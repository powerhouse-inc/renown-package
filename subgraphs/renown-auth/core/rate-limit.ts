/**
 * A simple in-memory sliding-window rate limiter: `limit` calls to `take` per
 * `key` within any `windowMs`-long window. Not shared across processes —
 * fine for a single-instance switchboard guarding an unauthenticated mutation.
 */
export function createRateLimiter(
  limit: number,
  windowMs: number,
): { take(key: string, now?: number): boolean } {
  const hits = new Map<string, number[]>();

  return {
    take(key: string, now: number = Date.now()): boolean {
      const windowStart = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }

      recent.push(now);
      hits.set(key, recent);
      return true;
    },
  };
}
