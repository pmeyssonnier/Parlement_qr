import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateCase, type SearchCase, searchCases, summarize, withDisplay } from "../scripts/search-cases";
import { validateCorpus } from "../src/lib/documents";

// The corpus audit:search replays in the CI.
const corpus = validateCorpus(JSON.parse(readFileSync("data/corpus-refreshed.json", "utf8")));
const base: SearchCase = { id: "cas", kind: "titre", question: "Question", expect: ["B"] };

test("audit de recherche : les cas désignent des fiches du corpus", () => {
  const known = new Set(corpus.questions.map(q => q.moncode));
  const ids = searchCases.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length, "identifiants de cas en double");
  for (const c of searchCases) {
    for (const id of c.expect ?? []) assert.ok(known.has(id), `${c.id} : ${id} absente du corpus`);
    if (c.expect) assert.ok(c.expect.length > 0, `${c.id} : liste attendue vide`);
    if (c.gap !== undefined) assert.ok(c.gap.trim(), `${c.id} : écart sans explication`);
  }
  for (const kind of ["titre", "citoyen", "suivi", "hors_sujet"])
    assert.ok(
      searchCases.some(c => c.kind === kind && !c.gap),
      `aucun cas actif pour ${kind}`,
    );
});

test("audit de recherche : rang, rang maximal et hors sujet", () => {
  assert.equal(evaluateCase(base, ["A", "B"]).rank, 2);
  assert.equal(evaluateCase(base, ["A", "B"]).pass, true);
  assert.equal(evaluateCase({ ...base, maxRank: 1 }, ["A", "B"]).pass, false);
  assert.equal(evaluateCase(base, ["A", "C"]).pass, false);
  assert.equal(evaluateCase(base, ["A", "C", "D", "B"]).pass, false);
  const none: SearchCase = { ...base, kind: "hors_sujet", expect: null };
  assert.equal(evaluateCase(none, []).pass, true);
  assert.equal(evaluateCase(none, ["A"]).pass, false);
});

test("audit de recherche : la fiche retrouvée doit aussi être affichée", () => {
  const found = evaluateCase(base, ["B"]);
  assert.equal(withDisplay(found, base, ["B"]).pass, true);
  assert.equal(withDisplay(found, base, []).pass, false);
  const none: SearchCase = { ...base, kind: "hors_sujet", expect: null };
  assert.equal(withDisplay(evaluateCase(none, []), none, ["A"]).pass, false);
});

test("audit de recherche : écarts connus exclus des échecs, MRR", () => {
  const gap = { ...base, gap: "limite documentée" };
  const summary = summarize([
    evaluateCase(base, ["B"]),
    evaluateCase(base, ["A", "B"]),
    evaluateCase(gap, []),
    evaluateCase({ ...gap, id: "resolu" }, ["B"]),
  ]);
  assert.equal(summary.failed, 0);
  assert.equal(summary.knownGaps, 1);
  assert.deepEqual(summary.resolvedGaps, ["resolu"]);
  assert.equal(summary.top1, 0.5);
  assert.equal(summary.mrr, (1 + 0.5 + 0 + 1) / 4);
});
