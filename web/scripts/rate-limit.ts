// The embeddings API refuses a request with 429 when the organisation's
// tokens-per-minute limit is reached (1 000 000 for text-embedding-3-small on
// this account). A refused request is not billed and says when to retry. A
// full reindex sends about 4 million tokens back to back, so it reaches the
// limit: the import waits and asks again instead of stopping.
export const RATE_LIMIT_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 20_000;
const MARGIN_MS = 250;

type HttpError = { status?: unknown; code?: unknown; message?: unknown; headers?: unknown };

function header(headers: unknown, name: string): number | null {
  const value = headers instanceof Headers ? headers.get(name) : null;
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** The wait the API announces: headers first, then « try again in 1.156s ». */
function announcedDelay(error: HttpError): number | null {
  const ms = header(error.headers, "retry-after-ms");
  if (ms !== null) return ms;
  const seconds = header(error.headers, "retry-after");
  if (seconds !== null) return seconds * 1000;
  const match = typeof error.message === "string" ? /try again in ([\d.]+)\s*(ms|s)\b/i.exec(error.message) : null;
  if (!match) return null;
  return Number(match[1]) * (match[2]?.toLowerCase() === "ms" ? 1 : 1000);
}

/**
 * Milliseconds to wait before asking again after this error, or null when
 * asking again cannot help: not a 429, or an exhausted account (a payment
 * problem, not a rate).
 */
export function rateLimitDelay(error: unknown, attempt: number): number | null {
  if (!error || typeof error !== "object") return null;
  const failure = error as HttpError;
  if (failure.status !== 429 || failure.code === "insufficient_quota") return null;
  const backoff = Math.min(1000 * 2 ** (attempt - 1), MAX_BACKOFF_MS);
  return Math.max(announcedDelay(failure) ?? 0, backoff) + MARGIN_MS;
}

const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/** Runs `call`, waiting and retrying while the API answers 429, at most `attempts` times in all. */
export async function withRateLimitRetry<T>(
  call: () => Promise<T>,
  onWait: (delayMs: number, attempt: number) => void = () => {},
  sleep: (ms: number) => Promise<void> = pause,
  attempts = RATE_LIMIT_ATTEMPTS,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const delay = attempt < attempts ? rateLimitDelay(error, attempt) : null;
      if (delay === null) throw error;
      onWait(delay, attempt);
      await sleep(delay);
    }
  }
}
