import assert from "node:assert/strict";
import test from "node:test";
import { ttlCache } from "../src/lib/ttl-cache";

test("cache : une seule requête pendant la durée de vie, puis rechargement", async () => {
  let clock = 0;
  let calls = 0;
  const get = ttlCache(
    async () => ++calls,
    1000,
    () => clock,
  );
  assert.deepEqual(await Promise.all([get(), get()]), [1, 1]);
  clock = 999;
  assert.equal(await get(), 1);
  clock = 1000;
  assert.equal(await get(), 2);
  assert.equal(calls, 2);
});
test("cache : une erreur n'est jamais mémorisée", async () => {
  let fail = true;
  const get = ttlCache(
    async () => {
      if (fail) throw new Error("indisponible");
      return "ok";
    },
    60_000,
    () => 0,
  );
  await assert.rejects(get());
  fail = false;
  assert.equal(await get(), "ok");
});
