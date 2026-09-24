import assert from "node:assert/strict";
import test from "node:test";
import { retentionSummary } from "../scripts/retention";

const rollback = { activated_at: "2026-09-24T15:03:43Z", activation_unknown: false };
const unknown = { activated_at: null, activation_unknown: true };
const recent = { activated_at: null, activation_unknown: false };

test("rétention : le message compte les versions réellement conservées", () => {
  assert.equal(
    retentionSummary(0, [rollback, unknown, unknown, unknown, unknown], 2),
    "Rétention : 0 version supprimée ; conservé : 1 version pour retour arrière (2 au plus), " +
      "4 versions antérieures à la migration, jamais supprimée(s).",
  );
});
test("rétention : imports récents et accords au pluriel", () => {
  assert.equal(
    retentionSummary(3, [rollback, rollback, recent], 2),
    "Rétention : 3 versions supprimées ; conservé : 2 versions pour retour arrière (2 au plus), " +
      "1 import récent non activé.",
  );
  assert.equal(
    retentionSummary(1, [], 2),
    "Rétention : 1 version supprimée ; conservé : 0 version pour retour arrière (2 au plus).",
  );
});
