# renown.id Site Polish — Phase B web (/apps, network pulse) and Phase C (/me) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the remaining renown.id pages: the `/apps` directory (category chips, load more, empty and outage states), the homepage network pulse, and `/me` ("Your Renown": identity card, profile completeness, connected apps and CLI sessions, revoke with confirm, optimistic removal and rollback, download my data).

**Architecture:** Builds on Phase A's shell exactly as produced (`SiteLayout`, `PageMeta`, primitives, `AppTile`, the typed `pulse` slot, `withTimeout`/`SSR_DATA_TIMEOUT_MS`, the stub switchboard with removable fixtures). `/apps` and the pulse are SSR with the 2.5 s budget and degrade per section; `/apps` then updates in place through shallow routing and browser reads of renown-stats. `/me` is a client page: pure modules in `lib/me/` (grouping, completeness, export, revoke orchestration) are unit-tested in the Playwright worker; the page reads `renownCredentials` and batched `appProfile` lookups from the browser and revokes with `renown_revokeCredential`, bearer first and the wallet's `personal_sign` of `revokeMessage()` as the fallback.

**Tech Stack:** Next.js 16.2.6 (pages router, webpack), React 19.2.6, Tailwind v4 tokens, graphql-request 7, viem 2.48.4, `@powerhousedao/reactor-browser` 6.2.3 (`useRenownAuth`, `useRenown().getBearerToken`), Playwright 1.57 + `@axe-core/playwright` 4.13.0. No new dependencies.

**Spec:** `/home/f/projects/renown-package-hub/docs/superpowers/specs/2026-10-09-renown-site-polish-design.md` (binding) — sections "/apps", homepage §5 "Network pulse", "/me", "Error handling", "Testing". Consumes `/home/f/projects/renown-package-hub/docs/superpowers/plans/2026-10-09-site-polish-phase-a-shell.md` ("Produced interfaces") and the backend's "Interfaces produced" in `2026-10-09-site-polish-phase-b-backend.md` (live since renown-package 1.10.0).

**Repo:** `/home/f/projects/renown-hub`, branch `feat/site-polish`. **Precondition:** Phase A Tasks 1–10 are committed (this plan's diffs to `pages/index.tsx`, `components/home/network-pulse.tsx` and `e2e/home.spec.ts` apply to Phase A Task 6's code).

**How this plan was produced:** every task was implemented in a scratch worktree of `feat/site-polish` (2a834f3) with Phase A Tasks 6–9 applied from the Phase A plan first. `pnpm exec tsc --noEmit`, `pnpm lint` and `pnpm build` passed, and the full Playwright suite (`--workers=3`) ran 213 tests, 211 passing with exactly the code below (the two failures are Phase A tests unrelated to this plan; see Task 5 Step 2). Code blocks are the real files, not sketches.

---

## Planner rulings

Decisions the spec left open (binding for this plan):

1. **`?category=` is normalised, never an error.** First value, trimmed; blank, absent or longer than 40 characters (the model's maximum, which the backend would match against nothing) means "all apps". Matching a chip is case-insensitive (`/apps?category=%20games%20` selects "Games"), like the backend filter. The canonical URL of every `/apps` view is `/apps`.
2. **Chips are links.** `next/link` with `shallow` and `scroll={false}`: without JavaScript they are ordinary SSR navigations; with it the URL changes in place and `useAppDirectory` fetches the category's first page from the browser. Back/forward refetches the same way; answers to superseded requests are dropped. While a category loads, the current cards stay (dimmed, `aria-busy`); placeholder cards are shown only when nothing is on screen.
3. **"All" has no count.** Category counts do not add up to the total (apps without a category exist), and the backend has no total.
4. **Outage semantics.** List failure on the server → inline notice with "Try again" (client refetch), HTTP 200, `Cache-Control: no-store` (an outage must not be cached at the edge). A categories failure alone only hides the chips. A failed "Load more" keeps the list and says so next to the button.
5. **Pulse = its own SSR request** (`renownNetworkStats`, not merged into the `appProfiles(limit: 6)` query), so one failure never takes the other section down and Phase A's homepage fixtures keep working. The threshold is applied in `NetworkPulseSection` through `pulseMin()`, which reads `NEXT_PUBLIC_PULSE_MIN` (inlined at build time, so server and client agree; whole number ≥ 0, else 25). Order and wording: identities "people with a Renown ID", activeCredentials "active app approvals", activeUsers30d "people active in apps in the last 30 days", apps "apps with a Renown identity". With prod numbers today (245 / 168 / 0 / 1) two counts show.
6. **Count-up never changes what crawlers or the first paint see.** SSR renders the final numbers; only a number still below the fold is reset to 0 on mount (off screen) and counted up by direct DOM writes when it scrolls in. An invisible copy of the final value reserves the width (no layout shift); a `sr-only` copy is what screen readers read. Under reduced motion nothing animates and the live dot does not ping. The section copy "refreshed every five minutes" is the backend's 300 s cache (backend ruling 7).
7. **Who `/me` is for.** The Renown session (`useRenownAuth().user.address`), like the header. Under the test-only `NEXT_PUBLIC_E2E_AUTH=1` switch (inert in real builds) the injected test wallet's session stands in for it and the bearer is `window.__renownE2eBearer` (absent = no bearer) — the same switch and global `hooks/use-profile-editor-auth.ts` already uses. The header still shows "Sign in" in e2e (Phase A ruling 7).
8. **Listing approvals.** `renownCredentials(input: { issuer: <lowercased address>, includeRevoked: false })` on `NEXT_PUBLIC_SWITCHBOARD_ENDPOINT` (the supergraph the profile reads use). Not `ethAddress` (it ANDs issuer and proof address) and no `driveId` (the resolver ignores it). Copies of one VC (several documents, same `credentialId`) count once. Expired credentials are still listed, with an "Expired" badge (the backend does not filter them, and they can still be revoked). The group key is `credentialSubjectId`, falling back to `issuerId` for old credentials without a subject.
9. **App vs session.** Only `did:key` subjects are looked up, with aliased `appProfile(appDid:)` queries on `<switchboard>/graphql/renown-stats`, 25 per request. A subject with a profile is an app (logo, name, link to `/app/[did]`); everything else goes under "CLI & other sessions", named by `credentialSubjectApp` (the name the client gave itself) with the subject DID shortened. If the profile lookup fails, the list still renders (every subject as a session) rather than failing.
10. **Revoke transport.** The browser calls `renown_revokeCredential` on the switchboard directly for both proofs: with `Authorization: Bearer <renown.getBearerToken({ expiresIn: 600 })>` first; on no bearer, or on FORBIDDEN / UNAUTHENTICATED / HTTP 401 / 403, with `signature` + `timestamp` (= now, ISO) from the wallet's `personal_sign` of `revokeMessage(credentialId, timestamp)`. NOT_FOUND and network errors are not retried. It does not go through `DELETE /api/credential/renown`: that route only exists for the pre-renown-auth legacy fallback, which no deployment needs any more (backend ≥ 1.10.0 everywhere). The message is the site's existing verbatim copy of the server's (`services/renown-signed-messages.ts`); Task 3 pins it with a test vector.
11. **Optimistic revoke and lag.** The row disappears when the user confirms; a failure puts it back and shows an error toast; success shows a toast and refetches quietly (no skeleton). Revoked ids stay hidden for the page's lifetime, because the read model can still list a credential right after its revocation. NOT_FOUND also triggers a quiet refetch.
12. **Messages.** Toast copy: success "Revoked. <name> can no longer act for you."; failure "<name> was not revoked. <reason>", reasons from `revokeFailureText()` (FORBIDDEN, NOT_FOUND, NETWORK, DECLINED signature, NO_WALLET, other). The action is called "Revoke" on the row, the dialog and the toast.
13. **The confirm dialog is a native `<dialog>` opened with `showModal()`** (the page behind is inert, Esc closes, focus starts on Cancel because it comes first in DOM order). On confirm the dialog closes first and focus moves to the section heading (`tabIndex=-1`), because the row that opened it is gone; on cancel the browser returns focus to the row's Revoke button.
14. **Download my data** writes `renown-<lowercased address>.json`: `exportedAt`, `address`, `did`, the profile fields (`documentId, displayName, handle, bio, links[{label,url}], avatar, userImage, username, createdAt, updatedAt`) and the approvals exactly as grouped on screen (`subject, kind, name, credentials[{credentialId, issuedAt, expiresAt, expired}]`). Enabled only once the list has loaded.
15. **The user's DID** shown on the card is the `issuerId` their credentials carry (exact chain), else `did:pkh:eip155:1:<lowercased address>`.
16. **Shared bits.** Nothing reusable existed: the profile editor's toast is inline in `pages/profile/edit.tsx` (left unchanged) and `utils/stat-format.ts` only formats dates. New: `utils/relative-time.ts` and `components/site/toast.tsx`.
17. **Phase A defects fixed here** (found while building on it): (a) the global `a { color: inherit; … }` in `styles/globals.css` was unlayered, so it beat Tailwind's layered `text-*` utilities on every link: primary `ButtonLink`s and active chips rendered `#393E44` on `#0066D6` (2.3:1; axe did not flag it). It moves into `@layer base`. (b) `AppTile`'s logo painted under the cover (the cover wrapper is positioned, the logo was not); the logo gets `relative`. (c) `attachScreenshots` now asserts no horizontal page scroll at both widths (it caught a 598 px-wide `/me` at 390 px during planning, and (d) a 456 px-wide `/developers` at 390 px: the inline `Mono` code of the connect-link URL did not wrap; it gets `wrap-anywhere`).
18. **`/me` is not in the sitemap and not in robots.txt**: it is a private client page with `noindex` (a robots `Disallow` would stop crawlers from seeing the `noindex`).
19. **Client-side failures log with `console.warn`, not `console.error`:** under `next dev`, `console.error` raises the Next error overlay, whose portal intercepts clicks in e2e. Server-side SSR logging keeps `console.error`.
20. **E2E isolation.** `/apps` server reads reach the stub, so `e2e/apps.spec.ts` is serial and owns the `appProfiles(limit: 24 …)` and `appProfileCategories` fixtures. The pulse tests live in the serial `e2e/home.spec.ts` (Phase A ruling 12: every homepage load is there). `/me` reads and writes go from the browser, so `e2e/me.spec.ts` answers them per page with `page.route` (parallel-safe, nothing shared).

## Rollout notes (for the controller)

- **Backend:** `NEXT_PUBLIC_SWITCHBOARD_ENDPOINT` must point at a switchboard running renown-package ≥ 1.10.0 (`appProfiles(category:)`, `appProfileCategories`, `renownNetworkStats`). Staging and prod already do.
- **`NEXT_PUBLIC_PULSE_MIN`** (optional, default 25). `NEXT_PUBLIC_*` values are inlined at build time, so a non-default value needs a Dockerfile `ARG`/`ENV` pair and a build arg in `.github/workflows/semantic-release.yml` (and Vercel env); setting it only at runtime has no effect. Leave unset for the launch.
- **`OG_MEDIA_HOSTS`** (Phase A, runtime): unchanged by this plan; keep whatever Phase A rollout sets.
- **`NEXT_PUBLIC_E2E_AUTH`** must stay unset in every deployed build (it lets the wallet session stand in for the Renown session on `/me`).
- **CORS:** `/me` sends `POST <switchboard>/graphql` with an `Authorization` header from `https://www.renown.id` (preflight). Verify on staging that the switchboard answers the preflight with that header allowed; if it does not, the bearer attempt fails as a network error and is *not* retried with a signature (ruling 10) — check the browser console during the staging revoke pass.
- **Real-wallet revoke** on staging (spec rollout step 2/3): sign in from the header, open `/me`, revoke one approval (bearer path), then repeat after clearing the Renown session but keeping the wallet connected (signature path). Hand the prod pass to the user if it cannot be scripted.
- **Lighthouse** (mobile) on staging for `/apps` (spec bar: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95), together with Phase A's `/` and `/developers`.

## Produced interfaces

```ts
// services/app-profiles.ts (extends Phase A)
export const APP_PROFILE_FIELDS: string                      // was the private FIELDS
export async function listAppProfiles(args: { limit: number; after?: string | null; category?: string | null }): Promise<AppProfilePage>
export interface AppProfileCategory { category: string; count: number }
export async function listAppCategories(): Promise<AppProfileCategory[]>   // throws on failure
// services/network-stats.ts
export async function fetchNetworkStats(): Promise<NetworkPulse | null>    // throws on failure
// utils/app-directory.ts
export const APPS_PAGE_SIZE = 24, CATEGORY_MAX_LENGTH = 40
export function parseCategory(value: string | string[] | undefined | null): string | null
export function sameCategory(a: string | null, b: string | null): boolean
export function appsHref(category: string | null): string
export function appendApps(existing: RenownAppProfile[], incoming: RenownAppProfile[]): RenownAppProfile[]
// utils/pulse.ts
export const DEFAULT_PULSE_MIN = 25
export type PulseKey = 'identities' | 'activeCredentials' | 'activeUsers30d' | 'apps'
export interface PulseMetric { key: PulseKey; value: number; label: string }
export function pulseMin(raw?: string): number
export function visibleMetrics(pulse: NetworkPulse | null | undefined, min: number): PulseMetric[]
// hooks/use-count-up.ts
export function useCountUp(ref: RefObject<HTMLElement | null>, value: number, format: (n: number) => string): void
// utils/relative-time.ts
export function formatRelative(iso: string, now: Date): string
export function formatAbsolute(iso: string, timeZone?: string): string
// lib/me/connections.ts
export interface IssuedCredential { documentId; credentialId; issuerId; issuanceDate; expirationDate: string | null; credentialSubjectId: string | null; credentialSubjectApp; revoked }
export interface Connection { credentialId: string; issuedAt: string; expiresAt: string | null }
export interface ConnectionGroup { subject: string; kind: 'app' | 'session'; name: string; app: RenownAppProfile | null; connections: Connection[] }
export interface GroupedConnections { apps: ConnectionGroup[]; sessions: ConnectionGroup[] }
export function subjectOf(c: IssuedCredential): string
export function profileCandidates(cs: IssuedCredential[]): string[]
export function isExpired(expiresAt: string | null, now: Date): boolean
export function shortDid(did: string): string
export function groupConnections(cs: IssuedCredential[], profiles: Readonly<Record<string, RenownAppProfile | null>>, hidden?: ReadonlySet<string>): GroupedConnections
export function identityDid(address: string, cs: IssuedCredential[]): string
// lib/me/completeness.ts
export function profileCompleteness(profile: RenownProfile | null): Completeness // { items: {key,label,done}[], done, total, percent }
// lib/me/export.ts
export function myDataJson(input: { address; did; profile; connections: GroupedConnections; now: Date }): string
export function myDataFileName(address: string): string
// lib/me/revoke.ts
export type RevokeAuth = { bearer: string } | { signature: string; timestamp: string }
export type RevokeFailure = 'FORBIDDEN' | 'NOT_FOUND' | 'NETWORK' | 'DECLINED' | 'NO_WALLET' | 'UNKNOWN'
export class RevokeError extends Error { readonly reason: RevokeFailure }
export interface RevokeDeps { getBearer(): Promise<string | null>; signMessage: ((m: string) => Promise<string>) | null; send(id: string, auth: RevokeAuth): Promise<void>; now?: () => Date }
export async function revokeConnection(credentialId: string, deps: RevokeDeps): Promise<'bearer' | 'signature'>
export function revokeFailureText(reason: RevokeFailure): string
// services/renown-connections.ts (browser)
export async function fetchIssuedCredentials(address: string): Promise<IssuedCredential[]>
export async function fetchAppProfilesFor(dids: string[]): Promise<Record<string, RenownAppProfile | null>>
export async function sendRevoke(credentialId: string, auth: RevokeAuth): Promise<void> // throws RevokeError
// components/site/toast.tsx
export interface Toast { id: number; tone: 'success' | 'error'; text: string }
export function useToasts(): { toasts: Toast[]; show(tone, text): void; dismiss(id: number): void }
export function ToastRegion(props: { toasts: Toast[]; onDismiss: (id: number) => void }): JSX.Element
// e2e/support/site.ts (extends Phase A)
export async function layoutShift(page: Page, settleMs?: number): Promise<number>
// e2e/support/test-session.ts
export async function signInTestWallet(page: Page, options?: { bearer?: string }): Promise<InjectedWallet>
```

Tokens added to `styles/globals.css`: `--danger` (fill, `#C42B1C` both themes, white text 5.6:1) and `--danger-ink` (text: `#B42318` light, `#FF8F80` dark) → utilities `bg-danger`, `text-danger-ink`, `border-danger/…`.

## Global Constraints

- Next.js 16.2.6, React 19.2.6, Tailwind v4 tokens in `styles/globals.css`, Inter via `next/font`, next-themes (`attribute="class"`, default dark). Evolve the current look: dark-first, Inter, primary `#0084FF`, the PH-icon background motif.
- Existing URLs keep working unchanged: `/?app=…`, `/?connect=…` (+ `deeplink`, `returnUrl`, `expiresInDays`), `/console`, `/oidc/login`, `/profile/[id]`, `/@handle`, `/profile/edit`, `/app/[did]`, `/media/...`, all `/api/*`.
- Public pages that read backend data use SSR with a 2.5 s per-request timeout; any data failure drops that section (never a 500, never an empty frame). `/apps` outage: friendly inline notice + retry (HTTP 200 page).
- No new runtime dependency over 30 kB gzip on the client (this plan adds none). No WebGL. Motion respects `prefers-reduced-motion`.
- Quality bar: zero serious/critical axe violations on every new page in both themes; screenshots light + dark at 390 and 1280; no layout shift from late data; Lighthouse (mobile) on `/apps` ≥ 90/95/95/95 (measured on staging).
- No hard-coded colours in components: tokens only (`bg-danger`, `text-ink`, …). The decorative `bg-black/60` dialog backdrop follows the existing avatar-cropper modal.
- Legal / social / Vetra links come from `components/site/nav.ts` (`VETRA_URL = https://www.vetra.io`).
- Copy: sentence case, active voice, no ALL-CAPS labels, no "→" glyphs appended to links, no middle-dot meta strings; errors say what happened and what to do, without apologising.
- `/me` revoke never sends a signature it did not need: bearer first, `personal_sign` only as the fallback (spec).
- Never edit Phase A's produced interfaces' names or props; `NetworkPulseSection({ pulse })` keeps its signature.
- No `Co-Authored-By` trailers in commits. Never push; commit on `feat/site-polish` only.

## Review Focus

Conditions no task's tests fully pin, most likely to bite first:

1. **The real bearer path.** E2E fakes the bearer; nothing proves the switchboard host turns a renown.id `renown.getBearerToken()` JWT into `ctx.user.address`, nor that its CORS preflight allows `Authorization` from www.renown.id. Expected behaviour: revoke succeeds with one request and no wallet prompt. If the host ignores the token the signature fallback still works (FORBIDDEN → sign); if CORS blocks it, revoke fails with "Renown did not respond". Verify in the staging real-wallet pass (Rollout notes) and watch the network tab.
2. **Signed in to Renown but no wallet session.** After a reload where wagmi/Privy has not reconnected, `signMessage` is null; if the bearer is also refused the toast says "Connect the wallet that gave this approval". Expected: no crash, the row comes back. Unit-tested in `lib/me/revoke` (NO_WALLET) but not in the browser, because e2e cannot hold a Renown session without a wallet.
3. **Many approvals.** A user with hundreds of CLI sessions gets one `renownCredentials` read and `ceil(n/25)` profile batches; the page has no pagination. Expected: it renders (slowly) rather than failing. Spot-check on staging with a long-lived test identity.
4. **Revoking the credential that backs your own renown.id session.** That approval is listed (subject = renown.id's own app DID, named "renown-app"); revoking it ends the site session's bearer, so the next revoke falls back to a signature. Expected: the page keeps working; a reload shows the sign-in panel. Check by hand once.
5. **Long names and odd data.** 60+ character app names or `credentialSubjectApp` values truncate in the group header; a credential without `expirationDate` shows "Never"; a credential whose subject is a `did:pkh` is a session. Covered for the common shapes by `me-model.spec.ts`; eyeball a long name on staging.

---

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `services/app-profiles.ts` | 1, 3 | Category filter, category counts; exported field list |
| `utils/app-directory.ts`, `components/apps/{use-app-directory.ts,category-chips.tsx,directory-notice.tsx}`, `pages/apps.tsx` | 1 | The directory |
| `styles/globals.css` | 1, 4 | `a` rule in `@layer base`; danger tokens |
| `components/app/app-tile.tsx` | 1 | Logo above the cover |
| `e2e/support/site.ts`, `e2e/support/stub-switchboard.mjs` | 1, 2 | `layoutShift`, no-horizontal-scroll check; stub defaults |
| `services/network-stats.ts`, `utils/pulse.ts`, `hooks/use-count-up.ts`, `components/home/network-pulse.tsx`, `pages/index.tsx` | 2 | Network pulse |
| `utils/relative-time.ts`, `lib/me/{connections,completeness,export,revoke}.ts`, `services/renown-connections.ts` | 3 | `/me` model and transport |
| `components/site/toast.tsx`, `components/me/*`, `pages/me.tsx`, `e2e/support/test-session.ts` | 4 | `/me` page |
| `e2e/apps.spec.ts`, `e2e/home.spec.ts`, `e2e/me-model.spec.ts`, `e2e/me.spec.ts` | 1–4 | Tests |

**Running tests:** Playwright starts the stub switchboard and `pnpm dev` itself. Make sure nothing else listens on ports 3000/4799. Single spec: `pnpm exec playwright test e2e/<file> --workers=3`.

---

## Task 1: `/apps` directory

**Files:**
- Create: `utils/app-directory.ts`, `components/apps/use-app-directory.ts`, `components/apps/category-chips.tsx`, `components/apps/directory-notice.tsx`, `pages/apps.tsx`
- Modify: `services/app-profiles.ts`, `styles/globals.css`, `components/app/app-tile.tsx`, `e2e/support/site.ts`, `e2e/support/stub-switchboard.mjs`
- Test: `e2e/apps.spec.ts`

**Interfaces:**
- Consumes: Phase A `SiteLayout`, `PageMeta`, `Container`/`Heading`/`Lead`/`ButtonLink`/`buttonClasses`, `AppTile` (`headingLevel={2}`), `VETRA_URL`, `withTimeout`, `SSR_DATA_TIMEOUT_MS`, `fixtureStub`/`removeFixture`, `useTheme`/`expectNoSeriousA11yViolations`/`attachScreenshots`; backend `appProfiles(limit, after, category)` and `appProfileCategories`.
- Produces: `listAppProfiles({ limit, after?, category? })`, `AppProfileCategory`, `listAppCategories()`, `APPS_PAGE_SIZE`, `CATEGORY_MAX_LENGTH`, `parseCategory`, `sameCategory`, `appsHref`, `appendApps`, `useAppDirectory`, `CategoryChips`, `EmptyDirectory`, `DirectoryOutage`, `layoutShift(page)`; stub default `appProfileCategories: []`.

- [ ] **Step 1: Shared test helpers.** Append to `e2e/support/site.ts`:

```ts
/**
 * Cumulative layout shift of the page so far (shifts right after user input
 * excluded, as in CLS), measured over a further `settleMs`.
 */
export async function layoutShift(page: Page, settleMs = 1000): Promise<number> {
  return page.evaluate(
    (ms) =>
      new Promise<number>((resolve) => {
        let total = 0
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & { value: number; hadRecentInput: boolean })[]) {
            if (!entry.hadRecentInput) total += entry.value
          }
        }).observe({ type: 'layout-shift', buffered: true })
        setTimeout(() => resolve(total), ms)
      }),
    settleMs,
  )
}
```

and add the no-horizontal-scroll check to `attachScreenshots` (inside its `for` loop, after the `waitForTimeout(200)`):

```diff
     await page.setViewportSize({ width, height: 900 })
     await page.waitForTimeout(200)
+    // No horizontal page scroll at any width.
+    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
     const body = await page.screenshot({ fullPage: true })
```

- [ ] **Step 2: Write the failing test** — `e2e/apps.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'
import { fixtureStub, removeFixture } from './support/stub-switchboard-client'
import { attachScreenshots, expectNoSeriousA11yViolations, layoutShift, useTheme } from './support/site'
import { appendApps, appsHref, parseCategory, sameCategory } from '../utils/app-directory'

// /apps reads appProfiles(limit: 24, …) and appProfileCategories, server-side
// on load and from the browser on filter / load more; both reach the stub. No
// other page uses limit 24 or the categories query, but the tests here swap
// those fixtures, so they run one at a time.
test.describe.configure({ mode: 'serial' })

const did = (key: string) => `did:key:z6MkDir${key}${'x'.repeat(40 - key.length)}`
const app = (key: string, category: string | null = null) => ({
  appDid: did(key),
  documentId: `stub-dir-${key}`,
  name: `Directory ${key}`,
  tagline: `Tagline ${key}`,
  logo: null,
  website: null,
  publisherDid: null,
  description: null,
  category,
  logoRef: null,
  coverRef: null,
  links: [],
})
const page = (items: unknown[], next: string | null = null) => ({ data: { appProfiles: { items, next } } })

const IDS: string[] = []
/** Answers appProfiles(limit: 24) whose variables contain `variables` (e.g. '"category":null'). */
async function apps(id: string, variables: string, entry: { status?: number; response: unknown }): Promise<void> {
  await removeFixture(id)
  IDS.push(id)
  await fixtureStub({ id, match: 'appProfiles(', variables: `"limit":24,${variables}`, ...entry })
}
async function categories(response: unknown): Promise<void> {
  await removeFixture('dir-categories')
  IDS.push('dir-categories')
  await fixtureStub({ id: 'dir-categories', match: 'appProfileCategories', response })
}
const CATEGORIES = { data: { appProfileCategories: [{ category: 'Games', count: 2 }, { category: 'Tools', count: 1 }] } }

test.beforeEach(async () => {
  await categories(CATEGORIES)
  await apps('dir-all', '"after":null,"category":null', { response: page([app('A1', 'Games'), app('A2', 'Tools'), app('A3', 'Games')]) })
  await apps('dir-games', '"after":null,"category":"Games"', { response: page([app('A1', 'Games'), app('A3', 'Games')]) })
})

test.afterAll(async () => {
  for (const id of IDS) await removeFixture(id)
})

const grid = (p: Page) => p.getByRole('list', { name: /apps$/i })

test.describe('directory helpers', () => {
  test('parseCategory trims, takes the first value and treats blank or oversized as all', () => {
    expect(parseCategory('  Games ')).toBe('Games')
    expect(parseCategory(['Tools', 'Games'])).toBe('Tools')
    expect(parseCategory('   ')).toBeNull()
    expect(parseCategory(undefined)).toBeNull()
    expect(parseCategory('x'.repeat(41))).toBeNull()
    expect(sameCategory('games', 'Games')).toBe(true)
    expect(sameCategory(null, null)).toBe(true)
    expect(appsHref('Dev & Ops')).toBe('/apps?category=Dev%20%26%20Ops')
    expect(appsHref(null)).toBe('/apps')
  })

  test('appendApps skips apps already listed', () => {
    expect(appendApps([app('A1')], [app('A1'), app('A2')]).map((a) => a.appDid)).toEqual([did('A1'), did('A2')])
  })
})

test('renders the first page, the category chips and the page metadata', async ({ page: p }) => {
  const response = await p.goto('/apps')
  expect(response?.status()).toBe(200)
  await expect(p).toHaveTitle('Apps - Renown')
  await expect(p.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/apps$/)
  await expect(p.getByRole('heading', { level: 1, name: 'Apps on Renown' })).toBeVisible()
  const chips = p.getByRole('navigation', { name: 'App categories' })
  await expect(chips.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
  // Link text utilities must beat the base `a { color: inherit }` (white on the primary fill).
  await expect(chips.getByRole('link', { name: 'All' })).toHaveCSS('color', 'rgb(255, 255, 255)')
  await expect(chips.getByRole('link', { name: 'Games, 2 apps' })).toHaveAttribute('href', '/apps?category=Games')
  await expect(chips.getByRole('link', { name: 'Tools, 1 app' })).toBeVisible()
  await expect(grid(p).getByRole('listitem')).toHaveCount(3)
  await expect(grid(p).getByRole('link', { name: /Directory A2/ })).toHaveAttribute('href', `/app/${did('A2')}`)
  await expect(p.getByRole('heading', { level: 2, name: 'Directory A1' })).toBeVisible()
  await expect(p.getByRole('button', { name: 'Load more apps' })).toHaveCount(0)
})

test('a chip filters in place (shallow route + fetch), and back restores all apps', async ({ page: p }) => {
  await p.goto('/apps')
  await expect(grid(p).getByRole('listitem')).toHaveCount(3)
  await p.evaluate(() => ((window as { __noReload?: boolean }).__noReload = true))
  await p.getByRole('link', { name: 'Games, 2 apps' }).click()
  await expect(p).toHaveURL(/\/apps\?category=Games$/)
  await expect(grid(p).getByRole('listitem')).toHaveCount(2)
  await expect(p.getByRole('link', { name: 'Games, 2 apps' })).toHaveAttribute('aria-current', 'page')
  await expect(p.getByRole('main').getByRole('status')).toHaveText('2 apps in Games')
  expect(await p.evaluate(() => (window as { __noReload?: boolean }).__noReload)).toBe(true)
  await p.goBack()
  await expect(p).toHaveURL(/\/apps$/)
  await expect(grid(p).getByRole('listitem')).toHaveCount(3)
  await expect(p.getByRole('link', { name: 'All' })).toHaveAttribute('aria-current', 'page')
})

test('a category in the URL is matched case-insensitively and rendered on the server', async ({ page: p }) => {
  await apps('dir-games-lower', '"after":null,"category":"games"', { response: page([app('A1', 'Games'), app('A3', 'Games')]) })
  await p.goto('/apps?category=%20games%20')
  await expect(p.getByRole('link', { name: 'Games, 2 apps' })).toHaveAttribute('aria-current', 'page')
  await expect(grid(p).getByRole('listitem')).toHaveCount(2)
})

test('Load more appends the next page, and a failed page can be retried', async ({ page: p }) => {
  await apps('dir-all', '"after":null,"category":null', { response: page([app('A1'), app('A2')], 'cursor-2') })
  await apps('dir-all-2', '"after":"cursor-2","category":null', { status: 500, response: { error: 'boom' } })
  await p.goto('/apps')
  await expect(grid(p).getByRole('listitem')).toHaveCount(2)
  await p.getByRole('button', { name: 'Load more apps' }).click()
  await expect(p.getByRole('main').getByRole('alert')).toContainText("More apps didn't load")
  await expect(grid(p).getByRole('listitem')).toHaveCount(2)

  await apps('dir-all-2', '"after":"cursor-2","category":null', { response: page([app('A2'), app('A4')], null) })
  await p.getByRole('button', { name: 'Load more apps' }).click()
  await expect(grid(p).getByRole('listitem')).toHaveCount(3)
  await expect(grid(p).getByRole('link', { name: /Directory A4/ })).toBeVisible()
  await expect(p.getByRole('button', { name: 'Load more apps' })).toHaveCount(0)
})

test('an empty category invites listing an app on Vetra', async ({ page: p }) => {
  await apps('dir-empty', '"after":null,"category":"Empty"', { response: page([]) })
  await p.goto('/apps?category=Empty')
  await expect(p.getByRole('heading', { level: 2, name: 'No apps here yet' })).toBeVisible()
  await expect(p.getByRole('link', { name: 'List your app on Vetra' })).toHaveAttribute('href', 'https://www.vetra.io')
  await expect(p.getByRole('link', { name: 'Show all apps' })).toHaveAttribute('href', '/apps')
})

test('an outage answers 200 with a notice, and Try again recovers', async ({ page: p }) => {
  await apps('dir-all', '"after":null,"category":null', { status: 500, response: { error: 'boom' } })
  await categories({ data: null, errors: [{ message: 'Stats are temporarily unavailable', extensions: { code: 'SERVICE_UNAVAILABLE' } }] })
  const response = await p.goto('/apps')
  expect(response?.status()).toBe(200)
  await expect(p.getByRole('main').getByRole('alert')).toContainText('The app directory is unavailable')
  await expect(p.getByRole('navigation', { name: 'App categories' })).toHaveCount(0)

  await apps('dir-all', '"after":null,"category":null', { response: page([app('A1')]) })
  await p.getByRole('button', { name: 'Try again' }).click()
  await expect(grid(p).getByRole('listitem')).toHaveCount(1)
  await expect(p.getByRole('main').getByRole('alert')).toHaveCount(0)
})

test('late data never shifts the layout', async ({ page: p }) => {
  await p.goto('/apps')
  await expect(grid(p).getByRole('listitem')).toHaveCount(3)
  expect(await layoutShift(p)).toBeLessThan(0.01)
})

for (const theme of ['light', 'dark'] as const) {
  test(`has no serious axe violations (${theme})`, async ({ page: p }, testInfo) => {
    await useTheme(p, theme)
    await p.goto('/apps')
    await expect(grid(p).getByRole('listitem')).toHaveCount(3)
    await expectNoSeriousA11yViolations(p)
    await attachScreenshots(p, testInfo, `apps-${theme}`)
  })
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec playwright test e2e/apps.spec.ts --workers=3`
Expected: FAIL — `Cannot find module '../utils/app-directory'`.

- [ ] **Step 4: Category reads.** In `services/app-profiles.ts` replace `listAppProfiles` with the category-aware version and add `listAppCategories` (the field list is still the private `FIELDS`; Task 3 exports it):

```ts
@@APPPROFILES_TASK1@@
```

and give the stub a default for the categories query (`e2e/support/stub-switchboard.mjs`, `DEFAULT_DATA`):

```diff
   appProfiles: { items: [], next: null },
+  appProfileCategories: [],
   appStats: null,
```

- [ ] **Step 5: URL state helpers** — `utils/app-directory.ts`:

```ts
// URL state and paging helpers for the /apps directory (pure; shared by the
// page's getServerSideProps and its client-side updates).
import type { RenownAppProfile } from '../services/app-profiles'

/** Apps per page (first SSR page and every "Load more"). */
export const APPS_PAGE_SIZE = 24

/** The longest category an app profile can carry; anything longer matches nothing. */
export const CATEGORY_MAX_LENGTH = 40

/**
 * The `?category=` value as the directory uses it: the first value, trimmed;
 * blank, absent or longer than a stored category can be means "all apps".
 */
export function parseCategory(value: string | string[] | undefined | null): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim() ?? ''
  if (!trimmed || trimmed.length > CATEGORY_MAX_LENGTH) return null
  return trimmed
}

/** Whether two categories are the same filter (the backend matches case-insensitively). */
export function sameCategory(a: string | null, b: string | null): boolean {
  return (a ?? '').toLowerCase() === (b ?? '').toLowerCase()
}

/** The directory URL for a category (null = all apps). */
export function appsHref(category: string | null): string {
  return category ? `/apps?category=${encodeURIComponent(category)}` : '/apps'
}

/** `existing` followed by the apps of `incoming` it does not already hold (a page can shift while paging). */
export function appendApps(existing: RenownAppProfile[], incoming: RenownAppProfile[]): RenownAppProfile[] {
  const seen = new Set(existing.map((app) => app.appDid))
  return [...existing, ...incoming.filter((app) => !seen.has(app.appDid))]
}
```

- [ ] **Step 6: The list state** — `components/apps/use-app-directory.ts` (no synchronous `setState` in effects: "loading" is derived from the URL category differing from the loaded one, which `react-hooks/set-state-in-effect` requires):

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { listAppProfiles, type AppProfilePage, type RenownAppProfile } from '../../services/app-profiles'
import { APPS_PAGE_SIZE, appendApps, sameCategory } from '../../utils/app-directory'

export interface AppDirectoryState {
  /** The category `items` belong to (null = all apps). */
  category: string | null
  items: RenownAppProfile[]
  next: string | null
  /** The list itself: shown, being replaced, or unavailable. */
  status: 'ready' | 'loading' | 'error'
  /** The "Load more" request. */
  more: 'idle' | 'loading' | 'error'
}

export interface AppDirectory {
  state: AppDirectoryState
  loadMore: () => void
  retry: () => void
}

/** The last answer for a category's list. */
interface Loaded {
  category: string | null
  items: RenownAppProfile[]
  next: string | null
  failed: boolean
  more: AppDirectoryState['more']
}

function fromPage(category: string | null, page: AppProfilePage | null): Loaded {
  return page
    ? { category, items: page.items, next: page.next, failed: false, more: 'idle' }
    : { category, items: [], next: null, failed: true, more: 'idle' }
}

/**
 * The directory list for the category in the URL. Starts from the server's
 * first page; when the category changes (chip, back/forward) it fetches that
 * category's first page, keeping the current cards on screen until it arrives.
 * Answers to superseded requests are dropped.
 */
export function useAppDirectory(
  initial: { category: string | null; page: AppProfilePage | null },
  category: string | null,
): AppDirectory {
  const [loaded, setLoaded] = useState<Loaded>(() => fromPage(initial.category, initial.page))
  const [retrying, setRetrying] = useState(false)
  const request = useRef(0)

  const fetchFirst = useCallback((target: string | null) => {
    const id = ++request.current
    listAppProfiles({ limit: APPS_PAGE_SIZE, category: target })
      .then((page) => {
        if (id === request.current) setLoaded(fromPage(target, page))
      })
      .catch((error: unknown) => {
        console.warn('Apps directory unavailable:', error)
        if (id === request.current) setLoaded(fromPage(target, null))
      })
      .finally(() => {
        if (id === request.current) setRetrying(false)
      })
  }, [])

  useEffect(() => {
    if (!sameCategory(category, loaded.category)) fetchFirst(category)
    // Back on the category already shown: an answer still in flight for another one is stale.
    else request.current++
  }, [category, loaded.category, fetchFirst])

  const busy = retrying || !sameCategory(category, loaded.category)

  const loadMore = useCallback(() => {
    if (!loaded.next || loaded.more === 'loading' || busy) return
    const id = request.current
    const { category: target, next } = loaded
    setLoaded((l) => ({ ...l, more: 'loading' }))
    listAppProfiles({ limit: APPS_PAGE_SIZE, after: next, category: target })
      .then((page) => {
        if (id !== request.current) return
        setLoaded((l) => ({ ...l, items: appendApps(l.items, page.items), next: page.next, more: 'idle' }))
      })
      .catch((error: unknown) => {
        console.warn('Apps directory: next page unavailable:', error)
        if (id === request.current) setLoaded((l) => ({ ...l, more: 'error' }))
      })
  }, [loaded, busy])

  const retry = useCallback(() => {
    setRetrying(true)
    fetchFirst(loaded.category)
  }, [fetchFirst, loaded.category])

  return {
    state: {
      category: loaded.category,
      items: loaded.items,
      next: loaded.next,
      status: busy ? 'loading' : loaded.failed ? 'error' : 'ready',
      more: loaded.more,
    },
    loadMore,
    retry,
  }
}
```

- [ ] **Step 7: Chips and notices**

`components/apps/category-chips.tsx`:

```tsx
import Link from 'next/link'
import type { AppProfileCategory } from '../../services/app-profiles'
import { cx } from '../../utils/cx'
import { appsHref, sameCategory } from '../../utils/app-directory'

const CHIP =
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-medium whitespace-nowrap transition-colors'
const IDLE = 'border-hairline-strong bg-surface-1 text-ink hover:border-primary/50 hover:bg-surface-2'
const ACTIVE = 'border-transparent bg-primary-strong text-primary-foreground'

/**
 * "All" plus one chip per category with its count. Chips are links (they work
 * without JavaScript); with it, they route shallowly and the page fetches the
 * category client-side. One line that scrolls sideways on phones, wrapping from md.
 */
export function CategoryChips({ categories, selected }: { categories: AppProfileCategory[]; selected: string | null }) {
  if (categories.length === 0) return null
  const chips = [{ category: null, count: null }, ...categories] as { category: string | null; count: number | null }[]
  return (
    <nav aria-label="App categories" className="-mx-4 md:mx-0">
      <ul className="flex gap-2 overflow-x-auto px-4 pt-1 pb-3 md:flex-wrap md:overflow-visible md:px-0">
        {chips.map(({ category, count }) => {
          const active = category === null ? selected === null : sameCategory(category, selected)
          return (
            <li key={category ?? '*'}>
              <Link
                href={appsHref(category)}
                shallow
                scroll={false}
                aria-current={active ? 'page' : undefined}
                aria-label={count === null ? undefined : `${category}, ${count === 1 ? '1 app' : `${count} apps`}`}
                className={cx(CHIP, active ? ACTIVE : IDLE)}
              >
                {category ?? 'All'}
                {count !== null && (
                  <span aria-hidden="true" className={cx('tabular-nums', active ? 'opacity-80' : 'text-ink-muted')}>
                    {count}
                  </span>
                )}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
```

`components/apps/directory-notice.tsx`:

```tsx
import type { ReactNode } from 'react'
import { ButtonLink, buttonClasses } from '../site/primitives'
import { VETRA_URL } from '../site/nav'

function NoticeFrame({ children, role }: { children: ReactNode; role?: 'alert' }) {
  return (
    <div
      role={role}
      className="border-hairline-strong rounded-panel flex flex-col items-center border border-dashed px-6 py-16 text-center md:py-20"
    >
      {children}
    </div>
  )
}

/** No apps for this filter: an invitation to list one. */
export function EmptyDirectory({ filtered }: { filtered: boolean }) {
  return (
    <NoticeFrame>
      <h2 className="text-ink text-h3">No apps here yet</h2>
      <p className="text-ink-muted mt-3 max-w-[46ch]">
        Apps appear here once their publisher gives them a Renown identity and a public profile on Vetra.
      </p>
      <div className="mt-8 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href={VETRA_URL}>List your app on Vetra</ButtonLink>
        {filtered && (
          <ButtonLink href="/apps" variant="secondary">
            Show all apps
          </ButtonLink>
        )}
      </div>
    </NoticeFrame>
  )
}

/** The directory could not be read: say so and offer a retry (the page itself still answers 200). */
export function DirectoryOutage({ onRetry }: { onRetry: () => void }) {
  return (
    <NoticeFrame role="alert">
      <h2 className="text-ink text-h3">The app directory is unavailable</h2>
      <p className="text-ink-muted mt-3 max-w-[46ch]">
        Renown didn&apos;t answer in time. Your apps and approvals are not affected. Try again in a moment.
      </p>
      <button type="button" onClick={onRetry} className={buttonClasses('primary', 'md', 'mt-8')}>
        Try again
      </button>
    </NoticeFrame>
  )
}
```

- [ ] **Step 8: The page** — `pages/apps.tsx`:

```tsx
import type { GetServerSideProps, NextPage } from 'next'
import { useRouter } from 'next/router'
import { AppTile } from '../components/app/app-tile'
import { CategoryChips } from '../components/apps/category-chips'
import { DirectoryOutage, EmptyDirectory } from '../components/apps/directory-notice'
import { useAppDirectory } from '../components/apps/use-app-directory'
import { PageMeta } from '../components/site/page-meta'
import { buttonClasses, Container, Heading, Lead } from '../components/site/primitives'
import { SiteLayout } from '../components/site/site-layout'
import {
  listAppCategories,
  listAppProfiles,
  type AppProfileCategory,
  type AppProfilePage,
} from '../services/app-profiles'
import { APPS_PAGE_SIZE, parseCategory, sameCategory } from '../utils/app-directory'
import { cx } from '../utils/cx'
import { SSR_DATA_TIMEOUT_MS, withTimeout } from '../utils/with-timeout'

interface AppsPageProps {
  /** The category the server rendered (null = all apps). */
  category: string | null
  /** First page for that category; null when the directory could not be read. */
  page: AppProfilePage | null
  /** Category chips; empty when there are none or they could not be read. */
  categories: AppProfileCategory[]
}

const DESCRIPTION =
  'Browse the apps that sign you in with Renown. Every one has a public Renown identity you can inspect before you approve it.'

function countLine(categories: AppProfileCategory[], selected: string | null): string | null {
  if (!selected) return null
  const match = categories.find((c) => sameCategory(c.category, selected))
  if (!match) return null
  return `${match.count === 1 ? '1 app' : `${match.count} apps`} in ${match.category}`
}

/** Placeholder cards while a category loads with nothing on screen yet (keeps the frame steady). */
function TileSkeletons() {
  return (
    <ul aria-hidden="true" className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((key) => (
        <li key={key} className="border-hairline bg-surface-1 rounded-card overflow-hidden border">
          <div className="bg-surface-2 aspect-[3/1] motion-safe:animate-pulse" />
          <div className="space-y-3 px-5 pt-10 pb-6">
            <div className="bg-surface-2 h-5 w-2/3 rounded motion-safe:animate-pulse" />
            <div className="bg-surface-2 h-4 w-full rounded motion-safe:animate-pulse" />
          </div>
        </li>
      ))}
    </ul>
  )
}

const AppsPage: NextPage<AppsPageProps> = ({ category: initialCategory, page, categories }) => {
  const router = useRouter()
  const category = parseCategory(router.query['category'])
  const { state, loadMore, retry } = useAppDirectory({ category: initialCategory, page }, category)
  const busy = state.status === 'loading'
  const summary = countLine(categories, state.category)

  return (
    <SiteLayout>
      <PageMeta title="Apps" description={DESCRIPTION} path="/apps" />
      <section aria-labelledby="apps-title">
        <Container className="pt-14 pb-10 md:pt-20 md:pb-12">
          <Heading level={1} id="apps-title">
            Apps on Renown
          </Heading>
          <Lead>{DESCRIPTION}</Lead>
        </Container>
      </section>

      <Container className="pb-24 md:pb-32">
        <CategoryChips categories={categories} selected={category} />
        <p role="status" className={cx('text-ink-muted mt-3 min-h-6 text-sm', !summary && 'sr-only')}>
          {busy ? 'Loading apps…' : (summary ?? '')}
        </p>

        <div className="mt-6">
          {state.status === 'error' ? (
            <DirectoryOutage onRetry={retry} />
          ) : state.items.length === 0 && busy ? (
            <TileSkeletons />
          ) : state.items.length === 0 ? (
            <EmptyDirectory filtered={state.category !== null} />
          ) : (
            <ul
              aria-busy={busy}
              aria-label={state.category ? `${state.category} apps` : 'All apps'}
              className={cx(
                'grid gap-5 transition-opacity duration-300 sm:grid-cols-2 lg:grid-cols-3',
                busy && 'pointer-events-none opacity-50',
              )}
            >
              {state.items.map((app) => (
                <li key={app.appDid}>
                  <AppTile app={app} headingLevel={2} />
                </li>
              ))}
            </ul>
          )}
        </div>

        {state.status === 'ready' && state.next && (
          <div className="mt-12 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={loadMore}
              disabled={state.more === 'loading'}
              className={buttonClasses('secondary', 'lg')}
            >
              {state.more === 'loading' ? 'Loading…' : 'Load more apps'}
            </button>
            {state.more === 'error' && (
              <p role="alert" className="text-ink-muted text-sm">
                More apps didn&apos;t load. Select the button to try again.
              </p>
            )}
          </div>
        )}
      </Container>
    </SiteLayout>
  )
}

export const getServerSideProps: GetServerSideProps<AppsPageProps> = async ({ query, res }) => {
  const category = parseCategory(query['category'])
  const [page, categories] = await Promise.all([
    withTimeout(listAppProfiles({ limit: APPS_PAGE_SIZE, category }), SSR_DATA_TIMEOUT_MS).catch((error: unknown) => {
      console.error('Apps directory unavailable:', error)
      return null
    }),
    withTimeout(listAppCategories(), SSR_DATA_TIMEOUT_MS).catch((error: unknown) => {
      console.error('Apps directory: categories unavailable:', error)
      return []
    }),
  ])
  // An outage must not be cached at the edge: the next visitor retries.
  res.setHeader('Cache-Control', page ? 'public, s-maxage=60, stale-while-revalidate=300' : 'no-store')
  return { props: { category, page, categories } }
}

export default AppsPage
```

- [ ] **Step 9: Two Phase A fixes the page depends on (ruling 17).** In `styles/globals.css`, move the global link rule into the base layer so `text-*` utilities on links win:

```diff
-a {
-    color: inherit;
-    text-decoration: none;
-    cursor: pointer;
-}
+/* In the base layer so text-* utilities on links (buttons, chips) win over it. */
+@layer base {
+    a {
+        color: inherit;
+        text-decoration: none;
+        cursor: pointer;
+    }
+}
```

In `components/app/app-tile.tsx`, lift the logo above the (positioned) cover:

```diff
@@ -30,7 +30,7 @@ export function AppTile({ app, headingLevel = 3 }: AppTileProps) {
           logoRef={app.logoRef}
           legacyLogo={app.logo}
           name={name}
-          className="-mt-7 h-14 w-14 text-xl ring-4"
+          className="relative -mt-7 h-14 w-14 text-xl ring-4"
         />
         <div className="mt-3 flex items-start justify-between gap-3">
           <Title className="text-ink text-h3 min-w-0 truncate">{name}</Title>
```

In `pages/developers.tsx` (Phase A Task 7), let the inline code wrap so the page fits 390 px (the new scroll check in `attachScreenshots` fails `/developers` otherwise):

```diff
@@ -37,7 +37,7 @@ const Code = ({ value, label }: { value: HighlightedCode; label: string }) => (
   <CodeBlock code={value.code} html={value.html} label={label} className="mt-6" />
 )
 
-const Mono = ({ children }: { children: ReactNode }) => <code className="text-ink font-mono text-[0.9em]">{children}</code>
+const Mono = ({ children }: { children: ReactNode }) => <code className="text-ink font-mono text-[0.9em] wrap-anywhere">{children}</code>
 
 const PARAMS: ParamRow[] = [
   { name: 'connect', value: 'App DID (did:key:…)', description: 'The app asking for access. Required unless app is set.' },
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm exec playwright test e2e/apps.spec.ts --workers=3`
Expected: 11 passed. Open the report (`pnpm exec playwright show-report`) and look at `apps-{light,dark}-{390,1280}.png`: chips on one line that scrolls sideways at 390 and wraps at 1280; the active chip white on blue; three tiles per row at 1280 with each logo overlapping the bottom of its cover.

- [ ] **Step 11: The other site specs still pass with the CSS and tile changes**

Run: `pnpm exec playwright test e2e/home.spec.ts e2e/site-shell.spec.ts e2e/app-pages.spec.ts e2e/static-pages.spec.ts e2e/developers.spec.ts --workers=3`
Expected: all pass (the new no-horizontal-scroll check runs inside every `attachScreenshots`), except possibly the Phase A builder test described in Task 5 Step 2, which fails with or without this plan.

- [ ] **Step 12: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add utils/app-directory.ts components/apps pages/apps.tsx services/app-profiles.ts styles/globals.css components/app/app-tile.tsx e2e/support/site.ts e2e/support/stub-switchboard.mjs e2e/apps.spec.ts
git commit -m "feat(apps): app directory with category chips, load more and outage state"
```

---

## Task 2: Homepage network pulse

**Files:**
- Create: `services/network-stats.ts`, `utils/pulse.ts`, `hooks/use-count-up.ts`
- Modify: `components/home/network-pulse.tsx` (replace Phase A's empty body), `pages/index.tsx`, `e2e/support/stub-switchboard.mjs`
- Test: `e2e/home.spec.ts` (extend)

**Interfaces:**
- Consumes: Phase A `NetworkPulse`, `NetworkPulseSection({ pulse })` slot, `HomePageData.pulse`, `Section`/`Heading`, `formatStatValue`, `switchboardOrigin`, `withTimeout`/`SSR_DATA_TIMEOUT_MS`, `layoutShift` (Task 1); backend `renownNetworkStats`.
- Produces: `fetchNetworkStats`, `DEFAULT_PULSE_MIN`, `pulseMin`, `visibleMetrics`, `PulseMetric`, `PulseKey`, `useCountUp`; homepage `getServerSideProps` now returns `pulse`; stub default `renownNetworkStats: null`.

- [ ] **Step 1: Write the failing tests** — in `e2e/home.spec.ts` (Phase A Task 6's file):

```diff
@@ -1,6 +1,7 @@
 import { test, expect } from '@playwright/test'
 import { fixtureStub, removeFixture } from './support/stub-switchboard-client'
-import { attachScreenshots, expectNoSeriousA11yViolations, useTheme } from './support/site'
+import { attachScreenshots, expectNoSeriousA11yViolations, layoutShift, useTheme } from './support/site'
+import { DEFAULT_PULSE_MIN, pulseMin, visibleMetrics } from '../utils/pulse'
 
 // Every homepage load in the suite lives in this file: its tests swap the
 // appProfiles fixture the SSR reads, so they run one at a time and no other
@@ -30,8 +31,19 @@ async function featured(entry: { status?: number; response: unknown }): Promise<
   await fixtureStub({ id: FIXTURE, match: 'appProfiles(', variables: '"limit":6', ...entry })
 }
 
+const PULSE = 'home-pulse'
+/** Prod on 2026-10-09: two counts reach the default threshold of 25. */
+const PROD_PULSE = { identities: 245, apps: 1, activeCredentials: 168, activeUsers30d: 0, updatedAt: '2026-10-09T10:00:00.000Z' }
+
+/** Makes the homepage's renownNetworkStats read answer with `entry`. */
+async function pulse(entry: { status?: number; response: unknown }): Promise<void> {
+  await removeFixture(PULSE)
+  await fixtureStub({ id: PULSE, match: 'renownNetworkStats', ...entry })
+}
+
 test.afterAll(async () => {
   await removeFixture(FIXTURE)
+  await removeFixture(PULSE)
 })
 
 test('renders the pitch, the CTAs and up to six featured apps', async ({ page }) => {
@@ -85,9 +97,83 @@ test('has canonical, Open Graph and JSON-LD metadata', async ({ page }) => {
   expect(types).toEqual(['Organization', 'WebSite'])
 })
 
+test.describe('network pulse', () => {
+  const region = (page: import('@playwright/test').Page) => page.getByRole('region', { name: 'The network right now' })
+
+  test('threshold and metric selection', () => {
+    expect(pulseMin(undefined)).toBe(DEFAULT_PULSE_MIN)
+    expect(pulseMin('')).toBe(DEFAULT_PULSE_MIN)
+    expect(pulseMin('-3')).toBe(DEFAULT_PULSE_MIN)
+    expect(pulseMin('ten')).toBe(DEFAULT_PULSE_MIN)
+    expect(pulseMin(' 0 ')).toBe(0)
+    expect(pulseMin('100')).toBe(100)
+    expect(visibleMetrics(PROD_PULSE, 25).map((m) => [m.key, m.value])).toEqual([
+      ['identities', 245],
+      ['activeCredentials', 168],
+    ])
+    expect(visibleMetrics(PROD_PULSE, 0)).toHaveLength(4)
+    expect(visibleMetrics(PROD_PULSE, 1000)).toEqual([])
+    expect(visibleMetrics(null, 0)).toEqual([])
+  })
+
+  test('shows only the counts at or above the threshold', async ({ page }) => {
+    await pulse({ response: { data: { renownNetworkStats: PROD_PULSE } } })
+    await page.emulateMedia({ reducedMotion: 'reduce' })
+    await page.goto('/')
+    const pulseRegion = region(page)
+    await expect(pulseRegion.getByRole('term')).toHaveText(['people with a Renown ID', 'active app approvals'])
+    await expect(page.getByTestId('pulse-identities')).toHaveText('245')
+    await expect(page.getByTestId('pulse-activeCredentials')).toHaveText('168')
+    await expect(pulseRegion.getByText('apps with a Renown identity')).toHaveCount(0)
+  })
+
+  test('is hidden when no count reaches the threshold', async ({ page }) => {
+    await pulse({ response: { data: { renownNetworkStats: { ...PROD_PULSE, identities: 24, activeCredentials: 3 } } } })
+    await page.goto('/')
+    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
+    await expect(region(page)).toHaveCount(0)
+  })
+
+  test('is hidden when the stats are unavailable, and the page still answers 200', async ({ page }) => {
+    await pulse({ response: { data: null, errors: [{ message: 'Stats are temporarily unavailable', extensions: { code: 'SERVICE_UNAVAILABLE' } }] } })
+    const response = await page.goto('/')
+    expect(response?.status()).toBe(200)
+    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
+    await expect(region(page)).toHaveCount(0)
+  })
+
+  test('counts up when scrolled into view, without shifting the layout', async ({ page }) => {
+    await pulse({ response: { data: { renownNetworkStats: PROD_PULSE } } })
+    await page.emulateMedia({ reducedMotion: 'no-preference' })
+    await page.setViewportSize({ width: 1280, height: 720 })
+    await page.goto('/')
+    const identities = page.getByTestId('pulse-identities')
+    await expect(identities).toHaveText('0')
+    const size = async () => {
+      const box = await region(page).boundingBox()
+      return box && { width: box.width, height: box.height }
+    }
+    const before = await size()
+    await identities.scrollIntoViewIfNeeded()
+    await expect(identities).toHaveText('245', { timeout: 5000 })
+    expect(await size()).toEqual(before)
+    expect(await layoutShift(page)).toBeLessThan(0.01)
+  })
+
+  test('shows the final numbers at once under reduced motion', async ({ page }) => {
+    await pulse({ response: { data: { renownNetworkStats: PROD_PULSE } } })
+    await page.emulateMedia({ reducedMotion: 'reduce' })
+    await page.goto('/')
+    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
+    await page.waitForTimeout(300)
+    await expect(page.getByTestId('pulse-identities')).toHaveText('245')
+  })
+})
+
 for (const theme of ['light', 'dark'] as const) {
   test(`has no serious axe violations (${theme})`, async ({ page }, testInfo) => {
     await featured({ response: { data: { appProfiles: { items: [1, 2, 3, 4, 5, 6].map(app), next: null } } } })
+    await pulse({ response: { data: { renownNetworkStats: { ...PROD_PULSE, apps: 31, activeUsers30d: 1234 } } } })
     await useTheme(page, theme)
     await page.goto('/')
     await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec playwright test e2e/home.spec.ts --workers=3`
Expected: FAIL — `Cannot find module '../utils/pulse'`.

- [ ] **Step 3: Reads and selection**

`services/network-stats.ts`:

```ts
// Network-wide counts from renown-stats `renownNetworkStats` (public read,
// cached for 300 s by the backend).
import { GraphQLClient } from 'graphql-request'
import type { NetworkPulse } from '../components/home/types'
import { switchboardOrigin } from './media'

/** The current counts; null when the switchboard has none. A failed read throws. */
export async function fetchNetworkStats(): Promise<NetworkPulse | null> {
  const data = await new GraphQLClient(`${switchboardOrigin()}/graphql/renown-stats`).request<{
    renownNetworkStats?: NetworkPulse | null
  }>(`query RenownNetworkStats { renownNetworkStats { identities apps activeCredentials activeUsers30d updatedAt } }`)
  return data.renownNetworkStats ?? null
}
```

`utils/pulse.ts`:

```ts
// Which network numbers the homepage shows (pure; used on server and client).
import type { NetworkPulse } from '../components/home/types'

/** Smallest number worth showing when NEXT_PUBLIC_PULSE_MIN is unset or invalid. */
export const DEFAULT_PULSE_MIN = 25

export type PulseKey = 'identities' | 'activeCredentials' | 'activeUsers30d' | 'apps'

export interface PulseMetric {
  key: PulseKey
  value: number
  label: string
}

/** Display order and wording of every metric. */
export const PULSE_LABELS: { key: PulseKey; label: string }[] = [
  { key: 'identities', label: 'people with a Renown ID' },
  { key: 'activeCredentials', label: 'active app approvals' },
  { key: 'activeUsers30d', label: 'people active in apps in the last 30 days' },
  { key: 'apps', label: 'apps with a Renown identity' },
]

/**
 * The threshold from NEXT_PUBLIC_PULSE_MIN (inlined at build time, so server
 * and client agree): a whole number ≥ 0, else DEFAULT_PULSE_MIN.
 */
export function pulseMin(raw: string | undefined = process.env.NEXT_PUBLIC_PULSE_MIN): number {
  if (raw === undefined || !/^\d+$/.test(raw.trim())) return DEFAULT_PULSE_MIN
  return Number(raw.trim())
}

/** The metrics at or above `min`, in display order; empty hides the section. */
export function visibleMetrics(pulse: NetworkPulse | null | undefined, min: number): PulseMetric[] {
  if (!pulse) return []
  return PULSE_LABELS.filter(({ key }) => Number.isFinite(pulse[key]) && pulse[key] >= min).map(({ key, label }) => ({
    key,
    label,
    value: pulse[key],
  }))
}
```

Stub default (`e2e/support/stub-switchboard.mjs`, `DEFAULT_DATA`) so homepage loads without a pulse fixture render no section:

```diff
   appProfileCategories: [],
+  renownNetworkStats: null,
   appStats: null,
```

- [ ] **Step 4: Count-up** — `hooks/use-count-up.ts`:

```ts
import { useEffect, type RefObject } from 'react'

const DURATION_MS = 1400

/** easeOutExpo, the site's motion curve. */
function ease(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)
}

/**
 * Counts the text of `ref` up from 0 to `value` the first time it scrolls
 * into view. The server markup already shows the final number, so crawlers,
 * no-JS visitors and anything above the fold see it unchanged; only a number
 * still below the fold is reset to 0 (off screen, so nothing flashes). Writes
 * the DOM directly (no re-render per frame). Off under prefers-reduced-motion.
 */
export function useCountUp(ref: RefObject<HTMLElement | null>, value: number, format: (n: number) => string): void {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined' || value <= 0) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (el.getBoundingClientRect().top < window.innerHeight) return

    el.textContent = format(0)
    let frame = 0
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        const start = performance.now()
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION_MS)
          el.textContent = format(Math.round(value * ease(t)))
          if (t < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
      },
      { rootMargin: '0px 0px -15% 0px' },
    )
    observer.observe(el)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      el.textContent = format(value)
    }
  }, [ref, value, format])
}
```

- [ ] **Step 5: Fill the slot** — replace `components/home/network-pulse.tsx`:

```tsx
import { useRef } from 'react'
import { useCountUp } from '../../hooks/use-count-up'
import { cx } from '../../utils/cx'
import { pulseMin, visibleMetrics, type PulseMetric } from '../../utils/pulse'
import { formatStatValue } from '../../utils/stat-format'
import { Heading, Section } from '../site/primitives'
import type { NetworkPulse } from './types'

const COLUMNS = ['', 'md:grid-cols-1', 'md:grid-cols-2', 'md:grid-cols-3', 'md:grid-cols-4']

function Metric({ metric, index }: { metric: PulseMetric; index: number }) {
  const number = useRef<HTMLSpanElement>(null)
  useCountUp(number, metric.value, formatStatValue)
  const final = formatStatValue(metric.value)
  return (
    <div
      className={cx(
        'border-hairline flex flex-col py-8 md:px-8 md:py-10',
        index > 0 ? 'border-t md:border-t-0 md:border-l' : 'md:pl-0',
      )}
    >
      <dt className="text-ink-muted mt-3 max-w-[24ch] leading-6">{metric.label}</dt>
      <dd className="text-ink text-display order-first grid tabular-nums">
        {/* The final value reserves the width, so counting never moves the layout. */}
        <span aria-hidden="true" className="invisible col-start-1 row-start-1">
          {final}
        </span>
        <span ref={number} aria-hidden="true" className="col-start-1 row-start-1" data-testid={`pulse-${metric.key}`}>
          {final}
        </span>
        <span className="sr-only">{final}</span>
      </dd>
    </div>
  )
}

/**
 * The network pulse: each renownNetworkStats count at or above
 * NEXT_PUBLIC_PULSE_MIN (default 25), counting up on first view. Renders
 * nothing when no count qualifies or the stats were unavailable.
 */
export function NetworkPulseSection({ pulse }: { pulse?: NetworkPulse | null }) {
  const metrics = visibleMetrics(pulse, pulseMin())
  if (metrics.length === 0) return null
  return (
    <Section labelledBy="pulse-title" spacing="sm">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <Heading level={2} id="pulse-title">
          The network right now
        </Heading>
        <p className="text-ink-muted inline-flex items-center gap-2.5 text-sm">
          <span aria-hidden="true" className="relative flex h-2 w-2">
            <span className="bg-signal absolute inline-flex h-full w-full rounded-full opacity-60 motion-safe:animate-ping" />
            <span className="bg-signal relative inline-flex h-2 w-2 rounded-full" />
          </span>
          Counted from Renown records, refreshed every five minutes
        </p>
      </div>
      <dl className={cx('border-hairline mt-10 grid border-t', COLUMNS[metrics.length])}>
        {metrics.map((metric, index) => (
          <Metric key={metric.key} metric={metric} index={index} />
        ))}
      </dl>
    </Section>
  )
}
```

- [ ] **Step 6: Load the stats on the server** — `pages/index.tsx`:

```diff
@@ -15,6 +15,7 @@ import { PageMeta } from '../components/site/page-meta'
 import { SiteLayout } from '../components/site/site-layout'
 import { useIsClient } from '../hooks/useIsClient'
 import { listAppProfiles } from '../services/app-profiles'
+import { fetchNetworkStats } from '../services/network-stats'
 import { parseExpiresInDays } from '../utils/credential-validity'
 import { parseReturnUrl } from '../utils/return-url'
 import { publicOrigin } from '../utils/seo'
@@ -92,17 +93,21 @@ export const getServerSideProps: GetServerSideProps<HomeProps> = async ({ query,
   if (query['app'] || query['connect']) return { props: { mode: 'auth' } }
   // Imported here so shiki stays server-only.
   const { highlight } = await import('../lib/highlight')
-  const [featuredApps, teaser] = await Promise.all([
+  const [featuredApps, pulse, teaser] = await Promise.all([
     withTimeout(listAppProfiles({ limit: 6 }), SSR_DATA_TIMEOUT_MS)
       .then((page) => page.items)
       .catch((error: unknown) => {
         console.error('Homepage: featured apps unavailable:', error)
         return []
       }),
+    withTimeout(fetchNetworkStats(), SSR_DATA_TIMEOUT_MS).catch((error: unknown) => {
+      console.error('Homepage: network stats unavailable:', error)
+      return null
+    }),
     highlight(TEASER_CODE, 'ts'),
   ])
   res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
-  return { props: { mode: 'site', featuredApps, pulse: null, teaser } }
+  return { props: { mode: 'site', featuredApps, pulse, teaser } }
 }
 
 export default Home
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec playwright test e2e/home.spec.ts --workers=3`
Expected: 12 passed. In the axe screenshots (`home-{light,dark}-1280.png`) the pulse sits between the featured apps and the developers teaser: heading left, "Counted from Renown records…" with a green dot right, four numbers on one hairline-ruled row, tops aligned even where a label wraps.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add services/network-stats.ts utils/pulse.ts hooks/use-count-up.ts components/home/network-pulse.tsx pages/index.tsx e2e/support/stub-switchboard.mjs e2e/home.spec.ts
git commit -m "feat(home): network pulse from renownNetworkStats with threshold and count-up"
```

---

## Task 3: `/me` model and transport

**Files:**
- Create: `utils/relative-time.ts`, `lib/me/connections.ts`, `lib/me/completeness.ts`, `lib/me/export.ts`, `lib/me/revoke.ts`, `services/renown-connections.ts`
- Modify: `services/app-profiles.ts` (export the field list)
- Test: `e2e/me-model.spec.ts`

**Interfaces:**
- Consumes: `revokeMessage` (`services/renown-signed-messages.ts`, verbatim copy of renown-package `subgraphs/renown-auth/core/signed-message.ts`: `` `Revoke Renown credential ${credentialId} at ${timestamp}` ``), `RenownProfile` (`services/switchboard.ts`), `RenownAppProfile`, `switchboardOrigin`, `SWITCHBOARD_ENDPOINT`; backend `renownCredentials(input: RenownCredentialsInput!)` (fields `documentId credentialId issuerId issuanceDate expirationDate credentialSubjectId credentialSubjectApp revoked`), `appProfile(appDid)`, `renown_revokeCredential(credentialId, signature, timestamp): Boolean` (errors `NOT_FOUND`, `FORBIDDEN`; a login token for the issuer address or a fresh — ±10 min — `personal_sign`).
- Produces: everything listed under `utils/relative-time.ts`, `lib/me/*` and `services/renown-connections.ts` in "Produced interfaces", and `APP_PROFILE_FIELDS`.

- [ ] **Step 1: Write the failing test** — `e2e/me-model.spec.ts` (the revoke test vector: key `0x11…11` → address `0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A`, message `Revoke Renown credential urn:uuid:1b4e28ba-2d11-4d4d-9f3b-8f1d5c6a7e90 at 2026-10-09T12:00:00.000Z`, deterministic signature below):

```ts
import { test, expect } from '@playwright/test'
import { verifyMessage } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { profileCompleteness } from '../lib/me/completeness'
import { groupConnections, identityDid, isExpired, profileCandidates, shortDid, type IssuedCredential } from '../lib/me/connections'
import { myDataFileName, myDataJson } from '../lib/me/export'
import { RevokeError, revokeConnection, revokeFailureText, type RevokeAuth } from '../lib/me/revoke'
import type { RenownAppProfile } from '../services/app-profiles'
import { revokeMessage } from '../services/renown-signed-messages'
import { formatAbsolute, formatRelative } from '../utils/relative-time'

// Runs in the Playwright worker (Node): the pure parts of /me.
const NOW = new Date('2026-10-09T12:00:00.000Z')
const ADDRESS = '0x5e1F0a01Aa000000000000000000000000000a01'
const ISSUER = `did:pkh:eip155:1:${ADDRESS.toLowerCase()}`
const ALPHA = 'did:key:z6MkAlphaxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const CLI = 'did:key:z6MkCliSessionxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

function credential(id: string, subject: string | null, issued: string, expires: string | null, extra: Partial<IssuedCredential> = {}): IssuedCredential {
  return {
    documentId: `doc-${id}`,
    credentialId: `urn:uuid:${id}`,
    issuerId: ISSUER,
    issuanceDate: issued,
    expirationDate: expires,
    credentialSubjectId: subject,
    credentialSubjectApp: subject === CLI ? 'ph-cli' : 'renown-app',
    revoked: false,
    ...extra,
  }
}
const alphaProfile = { appDid: ALPHA, documentId: 'alpha-doc', name: 'Alpha', logoRef: null, logo: null } as RenownAppProfile

test.describe('relative time', () => {
  test('formats past and future in plain words', () => {
    expect(formatRelative('2026-10-09T11:59:40.000Z', NOW)).toBe('just now')
    expect(formatRelative('2026-10-09T11:55:00.000Z', NOW)).toBe('5 minutes ago')
    expect(formatRelative('2026-10-09T15:00:00.000Z', NOW)).toBe('in 3 hours')
    expect(formatRelative('2026-10-10T12:00:00.000Z', NOW)).toBe('tomorrow')
    expect(formatRelative('2026-10-15T12:00:00.000Z', NOW)).toBe('in 6 days')
    expect(formatRelative('2026-08-01T12:00:00.000Z', NOW)).toBe('2 months ago')
    expect(formatRelative('2027-10-09T12:00:00.000Z', NOW)).toBe('next year')
    expect(formatRelative('not a date', NOW)).toBe('')
    expect(formatAbsolute('2026-10-09T12:03:00.000Z', 'UTC')).toBe('Oct 9, 2026, 12:03 PM')
  })
})

test.describe('connections', () => {
  test('groups by subject: app profiles under apps, the rest under sessions, newest first', () => {
    const list = [
      credential('a1', ALPHA, '2026-10-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z'),
      credential('a2', ALPHA, '2026-10-07T00:00:00.000Z', '2026-10-14T00:00:00.000Z'),
      credential('a2', ALPHA, '2026-10-07T00:00:00.000Z', '2026-10-14T00:00:00.000Z', { documentId: 'doc-a2-copy' }),
      credential('c1', CLI, '2026-10-08T00:00:00.000Z', null),
      credential('old', null, '2026-09-01T00:00:00.000Z', '2026-09-08T00:00:00.000Z'),
      credential('gone', CLI, '2026-10-08T00:00:00.000Z', null, { revoked: true }),
    ]
    const grouped = groupConnections(list, { [ALPHA]: alphaProfile, [CLI]: null })
    expect(grouped.apps.map((g) => [g.name, g.connections.map((c) => c.credentialId)])).toEqual([
      ['Alpha', ['urn:uuid:a2', 'urn:uuid:a1']],
    ])
    expect(grouped.sessions.map((g) => [g.subject, g.name, g.connections.length])).toEqual([
      [CLI, 'ph-cli', 1],
      [ISSUER, 'renown-app', 1],
    ])
    const hidden = groupConnections(list, { [ALPHA]: alphaProfile }, new Set(['urn:uuid:a2']))
    expect(hidden.apps[0].connections.map((c) => c.credentialId)).toEqual(['urn:uuid:a1'])
  })

  test('helpers', () => {
    expect(profileCandidates([credential('a', ALPHA, NOW.toISOString(), null), credential('b', ALPHA, NOW.toISOString(), null), credential('c', null, NOW.toISOString(), null)])).toEqual([ALPHA])
    expect(isExpired('2026-10-09T12:00:00.000Z', NOW)).toBe(true)
    expect(isExpired('2026-10-09T12:00:01.000Z', NOW)).toBe(false)
    expect(isExpired(null, NOW)).toBe(false)
    expect(shortDid(ALPHA)).toBe('did:key:z6MkAlph…xxxx')
    expect(identityDid(ADDRESS, [])).toBe(ISSUER)
    expect(identityDid(ADDRESS, [credential('x', null, NOW.toISOString(), null, { issuerId: `did:pkh:eip155:137:${ADDRESS.toLowerCase()}` })])).toBe(
      `did:pkh:eip155:137:${ADDRESS.toLowerCase()}`,
    )
  })

  test('completeness counts avatar, handle, bio and a link', () => {
    expect(profileCompleteness(null)).toMatchObject({ done: 0, total: 4, percent: 0 })
    const half = profileCompleteness({ documentId: 'd', handle: 'frank', userImage: 'https://x.example/a.png', bio: '  ', links: [] })
    expect(half.items.map((i) => [i.key, i.done])).toEqual([
      ['avatar', true],
      ['handle', true],
      ['bio', false],
      ['links', false],
    ])
    expect(half.percent).toBe(50)
  })

  test('the export holds the profile fields and the approvals as shown', () => {
    const grouped = groupConnections([credential('a1', ALPHA, '2026-10-01T00:00:00.000Z', '2026-10-08T00:00:00.000Z')], { [ALPHA]: alphaProfile })
    const json = JSON.parse(
      myDataJson({ address: ADDRESS, did: ISSUER, profile: { documentId: 'p', handle: 'frank', links: [{ id: 'l', label: 'Site', url: 'https://f.example' }] }, connections: grouped, now: NOW }),
    ) as Record<string, unknown>
    expect(json).toMatchObject({
      exportedAt: NOW.toISOString(),
      address: ADDRESS.toLowerCase(),
      did: ISSUER,
      profile: { documentId: 'p', handle: 'frank', displayName: null, links: [{ label: 'Site', url: 'https://f.example' }] },
      approvals: [{ subject: ALPHA, kind: 'app', name: 'Alpha', credentials: [{ credentialId: 'urn:uuid:a1', expired: true }] }],
    })
    expect(myDataFileName(ADDRESS)).toBe(`renown-${ADDRESS.toLowerCase()}.json`)
  })
})

test.describe('revoke', () => {
  // The exact message renown-package subgraphs/renown-auth/core/signed-message.ts verifies.
  test('revokeMessage matches the server format (test vector)', async () => {
    const message = revokeMessage('urn:uuid:1b4e28ba-2d11-4d4d-9f3b-8f1d5c6a7e90', '2026-10-09T12:00:00.000Z')
    expect(message).toBe('Revoke Renown credential urn:uuid:1b4e28ba-2d11-4d4d-9f3b-8f1d5c6a7e90 at 2026-10-09T12:00:00.000Z')
    const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
    expect(account.address).toBe('0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A')
    const signature = await account.signMessage({ message })
    expect(signature).toBe(
      '0xf209d469daeee91c19b378a4365180000fa9caa38dcc210f75520a235532c4212e6b3c2dfcc297632d4ad86f4b710888faca93cc26590ae892dbb93fd05420381b',
    )
    expect(await verifyMessage({ address: account.address, message, signature })).toBe(true)
  })

  function recorder(answers: (RevokeError | null)[]) {
    const sent: RevokeAuth[] = []
    return {
      sent,
      send: async (_id: string, auth: RevokeAuth) => {
        sent.push(auth)
        const answer = answers.shift()
        if (answer) throw answer
      },
    }
  }
  const sign = async (message: string) => `signed:${message}`

  test('uses the bearer when it works, and signs nothing', async () => {
    const r = recorder([null])
    expect(await revokeConnection('urn:uuid:x', { getBearer: async () => 'jwt', signMessage: sign, send: r.send })).toBe('bearer')
    expect(r.sent).toEqual([{ bearer: 'jwt' }])
  })

  test('falls back to a signature without a bearer or when the bearer is refused', async () => {
    for (const getBearer of [async () => null, async () => Promise.reject(new Error('no session')) as Promise<string | null>]) {
      const r = recorder([null])
      expect(await revokeConnection('urn:uuid:x', { getBearer, signMessage: sign, send: r.send, now: () => NOW })).toBe('signature')
      expect(r.sent).toEqual([{ signature: `signed:Revoke Renown credential urn:uuid:x at ${NOW.toISOString()}`, timestamp: NOW.toISOString() }])
    }
    const refused = recorder([new RevokeError('FORBIDDEN'), null])
    expect(await revokeConnection('urn:uuid:x', { getBearer: async () => 'jwt', signMessage: sign, send: refused.send, now: () => NOW })).toBe('signature')
    expect(refused.sent).toHaveLength(2)
  })

  test('does not retry other failures, and reports a missing wallet or a declined signature', async () => {
    const notFound = recorder([new RevokeError('NOT_FOUND')])
    await expect(revokeConnection('x', { getBearer: async () => 'jwt', signMessage: sign, send: notFound.send })).rejects.toMatchObject({ reason: 'NOT_FOUND' })
    expect(notFound.sent).toHaveLength(1)
    await expect(revokeConnection('x', { getBearer: async () => null, signMessage: null, send: recorder([]).send })).rejects.toMatchObject({ reason: 'NO_WALLET' })
    const declined = recorder([])
    await expect(
      revokeConnection('x', { getBearer: async () => null, signMessage: () => Promise.reject(new Error('4001')), send: declined.send }),
    ).rejects.toMatchObject({ reason: 'DECLINED' })
    expect(declined.sent).toEqual([])
    expect(revokeFailureText('FORBIDDEN')).toMatch(/wallet that gave it/)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec playwright test e2e/me-model.spec.ts`
Expected: FAIL — `Cannot find module '../lib/me/completeness'`.

- [ ] **Step 3: Relative time** — `utils/relative-time.ts`:

```ts
// Human dates for /me: "in 6 days" / "3 hours ago" plus an absolute form.

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "in 5 minutes", "3 hours ago", "tomorrow", "in 6 days", "2 months ago", "in 1 year". */
export function formatRelative(iso: string, now: Date): string {
  const diff = Date.parse(iso) - now.getTime()
  const abs = Math.abs(diff)
  if (Number.isNaN(diff)) return ''
  if (abs < 45_000) return 'just now'
  if (abs < HOUR) return RELATIVE.format(Math.round(diff / MINUTE), 'minute')
  if (abs < DAY) return RELATIVE.format(Math.round(diff / HOUR), 'hour')
  if (abs < 30 * DAY) return RELATIVE.format(Math.round(diff / DAY), 'day')
  if (abs < 365 * DAY) return RELATIVE.format(Math.round(diff / (30 * DAY)), 'month')
  return RELATIVE.format(Math.round(diff / (365 * DAY)), 'year')
}

/** "Oct 9, 2026, 2:03 PM" in the viewer's time zone (or `timeZone`). */
export function formatAbsolute(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone })
}
```

- [ ] **Step 4: Grouping, completeness, export**

`lib/me/connections.ts`:

```ts
// The signed-in user's approvals (renownCredentials issued by their address),
// grouped by the app or session they were issued to. Pure.
import type { RenownAppProfile } from '../../services/app-profiles'

/** The renownCredentials fields /me reads. */
export interface IssuedCredential {
  documentId: string
  /** The VC id (urn:uuid:…); what renown_revokeCredential takes. */
  credentialId: string
  issuerId: string
  issuanceDate: string
  expirationDate: string | null
  /** The DID the credential was issued to (app or CLI); null on old credentials. */
  credentialSubjectId: string | null
  /** The name the requesting app gave itself. */
  credentialSubjectApp: string
  revoked: boolean
}

/** One approval as a row. */
export interface Connection {
  credentialId: string
  issuedAt: string
  expiresAt: string | null
}

/** Every approval for one subject DID. */
export interface ConnectionGroup {
  subject: string
  /** app: the subject has a public app profile; session: a CLI or another unlisted client. */
  kind: 'app' | 'session'
  /** Display name: the app profile's name, else the name the client gave itself. */
  name: string
  app: RenownAppProfile | null
  connections: Connection[]
}

export interface GroupedConnections {
  apps: ConnectionGroup[]
  sessions: ConnectionGroup[]
}

/** The DID a credential was issued to (old credentials name only the issuer). */
export function subjectOf(credential: IssuedCredential): string {
  return credential.credentialSubjectId || credential.issuerId
}

/** Subject DIDs that can have an app profile (app identities are did:key), without duplicates. */
export function profileCandidates(credentials: IssuedCredential[]): string[] {
  return [...new Set(credentials.map(subjectOf))].filter((did) => did.startsWith('did:key:'))
}

/** True when `expiresAt` is set and not in the future. */
export function isExpired(expiresAt: string | null, now: Date): boolean {
  return expiresAt !== null && Date.parse(expiresAt) <= now.getTime()
}

/** did:key:z6MkhaXg…Rw3F — short enough for a row, still distinguishable. */
export function shortDid(did: string): string {
  return did.length <= 28 ? did : `${did.slice(0, 16)}…${did.slice(-4)}`
}

/**
 * Groups unrevoked credentials by subject: subjects with an app profile under
 * apps, the rest under sessions. Copies of one VC (several documents, same
 * credentialId) count once; ids in `hidden` (revoked here, read model not yet
 * caught up) are left out. Groups and rows are newest first.
 */
export function groupConnections(
  credentials: IssuedCredential[],
  profiles: Readonly<Record<string, RenownAppProfile | null>>,
  hidden: ReadonlySet<string> = new Set(),
): GroupedConnections {
  const seen = new Set<string>()
  const groups = new Map<string, ConnectionGroup>()
  const sorted = [...credentials].sort((a, b) => Date.parse(b.issuanceDate) - Date.parse(a.issuanceDate))
  for (const credential of sorted) {
    if (credential.revoked || hidden.has(credential.credentialId) || seen.has(credential.credentialId)) continue
    seen.add(credential.credentialId)
    const subject = subjectOf(credential)
    let group = groups.get(subject)
    if (!group) {
      const app = profiles[subject] ?? null
      group = {
        subject,
        kind: app ? 'app' : 'session',
        name: app?.name || credential.credentialSubjectApp || 'Unnamed client',
        app,
        connections: [],
      }
      groups.set(subject, group)
    }
    group.connections.push({
      credentialId: credential.credentialId,
      issuedAt: credential.issuanceDate,
      expiresAt: credential.expirationDate,
    })
  }
  const all = [...groups.values()]
  return { apps: all.filter((g) => g.kind === 'app'), sessions: all.filter((g) => g.kind === 'session') }
}

/** The user's DID: the issuer id their credentials carry, else did:pkh on Ethereum mainnet. */
export function identityDid(address: string, credentials: IssuedCredential[]): string {
  const lower = address.toLowerCase()
  return credentials.find((c) => c.issuerId.toLowerCase().endsWith(`:${lower}`))?.issuerId ?? `did:pkh:eip155:1:${lower}`
}
```

`lib/me/completeness.ts`:

```ts
// How complete a public profile is (avatar, handle, bio, a link). Pure.
import type { RenownProfile } from '../../services/switchboard'

export type CompletenessKey = 'avatar' | 'handle' | 'bio' | 'links'

export interface CompletenessItem {
  key: CompletenessKey
  label: string
  done: boolean
}

export interface Completeness {
  items: CompletenessItem[]
  done: number
  total: number
  /** 0-100, rounded. */
  percent: number
}

export function profileCompleteness(profile: RenownProfile | null): Completeness {
  const items: CompletenessItem[] = [
    { key: 'avatar', label: 'Add a profile picture', done: Boolean(profile?.avatar || profile?.userImage) },
    { key: 'handle', label: 'Claim your handle', done: Boolean(profile?.handle) },
    { key: 'bio', label: 'Write a short bio', done: Boolean(profile?.bio?.trim()) },
    { key: 'links', label: 'Add a link', done: (profile?.links?.length ?? 0) > 0 },
  ]
  const done = items.filter((item) => item.done).length
  return { items, done, total: items.length, percent: Math.round((done / items.length) * 100) }
}
```

`lib/me/export.ts`:

```ts
// "Download my data": the profile and approvals exactly as /me shows them. Pure.
import type { RenownProfile } from '../../services/switchboard'
import { isExpired, type GroupedConnections } from './connections'

export interface MyDataInput {
  address: string
  did: string
  profile: RenownProfile | null
  connections: GroupedConnections
  now: Date
}

/** Pretty-printed JSON of the user's profile fields and approvals. */
export function myDataJson({ address, did, profile, connections, now }: MyDataInput): string {
  const groups = [...connections.apps, ...connections.sessions]
  return JSON.stringify(
    {
      exportedAt: now.toISOString(),
      address: address.toLowerCase(),
      did,
      profile: profile && {
        documentId: profile.documentId,
        displayName: profile.displayName ?? null,
        handle: profile.handle ?? null,
        bio: profile.bio ?? null,
        links: (profile.links ?? []).map(({ label, url }) => ({ label, url })),
        avatar: profile.avatar ?? null,
        userImage: profile.userImage ?? null,
        username: profile.username ?? null,
        createdAt: profile.createdAt ?? null,
        updatedAt: profile.updatedAt ?? null,
      },
      approvals: groups.map((group) => ({
        subject: group.subject,
        kind: group.kind,
        name: group.name,
        credentials: group.connections.map((c) => ({
          credentialId: c.credentialId,
          issuedAt: c.issuedAt,
          expiresAt: c.expiresAt,
          expired: isExpired(c.expiresAt, now),
        })),
      })),
    },
    null,
    2,
  )
}

export function myDataFileName(address: string): string {
  return `renown-${address.toLowerCase()}.json`
}
```

- [ ] **Step 5: Revoke orchestration** — `lib/me/revoke.ts`:

```ts
// Revoking one approval: the Renown bearer first, then the wallet's
// personal_sign of revokeMessage() when there is no bearer or the switchboard
// does not accept it. Pure orchestration; the transport is injected.
import { revokeMessage } from '../../services/renown-signed-messages'

/** How a revoke request proves the issuer address. */
export type RevokeAuth = { bearer: string } | { signature: string; timestamp: string }

export type RevokeFailure = 'FORBIDDEN' | 'NOT_FOUND' | 'NETWORK' | 'DECLINED' | 'NO_WALLET' | 'UNKNOWN'

export class RevokeError extends Error {
  constructor(
    readonly reason: RevokeFailure,
    message: string = reason,
  ) {
    super(message)
    this.name = 'RevokeError'
  }
}

export interface RevokeDeps {
  /** The Renown bearer for the signed-in address; null when there is none. */
  getBearer: () => Promise<string | null>
  /** personal_sign with the wallet of the signed-in address; null without one. */
  signMessage: ((message: string) => Promise<string>) | null
  /** Sends renown_revokeCredential; throws RevokeError. */
  send: (credentialId: string, auth: RevokeAuth) => Promise<void>
  now?: () => Date
}

/** Revokes `credentialId`; resolves with the proof that worked, rejects with RevokeError. */
export async function revokeConnection(credentialId: string, deps: RevokeDeps): Promise<'bearer' | 'signature'> {
  const bearer = await deps.getBearer().catch(() => null)
  if (bearer) {
    try {
      await deps.send(credentialId, { bearer })
      return 'bearer'
    } catch (error) {
      // Only an authorisation refusal is worth a second try with a signature.
      if (!(error instanceof RevokeError) || error.reason !== 'FORBIDDEN') throw error
    }
  }
  if (!deps.signMessage) throw new RevokeError('NO_WALLET')
  const timestamp = (deps.now ?? (() => new Date()))().toISOString()
  let signature: string
  try {
    signature = await deps.signMessage(revokeMessage(credentialId, timestamp))
  } catch {
    throw new RevokeError('DECLINED')
  }
  await deps.send(credentialId, { signature, timestamp })
  return 'signature'
}

/** What went wrong, in plain words, for the error toast. */
export function revokeFailureText(reason: RevokeFailure): string {
  switch (reason) {
    case 'FORBIDDEN':
      return 'Renown could not confirm the approval is yours. Sign in with the wallet that gave it and try again.'
    case 'NOT_FOUND':
      return 'Renown has no record of this approval any more.'
    case 'NETWORK':
      return 'Renown did not respond. Check your connection and try again.'
    case 'DECLINED':
      return 'You declined the signature, so nothing was revoked.'
    case 'NO_WALLET':
      return 'Connect the wallet that gave this approval, then try again.'
    default:
      return 'Something went wrong on our side. Try again in a moment.'
  }
}
```

- [ ] **Step 6: Browser transport.** Export the app-profile field list (`services/app-profiles.ts`; rename every `${FIELDS}` use to `${APP_PROFILE_FIELDS}`):

```diff
-const FIELDS = `appDid documentId name tagline logo website publisherDid description category logoRef coverRef links { id label url }`
+export const APP_PROFILE_FIELDS = `appDid documentId name tagline logo website publisherDid description category logoRef coverRef links { id label url }`
```

```bash
sed -i 's/\${FIELDS}/${APP_PROFILE_FIELDS}/g' services/app-profiles.ts && grep -c 'APP_PROFILE_FIELDS' services/app-profiles.ts
```

Expected: `4`.

`services/renown-connections.ts`:

```ts
// Browser-side reads and the revoke write behind /me. Reads are public; the
// revoke proves the issuer with a Renown bearer or a personal_sign (see
// lib/me/revoke.ts), sent straight to the switchboard's renown-auth subgraph.
import { ClientError, GraphQLClient } from 'graphql-request'
import type { IssuedCredential } from '../lib/me/connections'
import { RevokeError, type RevokeAuth } from '../lib/me/revoke'
import { APP_PROFILE_FIELDS, type RenownAppProfile } from './app-profiles'
import { switchboardOrigin } from './media'
import { SWITCHBOARD_ENDPOINT } from './switchboard-endpoint'

const ISSUED_CREDENTIALS = `
  query IssuedCredentials($input: RenownCredentialsInput!) {
    renownCredentials(input: $input) {
      documentId
      credentialId
      issuerId
      issuanceDate
      expirationDate
      credentialSubjectId
      credentialSubjectApp
      revoked
    }
  }
`

const REVOKE = `
  mutation RevokeCredential($credentialId: String!, $signature: String, $timestamp: String) {
    renown_revokeCredential(credentialId: $credentialId, signature: $signature, timestamp: $timestamp)
  }
`

/** App profiles are looked up this many per request (one aliased query each). */
const PROFILE_BATCH = 25

/**
 * Unrevoked credentials issued by `address`. Filters on the issuer only: the
 * read model's `ethAddress` filter also requires the proof address to match.
 * A failed read throws.
 */
export async function fetchIssuedCredentials(address: string): Promise<IssuedCredential[]> {
  const data = await new GraphQLClient(SWITCHBOARD_ENDPOINT).request<{ renownCredentials: IssuedCredential[] }>(
    ISSUED_CREDENTIALS,
    { input: { issuer: address.toLowerCase(), includeRevoked: false } },
  )
  return data.renownCredentials
}

/**
 * The app profile of each DID (null when it has none), in aliased batches.
 * A failed batch throws.
 */
export async function fetchAppProfilesFor(dids: string[]): Promise<Record<string, RenownAppProfile | null>> {
  const client = new GraphQLClient(`${switchboardOrigin()}/graphql/renown-stats`)
  const result: Record<string, RenownAppProfile | null> = {}
  for (let start = 0; start < dids.length; start += PROFILE_BATCH) {
    const batch = dids.slice(start, start + PROFILE_BATCH)
    const params = batch.map((_, i) => `$d${i}: String!`).join(', ')
    const fields = batch.map((_, i) => `p${i}: appProfile(appDid: $d${i}) { ${APP_PROFILE_FIELDS} }`).join(' ')
    const variables = Object.fromEntries(batch.map((did, i) => [`d${i}`, did]))
    const data = await client.request<Record<string, RenownAppProfile | null>>(
      `query SubjectAppProfiles(${params}) { ${fields} }`,
      variables,
    )
    batch.forEach((did, i) => (result[did] = data[`p${i}`] ?? null))
  }
  return result
}

function toRevokeError(error: unknown): RevokeError {
  if (error instanceof ClientError) {
    if (error.response.status === 401 || error.response.status === 403) return new RevokeError('FORBIDDEN')
    const [first] = error.response.errors ?? []
    const code = typeof first?.extensions?.['code'] === 'string' ? first.extensions['code'] : undefined
    if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') return new RevokeError('FORBIDDEN', first?.message)
    if (code === 'NOT_FOUND') return new RevokeError('NOT_FOUND', first?.message)
    return new RevokeError('UNKNOWN', first?.message ?? `HTTP ${error.response.status}`)
  }
  return new RevokeError('NETWORK', error instanceof Error ? error.message : String(error))
}

/** renown_revokeCredential with a bearer (Authorization header) or a signature; throws RevokeError. */
export async function sendRevoke(credentialId: string, auth: RevokeAuth): Promise<void> {
  const client = new GraphQLClient(SWITCHBOARD_ENDPOINT, {
    headers: 'bearer' in auth ? { Authorization: `Bearer ${auth.bearer}` } : {},
  })
  let revoked: boolean | null
  try {
    const data = await client.request<{ renown_revokeCredential: boolean | null }>(REVOKE, {
      credentialId,
      ...('bearer' in auth ? {} : { signature: auth.signature, timestamp: auth.timestamp }),
    })
    revoked = data.renown_revokeCredential
  } catch (error) {
    throw toRevokeError(error)
  }
  if (!revoked) throw new RevokeError('UNKNOWN', 'The switchboard did not confirm the revocation')
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm exec playwright test e2e/me-model.spec.ts`
Expected: 9 passed.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add utils/relative-time.ts lib/me services/renown-connections.ts services/app-profiles.ts e2e/me-model.spec.ts
git commit -m "feat(me): approval grouping, completeness, export and revoke with signature fallback"
```

---

## Task 4: `/me` — Your Renown

**Files:**
- Create: `components/site/toast.tsx`, `components/me/use-me-session.ts`, `components/me/use-connections.ts`, `components/me/copy-field.tsx`, `components/me/identity-card.tsx`, `components/me/completeness-checklist.tsx`, `components/me/connection-list.tsx`, `components/me/revoke-dialog.tsx`, `components/me/me-dashboard.tsx`, `pages/me.tsx`, `e2e/support/test-session.ts`
- Modify: `styles/globals.css` (danger tokens)
- Test: `e2e/me.spec.ts`

**Interfaces:**
- Consumes: Task 3 (all of it), Phase A `SiteLayout`, `PageMeta`, primitives, `shortAddress`, `ProfileAvatar`, `AppLogo`, `useOwnProfile`, `profilePath`, `useSession`/`useAuthInitializing` (`hooks/use-wallet-adapter.ts`), `useRenownAuth`/`useRenown`, `installInjectedWallet`, `STUB_SWITCHBOARD_URL`.
- Produces: route `/me`; `MeSession`/`useMeSession`; `useConnections(address, { getBearer, signMessage })`; `useToasts`/`ToastRegion`/`Toast`; `RevokeDialog`/`RevokeTarget`; `signInTestWallet(page, { bearer? })`; tokens `--danger`, `--danger-ink`.

- [ ] **Step 1: The e2e session helper** — `e2e/support/test-session.ts` (the injected wallet connects on the sign-in screen; no credential is issued and nothing touches the shared stub):

```ts
// A signed-in visitor for /me under NEXT_PUBLIC_E2E_AUTH=1: the injected test
// wallet connects on the sign-in screen (no credential is issued), and the
// wallet session then stands in for the Renown session (components/me/use-me-session.ts).
import { expect, type Page } from '@playwright/test'
import { installInjectedWallet, type InjectedWallet } from './injected-wallet'

export async function signInTestWallet(page: Page, options: { bearer?: string } = {}): Promise<InjectedWallet> {
  // Nothing leaves localhost (ENS, wallet relays).
  await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort())
  if (options.bearer) {
    await page.addInitScript((bearer) => {
      ;(window as { __renownE2eBearer?: string }).__renownE2eBearer = bearer
    }, options.bearer)
  }
  const wallet = await installInjectedWallet(page)
  await page.goto('/?app=did:web:me.example')
  await expect(page.getByRole('button', { name: 'Confirm Authorization' })).toBeVisible({ timeout: 30_000 })
  return wallet
}
```

- [ ] **Step 2: Write the failing test** — `e2e/me.spec.ts`:

```ts
import { test, expect, type Page, type Route } from '@playwright/test'
import { verifyMessage } from 'viem'
import { revokeMessage } from '../services/renown-signed-messages'
import { attachScreenshots, expectNoSeriousA11yViolations, useTheme } from './support/site'
import { STUB_SWITCHBOARD_URL } from './support/stub-switchboard-client'
import { signInTestWallet } from './support/test-session'

// /me reads and revokes from the browser, so each test answers the switchboard
// itself (page.route): parallel-safe, no shared stub state.
const DAY = 86_400_000
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString()
const ALPHA = `did:key:z6MkMeAlpha${'a'.repeat(36)}`
const BETA = `did:key:z6MkMeBeta${'b'.repeat(37)}`
const CLI = `did:key:z6MkMeCli${'c'.repeat(38)}`

interface Revoke {
  variables: Record<string, unknown>
  authorization: string | undefined
}
type RevokeAnswer = { status?: number; json: unknown } | 'abort'

interface MockSwitchboard {
  revokes: Revoke[]
  credentialReads: () => number
  /** Answers the next revokes (default: success). */
  answers: RevokeAnswer[]
  /** While set, revoke answers wait for it (to observe the optimistic state). */
  hold: Promise<void> | null
  failCredentialReads: boolean
}

const appProfile = (did: string, name: string) => ({
  appDid: did,
  documentId: `doc-${name}`,
  name,
  tagline: null,
  logo: null,
  website: null,
  publisherDid: null,
  description: null,
  category: null,
  logoRef: null,
  coverRef: null,
  links: [],
})

async function mockSwitchboard(page: Page, address: string): Promise<MockSwitchboard> {
  const issuerId = `did:pkh:eip155:1:${address.toLowerCase()}`
  const credential = (id: string, subject: string, app: string, issued: number, expires: number | null, documentId = `doc-${id}`) => ({
    documentId,
    credentialId: `urn:uuid:${id}`,
    issuerId,
    issuanceDate: iso(issued),
    expirationDate: expires === null ? null : iso(expires),
    credentialSubjectId: subject,
    credentialSubjectApp: app,
    revoked: false,
  })
  // The read model lags: a revoked credential is still listed on the next read.
  const credentials = [
    credential('alpha-new', ALPHA, 'alpha', -2, 5),
    credential('alpha-new', ALPHA, 'alpha', -2, 5, 'doc-alpha-new-copy'),
    credential('alpha-old', ALPHA, 'alpha', -20, -13),
    credential('beta', BETA, 'beta', -1, 6),
    credential('cli', CLI, 'ph-cli', -3, 27),
  ]
  const profiles: Record<string, unknown> = { [ALPHA]: appProfile(ALPHA, 'Alpha Notes'), [BETA]: appProfile(BETA, 'Beta Board') }
  let reads = 0
  const mock: MockSwitchboard = { revokes: [], credentialReads: () => reads, answers: [], hold: null, failCredentialReads: false }

  await page.route(`${STUB_SWITCHBOARD_URL}/graphql**`, async (route: Route) => {
    const request = route.request()
    const { query, variables } = request.postDataJSON() as { query: string; variables: Record<string, unknown> }
    if (query.includes('renownCredentials')) {
      reads++
      if (mock.failCredentialReads) return route.fulfill({ status: 500, body: 'boom' })
      return route.fulfill({ json: { data: { renownCredentials: credentials } } })
    }
    if (query.includes('SubjectAppProfiles')) {
      const data = Object.fromEntries(Object.entries(variables).map(([key, did]) => [`p${key.slice(1)}`, profiles[String(did)] ?? null]))
      return route.fulfill({ json: { data } })
    }
    if (query.includes('renownUsers')) {
      return route.fulfill({
        json: {
          data: {
            renownUsers: [
              { documentId: 'doc-me', ethAddress: address.toLowerCase(), username: null, userImage: null, displayName: 'Edie Example', handle: 'edie', bio: null, links: [], avatar: null, createdAt: null, updatedAt: null },
            ],
          },
        },
      })
    }
    if (query.includes('renown_revokeCredential')) {
      mock.revokes.push({ variables, authorization: request.headers()['authorization'] })
      if (mock.hold) await mock.hold
      const answer = mock.answers.shift() ?? { json: { data: { renown_revokeCredential: true } } }
      if (answer === 'abort') return route.abort()
      return route.fulfill({ status: answer.status ?? 200, json: answer.json })
    }
    return route.continue()
  })
  return mock
}

const forbidden = { json: { data: null, errors: [{ message: 'Forbidden', extensions: { code: 'FORBIDDEN' } }] } }

async function openMe(page: Page, options: { bearer?: string } = {}) {
  const wallet = await signInTestWallet(page, options)
  const mock = await mockSwitchboard(page, wallet.address)
  await page.goto('/me')
  await expect(page.getByRole('heading', { level: 2, name: 'Connected apps' })).toBeVisible({ timeout: 30_000 })
  return { wallet, mock }
}

const apps = (page: Page) => page.getByRole('region', { name: 'Connected apps' })
const sessions = (page: Page) => page.getByRole('region', { name: 'CLI & other sessions' })
const toast = (page: Page, text: string) => page.getByRole('main').locator('[role=alert],[role=status]').filter({ hasText: text })

test.beforeEach(() => {
  test.setTimeout(120_000)
})

test('signed out: a sign-in panel, no data', async ({ page }) => {
  await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort())
  await page.goto('/me')
  await expect(page.getByRole('heading', { level: 1, name: 'Your Renown' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('main').getByRole('button', { name: 'Sign in' })).toBeVisible()
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
  await expect(page).toHaveTitle('Your Renown - Renown')
})

test('lists approvals grouped by app, with sessions apart and expiry shown', async ({ page }) => {
  const { wallet } = await openMe(page)

  // Identity card and completeness.
  await expect(page.getByRole('heading', { level: 2, name: 'Edie Example' })).toBeVisible()
  await expect(page.getByText('@edie')).toBeVisible()
  await expect(page.getByText(`did:pkh:eip155:1:${wallet.address.toLowerCase()}`)).toBeVisible()
  await expect(page.getByRole('link', { name: 'View public profile' })).toHaveAttribute('href', '/@edie')
  await expect(page.getByRole('main').getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/profile/edit')
  await expect(page.getByText('1 of 4 done')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Write a short bio' })).toHaveAttribute('href', '/profile/edit')

  // Apps: Alpha (two approvals, the copy counted once, one expired), Beta.
  await expect(apps(page).getByRole('heading', { level: 3 })).toHaveText(['Beta Board', 'Alpha Notes'])
  await expect(apps(page).getByRole('link', { name: 'Alpha Notes' })).toHaveAttribute('href', `/app/${ALPHA}`)
  const alpha = apps(page).getByRole('list', { name: 'Alpha Notes approvals' })
  await expect(alpha.getByRole('listitem')).toHaveCount(2)
  await expect(alpha.getByRole('listitem').nth(0)).toContainText('2 days ago')
  await expect(alpha.getByRole('listitem').nth(0)).toContainText('in 5 days')
  await expect(alpha.getByRole('listitem').nth(1)).toContainText('Expired')
  await expect(alpha.getByRole('listitem').nth(1)).toContainText('13 days ago')

  // Sessions: the CLI, by the name it gave itself and its short DID.
  await expect(sessions(page).getByRole('heading', { level: 3 })).toHaveText(['ph-cli'])
  await expect(sessions(page).getByText('did:key:z6MkMeCl…cccc')).toBeVisible()
})

test('revoke with the bearer: confirm, the row goes at once, a toast, a refetch', async ({ page }) => {
  const { wallet, mock } = await openMe(page, { bearer: 'e2e-bearer' })
  const readsBefore = mock.credentialReads()
  let release!: () => void
  mock.hold = new Promise((resolve) => (release = resolve))

  const revokeButton = apps(page).getByRole('button', { name: /^Revoke Beta Board/ })
  await revokeButton.click()
  const dialog = page.getByRole('dialog', { name: 'Revoke Beta Board?' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Beta Board will no longer be able to act for you.')
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Revoke' }).click()

  // Optimistic: gone before the switchboard answers.
  await expect(dialog).toBeHidden()
  await expect(apps(page).getByRole('heading', { name: 'Beta Board' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Connected apps' })).toBeFocused()
  release()

  await expect(toast(page, 'Revoked. Beta Board can no longer act for you.')).toBeVisible()
  expect(mock.revokes).toEqual([{ variables: { credentialId: 'urn:uuid:beta' }, authorization: 'Bearer e2e-bearer' }])
  expect(wallet.personalSignRequests).toEqual([])
  await expect.poll(() => mock.credentialReads()).toBeGreaterThan(readsBefore)
  // The lagging read model still lists it; it stays gone.
  await page.waitForTimeout(500)
  await expect(apps(page).getByRole('heading', { name: 'Beta Board' })).toHaveCount(0)
})

test('without a bearer, revoke signs the exact revoke message with the wallet', async ({ page }) => {
  const { wallet, mock } = await openMe(page)
  await sessions(page).getByRole('button', { name: /^Revoke ph-cli/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(toast(page, 'Revoked. ph-cli can no longer act for you.')).toBeVisible()

  expect(mock.revokes).toHaveLength(1)
  const { variables, authorization } = mock.revokes[0]
  expect(authorization).toBeUndefined()
  const { credentialId, signature, timestamp } = variables as { credentialId: string; signature: `0x${string}`; timestamp: string }
  expect(credentialId).toBe('urn:uuid:cli')
  expect(wallet.personalSignRequests).toEqual([revokeMessage(credentialId, timestamp)])
  expect(Math.abs(Date.parse(timestamp) - Date.now())).toBeLessThan(60_000)
  expect(await verifyMessage({ address: wallet.address, message: revokeMessage(credentialId, timestamp), signature })).toBe(true)
})

test('a refused bearer falls back to the wallet signature', async ({ page }) => {
  const { wallet, mock } = await openMe(page, { bearer: 'stale-bearer' })
  mock.answers.push(forbidden)
  await apps(page).getByRole('button', { name: /^Revoke Beta Board/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(toast(page, 'Revoked. Beta Board can no longer act for you.')).toBeVisible()
  expect(mock.revokes.map((r) => [r.authorization, 'signature' in r.variables])).toEqual([
    ['Bearer stale-bearer', false],
    [undefined, true],
  ])
  expect(wallet.personalSignRequests).toHaveLength(1)
})

test('a failed revoke puts the row back and explains why', async ({ page }) => {
  const { mock } = await openMe(page)
  mock.answers.push(forbidden)
  await apps(page).getByRole('button', { name: /^Revoke Beta Board/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(toast(page, 'Beta Board was not revoked. Renown could not confirm the approval is yours.')).toBeVisible()
  await expect(apps(page).getByRole('heading', { name: 'Beta Board' })).toBeVisible()

  mock.answers.push('abort')
  await apps(page).getByRole('button', { name: /^Revoke Beta Board/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(toast(page, 'Renown did not respond. Check your connection and try again.')).toBeVisible()
  await expect(apps(page).getByRole('heading', { name: 'Beta Board' })).toBeVisible()
})

test('a declined signature revokes nothing', async ({ page }) => {
  const { wallet, mock } = await openMe(page)
  wallet.declinePersonalSign = true
  await apps(page).getByRole('button', { name: /^Revoke Beta Board/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke' }).click()
  await expect(toast(page, 'You declined the signature, so nothing was revoked.')).toBeVisible()
  await expect(apps(page).getByRole('heading', { name: 'Beta Board' })).toBeVisible()
  expect(mock.revokes).toEqual([])
})

test('Escape cancels the dialog and returns focus to Revoke', async ({ page }) => {
  const { mock } = await openMe(page)
  const revokeButton = apps(page).getByRole('button', { name: /^Revoke Beta Board/ })
  await revokeButton.click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(revokeButton).toBeFocused()
  expect(mock.revokes).toEqual([])
})

test('a failed list shows Try again, which recovers', async ({ page }) => {
  const wallet = await signInTestWallet(page)
  const mock = await mockSwitchboard(page, wallet.address)
  mock.failCredentialReads = true
  await page.goto('/me')
  await expect(page.getByRole('main').getByRole('alert')).toContainText('Your approvals did not load', { timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Download my data' })).toBeDisabled()
  mock.failCredentialReads = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(apps(page).getByRole('heading', { level: 3 })).toHaveCount(2)
})

test('Download my data saves the profile and the approvals as JSON', async ({ page }) => {
  const { wallet } = await openMe(page)
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()])
  expect(file.suggestedFilename()).toBe(`renown-${wallet.address.toLowerCase()}.json`)
  const data = JSON.parse(await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'))) as {
    address: string
    profile: { handle: string }
    approvals: { name: string; kind: string; credentials: { credentialId: string; expired: boolean }[] }[]
  }
  expect(data.address).toBe(wallet.address.toLowerCase())
  expect(data.profile.handle).toBe('edie')
  expect(data.approvals.map((a) => [a.name, a.kind, a.credentials.map((c) => [c.credentialId, c.expired])])).toEqual([
    ['Beta Board', 'app', [['urn:uuid:beta', false]]],
    ['Alpha Notes', 'app', [['urn:uuid:alpha-new', false], ['urn:uuid:alpha-old', true]]],
    ['ph-cli', 'session', [['urn:uuid:cli', false]]],
  ])
})

for (const theme of ['light', 'dark'] as const) {
  test(`has no serious axe violations, signed in and with the dialog open (${theme})`, async ({ page }, testInfo) => {
    await useTheme(page, theme)
    await openMe(page)
    await expectNoSeriousA11yViolations(page)
    await attachScreenshots(page, testInfo, `me-${theme}`)
    await page.setViewportSize({ width: 1280, height: 900 })
    await apps(page).getByRole('button', { name: /^Revoke Beta Board/ }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expectNoSeriousA11yViolations(page)
    await testInfo.attach(`me-dialog-${theme}.png`, { body: await page.screenshot(), contentType: 'image/png' })
  })
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec playwright test e2e/me.spec.ts --workers=3`
Expected: FAIL — `/me` is a 404 (no "Your Renown" heading).

- [ ] **Step 4: Danger tokens** (`styles/globals.css`): add to `:root`, `.dark` and `@theme inline`:

```diff
 :root {
     …
     --code-bg: #F6F8FB;
+    --danger: #C42B1C;
+    --danger-ink: #B42318;
 }
 .dark {
     …
     --code-bg: #0A1226;
+    --danger: #C42B1C;
+    --danger-ink: #FF8F80;
 }
 @theme inline {
     …
     --color-code: var(--code-bg);
+    --color-danger: var(--danger);
+    --color-danger-ink: var(--danger-ink);
```

- [ ] **Step 5: Toast** — `components/site/toast.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { cx } from '../../utils/cx'

export interface Toast {
  id: number
  tone: 'success' | 'error'
  text: string
}

const LIFETIME_MS = { success: 5000, error: 9000 }

/** A small queue of toasts; each one dismisses itself after a few seconds. */
export function useToasts(): { toasts: Toast[]; show: (tone: Toast['tone'], text: string) => void; dismiss: (id: number) => void } {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const show = useCallback(
    (tone: Toast['tone'], text: string) => {
      const id = nextId.current++
      setToasts((list) => [...list.slice(-2), { id, tone, text }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), LIFETIME_MS[tone]),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  return { toasts, show, dismiss }
}

/**
 * Where toasts appear (bottom centre). The polite live region is always in the
 * page so screen readers hear success messages; errors are role="alert".
 */
export function ToastRegion({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 md:bottom-6"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role={toast.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            'shadow-card rounded-panel pointer-events-auto flex w-full max-w-md items-start gap-3 border px-4 py-3 text-sm',
            'bg-background text-ink',
            toast.tone === 'error' ? 'border-danger/50' : 'border-signal/40',
          )}
        >
          <span
            aria-hidden="true"
            className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', toast.tone === 'error' ? 'bg-danger' : 'bg-signal')}
          />
          <p className="flex-1 leading-6">{toast.text}</p>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="text-ink-muted hover:text-ink -mr-1 rounded px-1 text-sm font-medium"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Session and data hooks**

`components/me/use-me-session.ts`:

```ts
import { useRenown, useRenownAuth } from '@powerhousedao/reactor-browser/renown'
import { useCallback } from 'react'
import { useAuthInitializing, useSession } from '../../hooks/use-wallet-adapter'

/** Who /me is for, and how that person can prove it for a revoke. */
export type MeSession =
  | { state: 'loading' }
  | { state: 'signed-out'; login: () => void }
  | {
      state: 'signed-in'
      address: string
      /** The Renown bearer for `address`; null when it cannot be had. */
      getBearer: () => Promise<string | null>
      /** personal_sign by the connected wallet when it is `address`; null otherwise. */
      signMessage: ((message: string) => Promise<string>) | null
    }

// Playwright runs the dev server with NEXT_PUBLIC_E2E_AUTH=1: the wallet
// session from the test wallet then stands in for the Renown session, and the
// bearer comes from window.__renownE2eBearer (absent = no bearer). Inert in
// every other build.
const E2E_AUTH = process.env.NEXT_PUBLIC_E2E_AUTH === '1'
function e2eBearer(): string | null {
  if (!E2E_AUTH || typeof window === 'undefined') return null
  return (window as { __renownE2eBearer?: string }).__renownE2eBearer ?? null
}

export function useMeSession(): MeSession {
  const renownAuth = useRenownAuth()
  const renown = useRenown()
  const wallet = useSession()
  const walletInitializing = useAuthInitializing()

  const getBearer = useCallback(async (): Promise<string | null> => {
    if (E2E_AUTH) return e2eBearer()
    if (!renown?.user) return null
    try {
      return await renown.getBearerToken({ expiresIn: 600 })
    } catch (error) {
      console.warn('Renown bearer unavailable:', error)
      return null
    }
  }, [renown])

  const status = renownAuth.status
  const renownAddress = renownAuth.user?.address
  const address = renownAddress ?? (E2E_AUTH ? wallet?.address : undefined)
  if (!address) {
    if (status === undefined || status === 'loading' || status === 'checking' || (E2E_AUTH && walletInitializing)) {
      return { state: 'loading' }
    }
    return { state: 'signed-out', login: () => renownAuth.login() }
  }
  const signer = wallet && wallet.address.toLowerCase() === address.toLowerCase() ? wallet.signer : null
  return {
    state: 'signed-in',
    address,
    getBearer,
    signMessage: signer ? (message) => signer.signMessage(message) : null,
  }
}
```

`components/me/use-connections.ts`:

```ts
import { useCallback, useEffect, useMemo, useState } from 'react'
import { groupConnections, profileCandidates, type GroupedConnections, type IssuedCredential } from '../../lib/me/connections'
import { RevokeError, revokeConnection, type RevokeDeps, type RevokeFailure } from '../../lib/me/revoke'
import type { RenownAppProfile } from '../../services/app-profiles'
import { fetchAppProfilesFor, fetchIssuedCredentials, sendRevoke } from '../../services/renown-connections'

interface Snapshot {
  address: string
  credentials: IssuedCredential[]
  profiles: Record<string, RenownAppProfile | null>
}

export interface Connections {
  status: 'loading' | 'ready' | 'error'
  credentials: IssuedCredential[]
  grouped: GroupedConnections
  /** Reloads after a failed read. */
  retry: () => void
  /** Revokes optimistically: the row disappears at once and comes back if the revoke fails. */
  revoke: (credentialId: string) => Promise<{ ok: true } | { ok: false; reason: RevokeFailure }>
}

async function load(address: string): Promise<Snapshot> {
  const credentials = await fetchIssuedCredentials(address)
  // Without app profiles every subject still lists, as a session: degrade, don't fail.
  const profiles = await fetchAppProfilesFor(profileCandidates(credentials)).catch((error: unknown) => {
    console.warn('App profiles for /me unavailable:', error)
    return {}
  })
  return { address, credentials, profiles }
}

/** The approvals `address` has issued, with optimistic revoke and a refetch after each one. */
export function useConnections(address: string, auth: Pick<RevokeDeps, 'getBearer' | 'signMessage'>): Connections {
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState<(Snapshot & { attempt: number }) | null>(null)
  const [failedAttempt, setFailedAttempt] = useState<number | null>(null)
  // Revoked here or being revoked: hidden even if a refetch still lists them (the read model can lag).
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    load(address)
      .then((next) => {
        if (!cancelled) setSnapshot({ ...next, attempt })
      })
      .catch((error: unknown) => {
        console.warn('Approvals unavailable:', error)
        if (!cancelled) setFailedAttempt(attempt)
      })
    return () => {
      cancelled = true
    }
  }, [address, attempt])

  const current = snapshot && snapshot.address === address ? snapshot : null
  const status: Connections['status'] =
    current && current.attempt === attempt ? 'ready' : failedAttempt === attempt ? 'error' : 'loading'

  const grouped = useMemo(
    () => groupConnections(current?.credentials ?? [], current?.profiles ?? {}, hidden),
    [current, hidden],
  )

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  // Refetch quietly: the list stays on screen (revoked rows stay hidden).
  const refresh = useCallback(() => {
    load(address)
      .then((next) => setSnapshot((prev) => (prev && prev.address === address ? { ...next, attempt: prev.attempt } : prev)))
      .catch((error: unknown) => console.warn('Approvals refetch failed:', error))
  }, [address])

  const { getBearer, signMessage } = auth
  const revoke = useCallback(
    async (credentialId: string): Promise<{ ok: true } | { ok: false; reason: RevokeFailure }> => {
      setHidden((set) => new Set(set).add(credentialId))
      try {
        await revokeConnection(credentialId, { getBearer, signMessage, send: sendRevoke })
      } catch (error) {
        setHidden((set) => {
          const next = new Set(set)
          next.delete(credentialId)
          return next
        })
        const reason = error instanceof RevokeError ? error.reason : 'UNKNOWN'
        if (reason === 'NOT_FOUND') refresh()
        return { ok: false, reason }
      }
      refresh()
      return { ok: true }
    },
    [getBearer, signMessage, refresh],
  )

  return { status, credentials: current?.credentials ?? [], grouped, retry, revoke }
}
```

- [ ] **Step 7: Identity card, ring and checklist**

`components/me/copy-field.tsx`:

```tsx
import { useEffect, useState } from 'react'

/** A labelled value (DID, address) with a copy button that confirms in a live region. */
export function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="border-hairline flex items-center gap-3 border-t py-3 first:border-t-0">
      <div className="min-w-0 flex-1">
        <p className="text-ink-muted text-xs">{label}</p>
        <p className="text-ink truncate font-mono text-[13px]" title={value}>
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className="text-primary-ink hover:bg-surface-2 shrink-0 rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
      >
        Copy<span className="sr-only"> {label.toLowerCase()}</span>
      </button>
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ''}
      </span>
    </div>
  )
}
```

`components/me/identity-card.tsx` (design intent: the one bold element on `/me` is the completeness ring around the avatar — the identity itself is the picture; everything else is quiet hairline structure):

```tsx
import type { ReactNode } from 'react'
import type { Completeness } from '../../lib/me/completeness'
import type { RenownProfile } from '../../services/switchboard'
import { profilePath } from '../../utils/profile-url'
import { shortAddress } from '../site/account-links'
import { ButtonLink } from '../site/primitives'
import { ProfileAvatar } from '../profile/profile-avatar'
import { CopyField } from './copy-field'

const RING = { size: 132, stroke: 4 }

/**
 * The avatar inside a ring that fills as the profile is completed: the one
 * place on /me where the identity itself is the picture.
 */
function CompletenessRing({ percent, children }: { percent: number; children: ReactNode }) {
  const r = (RING.size - RING.stroke) / 2
  return (
    <div className="relative grid h-[132px] w-[132px] shrink-0 place-items-center">
      <svg aria-hidden="true" viewBox={`0 0 ${RING.size} ${RING.size}`} className="absolute inset-0 -rotate-90">
        <defs>
          <linearGradient id="me-ring" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: 'var(--grad-from)' }} />
            <stop offset="1" style={{ stopColor: 'var(--grad-to)' }} />
          </linearGradient>
        </defs>
        <circle cx={RING.size / 2} cy={RING.size / 2} r={r} fill="none" strokeWidth={RING.stroke} style={{ stroke: 'var(--hairline-strong)' }} />
        {percent > 0 && (
          <circle
            cx={RING.size / 2}
            cy={RING.size / 2}
            r={r}
            fill="none"
            stroke="url(#me-ring)"
            strokeWidth={RING.stroke}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${percent} 100`}
            className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-700"
          />
        )}
      </svg>
      {children}
    </div>
  )
}

export function IdentityCard({
  address,
  did,
  profile,
  completeness,
}: {
  address: string
  did: string
  profile: RenownProfile | null
  completeness: Completeness
}) {
  const name = profile?.displayName || profile?.username || shortAddress(address)
  const publicHref = profile ? profilePath(profile) : `/profile/${address}`
  return (
    <section aria-labelledby="identity-name" className="border-hairline bg-surface-1 shadow-card rounded-panel border p-6">
      <div className="flex items-center gap-5">
        <CompletenessRing percent={completeness.percent}>
          <ProfileAvatar
            documentId={profile?.documentId}
            avatar={profile?.avatar}
            userImage={profile?.userImage}
            seed={address.toLowerCase()}
            alt=""
            className="h-[108px] w-[108px]"
          />
        </CompletenessRing>
        <div className="min-w-0">
          <h2 id="identity-name" className="text-ink text-h3 truncate">
            {name}
          </h2>
          <p className="text-ink-muted mt-1 truncate text-sm">{profile?.handle ? `@${profile.handle}` : 'No handle yet'}</p>
        </div>
      </div>
      <div className="mt-6">
        <CopyField label="DID" value={did} />
        <CopyField label="Address" value={address} />
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <ButtonLink href={publicHref} variant="secondary">
          View public profile
        </ButtonLink>
        <ButtonLink href="/profile/edit" variant="ghost">
          Edit profile
        </ButtonLink>
      </div>
    </section>
  )
}
```

`components/me/completeness-checklist.tsx`:

```tsx
import Link from 'next/link'
import type { Completeness } from '../../lib/me/completeness'
import { cx } from '../../utils/cx'

/** What is left to complete the public profile, each open item linking to the editor. */
export function CompletenessChecklist({ completeness }: { completeness: Completeness }) {
  const complete = completeness.done === completeness.total
  return (
    <section aria-labelledby="completeness-title" className="border-hairline rounded-panel border p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="completeness-title" className="text-ink text-base font-semibold">
          Your public profile
        </h2>
        <p className="text-ink-muted text-sm tabular-nums">
          {completeness.done} of {completeness.total} done
        </p>
      </div>
      {complete ? (
        <p className="text-ink-muted mt-3 text-sm leading-6">Your profile is complete. People see a name, a face and where to find you.</p>
      ) : (
        <ul className="mt-4 space-y-1">
          {completeness.items.map((item) => (
            <li key={item.key}>
              {item.done ? (
                <span className="text-ink-muted flex items-center gap-3 py-1.5 text-sm">
                  <Check done />
                  <span className="line-through decoration-1">{item.label}</span>
                  <span className="sr-only">(done)</span>
                </span>
              ) : (
                <Link
                  href="/profile/edit"
                  className="text-ink hover:text-primary-ink flex items-center gap-3 py-1.5 text-sm font-medium transition-colors"
                >
                  <Check done={false} />
                  {item.label}
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Check({ done }: { done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid h-5 w-5 shrink-0 place-items-center rounded-full border',
        done ? 'bg-signal/15 border-signal/40 text-signal' : 'border-hairline-strong',
      )}
    >
      {done && (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12l5 5L20 7" />
        </svg>
      )}
    </span>
  )
}
```

- [ ] **Step 8: Approvals list and confirm dialog**

`components/me/connection-list.tsx`:

```tsx
import Link from 'next/link'
import { isExpired, shortDid, type Connection, type ConnectionGroup } from '../../lib/me/connections'
import { formatAbsolute, formatRelative } from '../../utils/relative-time'
import { AppLogo } from '../app/app-logo'
import { Badge } from '../site/primitives'

function When({ iso, now }: { iso: string; now: Date }) {
  return (
    <time dateTime={iso}>
      {formatRelative(iso, now)}
      <span className="text-ink-muted"> ({formatAbsolute(iso)})</span>
    </time>
  )
}

function Row({
  group,
  connection,
  now,
  onRevoke,
}: {
  group: ConnectionGroup
  connection: Connection
  now: Date
  onRevoke: (group: ConnectionGroup, connection: Connection) => void
}) {
  const expired = isExpired(connection.expiresAt, now)
  return (
    <li className="border-hairline flex flex-col gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-muted">Approved</dt>
        <dd className="text-ink">
          <When iso={connection.issuedAt} now={now} />
        </dd>
        <dt className="text-ink-muted">{expired ? 'Expired' : 'Expires'}</dt>
        <dd className="text-ink flex flex-wrap items-center gap-2">
          {connection.expiresAt ? <When iso={connection.expiresAt} now={now} /> : 'Never'}
          {expired && <Badge>Expired</Badge>}
        </dd>
      </dl>
      <button
        type="button"
        onClick={() => onRevoke(group, connection)}
        aria-label={`Revoke ${group.name}, approved ${formatAbsolute(connection.issuedAt)}`}
        className="border-hairline-strong text-danger-ink hover:border-danger/60 hover:bg-danger/10 self-start rounded-full border px-4 py-1.5 text-sm font-semibold transition-colors sm:self-auto"
      >
        Revoke
      </button>
    </li>
  )
}

function SessionGlyph() {
  return (
    <span aria-hidden="true" className="bg-surface-2 border-hairline text-primary-ink grid h-12 w-12 shrink-0 place-items-center rounded-2xl border">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5h16v14H4zM8 10l3 2-3 2M13 15h3" />
      </svg>
    </span>
  )
}

function Group({
  group,
  now,
  onRevoke,
}: {
  group: ConnectionGroup
  now: Date
  onRevoke: (group: ConnectionGroup, connection: Connection) => void
}) {
  return (
    <li className="border-hairline bg-surface-1 rounded-panel border px-5 pt-5 pb-1">
      <div className="flex items-center gap-4 pb-4">
        {group.app ? (
          <AppLogo
            documentId={group.app.documentId}
            logoRef={group.app.logoRef}
            legacyLogo={group.app.logo}
            name={group.name}
            className="h-12 w-12 text-lg ring-0"
          />
        ) : (
          <SessionGlyph />
        )}
        <div className="min-w-0 flex-1">
          <h3 className="text-ink truncate text-base font-semibold">
            {group.app ? (
              <Link href={`/app/${group.subject}`} className="hover:text-primary-ink transition-colors">
                {group.name}
              </Link>
            ) : (
              group.name
            )}
          </h3>
          <p className="text-ink-muted truncate font-mono text-xs" title={group.subject}>
            {shortDid(group.subject)}
          </p>
        </div>
        {group.connections.length > 1 && <Badge tone="primary">{group.connections.length} approvals</Badge>}
      </div>
      <ul aria-label={`${group.name} approvals`}>
        {group.connections.map((connection) => (
          <Row key={connection.credentialId} group={group} connection={connection} now={now} onRevoke={onRevoke} />
        ))}
      </ul>
    </li>
  )
}

/** One section of /me: a heading and its groups, or a one-line empty note. */
export function ConnectionSection({
  id,
  title,
  description,
  empty,
  groups,
  now,
  onRevoke,
}: {
  id: string
  title: string
  description: string
  empty: string
  groups: ConnectionGroup[]
  now: Date
  onRevoke: (group: ConnectionGroup, connection: Connection) => void
}) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} tabIndex={-1} className="text-ink text-h3 outline-none">
        {title}
      </h2>
      <p className="text-ink-muted mt-1.5 text-sm leading-6">{description}</p>
      {groups.length === 0 ? (
        <p className="border-hairline-strong text-ink-muted rounded-panel mt-5 border border-dashed px-5 py-6 text-sm">{empty}</p>
      ) : (
        <ul className="mt-5 space-y-4">
          {groups.map((group) => (
            <Group key={group.subject} group={group} now={now} onRevoke={onRevoke} />
          ))}
        </ul>
      )}
    </section>
  )
}
```

`components/me/revoke-dialog.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { buttonClasses } from '../site/primitives'

export interface RevokeTarget {
  credentialId: string
  /** The app or session name the dialog names. */
  name: string
  /** Element to focus once the row is gone (its section heading). */
  sectionId: string
}

/**
 * Confirms a revoke. A native modal <dialog>: the page behind is inert, focus
 * starts on Cancel (the safe choice), Esc cancels and focus returns to the
 * button that opened it.
 */
export function RevokeDialog({
  target,
  onCancel,
  onConfirm,
}: {
  target: RevokeTarget | null
  onCancel: () => void
  onConfirm: (target: RevokeTarget) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (target && !el.open) el.showModal()
    if (!target && el.open) el.close()
  }, [target])

  return (
    <dialog
      ref={dialog}
      aria-labelledby="revoke-title"
      aria-describedby="revoke-body"
      onClose={() => target && onCancel()}
      onClick={(event) => {
        // A click on the backdrop (the dialog box itself, outside its panel) cancels.
        if (event.target === event.currentTarget) onCancel()
      }}
      className="bg-background text-ink rounded-panel border-hairline-strong shadow-card m-auto w-[calc(100%-2rem)] max-w-md border p-0 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
    >
      {target && (
        <div className="p-6 md:p-7">
          <h2 id="revoke-title" className="text-ink text-h3">
            Revoke {target.name}?
          </h2>
          <p id="revoke-body" className="text-ink-muted mt-3 leading-6">
            {target.name} will no longer be able to act for you. To use it again, you approve it again.
          </p>
          <div className="mt-7 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {/* First in DOM order, so showModal() focuses Cancel. */}
            <button type="button" onClick={onCancel} className={buttonClasses('secondary')}>
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                // Close first: the dialog hands focus back to the opener now,
                // so onConfirm can move it elsewhere once the row is gone.
                dialog.current?.close()
                onConfirm(target)
              }}
              className="bg-danger text-primary-foreground inline-flex h-10 items-center justify-center rounded-full px-4 text-sm font-semibold transition-[filter] hover:brightness-110"
            >
              Revoke
            </button>
          </div>
        </div>
      )}
    </dialog>
  )
}
```

- [ ] **Step 9: Dashboard and page**

`components/me/me-dashboard.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useOwnProfile } from '../../hooks/use-own-profile'
import { profileCompleteness } from '../../lib/me/completeness'
import { identityDid, type Connection, type ConnectionGroup } from '../../lib/me/connections'
import { myDataFileName, myDataJson } from '../../lib/me/export'
import { revokeFailureText } from '../../lib/me/revoke'
import { buttonClasses, Heading, Lead } from '../site/primitives'
import { ToastRegion, useToasts } from '../site/toast'
import { CompletenessChecklist } from './completeness-checklist'
import { ConnectionSection } from './connection-list'
import { IdentityCard } from './identity-card'
import { RevokeDialog, type RevokeTarget } from './revoke-dialog'
import { useConnections } from './use-connections'
import type { MeSession } from './use-me-session'

type SignedIn = Extract<MeSession, { state: 'signed-in' }>

/** "Now", refreshed every minute so relative times and Expired badges stay true. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}

function download(name: string, json: string) {
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="space-y-4">
      {[0, 1].map((key) => (
        <div key={key} className="border-hairline bg-surface-1 rounded-panel h-36 border motion-safe:animate-pulse" />
      ))}
    </div>
  )
}

export function MeDashboard({ session }: { session: SignedIn }) {
  const { address } = session
  const profile = useOwnProfile(address)
  const connections = useConnections(address, session)
  const now = useNow()
  const { toasts, show, dismiss } = useToasts()
  const [target, setTarget] = useState<RevokeTarget | null>(null)
  const completeness = useMemo(() => profileCompleteness(profile), [profile])
  const did = identityDid(address, connections.credentials)

  function askRevoke(group: ConnectionGroup, connection: Connection) {
    setTarget({
      credentialId: connection.credentialId,
      name: group.name,
      sectionId: group.kind === 'app' ? 'apps-title' : 'sessions-title',
    })
  }

  async function confirmRevoke(chosen: RevokeTarget) {
    setTarget(null)
    // The row is about to disappear: keep keyboard focus in the list.
    document.getElementById(chosen.sectionId)?.focus()
    const result = await connections.revoke(chosen.credentialId)
    if (result.ok) show('success', `Revoked. ${chosen.name} can no longer act for you.`)
    else show('error', `${chosen.name} was not revoked. ${revokeFailureText(result.reason)}`)
  }

  const { apps, sessions } = connections.grouped
  return (
    <>
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <Heading level={1}>Your Renown</Heading>
          <Lead className="mt-3">Your identity, your public profile and every app you have allowed to act for you.</Lead>
        </div>
        <button
          type="button"
          disabled={connections.status !== 'ready'}
          onClick={() =>
            download(myDataFileName(address), myDataJson({ address, did, profile, connections: connections.grouped, now: new Date() }))
          }
          className={buttonClasses('secondary', 'md', 'self-start md:self-auto')}
        >
          Download my data
        </button>
      </div>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-start gap-8 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:gap-12">
        <div className="space-y-5 lg:sticky lg:top-24">
          <IdentityCard address={address} did={did} profile={profile} completeness={completeness} />
          <CompletenessChecklist completeness={completeness} />
        </div>

        <div className="min-w-0 space-y-12" aria-busy={connections.status === 'loading'}>
          {connections.status === 'loading' && <ListSkeleton />}
          {connections.status === 'error' && (
            <div role="alert" className="border-hairline-strong rounded-panel border border-dashed px-6 py-10 text-center">
              <h2 className="text-ink text-h3">Your approvals did not load</h2>
              <p className="text-ink-muted mt-2 text-sm">Renown did not answer. Nothing has changed; try again.</p>
              <button type="button" onClick={connections.retry} className={buttonClasses('primary', 'md', 'mt-6')}>
                Try again
              </button>
            </div>
          )}
          {connections.status === 'ready' && (
            <>
              <ConnectionSection
                id="apps-title"
                title="Connected apps"
                description="Apps with a public Renown identity that can sign in and act for you."
                empty="No apps can act for you right now."
                groups={apps}
                now={now}
                onRevoke={askRevoke}
              />
              <ConnectionSection
                id="sessions-title"
                title="CLI & other sessions"
                description="Command-line tools and clients without an app profile, listed by the identity they use."
                empty="No CLI or other sessions."
                groups={sessions}
                now={now}
                onRevoke={askRevoke}
              />
            </>
          )}
        </div>
      </div>

      <RevokeDialog target={target} onCancel={() => setTarget(null)} onConfirm={(t) => void confirmRevoke(t)} />
      <ToastRegion toasts={toasts} onDismiss={dismiss} />
    </>
  )
}
```

`pages/me.tsx`:

```tsx
import type { NextPage } from 'next'
import { MeDashboard } from '../components/me/me-dashboard'
import { useMeSession } from '../components/me/use-me-session'
import { PageMeta } from '../components/site/page-meta'
import { buttonClasses, Container } from '../components/site/primitives'
import { SiteLayout } from '../components/site/site-layout'

function SignInPanel({ login }: { login: () => void }) {
  return (
    <div className="border-hairline bg-surface-1 shadow-card rounded-panel mx-auto max-w-lg border px-6 py-12 text-center md:px-10">
      <h1 className="text-ink text-h2">Your Renown</h1>
      <p className="text-ink-muted mt-4 leading-7">
        Sign in to see your identity and every app you have approved, revoke access and download your data.
      </p>
      <button type="button" onClick={login} className={buttonClasses('primary', 'lg', 'mt-8')}>
        Sign in
      </button>
    </div>
  )
}

const MePage: NextPage = () => {
  const session = useMeSession()
  return (
    <SiteLayout>
      <PageMeta
        title="Your Renown"
        description="Your Renown identity, profile and the apps you have approved."
        path="/me"
        noindex
      />
      <Container className="min-h-[60vh] pt-12 pb-24 md:pt-16 md:pb-32">
        {session.state === 'loading' && (
          <p role="status" className="text-ink-muted py-24 text-center">
            Loading your Renown…
          </p>
        )}
        {session.state === 'signed-out' && <SignInPanel login={session.login} />}
        {session.state === 'signed-in' && <MeDashboard key={session.address} session={session} />}
      </Container>
    </SiteLayout>
  )
}

export default MePage
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `pnpm exec playwright test e2e/me.spec.ts --workers=3`
Expected: 12 passed. In the report, `me-{light,dark}-1280.png`: identity card (ring around the avatar, partly filled) and checklist on the left, "Connected apps" (Beta Board, then Alpha Notes with two rows, the older one with an "Expired" badge) and "CLI & other sessions" (ph-cli) on the right; at 390 everything stacks with no sideways scroll; `me-dialog-*.png` shows the dialog centred over a dimmed page.

- [ ] **Step 11: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add components/site/toast.tsx components/me pages/me.tsx styles/globals.css e2e/support/test-session.ts e2e/me.spec.ts
git commit -m "feat(me): your renown page with connected apps, sessions, revoke and data export"
```

---

## Task 5: Whole-branch verification

**Files:** none (verification only; fix forward in the task that owns a failure).

- [ ] **Step 1: Static checks and production build**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm build
```

Expected: no errors; the route table lists `ƒ /apps` and `ƒ /me` (the latter because `_app` has `getInitialProps`).

- [ ] **Step 2: Full e2e suite**

```bash
pnpm exec playwright test --workers=3
```

Expected: all pass (213 tests, 211 passing at the time of planning; the two failures were the Phase A tests below). A cold dev server can make the first spec of a route time out; rerun only the failed specs before investigating. Known dev-server flake (Phase A, not this plan): `profile-pages.spec.ts` "/@handle renders the identity…" can fail with `Network.getResponseBody: No resource with given identifier found` when another route compiles mid-test, because it reads `response.text()` last; it passes alone. If it bites, move that line directly under the `page.goto` (Phase A ruling 13):

```diff
     const response = await page.goto('/@pat-pages')
     expect(response?.status()).toBe(200)
+    const html = await response!.text()
     await expect(page.getByRole('heading', { name: 'Pat Pages' })).toBeVisible()
@@
-    expect(await response?.text()).toContain(`src="/media/doc-pages-1/avatar?v=${'f'.repeat(12)}"`)
+    expect(html).toContain(`src="/media/doc-pages-1/avatar?v=${'f'.repeat(12)}"`)
```

Second Phase A observation: `developers.spec.ts` "the connect link builder validates live…" expects `https://www.renown.id/?connect=…`, but the builder uses `publicOrigin()` and `playwright.config.ts` runs the dev server with `NEXT_PUBLIC_RENOWN_URL=http://localhost:3000`, so it renders `http://localhost:3000/?connect=…` and fails. This plan does not touch either file; whoever owns Phase A Task 7 decides whether the test should expect `` `${publicOrigin()}/?connect=…` `` instead.

- [ ] **Step 3: Screenshot review.** `pnpm exec playwright show-report` → the axe tests of `apps.spec.ts`, `home.spec.ts`, `me.spec.ts`: light/dark × 390/1280. Check: no sideways scroll at 390 (asserted), chips scroll inside their row, pulse numbers aligned, `/me` cards stack on mobile, the dialog is readable in both themes.

- [ ] **Step 4: Manual checks against a real switchboard** (`pnpm dev` without the stub env, `NEXT_PUBLIC_SWITCHBOARD_ENDPOINT` = staging): `/apps` lists the staging apps and a chip filters without a reload; the homepage shows only the counts ≥ 25; sign in from the header, open `/me`, check the list matches your approvals, cancel a revoke with Esc, then revoke one stale approval and watch the network tab (one `renown_revokeCredential` with `Authorization: Bearer …`, no wallet prompt). Record the outcome for Review Focus 1.

- [ ] **Step 5: Lighthouse handoff.** Mobile Lighthouse on staging for `/apps` (with `/` and `/developers` from Phase A) during rollout; this phase records nothing locally.

- [ ] **Step 6: Clean tree.** `git status` shows nothing to commit (`git checkout next-env.d.ts` if the build touched it).

---

## Self-review

**Spec coverage.** `/apps`: SSR first page `appProfiles(limit: 24, category)` + `appProfileCategories`, chips "All" + counts updating `?category=` via shallow routing and client fetch, cards via Phase A's `AppTile`, "Load more" with `next`/`after`, empty state "No apps here yet" + "List your app on Vetra" → https://www.vetra.io, outage notice + retry at HTTP 200, `PageMeta`, axe both themes, screenshots 390/1280, no layout shift — Task 1. Network pulse: `renownNetworkStats` within `SSR_DATA_TIMEOUT_MS`, per-metric threshold `NEXT_PUBLIC_PULSE_MIN` (default 25), hidden when none qualifies, count-up on reveal except reduced motion, tokens only — Task 2. `/me`: signed-out sign-in panel; identity card (avatar, display name, handle, DID/address copy, View public profile, Edit profile); completeness ring + checklist linking to `/profile/edit`; connected apps grouped by subject with logo/name/link; CLI & other sessions with shortened DIDs; issued/expires relative + absolute with "Expired"; revoke confirm dialog with "<App> will no longer be able to act for you"; bearer then `personal_sign` fallback with the backend's exact message; optimistic removal, rollback + toast with plain-language FORBIDDEN/NOT_FOUND/network messages, refetch; list failure + retry; Download my data — Tasks 3–4. Testing section: `/apps` (filter, load more, empty, outage), `/me` (signed out, list, grouping, revoke success, revoke failure rollback, download), homepage with/without/failed stats, axe and screenshots — Tasks 1, 2, 4. Rollout env vars — "Rollout notes".

**Placeholder scan:** no TBD/TODO; every code step has the full file or an exact diff.

**Type consistency:** `listAppProfiles` keeps Phase A's call shape (`{ limit, after? }`) and adds `category?`; `AppProfilePage` is reused by `useAppDirectory`; `NetworkPulse` (Phase A) is what `fetchNetworkStats` returns and `visibleMetrics` reads; `IssuedCredential`/`GroupedConnections`/`RevokeAuth`/`RevokeFailure` are defined in Task 3 and used with the same names in Task 4; `RevokeTarget` carries `credentialId`, `name`, `sectionId` in both `revoke-dialog.tsx` and `me-dashboard.tsx`; `useConnections(address, auth)` takes `Pick<RevokeDeps, 'getBearer' | 'signMessage'>`, which the signed-in `MeSession` satisfies.

**Review Focus:** five conditions listed at the top; the bearer path and the real-wallet pass are folded into Task 5 Step 4 and the Rollout notes.

