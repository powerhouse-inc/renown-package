# Renown Identity Hub — Design

Date: 2026-10-09 · Status: approved for one-shot execution (Phases 0–3)

## Goal

Make Renown the identity hub of the platform: users get a real, editable public
profile (avatar, display name, unique handle, bio, links), every app gets a
public profile page that its publisher edits from vetra.io, and apps report
live stats that show up on both the app page and the user's profile.

## Where this sits (reference architecture)

From the platform diagram (Renown / Vetra / Achra):

- **Renown** owns User Account, User Profile, App Profile, User Stats. Its
  pages are the canonical, shareable URLs (`renown.id/@handle`,
  `renown.id/app/<did>`).
- **Vetra** owns environments; it edits app profiles on the publisher's behalf
  and relays stats from environments to Renown (relay already exists).
- **Achra** owns marketplace listing, **user reviews**, billing. Reviews are
  **out of scope** here.

## Decisions (made with the user)

| # | Decision |
|---|---|
| D1 | The hub lives on renown.id; vetra.io links to it and edits app profiles. |
| D2 | App stats are **publisher-defined metrics** (id, label, unit, aggregation). |
| D3 | Images (avatars, app logos/covers) go into the **Powerhouse 6.2.3 attachment store**. |
| D4 | Attachment bytes live in **S3** (Hetzner Object Storage `nbg1`, same provider and shared credentials as pfnuer). |
| D5 | One spec for all phases; one plan per phase; staging first, then prod. |

## Current state (verified 2026-10-09)

- `renown-package` (`origin/main`, v1.7.0) pins `@powerhousedao/*` to
  `6.2.3-dev.26`; attachment store code is already present. Images:
  `cr.vetra.io/renown/{switchboard,connect}:v1.7.0`; app `renown-app:1.18.0`.
  Single tenant `renown` (prod). **No Renown staging exists.**
- `renown-user` state: `username`, `ethAddress`, `userImage` (free string).
  Written only by `renown_upsertProfile` / `renown_issueCredential`
  (`subgraphs/renown-auth`), which **skip null** (cannot clear) and are
  re-synced from ENS at every login (`renown` `services/wallet/profile-refresh.ts`),
  overwriting any edit. Read model table `renown_user`; `renownUser` lookup by
  username is not unique.
- `renown-app-profile` state: `appDid, publisherDid, name, tagline, logo,
  website`; writes via `upsertAppProfile`, which is FORBIDDEN everywhere because
  `RENOWN_STATS_PROFILE_APPS` is unset.
- `renown-user-stats`: per-user current values `{appDid, metric, value,
  updatedAt}`, ≤32 metrics per app per user. No per-app aggregates, no app list.
- Vetra relay (`vetra-cloud-package` `subgraphs/vetra-licensing/renown-stats.ts`)
  is configured in staging and prod; no environment is known to report yet.
- renown.id frontend (`renown`, Next 16 pages router, Tailwind 4, hand-rolled UI)
  is on `@powerhousedao/*@6.0.2-staging.8`; profile page shows only avatar,
  username, RenownID, address, member-since; no edit UI.
- Attachment store (6.2.3): content-addressed `AttachmentRef`
  (`attachment://v1:<sha256>`); upload = reserve → PUT via switchboard
  `/attachments/reservations` (bearer); download = `GET
  /attachments/:hash/download-target?documentId=…` (anonymous-capable, but only
  if the caller can read a document that references the hash) returning a
  short-lived signed URL. No server-side size cap or content-type allowlist.

## Global constraints

- Staging first, then prod, for every phase (renown, vetra-cloud-package, vetra.io).
- vetra.io changes land on **both** `main` and `staging`.
- No `Co-Authored-By` / generated-with trailers in commits or PRs.
- Never edit `gen/` folders; document-model changes go through the model JSON +
  `ph generate`; reducer code also lives in `src/reducers`.
- Reducers pure; new reducer code ≥95% coverage (lines, branches, functions,
  statements); every new error code has a test.
- Secrets never printed or pasted; they move OpenBao → ExternalSecret.
- Existing documents must stay valid: model changes are **additive within v1**
  (new optional fields, new operations; nothing removed or retyped).
- Every image is validated client-side (png/jpeg/webp, ≤2 MB before resize)
  and server-side (mime + size from the attachment record) before a profile
  references it.

## Phase 0 — Platform

1. **Upgrade** `renown-package` to `@powerhousedao/*@6.2.3` (+ `document-model`,
   `document-drive`), fix any type/test fallout, release. Upgrade the renown.id
   frontend to `@powerhousedao/*@6.2.3` (gives `useAttachmentUpload` etc.).
2. **Renown staging stack** (new tenant `renown-staging` in
   `powerhouse-k8s-hosting`): own CNPG database, switchboard
   (`switchboard.renown-staging.vetra.io`), connect
   (`connect.renown-staging.vetra.io`), app (`renown-staging.vetra.io`), images
   from the renown-package **staging** channel and a renown.id `staging` image.
   - renown-package: fast-forward `staging` to `main` before the first staging
     release; the release workflow's deploy step learns the staging tenant.
   - renown (frontend): build/push `renown-app:staging` from a `staging` branch.
   - OIDC/registration secrets: copied into `kv/tenants/renown-staging/oidc`
     (new values where they are secrets of the stack itself, e.g. signing keys).
3. **Attachments on S3**: `PH_ATTACHMENT_STORAGE=s3`, endpoint
   `https://nbg1.your-objectstorage.com`, region `nbg1`, path-style, buckets
   `renown-attachments` (prod) and `renown-staging-attachments` (staging),
   prefix `attachments`, credentials from `kv/powerhouse/shared/s3-credentials`
   via ExternalSecret (pfnuer pattern), `persistence.enabled: false`,
   `PH_SWITCHBOARD_PUBLIC_URL` set, `PH_ATTACHMENT_URL_SIGNING_SECRET` set
   (≥32 chars, from OpenBao). Buckets are private.
4. **Gated uploads**: browser uploads go through a gated renown-package upload
   route (mime allow-list, size cap, per-address rate limit), not the raw
   attachment API. The raw `/attachments/reservations` route is blocked at the
   ingress (the smoke script takes `--reserve-path` for the gated route).
5. **CORS**: renown switchboard `/attachments/*` accepts browser uploads from
   renown.id origins and vetra.io origins (prod + staging).
6. **Stable media URLs** (renown.id API route, cacheable, embeddable anywhere):
   `GET /media/<documentId>/<field>` → reads the document's ref for `field`
   (`avatar`, `logo`, `cover`) from the read model → asks the switchboard for a
   download target with `documentId` → `302` to it with
   `Cache-Control: public, max-age=60, stale-while-revalidate=240`. Unknown /
   unset → `404` (callers fall back). **Spike first**: confirm an anonymous
   server-side download-target call succeeds for a public profile document
   under `AUTH_ENABLED=true`; if it does not, the route uses a service bearer
   (an admin-signed Renown token held by the renown.id server) — same URL
   contract either way.
7. **Wire Vetra staging to Renown staging**: vetra staging switchboard
   `RENOWN_SWITCHBOARD_URL`, `RENOWN_STATS_URL`, registration token; vetra.io
   staging Renown URLs. Staging apps re-register their workload identity once
   (staging test data; acceptable).

Exit: staging Renown serves 6.2.3, an image uploaded through the staging
switchboard is retrievable through `renown-staging.vetra.io/media/...`; then
the same on prod.

## Phase 1 — User identity

### Model (`renown-user`, additive in v1)

State adds:

```graphql
displayName: String        # 1–64 chars, free text
handle: String             # unique, ^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$
bio: String                # ≤ 280 chars
links: [RenownUserLink!]!  # ≤ 8
avatar: AttachmentRef      # uploaded avatar; userImage stays as external/ENS URL
type RenownUserLink { id: OID! label: String! url: URL! }
```

Operations (module `profile`): `SET_DISPLAY_NAME`, `SET_HANDLE`, `SET_BIO`,
`SET_AVATAR` (`avatar: AttachmentRef` nullable → clears), `ADD_LINK`,
`UPDATE_LINK`, `REMOVE_LINK`, `REORDER_LINKS`. Errors: `InvalidHandleError`,
`BioTooLongError`, `DisplayNameLengthError`, `TooManyLinksError`,
`LinkNotFoundError`, `DuplicateLinkIdError`, `InvalidAvatarRefError`. Handle
uniqueness is **not** a reducer concern (needs global state); the write path
enforces it.

### Write path

Extend `renown_upsertProfile` (same signed-message scheme: the signature covers
`sha256(json(input))`) with `displayName, handle, bio, links, avatar` and
**patch semantics**: field absent/`null` → unchanged, `""`/`[]` → cleared.
Before dispatching it:

- validates handle format + a reserved list (`admin, api, app, apps, media,
  profile, settings, renown, vetra, powerhouse, www, help, about, login,
  console, oidc`), and uniqueness case-insensitively against the read model
  (unique index `lower(handle)`), returning `HANDLE_TAKEN`;
- for `avatar`, does **not** trust the attachment record: on S3 its mime/size
  are client-claimed. It HEADs the object via the attachment backend (real
  `ContentLength` ≤ 2 MB, real `ContentType` ∈ {png, jpeg, webp}) and sniffs
  the magic bytes (PNG/JPEG/WebP) of the fetched head of the object — else
  `INVALID_AVATAR`;
- rate limit as today.

Read model `renown_user`: add `display_name`, `handle` (unique, lowercase),
`bio`, `links jsonb`, `avatar_ref`; `renownUser(input: {handle})` lookup;
expose fields on `RenownUser` GraphQL type.

### ENS behaviour

`profile-refresh` no longer overwrites: ENS name/avatar are written only into
**empty** `username`/`userImage`; `handle` is suggested from the ENS name (sans
`.eth`) on first edit if free. The editor offers "Use ENS name" / "Use ENS
avatar" buttons.

### renown.id pages

- `/profile/edit` (auth required): avatar uploader (drag/drop or pick → square
  crop → 256×256 WebP in-browser → reserve/PUT to switchboard with the user's
  Renown bearer → ref), display name, handle (live availability check), bio
  with counter, links editor (add/edit/remove/reorder), live preview card,
  save (one signed upsert), clear avatar. Optimistic UI + toast; inline field
  errors from `HANDLE_TAKEN`/validation.
- `/@<handle>` (rewrite to `/profile/[id]`, which keeps accepting doc id /
  `0x` address and **redirects to `/@handle`** when one exists): avatar
  (`/media/<docId>/avatar`, fallback `userImage`, fallback generated
  identicon), display name, `@handle`, verified badges (ENS-verified when the
  ENS name resolves to the address; "Publisher" when they publish ≥1 app),
  bio, links, address (copy), member since, **Apps published** (Phase 2),
  **Stats** (Phase 3). OpenGraph/Twitter meta + `og:image` = avatar.
- Header shows the signed-in user's avatar + "Edit profile".

## Phase 2 — App profiles

### Model (`renown-app-profile`, additive in v1)

State adds:

```graphql
description: String          # ≤ 2000 chars, markdown subset (rendered sanitized)
category: String             # ≤ 40 chars
logoRef: AttachmentRef       # uploaded logo; legacy `logo` (URL/data) kept as fallback
coverRef: AttachmentRef      # 3:1 cover image
links: [RenownAppLink!]!     # ≤ 8  { id: OID!, label: String!, url: URL! }
metrics: [RenownAppMetric!]! # Phase 3
```

`SET_PROFILE` gains the scalar fields (same patch semantics); link ops
`ADD_LINK/UPDATE_LINK/REMOVE_LINK/REORDER_LINKS`; errors mirror Phase 1.

### Write path

- Set `RENOWN_STATS_PROFILE_APPS` (staging + prod) to vetra.io's Renown app
  DID (and renown.id's, for future in-hub editing).
- Extend `upsertAppProfile` with the new fields; image refs validated like
  avatars (logo ≤ 1 MB square, cover ≤ 2 MB). Publisher rule unchanged
  (workload identity `ownerAddress`).
- New read query `appProfiles(limit, after)` for listings, plus
  `appProfilesByPublisher` already exists.

### vetra.io

App detail gets a **Profile** tab (non-licensing and licensing-only apps):
logo + cover uploaders (crop, in-browser resize, upload to the Renown
switchboard with the user's bearer), name, tagline, description, category,
website, links, live preview card, "View on Renown" (`renown.id/app/<did>`),
save → `upsertAppProfile`. Overview shows the profile card + link. Same on
`main` and `staging`.

### renown.id

`/app/<did>`: cover, logo, name, tagline, category, description, links,
publisher (avatar + name → `/@handle`), stats (Phase 3), OG meta. The user
profile page lists **Apps published** (`appProfilesByPublisher`).

## Phase 3 — App stats

### Metric definitions (on the app profile)

```graphql
type RenownAppMetric {
  id: OID!
  key: String!          # ^[A-Za-z][A-Za-z0-9_.:-]{0,63}$ — the reported metric name
  label: String!        # ≤ 40
  unit: String          # ≤ 16, e.g. "notes", "pts"
  description: String   # ≤ 200
  aggregation: RenownMetricAggregation!   # SUM | MAX | AVG | COUNT_USERS
  public: Boolean!      # shown on app page and user profiles
}
```

Ops `ADD_METRIC / UPDATE_METRIC / REMOVE_METRIC / REORDER_METRICS`, ≤ 16
metrics, unique `key` (`DuplicateMetricKeyError`). Edited from the vetra.io
Profile tab ("Metrics" section) through `upsertAppProfile` (`metrics` array,
full replace).

### Aggregates (renown-stats store)

On every accepted `reportUserStat` (current-value semantics already), the
store also upserts, in the same transaction:

- `app_metric_values(app_did, metric, user_did, value, updated_at)` (PK
  app_did+metric+user_did);
- derived per query (not materialised): SUM/MAX/AVG over current values,
  COUNT_USERS = users with a value > 0; `activeUsers30d` = distinct users with
  any stat for the app updated in the last 30 days.

A one-time backfill builds `app_metric_values` from existing
`renown-user-stats` documents.

New query:

```graphql
appStats(appDid: String!): AppStats   # public
type AppStats { activeUsers30d: Int!, totalUsers: Int!,
  metrics: [AppMetricStat!]!, updatedAt: DateTime }
type AppMetricStat { key: String!, label: String!, unit: String,
  aggregation: RenownMetricAggregation!, value: Float!, users: Int!,
  top: [MetricContributor!]! }        # top 5 by value
type MetricContributor { userDid: String!, value: Float! }
```

Only `public` declared metrics are returned. Undeclared metrics are still
stored (so declaring later shows history) but never exposed by `appStats`.
`userStats(userDid)` is enriched with each app's name/logo and the metric's
label/unit when declared and public.

### Reporting ("make it work")

- Environments already call the Vetra licensing `reportUserStat(user, metric,
  value)` with `x-vetra-reporting-token`; verify the token reaches dedicated
  environments and the relay forwards to Renown (staging), fix what is broken.
- Ship a tiny helper for package authors (exported from vetra-cloud-package's
  public surface or documented snippet) and a vetra.io docs section "Report
  app stats" (env vars, mutation, current-value semantics, examples).
- End-to-end proof on staging: a staging environment reports a metric → it
  appears on `renown-staging.vetra.io/app/<did>` and the user's profile.

### UI

- App page: stat tiles (value + unit + label), active users (30 d), top
  contributors per metric (avatar + handle).
- User profile: "Stats" grouped by app (logo, app name → app page, metric
  label/value/unit).
- vetra.io app overview: compact stat tiles from `appStats`.

## Testing

- Reducers: unit + scenario tests, ≥95% coverage, every error code.
- Resolvers/store: vitest with the existing in-memory/Kysely test harness —
  handle uniqueness, patch semantics, image validation, aggregates, backfill,
  public-metric filtering.
- renown.id: Playwright e2e for edit profile (upload mocked at the network
  layer), public profile, app page; unit tests for crop/resize helpers.
- vetra.io: component tests for the Profile tab; existing suites stay green.
- Staging verification per phase (scripted where possible), then prod
  promotion and the same checks against prod.

## Rollout order

Phase 0 (staging → prod) → Phase 1 (staging → prod) → Phase 2 → Phase 3.
Each phase: renown-package release (staging channel → tenant
`renown-staging`), renown.id `staging` image, vetra.io/vetra-cloud-package to
their `staging` branches; verify; then `main`/latest and prod tenants.

## Risks

- Anonymous download-target under `AUTH_ENABLED=true` → service-bearer
  fallback (Phase 0 spike).
- 6.2.3-dev.26 → 6.2.3 drift (read-model catch-up changes) → full test run +
  staging soak before prod.
- `ph-cmd@<channel>` at image build vs lockfile pins → pin `ph-cmd` to 6.2.3 in
  the Dockerfile build arg.
- Handle squatting → reserved list now; moderation later.
- No server-side upload cap in 6.2.3 → validation at reference time; orphaned
  uploads are swept with reservations (24 h) / ignored.
