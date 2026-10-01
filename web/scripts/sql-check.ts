import { readFile } from "node:fs/promises";
import { validateCorpus } from "../src/lib/documents";
import type { Hit } from "../src/lib/schema";
import { contextualQuery, filterLexicalHits, lexicalQuery, localSearch } from "../src/lib/search";
import { psql } from "./psql";
import { evaluateCase, searchCases } from "./search-cases";
import {
  compareRows,
  type Difference,
  documentedProblem,
  KNOWN_KINDS,
  type Row,
  randomQueries,
  rareTitleWords,
  round6,
  SUBSTITUTE_VECTOR_SQL,
  titleVocabulary,
} from "./sql-parity";

// Parity of the two searches on the database prepared by scripts/sql-setup.ts:
// search_passages (SQL, used in production through Supabase) against localSearch
// (TypeScript, used by audit:search and as the fallback). Without a vector the SQL
// ranking is purely lexical, which is what is compared; with substitute vectors the
// semantic scores mean nothing, so only the contract is checked (it answers, it
// respects the limit).
//   SQL_CHECK_PSQL=psql PGHOST=localhost … npm run check:sql
const SEED = 20260930;
const RANDOM_QUERIES = 100;
const RARE_WORDS = 15;
const LIMIT = 6;

type Query = {
  group: "cas" | "hasard" | "rare";
  label: string;
  text: string;
  expect?: string[];
  caseId?: string;
  gap?: string;
};
type SqlRow = Row & { question_id: string; section: string; q: Hit["question"] };

// What findHits sends to the SQL: lexicalQuery(), which holds only letters, digits and " OR ".
function sqlQuery(terms: string) {
  if (!/^[a-z0-9 ]*$/.test(terms.replace(/ OR /g, " "))) throw new Error(`Termes inattendus : ${terms}`);
  return `select json_build_object('id', id, 'question_id', question_id, 'section', section, 'score', score, 'q', document)
  from public.search_passages('${terms}', null::extensions.vector, ${LIMIT})
    with ordinality as r(id, question_id, section, content, "position", score, document, n) order by n;`;
}

// Runs as service_role, the role the application uses: the grants of the migrations are exercised too.
function runSql(queries: Query[]) {
  const script = [
    "set role service_role;",
    ...queries.flatMap((query, i) => [`select 'Q${i}';`, sqlQuery(lexicalQuery(query.text))]),
  ].join("\n");
  const results = new Map<number, SqlRow[]>();
  let current = -1;
  for (const line of psql(script).split("\n")) {
    const header = line.match(/^Q(\d+)$/);
    if (header) {
      current = Number(header[1]);
      results.set(current, []);
    } else if (line.startsWith("{")) results.get(current)?.push(JSON.parse(line));
  }
  return results;
}

/** Contract of the function with a vector: it answers and respects the limit (the scores are not compared). */
function checkVectorContract(texts: string[]): string[] {
  const problems: string[] = [];
  for (const text of texts) {
    const terms = lexicalQuery(text);
    for (const [limit, max] of [
      [1, 1],
      [LIMIT, LIMIT],
      [100, 8],
    ] as const) {
      // The vector is computed once and passed as a literal: inlined in the function, an expression
      // would be evaluated again for every passage.
      const out = psql(
        `${SUBSTITUTE_VECTOR_SQL}
select pg_temp.substitute_vector('${text.replace(/[^a-z0-9 ]/gi, "")}') as vector \\gset
set role service_role;
select count(*), coalesce(bool_and(section = 'reponse'), true)
from public.search_passages('${terms}', :'vector'::extensions.vector, ${limit});`,
      ).trim();
      const [count, onlyAnswers] = out.split("|");
      if (Number(count) < 1 || Number(count) > max || onlyAnswers !== "t") {
        problems.push(
          `avec vecteur, « ${text} », limite ${limit} : ${count} ligne(s), uniquement réponses = ${onlyAnswers}`,
        );
      }
    }
  }
  return problems;
}

/** anon must not run the function (psql prints « permission denied »). */
function checkAnonDenied(): string | null {
  try {
    psql("set role anon; select count(*) from public.search_passages('tram', null, 1);");
    return "anon peut appeler search_passages";
  } catch (error) {
    return error instanceof Error && /permission denied/i.test(error.message)
      ? null
      : `erreur inattendue pour anon : ${error}`;
  }
}

async function main() {
  const file = process.argv.find(a => a.startsWith("--file="))?.slice(7) || "data/corpus-refreshed.json";
  const corpus = validateCorpus(JSON.parse(await readFile(file, "utf8")));
  const questions = corpus.questions;

  const queries: Query[] = [
    ...searchCases.map<Query>(c => ({
      group: "cas",
      label: c.id,
      caseId: c.id,
      text: contextualQuery(
        c.question,
        (c.history ?? []).map(content => ({ content })),
      ),
      gap: c.gap,
    })),
    ...randomQueries(titleVocabulary(questions), RANDOM_QUERIES, SEED).map<Query>((text, i) => ({
      group: "hasard",
      label: `hasard-${String(i + 1).padStart(3, "0")}`,
      text,
    })),
    ...rareTitleWords(questions, RARE_WORDS, SEED).map<Query>(({ word, moncode }) => ({
      group: "rare",
      label: `rare-${word}`,
      text: word,
      expect: [moncode],
    })),
  ];

  const sql = runSql(queries);
  const reports: string[] = [];
  const counts = { cas: 0, hasard: 0, rare: 0 };
  const tally = new Map<string, number>();
  const knownTally = new Map<string, number>();
  let failing = 0;
  let known = 0;
  queries.forEach((query, i) => {
    const sqlHits: Hit[] = (sql.get(i) ?? []).map(r => ({
      passage: {
        id: r.id,
        questionId: r.question_id,
        section: r.section as "question" | "reponse",
        text: "",
        order: 0,
      },
      question: r.q,
      score: r.score,
    }));
    // What production does without a vector: the rows of the SQL, then the lexical filter.
    const production = filterLexicalHits(sqlHits, query.text);
    const local = localSearch(questions, query.text, LIMIT);
    const differences: Difference[] = compareRows(
      local.map(h => ({ id: h.passage.id, score: h.score })),
      production.map(h => ({ id: h.passage.id, score: h.score })),
    );
    // The expectations: the audit case (rank among distinct questions) or the document of a rare word.
    const expected = query.caseId ? searchCases.find(c => c.id === query.caseId) : undefined;
    for (const [name, hits] of [
      ["local", local],
      ["SQL", production],
    ] as const) {
      const distinct = [...new Set(hits.map(h => h.question.moncode))];
      if (expected) {
        const result = evaluateCase(expected, distinct);
        if (!result.pass && !query.gap)
          differences.push({
            kind: "attendu",
            detail: `${name} : cas de l'audit non tenu (${result.reason ?? "rang"} ${JSON.stringify(distinct)})`,
          });
      } else if (query.expect && !distinct.some(m => query.expect?.includes(m))) {
        differences.push({
          kind: "attendu",
          detail: `${name} ne renvoie pas le document attendu ${query.expect.join("/")}`,
        });
      }
    }
    counts[query.group]++;
    if (!differences.length) return;
    // A known kind is documented by a migration: it stays known only while the SQL rows keep that property.
    const sqlRows = production.map(h => ({ id: h.passage.id, question_id: h.passage.questionId, score: h.score }));
    const notes = new Map<Difference, string>();
    const unknown = differences.filter(d => {
      const reason = KNOWN_KINDS[d.kind];
      if (!reason) return true;
      const broken = documentedProblem(d.kind, sqlRows);
      if (broken) {
        d.detail = `${d.detail} ; la propriété documentée n'est pas tenue (${broken})`;
        return true;
      }
      notes.set(d, reason);
      return false;
    });
    for (const d of differences) {
      const target = unknown.includes(d) ? tally : knownTally;
      target.set(d.kind, (target.get(d.kind) ?? 0) + 1);
    }
    if (unknown.length) failing++;
    else known++;
    reports.push(
      [
        `${unknown.length ? "ÉCART" : "ÉCART CONNU"} ${query.label} (${query.group}) : « ${query.text} »`,
        `  termes envoyés au SQL : ${lexicalQuery(query.text) || "(aucun)"}`,
        `  local : ${JSON.stringify(local.map(h => [h.passage.id, round6(h.score)]))}`,
        `  SQL   : ${JSON.stringify(production.map(h => [h.passage.id, round6(h.score)]))}`,
        ...differences.map(d => `  - ${d.kind}${notes.has(d) ? " (connu)" : ""} : ${d.detail}`),
      ].join("\n"),
    );
  });

  const problems = [
    ...checkVectorContract(["tram 55", "stib chaleur", "elagage arbres"]),
    ...[checkAnonDenied()].flatMap(p => (p ? [p] : [])),
  ];
  console.log(reports.join("\n"));
  for (const problem of problems) console.log(`CONTRAT ${problem}`);
  console.log(
    `Parité : ${queries.length} requêtes (${counts.cas} cas de l'audit, ${counts.hasard} au hasard, graine ${SEED}, ${counts.rare} mots rares) : ` +
      `${failing} écart(s) inconnu(s)${tally.size ? ` [${[...tally].map(([k, v]) => `${v} ${k}`).join(", ")}]` : ""}, ${known} requête(s) à écarts connus seulement${knownTally.size ? ` [${[...knownTally].map(([k, v]) => `${v} ${k}`).join(", ")}]` : ""}, ` +
      `${problems.length} problème(s) de contrat.`,
  );
  if (failing || problems.length) process.exitCode = 1;
}
main().catch(e => {
  console.error(e instanceof Error ? e.message : "Contrôle SQL interrompu.");
  process.exitCode = 1;
});
