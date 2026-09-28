// Quiet keys (an attacker minting unlimited fresh EOAs on an unauthenticated
// endpoint) must not pin memory forever just because they're never retaken.
// A periodic sweep prunes any key whose timestamps have all aged out, and a
// hard cap refuses brand-new keys outright if a sweep can't free enough room.
const SWEEP_EVERY_TAKES = 256;
const SWEEP_AT_SIZE = 10_000;
const MAX_KEYS = 50_000;

/**
 * A simple in-memory sliding-window rate limiter: `limit` calls to `take` per
 * `key` within any `windowMs`-long window. Not shared across processes —
 * fine for a single-instance switchboard guarding an unauthenticated mutation.
 */
export function createRateLimiter(
  limit: number,
  windowMs: number,
): { take(key: string, now?: number): boolean; size(): number } {
  const hits = new Map<string, number[]>();
  let takes = 0;

  function store(key: string, timestamps: number[]): void {
    if (timestamps.length === 0) hits.delete(key);
    else hits.set(key, timestamps);
  }

  // Drops every key whose timestamps have all aged out of the window.
  function sweep(now: number): void {
    const windowStart = now - windowMs;
    for (const [key, timestamps] of hits) {
      const recent = timestamps.filter((t) => t > windowStart);
      if (recent.length !== timestamps.length) store(key, recent);
    }
  }

  return {
    take(key: string, now: number = Date.now()): boolean {
      takes++;
      if (takes % SWEEP_EVERY_TAKES === 0 || hits.size > SWEEP_AT_SIZE) {
        sweep(now);
      }

      const isNewKey = !hits.has(key);
      if (isNewKey && hits.size >= MAX_KEYS) {
        sweep(now);
        if (hits.size >= MAX_KEYS) return false;
      }

      const windowStart = now - windowMs;
      const recent = (hits.get(key) ?? []).filter((t) => t > windowStart);

      if (recent.length >= limit) {
        store(key, recent);
        return false;
      }

      recent.push(now);
      store(key, recent);
      return true;
    },
    size(): number {
      return hits.size;
    },
  };
}
