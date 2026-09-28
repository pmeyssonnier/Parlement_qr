// Browser-side client of /api/chat. Type-only imports keep zod out of the
// client bundle: the response is checked with a lightweight guard instead.
import type { ChatResponse } from "./schema";

export type HistoryEntry = { role: "user"; content: string };
/** An error whose message can be shown to the user as is. */
export class ServiceError extends Error {}

export function errorMessage(data: unknown) {
  return data && typeof data === "object" && "error" in data && typeof data.error === "string"
    ? data.error
    : "Le service est indisponible.";
}
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";
const natures = ["fond", "incompetence", "renvoi", "absente"];

function isParagraph(v: unknown) {
  return isObject(v) && isString(v.text) && Array.isArray(v.sourceIds) && v.sourceIds.every(isString);
}
function isSource(v: unknown) {
  return (
    isObject(v) &&
    isString(v.id) &&
    isString(v.title) &&
    isString(v.author) &&
    isString(v.recipient) &&
    (v.date === null || isString(v.date)) &&
    // Rendered as href: only https links, never javascript: or data: ones.
    isString(v.url) &&
    v.url.startsWith("https://") &&
    Array.isArray(v.excerpts) &&
    v.excerpts.length > 0 &&
    v.excerpts.every(isString) &&
    natures.includes(v.nature as string)
  );
}
/** Everything the answer view and the export read, down to each paragraph and source. */
export function isChatResponse(data: unknown): data is ChatResponse {
  return (
    isObject(data) &&
    (data.mode === "ia" || data.mode === "extraits") &&
    (data.status === "documente" || data.status === "insuffisant") &&
    Array.isArray(data.paragraphs) &&
    data.paragraphs.every(isParagraph) &&
    Array.isArray(data.sources) &&
    data.sources.every(isSource) &&
    isString(data.notice) &&
    isString(data.requestId)
  );
}
export async function askQuestion(
  message: string,
  history: HistoryEntry[],
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ChatResponse> {
  const result = await fetcher("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, history }),
    signal,
  });
  // A platform error page (502, 504…) is HTML: never show a JSON parse error.
  const data: unknown = await result.json().catch(() => null);
  if (!result.ok || !isChatResponse(data)) throw new ServiceError(errorMessage(data));
  return data;
}
/** User-facing message for any failure of askQuestion. */
export function failureMessage(error: unknown) {
  if (error instanceof ServiceError) return error.message;
  if (error instanceof Error && error.name === "AbortError")
    return "La recherche a pris trop de temps. Réessayez dans un instant.";
  return "Le service est indisponible. Vérifiez votre connexion et réessayez.";
}
