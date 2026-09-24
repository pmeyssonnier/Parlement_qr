import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import type { Database } from "../src/lib/database.types";
import { passages, validateCorpus } from "../src/lib/documents";
import type { Question } from "../src/lib/schema";
import { assertBudgetFits, embeddingBatches, ImportBudget, positiveLimit } from "./import-budget";
import { retentionSummary } from "./retention";

type Db = SupabaseClient<Database>;
type Item = { q: Question; hash: string; passages: ReturnType<typeof passages>; texts: string[] };

// Well under the embeddings API limits (2 048 inputs, 300 000 tokens per request).
const BATCH_MAX_INPUTS = 256;
const BATCH_MAX_BYTES = 200_000;
// PostgREST returns at most 1 000 rows per request by default.
const PAGE_SIZE = 1000;
// Passage rows carry a 1 536-dimension vector as text (about 20 kB each).
const PASSAGE_CHUNK = 100;
// Unchanged questions copied per database call.
const CLONE_CHUNK = 500;

function toItem(q: Question): Item {
  const ps = passages(q);
  return {
    q,
    hash: createHash("sha256").update(JSON.stringify(q)).digest("hex"),
    passages: ps,
    texts: ps.map(p => `${q.titre}\n${q.auteur}\n${q.destinataire}\n${p.section.toUpperCase()}\n${p.text}`),
  };
}

async function previousHashes(db: Db, versionId: string) {
  const hashes = new Map<string, string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await db
      .from("questions")
      .select("id,content_hash")
      .eq("version_id", versionId)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error("Impossible de lire le corpus actif avant import.");
    for (const row of data) hashes.set(row.id, row.content_hash);
    if (data.length < PAGE_SIZE) return hashes;
  }
}

async function main() {
  const path = process.argv.find(a => a.startsWith("--file="))?.slice(7) || "data/corpus.json";
  const corpus = validateCorpus(JSON.parse(await readFile(path, "utf8")));
  const items = corpus.questions.map(toItem);
  const passageCount = items.reduce((n, item) => n + item.passages.length, 0);
  const maxRecords = positiveLimit(process.env.IMPORT_MAX_RECORDS, 6000);
  const keepVersions = positiveLimit(process.env.IMPORT_KEEP_VERSIONS, 2);
  if (corpus.questions.length > maxRecords) throw new Error("Plafond de fiches dépassé avant import.");
  const budget = new ImportBudget(
    positiveLimit(process.env.IMPORT_MAX_EMBEDDING_CALLS, 25),
    positiveLimit(process.env.IMPORT_MAX_EMBEDDING_BYTES, 250000),
  );
  if (process.argv.includes("--validate-only")) {
    console.log(`${corpus.questions.length} fiches, ${passageCount} passages : validation réussie.`);
    return;
  }
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, OPENAI_API_KEY: apiKey } = process.env;
  if (!url || !key) throw new Error("Configurez SUPABASE_URL et SUPABASE_SECRET_KEY dans .env.local.");
  const withoutEmbeddings = process.argv.includes("--without-embeddings");
  if (!apiKey && !withoutEmbeddings) throw new Error("Configurez OPENAI_API_KEY ou utilisez --without-embeddings.");
  const db = createClient<Database>(url, key, { auth: { persistSession: false } });
  const client = !withoutEmbeddings ? new OpenAI({ apiKey, timeout: 60000, maxRetries: 0 }) : null;
  const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  const { data: previous, error: previousError } = await db
    .from("corpus_versions")
    .select("id")
    .eq("active", true)
    .maybeSingle();
  if (previousError) throw new Error("Impossible de vérifier le corpus actif avant import.");

  // Unchanged questions keep their embeddings; only the others are sent to
  // OpenAI. The budget is checked before any version is created.
  const hashes = client && previous ? await previousHashes(db, previous.id) : new Map<string, string>();
  const unchanged = items.filter(item => hashes.get(item.q.id) === item.hash);
  const unchangedIds = new Set(unchanged.map(item => item.q.id));
  if (client)
    assertBudgetFits(
      budget,
      embeddingBatches(
        items.filter(item => !unchangedIds.has(item.q.id)),
        BATCH_MAX_INPUTS,
        BATCH_MAX_BYTES,
      ),
    );

  const { data: version, error } = await db
    .from("corpus_versions")
    .insert({ count: corpus.questions.length, extracted_at: corpus.extrait_le, method: corpus.methode_echantillonnage })
    .select("id")
    .single();
  if (error || !version)
    throw new Error("Impossible de créer la version. Vérifiez la migration et les accès Supabase.");
  try {
    const reused = new Set<string>();
    // In chunks, so that no single statement runs long enough to hit a
    // database statement timeout, whatever the corpus size.
    for (let from = 0; client && previous && from < unchanged.length; from += CLONE_CHUNK) {
      const { data, error } = await db.rpc("clone_unchanged_questions", {
        p_from: previous.id,
        p_to: version.id,
        p_model: model,
        p_questions: unchanged.slice(from, from + CLONE_CHUNK).map(item => ({ id: item.q.id, hash: item.hash })),
      });
      if (error)
        throw new Error("Reprise des fiches inchangées impossible : appliquez la migration 004_clone_unchanged.sql.");
      for (const id of data) reused.add(id);
    }
    const remaining = items.filter(item => !reused.has(item.q.id));
    let imported = 0;
    for (const batch of embeddingBatches(remaining, BATCH_MAX_INPUTS, BATCH_MAX_BYTES)) {
      const texts = batch.flatMap(item => item.texts);
      // pgvector accepts the "[x,y,…]" text form.
      let vectors: (string | null)[] = texts.map(() => null);
      if (client) {
        budget.reserve(texts);
        const response = await client.embeddings.create({ model, dimensions: 1536, input: texts });
        if (response.data.length !== texts.length) throw new Error("Réponse OpenAI incomplète.");
        vectors = response.data.sort((a, b) => a.index - b.index).map(d => JSON.stringify(d.embedding));
      }
      const { error: qe } = await db
        .from("questions")
        .insert(
          batch.map(item => ({ version_id: version.id, id: item.q.id, document: item.q, content_hash: item.hash })),
        );
      if (qe) throw new Error("Échec de l’importation des fiches.");
      const rows = batch.flatMap(item =>
        item.passages.map((p, i) => ({
          version_id: version.id,
          id: p.id,
          question_id: item.q.id,
          section: p.section,
          position: p.order,
          content: p.text,
          search_text: item.texts[i] ?? "",
        })),
      );
      for (let from = 0; from < rows.length; from += PASSAGE_CHUNK) {
        const chunk = rows.slice(from, from + PASSAGE_CHUNK).map((row, i) => ({
          ...row,
          embedding: vectors[from + i] ?? null,
          embedding_model: client ? model : null,
        }));
        const { error: pe } = await db.from("passages").insert(chunk);
        if (pe) throw new Error("Échec de l’importation des passages.");
      }
      imported += batch.length;
      console.log(`Importé : ${imported}/${remaining.length} fiches nouvelles ou modifiées`);
    }
    const { error: activationError } = await db.rpc("activate_corpus", {
      p_id: version.id,
      p_passage_count: passageCount,
    });
    if (activationError) throw new Error("La nouvelle version n’a pas été activée : import incomplet.");
    console.log(
      `Corpus activé : ${corpus.questions.length} fiches, ${passageCount} passages ` +
        `(${reused.size} reprises sans changement, ${remaining.length} nouvelles ou modifiées). Version : ${version.id}`,
    );
    console.log(`OpenAI : ${budget.calls} appels, ${budget.bytes} octets de texte envoyés au maximum.`);
    // Retention failure never fails an import that is already live.
    const { data: removed, error: pruneError } = await db.rpc("prune_corpus_versions", { p_keep: keepVersions });
    if (pruneError) console.warn("Anciennes versions non nettoyées : appliquez la migration 003_corpus_retention.sql.");
    else {
      const { data: remainingVersions, error: listError } = await db
        .from("corpus_versions")
        .select("activated_at,activation_unknown")
        .eq("active", false);
      console.log(
        listError || !remainingVersions
          ? `Rétention : ${removed} version(s) supprimée(s) ; détail des versions conservées indisponible.`
          : retentionSummary(removed, remainingVersions, keepVersions),
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
