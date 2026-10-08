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
