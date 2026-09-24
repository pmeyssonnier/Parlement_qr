// Per-instance memoization of an async loader. Concurrent callers share the
// pending promise; a rejection is never cached, so the next call retries.
export function ttlCache<T>(load: () => Promise<T>, ttlMs: number, now: () => number = Date.now) {
  let entry: { value: Promise<T>; expires: number } | undefined;
  return () => {
    if (entry && entry.expires > now()) return entry.value;
    const value = load();
    const current = { value, expires: now() + ttlMs };
    entry = current;
    value.catch(() => {
      if (entry === current) entry = undefined;
    });
    return value;
  };
}
