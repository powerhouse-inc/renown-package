# renown-stats

App profiles (`powerhouse/renown-app-profile`) and per-user app stats
(`powerhouse/renown-user-stats`), at `/graphql/renown-stats`.

## Who may write

| Mutation | Caller |
| --- | --- |
| `reportUserStat(appDid, …)` | The app itself: a host-resolved bearer issued by `appDid`, **or** an app token in `X-Renown-App-Token` whose `aud` is the stats audience, issued by `appDid`. Either way `appDid` must be a registered workload identity (renown-workload), the token's subject wallet must be that identity's `ownerAddress`, and that wallet must hold an unrevoked, unexpired delegation to `appDid`. |
| `upsertAppProfile(appDid, …)` | The publisher's own wallet bearer (`Authorization`), **plus** either the Renown workload registration token in `X-Renown-Workload-Registration-Token` (the Vetra relay: vetra.io → `vetraPublisher.updateAppProfile` → here) or a bearer signed by an app key listed in `RENOWN_STATS_PROFILE_APPS` (server-held stable keys only; unset in every tenant). The first upsert needs the wallet to be the workload identity's `ownerAddress` and makes it the publisher; later upserts need the same wallet. |

Ownership is anchored on the workload identity, never on a delegation alone
(anyone can self-publish a delegation to any did:key):

- An app DID that is not a registered workload identity is always FORBIDDEN,
  on both paths, with or without a delegation.
- The profile publisher is fixed at the first claim. It is not re-checked
  later: if the workload identity is deleted, the publisher keeps the profile.
- A bearer alone never writes a profile: a browser's bearer is signed by a
  random per-browser `did:key`, and any site the wallet signed into can mint
  one, so there is no "dashboard key" to allowlist. Writes come through the
  Vetra relay (registration token + the publisher's bearer). A wrong, empty
  or repeated relay header is FORBIDDEN and never falls back to the app-key
  rule; with no token configured the relay is off.
- Image refs (`logoRef`, `coverRef`) must name an uploaded image: the stored
  object's real size (logo ≤ 1 MiB, cover ≤ 2 MiB), type and magic bytes are
  checked (`INVALID_IMAGE`, `extensions.field`). Their refs are recorded in
  `app_profile_images` for `GET …/media/<documentId>/{logo,cover}`.
- CI workload tokens (those carrying the `vetra` claim) are refused in
  `X-Renown-App-Token`, whatever their audience; use `issueAppStatsToken`.

Reads are public: `appProfile`, `appProfilesByPublisher`, `appProfiles(limit, after, category)` (newest first, `limit` 1–50, opaque `next` cursor; `category` matches case-insensitively, blank = all), `appProfileCategories` and `renownNetworkStats`. Profile fields: `name, tagline, logo` (legacy URL), `website, description` (markdown subset, ≤ 2000), `category` (≤ 40), `logoRef, coverRef, links` (≤ 8). Stats are current values per (app, metric): resending an unchanged value is a no-op (no operation is appended).

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
| `RENOWN_STATS_PROFILE_APPS` | Comma-separated app DIDs (`did:key:z…`, trimmed) whose host bearers may call `upsertAppProfile` without the relay. Only for server-held stable keys; browsers sign with random keys. | unset |
| `RENOWN_WORKLOAD_REGISTRATION_TOKEN` | Shared with renown-workload. Its holder (Vetra) may relay `upsertAppProfile` for the wallet whose bearer it forwards. | unset: relay off |

## Limits

600 reports per app DID per minute; 30 profile upserts per wallet per minute
(in memory, per replica); 32 metrics per app per user.

## Metrics (identity hub phase 3)

Publishers declare what their app reports on its profile: `upsertAppProfile(metrics: [AppMetricInput!])` takes the whole list (`[]` clears; absent leaves it). Each metric: `key` (the reported metric name, `^[A-Za-z][A-Za-z0-9_.:-]{0,63}$`, unique), `label` (1–40), `unit` (≤ 16), `description` (≤ 200), `aggregation` (`SUM | MAX | AVG | COUNT_USERS`), `public`. At most 16 per app; bad lists are `BAD_USER_INPUT` with `extensions.field = "metrics"`. A changed key is applied as remove + add (same id), so keys can be swapped in one save.

Every accepted `reportUserStat` (changed value or not) also upserts `app_metric_values(app_did, metric, user_did, value, updated_at)` — right after the document write, under the same per-user lock (there is no shared transaction between documents and this table; the next report of the same value repairs a missed row). Rows are guarded "newer `updated_at` wins". Values reported before this existed are copied once at startup (job `app-metric-values-backfill-v1` in `renown_stats_jobs`; idempotent, retried on the next start until every user-stats document was read).

### Reading stats

`appStats(appDid)` (public) derives, per query, for each **declared public** metric: SUM/MAX/AVG over users' current values or COUNT_USERS (users with a value > 0), `users` with a value, and the top 5 contributors (value desc, earlier report first) with their Renown handle, display name and avatar from the `renown-user` read model (missing or unavailable read model → address only). `activeUsers30d` counts users with any stat for the app reported in the last 30 days, `totalUsers` all of them. `null` when the app has neither a profile nor any value.

`userStats(userDid)` now carries the app's `appName`, `appDocumentId`, `appHasLogo`, `appLogo` and, for metrics the app declares public, `label` and `unit`. Metrics declared private are omitted; undeclared ones are returned without a label.

`reportUserStat` may answer `SERVICE_UNAVAILABLE` after the value was already stored (the aggregate write failed); retrying is safe. Public reads answer `SERVICE_UNAVAILABLE` ("Stats are temporarily unavailable") when the index or read model fails, and `userStats` withholds an app's rows entirely when its profile exists but cannot be read.

## Catalog and network reads (site polish)

`upsertAppProfile` copies the saved category into `app_profile_documents.category` (trimmed, null when none) in the same step as the image index; profiles from before this were copied once at startup (job `app-profile-category-backfill-v1` in `renown_stats_jobs`; retried on the next start until every profile document was read).

- `appProfiles(category)` filters on `lower(category)`; the cursor works within the same filter.
- `appProfileCategories` groups case-insensitively: `{ category, count }`, label = smallest spelling (byte order), ordered count desc then name; empty categories are left out.
- `renownNetworkStats`: `identities` = distinct lower-cased `eth_address` in `renown_user`; `apps` = app profiles; `activeCredentials` = distinct `credential_id` of `renown_credential` rows with `revoked = false` and `expiration_date` null or in the future; `activeUsers30d` = distinct users with any `app_metric_values` row updated in the last 30 days (all apps; the same source as `appStats.activeUsers30d`); `updatedAt` = when computed. Cached per replica for 300 s; concurrent requests share one computation; a failed read answers `SERVICE_UNAVAILABLE` and is not cached.
