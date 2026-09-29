import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { RATE_LIMIT_ATTEMPTS, rateLimitDelay, withRateLimitRetry } from "../scripts/rate-limit";

const limited = (message = "Rate limit reached", headers: Record<string, string> = {}, code = "rate_limit_exceeded") =>
  Object.assign(new Error(message), { status: 429, code, headers: new Headers(headers) });

test("429 : l'attente annoncée par les en-têtes ou par le message", () => {
  // The message of the run of 29 September 2026: « Please try again in 1.156s ».
  const message =
    "Rate limit reached for text-embedding-3-small on tokens per min (TPM): Limit 1000000, Used 969710, Requested 49559. Please try again in 1.156s.";
  // 1.156 s announced, more than the first backoff (1 s), plus the margin.
  assert.equal(rateLimitDelay(limited(message), 1), 1406);
  assert.equal(rateLimitDelay(limited("x", { "retry-after-ms": "4500" }), 1), 4750);
  assert.equal(rateLimitDelay(limited("x", { "retry-after": "7" }), 1), 7250);
  assert.equal(rateLimitDelay(limited("Please try again in 800ms."), 1), 1250);
  // 45 s announced: waited as announced, never less than the backoff.
  assert.equal(rateLimitDelay(limited("x", { "retry-after": "45" }), 1), 45250);
});

test("429 : attente croissante plafonnée sans annonce", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6, 7].map(attempt => rateLimitDelay(limited(), attempt)),
    [1250, 2250, 4250, 8250, 16250, 20250, 20250],
  );
});

test("429 : pas de nouvelle tentative pour une autre erreur ou un compte épuisé", () => {
  assert.equal(rateLimitDelay(Object.assign(new Error("x"), { status: 500 }), 1), null);
  assert.equal(rateLimitDelay(limited("You exceeded your current quota", {}, "insufficient_quota"), 1), null);
  assert.equal(rateLimitDelay(new Error("réseau"), 1), null);
  assert.equal(rateLimitDelay(undefined, 1), null);
});

test("nouvelles tentatives : attend, réessaie, puis renvoie le résultat", async () => {
  const waits: number[] = [];
  let calls = 0;
  const result = await withRateLimitRetry(
    async () => {
      if (++calls < 3) throw limited("x", { "retry-after-ms": "100" });
      return "vecteurs";
    },
    delay => waits.push(delay),
    async () => {},
  );
  assert.equal(result, "vecteurs");
  assert.equal(calls, 3);
  assert.deepEqual(waits, [1250, 2250]);
});

test("nouvelles tentatives : les autres erreurs et l'épuisement sont renvoyés", async () => {
  let calls = 0;
  await assert.rejects(
    withRateLimitRetry(
      async () => {
        calls++;
        throw new Error("clé invalide");
      },
      () => assert.fail("aucune attente"),
      async () => {},
    ),
    /clé invalide/,
  );
  assert.equal(calls, 1);
  calls = 0;
  await assert.rejects(
    withRateLimitRetry(
      async () => {
        calls++;
        throw limited();
      },
      () => {},
      async () => {},
    ),
    /Rate limit reached/,
  );
  assert.equal(calls, RATE_LIMIT_ATTEMPTS);
});

test("erreur réelle du client OpenAI : 429 reconnu, en-têtes lus", () => {
  const error = OpenAI.APIError.generate(
    429,
    { message: "Please try again in 2s.", code: "rate_limit_exceeded" },
    "429 Please try again in 2s.",
    new Headers({ "retry-after-ms": "3000" }),
  );
  assert.ok(error instanceof OpenAI.RateLimitError);
  assert.equal(rateLimitDelay(error, 1), 3250);
});
