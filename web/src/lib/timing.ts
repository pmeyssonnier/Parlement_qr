// Operational diagnostics for /api/chat: step durations and failure codes only,
// never the question, the answer or an upstream error message.

/** Duration of each step of one request, in milliseconds. */
export type Timings = Record<string, number>;

/** Runs a step and records its duration, whether it succeeds or fails. */
export async function timed<T>(timings: Timings | undefined, step: string, run: () => Promise<T>): Promise<T> {
  const start = performance.now();
  try {
    return await run();
  } finally {
    if (timings) timings[step] = Math.round(performance.now() - start);
  }
}

/** The application-owned code of a failure (QUOTA_UNAVAILABLE…), or UNEXPECTED. */
export function failureCode(error: unknown) {
  return error instanceof Error && /^[A-Z][A-Z_]+$/.test(error.message) ? error.message : "UNEXPECTED";
}
