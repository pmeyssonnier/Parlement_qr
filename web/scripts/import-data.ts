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
// Passage rows carry a 1 536-dimension vector as text (about 20 kB each).
const PASSAGE_CHUNK = 100;
// Hashes checked, and version references written, per database call.
const REFERENCE_CHUNK = 500;

function toItem(q: Question): Item {
  const ps = passages(q);
  return {
    q,
    hash: createHash("sha256").update(JSON.stringify(q)).digest("hex"),
    passages: ps,
    texts: ps.map(p => `${q.titre}\n${q.auteur}\n${q.destinataire}\n${p.section.toUpperCase()}\n${p.text}`),
  };
}

// Contents are stored once, keyed by their hash (migration 005). A content is
// ready when all its passages are stored with an embedding of the current
// model; any other content is (re)written.
async function readyHashes(db: Db, items: Item[], model: string) {
  const ready = new Set<string>();
  for (let from = 0; from < items.length; from += REFERENCE_CHUNK) {
    const chunk = items.slice(from, from + REFERENCE_CHUNK);
    const { data, error } = await db.rpc("ready_documents", { p_hashes: chunk.map(item => item.hash), p_model: model });
    if (error)
      throw new Error(
        "Lecture des contenus stockés impossible : appliquez la migration 005_deduplicate_documents.sql.",
      );
    const counts = new Map(data.map(row => [row.content_hash, row.ready_passages]));
    for (const item of chunk) if (counts.get(item.hash) === item.passages.length) ready.add(item.hash);
  }
  return ready;
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

  // Only contents not stored yet (or stored without a usable embedding) are
  // written and sent to OpenAI. The budget is checked before anything is written.
  const ready = await readyHashes(db, items, model);
  const missing = items.filter(item => !ready.has(item.hash));
  const batches = embeddingBatches(missing, BATCH_MAX_INPUTS, BATCH_MAX_BYTES);
  if (client) assertBudgetFits(budget, batches);

  const { data: version, error } = await db
    .from("corpus_versions")
    .insert({ count: corpus.questions.length, extracted_at: corpus.extrait_le, method: corpus.methode_echantillonnage })
    .select("id")
    .single();
  if (error || !version)
    throw new Error("Impossible de créer la version. Vérifiez la migration et les accès Supabase.");
  try {
    let stored = 0;
    for (const batch of batches) {
      const texts = batch.flatMap(item => item.texts);
      // pgvector accepts the "[x,y,…]" text form.
      let vectors: (string | null)[] = texts.map(() => null);
      if (client) {
        budget.reserve(texts);
        const response = await client.embeddings.create({ model, dimensions: 1536, input: texts });
        if (response.data.length !== texts.length) throw new Error("Réponse OpenAI incomplète.");
        vectors = response.data.sort((a, b) => a.index - b.index).map(d => JSON.stringify(d.embedding));
      }
      // A content may already exist with incomplete passages: keep the
      // document, complete or replace its passages.
      const { error: de } = await db.from("question_documents").upsert(
        batch.map(item => ({ content_hash: item.hash, question_id: item.q.id, document: item.q })),
        { onConflict: "content_hash", ignoreDuplicates: true },
      );
      if (de) throw new Error("Échec de l’enregistrement des fiches.");
      const rows = batch.flatMap(item =>
        item.passages.map((p, i) => ({
          content_hash: item.hash,
          id: p.id,
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
        const { error: pe } = await db.from("document_passages").upsert(chunk, { onConflict: "content_hash,id" });
        if (pe) throw new Error("Échec de l’enregistrement des passages.");
      }
      stored += batch.length;
      console.log(`Enregistré : ${stored}/${missing.length} fiches nouvelles ou modifiées`);
    }
    for (let from = 0; from < items.length; from += REFERENCE_CHUNK) {
      const { error: re } = await db
        .from("version_questions")
        .insert(
          items
            .slice(from, from + REFERENCE_CHUNK)
            .map(item => ({ version_id: version.id, question_id: item.q.id, content_hash: item.hash })),
        );
      if (re) throw new Error("Échec de la composition de la version.");
    }
    const { error: activationError } = await db.rpc("activate_corpus", {
      p_id: version.id,
      p_passage_count: passageCount,
    });
    if (activationError) throw new Error("La nouvelle version n’a pas été activée : import incomplet.");
    console.log(
      `Corpus activé : ${corpus.questions.length} fiches, ${passageCount} passages ` +
        `(${items.length - missing.length} déjà stockées, ${missing.length} nouvelles ou modifiées). Version : ${version.id}`,
    );
    console.log(`OpenAI : ${budget.calls} appels, ${budget.bytes} octets de texte envoyés au maximum.`);
    // Retention failure never fails an import that is already live.
    const { data: removed, error: pruneError } = await db.rpc("prune_corpus_versions", { p_keep: keepVersions });
    if (pruneError) console.warn("Anciennes versions non nettoyées : appliquez les migrations 003 et 005.");
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
