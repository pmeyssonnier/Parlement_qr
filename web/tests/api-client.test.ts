import assert from "node:assert/strict";
import test from "node:test";
import { extractiveAnswer } from "../src/lib/answer";
import { askQuestion, failureMessage, isChatResponse, ServiceError } from "../src/lib/api-client";
import { corpus } from "../src/lib/corpus";
import { localSearch } from "../src/lib/search";

const reply =
  (body: string, status = 200): typeof fetch =>
  async () =>
    new Response(body, { status });
const signal = new AbortController().signal;

test("client : une réponse valide est renvoyée telle quelle", async () => {
  const response = extractiveAnswer([], "req");
  assert.ok(isChatResponse(response));
  assert.deepEqual(await askQuestion("STIB", [], signal, reply(JSON.stringify(response))), response);
});
test("client : une page d'erreur HTML donne un message lisible", async () => {
  const error = await askQuestion("STIB", [], signal, reply("<html>504 Gateway Timeout</html>", 504)).catch(e => e);
  assert.ok(error instanceof ServiceError);
  assert.equal(failureMessage(error), "Le service est indisponible.");
});
test("client : le message d'erreur de l'API est conservé", async () => {
  const body = JSON.stringify({ error: "La limite de questions est atteinte.", requestId: "r" });
  const error = await askQuestion("STIB", [], signal, reply(body, 429)).catch(e => e);
  assert.equal(failureMessage(error), "La limite de questions est atteinte.");
});
test("client : une réponse 200 mal formée est refusée", async () => {
  await assert.rejects(askQuestion("STIB", [], signal, reply(JSON.stringify({ mode: "autre" }))), ServiceError);
});
test("client : délai dépassé et panne réseau", () => {
  assert.match(failureMessage(new DOMException("aborted", "AbortError")), /trop de temps/);
  assert.match(failureMessage(new TypeError("Failed to fetch")), /Vérifiez votre connexion/);
});
test("client : chaque paragraphe et chaque source sont vérifiés", () => {
  const response = extractiveAnswer(localSearch(corpus.questions, "STIB forte chaleur"), "req");
  assert.ok(response.sources.length);
  assert.ok(isChatResponse(response));
  const [source] = response.sources;
  assert.ok(source);
  const withSource = (changes: Record<string, unknown>) => ({ ...response, sources: [{ ...source, ...changes }] });
  // Rendered as href: a javascript: or data: link must never reach the page.
  assert.equal(isChatResponse(withSource({ url: "javascript:alert(1)" })), false);
  assert.equal(isChatResponse(withSource({ url: "http://www.parlement.brussels/x" })), false);
  assert.equal(isChatResponse(withSource({ excerpt: undefined })), false);
  assert.equal(isChatResponse(withSource({ nature: "autre" })), false);
  assert.equal(isChatResponse({ ...response, paragraphs: [{ text: "x" }] }), false);
  assert.equal(isChatResponse({ ...response, requestId: undefined }), false);
});
