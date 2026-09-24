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
export function isChatResponse(data: unknown): data is ChatResponse {
  if (!data || typeof data !== "object") return false;
  const r = data as Record<string, unknown>;
  return (
    (r.mode === "ia" || r.mode === "extraits") &&
    (r.status === "documente" || r.status === "insuffisant") &&
    Array.isArray(r.paragraphs) &&
    Array.isArray(r.sources) &&
    typeof r.notice === "string"
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
