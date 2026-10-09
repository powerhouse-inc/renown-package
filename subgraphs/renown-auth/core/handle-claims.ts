/** How long a dispatched handle is held for its profile before the read model is trusted alone. */
export const HANDLE_CLAIM_TTL_MS = 120_000;

/**
 * Handles dispatched by this process but maybe not yet visible in the read
 * model (the processor indexes asynchronously). Without it, two upserts a
 * few milliseconds apart could both see a handle as free.
 */
export function createHandleClaims(ttlMs = HANDLE_CLAIM_TTL_MS) {
  const claims = new Map<string, { documentId: string; until: number }>();
  return {
    /** The document holding a live claim on `handle`, if any. */
    holder(handle: string, now: number): string | undefined {
      const claim = claims.get(handle);
      if (!claim || claim.until <= now) {
        claims.delete(handle);
        return undefined;
      }
      return claim.documentId;
    },
    claim(handle: string, documentId: string, now: number): void {
      claims.set(handle, { documentId, until: now + ttlMs });
    },
  };
}

export type HandleClaims = ReturnType<typeof createHandleClaims>;
