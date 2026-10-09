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

Reads are public: `appProfile`, `appProfilesByPublisher` and `appProfiles(limit, after)` (newest first, `limit` 1–50, opaque `next` cursor). Profile fields: `name, tagline, logo` (legacy URL), `website, description` (markdown subset, ≤ 2000), `category` (≤ 40), `logoRef, coverRef, links` (≤ 8). Stats are current values per (app, metric): resending an unchanged value is a no-op (no operation is appended).

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
