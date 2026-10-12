/**
 * In-process mutual exclusion per key: same-key calls run one after another
 * (a failure doesn't block the next), different keys run concurrently. Idle
 * keys are dropped so the map doesn't grow.
 */
export function createKeyedLock(): <T>(key: string, fn: () => Promise<T>) => Promise<T> {
  const tails = new Map<string, Promise<void>>();
  return async <T>(key: string, fn: () => Promise<T>): Promise<T> => {
    const previous = tails.get(key) ?? Promise.resolve();
    const result = previous.then(fn);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    tails.set(key, tail);
    try {
      return await result;
    } finally {
      if (tails.get(key) === tail) tails.delete(key);
    }
  };
}

/**
 * The one lock registry of this process, shared by renown-orgs and
 * renown-stats: their `app:<did>` (and every other) keys must exclude each
 * other, which two separate registries would not. In-process only, so a
 * tenant runs a single switchboard replica.
 */
export const sharedKeyedLock: <T>(key: string, fn: () => Promise<T>) => Promise<T> = createKeyedLock();
