# renown-stats

App profiles (`powerhouse/renown-app-profile`) and per-user app stats
(`powerhouse/renown-user-stats`), at `/graphql/renown-stats`.

## Who may write

| Mutation | Caller |
| --- | --- |
| `reportUserStat(appDid, …)` | The app itself: a host-resolved bearer issued by `appDid`, **or** an app token in `X-Renown-App-Token` whose `aud` is the stats audience, issued by `appDid`. Either way `appDid` must be a registered workload identity (renown-workload), the token's subject wallet must be that identity's `ownerAddress`, and that wallet must hold an unrevoked, unexpired delegation to `appDid`. |
| `upsertAppProfile(appDid, …)` | The publisher, by wallet bearer signed by a listed profile app: every upsert needs the bearer's signing app DID (`appKey`) in `RENOWN_STATS_PROFILE_APPS`. The first upsert needs the caller to be the workload identity's `ownerAddress` and makes that wallet the publisher; later upserts need the same wallet. |

Ownership is anchored on the workload identity, never on a delegation alone
(anyone can self-publish a delegation to any did:key):

- An app DID that is not a registered workload identity is always FORBIDDEN,
  on both paths, with or without a delegation.
- The profile publisher is fixed at the first claim. It is not re-checked
  later: if the workload identity is deleted, the publisher keeps the profile.
- A host bearer from any app not listed in `RENOWN_STATS_PROFILE_APPS` cannot
  write profiles, so a third-party dApp the publisher logged into cannot
  rewrite them. With the variable unset or empty every upsert is FORBIDDEN.
- CI workload tokens (those carrying the `vetra` claim) are refused in
  `X-Renown-App-Token`, whatever their audience; use `issueAppStatsToken`.

Reads are public. Stats are current values per (app, metric): resending an unchanged value is a no-op (no operation is appended).

App tokens go in `X-Renown-App-Token`, not `Authorization`: the host verifies
`Authorization` bearers without an audience and answers 401 to any token that
carries one. Vetra gets app tokens from renown-workload's `issueAppStatsToken`.

## Runtime dependencies

Besides its own `renown-stats` namespace, this subgraph reads, at request time
and through the host's shared relational db (the same one renown-workload's
subgraph gets):

- the `renown-workload` namespace (`workload_identities`): an app DID acts only
  if it is a registered workload identity owned by the caller's wallet;
- the delegation read model (renown credentials): the owner must hold a live
  delegation to the app DID.

If either is unavailable, authorisation fails closed (FORBIDDEN, with a
server-side warning). Deploy this package together with renown-workload and the
credential processor.

## Environment

| Variable | Purpose | Default |
| --- | --- | --- |
| `RENOWN_STATS_AUDIENCE` | The `aud` app tokens must carry (also what `issueAppStatsToken` mints). | `https://switchboard.renown.vetra.io/graphql/renown-stats` |
| `RENOWN_STATS_PROFILE_APPS` | Comma-separated app DIDs (`did:key:z…`, trimmed) whose host bearers may call `upsertAppProfile` (e.g. the Renown and Vetra dashboards). | unset: every upsert is FORBIDDEN |

## Limits

600 reports per app DID per minute; 30 profile upserts per wallet per minute
(in memory, per replica); 32 metrics per app per user.
