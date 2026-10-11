# renown.id profile pages — design

Date: 2026-10-10
Status: approved in conversation ("we also need to work on the profile pages… one shot with superpowers. think beyond. make it awesome.")
Repo: renown.id (`/home/f/projects/renown-hub`). Builds on the site polish (`2026-10-09-renown-site-polish-design.md`, global constraints apply) and runs after the follow-ups (`2026-10-10-renown-site-followups-design.md`: lazy wallet shell, OG on Node + sharp, OG clamping).

## Intent

The public profile pages are what people share. Today `/@handle` (`/profile/[id]`) and
`/app/[did]` still use the pre-polish centred "glass card": a stock Renown banner, a raw address
and document UUID, an all-caps "TOTAL" stat label, no sharing, no owner affordances. Make them
the best pages on the site: personal, verifiable, shareable, and consistent with the new design
system — while keeping every current URL, redirect, status code and data contract.

## Success criteria

- A visitor understands in one screen who this is (or what this app is), that the identity is
  verified, and what they have published/done — and can share it in one tap.
- Every profile looks distinct even without an avatar or bio (generative identity art).
- Owners see "Edit profile" (and a completeness nudge) on their own page; others never do.
- Quality bar as the polish spec: axe zero serious/critical in both themes, CLS 0, Lighthouse
  mobile Accessibility/SEO 100 and Performance ≥ 90 (with the follow-ups' lazy wallet shell).
- All existing e2e for profile/app pages (redirects to `/@handle`, 404, 503 outage, media,
  link safety, og meta) stay green or are updated only where the markup intentionally changed.

## Global constraints (in addition to the polish spec)

- Data sources only as they exist today: `renownUsers` (profile fields), `appProfilesByPublisher`,
  `appProfile`, `appStats`, `userStats` (renown-stats), server-side ENS (`utils/ens.ts`), `/media`.
  No new backend fields. Do not list a user's credentials/approvals on public pages (privacy).
- Copy: sentence case, UK spelling, no ALL-CAPS labels, no "→", no middle dots.
- SSR with the existing timeouts; secondary sections (apps, activity, more apps) drop out on
  failure; primary failure keeps today's semantics (503 outage, 404 unknown).
- No new client dependency over 30 kB gzip; QR code generated on the server (SVG string) or with a
  tiny dependency; generative art is server-rendered SVG (no canvas/WebGL).

## Design

### Shared: identity art (`lib/identity-art`)

Deterministic SVG "constellation" seeded by a string (wallet address or app DID): 2–3 hues derived
from a hash, node positions and edges from a seeded PRNG, the homepage constellation's visual
language (glow centre, orbit rings, signed edges). Pure function `identityArt(seed, { width,
height, theme })` → SVG string; tokens for neutrals, seeded hues for accents; static (no animation)
except an optional subtle shimmer under `prefers-reduced-motion: no-preference`. Used as:
profile cover, app cover fallback (no cover image), and the background of the OG profile/app cards
(rasterised there via the OG route).

### Profile page (`/@handle`, `/profile/[id]`)

1. **Hero:** identity-art cover (rounded, full container width), avatar overlapping the cover edge
   (uploaded avatar via `/media`, else identicon), display name (fallback: handle, ENS name, short
   address), `@handle`, ENS name when it resolves and differs, and a **Verified Renown identity**
   badge — a disclosure that explains in two sentences what is verified (the wallet controls this
   DID; profile edits are signed by it) with a link to `/trust`.
2. **Actions:** "Share" (popover: copy profile link with live-region confirmation, QR code SVG of
   the canonical URL, native share where available) and, for the owner only (client-side check
   against the Renown session address), "Edit profile" + a compact completeness nudge (reusing the
   `/me` completeness logic) when incomplete.
3. **About:** bio rendered with the existing markdown-lite (safe links only), and links as chips
   with recognised service icons (GitHub, X, LinkedIn, Farcaster, YouTube, Discord, Telegram,
   website fallback) and the hostname; unsafe links stay dropped as today.
4. **Facts strip:** member since (month year), apps published, apps with activity — only facts
   that are true and public; hidden when zero rather than showing "0".
5. **Apps published:** `AppTile` grid (reusing `/apps` tiles, lazy images) with a link per app;
   hidden when none.
6. **Activity:** `userStats` grouped by app — metric cards in the app's own words ("12 notes
   written in Knowledge Vault"), with the app logo; hidden when there is no public activity.
7. **Check this identity:** DID (`did:pkh:eip155:<chain>:<address>`) and address with copy
   buttons, an Etherscan link for the address, the profile document id in small print, and one
   line on how anyone can verify signatures (link `/trust`).
8. **Empty and edge states:** no handle (stays on `/profile/<id>` as today), no bio, no apps, no
   activity, very long names/bios, outage (503) and unknown (404) — never an empty frame.
9. **SEO/sharing:** title "Name (@handle) on Renown", description from bio, canonical `/@handle`,
   OG profile card with identity art background, JSON-LD `ProfilePage` + `Person` (name,
   alternateName handle, url, sameAs = link URLs, image).

### App page (`/app/[did]`)

1. **Hero:** cover image (or identity art seeded by the app DID), logo overlapping, name, category
   chip linking to `/apps?category=…`, tagline, primary "Open app" button (website, external, with
   `rel="noopener"`), "Share" (same popover as profiles), **Verified app identity** badge
   explaining that sign-in requests from this app are signed with this DID.
2. **About:** description with proper prose typography (markdown-lite), links list with icons.
3. **Stats:** metric cards with sentence-case labels, value, unit, and what the number means
   (aggregation in plain words, e.g. "Total across all users"); `activeUsers30d` / `totalUsers`
   when present; a tasteful "No activity reported yet" state instead of a lone "0".
4. **Publisher:** card with the publisher's avatar, name, handle and identity art accent, linking to
   their profile, plus "More apps by <name>" (other apps of the publisher, hidden when none).
5. **More in <category>:** up to 3 other apps in the same category (`appProfiles(category)`),
   hidden when none.
6. **Check this app:** app DID with copy, one line on how apps prove their identity, link to
   `/developers`.
7. **SEO:** title "Name on Renown", canonical, OG app card (identity art background when no
   cover), JSON-LD `SoftwareApplication` (name, description, url, applicationCategory, publisher).

### Components

`components/profile/*` and `components/app-page/*` built from the site primitives; shared
`ShareMenu`, `VerifiedBadge`, `IdentityPanel`, `LinkChip` (+ `utils/link-service.ts` for icon
detection), `MetricCard`. The old glass-card components that become unused are deleted.

## Testing

- e2e: profile with full data / minimal data / no handle / owner view (e2e switch) / outage 503 /
  unknown 404 / unsafe link dropped / share copy + QR present / JSON-LD valid JSON with expected
  fields; app page with cover / without cover (identity art) / stats zero state / publisher + more
  apps / category link / JSON-LD; identity art determinism (same seed → same SVG, different seeds
  differ); link-service detection table; axe both themes; screenshots 390/1280 light/dark; no
  horizontal scroll.
- OG: profile and app cards render with identity art backgrounds (header check + one image
  snapshot reviewed by eye).

## Rollout

After the follow-ups ship: staging (screenshots + Lighthouse on `/@frank` and the Knowledge Vault
app page), then prod via `main`; image pinned after it exists.

## Out of scope

New profile fields (cover upload, pronouns, location), follower graphs, comments, endorsements.
