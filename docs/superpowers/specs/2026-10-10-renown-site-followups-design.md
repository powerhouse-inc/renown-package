# renown.id site follow-ups — design

Date: 2026-10-10
Status: approved in conversation ("continue with the 3 suggested follow ups. one shot.")
Repo: renown.id (`/home/f/projects/renown-hub`, branch `feat/site-followups` from origin/main 6bc7ae0, release 1.21.1)
Builds on: `2026-10-09-renown-site-polish-design.md` (its global constraints still apply).

## Intent

Close the three follow-ups left by the site polish launch:

1. **Performance:** mobile Lighthouse Performance ≥ 90 on `/`, `/apps`, `/developers`
   (today 78 / 65 / 81). The whole wallet stack (Privy, wagmi, RainbowKit, WalletConnect/Reown,
   viem) lives in `pages/_app.tsx` and the `_app` chunk (~3.4 MB raw) loads and executes on every
   page, although marketing pages never use it.
2. **Real logos in link previews:** `/api/og` cannot draw WebP (Satori). App logos/covers from
   vetra.io and possibly avatars are WebP, so cards show a monogram. Draw the real image.
3. **Small items:** the profile read that gates "Download my data" on `/me` has no client
   timeout; OG cards must stay readable with very long names/taglines (80+ characters).

## Findings that shape the design

- Restoring a Renown session only needs `<Renown>` from `@powerhousedao/reactor-browser/renown`
  (credential + app key in IndexedDB). Privy/wagmi are not involved. `useRenownAuth()` works with
  only `<Renown>` mounted.
- The header "Sign in" (`useRenownAuth().login()` with no wallet activator) navigates the tab to
  `/?app=<did>&connect=<did>&…&returnUrl=…`, where `WebFlow` runs the wallet flow. Marketing pages
  therefore never use the wallet providers in-page.
- Wallet consumers (need `AuthRootProvider` = wagmi + Privy + orchestrator): `WebFlow` on `/` with
  `app`/`connect`, `/console` (`ConsoleFlow`), `/oidc/login` (`OidcLoginFlow`), `/profile/edit`,
  `/me` (signature fallback for revoke and the e2e stand-in session).
- Couplings that drag the stack into `_app`: `AnalyticsIdentity` uses the orchestrator
  `useSession`; `hooks/auth.ts` and `components/auth/credential.tsx` import
  `RevokeSignatureRejectedError` from `services/wallet/orchestrator`; `_app` imports
  `@rainbow-me/rainbowkit/styles.css`; `pages/index.tsx` statically imports `WebFlow`.

## Design

### 1. Route-scoped wallet stack

- New `components/wallet/wallet-shell.tsx`: renders `AuthRootProvider` (and imports the
  RainbowKit stylesheet) around its children. It is the only entry point to
  `services/wallet/setup` from pages.
- New `components/wallet/lazy-wallet-shell.tsx`: `next/dynamic(() => import('./wallet-shell'),
  { ssr: false, loading: <neutral loading state> })`. The loading state matches each page's
  existing loading UI so there is no layout jump.
- `pages/_app.tsx` keeps ThemeProvider, QueryClientProvider, `<Renown>`, Analytics and the page;
  it no longer mounts `AuthRootProvider` nor imports the RainbowKit CSS.
- Wallet routes wrap their wallet-dependent content in `LazyWalletShell`:
  - `/` only in the auth branch (`app`/`connect` present): `WebFlow` itself is loaded with
    `next/dynamic` inside the shell, so the homepage chunk carries no wallet code.
  - `/console`, `/oidc/login`, `/profile/edit`, `/me` (the whole page body).
- `AnalyticsIdentity` identifies from `useRenownAuth()` (address/user) instead of the orchestrator
  session, so returning users are still identified on marketing pages.
- `RevokeSignatureRejectedError` moves to a dependency-free module (e.g.
  `services/wallet/errors.ts`) re-exported by the orchestrator for compatibility.
- Nothing reachable from marketing pages (`/`, `/apps`, `/developers`, `/trust`, `/ecosystem`,
  `/app/[did]`, `/profile/[id]`, `/@handle`, 404/500) may import `services/wallet/*`,
  `auth-providers/*`, `hooks/use-wallet-adapter`, `hooks/auth`, `utils/wagmi`, wagmi, Privy,
  RainbowKit or WalletConnect modules. Enforced by a build check (script or test) that inspects
  the built client chunks for those pages and fails if wallet markers (e.g. `privy`,
  `walletconnect`, `rainbowkit`, `wagmi`) appear.
- Behaviour on wallet routes is unchanged: all existing e2e specs for `?app`/`?connect`,
  `/console`, `/oidc/login`, `/profile/edit`, `/me` (incl. the `NEXT_PUBLIC_E2E_AUTH` stand-in)
  stay green.
- Header, mobile nav, hero CTA and sign-out keep using `useRenownAuth` only (already true).

Target: mobile Lighthouse Performance ≥ 90 on `/`, `/apps`, `/developers` on staging and prod;
Accessibility and SEO stay 100; CLS stays 0. Best Practices rises once Privy's third-party cookies
leave marketing pages; the OpenPanel 503 console errors are an infrastructure issue outside this
repo and are reported, not fixed here.

### 2. OG images: convert undrawable formats

- `/api/og` moves from the edge runtime to the Node.js runtime (`next/og` works on both) and
  converts WebP/AVIF images (and SVG, rasterised) to PNG with `sharp` before drawing. `sharp` is a
  server-only dependency (never in client bundles); it must work in the production Docker image
  (node:22-alpine, musl) and on Vercel — verified by a production build and a request in the
  container/staging.
- All existing protections stay: only the site's own `/media` route, manual redirects to
  allowlisted storage hosts, byte cap while streaming, type allowlist (now also webp/avif/svg as
  convertible), timeout, default-card fallback + degraded cache on real failures.
- Conversion failures (corrupt bytes) fall back to the monogram card (normal caching), never 500.
- Decompression-bomb guard: sharp `limitInputPixels` (e.g. 40 MP) and an output resize to the card
  size (logo ≤ 256 px, cover ≤ 1200×630, avatar ≤ 256 px).

### 3. Small items

- `hooks/use-own-profile.ts`: bound the profile read with `withTimeout(…, CLIENT_DATA_TIMEOUT_MS)`;
  on timeout it resolves as "loaded, no profile" (so Download enables and the page explains) and
  logs `console.warn` without sensitive data.
- OG cards: name clamps to 2 lines and tagline to 2 lines with an ellipsis; display names and
  handles likewise; verified with 120-character fixtures for app and profile variants.

## Testing

- e2e: existing suite green; new specs for: marketing pages render and the header Sign in works
  without the wallet stack (and no wallet chunk requests on `/`); `/?app=…` still renders WebFlow;
  `/me` and `/profile/edit` still work under the e2e switch; OG WebP fixture now draws the image
  variant (assert header `X-Og-Image: drawn` or equivalent) and long-name fixtures return 200.
- Build check for wallet markers in marketing chunks (part of the verification task and CI).
- Lighthouse mobile on staging before prod; record before/after.

## Rollout

Staging (`deploy/staging`, pin `staging-<sha7>` after the image exists), Lighthouse + smoke, then
`main` (semantic-release → Vercel prod + `renown-app:<version>` pinned after the image exists).
The real-wallet sign-in/revoke pass remains with the user.

## Out of scope

Replacing Privy/wagmi, OpenPanel infrastructure, image CDN.
