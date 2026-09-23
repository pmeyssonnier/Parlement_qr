import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { validateCorpus, passages } from "../src/lib/documents";

async function main() {
  const path = process.argv.find(a => a.startsWith("--file="))?.slice(7) || "data/corpus.json";
  const corpus = validateCorpus(JSON.parse(await readFile(path, "utf8")));
  const allPassages = corpus.questions.flatMap(passages);
  if (process.argv.includes("--validate-only")) { console.log(`${corpus.questions.length} fiches, ${allPassages.length} passages : validation réussie.`); return; }
  const { SUPABASE_URL: url, SUPABASE_SECRET_KEY: key, OPENAI_API_KEY: apiKey } = process.env;
  if (!url || !key) throw new Error("Configurez SUPABASE_URL et SUPABASE_SECRET_KEY dans .env.local.");
  const withoutEmbeddings = process.argv.includes("--without-embeddings");
  if (!apiKey && !withoutEmbeddings) throw new Error("Configurez OPENAI_API_KEY ou utilisez --without-embeddings.");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const client = !withoutEmbeddings ? new OpenAI({ apiKey, timeout: 30000, maxRetries: 2 }) : null;
  const model = process.env.EMBEDDING_MODEL || "text-embedding-3-small";
  const { data: previous } = await db.from("corpus_versions").select("id").eq("active",true).maybeSingle();
  const { data: version, error } = await db.from("corpus_versions").insert({ count: corpus.questions.length, extracted_at: corpus.extrait_le, method: corpus.methode_echantillonnage }).select("id").single();
  if (error || !version) throw new Error("Impossible de créer la version. Vérifiez la migration et les accès Supabase.");
  try {
    for (const q of corpus.questions) {
      const hash = createHash("sha256").update(JSON.stringify(q)).digest("hex");
      const { error } = await db.from("questions").insert({ version_id: version.id, id: q.id, document: q, content_hash: hash });
      if (error) throw new Error("Échec de l’importation d’une fiche.");
      const ps = passages(q);
      const searchTexts = ps.map(p => `${q.titre}\n${q.auteur}\n${q.destinataire}\n${p.section.toUpperCase()}\n${p.text}`);
      let vectors: (number[] | string)[] = [];
      if (client && previous) {
        const { data: oldQuestion } = await db.from("questions").select("content_hash").eq("version_id",previous.id).eq("id",q.id).maybeSingle();
        if (oldQuestion?.content_hash === hash) {
          const { data: cached } = await db.from("passages").select("id,embedding,embedding_model").eq("version_id",previous.id).eq("question_id",q.id);
          const cache = new Map((cached || []).map(p=>[p.id,p]));
          if (ps.every(p=>cache.get(p.id)?.embedding && cache.get(p.id)?.embedding_model===model)) vectors=ps.map(p=>cache.get(p.id)!.embedding);
        }
      }
      if (client && !vectors.length) vectors=(await client.embeddings.create({ model, dimensions:1536, input:searchTexts })).data.sort((a,b)=>a.index-b.index).map(d=>d.embedding);
      const { error: pe } = await db.from("passages").insert(ps.map((p,i) => ({ version_id: version.id, id:p.id, question_id:q.id, section:p.section, position:p.order, content:p.text, search_text:searchTexts[i], embedding:vectors[i] || null, embedding_model:client ? model : null })));
      if (pe) throw new Error("Échec de l’importation des passages.");
      console.log(`Importé : ${q.id} (${ps.length} passages)`);
    }
    const { error: activationError } = await db.rpc("activate_corpus", { p_id:version.id, p_passage_count:allPassages.length });
    if (activationError) throw new Error("La nouvelle version n’a pas été activée : import incomplet.");
    console.log(`Corpus activé : ${corpus.questions.length} fiches, ${allPassages.length} passages. Version : ${version.id}`);
  } catch (error) {
    console.error(`Import interrompu. La version précédente reste active. Version de préparation : ${version.id}`);
    throw error;
  }
}
main().catch(e => { console.error(e instanceof Error ? e.message : "Échec de l’importation."); process.exitCode=1; });
