# renown-stats

App profiles (`powerhouse/renown-app-profile`) and per-user app stats
(`powerhouse/renown-user-stats`), at `/graphql/renown-stats`.

## Who may write

| Mutation | Caller |
| --- | --- |
| `reportUserStat(appDid, …)` | The app itself: a host-resolved bearer issued by `appDid`, **or** an app token in `X-Renown-App-Token` whose `aud` is the stats audience, issued by `appDid` for an owner who holds an unrevoked, unexpired delegation to it. |
| `upsertAppProfile(appDid, …)` | The publisher, by wallet bearer. The first upsert needs a delegation from that wallet to `appDid` and makes it the publisher; later upserts need the same wallet. |

Reads are public. Stats are current values per (app, metric): resending a value is harmless.

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

## Limits

600 reports per app DID per minute; 30 profile upserts per wallet per minute
(in memory, per replica); 32 metrics per app per user.
