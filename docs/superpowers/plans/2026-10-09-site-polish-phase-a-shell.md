# renown.id Site Polish — Phase A (Shell, Homepage, Docs Pages, SEO) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give www.renown.id a public face: a site shell (header, avatar menu, mobile drawer, footer), a design-token + primitive layer, a homepage with the animated identity constellation, `/developers` with a live connect-link builder, `/trust`, `/ecosystem`, designed 404/500, per-page SEO with generated OG images, robots.txt and sitemap.xml — while every auth flow and existing URL keeps working unchanged.

**Architecture:** Every page renders inside `SiteLayout` (`variant="site"`: sticky header + `<main id="main">` + footer; `variant="auth"`: today's minimal sign-in chrome). Visual decisions live as CSS custom properties in `styles/globals.css` exposed to Tailwind v4 via `@theme inline`; components use only token utilities. Server data is optional decoration: SSR reads go through `withTimeout(…, 2500)` and a failure removes the section. Syntax highlighting (shiki) runs only in `getStaticProps`/`getServerSideProps`; OG images are an edge route built with `next/og`.

**Tech Stack:** Next.js 16.2.6 (pages router, webpack), React 19.2.6, Tailwind v4, next-themes, Inter (`next/font`), graphql-request, shiki 4.4.3 (server only), `next/og`, Playwright 1.57 + `@axe-core/playwright` 4.13.0.

**Spec:** `/home/f/projects/renown-package-hub/docs/superpowers/specs/2026-10-09-renown-site-polish-design.md` (binding). Repo for all tasks: `/home/f/projects/renown-hub`, branch `feat/site-polish`.

**How this plan was produced:** every task was implemented in a scratch worktree of `feat/site-polish` (797085f); `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build` and the full Playwright suite (173 tests, `--workers=3`) passed with exactly the code below. Code blocks are the real files, not sketches.

---

## Planner rulings

Decisions the spec left open, made here so Phases B and C can rely on them:

1. **`/apps` and `/me` are linked before they exist.** Header, drawer, footer, the homepage "Browse all apps" button and the account menu link to `/apps` and `/me` (Phase B). Phase A is not released on its own: renown.id ships to staging only after Phases A+B(+C) are merged (spec rollout step 2). The sitemap already lists `/apps`.
2. **OG images replace the raw `/media` previews on `/@handle` and `/app/[did]`.** The spec says the `next/og` route is used by `/`, `/@handle` and `/app/[did]`; the old `og:image` (avatar / cover URL, absent without an image) becomes `/api/og?variant=profile&address=…` / `/api/og?variant=app&did=…`, always present, `twitter:card` always `summary_large_image`. Two assertions in `e2e/profile-pages.spec.ts` and one in `e2e/app-pages.spec.ts` change accordingly (Task 4). Everything else on those pages is behaviour-identical.
3. **Profile OG variant is keyed by wallet address**, not handle (`?variant=profile&address=0x…`): every wallet profile has one, it is the lookup the header already uses (`driveId: renown-<address>`), and handle-less profiles get a card too. Pages without a wallet address use the default card.
4. **OG image fallback = default card** (spec: "image fetch failures fall back to the default variant"). A missing image (no avatar/logo) is not a failure: the card shows a gradient monogram. Images must be PNG/JPEG/GIF ≤ 4 MB (Satori cannot draw WebP); anything else falls back. The route always answers 200 with `X-Og-Variant` naming the variant drawn.
5. **The homepage teaser is highlighted per request** (shiki in `getServerSideProps`, memoised highlighter, JS regex engine) because the page is SSR for featured apps; `/developers` is SSG and highlights at build time as the spec requires. shiki never reaches the client (checked: no shiki strings in `.next/static`).
6. **Header auth reflects the Renown session** (`useRenownAuth`, exactly what the old `RenownLoginButton` used), not the wallet session. The old top-right button is deleted; its "View Profile" became "Your profile" (`/@handle` when the own profile has one, else `/profile/<address>` per spec).
7. **The signed-in account menu has no automated test.** The e2e harness can only fake the wallet session (`NEXT_PUBLIC_E2E_AUTH`), not a Renown session, so the header never reaches the signed-in state under Playwright. It is covered by the Task 10 manual check and the Review Focus list. (A first attempt at an e2e test was removed for this reason.)
8. **`_app` wraps pages in a `<div>` instead of `<main>`.** `SiteLayout` owns the single `<main id="main">` (skip-link target, axe `landmark-*` rules); pages render content only. Auth pages keep `styles.main` on a `<div>`.
9. **Primary button fill is `--primary-strong` (#0066D6), not `#0084FF`.** White on #0084FF is 3.66:1 (fails WCAG AA for 15 px text); #0066D6 is 5.42:1. `#0084FF` stays the brand accent (glows, rings, edges). Text links use `--primary-ink` (#0062C9 light 5.55:1, #5AB0FF dark 8.54:1).
10. **Reduced motion is handled per component**, not by a global kill switch (which would also freeze loading spinners): the constellation animates only inside `@media (prefers-reduced-motion: no-preference)`, `Reveal` does nothing under reduce, hover lifts use `motion-reduce:`.
11. **Connect-link builder requires a `did:key` app DID** (`APP_DID_RE`, the site's app-identity regex) although the sign-in flow itself accepts any string: the builder is for developers creating a new link, and every Renown app identity (`renown.did`) is a `did:key`. `returnUrl` and `expiresInDays` use the real parsers (`parseReturnUrl`, `parseExpiresInDays`).
12. **E2E isolation for the homepage.** The homepage SSR reads `appProfiles(limit: 6)` — one query shape for every load — so every homepage load lives in the serial `e2e/home.spec.ts`, which swaps a named stub fixture (`/__stub/fixture/remove` is added to the stub). No other spec may load `/` without `?app=`/`?connect=`. The sitemap reads `limit: 50`, which no page uses.
13. **Dev-server test hardening.** Under `next dev`, a 404 page full-reloads when another route compiles, and a reload discards a response body. Drawer navigation is tested from `/ecosystem` (not the 404 page) with a 30 s URL timeout, and `profile-pages.spec.ts` reads the response body before other assertions. Run the full suite with `--workers=3` (the default worker count times out on a cold dev server — also true before this plan).

## OIDC check (spec /developers §6)

`curl https://www.renown.id/.well-known/openid-configuration` → 404, but the issuer the site uses (`services/oidc.ts` `DEFAULT_OIDC_ISSUER`) answers: `https://switchboard.renown.vetra.io/api/@powerhousedao/renown-package/oidc/.well-known/openid-configuration` → 200 (authorization_code + PKCE S256, RS256 ID tokens, scopes openid/profile/email). The OIDC section is included with that issuer. Client registration is token-gated (`x-renown-oidc-registration-token`, `subgraphs/renown-oidc/resolvers.ts`), so the page says registration is not self-service.

## Claims cut as unverifiable

- "Connect *and Vetra* accept your Renown ID" → only Connect is named (Connect uses the Renown signer; Vetra's own login was not verified in code).
- "Switchboard verifies Renown bearer tokens on every request" → cut (not verified in reactor-api code here).
- "Create your ID in a minute" → replaced by "It takes one signature."
- "renown.id is AGPL-3.0" → the site repo has no LICENSE file; only renown-package and `@renown/sdk` are AGPL-3.0-only. The page says the site's code is public.
- Email/social login wording → the enabled login methods are deployment config (`LoginMethod`), so copy only promises "the wallet you already have".
- A process for getting an OIDC client ID → no public process found; the page only states it is operator-registered.

---

## Produced interfaces (stable for Phases B and C)

Phases B and C build on these exports. Do not rename or change their props.

**Layout and chrome — `components/site/`**

```ts
// site-layout.tsx
export type SiteLayoutVariant = 'site' | 'auth'
export interface SiteLayoutProps { children: ReactNode; variant?: SiteLayoutVariant } // default 'site'
export function SiteLayout(props: SiteLayoutProps): JSX.Element
// Pages render NO <main>: SiteLayout renders <main id="main"> in both variants.

// site-header.tsx / site-footer.tsx (rendered by SiteLayout; no props)
export function SiteHeader(): JSX.Element
export function SiteFooter(): JSX.Element

// nav.ts — the only place chrome links live
export interface NavLink { label: string; href: string }
export interface FooterColumn { title: string; links: NavLink[] }
export const SITE_NAV: NavLink[]            // Apps /apps, Developers, Trust, Ecosystem
export const FOOTER_COLUMNS: FooterColumn[]
export const PRIVACY_URL, TERMS_URL, GITHUB_URL, X_URL, VETRA_URL, POWERHOUSE_URL, APP_STATS_DOCS_URL: string
export function isActivePath(pathname: string, href: string): boolean
export function isExternal(href: string): boolean

// use-site-auth.ts — the session as chrome sees it (Renown session)
export type SiteAuth =
  | { state: 'loading' }
  | { state: 'signed-out'; login: () => void }
  | { state: 'signed-in'; address: string; displayName: string | null; avatarUrl: string | null; profile: RenownProfile | null; logout: () => void }
export function useSiteAuth(): SiteAuth

// account-links.ts
export function accountLinks(address: string, profile: { handle?: string | null; documentId: string } | null): NavLink[]
export function shortAddress(address: string): string

// page-meta.tsx — how every page declares its SEO
export interface PageMetaProps {
  title?: string            // "Apps" → "<title>Apps - Renown</title>"; omit on "/"
  description?: string      // defaults to DEFAULT_DESCRIPTION
  path?: string             // "/apps" → canonical + og:url from NEXT_PUBLIC_RENOWN_URL
  image?: string            // absolute; defaults to ogImageUrl() (default card)
  twitterCard?: 'summary' | 'summary_large_image'
  ogType?: 'website' | 'profile' | 'article'
  noindex?: boolean
  jsonLd?: object[]
}
export function PageMeta(props: PageMetaProps): JSX.Element // place it inside <SiteLayout>

// error-state.tsx — designed empty/error body
export function ErrorState(props: { code?: string; title: string; message: string }): JSX.Element

// ph-motif.tsx
export function PhMotif(props: { className?: string }): JSX.Element
```

**Primitives — `components/site/primitives` (barrel `index.ts`)**

```ts
Container({ children, className?, as?: ElementType, narrow?: boolean })       // max 1200 px (760 narrow), px-4 md:px-6
Section({ children, id?, labelledBy?, tone?: 'plain'|'raised', spacing?: 'sm'|'md', className?, contained?: boolean })
Eyebrow({ children, className? })                                            // sentence case + signal dot
Heading({ children, level: 1|2|3, size?: 'display'|'h1'|'h2'|'h3', id?, className? })
Lead({ children, className? })
Card({ children, className?, as?, interactive?: boolean })
Badge({ children, tone?: 'neutral'|'primary'|'signal', className? })
ButtonLink({ href, children, variant?: 'primary'|'secondary'|'ghost', size?: 'md'|'lg', className? }) // http(s) → new tab
buttonClasses(variant?, size?, className?): string                           // for <button>
CodeBlock({ code: string, html?: string | null, label?: string, className? }) // html from lib/highlight.ts
Reveal({ children, className?, as?, delay?: number })
```

**Tokens (Tailwind utilities from `styles/globals.css`)** — colours: `bg-surface-1|2|3`, `border-hairline`, `border-hairline-strong`, `text-ink`, `text-ink-muted`, `bg-primary-strong`, `text-primary-ink`, `text-signal`/`bg-signal`, `bg-header`, `bg-code`, `from-grad-from`/`to-grad-to`; shadows `shadow-card`, `shadow-glow`; type `text-display|h1|h2|h3|lead`; radii `rounded-control|card|panel`; easing `ease-out-expo`. Raw vars: `--grad-from`, `--grad-to`, `--glow-primary`, `--primary`, `--background`.

**Homepage — `components/home/`**

```ts
// types.ts
export interface NetworkPulse { identities: number; apps: number; activeCredentials: number; activeUsers30d: number; updatedAt: string }
export interface HomePageData { featuredApps: RenownAppProfile[]; pulse?: NetworkPulse | null; teaser: HighlightedCode }
// network-pulse.tsx — Phase B replaces the body, keeps this signature
export function NetworkPulseSection({ pulse }: { pulse?: NetworkPulse | null }): JSX.Element | null
// pages/index.tsx getServerSideProps returns { mode: 'site', featuredApps, pulse: null, teaser }; Phase B fills `pulse`.
```

**App card (reused by `/apps`)** — `components/app/app-tile.tsx`

```ts
export interface AppTileProps { app: RenownAppProfile; headingLevel?: 2 | 3 }
export function AppTile(props: AppTileProps): JSX.Element // links to /app/[did]
```

**Data and SEO helpers**

```ts
// services/app-profiles.ts
export interface AppProfilePage { items: RenownAppProfile[]; next: string | null }
export async function listAppProfiles(args: { limit: number; after?: string | null }): Promise<AppProfilePage> // throws on failure
// utils/with-timeout.ts
export class TimeoutError extends Error
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T>
export const SSR_DATA_TIMEOUT_MS = 2500
// lib/highlight.ts (server-only: import dynamically inside getStaticProps/getServerSideProps)
export type CodeLang = 'ts' | 'bash' | 'graphql'
export interface HighlightedCode { code: string; html: string }
export async function highlight(code: string, lang: CodeLang): Promise<HighlightedCode>
export async function highlightAll<K extends string>(samples: Record<K, { code: string; lang: CodeLang }>): Promise<Record<K, HighlightedCode>>
// utils/seo.ts
export function publicOrigin(): string
export function canonicalUrl(path: string): string
export type OgImageParams = { variant: 'default' } | { variant: 'profile'; address: string } | { variant: 'app'; did: string }
export function ogImageUrl(params?: OgImageParams, origin?: string): string
export const SITE_NAME: string, DEFAULT_DESCRIPTION: string
// lib/sitemap.ts
export const STATIC_PATHS: string[]   // Phase B/C add their public pages here
export const SITEMAP_APP_CAP = 1000
// components/ecosystem/ecosystem-data.ts
export interface EcosystemEntry { id: 'renown'|'vetra'|'achra'|'connect'|'switchboard'; name: string; role: string; detail: string; href: string }
export const ECOSYSTEM: EcosystemEntry[]
```

**E2E helpers** — `e2e/support/site.ts`: `useTheme(page, 'light'|'dark')`, `expectNoSeriousA11yViolations(page)`, `attachScreenshots(page, testInfo, name)`; `e2e/support/stub-switchboard-client.ts`: `fixtureStub({ id?, match, variables?, status?, response })`, `removeFixture(id)`.

---

## Global Constraints

- Next.js 16.2.6, React 19.2.6, Tailwind v4 tokens in `styles/globals.css`, Inter via `next/font`, next-themes (`attribute="class"`, default dark). Evolve the current look: dark-first, Inter, primary `#0084FF`, the PH-icon background motif.
- Existing URLs keep working unchanged: `/?app=…`, `/?connect=…` (+ `deeplink`, `returnUrl`, `expiresInDays`), `/console`, `/oidc/login`, `/profile/[id]`, `/@handle`, `/profile/edit`, `/app/[did]`, `/media/...`, all `/api/*`.
- Auth screens (WebFlow on `/` with `app`/`connect`, `/console`, `/oidc/login`) render inside a minimal chrome: logo + theme toggle only, no nav, no footer links.
- Legal links point to `https://www.vetra.io/privacy-policy` and `https://www.vetra.io/terms-and-conditions`.
- Social links: GitHub `https://github.com/powerhouse-inc`, X `https://x.com/PowerhouseDAO`.
- No new runtime dependency over 30 kB gzip on the client. No WebGL. Motion respects `prefers-reduced-motion`.
- Public pages that read backend data use SSR with a 2.5 s per-request timeout; any data failure drops that section (never a 500, never an empty frame).
- Every factual claim on `/trust` and `/developers` is verified against code (renown-package, renown.id, `@renown/sdk` 6.2.3); a claim that cannot be verified is cut.
- Quality bar: Lighthouse (mobile) on `/`, `/apps`, `/developers` — Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95; zero serious/critical axe violations on every new page in both themes; no layout shift from late data.
- No hard-coded colours in new components (tokens only; the OG image route, which renders outside the page, is the exception).
- Exact dependency versions: `shiki@4.4.3` (dependency, server-only), `@axe-core/playwright@4.13.0` (devDependency). Install with `pnpm add -w …` (the repo is a pnpm workspace root).
- No `Co-Authored-By` trailers in commits. Never push; commit on `feat/site-polish` only.
- Copy: sentence case, active voice, no ALL-CAPS labels, no "→" glyphs appended to links, no middle-dot meta strings.

## Review Focus

Conditions no task's tests fully pin, most likely to bite first:

1. **Signed-in header state.** A real Renown session must show the avatar button; its menu must open with focus on "Your Renown", move with ↑/↓, close on Esc (focus back on the button) and on outside click, and "Sign out" must log out. Not reachable from Playwright (ruling 7) — verify by hand in Task 10.
2. **Slow backend on the homepage.** A switchboard that hangs must not delay `/` by more than ~2.5 s; the stub cannot delay, so only `withTimeout` is unit-tested (Task 5). Check `getServerSideProps` keeps `withTimeout(listAppProfiles(...), SSR_DATA_TIMEOUT_MS)`.
3. **OG images that decode badly.** An image whose content-type says PNG but whose bytes are corrupt fails inside `ImageResponse` streaming, after the fallback decision; crawlers then get a broken image. The route checks type and size only. Watch staging logs for `og:` errors.
4. **Theme flash and contrast at boundaries.** axe runs at 1280 px with `reducedMotion: 'reduce'`; it does not see hover states (primary hover `brightness-110`) or the drawer open. Check the drawer and account menu in light mode for contrast by eye.
5. **Very long names.** App names/taglines and display names of 60+ characters: `AppTile` truncates the name and clamps the tagline to 2 lines; the account button truncates at 10 rem; OG cards wrap but may overflow at 80+ characters. Spot-check with a long fixture during Task 10.

---

## File map

| Path | Task | Responsibility |
| --- | --- | --- |
| `styles/globals.css` | 1, 3, 6, 8 | Tokens; focus ring; shiki colours; drawer, constellation, flow-diagram CSS |
| `utils/cx.ts` | 1 | Class-name join |
| `components/site/primitives/*` | 1 | Container, Section, Eyebrow, Heading/Lead, Card, Badge, ButtonLink, CodeBlock, Reveal + barrel |
| `components/ui/renown-logo.tsx`, `theme-toggle.tsx` | 1 | Logo accepts `className`; round 40 px toggle |
| `utils/seo.ts`, `components/site/page-meta.tsx` | 2 | Canonical/OG URL helpers, per-page head |
| `lib/og/og-data.ts`, `pages/api/og.tsx` | 2 | OG card data (edge) and image route |
| `components/site/{nav,account-links,use-site-auth,account-menu,auth-slot,mobile-nav,site-header,site-footer,site-backdrop,site-layout,error-state}.ts(x)`, `hooks/use-own-profile.ts` | 3 | Site shell |
| `pages/{404,500}.tsx`, `pages/_app.tsx`, `pages/console.tsx`, `pages/oidc/login.tsx` | 3 | Error pages; single `<main>`; auth chrome |
| `pages/profile/[id].tsx`, `pages/app/[did].tsx`, `pages/profile/edit.tsx`, `components/ui/not-found-page.tsx` | 4 | Existing pages on the site layout; OG card URLs |
| `lib/highlight.ts`, `utils/with-timeout.ts`, `services/app-profiles.ts`, `e2e/support/stub-switchboard*.{mjs,ts}` | 5 | Server data plumbing |
| `components/home/*`, `components/app/app-tile.tsx`, `components/ecosystem/ecosystem-data.ts`, `components/site/ph-motif.tsx`, `pages/index.tsx` | 6 | Homepage |
| `utils/connect-link.ts`, `components/developers/*`, `pages/developers.tsx` | 7 | Developer guide + link builder |
| `components/trust/trust-content.ts`, `pages/trust.tsx`, `components/ecosystem/identity-flow-diagram.tsx`, `pages/ecosystem.tsx` | 8 | Trust and ecosystem |
| `lib/sitemap.ts`, `pages/sitemap.xml.tsx`, `pages/robots.txt.tsx` | 9 | Crawling |
| `e2e/*.spec.ts`, `e2e/support/site.ts` | 2–9 | Tests per task |

Removed in Task 6: `components/ui/page-background.tsx`, `components/auth/renown-login-button.tsx`.

**Running tests:** Playwright starts the stub switchboard and `pnpm dev` itself (`playwright.config.ts`). Make sure nothing else listens on ports 3000/4799 (a reused server without the stub env breaks API specs). Single spec: `pnpm exec playwright test e2e/<file> --workers=3`.

---

## Task 1: Design tokens and primitives

**Files:**
- Modify: `styles/globals.css` (four insertions)
- Modify: `components/ui/renown-logo.tsx`, `components/ui/theme-toggle.tsx`, `components/ui/page-background.tsx` (one line)
- Create: `utils/cx.ts`, `components/site/primitives/{container,section,eyebrow,heading,card,badge,button-link,code-block,reveal}.tsx`, `components/site/primitives/index.ts`

**Interfaces:**
- Consumes: existing tokens (`--background`, `--primary`, `--primary-foreground`, `--destructive`) in `styles/globals.css`.
- Produces: the primitives and token utilities listed under "Produced interfaces". `RenownLogo` now honours a `className` prop (default `w-30 h-10 md:w-50 md:h-20`, unchanged when omitted).

This task has no page yet, so it is verified by typecheck, lint and build; every later task's specs exercise these primitives (axe contrast checks run on all of them in Tasks 3, 6, 7, 8).

- [ ] **Step 1: Add the light-theme tokens.** In `styles/globals.css`, inside the `:root { … }` block, directly after the `--shadow-modal: …;` declaration (before the closing `}`), insert:

```css
    /* Site polish tokens (components/site). */
    --surface-1: #FFFFFF;
    --surface-2: #F1F5FA;
    --surface-3: #E6EDF6;
    --hairline: rgba(15, 30, 60, 0.10);
    --hairline-strong: rgba(15, 30, 60, 0.18);
    --ink: #0B1220;
    --ink-muted: #5F6670;
    --primary-strong: #0066D6;
    --primary-ink: #0062C9;
    --signal: #007A57;
    --grad-from: #21FFB4;
    --grad-to: #0080FF;
    --glow-primary: 0 0 0 1px rgba(0, 132, 255, 0.18), 0 24px 60px -28px rgba(0, 102, 214, 0.45);
    --shadow-card: 0 1px 0 rgba(255, 255, 255, 0.8) inset, 0 1px 2px rgba(15, 30, 60, 0.06), 0 12px 32px -16px rgba(15, 30, 60, 0.18);
    --header-bg: rgba(247, 249, 252, 0.72);
    --code-bg: #F6F8FB;
```

- [ ] **Step 2: Add the dark-theme tokens.** Inside `.dark { … }`, directly after `--neutral-1: rgba(255, 255, 255, 0.05);`, insert:

```css
    --surface-1: rgba(255, 255, 255, 0.035);
    --surface-2: rgba(255, 255, 255, 0.06);
    --surface-3: rgba(255, 255, 255, 0.10);
    --hairline: rgba(255, 255, 255, 0.09);
    --hairline-strong: rgba(255, 255, 255, 0.16);
    --ink: #F4F7FF;
    --ink-muted: #94A3B8;
    --primary-strong: #0066D6;
    --primary-ink: #5AB0FF;
    --signal: #21FFB4;
    --grad-from: #21FFB4;
    --grad-to: #0080FF;
    --glow-primary: 0 0 0 1px rgba(90, 176, 255, 0.22), 0 30px 80px -30px rgba(0, 132, 255, 0.65);
    --shadow-card: 0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 20px 40px -24px rgba(0, 0, 0, 0.7);
    --header-bg: rgba(5, 10, 26, 0.66);
    --code-bg: #0A1226;
```

- [ ] **Step 3: Expose tokens to Tailwind.** Inside `@theme inline { … }`, directly after `--shadow-modal: var(--shadow-modal);`, insert:

```css
    --color-surface-1: var(--surface-1);
    --color-surface-2: var(--surface-2);
    --color-surface-3: var(--surface-3);
    --color-hairline: var(--hairline);
    --color-hairline-strong: var(--hairline-strong);
    --color-ink: var(--ink);
    --color-ink-muted: var(--ink-muted);
    --color-primary-strong: var(--primary-strong);
    --color-primary-ink: var(--primary-ink);
    --color-signal: var(--signal);
    --color-grad-from: var(--grad-from);
    --color-grad-to: var(--grad-to);
    --color-header: var(--header-bg);
    --color-code: var(--code-bg);
    --shadow-glow: var(--glow-primary);
    --shadow-card: var(--shadow-card);

    /* Type scale: fluid display sizes, fixed text sizes. */
    --text-display: clamp(2.6rem, 1.55rem + 4.4vw, 4.75rem);
    --text-display--line-height: 1.02;
    --text-display--letter-spacing: -0.038em;
    --text-display--font-weight: 650;
    --text-h1: clamp(2.2rem, 1.6rem + 2.4vw, 3.4rem);
    --text-h1--line-height: 1.06;
    --text-h1--letter-spacing: -0.032em;
    --text-h1--font-weight: 650;
    --text-h2: clamp(1.7rem, 1.35rem + 1.4vw, 2.45rem);
    --text-h2--line-height: 1.12;
    --text-h2--letter-spacing: -0.026em;
    --text-h2--font-weight: 640;
    --text-h3: 1.1875rem;
    --text-h3--line-height: 1.35;
    --text-h3--letter-spacing: -0.012em;
    --text-h3--font-weight: 600;
    --text-lead: clamp(1.0625rem, 0.98rem + 0.35vw, 1.25rem);
    --text-lead--line-height: 1.6;

    --radius-control: 10px;
    --radius-card: 18px;
    --radius-panel: 28px;

    --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
```

- [ ] **Step 4: Focus ring and shiki colours.** Append to the end of `styles/globals.css`:

```css
/* Focus ring for every interactive element on the site. */
:focus-visible {
    outline: 2px solid var(--primary-ink);
    outline-offset: 2px;
}

/* Shiki dual-theme output (lib/highlight.ts emits --shiki-light / --shiki-dark). */
.shiki,
.shiki span {
    color: var(--shiki-light);
    background-color: transparent !important;
}
.dark .shiki,
.dark .shiki span {
    color: var(--shiki-dark);
}
```

- [ ] **Step 5: Let the logo take a size; round the theme toggle.** `RenownLogo` used to ignore `className` (it was overwritten after `{...props}`); `PageBackground` passes `className="text-foreground"`, which would now shrink the logo on the pages still using it until Task 6, so drop that no-op class first:

```diff
--- a/components/ui/page-background.tsx
+++ b/components/ui/page-background.tsx
@@
       <div className="absolute left-8 top-3 z-10 flex items-center gap-4">
-        <RenownLogo aria-label="Renown" className="text-foreground" />
+        <RenownLogo aria-label="Renown" />
       </div>
```

Then apply:

```diff
diff --git a/components/ui/renown-logo.tsx b/components/ui/renown-logo.tsx
index b8030f0..b0969c9 100644
--- a/components/ui/renown-logo.tsx
+++ b/components/ui/renown-logo.tsx
@@ -12,5 +12,5 @@ const RenownLogo: React.FC<SVGProps<SVGSVGElement>> = (props) =>
       xmlns="http://www.w3.org/2000/svg"
       {...props}
-      className="w-30 h-10 md:w-50 md:h-20"
+      className={props.className ?? "w-30 h-10 md:w-50 md:h-20"}
     >
       <path
@@ -91,6 +91,6 @@ const RenownLogo: React.FC<SVGProps<SVGSVGElement>> = (props) =>
           gradientUnits="userSpaceOnUse"
         >
-          <stop stop-color="#21FFB4" />
-          <stop offset="1" stop-color="#0080FF" />
+          <stop stopColor="#21FFB4" />
+          <stop offset="1" stopColor="#0080FF" />
         </linearGradient>
       </defs>
```

```diff
diff --git a/components/ui/theme-toggle.tsx b/components/ui/theme-toggle.tsx
index 1a94ab5..3320cd2 100644
--- a/components/ui/theme-toggle.tsx
+++ b/components/ui/theme-toggle.tsx
@@ -13,11 +13,11 @@ const ThemeToggle: React.FC = () => {
     <button
       onClick={toggleTheme}
-      className="p-2 rounded-lg border border-foreground/20 hover:bg-foreground/10 transition-colors text-foreground"
+      className="flex h-10 w-10 items-center justify-center rounded-full border border-foreground/20 text-foreground transition-colors hover:bg-foreground/10"
       aria-label="Toggle theme"
     >
       <svg
         xmlns="http://www.w3.org/2000/svg"
-        width="24"
-        height="24"
+        width="18"
+        height="18"
         viewBox="0 0 24 24"
         fill="none"
@@ -40,6 +40,6 @@ const ThemeToggle: React.FC = () => {
       <svg
         xmlns="http://www.w3.org/2000/svg"
-        width="24"
-        height="24"
+        width="18"
+        height="18"
         viewBox="0 0 24 24"
         fill="none"
```

- [ ] **Step 6: Create `utils/cx.ts`**

```ts
/** Joins class names, skipping falsy entries. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
```

- [ ] **Step 7: Create the layout primitives**

`components/site/primitives/container.tsx`:

```tsx
import type { ElementType, ReactNode } from 'react'
import { cx } from '../../../utils/cx'

export interface ContainerProps {
  children: ReactNode
  className?: string
  /** Rendered element; defaults to div. */
  as?: ElementType
  /** Narrow reading width (760 px) for long-form pages. */
  narrow?: boolean
}

/** Horizontal frame: max 1200 px (760 px narrow), 16 px gutters on mobile, 24 px from md. */
export function Container({ children, className, as: Tag = 'div', narrow = false }: ContainerProps) {
  return (
    <Tag className={cx('mx-auto w-full px-4 md:px-6', narrow ? 'max-w-[760px]' : 'max-w-[1200px]', className)}>
      {children}
    </Tag>
  )
}
```

`components/site/primitives/section.tsx`:

```tsx
import type { ReactNode } from 'react'
import { cx } from '../../../utils/cx'
import { Container } from './container'

export interface SectionProps {
  children: ReactNode
  /** Anchor id (in-page links, TOC). */
  id?: string
  /** id of the heading that names this section. */
  labelledBy?: string
  /** plain: transparent; raised: a faint surface band with hairlines. */
  tone?: 'plain' | 'raised'
  /** Vertical rhythm: md = 80/112 px, sm = 56/72 px. */
  spacing?: 'sm' | 'md'
  className?: string
  /** Wrap children in a Container (default true). */
  contained?: boolean
}

/** One vertical band of a page, with consistent rhythm. */
export function Section({
  children,
  id,
  labelledBy,
  tone = 'plain',
  spacing = 'md',
  className,
  contained = true,
}: SectionProps) {
  return (
    <section
      id={id}
      aria-labelledby={labelledBy}
      className={cx(
        'relative scroll-mt-24',
        spacing === 'md' ? 'py-20 md:py-28' : 'py-14 md:py-[72px]',
        tone === 'raised' && 'border-hairline bg-surface-1 border-y',
        className,
      )}
    >
      {contained ? <Container>{children}</Container> : children}
    </section>
  )
}
```

`components/site/primitives/eyebrow.tsx`:

```tsx
import type { ReactNode } from 'react'
import { cx } from '../../../utils/cx'

/** A short sentence-case label above a heading, marked with the signal dot. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cx('text-primary-ink mb-4 inline-flex items-center gap-2 text-sm font-semibold', className)}>
      <span aria-hidden="true" className="bg-signal h-1.5 w-1.5 rounded-full shadow-[0_0_10px_var(--signal)]" />
      {children}
    </p>
  )
}
```

`components/site/primitives/heading.tsx`:

```tsx
import type { ReactNode } from 'react'
import { cx } from '../../../utils/cx'

export type HeadingSize = 'display' | 'h1' | 'h2' | 'h3'

export interface HeadingProps {
  children: ReactNode
  /** Document outline level (h1-h3). */
  level: 1 | 2 | 3
  /** Visual size from the type scale; defaults to the level's own size. */
  size?: HeadingSize
  id?: string
  className?: string
}

const SIZE: Record<HeadingSize, string> = {
  display: 'text-display text-balance',
  h1: 'text-h1 text-balance',
  h2: 'text-h2 text-balance',
  h3: 'text-h3',
}

/** A heading on the site type scale; level and visual size are independent. */
export function Heading({ children, level, size, id, className }: HeadingProps) {
  const Tag = `h${level}` as const
  const visual = size ?? (level === 1 ? 'h1' : level === 2 ? 'h2' : 'h3')
  return (
    <Tag id={id} className={cx('text-ink', SIZE[visual], className)}>
      {children}
    </Tag>
  )
}

/** The paragraph under a section heading. */
export function Lead({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-ink-muted text-lead mt-5 max-w-[62ch] text-pretty', className)}>{children}</p>
}
```

`components/site/primitives/card.tsx`:

```tsx
import type { ElementType, ReactNode } from 'react'
import { cx } from '../../../utils/cx'

export interface CardProps {
  children: ReactNode
  className?: string
  as?: ElementType
  /** Adds hover lift + primary hairline, for cards that are links. */
  interactive?: boolean
}

/** A raised surface: hairline border, card radius, soft shadow. */
export function Card({ children, className, as: Tag = 'div', interactive = false }: CardProps) {
  return (
    <Tag
      className={cx(
        'border-hairline bg-surface-1 shadow-card rounded-card relative border backdrop-blur-sm',
        interactive &&
          'hover:border-primary/40 transition-[border-color,transform,box-shadow] duration-300 ease-out-expo hover:-translate-y-0.5 hover:shadow-glow motion-reduce:hover:translate-y-0',
        className,
      )}
    >
      {children}
    </Tag>
  )
}
```

`components/site/primitives/badge.tsx`:

```tsx
import type { ReactNode } from 'react'
import { cx } from '../../../utils/cx'

export type BadgeTone = 'neutral' | 'primary' | 'signal'

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-2 text-ink-muted border-hairline',
  primary: 'bg-primary/10 text-primary-ink border-primary/20',
  signal: 'bg-signal/10 text-signal border-signal/25',
}

/** A small pill label (category, status). */
export function Badge({ children, tone = 'neutral', className }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium', TONE[tone], className)}>
      {children}
    </span>
  )
}
```

`components/site/primitives/button-link.tsx`:

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cx } from '../../../utils/cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost'
export type ButtonSize = 'md' | 'lg'

const BASE =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold transition-[background-color,border-color,color,box-shadow] duration-200 disabled:pointer-events-none disabled:opacity-60'
const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary-strong text-primary-foreground shadow-glow hover:brightness-110',
  secondary: 'border border-hairline-strong bg-surface-1 text-ink hover:border-primary/50 hover:bg-surface-2',
  ghost: 'text-ink hover:bg-surface-2',
}
const SIZE: Record<ButtonSize, string> = {
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-[15px]',
}

/** Class names of a site button, for <button> elements. */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string): string {
  return cx(BASE, VARIANT[variant], SIZE[size], className)
}

export interface ButtonLinkProps {
  href: string
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

/** A link styled as a button; absolute http(s) URLs open as plain external links. */
export function ButtonLink({ href, children, variant = 'primary', size = 'md', className }: ButtonLinkProps) {
  const classes = buttonClasses(variant, size, className)
  if (/^https?:\/\//.test(href)) {
    return (
      <a href={href} className={classes} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    )
  }
  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  )
}
```

- [ ] **Step 8: Create CodeBlock and Reveal**

`components/site/primitives/code-block.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { cx } from '../../../utils/cx'

export interface CodeBlockProps {
  /** Plain source, copied to the clipboard. */
  code: string
  /** Pre-highlighted HTML from lib/highlight.ts (server-side only); plain code is shown when absent. */
  html?: string | null
  /** Caption in the block's top bar, e.g. a file name or "Terminal". */
  label?: string
  className?: string
}

/** A code sample with a copy button; "Copied" is announced through a live region. */
export function CodeBlock({ code, html, label, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <figure
      className={cx(
        'border-hairline bg-code rounded-card group relative overflow-hidden border text-left shadow-card',
        className,
      )}
    >
      <div className="border-hairline flex h-11 items-center justify-between gap-3 border-b pr-2 pl-4">
        <figcaption className="text-ink-muted truncate font-mono text-xs">{label ?? ''}</figcaption>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-ink-muted hover:text-ink hover:bg-surface-2 inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium transition-colors"
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            {copied ? (
              <path d="M20 6 9 17l-5-5" />
            ) : (
              <>
                <rect x="9" y="9" width="12" height="12" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </>
            )}
          </svg>
          {copied ? 'Copied' : 'Copy'}
        </button>
        <span role="status" aria-live="polite" className="sr-only">
          {copied ? 'Copied' : ''}
        </span>
      </div>
      {html ? (
        <div
          className="overflow-x-auto p-4 font-mono text-[13px] leading-6 [&_pre]:outline-none"
          // Trusted: produced at build/SSR time by lib/highlight.ts from literals in this repo.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="text-ink overflow-x-auto p-4 font-mono text-[13px] leading-6">
          <code>{code}</code>
        </pre>
      )}
    </figure>
  )
}
```

`components/site/primitives/reveal.tsx`:

```tsx
import { useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'
import { cx } from '../../../utils/cx'

export interface RevealProps {
  children: ReactNode
  className?: string
  as?: ElementType
  /** Delay in ms once the element enters the viewport (for staggering siblings). */
  delay?: number
}

type Phase = 'static' | 'hidden' | 'shown'

/**
 * Fades and lifts its children in when they scroll into view. Server markup is
 * fully visible; only elements still below the fold are hidden after mount, so
 * nothing above the fold flashes and nothing is lost without JavaScript. Off
 * under prefers-reduced-motion.
 */
export function Reveal({ children, className, as: Tag = 'div', delay = 0 }: RevealProps) {
  const ref = useRef<HTMLElement>(null)
  const [phase, setPhase] = useState<Phase>('static')

  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    if (el.getBoundingClientRect().top < window.innerHeight) return
    setPhase('hidden')
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setPhase('shown')
          observer.disconnect()
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref}
      style={phase === 'shown' && delay ? { transitionDelay: `${delay}ms` } : undefined}
      className={cx(
        phase !== 'static' && 'transition-[opacity,transform] duration-700 ease-out-expo',
        phase === 'hidden' && 'translate-y-4 opacity-0',
        className,
      )}
    >
      {children}
    </Tag>
  )
}
```

`components/site/primitives/index.ts`:

```ts
export { Container, type ContainerProps } from './container'
export { Section, type SectionProps } from './section'
export { Eyebrow } from './eyebrow'
export { Heading, Lead, type HeadingProps, type HeadingSize } from './heading'
export { Card, type CardProps } from './card'
export { Badge, type BadgeTone } from './badge'
export { ButtonLink, buttonClasses, type ButtonLinkProps, type ButtonSize, type ButtonVariant } from './button-link'
export { CodeBlock, type CodeBlockProps } from './code-block'
export { Reveal, type RevealProps } from './reveal'
```

- [ ] **Step 9: Verify**

Run: `pnpm exec tsc --noEmit && pnpm lint`
Expected: no output from tsc, no lint errors or warnings.

Run: `pnpm build`
Expected: build succeeds; `/?app=…`, `/console` and the profile pages still show the logo at its old size (no class is passed now).

- [ ] **Step 10: Commit**

```bash
git add styles/globals.css utils/cx.ts components/site/primitives components/ui/renown-logo.tsx components/ui/theme-toggle.tsx components/ui/page-background.tsx
git commit -m "feat(site): design tokens and layout primitives"
```

---

## Task 2: SEO helpers, PageMeta and the OG image route

**Files:**
- Create: `utils/seo.ts`, `components/site/page-meta.tsx`, `lib/og/og-data.ts`, `pages/api/og.tsx`
- Test: `e2e/og.spec.ts`

**Interfaces:**
- Consumes: `APP_DID_RE` (`services/app-profiles.ts`), `mediaUrl`, `switchboardOrigin` (`services/media.ts`), `SWITCHBOARD_ENDPOINT` (`services/switchboard-endpoint.ts`), Inter TTFs in `assets/fonts/`.
- Produces: `publicOrigin`, `canonicalUrl`, `ogImageUrl`, `OgImageParams`, `SITE_NAME`, `DEFAULT_DESCRIPTION`, `PageMeta`/`PageMetaProps`; `GET /api/og?variant=default|profile&address=…|app&did=…` → 200 `image/png` 1200×630 with header `X-Og-Variant`.

- [ ] **Step 1: Write the failing test** — `e2e/og.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { fixtureStub } from './support/stub-switchboard-client'

// Fixtures use ids no other spec uses (they survive renown-writes.spec.ts's resets).
// The OG route (pages/api/og.tsx) against the stub switchboard.
const ADDRESS = '0x5e00000000000000000000000000000000000c01'
const BROKEN = '0x5e00000000000000000000000000000000000c02'
const APP_DID = 'did:key:z6MkSeoAppxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1'
const profile = (documentId: string, avatar: string | null) => ({
  documentId,
  displayName: 'Olga Graph',
  username: null,
  handle: 'olga',
  avatar,
  userImage: null,
})

test.beforeAll(async () => {
  await fixtureStub({ match: 'OgProfile', variables: ADDRESS, response: { data: { renownUsers: [profile('seo-doc-1', null)] } } })
  // Its avatar is not stored on the stub: the image fetch 404s.
  await fixtureStub({
    match: 'OgProfile',
    variables: BROKEN,
    response: { data: { renownUsers: [profile('seo-doc-broken', `attachment://v1:${'a'.repeat(64)}`)] } },
  })
  await fixtureStub({
    match: 'OgApp',
    variables: APP_DID,
    response: { data: { appProfile: { documentId: 'stub-app-doc', name: 'Seo App', tagline: 'Found everywhere', category: 'Tools', logo: null, logoRef: `attachment://v1:${'1'.repeat(64)}` } } },
  })
})

test.describe('link-preview images', () => {
  const variantOf = async (request: import('@playwright/test').APIRequestContext, query: string) => {
    const response = await request.get(`/api/og${query}`)
    expect(response.status(), query).toBe(200)
    expect(response.headers()['content-type'], query).toBe('image/png')
    return response.headers()['x-og-variant']
  }

  test('render the default, profile and app cards', async ({ request }) => {
    expect(await variantOf(request, '')).toBe('default')
    expect(await variantOf(request, `?variant=profile&address=${ADDRESS}`)).toBe('profile')
    expect(await variantOf(request, `?variant=app&did=${APP_DID}`)).toBe('app')
  })

  test('fall back to the default card on bad input, unknown ids and broken images', async ({ request }) => {
    expect(await variantOf(request, '?variant=profile&address=nope')).toBe('default')
    expect(await variantOf(request, '?variant=profile&address=0x5e00000000000000000000000000000000000c99')).toBe('default')
    expect(await variantOf(request, `?variant=profile&address=${BROKEN}`)).toBe('default')
    expect(await variantOf(request, '?variant=app&did=did:web:nope')).toBe('default')
    expect(await variantOf(request, '?variant=bogus')).toBe('default')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec playwright test e2e/og.spec.ts --workers=3`
Expected: FAIL — `/api/og` answers 404 (`expect(response.status()).toBe(200)` received 404).

- [ ] **Step 3: Create `utils/seo.ts`**

```ts
/** Canonical origin of the public site (NEXT_PUBLIC_RENOWN_URL, else www.renown.id), without a trailing slash. */
export function publicOrigin(): string {
  return (process.env.NEXT_PUBLIC_RENOWN_URL || 'https://www.renown.id').replace(/\/+$/, '')
}

/** Absolute canonical URL of a site path ("/" or "/developers"). */
export function canonicalUrl(path: string): string {
  const clean = path === '/' ? '' : path.startsWith('/') ? path : `/${path}`
  return `${publicOrigin()}${clean}`
}

export type OgImageParams =
  | { variant: 'default' }
  /** A profile card, looked up by the wallet address of the profile. */
  | { variant: 'profile'; address: string }
  /** An app card, looked up by the app DID. */
  | { variant: 'app'; did: string }

/** Absolute URL of the generated link-preview image (pages/api/og.tsx). */
export function ogImageUrl(params: OgImageParams = { variant: 'default' }, origin = publicOrigin()): string {
  const query = new URLSearchParams({ variant: params.variant })
  if (params.variant === 'profile') query.set('address', params.address.toLowerCase())
  if (params.variant === 'app') query.set('did', params.did)
  return `${origin}/api/og?${query.toString()}`
}

export const SITE_NAME = 'Renown'
export const DEFAULT_DESCRIPTION =
  'Renown is the identity layer of the Powerhouse network: one wallet-backed ID to sign in to every app, sign your work, and revoke access whenever you choose.'
```

- [ ] **Step 4: Create `components/site/page-meta.tsx`**

```tsx
import Head from 'next/head'
import { canonicalUrl, DEFAULT_DESCRIPTION, ogImageUrl, SITE_NAME } from '../../utils/seo'

export interface PageMetaProps {
  /** Page title without the site suffix ("Developers"); omit on the homepage. */
  title?: string
  description?: string
  /** Site path for the canonical URL ("/developers"). Omit for pages that must not be canonicalised. */
  path?: string
  /** Absolute link-preview image; defaults to the generated default card. */
  image?: string
  /** summary_large_image (default) or summary. */
  twitterCard?: 'summary' | 'summary_large_image'
  ogType?: 'website' | 'profile' | 'article'
  /** Adds robots noindex (404, 500, private pages). */
  noindex?: boolean
  /** JSON-LD objects rendered as application/ld+json scripts. */
  jsonLd?: object[]
}

/** Every page's <head> SEO block: title, description, canonical, Open Graph, Twitter, JSON-LD. */
export function PageMeta({
  title,
  description = DEFAULT_DESCRIPTION,
  path,
  image = ogImageUrl(),
  twitterCard = 'summary_large_image',
  ogType = 'website',
  noindex = false,
  jsonLd = [],
}: PageMetaProps) {
  const fullTitle = title ? `${title} - ${SITE_NAME}` : `${SITE_NAME} - One identity for the Powerhouse network`
  const url = path ? canonicalUrl(path) : null
  return (
    <Head>
      <title>{fullTitle}</title>
      <meta name="description" content={description} key="description" />
      {noindex && <meta name="robots" content="noindex" key="robots" />}
      {url && <link rel="canonical" href={url} key="canonical" />}
      <meta property="og:site_name" content={SITE_NAME} key="og:site_name" />
      <meta property="og:type" content={ogType} key="og:type" />
      <meta property="og:title" content={title ?? SITE_NAME} key="og:title" />
      <meta property="og:description" content={description} key="og:description" />
      {url && <meta property="og:url" content={url} key="og:url" />}
      <meta property="og:image" content={image} key="og:image" />
      <meta name="twitter:card" content={twitterCard} key="twitter:card" />
      <meta name="twitter:title" content={title ?? SITE_NAME} key="twitter:title" />
      <meta name="twitter:description" content={description} key="twitter:description" />
      <meta name="twitter:image" content={image} key="twitter:image" />
      {jsonLd.map((data, index) => (
        <script
          key={`ld-${index}`}
          type="application/ld+json"
          // JSON.stringify output with "<" escaped cannot break out of the script element.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, '\\u003c') }}
        />
      ))}
    </Head>
  )
}
```

- [ ] **Step 5: Create the OG data loader** — `lib/og/og-data.ts`:

```ts
// Data for the link-preview route (pages/api/og.tsx, edge runtime): plain
// fetch only. Every failure throws; the route answers with the default card.
import { APP_DID_RE } from '../../services/app-profiles'
import { mediaUrl, switchboardOrigin } from '../../services/media'
import { SWITCHBOARD_ENDPOINT } from '../../services/switchboard-endpoint'

export const OG_FETCH_TIMEOUT_MS = 2500
const ADDRESS_RE = /^0x[0-9a-f]{40}$/
const MAX_IMAGE_BYTES = 4 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])

export type OgCard =
  | { variant: 'default' }
  | { variant: 'profile'; name: string; handle: string | null; address: string; image: string | null }
  | { variant: 'app'; name: string; tagline: string | null; category: string | null; logo: string | null }

async function graphql<T>(endpoint: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(OG_FETCH_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`GraphQL ${response.status}`)
  const body = (await response.json()) as { data?: T; errors?: unknown[] }
  if (!body.data || body.errors?.length) throw new Error('GraphQL error')
  return body.data
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Fetches an image as a data URL (PNG/JPEG/GIF, at most 4 MB); throws on anything else. */
export async function fetchImageDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(OG_FETCH_TIMEOUT_MS), redirect: 'follow' })
  const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (!response.ok || !IMAGE_TYPES.has(type)) throw new Error(`Unusable image (${response.status} ${type})`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > MAX_IMAGE_BYTES) throw new Error('Image too large')
  return `data:${type};base64,${toBase64(bytes)}`
}

interface ProfileRow {
  documentId: string
  displayName: string | null
  username: string | null
  handle: string | null
  avatar: string | null
  userImage: string | null
}

/** The profile card for a wallet; null when there is no such profile. */
export async function loadProfileCard(address: string, origin: string): Promise<OgCard | null> {
  const lower = address.toLowerCase()
  if (!ADDRESS_RE.test(lower)) return null
  const data = await graphql<{ renownUsers: ProfileRow[] }>(
    SWITCHBOARD_ENDPOINT,
    `query OgProfile($input: RenownUsersInput!) { renownUsers(input: $input) { documentId displayName username handle avatar userImage } }`,
    { input: { driveId: `renown-${lower}`, ethAddresses: [lower] } },
  )
  const profile = data.renownUsers[0]
  if (!profile) return null
  const imageUrl = profile.avatar
    ? mediaUrl(profile.documentId, 'avatar', origin, profile.avatar)
    : profile.userImage && /^https:\/\//i.test(profile.userImage)
      ? profile.userImage
      : null
  return {
    variant: 'profile',
    name: profile.displayName || profile.username || `${lower.slice(0, 6)}…${lower.slice(-4)}`,
    handle: profile.handle,
    address: lower,
    image: imageUrl ? await fetchImageDataUrl(imageUrl) : null,
  }
}

interface AppRow {
  documentId: string
  name: string | null
  tagline: string | null
  category: string | null
  logo: string | null
  logoRef: string | null
}

/** The app card for an app DID; null when there is no such app. */
export async function loadAppCard(did: string, origin: string): Promise<OgCard | null> {
  if (!APP_DID_RE.test(did)) return null
  const data = await graphql<{ appProfile: AppRow | null }>(
    `${switchboardOrigin()}/graphql/renown-stats`,
    `query OgApp($appDid: String!) { appProfile(appDid: $appDid) { documentId name tagline category logo logoRef } }`,
    { appDid: did },
  )
  const app = data.appProfile
  if (!app) return null
  const logoUrl = app.logoRef
    ? mediaUrl(app.documentId, 'logo', origin, app.logoRef)
    : app.logo && /^https:\/\//i.test(app.logo)
      ? app.logo
      : null
  return {
    variant: 'app',
    name: app.name || 'Untitled app',
    tagline: app.tagline,
    category: app.category,
    logo: logoUrl ? await fetchImageDataUrl(logoUrl) : null,
  }
}
```

- [ ] **Step 6: Create the edge route** — `pages/api/og.tsx`:

```tsx
import { ImageResponse } from 'next/og'
import type { NextRequest } from 'next/server'
import { loadAppCard, loadProfileCard, type OgCard } from '../../lib/og/og-data'

// Link-preview images: /api/og?variant=default | profile&address=0x… | app&did=did:key:…
// Any lookup or image failure answers with the default card (always 200).
export const config = { runtime: 'edge' }

const SIZE = { width: 1200, height: 630 }
const INK = '#F4F7FF'
const MUTED = '#94A3B8'
const BG = '#050A1A'
const SIGNAL = '#21FFB4'
const BLUE = '#0080FF'

const fonts = Promise.all([
  fetch(new URL('../../assets/fonts/Inter-Regular.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
  fetch(new URL('../../assets/fonts/Inter-SemiBold.ttf', import.meta.url)).then((r) => r.arrayBuffer()),
])

function Sparkle({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 66 66">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={SIGNAL} />
          <stop offset="1" stopColor={BLUE} />
        </linearGradient>
      </defs>
      <path d="M31.3 1C28.2 12 20 20.6 9.4 23.8c-1.3.4-1.3 2.3 0 2.7C20 29.7 28.2 38.3 31.3 49.3c.4 1.4 2.3 1.4 2.7 0 3.1-11 11.4-19.6 21.9-22.8 1.3-.4 1.3-2.3 0-2.7C45.4 20.6 37.1 12 34 1c-.4-1.4-2.3-1.4-2.7 0Z" fill="url(#g)" />
    </svg>
  )
}

function Frame({ children, footer }: { children: React.ReactNode; footer: string }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        backgroundColor: BG,
        backgroundImage: `radial-gradient(circle at 85% 10%, rgba(0,128,255,0.35), transparent 45%), radial-gradient(circle at 5% 0%, rgba(33,255,180,0.14), transparent 40%)`,
        color: INK,
        fontFamily: 'Inter',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Sparkle size={40} />
        <span style={{ fontSize: 36, fontWeight: 600, letterSpacing: -1 }}>Renown</span>
      </div>
      {children}
      <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>{footer}</div>
    </div>
  )
}

function Monogram({ text, size, radius }: { text: string; size: number; radius: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: size * 0.42,
        fontWeight: 600,
        color: INK,
        backgroundImage: `linear-gradient(135deg, ${SIGNAL}, ${BLUE})`,
      }}
    >
      {text.trim().charAt(0).toUpperCase() || '?'}
    </div>
  )
}

function render(card: OgCard) {
  if (card.variant === 'profile') {
    return (
      <Frame footer={card.handle ? `renown.id/@${card.handle}` : 'renown.id'}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
          {card.image ? (
            // eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img>
            <img src={card.image} width={220} height={220} alt="" style={{ borderRadius: 220, objectFit: 'cover', border: `4px solid ${BLUE}` }} />
          ) : (
            <Monogram text={card.name} size={220} radius={220} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>
            <span style={{ fontSize: 72, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>{card.name}</span>
            {card.handle && <span style={{ fontSize: 34, color: SIGNAL }}>@{card.handle}</span>}
            <span style={{ fontSize: 26, color: MUTED }}>{`${card.address.slice(0, 6)}…${card.address.slice(-4)} on Renown`}</span>
          </div>
        </div>
      </Frame>
    )
  }
  if (card.variant === 'app') {
    return (
      <Frame footer="An app on Renown">
        <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
          {card.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img>
            <img src={card.logo} width={200} height={200} alt="" style={{ borderRadius: 44, objectFit: 'cover' }} />
          ) : (
            <Monogram text={card.name} size={200} radius={44} />
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 760 }}>
            {card.category && <span style={{ fontSize: 24, color: SIGNAL }}>{card.category}</span>}
            <span style={{ fontSize: 72, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }}>{card.name}</span>
            {card.tagline && <span style={{ fontSize: 32, color: MUTED, lineHeight: 1.3 }}>{card.tagline}</span>}
          </div>
        </div>
      </Frame>
    )
  }
  return (
    <Frame footer="www.renown.id">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 24, maxWidth: 900 }}>
        <span style={{ fontSize: 84, fontWeight: 600, letterSpacing: -3, lineHeight: 1.02 }}>One identity for the Powerhouse network</span>
        <span style={{ fontSize: 30, color: MUTED }}>Sign in everywhere. Sign your work. Revoke access any time.</span>
      </div>
    </Frame>
  )
}

async function loadCard(url: URL): Promise<OgCard> {
  const variant = url.searchParams.get('variant')
  try {
    if (variant === 'profile') return (await loadProfileCard(url.searchParams.get('address') ?? '', url.origin)) ?? { variant: 'default' }
    if (variant === 'app') return (await loadAppCard(url.searchParams.get('did') ?? '', url.origin)) ?? { variant: 'default' }
  } catch (error) {
    console.error('og: falling back to the default card:', error)
  }
  return { variant: 'default' }
}

export default async function handler(req: NextRequest) {
  const url = new URL(req.url)
  const card = await loadCard(url)
  const [regular, semibold] = await fonts
  return new ImageResponse(render(card), {
    ...SIZE,
    fonts: [
      { name: 'Inter', data: regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: semibold, weight: 600, style: 'normal' },
    ],
    headers: {
      'Cache-Control': 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
      'X-Og-Variant': card.variant,
    },
  })
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm exec playwright test e2e/og.spec.ts --workers=3`
Expected: 2 passed. The dev log shows `og: falling back to the default card: Error: Unusable image (404 application/json)` for the broken-avatar case — that is the fallback working.

Also eyeball the default card: `curl -s -o /tmp/og.png http://localhost:3000/api/og` while `pnpm dev` runs, and open it — dark navy, Renown sparkle + wordmark, "One identity for the Powerhouse network".

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add utils/seo.ts components/site/page-meta.tsx lib/og pages/api/og.tsx e2e/og.spec.ts
git commit -m "feat(seo): page meta helper and generated link-preview images"
```

---

## Task 3: Site shell, error pages and the auth chrome

**Files:**
- Create: `components/site/{nav.ts,account-links.ts,use-site-auth.ts,account-menu.tsx,auth-slot.tsx,mobile-nav.tsx,site-header.tsx,site-footer.tsx,site-backdrop.tsx,site-layout.tsx,error-state.tsx}`, `hooks/use-own-profile.ts`, `pages/404.tsx`, `pages/500.tsx`, `e2e/support/site.ts`
- Modify: `styles/globals.css` (drawer keyframes), `pages/_app.tsx`, `pages/console.tsx`, `pages/oidc/login.tsx`, `package.json`/`pnpm-lock.yaml` (`@axe-core/playwright`)
- Test: `e2e/site-shell.spec.ts`

**Interfaces:**
- Consumes: Task 1 primitives and tokens; `PageMeta` (Task 2); `useRenownAuth` from `@powerhousedao/reactor-browser/renown`; `getProfile` (`services/switchboard.ts`); `ProfileAvatar`; `RenownLogo`, `ThemeToggle`, `PhIconsBackground`; `profilePath` (`utils/profile-url.ts`).
- Produces: `SiteLayout`, `SiteHeader`, `SiteFooter`, nav constants, `useSiteAuth`/`SiteAuth`, `accountLinks`, `shortAddress`, `ErrorState`, `useOwnProfile(address): RenownProfile | null`; e2e helpers `useTheme`, `expectNoSeriousA11yViolations`, `attachScreenshots`.

- [ ] **Step 1: Install axe for Playwright**

```bash
pnpm add -w -D @axe-core/playwright@4.13.0
```

- [ ] **Step 2: Create the e2e helpers** — `e2e/support/site.ts`:

```ts
// Shared helpers for the site-polish specs: theme, axe and screenshots.
import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type TestInfo } from '@playwright/test'

export type Theme = 'light' | 'dark'

/** Pins next-themes to `theme` for every page load of this page's context. */
export async function useTheme(page: Page, theme: Theme): Promise<void> {
  await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' })
  await page.addInitScript((value) => {
    try {
      localStorage.setItem('theme', value)
    } catch {
      // storage blocked: the emulated colour scheme still applies
    }
  }, theme)
}

/** Fails on serious or critical axe violations (WCAG 2.x A/AA rules). */
export async function expectNoSeriousA11yViolations(page: Page): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    // Third-party wallet modals are not part of the page under test.
    .exclude('[data-rk]')
    .analyze()
  const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(', ')})`),
  ).toEqual([])
}

/** Full-page screenshots at 390 and 1280 px, attached to the test report. */
export async function attachScreenshots(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    await page.waitForTimeout(200)
    const body = await page.screenshot({ fullPage: true })
    await testInfo.attach(`${name}-${width}.png`, { body, contentType: 'image/png' })
  }
}
```

- [ ] **Step 3: Write the failing test** — `e2e/site-shell.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

// Header, footer and mobile drawer, on the 404 page (site layout, no data).
const PAGE = '/no-such-page'

test.describe('site header', () => {
  test('shows the primary nav, theme toggle and sign-in', async ({ page }) => {
    await page.goto(PAGE)
    const nav = page.getByRole('banner').getByRole('navigation', { name: 'Main' })
    for (const [label, href] of [
      ['Apps', '/apps'],
      ['Developers', '/developers'],
      ['Trust', '/trust'],
      ['Ecosystem', '/ecosystem'],
    ]) {
      await expect(nav.getByRole('link', { name: label })).toHaveAttribute('href', href)
    }
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Renown home' })).toHaveAttribute('href', '/')
    await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible()
    await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
  })

  test('the skip link jumps to the main content', async ({ page }) => {
    await page.goto(PAGE)
    // Hydrated once the session check settles; Tab before that can land anywhere.
    await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Tab')
    const skip = page.getByRole('link', { name: 'Skip to content' })
    await expect(skip).toBeFocused()
    await expect(skip).toHaveAttribute('href', '#main')
    await expect(page.locator('main#main')).toHaveCount(1)
  })
})

test.describe('site footer', () => {
  test('links products, developers, ecosystem and legal pages', async ({ page }) => {
    await page.goto(PAGE)
    const footer = page.getByRole('contentinfo')
    const expected: Array<[string, string]> = [
      ['Apps', '/apps'],
      ['Your Renown', '/me'],
      ['App stats docs', 'https://www.vetra.io/docs/app-stats'],
      ['GitHub', 'https://github.com/powerhouse-inc'],
      ['Vetra', 'https://www.vetra.io'],
      ['Powerhouse', 'https://www.powerhouse.inc'],
      ['Privacy', 'https://www.vetra.io/privacy-policy'],
      ['Terms', 'https://www.vetra.io/terms-and-conditions'],
      ['Powerhouse on X', 'https://x.com/PowerhouseDAO'],
    ]
    for (const [name, href] of expected) {
      await expect(footer.getByRole('link', { name, exact: true })).toHaveAttribute('href', href)
    }
    await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('rel', /noopener/)
    await expect(footer).toContainText(`© ${new Date().getFullYear()} Powerhouse`)
  })
})

test.describe('mobile drawer', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('opens from the keyboard, traps focus, and Esc returns focus to the toggle', async ({ page }) => {
    await page.goto(PAGE)
    await expect(page.getByRole('banner').getByRole('navigation', { name: 'Main' })).toBeHidden()
    const toggle = page.getByRole('button', { name: 'Open menu' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.focus()
    await page.keyboard.press('Enter')

    const drawer = page.getByRole('dialog', { name: 'Menu' })
    await expect(drawer).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(drawer.getByRole('button', { name: 'Close menu' })).toBeFocused()
    await expect(drawer.getByRole('link', { name: 'Ecosystem' })).toHaveAttribute('href', '/ecosystem')

    // Shift+Tab from the first element wraps to the last one inside the drawer.
    await page.keyboard.press('Shift+Tab')
    expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab')
      expect(await drawer.evaluate((el) => el.contains(document.activeElement))).toBe(true)
    }

    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

test.describe('auth screens keep the minimal chrome', () => {
  for (const path of ['/console?session=chrome-test', '/oidc/login', '/?app=did:web:chrome.example']) {
    test(`${path} has no site nav, footer or header sign-in`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByRole('button', { name: 'Toggle theme' })).toBeVisible()
      await expect(page.locator('svg[aria-label="Renown"]')).toBeVisible()
      await expect(page.getByRole('banner')).toHaveCount(0)
      await expect(page.getByRole('contentinfo')).toHaveCount(0)
      await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0)
      await expect(page.getByRole('link', { name: 'Skip to content' })).toHaveCount(0)
    })
  }
})
```

- [ ] **Step 4: Run it to verify it fails**

Run: `pnpm exec playwright test e2e/site-shell.spec.ts --workers=3`
Expected: FAIL — on `/no-such-page` there is no `banner` (the default Next 404), so `getByRole('banner')…` times out. The three auth-chrome tests already pass (they pin today's behaviour).

- [ ] **Step 5: Navigation config** — `components/site/nav.ts`:

```ts
// Every link the site chrome shows, in one place (header, drawer, footer).

export interface NavLink {
  label: string
  href: string
}

export interface FooterColumn {
  title: string
  links: NavLink[]
}

/** Primary navigation (header and mobile drawer). */
export const SITE_NAV: NavLink[] = [
  { label: 'Apps', href: '/apps' },
  { label: 'Developers', href: '/developers' },
  { label: 'Trust', href: '/trust' },
  { label: 'Ecosystem', href: '/ecosystem' },
]

export const PRIVACY_URL = 'https://www.vetra.io/privacy-policy'
export const TERMS_URL = 'https://www.vetra.io/terms-and-conditions'
export const GITHUB_URL = 'https://github.com/powerhouse-inc'
export const X_URL = 'https://x.com/PowerhouseDAO'
export const VETRA_URL = 'https://www.vetra.io'
export const POWERHOUSE_URL = 'https://www.powerhouse.inc'
export const APP_STATS_DOCS_URL = 'https://www.vetra.io/docs/app-stats'

export const FOOTER_COLUMNS: FooterColumn[] = [
  {
    title: 'Product',
    links: [
      { label: 'Apps', href: '/apps' },
      { label: 'Your Renown', href: '/me' },
      { label: 'Trust', href: '/trust' },
    ],
  },
  {
    title: 'Developers',
    links: [
      { label: 'Developers', href: '/developers' },
      { label: 'App stats docs', href: APP_STATS_DOCS_URL },
      { label: 'GitHub', href: GITHUB_URL },
    ],
  },
  {
    title: 'Ecosystem',
    links: [
      { label: 'Ecosystem', href: '/ecosystem' },
      { label: 'Vetra', href: VETRA_URL },
      { label: 'Powerhouse', href: POWERHOUSE_URL },
    ],
  },
  {
    title: 'Legal',
    links: [
      { label: 'Privacy', href: PRIVACY_URL },
      { label: 'Terms', href: TERMS_URL },
    ],
  },
]

/** True when `pathname` is `href` or below it (for aria-current). */
export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href)
}
```

- [ ] **Step 6: Own-profile hook and account links**

`hooks/use-own-profile.ts`:

```ts
import { useEffect, useState } from 'react'
import { getProfile, type RenownProfile } from '../services/switchboard'

/**
 * The signed-in wallet's Renown profile (null while loading, when there is
 * none, or when the read failed). Re-reads when the address changes.
 */
export function useOwnProfile(address: string | undefined): RenownProfile | null {
  const [state, setState] = useState<{ address: string; profile: RenownProfile | null } | null>(null)

  useEffect(() => {
    if (!address) return
    let cancelled = false
    const lower = address.toLowerCase()
    void getProfile({ driveId: `renown-${lower}`, ethAddress: lower }).then((profile) => {
      if (!cancelled) setState({ address, profile })
    })
    return () => {
      cancelled = true
    }
  }, [address])

  return state && state.address === address ? state.profile : null
}
```

`components/site/account-links.ts`:

```ts
import { profilePath } from '../../utils/profile-url'
import type { NavLink } from './nav'

/** The signed-in user's destinations (header menu and mobile drawer). */
export function accountLinks(address: string, profile: { handle?: string | null; documentId: string } | null): NavLink[] {
  return [
    { label: 'Your Renown', href: '/me' },
    { label: 'Your profile', href: profile?.handle ? profilePath(profile) : `/profile/${address}` },
    { label: 'Edit profile', href: '/profile/edit' },
  ]
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}
```

`components/site/use-site-auth.ts`:

```ts
import { useRenownAuth } from '@powerhousedao/reactor-browser/renown'
import { useOwnProfile } from '../../hooks/use-own-profile'
import type { RenownProfile } from '../../services/switchboard'

export type SiteAuth =
  | { state: 'loading' }
  | { state: 'signed-out'; login: () => void }
  | {
      state: 'signed-in'
      address: string
      displayName: string | null
      avatarUrl: string | null
      profile: RenownProfile | null
      logout: () => void
    }

/** The visitor's session as the site chrome needs it. */
export function useSiteAuth(): SiteAuth {
  const { user, status, displayName, avatarUrl, login, logout } = useRenownAuth()
  const profile = useOwnProfile(user?.address)
  if (status === undefined || status === 'loading' || status === 'checking') return { state: 'loading' }
  if (!user) return { state: 'signed-out', login: () => void login() }
  return {
    state: 'signed-in',
    address: user.address,
    displayName: displayName ?? null,
    avatarUrl: avatarUrl ?? null,
    profile,
    logout: () => void logout(),
  }
}
```

- [ ] **Step 7: Account menu and auth slot**

`components/site/account-menu.tsx`:

```tsx
import Link from 'next/link'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ProfileAvatar } from '../profile/profile-avatar'
import type { RenownProfile } from '../../services/switchboard'
import { accountLinks, shortAddress } from './account-links'

export interface AccountMenuProps {
  address: string
  displayName?: string | null
  /** External avatar (ENS or legacy URL) from the session. */
  avatarUrl?: string | null
  profile: RenownProfile | null
  onSignOut: () => void
}

/** The signed-in avatar button and its menu. Esc closes and returns focus; arrows move between items. */
export function AccountMenu({ address, displayName, avatarUrl, profile, onSignOut }: AccountMenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const name = displayName || profile?.displayName || shortAddress(address)

  useEffect(() => {
    if (!open) return
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    return () => document.removeEventListener('mousedown', onPointer)
  }, [open])

  function close() {
    setOpen(false)
    buttonRef.current?.focus()
  }

  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      items[(index + 1) % items.length]?.focus()
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      items[(index - 1 + items.length) % items.length]?.focus()
    } else if (event.key === 'Tab') {
      setOpen(false)
    }
  }

  const itemClass =
    'text-ink hover:bg-surface-2 focus-visible:bg-surface-2 flex w-full items-center rounded-lg px-3 py-2 text-left text-sm outline-none'

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${name}`}
        onClick={() => setOpen((value) => !value)}
        className="border-hairline-strong hover:border-primary/50 flex h-10 items-center gap-2 rounded-full border py-1 pr-3 pl-1 transition-colors"
      >
        <ProfileAvatar
          documentId={profile?.documentId}
          avatar={profile?.avatar}
          userImage={avatarUrl ?? profile?.userImage}
          seed={address}
          alt=""
          className="h-8 w-8"
        />
        <span className="text-ink max-w-[10rem] truncate text-sm font-medium">{name}</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`text-ink-muted transition-transform ${open ? 'rotate-180' : ''}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Account"
          onKeyDown={onMenuKey}
          className="border-hairline bg-background shadow-modal absolute top-12 right-0 z-50 w-60 rounded-2xl border p-1.5"
        >
          <div className="border-hairline mb-1 border-b px-3 pt-2 pb-3">
            <p className="text-ink truncate text-sm font-semibold">{name}</p>
            <p className="text-ink-muted font-mono text-xs">{shortAddress(address)}</p>
          </div>
          {accountLinks(address, profile).map((link) => (
            <Link key={link.href} href={link.href} role="menuitem" className={itemClass} onClick={() => setOpen(false)}>
              {link.label}
            </Link>
          ))}
          <button
            type="button"
            role="menuitem"
            className={`${itemClass} text-destructive`}
            onClick={() => {
              setOpen(false)
              onSignOut()
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
```

`components/site/auth-slot.tsx`:

```tsx
import { buttonClasses } from './primitives'
import { AccountMenu } from './account-menu'
import type { SiteAuth } from './use-site-auth'

/** Header auth control: a placeholder while the session restores, "Sign in", or the account menu. */
export function AuthSlot({ auth }: { auth: SiteAuth }) {
  if (auth.state === 'loading') {
    return <span aria-hidden="true" className="bg-surface-2 block h-10 w-[92px] animate-pulse rounded-full" />
  }
  if (auth.state === 'signed-out') {
    return (
      <button type="button" onClick={auth.login} className={buttonClasses('secondary', 'md')}>
        Sign in
      </button>
    )
  }
  return (
    <AccountMenu
      address={auth.address}
      displayName={auth.displayName}
      avatarUrl={auth.avatarUrl}
      profile={auth.profile}
      onSignOut={auth.logout}
    />
  )
}
```

- [ ] **Step 8: Mobile drawer.** Create `components/site/mobile-nav.tsx`:

```tsx
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../../utils/cx'
import { accountLinks } from './account-links'
import { isActivePath, SITE_NAV } from './nav'
import { buttonClasses } from './primitives'
import type { SiteAuth } from './use-site-auth'

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The < 768 px navigation: a toggle button and a modal drawer. Focus moves into
 * the drawer, Tab cycles inside it, Esc / a link / the close button close it and
 * focus returns to the toggle.
 */
export function MobileNav({ auth }: { auth: SiteAuth }) {
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const { pathname, events } = useRouter()

  useEffect(() => {
    if (!open) return
    panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    const onRoute = () => setOpen(false)
    events.on('routeChangeStart', onRoute)
    return () => {
      document.body.style.overflow = overflow
      events.off('routeChangeStart', onRoute)
    }
  }, [open, events])

  function close() {
    setOpen(false)
    toggleRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const items = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])
    if (items.length === 0) return
    const first = items[0]
    const last = items[items.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const linkClass = 'text-ink hover:bg-surface-2 block rounded-xl px-3 py-3 text-lg font-medium'

  return (
    <div className="md:hidden">
      <button
        ref={toggleRef}
        type="button"
        aria-expanded={open}
        aria-controls="site-drawer"
        aria-label="Open menu"
        onClick={() => setOpen(true)}
        className="text-ink hover:bg-surface-2 flex h-10 w-10 items-center justify-center rounded-full"
      >
        <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>
      {open && (
        <div className="fixed inset-0 z-50">
          <div aria-hidden="true" className="bg-background/70 absolute inset-0 backdrop-blur-sm" onClick={close} />
          <div
            id="site-drawer"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
            onKeyDown={onKeyDown}
            className="border-hairline bg-background absolute inset-y-0 right-0 flex w-[min(20rem,88vw)] flex-col border-l p-4 shadow-modal motion-safe:animate-[drawer-in_280ms_var(--ease-out-expo)]"
          >
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                aria-label="Close menu"
                onClick={close}
                className="text-ink hover:bg-surface-2 flex h-10 w-10 items-center justify-center rounded-full"
              >
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6 6 18" />
                </svg>
              </button>
            </div>
            <nav aria-label="Main">
              <ul className="space-y-1">
                {SITE_NAV.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      aria-current={isActivePath(pathname, link.href) ? 'page' : undefined}
                      className={cx(linkClass, isActivePath(pathname, link.href) && 'text-primary-ink')}
                      onClick={() => setOpen(false)}
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div className="border-hairline mt-auto border-t pt-4">
              {auth.state === 'signed-out' && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    auth.login()
                  }}
                  className={buttonClasses('primary', 'lg', 'w-full')}
                >
                  Sign in
                </button>
              )}
              {auth.state === 'signed-in' && (
                <ul className="space-y-1">
                  {accountLinks(auth.address, auth.profile).map((link) => (
                    <li key={link.href}>
                      <Link href={link.href} className={linkClass} onClick={() => setOpen(false)}>
                        {link.label}
                      </Link>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      className={cx(linkClass, 'text-destructive w-full text-left')}
                      onClick={() => {
                        setOpen(false)
                        auth.logout()
                      }}
                    >
                      Sign out
                    </button>
                  </li>
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

Append its slide-in keyframes to `styles/globals.css`:

```css
@keyframes drawer-in {
    from {
        transform: translateX(100%);
    }
    to {
        transform: translateX(0);
    }
}
```

- [ ] **Step 9: Header, footer, backdrop, layout**

`components/site/site-header.tsx`:

```tsx
import Link from 'next/link'
import { useRouter } from 'next/router'
import { cx } from '../../utils/cx'
import RenownLogo from '../ui/renown-logo'
import ThemeToggle from '../ui/theme-toggle'
import { AuthSlot } from './auth-slot'
import { MobileNav } from './mobile-nav'
import { isActivePath, SITE_NAV } from './nav'
import { Container } from './primitives'
import { useSiteAuth } from './use-site-auth'

/** Sticky, translucent site header: logo, primary nav, theme toggle, auth (drawer below 768 px). */
export function SiteHeader() {
  const { pathname } = useRouter()
  const auth = useSiteAuth()
  return (
    <header className="border-hairline bg-header sticky top-0 z-40 border-b backdrop-blur-xl backdrop-saturate-150">
      <Container className="flex h-16 items-center gap-6">
        <Link href="/" aria-label="Renown home" className="text-ink -ml-1 flex shrink-0 items-center rounded-md p-1">
          <RenownLogo aria-hidden="true" className="h-7 w-auto md:h-8" />
        </Link>
        <nav aria-label="Main" className="hidden md:block">
          <ul className="flex items-center gap-1">
            {SITE_NAV.map((link) => {
              const active = isActivePath(pathname, link.href)
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={active ? 'page' : undefined}
                    className={cx(
                      'rounded-full px-3 py-2 text-sm font-medium transition-colors',
                      active ? 'text-ink bg-surface-2' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {link.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <div className="hidden md:block">
            <AuthSlot auth={auth} />
          </div>
          <MobileNav auth={auth} />
        </div>
      </Container>
    </header>
  )
}
```

`components/site/site-footer.tsx`:

```tsx
import Link from 'next/link'
import RenownLogo from '../ui/renown-logo'
import { FOOTER_COLUMNS, isExternal, X_URL, type NavLink } from './nav'
import { Container } from './primitives'

function FooterLink({ link }: { link: NavLink }) {
  const className = 'text-ink-muted hover:text-ink text-sm transition-colors'
  if (isExternal(link.href)) {
    return (
      <a href={link.href} className={className} target="_blank" rel="noopener noreferrer">
        {link.label}
      </a>
    )
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
  )
}

/** Site footer: product, developer, ecosystem and legal columns; copyright and X. */
export function SiteFooter() {
  return (
    <footer className="border-hairline relative border-t">
      <Container className="grid grid-cols-2 gap-x-6 gap-y-10 py-14 md:grid-cols-[1.4fr_repeat(4,1fr)] md:py-16">
        <div className="col-span-2 max-w-xs md:col-span-1">
          <RenownLogo aria-hidden="true" className="text-ink h-8 w-auto" />
          <p className="text-ink-muted mt-4 text-sm leading-6">The identity layer of the Powerhouse network.</p>
        </div>
        {FOOTER_COLUMNS.map((column) => (
          <nav key={column.title} aria-label={column.title}>
            <h2 className="text-ink text-sm font-semibold">{column.title}</h2>
            <ul className="mt-4 space-y-3">
              {column.links.map((link) => (
                <li key={link.href}>
                  <FooterLink link={link} />
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="border-hairline flex flex-col items-start justify-between gap-4 border-t py-6 sm:flex-row sm:items-center">
        <p className="text-ink-muted text-sm">© {new Date().getFullYear()} Powerhouse</p>
        <a
          href={X_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Powerhouse on X"
          className="text-ink-muted hover:text-ink flex h-9 w-9 items-center justify-center rounded-full transition-colors"
        >
          <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
      </Container>
    </footer>
  )
}
```

`components/site/site-backdrop.tsx`:

```tsx
/**
 * The site's ambient background: a primary/signal aurora at the top of the
 * page, fading out below the first screen. Pure
 * CSS (no image requests), decorative only.
 */
export function SiteBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[1100px] overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(60% 50% at 78% 8%, color-mix(in oklab, var(--grad-to) 22%, transparent), transparent 70%),' +
            'radial-gradient(40% 35% at 12% 0%, color-mix(in oklab, var(--grad-from) 12%, transparent), transparent 70%)',
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-64 bg-gradient-to-b from-transparent to-[var(--background)]" />
    </div>
  )
}
```

`components/site/site-layout.tsx` (the `auth` variant reproduces `PageBackground` minus the login button; it is the only place the gradient/noise images are still loaded):

```tsx
import Image from 'next/image'
import type { ReactNode } from 'react'
import LandingGradient from '../../assets/images/landing-gradient.jpg'
import Noise from '../../assets/images/noise.png'
import PhIconsBackground from '../ui/ph-icons-background'
import RenownLogo from '../ui/renown-logo'
import ThemeToggle from '../ui/theme-toggle'
import { SiteBackdrop } from './site-backdrop'
import { SiteFooter } from './site-footer'
import { SiteHeader } from './site-header'

export type SiteLayoutVariant = 'site' | 'auth'

export interface SiteLayoutProps {
  children: ReactNode
  /** site: header + main + footer. auth: the minimal sign-in chrome (logo + theme toggle only). */
  variant?: SiteLayoutVariant
}

/** The page frame every route renders inside. Pages render their content only (no <main>). */
export function SiteLayout({ children, variant = 'site' }: SiteLayoutProps) {
  if (variant === 'auth') {
    return (
      <div className="relative min-h-screen overflow-hidden">
        <div className="absolute top-0 bottom-0 z-0 hidden w-screen overflow-hidden fill-[#404040] dark:block">
          <Image priority src={LandingGradient} alt="" className="absolute z-0 h-full w-[101vw] max-w-none object-cover" />
          <Image priority src={Noise} alt="" className="absolute z-0 h-full w-[101vw] max-w-none object-cover" />
        </div>
        <div className="pointer-events-none absolute top-0 bottom-0 z-0 w-screen overflow-hidden">
          <PhIconsBackground aria-hidden="true" className="pointer-events-none absolute bottom-0 left-0" />
        </div>
        <div className="absolute top-3 left-8 z-10 flex items-center gap-4">
          <RenownLogo role="img" aria-label="Renown" />
        </div>
        <div className="absolute top-3 right-8 z-10 flex items-center gap-3">
          <ThemeToggle />
        </div>
        <main id="main">{children}</main>
      </div>
    )
  }
  return (
    <div className="relative isolate flex min-h-screen flex-col">
      <a
        href="#main"
        className="bg-primary-strong text-primary-foreground sr-only z-50 rounded-full px-4 py-2 text-sm font-semibold focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SiteBackdrop />
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
    </div>
  )
}
```

- [ ] **Step 10: Error state, 404 and 500**

`components/site/error-state.tsx`:

```tsx
import { ButtonLink, Container } from './primitives'

export interface ErrorStateProps {
  /** Status shown above the title ("404"); omitted when absent. */
  code?: string
  title: string
  message: string
}

/** A full-width error/empty page body: a broken signed edge, the message, and the way back. */
export function ErrorState({ code, title, message }: ErrorStateProps) {
  return (
    <Container className="flex flex-col items-center py-24 text-center md:py-32">
      <svg aria-hidden="true" viewBox="0 0 240 80" className="mb-10 w-60">
        <line x1="40" y1="40" x2="120" y2="40" style={{ stroke: 'var(--primary)', strokeOpacity: 0.45 }} strokeWidth="1.5" />
        <line x1="132" y1="40" x2="196" y2="40" style={{ stroke: 'var(--hairline-strong)' }} strokeWidth="1.5" strokeDasharray="3 6" />
        <circle cx="40" cy="40" r="18" style={{ fill: 'var(--primary-strong)' }} />
        <circle cx="200" cy="40" r="16" fill="none" style={{ stroke: 'var(--hairline-strong)' }} strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>
      {code && <p className="text-primary-ink font-mono text-sm font-semibold">{code}</p>}
      <h1 className="text-ink text-h1 mt-3 max-w-[20ch] text-balance">{title}</h1>
      <p className="text-ink-muted text-lead mt-5 max-w-[52ch]">{message}</p>
      <div className="mt-10 flex flex-col gap-3 sm:flex-row">
        <ButtonLink href="/">Go to the homepage</ButtonLink>
        <ButtonLink href="/apps" variant="secondary">
          Browse apps
        </ButtonLink>
      </div>
    </Container>
  )
}
```

`pages/404.tsx`:

```tsx
import { ErrorState } from '../components/site/error-state'
import { PageMeta } from '../components/site/page-meta'
import { SiteLayout } from '../components/site/site-layout'

export default function NotFound() {
  return (
    <SiteLayout>
      <PageMeta title="Page not found" noindex />
      <ErrorState code="404" title="This page is not on the network" message="The link may be old or mistyped. Profiles live at renown.id/@handle and apps at renown.id/app/<DID>." />
    </SiteLayout>
  )
}
```

`pages/500.tsx`:

```tsx
import { ErrorState } from '../components/site/error-state'
import { PageMeta } from '../components/site/page-meta'
import { SiteLayout } from '../components/site/site-layout'

export default function ServerError() {
  return (
    <SiteLayout>
      <PageMeta title="Something went wrong" noindex />
      <ErrorState code="500" title="Renown hit an error" message="The page could not be loaded. Try again in a moment; if it keeps failing, the service may be down for maintenance." />
    </SiteLayout>
  )
}
```

- [ ] **Step 11: One `<main>` per page; auth pages on the auth chrome.** Apply to `pages/_app.tsx`:

```diff
diff --git a/pages/_app.tsx b/pages/_app.tsx
index df0566d..692fc07 100644
--- a/pages/_app.tsx
+++ b/pages/_app.tsx
@@ -23,5 +23,5 @@ function MyApp({ Component, pageProps, initialProfileId }: MyAppProps) {
   return (
     <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
-      <main className={inter.className}>
+      <div className={inter.className}>
         <QueryClientProvider client={queryClient}>
           <AuthRootProvider>
@@ -39,5 +39,5 @@ function MyApp({ Component, pageProps, initialProfileId }: MyAppProps) {
           </AuthRootProvider>
         </QueryClientProvider>
-      </main>
+      </div>
     </ThemeProvider>
   )
```

Replace `pages/console.tsx` with:

```tsx
import type { NextPage } from "next";
import Head from "next/head";
import styles from "../styles/Home.module.css";
import { useRouter } from "next/router";
import ConsoleFlow from "../components/auth/console-flow";
import { SiteLayout } from "../components/site/site-layout";
import { useIsClient } from "../hooks/useIsClient";
import { parseExpiresInDays } from "../utils/credential-validity";

const ConsolePage: NextPage = () => {
    const router = useRouter();
    const sessionId = router.query["session"]?.toString();
    const connectDid = router.query["connect"]?.toString(); // CLI's DID to authorize
    const expiresInDays = parseExpiresInDays(router.query["expiresInDays"]);
    const isClient = useIsClient();

    return (
        <SiteLayout variant="auth">
            <div className={styles.container}>
                <Head>
                    <title>Renown - Console Login</title>
                    <meta content="Authorize Powerhouse CLI" name="description" />
                </Head>

                <div className={styles.main}>
                    {sessionId && isClient ? (
                        <ConsoleFlow sessionId={sessionId} connectDid={connectDid} expiresInDays={expiresInDays} />
                    ) : !sessionId && isClient ? (
                        <div className="text-center text-muted-foreground">
                            <h2 className="text-2xl font-semibold mb-4">Invalid Session</h2>
                            <p>No session ID provided. Please run <code className="bg-muted px-2 py-1 rounded-sm">ph login</code> from your terminal.</p>
                        </div>
                    ) : null}
                </div>
            </div>
        </SiteLayout>
    );
};

export default ConsolePage;
```

Replace `pages/oidc/login.tsx` with:

```tsx
import type { NextPage } from "next";
import Head from "next/head";
import { useRouter } from "next/router";
import styles from "../../styles/Home.module.css";
import OidcLoginFlow from "../../components/auth/oidc-login-flow";
import { SiteLayout } from "../../components/site/site-layout";
import { useIsClient } from "../../hooks/useIsClient";

const OidcLoginPage: NextPage = () => {
    const router = useRouter();
    const requestId = router.query["request"]?.toString();
    const issuer = router.query["issuer"]?.toString();
    const isClient = useIsClient();

    return (
        <SiteLayout variant="auth">
            <div className={styles.container}>
                <Head>
                    <title>Renown - Sign in</title>
                    <meta content="Sign in to Renown" name="description" />
                </Head>

                <div className={styles.main}>
                    {requestId && isClient ? (
                        <OidcLoginFlow requestId={requestId} issuer={issuer} />
                    ) : !requestId && isClient ? (
                        <div className="text-center text-muted-foreground">
                            <h2 className="text-2xl font-semibold mb-4">Invalid sign-in link</h2>
                            <p>
                                No sign-in request was provided. Please restart the sign-in flow
                                from the application you were using.
                            </p>
                        </div>
                    ) : null}
                </div>
            </div>
        </SiteLayout>
    );
};

export default OidcLoginPage;
```

- [ ] **Step 12: Run the shell test and the auth specs**

Run: `pnpm exec playwright test e2e/site-shell.spec.ts e2e/console-page.spec.ts e2e/oidc-login.spec.ts --workers=3`
Expected: all pass (site-shell 7, console-page 8, oidc-login all).

- [ ] **Step 13: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add components/site hooks/use-own-profile.ts pages/404.tsx pages/500.tsx pages/_app.tsx pages/console.tsx pages/oidc/login.tsx styles/globals.css e2e/support/site.ts e2e/site-shell.spec.ts package.json pnpm-lock.yaml
git commit -m "feat(site): header, footer, mobile drawer, error pages and auth chrome"
```

---

## Task 4: Move profile, app and editor pages onto the site layout

**Files:**
- Modify: `pages/profile/[id].tsx`, `pages/app/[did].tsx`, `pages/profile/edit.tsx`, `components/ui/not-found-page.tsx`
- Modify tests: `e2e/profile-pages.spec.ts`, `e2e/app-pages.spec.ts`, `e2e/renown-writes.spec.ts`

**Interfaces:**
- Consumes: `SiteLayout` (Task 3), `ErrorState` (Task 3), `ogImageUrl` (Task 2), `siteOrigin` (`utils/site-origin.ts`).
- Produces: no new exports. `NotFoundPage({ title, message })` keeps its signature and now renders inside the site layout.

Behaviour is unchanged except `og:image`/`twitter:card` (ruling 2) and the top padding (the header is now in flow, so `pt-24` becomes `pt-12 md:pt-16`).

- [ ] **Step 1: Update the tests first.** The header and footer add links whose names overlap page links ("Docs" ⊂ "App stats docs", "GitHub", a second "Sign in"), so scope page assertions to `main`; switch the OG expectations to the card URLs; read the response body before it can be discarded:

```diff
diff --git a/e2e/profile-pages.spec.ts b/e2e/profile-pages.spec.ts
index 1a550ae..14a1e65 100644
--- a/e2e/profile-pages.spec.ts
+++ b/e2e/profile-pages.spec.ts
@@ -52,5 +52,5 @@ test.describe('public profile', () => {
     expect(await response?.text()).toContain(`src="/media/doc-pages-1/avatar?v=${'f'.repeat(12)}"`)
     await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Pat Pages (@pat-pages)')
-    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/media\/doc-pages-1\/avatar$/)
+    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', new RegExp(`/api/og\\?variant=profile&address=${ADDRESS}$`))
     await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/@pat-pages$/)
   })
@@ -67,8 +67,10 @@ test.describe('public profile', () => {
     const response = await page.goto('/profile/doc-pages-2')
     expect(response?.status()).toBe(200)
+    // Read the body first: a dev-server reload (another route compiling) discards it.
+    const html = await response?.text()
     await expect(page.getByRole('heading', { name: 'plain-user' })).toBeVisible()
     await expect(page.getByRole('img', { name: 'Generated avatar' })).toBeVisible()
-    await expect(page.locator('meta[property="og:image"]')).toHaveCount(0)
-    expect(await response?.text()).not.toContain('/media/doc-pages-2')
+    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/api\/og\?variant=profile&address=0x5e00000000000000000000000000000000000002$/)
+    expect(html).not.toContain('/media/doc-pages-2')
   })
```

```diff
diff --git a/e2e/app-pages.spec.ts b/e2e/app-pages.spec.ts
index 5d95e7e..37dd7a8 100644
--- a/e2e/app-pages.spec.ts
+++ b/e2e/app-pages.spec.ts
@@ -60,19 +60,19 @@ test.describe('app page', () => {
     await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
     await expect(page.locator('strong', { hasText: 'notes' })).toBeVisible()
-    await expect(page.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://docs.vault.example/')
-    await expect(page.getByRole('link', { name: 'Evil' })).toHaveCount(0)
-    const docs = page.getByRole('link', { name: 'Docs' })
+    await expect(page.getByRole('main').getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://docs.vault.example/')
+    await expect(page.getByRole('main').getByRole('link', { name: 'Evil' })).toHaveCount(0)
+    const docs = page.getByRole('main').getByRole('link', { name: 'Docs' })
     await expect(docs).toHaveAttribute('target', '_blank')
     await expect(docs).toHaveAttribute('rel', 'noopener noreferrer nofollow ugc')
     await expect(page.locator('main script')).toHaveCount(0)
     await expect(page.getByText('<script>alert(1)</script>')).toBeVisible()
-    await expect(page.getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/acme/vault')
-    await expect(page.getByRole('link', { name: /Bad/ })).toHaveCount(0)
-    await expect(page.getByRole('link', { name: /vault\.example/ })).toHaveAttribute('href', 'https://vault.example')
+    await expect(page.getByRole('main').getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/acme/vault')
+    await expect(page.getByRole('main').getByRole('link', { name: /Bad/ })).toHaveCount(0)
+    await expect(page.getByRole('main').getByRole('link', { name: /vault\.example/ })).toHaveAttribute('href', 'https://vault.example')
     await expect(page.locator('img[alt="Vault Pages logo"]')).toHaveAttribute('src', '/media/stub-app-doc/logo?v=111111111111')
     await expect(page.locator('img[src="/media/stub-app-doc/cover?v=222222222222"]')).toHaveCount(1)
-    await expect(page.getByRole('link', { name: /Vera Vault/ })).toHaveAttribute('href', '/@vera-vault')
+    await expect(page.getByRole('main').getByRole('link', { name: /Vera Vault/ })).toHaveAttribute('href', '/@vera-vault')
     await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Vault Pages — Notes for teams')
-    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/media\/stub-app-doc\/cover\?v=222222222222$/)
+    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', new RegExp(`/api/og\\?variant=app&did=${encodeURIComponent(APP_DID)}$`))
     await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
     await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/app/${APP_DID}$`))
```

```diff
diff --git a/e2e/renown-writes.spec.ts b/e2e/renown-writes.spec.ts
index b791b21..a24b02f 100644
--- a/e2e/renown-writes.spec.ts
+++ b/e2e/renown-writes.spec.ts
@@ -634,5 +634,5 @@ test.describe('profile editor', () => {
     await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort())
     await page.goto('/profile/edit')
-    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
+    await expect(page.getByRole('main').getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
   })
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec playwright test e2e/profile-pages.spec.ts e2e/app-pages.spec.ts --workers=3`
Expected: FAIL — `og:image` is still `/media/…` (and absent on `/profile/doc-pages-2`).

- [ ] **Step 3: Migrate the pages**

```diff
diff --git a/pages/profile/[id].tsx b/pages/profile/[id].tsx
index 94aecd8..45636e8 100644
--- a/pages/profile/[id].tsx
+++ b/pages/profile/[id].tsx
@@ -3,5 +3,5 @@ import { ProfileStats } from '../../components/profile/profile-stats'
 import { getUserStats, type UserStatEntry } from '../../services/app-stats'
 import Head from 'next/head'
-import PageBackground from '../../components/ui/page-background'
+import { SiteLayout } from '../../components/site/site-layout'
 import { AppProfileCard } from '../../components/app/app-profile-card'
 import { getAppProfilesByPublisher, type RenownAppProfile } from '../../services/app-profiles'
@@ -11,9 +11,9 @@ import { CopyAddress } from '../../components/profile/copy-address'
 import { OwnProfileActions } from '../../components/profile/own-profile-actions'
 import { ProfileSummary, profileName } from '../../components/profile/profile-summary'
-import { mediaUrl } from '../../services/media'
 import { fetchProfile, type RenownProfile } from '../../services/switchboard'
 import { DEFAULT_DRIVE_ID } from '../../utils/constants'
 import { isEnsVerified } from '../../utils/ens'
 import { profilePath } from '../../utils/profile-url'
+import { ogImageUrl } from '../../utils/seo'
 import { siteOrigin } from '../../utils/site-origin'
 
@@ -25,5 +25,5 @@ interface ProfilePageProps {
   /** Absolute canonical URL of this profile. */
   canonicalUrl: string | null
-  /** Absolute image for link previews, if the profile has one. */
+  /** Absolute link-preview image (the generated /api/og profile card). */
   ogImage: string | null
   error?: string
@@ -44,5 +44,5 @@ const ProfilePage: NextPage<ProfilePageProps> = ({ profile, ensVerified, apps, s
 
   return (
-    <PageBackground>
+    <SiteLayout>
       <Head>
         <title>{`${title} - Renown`}</title>
@@ -55,5 +55,5 @@ const ProfilePage: NextPage<ProfilePageProps> = ({ profile, ensVerified, apps, s
         {ogImage && <meta property="og:image" content={ogImage} />}
         {profile.handle && <meta property="profile:username" content={profile.handle} />}
-        <meta name="twitter:card" content="summary" />
+        <meta name="twitter:card" content="summary_large_image" />
         <meta name="twitter:title" content={title} />
         <meta name="twitter:description" content={description} />
@@ -61,5 +61,5 @@ const ProfilePage: NextPage<ProfilePageProps> = ({ profile, ensVerified, apps, s
       </Head>
 
-      <main className="relative flex min-h-screen items-center justify-center px-4 pt-24 pb-12">
+      <div className="relative flex justify-center px-4 pt-12 pb-20 md:pt-16">
         <div className="w-full max-w-2xl">
           <RenownCard>
@@ -111,6 +111,6 @@ const ProfilePage: NextPage<ProfilePageProps> = ({ profile, ensVerified, apps, s
           </RenownCard>
         </div>
-      </main>
-    </PageBackground>
+      </div>
+    </SiteLayout>
   )
 }
@@ -152,9 +152,7 @@ export const getServerSideProps: GetServerSideProps<ProfilePageProps> = async (c
 
   const origin = siteOrigin(context.req.headers.host)
-  const ogImage = profile.avatar
-    ? mediaUrl(profile.documentId, 'avatar', origin)
-    : profile.userImage && /^https:\/\//i.test(profile.userImage)
-      ? profile.userImage
-      : null
+  const ogImage = ADDRESS_RE.test(profile.ethAddress ?? '')
+    ? ogImageUrl({ variant: 'profile', address: profile.ethAddress ?? '' }, origin)
+    : ogImageUrl({ variant: 'default' }, origin)
   context.res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
   const address = profile.ethAddress ?? ''
```

```diff
diff --git a/pages/app/[did].tsx b/pages/app/[did].tsx
index fa4ba71..9963cb9 100644
--- a/pages/app/[did].tsx
+++ b/pages/app/[did].tsx
@@ -10,10 +10,10 @@ import { ProfileLinks } from '../../components/profile/profile-links'
 import { profileName, shortAddress } from '../../components/profile/profile-summary'
 import { NotFoundPage } from '../../components/ui/not-found-page'
-import PageBackground from '../../components/ui/page-background'
+import { SiteLayout } from '../../components/site/site-layout'
 import { APP_DID_RE, fetchAppProfile, type RenownAppProfile } from '../../services/app-profiles'
 import { getAppStats, type AppStats } from '../../services/app-stats'
-import { mediaUrl } from '../../services/media'
 import { getProfile, type RenownProfile } from '../../services/switchboard'
 import { profilePath } from '../../utils/profile-url'
+import { ogImageUrl } from '../../utils/seo'
 import { siteOrigin } from '../../utils/site-origin'
 
@@ -78,5 +78,5 @@ const AppPage: NextPage<AppPageProps> = ({ app, stats, publisher, publisherAddre
 
   return (
-    <PageBackground>
+    <SiteLayout>
       <Head>
         <title>{`${title} - Renown`}</title>
@@ -88,5 +88,5 @@ const AppPage: NextPage<AppPageProps> = ({ app, stats, publisher, publisherAddre
         {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
         {ogImage && <meta property="og:image" content={ogImage} />}
-        <meta name="twitter:card" content={app.coverRef ? 'summary_large_image' : 'summary'} />
+        <meta name="twitter:card" content="summary_large_image" />
         <meta name="twitter:title" content={title} />
         <meta name="twitter:description" content={description} />
@@ -94,5 +94,5 @@ const AppPage: NextPage<AppPageProps> = ({ app, stats, publisher, publisherAddre
       </Head>
 
-      <main className="relative flex min-h-screen justify-center px-4 pt-24 pb-12">
+      <div className="relative flex justify-center px-4 pt-12 pb-20 md:pt-16">
         <article className="w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-200 bg-white/80 shadow-2xl backdrop-blur-lg dark:border-white/20 dark:bg-white/10">
           <AppCover documentId={app.documentId} coverRef={app.coverRef} seed={app.appDid} />
@@ -139,6 +139,6 @@ const AppPage: NextPage<AppPageProps> = ({ app, stats, publisher, publisherAddre
           </div>
         </article>
-      </main>
-    </PageBackground>
+      </div>
+    </SiteLayout>
   )
 }
@@ -171,11 +171,5 @@ export const getServerSideProps: GetServerSideProps<AppPageProps> = async (conte
   ])
   const origin = siteOrigin(context.req.headers.host)
-  const ogImage = app.coverRef
-    ? mediaUrl(app.documentId, 'cover', origin, app.coverRef)
-    : app.logoRef
-      ? mediaUrl(app.documentId, 'logo', origin, app.logoRef)
-      : app.logo && /^https:\/\//i.test(app.logo)
-        ? app.logo
-        : null
+  const ogImage = ogImageUrl({ variant: 'app', did }, origin)
   context.res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
   return {
```

```diff
diff --git a/pages/profile/edit.tsx b/pages/profile/edit.tsx
index bdb1ea2..dfcfac1 100644
--- a/pages/profile/edit.tsx
+++ b/pages/profile/edit.tsx
@@ -11,5 +11,5 @@ import { HandleField } from '../../components/profile-edit/handle-field'
 import { LinksEditor } from '../../components/profile-edit/links-editor'
 import { ProfileSummary } from '../../components/profile/profile-summary'
-import PageBackground from '../../components/ui/page-background'
+import { SiteLayout } from '../../components/site/site-layout'
 import RenownCard from '../../components/ui/renown-card'
 import { useProfileEditorAuth } from '../../hooks/use-profile-editor-auth'
@@ -368,10 +368,10 @@ const EditProfilePage: NextPage = () => {
   const auth = useProfileEditorAuth()
   return (
-    <PageBackground>
+    <SiteLayout>
       <Head>
         <title>Edit profile - Renown</title>
         <meta name="robots" content="noindex" />
       </Head>
-      <div className="relative mx-auto min-h-screen w-full max-w-5xl px-4 pt-24 pb-16">
+      <div className="relative mx-auto w-full max-w-5xl px-4 pt-12 pb-20 md:pt-16">
         {auth.status === 'loading' && <p className="text-muted-foreground py-24 text-center">Loading…</p>}
         {auth.status === 'signed-out' && (
@@ -392,5 +392,5 @@ const EditProfilePage: NextPage = () => {
         )}
       </div>
-    </PageBackground>
+    </SiteLayout>
   )
 }
```

Replace `components/ui/not-found-page.tsx` with:

```tsx
import Head from 'next/head'
import { ErrorState } from '../site/error-state'
import { SiteLayout } from '../site/site-layout'

/** A full-page "not found" (or error) message that search engines skip. */
export function NotFoundPage({ title, message }: { title: string; message: string }) {
  return (
    <SiteLayout>
      <Head>
        <title>{`${title} - Renown`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <ErrorState title={title} message={message} />
    </SiteLayout>
  )
}
```

- [ ] **Step 4: Run the page specs**

Run: `pnpm exec playwright test e2e/profile-pages.spec.ts e2e/app-pages.spec.ts e2e/app-stats.spec.ts e2e/profile-apps.spec.ts e2e/profile-stats.spec.ts e2e/profile-refresh.spec.ts e2e/renown-writes.spec.ts e2e/profile-form.spec.ts --workers=3`
Expected: all pass.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add "pages/profile/[id].tsx" "pages/app/[did].tsx" pages/profile/edit.tsx components/ui/not-found-page.tsx e2e/profile-pages.spec.ts e2e/app-pages.spec.ts e2e/renown-writes.spec.ts
git commit -m "feat(site): profile, app and editor pages on the site layout with OG cards"
```

---

## Task 5: Server data plumbing — app list, timeouts, highlighting, stub support

**Files:**
- Create: `lib/highlight.ts`, `utils/with-timeout.ts`
- Modify: `services/app-profiles.ts`, `e2e/support/stub-switchboard.mjs`, `e2e/support/stub-switchboard-client.ts`, `package.json`/`pnpm-lock.yaml` (`shiki`)
- Test: `e2e/server-utils.spec.ts`

**Interfaces:**
- Consumes: the renown-stats `appProfiles(limit: Int, after: String): AppProfilePage!` query that already exists in renown-package (`subgraphs/renown-stats/schema.ts`; `limit` 1–50, newest first).
- Produces: `listAppProfiles`, `AppProfilePage`, `withTimeout`, `TimeoutError`, `SSR_DATA_TIMEOUT_MS`, `highlight`, `highlightAll`, `HighlightedCode`, `CodeLang`; stub: `appProfiles` default `{ items: [], next: null }`, `POST /__stub/fixture/remove { id }`, client `removeFixture(id)` and `fixtureStub({ id, … })`.

- [ ] **Step 1: Install shiki**

```bash
pnpm add -w shiki@4.4.3
```

- [ ] **Step 2: Write the failing test** — `e2e/server-utils.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { highlight, highlightAll } from '../lib/highlight'
import { TimeoutError, withTimeout } from '../utils/with-timeout'

// Runs in the Playwright worker (Node), not the browser.
test.describe('withTimeout', () => {
  test('passes a fast result through', async () => {
    expect(await withTimeout(Promise.resolve(42), 50)).toBe(42)
  })

  test('rejects a slow promise with TimeoutError', async () => {
    const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 200))
    await expect(withTimeout(slow, 20)).rejects.toBeInstanceOf(TimeoutError)
  })

  test('keeps the original rejection', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom')
  })
})

test.describe('highlight', () => {
  test('emits dual-theme shiki HTML and trims the source', async () => {
    const result = await highlight('\n  const a = 1\n', 'ts')
    expect(result.code).toBe('const a = 1')
    expect(result.html).toContain('class="shiki')
    expect(result.html).toContain('--shiki-light:')
    expect(result.html).toContain('--shiki-dark:')
  })

  test('escapes markup in the source', async () => {
    const result = await highlight('const html = "<script>alert(1)</script>"', 'ts')
    expect(result.html).not.toContain('<script>')
  })

  test('highlightAll keeps the keys', async () => {
    const all = await highlightAll({ a: { code: 'pnpm add x', lang: 'bash' }, b: { code: 'query { a }', lang: 'graphql' } })
    expect(Object.keys(all)).toEqual(['a', 'b'])
    expect(all.b.html).toContain('shiki')
  })
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm exec playwright test e2e/server-utils.spec.ts`
Expected: FAIL — `Cannot find module '../lib/highlight'`.

- [ ] **Step 4: Create `utils/with-timeout.ts`**

```ts
/** Rejects with `TimeoutError` when `promise` takes longer than `ms`. */
export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`Timed out after ${ms} ms`)
    this.name = 'TimeoutError'
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

/** Per-request budget for optional SSR data on public pages (spec: 2.5 s). */
export const SSR_DATA_TIMEOUT_MS = 2500
```

- [ ] **Step 5: Create `lib/highlight.ts`**

```ts
// Server-only syntax highlighting (getStaticProps / getServerSideProps). Never
// import this from a component: shiki must stay out of the client bundle.
import { createHighlighterCore, type HighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'

export type CodeLang = 'ts' | 'bash' | 'graphql'

/** A code sample ready for <CodeBlock>: the source and its highlighted HTML. */
export interface HighlightedCode {
  code: string
  html: string
}

let highlighter: Promise<HighlighterCore> | null = null

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs'), import('shiki/themes/github-dark-default.mjs')],
    langs: [import('shiki/langs/typescript.mjs'), import('shiki/langs/bash.mjs'), import('shiki/langs/graphql.mjs')],
    engine: createJavaScriptRegexEngine(),
  })
  return highlighter
}

const LANG: Record<CodeLang, string> = { ts: 'typescript', bash: 'bash', graphql: 'graphql' }

/** Highlights `code` with both site themes (CSS variables --shiki-light / --shiki-dark). */
export async function highlight(code: string, lang: CodeLang): Promise<HighlightedCode> {
  const shiki = await getHighlighter()
  const html = shiki.codeToHtml(code.trim(), {
    lang: LANG[lang],
    themes: { light: 'github-light', dark: 'github-dark-default' },
    defaultColor: false,
  })
  return { code: code.trim(), html }
}

/** Highlights a record of samples in parallel, keeping the keys. */
export async function highlightAll<K extends string>(
  samples: Record<K, { code: string; lang: CodeLang }>,
): Promise<Record<K, HighlightedCode>> {
  const entries = await Promise.all(
    (Object.keys(samples) as K[]).map(async (key) => [key, await highlight(samples[key].code, samples[key].lang)] as const),
  )
  return Object.fromEntries(entries) as Record<K, HighlightedCode>
}
```

- [ ] **Step 6: Add `listAppProfiles`**

```diff
diff --git a/services/app-profiles.ts b/services/app-profiles.ts
index cab1509..df22ff9 100644
--- a/services/app-profiles.ts
+++ b/services/app-profiles.ts
@@ -55,4 +55,22 @@ export async function getAppProfile(appDid: string): Promise<RenownAppProfile |
 }
 
+export interface AppProfilePage {
+  items: RenownAppProfile[]
+  /** Cursor for the next page; null on the last page. */
+  next: string | null
+}
+
+/**
+ * One page of every app profile, newest first (`limit` 1-50). A failed read
+ * throws; callers decide whether that hides a section or shows an outage.
+ */
+export async function listAppProfiles({ limit, after }: { limit: number; after?: string | null }): Promise<AppProfilePage> {
+  const data = await client().request<{ appProfiles: AppProfilePage }>(
+    `query AppProfiles($limit: Int, $after: String) { appProfiles(limit: $limit, after: $after) { items { ${FIELDS} } next } }`,
+    { limit, after: after ?? null },
+  )
+  return data.appProfiles
+}
+
 /** The app profiles a wallet publishes (oldest first). */
 export async function getAppProfilesByPublisher(address: string): Promise<RenownAppProfile[]> {
```

- [ ] **Step 7: Teach the stub switchboard about `appProfiles` and removable fixtures**

```diff
diff --git a/e2e/support/stub-switchboard.mjs b/e2e/support/stub-switchboard.mjs
index daad4db..f265b3e 100644
--- a/e2e/support/stub-switchboard.mjs
+++ b/e2e/support/stub-switchboard.mjs
@@ -15,4 +15,5 @@
 //                            survives /__stub/reset; for specs that run in
 //                            parallel with the scripting ones (unique variables!)
+//   POST /__stub/fixture/remove  { id } — drops the fixtures added with that id
 //
 // renown-package HTTP routes (stateless, safe in parallel):
@@ -50,4 +51,5 @@ const DEFAULT_DATA = {
   appProfile: null,
   appProfilesByPublisher: [],
+  appProfiles: { items: [], next: null },
   appStats: null,
   userStats: [],
@@ -149,4 +151,9 @@ const server = http.createServer(async (req, res) => {
       return send(res, 200, { ok: true })
     }
+    if (req.url === '/__stub/fixture/remove' && req.method === 'POST') {
+      const { id } = await readBody(req)
+      for (let i = fixtures.length - 1; i >= 0; i--) if (fixtures[i].id === id) fixtures.splice(i, 1)
+      return send(res, 200, { ok: true })
+    }
     if (req.url === '/__stub/fixture' && req.method === 'POST') {
       fixtures.push(await readBody(req))
```

```diff
diff --git a/e2e/support/stub-switchboard-client.ts b/e2e/support/stub-switchboard-client.ts
index 54b1c06..af23b2c 100644
--- a/e2e/support/stub-switchboard-client.ts
+++ b/e2e/support/stub-switchboard-client.ts
@@ -11,4 +11,6 @@ export interface RecordedRequest {
 
 interface ScriptEntry {
+  /** Fixtures only: a name for removeFixture(). */
+  id?: string
   /** Substring the GraphQL query must contain. */
   match: string
@@ -43,4 +45,13 @@ export async function fixtureStub(entry: ScriptEntry): Promise<void> {
 }
 
+/** Drops the fixtures added with `id` (fixtures otherwise live as long as the stub). */
+export async function removeFixture(id: string): Promise<void> {
+  await fetch(`${STUB_SWITCHBOARD_URL}/__stub/fixture/remove`, {
+    method: 'POST',
+    headers: { 'Content-Type': 'application/json' },
+    body: JSON.stringify({ id }),
+  })
+}
+
 /** Recorded requests whose query contains `match`. */
 export async function stubRequests(match: string): Promise<RecordedRequest[]> {
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm exec playwright test e2e/server-utils.spec.ts`
Expected: 6 passed.

- [ ] **Step 9: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add lib/highlight.ts utils/with-timeout.ts services/app-profiles.ts e2e/support/stub-switchboard.mjs e2e/support/stub-switchboard-client.ts e2e/server-utils.spec.ts package.json pnpm-lock.yaml
git commit -m "feat(site): app profile listing, SSR timeouts and server-side highlighting"
```

---

## Task 6: Homepage with the identity constellation

**Files:**
- Create: `components/home/{types.ts,network-pulse.tsx,constellation.tsx,hero-cta.tsx,hero.tsx,pillars.tsx,how-it-works.tsx,featured-apps.tsx,developers-teaser.tsx,ecosystem-strip.tsx,final-cta.tsx}`, `components/app/app-tile.tsx`, `components/ecosystem/ecosystem-data.ts`, `components/site/ph-motif.tsx`
- Modify: `pages/index.tsx` (rewrite), `styles/globals.css` (constellation CSS)
- Delete: `components/ui/page-background.tsx`, `components/auth/renown-login-button.tsx`
- Test: `e2e/home.spec.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (primitives, `SiteLayout`, `PageMeta`), Task 5 (`listAppProfiles`, `withTimeout`, `SSR_DATA_TIMEOUT_MS`, `highlight`), `AppCover`, `AppLogo`, `WebFlow`, `parseReturnUrl`, `parseExpiresInDays`, `useIsClient`, `mediaUrl`.
- Produces: `NetworkPulse`, `HomePageData`, `NetworkPulseSection`, `AppTile`/`AppTileProps`, `ECOSYSTEM`/`EcosystemEntry`, `PhMotif`, `FEATURED_APPS_MIN = 3`, `TEASER_CODE`.

Design intent (keep it when editing): one bold element — the constellation (your DID at the centre, approved apps in orbit, signed edges pulsing toward you; featured app logos become the nodes). Everything else is quiet: hairline-ruled pillars instead of a card grid, a single numbered sequence (the only real sequence on the page), one staggered reveal (how-it-works) plus the final CTA. All motion stops under reduced motion.

- [ ] **Step 1: Write the failing test** — `e2e/home.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { fixtureStub, removeFixture } from './support/stub-switchboard-client'
import { attachScreenshots, expectNoSeriousA11yViolations, useTheme } from './support/site'

// Every homepage load in the suite lives in this file: its tests swap the
// appProfiles fixture the SSR reads, so they run one at a time and no other
// spec may load "/" without an auth query.
test.describe.configure({ mode: 'serial' })

const FIXTURE = 'home-featured'
const did = (n: number) => `did:key:z6MkHomeApp${n}${'x'.repeat(36)}`
const app = (n: number) => ({
  appDid: did(n),
  documentId: `stub-home-${n}`,
  name: `Home App ${n}`,
  tagline: `Tagline ${n}`,
  logo: null,
  website: null,
  publisherDid: null,
  description: null,
  category: n % 2 ? 'Productivity' : null,
  logoRef: null,
  coverRef: null,
  links: [],
})

/** Makes the homepage's appProfiles(limit: 6) read answer with `entry`. */
async function featured(entry: { status?: number; response: unknown }): Promise<void> {
  await removeFixture(FIXTURE)
  await fixtureStub({ id: FIXTURE, match: 'appProfiles(', variables: '"limit":6', ...entry })
}

test.afterAll(async () => {
  await removeFixture(FIXTURE)
})

test('renders the pitch, the CTAs and up to six featured apps', async ({ page }) => {
  await featured({ response: { data: { appProfiles: { items: [1, 2, 3, 4].map(app), next: null } } } })
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1, name: 'One identity for the Powerhouse network' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create your Renown ID' }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('link', { name: 'Build with Renown' }).first()).toHaveAttribute('href', '/developers')
  const section = page.getByRole('region', { name: 'Apps that sign you in with Renown' })
  await expect(section.getByRole('listitem')).toHaveCount(4)
  await expect(section.getByRole('link', { name: /Home App 1/ })).toHaveAttribute('href', `/app/${did(1)}`)
  await expect(section.getByRole('link', { name: 'Browse all apps' })).toHaveAttribute('href', '/apps')
  await expect(page.locator('svg.rn-constellation')).toHaveAttribute('aria-hidden', 'true')
  await expect(page.locator('svg.rn-constellation text')).toHaveCount(4) // monograms of the four apps without logos
  await expect(page.getByRole('link', { name: 'Read the developer guide' })).toHaveAttribute('href', '/developers')
  await expect(page.locator('.shiki').first()).toBeVisible()
  for (const name of ['Renown', 'Vetra', 'Achra', 'Connect', 'Switchboard']) {
    await expect(page.getByRole('region', { name: 'Part of the Powerhouse ecosystem' }).getByRole('link', { name })).toHaveAttribute(
      'href',
      `/ecosystem#${name.toLowerCase()}`,
    )
  }
})

test('hides the featured apps below three, without a gap', async ({ page }) => {
  await featured({ response: { data: { appProfiles: { items: [1, 2].map(app), next: null } } } })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Apps that sign you in with Renown' })).toHaveCount(0)
  await expect(page.locator('svg.rn-constellation text')).toHaveCount(2)
})

test('a backend outage drops the section and never fails the page', async ({ page }) => {
  await featured({ status: 500, response: { error: 'boom' } })
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Apps that sign you in with Renown' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Bring your identity to every app' })).toBeVisible()
})

test('has canonical, Open Graph and JSON-LD metadata', async ({ page }) => {
  await removeFixture(FIXTURE)
  await page.goto('/')
  await expect(page).toHaveTitle('Renown - One identity for the Powerhouse network')
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /^https?:\/\/[^/]+$/)
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/api\/og\?variant=default$/)
  const ld = await page.locator('script[type="application/ld+json"]').allTextContents()
  const types = ld.map((text) => (JSON.parse(text) as { '@type': string })['@type'])
  expect(types).toEqual(['Organization', 'WebSite'])
})

for (const theme of ['light', 'dark'] as const) {
  test(`has no serious axe violations (${theme})`, async ({ page }, testInfo) => {
    await featured({ response: { data: { appProfiles: { items: [1, 2, 3, 4, 5, 6].map(app), next: null } } } })
    await useTheme(page, theme)
    await page.goto('/')
    await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
    await expectNoSeriousA11yViolations(page)
    await attachScreenshots(page, testInfo, `home-${theme}`)
  })
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec playwright test e2e/home.spec.ts --workers=3`
Expected: FAIL — no `h1` "One identity for the Powerhouse network" on `/`.

- [ ] **Step 3: Shared data: ecosystem entries, homepage types, pulse slot**

`components/ecosystem/ecosystem-data.ts`:

```ts
// The Powerhouse systems Renown works with (homepage strip and /ecosystem).

export interface EcosystemEntry {
  id: 'renown' | 'vetra' | 'achra' | 'connect' | 'switchboard'
  name: string
  /** One-line role. */
  role: string
  /** What it does with identity, for the /ecosystem cards. */
  detail: string
  href: string
}

export const ECOSYSTEM: EcosystemEntry[] = [
  {
    id: 'renown',
    name: 'Renown',
    role: 'Identity, profiles and app stats',
    detail: 'Issues the credentials that let apps act for you, hosts public user and app profiles, and aggregates the stats apps report.',
    href: '/',
  },
  {
    id: 'vetra',
    name: 'Vetra',
    role: 'Build and host environments',
    detail: 'Where builders develop Powerhouse apps and run them in hosted environments. Apps get their Renown identity there.',
    href: 'https://www.vetra.io',
  },
  {
    id: 'achra',
    name: 'Achra',
    role: 'Marketplace, reviews and billing',
    detail: 'The marketplace for Powerhouse apps: listings, user reviews, subscriptions and billing.',
    href: 'https://www.achra.com',
  },
  {
    id: 'connect',
    name: 'Connect',
    role: 'The document app',
    detail: 'The app where people open drives and work on documents. Every change is signed with the key your Renown credential authorised.',
    href: 'https://connect.vetra.io',
  },
  {
    id: 'switchboard',
    name: 'Switchboard',
    role: 'APIs for documents',
    detail: 'The GraphQL and MCP API service for reading and writing documents.',
    href: 'https://academy.vetra.io',
  },
]
```

`components/home/types.ts`:

```ts
import type { HighlightedCode } from '../../lib/highlight'
import type { RenownAppProfile } from '../../services/app-profiles'

/** Network-wide counts from renown-stats `renownNetworkStats` (filled in by Phase B). */
export interface NetworkPulse {
  identities: number
  apps: number
  activeCredentials: number
  activeUsers30d: number
  /** ISO timestamp of the cached snapshot. */
  updatedAt: string
}

/** Props of the marketing homepage (pages/index.tsx without an auth query). */
export interface HomePageData {
  /** Up to 6 newest app profiles; the section hides below 3. */
  featuredApps: RenownAppProfile[]
  /** Phase B: network stats; null/undefined renders nothing. */
  pulse?: NetworkPulse | null
  /** The developers-teaser code sample, highlighted server-side. */
  teaser: HighlightedCode
}
```

`components/home/network-pulse.tsx`:

```tsx
import type { NetworkPulse } from './types'

/**
 * Slot for the network pulse section. Phase A renders nothing; Phase B
 * replaces this body (keep the export and props stable).
 */
export function NetworkPulseSection({ pulse }: { pulse?: NetworkPulse | null }) {
  void pulse
  return null
}
```

- [ ] **Step 4: The constellation.** Create `components/home/constellation.tsx`:

```tsx
import { mediaUrl } from '../../services/media'
import type { RenownAppProfile } from '../../services/app-profiles'

// The hero's signature visual: your DID at the centre, the apps you approved in
// orbit, each tied to you by a signed edge that pulses. Decorative (aria-hidden);
// all motion is CSS (globals.css, .rn-constellation) and stops under
// prefers-reduced-motion.

const C = 280
/** Glyphs (24x24 stroke paths) for nodes without an app logo. */
const GLYPHS = [
  'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6', // document
  'M4 5h16v14H4zM8 10l3 2-3 2M13 15h3', // terminal
  'M5 19V11M10 19V5M15 19v-6M20 19V9', // stats
  'M5 5h14v10H9l-4 4z', // message
  'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12L4 7.5', // package
  'M15 7a3 3 0 1 1-3 3M12 10H4v4M7 10v3', // key
]

interface NodeSpec {
  orbit: 'inner' | 'outer'
  angle: number
}

const NODES: NodeSpec[] = [
  { orbit: 'inner', angle: -38 },
  { orbit: 'outer', angle: 22 },
  { orbit: 'inner', angle: 96 },
  { orbit: 'outer', angle: 158 },
  { orbit: 'inner', angle: 214 },
  { orbit: 'outer', angle: 280 },
]
const RADIUS = { inner: 150, outer: 236 }

function position(spec: NodeSpec): { x: number; y: number } {
  const rad = (spec.angle * Math.PI) / 180
  const r = RADIUS[spec.orbit]
  return { x: Math.round(C + r * Math.cos(rad)), y: Math.round(C + r * Math.sin(rad)) }
}

function logoSrc(app: RenownAppProfile): string | null {
  if (app.logoRef) return mediaUrl(app.documentId, 'logo', '', app.logoRef)
  return app.logo && /^https:\/\//i.test(app.logo) ? app.logo : null
}

function Node({ index, spec, app }: { index: number; spec: NodeSpec; app?: RenownAppProfile }) {
  const { x, y } = position(spec)
  const src = app ? logoSrc(app) : null
  const letter = app?.name?.trim().charAt(0).toUpperCase()
  const clipId = `rn-node-clip-${index}`
  return (
    <g>
      <line x1={x} y1={y} x2={C} y2={C} className="rn-edge" pathLength={100} />
      <line x1={x} y1={y} x2={C} y2={C} className="rn-pulse" pathLength={100} style={{ animationDelay: `${index * 0.9}s` }} />
      <g transform={`translate(${x} ${y})`}>
        <g className="rn-spin" data-orbit={spec.orbit}>
          <g className="rn-node" style={{ animationDelay: `${180 + index * 90}ms` }}>
            <circle r={30} className="rn-node-bg" />
            {letter && !src ? (
              <text textAnchor="middle" dominantBaseline="central" className="rn-letter">
                {letter}
              </text>
            ) : (
              <g transform="translate(-12 -12)">
                <path d={GLYPHS[index % GLYPHS.length]} className="rn-glyph" />
              </g>
            )}
            {src && (
              <>
                <clipPath id={clipId}>
                  <circle r={26} />
                </clipPath>
                <image href={src} x={-26} y={-26} width={52} height={52} clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" />
              </>
            )}
            <circle r={30} className="rn-node-ring" />
          </g>
        </g>
      </g>
    </g>
  )
}

/** Up to six apps (those with logos first) orbiting the visitor's DID. */
export function Constellation({ apps = [] }: { apps?: RenownAppProfile[] }) {
  const ordered = [...apps].sort((a, b) => Number(Boolean(logoSrc(b))) - Number(Boolean(logoSrc(a)))).slice(0, NODES.length)
  const inner = NODES.map((spec, index) => ({ spec, index })).filter(({ spec }) => spec.orbit === 'inner')
  const outer = NODES.map((spec, index) => ({ spec, index })).filter(({ spec }) => spec.orbit === 'outer')
  return (
    <svg viewBox="0 0 560 560" aria-hidden="true" focusable="false" className="rn-constellation h-auto w-full">
      <defs>
        <radialGradient id="rn-core-glow">
          <stop offset="0" style={{ stopColor: 'var(--grad-to)', stopOpacity: 0.55 }} />
          <stop offset="1" style={{ stopColor: 'var(--grad-to)', stopOpacity: 0 }} />
        </radialGradient>
        <linearGradient id="rn-core-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--grad-from)' }} />
          <stop offset="1" style={{ stopColor: 'var(--grad-to)' }} />
        </linearGradient>
      </defs>
      <circle cx={C} cy={C} r={RADIUS.inner} className="rn-orbit" />
      <circle cx={C} cy={C} r={RADIUS.outer} className="rn-orbit" />
      <circle cx={C} cy={C} r={268} className="rn-orbit rn-orbit-faint" />
      <circle cx={C} cy={C} r={130} fill="url(#rn-core-glow)" className="rn-core-glow" />
      <g className="rn-ring" data-orbit="inner">
        {inner.map(({ spec, index }) => (
          <Node key={index} index={index} spec={spec} app={ordered[index]} />
        ))}
      </g>
      <g className="rn-ring" data-orbit="outer">
        {outer.map(({ spec, index }) => (
          <Node key={index} index={index} spec={spec} app={ordered[index]} />
        ))}
      </g>
      <g transform={`translate(${C} ${C})`}>
        <circle r={54} className="rn-core-halo" />
        <circle r={44} fill="url(#rn-core-fill)" />
        <path
          transform="translate(-17 -17) scale(0.52)"
          d="M31.3 1C28.2 12 20 20.6 9.4 23.8c-1.3.4-1.3 2.3 0 2.7C20 29.7 28.2 38.3 31.3 49.3c.4 1.4 2.3 1.4 2.7 0 3.1-11 11.4-19.6 21.9-22.8 1.3-.4 1.3-2.3 0-2.7C45.4 20.6 37.1 12 34 1c-.4-1.4-2.3-1.4-2.7 0Z"
          className="rn-spark"
        />
      </g>
    </svg>
  )
}
```

Append its styles to `styles/globals.css` (all animation is inside `prefers-reduced-motion: no-preference`):

```css
/* Hero identity constellation (components/home/constellation.tsx). */
.rn-constellation .rn-orbit {
    fill: none;
    stroke: var(--hairline-strong);
    stroke-dasharray: 2 6;
}
.rn-constellation .rn-orbit-faint {
    stroke: var(--hairline);
}
.rn-constellation .rn-edge {
    stroke: var(--primary);
    stroke-opacity: 0.28;
    stroke-width: 1.25;
}
.rn-constellation .rn-pulse {
    stroke: var(--signal);
    stroke-width: 2.5;
    stroke-linecap: round;
    stroke-dasharray: 0 100;
}
.rn-constellation .rn-node-bg {
    fill: var(--background);
}
.rn-constellation .rn-node-ring {
    fill: none;
    stroke: var(--hairline-strong);
    stroke-width: 1.5;
}
.rn-constellation .rn-glyph {
    fill: none;
    stroke: var(--primary-ink);
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
}
.rn-constellation .rn-letter {
    fill: var(--ink);
    font-size: 22px;
    font-weight: 600;
}
.rn-constellation .rn-core-halo {
    fill: none;
    stroke: var(--primary);
    stroke-opacity: 0.35;
}
.rn-constellation .rn-ring {
    transform-box: view-box;
    transform-origin: 50% 50%;
}
.rn-constellation .rn-spin,
.rn-constellation .rn-node {
    transform-box: fill-box;
    transform-origin: 50% 50%;
}
.rn-constellation .rn-spark {
    fill: var(--primary-foreground);
}

@media (prefers-reduced-motion: no-preference) {
    .rn-constellation .rn-ring[data-orbit="inner"] {
        animation: rn-orbit 140s linear infinite;
    }
    .rn-constellation .rn-ring[data-orbit="outer"] {
        animation: rn-orbit 220s linear infinite reverse;
    }
    .rn-constellation .rn-spin[data-orbit="inner"] {
        animation: rn-orbit 140s linear infinite reverse;
    }
    .rn-constellation .rn-spin[data-orbit="outer"] {
        animation: rn-orbit 220s linear infinite;
    }
    .rn-constellation .rn-pulse {
        animation: rn-pulse 5.4s var(--ease-out-expo) infinite;
    }
    .rn-constellation .rn-node {
        animation: rn-node-in 900ms var(--ease-out-expo) both;
    }
    .rn-constellation .rn-core-glow {
        transform-box: fill-box;
        transform-origin: 50% 50%;
        animation: rn-breathe 6s ease-in-out infinite;
    }
}

@keyframes rn-orbit {
    to {
        transform: rotate(360deg);
    }
}
@keyframes rn-pulse {
    0% {
        stroke-dasharray: 0 100;
        stroke-dashoffset: 0;
        opacity: 0;
    }
    8% {
        opacity: 1;
    }
    30% {
        stroke-dasharray: 14 100;
        stroke-dashoffset: -86;
        opacity: 0;
    }
    100% {
        stroke-dasharray: 14 100;
        stroke-dashoffset: -86;
        opacity: 0;
    }
}
@keyframes rn-node-in {
    from {
        opacity: 0;
        transform: scale(0.6);
    }
    to {
        opacity: 1;
        transform: scale(1);
    }
}
@keyframes rn-breathe {
    0%,
    100% {
        opacity: 0.75;
        transform: scale(1);
    }
    50% {
        opacity: 1;
        transform: scale(1.08);
    }
}
```

- [ ] **Step 5: Hero**

`components/home/hero-cta.tsx`:

```tsx
import { useRenownAuth } from '@powerhousedao/reactor-browser/renown'
import { ButtonLink, buttonClasses } from '../site/primitives'

/** Primary CTA: starts the Renown login, or links to /me once signed in. */
export function HeroCta() {
  const { user, login } = useRenownAuth()
  return (
    <div className="flex flex-col gap-3 sm:flex-row">
      {user ? (
        <ButtonLink href="/me" size="lg">
          Go to your Renown
        </ButtonLink>
      ) : (
        <button type="button" onClick={() => void login()} className={buttonClasses('primary', 'lg')}>
          Create your Renown ID
        </button>
      )}
      <ButtonLink href="/developers" variant="secondary" size="lg">
        Build with Renown
      </ButtonLink>
    </div>
  )
}
```

`components/home/hero.tsx`:

```tsx
import type { RenownAppProfile } from '../../services/app-profiles'
import { Container } from '../site/primitives'
import { Constellation } from './constellation'
import { HeroCta } from './hero-cta'

export function Hero({ apps }: { apps: RenownAppProfile[] }) {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden">
      <Container className="grid items-center gap-12 pt-14 pb-16 md:pt-20 lg:grid-cols-[1.05fr_1fr] lg:gap-8 lg:pt-24 lg:pb-28">
        <div className="max-w-[640px]">
          <p className="text-ink-muted border-hairline bg-surface-1 mb-7 inline-flex items-center gap-2 rounded-full border py-1 pr-3.5 pl-1.5 text-sm backdrop-blur">
            <span className="bg-signal/15 text-signal rounded-full px-2 py-0.5 font-mono text-xs">did:pkh</span>
            Your wallet is your identity
          </p>
          <h1 id="hero-title" className="text-ink text-display text-balance">
            One identity for the Powerhouse network
          </h1>
          <p className="text-ink-muted text-lead mt-6 max-w-[54ch] text-pretty">
            Renown turns your wallet into a portable identity. Sign in to every Powerhouse app, sign everything you
            create, and revoke an app&apos;s access whenever you choose.
          </p>
          <div className="mt-9">
            <HeroCta />
          </div>
          <p className="text-ink-muted mt-6 text-sm">No passwords. Your wallet keys never leave your wallet.</p>
        </div>
        <div className="relative mx-auto w-full max-w-[460px] lg:max-w-[540px]">
          <div
            aria-hidden="true"
            className="absolute inset-[12%] rounded-full blur-3xl"
            style={{ background: 'radial-gradient(closest-side, color-mix(in oklab, var(--grad-to) 30%, transparent), transparent)' }}
          />
          <Constellation apps={apps} />
        </div>
      </Container>
    </section>
  )
}
```

- [ ] **Step 6: Pillars and how it works**

`components/home/pillars.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Heading, Lead, Section } from '../site/primitives'

interface Pillar {
  title: string
  body: ReactNode
  icon: string
}

const PILLARS: Pillar[] = [
  {
    title: 'Sign in everywhere',
    body: 'Powerhouse apps like Connect accept the same Renown ID. You approve each app once, and there is no password to reuse or leak.',
    icon: 'M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3',
  },
  {
    title: 'Provable authorship',
    body: 'Every change you make to a Powerhouse document is signed by a key you authorised, so anyone can check it came from your DID.',
    icon: 'M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6zM9 12l2 2 4-4',
  },
  {
    title: 'Your public profile',
    body: (
      <>
        Claim a handle at <span className="text-ink font-mono text-[0.92em]">renown.id/@you</span> with a name, avatar,
        bio and links, and list the apps you publish.
      </>
    ),
    icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  },
]

export function Pillars() {
  return (
    <Section labelledBy="pillars-title">
      <div className="max-w-[720px]">
        <Heading level={2} id="pillars-title">
          An identity that travels with you
        </Heading>
        <Lead>One sign-in, one signature, one profile, recognised across the network.</Lead>
      </div>
      <ul className="border-hairline mt-14 grid border-t md:grid-cols-3">
        {PILLARS.map((pillar, index) => (
          <li
            key={pillar.title}
            className={`border-hairline py-8 md:px-8 md:py-10 ${index > 0 ? 'border-t md:border-t-0 md:border-l' : 'md:pl-0'}`}
          >
            <span className="bg-primary/10 text-primary-ink ring-primary/20 flex h-11 w-11 items-center justify-center rounded-xl ring-1">
              <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={pillar.icon} />
              </svg>
            </span>
            <h3 className="text-ink text-h3 mt-6">{pillar.title}</h3>
            <p className="text-ink-muted mt-3 leading-7">{pillar.body}</p>
          </li>
        ))}
      </ul>
    </Section>
  )
}
```

`components/home/how-it-works.tsx`:

```tsx
import { Heading, Lead, Reveal, Section } from '../site/primitives'

const STEPS = [
  {
    title: 'Connect a wallet',
    body: 'Use the wallet you already have. Renown never asks for a password and never sees your private key.',
  },
  {
    title: 'Your DID is created',
    body: (
      <>
        Your identity is derived from your address, like{' '}
        <span className="text-ink font-mono text-[0.9em] break-all">did:pkh:eip155:1:0x5e…0a01</span>. There is nothing to
        register.
      </>
    ),
  },
  {
    title: 'Apps ask, you approve',
    body: 'An app requests access and you sign one credential for it, valid for 7 days unless the app asks for longer. Revoke it any time.',
  },
]

export function HowItWorks() {
  return (
    <Section labelledBy="how-title" tone="raised">
      <div className="max-w-[720px]">
        <Heading level={2} id="how-title">
          From wallet to signed in, in three steps
        </Heading>
        <Lead>No accounts to create and no passwords to remember. Just signatures you can check.</Lead>
      </div>
      <ol className="relative mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
        <span
          aria-hidden="true"
          className="via-primary/40 absolute top-5 right-[16%] left-[16%] hidden h-px bg-gradient-to-r from-transparent to-transparent md:block"
        />
        {STEPS.map((step, index) => (
          <Reveal as="li" key={step.title} delay={index * 120} className="relative">
            <span className="border-primary/40 bg-background text-primary-ink relative z-10 flex h-10 w-10 items-center justify-center rounded-full border font-mono text-sm font-semibold shadow-glow">
              {index + 1}
            </span>
            <h3 className="text-ink text-h3 mt-6">{step.title}</h3>
            <p className="text-ink-muted mt-3 leading-7">{step.body}</p>
          </Reveal>
        ))}
      </ol>
    </Section>
  )
}
```

- [ ] **Step 7: The reusable app card and featured apps**

`components/app/app-tile.tsx`:

```tsx
import Link from 'next/link'
import type { RenownAppProfile } from '../../services/app-profiles'
import { Badge } from '../site/primitives'
import { AppCover } from './app-cover'
import { AppLogo } from './app-logo'

export interface AppTileProps {
  app: RenownAppProfile
  /** Heading level of the app name inside its list (default 3). */
  headingLevel?: 2 | 3
}

/** A directory card for one app: cover, logo, name, tagline and category, linking to /app/[did]. */
export function AppTile({ app, headingLevel = 3 }: AppTileProps) {
  const name = app.name || 'Untitled app'
  const Title = `h${headingLevel}` as const
  return (
    <Link
      href={`/app/${app.appDid}`}
      className="group border-hairline bg-surface-1 shadow-card rounded-card hover:border-primary/40 hover:shadow-glow relative flex h-full flex-col overflow-hidden border transition-[border-color,box-shadow,transform] duration-300 ease-out-expo hover:-translate-y-0.5 motion-reduce:hover:translate-y-0"
    >
      <div className="relative overflow-hidden">
        <div className="transition-transform duration-700 ease-out-expo group-hover:scale-[1.03] motion-reduce:group-hover:scale-100">
          <AppCover documentId={app.documentId} coverRef={app.coverRef} seed={app.appDid} />
        </div>
      </div>
      <div className="flex flex-1 flex-col px-5 pb-5">
        <AppLogo
          documentId={app.documentId}
          logoRef={app.logoRef}
          legacyLogo={app.logo}
          name={name}
          className="-mt-7 h-14 w-14 text-xl ring-4"
        />
        <div className="mt-3 flex items-start justify-between gap-3">
          <Title className="text-ink text-h3 min-w-0 truncate">{name}</Title>
          {app.category && <Badge tone="primary" className="mt-0.5 shrink-0">{app.category}</Badge>}
        </div>
        {app.tagline && <p className="text-ink-muted mt-1.5 line-clamp-2 text-sm leading-6">{app.tagline}</p>}
      </div>
    </Link>
  )
}
```

`components/home/featured-apps.tsx`:

```tsx
import type { RenownAppProfile } from '../../services/app-profiles'
import { AppTile } from '../app/app-tile'
import { ButtonLink, Heading, Lead, Section } from '../site/primitives'

/** Fewer than this many apps hides the section. */
export const FEATURED_APPS_MIN = 3

export function FeaturedApps({ apps }: { apps: RenownAppProfile[] }) {
  if (apps.length < FEATURED_APPS_MIN) return null
  return (
    <Section labelledBy="featured-apps-title">
      <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div className="max-w-[640px]">
          <Heading level={2} id="featured-apps-title">
            Apps that sign you in with Renown
          </Heading>
          <Lead>Each one has a public Renown identity you can inspect before you approve it.</Lead>
        </div>
        <ButtonLink href="/apps" variant="secondary" className="self-start md:self-auto">
          Browse all apps
        </ButtonLink>
      </div>
      <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {apps.slice(0, 6).map((app) => (
          <li key={app.appDid}>
            <AppTile app={app} />
          </li>
        ))}
      </ul>
    </Section>
  )
}
```

- [ ] **Step 8: Developers teaser, ecosystem strip, final CTA**

`components/home/developers-teaser.tsx`:

```tsx
import type { HighlightedCode } from '../../lib/highlight'
import { ButtonLink, CodeBlock, Eyebrow, Heading, Lead, Section } from '../site/primitives'

/** The 6-line server check shown on the homepage (highlighted in getServerSideProps). */
export const TEASER_CODE = `import { verifyAuthBearerToken, fetchDelegationCredential } from '@renown/sdk'

const jwt = await verifyAuthBearerToken(token)
if (!jwt) throw new Error('Invalid or expired token')
const { address, chainId } = jwt.verifiableCredential.credentialSubject
const grant = await fetchDelegationCredential({ address, chainId, appDid: jwt.issuer })`

export function DevelopersTeaser({ code }: { code: HighlightedCode }) {
  return (
    <Section labelledBy="dev-teaser-title">
      <div className="grid items-center gap-12 lg:grid-cols-[0.72fr_1.28fr]">
        <div>
          <Eyebrow>For developers</Eyebrow>
          <Heading level={2} id="dev-teaser-title">
            Add Renown sign‑in to your app
          </Heading>
          <Lead>
            Send people to a connect link, get their approval back as a signed credential, and verify every request on
            your server with <span className="text-ink font-mono text-[0.92em]">@renown/sdk</span>.
          </Lead>
          <ButtonLink href="/developers" variant="secondary" className="mt-8">
            Read the developer guide
          </ButtonLink>
        </div>
        <CodeBlock code={code.code} html={code.html} label="server.ts" className="min-w-0" />
      </div>
    </Section>
  )
}
```

`components/home/ecosystem-strip.tsx`:

```tsx
import Link from 'next/link'
import { ECOSYSTEM } from '../ecosystem/ecosystem-data'
import { Section } from '../site/primitives'

export function EcosystemStrip() {
  return (
    <Section labelledBy="ecosystem-strip-title" spacing="sm">
      <div className="border-hairline bg-surface-1 rounded-panel flex flex-col gap-6 border p-6 md:flex-row md:items-center md:justify-between md:p-8">
        <div>
          <h2 id="ecosystem-strip-title" className="text-ink text-h3">
            Part of the Powerhouse ecosystem
          </h2>
          <p className="text-ink-muted mt-1 text-sm">One identity across every system in the network.</p>
        </div>
        <ul className="flex flex-wrap gap-2">
          {ECOSYSTEM.map((entry) => (
            <li key={entry.id}>
              <Link
                href={`/ecosystem#${entry.id}`}
                className="border-hairline-strong text-ink hover:border-primary/50 hover:bg-surface-2 inline-flex h-9 items-center rounded-full border px-4 text-sm font-medium transition-colors"
              >
                {entry.name}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  )
}
```

`components/site/ph-motif.tsx`:

```tsx
import { cx } from '../../utils/cx'
import PhIconsBackground from '../ui/ph-icons-background'

/** The Powerhouse icon field as a decorative accent; position it with `className`. */
export function PhMotif({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cx('pointer-events-none absolute', className)}>
      <PhIconsBackground className="[mask-image:radial-gradient(closest-side,black_35%,transparent)]" />
    </div>
  )
}
```

`components/home/final-cta.tsx`:

```tsx
import { PhMotif } from '../site/ph-motif'
import { Container, Reveal } from '../site/primitives'
import { HeroCta } from './hero-cta'

export function FinalCta() {
  return (
    <section aria-labelledby="final-cta-title" className="pt-8 pb-24 md:pb-32">
      <Container>
        <Reveal className="rounded-panel relative isolate overflow-hidden p-[1px]">
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10"
            style={{ background: 'linear-gradient(120deg, var(--grad-from), var(--grad-to) 45%, transparent 80%)' }}
          />
          <div className="bg-background rounded-panel relative isolate overflow-hidden px-6 py-14 text-center md:px-12 md:py-20">
            <div
              aria-hidden="true"
              className="absolute inset-x-0 -top-1/2 -z-10 h-full"
              style={{ background: 'radial-gradient(50% 60% at 50% 100%, color-mix(in oklab, var(--grad-to) 26%, transparent), transparent)' }}
            />
            <PhMotif className="-right-56 -bottom-72 -z-10 hidden opacity-50 md:block dark:opacity-80" />
            <PhMotif className="-top-80 -left-64 -z-10 hidden rotate-180 opacity-40 lg:block dark:opacity-60" />
            <h2 id="final-cta-title" className="text-ink text-h1 mx-auto max-w-[18ch] text-balance">
              Bring your identity to every app
            </h2>
            <p className="text-ink-muted text-lead mx-auto mt-5 max-w-[48ch]">
              Create your Renown ID with the wallet you already use. It takes one signature.
            </p>
            <div className="mt-9 flex justify-center">
              <HeroCta />
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  )
}
```

- [ ] **Step 9: Rewrite `pages/index.tsx`** (the auth branch renders exactly what it rendered before, now in the auth chrome):

```tsx
import type { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import { useRouter } from 'next/router'
import { WebFlow } from '../components/auth/web-flow'
import { DevelopersTeaser, TEASER_CODE } from '../components/home/developers-teaser'
import { EcosystemStrip } from '../components/home/ecosystem-strip'
import { FeaturedApps } from '../components/home/featured-apps'
import { FinalCta } from '../components/home/final-cta'
import { Hero } from '../components/home/hero'
import { HowItWorks } from '../components/home/how-it-works'
import { NetworkPulseSection } from '../components/home/network-pulse'
import { Pillars } from '../components/home/pillars'
import type { HomePageData } from '../components/home/types'
import { PageMeta } from '../components/site/page-meta'
import { SiteLayout } from '../components/site/site-layout'
import { useIsClient } from '../hooks/useIsClient'
import { listAppProfiles } from '../services/app-profiles'
import { parseExpiresInDays } from '../utils/credential-validity'
import { parseReturnUrl } from '../utils/return-url'
import { publicOrigin } from '../utils/seo'
import { SSR_DATA_TIMEOUT_MS, withTimeout } from '../utils/with-timeout'
import styles from '../styles/Home.module.css'

type HomeProps = { mode: 'auth' } | ({ mode: 'site' } & HomePageData)

/** `/?app=` / `/?connect=`: the sign-in flow, exactly as before, in the minimal auth chrome. */
function AuthHome() {
  const router = useRouter()
  const connectId = router.query['connect']?.toString()
  const appId = router.query['app']?.toString() || connectId
  const deeplink = router.query['deeplink']?.toString()
  const returnUrl = parseReturnUrl(router.query['returnUrl'])
  const expiresInDays = parseExpiresInDays(router.query['expiresInDays'])
  const isClient = useIsClient()

  return (
    <SiteLayout variant="auth">
      <div className={styles.container}>
        <Head>
          <title>Renown</title>
          <meta content="Created by Powerhouse" name="description" />
        </Head>
        <div className={styles.main}>
          {appId && isClient && (
            <WebFlow appId={appId} deeplink={deeplink} returnUrl={returnUrl} expiresInDays={expiresInDays} />
          )}
        </div>
      </div>
    </SiteLayout>
  )
}

function jsonLd(origin: string): object[] {
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Renown',
      url: origin,
      logo: `${origin}/favicon.ico`,
      parentOrganization: { '@type': 'Organization', name: 'Powerhouse', url: 'https://www.powerhouse.inc' },
      sameAs: ['https://github.com/powerhouse-inc', 'https://x.com/PowerhouseDAO'],
    },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Renown', url: origin },
  ]
}

function MarketingHome({ featuredApps, pulse, teaser }: HomePageData) {
  return (
    <SiteLayout>
      <PageMeta path="/" jsonLd={jsonLd(publicOrigin())} />
      <Hero apps={featuredApps} />
      <Pillars />
      <HowItWorks />
      <FeaturedApps apps={featuredApps} />
      <NetworkPulseSection pulse={pulse} />
      <DevelopersTeaser code={teaser} />
      <EcosystemStrip />
      <FinalCta />
    </SiteLayout>
  )
}

const Home: NextPage<HomeProps> = (props) => {
  const router = useRouter()
  const inAuthFlow = Boolean(router.query['app'] || router.query['connect'])
  if (inAuthFlow || props.mode === 'auth') return <AuthHome />
  return <MarketingHome featuredApps={props.featuredApps} pulse={props.pulse} teaser={props.teaser} />
}

export const getServerSideProps: GetServerSideProps<HomeProps> = async ({ query, res }) => {
  if (query['app'] || query['connect']) return { props: { mode: 'auth' } }
  // Imported here so shiki stays server-only.
  const { highlight } = await import('../lib/highlight')
  const [featuredApps, teaser] = await Promise.all([
    withTimeout(listAppProfiles({ limit: 6 }), SSR_DATA_TIMEOUT_MS)
      .then((page) => page.items)
      .catch((error: unknown) => {
        console.error('Homepage: featured apps unavailable:', error)
        return []
      }),
    highlight(TEASER_CODE, 'ts'),
  ])
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300')
  return { props: { mode: 'site', featuredApps, pulse: null, teaser } }
}

export default Home
```

- [ ] **Step 10: Remove the old chrome**

```bash
git rm components/ui/page-background.tsx components/auth/renown-login-button.tsx
grep -rn "page-background\|renown-login-button" pages components hooks || echo "no references left"
```

Expected: `no references left`.

- [ ] **Step 11: Run the homepage test and the web-flow specs**

Run: `pnpm exec playwright test e2e/home.spec.ts e2e/site-shell.spec.ts e2e/renown-writes.spec.ts e2e/credential-validity-flow.spec.ts --workers=3`
Expected: all pass (home 6). The two axe tests attach `home-light-390.png`, `home-light-1280.png`, `home-dark-390.png`, `home-dark-1280.png` to the HTML report (`pnpm exec playwright show-report`) — look at them: hero headline left, constellation right (below on 390), six app tiles in a 3-column grid, no element overlapping the footer.

- [ ] **Step 12: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add components/home components/app/app-tile.tsx components/ecosystem/ecosystem-data.ts components/site/ph-motif.tsx pages/index.tsx styles/globals.css e2e/home.spec.ts
git commit -m "feat(home): marketing homepage with identity constellation and featured apps"
```

---

## Task 7: `/developers` with the connect link builder

**Files:**
- Create: `utils/connect-link.ts`, `components/developers/{connect-link-builder.tsx,toc.tsx,param-table.tsx,snippets.ts}`, `pages/developers.tsx`
- Test: `e2e/connect-link.spec.ts`, `e2e/developers.spec.ts`

**Interfaces:**
- Consumes: `APP_DID_RE` (`services/app-profiles.ts`), `parseReturnUrl` (`utils/return-url.ts`), `parseExpiresInDays`, `DEFAULT_CREDENTIAL_VALIDITY_DAYS`, `MAX_CREDENTIAL_VALIDITY_DAYS` (`utils/credential-validity.ts`), `DEFAULT_OIDC_ISSUER` (`services/oidc.ts`), `highlightAll` (Task 5), primitives, `PageMeta`, nav URLs.
- Produces: `buildConnectLink(input: ConnectLinkInput): ConnectLinkResult`; `Toc`/`TocItem`; `ParamTable`/`ParamRow`; `SNIPPETS`/`SnippetKey`.

Every SDK call in `snippets.ts` was checked against `node_modules/@renown/sdk` 6.2.3: `RenownBuilder` (`dist/index.d.ts`), `Renown.did`, `Renown.login(userDid)`, `Renown.getBearerToken({ expiresIn })`, `verifyAuthBearerToken(jwt)` → `false | AuthVerifiedCredential` (subject `{ address, chainId, networkId }`, JWT `issuer` = app key DID), `fetchDelegationCredential({ address, chainId, appDid })` (ignores revoked and expired credentials). The `user` return parameter is URL-encoded twice by the flow (`hooks/use-auth-flow.ts` `buildRedirectUrl`), hence `decodeURIComponent` in the callback snippet. The public GraphQL endpoint was checked live (`appProfiles` on `https://switchboard.renown.vetra.io/graphql/renown-stats` answers).

- [ ] **Step 1: Write the failing tests**

`e2e/connect-link.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { buildConnectLink } from '../utils/connect-link'

// Runs in the Playwright worker (Node), not the browser.
const ORIGIN = 'https://www.renown.id'
const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'

test.describe('buildConnectLink', () => {
  test('builds a minimal connect link', () => {
    const result = buildConnectLink({ origin: ORIGIN, appDid: DID, returnUrl: '', expiresInDays: '' })
    expect(result.url).toBe(`${ORIGIN}/?connect=${encodeURIComponent(DID)}`)
    expect(result.effectiveDays).toBe(7)
    expect(result.errors).toEqual({})
  })

  test('encodes the return URL and keeps an explicit validity', () => {
    const result = buildConnectLink({ origin: `${ORIGIN}/`, appDid: ` ${DID} `, returnUrl: 'https://app.example/cb?x=1', expiresInDays: '30' })
    const url = new URL(result.url ?? '')
    expect(url.origin).toBe(ORIGIN)
    expect(url.searchParams.get('connect')).toBe(DID)
    expect(url.searchParams.get('returnUrl')).toBe('https://app.example/cb?x=1')
    expect(url.searchParams.get('expiresInDays')).toBe('30')
  })

  test('clamps long validity to 365 days and says so', () => {
    const result = buildConnectLink({ origin: ORIGIN, appDid: DID, returnUrl: '', expiresInDays: '9999' })
    expect(result.clamped).toBe(true)
    expect(result.effectiveDays).toBe(365)
    expect(new URL(result.url ?? '').searchParams.get('expiresInDays')).toBe('365')
  })

  test('rejects what the sign-in flow would drop or misread', () => {
    expect(buildConnectLink({ origin: ORIGIN, appDid: '', returnUrl: '', expiresInDays: '' }).errors.appDid).toBe('Enter your app DID.')
    expect(buildConnectLink({ origin: ORIGIN, appDid: 'did:web:x', returnUrl: '', expiresInDays: '' }).errors.appDid).toMatch(/did:key/)
    for (const returnUrl of ['/relative', 'javascript:alert(1)', 'not a url']) {
      const result = buildConnectLink({ origin: ORIGIN, appDid: DID, returnUrl, expiresInDays: '' })
      expect(result.url, returnUrl).toBeNull()
      expect(result.errors.returnUrl).toMatch(/absolute http/)
    }
    for (const expiresInDays of ['0', '-3', '1.5', 'week']) {
      const result = buildConnectLink({ origin: ORIGIN, appDid: DID, returnUrl: '', expiresInDays })
      expect(result.url, expiresInDays).toBeNull()
      expect(result.errors.expiresInDays).toMatch(/1 to 365/)
    }
  })
})
```

`e2e/developers.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { attachScreenshots, expectNoSeriousA11yViolations, useTheme } from './support/site'

const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'

test.describe('/developers', () => {
  test('renders the guide with a table of contents and highlighted code', async ({ page }) => {
    const response = await page.goto('/developers')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: 'Build with Renown' })).toBeVisible()
    const mainNav = page.getByRole('banner').getByRole('navigation', { name: 'Main' })
    await expect(mainNav.getByRole('link', { name: 'Developers' })).toHaveAttribute('aria-current', 'page')
    await expect(mainNav.getByRole('link', { name: 'Trust' })).not.toHaveAttribute('aria-current', 'page')
    const toc = page.getByRole('navigation', { name: 'On this page' })
    await expect(toc.getByRole('link')).toHaveCount(7)
    await expect(toc.getByRole('link', { name: 'Build a connect link' })).toHaveAttribute('href', '#builder')
    for (const param of ['connect', 'app', 'returnUrl', 'deeplink', 'expiresInDays']) {
      await expect(page.getByRole('rowheader', { name: param, exact: true })).toBeVisible()
    }
    await expect(page.locator('#sdk .shiki')).toHaveCount(5)
    await expect(page.getByText('https://switchboard.renown.vetra.io/api/@powerhousedao/renown-package/oidc', { exact: true })).toBeVisible()
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/developers$/)
  })

  test('the connect link builder validates live and builds a working link', async ({ page }) => {
    await page.goto('/developers')
    const output = page.getByTestId('connect-link-output')
    const copy = page.getByRole('button', { name: 'Copy link' })
    await expect(output).toHaveText('Enter a valid app DID to generate the link.')
    await expect(copy).toBeDisabled()

    const did = page.getByLabel('App DID')
    await did.fill('did:web:example.com')
    await expect(did).toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('An app DID looks like did:key:z6Mk… (base58btc).')).toBeVisible()

    await did.fill(DID)
    await expect(did).toHaveAttribute('aria-invalid', 'false')
    await expect(output).toHaveText(`https://www.renown.id/?connect=${encodeURIComponent(DID)}&expiresInDays=7`)
    await expect(copy).toBeEnabled()

    const returnUrl = page.getByLabel('Return URL (optional)')
    await returnUrl.fill('/relative')
    await expect(page.getByText('Use an absolute http(s) URL; the sign-in flow ignores anything else.')).toBeVisible()
    await expect(copy).toBeDisabled()
    await returnUrl.fill('https://app.example/cb')

    await page.getByRole('button', { name: '30 days' }).click()
    await expect(page.getByRole('button', { name: '30 days' })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByText('Not the default, so the user confirms this validity explicitly.')).toBeVisible()
    await page.getByLabel('Days').fill('9999')
    await expect(page.getByText('Longer than the maximum: the flow will ask for 365 days.')).toBeVisible()
    await expect(output).toContainText('expiresInDays=365')

    const tryIt = page.getByRole('link', { name: 'Try it' })
    await expect(tryIt).toHaveAttribute('href', /^\/\?connect=/)
    await expect(tryIt).toHaveAttribute('target', '_blank')
  })

  test('copying announces "Copied"', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only here')
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/developers')
    await page.getByLabel('App DID').fill(DID)
    await page.getByRole('button', { name: 'Copy link' }).click()
    await expect(page.getByRole('button', { name: 'Copied' })).toBeVisible()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(encodeURIComponent(DID))
  })

  for (const theme of ['light', 'dark'] as const) {
    test(`has no serious axe violations (${theme})`, async ({ page }, testInfo) => {
      await useTheme(page, theme)
      await page.goto('/developers')
      await page.getByLabel('App DID').fill('not-a-did')
      await expectNoSeriousA11yViolations(page)
      await attachScreenshots(page, testInfo, `developers-${theme}`)
    })
  }
})
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm exec playwright test e2e/connect-link.spec.ts e2e/developers.spec.ts --workers=3`
Expected: FAIL — `Cannot find module '../utils/connect-link'`.

- [ ] **Step 3: Create `utils/connect-link.ts`**

```ts
// The /developers connect-link builder, validated with the same parsers the
// sign-in flow (pages/index.tsx) applies to the link it receives.
import { APP_DID_RE } from '../services/app-profiles'
import { MAX_CREDENTIAL_VALIDITY_DAYS, parseExpiresInDays } from './credential-validity'
import { parseReturnUrl } from './return-url'

export interface ConnectLinkInput {
  /** Site origin the link points at, e.g. https://www.renown.id. */
  origin: string
  appDid: string
  /** Optional; must be an absolute http(s) URL to be honoured. */
  returnUrl: string
  /** Raw text of the expiry field (days). */
  expiresInDays: string
}

export interface ConnectLinkResult {
  /** The link, or null while a field is invalid. */
  url: string | null
  errors: Partial<Record<'appDid' | 'returnUrl' | 'expiresInDays', string>>
  /** Validity the flow will actually ask for (after defaulting/clamping). */
  effectiveDays: number
  /** Set when the requested expiry is clamped to the maximum. */
  clamped: boolean
}

export function buildConnectLink(input: ConnectLinkInput): ConnectLinkResult {
  const errors: ConnectLinkResult['errors'] = {}
  const appDid = input.appDid.trim()
  const returnUrl = input.returnUrl.trim()
  const days = input.expiresInDays.trim()

  if (!appDid) errors.appDid = 'Enter your app DID.'
  else if (!APP_DID_RE.test(appDid)) errors.appDid = 'An app DID looks like did:key:z6Mk… (base58btc).'

  if (returnUrl && !parseReturnUrl(returnUrl)) {
    errors.returnUrl = 'Use an absolute http(s) URL; the sign-in flow ignores anything else.'
  }

  if (days && (!/^\d+$/.test(days) || Number(days) < 1)) {
    errors.expiresInDays = `Use a whole number of days from 1 to ${MAX_CREDENTIAL_VALIDITY_DAYS}.`
  }

  const effectiveDays = parseExpiresInDays(days || undefined)
  const clamped = /^\d+$/.test(days) && Number(days) > MAX_CREDENTIAL_VALIDITY_DAYS
  if (Object.keys(errors).length > 0) return { url: null, errors, effectiveDays, clamped }

  const params = new URLSearchParams({ connect: appDid })
  if (returnUrl) params.set('returnUrl', returnUrl)
  if (days) params.set('expiresInDays', String(effectiveDays))
  return { url: `${input.origin.replace(/\/+$/, '')}/?${params.toString()}`, errors, effectiveDays, clamped }
}
```

- [ ] **Step 4: Builder, TOC and parameter table**

`components/developers/connect-link-builder.tsx`:

```tsx
import { useId, useMemo, useState } from 'react'
import { buildConnectLink } from '../../utils/connect-link'
import { DEFAULT_CREDENTIAL_VALIDITY_DAYS } from '../../utils/credential-validity'
import { publicOrigin } from '../../utils/seo'
import { cx } from '../../utils/cx'
import { buttonClasses } from '../site/primitives'

const PRESETS = [1, 7, 30, 90, 365]

const inputClass =
  'border-hairline-strong bg-surface-1 text-ink placeholder:text-ink-muted/70 focus-visible:border-primary h-11 w-full rounded-[var(--radius-control)] border px-3.5 font-mono text-sm outline-none transition-colors aria-invalid:border-destructive'

function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string
  label: string
  hint?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label htmlFor={id} className="text-ink mb-2 block text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-msg`} className="text-destructive mt-2 text-sm">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-msg`} className="text-ink-muted mt-2 text-sm">
            {hint}
          </p>
        )
      )}
    </div>
  )
}

/** Interactive builder for a `?connect=` link, validated live with the sign-in flow's own parsers. */
export function ConnectLinkBuilder() {
  const uid = useId()
  const [appDid, setAppDid] = useState('')
  const [returnUrl, setReturnUrl] = useState('')
  const [days, setDays] = useState(String(DEFAULT_CREDENTIAL_VALIDITY_DAYS))
  const [copied, setCopied] = useState(false)
  const result = useMemo(
    () => buildConnectLink({ origin: publicOrigin(), appDid, returnUrl, expiresInDays: days }),
    [appDid, returnUrl, days],
  )
  // Untouched DID field: no error yet, just the hint.
  const didError = appDid ? result.errors.appDid : undefined

  async function copy() {
    if (!result.url) return
    try {
      await navigator.clipboard.writeText(result.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  const ids = { did: `${uid}-did`, ret: `${uid}-ret`, days: `${uid}-days` }
  return (
    <div className="border-hairline bg-surface-1 rounded-panel shadow-card border p-5 md:p-8">
      <form className="grid gap-6" onSubmit={(event) => event.preventDefault()} aria-label="Connect link builder">
        <Field id={ids.did} label="App DID" hint="Your app's Renown identity (renown.did in the SDK)." error={didError}>
          <input
            id={ids.did}
            className={inputClass}
            value={appDid}
            onChange={(event) => setAppDid(event.target.value)}
            placeholder="did:key:z6Mk…"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={Boolean(didError)}
            aria-describedby={`${ids.did}-msg`}
          />
        </Field>
        <Field
          id={ids.ret}
          label="Return URL (optional)"
          hint="Where Renown sends the user back, with ?user=did:pkh:… appended."
          error={result.errors.returnUrl}
        >
          <input
            id={ids.ret}
            className={inputClass}
            value={returnUrl}
            onChange={(event) => setReturnUrl(event.target.value)}
            placeholder="https://app.example.com/auth/renown"
            spellCheck={false}
            autoComplete="off"
            inputMode="url"
            aria-invalid={Boolean(result.errors.returnUrl)}
            aria-describedby={`${ids.ret}-msg`}
          />
        </Field>
        <fieldset>
          <legend className="text-ink mb-2 text-sm font-medium">Credential validity</legend>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((preset) => {
              const active = days === String(preset)
              return (
                <button
                  key={preset}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setDays(String(preset))}
                  className={cx(
                    'h-9 rounded-full border px-3.5 text-sm font-medium transition-colors',
                    active ? 'border-primary bg-primary/10 text-primary-ink' : 'border-hairline-strong text-ink hover:bg-surface-2',
                  )}
                >
                  {preset === 1 ? '1 day' : `${preset} days`}
                </button>
              )
            })}
          </div>
          <div className="mt-3 max-w-[12rem]">
            <label htmlFor={ids.days} className="sr-only">
              Days
            </label>
            <div className="relative">
              <input
                id={ids.days}
                className={cx(inputClass, 'pr-14')}
                value={days}
                onChange={(event) => setDays(event.target.value)}
                inputMode="numeric"
                aria-invalid={Boolean(result.errors.expiresInDays)}
                aria-describedby={`${ids.days}-msg`}
              />
              <span aria-hidden="true" className="text-ink-muted pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-sm">
                days
              </span>
            </div>
          </div>
          <p id={`${ids.days}-msg`} className={cx('mt-2 text-sm', result.errors.expiresInDays ? 'text-destructive' : 'text-ink-muted')}>
            {result.errors.expiresInDays ??
              (result.clamped
                ? `Longer than the maximum: the flow will ask for ${result.effectiveDays} days.`
                : result.effectiveDays === DEFAULT_CREDENTIAL_VALIDITY_DAYS
                  ? 'The default validity.'
                  : 'Not the default, so the user confirms this validity explicitly.')}
          </p>
        </fieldset>
      </form>

      <div className="border-hairline mt-8 border-t pt-6">
        <p className="text-ink mb-2 text-sm font-medium" id={`${uid}-out-label`}>
          Your connect link
        </p>
        <output
          aria-labelledby={`${uid}-out-label`}
          aria-live="polite"
          data-testid="connect-link-output"
          className={cx(
            'bg-code border-hairline block min-h-11 rounded-[var(--radius-control)] border px-3.5 py-3 font-mono text-sm break-all',
            result.url ? 'text-ink' : 'text-ink-muted',
          )}
        >
          {result.url ?? 'Enter a valid app DID to generate the link.'}
        </output>
        <div className="mt-4 flex flex-wrap gap-3">
          <button type="button" disabled={!result.url} onClick={() => void copy()} className={buttonClasses('primary', 'md')}>
            {copied ? 'Copied' : 'Copy link'}
          </button>
          {result.url ? (
            <a href={result.url.replace(publicOrigin(), '')} target="_blank" rel="noopener noreferrer" className={buttonClasses('secondary', 'md')}>
              Try it
            </a>
          ) : (
            <span aria-disabled="true" className={buttonClasses('secondary', 'md', 'pointer-events-none opacity-60')}>
              Try it
            </span>
          )}
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? 'Copied' : ''}
          </span>
        </div>
      </div>
    </div>
  )
}
```

`components/developers/toc.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { cx } from '../../utils/cx'

export interface TocItem {
  id: string
  label: string
}

/** Sticky in-page table of contents; marks the section in view with aria-current. */
export function Toc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState(items[0]?.id)

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActive(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -65% 0px' },
    )
    for (const item of items) {
      const el = document.getElementById(item.id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [items])

  return (
    <nav aria-label="On this page" className="sticky top-24">
      <p className="text-ink mb-3 text-sm font-semibold">On this page</p>
      <ul className="border-hairline space-y-1 border-l">
        {items.map((item) => (
          <li key={item.id}>
            <a
              href={`#${item.id}`}
              aria-current={active === item.id ? 'true' : undefined}
              className={cx(
                '-ml-px block border-l py-1.5 pl-4 text-sm transition-colors',
                active === item.id ? 'border-primary text-ink font-medium' : 'text-ink-muted hover:text-ink border-transparent',
              )}
            >
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
```

`components/developers/param-table.tsx`:

```tsx
import type { ReactNode } from 'react'

export interface ParamRow {
  name: string
  value: ReactNode
  description: ReactNode
}

/** The connect-link parameter reference; stacks into cards below md. */
export function ParamTable({ rows }: { rows: ParamRow[] }) {
  return (
    <div className="border-hairline rounded-card overflow-hidden border">
      <table className="w-full border-collapse text-left text-sm">
        <thead className="bg-surface-2 hidden md:table-header-group">
          <tr>
            <th scope="col" className="text-ink px-4 py-3 font-semibold">Parameter</th>
            <th scope="col" className="text-ink px-4 py-3 font-semibold">Value</th>
            <th scope="col" className="text-ink px-4 py-3 font-semibold">Behaviour</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-hairline block border-t first:border-t-0 md:table-row md:first:border-t">
              <th scope="row" className="text-primary-ink block px-4 pt-4 font-mono font-medium md:table-cell md:py-4 md:align-top">
                {row.name}
              </th>
              <td className="text-ink block px-4 pt-1 md:table-cell md:py-4 md:align-top">{row.value}</td>
              <td className="text-ink-muted block px-4 pt-1 pb-4 leading-6 md:table-cell md:py-4 md:align-top">{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 5: Snippets** — `components/developers/snippets.ts`:

```ts
// Code samples on /developers. Every API used here exists in @renown/sdk 6.2.3
// (RenownBuilder, renown.did, renown.login, renown.getBearerToken,
// verifyAuthBearerToken, fetchDelegationCredential); keep them in sync with it.
import type { CodeLang } from '../../lib/highlight'
import { DEFAULT_OIDC_ISSUER } from '../../services/oidc'

export type SnippetKey = 'install' | 'identity' | 'callback' | 'bearer' | 'verify' | 'oidc' | 'graphql' | 'graphqlCurl'

export const SNIPPETS: Record<SnippetKey, { code: string; lang: CodeLang; label: string }> = {
  install: { lang: 'bash', label: 'Terminal', code: 'pnpm add @renown/sdk' },
  identity: {
    lang: 'ts',
    label: 'app.ts',
    code: `import { RenownBuilder } from '@renown/sdk'

// Creates (once) and stores your app's key pair in the browser.
const renown = await new RenownBuilder('my-app').build()

// Your app's identity: pass it as ?connect= in the connect link.
const connectUrl = \`https://www.renown.id/?connect=\${renown.did}&returnUrl=\${encodeURIComponent(location.href)}\``,
  },
  callback: {
    lang: 'ts',
    label: 'callback.ts',
    code: `// Back from Renown: ?user=did:pkh:eip155:<chainId>:<address>
const user = new URL(location.href).searchParams.get('user')
if (user) {
  // Loads the credential the user just signed for renown.did.
  await renown.login(decodeURIComponent(user))
}`,
  },
  bearer: {
    lang: 'ts',
    label: 'api-client.ts',
    code: `// A short-lived token signed by your app key, for your own API.
const token = await renown.getBearerToken({ expiresIn: 600 })
await fetch('/api/notes', { headers: { Authorization: \`Bearer \${token}\` } })`,
  },
  verify: {
    lang: 'ts',
    label: 'server.ts',
    code: `import { verifyAuthBearerToken, fetchDelegationCredential } from '@renown/sdk'

export async function authenticate(token: string) {
  // 1. The token is well-formed, unexpired and signed by its issuer (your app key).
  const jwt = await verifyAuthBearerToken(token)
  if (!jwt) return null
  // 2. The wallet in the token really authorised that key: an unrevoked,
  //    unexpired credential exists on Renown.
  const { address, chainId } = jwt.verifiableCredential.credentialSubject
  const grant = await fetchDelegationCredential({ address, chainId, appDid: jwt.issuer })
  return grant ? { address, chainId } : null
}`,
  },
  oidc: {
    lang: 'bash',
    label: 'Terminal',
    code: `curl ${DEFAULT_OIDC_ISSUER}/.well-known/openid-configuration`,
  },
  graphql: {
    lang: 'graphql',
    label: 'renown-stats',
    code: `query {
  appProfiles(limit: 5) {
    items { appDid name tagline category }
    next
  }
}`,
  },
  graphqlCurl: {
    lang: 'bash',
    label: 'Terminal',
    code: `curl -s https://switchboard.renown.vetra.io/graphql/renown-stats \\
  -H 'content-type: application/json' \\
  -d '{"query":"{ appProfiles(limit: 5) { items { appDid name } next } }"}'`,
  },
}
```

- [ ] **Step 6: The page** — `pages/developers.tsx` (SSG; highlighting happens in `getStaticProps` at build time):

```tsx
import type { GetStaticProps, NextPage } from 'next'
import type { ReactNode } from 'react'
import { ConnectLinkBuilder } from '../components/developers/connect-link-builder'
import { ParamTable, type ParamRow } from '../components/developers/param-table'
import { SNIPPETS, type SnippetKey } from '../components/developers/snippets'
import { Toc, type TocItem } from '../components/developers/toc'
import { PageMeta } from '../components/site/page-meta'
import { APP_STATS_DOCS_URL, VETRA_URL } from '../components/site/nav'
import { CodeBlock, Container, Eyebrow, Heading, Lead } from '../components/site/primitives'
import { SiteLayout } from '../components/site/site-layout'
import type { HighlightedCode } from '../lib/highlight'
import { DEFAULT_OIDC_ISSUER } from '../services/oidc'
import { DEFAULT_CREDENTIAL_VALIDITY_DAYS, MAX_CREDENTIAL_VALIDITY_DAYS } from '../utils/credential-validity'

interface DevelopersProps {
  code: Record<SnippetKey, HighlightedCode>
}

const TOC: TocItem[] = [
  { id: 'how-login-works', label: 'How Renown login works' },
  { id: 'connect-link', label: 'Connect link reference' },
  { id: 'builder', label: 'Build a connect link' },
  { id: 'sdk', label: 'SDK quick start' },
  { id: 'app-identity', label: 'App identity and stats' },
  { id: 'oidc', label: 'Sign in with Renown (OIDC)' },
  { id: 'graphql', label: 'Public GraphQL reads' },
]

const FLOW = [
  { title: 'Your app sends the user to a connect link', body: 'The link names your app by its DID and says where to send the user afterwards.' },
  { title: 'The user approves', body: 'They sign in with their wallet and sign one credential that authorises your app key.' },
  { title: 'Renown stores the credential', body: 'It is public and revocable. The user is sent back with their DID in ?user=.' },
  { title: 'Your app verifies', body: 'Your server checks each request’s token and the credential behind it with @renown/sdk.' },
]

const Code = ({ value, label }: { value: HighlightedCode; label: string }) => (
  <CodeBlock code={value.code} html={value.html} label={label} className="mt-6" />
)

const Mono = ({ children }: { children: ReactNode }) => <code className="text-ink font-mono text-[0.9em]">{children}</code>

const PARAMS: ParamRow[] = [
  { name: 'connect', value: 'App DID (did:key:…)', description: 'The app asking for access. Required unless app is set.' },
  { name: 'app', value: 'App DID', description: 'Same as connect; when both are present, app wins.' },
  {
    name: 'returnUrl',
    value: 'Absolute http(s) URL',
    description: (
      <>
        After approval the user is sent here with <Mono>user=did:pkh:eip155:&lt;chainId&gt;:&lt;address&gt;</Mono> added
        (URL-encoded). Anything that is not an absolute http(s) URL is ignored and the flow ends on Renown.
      </>
    ),
  },
  {
    name: 'deeplink',
    value: 'URL scheme',
    description: (
      <>
        For native apps: after approval Renown opens <Mono>&lt;deeplink&gt;://login/&lt;did&gt;</Mono>. Takes precedence over
        returnUrl.
      </>
    ),
  },
  {
    name: 'expiresInDays',
    value: `Whole number, 1–${MAX_CREDENTIAL_VALIDITY_DAYS}`,
    description: `How long the credential is valid. Default ${DEFAULT_CREDENTIAL_VALIDITY_DAYS}; larger values are clamped to ${MAX_CREDENTIAL_VALIDITY_DAYS}; anything else falls back to ${DEFAULT_CREDENTIAL_VALIDITY_DAYS}. A non-default validity is shown to the user to confirm.`,
  },
]

function DocSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="border-hairline scroll-mt-24 border-t py-14 first:border-t-0 first:pt-0">
      <Heading level={2} size="h2" id={`${id}-title`} className="text-[1.75rem] md:text-[2rem]">
        {title}
      </Heading>
      {children}
    </section>
  )
}

const prose = 'text-ink-muted mt-4 max-w-[68ch] leading-7'
const link = 'text-primary-ink font-medium underline decoration-primary/30 underline-offset-4 hover:decoration-primary'

const DevelopersPage: NextPage<DevelopersProps> = ({ code }) => (
  <SiteLayout>
    <PageMeta
      title="Developers"
      path="/developers"
      description="Add Renown sign-in to your app: connect links, credentials, @renown/sdk, OpenID Connect and public GraphQL reads."
    />
    <Container className="pt-14 pb-10 md:pt-20">
      <Eyebrow>Developers</Eyebrow>
      <Heading level={1} size="h1" className="max-w-[18ch]">
        Build with Renown
      </Heading>
      <Lead>
        Let people sign in to your app with their Renown identity and act through a key they authorised, then verify it on
        your server. Everything here works against production today.
      </Lead>
    </Container>
    <Container className="grid gap-12 pb-24 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-16">
      <aside className="hidden lg:block">
        <Toc items={TOC} />
      </aside>
      <div className="min-w-0">
        <DocSection id="how-login-works" title="How Renown login works">
          <ol className="mt-8 grid gap-4 sm:grid-cols-2">
            {FLOW.map((step, index) => (
              <li key={step.title} className="border-hairline bg-surface-1 rounded-card border p-5">
                <span className="text-primary-ink font-mono text-sm font-semibold">{index + 1}</span>
                <h3 className="text-ink mt-2 font-semibold">{step.title}</h3>
                <p className="text-ink-muted mt-1.5 text-sm leading-6">{step.body}</p>
              </li>
            ))}
          </ol>
        </DocSection>

        <DocSection id="connect-link" title="Connect link reference">
          <p className={prose}>
            A connect link opens the Renown sign-in flow for your app:
          </p>
          <p className="bg-code border-hairline text-ink mt-4 rounded-[var(--radius-control)] border px-4 py-3 font-mono text-sm break-all">
            https://www.renown.id/?connect=&lt;app DID&gt;&amp;returnUrl=&lt;url&gt;&amp;expiresInDays=&lt;n&gt;
          </p>
          <div className="mt-6">
            <ParamTable rows={PARAMS} />
          </div>
        </DocSection>

        <DocSection id="builder" title="Build a connect link">
          <p className={prose}>
            Fill in your app&apos;s details. The link is checked with the same rules the sign-in flow applies.
          </p>
          <div className="mt-8">
            <ConnectLinkBuilder />
          </div>
        </DocSection>

        <DocSection id="sdk" title="SDK quick start">
          <p className={prose}>
            <Mono>@renown/sdk</Mono> gives your app a key pair and identity in the browser, logs the user in once they
            approve, signs short-lived bearer tokens, and verifies them on your server.
          </p>
          <Code value={code.install} label={SNIPPETS.install.label} />
          <h3 className="text-ink text-h3 mt-10">1. Give your app an identity</h3>
          <Code value={code.identity} label={SNIPPETS.identity.label} />
          <h3 className="text-ink text-h3 mt-10">2. Complete the login when the user returns</h3>
          <Code value={code.callback} label={SNIPPETS.callback.label} />
          <h3 className="text-ink text-h3 mt-10">3. Call your API with a bearer token</h3>
          <Code value={code.bearer} label={SNIPPETS.bearer.label} />
          <h3 className="text-ink text-h3 mt-10">4. Verify requests on your server</h3>
          <Code value={code.verify} label={SNIPPETS.verify.label} />
        </DocSection>

        <DocSection id="app-identity" title="App identity and stats">
          <p className={prose}>
            Apps built and hosted on{' '}
            <a className={link} href={VETRA_URL} target="_blank" rel="noopener noreferrer">
              Vetra
            </a>{' '}
            get their Renown identity there, along with a public app profile at <Mono>renown.id/app/&lt;DID&gt;</Mono>. Apps
            can report per-user stats that appear on user profiles and app pages; see the{' '}
            <a className={link} href={APP_STATS_DOCS_URL} target="_blank" rel="noopener noreferrer">
              app stats docs
            </a>
            .
          </p>
        </DocSection>

        <DocSection id="oidc" title="Sign in with Renown (OIDC)">
          <p className={prose}>
            Renown is also an OpenID Connect provider (authorization code flow with PKCE, RS256 ID tokens). Point any OIDC
            client at the issuer:
          </p>
          <p className="bg-code border-hairline text-ink mt-4 rounded-[var(--radius-control)] border px-4 py-3 font-mono text-sm break-all">
            {DEFAULT_OIDC_ISSUER}
          </p>
          <Code value={code.oidc} label={SNIPPETS.oidc.label} />
          <p className={prose}>
            Client registration is not self-service yet: clients are registered by the Renown operators.
          </p>
        </DocSection>

        <DocSection id="graphql" title="Public GraphQL reads">
          <p className={prose}>
            Profiles, app profiles and app stats are public. Read app profiles and stats from{' '}
            <Mono>https://switchboard.renown.vetra.io/graphql/renown-stats</Mono> (queries <Mono>appProfile</Mono>,{' '}
            <Mono>appProfiles</Mono>, <Mono>appStats</Mono>, <Mono>userStats</Mono>) and user profiles from{' '}
            <Mono>https://switchboard.renown.vetra.io/graphql</Mono> (<Mono>renownUsers</Mono>).
          </p>
          <Code value={code.graphql} label={SNIPPETS.graphql.label} />
          <Code value={code.graphqlCurl} label={SNIPPETS.graphqlCurl.label} />
        </DocSection>
      </div>
    </Container>
  </SiteLayout>
)

export const getStaticProps: GetStaticProps<DevelopersProps> = async () => {
  const { highlightAll } = await import('../lib/highlight')
  const code = await highlightAll(SNIPPETS)
  return { props: { code } }
}

export default DevelopersPage
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm exec playwright test e2e/connect-link.spec.ts e2e/developers.spec.ts --workers=3`
Expected: 4 + 5 passed.

- [ ] **Step 8: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add utils/connect-link.ts components/developers pages/developers.tsx e2e/connect-link.spec.ts e2e/developers.spec.ts
git commit -m "feat(developers): developer guide with a live connect link builder"
```

---

## Task 8: `/trust` and `/ecosystem`

**Files:**
- Create: `components/trust/trust-content.ts`, `pages/trust.tsx`, `components/ecosystem/identity-flow-diagram.tsx`, `pages/ecosystem.tsx`
- Modify: `styles/globals.css` (flow diagram CSS)
- Test: `e2e/static-pages.spec.ts`

**Interfaces:**
- Consumes: `ECOSYSTEM` (Task 6), primitives, `PageMeta`, `isExternal`.
- Produces: `TRUST_CLAIMS`, `STORED`, `NEVER_HELD`, `OPEN_SOURCE`, `IdentityFlowDiagram`.

Claim → evidence (all re-checked during planning; every claim on the page links to its source):

| Claim | Evidence |
| --- | --- |
| DID is `did:pkh:eip155:<chain>:<address>` | `hooks/use-auth-flow.ts` `buildRedirectUrl` |
| App key: P-256 via Web Crypto, stored in IndexedDB | `@renown/sdk` `signer-*.js` (`ECDSA`, `namedCurve: "P-256"`, `subtle.generateKey`), `BrowserKeyStorage`, `keyDbName` default `renownKeyDB` |
| EIP-712 credential naming the app key; 7-day default, 365 max; non-default validity confirmed | `buildAndSignCredential`, `utils/credential-validity.ts`, comment in `use-auth-flow.ts` ("never signed silently") |
| Only the issuer can revoke; revoked/expired credentials ignored | renown-package `subgraphs/renown-auth/resolvers.ts` `renown_revokeCredential` (proven address must equal issuer), SDK `SwitchboardClient.getCredential` filters `revoked` and `expirationDate` |
| Operations signed over action, target and signer | SDK `signActionV2({ action, target, signer: actionSignerIdentity(this) })` |
| Stored: profile fields, public credentials, images via short-lived signed links | `processors/renown-user/migrations.ts` columns; `renownCredentials` public read (checked live); `services/media.ts` (302 to short-lived signed URL) |
| AGPL-3.0 | renown-package `LICENSE`, `@renown/sdk` `package.json` `"license": "AGPL-3.0-only"`; repos public (github.com/powerhouse-inc/renown, /renown-package, /powerhouse → 200) |

- [ ] **Step 1: Write the failing test** — `e2e/static-pages.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { attachScreenshots, expectNoSeriousA11yViolations, useTheme } from './support/site'

test.describe('/trust', () => {
  test('every claim links to its source code', async ({ page }) => {
    await page.goto('/trust')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Check how Renown works, not just what we say')
    const claims = page.locator('ol > li[id]')
    await expect(claims).toHaveCount(5)
    for (const claim of await claims.all()) {
      await expect(claim.getByRole('link', { name: /source code/ })).toHaveAttribute('href', /^https:\/\/github\.com\/powerhouse-inc\//)
    }
    await expect(page.getByRole('heading', { name: 'Never held' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Your Renown' })).toHaveAttribute('href', '/me')
  })
})

test.describe('/ecosystem', () => {
  test('describes the five systems and draws the identity flow', async ({ page }) => {
    await page.goto('/ecosystem')
    for (const name of ['Renown', 'Vetra', 'Achra', 'Connect', 'Switchboard']) {
      await expect(page.locator(`#${name.toLowerCase()}`).getByRole('heading', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('img', { name: 'How a Renown identity flows through the Powerhouse network' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Visit Achra' })).toHaveAttribute('href', 'https://www.achra.com')
  })
})

test.describe('mobile drawer navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  // Starts on a real page: in `next dev`, a 404 page reloads itself when another route compiles.
  test('a drawer link navigates and closes the drawer', async ({ page }) => {
    await page.goto('/ecosystem')
    await page.getByRole('button', { name: 'Open menu' }).click()
    const drawer = page.getByRole('dialog', { name: 'Menu' })
    await expect(drawer.getByRole('link', { name: 'Ecosystem' })).toHaveAttribute('aria-current', 'page')
    await drawer.getByRole('link', { name: 'Trust' }).click()
    await expect(page).toHaveURL(/\/trust$/, { timeout: 30_000 })
    await expect(drawer).toBeHidden()
  })
})

test.describe('error pages', () => {
  test('an unknown path is a designed, unindexed 404', async ({ page }) => {
    const response = await page.goto('/no-such-page')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { level: 1, name: 'This page is not on the network' })).toBeVisible()
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex')
    await expect(page.getByRole('link', { name: 'Go to the homepage' })).toHaveAttribute('href', '/')
    await expect(page.getByRole('banner')).toBeVisible()
  })
})

for (const path of ['/trust', '/ecosystem', '/no-such-page']) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${path} has no serious axe violations (${theme})`, async ({ page }, testInfo) => {
      await useTheme(page, theme)
      await page.goto(path)
      await expectNoSeriousA11yViolations(page)
      await attachScreenshots(page, testInfo, `${path.slice(1)}-${theme}`)
    })
  }
}
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec playwright test e2e/static-pages.spec.ts --workers=3`
Expected: FAIL — `/trust` and `/ecosystem` render the 404 page.

- [ ] **Step 3: Trust content and page**

`components/trust/trust-content.ts`:

```ts
// Every claim on /trust, each with the code it was verified against
// (renown-package, renown.id and @renown/sdk 6.2.3). Change a claim only
// together with its source.

const PKG = 'https://github.com/powerhouse-inc/renown-package/blob/main'
const SITE = 'https://github.com/powerhouse-inc/renown/blob/main'
const SDK = 'https://github.com/powerhouse-inc/powerhouse/tree/main/packages/renown'

export interface TrustClaim {
  id: string
  title: string
  body: string
  source: { label: string; href: string }
}

export const TRUST_CLAIMS: TrustClaim[] = [
  {
    id: 'identity',
    title: 'Your identity is your wallet address',
    body: 'Your Renown DID is did:pkh:eip155:<chain>:<address>, derived from the wallet you sign in with. There is no account, username or password behind it.',
    source: { label: 'use-auth-flow.ts', href: `${SITE}/hooks/use-auth-flow.ts` },
  },
  {
    id: 'app-keys',
    title: 'Each app gets its own key, on your device',
    body: 'When you use an app, it generates a P-256 key pair with your browser’s Web Crypto API and keeps it in IndexedDB. That key, not your wallet, signs the app’s requests and document operations.',
    source: { label: '@renown/sdk', href: SDK },
  },
  {
    id: 'credentials',
    title: 'Apps act for you only with a credential you signed',
    body: 'Approving an app means signing one EIP-712 verifiable credential with your wallet that names the app’s key. It is valid for 7 days unless the app asks for longer (365 days at most), and a non-default validity is always shown to you to confirm.',
    source: { label: 'credential-validity.ts', href: `${SITE}/utils/credential-validity.ts` },
  },
  {
    id: 'revocation',
    title: 'You can revoke any credential, and only you can',
    body: 'Revoking requires proof that you are the wallet that issued the credential. A revoked or expired credential is ignored by the SDK’s delegation check, so the app’s key stops being accepted on your behalf.',
    source: { label: 'renown-auth/resolvers.ts', href: `${PKG}/subgraphs/renown-auth/resolvers.ts` },
  },
  {
    id: 'operations',
    title: 'Your work is signed',
    body: 'Each document operation an app submits for you carries a signature over the action, the target document and the signer’s identity, so anyone can check who made a change.',
    source: { label: '@renown/sdk signer', href: SDK },
  },
]

export const STORED: string[] = [
  'Your public profile: display name, handle, bio, links, avatar and the wallet address it belongs to.',
  'The credentials you sign, which are public so that anyone can verify them, including whether they were revoked.',
  'Images you upload, kept in object storage and served through short-lived signed links.',
]

export const NEVER_HELD: string[] = [
  'Your wallet’s private key or seed phrase. Every wallet signature happens in your wallet.',
  'The private keys apps generate on your device.',
  'A password: there is none.',
]

export const OPEN_SOURCE = [
  { label: 'renown-package', detail: 'Credentials, profiles, OIDC, stats (switchboard package)', href: 'https://github.com/powerhouse-inc/renown-package' },
  { label: 'renown.id', detail: 'This website and the sign-in flow', href: 'https://github.com/powerhouse-inc/renown' },
  { label: '@renown/sdk', detail: 'The SDK apps use to sign and verify', href: SDK },
]

export const STORAGE_SOURCE = `${PKG}/processors/renown-user/migrations.ts`
```

`pages/trust.tsx`:

```tsx
import type { NextPage } from 'next'
import Link from 'next/link'
import { PageMeta } from '../components/site/page-meta'
import { Card, Container, Eyebrow, Heading, Lead, Section } from '../components/site/primitives'
import { SiteLayout } from '../components/site/site-layout'
import { NEVER_HELD, OPEN_SOURCE, STORAGE_SOURCE, STORED, TRUST_CLAIMS } from '../components/trust/trust-content'

const sourceLink = 'text-ink-muted hover:text-primary-ink mt-4 inline-flex items-center gap-1.5 font-mono text-xs transition-colors'

function SourceIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m16 18 6-6-6-6M8 6l-6 6 6 6" />
    </svg>
  )
}

const TrustPage: NextPage = () => (
  <SiteLayout>
    <PageMeta
      title="Trust"
      path="/trust"
      description="How Renown identities, keys and credentials work, what Renown stores, and what it never holds. Every claim links to the code."
    />
    <Container className="pt-14 pb-6 md:pt-20">
      <Eyebrow>Trust</Eyebrow>
      <Heading level={1} className="max-w-[20ch]">
        Check how Renown works, not just what we say
      </Heading>
      <Lead>
        Every statement on this page links to the open-source code that implements it.
      </Lead>
    </Container>

    <Section labelledBy="claims-title" spacing="sm">
      <h2 id="claims-title" className="sr-only">
        How it works
      </h2>
      <ol className="border-hairline divide-hairline divide-y border-y">
        {TRUST_CLAIMS.map((claim) => (
          <li key={claim.id} id={claim.id} className="grid gap-3 py-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:gap-12 md:py-10">
            <h3 className="text-ink text-h3 max-w-[28ch]">{claim.title}</h3>
            <div>
              <p className="text-ink-muted leading-7">{claim.body}</p>
              <a href={claim.source.href} target="_blank" rel="noopener noreferrer" className={sourceLink}>
                <SourceIcon />
                {claim.source.label}
                <span className="sr-only"> (source code)</span>
              </a>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-ink-muted mt-6 text-sm">
        Want to see or revoke what you have approved?{' '}
        <Link href="/me" className="text-primary-ink font-medium underline underline-offset-4">
          Open Your Renown
        </Link>
        .
      </p>
    </Section>

    <Section labelledBy="data-title" spacing="sm">
      <Heading level={2} id="data-title">
        What Renown stores, and what it never holds
      </Heading>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        <Card className="p-6 md:p-8">
          <h3 className="text-ink text-h3">Stored</h3>
          <ul className="mt-5 space-y-4">
            {STORED.map((item) => (
              <li key={item} className="text-ink-muted flex gap-3 leading-7">
                <span aria-hidden="true" className="bg-primary mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full" />
                {item}
              </li>
            ))}
          </ul>
          <a href={STORAGE_SOURCE} target="_blank" rel="noopener noreferrer" className={sourceLink}>
            <SourceIcon />
            renown-user/migrations.ts
            <span className="sr-only"> (source code)</span>
          </a>
        </Card>
        <Card className="border-signal/30 p-6 md:p-8">
          <h3 className="text-ink text-h3">Never held</h3>
          <ul className="mt-5 space-y-4">
            {NEVER_HELD.map((item) => (
              <li key={item} className="text-ink-muted flex gap-3 leading-7">
                <svg aria-hidden="true" className="text-signal mt-1.5 shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </Section>

    <Section labelledBy="oss-title" spacing="sm" className="pb-24">
      <Heading level={2} id="oss-title">
        Open source
      </Heading>
      <Lead>The Renown package and SDK are AGPL-3.0 licensed, and this website&apos;s code is public. Read it, run it, audit it.</Lead>
      <ul className="mt-10 grid gap-4 md:grid-cols-3">
        {OPEN_SOURCE.map((repo) => (
          <li key={repo.label}>
            <a
              href={repo.href}
              target="_blank"
              rel="noopener noreferrer"
              className="border-hairline bg-surface-1 rounded-card hover:border-primary/40 block h-full border p-6 transition-colors"
            >
              <span className="text-ink font-mono text-sm font-semibold">{repo.label}</span>
              <span className="text-ink-muted mt-2 block text-sm leading-6">{repo.detail}</span>
            </a>
          </li>
        ))}
      </ul>
    </Section>
  </SiteLayout>
)

export default TrustPage
```

- [ ] **Step 4: Ecosystem diagram and page**

`components/ecosystem/identity-flow-diagram.tsx`:

```tsx
// How one Renown identity moves through the network (static SVG on /ecosystem).

interface Box {
  id: string
  x: number
  y: number
  label: string
  sub: string
  primary?: boolean
}

const W = 168
const H = 64
const BOXES: Box[] = [
  { id: 'you', x: 16, y: 152, label: 'You', sub: 'your wallet DID' },
  { id: 'renown', x: 330, y: 152, label: 'Renown', sub: 'credentials and profiles', primary: true },
  { id: 'app', x: 640, y: 40, label: 'Connect and apps', sub: 'act with an app key' },
  { id: 'switchboard', x: 640, y: 248, label: 'Switchboard', sub: 'stores signed changes' },
  { id: 'vetra', x: 330, y: 312, label: 'Vetra', sub: 'app identities' },
  { id: 'achra', x: 640, y: 376, label: 'Achra', sub: 'listings and reviews' },
]

interface Edge {
  d: string
  label: string
  lx: number
  ly: number
  anchor?: 'start' | 'middle' | 'end'
  dashed?: boolean
}

const EDGES: Edge[] = [
  { d: 'M184 184 H326', label: 'you sign a credential', lx: 257, ly: 172 },
  { d: 'M498 172 C572 172 566 72 636 72', label: 'authorises the app key', lx: 552, ly: 112, anchor: 'end' },
  { d: 'M724 104 V244', label: 'signed changes', lx: 734, ly: 180, anchor: 'start' },
  { d: 'M414 312 V220', label: 'registers apps', lx: 424, ly: 270, anchor: 'start' },
  { d: 'M498 204 C590 204 560 408 636 408', label: 'same identity', lx: 590, ly: 330, anchor: 'start', dashed: true },
]

export function IdentityFlowDiagram() {
  return (
    <svg viewBox="0 0 824 456" role="img" aria-labelledby="flow-title-svg flow-desc-svg" className="rn-flow h-auto w-full min-w-[720px]">
      <title id="flow-title-svg">How a Renown identity flows through the Powerhouse network</title>
      <desc id="flow-desc-svg">
        You sign a credential on Renown that authorises an app key. Connect and other apps act with that key and send signed
        changes to Switchboard. Vetra registers app identities on Renown, and Achra uses the same identity for listings and
        reviews.
      </desc>
      <defs>
        <marker id="rn-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0 10 5 0 10z" className="rn-flow-arrow" />
        </marker>
      </defs>
      {EDGES.map((edge) => (
        <g key={edge.label}>
          <path d={edge.d} className={edge.dashed ? 'rn-flow-edge rn-flow-dashed' : 'rn-flow-edge'} markerEnd="url(#rn-arrow)" />
          <text x={edge.lx} y={edge.ly} textAnchor={edge.anchor ?? 'middle'} className="rn-flow-edge-label">
            {edge.label}
          </text>
        </g>
      ))}
      {BOXES.map((box) => (
        <g key={box.id} transform={`translate(${box.x} ${box.y})`}>
          <rect width={W} height={H} rx={14} className={box.primary ? 'rn-flow-box rn-flow-primary' : 'rn-flow-box'} />
          <text x={W / 2} y={28} textAnchor="middle" className="rn-flow-label">
            {box.label}
          </text>
          <text x={W / 2} y={47} textAnchor="middle" className="rn-flow-sub">
            {box.sub}
          </text>
        </g>
      ))}
    </svg>
  )
}
```

Append to `styles/globals.css`:

```css
/* /ecosystem identity flow diagram. */
.rn-flow .rn-flow-box {
    fill: var(--surface-2);
    stroke: var(--hairline-strong);
}
.rn-flow .rn-flow-primary {
    fill: color-mix(in oklab, var(--primary) 14%, var(--background));
    stroke: var(--primary);
}
.rn-flow .rn-flow-label {
    fill: var(--ink);
    font-size: 15px;
    font-weight: 600;
}
.rn-flow .rn-flow-sub {
    fill: var(--ink-muted);
    font-size: 12px;
}
.rn-flow .rn-flow-edge {
    fill: none;
    stroke: var(--primary-ink);
    stroke-width: 1.5;
}
.rn-flow .rn-flow-dashed {
    stroke-dasharray: 5 6;
    stroke: var(--ink-muted);
}
.rn-flow .rn-flow-arrow {
    fill: var(--primary-ink);
}
.rn-flow .rn-flow-edge-label {
    fill: var(--ink-muted);
    font-size: 12px;
    paint-order: stroke;
    stroke: var(--background);
    stroke-width: 6px;
    stroke-linejoin: round;
}
```

`pages/ecosystem.tsx`:

```tsx
import type { NextPage } from 'next'
import { ECOSYSTEM } from '../components/ecosystem/ecosystem-data'
import { IdentityFlowDiagram } from '../components/ecosystem/identity-flow-diagram'
import { PageMeta } from '../components/site/page-meta'
import { Card, Container, Eyebrow, Heading, Lead, Section } from '../components/site/primitives'
import { SiteLayout } from '../components/site/site-layout'
import { isExternal } from '../components/site/nav'

const EcosystemPage: NextPage = () => (
  <SiteLayout>
    <PageMeta
      title="Ecosystem"
      path="/ecosystem"
      description="Renown, Vetra, Achra, Connect and Switchboard: how one identity flows through the Powerhouse network."
    />
    <Container className="pt-14 pb-6 md:pt-20">
      <Eyebrow>Ecosystem</Eyebrow>
      <Heading level={1} className="max-w-[20ch]">
        One identity across the Powerhouse network
      </Heading>
      <Lead>Renown is the identity layer. Here is what each part of the network does, and how your identity moves between them.</Lead>
    </Container>

    <Section labelledBy="flow-title" spacing="sm">
      <h2 id="flow-title" className="text-ink text-h3">
        How identity flows
      </h2>
      <Card className="mt-6 overflow-x-auto p-4 md:p-8">
        <IdentityFlowDiagram />
      </Card>
    </Section>

    <Section labelledBy="systems-title" spacing="sm" className="pb-24">
      <h2 id="systems-title" className="sr-only">
        Systems
      </h2>
      <ul className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {ECOSYSTEM.map((entry) => (
          <li key={entry.id} id={entry.id} className="scroll-mt-24">
            <Card className={`flex h-full flex-col p-6 ${entry.id === 'renown' ? 'border-primary/40 shadow-glow' : ''}`}>
              <h3 className="text-ink text-h3">{entry.name}</h3>
              <p className="text-primary-ink mt-1 text-sm font-medium">{entry.role}</p>
              <p className="text-ink-muted mt-4 flex-1 leading-7">{entry.detail}</p>
              <a
                href={entry.href}
                {...(isExternal(entry.href) ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                className="text-ink hover:text-primary-ink mt-6 text-sm font-semibold underline decoration-hairline-strong underline-offset-4"
              >
                {entry.id === 'renown' ? 'Back to Renown' : `Visit ${entry.name}`}
              </a>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  </SiteLayout>
)

export default EcosystemPage
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec playwright test e2e/static-pages.spec.ts --workers=3`
Expected: 10 passed.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add components/trust pages/trust.tsx components/ecosystem/identity-flow-diagram.tsx pages/ecosystem.tsx styles/globals.css e2e/static-pages.spec.ts
git commit -m "feat(site): trust and ecosystem pages"
```

---

## Task 9: robots.txt and sitemap.xml

**Files:**
- Create: `lib/sitemap.ts`, `pages/sitemap.xml.tsx`, `pages/robots.txt.tsx`
- Test: `e2e/crawling.spec.ts`

**Interfaces:**
- Consumes: `listAppProfiles`, `AppProfilePage` (Task 5), `withTimeout` (Task 5), `publicOrigin` (Task 2).
- Produces: `STATIC_PATHS`, `SITEMAP_APP_CAP`, `collectAppDids(fetchPage, cap?)`, `renderSitemap(origin, appDids)`, `renderRobots(origin)`; routes `/sitemap.xml` (application/xml) and `/robots.txt` (text/plain).

- [ ] **Step 1: Write the failing test** — `e2e/crawling.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { fixtureStub, removeFixture } from './support/stub-switchboard-client'
import { renderSitemap } from '../lib/sitemap'

// The sitemap's appProfiles walk uses limit 50; nothing else reads that page size.
const APP_DID = 'did:key:z6MkCrawlAppxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1'

test.beforeAll(async () => {
  await fixtureStub({
    id: 'crawl-sitemap',
    match: 'appProfiles(',
    variables: '"limit":50',
    response: { data: { appProfiles: { items: [{ appDid: APP_DID }], next: null } } },
  })
})

test.afterAll(async () => {
  await removeFixture('crawl-sitemap')
})

test.describe('crawling', () => {
  test('robots.txt allows the site and link previews, and points at the sitemap', async ({ request }) => {
    const response = await request.get('/robots.txt')
    expect(response.headers()['content-type']).toMatch(/text\/plain/)
    const text = await response.text()
    expect(text).toContain('Allow: /api/og')
    expect(text).toContain('Disallow: /api/')
    expect(text).toMatch(/Sitemap: https?:\/\/[^\s]+\/sitemap\.xml/)
  })

  test('sitemap.xml lists the static pages and every app profile', async ({ request }) => {
    const response = await request.get('/sitemap.xml')
    expect(response.headers()['content-type']).toMatch(/application\/xml/)
    const xml = await response.text()
    for (const path of ['/developers', '/trust', '/ecosystem', '/apps']) expect(xml).toContain(`${path}</loc>`)
    expect(xml).toContain(`/app/${APP_DID}</loc>`)
  })

  test('renderSitemap escapes XML', () => {
    expect(renderSitemap('https://x.test', ['did:key:a&b'])).toContain('<loc>https://x.test/app/did:key:a&amp;b</loc>')
  })
})

test.describe('per-page metadata', () => {
  for (const [path, title] of [
    ['/developers', 'Developers - Renown'],
    ['/trust', 'Trust - Renown'],
    ['/ecosystem', 'Ecosystem - Renown'],
  ]) {
    test(`${path} has title, description, canonical and a default card`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveTitle(title)
      await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.{40,}/)
      await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`${path}$`))
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/api\/og\?variant=default$/)
      await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
    })
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm exec playwright test e2e/crawling.spec.ts --workers=3`
Expected: FAIL — `Cannot find module '../lib/sitemap'`.

- [ ] **Step 3: Create `lib/sitemap.ts`** (robots keeps `/api/og` crawlable — Twitterbot honours robots.txt):

```ts
import type { AppProfilePage } from '../services/app-profiles'

/** Public, indexable site paths (pages Phase B/C add are listed here too). */
export const STATIC_PATHS = ['/', '/apps', '/developers', '/trust', '/ecosystem']

/** Most app profile URLs listed in the sitemap. */
export const SITEMAP_APP_CAP = 1000
const PAGE_SIZE = 50

/**
 * App DIDs from every appProfiles page, newest first, up to `cap`. A failing
 * page ends the walk with what was collected so far.
 */
export async function collectAppDids(
  fetchPage: (args: { limit: number; after?: string | null }) => Promise<AppProfilePage>,
  cap = SITEMAP_APP_CAP,
): Promise<string[]> {
  const dids: string[] = []
  let after: string | null = null
  while (dids.length < cap) {
    let page: AppProfilePage
    try {
      page = await fetchPage({ limit: Math.min(PAGE_SIZE, cap - dids.length), after })
    } catch (error) {
      console.error('sitemap: app profiles unavailable:', error)
      break
    }
    dids.push(...page.items.map((item) => item.appDid))
    if (!page.next || page.items.length === 0) break
    after = page.next
  }
  return dids.slice(0, cap)
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

/** sitemap.xml for the static paths and the given app DIDs. */
export function renderSitemap(origin: string, appDids: string[]): string {
  const urls = [...STATIC_PATHS.map((path) => `${origin}${path === '/' ? '' : path}`), ...appDids.map((did) => `${origin}/app/${did}`)]
  const body = urls.map((url) => `  <url><loc>${escapeXml(url)}</loc></url>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`
}

/** robots.txt: everything public except the API (link previews stay crawlable), the editor and the sign-in screens. */
export function renderRobots(origin: string): string {
  return ['User-agent: *', 'Allow: /', 'Allow: /api/og', 'Disallow: /api/', 'Disallow: /profile/edit', 'Disallow: /console', 'Disallow: /oidc/', '', `Sitemap: ${origin}/sitemap.xml`, ''].join('\n')
}
```

- [ ] **Step 4: Routes**

`pages/sitemap.xml.tsx`:

```tsx
import type { GetServerSideProps } from 'next'
import { collectAppDids, renderSitemap } from '../lib/sitemap'
import { listAppProfiles } from '../services/app-profiles'
import { publicOrigin } from '../utils/seo'
import { withTimeout } from '../utils/with-timeout'

/** Overall budget for paging through app profiles. */
const SITEMAP_TIMEOUT_MS = 8000

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const dids = await withTimeout(collectAppDids(listAppProfiles), SITEMAP_TIMEOUT_MS).catch((error: unknown) => {
    console.error('sitemap: app profiles timed out:', error)
    return []
  })
  res.setHeader('Content-Type', 'application/xml; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
  res.write(renderSitemap(publicOrigin(), dids))
  res.end()
  return { props: {} }
}

export default function Sitemap() {
  return null
}
```

`pages/robots.txt.tsx`:

```tsx
import type { GetServerSideProps } from 'next'
import { renderRobots } from '../lib/sitemap'
import { publicOrigin } from '../utils/seo'

export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, s-maxage=86400')
  res.write(renderRobots(publicOrigin()))
  res.end()
  return { props: {} }
}

export default function Robots() {
  return null
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm exec playwright test e2e/crawling.spec.ts --workers=3`
Expected: 6 passed.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
pnpm exec tsc --noEmit && pnpm lint
git add lib/sitemap.ts pages/sitemap.xml.tsx pages/robots.txt.tsx e2e/crawling.spec.ts
git commit -m "feat(seo): robots.txt and sitemap.xml with app profile URLs"
```

---

## Task 10: Whole-branch verification

**Files:** none (verification only; fix forward in the task that owns a failure).

- [ ] **Step 1: Static checks and production build**

```bash
pnpm exec tsc --noEmit && pnpm lint && pnpm build
```

Expected: no errors; the route table lists `● /developers` (SSG) and `ƒ /api/og`, `/sitemap.xml`, `/robots.txt`, `/trust`, `/ecosystem`, `/404`, `/500`.

- [ ] **Step 2: shiki stays on the server**

```bash
grep -rlE "createHighlighterCore|shikijs|github-dark-default" .next/static || echo "client bundles clean"
```

Expected: `client bundles clean`. Page chunks stay small (`ls -la .next/static/chunks/pages`: `index` ≈ 35 kB, `developers` ≈ 25 kB raw).

- [ ] **Step 3: Full e2e suite**

```bash
pnpm exec playwright test --workers=3
```

Expected: all pass (173 at the time of planning). A cold dev server can make the first spec of a route time out; rerun only the failed specs before investigating.

- [ ] **Step 4: Screenshot review.** `pnpm exec playwright show-report` → open the axe tests in `home.spec.ts`, `developers.spec.ts`, `static-pages.spec.ts`: each has light/dark × 390/1280 screenshots. Check: no horizontal scroll at 390; header never wraps; code blocks scroll inside their frame; footer columns 2-up on mobile.

- [ ] **Step 5: Manual signed-in check (Review Focus 1).** `pnpm dev` against a real switchboard (no stub env), sign in with a wallet from the header, then: the avatar button appears; Enter opens the menu with focus on "Your Renown"; ↓ moves to "Your profile" (`/@handle` or `/profile/<address>`); Esc closes and focus returns; outside click closes; "Sign out" signs out and "Sign in" returns. At 390 px the drawer shows the same account links. The homepage CTA reads "Go to your Renown" while signed in.

- [ ] **Step 6: Lighthouse handoff.** The spec's Lighthouse bar is measured on the staging deploy (spec rollout step 2), not in this phase. Record the mobile scores for `/` and `/developers` when renown-staging runs this branch; `/apps` is Phase B.

- [ ] **Step 7: Clean tree.** `git status` shows nothing to commit (Next may touch `next-env.d.ts` during build; `git checkout next-env.d.ts`).

---

## Self-review

**Spec coverage (Phase A scope):** site shell — Task 3 (SiteLayout site|auth, sticky translucent header with avatar menu + drawer with focus trap/Esc/`aria-expanded`, footer columns/legal/social exactly as specified); tokens + primitives — Task 1 (type scale, `--radius-*`, `surface-1/2/3`, `--glow-primary`, gradient stops; Container/Section/Eyebrow/Heading/Card/Badge/CodeBlock with live-region "Copied"/Reveal); homepage — Task 6 (hero copy and CTAs incl. signed-in "Go to your Renown", constellation < 15 kB, `aria-hidden`, static under reduced motion; pillars; how it works; featured apps via `appProfiles(limit: 6)` hidden < 3; typed `pulse` slot rendering nothing; developers teaser; ecosystem strip; final CTA); `/developers` — Task 7 (all seven sections; builder on the real parsers; SDK snippets limited to verified APIs; OIDC included after the live discovery check; GraphQL reads; SSG + build-time shiki); `/trust` — Task 8 (claims verified, cuts listed above); `/ecosystem` — Task 8 (five cards + SVG flow); existing pages migrated — Task 4; designed 404/500 — Task 3; SEO (per-page meta, canonical, OG route default/profile/app + fallback, robots, sitemap with app URLs capped at 1000, JSON-LD on `/`) — Tasks 2, 6, 9; axe both themes + screenshots light/dark 390/1280 — Tasks 3, 6, 7, 8 helpers/specs; auth screens minimal and existing specs green — Tasks 3, 6, 10. Phase B/C items (`/apps`, `/me`, network pulse data, backend queries) are out of scope by instruction.

**Placeholder scan:** no TBD/TODO; every code step has the full file or an exact diff.

**Type consistency:** `OgImageParams` uses `address` everywhere (Tasks 2, 4); `HighlightedCode` is produced in Task 5 and consumed by `CodeBlock` props (`code`, `html`) in Tasks 6–7; `AppProfilePage` from Task 5 is used by `collectAppDids` in Task 9; `SiteAuth` states (`loading|signed-out|signed-in`) match in `AuthSlot` and `MobileNav`.

**Review Focus:** five uncovered conditions listed at the top; each that can be checked is folded into Task 10 (steps 4–5).
