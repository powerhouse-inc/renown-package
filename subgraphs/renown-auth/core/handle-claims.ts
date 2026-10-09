/** How long a dispatched handle is held for its owner before the read model is trusted alone. */
export const HANDLE_CLAIM_TTL_MS = 120_000;

/**
 * Handles reserved by this process, keyed by an owner (the profile address)
 * while the request is in flight and until the read model (which indexes
 * asynchronously) catches up. Without it, two upserts a few milliseconds
 * apart could both see a handle as free.
 *
 * The map is per-process: with several replicas only the read model's unique
 * index on LOWER(handle) protects consistency across them.
 */
export function createHandleClaims(ttlMs = HANDLE_CLAIM_TTL_MS) {
  const claims = new Map<string, { owner: string; until: number }>();
  return {
    /** The owner holding a live claim on `handle`, if any. */
    holder(handle: string, now: number): string | undefined {
      const claim = claims.get(handle);
      if (!claim || claim.until <= now) {
        claims.delete(handle);
        return undefined;
      }
      return claim.owner;
    },
    /** Reserves `handle` for `owner`, dropping the owner's other claims and all expired ones. */
    claim(handle: string, owner: string, now: number): void {
      for (const [key, claim] of claims) {
        if (claim.until <= now || (claim.owner === owner && key !== handle)) claims.delete(key);
      }
      claims.set(handle, { owner, until: now + ttlMs });
    },
    /** Drops `owner`'s claim on `handle` (a failed request); another owner's claim is left alone. */
    release(handle: string, owner: string): void {
      if (claims.get(handle)?.owner === owner) claims.delete(handle);
    },
  };
}

export type HandleClaims = ReturnType<typeof createHandleClaims>;
