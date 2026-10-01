import assert from "node:assert/strict";
import test from "node:test";
import { assertLocalDatabase, psqlCommand } from "../scripts/psql";
import {
  compareRows,
  copyField,
  copyRow,
  documentedProblem,
  KNOWN_KINDS,
  randomQueries,
  rareTitleWords,
  round6,
  rrfRank,
  seededRandom,
  titleVocabulary,
} from "../scripts/sql-parity";
import { corpus } from "../src/lib/corpus";

test("COPY : séparateurs, retours à la ligne et barres obliques sont protégés, null devient \\N", () => {
  assert.equal(copyField("a\tb\nc\r\\d"), "a\\tb\\nc\\r\\\\d");
  assert.equal(copyField(null), "\\N");
  assert.equal(copyField(3), "3");
  assert.equal(copyRow(["x", 1, null]), "x\t1\t\\N");
});

test("graine fixe : mêmes requêtes à chaque exécution, 1 à 4 mots distincts du vocabulaire des titres", () => {
  const first = seededRandom(42);
  const second = seededRandom(42);
  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
  const vocabulary = titleVocabulary(corpus.questions);
  assert.ok(vocabulary.length > 20);
  assert.deepEqual(vocabulary, [...vocabulary].sort());
  const queries = randomQueries(vocabulary, 100, 20260930);
  assert.deepEqual(queries, randomQueries(vocabulary, 100, 20260930));
  assert.notDeepEqual(queries, randomQueries(vocabulary, 100, 1));
  for (const query of queries) {
    const words = query.split(" ");
    assert.ok(words.length >= 1 && words.length <= 4, query);
    assert.equal(new Set(words).size, words.length, query);
    assert.ok(
      words.every(w => vocabulary.includes(w)),
      query,
    );
  }
});

test("mots rares : un seul titre, une fiche avec réponse, jamais ailleurs dans le corpus", () => {
  const rare = rareTitleWords(corpus.questions, 5, 20260930);
  assert.deepEqual(rare, rareTitleWords(corpus.questions, 5, 20260930));
  for (const { word, moncode } of rare) {
    const owner = corpus.questions.find(q => q.moncode === moncode);
    assert.ok(owner?.reponse?.trim(), word);
  }
});

test("comparaison : l'écart est rangé dans sa catégorie la plus précise", () => {
  const row = (id: string, score = 1) => ({ id, score });
  const q1a = "PRB-1-1:reponse:0";
  const q1b = "PRB-1-1:reponse:1";
  const q2a = "PRB-1-2:reponse:0";
  assert.deepEqual(compareRows([row(q1a)], [row(q1a)]), []);
  assert.equal(compareRows([row(q1a)], [])[0]?.kind, "sql-vide");
  assert.equal(compareRows([], [row(q1a)])[0]?.kind, "local-vide");
  assert.equal(compareRows([row(q1a)], [row(q2a)])[0]?.kind, "premiere-question");
  assert.equal(compareRows([row(q1a)], [row(q1a), row(q2a)])[0]?.kind, "questions");
  assert.equal(compareRows([row(q1a), row(q1b)], [row(q1a), row("PRB-1-1:reponse:2")])[0]?.kind, "passages");
  assert.equal(compareRows([row(q1a), row(q1b)], [row(q1b), row(q1a)])[0]?.kind, "ordre");
  assert.equal(compareRows([row(q1a, 1)], [row(q1a, 0.5)])[0]?.kind, "scores");
  assert.deepEqual(compareRows([row(q1a, 1.0000001)], [row(q1a, 1.0000002)]), []); // 6 décimales
  assert.equal(round6(0.0163934426), 0.016393);
});

test("psql : SQL_CHECK_PSQL est obligatoire et seule une base locale est acceptée", () => {
  assert.throws(() => psqlCommand({}), /SQL_CHECK_PSQL/);
  assert.equal(psqlCommand({ SQL_CHECK_PSQL: " psql " }), "psql");
  for (const env of [{}, { PGHOST: "localhost" }, { PGHOST: "127.0.0.1" }, { PGHOST: "/var/run/postgresql" }]) {
    assert.doesNotThrow(() => assertLocalDatabase(env));
  }
  for (const host of ["db.abcdefgh.supabase.co", "10.0.0.5", "example.com"]) {
    assert.throws(() => assertLocalDatabase({ PGHOST: host }), /base locale/);
  }
  assert.throws(() => assertLocalDatabase({ PGHOSTADDR: "203.0.113.7" }), /base locale/);
  assert.throws(() => assertLocalDatabase({ PGSERVICE: "supabase" }), /PGSERVICE/);
});

test("écarts connus : seulement scores et ordre, et seulement si la propriété documentée tient", () => {
  assert.deepEqual(Object.keys(KNOWN_KINDS).sort(), ["ordre", "scores"]);
  assert.equal(rrfRank(1 / 61), 1);
  assert.equal(rrfRank(1 / 63), 3);
  assert.equal(rrfRank(8.31), null);
  const row = (question_id: string, id: string, score: number) => ({ id, question_id, score });
  const ok = [row("a", "a0", 1 / 61), row("a", "a1", 1 / 61), row("b", "b0", 1 / 62), row("b", "b1", 1 / 62)];
  assert.equal(documentedProblem("scores", ok), null);
  assert.match(documentedProblem("scores", [row("a", "a0", 8.31)]) ?? "", /1\/\(60\+rang\)/);
  assert.match(documentedProblem("scores", [row("a", "a0", 1 / 62), row("b", "b0", 1 / 61)]) ?? "", /plus élevé/);
  assert.match(documentedProblem("scores", [row("a", "a0", 1 / 61), row("a", "a1", 1 / 62)]) ?? "", /différents/);
  assert.equal(documentedProblem("ordre", ok), null);
  const bad = [row("a", "a0", 1), row("b", "b0", 1), row("b", "b1", 1), row("c", "c0", 1)];
  assert.match(documentedProblem("ordre", bad) ?? "", /premier passage après des seconds/);
  assert.equal(documentedProblem("questions", ok), null);
});
