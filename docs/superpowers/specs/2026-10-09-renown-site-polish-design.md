# renown.id site polish — design

Date: 2026-10-09
Status: approved in conversation ("ok lfg one shot … go beyond")
Repos: renown.id (`/home/f/projects/renown-hub`, branch `feat/site-polish`), renown-package (`/home/f/projects/renown-package-hub`, branch `feat/site-polish`)

## Intent

www.renown.id has no public face: `/` renders only a background and a login button unless an
auth link (`?app=` / `?connect=`) is opened. Turn renown.id into a serious, impressive product
site for the Powerhouse identity layer while keeping every existing flow and URL working.

Audience (user answer "1-4"): all of them — end users (get an ID, manage access), app
developers (integrate Renown login + stats), and the ecosystem (what Renown is, how big the
network is, why it can be trusted). The homepage gives one sharp pitch and then a clear path
per audience.

Success criteria:
- A first-time visitor understands in one screen what Renown is and has an obvious next step.
- Signed-in users can see and revoke every app / CLI session they authorised.
- Developers can go from `/developers` to a working connect link without leaving the page.
- The site looks and feels like one product across `/`, `/apps`, `/@handle`, `/app/[did]`,
  `/me`, docs-like pages and the auth screens, in light and dark.
- Quality bar ("go beyond"): Lighthouse (mobile) on `/`, `/apps`, `/developers` —
  Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95; zero serious/critical
  axe violations on every new page in both themes; no layout shift from late data.

## Global constraints

- Next.js 16.2.6, React 19.2.6, Tailwind v4 tokens in `styles/globals.css`, Inter via
  `next/font`, next-themes (`attribute="class"`, default dark). Evolve this look (user choice
  "Evolve current"): keep dark-first, Inter, primary `#0084FF`, the PH-icon background motif.
- Existing URLs keep working unchanged: `/?app=…`, `/?connect=…` (+ `deeplink`, `returnUrl`,
  `expiresInDays`), `/console`, `/oidc/login`, `/profile/[id]`, `/@handle`, `/profile/edit`,
  `/app/[did]`, `/media/...`, all `/api/*`.
- Auth screens (WebFlow on `/` with `app`/`connect`, `/console`, `/oidc/login`) render inside a
  minimal chrome: logo + theme toggle only, no nav, no footer links.
- Legal links point to `https://www.vetra.io/privacy-policy` and
  `https://www.vetra.io/terms-and-conditions` (vetra.io's policy covers Renown).
- Social links: GitHub `https://github.com/powerhouse-inc`, X `https://x.com/PowerhouseDAO`.
- No new runtime dependency over 30 kB gzip on the client. No WebGL. Motion respects
  `prefers-reduced-motion`.
- Public pages that read backend data use SSR with a 2.5 s per-request timeout; any data
  failure drops that section (never a 500, never an empty frame).
- Every factual claim on `/trust` and `/developers` is verified against code (renown-package,
  renown.id, `@renown/sdk` 6.2.3) during implementation; a claim that cannot be verified is cut.
- Staging first, then prod. Backend (renown-package) ships before the website that needs it.
- No `Co-Authored-By` trailers in commits.

## Architecture

### Site shell (renown.id)

- `components/site/site-header.tsx`: logo (→ `/`), nav (Apps `/apps`, Developers
  `/developers`, Trust `/trust`, Ecosystem `/ecosystem`), theme toggle, auth slot. Signed out:
  "Sign in" (existing `RenownLoginButton` behaviour). Signed in: avatar (via `/media` or
  fallback) opening a menu: Your Renown (`/me`), Your profile (`/@handle` or `/profile/<addr>`),
  Edit profile (`/profile/edit`), Sign out. Sticky, translucent with backdrop blur. Below
  768 px the nav collapses into an accessible drawer (focus trap, Esc closes, `aria-expanded`).
- `components/site/site-footer.tsx`: columns Product (Apps, Your Renown, Trust), Developers
  (Developers, App stats docs → `https://www.vetra.io/docs/app-stats`, GitHub), Ecosystem
  (Ecosystem, Vetra, Powerhouse), Legal (Privacy, Terms); bottom row © Powerhouse + X link.
- `components/site/site-layout.tsx`: `variant: "site" | "auth"`. `site` = header + main +
  footer over the existing background; `auth` = today's `PageBackground` look (logo + toggle).
  All non-auth pages (including `/profile/*`, `/app/*`, 404) move onto `site`.
- Design primitives in `components/site/primitives/`: `Container` (max 1200 px, 16 px gutters
  mobile / 24 px desktop), `Section` (vertical rhythm), `Eyebrow`, `Heading` (display/h1/h2/h3
  from a type scale defined as tokens), `Card`, `Badge`, `CodeBlock` (pre-highlighted HTML +
  copy button with live-region "Copied"), `Reveal` (IntersectionObserver fade/translate, off
  under reduced motion).
- Tokens added to `globals.css` for both themes: type scale, `--radius-*`, surface levels
  (`surface-1/2/3`), `--glow-primary`, and gradient stops; no hard-coded colours in components.

### Pages

**`/` (homepage)** — `pages/index.tsx` keeps its auth branch: when `app` or `connect` is
present, it renders WebFlow in the `auth` layout exactly as today. Otherwise it renders
`components/home/*` in the `site` layout, with `getServerSideProps` loading featured apps and
network stats (both optional). Sections in order:
1. Hero — headline "One identity for the Powerhouse network", sub-line, primary CTA
   "Create your Renown ID" (starts the existing login), secondary "Build with Renown"
   (→ `/developers`). When signed in, the primary CTA becomes "Go to your Renown" (→ `/me`).
   Signature visual: an animated SVG "identity constellation" — a central DID node with
   orbiting app nodes (featured app logos when available, glyphs otherwise) linked by signed
   edges that pulse; static under reduced motion; < 15 kB; decorative (`aria-hidden`).
2. Pillars — Sign in everywhere; Provable authorship (every operation signed by your DID);
   Your public profile (`/@handle`).
3. How it works — 3 steps: connect a wallet → your DID is created → apps ask, you approve
   (and can revoke anytime).
4. Featured apps — up to 6 from `appProfiles(limit: 6)`; hidden when fewer than 3; "Browse all
   apps" → `/apps`.
5. Network pulse — numbers from `renownNetworkStats` (see Backend), each shown only when
   ≥ `NEXT_PUBLIC_PULSE_MIN` (default 25); section hidden when none qualifies; numbers count up
   on reveal (not under reduced motion).
6. Developers teaser — a 6-line code sample + "Read the developer guide".
7. Ecosystem strip — Renown / Vetra / Achra / Connect / Switchboard chips → `/ecosystem`.
8. Final CTA band.

**`/apps` (directory)** — SSR first page `appProfiles(limit: 24, category)` plus
`appProfileCategories`. Category chips ("All" + each category with its count) update the
`?category=` query (shallow route + fetch), cards show cover, logo, name, tagline, category →
`/app/[did]`. "Load more" uses `next` / `after`. Empty state: "No apps here yet" + "List your
app on Vetra" → `https://www.vetra.io`. Outage: friendly inline notice + retry (HTTP 200 page).

**`/me` (Your Renown)** — client page; signed-out visitors see a sign-in panel. Signed in:
- Identity card: avatar, display name, handle, DID / address with copy, "View public
  profile", "Edit profile".
- Profile completeness: avatar, handle, bio, at least one link — progress ring + checklist
  linking to `/profile/edit`.
- Connected apps: `renownCredentials(input: { issuer: <address>, includeRevoked: false })`,
  grouped by `credential_subject_id`; a subject that has an app profile
  (`appProfile(appDid)`) shows its logo + name and links to `/app/[did]`; others are listed
  under "CLI & other sessions" with the subject DID shortened. Each row: issued, expires
  (relative + absolute, "Expired" badge when past), Revoke.
- Revoke: confirm dialog ("<App> will no longer be able to act for you") → call
  `renown_revokeCredential(credentialId)` with the user's Renown bearer
  (`renown.getBearerToken`); on FORBIDDEN or missing bearer fall back to a wallet
  `personal_sign` of the exact message produced by the backend's `revokeMessage(credentialId,
  timestamp)` with `timestamp` = now ISO. Optimistic removal, rolled back with an error toast
  on failure; list refetched after success.
- "Download my data": a JSON file with the profile fields and credential list as shown.
- E2E uses the existing test-only `NEXT_PUBLIC_E2E_AUTH=1` switch (inert in real builds).

**`/developers`** — static (SSG) guide with a sticky in-page TOC:
1. How Renown login works (connect link → user approves → credential → app verifies).
2. Connect link reference: `https://www.renown.id/?connect=<app DID>&returnUrl=<url>&expiresInDays=<n>`
   (plus `app`, `deeplink`), with parameter table (validated against `pages/index.tsx`,
   `utils/return-url.ts`, `utils/credential-validity.ts`).
3. Interactive **Connect link builder**: inputs app DID, return URL, expiry (presets) →
   validated live (same parsers as the real flow), copyable link, "Try it" button.
4. SDK quick start with `@renown/sdk` 6.2.3 snippets (only APIs verified to exist).
5. Get an app identity through Vetra; app profiles and stats (→ vetra.io `/docs/app-stats`).
6. Sign in with Renown (OIDC): issuer + discovery URL, included only if the OIDC provider is
   publicly reachable on prod (checked: `/.well-known/openid-configuration`).
7. Public GraphQL reads (profiles, app profiles, stats) with endpoint URL and one example.
Code highlighted at build time (shiki in `getStaticProps`, no client highlighter).

**`/trust`** — static: how keys & DIDs work, what a credential is, expiry and revocation (link
to `/me`), what Renown stores (profile fields, public credentials, images in S3) and what it
never holds (private keys), signed operations, open source links. Each claim verified.

**`/ecosystem`** — static cards: Renown (identity, profiles, stats), Vetra (build & host
environments), Achra (marketplace, reviews, billing), Connect (document app), Switchboard
(APIs) — each with one-line role and link; a simple SVG diagram of how identity flows
between them.

**Existing pages** — `/profile/[id]`, `/@handle`, `/app/[did]`, `/profile/edit`, 404 adopt the
site layout and primitives without behaviour changes. A designed 404 and 500.

### SEO & sharing

- Per-page `<title>`, description, canonical (base `NEXT_PUBLIC_RENOWN_URL`), OG/Twitter tags.
- OG images via `next/og` route `pages/api/og.tsx`: variants `default`, `profile` (avatar,
  display name, @handle), `app` (logo/cover, name, tagline); used by `/`, `/@handle`,
  `/app/[did]`. Image fetch failures fall back to the default variant.
- `robots.txt` and `sitemap.xml` (static pages + app profile URLs via `appProfiles` paging,
  cap 1000).
- JSON-LD `Organization` + `WebSite` on `/`.

### Backend (renown-package, `subgraphs/renown-stats`)

1. `appProfiles(limit: Int, after: String, category: String): AppProfilePage!` — optional
   case-insensitive exact match on the stored category; same paging/limits as today; blank or
   absent = no filter.
2. `appProfileCategories: [AppProfileCategory!]!` with
   `type AppProfileCategory { category: String!, count: Int! }` — non-empty categories of
   public app profiles, ordered by count desc then name.
3. `renownNetworkStats: RenownNetworkStats!` with
   `type RenownNetworkStats { identities: Int!, apps: Int!, activeCredentials: Int!, activeUsers30d: Int!, updatedAt: String! }`
   - identities = distinct lower-cased `eth_address` in `renown_user`;
   - apps = number of app profiles;
   - activeCredentials = `renown_credential` rows with `revoked = false` and
     `expiration_date` null or in the future;
   - activeUsers30d = distinct user DIDs with stats activity in the last 30 days, from the
     same source `appStats.activeUsers30d` uses;
   - cached in-process for 300 s; a storage failure maps to `SERVICE_UNAVAILABLE`.
All three are public reads (same exposure as `appProfiles`).

## Error handling

- SSR data: timeout 2.5 s, failures logged server-side, section omitted.
- `/apps` outage: inline notice with retry; never 500.
- `/me`: credential list failure → inline error + retry; revoke failure → rollback + toast
  with the GraphQL error message mapped to plain language (FORBIDDEN, NOT_FOUND, network).
- OG route: any failure → default image (200).

## Testing

- renown-package: vitest for category filter (case, blank, paging with filter), categories
  aggregation, network stats (each count, expiry/revoked edges, cache, storage failure).
- renown.id Playwright: header/nav/drawer (keyboard), footer links, homepage with data /
  without data / backend down, `/apps` (filter, load more, empty, outage), `/me` (signed out,
  list, grouping, revoke success, revoke failure rollback, download), `/developers` builder
  validation, `/trust`, `/ecosystem`, OG route, sitemap/robots, auth screens still minimal
  and WebFlow unchanged (existing specs stay green). Screenshots light + dark at 390 and 1280.
- axe (`@axe-core/playwright`, dev dependency) on every new page, both themes: no serious or
  critical violations. Lighthouse run against the staging deploy before prod promotion.

## Rollout

1. renown-package: `feat/site-polish` → main; release staging channel, roll renown-staging,
   verify the three queries; then `latest`, roll prod, verify.
2. renown.id: merge to `deploy/staging`, pin `staging-<sha7>` on renown-staging, verify every
   page + Lighthouse + revoke with the e2e switch off (scripted where possible); then main
   (semantic-release, Vercel prod + k8s app tag pin), prod smoke.
3. The real-wallet pass of `/me` revoke on prod is handed to the user if it cannot be scripted.

## Out of scope

Verify tool (#6), people search (#7), new legal texts, i18n, a CMS.
