import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { passages, searchText, validateCorpus } from "../src/lib/documents";
import { SCHEMA_VERSION } from "../src/lib/schema-version";
import { contentHash, indexConfig } from "./index-config";
import { psql, psqlValue } from "./psql";
import { copyRow, SUBSTITUTE_MODEL, SUBSTITUTE_VECTOR_SQL } from "./sql-parity";

// Prepares a THROWAWAY local PostgreSQL database (pgvector) for scripts/sql-check.ts:
// what Supabase provides (roles, extensions schema), the migrations in order,
// then the local corpus stored as the import would store it, with substitute
// vectors computed in SQL: no Supabase, no OpenAI, no cost.
//   SQL_CHECK_PSQL=psql PGHOST=localhost PGUSER=postgres PGPASSWORD=… PGDATABASE=… npm run check:sql:setup
// Options: --file=<corpus.json> (default data/corpus-refreshed.json), --reset (drops what a
// previous setup left in the public and extensions schemas).
const MIGRATIONS = join("supabase", "migrations");

const SUPABASE_BASICS = `
create schema if not exists extensions;
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    if not exists (select from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
  end loop; end $$;
-- As on Supabase: service_role bypasses row-level security (the tables enable it without any policy),
-- so without this attribute it would read no row at all.
alter role service_role bypassrls;`;

async function applyMigrations() {
  const files = (await readdir(MIGRATIONS)).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();
  for (const file of files) {
    psql(await readFile(join(MIGRATIONS, file), "utf8"));
    console.log(`Migration appliquée : ${file}`);
  }
  return files;
}

function loadScript(corpus: ReturnType<typeof validateCorpus>) {
  const config = indexConfig(SUBSTITUTE_MODEL);
  const items = corpus.questions.map(q => {
    const ps = passages(q);
    return { q, hash: contentHash(q, config), passages: ps, texts: ps.map(p => searchText(q, p)) };
  });
  const passageCount = items.reduce((n, item) => n + item.passages.length, 0);
  const docs = items.map(i => copyRow([i.hash, i.q.id, JSON.stringify(i.q)]));
  const rows = items.flatMap(i =>
    i.passages.map((p, n) => copyRow([i.hash, p.id, p.section, p.order, p.text, i.texts[n] as string])),
  );
  const refs = items.map(i => copyRow([i.q.id, i.hash]));
  const script = `
begin;
${SUBSTITUTE_VECTOR_SQL}
create temp table stage_documents (content_hash text, question_id text, document text) on commit drop;
create temp table stage_passages (content_hash text, id text, section text, position integer, content text, search_text text) on commit drop;
create temp table stage_references (question_id text, content_hash text) on commit drop;
copy stage_documents from stdin;
${docs.join("\n")}
\\.
copy stage_passages from stdin;
${rows.join("\n")}
\\.
copy stage_references from stdin;
${refs.join("\n")}
\\.
insert into question_documents (content_hash, question_id, document)
  select content_hash, question_id, document::jsonb from stage_documents;
insert into document_passages (content_hash, id, section, "position", content, search_text, embedding, embedding_model)
  select content_hash, id, section, position, content, search_text, pg_temp.substitute_vector(search_text), '${SUBSTITUTE_MODEL}'
  from stage_passages;
select gen_random_uuid() as version \\gset
insert into corpus_versions (id, count, extracted_at, method, index_config)
  values (:'version', ${items.length}, :'extracted_at', :'method', :'config');
insert into version_questions (version_id, question_id, content_hash)
  select :'version', question_id, content_hash from stage_references;
select activate_corpus(:'version', ${passageCount}) \\gset
commit;
select count(*) from corpus_versions where active;`;
  return { script, config, questions: items.length, passageCount };
}

async function main() {
  const file = process.argv.find(a => a.startsWith("--file="))?.slice(7) || "data/corpus-refreshed.json";
  const corpus = validateCorpus(JSON.parse(await readFile(file, "utf8")));

  if (psqlValue("select to_regclass('public.corpus_versions') is not null") === "t") {
    if (!process.argv.includes("--reset")) {
      throw new Error("La base contient déjà le schéma : utilisez une base vide ou relancez avec --reset.");
    }
    psql("drop schema public cascade; create schema public; drop schema if exists extensions cascade;");
  }
  psql(SUPABASE_BASICS);
  const files = await applyMigrations();

  // Rights Supabase gives to the roles: usage of the schemas, so that service_role can call the functions.
  psql("grant usage on schema public, extensions to service_role");
  // 010 can be replayed (web/supabase/tests/run.sh does it): replay it, then check that the rights
  // given above and by the migrations are intact (psql prints booleans as t / f).
  psql(await readFile(join(MIGRATIONS, "010_schema_version_and_quota_release.sql"), "utf8"));
  const search = "public.search_passages(text, extensions.vector, integer)";
  const rights = psqlValue(
    `select has_function_privilege('service_role', '${search}', 'execute'), has_function_privilege('anon', '${search}', 'execute'),
            has_function_privilege('authenticated', '${search}', 'execute')`,
  );
  if (rights !== "t|f|f")
    throw new Error(`Droits inattendus sur search_passages après le rejeu de 010 : ${rights} (attendu t|f|f).`);
  const version = psqlValue("select public.schema_version()");
  if (Number(version) !== SCHEMA_VERSION) {
    throw new Error(`schema_version() = ${version}, le code attend ${SCHEMA_VERSION} (${files.at(-1)}).`);
  }

  const started = Date.now();
  const { script, config, questions, passageCount } = loadScript(corpus);
  const active = psql(script, {
    extracted_at: corpus.extrait_le,
    method: corpus.methode_echantillonnage,
    config,
  }).trim();
  if (active !== "1") throw new Error(`Une seule version doit être active, ${active} trouvée(s).`);
  console.log(
    `Corpus chargé et activé : ${questions} fiches, ${passageCount} passages, vecteurs de substitution ` +
      `(${SUBSTITUTE_MODEL}), en ${((Date.now() - started) / 1000).toFixed(1)} s.`,
  );
}
main().catch(e => {
  console.error(e instanceof Error ? e.message : "Préparation de la base interrompue.");
  process.exitCode = 1;
});
