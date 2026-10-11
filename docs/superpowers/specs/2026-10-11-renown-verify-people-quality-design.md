# renown.id: verify tool, opt-in people search, cleanup and layout guards — design

Date: 2026-10-11
Status: approved in conversation (user: "5. ok 6. ok 7 ok" on the proposed next steps)
Repos: renown.id (`/home/f/projects/renown-hub`), renown-package (`/home/f/projects/renown-package-hub`).
Builds on the polish, follow-ups and profile-pages specs (their global constraints apply).

## Intent

1. **Cleanup** the parked polish items from the last launch.
2. **Layout guards**: make the class of bug the user found by hand (mobile menu without a
   background, broken final CTA panel) fail CI instead of reaching prod.
3. **`/verify`**: a public tool where anyone pastes a Renown DID, credential, bearer token or a
   signed document operation and sees, in plain words, whether it is genuine, who signed it, for
   which app, and whether it is still valid. It makes "provable authorship" tangible.
4. **Opt-in people search**: `/people`, a directory of profiles whose owners chose to be listed.
   Nobody is listed by default.

## Global constraints

- Everything cryptographic for `/verify` runs in the browser; no secrets; pasted input never
  leaves the browser except the minimal public lookups (profile by address, app profile by DID,
  credential status by id). Shareable links put the input in the URL fragment (`#`), never in the
  query string.
- `/verify` and `/people` are marketing pages: no wallet code (add them to the wallet-chunk check).
- People search returns only profiles with `listed = true`; direct profile lookups are unchanged;
  no email, credentials or approvals are ever exposed.
- Profile signature compatibility: existing signed messages and stored signatures stay valid.
- Backend ships before the website that needs it; staging before prod.
- Copy: sentence case, UK spelling, no ALL-CAPS, no "→", no middle dots; every claim on `/verify`
  must be true of the code.
- Quality bar unchanged: axe zero serious/critical both themes, CLS 0, Lighthouse mobile ≥ 90 on
  the new pages.

## 1. Cleanup (renown.id)

- OG app cards: blur the cover background (sharp blur) so the cover's own text does not show
  through the scrim.
- OG image route: stop accepting `image/svg+xml` (Renown media never stores SVG; it is the only
  input where libvips can overrun its time limit); update fixtures/tests.
- Profile and app pages: compute the identity accent colour on the server and pass it as a prop
  (like the art SVGs).
- `OG_MEDIA_HOSTS`: normalise entries (strip a default `:443`), so an explicit port works.
- Lazy wallet shell: an error boundary around the shell and body that renders the existing
  "Sign-in could not load" + Reload fallback for render-time errors.
- `usePopover`: reset the placement when closed via the toggle; recompute on resize while open.

## 2. Layout guards (renown.id e2e)

A `layout-invariants` spec that runs for every public page (`/`, `/apps`, `/developers`,
`/trust`, `/ecosystem`, `/@handle` fixture, `/app/[did]` fixture, `/me` signed-in fixture,
`/verify`, `/people`) × widths 390 and 1280 × light and dark, plus interactive states (mobile menu
open, share sheet open, verified badge sheet open, revoke dialog open):
- no horizontal page overflow;
- every open overlay/sheet/drawer covers the area it should (full viewport for overlays, panel
  height ≥ its content, panel content inside its box) and has an opaque background behind its text
  (sample the computed background along the content box — no transparent panels);
- decorative layers never extend past their panel's box when the panel clips (no stray grid/tiles
  outside a rounded frame);
- headings and body text never overlap other text boxes (bounding-box intersection check on text
  elements within a section);
- a screenshot gallery is attached to the test report for human review (no pixel baselines).

## 3. `/verify` (renown.id; small backend addition)

### Input and detection
One large text area ("Paste a DID, credential, token or signed operation") with auto-detection:
- `did:pkh:eip155:<chain>:<address>` → identity check;
- `did:key:z…` → app key / app identity check;
- JSON with `proof.eip712` and `type` containing `RenownCredential` → delegation credential;
- a JWT (three base64url parts) → Renown bearer token;
- `urn:uuid:…` → credential lookup;
- JSON of an action/operation with `context.signer.signatures` → signed operation; then two extra
  fields appear: document ID (required) and branch (default `main`).
Examples are one click away ("Try an example") using fixtures that verify successfully.

### Checks (all client-side crypto)
- **Credential**: EIP-712 signature via `verifyCredentialSignature` (EOA); if that fails and the
  issuer address is a contract, verify on-chain with viem `verifyTypedData` (ERC-1271/6492) through
  the existing public RPC config; expiry vs now; revocation status via the backend (below); issuer
  profile; subject app profile (did:key) or "CLI or other session".
- **Bearer token**: `verifyAuthBearerToken` (did-jwt, expiry, subject); show issuer app key and
  the user address it claims; then look up whether a non-revoked, unexpired delegation credential
  authorises that key for that address (via credential lookup by app DID + address).
- **Signed operation**: recompute the v2 hash (`hashActionV2` from `@powerhousedao/shared`,
  added as a direct dependency pinned to the version reactor-browser uses) for the given document
  ID and branch, compare with the signed hash, verify the P-256 signature against the `did:key`
  public key with WebCrypto, and check the signer key is authorised by a valid credential for the
  claimed user address (same lookup as the token). Legacy (v1) signatures: verify signature only
  and say the document binding is not covered.
- **DID**: parse, show the profile (or "no public profile"), app profile for did:key.

### Result UI
A verdict banner (Genuine / Not genuine / Revoked / Expired / Could not check) with plain-words
reasons, then a checklist of each check with pass/fail/neutral and a one-line explanation, the
signer identity card (links to `/@handle`), the app card (links to `/app/[did]`), timestamps, and
"Copy share link" (fragment). Never claim more than was checked; "Could not check" when a lookup
fails.

### Backend (renown-package)
- `renownCredentials(input: RenownCredentialsInput!)` gains `credentialId: String` (exact match;
  uses the existing `idx_renown_credential_credential_id`); may be combined with existing filters;
  when used alone it does not require issuer/proof address.

## 4. Opt-in people search

### Backend (renown-package)
- renown-user model v1 (in place, as previous field additions): `listed: Boolean` (initial
  `false`), operation `SET_LISTED { listed: Boolean! }`; reducer tolerant of old documents missing
  the key.
- `renown_upsertProfile(… listed: Boolean)`; the signed `profileMessage` payload appends `listed`
  as the 8th key **only when it is not null/undefined** (existing messages and stored signatures
  unchanged); renown.id's byte-identical copy updated in lockstep with shared test vectors.
- Read model `renown_user`: column `listed boolean not null default false` (migration re-runnable),
  processor handles `SET_LISTED`; partial indexes `WHERE listed` on `LOWER(handle)
  text_pattern_ops` and `LOWER(display_name) text_pattern_ops`.
- New public query:
  ```graphql
  renownUserSearch(query: String!, limit: Int, after: String): RenownUserSearchPage!
  type RenownUserSearchPage { items: [ReadRenownUser!]!, next: String }
  ```
  `query` trimmed, 2–40 chars (else BAD_USER_INPUT), prefix match on lower(handle) or
  lower(display_name), `%`/`_` escaped, only `listed = true`, ordered by lower(handle) then
  document id, keyset cursor, `limit` default 20, max 50. `ReadRenownUser` gains `listed`.
- Deploy order: backend first (a new site against an old backend would sign a message the old
  server does not hash).

### renown.id
- Profile editor: a "List me in people search" switch (off by default) with one sentence on what
  listing means; saved like other fields (signed); `/me` completeness unaffected.
- `/people`: search box (SSR for `?q=`, debounced client updates, URL kept in sync), results as
  profile cards (avatar, name, handle, identity-art accent, bio snippet), "Load more", empty state
  ("Nobody matches yet" + "List yourself" → `/profile/edit` when signed in), an explainer that only
  people who opted in appear. Header nav gains "People". Not in the sitemap beyond `/people`
  itself; result pages `noindex` for queries.

## Testing

- Backend: vitest for `credentialId` filter, `listed` model/reducer/processor/migration, search
  query (prefix, escaping, listed-only, pagination, limits), profileMessage vectors with and
  without `listed`.
- renown.id: verify detection table; each check with valid/invalid/revoked/expired fixtures
  (credential, token, v2 operation, legacy operation, DID); smart-wallet path unit-tested with a
  mocked client; `/people` search, pagination, empty, opt-in toggle round trip; layout invariants
  as above; axe both themes; wallet-chunk check includes `/verify` and `/people`.

## Rollout

Backend (renown-package): staging → prod. renown.id: staging (`deploy/staging`, pin after image
exists) → main/prod. Cleanup + layout guards may ship ahead of the features.

## Out of scope

Following/endorsements, people search by address (addresses are already resolvable directly),
verifying non-Renown credentials.
