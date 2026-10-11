# renown.id site follow-ups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marketing pages of renown.id ship no wallet code (mobile Lighthouse Performance ≥ 90), `/api/og` draws real WebP/AVIF/SVG images via sharp on the Node runtime, `/me`'s profile read is bounded by a timeout, and OG cards clamp long text.

**Architecture:** `pages/_app.tsx` keeps only `<Renown>` (session restore) and drops `AuthRootProvider`; each wallet route loads the wallet stack and its own body together through `withLazyWalletShell()` (`next/dynamic`, `ssr: false`), and `pnpm build` fails when a marketing page's chunks contain wallet markers. `/api/og` becomes a Node API route that converts every fetched image to a bounded PNG with sharp before Satori draws it.

**Tech Stack:** Next 16.2.6 pages router (webpack build), React 19.2.6, Tailwind v4, `next/og` (Satori), sharp 0.34.5, Playwright e2e with the stub switchboard, pnpm 10.

**Spec:** `/home/f/projects/renown-package-hub/docs/superpowers/specs/2026-10-10-renown-site-followups-design.md` (parent: `2026-10-09-renown-site-polish-design.md`, its global constraints still apply).

**Code repo:** `/home/f/projects/renown-hub` (powerhouse-inc/renown), branch `feat/site-followups` (= origin/main 6bc7ae0, release 1.21.1). All paths below are relative to that repo.

## Planner rulings

These were decided while implementing every task in a scratch worktree (all tests below were run there):

1. **Factory instead of a children wrapper.** The spec's `LazyWalletShell` is implemented as `withLazyWalletShell(loadBody, Fallback)` in `components/wallet/lazy-wallet-shell.tsx`: one `next/dynamic` (`ssr: false`) that downloads `wallet-shell.tsx` and the route's body in parallel (one round trip, no waterfall) and renders the body inside `AuthRootProvider`. A `<LazyWalletShell>{children}</LazyWalletShell>` would leave the wallet-dependent children statically imported in the page chunk, so the footer's "Your Renown" `<Link>` prefetch would still pull wallet code onto marketing pages. Per-route fallbacks keep each page's existing loading UI.
2. **Fallbacks handle a failed chunk download** (`error` prop of the dynamic loading component): "Sign-in could not load" + Reload, never an endless skeleton.
3. **The shell is per route**, so a client-side navigation between wallet routes remounts the providers. Verified: `/me` → `/profile/edit` keeps the wallet session (e2e test in Task 3).
4. **`AnalyticsIdentity` follows the Renown session** (`useRenownAuth()`), and only acts once the status is settled (`authorized`/`not-authorized`), so a returning user is not cleared during restore. `accountType` is no longer sent (only the wallet session knows it). Users in a third-party connect flow who are not signed into renown.id itself are no longer identified — this follows from the spec.
5. **The wallet-chunk check runs inside `pnpm build`** (`next build --webpack && node scripts/check-wallet-chunks.mjs`). This runs in the Docker builder on every PR and push (the CI's `docker/build-push-action`) and on Vercel. The markers are strings only those libraries contain (`auth.privy.io`, `@privy-io`, `walletconnect`, `rainbowkit`, `[data-rk]`, `wagmi`, `@reown`), with a positive control so a renamed marker cannot pass silently. Plain `privy` is **not** a marker: `@powerhousedao/reactor-browser/renown` contains the `privy_oauth_code` URL parameter name.
6. **The axe gate was vacuous (found during planning).** RainbowKitProvider wraps the whole page in `<div data-rk>`, and `e2e/support/site.ts` excluded `[data-rk]`, so every "no serious axe violations" test checked nothing. Once the wallet providers leave `_app`, axe really runs and finds existing light-theme contrast failures (`--destructive` #EA4335 on white 3.92:1, `--signal` #007A57 on its 15 % tint 4.33:1, shiki `github-light` keywords and comments ≈ 4.3:1). Task 1 fixes the helper (skip only RainbowKit's `<body>` portals) and the colours **first, on main**. Verified: on origin/main, the fixed helper fails `/` and `/developers` (light), and the three colour changes make all 62 axe-bearing tests pass.
7. **`DEFAULT_OIDC_ISSUER` moves to `utils/oidc-issuer.ts`** so `/developers` stops bundling `viem/siwe` (`services/oidc.ts` re-exports it): −13 KB raw on `/developers`.
8. **Every OG image goes through sharp**, PNG/JPEG/GIF included, so `limitInputPixels` (40 MP) and the resize to 256 px apply to all formats. No cover box: no card variant draws a cover (YAGNI).
9. **OG failure classes:** fetch/host/type/size failures → default card, degraded cache (unchanged); undecodable bytes or a pixel bomb → the intended card with its monogram, normal cache (spec); a Satori draw failure → default card, degraded cache (new guard, the route never 500s). New header `X-Og-Image: drawn | monogram | none`.
10. **sharp 0.34.5 becomes a direct dependency** (the same version `next` already pulls in optionally). There is no Dockerfile or `supportedArchitectures` change: `pnpm i` on node:22-alpine installs `@img/sharp-linuxmusl-x64` (verified in the built image).
11. **Fonts on Node** are read with `fs` from `assets/fonts` and traced into the standalone output with `outputFileTracingIncludes['/api/og']`. The old `fetch(new URL(…, import.meta.url))` only works on edge.
12. **`useOwnProfile` timeout** (`CLIENT_DATA_TIMEOUT_MS` = 10 s) resolves as loaded, with no profile and `timedOut: true`. `/me` then shows a status line, and a late answer is ignored. `getProfile` never rejects, so only the timeout reaches the catch.
13. **Lazy flows in dev e2e:** `next dev` compiles the lazily loaded flow chunk on first request, so the first visible assertion after `goto` in `console-page.spec.ts` and `oidc-login.spec.ts` gets `{ timeout: 30_000 }` (as other flow specs already do). Under three workers these failed intermittently at the 5 s default.

## Measured before/after (scratch worktree, production build)

Build env: `NEXT_PUBLIC_PRIVY_APP_ID` set (as in prod), switchboard unreachable (data sections omitted). The JS counted is what the page loads up front (polyfills + main + framework + `_app` + page chunks from `.next/build-manifest.json`).

| Page | Before raw / gzip | After raw / gzip |
|---|---|---|
| `/` | 4149 KB / 1221 KB | 1228 KB / 374 KB |
| `/apps` | 4070 KB / 1190 KB | 1207 KB / 366 KB |
| `/developers` | 4082 KB / 1194 KB | 1215 KB / 369 KB |
| `_app` chunk alone | 3685 KB | 807 KB |

The remaining `_app` weight is mostly viem + multiformats pulled in by `@renown/sdk` through `<Renown>` (out of scope).

Lighthouse 12.6.0 mobile, `pnpm build && pnpm start -p 3100`, two runs each (Perf / A11y / BP / SEO, TBT):

| Page | Before | After |
|---|---|---|
| `/` | 73, 77 / 100 / 75 / 100 — TBT 880, 770 ms | 96, 95 / 100 / 96 / 100 — TBT 60, 90 ms |
| `/apps` | 81, 81 / 100 / 75 / 100 — TBT 690, 670 ms | 98, 98 / 100 / 96 / 100 — TBT 70, 30 ms |
| `/developers` | 81, 80 / 100 / 75 / 100 — TBT 620, 720 ms | 97, 97 / 100 / 96 / 100 — TBT 30, 30 ms |

CLS 0 everywhere, before and after. These are local numbers; the spec's target is staging/prod (Task 7).

Docker (`docker build` of the unchanged Dockerfile, node:22-alpine): the build passed, including the wallet-chunk check. In the running container (`--network host`, stub switchboard on the host), WebP, AVIF and SVG avatars returned `X-Og-Image: drawn`; the corrupt WebP and the 64 MP PNG returned `monogram` with the long cache. `node_modules/.pnpm` contains `@img+sharp-linuxmusl-x64@0.34.5` and `@img+sharp-libvips-linuxmusl-x64@1.2.4`. Image size: 499 MB.

Full e2e suite (`--workers=3`) after all tasks: 241 passed + 1 dev-compile timeout, fixed by the ruling-13 timeouts (both specs then 12/12). The "wallet code cannot be downloaded" test was added afterwards and passes (wallet-split 7/7), so the suite is 243 tests. One earlier full run hit a known dev-overlay flake in `renown-writes.spec.ts:528` (`Revoke` matched two "Open in editor" overlay buttons); it passed on rerun.

## Global Constraints

- Next.js 16.2.6 pages router, React 19.2.6, Tailwind v4 tokens in `styles/globals.css`; keep dark-first look, Inter, primary `#0084FF`.
- Existing URLs keep working unchanged: `/?app=…`, `/?connect=…` (+ `deeplink`, `returnUrl`, `expiresInDays`), `/console`, `/oidc/login`, `/profile/[id]`, `/@handle`, `/profile/edit`, `/app/[did]`, `/media/...`, all `/api/*`.
- Auth screens (WebFlow on `/` with `app`/`connect`, `/console`, `/oidc/login`) render inside the minimal auth chrome (logo + theme toggle only).
- No new runtime dependency over 30 kB gzip **on the client** (sharp is server-only and must never reach a client bundle).
- Nothing reachable from marketing pages (`/`, `/apps`, `/developers`, `/trust`, `/ecosystem`, `/app/[did]`, `/profile/[id]`, `/@handle`, 404/500) may import `services/wallet/*`, `auth-providers/*`, `hooks/use-wallet-adapter`, `hooks/auth`, `utils/wagmi`, wagmi, Privy, RainbowKit or WalletConnect modules.
- Behaviour on wallet routes is unchanged; all existing e2e specs for `?app`/`?connect`, `/console`, `/oidc/login`, `/profile/edit`, `/me` (incl. `NEXT_PUBLIC_E2E_AUTH`) stay green.
- OG route: only the site's own `/media` route, manual redirects to allowlisted storage hosts, byte cap while streaming, type allowlist, timeout, default-card fallback + degraded cache on real failures; conversion failures → monogram (normal cache), never 500; sharp `limitInputPixels` 40 MP; logo/avatar ≤ 256 px.
- `/me` profile read bounded by `CLIENT_DATA_TIMEOUT_MS`; on timeout "loaded, no profile", page explains, `console.warn` without sensitive data.
- OG names and taglines clamp to 2 lines with an ellipsis; handles likewise (1 line); verified with 120-character fixtures.
- Accessibility and SEO stay 100; CLS stays 0.
- No `Co-Authored-By` trailers in commits. Staging first, then prod.

## Review Focus

1. **The wallet chunk fails to download on a sign-in link** (deploy replaced chunks, flaky network): the visitor should see "Sign-in could not load" with a Reload button, not an endless "Signing you in" skeleton. Test: Task 3, `wallet-split.spec.ts` "when the wallet code cannot be downloaded…".
2. **Client-side navigation between two wallet routes** (`/me` → `/profile/edit`) remounts the wallet providers: the user must stay signed in, with no Sign-in prompt. Test: Task 3, "moving between wallet routes in the app keeps the wallet session".
3. **Header "Sign in" on a marketing page** (which now has no wallet code) must still land on the working sign-in flow, which loads the wallet stack there. Test: Task 3, "header Sign in leads to the sign-in flow…".
4. **A stored avatar or logo that is corrupt or a decompression bomb** must still yield a 200 card with the monogram and the long cache, never a 500 or an hour-long degraded fallback. Tests: Task 4, "draw the monogram when the image cannot be decoded or is a decompression bomb" + caching assertions.
5. **The switchboard hangs on the profile read on `/me`**: Download must enable after the timeout, the page must say the profile is missing, and the file must say `profile: null`. Test: Task 6.

---

### Task 1: Make the axe gate real and fix the light-theme contrast it finds

**Files:**
- Modify: `e2e/support/site.ts` (`expectNoSeriousA11yViolations`)
- Modify: `styles/globals.css` (light `:root`: `--destructive`, `--signal`)
- Modify: `lib/highlight.ts` (light shiki theme)

**Interfaces:**
- Consumes: nothing.
- Produces: `expectNoSeriousA11yViolations(page)` keeps its signature but now checks everything except RainbowKit modals portalled onto `<body>`; later tasks rely on it actually checking marketing and wallet pages.

- [ ] **Step 1: Fix the helper so it no longer excludes the whole page**

In `e2e/support/site.ts` replace

```ts
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    // Third-party wallet modals are not part of the page under test.
    .exclude('[data-rk]')
    .analyze()
```

with

```ts
  // Third-party wallet modals are not part of the page under test. RainbowKit
  // marks both its modals (portals on <body>) and its provider's wrapper with
  // [data-rk], and the wrapper holds page content: skip only the [data-rk]
  // elements that neither sit in nor wrap the page's <main>.
  await page.evaluate(() => {
    const main = document.querySelector('main')
    for (const el of Array.from(document.querySelectorAll('[data-rk]'))) {
      if (!main || (!main.contains(el) && !el.contains(main))) el.setAttribute('data-axe-skip', '')
    }
  })
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
    .exclude('[data-axe-skip]')
    .analyze()
```

- [ ] **Step 2: Run the axe tests to see them fail**

Run: `npx playwright test e2e/developers.spec.ts:86 e2e/home.spec.ts:213 --workers=2 --reporter=line`
Expected: FAIL. Both light variants report `color-contrast`: on `/` for `.bg-signal\/15` and the code-teaser keyword spans; on `/developers` for `#…-did-msg` (#ea4335 on #ffffff, 3.92) and the code-block spans (#d73a49 / #6e7781 on #f6f8fb, ≈ 4.3).

- [ ] **Step 3: Fix the colours**

In `styles/globals.css`, in the first (light) `:root` block, replace

```css
    --accent-foreground: #FFFFFF;
    --destructive: #EA4335;
```

with

```css
    --accent-foreground: #FFFFFF;
    /* Darker than the dark theme's red: 5.8:1 on white (WCAG AA for text). */
    --destructive: #C5221F;
```

(only the first occurrence; the dark block keeps `#EA4335`), and in the same light block replace `--signal: #007A57;` with `--signal: #006B4C;` (5.3:1 on its 15 % tint).

In `lib/highlight.ts` replace both `github-light` references:

```ts
    themes: [import('shiki/themes/github-light-high-contrast.mjs'), import('shiki/themes/github-dark-default.mjs')],
```

```ts
    themes: { light: 'github-light-high-contrast', dark: 'github-dark-default' },
```

- [ ] **Step 4: Run every axe-bearing spec**

Run: `npx playwright test e2e/apps.spec.ts e2e/home.spec.ts e2e/me.spec.ts e2e/developers.spec.ts e2e/static-pages.spec.ts --workers=3 --reporter=line`
Expected: PASS (62 tests on main).

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint && npx tsc --noEmit -p .
git add e2e/support/site.ts styles/globals.css lib/highlight.ts
git commit -m "fix(a11y): check the page under RainbowKit's wrapper and meet AA contrast in light theme"
```

---

### Task 2: Decouple shared code from the wallet stack

**Files:**
- Create: `services/wallet/errors.ts`
- Create: `utils/oidc-issuer.ts`
- Modify: `services/wallet/orchestrator.ts:20-25` (class moves out, re-exported)
- Modify: `hooks/auth.ts:4`, `components/auth/credential.tsx:10` (import path)
- Modify: `components/analytics/analytics-identity.tsx` (whole file)
- Modify: `services/oidc.ts:1-6`, `components/developers/snippets.ts:5`, `pages/developers.tsx:12`

**Interfaces:**
- Consumes: `useRenownAuth()` from `@powerhousedao/reactor-browser/renown`. It returns `{ status: 'initial' | 'checking' | 'authorized' | 'not-authorized' | 'loading' | undefined, user?: { address: \`0x${string}\`, networkId: string, chainId: number, did: string } }`.
- Produces: `RevokeSignatureRejectedError` from `services/wallet/errors` (also still exported by `services/wallet/orchestrator`); `DEFAULT_OIDC_ISSUER` from `utils/oidc-issuer` (also still exported by `services/oidc`); `AnalyticsIdentity` no longer imports `hooks/use-wallet-adapter`.

- [ ] **Step 1: Write the dependency check that fails today**

Run:

```bash
grep -nE "use-wallet-adapter" components/analytics/analytics-identity.tsx
grep -nE "wallet/orchestrator['\"]" hooks/auth.ts components/auth/credential.tsx
grep -nE "services/oidc['\"]" components/developers/snippets.ts pages/developers.tsx
```

Expected: 5 matching lines in total (the couplings this task removes).

- [ ] **Step 2: Move the error class**

Create `services/wallet/errors.ts`:

```ts
// Wallet errors with no dependencies, so UI code can test for them without
// importing the orchestrator (and with it the wallet stack).

/** Thrown when the wallet did not sign a revocation (the user declined, or signing failed). */
export class RevokeSignatureRejectedError extends Error {
  constructor(cause?: unknown) {
    super('The revocation was not signed, so the credential is still active.', { cause })
    this.name = 'RevokeSignatureRejectedError'
  }
}
```

In `services/wallet/orchestrator.ts` add `import { RevokeSignatureRejectedError } from './errors'` after the `./profile-refresh` import, and replace the class declaration

```ts
/** Thrown when the wallet did not sign a revocation (the user declined, or signing failed). */
export class RevokeSignatureRejectedError extends Error {
  constructor(cause?: unknown) {
    super('The revocation was not signed, so the credential is still active.', { cause })
    this.name = 'RevokeSignatureRejectedError'
  }
}
```

with

```ts
// Re-exported for compatibility; the class lives in a dependency-free module.
export { RevokeSignatureRejectedError }
```

In `hooks/auth.ts` change `from '../services/wallet/orchestrator'` to `from '../services/wallet/errors'`; in `components/auth/credential.tsx` change `from "../../services/wallet/orchestrator"` to `from "../../services/wallet/errors"`.

- [ ] **Step 3: Move the OIDC issuer constant**

Create `utils/oidc-issuer.ts`:

```ts
// The default Renown OIDC issuer, without services/oidc.ts's viem imports, so
// /developers can name it without shipping viem.

/** Default Renown OIDC issuer, served by the Renown switchboard. */
export const DEFAULT_OIDC_ISSUER = 'https://switchboard.renown.vetra.io/api/@powerhousedao/renown-package/oidc'
```

In `services/oidc.ts` replace

```ts
/** Default Renown OIDC issuer, served by the Renown switchboard. */
export const DEFAULT_OIDC_ISSUER =
    "https://switchboard.renown.vetra.io/api/@powerhousedao/renown-package/oidc";
```

with

```ts
import { DEFAULT_OIDC_ISSUER } from "../utils/oidc-issuer";

export { DEFAULT_OIDC_ISSUER };
```

In `components/developers/snippets.ts` change `from '../../services/oidc'` to `from '../../utils/oidc-issuer'`; in `pages/developers.tsx` change `from '../services/oidc'` to `from '../utils/oidc-issuer'`.

- [ ] **Step 4: Identify analytics users from the Renown session**

Replace `components/analytics/analytics-identity.tsx` with:

```tsx
'use client'

import { useRenownAuth } from '@powerhousedao/reactor-browser/renown'
import { useEffect, useRef } from 'react'
import {
  clearProfileHint,
  useOpenPanelAnalytics,
  writeProfileHint,
} from '../../services/analytics'

/**
 * Drives OpenPanel user identity from the Renown session.
 *
 * The Renown session (`<Renown>` in _app) is restored on every page without
 * the wallet stack, so returning users are identified on marketing pages too.
 * Identifies on login (address `undefined → defined`) and clears on logout
 * (`defined → undefined`). A `prevAddressRef` guards against re-firing on
 * unrelated re-renders — identify/clear run only on an actual transition.
 * While the session is still being restored nothing happens, so a returning
 * user is never cleared and re-identified on load.
 *
 * The wallet address is the stable profile ID; chain context travels as
 * properties. No credentials/JWTs are ever forwarded.
 *
 * The transition also writes/clears the `op_profile` cookie that seeds the
 * next load's first pageview (see profile-hint.ts).
 */
export function AnalyticsIdentity() {
  const { status, user } = useRenownAuth()
  const { identify, clear } = useOpenPanelAnalytics()
  const prevAddressRef = useRef<string | null>(null)
  const settled = status === 'authorized' || status === 'not-authorized'
  const address = user?.address ?? null
  const did = user?.did
  const networkId = user?.networkId
  const chainId = user?.chainId

  useEffect(() => {
    if (!settled) return
    if (address === prevAddressRef.current) return
    prevAddressRef.current = address

    if (address) {
      identify({
        profileId: address,
        properties: { address, did, networkId, chainId, caip2: `${networkId}:${chainId}` },
      })
      try {
        writeProfileHint(address)
      } catch (e) {
        console.warn('[analytics] failed to write profile hint', e)
      }
    } else {
      clear()
      try {
        clearProfileHint()
      } catch (e) {
        console.warn('[analytics] failed to clear profile hint', e)
      }
    }
  }, [settled, address, did, networkId, chainId, identify, clear])

  return null
}
```

- [ ] **Step 5: Verify**

Run the three greps from Step 1 again. Expected: no output.
Run: `npx tsc --noEmit -p . && pnpm lint`. Expected: clean.
Run: `npx playwright test e2e/developers.spec.ts e2e/credential-validity-flow.spec.ts e2e/renown-writes.spec.ts e2e/oidc-login.spec.ts --workers=3 --reporter=line`. Expected: PASS (revocation-declined copy still uses `RevokeSignatureRejectedError`; OIDC issuer logic unchanged).

- [ ] **Step 6: Commit**

```bash
git add services/wallet/errors.ts services/wallet/orchestrator.ts hooks/auth.ts components/auth/credential.tsx utils/oidc-issuer.ts services/oidc.ts components/developers/snippets.ts pages/developers.tsx components/analytics/analytics-identity.tsx
git commit -m "refactor(wallet): decouple analytics, revoke errors and the OIDC issuer from the wallet stack"
```

---

### Task 3: Route-scoped lazy wallet shell, with a build check for marketing chunks

**Files:**
- Create: `components/wallet/wallet-shell.tsx`, `components/wallet/lazy-wallet-shell.tsx`, `components/wallet/wallet-load-error.tsx`
- Create: `components/auth/auth-flow-loading.tsx`
- Create: `components/me/me-loading.tsx`, `components/me/me-page-body.tsx`
- Create: `components/profile-edit/glass.ts`, `components/profile-edit/edit-profile-loading.tsx`, `components/profile-edit/edit-profile-body.tsx` (moved from `pages/profile/edit.tsx`)
- Create: `scripts/check-wallet-chunks.mjs`
- Create: `e2e/wallet-split.spec.ts`
- Modify: `pages/_app.tsx`, `pages/index.tsx`, `pages/console.tsx`, `pages/oidc/login.tsx`, `pages/me.tsx`, `pages/profile/edit.tsx`
- Modify: `package.json` (`build`, `check:wallet-chunks`)
- Modify: `e2e/console-page.spec.ts`, `e2e/oidc-login.spec.ts` (first-assertion timeouts)

**Interfaces:**
- Consumes: `AuthRootProvider` from `services/wallet/auth-root-provider` (unchanged); `useMeSession()` (`components/me/use-me-session.ts`), `useProfileEditorAuth()` (`hooks/use-profile-editor-auth.ts`), `MeDashboard`, `WebFlow` (named export), `ConsoleFlow` / `OidcLoginFlow` (default exports) — all unchanged; `signInTestWallet(page, { bearer? })` from `e2e/support/test-session.ts`.
- Produces:
  - `withLazyWalletShell<P extends object>(loadBody: () => Promise<ComponentType<P>>, Fallback: ComponentType<WalletFallbackProps>): ComponentType<P>`
  - `interface WalletFallbackProps { error: Error | null }`
  - `WalletShell({ children })`, `WalletLoadError()`, `AuthFlowLoading(props: WalletFallbackProps)`, `MeLoading(props)`, `MePageBody()`, `EditProfileLoading(props)`, `EditProfileBody()`, `glass: string`
  - `pnpm build` = `next build --webpack && node scripts/check-wallet-chunks.mjs`; `pnpm check:wallet-chunks [nextDir]`

- [ ] **Step 1: Write the failing e2e spec**

Create `e2e/wallet-split.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'
import { signInTestWallet } from './support/test-session'

// The wallet stack (Privy, wagmi, RainbowKit, WalletConnect/Reown) loads only on
// the wallet routes (components/wallet/lazy-wallet-shell.tsx). The production
// build enforces the same for every marketing page (scripts/check-wallet-chunks.mjs).
// The e2e server is `next dev`, whose chunks name every module by its path:
// these are the wallet modules' paths (library docs comments, e.g. viem's
// `['wagmi', 420n]` examples, would make plain library names match).
const WALLET_MARKERS = [
  '/node_modules/.pnpm/@privy-io+',
  '/node_modules/.pnpm/wagmi@',
  '/node_modules/.pnpm/@rainbow-me+rainbowkit@',
  '/node_modules/.pnpm/@walletconnect+',
  '/node_modules/.pnpm/@reown+',
  '/services/wallet/',
  '/auth-providers/',
]

/** Every script the page downloaded while loading, by URL → body. */
async function collectScripts(page: Page): Promise<Map<string, Promise<string>>> {
  const scripts = new Map<string, Promise<string>>()
  page.on('response', (response) => {
    if (response.request().resourceType() === 'script') scripts.set(response.url(), response.text().catch(() => ''))
  })
  return scripts
}

async function walletScripts(scripts: Map<string, Promise<string>>): Promise<string[]> {
  const found: string[] = []
  for (const [url, body] of scripts) {
    const text = await body
    const markers = WALLET_MARKERS.filter((marker) => text.includes(marker))
    if (markers.length) found.push(`${url}: ${markers.join(', ')}`)
  }
  return found
}

test.beforeEach(async ({ page }) => {
  test.setTimeout(90_000)
  // Nothing leaves localhost (ENS, wallet relays, analytics).
  await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort())
})

for (const path of ['/', '/apps', '/developers']) {
  test(`${path} downloads no wallet code`, async ({ page }) => {
    const scripts = await collectScripts(page)
    await page.goto(path)
    await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState('networkidle')
    expect(scripts.size).toBeGreaterThan(0)
    expect(await walletScripts(scripts)).toEqual([])
  })
}

test('header Sign in leads to the sign-in flow, which loads the wallet stack there', async ({ page }) => {
  await page.goto('/apps')
  const scripts = await collectScripts(page)
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click({ timeout: 30_000 })
  await expect(page).toHaveURL(/[?&]app=.*[&]connect=|[?&]connect=.*[&]app=/)
  await expect(page.getByRole('heading', { name: 'Connect Wallet' })).toBeVisible({ timeout: 30_000 })
  expect((await walletScripts(scripts)).length).toBeGreaterThan(0)
})

test('/?app= renders the sign-in flow', async ({ page }) => {
  await page.goto('/?app=did:web:split.example')
  await expect(page.getByRole('heading', { name: 'Connect Wallet' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
})

test('moving between wallet routes in the app keeps the wallet session', async ({ page }) => {
  await signInTestWallet(page, { bearer: 'e2e-split-bearer' })
  await page.goto('/me')
  await expect(page.getByRole('heading', { level: 2, name: 'Connected apps' })).toBeVisible({ timeout: 30_000 })
  // A client-side navigation unmounts /me's wallet shell and mounts /profile/edit's.
  await page.evaluate(() => (window as unknown as { next: { router: { push: (url: string) => Promise<boolean> } } }).next.router.push('/profile/edit'))
  await expect(page).toHaveURL(/\/profile\/edit$/)
  await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('main').getByRole('button', { name: 'Sign in' })).toHaveCount(0)
})

test('when the wallet code cannot be downloaded, the sign-in page says so and offers a reload', async ({ page }) => {
  // e.g. a deploy replaced the chunks, or the connection dropped. next dev names
  // the chunk after its module (components/wallet/wallet-shell.tsx).
  await page.route(/wallet-shell/, (route) => route.abort())
  await page.goto('/?app=did:web:split.example')
  await expect(page.getByRole('alert').filter({ hasText: 'Sign-in could not load' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible()
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx playwright test e2e/wallet-split.spec.ts --workers=3 --reporter=line`
Expected: the three "downloads no wallet code" tests FAIL (`pages/_app.js` contains `/services/wallet/`, `/node_modules/.pnpm/wagmi@`, …), and the "cannot be downloaded" test FAILS (no such alert). The other three pass already.

- [ ] **Step 3: Create the shell, the factory and the error state**

`components/wallet/wallet-shell.tsx`:

```tsx
// The wallet stack (wagmi + RainbowKit + Privy + the auth orchestrator) for the
// routes that sign with a wallet. Only components/wallet/lazy-wallet-shell.tsx
// imports this module, so marketing pages never download it.
import '@rainbow-me/rainbowkit/styles.css'
import type { ReactNode } from 'react'
import { AuthRootProvider } from '../../services/wallet/auth-root-provider'

export function WalletShell({ children }: { children: ReactNode }) {
  return <AuthRootProvider>{children}</AuthRootProvider>
}
```

`components/wallet/lazy-wallet-shell.tsx`:

```tsx
import dynamic from 'next/dynamic'
import type { ComponentType } from 'react'

/** What a wallet route shows while the wallet stack loads, or when it failed to load. */
export interface WalletFallbackProps {
  /** Set when the wallet code could not be downloaded (e.g. offline, or a deploy replaced the chunks). */
  error: Error | null
}

/**
 * `Body` rendered inside the wallet providers, in the browser only. The wallet
 * stack and `Body` download in parallel (one round trip, no waterfall), so the
 * page that uses this carries no wallet code in its own chunk. `Fallback`
 * renders on the server, during hydration and until both have loaded.
 *
 * Call it at module scope of a page, with an inline `import()`:
 *   const MeBody = withLazyWalletShell(() => import('../components/me/me-page-body').then((m) => m.MePageBody), MeFallback)
 */
export function withLazyWalletShell<P extends object>(
  loadBody: () => Promise<ComponentType<P>>,
  Fallback: ComponentType<WalletFallbackProps>,
): ComponentType<P> {
  return dynamic<P>(
    () =>
      Promise.all([import('./wallet-shell'), loadBody()]).then(([{ WalletShell }, Body]) => {
        function WalletBody(props: P) {
          return (
            <WalletShell>
              <Body {...props} />
            </WalletShell>
          )
        }
        return WalletBody
      }),
    { ssr: false, loading: ({ error }) => <Fallback error={error ?? null} /> },
  )
}
```

`components/wallet/wallet-load-error.tsx`:

```tsx
/** Shown by a wallet route when its wallet code failed to download. */
export function WalletLoadError() {
  return (
    <div role="alert" className="mx-auto max-w-md py-16 text-center">
      <p className="text-ink text-lg font-semibold">Sign-in could not load</p>
      <p className="text-ink-muted mt-2 text-sm">Check your connection and reload the page.</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="bg-primary text-primary-foreground hover:bg-primary/80 mt-6 rounded-lg px-5 py-2 text-sm font-semibold transition-colors"
      >
        Reload
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Per-route fallbacks**

`components/auth/auth-flow-loading.tsx` (mirrors WebFlow's own loading view, so the card does not jump):

```tsx
import type { WalletFallbackProps } from '../wallet/lazy-wallet-shell'
import { WalletLoadError } from '../wallet/wallet-load-error'
import RenownCard from '../ui/renown-card'
import { LoadingBody } from './loading-body'

/**
 * The sign-in card in its loading state, as WebFlow / ConsoleFlow / OidcLoginFlow
 * draw it while the session is restored: shown while their wallet code loads,
 * so the card does not jump when the flow takes over.
 */
export function AuthFlowLoading({ error }: WalletFallbackProps) {
  if (error) return <WalletLoadError />
  return (
    <div className="flex flex-col items-center">
      <RenownCard className="max-w-[482px] rounded-3xl shadow-modal">
        <div className="flex flex-col items-center bg-background px-8 pb-8 pt-10">
          <h2 className="mb-3 text-3xl font-semibold">Signing you in</h2>
          <p className="mb-10 text-center text-lg leading-6 text-muted-foreground-light">
            Hang tight while we finish setting up your session.
          </p>
          <LoadingBody />
        </div>
      </RenownCard>
    </div>
  )
}
```

`components/me/me-loading.tsx`:

```tsx
import type { WalletFallbackProps } from '../wallet/lazy-wallet-shell'
import { WalletLoadError } from '../wallet/wallet-load-error'

/** /me while the session (or the wallet code) loads. */
export function MeLoading({ error }: WalletFallbackProps) {
  if (error) return <WalletLoadError />
  return (
    <p role="status" className="text-ink-muted py-24 text-center">
      Loading your Renown…
    </p>
  )
}
```

`components/profile-edit/edit-profile-loading.tsx`:

```tsx
import type { WalletFallbackProps } from '../wallet/lazy-wallet-shell'
import { WalletLoadError } from '../wallet/wallet-load-error'

/** /profile/edit while the session (or the wallet code) loads. */
export function EditProfileLoading({ error }: WalletFallbackProps) {
  if (error) return <WalletLoadError />
  return <p className="text-muted-foreground py-24 text-center">Loading…</p>
}
```

`components/profile-edit/glass.ts`:

```ts
/** The frosted card the profile editor draws its panels on. */
export const glass =
  'rounded-2xl border border-gray-200 bg-white/80 shadow-2xl backdrop-blur-lg dark:border-white/20 dark:bg-white/10'
```

- [ ] **Step 5: Move /me's session-dependent content into a body**

`components/me/me-page-body.tsx`:

```tsx
// /me's content. It reads the wallet session (signature fallback for revoke,
// the e2e stand-in session), so pages/me.tsx loads it inside the wallet shell.
import { buttonClasses } from '../site/primitives'
import { MeDashboard } from './me-dashboard'
import { MeLoading } from './me-loading'
import { useMeSession } from './use-me-session'

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

export function MePageBody() {
  const session = useMeSession()
  if (session.state === 'loading') return <MeLoading error={null} />
  if (session.state === 'signed-out') return <SignInPanel login={session.login} />
  return <MeDashboard key={session.address} session={session} />
}
```

Replace `pages/me.tsx`:

```tsx
import type { NextPage } from 'next'
import { MeLoading } from '../components/me/me-loading'
import { PageMeta } from '../components/site/page-meta'
import { Container } from '../components/site/primitives'
import { SiteLayout } from '../components/site/site-layout'
import { withLazyWalletShell } from '../components/wallet/lazy-wallet-shell'

// The dashboard with the wallet stack, loaded in the browser only.
const MeBody = withLazyWalletShell(
  () => import('../components/me/me-page-body').then((m) => m.MePageBody),
  MeLoading,
)

const MePage: NextPage = () => (
  <SiteLayout>
    <PageMeta
      title="Your Renown"
      description="Your Renown identity, profile and the apps you have approved."
      path="/me"
      noindex
    />
    <Container className="min-h-[60vh] pt-12 pb-24 md:pt-16 md:pb-32">
      <MeBody />
    </Container>
  </SiteLayout>
)

export default MePage
```

- [ ] **Step 6: Move the profile editor into a body (mechanical move)**

Run this from the repo root. It moves `type Toast`, `normalizedForm` and `Editor` from `pages/profile/edit.tsx` into `components/profile-edit/edit-profile-body.tsx` without changing them (except that `glass` is now imported), adds `EditProfileBody`, and rewrites the page:

```bash
python3 - <<'EOF'
p = 'pages/profile/edit.tsx'
s = open(p).read()
body = s[s.index("type Toast ="):s.index("const EditProfilePage: NextPage")]
glass_def = """const glass =
  'rounded-2xl border border-gray-200 bg-white/80 shadow-2xl backdrop-blur-lg dark:border-white/20 dark:bg-white/10'

"""
assert glass_def in body
body = body.replace(glass_def, '')
imports = """// /profile/edit's editor. It signs with the wallet session and reads ENS
// through wagmi, so pages/profile/edit.tsx loads it inside the wallet shell.
import Link from 'next/link'
import { useRouter } from 'next/router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Hex } from 'viem'
import { useEnsAvatar, useEnsName } from 'wagmi'
import { AvatarUploader } from './avatar-uploader'
import { EditProfileLoading } from './edit-profile-loading'
import { Field, inputClass } from './field'
import { glass } from './glass'
import { HandleField } from './handle-field'
import { LinksEditor } from './links-editor'
import { ProfileSummary } from '../profile/profile-summary'
import RenownCard from '../ui/renown-card'
import { useProfileEditorAuth } from '../../hooks/use-profile-editor-auth'
import { profileMessage } from '../../services/renown-signed-messages'
import { fetchProfile, type RenownProfile } from '../../services/switchboard'
import {
  changedFields,
  formFromProfile,
  formProblems,
  handleFromEns,
  hasChanges,
  LIMITS,
  normalizeHandle,
  type FormField,
  type FormProblems,
  type ProfileForm,
} from '../../utils/profile-form'
import { profilePath } from '../../utils/profile-url'

"""
tail = """/** Sign-in prompt, or the editor once the wallet and Renown sessions agree. */
export function EditProfileBody() {
  const auth = useProfileEditorAuth()
  if (auth.status === 'loading') return <EditProfileLoading error={null} />
  if (auth.status === 'signed-out') {
    return (
      <div className={`${glass} mx-auto max-w-md space-y-4 p-8 text-center`}>
        <h1 className="text-foreground text-2xl font-bold">Edit your profile</h1>
        <p className="text-muted-foreground text-sm">Sign in with your wallet to edit your Renown profile.</p>
        <button
          type="button"
          onClick={auth.login}
          className="bg-primary text-primary-foreground hover:bg-primary/80 rounded-lg px-5 py-2 text-sm font-semibold transition-colors"
        >
          Sign in
        </button>
      </div>
    )
  }
  return <Editor address={auth.address} profileId={auth.profileId} signMessage={auth.signMessage} getBearer={auth.getBearer} />
}
"""
open('components/profile-edit/edit-profile-body.tsx', 'w').write(imports + body + tail)
open(p, 'w').write("""import type { NextPage } from 'next'
import Head from 'next/head'
import { EditProfileLoading } from '../../components/profile-edit/edit-profile-loading'
import { SiteLayout } from '../../components/site/site-layout'
import { withLazyWalletShell } from '../../components/wallet/lazy-wallet-shell'

// The editor with the wallet stack, loaded in the browser only.
const EditProfileBody = withLazyWalletShell(
  () => import('../../components/profile-edit/edit-profile-body').then((m) => m.EditProfileBody),
  EditProfileLoading,
)

const EditProfilePage: NextPage = () => (
  <SiteLayout>
    <Head>
      <title>Edit profile - Renown</title>
      <meta name="robots" content="noindex" />
    </Head>
    <div className="relative mx-auto w-full max-w-5xl px-4 pt-12 pb-20 md:pt-16">
      <EditProfileBody />
    </div>
  </SiteLayout>
)

export default EditProfilePage
""")
EOF
```

Expected: `grep -n "^function Editor\|^type Toast\|^function normalizedForm\|^export function EditProfileBody" components/profile-edit/edit-profile-body.tsx` prints four lines.

- [ ] **Step 7: Load the auth flows lazily**

`pages/index.tsx`: replace `import { WebFlow } from '../components/auth/web-flow'` with `import { AuthFlowLoading } from '../components/auth/auth-flow-loading'`, add `import { withLazyWalletShell } from '../components/wallet/lazy-wallet-shell'` after the `site-layout` import, add after the `HomeProps` type:

```tsx
// The sign-in flow and the wallet stack load only on `/?app=` / `/?connect=`:
// the marketing homepage ships no wallet code.
const LazyWebFlow = withLazyWalletShell(
  () => import('../components/auth/web-flow').then((m) => m.WebFlow),
  AuthFlowLoading,
)
```

and in `AuthHome` render `<LazyWebFlow appId={appId} deeplink={deeplink} returnUrl={returnUrl} expiresInDays={expiresInDays} />` where it rendered `<WebFlow … />` (same props, same `appId && isClient` guard).

`pages/console.tsx`: replace `import ConsoleFlow from "../components/auth/console-flow";` with `import { AuthFlowLoading } from "../components/auth/auth-flow-loading";`, add `import { withLazyWalletShell } from "../components/wallet/lazy-wallet-shell";` after the `site-layout` import, and add before `const ConsolePage`:

```tsx
// The CLI sign-in flow with the wallet stack, loaded in the browser only.
const ConsoleFlow = withLazyWalletShell(
    () => import("../components/auth/console-flow").then((m) => m.default),
    AuthFlowLoading,
);
```

(the JSX `<ConsoleFlow sessionId=… connectDid=… expiresInDays=… />` stays as is).

`pages/oidc/login.tsx`: replace `import OidcLoginFlow from "../../components/auth/oidc-login-flow";` with `import { AuthFlowLoading } from "../../components/auth/auth-flow-loading";`, add `import { withLazyWalletShell } from "../../components/wallet/lazy-wallet-shell";` after the `site-layout` import, and add before `const OidcLoginPage`:

```tsx
// The OIDC sign-in flow with the wallet stack, loaded in the browser only.
const OidcLoginFlow = withLazyWalletShell(
    () => import("../../components/auth/oidc-login-flow").then((m) => m.default),
    AuthFlowLoading,
);
```

- [ ] **Step 8: Take the wallet stack out of `_app`**

Replace `pages/_app.tsx`:

```tsx
import '../styles/globals.css'
import type { AppProps } from 'next/app'
import { Inter } from 'next/font/google'
import { ThemeProvider } from 'next-themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Renown } from '@powerhousedao/reactor-browser/renown'
import { Analytics } from '../components/analytics/analytics'

const inter = Inter({ subsets: ['latin'] })

const queryClient = new QueryClient()

// The wallet stack (wagmi, Privy, RainbowKit) is not mounted here: only the
// routes that sign with a wallet load it (components/wallet/lazy-wallet-shell.tsx).
// <Renown> alone restores the Renown session on every page.
function MyApp({ Component, pageProps }: AppProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem>
      <div className={inter.className}>
        <QueryClientProvider client={queryClient}>
          <Renown
            appName="renown-app"
            url={process.env.NEXT_PUBLIC_RENOWN_URL || 'https://www.renown.id'}
            onError={(error) => {
              // useRenownInit rejects synchronously during SSR — suppress that noise.
              if (error instanceof Error && error.message === 'window is undefined') return
              console.error(error)
            }}
          />
          <Analytics />
          <Component {...pageProps} />
        </QueryClientProvider>
      </div>
    </ThemeProvider>
  )
}

export default MyApp
```

- [ ] **Step 9: Give the lazily loaded flows time to compile in dev**

`next dev` compiles the flow chunk on first request. In `e2e/oidc-login.spec.ts` change the three post-`goto` assertions at lines 35, 45 and 58 from `.toBeVisible()` to `.toBeVisible({ timeout: 30_000 })`. In `e2e/console-page.spec.ts` do the same at lines 17, 41, 56, 60, 64, 74 and 91 (each is the first assertion on flow content after a `goto`).

- [ ] **Step 10: Run the e2e spec and the wallet-route specs**

Run: `npx playwright test e2e/wallet-split.spec.ts e2e/me.spec.ts e2e/oidc-login.spec.ts e2e/console-page.spec.ts e2e/credential-validity-flow.spec.ts e2e/renown-writes.spec.ts e2e/site-shell.spec.ts e2e/connect-link.spec.ts --workers=3 --reporter=line`
Expected: PASS (wallet-split 7/7).

- [ ] **Step 11: Write the build check**

Create `scripts/check-wallet-chunks.mjs`:

```js
#!/usr/bin/env node
// Fails the build when a marketing page's client chunks contain wallet code.
//
// Marketing pages must not download the wallet stack (Privy, wagmi, RainbowKit,
// WalletConnect/Reown): only the wallet routes load it, through
// components/wallet/lazy-wallet-shell.tsx. This reads .next/build-manifest.json
// (the JS/CSS each page loads up front) after `next build` and searches those
// files for strings only the wallet libraries contain. It also checks the
// markers still occur in the build's other chunks, so a library upgrade that
// renames them cannot turn this check into a silent pass.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const NEXT_DIR = process.argv[2] ?? '.next'

const MARKETING_PAGES = ['/', '/apps', '/developers', '/trust', '/ecosystem', '/app/[did]', '/profile/[id]', '/404', '/500']

/** Library → strings found in its bundled code and in no Renown code. */
const WALLET_MARKERS = {
  privy: ['auth.privy.io', '@privy-io'],
  walletconnect: ['walletconnect'],
  rainbowkit: ['rainbowkit', '[data-rk]'],
  wagmi: ['wagmi'],
  reown: ['@reown'],
}

function read(file) {
  return readFileSync(join(NEXT_DIR, file), 'utf8')
}

/** The libraries whose markers occur in `text`. */
function walletLibrariesIn(text) {
  return Object.entries(WALLET_MARKERS)
    .filter(([, markers]) => markers.some((marker) => text.includes(marker)))
    .map(([library]) => library)
}

function main() {
  const manifest = JSON.parse(read('build-manifest.json'))
  const problems = []
  for (const page of MARKETING_PAGES) {
    const files = manifest.pages[page]
    if (!files) {
      problems.push(`${page}: not in build-manifest.json (renamed? update MARKETING_PAGES)`)
      continue
    }
    for (const file of new Set([...manifest.pages['/_app'], ...files])) {
      if (!file.endsWith('.js') && !file.endsWith('.css')) continue
      const found = walletLibrariesIn(read(file))
      if (found.length) problems.push(`${page}: ${file} contains ${found.join(', ')}`)
    }
  }
  // Positive control: every marker set must still match some chunk of this build.
  const chunksDir = join(NEXT_DIR, 'static', 'chunks')
  const all = readdirSync(chunksDir, { recursive: true })
    .filter((file) => String(file).endsWith('.js'))
    .map((file) => readFileSync(join(chunksDir, String(file)), 'utf8'))
    .join('\n')
  const present = walletLibrariesIn(all)
  for (const library of Object.keys(WALLET_MARKERS)) {
    if (!present.includes(library)) {
      problems.push(`no chunk contains a ${library} marker: update WALLET_MARKERS.${library}`)
    }
  }
  if (problems.length) {
    console.error('Wallet code check failed:\n  ' + problems.join('\n  '))
    process.exit(1)
  }
  console.log(`Wallet code check passed: ${MARKETING_PAGES.length} marketing pages load no wallet code.`)
}

main()
```

In `package.json` scripts set `"build": "next build --webpack && node scripts/check-wallet-chunks.mjs"` and add `"check:wallet-chunks": "node scripts/check-wallet-chunks.mjs"`.

- [ ] **Step 12: Build, and prove the check can fail**

Run: `pnpm build 2>&1 | tail -3`
Expected: ends with `Wallet code check passed: 9 marketing pages load no wallet code.`

Then prove the negative with a doctored manifest:

```bash
T=$(mktemp -d); mkdir -p $T/static && cp -r .next/static/chunks .next/static/css $T/static/
node -e "
const fs=require('fs');const m=JSON.parse(fs.readFileSync('.next/build-manifest.json'));
const big=fs.readdirSync('.next/static/chunks').find(f=>f.endsWith('.js')&&fs.readFileSync('.next/static/chunks/'+f,'utf8').includes('auth.privy.io'));
m.pages['/apps'].push('static/chunks/'+big);fs.writeFileSync('$T/build-manifest.json',JSON.stringify(m))"
node scripts/check-wallet-chunks.mjs $T; echo exit=$?; rm -rf $T
```

Expected: `Wallet code check failed: /apps: static/chunks/<id>.js contains privy, walletconnect, wagmi, reown` and `exit=1`. (On origin/main the real `_app` chunk matched all five libraries.)

- [ ] **Step 13: Lint, type-check, commit**

```bash
npx tsc --noEmit -p . && pnpm lint
git add components/wallet components/auth/auth-flow-loading.tsx components/me/me-loading.tsx components/me/me-page-body.tsx components/profile-edit/glass.ts components/profile-edit/edit-profile-loading.tsx components/profile-edit/edit-profile-body.tsx pages/_app.tsx pages/index.tsx pages/console.tsx pages/oidc/login.tsx pages/me.tsx pages/profile/edit.tsx scripts/check-wallet-chunks.mjs package.json e2e/wallet-split.spec.ts e2e/console-page.spec.ts e2e/oidc-login.spec.ts
git commit -m "perf(site): load the wallet stack only on wallet routes and fail the build if marketing pages ship it"
```

---

### Task 4: `/api/og` on Node with sharp: draw WebP, AVIF and SVG

**Files:**
- Create: `lib/og/og-image.ts`
- Modify: `lib/og/og-data.ts`, `lib/og/og-font.ts` (whole file), `pages/api/og.tsx` (header, fonts, handler)
- Modify: `next.config.ts` (`outputFileTracingIncludes`)
- Modify: `package.json` / `pnpm-lock.yaml` (`sharp` 0.34.5)
- Modify: `e2e/support/stub-switchboard.mjs` (image fixtures), `e2e/og.spec.ts`

**Interfaces:**
- Consumes: `loadProfileCard(address, origin)`, `loadAppCard(did, origin)`, `OgCard` (unchanged shapes); `fixtureStub()` from `e2e/support/stub-switchboard-client.ts`.
- Produces:
  - `toPngDataUrl(bytes: Uint8Array, box: ImageBox): Promise<string>`, `MAX_INPUT_PIXELS = 40_000_000`, `AVATAR_BOX`, `LOGO_BOX` (`{ width: 256, height: 256 }`), `interface ImageBox { width: number; height: number }`
  - `fetchImageDataUrl(url: string, origin: string, box: ImageBox): Promise<string | null>`
  - `readFont(name: string, dir = FONT_DIR): Promise<ArrayBuffer>`, `FONT_DIR`
  - Response header `X-Og-Image: 'drawn' | 'monogram' | 'none'` (Task 5 tests rely on `X-Og-Variant` + the PNG body only)

- [ ] **Step 1: Add sharp as a server dependency**

Run: `pnpm add -w sharp@0.34.5`
Expected: `package.json` gains `"sharp": "0.34.5"`; `pnpm-lock.yaml` adds the importer entry and drops `optional: true` from `sharp@0.34.5` / `@img/colour`. (`onlyBuiltDependencies` in `pnpm-workspace.yaml` already lists `sharp`.)

- [ ] **Step 2: Add the image fixtures to the stub switchboard**

In `e2e/support/stub-switchboard.mjs` add `import { crc32, deflateSync } from 'node:zlib'` after `import http from 'node:http'`, and after the `const port = …` line add:

```js
/** A PNG whose header claims `size` × `size` 1-bit pixels, all zero: a few KB that decode to `size`² pixels. */
function pixelBombPng(size) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body))
    return Buffer.concat([length, body, crc])
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 1 // bit depth
  header[9] = 0 // greyscale
  const rows = Buffer.alloc(size * (1 + Math.ceil(size / 8)))
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// Images the OG route converts with sharp (e2e/og.spec.ts): valid WebP/AVIF/SVG,
// a WebP with corrupt bytes, and a 64-megapixel PNG (over the 40 MP limit).
const OG_IMAGES = {
  webp: { type: 'image/webp', bytes: () => Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvB8ABAAfQ/4aUtv+BiOh/AAA=', 'base64') },
  avif: {
    type: 'image/avif',
    bytes: () =>
      Buffer.from(
        'AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAAA5waXRtAAAAAAABAAAAImlsb2MAAAAAREAAAQABAAAAAAD6AAEAAAAAAAAAHQAAACNpaW5mAAAAAAABAAAAFWluZmUCAAAAAAEAAGF2MDEAAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAgAAAAIAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAlbWRhdBIACgg4CL9hAQ0GkDIPGAAAAEAAsAxmyziV6Ug4',
        'base64',
      ),
  },
  svg: {
    type: 'image/svg+xml',
    bytes: () => Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#0080ff"/></svg>'),
  },
  badwebp: { type: 'image/webp', bytes: () => Buffer.concat([Buffer.from('RIFF\x10\x00\x00\x00WEBPVP8 ', 'latin1'), Buffer.alloc(64, 0x5a)]) },
  bomb: { type: 'image/png', bytes: () => pixelBombPng(8000) },
}
```

(The WebP is an 8×8 lossless #21FFB4 square; the AVIF an 8×8 #0080FF square, both made with sharp.)

Replace the one-line `const hostile = { … }` map with:

```js
    const hostile = {
      'stub-text-doc': `http://localhost:${port}/__stub/og/text`,
      'stub-huge-doc': `http://localhost:${port}/__stub/og/huge`,
      'stub-evil-doc': 'https://evil.example/avatar.png',
      'stub-loop-doc': `http://localhost:${port}/__stub/og/loop1`,
      'stub-webp-doc': `http://localhost:${port}/__stub/og/webp`,
      'stub-avif-doc': `http://localhost:${port}/__stub/og/avif`,
      'stub-svg-doc': `http://localhost:${port}/__stub/og/svg`,
      'stub-badwebp-doc': `http://localhost:${port}/__stub/og/badwebp`,
      'stub-bomb-doc': `http://localhost:${port}/__stub/og/bomb`,
    }
```

Change the route regex to `/^\/__stub\/og\/(text|huge|webp|avif|svg|badwebp|bomb|loop1|loop2|loop3)$/`, and replace the old `if (og[1] === 'webp') { … }` branch with:

```js
    const image = OG_IMAGES[og[1]]
    if (image) {
      res.writeHead(200, { 'Content-Type': image.type })
      return res.end(image.bytes())
    }
```

Also extend the header comment's route list with `GET /__stub/og/<webp|avif|svg|badwebp|bomb>   OG image fixtures`.

- [ ] **Step 3: Write the failing OG tests**

In `e2e/og.spec.ts`:

1. Change `import { fetchFont } from '../lib/og/og-font'` to `import { readFont } from '../lib/og/og-font'`.
2. After `const WEBP = …` add:

```ts
const AVIF = '0x5e00000000000000000000000000000000000c09'
const SVG = '0x5e00000000000000000000000000000000000c0a'
const BAD_WEBP = '0x5e00000000000000000000000000000000000c0b'
const BOMB = '0x5e00000000000000000000000000000000000c0c'
```

3. Replace the `WEBP` fixture line in `beforeAll` with:

```ts
  for (const [address, doc] of [[WEBP, 'stub-webp-doc'], [AVIF, 'stub-avif-doc'], [SVG, 'stub-svg-doc'], [BAD_WEBP, 'stub-badwebp-doc'], [BOMB, 'stub-bomb-doc']]) {
    await fixtureStub({ match: 'OgProfile', variables: address, response: { data: { renownUsers: [profile(doc, `attachment://v1:${'c'.repeat(64)}`)] } } })
  }
```

and change the WebP app fixture's `tagline: 'Draws a monogram'` to `tagline: 'Draws its WebP logo'`.
4. Replace the `variantOf` helper with:

```ts
  const cardOf = async (request: import('@playwright/test').APIRequestContext, query: string) => {
    const response = await request.get(`/api/og${query}`)
    expect(response.status(), query).toBe(200)
    expect(response.headers()['content-type'], query).toBe('image/png')
    return { variant: response.headers()['x-og-variant'], image: response.headers()['x-og-image'] }
  }
  const variantOf = async (request: import('@playwright/test').APIRequestContext, query: string) => (await cardOf(request, query)).variant
```

5. Replace the test "draw the intended card with a monogram when the image is WebP (Satori cannot draw it)" with:

```ts
  test('draw the stored image: PNG as is, WebP, AVIF and SVG converted to PNG', async ({ request }) => {
    expect(await cardOf(request, `?variant=app&did=${APP_DID}`)).toEqual({ variant: 'app', image: 'drawn' })
    expect(await cardOf(request, `?variant=profile&address=${WEBP}`)).toEqual({ variant: 'profile', image: 'drawn' })
    expect(await cardOf(request, `?variant=app&did=${WEBP_APP_DID}`)).toEqual({ variant: 'app', image: 'drawn' })
    expect(await cardOf(request, `?variant=profile&address=${AVIF}`)).toEqual({ variant: 'profile', image: 'drawn' })
    expect(await cardOf(request, `?variant=profile&address=${SVG}`)).toEqual({ variant: 'profile', image: 'drawn' })
  })

  test('draw the monogram when the image cannot be decoded or is a decompression bomb', async ({ request }) => {
    expect(await cardOf(request, `?variant=profile&address=${BAD_WEBP}`)).toEqual({ variant: 'profile', image: 'monogram' })
    expect(await cardOf(request, `?variant=profile&address=${BOMB}`)).toEqual({ variant: 'profile', image: 'monogram' })
  })

  test('without a stored image the card draws its monogram; the default card has no image', async ({ request }) => {
    expect(await cardOf(request, `?variant=profile&address=${ADDRESS}`)).toEqual({ variant: 'profile', image: 'monogram' })
    expect(await cardOf(request, '')).toEqual({ variant: 'default', image: 'none' })
  })
```

6. In "cache real cards, monograms and unknown ids at the edge" add after the `WEBP_APP_DID` line:

```ts
    expect(await cacheOf(request, `?variant=profile&address=${BAD_WEBP}`)).toBe(LONG)
    expect(await cacheOf(request, `?variant=profile&address=${BOMB}`)).toBe(LONG)
```

7. Replace the final font test with:

```ts
test('fonts are read from assets/fonts; a missing font is a failure, so the card falls back to the default font', async () => {
  expect((await readFont('Inter-SemiBold.ttf')).byteLength).toBeGreaterThan(100_000)
  await expect(readFont('Inter-SemiBold.ttf', '/nonexistent-font-dir')).rejects.toThrow()
})
```

Run: `npx playwright test e2e/og.spec.ts --workers=3 --reporter=line`
Expected: FAIL. `tsc`/Playwright first reports that `readFont` is not exported. Once that compiles, the `drawn`/`monogram` expectations fail because there is no `x-og-image` header yet.

- [ ] **Step 4: The converter**

Create `lib/og/og-image.ts`:

```ts
// Converts a fetched image into a PNG the link-preview card can draw (Satori
// draws PNG/JPEG/GIF only). Node runtime only: sharp is a native module.
import sharp from 'sharp'

/** Larger inputs are refused before decoding (decompression bombs). 40 MP ≈ 6300 × 6300. */
export const MAX_INPUT_PIXELS = 40_000_000

export interface ImageBox {
  width: number
  height: number
}

/** The card draws avatars at 220 px and logos at 200 px: 256 px is enough for both. */
export const AVATAR_BOX: ImageBox = { width: 256, height: 256 }
export const LOGO_BOX: ImageBox = { width: 256, height: 256 }

/**
 * `bytes` (PNG, JPEG, GIF, WebP, AVIF or SVG) as a PNG data URL, cropped to
 * fill `box` like the card's `objectFit: cover` and never enlarged. Only the
 * first frame of an animation is used; EXIF orientation is applied. Throws on
 * bytes sharp cannot decode and on images over MAX_INPUT_PIXELS.
 */
export async function toPngDataUrl(bytes: Uint8Array, box: ImageBox): Promise<string> {
  const png = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' })
    .rotate()
    .resize({ width: box.width, height: box.height, fit: 'cover', withoutEnlargement: true })
    .png()
    .toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}
```

(sharp's default `unlimited: false` keeps librsvg's SVG safety limits; an SVG loaded from a buffer has no base URL, so external references are not fetched.)

- [ ] **Step 5: Convert in the image fetch**

In `lib/og/og-data.ts`:

Replace the file header comment with:

```ts
// Data for the link-preview route (pages/api/og.tsx, Node runtime). A failed
// lookup or fetch throws, and the route answers with the default card; an image
// that cannot be decoded draws the card with its monogram instead.
```

Add `import { AVATAR_BOX, LOGO_BOX, toPngDataUrl, type ImageBox } from './og-image'` after the `switchboard-endpoint` import.

Replace

```ts
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif'])
// Valid images Satori cannot draw: not a failure, the card draws its monogram instead.
const UNDRAWABLE_IMAGE_TYPES = new Set(['image/webp', 'image/avif', 'image/svg+xml'])
```

with

```ts
// Every image is converted to PNG before drawing (lib/og/og-image.ts).
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif', 'image/svg+xml'])
```

Delete the `toBase64` function. Replace the `fetchImageDataUrl` doc comment and signature with:

```ts
/**
 * Fetches a media image (PNG/JPEG/GIF/WebP/AVIF/SVG, at most 4 MB) as a PNG
 * data URL that fits `box`; null when the bytes cannot be decoded or the image
 * is too large to decode (the card draws its monogram); throws on anything else.
 * Redirects are followed by hand: at most two hops, each only to an allowed
 * host (see isAllowedTarget). `origin` is the site's public origin.
 */
export async function fetchImageDataUrl(url: string, origin: string, box: ImageBox): Promise<string | null> {
```

and replace its tail

```ts
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (response.ok && UNDRAWABLE_IMAGE_TYPES.has(type)) {
      await response.body?.cancel()
      return null
    }
    if (!response.ok || !IMAGE_TYPES.has(type)) throw new Error(`Unusable image (${response.status} ${type})`)
    return `data:${type};base64,${toBase64(await readCapped(response))}`
```

with

```ts
    const type = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (!response.ok || !IMAGE_TYPES.has(type)) throw new Error(`Unusable image (${response.status} ${type})`)
    const bytes = await readCapped(response)
    try {
      return await toPngDataUrl(bytes, box)
    } catch (error) {
      // Corrupt bytes or a decompression bomb: a valid answer, not an outage.
      console.warn('og: image could not be converted, drawing the monogram:', error instanceof Error ? error.message : error)
      return null
    }
```

In `loadProfileCard` pass `AVATAR_BOX` (`fetchImageDataUrl(imageUrl, origin, AVATAR_BOX)`); in `loadAppCard` pass `LOGO_BOX`.

- [ ] **Step 6: Fonts from disk, traced into the standalone output**

Replace `lib/og/og-font.ts`:

```ts
// Font bytes for the link-preview route (pages/api/og.tsx, Node runtime). The
// fonts ship with the server: next.config.ts traces assets/fonts into the
// standalone output for /api/og.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const FONT_DIR = join(process.cwd(), 'assets', 'fonts')

/** The font file `name` from `dir`; rejects when it cannot be read. */
export async function readFont(name: string, dir = FONT_DIR): Promise<ArrayBuffer> {
  const bytes = await readFile(join(dir, name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}
```

In `next.config.ts` add after `output: "standalone",`:

```ts
    // /api/og reads its fonts from disk (lib/og/og-font.ts): ship them with the server.
    outputFileTracingIncludes: {
        "/api/og": ["./assets/fonts/Inter-Regular.ttf", "./assets/fonts/Inter-SemiBold.ttf"],
    },
```

- [ ] **Step 7: The route on Node**

In `pages/api/og.tsx` replace the imports and the edge config:

```tsx
import type { NextApiRequest, NextApiResponse } from 'next'
import { ImageResponse } from 'next/og'
import { publicOrigin } from '../../utils/seo'
import { loadAppCard, loadProfileCard, type OgCard } from '../../lib/og/og-data'
import { readFont } from '../../lib/og/og-font'

// Link-preview images: /api/og?variant=default | profile&address=0x… | app&did=did:key:…
// Any lookup or image failure answers with the default card (always 200).
// Node runtime (the pages-router default): images are converted with sharp
// (lib/og/og-image.ts), which the edge runtime cannot load.
```

(i.e. delete `export const config = { runtime: 'edge' }` and the `NextRequest`/`fetchFont` imports). In `loadFonts` replace the two `fetchFont(new URL(…, import.meta.url))` calls with:

```tsx
  fontsPromise ??= Promise.all([readFont('Inter-Regular.ttf'), readFont('Inter-SemiBold.ttf')])
```

Replace the whole `export default async function handler(req: NextRequest) { … }` with:

```tsx
/** Whether the card drew the stored image, its monogram, or has no image slot (default card). */
function imageState(card: OgCard): 'drawn' | 'monogram' | 'none' {
  if (card.variant === 'profile') return card.image ? 'drawn' : 'monogram'
  if (card.variant === 'app') return card.logo ? 'drawn' : 'monogram'
  return 'none'
}

async function drawPng(card: OgCard, fonts: [ArrayBuffer, ArrayBuffer] | null): Promise<Buffer> {
  const image = new ImageResponse(render(card), {
    ...SIZE,
    ...(fonts && {
      fonts: [
        { name: 'Inter', data: fonts[0], weight: 400 as const, style: 'normal' as const },
        { name: 'Inter', data: fonts[1], weight: 600 as const, style: 'normal' as const },
      ],
    }),
  })
  return Buffer.from(await image.arrayBuffer())
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only the query matters; the base is a placeholder.
  const url = new URL(req.url ?? '/', 'http://og.invalid')
  let { card, degraded } = await loadCard(url)
  const fonts = await loadFonts()
  let png: Buffer
  try {
    png = await drawPng(card, fonts)
  } catch (error) {
    // Satori refused this card (e.g. an image it cannot lay out): draw the default card instead.
    console.error('og: drawing failed, falling back to the default card:', error)
    card = { variant: 'default' }
    degraded = true
    png = await drawPng(card, fonts)
  }
  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Cache-Control', degraded || !fonts ? CACHE_DEGRADED : CACHE_OK)
  res.setHeader('X-Og-Variant', card.variant)
  res.setHeader('X-Og-Image', imageState(card))
  res.status(200).send(png)
}
```

- [ ] **Step 8: Run the OG tests**

Restart the stub if a dev server is reused (`fuser -k 4799/tcp`), then run: `npx playwright test e2e/og.spec.ts --workers=3 --reporter=line`
Expected: PASS (10 tests), including the existing guards (text, huge, evil host, redirect loop, broken, unknown) — Node's `fetch` honours `redirect: 'manual'`.

Look at one card: `curl -s -o /tmp/og.png "http://localhost:3000/api/og?variant=app&did=did:key:z6MkSeoWebpAppxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1"` and open it. You should see a green rounded square logo next to "Webp App".

- [ ] **Step 9: Build, check that sharp stays server-only, and commit**

```bash
npx tsc --noEmit -p . && pnpm lint && pnpm build 2>&1 | tail -2
grep -l "sharp-linux\|libvips" .next/static/chunks/*.js .next/static/chunks/pages/*.js || echo "no sharp in client chunks"
ls .next/standalone/assets/fonts/Inter-SemiBold.ttf .next/standalone/node_modules/.pnpm | grep -c "sharp\|Inter-SemiBold"
git add lib/og/og-image.ts lib/og/og-data.ts lib/og/og-font.ts pages/api/og.tsx next.config.ts package.json pnpm-lock.yaml e2e/support/stub-switchboard.mjs e2e/og.spec.ts
git commit -m "feat(og): draw WebP, AVIF and SVG images by converting them with sharp on the Node runtime"
```

Expected: build passes; `no sharp in client chunks`; the count is ≥ 2.

---

### Task 5: Clamp long names, handles and taglines on OG cards

**Files:**
- Modify: `pages/api/og.tsx` (`clamp` helper, `Frame` footer, `Monogram`, profile and app layouts)
- Modify: `e2e/og.spec.ts` (120-character fixtures + pixel-margin test)

**Interfaces:**
- Consumes: Task 4's Node route and `X-Og-Variant` header; `sharp` (dev-time use in the spec).
- Produces: `clamp(lines: number): React.CSSProperties` (internal to `pages/api/og.tsx`).

- [ ] **Step 1: Write the failing tests**

In `e2e/og.spec.ts` add `import sharp from 'sharp'` after the Playwright import. After the `BOMB` constant add:

```ts
const LONG_NAME = '0x5e00000000000000000000000000000000000c0d'
const LONG_WORD = '0x5e00000000000000000000000000000000000c0e'
const LONG_APP_DID = 'did:key:z6MkSeoLongAppxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1'
// 120 characters of real words, and one 120-character word.
const LONG_TEXT = 'Quarterly Treasury Reconciliation Dashboard for Decentralised Autonomous Organisations and Their Many Contributors World'
const LONG_RUN = 'W'.repeat(120)
```

At the top of `test.beforeAll` add:

```ts
  await fixtureStub({
    match: 'OgProfile',
    variables: LONG_NAME,
    response: { data: { renownUsers: [{ ...profile('stub-webp-doc', `attachment://v1:${'c'.repeat(64)}`), displayName: LONG_TEXT, handle: 'h'.repeat(120) }] } },
  })
  await fixtureStub({ match: 'OgProfile', variables: LONG_WORD, response: { data: { renownUsers: [{ ...profile('seo-doc-long', null), displayName: LONG_RUN }] } } })
  await fixtureStub({
    match: 'OgApp',
    variables: LONG_APP_DID,
    response: { data: { appProfile: { documentId: 'stub-webp-doc', name: LONG_TEXT, tagline: LONG_TEXT, category: LONG_TEXT, logo: null, logoRef: `attachment://v1:${'2'.repeat(64)}` } } },
  })
```

Before `test.describe('link-preview caching', …)` add:

```ts
/**
 * Pixels of card text (ink #F4F7FF or muted #94A3B8; every channel > 140) in the
 * right 48 px or the bottom 40 px of the card, where no text belongs: text that
 * runs past its box shows up there. The background and the green/blue accents
 * have a channel ≤ 140.
 */
async function textPixelsInMargins(png: Buffer): Promise<number> {
  const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let count = 0
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (x < info.width - 48 && y < info.height - 40) continue
      const i = (y * info.width + x) * 3
      if (data[i] > 140 && data[i + 1] > 140 && data[i + 2] > 140) count++
    }
  }
  return count
}

test.describe('link-preview text', () => {
  for (const [label, query] of [
    ['a 120-character app name, tagline and category', `?variant=app&did=${LONG_APP_DID}`],
    ['a 120-character display name and handle', `?variant=profile&address=${LONG_NAME}`],
    ['a 120-character name without spaces', `?variant=profile&address=${LONG_WORD}`],
  ]) {
    test(`clamps ${label} inside the card`, async ({ request }) => {
      const response = await request.get(`/api/og${query}`)
      expect(response.status()).toBe(200)
      expect(response.headers()['x-og-variant']).not.toBe('default')
      expect(await textPixelsInMargins(await response.body())).toBe(0)
    })
  }

  test('a short card keeps its text margins clear too', async ({ request }) => {
    const response = await request.get(`/api/og?variant=app&did=${APP_DID}`)
    expect(await textPixelsInMargins(await response.body())).toBe(0)
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `npx playwright test e2e/og.spec.ts -g "link-preview text" --reporter=line`
Expected: the three "clamps …" tests FAIL with counts in the thousands (measured: 1088, 3393, 6285: the name runs past the bottom, the word past the right edge, the handle footer past the right edge). The short-card test passes.

- [ ] **Step 3: Clamp the text**

In `pages/api/og.tsx` add above `function Frame(`:

```tsx
/**
 * Text cut to `lines` lines with an ellipsis; words longer than a line break
 * anywhere. User-provided names, handles and taglines can be any length.
 */
function clamp(lines: number): React.CSSProperties {
  return { display: 'block', lineClamp: lines, overflow: 'hidden', wordBreak: 'break-word' }
}
```

Then:
- In `Frame`, replace `<div style={{ display: 'flex', fontSize: 24, color: MUTED }}>{footer}</div>` with `<div style={{ ...clamp(1), fontSize: 24, color: MUTED }}>{footer}</div>`.
- In `Monogram`'s style add `flexShrink: 0,` after `height: size,`.
- Profile variant: the avatar `<img>` style becomes `{ flexShrink: 0, borderRadius: 220, objectFit: 'cover', border: \`4px solid ${BLUE}\` }`. The text column `<div style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 720 }}>` becomes `<div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1, minWidth: 0 }}>`. The name span style becomes `{ ...clamp(2), fontSize: 72, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }`, and the handle span style becomes `{ ...clamp(1), fontSize: 34, color: SIGNAL }`.
- App variant: the logo `<img>` style becomes `{ flexShrink: 0, borderRadius: 44, objectFit: 'cover' }`. The text column `maxWidth: 760` becomes `flex: 1, minWidth: 0`. The category style becomes `{ ...clamp(1), fontSize: 24, color: SIGNAL }`, the name style `{ ...clamp(2), fontSize: 72, fontWeight: 600, letterSpacing: -2, lineHeight: 1.05 }`, and the tagline style `{ ...clamp(2), fontSize: 32, color: MUTED, lineHeight: 1.3 }`.

- [ ] **Step 4: Run the OG spec and look at a card**

Run: `npx playwright test e2e/og.spec.ts --workers=3 --reporter=line`
Expected: PASS (14 tests).
Look at `curl -s -o /tmp/long.png "http://localhost:3000/api/og?variant=app&did=did:key:z6MkSeoLongAppxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1"`. The category should be on one line with an ellipsis, the name on two lines ending "Dashbo…", and the tagline on two lines with an ellipsis, all inside the card.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit -p . && pnpm lint
git add pages/api/og.tsx e2e/og.spec.ts
git commit -m "fix(og): clamp long names, handles and taglines inside the card"
```

---

### Task 6: Bound `/me`'s profile read with a client timeout

**Files:**
- Modify: `hooks/use-own-profile.ts` (whole file)
- Modify: `components/me/me-dashboard.tsx:49` and the block after the Download button
- Modify: `e2e/me.spec.ts` (new test before the axe loop)

**Interfaces:**
- Consumes: `withTimeout(promise, ms)`, `CLIENT_DATA_TIMEOUT_MS` (10 000) from `utils/with-timeout.ts`; `getProfile()` (never rejects; a failed read is `null`).
- Produces: `useOwnProfile(address): { profile: RenownProfile | null; loaded: boolean; timedOut: boolean }` (`components/site/use-site-auth.ts` keeps using only `profile`).

- [ ] **Step 1: Write the failing test**

In `e2e/me.spec.ts` add before `for (const theme of ['light', 'dark'] as const) {`:

```ts
test('a profile read that never answers times out: Download enables, the page says the profile is missing', async ({ page }) => {
  const wallet = await signInTestWallet(page)
  const mock = await mockSwitchboard(page, wallet.address)
  mock.holdProfile = new Promise<void>(() => {})
  await page.goto('/me')
  await expect(page.getByRole('heading', { level: 2, name: 'Connected apps' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Download my data' })).toBeDisabled()
  // CLIENT_DATA_TIMEOUT_MS (10 s) after the read started.
  await expect(page.getByRole('button', { name: 'Download my data' })).toBeEnabled({ timeout: 20_000 })
  await expect(page.getByText('Your profile did not load')).toBeVisible()
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()])
  const data = JSON.parse(await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'))) as {
    profile: unknown
  }
  expect(data.profile).toBeNull()
})
```

Run: `npx playwright test e2e/me.spec.ts -g "never answers times out" --reporter=line`
Expected: FAIL. "Download my data" stays disabled (`toBeEnabled` times out after 20 s).

- [ ] **Step 2: Implement the timeout**

Replace `hooks/use-own-profile.ts`:

```ts
import { useEffect, useState } from 'react'
import { getProfile, type RenownProfile } from '../services/switchboard'
import { CLIENT_DATA_TIMEOUT_MS, withTimeout } from '../utils/with-timeout'

export interface OwnProfile {
  /** The profile; null while loading, when there is none, or when the read failed or timed out. */
  profile: RenownProfile | null
  /** True once the read for the current address has answered or timed out (profile may still be null). */
  loaded: boolean
  /** True when the read did not answer within CLIENT_DATA_TIMEOUT_MS: the page says the profile is missing. */
  timedOut: boolean
}

interface Answer {
  address: string
  profile: RenownProfile | null
  timedOut: boolean
}

/** The signed-in wallet's Renown profile. Re-reads when the address changes. */
export function useOwnProfile(address: string | undefined): OwnProfile {
  const [answer, setAnswer] = useState<Answer | null>(null)

  useEffect(() => {
    if (!address) return
    let cancelled = false
    const lower = address.toLowerCase()
    // getProfile never rejects (a failed read is null); only the timeout does.
    withTimeout(getProfile({ driveId: `renown-${lower}`, ethAddress: lower }), CLIENT_DATA_TIMEOUT_MS)
      .then((profile) => {
        if (!cancelled) setAnswer({ address, profile, timedOut: false })
      })
      .catch(() => {
        if (cancelled) return
        // No address or profile data in the log.
        console.warn(`Renown profile read timed out after ${CLIENT_DATA_TIMEOUT_MS} ms`)
        setAnswer({ address, profile: null, timedOut: true })
      })
    return () => {
      cancelled = true
    }
  }, [address])

  const current = answer && answer.address === address ? answer : null
  return { profile: current?.profile ?? null, loaded: current !== null, timedOut: current?.timedOut ?? false }
}
```

In `components/me/me-dashboard.tsx` replace `const { profile, loaded: profileLoaded } = useOwnProfile(address)` with `const { profile, loaded: profileLoaded, timedOut: profileTimedOut } = useOwnProfile(address)`, and directly after the `</div>` that closes the heading row (the one containing the Download button) add:

```tsx
      {profileTimedOut && (
        <p role="status" className="text-ink-muted mt-4 text-sm">
          Your profile did not load, so it is not shown here and a download leaves it out. Reload the page to try again.
        </p>
      )}
```

- [ ] **Step 3: Run the /me spec**

Run: `npx playwright test e2e/me.spec.ts --workers=3 --reporter=line`
Expected: PASS (15 tests, including "Download my data waits for the profile as well as the approvals" and the axe tests).

- [ ] **Step 4: Commit**

```bash
npx tsc --noEmit -p . && pnpm lint
git add hooks/use-own-profile.ts components/me/me-dashboard.tsx e2e/me.spec.ts
git commit -m "fix(me): stop waiting for a profile read that never answers"
```

---

### Task 7: Whole-branch verification, Docker/sharp check, Lighthouse on staging

**Files:** none (verification only; fix forward in the owning task if something fails).

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence for the rollout (chunk sizes, Lighthouse, OG in the image).

- [ ] **Step 1: Static checks and build**

```bash
npx tsc --noEmit -p . && pnpm lint
NEXT_PUBLIC_PRIVY_APP_ID=x pnpm build 2>&1 | tail -2
```

Expected: clean, and the build ends with `Wallet code check passed: 9 marketing pages load no wallet code.`

- [ ] **Step 2: Full e2e suite once**

Run: `npx playwright test --workers=3 --reporter=line 2>&1 | tail -5`
Expected: 243 passed. If `renown-writes.spec.ts:528` fails with a strict-mode match on "Open in editor" buttons, that is the Next dev overlay flake: rerun that spec alone.

- [ ] **Step 3: sharp in the production image**

```bash
docker build -q -t renown-followups:verify --build-arg NEXT_PUBLIC_SWITCHBOARD_ENDPOINT=http://localhost:4799/graphql --build-arg NEXT_PUBLIC_RENOWN_URL=http://localhost:3200 --build-arg NEXT_PUBLIC_PRIVY_APP_ID=x .
STUB_SWITCHBOARD_PORT=4799 node e2e/support/stub-switchboard.mjs &
docker run -d --rm --name renown-verify --network host -e PORT=3200 renown-followups:verify
node -e "
const post=(b)=>fetch('http://localhost:4799/__stub/fixture',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});
(async()=>{for (const [a,doc] of [['c08','stub-webp-doc'],['c09','stub-avif-doc'],['c0a','stub-svg-doc'],['c0b','stub-badwebp-doc'],['c0c','stub-bomb-doc']])
  await post({match:'OgProfile',variables:'0x5e00000000000000000000000000000000000'+a,response:{data:{renownUsers:[{documentId:doc,displayName:'Olga Graph',username:null,handle:'olga',avatar:'attachment://v1:'+'c'.repeat(64),userImage:null}]}}})})()"
for a in c08 c09 c0a c0b c0c; do curl -s -o /dev/null -D - "http://localhost:3200/api/og?variant=profile&address=0x5e00000000000000000000000000000000000$a" | grep -i "x-og-image"; done
docker exec renown-verify sh -c 'ls node_modules/.pnpm | grep linuxmusl'
docker stop renown-verify; kill %1
```

Expected: `drawn` ×3 (WebP, AVIF, SVG), then `monogram` ×2; `@img+sharp-linuxmusl-x64@0.34.5` and `@img+sharp-libvips-linuxmusl-x64@1.2.4` listed.

- [ ] **Step 4: Staging (after merge to `deploy/staging` and pinning `staging-<sha7>`)**

```bash
for p in "" apps developers; do CHROME_PATH=/home/f/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome npx -y lighthouse@12.6.0 "https://renown-staging.vetra.io/$p" --quiet --output=json --output-path=/tmp/lh-$p.json --chrome-flags="--headless=new --no-sandbox"; node -e "const c=require('/tmp/lh-$p.json').categories;console.log('/$p',['performance','accessibility','best-practices','seo'].map(k=>Math.round(c[k].score*100)).join(' / '))"; done
curl -sI "https://renown-staging.vetra.io/api/og?variant=app&did=<DID of a staging app whose logo is WebP>" | grep -i "x-og"
curl -s -o /dev/null -w "%{http_code}\n" "https://renown-staging.vetra.io/?app=did:web:example.com"
```

Expected: Performance ≥ 90 on all three, Accessibility 100, SEO 100; `X-Og-Variant: app`, `X-Og-Image: drawn`; 200. Then smoke `/me`, `/profile/edit`, `/console?session=x`, `/oidc/login` in a browser (sign-in card or panel appears, no "Sign-in could not load"). Record the staging numbers in the PR before promoting to main.

---

## Rollout notes

- **Env:** no new variables. `OG_MEDIA_HOSTS` (storage hosts for `/media` redirects) is unchanged and still applies. `NEXT_PUBLIC_*` build args are unchanged.
- **Docker:** no Dockerfile change. The `deps` stage runs `pnpm i --frozen-lockfile` on node:22-alpine, which installs the musl sharp binaries (verified). The standalone output traces `sharp`, `@img/*` and `assets/fonts` for `/api/og`. The builder's `pnpm run build` now also runs the wallet-chunk check, so a PR whose marketing pages pull wallet code fails the image build in CI (`docker/build-push-action` runs on PRs with `push: false`).
- **Vercel:** `/api/og` turns from an Edge Function into a Node.js Serverless Function. sharp's glibc binary (`@img/sharp-linux-x64`) installs on Vercel's build image; the function bundle grows by about 20 MB (well under the 250 MB limit). Edge caching is unchanged (`s-maxage=3600, stale-while-revalidate=86400`). Cold starts are slower than edge, which is fine for crawler traffic. The `build` script includes the check, so Vercel builds fail the same way.
- **Cached cards:** cards rendered with a monogram before this change stay cached at the CDN for up to 1 h (+24 h SWR), and much longer on social platforms. Re-scrape the important ones (Facebook Sharing Debugger, LinkedIn Post Inspector; X refetches on its own schedule).
- **Order:** staging first (`deploy/staging`, pin `staging-<sha7>` only after the image exists, Task 7 Step 4), then `main` → semantic-release → Vercel prod + `renown-app:<version>` pinned once the image exists. Prod smoke: the same three curls against `https://www.renown.id`.
- **Analytics:** OpenPanel identification now follows the Renown session (ruling 4). Expect fewer identified events on third-party connect flows and more identified pageviews on marketing pages from returning users.
- **Not verifiable locally (left to staging/user):** real Privy/WalletConnect sign-in and revoke with a real wallet (user pass, unchanged scope); Lighthouse on staging/prod hardware; OpenPanel identify events arriving (the e2e build has no OpenPanel client id).

## Self-review

- **Spec coverage:**
  - Wallet shell + `_app` → Task 3. `/` dynamic WebFlow → Task 3 Step 7. Wallet routes → Task 3 Steps 5–7.
  - AnalyticsIdentity and the `RevokeSignatureRejectedError` move → Task 2. RainbowKit CSS moved into the shell → Task 3 Step 3.
  - Build check → Task 3 Steps 11–12. "No wallet chunk requests on /" e2e → Task 3 Step 1. Header Sign in, `/?app` and the `/me`/`/profile/edit` e2e switch → Task 3 tests plus the existing specs.
  - OG on Node with sharp, limits and protections → Task 4. Conversion failure → monogram → Task 4 tests. Docker/Vercel → Task 7 + Rollout.
  - `useOwnProfile` timeout → Task 6. OG clamping with 120-character fixtures → Task 5. Lighthouse before/after → measured above + Task 7 Step 4.
- **Placeholder scan:** the only angle-bracket token left for the executor is the staging app DID in Task 7 Step 4, which only exists in staging data. It is named explicitly ("a staging app whose logo is WebP").
- **Type consistency:** `withLazyWalletShell`/`WalletFallbackProps` are used the same way in Tasks 3's pages and fallbacks. `fetchImageDataUrl(url, origin, box)` is used with `AVATAR_BOX`/`LOGO_BOX`. `readFont(name, dir?)` is used in og.tsx and og.spec. `useOwnProfile().timedOut` is used in me-dashboard.
- **Review Focus:** each of the five lines has a test in its owning task (Task 3 ×3, Task 4, Task 6).
