import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import type { Database } from "../src/lib/database.types";
import { passages, validateCorpus } from "../src/lib/documents";
import { ImportBudget, positiveLimit } from "./import-budget";
import { retentionSummary } from "./retention";

async function main() {
  const path = process.argv.find(a => a.startsWith("--file="))?.slice(7) || "data/corpus.json";
  const corpus = validateCorpus(JSON.parse(await readFile(path, "utf8")));
  const allPassages = corpus.questions.flatMap(passages);
  const maxRecords = positiveLimit(process.env.IMPORT_MAX_RECORDS, 500);
  const keepVersions = positiveLimit(process.env.IMPORT_KEEP_VERSIONS, 2);
  if (corpus.questions.length > maxRecords) throw new Error("Plafond de fiches dépassé avant import.");
  const budget = new ImportBudget(
    positiveLimit(process.env.IMPORT_MAX_EMBEDDING_CALLS, 25),
    positiveLimit(process.env.IMPORT_MAX_EMBEDDING_BYTES, 250000),
  );
  if (process.argv.includes("--validate-only")) {
    console.log(`${corpus.questions.length} fiches, ${allPassages.length} passages : validation réussie.`);
    return;
  }
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, OPENAI_API_KEY: apiKey } = process.env;
  if (!url || !key) throw new Error("Configurez SUPABASE_URL et SUPABASE_SECRET_KEY dans .env.local.");
  const withoutEmbeddings = process.argv.includes("--without-embeddings");
  if (!apiKey && !withoutEmbeddings) throw new Error("Configurez OPENAI_API_KEY ou utilisez --without-embeddings.");
  const db = createClient<Database>(url, key, { auth: { persistSession: false } });
  const client = !withoutEmbeddings ? new OpenAI({ apiKey, timeout: 30000, maxRetries: 0 }) : null;
  const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  const { data: previous, error: previousError } = await db
    .from("corpus_versions")
    .select("id")
    .eq("active", true)
    .maybeSingle();
  if (previousError) throw new Error("Impossible de vérifier le corpus actif avant import.");
  const { data: version, error } = await db
    .from("corpus_versions")
    .insert({ count: corpus.questions.length, extracted_at: corpus.extrait_le, method: corpus.methode_echantillonnage })
    .select("id")
    .single();
  if (error || !version)
    throw new Error("Impossible de créer la version. Vérifiez la migration et les accès Supabase.");
  try {
    for (const q of corpus.questions) {
      const hash = createHash("sha256").update(JSON.stringify(q)).digest("hex");
      const { error } = await db
        .from("questions")
        .insert({ version_id: version.id, id: q.id, document: q, content_hash: hash });
      if (error) throw new Error("Échec de l’importation d’une fiche.");
      const ps = passages(q);
      const searchText = (p: (typeof ps)[number]) =>
        `${q.titre}\n${q.auteur}\n${q.destinataire}\n${p.section.toUpperCase()}\n${p.text}`;
      const searchTexts = ps.map(searchText);
      // pgvector accepts the "[x,y,…]" text form, which is also how cached vectors come back.
      let vectors: (string | null)[] = [];
      if (client && previous) {
        const { data: oldQuestion } = await db
          .from("questions")
          .select("content_hash")
          .eq("version_id", previous.id)
          .eq("id", q.id)
          .maybeSingle();
        if (oldQuestion?.content_hash === hash) {
          const { data: cached } = await db
            .from("passages")
            .select("id,embedding,embedding_model")
            .eq("version_id", previous.id)
            .eq("question_id", q.id);
          const cache = new Map((cached || []).map(p => [p.id, p]));
          if (ps.every(p => cache.get(p.id)?.embedding && cache.get(p.id)?.embedding_model === model))
            vectors = ps.map(p => cache.get(p.id)?.embedding ?? null);
        }
      }
      if (client && !vectors.length) {
        budget.reserve(searchTexts);
        vectors = (await client.embeddings.create({ model, dimensions: 1536, input: searchTexts })).data
          .sort((a, b) => a.index - b.index)
          .map(d => JSON.stringify(d.embedding));
      }
      const { error: pe } = await db.from("passages").insert(
        ps.map((p, i) => ({
          version_id: version.id,
          id: p.id,
          question_id: q.id,
          section: p.section,
          position: p.order,
          content: p.text,
          search_text: searchText(p),
          embedding: vectors[i] ?? null,
          embedding_model: client ? model : null,
        })),
      );
      if (pe) throw new Error("Échec de l’importation des passages.");
      console.log(`Importé : ${q.id} (${ps.length} passages)`);
    }
    const { error: activationError } = await db.rpc("activate_corpus", {
      p_id: version.id,
      p_passage_count: allPassages.length,
    });
    if (activationError) throw new Error("La nouvelle version n’a pas été activée : import incomplet.");
    console.log(
      `Corpus activé : ${corpus.questions.length} fiches, ${allPassages.length} passages. Version : ${version.id}`,
    );
    console.log(`OpenAI : ${budget.calls} appels, ${budget.bytes} octets de texte envoyés au maximum.`);
    // Retention failure never fails an import that is already live.
    const { data: removed, error: pruneError } = await db.rpc("prune_corpus_versions", { p_keep: keepVersions });
    if (pruneError) console.warn("Anciennes versions non nettoyées : appliquez la migration 003_corpus_retention.sql.");
    else {
      const { data: remaining, error: listError } = await db
        .from("corpus_versions")
        .select("activated_at,activation_unknown")
        .eq("active", false);
      console.log(
        listError || !remaining
          ? `Rétention : ${removed} version(s) supprimée(s) ; détail des versions conservées indisponible.`
          : retentionSummary(removed, remaining, keepVersions),
      );
    }
  } catch (error) {
    console.error(`Import interrompu. La version précédente reste active. Version de préparation : ${version.id}`);
    throw error;
  }
}
main().catch(e => {
  console.error(e instanceof Error ? e.message : "Échec de l’importation.");
  process.exitCode = 1;
});
