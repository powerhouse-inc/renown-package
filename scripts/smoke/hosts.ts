/**
 * Host rules of the organisations smoke script, kept apart from the script
 * (which runs on import) so they can be tested.
 */

/** Loopback: the in-process test run, where renown-oidc may not be registered. */
export function isLocalHost(host: string): boolean {
  return /^(localhost|127\.0\.0\.1|\[::1\]|::1)$/.test(host);
}

/** A host the script may write to: loopback, or one with an anchored `staging` label (renown-staging.vetra.io). */
export function isStagingHost(host: string): boolean {
  return isLocalHost(host) || /(^|[.-])staging([.-]|$)/.test(host);
}

/**
 * What an OIDC discovery response means for the check: nothing (served), a skip
 * on a local host, else a failure: staging and prod must serve it.
 */
export function discoveryProblem(status: number, host: string): { skip: string } | { fail: string } | null {
  if (status >= 200 && status < 300) return null;
  return isLocalHost(host) ? { skip: `not served (${status}); skipped` } : { fail: `OIDC discovery not served (${status})` };
}
