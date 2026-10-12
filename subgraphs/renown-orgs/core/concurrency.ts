/** `fn` over `items`, at most `limit` at a time, results in input order. */
export async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit)
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  return out;
}

/**
 * Runs `fn` over `items` in order on a pool of `limit` workers: a worker
 * takes the next item as soon as it is free. No item is started once
 * `clock()` reaches `deadline` (started ones finish). Returns how many were
 * started. `fn` must not throw (isolate items yourself).
 */
export async function poolUntil<T>(
  items: readonly T[],
  options: { limit: number; deadline: number; clock?: () => number },
  fn: (item: T) => Promise<void>,
): Promise<number> {
  const clock = options.clock ?? Date.now;
  let next = 0;
  const worker = async () => {
    while (next < items.length && clock() < options.deadline) {
      const item = items[next++];
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.limit, items.length)) }, worker));
  return next;
}
