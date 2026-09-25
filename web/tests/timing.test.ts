import assert from "node:assert/strict";
import test from "node:test";
import { failureCode, type Timings, timed } from "../src/lib/timing";

test("durées : chaque étape est mesurée, même en cas d'échec", async () => {
  const timings: Timings = {};
  assert.equal(await timed(timings, "quota", async () => "ia"), "ia");
  await assert.rejects(
    timed(timings, "search", async () => {
      throw new Error("SEARCH_UNAVAILABLE");
    }),
  );
  assert.deepEqual(Object.keys(timings), ["quota", "search"]);
  assert.ok(Object.values(timings).every(ms => Number.isInteger(ms) && ms >= 0));
  assert.equal(await timed(undefined, "search", async () => 1), 1);
});
test("codes d'échec : seuls les codes de l'application entrent dans les journaux", () => {
  assert.equal(failureCode(new Error("QUOTA_UNAVAILABLE")), "QUOTA_UNAVAILABLE");
  assert.equal(failureCode(new Error("CONFIGURATION")), "CONFIGURATION");
  assert.equal(failureCode(new Error("connect ECONNREFUSED 10.0.0.1:443")), "UNEXPECTED");
  assert.equal(failureCode(new Error('[{"code":"invalid_type"}]')), "UNEXPECTED");
  assert.equal(failureCode("SEARCH_UNAVAILABLE"), "UNEXPECTED");
});
