/**
 * The `aud` an app token must carry for `reportUserStat` via the
 * `X-Renown-App-Token` header. Also what renown-workload's
 * `issueAppStatsToken` mints for, so both sides read the same env.
 */
export const DEFAULT_STATS_AUDIENCE = "https://switchboard.renown.vetra.io/graphql/renown-stats";

export function statsAudience(env: Record<string, string | undefined>): string {
  const raw = env.RENOWN_STATS_AUDIENCE?.trim();
  return raw ? raw.replace(/\/+$/, "") : DEFAULT_STATS_AUDIENCE;
}

/**
 * The app DIDs whose host bearers may upsert app profiles (the Renown/Vetra
 * dashboards), from `RENOWN_STATS_PROFILE_APPS` (comma-separated). Empty when
 * unset: then every upsert is refused, so a third-party dApp the publisher
 * logged into can never rewrite their profile.
 */
export function statsProfileApps(
  env: Record<string, string | undefined>,
): ReadonlySet<string> {
  return new Set(
    (env.RENOWN_STATS_PROFILE_APPS ?? "")
      .split(",")
      .map((did) => did.trim())
      .filter((did) => did !== ""),
  );
}
/**
 * The header the Vetra relay sends the workload registration token in — the
 * same header renown-workload reads.
 */
export const REGISTRAR_HEADER = "x-renown-workload-registration-token";

/**
 * RENOWN_WORKLOAD_REGISTRATION_TOKEN, trimmed; null when unset. Its holder
 * (Vetra) registers workload identities and may relay a publisher's
 * upsertAppProfile together with the publisher's own bearer.
 */
export function statsRegistrationToken(
  env: Record<string, string | undefined>,
): string | null {
  const raw = env.RENOWN_WORKLOAD_REGISTRATION_TOKEN?.trim();
  return raw ? raw : null;
}
