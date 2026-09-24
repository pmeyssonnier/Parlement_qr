import assert from "node:assert/strict";
import test from "node:test";
import { assertBudgetFits, embeddingBatches, ImportBudget, positiveLimit } from "../scripts/import-budget";

test("le budget réserve avant l'appel et refuse tout dépassement", () => {
  const b = new ImportBudget(2, 6);
  b.reserve(["é"]); // two UTF-8 bytes
  assert.equal(b.bytes, 2);
  assert.throws(() => b.reserve(["12345"]));
  assert.equal(b.calls, 1);
  b.reserve(["1234"]);
  assert.equal(b.bytes, 6);
  assert.throws(() => b.reserve([""]));
});
test("les plafonds invalides ne désactivent pas la protection", () => {
  for (const v of ["0", "-1", "NaN", "Infinity", "1.5", ""]) assert.throws(() => positiveLimit(v, 25));
  assert.equal(positiveLimit(undefined, 25), 25);
  assert.equal(positiveLimit("10", 25), 10);
});

const item = (id: string, ...texts: string[]) => ({ id, texts });

test("lots d’embeddings : fiches entières, plafonds d’entrées et d’octets", () => {
  const items = [item("a", "12", "34"), item("b", "56"), item("c", "7890"), item("d", "é")];
  const ids = (batches: { id: string }[][]) => batches.map(batch => batch.map(i => i.id));
  assert.deepEqual(ids(embeddingBatches(items, 3, 100)), [
    ["a", "b"],
    ["c", "d"],
  ]);
  assert.deepEqual(ids(embeddingBatches(items, 10, 6)), [
    ["a", "b"],
    ["c", "d"],
  ]);
  // A question larger than the limits gets a request of its own, never split.
  assert.deepEqual(ids(embeddingBatches([item("big", "x".repeat(50)), item("e", "y")], 10, 10)), [["big"], ["e"]]);
  assert.deepEqual(embeddingBatches([], 10, 10), []);
});
test("le budget est vérifié avant tout import", () => {
  const batches = embeddingBatches([item("a", "1234"), item("b", "5678")], 1, 100);
  assert.doesNotThrow(() => assertBudgetFits(new ImportBudget(2, 8), batches));
  assert.throws(() => assertBudgetFits(new ImportBudget(1, 100), batches), /2 appels et 8 octets/);
  assert.throws(() => assertBudgetFits(new ImportBudget(5, 7), batches), /corpus précédent reste actif/);
});
