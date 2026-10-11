# renown.id profile pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn `/@handle` (`/profile/[id]`) and `/app/[did]` from the pre-polish glass cards into the site's best pages: a deterministic identity-art cover per wallet or app, verification that explains itself, sharing (link, QR, system sheet), owner affordances, public facts, activity and app stats in plain words, and full SEO (titles, JSON-LD, OG cards drawn on the identity art), while every URL, redirect, status code and data contract stays as it is.

**Architecture:** A pure `identityArt(seed, { width, height, theme })` in `lib/identity-art.ts` returns an SVG string with concrete colours (OKLCH computed to hex). The pages render both theme variants inline and CSS shows one, so nothing changes after hydration. `/api/og` rasterises the same SVG with sharp for its backdrop. Shared UI lives in `components/identity/*` (share menu, verified badge, link chips, copy rows, metric cards). Each page is a hero plus a two-column body (`components/profile/*`, `components/app-page/*`). Secondary SSR reads are bounded by `SSR_DATA_TIMEOUT_MS` and drop their section on failure. Owner detection happens only in the browser (`useRenownAuth`), so these marketing pages ship no wallet code.

**Tech Stack:** Next 16.2.6 pages router (webpack build), React 19.2.6, Tailwind v4 tokens, `next/og` (Satori) + sharp 0.34.5 (from the follow-ups), `uqr` 0.1.2 (server-only QR encoder), Playwright e2e against the stub switchboard, pnpm 10.

**Spec:** `/home/f/projects/renown-package-hub/docs/superpowers/specs/2026-10-10-renown-profile-pages-design.md` (parent: `2026-10-09-renown-site-polish-design.md`, whose global constraints still apply).

**Code repo:** `/home/f/projects/renown-hub` (powerhouse-inc/renown). Start from the branch that carries the finished follow-ups plan (`docs/superpowers/plans/2026-10-10-site-followups.md`, Tasks 1–6: real axe gate, lazy wallet shell + `pnpm build` wallet-chunk check, `/api/og` on Node with sharp, OG clamping, `/me` timeout). Branch `feat/profile-pages` from it. All paths below are relative to the code repo.

## Planner rulings

Every task below was implemented in a scratch worktree (origin/main 6bc7ae0 + the follow-ups' Tasks 1–6). All code in this plan is the code that ran there.

1. **Both theme variants are server-rendered.** `IdentityArt` renders the light and the dark SVG and CSS (`dark:hidden` / `hidden dark:block`) shows one. The theme is only known in the browser (next-themes), so rendering one variant would flash or shift after hydration. Each SVG is about 5 KB. The colours are concrete hex values (computed from OKLCH, so lightness is even across hues) and not CSS variables, so `/api/og` can rasterise the same SVG with sharp.
2. **Hues avoid OKLCH 70–125** (olive and mustard). These looked dirty on the light background in screenshots, so they move to the nearer edge (66 or 128). A unit test checks 400 seeds.
3. **The QR code is computed in `getServerSideProps`** with `uqr@0.1.2` (error correction M, about 14 KB, MIT). Only a path string reaches the page. Verified: no `uqr` code in any client chunk. The code is drawn dark on a white tile in both themes, because scanners need dark modules on light.
4. **Owner detection is client-only and cannot shift the layout.** `useViewerAddress()` returns `useRenownAuth().address`, lowercased. It is null on the server and during hydration (`useSyncExternalStore` with a null server snapshot). The owner's "Edit profile" and the "n of 4" completeness ring are appended after "Share" in a left-aligned row, so nothing moves (CLS test with an owner). The e2e switch is `window.__renownE2eViewer`, honoured only under `NEXT_PUBLIC_E2E_AUTH=1`, the same pattern as `/me`'s `__renownE2eBearer`. The completeness logic is `/me`'s `profileCompleteness()`, computed from the server-rendered profile, so there is no extra read.
5. **Popovers are non-modal disclosures.** Each is a button with `aria-expanded`/`aria-controls` and a labelled region. Escape closes it and returns focus; a click or focus outside closes it. Below 640 px the panels are bottom sheets (`fixed inset-x-4 bottom-4`): anchored to a badge, they overflowed a 390 px viewport (measured `scrollWidth` 425).
6. **The name fallback** is display name, then handle, then username, then the short address, then the document id. A username is skipped when it is only a shortened address: prod `@frank` has the legacy username `0x2BbE...3aC6`. The ENS chip shows the username only when `isEnsVerified` is true and it differs from the shown name. There is no reverse lookup (no backend change).
7. **Section names.** Profile: "About", "Apps published", "Activity" ("Stats" before). App: "Overview" (not "About": app descriptions often start with `## About`, which would make two identical headings) and "Stats". Markdown headings inside a section are demoted one level (`MarkdownLite headingBase={3}`).
8. **A facts strip replaces the old badges.** "Member since June 2026", "2 apps published" and "Active in 1 app" replace the "Publisher" and "ENS verified" pills. A fact is left out when it is zero. Dates use en-GB and UTC.
9. **Titles.** The document title is "Name (@handle) on Renown" or "Name on Renown", set through a new `PageMeta` `documentTitle` prop. The profile `og:title` stays "Name (@handle)". The app `og:title` becomes the name alone (it was "Name — tagline") and the description is the tagline. Canonical URLs now come from `PageMeta` (`NEXT_PUBLIC_RENOWN_URL`), like every other page.
10. **Two different "no stats" cases.** A failed or timed-out `appStats` read is null, and the section drops out. An app that reports nothing yet (`totalUsers` 0 and every metric 0) shows "No activity reported yet", naming its declared metrics. The live Knowledge Vault page is exactly this case today. Metric meanings are written out ("Total across all users", "Highest by a single user", "Average per user", "Number of users"), and `AGGREGATION_CAPTION` is removed.
11. **Secondary SSR reads** (published apps, user stats, publisher profile, app stats, the publisher's apps, the category) go through `withTimeout(…, SSR_DATA_TIMEOUT_MS).catch(fallback)`. The primary read keeps today's semantics exactly: 503 + `no-store` + `Retry-After` on an outage, 404 when unknown, the 307 to `/@handle`.
12. **OG backdrops.** A profile card is drawn on its identity art. An app card is drawn on its cover when the cover can be fetched and decoded (through the follow-ups' `fetchImageDataUrl`, at a 1200×630 box), and otherwise on its identity art. A scrim keeps the text legible, and keeps the follow-ups' "no text pixels in the margins" test at 0. New header `X-Og-Background: cover | art | none`. A cover that fails is decoration: it never degrades the cache.
13. **The verification copy is limited to claims backed by code.** On profiles: the wallet controls the identity; only that wallet or an app it approved can change the profile; every change is signed. This follows the write-auth spec and `/trust`'s "each document operation … carries a signature". On apps: the app is identified by its own key, and an approval is a credential naming that key (`/trust`, "app-keys" and "credentials"). The executor re-reads `components/trust/trust-content.ts` and must not strengthen these claims.
14. **Icons come from dependencies already installed.** `@iconify-icons/simple-icons` (GitHub, X, LinkedIn, YouTube, Discord, Telegram) and `@iconify-icons/lucide/globe` provide the icon data only, without the iconify runtime. Farcaster is not in simple-icons 1.2.74, so it is a small hand-drawn arch.
15. **Deleted:** `components/profile/copy-address.tsx`, `own-profile-actions.tsx`, `profile-stats.tsx`, `components/app/app-profile-card.tsx`, `components/app/app-stats.tsx`, `AGGREGATION_CAPTION`. **Kept:** `components/ui/renown-card.tsx` and `components/auth/profile-card.tsx` (the auth flows use them), `ProfileSummary`/`ProfileLinks` (the editor preview on `/profile/edit`, out of scope), `AppCover` (directory tiles).

## Measured in the scratch worktree

- `npx tsc --noEmit -p .` and `pnpm lint` are clean. `NEXT_PUBLIC_PRIVY_APP_ID=x pnpm build` ends with "Wallet code check passed: 9 marketing pages load no wallet code."
- Up-front JS (`_app` + page chunks, gzip) is 351 KB on `/profile/[id]` and on `/app/[did]` (`/apps`: 341 KB).
- Lighthouse 12.6.0 mobile, local production build on the stub switchboard (Performance / Accessibility / Best Practices / SEO):

  | Page | Score | CLS | TBT |
  |---|---|---|---|
  | rich profile | 96 / 100 / 100 / 100 | 0 | 94 ms |
  | minimal profile | 96 / 100 / 100 / 100 | 0 | 61 ms |
  | app with cover | 96 / 100 / 100 / 100 | 0 | 32 ms |
  | app without cover | 96 / 100 / 100 / 100 | 0 | 30 ms |

- Full e2e suite (`--workers=3`): **281 passed** (243 from the follow-ups plus the new and changed specs below).
- Screenshots (light/dark × 390/1280, rich and minimal profile, app with and without cover, plus the OG cards) were reviewed by eye. They are under `/tmp/claude-1000/-home-f-projects-vetra-cloud-package-licensing/836c66d6-98d7-4edb-aaea-70e6583bd747/scratchpad/shots/plan-prof-*.png`.

## Global Constraints

- Next.js 16.2.6 pages router, React 19.2.6, Tailwind v4 tokens in `styles/globals.css`; dark-first, Inter, primary `#0084FF`.
- Existing URLs, redirects and status codes are unchanged: `/@handle`, `/profile/[id]` (by document id, address or username; 307 to `/@handle` once a handle exists), `/app/[did]`, 404 for unknown, 503 + `no-store` + `Retry-After: 30` on an outage, `/media/...`, `/api/og`.
- Data only from `renownUsers`, `appProfilesByPublisher`, `appProfile`, `appProfiles(category)`, `appStats`, `userStats`, server-side ENS (`utils/ens.ts`), `/media`. No backend changes. A user's credentials or approvals are never listed on public pages.
- Copy: sentence case, UK spelling, no ALL-CAPS labels, no "→", no middle dots.
- SSR with the existing timeouts. Secondary sections drop out on failure, and the primary failure keeps today's semantics.
- No new client dependency over 30 kB gzip. The QR code is generated on the server. The identity art is server-rendered SVG (no canvas, no WebGL), static apart from an optional twinkle under `prefers-reduced-motion: no-preference`.
- `/profile/[id]` and `/app/[did]` are marketing pages: no import of `services/wallet/*`, `auth-providers/*`, `hooks/use-wallet-adapter`, `hooks/auth`, `utils/wagmi`, wagmi, Privy, RainbowKit or WalletConnect. Owner detection uses `useRenownAuth` only. `pnpm build`'s wallet-chunk check must pass.
- Quality bar: zero serious/critical axe violations in both themes (the follow-ups' real gate), CLS 0, Lighthouse mobile Accessibility and SEO 100, Performance ≥ 90, no horizontal scroll at 390 px.
- No `Co-Authored-By` trailers in commits. Staging first, then prod.

## Review Focus

1. **The owner opens their own profile.** Session restore finishes after hydration. "Edit profile" and the completeness ring must appear without moving anything on the page. Test: Task 3, "nothing shifts after load, for visitors and owners".
2. **A disclosure is opened on a 390 px phone.** The verified-badge panel and the share menu must stay inside the viewport (bottom sheet), with no horizontal scroll. Test: Tasks 3 and 4: the axe tests open the share menu or the badge, then `attachScreenshots` asserts `scrollWidth ≤ 390`.
3. **An app's cover fails to load** (404, expired signed URL). The identity art must stay visible behind it and the frame must not change size; the OG card falls back to the art. Tests: Task 4 (`profile-apps.spec.ts`, the GAMMA app whose cover 404s: no `img`, two `.rn-art svg`) and Task 5 ("an app whose cover cannot be fetched falls back to its identity art").
4. **A legacy profile whose username is only a shortened address** (prod `@frank`: `0x2BbE...3aC6`) and no display name must be named by handle or short address, not by the truncated string. Test: Task 2, "profile names fall back …".
5. **A 120-character name without spaces and a very long bio** on a phone must wrap inside the page. Test: Task 3, "a 120-character name without spaces and a very long bio stay inside the page".

---

### Task 1: Identity art

**Files:**
- Create: `lib/identity-art.ts`
- Create: `components/identity/identity-art.tsx`
- Modify: `styles/globals.css` (append the `.rn-art` block)
- Test: `e2e/identity-art.spec.ts`

**Interfaces:**
- Consumes: `cx(...)` from `utils/cx`; `sharp` (dev-time use in the spec; a dependency since the follow-ups).
- Produces:
  - `type IdentityArtTheme = 'light' | 'dark'`
  - `interface IdentityArtOptions { width: number; height: number; theme: IdentityArtTheme; idPrefix?: string }`
  - `identityArt(seed: string, options: IdentityArtOptions): string`: a standalone SVG document, `preserveAspectRatio="xMidYMid slice"`
  - `identityHues(seed: string): { a: number; b: number; c: number }`, `identityAccent(seed: string): string` (`#rrggbb`), `oklchHex(l, c, h): string`, `seedHash(seed): number`
  - `<IdentityArt seed idPrefix width? height? className? />`: fills the box that `className` sizes and positions; both themes are server-rendered

- [ ] **Step 1: Write the failing test**

Create `e2e/identity-art.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import sharp from 'sharp'
import { identityAccent, identityArt, identityHues, oklchHex } from '../lib/identity-art'

// lib/identity-art.ts: pure, so these run without a page.
const A = '0x2bbea0145d6fb9c6709a74c1179ca0be71bb3ac6'
const B = '0x2bbea0145d6fb9c6709a74c1179ca0be71bb3ac7'
const APP = 'did:key:zDnaed4wPy35wBBJVLZL1XPRQWKpQeeb3JRgMdmHQsLe7KJyi'
const SIZE = { width: 1200, height: 320 }

test('the same seed always draws the same picture, case-insensitively', () => {
  expect(identityArt(A, { ...SIZE, theme: 'dark' })).toBe(identityArt(A, { ...SIZE, theme: 'dark' }))
  expect(identityArt(A.toUpperCase().replace('0X', '0x'), { ...SIZE, theme: 'dark' })).toBe(identityArt(A, { ...SIZE, theme: 'dark' }))
})

test('different seeds, themes and id prefixes draw different pictures', () => {
  const a = identityArt(A, { ...SIZE, theme: 'dark' })
  expect(identityArt(B, { ...SIZE, theme: 'dark' })).not.toBe(a)
  expect(identityArt(APP, { ...SIZE, theme: 'dark' })).not.toBe(a)
  expect(identityArt(A, { ...SIZE, theme: 'light' })).not.toBe(a)
  expect(identityArt(A, { ...SIZE, theme: 'dark', idPrefix: 'other' })).toContain('id="other-dark-base"')
})

test('the SVG never contains the seed and stays small', () => {
  for (const seed of [A, APP, '<script>alert(1)</script>']) {
    const svg = identityArt(seed, { ...SIZE, theme: 'light' })
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).not.toContain(seed)
    expect(svg).not.toMatch(/<script|on\w+=/i)
    expect(svg.length).toBeLessThan(8000)
  }
})

test('hues avoid the muddy olive band, and colours are hex', () => {
  for (let i = 0; i < 400; i++) {
    const { a, b, c } = identityHues(`0x${i.toString(16).padStart(40, '0')}`)
    for (const hue of [a, b, c]) {
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
      expect(hue >= 70 && hue < 125).toBe(false)
    }
  }
  expect(identityAccent(A)).toMatch(/^#[0-9a-f]{6}$/)
  expect(oklchHex(1, 0, 0)).toBe('#ffffff')
  expect(oklchHex(0, 0, 0)).toBe('#000000')
})

test('sharp rasterises the art (link-preview cards draw it)', async () => {
  const svg = identityArt(APP, { width: 1200, height: 630, theme: 'dark' })
  const { info } = await sharp(Buffer.from(svg)).png().toBuffer({ resolveWithObject: true })
  expect([info.width, info.height]).toEqual([1200, 630])
})
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx playwright test e2e/identity-art.spec.ts --reporter=line`
Expected: FAIL, because the module `../lib/identity-art` cannot be resolved.

- [ ] **Step 3: Implement the art**

Create `lib/identity-art.ts`:

```ts
// Identity art: a deterministic "constellation" for a wallet address or an app
// DID, drawn as an SVG string. The same seed always gives the same picture, so
// every profile and app looks like itself even without an avatar or a cover.
// Pure (no DOM, no randomness): used by the profile and app pages (inline) and
// by the link-preview cards (pages/api/og.tsx rasterises it with sharp, which
// is why colours are concrete hex values and not CSS variables).

export type IdentityArtTheme = 'light' | 'dark'

export interface IdentityArtOptions {
  width: number
  height: number
  theme: IdentityArtTheme
  /** Prefix for the SVG's gradient ids; must differ between pictures on one page. */
  idPrefix?: string
}

export interface IdentityHues {
  /** Main hue (0-359): the core glow. */
  a: number
  /** Neighbour hue: the second glow and most nodes. */
  b: number
  /** Accent hue, used sparingly (two or three nodes). */
  c: number
}

/** FNV-1a over the lowercased seed: stable across runtimes, no crypto needed. */
export function seedHash(seed: string): number {
  let h = 0x811c9dc5
  for (const char of seed.toLowerCase()) {
    h ^= char.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** mulberry32: a tiny seeded PRNG returning floats in [0, 1). */
function prng(seed: number): () => number {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

/** Olive and mustard (OKLCH hue 70-125) read as dirty on light backgrounds: such hues move to the nearer edge (amber or green). */
function clean(hue: number): number {
  const h = ((hue % 360) + 360) % 360
  if (h < 70 || h >= 125) return h
  return h < 97 ? 66 : 128
}

/** The seed's three hues. */
export function identityHues(seed: string): IdentityHues {
  const rand = prng(seedHash(seed))
  const a = clean(Math.floor(rand() * 360))
  const b = clean(a + (rand() < 0.5 ? -1 : 1) * (35 + Math.floor(rand() * 50)))
  const c = clean(a + 150 + Math.floor(rand() * 60))
  return { a, b, c }
}

/** OKLCH (l 0-1, c ~0-0.37, h degrees) to #rrggbb, gamut-clipped. Perceptually even lightness across hues. */
export function oklchHex(l: number, c: number, h: number): string {
  const rad = (h * Math.PI) / 180
  const A = c * Math.cos(rad)
  const B = c * Math.sin(rad)
  const l_ = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3
  const m_ = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3
  const s_ = (l - 0.0894841775 * A - 1.291485548 * B) ** 3
  const linear = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
  return `#${linear
    .map((v) => {
      const x = Math.min(1, Math.max(0, v))
      const srgb = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
      return Math.round(srgb * 255)
        .toString(16)
        .padStart(2, '0')
    })
    .join('')}`
}

const r1 = (n: number) => Math.round(n * 10) / 10

interface Palette {
  base: string
  baseEdge: string
  glowA: string
  glowB: string
  glowOpacity: number
  node: string
  accent: string
  line: string
  lineOpacity: number
  ring: string
  star: string
  core: [string, string]
}

function palette(hues: IdentityHues, theme: IdentityArtTheme): Palette {
  if (theme === 'dark') {
    return {
      base: oklchHex(0.19, 0.045, hues.a),
      baseEdge: oklchHex(0.13, 0.03, hues.b),
      glowA: oklchHex(0.62, 0.17, hues.a),
      glowB: oklchHex(0.58, 0.15, hues.b),
      glowOpacity: 0.6,
      node: oklchHex(0.86, 0.09, hues.b),
      accent: oklchHex(0.86, 0.15, hues.c),
      line: oklchHex(0.82, 0.08, hues.a),
      lineOpacity: 0.34,
      ring: oklchHex(0.8, 0.05, hues.a),
      star: '#ffffff',
      core: [oklchHex(0.9, 0.12, hues.b), oklchHex(0.72, 0.17, hues.a)],
    }
  }
  return {
    base: oklchHex(0.965, 0.022, hues.a),
    baseEdge: oklchHex(0.93, 0.035, hues.b),
    glowA: oklchHex(0.78, 0.13, hues.a),
    glowB: oklchHex(0.82, 0.11, hues.b),
    glowOpacity: 0.7,
    node: oklchHex(0.52, 0.14, hues.b),
    accent: oklchHex(0.6, 0.17, hues.c),
    line: oklchHex(0.45, 0.12, hues.a),
    lineOpacity: 0.3,
    ring: oklchHex(0.5, 0.07, hues.a),
    star: oklchHex(0.4, 0.05, hues.a),
    core: [oklchHex(0.7, 0.15, hues.b), oklchHex(0.5, 0.18, hues.a)],
  }
}

/**
 * The seed's constellation as a standalone SVG document string (`width` x
 * `height`, scales with preserveAspectRatio "xMidYMid slice"). A glowing core
 * right of centre, orbit rings around it, nodes on the orbits tied to the core
 * by edges and to their nearest neighbour, and a faint star field.
 */
export function identityArt(seed: string, { width, height, theme, idPrefix = 'ia' }: IdentityArtOptions): string {
  const hues = identityHues(seed)
  const p = palette(hues, theme)
  // A second stream for layout, so hues and layout vary independently.
  const rand = prng(seedHash(`${seed}#layout`))
  const id = `${idPrefix}-${theme}`
  const cx = width * (0.56 + rand() * 0.16)
  const cy = height * (0.38 + rand() * 0.24)
  const unit = Math.min(width, height)
  // Orbits stretch with the picture: wide covers get wide ellipses.
  const orbits = [0.13, 0.25, 0.4].map((k) => Math.max(unit * 0.3, width * k) * (0.9 + rand() * 0.2))
  const tilt = r1(-12 + rand() * 24)
  const squash = Math.min(0.85, (height / width) * (1.5 + rand() * 0.5))

  // Nodes on the orbits (ellipses: x radius r, y radius r * squash, rotated by tilt).
  const count = 11 + Math.floor(rand() * 6)
  const tiltRad = (tilt * Math.PI) / 180
  const nodes: { x: number; y: number; r: number; accent: boolean }[] = []
  for (let i = 0; i < count; i++) {
    const orbit = orbits[i % orbits.length]
    const angle = rand() * Math.PI * 2
    const ex = orbit * Math.cos(angle)
    const ey = orbit * squash * Math.sin(angle)
    const node = {
      x: r1(cx + ex * Math.cos(tiltRad) - ey * Math.sin(tiltRad)),
      y: r1(cy + ex * Math.sin(tiltRad) + ey * Math.cos(tiltRad)),
      r: r1(2.4 + rand() * 3.6),
      accent: i % 4 === 1,
    }
    const inside = node.x > 8 && node.x < width - 8 && node.y > 8 && node.y < height - 8
    // Nodes keep apart (24 units) and clear of the core, so no two dots merge.
    const apart = [...nodes, { x: cx, y: cy }].every((m) => (m.x - node.x) ** 2 + (m.y - node.y) ** 2 > 24 ** 2)
    if (inside && apart) nodes.push(node)
  }

  const edges: string[] = []
  for (const [i, n] of nodes.entries()) {
    // Every node is tied to the core (the "signed" edges), every other one also to its nearest neighbour.
    if (i % 3 !== 2) edges.push(`M${r1(cx)} ${r1(cy)}L${n.x} ${n.y}`)
    if (i % 2 === 0) {
      let best: (typeof nodes)[number] | null = null
      let bestD = Infinity
      for (const m of nodes) {
        const d = (m.x - n.x) ** 2 + (m.y - n.y) ** 2
        if (m !== n && d < bestD) {
          bestD = d
          best = m
        }
      }
      if (best) edges.push(`M${n.x} ${n.y}L${best.x} ${best.y}`)
    }
  }

  const stars: string[] = []
  const starCount = Math.round((width * height) / 9000)
  for (let i = 0; i < starCount; i++) {
    const x = r1(rand() * width)
    const y = r1(rand() * height)
    const r = r1(0.5 + rand() * 0.9)
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" opacity="${r1(0.12 + rand() * 0.4)}"/>`)
  }

  const bx = r1(width * (0.12 + rand() * 0.3))
  const by = r1(height * (0.15 + rand() * 0.5))
  const nodeMarkup = nodes
    .map((n, i) => {
      const fill = n.accent ? p.accent : p.node
      const halo = n.r > 4.2 || n.accent ? `<circle cx="${n.x}" cy="${n.y}" r="${r1(n.r * 2.6)}" fill="none" stroke="${fill}" stroke-opacity="0.45"/>` : ''
      const twinkle = i % 3 === 0 ? ' class="rn-art-twinkle"' : ''
      return `${halo}<circle${twinkle} cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${fill}"/>`
    })
    .join('')

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">`,
    `<defs>`,
    `<linearGradient id="${id}-base" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.base}"/><stop offset="1" stop-color="${p.baseEdge}"/></linearGradient>`,
    `<radialGradient id="${id}-ga"><stop offset="0" stop-color="${p.glowA}" stop-opacity="${p.glowOpacity}"/><stop offset="1" stop-color="${p.glowA}" stop-opacity="0"/></radialGradient>`,
    `<radialGradient id="${id}-gb"><stop offset="0" stop-color="${p.glowB}" stop-opacity="${r1(p.glowOpacity * 0.75)}"/><stop offset="1" stop-color="${p.glowB}" stop-opacity="0"/></radialGradient>`,
    `<linearGradient id="${id}-core" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${p.core[0]}"/><stop offset="1" stop-color="${p.core[1]}"/></linearGradient>`,
    `</defs>`,
    `<rect width="${width}" height="${height}" fill="url(#${id}-base)"/>`,
    `<circle cx="${bx}" cy="${by}" r="${r1(unit * 0.9)}" fill="url(#${id}-gb)"/>`,
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(unit * 1.15)}" fill="url(#${id}-ga)"/>`,
    `<g fill="${p.star}">${stars.join('')}</g>`,
    `<g fill="none" stroke="${p.ring}" stroke-opacity="0.42" stroke-dasharray="2 7" transform="rotate(${tilt} ${r1(cx)} ${r1(cy)})">`,
    orbits.map((r) => `<ellipse cx="${r1(cx)}" cy="${r1(cy)}" rx="${r1(r)}" ry="${r1(r * squash)}"/>`).join(''),
    `</g>`,
    `<path d="${edges.join('')}" stroke="${p.line}" stroke-opacity="${p.lineOpacity}" stroke-width="1.2" fill="none"/>`,
    nodeMarkup,
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(unit * 0.075)}" fill="none" stroke="${p.core[0]}" stroke-opacity="0.5"/>`,
    `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${r1(unit * 0.045)}" fill="url(#${id}-core)"/>`,
    `</svg>`,
  ].join('')
}

/** The seed's accent colour (mid lightness, reads on light and dark): the avatar ring, publisher accents. */
export function identityAccent(seed: string): string {
  return oklchHex(0.66, 0.15, identityHues(seed).a)
}
```

Create `components/identity/identity-art.tsx`:

```tsx
import { useMemo } from 'react'
import { identityArt } from '../../lib/identity-art'
import { cx } from '../../utils/cx'

export interface IdentityArtProps {
  /** Wallet address or app DID. */
  seed: string
  /** Drawing size in SVG units; the picture fills its box (cropped, never stretched). */
  width?: number
  height?: number
  /** Unique per picture on a page (gradient ids). */
  idPrefix: string
  className?: string
}

/**
 * The seed's constellation, filling its box. Both theme variants are server
 * rendered and CSS shows the one for the current theme, so nothing changes
 * after hydration (no layout shift, no flash). Decorative.
 */
export function IdentityArt({ seed, width = 1200, height = 320, idPrefix, className }: IdentityArtProps) {
  const [light, dark] = useMemo(
    () => [identityArt(seed, { width, height, theme: 'light', idPrefix }), identityArt(seed, { width, height, theme: 'dark', idPrefix })],
    [seed, width, height, idPrefix],
  )
  return (
    // className gives the box its size (and position, e.g. "absolute inset-0"); both variants fill it.
    <div aria-hidden="true" className={cx('rn-art overflow-hidden', className)}>
      {/* Trusted: identityArt() emits numbers and fixed markup only; the seed is never echoed. */}
      <div className="h-full w-full dark:hidden" dangerouslySetInnerHTML={{ __html: light }} />
      <div className="hidden h-full w-full dark:block" dangerouslySetInnerHTML={{ __html: dark }} />
    </div>
  )
}
```

Append to the end of `styles/globals.css`:

```css
/* Identity art (lib/identity-art.ts, components/identity/identity-art.tsx). */
.rn-art svg {
    display: block;
    width: 100%;
    height: 100%;
}
@media (prefers-reduced-motion: no-preference) {
    .rn-art .rn-art-twinkle {
        animation: rn-twinkle 4.8s ease-in-out infinite;
    }
    .rn-art .rn-art-twinkle:nth-of-type(2n) {
        animation-delay: -1.6s;
    }
    .rn-art .rn-art-twinkle:nth-of-type(3n) {
        animation-delay: -3.2s;
    }
}
@keyframes rn-twinkle {
    0%,
    100% {
        opacity: 1;
    }
    50% {
        opacity: 0.35;
    }
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `npx playwright test e2e/identity-art.spec.ts --reporter=line`
Expected: PASS (5 tests).

- [ ] **Step 5: Look at it**

Render a grid of seeds to check the art by eye (light and dark, 6 seeds; nodes must never merge, and no olive tones):

```bash
node --input-type=module -e "
import { identityArt } from './lib/identity-art.ts';
import sharp from 'sharp';
const seeds = ['0x2bbea0145d6fb9c6709a74c1179ca0be71bb3ac6', '0x5e00000000000000000000000000000000000001', 'did:key:zDnaed4wPy35wBBJVLZL1XPRQWKpQeeb3JRgMdmHQsLe7KJyi'];
const tiles = [];
for (const [row, seed] of seeds.entries()) for (const [col, theme] of ['dark', 'light'].entries())
  tiles.push({ input: await sharp(Buffer.from(identityArt(seed, { width: 1200, height: 300, theme }))).resize(600, 150).png().toBuffer(), left: col * 610, top: row * 160 });
await sharp({ create: { width: 1210, height: 480, channels: 3, background: '#888' } }).composite(tiles).png().toFile('/tmp/identity-art.png');
"
```

(Node 22.18+ strips the TypeScript types natively; it prints a module-type warning, which is harmless.) Open `/tmp/identity-art.png`.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit -p . && pnpm lint
git add lib/identity-art.ts components/identity/identity-art.tsx styles/globals.css e2e/identity-art.spec.ts
git commit -m "feat(identity): deterministic identity art for profiles and apps"
```

---

### Task 2: Pure building blocks: link services, names, QR codes, JSON-LD

**Files:**
- Create: `utils/link-service.ts`, `lib/profile-identity.ts`, `lib/qr.ts`, `lib/json-ld.ts`
- Modify: `package.json`, `pnpm-lock.yaml` (`uqr` 0.1.2)
- Test: `e2e/link-service.spec.ts`

**Interfaces:**
- Consumes: `RenownProfile` (`services/switchboard`), `RenownAppProfile` (`services/app-profiles`).
- Produces:
  - `type LinkService = 'github' | 'x' | 'linkedin' | 'farcaster' | 'youtube' | 'discord' | 'telegram' | 'website'`; `linkTarget(url: string): { service: LinkService; host: string } | null` (null for anything but http(s)); `SERVICE_NAME: Record<LinkService, string>`
  - `ADDRESS_RE`, `shortAddress(address): string`, `profileDisplayName(profile): string`, `walletDid(address): string` (`did:pkh:eip155:1:<lowercase>`), `memberSince(createdAt): string | null` ("June 2026")
  - `interface QrCode { size: number; path: string }`, `qrCode(text: string): QrCode` (server-only)
  - `profileJsonLd({ profile, name, url, image, did }): object`, `appJsonLd({ app, name, url, image, publisher }): object`

- [ ] **Step 1: Add the QR encoder (server-only)**

Run: `pnpm add -w uqr@0.1.2`
Expected: `package.json` gains `"uqr": "0.1.2"`. It is only ever imported from `getServerSideProps` code (`lib/qr.ts`), which Next strips from the client bundle (verified in Task 6).

- [ ] **Step 2: Write the failing test**

Create `e2e/link-service.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { appJsonLd, profileJsonLd } from '../lib/json-ld'
import { memberSince, profileDisplayName, walletDid } from '../lib/profile-identity'
import { qrCode } from '../lib/qr'
import { linkTarget } from '../utils/link-service'

test('links are recognised by host, unsafe ones are not links at all', () => {
  const table: [string, ReturnType<typeof linkTarget>][] = [
    ['https://github.com/powerhouse-inc', { service: 'github', host: 'github.com' }],
    ['https://gist.github.com/x', { service: 'github', host: 'gist.github.com' }],
    ['https://x.com/PowerhouseDAO', { service: 'x', host: 'x.com' }],
    ['https://twitter.com/a', { service: 'x', host: 'twitter.com' }],
    ['https://www.linkedin.com/in/a', { service: 'linkedin', host: 'linkedin.com' }],
    ['https://farcaster.xyz/a', { service: 'farcaster', host: 'farcaster.xyz' }],
    ['https://warpcast.com/a', { service: 'farcaster', host: 'warpcast.com' }],
    ['https://youtu.be/abc', { service: 'youtube', host: 'youtu.be' }],
    ['https://m.youtube.com/@a', { service: 'youtube', host: 'm.youtube.com' }],
    ['https://discord.gg/abc', { service: 'discord', host: 'discord.gg' }],
    ['https://t.me/a', { service: 'telegram', host: 't.me' }],
    ['http://example.org/blog', { service: 'website', host: 'example.org' }],
    ['https://notgithub.com/a', { service: 'website', host: 'notgithub.com' }],
    ['https://github.com.evil.example/a', { service: 'website', host: 'github.com.evil.example' }],
    ['javascript:alert(1)', null],
    ['mailto:a@b.c', null],
    ['not a url', null],
  ]
  for (const [url, expected] of table) expect(linkTarget(url), url).toEqual(expected)
})

test('profile names fall back from display name to handle, username, short address', () => {
  const base = { documentId: 'doc-1', ethAddress: '0x2bbea0145d6fb9c6709a74c1179ca0be71bb3ac6' }
  expect(profileDisplayName({ ...base, displayName: 'Ada', handle: 'ada', username: 'ada.eth' })).toBe('Ada')
  expect(profileDisplayName({ ...base, displayName: '  ', handle: 'ada', username: 'ada.eth' })).toBe('ada')
  expect(profileDisplayName({ ...base, displayName: null, handle: null, username: 'ada.eth' })).toBe('ada.eth')
  expect(profileDisplayName({ ...base, displayName: null, handle: null, username: '0x2BbE...3aC6' })).toBe('0x2bbe…3ac6')
  expect(profileDisplayName({ documentId: 'doc-1', displayName: null, handle: null, username: null, ethAddress: null })).toBe('doc-1')
  expect(walletDid('0xABC0000000000000000000000000000000000001')).toBe('did:pkh:eip155:1:0xabc0000000000000000000000000000000000001')
  expect(memberSince('2026-06-15T16:49:47.419Z')).toBe('June 2026')
  expect(memberSince('2026-01-01T00:30:00.000Z')).toBe('January 2026')
  expect(memberSince('nope')).toBeNull()
  expect(memberSince(null)).toBeNull()
})

test('QR codes are deterministic single paths with whole-module coordinates', () => {
  const a = qrCode('https://www.renown.id/@frank')
  expect(qrCode('https://www.renown.id/@frank')).toEqual(a)
  expect(qrCode('https://www.renown.id/@ada')).not.toEqual(a)
  expect(a.size).toBe(29) // version 3 at error correction M
  expect(a.path).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/)
  expect(qrCode(`https://www.renown.id/app/did:key:${'z'.repeat(60)}`).size).toBeGreaterThan(a.size)
})

test('JSON-LD carries only safe links and the facts shown on the page', () => {
  const profile = {
    documentId: 'doc-1',
    handle: 'ada',
    bio: ' Builds things ',
    createdAt: '2026-01-01T00:00:00.000Z',
    links: [
      { id: '1', label: 'GitHub', url: 'https://github.com/ada' },
      { id: '2', label: 'Bad', url: 'javascript:alert(1)' },
    ],
  }
  expect(profileJsonLd({ profile, name: 'Ada', url: 'https://r.id/@ada', image: null, did: 'did:pkh:eip155:1:0xa' })).toEqual({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: 'https://r.id/@ada',
    dateCreated: '2026-01-01T00:00:00.000Z',
    mainEntity: {
      '@type': 'Person',
      name: 'Ada',
      url: 'https://r.id/@ada',
      alternateName: '@ada',
      identifier: 'did:pkh:eip155:1:0xa',
      description: 'Builds things',
      sameAs: ['https://github.com/ada'],
    },
  })
  const app = {
    appDid: 'did:key:zApp',
    documentId: 'd',
    name: 'Vault',
    tagline: null,
    logo: null,
    website: 'javascript:alert(1)',
    publisherDid: null,
    description: 'Notes',
    category: 'Data',
    logoRef: null,
    coverRef: null,
    links: [],
  }
  expect(appJsonLd({ app, name: 'Vault', url: 'https://r.id/app/x', image: null, publisher: { name: 'Ada', url: 'https://r.id/@ada' } })).toEqual({
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: 'Vault',
    url: 'https://r.id/app/x',
    identifier: 'did:key:zApp',
    description: 'Notes',
    applicationCategory: 'Data',
    publisher: { '@type': 'Person', name: 'Ada', url: 'https://r.id/@ada' },
  })
})
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx playwright test e2e/link-service.spec.ts --reporter=line`
Expected: FAIL, because `../lib/json-ld` (and the other modules) cannot be resolved.

- [ ] **Step 4: Implement**

Create `utils/link-service.ts`:

```ts
// Which service a profile or app link points to, for its icon. Pure. Only
// http(s) URLs are links at all: anything else is dropped by the callers.

export type LinkService = 'github' | 'x' | 'linkedin' | 'farcaster' | 'youtube' | 'discord' | 'telegram' | 'website'

export interface LinkTarget {
  service: LinkService
  /** Hostname without "www.", e.g. "github.com". */
  host: string
}

/** Hostnames (and their subdomains) per service. */
const HOSTS: [LinkService, string[]][] = [
  ['github', ['github.com']],
  ['x', ['x.com', 'twitter.com']],
  ['linkedin', ['linkedin.com', 'lnkd.in']],
  ['farcaster', ['farcaster.xyz', 'warpcast.com']],
  ['youtube', ['youtube.com', 'youtu.be']],
  ['discord', ['discord.com', 'discord.gg', 'discordapp.com']],
  ['telegram', ['t.me', 'telegram.me', 'telegram.org']],
]

/** The service behind `url`, or null when it is not an http(s) URL (such links are never rendered). */
export function linkTarget(url: string): LinkTarget | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  for (const [service, domains] of HOSTS) {
    if (domains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return { service, host }
  }
  return { service: 'website', host }
}

/** Display name of a service, for accessible labels ("GitHub"). */
export const SERVICE_NAME: Record<LinkService, string> = {
  github: 'GitHub',
  x: 'X',
  linkedin: 'LinkedIn',
  farcaster: 'Farcaster',
  youtube: 'YouTube',
  discord: 'Discord',
  telegram: 'Telegram',
  website: 'Website',
}
```

Create `lib/profile-identity.ts`:

```ts
// How a public profile names and identifies its owner. Pure.
import type { RenownProfile } from '../services/switchboard'

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** Legacy usernames that are only a shortened address ("0x2BbE...3aC6") say nothing a name should. */
function isAddressLike(value: string): boolean {
  return /^0x[0-9a-f]{3,}(\.\.\.|…)[0-9a-f]{3,}$/i.test(value) || ADDRESS_RE.test(value)
}

/**
 * The name a profile is shown under: display name, then handle, then the
 * username (an ENS name or a legacy name, unless it is just an address), then
 * the short address, then the document id.
 */
export function profileDisplayName(profile: Pick<RenownProfile, 'displayName' | 'handle' | 'username' | 'ethAddress' | 'documentId'>): string {
  const username = profile.username?.trim()
  return (
    profile.displayName?.trim() ||
    profile.handle ||
    (username && !isAddressLike(username) ? username : '') ||
    (profile.ethAddress && ADDRESS_RE.test(profile.ethAddress) ? shortAddress(profile.ethAddress) : '') ||
    profile.documentId
  )
}

/** The wallet's Renown DID (did:pkh on Ethereum mainnet, lowercase address). */
export function walletDid(address: string): string {
  return `did:pkh:eip155:1:${address.toLowerCase()}`
}

/** "June 2026" (UTC, same text on server and client); null without a valid date. */
export function memberSince(createdAt: string | null | undefined): string | null {
  if (!createdAt) return null
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}
```

Create `lib/qr.ts`:

```ts
// QR codes for share menus, computed on the server (getServerSideProps): the
// encoder (uqr) never ships to the browser, only the resulting path does.
import { encode } from 'uqr'

export interface QrCode {
  /** Modules per side (no quiet zone). */
  size: number
  /** One SVG path drawing every dark module as a 1x1 square, origin at the top-left module. */
  path: string
}

/** The QR code of `text` (error correction M) as a single SVG path. */
export function qrCode(text: string): QrCode {
  const { size, data } = encode(text, { ecc: 'M', border: 0 })
  let path = ''
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // Runs of dark modules on a row become one rectangle (keeps the path short).
      if (!data[y][x] || (x > 0 && data[y][x - 1])) continue
      let run = 1
      while (x + run < size && data[y][x + run]) run++
      path += `M${x} ${y}h${run}v1h-${run}z`
    }
  }
  return { size, path }
}
```

Create `lib/json-ld.ts`:

```ts
// schema.org JSON-LD for the public profile and app pages. Pure; rendered by
// PageMeta (which escapes "<"). Only public, already-shown facts.
import type { RenownAppProfile } from '../services/app-profiles'
import type { RenownProfile } from '../services/switchboard'
import { linkTarget } from '../utils/link-service'

function safeUrls(links: readonly { url: string }[] | undefined): string[] {
  return (links ?? []).filter((link) => linkTarget(link.url)).map((link) => link.url)
}

export interface ProfileJsonLdInput {
  profile: RenownProfile
  name: string
  /** Absolute canonical URL of the profile page. */
  url: string
  /** Absolute avatar URL (/media), when the profile has an uploaded avatar. */
  image: string | null
  /** did:pkh of the wallet, when there is one. */
  did: string | null
}

/** ProfilePage whose main entity is the Person. */
export function profileJsonLd({ profile, name, url, image, did }: ProfileJsonLdInput): object {
  const sameAs = safeUrls(profile.links)
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url,
    ...(profile.createdAt && { dateCreated: profile.createdAt }),
    ...(profile.updatedAt && { dateModified: profile.updatedAt }),
    mainEntity: {
      '@type': 'Person',
      name,
      url,
      ...(profile.handle && { alternateName: `@${profile.handle}` }),
      ...(did && { identifier: did }),
      ...(profile.bio?.trim() && { description: profile.bio.trim() }),
      ...(image && { image }),
      ...(sameAs.length > 0 && { sameAs }),
    },
  }
}

export interface AppJsonLdInput {
  app: RenownAppProfile
  name: string
  url: string
  image: string | null
  /** The publisher's name and profile URL, when known. */
  publisher: { name: string; url: string } | null
}

/** SoftwareApplication for an app page. */
export function appJsonLd({ app, name, url, image, publisher }: AppJsonLdInput): object {
  const sameAs = safeUrls(app.links)
  const website = app.website && linkTarget(app.website) ? app.website : null
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name,
    url,
    identifier: app.appDid,
    ...((app.tagline || app.description) && { description: app.tagline || app.description }),
    ...(app.category && { applicationCategory: app.category }),
    ...(image && { image }),
    ...(website && { installUrl: website }),
    ...(sameAs.length > 0 && { sameAs }),
    ...(publisher && { publisher: { '@type': 'Person', name: publisher.name, url: publisher.url } }),
  }
}
```

- [ ] **Step 5: Run the test to see it pass**

Run: `npx playwright test e2e/link-service.spec.ts --reporter=line`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit -p . && pnpm lint
git add package.json pnpm-lock.yaml utils/link-service.ts lib/profile-identity.ts lib/qr.ts lib/json-ld.ts e2e/link-service.spec.ts
git commit -m "feat(identity): link services, profile names, server-side QR codes and JSON-LD"
```

---

### Task 3: Shared identity UI and the profile page

**Files:**
- Create: `components/identity/service-icon.tsx`, `link-chip.tsx`, `use-popover.ts`, `verified-badge.tsx`, `share-menu.tsx`, `copy-row.tsx`, `identity-panel.tsx`, `page-section.tsx`, `metric-card.tsx`, `use-viewer-address.ts`
- Create: `components/profile/profile-hero.tsx`, `profile-owner-actions.tsx`, `profile-sections.tsx`, `profile-identity-panel.tsx`
- Modify: `pages/profile/[id].tsx` (whole file), `components/site/page-meta.tsx` (`documentTitle`, `children`), `components/app/markdown-lite.tsx` (`headingBase`)
- Delete: `components/profile/copy-address.tsx`, `components/profile/own-profile-actions.tsx`, `components/profile/profile-stats.tsx`, `components/app/app-profile-card.tsx`
- Test: `e2e/profile-page.spec.ts` (new); `e2e/profile-pages.spec.ts`, `e2e/profile-stats.spec.ts`, `e2e/profile-apps.spec.ts` (intentional markup changes)

**Interfaces:**
- Consumes: Task 1 `IdentityArt`, `identityAccent`; Task 2 `linkTarget`, `profileDisplayName`, `walletDid`, `memberSince`, `shortAddress`, `ADDRESS_RE`, `qrCode`/`QrCode`, `profileJsonLd`; `profileCompleteness(profile): Completeness` (`lib/me/completeness`); `useRenownAuth()` (`.address: string | undefined`); `groupUserStats`, `formatStatValue` (`utils/stat-format`); `AppTile`, `AppLogo`, `MarkdownLite`, `ProfileAvatar`; `withTimeout`, `SSR_DATA_TIMEOUT_MS`; the follow-ups' axe helper `expectNoSeriousA11yViolations`, plus `attachScreenshots`, `layoutShift`, `useTheme` (`e2e/support/site.ts`).
- Produces (used again in Task 4):
  - `<ShareMenu url title qr subject align? />`, `<VerifiedBadge label learnMore={{ href, label }} align?>{two sentences}</VerifiedBadge>`, `usePopover()`
  - `<LinkChips links label? />` (only http(s) links render), `<ServiceIcon service className? />`
  - `<CopyRow label value link? />`, `<IdentityPanel title footer>{rows}</IdentityPanel>` (a region named by its title)
  - `<PageSection id title aside? className?>` (a region named by its h2), `<MetricCard value unit? label meaning? description? metricKey? />` (`data-metric` / `data-value`)
  - `useViewerAddress(): string | null`
  - `PageMeta` props `documentTitle?: string` and `children?: ReactNode`; `MarkdownLite` prop `headingBase?: 2 | 3`

- [ ] **Step 1: Write the failing tests**

Create `e2e/profile-page.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test'
import { attachScreenshots, expectNoSeriousA11yViolations, layoutShift, useTheme } from './support/site'
import { fixtureStub } from './support/stub-switchboard-client'

// The redesigned public profile (/@handle): hero, share, verification, owner
// view, sections and SEO. Fixture ids are unique to this spec.
const RICH = '0x5e00000000000000000000000000000000000f11'
const MINIMAL = '0x5e00000000000000000000000000000000000f12'
const LONG = '0x5e00000000000000000000000000000000000f13'
const APP_DID = 'did:key:z6MkRuthNotesAppxxxxxxxxxxxxxxxxxxxxxxxxxxxx1'
const LONG_WORD = 'W'.repeat(120)
const profile = (handle: string, address: string, extra: Record<string, unknown> = {}) => ({
  documentId: `doc-${handle}`,
  username: null,
  ethAddress: address,
  userImage: null,
  displayName: null,
  handle,
  bio: null,
  links: [],
  avatar: null,
  createdAt: '2026-06-15T16:49:47.419Z',
  updatedAt: '2026-10-09T10:00:00.000Z',
  ...extra,
})
const RICH_PROFILE = profile('rich-ruth', RICH, {
  displayName: 'Ruth Rich',
  bio: 'Builds **tools** for open organisations. Read [my notes](https://notes.example).\n\nSecond paragraph.',
  links: [
    { id: 'l1', label: 'GitHub', url: 'https://github.com/ruth' },
    { id: 'l2', label: 'Blog', url: 'https://ruth.example/blog' },
    { id: 'l3', label: 'Evil', url: 'javascript:alert(1)' },
  ],
})

test.beforeAll(async () => {
  const users = (p: unknown) => ({ data: { renownUsers: [p] } })
  await fixtureStub({ match: 'renownUsers', variables: '"rich-ruth"', response: users(RICH_PROFILE) })
  await fixtureStub({ match: 'renownUsers', variables: '"min-mo"', response: users(profile('min-mo', MINIMAL, { username: '0x5E00...0f12' })) })
  await fixtureStub({
    match: 'renownUsers',
    variables: '"long-lars"',
    response: users(profile('long-lars', LONG, { displayName: LONG_WORD, bio: `${LONG_WORD} ${'word '.repeat(300)}` })),
  })
  await fixtureStub({
    match: 'appProfilesByPublisher(',
    variables: RICH,
    response: {
      data: {
        appProfilesByPublisher: [
          { appDid: APP_DID, documentId: 'doc-pp-app', name: 'Ruth Notes', tagline: 'Notes for Ruth', logo: null, website: null, publisherDid: `did:pkh:eip155:1:${RICH}`, description: null, category: 'Data', logoRef: null, coverRef: null, links: [] },
        ],
      },
    },
  })
  await fixtureStub({
    match: 'userStats(',
    variables: RICH,
    response: {
      data: {
        userStats: [
          { appDid: APP_DID, metric: 'notes', value: 1284, updatedAt: '2026-10-09T00:00:00.000Z', appName: 'Ruth Notes', appDocumentId: 'doc-pp-app', appHasLogo: false, appLogoRef: null, appLogo: null, label: 'Notes written', unit: 'notes' },
        ],
      },
    },
  })
})

async function signedInAs(page: Page, address: string | null) {
  await page.addInitScript((viewer) => {
    if (viewer) (window as { __renownE2eViewer?: string }).__renownE2eViewer = viewer
  }, address)
}

test.describe('profile page', () => {
  test('a rich profile shows identity, facts, about, apps and activity', async ({ page }) => {
    expect((await page.goto('/@rich-ruth'))?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: 'Ruth Rich' })).toBeVisible()
    await expect(page.getByText('@rich-ruth', { exact: true })).toBeVisible()
    const facts = page.getByRole('list', { name: 'About this profile' })
    await expect(facts).toContainText('Member since June 2026')
    await expect(facts).toContainText('1 app published')
    await expect(facts).toContainText('Active in 1 app')
    await expect(page.getByRole('heading', { level: 2, name: 'About' })).toBeVisible()
    await expect(page.locator('strong', { hasText: 'tools' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'my notes' })).toHaveAttribute('href', 'https://notes.example/')
    const links = page.getByRole('list', { name: 'Links' })
    await expect(links.getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/ruth')
    await expect(links.getByRole('link', { name: /GitHub/ })).toContainText('github.com')
    await expect(links.getByRole('link', { name: /Blog/ })).toContainText('ruth.example')
    await expect(page.getByRole('link', { name: /Evil/ })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'Apps published' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Ruth Notes/ }).first()).toHaveAttribute('href', `/app/${APP_DID}`)
    await expect(page.getByRole('heading', { level: 2, name: 'Activity' })).toBeVisible()
    await expect(page.locator(`[data-app-did="${APP_DID}"] [data-metric="notes"]`)).toContainText('1,284')
    await expect(page.getByRole('heading', { name: 'Nothing public yet' })).toHaveCount(0)
  })

  test('a minimal profile names itself by handle and says what will appear, never an empty frame', async ({ page }) => {
    expect((await page.goto('/@min-mo'))?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: 'min-mo' })).toBeVisible()
    await expect(page.getByText('Nothing public yet')).toBeVisible()
    await expect(page.getByRole('list', { name: 'About this profile' })).toHaveText(/Member since June 2026/)
    await expect(page.getByText(/apps? published/)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'About', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Activity' })).toHaveCount(0)
  })

  test('the verified badge explains what is verified and links to /trust', async ({ page }) => {
    await page.goto('/@rich-ruth')
    const badge = page.getByRole('button', { name: 'Verified Renown identity' })
    await expect(badge).toHaveAttribute('aria-expanded', 'false')
    await badge.click()
    await expect(badge).toHaveAttribute('aria-expanded', 'true')
    const panel = page.getByRole('region', { name: 'Verified Renown identity' })
    await expect(panel).toContainText('0x5e00…0f11 controls this identity')
    await expect(panel.getByRole('link', { name: 'How Renown verifies identities' })).toHaveAttribute('href', '/trust')
    await page.keyboard.press('Escape')
    await expect(panel).toHaveCount(0)
    await expect(badge).toBeFocused()
  })

  test('Share copies the canonical link (announced) and shows its QR code', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.goto('/@rich-ruth')
    await page.getByRole('button', { name: 'Share' }).click()
    const menu = page.getByRole('region', { name: 'Share' })
    await expect(menu.getByRole('img', { name: /^QR code for http:\/\/localhost:\d+\/@rich-ruth$/ })).toBeVisible()
    await menu.getByRole('button', { name: 'Copy link' }).click()
    await expect(menu.getByRole('status')).toHaveText('Link copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/@rich-ruth$/)
    await page.mouse.click(5, 5)
    await expect(menu).toHaveCount(0)
  })

  test('the owner sees Edit profile and how complete the profile is; visitors never do', async ({ page }) => {
    await page.goto('/@min-mo')
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Edit profile' })).toHaveCount(0)

    await signedInAs(page, MINIMAL.toUpperCase().replace('0X', '0x'))
    await page.goto('/@min-mo')
    await expect(page.getByRole('main').getByRole('link', { name: 'Edit profile' })).toHaveAttribute('href', '/profile/edit')
    // min-mo has a handle only: 1 of 4 (avatar, bio and a link are missing).
    await expect(page.getByRole('main').getByRole('link', { name: /1 of 4 profile steps done/ })).toHaveAttribute('href', '/profile/edit')

    await signedInAs(page, RICH)
    await page.goto('/@min-mo')
    await expect(page.getByRole('button', { name: 'Share' })).toBeVisible()
    await expect(page.getByRole('main').getByRole('link', { name: 'Edit profile' })).toHaveCount(0)
  })

  test('JSON-LD is valid and describes the person', async ({ request }) => {
    const html = await (await request.get('/@rich-ruth')).text()
    const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>)
    const page = blocks.find((b) => b['@type'] === 'ProfilePage') as { mainEntity: Record<string, unknown>; url: string }
    expect(page.url).toMatch(/\/@rich-ruth$/)
    expect(page.mainEntity).toMatchObject({
      '@type': 'Person',
      name: 'Ruth Rich',
      alternateName: '@rich-ruth',
      identifier: `did:pkh:eip155:1:${RICH}`,
      sameAs: ['https://github.com/ruth', 'https://ruth.example/blog'],
    })
  })

  test('a 120-character name without spaces and a very long bio stay inside the page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 })
    expect((await page.goto('/@long-lars'))?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })

  test('nothing shifts after load, for visitors and owners', async ({ page }) => {
    await page.goto('/@rich-ruth')
    expect(await layoutShift(page)).toBeLessThan(0.01)
    await signedInAs(page, RICH)
    await page.goto('/@rich-ruth')
    await expect(page.getByRole('main').getByRole('link', { name: 'Edit profile' })).toBeVisible()
    expect(await layoutShift(page)).toBeLessThan(0.01)
  })
})

for (const theme of ['light', 'dark'] as const) {
  for (const [label, path] of [
    ['rich', '/@rich-ruth'],
    ['minimal', '/@min-mo'],
  ] as const) {
    test(`a ${label} profile has no serious axe violations (${theme})`, async ({ page }, testInfo) => {
      await useTheme(page, theme)
      await page.goto(path)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoSeriousA11yViolations(page)
      await page.getByRole('button', { name: 'Share' }).click()
      await expectNoSeriousA11yViolations(page)
      await attachScreenshots(page, testInfo, `profile-${label}-${theme}`)
    })
  }
}
```

In `e2e/profile-pages.spec.ts` replace

```ts
    await expect(page.getByRole('button', { name: 'Copy address' })).toContainText(ADDRESS)
```

with

```ts
    const panel = page.getByRole('region', { name: 'Check this identity' })
    await expect(panel).toContainText(ADDRESS)
    await expect(panel).toContainText(`did:pkh:eip155:1:${ADDRESS}`)
    await expect(panel.getByRole('button', { name: 'Copy address' })).toBeVisible()
    await expect(panel.getByRole('link', { name: 'View on Etherscan' })).toHaveAttribute('href', `https://etherscan.io/address/${ADDRESS}`)
    await expect(page).toHaveTitle('Pat Pages (@pat-pages) on Renown')
```

In `e2e/profile-stats.spec.ts` replace each of the three `getByRole('heading', { name: 'Stats', exact: true })` with `getByRole('heading', { name: 'Activity', exact: true })` (the section is now "Activity").

In `e2e/profile-apps.spec.ts`:
- rename the first test to `'a publisher profile lists its apps and counts them'` and replace its `await expect(page.getByText('Publisher', { exact: true })).toBeVisible()` with `await expect(page.getByText('2 apps published')).toBeVisible()`;
- in `'a profile without apps shows neither'` replace `await expect(page.getByText('Publisher', { exact: true })).toHaveCount(0)` with `await expect(page.getByText(/apps? published/)).toHaveCount(0)`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx playwright test e2e/profile-page.spec.ts e2e/profile-pages.spec.ts e2e/profile-stats.spec.ts e2e/profile-apps.spec.ts --workers=3 --reporter=line`
Expected: FAIL. The new spec cannot find "About this profile", "Verified Renown identity", "Share" or "Check this identity". `profile-stats` fails on "Activity", `profile-apps` on "2 apps published", and `profile-pages` on the identity panel.

- [ ] **Step 3: Extend PageMeta and MarkdownLite**

In `components/site/page-meta.tsx`:
- add `import type { ReactNode } from 'react'` after `import Head from 'next/head'`;
- in `PageMetaProps`, after `jsonLd?: object[]`, add

```ts
  /** The whole <title> when it is not "<title> - Renown" (e.g. "Ada (@ada) on Renown"); og/twitter titles still use `title`. */
  documentTitle?: string
  /** Extra head tags (e.g. profile:username). */
  children?: ReactNode
```

- destructure them (`jsonLd = [],` becomes `jsonLd = [],\n  documentTitle,\n  children,`), change the first line of the body to

```ts
  const fullTitle = documentTitle ? documentTitle : title ? `${title} - ${SITE_NAME}` : `${SITE_NAME} - One identity for the Powerhouse network`
```

- and render `{children}` as the last child of `<Head>` (after the JSON-LD map).

In `components/app/markdown-lite.tsx` replace

```tsx
function block(node: Block, i: number): ReactNode {
  switch (node.type) {
    case 'heading': {
      const Tag = node.level === 1 ? 'h2' : node.level === 2 ? 'h3' : 'h4'
```

with

```tsx
function block(node: Block, i: number, headingBase: 2 | 3): ReactNode {
  switch (node.type) {
    case 'heading': {
      const Tag = (['h2', 'h3', 'h4', 'h5'] as const)[headingBase - 2 + node.level - 1]
```

and the exported component with

```tsx
/**
 * A description in the markdown subset, as React elements only (no HTML is ever
 * injected). `headingBase`: the element of a level-1 heading (2 = h2), so the
 * text's headings sit below the section heading that contains it.
 */
export function MarkdownLite({ text, className = '', headingBase = 2 }: { text: string; className?: string; headingBase?: 2 | 3 }) {
  return <div className={`text-foreground/90 space-y-3 break-words ${className}`}>{parseMarkdownLite(text).map((node, i) => block(node, i, headingBase))}</div>
}
```

- [ ] **Step 4: Create the shared identity components**

`components/identity/service-icon.tsx`:

```tsx
import discord from '@iconify-icons/simple-icons/discord'
import github from '@iconify-icons/simple-icons/github'
import linkedin from '@iconify-icons/simple-icons/linkedin'
import telegram from '@iconify-icons/simple-icons/telegram'
import x from '@iconify-icons/simple-icons/x'
import youtube from '@iconify-icons/simple-icons/youtube'
import globe from '@iconify-icons/lucide/globe'
import type { LinkService } from '../../utils/link-service'

// Icon bodies are static SVG markup shipped with the iconify packages (no user data).
const FARCASTER =
  '<path fill="currentColor" d="M4 3h16v3h-1.5v12H20v3h-6.5v-3h1.5v-6a3 3 0 0 0-6 0v6h1.5v3H4v-3h1.5V6H4z"/>'
const BODY: Record<LinkService, string> = {
  github: github.body,
  x: x.body,
  linkedin: linkedin.body,
  farcaster: FARCASTER,
  youtube: youtube.body,
  discord: discord.body,
  telegram: telegram.body,
  website: globe.body,
}

/** A 16 px service glyph in the current text colour; decorative. */
export function ServiceIcon({ service, className = 'h-4 w-4' }: { service: LinkService; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      className={className}
      // Trusted: iconify's bundled icon markup, never user input.
      dangerouslySetInnerHTML={{ __html: BODY[service] }}
    />
  )
}
```

`components/identity/link-chip.tsx`:

```tsx
import type { RenownProfileLink } from '../../services/switchboard'
import { linkTarget } from '../../utils/link-service'
import { ServiceIcon } from './service-icon'

/**
 * Links as chips with the service's icon, the label and the hostname. Links
 * that are not http(s) URLs are dropped (never rendered as links).
 */
export function LinkChips({ links, label = 'Links' }: { links: readonly RenownProfileLink[]; label?: string }) {
  const safe = links.flatMap((link) => {
    const target = linkTarget(link.url)
    return target ? [{ ...link, ...target }] : []
  })
  if (safe.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-2" aria-label={label}>
      {safe.map((link) => (
        <li key={link.id} className="min-w-0 max-w-full">
          <a
            href={link.url}
            target="_blank"
            rel="me noopener noreferrer nofollow"
            className="border-hairline bg-surface-1 text-ink hover:border-primary/50 hover:bg-surface-2 inline-flex max-w-full items-center gap-2 rounded-full border py-1.5 pr-3.5 pl-3 text-sm transition-colors"
          >
            <ServiceIcon service={link.service} className="text-ink-muted h-4 w-4 shrink-0" />
            <span className="truncate font-medium">{link.label || link.host}</span>
            {link.label && <span className="text-ink-muted truncate text-xs">{link.host}</span>}
          </a>
        </li>
      ))}
    </ul>
  )
}
```

`components/identity/use-popover.ts`:

```ts
import { useCallback, useEffect, useId, useRef, useState } from 'react'

/**
 * A button-anchored popover: toggled by its button, closed by Escape (focus
 * returns to the button) or a click/focus outside. Not modal: no focus trap.
 */
export function usePopover() {
  const [open, setOpen] = useState(false)
  const id = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') close(true)
    }
    function onOutside(event: Event) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onOutside)
    document.addEventListener('focusin', onOutside)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onOutside)
      document.removeEventListener('focusin', onOutside)
    }
  }, [open, close])

  return {
    open,
    rootRef,
    buttonProps: {
      ref: buttonRef,
      type: 'button' as const,
      'aria-expanded': open,
      'aria-controls': `${id}-panel`,
      onClick: () => setOpen((value) => !value),
    },
    panelId: `${id}-panel`,
    close,
  }
}
```

`components/identity/verified-badge.tsx`:

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'
import { usePopover } from './use-popover'

export interface VerifiedBadgeProps {
  /** "Verified Renown identity" / "Verified app identity". */
  label: string
  /** Two sentences on what exactly is verified. */
  children: ReactNode
  /** Where to read more ("/trust", "/developers") and the link text. */
  learnMore: { href: string; label: string }
  /** Which side the panel is anchored to (keep it inside the viewport). */
  align?: 'start' | 'end'
}

/** A "verified" pill that discloses what was verified, and how, on click. */
export function VerifiedBadge({ label, children, learnMore, align = 'start' }: VerifiedBadgeProps) {
  const { open, rootRef, buttonProps, panelId } = usePopover()
  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        {...buttonProps}
        className="border-signal/30 bg-signal/10 text-signal hover:bg-signal/15 inline-flex h-7 items-center gap-1.5 rounded-full border pr-2.5 pl-2 text-xs font-semibold transition-colors"
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3 4.5 6v5.5c0 4.6 3.1 8.2 7.5 9.5 4.4-1.3 7.5-4.9 7.5-9.5V6z" />
          <path d="m8.8 12.2 2.2 2.2 4.4-4.6" />
        </svg>
        {label}
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={cx('transition-transform', open && 'rotate-180')}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label={label}
          className={cx(
            // Below 640 px a sheet pinned to the bottom of the screen: anchored to the badge it would overflow.
            'border-hairline-strong bg-background shadow-card rounded-card z-30 border p-4 text-left max-sm:fixed max-sm:inset-x-4 max-sm:bottom-4 sm:absolute sm:top-full sm:mt-2 sm:w-80',
            align === 'end' ? 'sm:right-0' : 'sm:left-0',
          )}
        >
          <div className="text-ink-muted space-y-2 text-sm leading-6">{children}</div>
          <Link href={learnMore.href} className="text-primary-ink mt-3 inline-block text-sm font-semibold hover:underline">
            {learnMore.label}
          </Link>
        </div>
      )}
    </div>
  )
}
```

`components/identity/share-menu.tsx`:

```tsx
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { QrCode } from '../../lib/qr'
import { cx } from '../../utils/cx'
import { buttonClasses } from '../site/primitives'
import { usePopover } from './use-popover'

export interface ShareMenuProps {
  /** Absolute canonical URL to share. */
  url: string
  /** Title passed to the system share sheet. */
  title: string
  /** QR code of `url`, computed on the server (lib/qr.ts); omitted when null. */
  qr: QrCode | null
  /** What the QR code opens, for its caption ("this profile", "this app"). */
  subject: string
  align?: 'start' | 'end'
}

const noSubscribe = () => () => {}

/** "Share": copy the link (announced), a QR code, and the system share sheet where there is one. */
export function ShareMenu({ url, title, qr, subject, align = 'end' }: ShareMenuProps) {
  const { open, rootRef, buttonProps, panelId } = usePopover()
  const [copied, setCopied] = useState(false)
  // The system share sheet exists only in some browsers; false on the server and during hydration.
  const canShare = useSyncExternalStore(noSubscribe, () => typeof navigator.share === 'function', () => false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  async function copy() {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopied(false)
    }
  }

  async function share() {
    try {
      await navigator.share({ title, url })
    } catch {
      // Dismissed by the user, or blocked: nothing to do.
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <button {...buttonProps} className={buttonClasses('secondary', 'md')}>
        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
        Share
      </button>
      {open && (
        <div
          id={panelId}
          role="region"
          aria-label="Share"
          className={cx(
            // Below 640 px a sheet pinned to the bottom of the screen, like the verified badge's.
            'border-hairline-strong bg-background shadow-card rounded-card z-30 border p-4 max-sm:fixed max-sm:inset-x-4 max-sm:bottom-4 sm:absolute sm:top-full sm:mt-2 sm:w-72',
            align === 'end' ? 'sm:right-0' : 'sm:left-0',
          )}
        >
          <p className="text-ink-muted truncate font-mono text-xs" title={url}>
            {url.replace(/^https?:\/\//, '')}
          </p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => void copy()} className={buttonClasses('primary', 'md', 'flex-1')}>
              {copied ? 'Link copied' : 'Copy link'}
            </button>
            {canShare && (
              <button type="button" onClick={() => void share()} className={buttonClasses('secondary', 'md')}>
                More options
              </button>
            )}
          </div>
          <span role="status" aria-live="polite" className="sr-only">
            {copied ? 'Link copied' : ''}
          </span>
          {qr && (
            <figure className="mt-4 flex flex-col items-center gap-2">
              {/* White quiet zone in both themes: scanners need dark modules on light. */}
              <svg
                role="img"
                aria-label={`QR code for ${url}`}
                viewBox={`0 0 ${qr.size + 8} ${qr.size + 8}`}
                shapeRendering="crispEdges"
                className="h-40 w-40 rounded-lg bg-white"
              >
                <path d={qr.path} transform="translate(4 4)" fill="#0B1220" />
              </svg>
              <figcaption className="text-ink-muted text-xs">Scan to open {subject}</figcaption>
            </figure>
          )}
        </div>
      )}
    </div>
  )
}
```

`components/identity/copy-row.tsx`:

```tsx
import { useEffect, useState } from 'react'

export interface CopyRowProps {
  label: string
  value: string
  /** Optional link shown under the value (e.g. a block explorer). */
  link?: { href: string; label: string }
}

/** A labelled value (DID, address) shown in full, with a copy button confirmed in a live region. */
export function CopyRow({ label, value, link }: CopyRowProps) {
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
    <div className="border-hairline border-t py-3 first:border-t-0 first:pt-0">
      <div className="flex items-center justify-between gap-3">
        <p className="text-ink-muted text-xs font-medium">{label}</p>
        <button
          type="button"
          onClick={() => void copy()}
          className="text-primary-ink hover:bg-surface-2 -my-1 shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold transition-colors"
        >
          {copied ? 'Copied' : 'Copy'}
          <span className="sr-only"> {label.toLowerCase()}</span>
        </button>
      </div>
      <p className="text-ink mt-1 font-mono text-[13px] leading-5 break-all">{value}</p>
      {link && (
        <a href={link.href} target="_blank" rel="noopener noreferrer" className="text-primary-ink mt-1.5 inline-block text-xs font-semibold hover:underline">
          {link.label}
        </a>
      )}
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ''}
      </span>
    </div>
  )
}
```

`components/identity/identity-panel.tsx`:

```tsx
import type { ReactNode } from 'react'

/** "Check this identity": the raw identifiers with copy buttons and how to verify them. */
export function IdentityPanel({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  const id = `panel-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <section aria-labelledby={id} className="border-hairline bg-surface-1 rounded-card border p-5">
      <h2 id={id} className="text-ink text-base font-semibold">
        {title}
      </h2>
      <div className="mt-4">{children}</div>
      <div className="text-ink-muted border-hairline mt-1 border-t pt-3 text-xs leading-5">{footer}</div>
    </section>
  )
}
```

`components/identity/page-section.tsx`:

```tsx
import type { ReactNode } from 'react'
import { cx } from '../../utils/cx'

/** A titled block of a profile or app page (h2 + content), with the pages' shared rhythm. */
export function PageSection({ id, title, aside, children, className }: { id: string; title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cx('min-w-0', className)}>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={id} className="text-ink text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}
```

`components/identity/metric-card.tsx`:

```tsx
import { formatStatValue } from '../../utils/stat-format'

export interface MetricCardProps {
  value: number
  unit?: string | null
  /** What was counted, in the app's own words ("Notes written"). */
  label: string
  /** What the number means ("Total across all users"); omitted on profiles. */
  meaning?: string | null
  /** The publisher's description of the metric. */
  description?: string | null
  /** Exposed as data-metric for tests and analytics. */
  metricKey?: string
}

/** One number with its unit and label, and optionally what it means. */
export function MetricCard({ value, unit, label, meaning, description, metricKey }: MetricCardProps) {
  return (
    <div className="border-hairline bg-surface-1 rounded-card min-w-0 border p-4" data-metric={metricKey} data-value={String(value)}>
      <p className="text-ink flex min-w-0 items-baseline gap-1.5">
        <span className="text-[1.75rem] leading-none font-semibold tracking-tight tabular-nums">{formatStatValue(value)}</span>
        {unit && <span className="text-ink-muted truncate text-sm">{unit}</span>}
      </p>
      <p className="text-ink mt-2 text-sm font-medium [overflow-wrap:anywhere]">{label}</p>
      {meaning && <p className="text-ink-muted mt-0.5 text-xs">{meaning}</p>}
      {description && <p className="text-ink-muted mt-2 text-xs leading-5 [overflow-wrap:anywhere]">{description}</p>}
    </div>
  )
}
```

`components/identity/use-viewer-address.ts`:

```ts
import { useRenownAuth } from '@powerhousedao/reactor-browser/renown'
import { useSyncExternalStore } from 'react'

// Playwright runs the dev server with NEXT_PUBLIC_E2E_AUTH=1: a test can then
// stand in for the Renown session on public pages by setting
// window.__renownE2eViewer to a wallet address. Inert in every other build.
const E2E_AUTH = process.env.NEXT_PUBLIC_E2E_AUTH === '1'
const noSubscribe = () => () => {}
const e2eViewer = () => (E2E_AUTH ? ((window as { __renownE2eViewer?: string }).__renownE2eViewer ?? null) : null)

/**
 * The signed-in visitor's wallet address (lowercase) from the Renown session,
 * or null. Null on the server and during hydration (the Renown session is
 * restored in the browser), so owner-only UI appears after mount and never
 * mismatches the server markup.
 */
export function useViewerAddress(): string | null {
  const { address } = useRenownAuth()
  const testViewer = useSyncExternalStore(noSubscribe, e2eViewer, () => null)
  const viewer = address ?? testViewer
  return viewer ? viewer.toLowerCase() : null
}
```

- [ ] **Step 5: Create the profile components**

`components/profile/profile-owner-actions.tsx`:

```tsx
import Link from 'next/link'
import type { Completeness } from '../../lib/me/completeness'
import { ButtonLink } from '../site/primitives'
import { useViewerAddress } from '../identity/use-viewer-address'

/**
 * "Edit profile" and, while the profile is incomplete, how far along it is:
 * only for the signed-in owner (client-side, after hydration), never for anyone else.
 */
export function ProfileOwnerActions({ address, completeness }: { address: string; completeness: Completeness }) {
  const viewer = useViewerAddress()
  if (!viewer || viewer !== address.toLowerCase()) return null
  const open = completeness.items.filter((item) => !item.done)
  return (
    <>
      <ButtonLink href="/profile/edit" variant="secondary">
        Edit profile
      </ButtonLink>
      {open.length > 0 && (
        <Link
          href="/profile/edit"
          title={`To do: ${open.map((item) => item.label.toLowerCase()).join(', ')}`}
          className="text-ink-muted hover:text-ink hover:bg-surface-2 inline-flex h-10 items-center gap-2 rounded-full px-3 text-sm font-medium transition-colors"
        >
          <Ring percent={completeness.percent} />
          <span>
            {completeness.done} of {completeness.total}
            <span className="sr-only"> profile steps done, finish your profile</span>
          </span>
        </Link>
      )}
    </>
  )
}

function Ring({ percent }: { percent: number }) {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" className="-rotate-90">
      <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" style={{ stroke: 'var(--hairline-strong)' }} />
      <circle cx="10" cy="10" r="8" fill="none" strokeWidth="2.5" strokeLinecap="round" pathLength={100} strokeDasharray={`${percent} 100`} style={{ stroke: 'var(--signal)' }} />
    </svg>
  )
}
```

`components/profile/profile-hero.tsx`:

```tsx
import type { ReactNode } from 'react'
import type { Completeness } from '../../lib/me/completeness'
import { identityAccent } from '../../lib/identity-art'
import { shortAddress } from '../../lib/profile-identity'
import type { QrCode } from '../../lib/qr'
import type { RenownProfile } from '../../services/switchboard'
import { Badge } from '../site/primitives'
import { IdentityArt } from '../identity/identity-art'
import { ShareMenu } from '../identity/share-menu'
import { VerifiedBadge } from '../identity/verified-badge'
import { ProfileAvatar } from './profile-avatar'
import { ProfileOwnerActions } from './profile-owner-actions'

export interface ProfileFact {
  key: string
  icon: 'calendar' | 'apps' | 'activity'
  text: string
}

export interface ProfileHeroProps {
  profile: RenownProfile
  name: string
  /** Lowercase wallet address; null for a profile without one (then no art seed but the document id). */
  address: string | null
  /** The ENS name to show next to the handle (resolves to the address and differs from the name). */
  ensName: string | null
  facts: ProfileFact[]
  completeness: Completeness
  shareUrl: string
  qr: QrCode | null
}

const FACT_ICON: Record<ProfileFact['icon'], ReactNode> = {
  calendar: <path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" />,
  apps: <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
}

/** The top of a public profile: identity art, avatar, name, handle, verification, facts and actions. */
export function ProfileHero({ profile, name, address, ensName, facts, completeness, shareUrl, qr }: ProfileHeroProps) {
  const seed = address ?? profile.documentId
  return (
    <header>
      <IdentityArt
        seed={seed}
        idPrefix="profile"
        className="border-hairline rounded-panel h-[168px] border sm:h-[232px] lg:h-[272px]"
      />
      <div className="px-1 sm:px-8">
        <div className="-mt-14 flex items-end justify-between gap-4 sm:-mt-[68px]">
          <div className="bg-background relative shrink-0 rounded-full p-1" style={{ boxShadow: `0 0 0 2px ${identityAccent(seed)}` }}>
            <ProfileAvatar
              documentId={profile.documentId}
              avatar={profile.avatar}
              userImage={profile.userImage}
              seed={seed}
              alt={name}
              className="h-[104px] w-[104px] sm:h-[128px] sm:w-[128px]"
            />
          </div>
        </div>
        <div className="mt-4 min-w-0">
          <h1 className="text-ink text-h1 text-balance [overflow-wrap:anywhere]">{name}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            {profile.handle && <p className="text-primary-ink text-lg font-medium [overflow-wrap:anywhere]">@{profile.handle}</p>}
            {ensName && (
              <Badge tone="neutral" className="max-w-full">
                <span className="truncate">{ensName}</span>
              </Badge>
            )}
            {address && (
              <VerifiedBadge label="Verified Renown identity" learnMore={{ href: '/trust', label: 'How Renown verifies identities' }}>
                <p>
                  The wallet {shortAddress(address)} controls this identity. Only that wallet, or an app it has approved, can change
                  this profile, and every change is signed.
                </p>
              </VerifiedBadge>
            )}
          </div>
          {facts.length > 0 && (
            <ul className="text-ink-muted mt-5 flex flex-wrap gap-x-6 gap-y-2 text-sm" aria-label="About this profile">
              {facts.map((fact) => (
                <li key={fact.key} className="inline-flex items-center gap-2">
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    {FACT_ICON[fact.icon]}
                  </svg>
                  {fact.text}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <ShareMenu url={shareUrl} title={`${name} on Renown`} qr={qr} subject="this profile" align="start" />
            {address && <ProfileOwnerActions address={address} completeness={completeness} />}
          </div>
        </div>
      </div>
    </header>
  )
}
```

`components/profile/profile-sections.tsx`:

```tsx
import Link from 'next/link'
import type { RenownAppProfile } from '../../services/app-profiles'
import type { RenownProfileLink } from '../../services/switchboard'
import type { AppStatGroup } from '../../utils/stat-format'
import { AppLogo } from '../app/app-logo'
import { AppTile } from '../app/app-tile'
import { MarkdownLite } from '../app/markdown-lite'
import { LinkChips } from '../identity/link-chip'
import { MetricCard } from '../identity/metric-card'
import { PageSection } from '../identity/page-section'

/** Bio (markdown subset, safe links only) and links; nothing when there is neither. */
export function ProfileAbout({ bio, links }: { bio: string | null; links: RenownProfileLink[] }) {
  const text = bio?.trim()
  if (!text && links.length === 0) return null
  return (
    <PageSection id="profile-about" title="About">
      {text && <MarkdownLite text={text} headingBase={3} className="max-w-[68ch] text-[1.0625rem] leading-7" />}
      {links.length > 0 && (
        <div className={text ? 'mt-5' : undefined}>
          <LinkChips links={links} />
        </div>
      )}
    </PageSection>
  )
}

/** The apps this wallet publishes, as directory tiles. */
export function ProfileApps({ apps }: { apps: RenownAppProfile[] }) {
  if (apps.length === 0) return null
  return (
    <PageSection id="apps-published" title="Apps published">
      <ul className="grid gap-5 sm:grid-cols-2">
        {apps.map((app) => (
          <li key={app.appDid}>
            <AppTile app={app} />
          </li>
        ))}
      </ul>
    </PageSection>
  )
}

/** Public stats across apps, one group per app in the app's own words. */
export function ProfileActivity({ groups }: { groups: AppStatGroup[] }) {
  if (groups.length === 0) return null
  return (
    <PageSection id="profile-activity" title="Activity">
      <div className="space-y-6">
        {groups.map((group) => (
          <div key={group.appDid} data-app-did={group.appDid}>
            <Link href={`/app/${group.appDid}`} className="group inline-flex max-w-full min-w-0 items-center gap-3">
              <AppLogo
                documentId={group.appDocumentId}
                logoRef={group.appHasLogo ? group.appLogoRef : null}
                legacyLogo={group.appLogo}
                name={group.appName}
                className="h-8 w-8 rounded-[10px] text-sm shadow-none"
              />
              <span className="text-ink truncate font-semibold group-hover:underline">{group.appName}</span>
            </Link>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {group.entries.map((entry) => (
                <MetricCard key={entry.metric} metricKey={entry.metric} value={entry.value} unit={entry.unit} label={entry.label ?? entry.metric} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </PageSection>
  )
}

/** Shown instead of an empty column when a profile has no bio, links, apps or activity yet. */
export function ProfileEmpty({ name }: { name: string }) {
  return (
    <div className="border-hairline rounded-card border border-dashed px-6 py-10 text-center">
      <p className="text-ink font-semibold">Nothing public yet</p>
      <p className="text-ink-muted mx-auto mt-2 max-w-[44ch] text-sm leading-6">
        A bio, links, published apps and activity appear here once {name} adds them or starts using apps on Renown.
      </p>
    </div>
  )
}
```

`components/profile/profile-identity-panel.tsx`:

```tsx
import Link from 'next/link'
import { walletDid } from '../../lib/profile-identity'
import { CopyRow } from '../identity/copy-row'
import { IdentityPanel } from '../identity/identity-panel'

/** "Check this identity": DID, address (with Etherscan) and the profile document id. */
export function ProfileIdentityPanel({ address, documentId }: { address: string | null; documentId: string }) {
  return (
    <IdentityPanel
      title="Check this identity"
      footer={
        <>
          Every change to this profile is a signed operation, so anyone can check who made it.{' '}
          <Link href="/trust" className="text-primary-ink font-semibold hover:underline">
            How verification works
          </Link>
        </>
      }
    >
      {address && (
        <>
          <CopyRow label="DID" value={walletDid(address)} />
          <CopyRow label="Address" value={address} link={{ href: `https://etherscan.io/address/${address}`, label: 'View on Etherscan' }} />
        </>
      )}
      <p className="text-ink-muted border-hairline border-t py-3 text-xs first:border-t-0 first:pt-0">
        Profile document <span className="font-mono break-all">{documentId}</span>
      </p>
    </IdentityPanel>
  )
}
```

- [ ] **Step 6: Rewrite the page**

Replace `pages/profile/[id].tsx`:

```tsx
import type { GetServerSideProps, NextPage } from 'next'
import { ProfileHero, type ProfileFact } from '../../components/profile/profile-hero'
import { ProfileIdentityPanel } from '../../components/profile/profile-identity-panel'
import { ProfileAbout, ProfileActivity, ProfileApps, ProfileEmpty } from '../../components/profile/profile-sections'
import { PageMeta } from '../../components/site/page-meta'
import { Container } from '../../components/site/primitives'
import { SiteLayout } from '../../components/site/site-layout'
import { NotFoundPage } from '../../components/ui/not-found-page'
import { profileJsonLd } from '../../lib/json-ld'
import { profileCompleteness } from '../../lib/me/completeness'
import { ADDRESS_RE, memberSince, profileDisplayName, walletDid } from '../../lib/profile-identity'
import { qrCode, type QrCode } from '../../lib/qr'
import { getAppProfilesByPublisher, type RenownAppProfile } from '../../services/app-profiles'
import { getUserStats, type UserStatEntry } from '../../services/app-stats'
import { mediaUrl } from '../../services/media'
import { fetchProfile, type RenownProfile } from '../../services/switchboard'
import { DEFAULT_DRIVE_ID } from '../../utils/constants'
import { isEnsVerified } from '../../utils/ens'
import { profilePath } from '../../utils/profile-url'
import { ogImageUrl } from '../../utils/seo'
import { siteOrigin } from '../../utils/site-origin'
import { groupUserStats } from '../../utils/stat-format'
import { SSR_DATA_TIMEOUT_MS, withTimeout } from '../../utils/with-timeout'

interface ProfilePageProps {
  profile: RenownProfile | null
  ensVerified: boolean
  apps: RenownAppProfile[]
  stats: UserStatEntry[]
  /** Absolute canonical URL of this profile. */
  canonicalUrl: string | null
  /** Absolute link-preview image (the generated /api/og profile card). */
  ogImage: string | null
  /** QR code of canonicalUrl for the share menu (computed here, on the server). */
  qr: QrCode | null
  error?: string
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

const ProfilePage: NextPage<ProfilePageProps> = ({ profile, ensVerified, apps, stats, canonicalUrl, ogImage, qr, error }) => {
  if (error) return <NotFoundPage title="Something went wrong" message={error} />
  if (!profile) {
    return <NotFoundPage title="Profile not found" message="No Renown profile has this name or address. Check the link, or browse apps to find people who publish them." />
  }

  const address = profile.ethAddress && ADDRESS_RE.test(profile.ethAddress) ? profile.ethAddress.toLowerCase() : null
  const name = profileDisplayName(profile)
  const ogTitle = profile.handle ? `${name} (@${profile.handle})` : name
  const description = profile.bio?.trim() || `${name} on Renown, the identity layer of the Powerhouse network.`
  const ensName = ensVerified && profile.username && profile.username !== name ? profile.username : null
  const groups = groupUserStats(stats)
  const since = memberSince(profile.createdAt)
  const facts: ProfileFact[] = [
    ...(since ? [{ key: 'since', icon: 'calendar' as const, text: `Member since ${since}` }] : []),
    ...(apps.length > 0 ? [{ key: 'apps', icon: 'apps' as const, text: `${plural(apps.length, 'app', 'apps')} published` }] : []),
    ...(groups.length > 0 ? [{ key: 'active', icon: 'activity' as const, text: `Active in ${plural(groups.length, 'app', 'apps')}` }] : []),
  ]
  const links = profile.links ?? []
  const hasContent = Boolean(profile.bio?.trim()) || links.length > 0 || apps.length > 0 || groups.length > 0
  const path = profilePath(profile)
  const url = canonicalUrl ?? path
  const image = profile.avatar && canonicalUrl ? mediaUrl(profile.documentId, 'avatar', new URL(canonicalUrl).origin, profile.avatar) : null

  return (
    <SiteLayout>
      <PageMeta
        title={ogTitle}
        documentTitle={`${ogTitle} on Renown`}
        description={description}
        path={path}
        ogType="profile"
        {...(ogImage && { image: ogImage })}
        jsonLd={[profileJsonLd({ profile, name, url, image, did: address ? walletDid(address) : null })]}
      >
        {profile.handle && <meta property="profile:username" content={profile.handle} key="profile:username" />}
      </PageMeta>

      <Container className="max-w-[1120px] pt-6 pb-20 md:pt-10">
        <ProfileHero
          profile={profile}
          name={name}
          address={address}
          ensName={ensName}
          facts={facts}
          completeness={profileCompleteness(profile)}
          shareUrl={url}
          qr={qr}
        />
        <div className="mt-12 grid gap-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14">
          <div className="min-w-0 space-y-12">
            {hasContent ? (
              <>
                <ProfileAbout bio={profile.bio ?? null} links={links} />
                <ProfileApps apps={apps} />
                <ProfileActivity groups={groups} />
              </>
            ) : (
              <ProfileEmpty name={name} />
            )}
          </div>
          <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
            <ProfileIdentityPanel address={address} documentId={profile.documentId} />
          </aside>
        </div>
      </Container>
    </SiteLayout>
  )
}

/** A secondary read: bounded by the SSR budget; a failure or timeout drops its section. */
function optional<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return withTimeout(promise, SSR_DATA_TIMEOUT_MS).catch(() => fallback)
}

export const getServerSideProps: GetServerSideProps<ProfilePageProps> = async (context) => {
  const id = String(context.params?.id ?? '')
  const byHandle = context.query.by === 'handle'
  const empty = { profile: null, ensVerified: false, apps: [], stats: [], canonicalUrl: null, ogImage: null, qr: null }
  if (!id) return { props: { ...empty, error: 'No profile identifier provided' } }

  let profile: RenownProfile | null
  try {
    if (byHandle) {
      profile = await fetchProfile({ driveId: DEFAULT_DRIVE_ID, handle: id.toLowerCase() })
    } else if (ADDRESS_RE.test(id)) {
      profile = await fetchProfile({ driveId: `renown-${id.toLowerCase()}`, ethAddress: id.toLowerCase() })
    } else {
      profile =
        (await fetchProfile({ driveId: DEFAULT_DRIVE_ID, id })) ??
        (await fetchProfile({ driveId: DEFAULT_DRIVE_ID, username: id }))
    }
  } catch (error) {
    // An outage is not "no such profile": a 404 would make crawlers drop valid profiles.
    console.error('Failed to fetch profile from switchboard:', error)
    context.res.statusCode = 503
    context.res.setHeader('Cache-Control', 'no-store')
    context.res.setHeader('Retry-After', '30')
    return { props: { ...empty, error: 'Profiles are temporarily unavailable. Please try again in a moment.' } }
  }
  if (!profile) {
    context.res.statusCode = 404
    return { props: empty }
  }

  // One canonical URL per profile: /@handle once a handle exists.
  if (profile.handle && !(byHandle && id === profile.handle)) {
    return { redirect: { destination: `/@${profile.handle}`, permanent: false } }
  }

  const origin = siteOrigin(context.req.headers.host)
  const address = profile.ethAddress ?? ''
  const wallet = ADDRESS_RE.test(address)
  const ogImage = wallet ? ogImageUrl({ variant: 'profile', address }, origin) : ogImageUrl({ variant: 'default' }, origin)
  context.res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  // Secondary sections: each drops out on failure or timeout; the profile always renders.
  const [ensVerified, apps, stats] = await Promise.all([
    isEnsVerified(profile.username, profile.ethAddress),
    wallet ? optional(getAppProfilesByPublisher(address.toLowerCase()), []) : Promise.resolve([]),
    wallet ? optional(getUserStats(address), []) : Promise.resolve([]),
  ])
  const canonicalUrl = `${origin}${profilePath(profile)}`
  return {
    props: { profile, ensVerified, apps, stats, canonicalUrl, ogImage, qr: qrCode(canonicalUrl) },
  }
}

export default ProfilePage
```

Delete the glass-card pieces it no longer uses:

```bash
git rm components/profile/copy-address.tsx components/profile/own-profile-actions.tsx components/profile/profile-stats.tsx components/app/app-profile-card.tsx
```

- [ ] **Step 7: Run the profile specs**

Run: `npx playwright test e2e/profile-page.spec.ts e2e/profile-pages.spec.ts e2e/profile-stats.spec.ts e2e/profile-apps.spec.ts e2e/markdown-lite.spec.ts --workers=3 --reporter=line`
Expected: PASS. The axe tests open the share menu before checking, and `attachScreenshots` asserts no horizontal scroll at 390 and 1280. Look at the attached screenshots (`npx playwright show-report`): rich and minimal, light and dark.

- [ ] **Step 8: Commit**

```bash
npx tsc --noEmit -p . && pnpm lint
git add components/identity components/profile pages/profile/[id].tsx components/site/page-meta.tsx components/app/markdown-lite.tsx e2e/profile-page.spec.ts e2e/profile-pages.spec.ts e2e/profile-stats.spec.ts e2e/profile-apps.spec.ts
git commit -m "feat(profile): identity-art hero, verification, sharing, owner view and activity on public profiles"
```

---

### Task 4: The app page

**Files:**
- Create: `components/app-page/app-hero-cover.tsx`, `app-hero.tsx`, `app-stats.tsx`, `app-publisher.tsx`, `app-identity-panel.tsx`
- Modify: `pages/app/[did].tsx` (whole file), `utils/stat-format.ts` (drop `AGGREGATION_CAPTION`)
- Delete: `components/app/app-stats.tsx`
- Test: `e2e/app-page.spec.ts` (new); `e2e/app-pages.spec.ts`, `e2e/profile-apps.spec.ts` (intentional markup changes)

**Interfaces:**
- Consumes: Task 1 `IdentityArt`, `identityAccent`; Task 2 `linkTarget`, `profileDisplayName`, `shortAddress`, `qrCode`, `appJsonLd`; Task 3 `ShareMenu`, `VerifiedBadge`, `LinkChips`, `CopyRow`, `IdentityPanel`, `PageSection`, `MetricCard`, `PageMeta` (`documentTitle`), `MarkdownLite` (`headingBase`); `listAppProfiles({ limit, category })`, `getAppProfilesByPublisher(address)`, `getAppStats(did)`, `getProfile(...)`, `AppTile`, `AppLogo`, `ProfileAvatar`, `ButtonLink`.
- Produces: `AGGREGATION_MEANING: Record<MetricAggregation, string>`, `hasNoActivity(stats: AppStats): boolean`, `publisherName(publisher, address): string`, `<AppHeroCover documentId coverRef appDid className? />`.

- [ ] **Step 1: Write the failing tests**

Create `e2e/app-page.spec.ts` (the DIDs must match `APP_DID_RE`, a base58 alphabet with no `0`, `O`, `I` or `l`):

```ts
import { test, expect } from '@playwright/test'
import { attachScreenshots, expectNoSeriousA11yViolations, layoutShift, useTheme } from './support/site'
import { fixtureStub } from './support/stub-switchboard-client'

// The redesigned app page (/app/[did]): cover or identity art, verification,
// stats zero state, publisher, more apps, SEO. Fixture ids are unique to this spec.
const PUBLISHER = '0x5e00000000000000000000000000000000000f21'
const COVERED = 'did:key:z6MkAppPageCoveredxxxxxxxxxxxxxxxxxxxxxxxxxxx1'
const PLAIN = 'did:key:z6MkAppPageBareAppxxxxxxxxxxxxxxxxxxxxxxxxxxx1'
const SIBLING = 'did:key:z6MkAppPageSisterAppxxxxxxxxxxxxxxxxxxxxxxxxx1'
const NEIGHBOUR = 'did:key:z6MkAppPageNeighbourxxxxxxxxxxxxxxxxxxxxxxxxx1'
const LONELY = 'did:key:z6MkAppPageSoAppxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1'
const app = (appDid: string, name: string, extra: Record<string, unknown> = {}) => ({
  appDid,
  documentId: `doc-ap-${name.replace(/\W/g, '')}`,
  name,
  tagline: `${name} tagline`,
  logo: null,
  website: null,
  publisherDid: `did:pkh:eip155:1:${PUBLISHER}`,
  description: null,
  category: 'Ledgers',
  logoRef: null,
  coverRef: null,
  links: [],
  ...extra,
})
const COVERED_APP = app(COVERED, 'Covered Ledger', {
  // stub-app-doc has a logo and a cover on the stub's /media route.
  documentId: 'stub-app-doc',
  logoRef: `attachment://v1:${'1'.repeat(64)}`,
  coverRef: `attachment://v1:${'2'.repeat(64)}`,
  website: 'https://ledger.example',
  links: [{ id: 'd', label: 'Discord', url: 'https://discord.gg/ledger' }],
})
const PLAIN_APP = app(PLAIN, 'Plain Ledger', { description: 'Plain words.' })

test.beforeAll(async () => {
  await fixtureStub({ match: 'appProfile(', variables: COVERED, response: { data: { appProfile: COVERED_APP } } })
  await fixtureStub({ match: 'appProfile(', variables: PLAIN, response: { data: { appProfile: PLAIN_APP } } })
  await fixtureStub({ match: 'appProfile(', variables: LONELY, response: { data: { appProfile: app(LONELY, 'Lonely', { publisherDid: null, category: null }) } } })
  await fixtureStub({
    match: 'renownUsers',
    variables: PUBLISHER,
    response: { data: { renownUsers: [{ documentId: 'doc-ap-pub', username: null, ethAddress: PUBLISHER, userImage: null, displayName: 'Pia Publisher', handle: 'pia-pub', bio: null, links: [], avatar: null, createdAt: null, updatedAt: null }] } },
  })
  await fixtureStub({
    match: 'appProfilesByPublisher(',
    variables: PUBLISHER,
    response: { data: { appProfilesByPublisher: [COVERED_APP, PLAIN_APP, app(SIBLING, 'Sibling Sheet', { category: 'Sheets' })] } },
  })
  await fixtureStub({
    match: 'appProfiles(',
    variables: '"Ledgers"',
    response: { data: { appProfiles: { items: [COVERED_APP, PLAIN_APP, app(NEIGHBOUR, 'Neighbour Books', { publisherDid: null })], next: null } } },
  })
  await fixtureStub({
    match: 'appStats(',
    variables: PLAIN,
    response: { data: { appStats: { appDid: PLAIN, activeUsers30d: 0, totalUsers: 0, updatedAt: null, metrics: [{ key: 'entries', label: 'Entries booked', unit: null, description: null, aggregation: 'SUM', value: 0, users: 0, top: [] }] } } },
  })
  await fixtureStub({ match: 'appStats(', variables: COVERED, status: 500, response: { errors: [{ message: 'boom' }] } })
})

test.describe('app page', () => {
  test('an app with a cover shows it over its identity art, with Open app and the category link', async ({ page }) => {
    expect((await page.goto(`/app/${COVERED}`))?.status()).toBe(200)
    const header = page.locator('main header')
    await expect(header.locator('img[src="/media/stub-app-doc/cover?v=222222222222"]')).toHaveCount(1)
    await expect(header.locator('.rn-art svg')).toHaveCount(2)
    await expect(page.getByRole('heading', { level: 1, name: 'Covered Ledger' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open app' })).toHaveAttribute('href', 'https://ledger.example')
    await expect(page.getByRole('main').getByRole('link', { name: 'Ledgers', exact: true })).toHaveAttribute('href', '/apps?category=Ledgers')
    await expect(page.getByRole('list', { name: 'Links' }).getByRole('link', { name: /Discord/ })).toContainText('discord.gg')
    // A failed stats read drops the section; the page stays.
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toHaveCount(0)
  })

  test('an app without a cover shows its identity art, and a zero-stats app says no activity yet', async ({ page }) => {
    expect((await page.goto(`/app/${PLAIN}`))?.status()).toBe(200)
    const header = page.locator('main header')
    await expect(header.locator('img')).toHaveCount(0)
    await expect(header.locator('.rn-art svg')).toHaveCount(2)
    await expect(page.getByRole('link', { name: 'Open app' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Stats', exact: true })).toBeVisible()
    await expect(page.getByText('No activity reported yet')).toBeVisible()
    await expect(page.getByText(/starting with entries booked/)).toBeVisible()
    await expect(page.locator('[data-metric="entries"]')).toHaveCount(0)
  })

  test('publisher, more apps by the publisher and more in the category', async ({ page }) => {
    await page.goto(`/app/${PLAIN}`)
    const publisher = page.getByRole('region', { name: 'Publisher', exact: true })
    await expect(publisher.getByRole('link', { name: /Pia Publisher/ })).toHaveAttribute('href', '/@pia-pub')
    await expect(publisher).toContainText('@pia-pub')
    const more = page.getByRole('region', { name: 'More apps by Pia Publisher' })
    await expect(more.getByRole('link')).toHaveCount(2)
    await expect(more.getByRole('link', { name: /Covered Ledger/ })).toHaveAttribute('href', `/app/${COVERED}`)
    await expect(more.getByRole('link', { name: /Sibling Sheet/ })).toHaveAttribute('href', `/app/${SIBLING}`)
    const category = page.getByRole('region', { name: 'More in Ledgers' })
    await expect(category.getByRole('link')).toHaveCount(2)
    await expect(category.getByRole('link', { name: /Neighbour Books/ })).toHaveAttribute('href', `/app/${NEIGHBOUR}`)
    await expect(category.getByRole('link', { name: /Plain Ledger/ })).toHaveCount(0)
  })

  test('an app without publisher or category shows neither section', async ({ page }) => {
    expect((await page.goto(`/app/${LONELY}`))?.status()).toBe(200)
    await expect(page.getByRole('region', { name: 'Publisher', exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: /^More / })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Check this app' })).toContainText(LONELY)
  })

  test('the verified badge explains the app identity and links to /developers', async ({ page }) => {
    await page.goto(`/app/${PLAIN}`)
    await page.getByRole('button', { name: 'Verified app identity' }).click()
    const panel = page.getByRole('region', { name: 'Verified app identity' })
    await expect(panel).toContainText('only the app holding it can act for you')
    await expect(panel.getByRole('link', { name: 'How apps prove who they are' })).toHaveAttribute('href', '/developers')
  })

  test('JSON-LD describes the software application and its publisher', async ({ request }) => {
    const html = await (await request.get(`/app/${COVERED}`)).text()
    const blocks = [...html.matchAll(/<script type="application\/ld\+json"[^>]*>(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]) as Record<string, unknown>)
    expect(blocks.find((b) => b['@type'] === 'SoftwareApplication')).toMatchObject({
      name: 'Covered Ledger',
      identifier: COVERED,
      applicationCategory: 'Ledgers',
      installUrl: 'https://ledger.example',
      sameAs: ['https://discord.gg/ledger'],
      publisher: { '@type': 'Person', name: 'Pia Publisher' },
    })
  })

  test('nothing shifts after load', async ({ page }) => {
    await page.goto(`/app/${COVERED}`)
    expect(await layoutShift(page)).toBeLessThan(0.01)
  })
})

for (const theme of ['light', 'dark'] as const) {
  for (const [label, did] of [
    ['with cover', COVERED],
    ['without cover', PLAIN],
  ] as const) {
    test(`an app ${label} has no serious axe violations (${theme})`, async ({ page }, testInfo) => {
      await useTheme(page, theme)
      await page.goto(`/app/${did}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expectNoSeriousA11yViolations(page)
      await page.getByRole('button', { name: 'Verified app identity' }).click()
      await expectNoSeriousA11yViolations(page)
      await attachScreenshots(page, testInfo, `app-${label.replace(' ', '-')}-${theme}`)
    })
  }
}
```

In `e2e/app-pages.spec.ts` replace

```ts
    await expect(page.getByRole('main').getByRole('link', { name: /vault\.example/ })).toHaveAttribute('href', 'https://vault.example')
```

with

```ts
    const open = page.getByRole('main').getByRole('link', { name: 'Open app' })
    await expect(open).toHaveAttribute('href', 'https://vault.example')
    await expect(open).toHaveAttribute('rel', /noopener/)
    await expect(page.getByRole('main').getByText('vault.example', { exact: true })).toBeVisible()
```

and

```ts
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Vault Pages — Notes for teams')
```

with

```ts
    await expect(page).toHaveTitle('Vault Pages on Renown')
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Vault Pages')
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', 'Notes for teams')
```

In `e2e/profile-apps.spec.ts`, at the end of `'a logo that 404s falls back to the monogram on the card and the app page'`, replace

```ts
  await expect(page.locator('article').getByText('A', { exact: true })).toBeVisible()
  await expect(page.locator('article img')).toHaveCount(0)
```

with

```ts
  await expect(page.locator('main header').getByText('A', { exact: true })).toBeVisible()
  // No logo and no cover image: the cover is identity art (inline SVG), the logo its monogram.
  await expect(page.locator('main header img')).toHaveCount(0)
  await expect(page.locator('main header .rn-art svg')).toHaveCount(2)
```

(GAMMA's cover 404s on the stub, so this also pins Review Focus 3: the art stays and the image is dropped.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx playwright test e2e/app-page.spec.ts e2e/app-pages.spec.ts e2e/profile-apps.spec.ts e2e/app-stats.spec.ts --workers=3 --reporter=line`
Expected: FAIL. There is no `.rn-art`, no "Open app", no "Publisher" region, and no "No activity reported yet". `app-stats.spec.ts` still passes.

- [ ] **Step 3: Create the app page components**

`components/app-page/app-hero-cover.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { mediaUrl } from '../../services/media'
import { cx } from '../../utils/cx'
import { IdentityArt } from '../identity/identity-art'

/**
 * The app's cover, over its identity art: the art shows while the cover loads,
 * when there is none, and when it fails to load (the frame never changes size).
 */
export function AppHeroCover({ documentId, coverRef, appDid, className }: { documentId: string; coverRef: string | null; appDid: string; className?: string }) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  // A server-rendered <img> can fail before hydration (no React error event): catch it once mounted.
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth === 0) setFailed(true)
  }, [coverRef])
  return (
    <div className={cx('border-hairline rounded-panel relative overflow-hidden border', className)}>
      <IdentityArt seed={appDid} idPrefix="app" className="absolute inset-0" />
      {coverRef && !failed && (
        // eslint-disable-next-line @next/next/no-img-element -- /media 302s to signed storage URLs next/image can't allowlist
        <img
          ref={imgRef}
          src={mediaUrl(documentId, 'cover', '', coverRef)}
          alt=""
          loading="eager"
          fetchPriority="high"
          decoding="async"
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  )
}
```

`components/app-page/app-hero.tsx`:

```tsx
import Link from 'next/link'
import type { QrCode } from '../../lib/qr'
import type { RenownAppProfile } from '../../services/app-profiles'
import { ButtonLink } from '../site/primitives'
import { AppLogo } from '../app/app-logo'
import { ShareMenu } from '../identity/share-menu'
import { VerifiedBadge } from '../identity/verified-badge'
import { AppHeroCover } from './app-hero-cover'

export interface AppHeroProps {
  app: RenownAppProfile
  name: string
  /** http(s) website and its hostname, when the app has one. */
  website: { url: string; host: string } | null
  shareUrl: string
  qr: QrCode | null
}

/** The top of an app page: cover (or identity art), logo, name, tagline, category, verification and actions. */
export function AppHero({ app, name, website, shareUrl, qr }: AppHeroProps) {
  return (
    <header>
      <AppHeroCover documentId={app.documentId} coverRef={app.coverRef} appDid={app.appDid} className="h-[168px] sm:h-[232px] lg:h-[272px]" />
      <div className="px-1 sm:px-8">
        <div className="bg-background relative -mt-12 w-fit rounded-[22px] p-1 sm:-mt-14">
          <AppLogo
            documentId={app.documentId}
            logoRef={app.logoRef}
            legacyLogo={app.logo}
            name={name}
            priority
            className="h-[88px] w-[88px] rounded-[18px] text-4xl shadow-none sm:h-[104px] sm:w-[104px]"
          />
        </div>
        <div className="mt-4 min-w-0">
          <h1 className="text-ink text-h1 text-balance [overflow-wrap:anywhere]">{name}</h1>
          {app.tagline && <p className="text-ink-muted text-lead mt-3 max-w-[60ch] text-pretty [overflow-wrap:anywhere]">{app.tagline}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2">
            {app.category && (
              <Link
                href={`/apps?category=${encodeURIComponent(app.category)}`}
                className="border-primary/20 bg-primary/10 text-primary-ink hover:border-primary/50 inline-flex h-7 max-w-full items-center rounded-full border px-3 text-xs font-semibold transition-colors"
              >
                <span className="truncate">{app.category}</span>
              </Link>
            )}
            <VerifiedBadge label="Verified app identity" learnMore={{ href: '/developers', label: 'How apps prove who they are' }}>
              <p>
                This app is identified by its own key, the DID shown on this page. When you approve it, your wallet signs a credential
                naming that key, so only the app holding it can act for you.
              </p>
            </VerifiedBadge>
          </div>
          <div className="mt-6 flex flex-wrap items-center gap-x-3 gap-y-2">
            {website && (
              <ButtonLink href={website.url}>
                Open app
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M7 17 17 7M8 7h9v9" />
                </svg>
              </ButtonLink>
            )}
            <ShareMenu url={shareUrl} title={`${name} on Renown`} qr={qr} subject="this app" align="start" />
            {website && <span className="text-ink-muted text-sm">{website.host}</span>}
          </div>
        </div>
      </div>
    </header>
  )
}
```

`components/app-page/app-stats.tsx` (the leaderboard moves here from `components/app/app-stats.tsx`, restyled on the site tokens):

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { AppMetricStat, AppStats, MetricAggregation, MetricContributor } from '../../services/app-stats'
import { formatStatDate, formatStatValue } from '../../utils/stat-format'
import { shortAddress } from '../../lib/profile-identity'
import { MetricCard } from '../identity/metric-card'
import { PageSection } from '../identity/page-section'
import { ProfileAvatar } from '../profile/profile-avatar'

/** What a metric's number means, in plain words. */
export const AGGREGATION_MEANING: Record<MetricAggregation, string> = {
  SUM: 'Total across all users',
  MAX: 'Highest by a single user',
  AVG: 'Average per user',
  COUNT_USERS: 'Number of users',
}

/** True when the app reports nothing yet: no users and every metric at zero. */
export function hasNoActivity(stats: AppStats): boolean {
  return stats.totalUsers === 0 && stats.metrics.every((m) => m.value === 0)
}

function contributorName(c: MetricContributor): string {
  if (c.displayName) return c.displayName
  if (c.handle) return `@${c.handle}`
  if (c.address) return shortAddress(c.address)
  return `${c.userDid.slice(0, 16)}…${c.userDid.slice(-4)}`
}

function contributorHref(c: MetricContributor): string | null {
  if (c.handle) return `/@${c.handle}`
  if (c.address) return `/profile/${c.address}`
  return null
}

function withUnit(value: number, unit: string | null): string {
  return unit ? `${formatStatValue(value)} ${unit}` : formatStatValue(value)
}

function Leaderboard({ metric }: { metric: AppMetricStat }) {
  return (
    <div className="border-hairline rounded-card min-w-0 border p-4">
      <h4 className="text-ink text-sm font-semibold">{metric.label}</h4>
      <ol className="mt-3 space-y-1">
        {metric.top.map((c, i) => {
          const href = contributorHref(c)
          const body: ReactNode = (
            <>
              <span className="text-ink-muted w-4 shrink-0 text-xs tabular-nums">{i + 1}</span>
              <ProfileAvatar documentId={c.documentId} avatar={c.avatar} userImage={c.userImage} seed={c.address ?? c.userDid} alt="" className="h-7 w-7 shrink-0" />
              <span className="text-ink min-w-0 flex-1 truncate text-sm">{contributorName(c)}</span>
              <span className="text-ink shrink-0 text-sm font-semibold tabular-nums">{withUnit(c.value, metric.unit)}</span>
            </>
          )
          return (
            <li key={c.userDid}>
              {href ? (
                <Link href={href} className="hover:bg-surface-2 -mx-2 flex items-center gap-3 rounded-lg px-2 py-1 transition-colors">
                  {body}
                </Link>
              ) : (
                <div className="flex items-center gap-3 py-1">{body}</div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The app's public numbers: active users, one card per declared metric, top contributors; a calm empty state at zero. */
export function AppStatsSection({ stats, appName }: { stats: AppStats; appName: string }) {
  const empty = hasNoActivity(stats)
  const boards = stats.metrics.filter((m) => m.top.length > 0)
  return (
    <PageSection
      id="app-stats-heading"
      title="Stats"
      aside={stats.updatedAt && !empty ? <span className="text-ink-muted text-xs">Updated {formatStatDate(stats.updatedAt)}</span> : null}
    >
      {empty ? (
        <div className="border-hairline rounded-card border border-dashed px-6 py-8">
          <p className="text-ink font-semibold">No activity reported yet</p>
          <p className="text-ink-muted mt-1.5 max-w-[52ch] text-sm leading-6">
            When people use {appName}, the numbers it reports appear here
            {stats.metrics.length > 0 ? `, starting with ${stats.metrics.map((m) => m.label.toLowerCase()).join(', ')}` : ''}.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {stats.totalUsers > 0 && (
              <MetricCard value={stats.activeUsers30d} label="Active in the last 30 days" meaning={`of ${formatStatValue(stats.totalUsers)} users`} />
            )}
            {stats.metrics.map((m) => (
              <MetricCard key={m.key} metricKey={m.key} value={m.value} unit={m.unit} label={m.label} meaning={AGGREGATION_MEANING[m.aggregation]} description={m.description} />
            ))}
          </div>
          {boards.length > 0 && (
            <div className="mt-8">
              <h3 className="text-ink text-base font-semibold">Top contributors</h3>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {boards.map((m) => (
                  <Leaderboard key={m.key} metric={m} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </PageSection>
  )
}
```

`components/app-page/app-publisher.tsx`:

```tsx
import Link from 'next/link'
import { identityAccent } from '../../lib/identity-art'
import { profileDisplayName, shortAddress } from '../../lib/profile-identity'
import type { RenownAppProfile } from '../../services/app-profiles'
import type { RenownProfile } from '../../services/switchboard'
import { profilePath } from '../../utils/profile-url'
import { AppLogo } from '../app/app-logo'
import { IdentityArt } from '../identity/identity-art'
import { PageSection } from '../identity/page-section'
import { ProfileAvatar } from '../profile/profile-avatar'

/** The name a publisher is shown under: their profile's name, else the short address. */
export function publisherName(publisher: RenownProfile | null, address: string): string {
  return publisher ? profileDisplayName(publisher) : shortAddress(address)
}

/** Who publishes the app: identity art strip, avatar, name and handle, linking to their profile. */
export function PublisherCard({ publisher, address }: { publisher: RenownProfile | null; address: string }) {
  const name = publisherName(publisher, address)
  const href = publisher ? profilePath(publisher) : `/profile/${address}`
  return (
    <PageSection id="app-publisher" title="Publisher">
      <Link href={href} className="group border-hairline bg-surface-1 rounded-card hover:border-primary/40 block overflow-hidden border transition-colors">
        <IdentityArt seed={address} idPrefix="publisher" width={640} height={120} className="h-16" />
        <span className="relative block px-4 pb-4">
          <span className="bg-background -mt-7 block w-fit rounded-full p-0.5" style={{ boxShadow: `0 0 0 2px ${identityAccent(address)}` }}>
            <ProfileAvatar documentId={publisher?.documentId} avatar={publisher?.avatar} userImage={publisher?.userImage} seed={address} alt="" className="h-12 w-12" />
          </span>
          <span className="text-ink mt-2 block truncate font-semibold group-hover:underline">{name}</span>
          <span className="text-ink-muted block truncate text-sm">{publisher?.handle ? `@${publisher.handle}` : shortAddress(address)}</span>
        </span>
      </Link>
    </PageSection>
  )
}

/** Other apps by the same publisher, as compact rows; nothing when there are none. */
export function MoreByPublisher({ apps, name }: { apps: RenownAppProfile[]; name: string }) {
  if (apps.length === 0) return null
  return (
    <PageSection id="more-by-publisher" title={`More apps by ${name}`}>
      <ul className="space-y-1">
        {apps.map((app) => {
          const appName = app.name || 'Untitled app'
          return (
            <li key={app.appDid}>
              <Link href={`/app/${app.appDid}`} className="hover:bg-surface-2 -mx-2 flex items-center gap-3 rounded-xl px-2 py-2 transition-colors">
                <AppLogo documentId={app.documentId} logoRef={app.logoRef} legacyLogo={app.logo} name={appName} className="h-10 w-10 rounded-xl text-base shadow-none" />
                <span className="min-w-0">
                  <span className="text-ink block truncate text-sm font-semibold">{appName}</span>
                  {app.tagline && <span className="text-ink-muted block truncate text-xs">{app.tagline}</span>}
                </span>
              </Link>
            </li>
          )
        })}
      </ul>
    </PageSection>
  )
}
```

`components/app-page/app-identity-panel.tsx`:

```tsx
import Link from 'next/link'
import { CopyRow } from '../identity/copy-row'
import { IdentityPanel } from '../identity/identity-panel'

/** "Check this app": the app DID with copy, and how apps prove their identity. */
export function AppIdentityPanel({ appDid }: { appDid: string }) {
  return (
    <IdentityPanel
      title="Check this app"
      footer={
        <>
          Apps prove who they are by signing with the key behind this DID.{' '}
          <Link href="/developers" className="text-primary-ink font-semibold hover:underline">
            How app identities work
          </Link>
        </>
      }
    >
      <CopyRow label="App DID" value={appDid} />
    </IdentityPanel>
  )
}
```

- [ ] **Step 4: Rewrite the page and drop the old pieces**

Replace `pages/app/[did].tsx`:

```tsx
import type { GetServerSideProps, NextPage } from 'next'
import { AppTile } from '../../components/app/app-tile'
import { MarkdownLite } from '../../components/app/markdown-lite'
import { AppHero } from '../../components/app-page/app-hero'
import { AppIdentityPanel } from '../../components/app-page/app-identity-panel'
import { MoreByPublisher, PublisherCard, publisherName } from '../../components/app-page/app-publisher'
import { AppStatsSection } from '../../components/app-page/app-stats'
import { LinkChips } from '../../components/identity/link-chip'
import { PageSection } from '../../components/identity/page-section'
import { PageMeta } from '../../components/site/page-meta'
import { Container } from '../../components/site/primitives'
import { SiteLayout } from '../../components/site/site-layout'
import { NotFoundPage } from '../../components/ui/not-found-page'
import { appJsonLd } from '../../lib/json-ld'
import { qrCode, type QrCode } from '../../lib/qr'
import { APP_DID_RE, fetchAppProfile, getAppProfilesByPublisher, listAppProfiles, type RenownAppProfile } from '../../services/app-profiles'
import { getAppStats, type AppStats } from '../../services/app-stats'
import { mediaUrl } from '../../services/media'
import { getProfile, type RenownProfile } from '../../services/switchboard'
import { linkTarget } from '../../utils/link-service'
import { profilePath } from '../../utils/profile-url'
import { ogImageUrl } from '../../utils/seo'
import { siteOrigin } from '../../utils/site-origin'
import { SSR_DATA_TIMEOUT_MS, withTimeout } from '../../utils/with-timeout'

interface AppPageProps {
  app: RenownAppProfile | null
  /** Public stats; null when the stats read failed or timed out (the section drops out). */
  stats: AppStats | null
  /** The publisher's Renown profile, when it has one. */
  publisher: RenownProfile | null
  /** Lowercase wallet of the publisher, from publisherDid. */
  publisherAddress: string | null
  /** The publisher's other apps (this one excluded), at most 4. */
  moreByPublisher: RenownAppProfile[]
  /** Other apps in the same category (this one excluded), at most 3. */
  moreInCategory: RenownAppProfile[]
  canonicalUrl: string | null
  ogImage: string | null
  /** QR code of canonicalUrl for the share menu (computed on the server). */
  qr: QrCode | null
  error?: string
}

const PKH_RE = /^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$/

const AppPage: NextPage<AppPageProps> = ({ app, stats, publisher, publisherAddress, moreByPublisher, moreInCategory, canonicalUrl, ogImage, qr, error }) => {
  if (error) return <NotFoundPage title="Something went wrong" message={error} />
  if (!app) return <NotFoundPage title="App not found" message="No app on Renown has this identity. Check the link, or browse the directory." />

  const name = app.name?.trim() || 'Untitled app'
  const description = app.tagline || `${name}, an app with a verified identity on Renown.`
  const target = app.website ? linkTarget(app.website) : null
  const website = app.website && target ? { url: app.website, host: target.host } : null
  const path = `/app/${app.appDid}`
  const url = canonicalUrl ?? path
  const origin = canonicalUrl ? new URL(canonicalUrl).origin : ''
  const image = app.logoRef && origin ? mediaUrl(app.documentId, 'logo', origin, app.logoRef) : null
  const pubName = publisherAddress ? publisherName(publisher, publisherAddress) : null
  const publisherLd =
    publisherAddress && pubName ? { name: pubName, url: `${origin}${publisher ? profilePath(publisher) : `/profile/${publisherAddress}`}` } : null

  return (
    <SiteLayout>
      <PageMeta
        title={name}
        documentTitle={`${name} on Renown`}
        description={description}
        path={path}
        {...(ogImage && { image: ogImage })}
        jsonLd={[appJsonLd({ app, name, url, image, publisher: publisherLd })]}
      />

      <Container className="max-w-[1120px] pt-6 pb-20 md:pt-10">
        <AppHero app={app} name={name} website={website} shareUrl={url} qr={qr} />
        <div className="mt-12 grid gap-12 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-14">
          <div className="min-w-0 space-y-12">
            {(app.description || app.links.length > 0) && (
              <PageSection id="app-overview" title="Overview">
                {app.description && <MarkdownLite text={app.description} headingBase={3} className="max-w-[68ch] text-[1.0625rem] leading-7" />}
                {app.links.length > 0 && (
                  <div className={app.description ? 'mt-6' : undefined}>
                    <LinkChips links={app.links} />
                  </div>
                )}
              </PageSection>
            )}
            {stats && <AppStatsSection stats={stats} appName={name} />}
          </div>
          <aside className="min-w-0 space-y-10">
            {publisherAddress && <PublisherCard publisher={publisher} address={publisherAddress} />}
            {pubName && <MoreByPublisher apps={moreByPublisher} name={pubName} />}
            <AppIdentityPanel appDid={app.appDid} />
          </aside>
        </div>
        {app.category && moreInCategory.length > 0 && (
          <PageSection id="more-in-category" title={`More in ${app.category}`} className="mt-16 sm:px-8">
            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {moreInCategory.map((other) => (
                <li key={other.appDid}>
                  <AppTile app={other} />
                </li>
              ))}
            </ul>
          </PageSection>
        )}
      </Container>
    </SiteLayout>
  )
}

/** A secondary read: bounded by the SSR budget; a failure or timeout drops its section. */
function optional<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return withTimeout(promise, SSR_DATA_TIMEOUT_MS).catch(() => fallback)
}

export const getServerSideProps: GetServerSideProps<AppPageProps> = async (context) => {
  const did = String(context.params?.did ?? '')
  const empty: AppPageProps = {
    app: null,
    stats: null,
    publisher: null,
    publisherAddress: null,
    moreByPublisher: [],
    moreInCategory: [],
    canonicalUrl: null,
    ogImage: null,
    qr: null,
  }
  let app: RenownAppProfile | null = null
  if (APP_DID_RE.test(did)) {
    try {
      app = await fetchAppProfile(did)
    } catch (error) {
      // An outage is not "no such app": a 404 would make crawlers drop valid pages.
      console.error('Failed to fetch app profile from switchboard:', error)
      context.res.statusCode = 503
      context.res.setHeader('Cache-Control', 'no-store')
      context.res.setHeader('Retry-After', '30')
      return { props: { ...empty, error: 'Apps are temporarily unavailable. Please try again in a moment.' } }
    }
  }
  if (!app) {
    context.res.statusCode = 404
    return { props: empty }
  }

  const publisherAddress = PKH_RE.exec(app.publisherDid ?? '')?.[1]?.toLowerCase() ?? null
  const others = (apps: RenownAppProfile[]) => apps.filter((other) => other.appDid !== app.appDid)
  const [publisher, stats, byPublisher, inCategory] = await Promise.all([
    publisherAddress ? optional(getProfile({ driveId: `renown-${publisherAddress}`, ethAddress: publisherAddress }), null) : Promise.resolve(null),
    optional(getAppStats(did), null),
    publisherAddress ? optional(getAppProfilesByPublisher(publisherAddress), []) : Promise.resolve([]),
    app.category ? optional(listAppProfiles({ limit: 4, category: app.category }).then((page) => page.items), []) : Promise.resolve([]),
  ])
  const origin = siteOrigin(context.req.headers.host)
  const canonicalUrl = `${origin}/app/${did}`
  context.res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  return {
    props: {
      app,
      stats,
      publisher,
      publisherAddress,
      moreByPublisher: others(byPublisher).slice(0, 4),
      moreInCategory: others(inCategory).slice(0, 3),
      canonicalUrl,
      ogImage: ogImageUrl({ variant: 'app', did }, origin),
      qr: qrCode(canonicalUrl),
    },
  }
}

export default AppPage
```

In `utils/stat-format.ts` delete the `AGGREGATION_CAPTION` constant and its doc comment (`/** How a tile names its aggregation. */` up to the closing `}`), and change the first line to `import type { UserStatEntry } from '../services/app-stats'`.

```bash
git rm components/app/app-stats.tsx
grep -rn "AGGREGATION_CAPTION\|components/app/app-stats\|app-profile-card\|copy-address\|own-profile-actions" components pages lib utils e2e
```

Expected: no output from the grep.

- [ ] **Step 5: Run the app specs**

Run: `npx playwright test e2e/app-page.spec.ts e2e/app-pages.spec.ts e2e/profile-apps.spec.ts e2e/app-stats.spec.ts e2e/stat-format.spec.ts --workers=3 --reporter=line`
Expected: PASS. `app-stats.spec.ts` needs no edits: the meanings still contain "Total" and "Highest", and the active-users card still says "of 12 users". Check the attached screenshots for the app with and without a cover, in both themes.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit -p . && pnpm lint
git add components/app-page pages/app/[did].tsx utils/stat-format.ts e2e/app-page.spec.ts e2e/app-pages.spec.ts e2e/profile-apps.spec.ts
git commit -m "feat(app-page): cover or identity art, verification, plain-language stats, publisher and related apps"
```

---

### Task 5: Link-preview cards drawn on the identity art (or the app cover)

**Files:**
- Create: `lib/og/og-art.ts`
- Modify: `lib/og/og-data.ts` (`OgBackground`, card `background`, the `coverRef` query field), `pages/api/og.tsx` (`Backdrop`, `Frame`, `X-Og-Background`)
- Test: `e2e/og.spec.ts` (new describe block)

**Interfaces:**
- Consumes: Task 1 `identityArt`; the follow-ups' `fetchImageDataUrl(url, origin, box)`, `AVATAR_BOX`, `LOGO_BOX`, `clamp()`, `X-Og-Variant`/`X-Og-Image` headers, `CACHE_OK`.
- Produces: `CARD_BOX = { width: 1200, height: 630 }`, `identityArtDataUrl(seed): Promise<string | null>`, `interface OgBackground { kind: 'cover' | 'art'; src: string }`. Profile and app `OgCard`s gain `background: OgBackground | null`. Response header `X-Og-Background: 'cover' | 'art' | 'none'`.

- [ ] **Step 1: Write the failing tests**

Append to `e2e/og.spec.ts`:

```ts
test.describe('link-preview backgrounds', () => {
  const COVER_APP_DID = 'did:key:z6MkSeoCoverAppxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1'
  const BROKEN_COVER_DID = 'did:key:z6MkSeoBrokenCoverxxxxxxxxxxxxxxxxxxxxxxxxxxx1'
  test.beforeAll(async () => {
    const row = (documentId: string, coverRef: string) => ({ documentId, name: 'Cover App', tagline: 'Has a cover', category: 'Tools', logo: null, logoRef: null, coverRef })
    // stub-app-doc serves a cover; doc-og-nocover has none (its /media cover 404s).
    await fixtureStub({ match: 'OgApp', variables: COVER_APP_DID, response: { data: { appProfile: row('stub-app-doc', `attachment://v1:${'2'.repeat(64)}`) } } })
    await fixtureStub({ match: 'OgApp', variables: BROKEN_COVER_DID, response: { data: { appProfile: row('doc-og-nocover', `attachment://v1:${'9'.repeat(64)}`) } } })
  })

  for (const [label, query, background] of [
    ['a profile is drawn on its identity art', `?variant=profile&address=${ADDRESS}`, 'art'],
    ['an app without a cover is drawn on its identity art', `?variant=app&did=${APP_DID}`, 'art'],
    ['an app with a cover is drawn on the cover', `?variant=app&did=${COVER_APP_DID}`, 'cover'],
    ['an app whose cover cannot be fetched falls back to its identity art', `?variant=app&did=${BROKEN_COVER_DID}`, 'art'],
    ['the default card has no backdrop', '?variant=default', 'none'],
  ] as const) {
    test(label, async ({ request }) => {
      const response = await request.get(`/api/og${query}`)
      expect(response.status()).toBe(200)
      expect(response.headers()['x-og-background']).toBe(background)
      expect(response.headers()['cache-control']).toBe('public, max-age=300, s-maxage=3600, stale-while-revalidate=86400')
    })
  }

  test('the same profile always gets the same card, and two profiles differ', async ({ request }) => {
    const a = await (await request.get(`/api/og?variant=profile&address=${ADDRESS}`)).body()
    const again = await (await request.get(`/api/og?variant=profile&address=${ADDRESS}`)).body()
    const other = await (await request.get(`/api/og?variant=profile&address=${WEBP}`)).body()
    expect(again.equals(a)).toBe(true)
    expect(other.equals(a)).toBe(false)
  })
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx playwright test e2e/og.spec.ts -g "link-preview backgrounds" --reporter=line`
Expected: FAIL. `x-og-background` is `undefined` (the 5 header tests). The determinism test passes already.

- [ ] **Step 3: Rasterise the art**

Create `lib/og/og-art.ts`:

```ts
// The identity art behind profile and app link-preview cards, rasterised with
// sharp (Node runtime only). Satori cannot draw this SVG itself (gradients,
// many nodes), so it gets a PNG at card size.
import sharp from 'sharp'
import { identityArt } from '../identity-art'

export const CARD_BOX = { width: 1200, height: 630 }

/** The seed's dark-theme constellation as a 1200 x 630 PNG data URL; null when it cannot be drawn. */
export async function identityArtDataUrl(seed: string): Promise<string | null> {
  try {
    const svg = identityArt(seed, { ...CARD_BOX, theme: 'dark', idPrefix: 'og' })
    const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch (error) {
    console.warn('og: identity art could not be drawn:', error instanceof Error ? error.message : error)
    return null
  }
}
```

- [ ] **Step 4: Give cards a background**

In `lib/og/og-data.ts`:
- add `import { CARD_BOX, identityArtDataUrl } from './og-art'` above the `./og-image` import;
- replace the `OgCard` type with

```ts
/** What a card is drawn on: the app's cover, the seed's identity art, or the plain frame. */
export interface OgBackground {
  kind: 'cover' | 'art'
  /** PNG data URL at card size. */
  src: string
}

export type OgCard =
  | { variant: 'default' }
  | { variant: 'profile'; name: string; handle: string | null; address: string; image: string | null; background: OgBackground | null }
  | { variant: 'app'; name: string; tagline: string | null; category: string | null; logo: string | null; background: OgBackground | null }

async function artBackground(seed: string): Promise<OgBackground | null> {
  const src = await identityArtDataUrl(seed)
  return src ? { kind: 'art', src } : null
}
```

- in `loadProfileCard`, replace everything from `return {` to the end of the function with

```ts
  const [image, background] = await Promise.all([
    imageUrl ? fetchImageDataUrl(imageUrl, origin, AVATAR_BOX) : Promise.resolve(null),
    artBackground(lower),
  ])
  return {
    variant: 'profile',
    name: profile.displayName || profile.username || `${lower.slice(0, 6)}…${lower.slice(-4)}`,
    handle: profile.handle,
    address: lower,
    image,
    background,
  }
}
```

- add `coverRef: string | null` to `interface AppRow`, and `coverRef` to the end of the `OgApp` query's field list (`… logo logoRef coverRef } }`);
- in `loadAppCard`, after the `logoUrl` line, replace the `return { … }` with

```ts
  const coverUrl = app.coverRef ? mediaUrl(app.documentId, 'cover', origin, app.coverRef) : null
  const [logo, cover] = await Promise.all([
    logoUrl ? fetchImageDataUrl(logoUrl, origin, LOGO_BOX) : Promise.resolve(null),
    // A cover that cannot be fetched or decoded is decoration: the identity art stands in.
    coverUrl ? fetchImageDataUrl(coverUrl, origin, CARD_BOX).catch(() => null) : Promise.resolve(null),
  ])
  return {
    variant: 'app',
    name: app.name || 'Untitled app',
    tagline: app.tagline,
    category: app.category,
    logo,
    background: cover ? { kind: 'cover', src: cover } : await artBackground(did),
  }
```

In `pages/api/og.tsx`:
- import `type OgBackground` next to `OgCard` from `../../lib/og/og-data`;
- replace `function Frame(…)` up to and including its outer `<div style={{ … }}>` opening tag with

```tsx
/**
 * The card's backdrop: the app cover or the identity art, under a scrim that
 * keeps the text legible (darker on the left, where the text sits) and the art
 * dim enough that no backdrop pixel reads as text.
 */
function Backdrop({ background }: { background: OgBackground }) {
  return (
    <div style={{ position: 'absolute', top: 0, left: 0, width: SIZE.width, height: SIZE.height, display: 'flex' }}>
      {/* eslint-disable-next-line @next/next/no-img-element -- satori renders plain <img> */}
      <img src={background.src} width={SIZE.width} height={SIZE.height} alt="" style={{ objectFit: 'cover' }} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: SIZE.width,
          height: SIZE.height,
          backgroundImage: 'linear-gradient(90deg, rgba(5,10,26,0.9) 0%, rgba(5,10,26,0.72) 55%, rgba(5,10,26,0.5) 100%)',
        }}
      />
    </div>
  )
}

function Frame({ children, footer, background = null }: { children: React.ReactNode; footer: string; background?: OgBackground | null }) {
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '64px 72px',
        backgroundColor: BG,
        ...(!background && {
          backgroundImage: `radial-gradient(circle at 85% 10%, rgba(0,128,255,0.35), transparent 45%), radial-gradient(circle at 5% 0%, rgba(33,255,180,0.14), transparent 40%)`,
        }),
        color: INK,
        fontFamily: 'Inter',
      }}
    >
      {background && <Backdrop background={background} />}
```

(Satori rejects `backgroundImage: 'none'`, which is why the gradient is spread in conditionally.)
- pass the backdrop: `<Frame footer={card.handle ? `renown.id/@${card.handle}` : 'renown.id'} background={card.background}>` and `<Frame footer="An app on Renown" background={card.background}>`;
- after `res.setHeader('X-Og-Image', imageState(card))` add

```ts
  res.setHeader('X-Og-Background', card.variant === 'default' ? 'none' : (card.background?.kind ?? 'none'))
```

- [ ] **Step 5: Run the OG spec and look at the cards**

Start the e2e servers by hand so they stay up after the run (Playwright reuses them outside CI):

```bash
STUB_SWITCHBOARD_PORT=4799 node e2e/support/stub-switchboard.mjs &
NEXT_PUBLIC_SWITCHBOARD_ENDPOINT=http://localhost:4799/graphql NEXT_PUBLIC_E2E_AUTH=1 NEXT_PUBLIC_RENOWN_URL=http://localhost:3000 pnpm dev &
npx playwright test e2e/og.spec.ts --workers=3 --reporter=line
```

Expected: PASS (20 tests). The follow-ups' "link-preview text" margin tests must still count 0 text pixels: the scrim keeps the art's brightest nodes below the 140 threshold. The spec has now seeded its fixtures into the stub, so:

```bash
curl -s -o /tmp/og-profile.png "http://localhost:3000/api/og?variant=profile&address=0x5e00000000000000000000000000000000000c01"
curl -s -o /tmp/og-app.png "http://localhost:3000/api/og?variant=app&did=did:key:z6MkSeoAppxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx1"
kill %1 %2
```

Open both. The constellation should be visible but quiet behind the text, and the avatar or logo, name and handle should read clearly.

- [ ] **Step 6: Commit**

```bash
npx tsc --noEmit -p . && pnpm lint
git add lib/og/og-art.ts lib/og/og-data.ts pages/api/og.tsx e2e/og.spec.ts
git commit -m "feat(og): draw profile and app cards on their identity art, or the app cover"
```

---

### Task 6: Whole-branch verification, Lighthouse, staging

**Files:** none (verification only; fix forward in the owning task if something fails).

**Interfaces:**
- Consumes: everything above.
- Produces: the evidence for the rollout.

- [ ] **Step 1: Static checks, build and the wallet-chunk check**

```bash
npx tsc --noEmit -p . && pnpm lint
NEXT_PUBLIC_PRIVY_APP_ID=x pnpm build 2>&1 | tail -1
grep -l "QrCodeDataType" .next/static/chunks/*.js .next/static/chunks/pages/*.js .next/static/chunks/pages/**/*.js 2>/dev/null
```

Expected: clean; `Wallet code check passed: 9 marketing pages load no wallet code.`; the grep prints nothing (the QR encoder stays on the server).

- [ ] **Step 2: Full e2e suite once**

Run: `npx playwright test --workers=3 --reporter=line 2>&1 | tail -3`
Expected: 281 passed. If `renown-writes.spec.ts:528` fails with a strict-mode match on "Open in editor" buttons, that is the known Next dev-overlay flake: rerun that spec alone.

- [ ] **Step 3: Lighthouse on a local production build**

```bash
# 1. Seed the page fixtures into a stub that outlives the test run (Playwright reuses it outside CI).
STUB_SWITCHBOARD_PORT=4799 node e2e/support/stub-switchboard.mjs &
npx playwright test e2e/profile-page.spec.ts e2e/app-page.spec.ts -g "has no serious" --reporter=line
# 2. Build and serve production against that stub (after the dev server has stopped: both use .next).
NEXT_PUBLIC_SWITCHBOARD_ENDPOINT=http://localhost:4799/graphql NEXT_PUBLIC_RENOWN_URL=http://localhost:3100 NEXT_PUBLIC_PRIVY_APP_ID=x pnpm build
NEXT_PUBLIC_SWITCHBOARD_ENDPOINT=http://localhost:4799/graphql pnpm start -p 3100 &
for p in "@rich-ruth" "@min-mo" "app/did:key:z6MkAppPageCoveredxxxxxxxxxxxxxxxxxxxxxxxxxxx1" "app/did:key:z6MkAppPageBareAppxxxxxxxxxxxxxxxxxxxxxxxxxxx1"; do
  CHROME_PATH=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | tail -1) npx -y lighthouse@12.6.0 "http://localhost:3100/$p" --quiet --output=json --output-path=/tmp/lh.json --chrome-flags="--headless=new --no-sandbox"
  node -e "const r=require('/tmp/lh.json');const c=r.categories;console.log('$p',['performance','accessibility','best-practices','seo'].map(k=>Math.round(c[k].score*100)).join(' / '),'CLS',r.audits['cumulative-layout-shift'].numericValue)"
done
kill %1 %2
```

Expected (measured in the scratch worktree): 96 / 100 / 100 / 100 with CLS 0 on all four.

- [ ] **Step 4: Staging (after merging to `deploy/staging` and pinning `staging-<sha7>` once the image exists)**

```bash
for p in "@frank" "app/did:key:zDnaed4wPy35wBBJVLZL1XPRQWKpQeeb3JRgMdmHQsLe7KJyi"; do
  CHROME_PATH=$(ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux64/chrome | tail -1) npx -y lighthouse@12.6.0 "https://renown-staging.vetra.io/$p" --quiet --output=json --output-path=/tmp/lh.json --chrome-flags="--headless=new --no-sandbox"
  node -e "const c=require('/tmp/lh.json').categories;console.log('$p',['performance','accessibility','best-practices','seo'].map(k=>Math.round(c[k].score*100)).join(' / '))"
done
curl -sI "https://renown-staging.vetra.io/api/og?variant=profile&address=0x2bbea0145d6fb9c6709a74c1179ca0be71bb3ac6" | grep -i "x-og"
curl -sI "https://renown-staging.vetra.io/api/og?variant=app&did=did:key:zDnaed4wPy35wBBJVLZL1XPRQWKpQeeb3JRgMdmHQsLe7KJyi" | grep -i "x-og"
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" "https://renown-staging.vetra.io/profile/0x2bbea0145d6fb9c6709a74c1179ca0be71bb3ac6"
```

Expected: Performance ≥ 90, Accessibility 100 and SEO 100 on both pages. The profile card returns `X-Og-Background: art`; the Knowledge Vault card returns `X-Og-Background: cover` (it has a cover) and `X-Og-Image: drawn`. The address URL returns `307 …/@frank`. Then, in a browser on staging, check by hand: open Share (copy link, scan the QR with a phone), open the verified badge, sign in as the owner of `@frank` and confirm "Edit profile" and "1 of 4" (or whatever is still missing) appear, and toggle the theme. Screenshot `/@frank` and the Knowledge Vault page at 390 and 1280 in both themes for the PR.

---
## Rollout notes

- **Order.** This ships after the follow-ups: their lazy wallet shell, sharp OG route and real axe gate are prerequisites. Then staging (`deploy/staging`, pin `staging-<sha7>` only after the image exists, Task 6 Step 4), then `main` → semantic-release → Vercel prod + `renown-app:<version>` pinned once the image exists. Prod smoke: Task 6 Step 4's curls and Lighthouse against `https://www.renown.id`.
- **No backend, env or Docker change.** `uqr` is a pure-JS server dependency (no native build). The OG route already runs on Node with sharp. Rasterising the art adds about 30–60 ms per uncached card, which the edge caches (`s-maxage=3600`).
- **Cached link previews.** Profile and app cards rendered before this change stay cached at the CDN for up to 1 h (+24 h SWR), and much longer on social platforms. Re-scrape `/@frank` and the Knowledge Vault page in the Facebook Sharing Debugger and LinkedIn Post Inspector after the prod deploy.
- **Visible changes people may notice.** The app `og:title` loses the tagline (now the description). The "Publisher" and "ENS verified" pills become facts and a chip. Profile stats are now under "Activity". `<title>` reads "… on Renown".
- **Not verifiable locally (left to staging and the user):** a real Renown session on a public page (the owner view was tested through the e2e switch only); scanning the QR code with a phone; the system share sheet (`navigator.share` is absent in headless Chromium, so "More options" never renders in e2e); ENS-verified chips (`isEnsVerified` needs mainnet RPC, blocked in e2e); Lighthouse on staging and prod hardware.

## Self-review

- **Spec coverage:**
  - Identity art (seeded hues, PRNG nodes, glow, orbits, signed edges, static plus reduced-motion twinkle; used on the profile cover, app cover fallback and OG backgrounds): Tasks 1 and 5.
  - Profile 1 (hero: art cover, overlapping avatar, name fallback, @handle, ENS when verified and different, verified disclosure with `/trust`): Task 3 plus Task 2 (`profileDisplayName`).
  - Profile 2 (Share: copy with a live region, server QR, native share; owner Edit + completeness nudge): Task 3.
  - Profile 3 (bio in markdown-lite, link chips with service icons and hostnames, unsafe links dropped): Tasks 2 and 3.
  - Profile 4 (facts strip, hidden at zero): Task 3. Profile 5 (`AppTile` grid): Task 3. Profile 6 (activity by app with logos): Task 3.
  - Profile 7 (DID and address copy, Etherscan, document id, verification line): Task 3. Profile 8 (no handle, no bio/apps/activity, long text, 503, 404): Task 3 tests plus the existing `profile-pages.spec.ts`.
  - Profile 9 (title, description, canonical, OG card, JSON-LD `ProfilePage` + `Person`): Tasks 2, 3 and 5.
  - App 1 (cover or art, logo, category link, tagline, Open app with `rel="noopener"`, Share, verified badge): Task 4.
  - App 2 (prose and links): Task 4. App 3 (metric cards with meanings, active users, zero state): Task 4.
  - App 4 (publisher card with art accent; more apps by the publisher): Task 4. App 5 (more in the category, up to 3): Task 4. App 6 (check this app): Task 4.
  - App 7 (title, canonical, OG card, JSON-LD `SoftwareApplication`): Tasks 2, 4 and 5.
  - Components (shared `ShareMenu`, `VerifiedBadge`, `IdentityPanel`, `LinkChip`, `MetricCard`, `utils/link-service.ts`; unused glass-card pieces deleted): Tasks 3 and 4.
  - Testing list: every item maps to a test in Tasks 1–5. Screenshots and Lighthouse: Tasks 3, 4 and 6. Rollout: Task 6 and the notes above.
- **Placeholder scan:** the only angle-bracket token left for the executor is `staging-<sha7>` / `<version>`, which only exists at deploy time.
- **Type consistency:**
  - `QrCode { size; path }` from `lib/qr.ts` is used by `ShareMenu` and both pages' props.
  - `identityArt(seed, { width, height, theme, idPrefix })` is used by `IdentityArt` and `og-art.ts`.
  - `OgBackground` / `card.background` are used in `og-data.ts` and `og.tsx`.
  - `PageSection` ids double as the regions the tests query (`Publisher`, `More apps by …`, `More in …`, `Check this identity`, `Check this app`).
  - `useViewerAddress()` returns lowercase, and `ProfileOwnerActions` compares it against `address.toLowerCase()`.
- **Review Focus:** each of the five lines has a test in its owning task: Task 3 (owner CLS; long text; popovers at 390 via the axe and screenshot tests), Task 4 (cover 404 → art), Task 5 (OG cover failure → art), Task 2 (legacy username).
