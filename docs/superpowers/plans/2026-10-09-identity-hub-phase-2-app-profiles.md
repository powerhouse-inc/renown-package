# Identity Hub — Phase 2 (App Profiles) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every app gets a rich public profile — logo, cover, description, category and links — that its publisher edits from a new **Profile** tab on vetra.io and that renown.id serves at `/app/<did>`, with **Apps published** and a **Publisher** badge on the publisher's own profile.

**Architecture:** The `renown-app-profile` model grows additively in v1 (four optional fields, a `links` list, four link operations). `upsertAppProfile` (renown-stats) gains the fields with patch semantics, checks uploaded images on the stored object exactly like Phase 1 avatars, records the image refs in a small `app_profile_images` table that the Phase 1 media route reads for `logo`/`cover`, and adds an `appProfiles(limit, after)` listing. Writes are gated to the **Vetra relay**: vetra.io calls `vetraPublisher.updateAppProfile` on Vetra's switchboard (vetra-cloud-package), which checks app ownership and forwards the user's own Renown bearer plus the Renown workload registration token. Images go browser → Phase 1's gated upload route with the user's bearer. renown.id renders the public pages; markdown is parsed by a tiny dependency-free parser into React elements.

**Tech Stack:** Powerhouse 6.2.3 (`ph-cli generate`, reactor-api package HTTP routes), Kysely + PGlite, Vitest, viem; renown.id: Next 16 pages router, Tailwind 4, Playwright with the stub switchboard; vetra.io: Next 16 app router, shadcn/ui (`modules/shared/components/ui`), React Query, Vitest + happy-dom + Testing Library; vetra-cloud-package: Vitest + PGlite publisher harness.

**Spec:** `/home/f/projects/renown-package-hub/docs/superpowers/specs/2026-10-09-renown-identity-hub-design.md` (Phase 2, Global constraints). Builds on `/home/f/projects/renown-package-hub/docs/superpowers/plans/2026-10-09-identity-hub-phase-1-user-identity.md` (Phase 1), whose code must be merged before Task 1 starts.

## Ruling needed

Decisions taken in this plan that differ from (or sharpen) the spec and the brief. Each has a default the plan implements; overrule before the named task starts.

1. **`RENOWN_STATS_PROFILE_APPS` cannot identify vetra.io. Default: profile writes are relayed by Vetra's switchboard and authorised by the Renown workload registration token plus the publisher's own bearer.** (Tasks 4, 5, 10, 11.)
   - Finding (installed `@renown/sdk` / `@powerhousedao/reactor-browser` `6.2.3-dev.28` in vetra.io): `RenownCryptoBuilder.build()` loads or **generates an ECDSA key pair per browser** and stores it in IndexedDB (`BrowserKeyStorage`, `signer-*.js` `#initializeKeyPair`). `getBearerToken` signs `createAuthBearerToken(chainId, networkId, address, this.issuer)` with that key, so the bearer's issuer — the switchboard's `ctx.user.appKey` — is a **random `did:key` per browser profile**. There is no stable "vetra.io app DID" to put in an allowlist.
   - The only app label anywhere is the delegation credential's `credentialSubject.app`, which the dApp chooses itself (`buildAndSignCredential({ app: this.#appName, appId: this.did })` for in-page sign-in, `?app=<did:key>` for the renown.id redirect). Any site can claim `app: "vetra"`, and bearers are portable (a site's server can replay one). Every bearer-only check — key allowlist, app-name claim, `aud`, `Origin` — reduces to "some site this wallet signed into".
   - **Default implemented:** `upsertAppProfile` keeps both existing rules (the bearer's wallet must be the workload identity's `ownerAddress` on first claim, then the recorded publisher) and replaces "bearer signed by a listed app" with "**either** the request carries the registration token in `X-Renown-Workload-Registration-Token` (the Vetra relay) **or** the bearer's `appKey` is in `RENOWN_STATS_PROFILE_APPS`" (kept for future server-held stable keys; stays **unset**). vetra.io calls `vetraPublisher { updateAppProfile(input) }` on Vetra's own switchboard; Vetra checks the caller owns the app (apps table, as every publisher write) and forwards the caller's bearer plus the token to Renown. The registration token already lets Vetra register workload identities with any `ownerAddress`, so trusting it for profile writes adds **no new trust**, and because the user's bearer must also verify, a leaked token alone cannot rewrite an existing profile. **No new secret and no hosting change:** both Renown tenants and both Vetra tenants already carry `RENOWN_WORKLOAD_REGISTRATION_TOKEN`, and both Vetra tenants already set `RENOWN_STATS_URL`.
   - What this does not stop: a hostile dApp holding the publisher's bearer can drive Vetra's API with it — exactly as it can already delete that publisher's Vetra apps and environments. The profile is now as protected as the app itself. The only bearer-replay-proof alternative is a wallet signature per save (EIP-712 "Update app profile <appDid> <sha256(payload)> at <ts>", like `renown_upsertProfile`'s personal_sign); it costs a wallet prompt per save and re-mounting the wallet adapter on restored sessions. Overrule here to get that instead.
   - Consequence: this phase changes and releases **vetra-cloud-package** (Task 5), which the brief's repo list did not include.
2. **Image refs travel in `SET_PROFILE` as `String`** (state type stays `AttachmentRef`): the `AttachmentRef` scalar cannot carry `""`, and SET_PROFILE's patch rule needs `""` = clear. The reducer stores only `attachment://v1:<64 lowercase hex>` (new `InvalidImageRefError`). (Task 1.)
3. **Media lookups for `logo`/`cover` read a new `app_profile_images(document_id, logo_ref, cover_ref)` table** in the `renown-stats` namespace, written by `upsertAppProfile` under its per-app lock right after the document write. App profiles have no read-model processor and the subgraph is their only writer (generic mutations are admin-only under `AUTH_ENABLED=true`); an admin editing a profile document by hand leaves the table stale until the next upsert. (Tasks 2–4.)
4. **Errors mirror Phase 1:** `DescriptionTooLongError`, `CategoryTooLongError`, `InvalidImageRefError` on SET_PROFILE; `TooManyLinksError`, `DuplicateLinkIdError`, `InvalidLinkError` (ADD_LINK) and `LinkNotFoundError` (UPDATE_LINK; also thrown by REMOVE/REORDER). Link rules are Phase 1's: ≤ 8, label 1–40 trimmed, http(s) URL ≤ 2048, REORDER moves the listed ids to the front. (Task 1.)
5. **Licensing-only apps need their identity DID:** `vetraPublisher.myApps` gains `identityDid: String` (apps table `identity_did`; the studio app from its document). An app without one shows "No Renown identity yet" instead of the form. `updateAppProfile` uses the publisher surface's ownership rule (owner or admin, status `ACTIVE`); the licensing on/off switch does not apply. (Tasks 5, 10, 11.)
6. **Description markdown subset:** paragraphs, line breaks, `#`/`##`/`###` headings, `-`/`*` and `1.` lists, `>` quotes, `**bold**`, `*italic*`/`_italic_`, `` `code` ``, `[label](url)` with http(s)/mailto only. Parsed to an AST and rendered as React elements — no HTML path exists. Identical parser in renown.id and vetra.io (preview). (Tasks 6, 9.)
7. **Aspect ratios are client-side only** (logo cropped square to 512×512, cover 3:1 to 1500×500, WebP, re-encoded at lower quality if over the cap). The server enforces type, size on the stored object (logo ≤ 1 MiB, cover ≤ 2 MiB) and magic bytes. `appProfiles` lists newest first with an opaque cursor; `limit` 1–50, default 20. The Phase 3 `metrics` field is **not** added; `upsertAppProfile` keeps flat optional arguments so Phase 3 can add `metrics` the same way.

## Global Constraints

- Staging first, then prod, for every repo (renown-package, vetra-cloud-package, renown.id, vetra.io). Rollout order per environment: renown-package → vetra-cloud-package → renown.id → vetra.io.
- vetra.io changes land on **both** `staging` and `main`.
- No `Co-Authored-By` / "Generated with" trailers in commits or PRs. Stage explicit paths only (never `git add -A` / `git add .`).
- Never edit `gen/` folders; document-model changes go through the model JSON + `pnpm generate document-model --document <json>` (never `generate all`); reducer code lives in `v1/src/reducers`.
- Reducers pure; new reducer code ≥ 95 % coverage (lines, branches, functions, statements); every new error code has a test; reducer errors are asserted via `operations.global[i].error`, never `.toThrow()`.
- Existing documents stay valid: model changes are additive within v1. Legacy app profiles have none of the new keys — every reader and reducer treats a missing `links` as `[]` and missing scalars as `null`.
- Every image is validated client-side (png/jpeg/webp, ≤ 2 MB before resize) and server-side (type + size + magic bytes from the stored object) before a profile references it.
- Secrets never printed or pasted (the registration token is only ever referenced by env-var name).
- Limits: name ≤ 120, tagline ≤ 280, website http(s) ≤ 2048, description ≤ 2000, category ≤ 40, links ≤ 8 (label 1–40, http(s) URL ≤ 2048); uploads: logo ≤ 1 MiB, cover ≤ 2 MiB, avatar ≤ 2 MiB (unchanged).
- `upsertAppProfile` patch semantics: absent/`null` → unchanged; `""` → clear (text fields and image refs); `links` is the whole desired list (`[]` clears).
- Media URL contract (Phase 1, extended): switchboard `GET /api/@powerhousedao/renown-package/media/<documentId>/<field>` and renown.id `GET /media/<documentId>/<field>`, fields `avatar`, `logo`, `cover`; 302 with `Cache-Control: public, max-age=60, stale-while-revalidate=240`, cacheable 404 when unknown/unset.
- Gated upload route (Phase 1): `POST /api/@powerhousedao/renown-package/media/uploads`, body `{ purpose, mimeType, sizeBytes, sha256 }`, purposes `avatar | logo | cover`.
- Repos and branches: renown-package `/home/f/projects/renown-package-hub` (`feat/identity-hub`); renown.id `/home/f/projects/renown-hub` (`feat/identity-hub`); vetra.io `/home/f/projects/vetra.io-hub` (`feat/identity-hub`); vetra-cloud-package new worktree `/home/f/projects/vetra-cloud-package-profiles` (`feat/identity-hub-profiles`, from `origin/main`); hosting `/home/f/projects/powerhouse-k8s-hosting` (`main`, push directly — ArgoCD syncs). Pushes use SSH: `git@github.com:powerhouse-inc/{renown-package,renown,vetra.to,vetra-cloud-package}.git`.
- Checks — renown-package: `pnpm tsc`, `pnpm lint`, `pnpm exec vitest run --coverage`; vetra-cloud-package: `pnpm tsc`, `pnpm lint`, `pnpm exec vitest run subgraphs/vetra-licensing`; renown.id: `pnpm exec tsc --noEmit -p .`, `pnpm lint`, `pnpm exec playwright test <spec>`; vetra.io: `pnpm tsc`, `pnpm lint`, `pnpm test:unit`. Pipe long output through `tail -30`; show only failures. Warnings that already exist on the base branch are not yours to fix.

## Review Focus

1. **A legacy app profile** (created by Phase 0 code: no `links`, no `description`/`category`/`logoRef`/`coverRef` keys) must still read back, render on `/app/<did>` and accept every new edit — Task 1 "legacy profile" test, Task 4 "legacy profile" test.
2. **Any bearer that did not come through the Vetra relay** — a browser's random did:key, a wrong or empty registration token, the relay header with no configured token, the right token for a wallet that does not own the identity — must be FORBIDDEN and create nothing — Task 4 gate tests; Task 5 refuses non-owners before forwarding.
3. **Bytes that lie:** a 1 MiB + 1 logo, HTML uploaded as `image/png`, a ref that was never uploaded — never stored on a profile — Task 3 `storedImageProblem` tests, Task 4 `INVALID_IMAGE` tests.
4. **`javascript:` anywhere** — in a link (`InvalidLinkError` / `BAD_USER_INPUT`) or inside description markdown (never an anchor) — Task 1, Task 4, Task 6 parser test, Task 7 page test, Task 9 preview test.
5. **Clearing an image** (`logoRef: ""`) must empty the media lookup so `/media/<doc>/logo` 404s and pages fall back to the legacy logo or monogram — Task 4 "patches" test (index ref is null afterwards), Task 3 lookup test.

## File structure

renown-package (`/home/f/projects/renown-package-hub`):

| Path | Responsibility |
|---|---|
| `document-models/renown-app-profile/renown-app-profile.json` | model spec: rich fields, SET_PROFILE inputs + errors, 4 link ops (codegen input) |
| `document-models/renown-app-profile/v1/src/utils.ts` | limits + validators shared by reducers and the write path |
| `document-models/renown-app-profile/v1/src/reducers/profile.ts` | reducers (legacy `links` guard) |
| `subgraphs/renown-stats/store/{migrations,types,kysely}.ts` | `app_profile_images` table, image refs, listing page |
| `subgraphs/renown-stats/store/media-lookup.ts` | `logo`/`cover` lookups for the media route |
| `media/{image,upload-route,stored-image,avatar,register}.ts` | `logo`/`cover` purposes, generic stored-image check, media fields |
| `subgraphs/renown-auth/core/profile-patch.ts` | `linkActions` takes the model's action creators |
| `subgraphs/renown-stats/core/{config,app-profile-patch}.ts` | relay header + token, rich-field validation and link diff |
| `subgraphs/renown-stats/{schema,resolvers,index}.ts`, `README.md` | extended `upsertAppProfile`, `appProfiles`, relay gate |

vetra-cloud-package (`/home/f/projects/vetra-cloud-package-profiles`):

| Path | Responsibility |
|---|---|
| `subgraphs/vetra-licensing/renown-profile.ts` | relay client → renown-stats `upsertAppProfile` |
| `subgraphs/vetra-licensing/{publisher-schema,publisher-resolvers,publisher-auth,owner-apps,index}.ts` | `updateAppProfile`, `myApps.identityDid` |
| `docs/superpowers/specs/2026-10-08-licensing-api-contract.md` | contract SDL (parity test) |

renown.id (`/home/f/projects/renown-hub`):

| Path | Responsibility |
|---|---|
| `services/app-profiles.ts`, `services/media.ts` | app profile reads; `logo`/`cover` media fields |
| `utils/markdown-lite.ts`, `components/app/markdown-lite.tsx` | markdown subset parser + React renderer |
| `utils/site-origin.ts`, `components/ui/not-found-page.tsx` | shared by profile and app pages |
| `components/app/{app-logo,app-cover,app-profile-card}.tsx`, `pages/app/[did].tsx` | public app page |
| `components/profile/profile-summary.tsx`, `pages/profile/[id].tsx` | Publisher badge, Apps published |
| `e2e/support/stub-switchboard.mjs`, `e2e/{markdown-lite,app-pages,profile-apps}.spec.ts` | stub + specs |

vetra.io (`/home/f/projects/vetra.io-hub`):

| Path | Responsibility |
|---|---|
| `modules/apps/lib/app-profile/{renown,api,image,upload,form,markdown-lite}.ts` | Renown URLs, reads, crop/resize (ported from Phase 1), upload, form model, markdown parser |
| `modules/publisher/{graphql,types}.ts` | `updateAppProfile`, `identityDid`, field-carrying errors |
| `modules/apps/hooks/use-app-profile.ts` | profile query, save mutation, bearer for uploads |
| `modules/apps/components/profile/*` | Profile tab, image fields + crop dialog, links editor, preview, overview card |
| `modules/apps/components/{app-detail,app-overview}.tsx` | tab wiring, overview card |

---

## Part A — renown-package

Precondition for Part A: Phase 1 (Tasks 1–10 of the Phase 1 plan) is merged on `feat/identity-hub`, so `media/`, `subgraphs/renown-auth/core/profile-patch.ts` and the Phase 1 tests exist. `cd /home/f/projects/renown-package-hub && git switch feat/identity-hub && git pull --ff-only`.

### Task 1: `renown-app-profile` rich fields (model + reducers)

**Files:**
- Modify: `document-models/renown-app-profile/renown-app-profile.json` (state schema, initial value, SET_PROFILE input + errors, 4 operations)
- Regenerate: `document-models/renown-app-profile/v1/gen/**`, `v1/schema.graphql` (codegen only)
- Replace: `document-models/renown-app-profile/v1/src/utils.ts`, `document-models/renown-app-profile/v1/src/reducers/profile.ts`
- Modify: `document-models/renown-app-profile/v1/tests/profile.test.ts` (one expectation)
- Test: `document-models/renown-app-profile/v1/tests/rich-profile.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (re-exported from `document-models/renown-app-profile/index.js` and `document-models/renown-app-profile/v1`):
  - state adds `description?: string|null`, `category?: string|null`, `logoRef?: AppImageRef|null`, `coverRef?: AppImageRef|null`, `links: RenownAppLink[]` (`{id,label,url}`).
  - `setProfile({ name?, tagline?, logo?, website?, description?, category?, logoRef?, coverRef? })` — every field `string|null|undefined`; `null`/absent unchanged, `""` clears.
  - `addLink({id,label,url})`, `updateLink({id,label?,url?})`, `removeLink({id})`, `reorderLinks({linkIds})` (also on `actions.*`).
  - utils: `MAX_DESCRIPTION_LENGTH=2000`, `MAX_CATEGORY_LENGTH=40`, `MAX_LINKS=8`, `MAX_LINK_LABEL_LENGTH=40`, `MAX_LINK_URL_LENGTH=2048`, `type AppImageRef`, `isAppImageRef(s): s is AppImageRef`, `isValidLinkLabel(s)`, `isValidLinkUrl(s)` (plus the existing `isAppDid`, `isPublisherDid`, `isWebsite`, `isLogo`).
  - errors (`v1/gen/profile/error.ts`): `DescriptionTooLongError`, `CategoryTooLongError`, `InvalidImageRefError`, `TooManyLinksError`, `DuplicateLinkIdError`, `InvalidLinkError`, `LinkNotFoundError`.

- [ ] **Step 1: Extend the model spec and generate.** From the repo root:

```bash
python3 - <<'PLAN_EOF'
import json
p = "document-models/renown-app-profile/renown-app-profile.json"
d = json.load(open(p))
spec = d["specifications"][0]
spec["state"]["global"]["schema"] = (
    "type RenownAppProfileState {\n"
    "  appDid: String\n"
    "  publisherDid: String\n"
    "  name: String\n"
    "  tagline: String\n"
    "  \"Legacy logo: an https URL or a raster data URL; logoRef wins when set\"\n"
    "  logo: String\n"
    "  website: String\n"
    "  \"Markdown subset, at most 2000 characters; rendered sanitized\"\n"
    "  description: String\n"
    "  \"At most 40 characters\"\n"
    "  category: String\n"
    "  \"Uploaded square logo\"\n"
    "  logoRef: AttachmentRef\n"
    "  \"Uploaded 3:1 cover image\"\n"
    "  coverRef: AttachmentRef\n"
    "  \"At most 8 links, in display order\"\n"
    "  links: [RenownAppLink!]!\n"
    "}\n\n"
    "type RenownAppLink {\n"
    "  id: OID!\n"
    "  label: String!\n"
    "  url: URL!\n"
    "}"
)
spec["state"]["global"]["initialValue"] = json.dumps(
    {"appDid": None, "publisherDid": None, "name": None, "tagline": None, "logo": None,
     "website": None, "description": None, "category": None, "logoRef": None,
     "coverRef": None, "links": []}, indent=2)

def err(eid, name, code, desc):
    return {"id": eid, "name": name, "code": code, "description": desc, "template": ""}

def op(oid, name, desc, schema, errors):
    return {"id": oid, "name": name, "description": desc, "schema": schema, "template": "",
            "reducer": "", "errors": errors, "examples": [], "scope": "global"}

ops = spec["modules"][0]["operations"]
set_profile = next(o for o in ops if o["name"] == "SET_PROFILE")
set_profile["schema"] = (
    "input SetProfileInput {\n"
    "  name: String\n"
    "  tagline: String\n"
    "  logo: String\n"
    "  website: String\n"
    "  \"Markdown subset, at most 2000 characters; empty clears\"\n"
    "  description: String\n"
    "  \"At most 40 characters; empty clears\"\n"
    "  category: String\n"
    "  \"attachment://v1:<sha256>; empty clears\"\n"
    "  logoRef: String\n"
    "  \"attachment://v1:<sha256>; empty clears\"\n"
    "  coverRef: String\n"
    "}"
)
set_profile["errors"].extend([
    err("description-too-long-error", "DescriptionTooLongError", "DESCRIPTION_TOO_LONG",
        "The description is longer than 2000 characters"),
    err("category-too-long-error", "CategoryTooLongError", "CATEGORY_TOO_LONG",
        "The category is longer than 40 characters"),
    err("invalid-image-ref-error", "InvalidImageRefError", "INVALID_IMAGE_REF",
        "logoRef or coverRef is not an attachment://v1:<64 lowercase hex> reference"),
])
ops.extend([
    op("add-app-link", "ADD_LINK", "Appends a profile link",
       "input AddLinkInput {\n  id: OID!\n  \"1-40 characters after trimming\"\n  label: String!\n  \"http(s) URL, at most 2048 characters\"\n  url: URL!\n}",
       [err("too-many-links-error", "TooManyLinksError", "TOO_MANY_LINKS", "The profile already has 8 links"),
        err("duplicate-link-id-error", "DuplicateLinkIdError", "DUPLICATE_LINK_ID", "A link with this id already exists"),
        err("invalid-link-error", "InvalidLinkError", "INVALID_LINK",
            "The label is blank or longer than 40 characters, or the URL is not an http(s) URL of at most 2048 characters")]),
    op("update-app-link", "UPDATE_LINK", "Changes the label and/or URL of a link",
       "input UpdateLinkInput {\n  id: OID!\n  label: String\n  url: URL\n}",
       [err("link-not-found-error", "LinkNotFoundError", "LINK_NOT_FOUND", "No link with this id exists")]),
    op("remove-app-link", "REMOVE_LINK", "Removes a link",
       "input RemoveLinkInput {\n  id: OID!\n}", []),
    op("reorder-app-links", "REORDER_LINKS",
       "Moves the listed links to the front in the given order; unlisted links keep their relative order after them",
       "input ReorderLinksInput {\n  linkIds: [OID!]!\n}", []),
])
json.dump(d, open(p, "w"), indent=2)
open(p, "a").write("\n")
PLAN_EOF
pnpm generate document-model --document document-models/renown-app-profile/renown-app-profile.json 2>&1 | tail -5
git checkout -- document-models/renown-app-profile/v1/tests/profile.test.ts powerhouse.manifest.json 2>/dev/null || true
git diff --stat
```

Expected: only `renown-app-profile.json`, `v1/gen/**`, `v1/schema.graphql` and `v1/src/reducers/profile.ts` (four stub methods that throw "not implemented") changed. If the generator touched anything else (it may rewrite `v1/tests/profile.test.ts` imports and reorder `powerhouse.manifest.json`), restore it with `git checkout --`.

- [ ] **Step 2: Write the failing tests.**

Create `document-models/renown-app-profile/v1/tests/rich-profile.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";
import {
  addLink,
  isAppImageRef,
  isValidLinkUrl,
  MAX_LINKS,
  reducer,
  removeLink,
  reorderLinks,
  setAppDid,
  setProfile,
  updateLink,
  utils,
} from "document-models/renown-app-profile/v1";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const LOGO = `attachment://v1:${"a".repeat(64)}`;
const COVER = `attachment://v1:${"b".repeat(64)}`;
const L1 = { id: "link-1", label: "Docs", url: "https://docs.example" };
const L2 = { id: "link-2", label: "GitHub", url: "https://github.com/acme/app" };
const L3 = { id: "link-3", label: "Blog", url: "http://blog.example/feed" };

type Doc = ReturnType<typeof utils.createDocument>;

/** Each global operation's error message (undefined when it applied). */
function errors(doc: Doc): (string | undefined)[] {
  return doc.operations.global.map((op) => op.error);
}

/** A profile whose app DID is set, as every write path leaves it. */
function withApp(): Doc {
  return reducer(utils.createDocument(), setAppDid({ appDid: APP }));
}

describe("RenownAppProfile rich profile", () => {
  it("starts empty", () => {
    expect(utils.createDocument().state.global).toMatchObject({
      description: null,
      category: null,
      logoRef: null,
      coverRef: null,
      links: [],
    });
  });

  it("sets, keeps (null) and clears (empty) description, category and images", () => {
    let d = withApp();
    d = reducer(
      d,
      setProfile({ description: "  Keeps **notes**.  ", category: " Tools ", logoRef: LOGO, coverRef: COVER }),
    );
    d = reducer(d, setProfile({ name: "Vault", description: null, logoRef: null }));
    expect(errors(d)).toEqual([undefined, undefined, undefined]);
    expect(d.state.global).toMatchObject({
      name: "Vault",
      description: "Keeps **notes**.",
      category: "Tools",
      logoRef: LOGO,
      coverRef: COVER,
    });

    d = reducer(d, setProfile({ description: "", category: "", logoRef: "", coverRef: "  " }));
    expect(errors(d)[3]).toBeUndefined();
    expect(d.state.global).toMatchObject({
      name: "Vault",
      description: null,
      category: null,
      logoRef: null,
      coverRef: null,
    });
  });

  it("rejects oversized text and non-attachment image refs without changing anything", () => {
    let d = withApp();
    d = reducer(d, setProfile({ name: "kept?", description: "d".repeat(2001) }));
    d = reducer(d, setProfile({ category: "c".repeat(41) }));
    d = reducer(d, setProfile({ logoRef: "https://cdn.example/logo.png" }));
    d = reducer(d, setProfile({ coverRef: `attachment://v1:${"A".repeat(64)}` }));
    const e = errors(d);
    expect(e[1]).toMatch(/2000/);
    expect(e[2]).toMatch(/40/);
    expect(e[3]).toMatch(/attachment/);
    expect(e[4]).toMatch(/attachment/);
    expect(d.state.global).toMatchObject({
      name: null,
      description: null,
      category: null,
      logoRef: null,
      coverRef: null,
    });
    // Boundaries that are valid.
    d = reducer(d, setProfile({ description: "d".repeat(2000), category: "c".repeat(40) }));
    expect(errors(d)[5]).toBeUndefined();
    expect(isAppImageRef(LOGO)).toBe(true);
    expect(isAppImageRef(`attachment://v2:${"a".repeat(64)}`)).toBe(false);
  });

  it("edits links: add, update label or URL, reorder, remove", () => {
    let d = withApp();
    d = reducer(d, addLink(L1));
    d = reducer(d, addLink(L2));
    d = reducer(d, addLink(L3));
    d = reducer(d, updateLink({ id: "link-2", label: "Code" }));
    d = reducer(d, updateLink({ id: "link-2", url: "https://codeberg.org/acme/app" }));
    d = reducer(d, reorderLinks({ linkIds: ["link-3", "link-1", "link-3"] }));
    d = reducer(d, removeLink({ id: "link-1" }));
    expect(errors(d)).toEqual(Array(8).fill(undefined));
    expect(d.state.global.links).toEqual([
      L3,
      { id: "link-2", label: "Code", url: "https://codeberg.org/acme/app" },
    ]);
  });

  it("enforces the link rules", () => {
    let d = withApp();
    for (let i = 0; i < MAX_LINKS; i++) {
      d = reducer(d, addLink({ id: `l${i}`, label: `L${i}`, url: `https://x.example/${i}` }));
    }
    d = reducer(d, addLink({ id: "l9", label: "Ninth", url: "https://x.example/9" }));
    d = reducer(d, addLink({ id: "l0", label: "Dup", url: "https://x.example/d" }));
    expect(errors(d)[MAX_LINKS + 1]).toMatch(/at most 8/);
    expect(errors(d)[MAX_LINKS + 2]).toMatch(/already used/);

    d = reducer(withApp(), addLink({ id: "a", label: "", url: "https://ok.example" }));
    d = reducer(d, addLink({ id: "b", label: "x".repeat(41), url: "https://ok.example" }));
    d = reducer(d, addLink({ id: "c", label: "XSS", url: "javascript:alert(1)" }));
    d = reducer(d, addLink({ id: "d", label: "Long", url: `https://x.example/${"p".repeat(2048)}` }));
    d = reducer(d, addLink(L1));
    d = reducer(d, updateLink({ id: "link-1", url: "data:text/html,hi" }));
    d = reducer(d, updateLink({ id: "missing", label: "x" }));
    d = reducer(d, removeLink({ id: "missing" }));
    d = reducer(d, reorderLinks({ linkIds: ["missing"] }));
    const e = errors(d);
    expect(e.slice(1, 3).every((m) => /label/i.test(m ?? ""))).toBe(true);
    expect(e.slice(3, 5).every((m) => /URL/.test(m ?? ""))).toBe(true);
    expect(e[5]).toBeUndefined();
    expect(e[6]).toMatch(/URL/);
    expect(e.slice(7).every((m) => /No link with id missing/.test(m ?? ""))).toBe(true);
    expect(d.state.global.links).toEqual([L1]);
    expect(isValidLinkUrl("not a url")).toBe(false);
  });

  it("treats a legacy profile without the new keys as empty", () => {
    const legacy = () => {
      const doc = withApp();
      const state = doc.state.global as Record<string, unknown>;
      for (const key of ["description", "category", "logoRef", "coverRef", "links"]) delete state[key];
      return doc;
    };
    expect(reducer(legacy(), addLink(L1)).state.global.links).toEqual([L1]);
    expect(reducer(legacy(), removeLink({ id: "x" })).operations.global[1].error).toMatch(/No link/);
    expect(reducer(legacy(), updateLink({ id: "x" })).operations.global[1].error).toMatch(/No link/);
    expect(reducer(legacy(), reorderLinks({ linkIds: [] })).state.global.links).toEqual([]);
    expect(reducer(legacy(), setProfile({ category: "Tools" })).state.global).toMatchObject({ category: "Tools" });
  });
});
```

Update the one existing expectation that lists every state key. In `document-models/renown-app-profile/v1/tests/profile.test.ts` replace:

```ts
      logo: "https://cdn.example/logo.png",
      website: "http://localhost:3000",
    });
```

with:

```ts
      logo: "https://cdn.example/logo.png",
      website: "http://localhost:3000",
      description: null,
      category: null,
      logoRef: null,
      coverRef: null,
      links: [],
    });
```

- [ ] **Step 3: Run them to see them fail.** `pnpm exec vitest run document-models/renown-app-profile 2>&1 | tail -30` → FAIL: `isAppImageRef`/`MAX_LINKS` are not exported, and the link tests report `Reducer for 'addLinkOperation' not implemented.` as operation errors.

- [ ] **Step 4: Implement utils and reducers.**

Replace the whole of `document-models/renown-app-profile/v1/src/utils.ts` with exactly:

```ts
const DID_PKH = /^did:pkh:eip155:[1-9][0-9]{0,19}:0x[0-9a-fA-F]{40}$/;
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const DATA_IMAGE =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_REF = /^attachment:\/\/v1:[0-9a-f]{64}$/;

/** Longest description (markdown source), in characters. */
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_CATEGORY_LENGTH = 40;
/** Most links one profile may hold. */
export const MAX_LINKS = 8;
export const MAX_LINK_LABEL_LENGTH = 40;
export const MAX_LINK_URL_LENGTH = 2048;

/** An uploaded image: attachment://v1:<sha256 hex>. */
export type AppImageRef = `attachment://v${number}:${string}`;

function protocolOf(value: string): string | null {
  try {
    return new URL(value).protocol;
  } catch {
    return null;
  }
}

export function isAppDid(value: string): boolean {
  return DID_KEY.test(value);
}

export function isPublisherDid(value: string): boolean {
  return DID_PKH.test(value);
}

export function isWebsite(value: string): boolean {
  const protocol = protocolOf(value);
  return protocol === "https:" || protocol === "http:";
}

export function isLogo(value: string): boolean {
  return DATA_IMAGE.test(value) || protocolOf(value) === "https:";
}

export function isAppImageRef(value: string): value is AppImageRef {
  return IMAGE_REF.test(value);
}

export function isValidLinkLabel(value: string): boolean {
  return value.length > 0 && value === value.trim() && value.length <= MAX_LINK_LABEL_LENGTH;
}

/** Only http(s) links are stored, so a profile never renders a javascript: or data: href. */
export function isValidLinkUrl(value: string): boolean {
  if (value.length > MAX_LINK_URL_LENGTH) return false;
  const protocol = protocolOf(value);
  return protocol === "https:" || protocol === "http:";
}
```

Replace the whole of `document-models/renown-app-profile/v1/src/reducers/profile.ts` with exactly:

```ts
import type {
  RenownAppLink,
  RenownAppProfileProfileOperations,
  RenownAppProfileState,
} from "document-models/renown-app-profile/v1";
import {
  AppDidImmutableError,
  AppDidNotSetError,
  CategoryTooLongError,
  DescriptionTooLongError,
  DuplicateLinkIdError,
  InvalidAppDidError,
  InvalidImageRefError,
  InvalidLinkError,
  InvalidLogoError,
  InvalidPublisherDidError,
  InvalidWebsiteError,
  LinkNotFoundError,
  TooManyLinksError,
} from "../../gen/profile/error.js";
import {
  isAppDid,
  isAppImageRef,
  isLogo,
  isPublisherDid,
  isValidLinkLabel,
  isValidLinkUrl,
  isWebsite,
  MAX_CATEGORY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LINKS,
  type AppImageRef,
} from "../utils.js";

/** undefined = leave unchanged, null = clear, string = set (trimmed). */
function patchValue(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** patchValue for an uploaded image: only attachment://v1:<sha256> refs are stored. */
function imageRefPatch(
  value: string | null | undefined,
): AppImageRef | null | undefined {
  const patched = patchValue(value);
  if (patched === undefined || patched === null) return patched;
  if (!isAppImageRef(patched)) {
    throw new InvalidImageRefError(
      `Not an attachment://v1:<sha256> reference: ${patched}`,
    );
  }
  return patched;
}

/**
 * The profile's links. Profiles created before links existed carry no
 * `links` key at all; they are treated as empty and the list is created on
 * first write.
 */
function linksOf(state: RenownAppProfileState): RenownAppLink[] {
  const legacy = state as { links?: RenownAppLink[] };
  legacy.links ??= [];
  return legacy.links;
}

function assertLink(label: string, url: string): void {
  if (!isValidLinkLabel(label)) {
    throw new InvalidLinkError(
      "Link label must be 1-40 characters without surrounding whitespace",
    );
  }
  if (!isValidLinkUrl(url)) {
    throw new InvalidLinkError(
      "Link URL must be an http(s) URL of at most 2048 characters",
    );
  }
}

export const renownAppProfileProfileOperations: RenownAppProfileProfileOperations =
  {
    setAppDidOperation(state, action) {
      const { appDid } = action.input;
      if (!isAppDid(appDid)) {
        throw new InvalidAppDidError(`Invalid app DID: ${appDid}`);
      }
      if (state.appDid && state.appDid !== appDid) {
        throw new AppDidImmutableError(
          `This profile belongs to ${state.appDid}`,
        );
      }
      state.appDid = appDid;
    },
    setPublisherDidOperation(state, action) {
      const { publisherDid } = action.input;
      if (!isPublisherDid(publisherDid)) {
        throw new InvalidPublisherDidError(
          `Invalid publisher DID: ${publisherDid}`,
        );
      }
      state.publisherDid = publisherDid;
    },
    setProfileOperation(state, action) {
      if (!state.appDid) {
        throw new AppDidNotSetError(
          "Set the app DID before editing the profile",
        );
      }
      const name = patchValue(action.input.name);
      const tagline = patchValue(action.input.tagline);
      const logo = patchValue(action.input.logo);
      const website = patchValue(action.input.website);
      const description = patchValue(action.input.description);
      const category = patchValue(action.input.category);
      const logoRef = imageRefPatch(action.input.logoRef);
      const coverRef = imageRefPatch(action.input.coverRef);
      if (website && !isWebsite(website)) {
        throw new InvalidWebsiteError(`Invalid website: ${website}`);
      }
      if (logo && !isLogo(logo)) {
        throw new InvalidLogoError(
          "The logo must be an https URL or a base64 image data URL",
        );
      }
      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        throw new DescriptionTooLongError(
          `The description exceeds ${MAX_DESCRIPTION_LENGTH} characters`,
        );
      }
      if (category && category.length > MAX_CATEGORY_LENGTH) {
        throw new CategoryTooLongError(
          `The category exceeds ${MAX_CATEGORY_LENGTH} characters`,
        );
      }
      if (name !== undefined) state.name = name;
      if (tagline !== undefined) state.tagline = tagline;
      if (logo !== undefined) state.logo = logo;
      if (website !== undefined) state.website = website;
      if (description !== undefined) state.description = description;
      if (category !== undefined) state.category = category;
      if (logoRef !== undefined) state.logoRef = logoRef;
      if (coverRef !== undefined) state.coverRef = coverRef;
    },
    addLinkOperation(state, action) {
      const { id, label, url } = action.input;
      const links = linksOf(state);
      if (links.some((link) => link.id === id)) {
        throw new DuplicateLinkIdError(`Link id ${id} is already used`);
      }
      if (links.length >= MAX_LINKS) {
        throw new TooManyLinksError(`A profile holds at most ${MAX_LINKS} links`);
      }
      assertLink(label, url);
      links.push({ id, label, url });
    },
    updateLinkOperation(state, action) {
      const { id, label, url } = action.input;
      const link = linksOf(state).find((l) => l.id === id);
      if (!link) throw new LinkNotFoundError(`No link with id ${id}`);
      const nextLabel = label ?? link.label;
      const nextUrl = url ?? link.url;
      assertLink(nextLabel, nextUrl);
      link.label = nextLabel;
      link.url = nextUrl;
    },
    removeLinkOperation(state, action) {
      const links = linksOf(state);
      const index = links.findIndex((l) => l.id === action.input.id);
      if (index === -1) {
        throw new LinkNotFoundError(`No link with id ${action.input.id}`);
      }
      links.splice(index, 1);
    },
    reorderLinksOperation(state, action) {
      const links = linksOf(state);
      const byId = new Map(links.map((link) => [link.id, link]));
      const front: RenownAppLink[] = [];
      for (const id of action.input.linkIds) {
        const link = byId.get(id);
        if (!link) throw new LinkNotFoundError(`No link with id ${id}`);
        if (!front.includes(link)) front.push(link);
      }
      state.links = [...front, ...links.filter((link) => !front.includes(link))];
    },
  };
```

- [ ] **Step 5: Run tests, coverage, types, lint.** `pnpm exec vitest run document-models/renown-app-profile 2>&1 | tail -15` → PASS (both test files). `pnpm exec vitest run --coverage 2>&1 | grep -E "renown-app-profile|ERROR|Threshold" ` → `renown-app-profile/.../profile.ts` 100 % in every column, thresholds pass. `pnpm tsc 2>&1 | tail -5` and `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 6: Commit.**

```bash
git add document-models/renown-app-profile/renown-app-profile.json document-models/renown-app-profile/v1/gen document-models/renown-app-profile/v1/schema.graphql document-models/renown-app-profile/v1/src/utils.ts document-models/renown-app-profile/v1/src/reducers/profile.ts document-models/renown-app-profile/v1/tests/profile.test.ts document-models/renown-app-profile/v1/tests/rich-profile.test.ts
git commit -m "feat(renown-app-profile): description, category, logo and cover images, links"
```

### Task 2: renown-stats store — image refs and the listing page

**Files:**
- Modify: `subgraphs/renown-stats/store/migrations.ts`, `subgraphs/renown-stats/store/types.ts`, `subgraphs/renown-stats/store/kysely.ts`
- Test: `subgraphs/renown-stats/tests/store.test.ts` (append)

**Interfaces:**
- Consumes: existing `KyselyStatsIndex`, `app_profile_documents`.
- Produces (`subgraphs/renown-stats/store/types.ts`):
  - table `app_profile_images(document_id text pk, logo_ref text null, cover_ref text null, updated_at timestamptz)`; index `app_profile_documents_created_at(created_at, app_did)`.
  - `type AppImageField = "logo" | "cover"`; `interface AppImagesPatch { logoRef?: string | null; coverRef?: string | null }` (undefined = unchanged, null = cleared); `interface AppProfileCursor { createdAt: Date; appDid: string }`; `interface AppProfileListEntry extends AppProfileEntry { createdAt: Date }`.
  - `StatsIndex.setAppImages(documentId, images: AppImagesPatch, now: Date): Promise<void>`, `StatsIndex.appImageRef(documentId, field: AppImageField): Promise<string | null>`, `StatsIndex.appProfilesPage(limit: number, after?: AppProfileCursor): Promise<AppProfileListEntry[]>` (newest first, ties by `app_did` descending, strictly after the cursor).

- [ ] **Step 1: Write the failing test.** Append to the end of `subgraphs/renown-stats/tests/store.test.ts`:

```ts
describe("KyselyStatsIndex app images and listing", () => {
  const LOGO = `attachment://v1:${"1".repeat(64)}`;
  const COVER = `attachment://v1:${"2".repeat(64)}`;

  it("records image refs per profile document, patching only the given ones", async () => {
    const index = await makeIndex();
    expect(await index.appImageRef("p-1", "logo")).toBeNull();
    await index.setAppImages("p-1", { logoRef: LOGO }, NOW);
    expect(await index.appImageRef("p-1", "logo")).toBe(LOGO);
    expect(await index.appImageRef("p-1", "cover")).toBeNull();
    await index.setAppImages("p-1", { coverRef: COVER }, LATER);
    expect(await index.appImageRef("p-1", "logo")).toBe(LOGO);
    expect(await index.appImageRef("p-1", "cover")).toBe(COVER);
    await index.setAppImages("p-1", { logoRef: null }, LATER);
    expect(await index.appImageRef("p-1", "logo")).toBeNull();
    expect(await index.appImageRef("p-1", "cover")).toBe(COVER);
    expect(await index.appImageRef("p-2", "cover")).toBeNull();
  });

  it("pages through every profile newest first, ties by app DID", async () => {
    const index = await makeIndex();
    await index.claimAppProfile({ appDid: "did:a", documentId: "p-a", publisherAddress: ALICE }, NOW);
    await index.claimAppProfile({ appDid: "did:b", documentId: "p-b", publisherAddress: BOB }, NOW);
    await index.claimAppProfile({ appDid: "did:c", documentId: "p-c", publisherAddress: ALICE }, LATER);
    const first = await index.appProfilesPage(2);
    expect(first.map((e) => e.appDid)).toEqual(["did:c", "did:b"]);
    expect(first[1]).toEqual({ appDid: "did:b", documentId: "p-b", publisherAddress: BOB, createdAt: NOW });
    const rest = await index.appProfilesPage(2, { createdAt: first[1].createdAt, appDid: first[1].appDid });
    expect(rest.map((e) => e.appDid)).toEqual(["did:a"]);
    expect(await index.appProfilesPage(2, { createdAt: NOW, appDid: "did:a" })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec vitest run subgraphs/renown-stats/tests/store.test.ts 2>&1 | tail -15` → FAIL (`index.appImageRef is not a function`).

- [ ] **Step 3: Implement.**

In `subgraphs/renown-stats/store/migrations.ts`, after the `app_profile_documents_publisher_address` index block (before the closing `}` of `migrate`), add:

```ts
  // Phase 2: the uploaded logo/cover of each profile document, for the
  // public media route, and newest-first listings.
  await db.schema
    .createTable("app_profile_images")
    .ifNotExists()
    .addColumn("document_id", "text", (col) => col.primaryKey())
    .addColumn("logo_ref", "text")
    .addColumn("cover_ref", "text")
    .addColumn("updated_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex("app_profile_documents_created_at")
    .ifNotExists()
    .on("app_profile_documents")
    .columns(["created_at", "app_did"])
    .execute();
```

In `subgraphs/renown-stats/store/types.ts`, replace:

```ts
export interface StatsDB {
  user_stats_documents: UserStatsDocumentRow;
  app_profile_documents: AppProfileDocumentRow;
}
```

with:

```ts
/** The uploaded images of one app-profile document (refs as stored on the document). */
export interface AppProfileImagesRow {
  document_id: string;
  logo_ref: string | null;
  cover_ref: string | null;
  updated_at: Timestamp;
}

export interface StatsDB {
  user_stats_documents: UserStatsDocumentRow;
  app_profile_documents: AppProfileDocumentRow;
  app_profile_images: AppProfileImagesRow;
}

export type AppImageField = "logo" | "cover";

/** undefined leaves an image unchanged; null clears it. */
export interface AppImagesPatch {
  logoRef?: string | null;
  coverRef?: string | null;
}

/** Position in the newest-first profile listing. */
export interface AppProfileCursor {
  createdAt: Date;
  appDid: string;
}
```

and replace:

```ts
  appProfilesByPublisher(publisherAddress: string): Promise<AppProfileEntry[]>;
}
```

with:

```ts
  appProfilesByPublisher(publisherAddress: string): Promise<AppProfileEntry[]>;
  /** Records the given image refs of a profile document; others are kept. */
  setAppImages(documentId: string, images: AppImagesPatch, now: Date): Promise<void>;
  /** The stored ref of a profile document's image, or null. */
  appImageRef(documentId: string, field: AppImageField): Promise<string | null>;
  /** Up to `limit` profiles, newest first, strictly after `after`. */
  appProfilesPage(limit: number, after?: AppProfileCursor): Promise<AppProfileListEntry[]>;
}

export interface AppProfileListEntry extends AppProfileEntry {
  createdAt: Date;
}
```

In `subgraphs/renown-stats/store/kysely.ts`, replace the first line:

```ts
import type { AppProfileEntry, StatsIndex, StatsKysely } from "./types.js";
```

with:

```ts
import type {
  AppImageField,
  AppImagesPatch,
  AppProfileCursor,
  AppProfileEntry,
  AppProfileListEntry,
  StatsIndex,
  StatsKysely,
} from "./types.js";
```

and add these methods to `KyselyStatsIndex`, right after `appProfilesByPublisher` (before the class's closing `}`):

```ts
  async setAppImages(documentId: string, images: AppImagesPatch, now: Date): Promise<void> {
    const changes: { logo_ref?: string | null; cover_ref?: string | null; updated_at: Date } = {
      updated_at: now,
    };
    if (images.logoRef !== undefined) changes.logo_ref = images.logoRef;
    if (images.coverRef !== undefined) changes.cover_ref = images.coverRef;
    await this.db
      .insertInto("app_profile_images")
      .values({
        document_id: documentId,
        logo_ref: images.logoRef ?? null,
        cover_ref: images.coverRef ?? null,
        updated_at: now,
      })
      .onConflict((oc) => oc.column("document_id").doUpdateSet(changes))
      .execute();
  }

  async appImageRef(documentId: string, field: AppImageField): Promise<string | null> {
    const row = await this.db
      .selectFrom("app_profile_images")
      .select(["logo_ref", "cover_ref"])
      .where("document_id", "=", documentId)
      .executeTakeFirst();
    if (!row) return null;
    return field === "logo" ? row.logo_ref : row.cover_ref;
  }

  async appProfilesPage(limit: number, after?: AppProfileCursor): Promise<AppProfileListEntry[]> {
    let query = this.db
      .selectFrom("app_profile_documents")
      .select(["app_did", "document_id", "publisher_address", "created_at"])
      .orderBy("created_at", "desc")
      .orderBy("app_did", "desc")
      .limit(limit);
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb("created_at", "<", after.createdAt),
          eb.and([eb("created_at", "=", after.createdAt), eb("app_did", "<", after.appDid)]),
        ]),
      );
    }
    const rows = await query.execute();
    return rows.map((row) => ({
      appDid: row.app_did,
      documentId: row.document_id,
      publisherAddress: row.publisher_address,
      createdAt: new Date(row.created_at),
    }));
  }
```

- [ ] **Step 4: Run the store tests, types, lint.** `pnpm exec vitest run subgraphs/renown-stats 2>&1 | tail -15` → PASS (all renown-stats suites; the migration still runs twice in `makeIndex`). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/renown-stats/store/migrations.ts subgraphs/renown-stats/store/types.ts subgraphs/renown-stats/store/kysely.ts subgraphs/renown-stats/tests/store.test.ts
git commit -m "feat(renown-stats): index app profile images and page through profiles"
```

### Task 3: Media — logo and cover uploads, stored-image checks, public `logo`/`cover` URLs

**Files:**
- Modify: `media/image.ts`, `media/upload-route.ts`, `media/avatar.ts`, `media/register.ts`
- Create: `media/stored-image.ts`, `subgraphs/renown-stats/store/media-lookup.ts`
- Test: `media/tests/app-images.test.ts`

**Interfaces:**
- Consumes: Phase 1 `MediaBackend`, `StoredObject`, `createUploadHandler`, `sniffImage`, `isImageMimeType`, `registerMedia`; Task 2 `KyselyStatsIndex.appImageRef`, `AppImageField`, `StatsKysely`.
- Produces:
  - `UPLOAD_LIMITS = { avatar: 2 MiB, logo: 1 MiB, cover: 2 MiB }`; `UploadPurpose = "avatar" | "logo" | "cover"`.
  - `storedImageProblem(ref, backend, purpose: UploadPurpose): Promise<string | null>` (`media/stored-image.ts`); `avatarProblem(ref, backend)` now delegates with `"avatar"` (same messages).
  - `STATS_NAMESPACE = "renown-stats"`, `appImageLookup(db: { queryNamespace(namespace: string): unknown }, field: AppImageField) → (documentId) => Promise<string | null>` (never throws; logs and answers null).
  - Upload route accepts `purpose: "logo" | "cover"`; media route serves fields `avatar`, `logo`, `cover`.

- [ ] **Step 1: Write the failing test.**

Create `media/tests/app-images.test.ts` with exactly:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, describe, expect, it, vi } from "vitest";
import { KyselyStatsIndex } from "../../subgraphs/renown-stats/store/kysely.js";
import { appImageLookup, STATS_NAMESPACE } from "../../subgraphs/renown-stats/store/media-lookup.js";
import { migrate } from "../../subgraphs/renown-stats/store/migrations.js";
import type { StatsDB } from "../../subgraphs/renown-stats/store/types.js";
import type { MediaBackend, ReserveRequest, StoredObject } from "../backend.js";
import { UPLOAD_LIMITS } from "../image.js";
import { storedImageProblem } from "../stored-image.js";
import { createUploadHandler } from "../upload-route.js";

const HASH = "e".repeat(64);
const REF = `attachment://v1:${HASH}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MIB = 1024 * 1024;

function ctx(): RouteContext {
  return {
    params: {},
    user: { address: "0xAbC0000000000000000000000000000000000001", chainId: 1, networkId: "eip155", appKey: "did:key:zApp" },
    authEnabled: true,
    rawBody: undefined,
    signal: new AbortController().signal,
    transport: { proto: "https", host: "sb", prefix: "", baseUrl: "https://sb" },
  };
}

function backend(stored: StoredObject | null = null): MediaBackend & { reserved: ReserveRequest[] } {
  const reserved: ReserveRequest[] = [];
  return {
    kind: "s3",
    reserved,
    reserve: vi.fn(async (request: ReserveRequest) => {
      reserved.push(request);
      return { kind: "reserved" as const, ref: REF, reservationId: "r", expiresAtUtc: "t", uploadTarget: null };
    }),
    inspect: vi.fn(async () => stored),
    serve: vi.fn(async () => null),
  };
}

function post(body: unknown): Request {
  return new Request("https://sb/api/@powerhousedao/renown-package/media/uploads", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const opened: Kysely<StatsDB>[] = [];
afterAll(async () => {
  await Promise.all(opened.map((db) => db.destroy()));
});

describe("app image uploads", () => {
  it("caps logos at 1 MiB and covers at 2 MiB", async () => {
    expect(UPLOAD_LIMITS).toEqual({ avatar: 2 * MIB, logo: MIB, cover: 2 * MIB });
    const status = async (purpose: string, sizeBytes: number) =>
      (await createUploadHandler({ backend: () => backend() })(
        post({ purpose, mimeType: "image/webp", sizeBytes, sha256: HASH }),
        ctx(),
      )).status;
    expect(await status("logo", MIB)).toBe(201);
    expect(await status("logo", MIB + 1)).toBe(413);
    expect(await status("cover", 2 * MIB)).toBe(201);
    expect(await status("cover", 2 * MIB + 1)).toBe(413);
  });

  it("names the reservation after its purpose", async () => {
    const b = backend();
    await createUploadHandler({ backend: () => b })(
      post({ purpose: "cover", mimeType: "image/png", sizeBytes: 10, sha256: HASH }),
      ctx(),
    );
    expect(b.reserved[0]).toMatchObject({ fileName: `cover-${HASH.slice(0, 12)}.png`, extension: "png" });
  });

  it("lists every purpose when refusing an unknown one", async () => {
    const res = await createUploadHandler({ backend: () => backend() })(
      post({ purpose: "banner", mimeType: "image/png", sizeBytes: 10, sha256: HASH }),
      ctx(),
    );
    expect(await res.json()).toMatchObject({ code: "INVALID_UPLOAD", error: "purpose must be one of: avatar, logo, cover" });
  });
});

describe("storedImageProblem", () => {
  const png = (sizeBytes: number): StoredObject => ({ mimeType: "image/png", sizeBytes, head: PNG });

  it("applies the purpose's size cap to the stored object", async () => {
    expect(await storedImageProblem(REF, backend(png(MIB)), "logo")).toBeNull();
    expect(await storedImageProblem(REF, backend(png(MIB + 1)), "logo")).toBe(`larger than ${MIB} bytes`);
    expect(await storedImageProblem(REF, backend(png(MIB + 1)), "cover")).toBeNull();
    expect(await storedImageProblem(REF, backend(png(2 * MIB + 1)), "cover")).toBe(`larger than ${2 * MIB} bytes`);
  });

  it("rejects malformed refs, missing objects and lying bytes", async () => {
    expect(await storedImageProblem("https://x", backend(png(1)), "logo")).toMatch(/reference/);
    expect(await storedImageProblem(REF, backend(null), "logo")).toMatch(/not uploaded/);
    const html = { mimeType: "image/png", sizeBytes: 10, head: new TextEncoder().encode("<html>") };
    expect(await storedImageProblem(REF, backend(html), "cover")).toMatch(/not a PNG/);
  });
});

describe("appImageLookup", () => {
  async function statsDb(): Promise<Kysely<StatsDB>> {
    const root = new Kysely<StatsDB>({ dialect: new PGliteDialect(new PGlite()) });
    opened.push(root);
    await sql`create schema ${sql.id(STATS_NAMESPACE)}`.execute(root);
    await migrate(root.withSchema(STATS_NAMESPACE));
    return root;
  }

  it("reads the stored logo and cover of a profile document", async () => {
    const root = await statsDb();
    await new KyselyStatsIndex(root.withSchema(STATS_NAMESPACE)).setAppImages("doc-1", { logoRef: REF }, new Date());
    const db = { queryNamespace: (namespace: string) => root.withSchema(namespace) };
    expect(await appImageLookup(db, "logo")("doc-1")).toBe(REF);
    expect(await appImageLookup(db, "cover")("doc-1")).toBeNull();
    expect(await appImageLookup(db, "logo")("doc-2")).toBeNull();
  });

  it("answers null, never throws, when the namespace is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const broken = {
      queryNamespace: () => {
        throw new Error("namespace unavailable");
      },
    };
    expect(await appImageLookup(broken, "logo")("doc-1")).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("namespace unavailable"));
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec vitest run media/tests/app-images.test.ts 2>&1 | tail -15` → FAIL (`Cannot find module '../stored-image.js'`).

- [ ] **Step 3: Implement.**

In `media/image.ts`, replace:

```ts
/** What an upload is for, and the most bytes it may have. */
export const UPLOAD_LIMITS = { avatar: 2 * 1024 * 1024 } as const;
```

with:

```ts
/** What an upload is for, and the most bytes it may have. */
export const UPLOAD_LIMITS = {
  avatar: 2 * 1024 * 1024,
  /** App-profile logo (cropped square in the browser). */
  logo: 1024 * 1024,
  /** App-profile cover (cropped 3:1 in the browser). */
  cover: 2 * 1024 * 1024,
} as const;
```

In `media/upload-route.ts`, replace:

```ts
    if (!isPurpose(purpose)) return fail(400, "INVALID_UPLOAD", "purpose must be one of: avatar");
```

with:

```ts
    if (!isPurpose(purpose)) {
      return fail(400, "INVALID_UPLOAD", `purpose must be one of: ${Object.keys(UPLOAD_LIMITS).join(", ")}`);
    }
```

Create `media/stored-image.ts` with exactly:

```ts
import type { MediaBackend } from "./backend.js";
import { isImageMimeType, sniffImage, UPLOAD_LIMITS, type UploadPurpose } from "./image.js";

const REF_RE = /^attachment:\/\/v1:([0-9a-f]{64})$/;

/**
 * Why `ref` can't be used as a `purpose` image (avatar, logo, cover), or null
 * when it can. Judged from the stored object itself — on S3 the host records
 * the reservation's claimed type and size before any byte arrives, so neither
 * is trusted: the bucket's size and type are checked against the purpose's
 * cap, and the leading bytes must be a PNG, JPEG or WebP signature of that
 * same type.
 */
export async function storedImageProblem(
  ref: string,
  backend: MediaBackend,
  purpose: UploadPurpose,
): Promise<string | null> {
  const hash = REF_RE.exec(ref)?.[1];
  if (!hash) return "not an attachment://v1 reference";
  const stored = await backend.inspect(hash);
  if (!stored) return "not uploaded (or the upload has not finished)";
  const limit = UPLOAD_LIMITS[purpose];
  if (stored.sizeBytes > limit) return `larger than ${limit} bytes`;
  if (!isImageMimeType(stored.mimeType)) return `stored as ${stored.mimeType}, not an image`;
  const sniffed = sniffImage(stored.head);
  if (sniffed === null) return "not a PNG, JPEG or WebP image";
  if (sniffed !== stored.mimeType) return `stored as ${stored.mimeType} but is ${sniffed}`;
  return null;
}
```

Replace the whole of `media/avatar.ts` with exactly:

```ts
import type { MediaBackend } from "./backend.js";
import { storedImageProblem } from "./stored-image.js";

/** Why `ref` can't be a profile's avatar, or null when it can (see storedImageProblem). */
export function avatarProblem(ref: string, backend: MediaBackend): Promise<string | null> {
  return storedImageProblem(ref, backend, "avatar");
}
```

Create `subgraphs/renown-stats/store/media-lookup.ts` with exactly:

```ts
import { KyselyStatsIndex } from "./kysely.js";
import type { AppImageField, StatsKysely } from "./types.js";

/** The relational namespace renown-stats keeps its index in. */
export const STATS_NAMESPACE = "renown-stats";

/** Anything that can open a relational namespace (the host's relational db). */
export interface NamespaceSource {
  queryNamespace(namespace: string): unknown;
}

/**
 * The media route's lookup for an app-profile image field: the ref
 * upsertAppProfile recorded for the profile document, or null. Never throws:
 * before renown-stats has set up its namespace (or if it can't) the image is
 * simply not there, and the route answers 404.
 */
export function appImageLookup(
  db: NamespaceSource,
  field: AppImageField,
): (documentId: string) => Promise<string | null> {
  return async (documentId) => {
    try {
      const index = new KyselyStatsIndex(db.queryNamespace(STATS_NAMESPACE) as StatsKysely);
      return await index.appImageRef(documentId, field);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[renown-media] ${field} lookup failed (${reason}); answering 404`);
      return null;
    }
  };
}
```

In `media/register.ts`, add the import below the existing `import { createMediaHandler } from "./media-route.js";` line:

```ts
import { appImageLookup } from "../subgraphs/renown-stats/store/media-lookup.js";
```

and replace:

```ts
          avatar: async (documentId) =>
            (await users().select("avatar_ref").where("document_id", "=", documentId).executeTakeFirst())
              ?.avatar_ref ?? null,
        },
```

with:

```ts
          avatar: async (documentId) =>
            (await users().select("avatar_ref").where("document_id", "=", documentId).executeTakeFirst())
              ?.avatar_ref ?? null,
          // App-profile images, recorded by renown-stats' upsertAppProfile.
          logo: appImageLookup(module.relationalDb, "logo"),
          cover: appImageLookup(module.relationalDb, "cover"),
        },
```

Also update the stale doc comment in `media/media-route.ts`: replace `/** Whitelist: only these fields are ever served. Phase 2 adds app-profile \`logo\`/\`cover\`. */` with `/** Whitelist: only these fields are ever served (avatar; app-profile logo and cover). */`.

- [ ] **Step 4: Run tests, types, lint, build.** `pnpm exec vitest run media subgraphs/renown-stats 2>&1 | tail -15` → PASS (Phase 1's `media.test.ts` unchanged and green: `avatarProblem` keeps its messages). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors. `pnpm build 2>&1 | tail -5` → succeeds.

- [ ] **Step 5: Commit.**

```bash
git add media/image.ts media/upload-route.ts media/stored-image.ts media/avatar.ts media/register.ts media/media-route.ts subgraphs/renown-stats/store/media-lookup.ts media/tests/app-images.test.ts
git commit -m "feat(media): logo and cover uploads and public media URLs"
```

### Task 4: `upsertAppProfile` — rich fields, image checks, the Vetra relay gate, `appProfiles`

**Files:**
- Modify: `subgraphs/renown-auth/core/profile-patch.ts` (`linkActions` takes the action creators), `subgraphs/renown-stats/core/config.ts`, `subgraphs/renown-stats/schema.ts`, `subgraphs/renown-stats/index.ts`, `subgraphs/renown-stats/README.md`, `subgraphs/renown-stats/tests/resolvers.test.ts` (one expectation)
- Create: `subgraphs/renown-stats/core/app-profile-patch.ts`
- Replace: `subgraphs/renown-stats/resolvers.ts`
- Test: `subgraphs/renown-stats/tests/app-profile-rich.test.ts`

**Interfaces:**
- Consumes: Task 1 actions/utils/errors; Task 2 `StatsIndex.setAppImages`, `appProfilesPage`, `AppImagesPatch`, `AppProfileCursor`; Task 3 `storedImageProblem`; Phase 1 `mediaBackend()` (`media/slot.ts`), `MediaBackend`, `linkActions`, `constantTimeEqual` (`subgraphs/renown-oidc/core/crypto.ts`).
- Produces:
  - `linkActions(current, desired, creators: LinkActionCreators = userActions)`; `interface LinkActionCreators { addLink; updateLink; removeLink; reorderLinks }` (`subgraphs/renown-auth/core/profile-patch.ts`).
  - `REGISTRAR_HEADER = "x-renown-workload-registration-token"`, `statsRegistrationToken(env): string | null` (`core/config.ts`).
  - `toRichProfilePatch(fields) → RichProfilePatch` (throws `AppProfileInputError(field, message)`), `appLinkActions(current, desired)`, types `AppProfileLink`, `RichProfileFields`, `RichProfilePatch` (`core/app-profile-patch.ts`).
  - `StatsResolverDeps` gains optional `registrationToken?: () => string | null`, `media?: () => MediaBackend | null`.
  - GraphQL (`/graphql/renown-stats`):
    - `type AppProfile { appDid: String!, documentId: String!, name, tagline, logo, website, publisherDid, description, category, logoRef, coverRef: String, links: [AppProfileLink!]! }`, `type AppProfileLink { id: String! label: String! url: String! }`, `type AppProfilePage { items: [AppProfile!]!, next: String }`.
    - `appProfiles(limit: Int, after: String): AppProfilePage!` (public).
    - `upsertAppProfile(appDid: String!, name: String, tagline: String, logo: String, website: String, description: String, category: String, logoRef: String, coverRef: String, links: [AppProfileLinkInput!]): Boolean!`; `input AppProfileLinkInput { id: String! label: String! url: String! }`.
    - Errors: `FORBIDDEN`; `BAD_USER_INPUT` with `extensions.field` (`name|tagline|website|logo|description|category|logoRef|coverRef|links`); `INVALID_IMAGE` with `extensions.field` (`logoRef|coverRef`); `SERVICE_UNAVAILABLE` (an image ref without a media backend); `RATE_LIMITED`; `SERVICE_NOT_CONFIGURED`.
  - Who may call `upsertAppProfile`: a bearer-resolved wallet (`ctx.user.address`) that is the identity's owner (first claim) / the recorded publisher (later), **and** either a valid `X-Renown-Workload-Registration-Token` header or a bearer `appKey` listed in `RENOWN_STATS_PROFILE_APPS`. A present-but-wrong header is FORBIDDEN, never a fallback.

- [ ] **Step 1: Write the failing tests.**

Create `subgraphs/renown-stats/tests/app-profile-rich.test.ts` with exactly:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { generateId, type Action, type PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { getAddress } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reducer, utils } from "../../../document-models/renown-app-profile/index.js";
import type { MediaBackend, StoredObject } from "../../../media/backend.js";
import { migrate as migrateWorkload } from "../../renown-workload/store/migrations.js";
import type { WorkloadDB } from "../../renown-workload/store/types.js";
import { REGISTRAR_HEADER } from "../core/config.js";
import { createResolvers, type StatsResolverDeps } from "../resolvers.js";
import { KyselyStatsIndex } from "../store/kysely.js";
import { migrate } from "../store/migrations.js";
import type { StatsDB } from "../store/types.js";

const OWNER = "0xabc0000000000000000000000000000000000001";
const MALLORY = "0xbad0000000000000000000000000000000000666";
const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const APP_2 = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const APP_3 = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
/** RENOWN_WORKLOAD_REGISTRATION_TOKEN as the Vetra relay sends it. */
const TOKEN = "registration-token-for-tests";
/** What a browser's bearer carries as appKey: a random per-browser did:key. */
const BROWSER_KEY = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const LOGO = `attachment://v1:${H1}`;
const COVER = `attachment://v1:${H2}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MIB = 1024 * 1024;
const L1 = { id: "l1", label: "Docs", url: "https://docs.example" };
const L2 = { id: "l2", label: "Code", url: "https://code.example/app" };
const L3 = { id: "l3", label: "Blog", url: "https://blog.example" };

let root: Kysely<StatsDB>;
const workloadDb = () => root.withSchema("renown-workload") as unknown as Kysely<WorkloadDB>;

async function registerIdentity(did: string, owner: string): Promise<void> {
  const now = new Date("2026-10-09T00:00:00Z");
  await workloadDb()
    .insertInto("workload_identities")
    .values({
      did,
      provider: "github",
      repository_id: generateId(),
      repository: "acme/app",
      production_branch: "main",
      owner_address: getAddress(owner),
      chain_id: 1,
      encrypted_key_pair: "sealed",
      created_at: now,
      updated_at: now,
    })
    .execute();
}

beforeAll(async () => {
  root = new Kysely<StatsDB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema "renown-stats"`.execute(root);
  await migrate(root.withSchema("renown-stats"));
  await sql`create schema "renown-workload"`.execute(root);
  await migrateWorkload(root.withSchema("renown-workload"));
});

afterAll(async () => {
  await root.destroy();
});

beforeEach(async () => {
  await root.withSchema("renown-stats").deleteFrom("app_profile_documents").execute();
  await root.withSchema("renown-stats").deleteFrom("app_profile_images").execute();
  await workloadDb().deleteFrom("workload_identities").execute();
  for (const did of [APP, APP_2, APP_3]) await registerIdentity(did, OWNER);
});

/** A reactor client over the real app-profile reducer, in memory. */
function fakeReactor() {
  const docs = new Map<string, PHDocument>();
  return {
    docs,
    createEmpty: vi.fn(() => {
      const doc = utils.createDocument() as unknown as PHDocument;
      docs.set(doc.header.id, doc);
      return Promise.resolve(doc);
    }),
    execute: vi.fn((id: string, _branch: string, actions: Action[]) => {
      let doc = docs.get(id);
      if (!doc) return Promise.reject(new Error(`no document ${id}`));
      for (const action of actions) doc = reducer(doc as never, action as never) as unknown as PHDocument;
      docs.set(id, doc);
      return Promise.resolve(doc);
    }),
    get: vi.fn((id: string) => {
      const doc = docs.get(id);
      return doc ? Promise.resolve(doc) : Promise.reject(new Error(`no document ${id}`));
    }),
  };
}

function storage(objects: Record<string, StoredObject>): MediaBackend {
  return {
    kind: "s3",
    reserve: vi.fn(),
    serve: vi.fn(),
    inspect: vi.fn((hash: string) => Promise.resolve(objects[hash] ?? null)),
  };
}
const png = (sizeBytes: number): StoredObject => ({ mimeType: "image/png", sizeBytes, head: PNG });
const STORED = storage({ [H1]: png(500_000), [H2]: png(1_500_000) });

type Ctx = { user?: { address?: string; appKey?: string }; headers?: Record<string, string> };
type Resolver = (parent: unknown, args: Record<string, unknown>, ctx: Ctx) => Promise<unknown>;
type ProfileOut = Record<string, unknown> & { documentId: string; links: unknown[] };

/** The Vetra relay: the wallet's own browser bearer plus the registration token. */
const relayed = (address = OWNER, token = TOKEN): Ctx => ({
  user: { address, appKey: BROWSER_KEY },
  headers: { [REGISTRAR_HEADER]: token },
});

let clock = 0;
function setup(options: { media?: MediaBackend | null; token?: string | null } = {}) {
  const reactor = fakeReactor();
  const index = new KyselyStatsIndex(root.withSchema("renown-stats"));
  const resolvers = createResolvers({
    reactorClient: reactor as unknown as StatsResolverDeps["reactorClient"],
    relationalDb: { queryNamespace: (ns: string) => root.withSchema(ns) } as unknown as IRelationalDb<unknown>,
    index: () => index,
    audience: () => "https://stats.example",
    profileApps: () => new Set<string>(),
    registrationToken: () => (options.token === undefined ? TOKEN : options.token),
    media: () => (options.media === undefined ? STORED : options.media),
    // A second later on every call, so listings have a stable order.
    now: () => new Date(Date.UTC(2026, 9, 9, 12, 0, clock++)),
  }) as { Query: Record<string, Resolver>; Mutation: Record<string, Resolver> };
  return {
    reactor,
    index,
    upsert: (args: Record<string, unknown>, ctx: Ctx = relayed()) =>
      resolvers.Mutation.upsertAppProfile(null, args, ctx),
    profile: (appDid: string) =>
      resolvers.Query.appProfile(null, { appDid }, {}) as Promise<ProfileOut | null>,
    page: (args: Record<string, unknown>) =>
      resolvers.Query.appProfiles(null, args, {}) as Promise<{ items: ProfileOut[]; next: string | null }>,
  };
}

/** The GraphQL error `promise` rejects with (fails the test if it resolves). */
async function failure(promise: Promise<unknown>): Promise<{ code: unknown; field: unknown; message: string }> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(GraphQLError);
  const e = error as GraphQLError;
  return { code: e.extensions.code, field: e.extensions.field, message: e.message };
}

describe("upsertAppProfile rich fields", () => {
  it("relays a rich profile for the identity owner and serves it back", async () => {
    const { upsert, profile, index } = setup();
    expect(
      await upsert({
        appDid: APP,
        name: "Vault",
        description: "**Notes** for teams",
        category: "Productivity",
        logoRef: LOGO,
        coverRef: COVER,
        links: [L1, L2],
      }),
    ).toBe(true);
    const out = await profile(APP);
    expect(out).toMatchObject({
      appDid: APP,
      name: "Vault",
      description: "**Notes** for teams",
      category: "Productivity",
      logoRef: LOGO,
      coverRef: COVER,
      links: [L1, L2],
      publisherDid: `did:pkh:eip155:1:${getAddress(OWNER)}`,
    });
    expect(await index.appImageRef(out!.documentId, "logo")).toBe(LOGO);
    expect(await index.appImageRef(out!.documentId, "cover")).toBe(COVER);
  });

  it("patches: null keeps, empty clears, links replace the whole list", async () => {
    const { upsert, profile, index, reactor } = setup();
    await upsert({ appDid: APP, description: "d", category: "c", logoRef: LOGO, coverRef: COVER, links: [L1, L2] });
    await upsert({ appDid: APP, description: null, category: "", logoRef: "", links: [{ ...L2, label: "Source" }, L3] });
    const out = await profile(APP);
    expect(out).toMatchObject({
      description: "d",
      category: null,
      logoRef: null,
      coverRef: COVER,
      links: [{ ...L2, label: "Source" }, L3],
    });
    expect(await index.appImageRef(out!.documentId, "logo")).toBeNull();
    expect(await index.appImageRef(out!.documentId, "cover")).toBe(COVER);
    const lastActions = reactor.execute.mock.calls.at(-1)?.[2] ?? [];
    expect(lastActions.map((action) => action.type)).toEqual([
      "SET_PROFILE",
      "REMOVE_LINK",
      "UPDATE_LINK",
      "ADD_LINK",
    ]);
  });

  it("treats a legacy profile without the rich keys as empty", async () => {
    const { upsert, profile, reactor } = setup();
    await upsert({ appDid: APP, name: "Old" });
    const { documentId } = (await profile(APP))!;
    const state = (reactor.docs.get(documentId)!.state as unknown as { global: Record<string, unknown> }).global;
    for (const key of ["description", "category", "logoRef", "coverRef", "links"]) delete state[key];
    expect(await profile(APP)).toMatchObject({ name: "Old", description: null, logoRef: null, links: [] });
    await upsert({ appDid: APP, links: [L1] });
    expect((await profile(APP))!.links).toEqual([L1]);
  });

  it.each([
    ["a browser bearer without the relay (its key is not listed)", { user: { address: OWNER, appKey: BROWSER_KEY } }],
    ["a wrong registration token", relayed(OWNER, "guess")],
    ["an empty registration token", relayed(OWNER, "")],
    ["the relay without a bearer", { headers: { [REGISTRAR_HEADER]: TOKEN } }],
    ["the relay for a wallet that does not own the identity", relayed(MALLORY)],
  ])("refuses %s", async (_, ctx) => {
    const { upsert, reactor } = setup();
    expect((await failure(upsert({ appDid: APP, name: "x" }, ctx as Ctx))).code).toBe("FORBIDDEN");
    expect(reactor.createEmpty).not.toHaveBeenCalled();
  });

  it("refuses the relay header when no registration token is configured", async () => {
    const { upsert } = setup({ token: null });
    expect((await failure(upsert({ appDid: APP, name: "x" }))).code).toBe("FORBIDDEN");
  });

  it("refuses a later relayed write from anyone but the publisher", async () => {
    const { upsert } = setup();
    await upsert({ appDid: APP, name: "Mine" });
    expect((await failure(upsert({ appDid: APP, name: "Theirs" }, relayed(MALLORY)))).code).toBe("FORBIDDEN");
  });

  it.each([
    ["a 2001-character description", { description: "d".repeat(2001) }, "description", /2000/],
    ["a 41-character category", { category: "c".repeat(41) }, "category", /40/],
    ["a URL as logoRef", { logoRef: "https://cdn.example/l.png" }, "logoRef", /attachment/],
    ["a v2 ref as coverRef", { coverRef: `attachment://v2:${H2}` }, "coverRef", /attachment/],
    [
      "nine links",
      { links: Array.from({ length: 9 }, (_, i) => ({ id: `n${i}`, label: "L", url: "https://x.example" })) },
      "links",
      /at most 8/,
    ],
    ["duplicate link ids", { links: [L1, { ...L2, id: L1.id }] }, "links", /unique id/],
    ["an empty link label", { links: [{ ...L1, label: "  " }] }, "links", /labels/],
    ["a javascript: link", { links: [{ ...L1, url: "javascript:alert(1)" }] }, "links", /http/],
    ["an unsafe website", { website: "javascript:alert(1)" }, "website", /http/],
  ])("refuses %s as BAD_USER_INPUT naming the field", async (_, fields, field, message) => {
    const { upsert, reactor } = setup();
    const error = await failure(upsert({ appDid: APP, ...fields }));
    expect(error).toMatchObject({ code: "BAD_USER_INPUT", field });
    expect(error.message).toMatch(message);
    expect(reactor.createEmpty).not.toHaveBeenCalled();
  });

  it.each([
    ["a logo over 1 MiB", { logoRef: LOGO }, storage({ [H1]: png(MIB + 1) }), "logoRef", /larger than 1048576/],
    ["a cover over 2 MiB", { coverRef: COVER }, storage({ [H2]: png(2 * MIB + 1) }), "coverRef", /larger than 2097152/],
    [
      "HTML bytes labelled PNG",
      { logoRef: LOGO },
      storage({ [H1]: { mimeType: "image/png", sizeBytes: 10, head: new TextEncoder().encode("<html>") } }),
      "logoRef",
      /not a PNG/,
    ],
    ["a logo that was never uploaded", { logoRef: LOGO }, storage({}), "logoRef", /not uploaded/],
  ])("refuses %s as INVALID_IMAGE before creating anything", async (_, fields, media, field, message) => {
    const { upsert, reactor } = setup({ media });
    const error = await failure(upsert({ appDid: APP, ...fields }));
    expect(error).toMatchObject({ code: "INVALID_IMAGE", field });
    expect(error.message).toMatch(message);
    expect(reactor.createEmpty).not.toHaveBeenCalled();
  });

  it("needs a media backend to set an image, but not to clear one", async () => {
    const { upsert } = setup({ media: null });
    expect((await failure(upsert({ appDid: APP, logoRef: LOGO }))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await upsert({ appDid: APP, name: "x", logoRef: "" })).toBe(true);
  });
});

describe("appProfiles", () => {
  it("lists every profile newest first, a page at a time", async () => {
    const { upsert, page } = setup();
    for (const appDid of [APP, APP_2, APP_3]) await upsert({ appDid, name: appDid.slice(-4) });
    const first = await page({ limit: 2 });
    expect(first.items.map((p) => p.appDid)).toEqual([APP_3, APP_2]);
    expect(first.next).toEqual(expect.any(String));
    const second = await page({ limit: 2, after: first.next });
    expect(second.items.map((p) => p.appDid)).toEqual([APP]);
    expect(second.next).toBeNull();
    expect((await page({})).items).toHaveLength(3);
  });

  it.each([[{ limit: 0 }], [{ limit: 51 }], [{ limit: 1.5 }], [{ after: "not-a-cursor" }]])(
    "refuses %j as BAD_USER_INPUT",
    async (args) => {
      expect((await failure(setup().page(args))).code).toBe("BAD_USER_INPUT");
    },
  );
});
```

Update the one existing expectation that lists every output field. In `subgraphs/renown-stats/tests/resolvers.test.ts` replace:

```ts
    const expected = {
      appDid: app.did,
      publisherDid: pkhDidFor(OWNER),
      ...fields,
    };
```

with:

```ts
    const expected = {
      appDid: app.did,
      documentId: expect.any(String),
      publisherDid: pkhDidFor(OWNER),
      ...fields,
      description: null,
      category: null,
      logoRef: null,
      coverRef: null,
      links: [],
    };
```

- [ ] **Step 2: Run them to see them fail.** `pnpm exec vitest run subgraphs/renown-stats 2>&1 | tail -20` → FAIL (`REGISTRAR_HEADER` is not exported from `../core/config.js`; the existing suite's first upsert test fails on the missing output fields).

- [ ] **Step 3: Implement.**

In `subgraphs/renown-auth/core/profile-patch.ts`:
1. In the import from `../../../document-models/renown-user/index.js`, delete the line `  type RenownUserLink,`.
2. Replace:

```ts
/**
 * The renown-user actions that turn `current` links into `desired` (removes,
 * then updates, then adds, then one reorder if the order still differs).
 */
export function linkActions(current: readonly RenownUserLink[], desired: readonly ProfileLink[]): Action[] {
```

with:

```ts
/** The link operations of a model; renown-user and renown-app-profile generate the same four. */
export interface LinkActionCreators {
  addLink(input: { id: string; label: string; url: string }): Action;
  updateLink(input: { id: string; label?: string | null; url?: string | null }): Action;
  removeLink(input: { id: string }): Action;
  reorderLinks(input: { linkIds: string[] }): Action;
}

/**
 * The actions that turn `current` links into `desired` (removes, then
 * updates, then adds, then one reorder if the order still differs), built
 * with `creators` (renown-user's by default).
 */
export function linkActions(
  current: readonly ProfileLink[],
  desired: readonly ProfileLink[],
  creators: LinkActionCreators = userActions,
): Action[] {
```

3. In the body of `linkActions`, replace `userActions.removeLink(` with `creators.removeLink(`, `userActions.updateLink(` with `creators.updateLink(`, `userActions.addLink(` with `creators.addLink(` and `userActions.reorderLinks(` with `creators.reorderLinks(` (one occurrence each; `identityActions` keeps using `userActions`).

Append to `subgraphs/renown-stats/core/config.ts`:

```ts
/**
 * The header the Vetra relay sends the workload registration token in — the
 * same header renown-workload reads.
 */
export const REGISTRAR_HEADER = "x-renown-workload-registration-token";

/**
 * RENOWN_WORKLOAD_REGISTRATION_TOKEN, trimmed; null when unset. Its holder
 * (Vetra) registers workload identities and may relay a publisher's
 * upsertAppProfile together with the publisher's own bearer.
 */
export function statsRegistrationToken(
  env: Record<string, string | undefined>,
): string | null {
  const raw = env.RENOWN_WORKLOAD_REGISTRATION_TOKEN?.trim();
  return raw ? raw : null;
}
```

Create `subgraphs/renown-stats/core/app-profile-patch.ts` with exactly:

```ts
import type { Action } from "document-model";
import {
  actions as appActions,
  isAppImageRef,
  isValidLinkLabel,
  isValidLinkUrl,
  MAX_CATEGORY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LINKS,
} from "../../../document-models/renown-app-profile/index.js";
import { linkActions } from "../../renown-auth/core/profile-patch.js";

export interface AppProfileLink {
  id: string;
  label: string;
  url: string;
}

/** The rich fields upsertAppProfile takes besides name/tagline/logo/website. */
export interface RichProfileFields {
  description?: string | null;
  category?: string | null;
  logoRef?: string | null;
  coverRef?: string | null;
  links?: readonly AppProfileLink[] | null;
}

/**
 * Validated rich fields. `undefined` leaves a field unchanged; `""` clears it
 * (SET_PROFILE's own rule); `links` is the whole desired list.
 */
export interface RichProfilePatch {
  description?: string;
  category?: string;
  logoRef?: string;
  coverRef?: string;
  links?: AppProfileLink[];
}

/** Thrown for an input that fails validation; `field` names the offending argument. */
export class AppProfileInputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "AppProfileInputError";
  }
}

/**
 * Applies the patch rules to the raw input: absent or null means unchanged,
 * "" (or []) clears. Text and refs are trimmed.
 * @throws {AppProfileInputError} for a value the model would reject.
 */
export function toRichProfilePatch(input: RichProfileFields): RichProfilePatch {
  const patch: RichProfilePatch = {};

  if (input.description != null) {
    const description = input.description.trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new AppProfileInputError(
        "description",
        `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      );
    }
    patch.description = description;
  }

  if (input.category != null) {
    const category = input.category.trim();
    if (category.length > MAX_CATEGORY_LENGTH) {
      throw new AppProfileInputError("category", `Category must be at most ${MAX_CATEGORY_LENGTH} characters`);
    }
    patch.category = category;
  }

  for (const field of ["logoRef", "coverRef"] as const) {
    const raw = input[field];
    if (raw == null) continue;
    const ref = raw.trim();
    if (ref !== "" && !isAppImageRef(ref)) {
      throw new AppProfileInputError(field, `${field} must be an attachment://v1:<sha256> reference`);
    }
    patch[field] = ref;
  }

  if (input.links != null) {
    if (input.links.length > MAX_LINKS) {
      throw new AppProfileInputError("links", `A profile holds at most ${MAX_LINKS} links`);
    }
    const ids = new Set<string>();
    patch.links = input.links.map((link) => {
      const label = link.label.trim();
      const url = link.url.trim();
      if (!link.id || ids.has(link.id)) throw new AppProfileInputError("links", "Every link needs a unique id");
      ids.add(link.id);
      if (!isValidLinkLabel(label)) throw new AppProfileInputError("links", "Link labels must be 1-40 characters");
      if (!isValidLinkUrl(url)) throw new AppProfileInputError("links", "Links must be http(s) URLs");
      return { id: link.id, label, url };
    });
  }

  return patch;
}

/** The renown-app-profile link operations that turn `current` into `desired`. */
export function appLinkActions(
  current: readonly AppProfileLink[],
  desired: readonly AppProfileLink[],
): Action[] {
  return linkActions(current, desired, appActions);
}
```

Replace the whole of `subgraphs/renown-stats/schema.ts` with exactly:

```ts
import type { DocumentNode } from "graphql";
import { gql } from "graphql-tag";

export const schema: DocumentNode = gql`
  type UserStat {
    appDid: String!
    metric: String!
    value: Float!
    updatedAt: String!
  }

  type AppProfileLink {
    id: String!
    label: String!
    url: String!
  }

  type AppProfile {
    appDid: String!
    "The profile document; its images are at <renown>/media/<documentId>/logo and /cover."
    documentId: String!
    name: String
    tagline: String
    "Legacy logo (https or raster data URL); prefer logoRef."
    logo: String
    website: String
    publisherDid: String
    "Markdown subset; render it sanitized."
    description: String
    category: String
    logoRef: String
    coverRef: String
    links: [AppProfileLink!]!
  }

  type AppProfilePage {
    items: [AppProfile!]!
    "Pass as after for the next page; null on the last page."
    next: String
  }

  input AppProfileLinkInput {
    id: String!
    label: String!
    url: String!
  }

  type Query {
    userStats(userDid: String!): [UserStat!]!
    appProfile(appDid: String!): AppProfile
    appProfilesByPublisher(publisherDid: String!): [AppProfile!]!
    "Every app profile, newest first. limit 1-50 (default 20)."
    appProfiles(limit: Int, after: String): AppProfilePage!
  }

  type Mutation {
    "Caller must authenticate as appDid (bearer whose issuer/subject is the app DID)."
    reportUserStat(
      appDid: String!
      userDid: String!
      metric: String!
      value: Float!
    ): Boolean!
    """
    Caller: the bearer of the identity owner's wallet (first write) or of the
    recorded publisher, relayed by the registration-token holder
    (X-Renown-Workload-Registration-Token) or signed by an app key listed in
    RENOWN_STATS_PROFILE_APPS. Absent or null fields are unchanged, "" clears,
    links replaces the whole list. Errors: FORBIDDEN, BAD_USER_INPUT and
    INVALID_IMAGE (extensions.field), RATE_LIMITED, SERVICE_UNAVAILABLE.
    """
    upsertAppProfile(
      appDid: String!
      name: String
      tagline: String
      logo: String
      website: String
      description: String
      category: String
      logoRef: String
      coverRef: String
      links: [AppProfileLinkInput!]
    ): Boolean!
  }
`;
```

Replace the whole of `subgraphs/renown-stats/resolvers.ts` with exactly:

```ts
import type { IReactorClient } from "@powerhousedao/reactor";
import { verifyAuthBearerToken } from "@renown/sdk";
import { generateId, type Action, type PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import {
  actions as profileActions,
  isLogo,
  isWebsite,
  renownAppProfileDocumentType,
  type RenownAppProfileDocument,
} from "../../document-models/renown-app-profile/index.js";
import {
  actions as statsActions,
  isMetricName,
  renownUserStatsDocumentType,
  type RenownUserStatsDocument,
} from "../../document-models/renown-user-stats/index.js";
import type { MediaBackend } from "../../media/backend.js";
import { mediaBackend } from "../../media/slot.js";
import { storedImageProblem } from "../../media/stored-image.js";
import { createRateLimiter } from "../renown-auth/core/rate-limit.js";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import { constantTimeEqual } from "../renown-oidc/core/crypto.js";
import {
  AppProfileInputError,
  appLinkActions,
  toRichProfilePatch,
  type AppProfileLink,
  type RichProfileFields,
  type RichProfilePatch,
} from "./core/app-profile-patch.js";
import { REGISTRAR_HEADER } from "./core/config.js";
import {
  addressOf,
  canonicalAppDid,
  canonicalUserDid,
  pkhDidFor,
} from "./core/dids.js";
import { createKeyedLock } from "./core/keyed-lock.js";
import { hasDelegation, workloadOwner } from "./lookups.js";
import type {
  AppImagesPatch,
  AppProfileCursor,
  AppProfileEntry,
  StatsIndex,
} from "./store/types.js";

/** Carries an app token whose `aud` is the stats audience (the host would 401 it as a bearer). */
export const APP_TOKEN_HEADER = "x-renown-app-token";

const REPORT_LIMIT = 600; // per app DID per minute
const PROFILE_LIMIT = 30; // per wallet per minute
const WINDOW_MS = 60_000;
const MAX_LENGTH = {
  name: 120,
  tagline: 280,
  website: 2048,
  logo: 524_288,
} as const;
/** appProfiles page sizes. */
const DEFAULT_PAGE = 20;
const MAX_PAGE = 50;
/** Which upsert argument holds which upload purpose. */
const IMAGE_FIELDS = [
  ["logoRef", "logo"],
  ["coverRef", "cover"],
] as const;

type RateLimiter = { take(key: string, now?: number): boolean };

interface ResolverContext {
  /** Set by the host when it resolved a bearer: the wallet, and the DID that signed the bearer. */
  user?: { address?: string; appKey?: string };
  headers?: Record<string, string | string[] | undefined>;
}

export interface StatsResolverDeps {
  reactorClient: Pick<IReactorClient, "createEmpty" | "execute" | "get">;
  relationalDb: ReadModelDb;
  /** Undefined until set up, or when the relational namespace is unavailable. */
  index(): StatsIndex | undefined;
  audience(): string;
  /**
   * App DIDs whose host bearers may upsert profiles (`RENOWN_STATS_PROFILE_APPS`),
   * for server-held stable keys only: a browser's bearer is signed by a random
   * per-browser did:key. Empty (the default) leaves the relay as the only way.
   */
  profileApps(): ReadonlySet<string>;
  /**
   * `RENOWN_WORKLOAD_REGISTRATION_TOKEN`. Its holder (the Vetra relay) may
   * write a profile for the wallet whose bearer it forwards. Null or absent:
   * relaying is off.
   */
  registrationToken?: () => string | null;
  /** Where image refs are checked; defaults to the backend the media processor published. */
  media?: () => MediaBackend | null;
  now?: () => Date;
  reportRateLimiter?: RateLimiter;
  profileRateLimiter?: RateLimiter;
}

interface ReportUserStatArgs {
  appDid: string;
  userDid: string;
  metric: string;
  value: number;
}

interface ProfileFields {
  name?: string | null;
  tagline?: string | null;
  logo?: string | null;
  website?: string | null;
}

interface UpsertAppProfileArgs extends ProfileFields, RichProfileFields {
  appDid: string;
}

interface UserStatOutput {
  appDid: string;
  metric: string;
  value: number;
  updatedAt: string;
}

interface AppProfileOutput {
  appDid: string;
  documentId: string;
  name: string | null;
  tagline: string | null;
  logo: string | null;
  website: string | null;
  publisherDid: string | null;
  description: string | null;
  category: string | null;
  logoRef: string | null;
  coverRef: string | null;
  links: AppProfileLink[];
}

const forbidden = () =>
  new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
const invalidRequest = (message: string) =>
  new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
/** A profile argument the caller must fix; `field` lets a form show it inline. */
const fieldError = (code: string, field: string, message: string) =>
  new GraphQLError(message, { extensions: { code, field } });
const rateLimited = () =>
  new GraphQLError("Rate limited", { extensions: { code: "RATE_LIMITED" } });
const notConfigured = () =>
  new GraphQLError("renown-stats is not available", {
    extensions: { code: "SERVICE_NOT_CONFIGURED" },
  });

/** Rejects oversized or unsafe legacy profile fields before anything is written ("" means clear). */
function assertProfileFields(fields: ProfileFields): void {
  for (const key of ["name", "tagline", "website", "logo"] as const) {
    const value = fields[key];
    if (value != null && value.length > MAX_LENGTH[key]) {
      throw fieldError("BAD_USER_INPUT", key, `${key} exceeds ${MAX_LENGTH[key]} characters`);
    }
  }
  const website = fields.website?.trim();
  if (website && !isWebsite(website))
    throw fieldError("BAD_USER_INPUT", "website", "website must be an http(s) URL");
  const logo = fields.logo?.trim();
  if (logo && !isLogo(logo))
    throw fieldError(
      "BAD_USER_INPUT",
      "logo",
      "logo must be an https URL or a base64 image data URL",
    );
}

/** The image refs a patch changes, for the media index; null when it changes none. */
function imagesPatch(patch: RichProfilePatch): AppImagesPatch | null {
  if (patch.logoRef === undefined && patch.coverRef === undefined) return null;
  return {
    ...(patch.logoRef === undefined ? {} : { logoRef: patch.logoRef || null }),
    ...(patch.coverRef === undefined ? {} : { coverRef: patch.coverRef || null }),
  };
}

/** The opaque appProfiles cursor: base64url of {t: createdAt ISO, d: appDid}. */
function encodeCursor(cursor: AppProfileCursor): string {
  return Buffer.from(
    JSON.stringify({ t: cursor.createdAt.toISOString(), d: cursor.appDid }),
  ).toString("base64url");
}

function decodeCursor(raw: string): AppProfileCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      t?: unknown;
      d?: unknown;
    };
    const createdAt = new Date(typeof parsed.t === "string" ? parsed.t : Number.NaN);
    if (typeof parsed.d !== "string" || Number.isNaN(createdAt.getTime())) {
      throw new Error("malformed cursor");
    }
    return { createdAt, appDid: parsed.d };
  } catch {
    throw invalidRequest("after is not a cursor from appProfiles");
  }
}

export function createResolvers(
  deps: StatsResolverDeps,
): Record<string, unknown> {
  const { reactorClient, relationalDb } = deps;
  const now = deps.now ?? (() => new Date());
  const reportRateLimiter =
    deps.reportRateLimiter ?? createRateLimiter(REPORT_LIMIT, WINDOW_MS);
  const profileRateLimiter =
    deps.profileRateLimiter ?? createRateLimiter(PROFILE_LIMIT, WINDOW_MS);
  const registrationToken = deps.registrationToken ?? (() => null);
  const media = deps.media ?? mediaBackend;
  const lock = createKeyedLock();

  function requireIndex(): StatsIndex {
    const index = deps.index();
    if (!index) throw notConfigured();
    return index;
  }

  /** Applies `actions`; a rejected operation becomes BAD_USER_INPUT with the reducer's message. */
  async function execute(documentId: string, actions: Action[]): Promise<void> {
    const document: PHDocument = await reactorClient.execute(
      documentId,
      "main",
      actions,
    );
    const sent = new Set(actions.map((action) => action.id));
    const failed = Object.values(document.operations)
      .flat()
      .find((operation) => operation.error && sent.has(operation.action.id));
    if (failed?.error)
      throw invalidRequest(`${failed.action.type} failed: ${failed.error}`);
  }

  /** Server-side only: the client always sees the same FORBIDDEN. */
  function warn(what: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[renown-stats] ${what} failed (${reason}); refusing`);
  }

  /** The lowercase owner of the registered workload identity `appDid`; undefined if none or on error. */
  async function ownerOf(appDid: string): Promise<string | undefined> {
    try {
      return await workloadOwner(relationalDb, appDid);
    } catch (error) {
      warn("workload identity lookup", error);
      return undefined;
    }
  }

  /**
   * True when `address` may act as `appDid`: `appDid` is a registered workload
   * identity owned by `address`, and `address` holds a live delegation to it.
   * A delegation alone proves nothing (anyone can self-publish one to any
   * did:key). Never throws.
   */
  async function actsFor(address: string, appDid: string): Promise<boolean> {
    const owner = await ownerOf(appDid);
    if (owner === undefined || owner !== address.toLowerCase()) return false;
    try {
      return await hasDelegation(relationalDb, address, appDid, now());
    } catch (error) {
      warn("delegation lookup", error);
      return false;
    }
  }

  /** The app DID and wallet a header app token claims, or undefined. Never throws. */
  async function appTokenCaller(
    token: string,
  ): Promise<{ appDid: string; address: string } | undefined> {
    try {
      const audience = deps.audience();
      const verified = await verifyAuthBearerToken(token, { audience });
      if (!verified) return undefined;
      // A CI workload token (it carries the `vetra` claim) is for the Vetra
      // CI endpoints, never a stats credential, whatever its audience.
      if ("vetra" in verified.payload) return undefined;
      // did-jwt only checks `aud` when the token has one; we require it.
      const aud = verified.payload.aud;
      if (!(Array.isArray(aud) ? aud.includes(audience) : aud === audience))
        return undefined;
      const appDid = canonicalAppDid(verified.issuer);
      const address = addressOf(
        verified.verifiableCredential.credentialSubject.address,
      );
      if (appDid === null || address === null) return undefined;
      return { appDid, address };
    } catch (error) {
      // Defensive only: verifyAuthBearerToken catches its own failures
      // (console.error-ing them itself) and resolves false, so this branch is
      // not normally reached and does not keep bad tokens out of error logs.
      // If something here does throw, log at debug: anyone can send a token.
      const reason = error instanceof Error ? error.message : String(error);
      console.debug(
        `[renown-stats] app token verification failed (${reason}); refusing`,
      );
      return undefined;
    }
  }

  /**
   * The app DID and wallet the caller presents: the header token whenever the
   * header is present at all (an empty, repeated or invalid header proves
   * nothing and never falls back), else the host bearer's signer and wallet.
   */
  async function presentedCaller(
    ctx: ResolverContext,
  ): Promise<{ appDid: string; address: string } | undefined> {
    const header = ctx.headers?.[APP_TOKEN_HEADER];
    if (header === undefined) {
      const appDid = ctx.user?.appKey;
      const address = ctx.user?.address ? addressOf(ctx.user.address) : null;
      return appDid && address ? { appDid, address } : undefined;
    }
    if (typeof header !== "string") return undefined;
    const token = header.trim().replace(/^Bearer\s+/i, "");
    return token === "" ? undefined : appTokenCaller(token);
  }

  /** True when the caller proves it is `appDid`, acting for that identity's owner. */
  async function provesApp(
    ctx: ResolverContext,
    appDid: string,
  ): Promise<boolean> {
    const caller = await presentedCaller(ctx);
    if (caller?.appDid !== appDid) return false;
    return actsFor(caller.address, appDid);
  }

  /**
   * "absent" without the relay header, "valid" when it carries the configured
   * registration token, else "invalid" (a wrong, empty or repeated header, or
   * no token configured) — which never falls back to the app-key rule.
   */
  function relayHeader(ctx: ResolverContext): "absent" | "valid" | "invalid" {
    const header = ctx.headers?.[REGISTRAR_HEADER];
    if (header === undefined) return "absent";
    const token = registrationToken();
    return typeof header === "string" &&
      token !== null &&
      constantTimeEqual(header, token)
      ? "valid"
      : "invalid";
  }

  /** INVALID_IMAGE unless every image ref the patch sets is a stored image within its limits. */
  async function assertImages(patch: RichProfilePatch): Promise<void> {
    for (const [field, purpose] of IMAGE_FIELDS) {
      const ref = patch[field];
      if (!ref) continue;
      const backend = media();
      if (!backend) {
        throw new GraphQLError("Image uploads are not available", {
          extensions: { code: "SERVICE_UNAVAILABLE" },
        });
      }
      const problem = await storedImageProblem(ref, backend, purpose);
      if (problem) throw fieldError("INVALID_IMAGE", field, `Invalid ${purpose}: ${problem}`);
    }
  }

  /** The actions that apply `fields` and `patch` to the profile document. */
  async function profileWrite(
    documentId: string,
    fields: ProfileFields,
    patch: RichProfilePatch,
  ): Promise<Action[]> {
    const scalars = {
      ...fields,
      description: patch.description,
      category: patch.category,
      logoRef: patch.logoRef,
      coverRef: patch.coverRef,
    };
    const actions: Action[] = [];
    if (Object.values(scalars).some((value) => value != null)) {
      actions.push(profileActions.setProfile(scalars));
    }
    if (patch.links) {
      const document =
        await reactorClient.get<RenownAppProfileDocument>(documentId);
      // Profiles from before links existed have no list at all.
      const current =
        (document.state.global as { links?: AppProfileLink[] }).links ?? [];
      actions.push(...appLinkActions(current, patch.links));
    }
    return actions;
  }

  /** The user's stats document, created (and bound to the user) on first use. */
  async function userStatsDocument(
    index: StatsIndex,
    userDid: string,
  ): Promise<string> {
    const existing = await index.userStatsDocument(userDid);
    if (existing) return existing;
    const created = (
      await reactorClient.createEmpty(renownUserStatsDocumentType)
    ).header.id;
    // Bind before claiming: a claimed document always has its user DID.
    await execute(created, [statsActions.setUserDid({ userDid })]);
    return index.claimUserStatsDocument(userDid, created, now());
  }

  async function profileOutput(
    entry: AppProfileEntry,
  ): Promise<AppProfileOutput> {
    const doc = await reactorClient.get<RenownAppProfileDocument>(
      entry.documentId,
    );
    // Profiles from before the rich fields have none of their keys.
    const state = doc.state.global as Partial<
      RenownAppProfileDocument["state"]["global"]
    >;
    return {
      appDid: entry.appDid,
      documentId: entry.documentId,
      name: state.name ?? null,
      tagline: state.tagline ?? null,
      logo: state.logo ?? null,
      website: state.website ?? null,
      publisherDid: state.publisherDid ?? null,
      description: state.description ?? null,
      category: state.category ?? null,
      logoRef: state.logoRef ?? null,
      coverRef: state.coverRef ?? null,
      links: (state.links ?? []).map(({ id, label, url }) => ({
        id,
        label,
        url,
      })),
    };
  }

  return {
    Query: {
      userStats: async (
        _: unknown,
        args: { userDid: string },
      ): Promise<UserStatOutput[]> => {
        const userDid = canonicalUserDid(args.userDid);
        if (userDid === null)
          throw invalidRequest(
            "userDid must be a did:pkh:eip155 or did:key DID",
          );
        const documentId = await requireIndex().userStatsDocument(userDid);
        if (!documentId) return [];
        const doc =
          await reactorClient.get<RenownUserStatsDocument>(documentId);
        return doc.state.global.stats.map(
          ({ appDid, metric, value, updatedAt }) => ({
            appDid,
            metric,
            value,
            updatedAt,
          }),
        );
      },

      appProfile: async (
        _: unknown,
        args: { appDid: string },
      ): Promise<AppProfileOutput | null> => {
        const appDid = canonicalAppDid(args.appDid);
        if (appDid === null)
          throw invalidRequest("appDid must be a did:key DID");
        const entry = await requireIndex().appProfile(appDid);
        return entry ? profileOutput(entry) : null;
      },

      appProfilesByPublisher: async (
        _: unknown,
        args: { publisherDid: string },
      ): Promise<AppProfileOutput[]> => {
        const address = addressOf(args.publisherDid);
        if (address === null)
          throw invalidRequest(
            "publisherDid must be a did:pkh:eip155 DID or an address",
          );
        const entries = await requireIndex().appProfilesByPublisher(address);
        return Promise.all(entries.map(profileOutput));
      },

      appProfiles: async (
        _: unknown,
        args: { limit?: number | null; after?: string | null },
      ): Promise<{ items: AppProfileOutput[]; next: string | null }> => {
        const limit = args.limit ?? DEFAULT_PAGE;
        if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE) {
          throw invalidRequest(`limit must be 1-${MAX_PAGE}`);
        }
        const after = args.after ? decodeCursor(args.after) : undefined;
        const entries = await requireIndex().appProfilesPage(limit + 1, after);
        const page = entries.slice(0, limit);
        const last = page.at(-1);
        return {
          items: await Promise.all(page.map(profileOutput)),
          next:
            entries.length > limit && last
              ? encodeCursor({ createdAt: last.createdAt, appDid: last.appDid })
              : null,
        };
      },
    },

    Mutation: {
      reportUserStat: async (
        _: unknown,
        args: ReportUserStatArgs,
        ctx: ResolverContext,
      ): Promise<boolean> => {
        const appDid = canonicalAppDid(args.appDid);
        if (appDid === null)
          throw invalidRequest("appDid must be a did:key DID");
        if (!(await provesApp(ctx, appDid))) throw forbidden();

        const userDid = canonicalUserDid(args.userDid);
        if (userDid === null)
          throw invalidRequest(
            "userDid must be a did:pkh:eip155 or did:key DID",
          );
        if (!isMetricName(args.metric))
          throw invalidRequest(
            "metric must match ^[A-Za-z][A-Za-z0-9_.:-]{0,63}$",
          );
        if (!Number.isFinite(args.value))
          throw invalidRequest("value must be a finite number");
        const index = requireIndex();
        if (!reportRateLimiter.take(appDid, now().getTime()))
          throw rateLimited();

        await lock(`user:${userDid}`, async () => {
          const documentId = await userStatsDocument(index, userDid);
          // Stats are current values: an unchanged value appends no operation.
          const current = await reactorClient.get<RenownUserStatsDocument>(
            documentId,
          );
          const stored = current.state.global.stats.find(
            (stat) => stat.appDid === appDid && stat.metric === args.metric,
          );
          if (stored?.value === args.value) return;
          await execute(documentId, [
            statsActions.setStat({
              id: generateId(),
              appDid,
              metric: args.metric,
              value: args.value,
              updatedAt: now().toISOString(),
            }),
          ]);
        });
        return true;
      },

      upsertAppProfile: async (
        _: unknown,
        args: UpsertAppProfileArgs,
        ctx: ResolverContext,
      ): Promise<boolean> => {
        const appDid = canonicalAppDid(args.appDid);
        if (appDid === null)
          throw invalidRequest("appDid must be a did:key DID");
        const caller = ctx.user?.address?.toLowerCase();
        if (!caller) throw forbidden();
        // Which client may write: the Vetra relay (registration token, plus
        // the publisher's own bearer), or a bearer signed by a listed app key.
        // A browser's bearer alone never qualifies: its did:key is random per
        // browser and any site the wallet signed into can mint one.
        const relay = relayHeader(ctx);
        if (relay === "invalid") throw forbidden();
        if (relay === "absent") {
          const appKey = ctx.user?.appKey;
          if (!appKey || !deps.profileApps().has(appKey)) throw forbidden();
        }
        const fields: ProfileFields = {
          name: args.name,
          tagline: args.tagline,
          logo: args.logo,
          website: args.website,
        };
        assertProfileFields(fields);
        let patch: RichProfilePatch;
        try {
          patch = toRichProfilePatch(args);
        } catch (error) {
          if (error instanceof AppProfileInputError)
            throw fieldError("BAD_USER_INPUT", error.field, error.message);
          throw error;
        }
        const index = requireIndex();
        if (!profileRateLimiter.take(caller, now().getTime()))
          throw rateLimited();

        await lock(`app:${appDid}`, async () => {
          let entry = await index.appProfile(appDid);
          // Only the registered identity's owner may claim a profile, and only
          // its publisher may edit one. A delegation is no proof: anyone can
          // self-publish one to any did:key.
          const allowed = entry
            ? entry.publisherAddress === caller
            : (await ownerOf(appDid)) === caller;
          if (!allowed) throw forbidden();
          await assertImages(patch);
          if (!entry) {
            const created = (
              await reactorClient.createEmpty(renownAppProfileDocumentType)
            ).header.id;
            await execute(created, [
              profileActions.setAppDid({ appDid }),
              profileActions.setPublisherDid({
                publisherDid: pkhDidFor(caller),
              }),
            ]);
            entry = await index.claimAppProfile(
              { appDid, documentId: created, publisherAddress: caller },
              now(),
            );
            if (entry.publisherAddress !== caller) throw forbidden();
          }
          const actions = await profileWrite(entry.documentId, fields, patch);
          if (actions.length > 0) await execute(entry.documentId, actions);
          const images = imagesPatch(patch);
          if (images) await index.setAppImages(entry.documentId, images, now());
        });
        return true;
      },
    },
  };
}
```

In `subgraphs/renown-stats/index.ts`, replace:

```ts
import { statsAudience, statsProfileApps } from "./core/config.js";
```

with:

```ts
import {
  statsAudience,
  statsProfileApps,
  statsRegistrationToken,
} from "./core/config.js";
```

and replace:

```ts
    profileApps: () => (this.#profileApps ??= statsProfileApps(process.env)),
  });
```

with:

```ts
    profileApps: () => (this.#profileApps ??= statsProfileApps(process.env)),
    // The Vetra relay's credential; read per call (cheap, and follows a rotated secret on restart).
    registrationToken: () => statsRegistrationToken(process.env),
  });
```

In `subgraphs/renown-stats/README.md`:
1. Replace the table row that starts with `` | `upsertAppProfile(appDid, …)` | `` with:

```markdown
| `upsertAppProfile(appDid, …)` | The publisher's own wallet bearer (`Authorization`), **plus** either the Renown workload registration token in `X-Renown-Workload-Registration-Token` (the Vetra relay: vetra.io → `vetraPublisher.updateAppProfile` → here) or a bearer signed by an app key listed in `RENOWN_STATS_PROFILE_APPS` (server-held stable keys only; unset in every tenant). The first upsert needs the wallet to be the workload identity's `ownerAddress` and makes it the publisher; later upserts need the same wallet. |
```

2. Replace the bullet that starts with `- A host bearer from any app not listed in` with:

```markdown
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
```

3. Replace the line `Reads are public. Stats are current values per (app, metric): resending an unchanged value is a no-op (no operation is appended).` with:

```markdown
Reads are public: `appProfile`, `appProfilesByPublisher` and `appProfiles(limit, after)` (newest first, `limit` 1–50, opaque `next` cursor). Profile fields: `name, tagline, logo` (legacy URL), `website, description` (markdown subset, ≤ 2000), `category` (≤ 40), `logoRef, coverRef, links` (≤ 8). Stats are current values per (app, metric): resending an unchanged value is a no-op (no operation is appended).
```

4. In the Environment table, replace the `RENOWN_STATS_PROFILE_APPS` row with these two rows:

```markdown
| `RENOWN_STATS_PROFILE_APPS` | Comma-separated app DIDs (`did:key:z…`, trimmed) whose host bearers may call `upsertAppProfile` without the relay. Only for server-held stable keys; browsers sign with random keys. | unset |
| `RENOWN_WORKLOAD_REGISTRATION_TOKEN` | Shared with renown-workload. Its holder (Vetra) may relay `upsertAppProfile` for the wallet whose bearer it forwards. | unset: relay off |
```

- [ ] **Step 4: Run everything.** `pnpm exec vitest run subgraphs/renown-stats subgraphs/renown-auth media 2>&1 | tail -20` → PASS (the existing 1 278-line `resolvers.test.ts` green apart from the edited expectation; Phase 1's `profile-identity.test.ts` unchanged and green). `pnpm exec vitest run --coverage 2>&1 | grep -E "ERROR|Threshold|All files"` → thresholds pass. `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/renown-auth/core/profile-patch.ts subgraphs/renown-stats/core/config.ts subgraphs/renown-stats/core/app-profile-patch.ts subgraphs/renown-stats/schema.ts subgraphs/renown-stats/resolvers.ts subgraphs/renown-stats/index.ts subgraphs/renown-stats/README.md subgraphs/renown-stats/tests/resolvers.test.ts subgraphs/renown-stats/tests/app-profile-rich.test.ts
git commit -m "feat(renown-stats): rich app profiles through the Vetra relay, appProfiles listing"
```

## Part B — vetra-cloud-package (the relay)

### Task 5: `vetraPublisher.updateAppProfile` relay and `myApps.identityDid`

**Files** (repo `/home/f/projects/vetra-cloud-package-profiles`):
- Create: `subgraphs/vetra-licensing/renown-profile.ts`
- Modify: `subgraphs/vetra-licensing/publisher-schema.ts`, `subgraphs/vetra-licensing/publisher-resolvers.ts`, `subgraphs/vetra-licensing/publisher-auth.ts`, `subgraphs/vetra-licensing/owner-apps.ts`, `subgraphs/vetra-licensing/index.ts`, `docs/superpowers/specs/2026-10-08-licensing-api-contract.md`, `subgraphs/vetra-licensing/__tests__/publisher-api.test.ts` (one expectation)
- Test: `subgraphs/vetra-licensing/__tests__/renown-profile.test.ts`, `subgraphs/vetra-licensing/__tests__/app-profile-relay.test.ts`

**Interfaces:**
- Consumes: Task 4's renown-stats mutation (`upsertAppProfile(appDid, name, tagline, website, description, category, logoRef, coverRef, links)`, codes `FORBIDDEN | BAD_USER_INPUT | INVALID_IMAGE | RATE_LIMITED | SERVICE_UNAVAILABLE | SERVICE_NOT_CONFIGURED`, `extensions.field`); `REGISTRATION_TOKEN_HEADER` (`subgraphs/vetra-apps/renown.ts`); `loadAppsConfig(process.env).renown?.registrationToken`; `cfg.renownStatsUrl` (`RENOWN_STATS_URL`); `resolveOwnerApp`, `toLicensingGraphQLError`.
- Produces:
  - `createRenownProfileRelay({ statsUrl, registrationToken, fetch?, timeoutMs? }): RenownProfileRelay | null`; `RenownProfileRelay.upsert(appDid, bearer, fields: AppProfileWrite): Promise<void>`; `RenownProfileError(code, message, field = null)`; `PROFILE_WRITE_KEYS`.
  - GraphQL on Vetra's switchboard: `type PublisherApp { …, identityDid: String }`; `input PublisherAppLinkInput { id: String! label: String! url: String! }`; `input UpdateAppProfileInput { appId: String!, name, tagline, website, description, category, logoRef, coverRef: String, links: [PublisherAppLinkInput!] }`; `VetraPublisherMutations.updateAppProfile(input: UpdateAppProfileInput!): Boolean!`.
  - Wire codes from `updateAppProfile`: `UNAUTHENTICATED`, `NOT_FOUND`, `APP_NOT_ACTIVE` (ownership, as every publisher field), `INVALID_INPUT` + `extensions.field`, `FORBIDDEN`, `RATE_LIMITED`, `NO_IDENTITY`, `PROFILE_UNAVAILABLE`.
  - `OwnerAppRecord.identity_did?: string | null`.

- [ ] **Step 0: Worktree.**

```bash
git -C /home/f/projects/vetra-cloud-package fetch origin
git -C /home/f/projects/vetra-cloud-package worktree add /home/f/projects/vetra-cloud-package-profiles -b feat/identity-hub-profiles origin/main
cd /home/f/projects/vetra-cloud-package-profiles && pnpm install --frozen-lockfile 2>&1 | tail -3
```

- [ ] **Step 1: Write the failing tests.**

Create `subgraphs/vetra-licensing/__tests__/renown-profile.test.ts` with exactly:

```ts
import { describe, expect, it, vi } from "vitest";
import { createRenownProfileRelay, RenownProfileError } from "../renown-profile.js";

const URL_ = "https://switchboard.renown-staging.vetra.io/graphql/renown-stats";
const DID = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";

function answering(status: number, body: unknown) {
  return vi.fn(async (_url: string, _init: RequestInit) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status }),
  );
}

async function refusal(promise: Promise<unknown>): Promise<RenownProfileError> {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(RenownProfileError);
  return error as RenownProfileError;
}

describe("createRenownProfileRelay", () => {
  it("is off without a stats URL or a registration token", () => {
    expect(createRenownProfileRelay({ statsUrl: null, registrationToken: "t" })).toBeNull();
    expect(createRenownProfileRelay({ statsUrl: URL_, registrationToken: null })).toBeNull();
  });

  it("forwards the bearer and the registration token with only the given fields", async () => {
    const fetch = answering(200, { data: { upsertAppProfile: true } });
    const relay = createRenownProfileRelay({ statsUrl: URL_, registrationToken: "reg", fetch: fetch as never })!;
    await relay.upsert(DID, "user-bearer", {
      name: "Vault",
      description: "",
      links: [{ id: "l1", label: "Docs", url: "https://docs.example" }],
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(URL_);
    expect(init.headers).toMatchObject({
      authorization: "Bearer user-bearer",
      "x-renown-workload-registration-token": "reg",
    });
    const body = JSON.parse(init.body as string) as { query: string; variables: Record<string, unknown> };
    expect(body.query).toContain("upsertAppProfile(appDid: $appDid");
    expect(body.variables).toEqual({
      appDid: DID,
      name: "Vault",
      description: "",
      links: [{ id: "l1", label: "Docs", url: "https://docs.example" }],
    });
  });

  it.each([
    ["BAD_USER_INPUT", "description", "INVALID_INPUT", "description"],
    ["INVALID_IMAGE", "logoRef", "INVALID_INPUT", "logoRef"],
    ["FORBIDDEN", undefined, "FORBIDDEN", null],
    ["RATE_LIMITED", undefined, "RATE_LIMITED", null],
    ["UNAUTHENTICATED", undefined, "UNAUTHENTICATED", null],
    ["SERVICE_UNAVAILABLE", undefined, "PROFILE_UNAVAILABLE", null],
    ["SERVICE_NOT_CONFIGURED", undefined, "PROFILE_UNAVAILABLE", null],
  ])("maps Renown's %s", async (renownCode, field, code, expectedField) => {
    const fetch = answering(200, {
      data: null,
      errors: [{ message: "Description must be at most 2000 characters", extensions: { code: renownCode, field } }],
    });
    const relay = createRenownProfileRelay({ statsUrl: URL_, registrationToken: "reg", fetch: fetch as never })!;
    const error = await refusal(relay.upsert(DID, "b", { description: "x" }));
    expect(error.code).toBe(code);
    expect(error.field).toBe(expectedField);
    if (code === "INVALID_INPUT") expect(error.message).toBe("Description must be at most 2000 characters");
  });

  it("maps a bare 401, a 5xx, a non-true answer and a network failure", async () => {
    const make = (fetch: unknown) =>
      createRenownProfileRelay({ statsUrl: URL_, registrationToken: "reg", fetch: fetch as never })!;
    expect((await refusal(make(answering(401, undefined)).upsert(DID, "b", {}))).code).toBe("UNAUTHENTICATED");
    expect((await refusal(make(answering(502, undefined)).upsert(DID, "b", {}))).code).toBe("PROFILE_UNAVAILABLE");
    expect((await refusal(make(answering(200, { data: { upsertAppProfile: false } })).upsert(DID, "b", {}))).code).toBe(
      "PROFILE_UNAVAILABLE",
    );
    const down = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect((await refusal(make(down).upsert(DID, "b", {}))).code).toBe("PROFILE_UNAVAILABLE");
  });
});
```

Create `subgraphs/vetra-licensing/__tests__/app-profile-relay.test.ts` with exactly:

```ts
import type { GraphQLError } from "graphql";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { RenownProfileError, type RenownProfileRelay } from "../renown-profile.js";
import { asUser, codeOf, createPublisherHarness, type PublisherHarness, type Resolvers } from "./publisher-harness.js";

const OWNER = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER = "0x2222222222222222222222222222222222222222";
const APP = "7c1d2e3f-5d0e-4e3e-9a55-1c3b9b8f2a44";
const BARE = "8d1d2e3f-5d0e-4e3e-9a55-1c3b9b8f2a55";
const DID = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";

let h: PublisherHarness;

beforeAll(async () => {
  h = await createPublisherHarness();
  await h.addApp(APP, OWNER);
  await h.addApp(BARE, OWNER);
  const row = h.rows.get(APP);
  if (row) h.rows.set(APP, { ...row, identity_did: DID });
});

const withBearer = (address: string) => ({ ...asUser(address), headers: { authorization: "Bearer user-bearer" } });

function relay(upsert: RenownProfileRelay["upsert"] = async () => undefined) {
  return { upsert: vi.fn(upsert) };
}

const update = (r: Resolvers, input: Record<string, unknown>, ctx: unknown) =>
  r.VetraPublisherMutations.updateAppProfile!({}, { input }, ctx);

describe("vetraPublisher.updateAppProfile", () => {
  it("forwards the owner's bearer and the fields for the app's Renown identity", async () => {
    const fake = relay();
    const input = { appId: APP, name: "Vault", links: [{ id: "l1", label: "Docs", url: "https://docs.example" }] };
    expect(await update(h.build({ renownProfile: fake }), input, withBearer(OWNER))).toBe(true);
    expect(fake.upsert).toHaveBeenCalledWith(DID, "user-bearer", input);
  });

  it("lists each app's identity DID in myApps", async () => {
    const apps = (await h.build().VetraPublisherQueries.myApps!({}, {}, asUser(OWNER))) as {
      id: string;
      identityDid: string | null;
    }[];
    expect(apps.find((a) => a.id === APP)?.identityDid).toBe(DID);
    expect(apps.find((a) => a.id === BARE)?.identityDid).toBeNull();
  });

  it.each([
    ["another wallet", () => withBearer(OTHER), APP, "NOT_FOUND"],
    ["a call without a bearer header", () => asUser(OWNER), APP, "UNAUTHENTICATED"],
    ["an app without a Renown identity", () => withBearer(OWNER), BARE, "NO_IDENTITY"],
  ])("refuses %s without calling Renown", async (_, ctx, appId, code) => {
    const fake = relay();
    expect(await codeOf(update(h.build({ renownProfile: fake }), { appId, name: "x" }, ctx()))).toBe(code);
    expect(fake.upsert).not.toHaveBeenCalled();
  });

  it("answers PROFILE_UNAVAILABLE when the relay is not configured", async () => {
    expect(await codeOf(update(h.build({ renownProfile: null }), { appId: APP, name: "x" }, withBearer(OWNER)))).toBe(
      "PROFILE_UNAVAILABLE",
    );
  });

  it("passes Renown's refusal through with the field to fix", async () => {
    const fake = relay(async () => {
      throw new RenownProfileError("INVALID_INPUT", "Description must be at most 2000 characters", "description");
    });
    const error = (await update(h.build({ renownProfile: fake }), { appId: APP, description: "x" }, withBearer(OWNER)).catch(
      (e: unknown) => e,
    )) as GraphQLError;
    expect(error.extensions).toEqual({ code: "INVALID_INPUT", field: "description" });
    expect(error.message).toBe("Description must be at most 2000 characters");
  });
});
```

Update the existing `myApps` expectation in `subgraphs/vetra-licensing/__tests__/publisher-api.test.ts`: replace

```ts
      { id: APP, name: `App ${APP.slice(0, 4)}`, status: "ACTIVE" },
      { id: HELD, name: `App ${HELD.slice(0, 4)}`, status: "ACTIVE" },
```

with:

```ts
      { id: APP, name: `App ${APP.slice(0, 4)}`, status: "ACTIVE", identityDid: null },
      { id: HELD, name: `App ${HELD.slice(0, 4)}`, status: "ACTIVE", identityDid: null },
```

- [ ] **Step 2: Run them to see them fail.** `pnpm exec vitest run subgraphs/vetra-licensing/__tests__/renown-profile.test.ts subgraphs/vetra-licensing/__tests__/app-profile-relay.test.ts subgraphs/vetra-licensing/__tests__/publisher-api.test.ts 2>&1 | tail -20` → FAIL (`Cannot find module '../renown-profile.js'`; `myApps` lacks `identityDid`).

- [ ] **Step 3: Implement.**

Create `subgraphs/vetra-licensing/renown-profile.ts` with exactly:

```ts
import { REGISTRATION_TOKEN_HEADER } from "../vetra-apps/renown.js";

/**
 * The Renown app-profile relay (identity hub phase 2).
 *
 * renown-stats writes an app profile only for a caller that presents BOTH the
 * publisher's own Renown bearer (Authorization; its wallet must own the app's
 * workload identity) AND the workload registration token Vetra already holds
 * (X-Renown-Workload-Registration-Token). Browser bearers are signed by random
 * per-browser keys, so Renown cannot tell vetra.io from any other site; the
 * token can. vetra.io calls vetraPublisher.updateAppProfile, Vetra checks the
 * caller owns the app, then forwards here to
 *   mutation { upsertAppProfile(appDid: String!, …): Boolean! }
 */

export interface AppProfileLinkInput {
  id: string;
  label: string;
  url: string;
}

/** What a publisher may change. Absent or null: unchanged; "": clear; links: the whole list. */
export interface AppProfileWrite {
  name?: string | null;
  tagline?: string | null;
  website?: string | null;
  description?: string | null;
  category?: string | null;
  logoRef?: string | null;
  coverRef?: string | null;
  links?: AppProfileLinkInput[] | null;
}

export const PROFILE_WRITE_KEYS = [
  "name",
  "tagline",
  "website",
  "description",
  "category",
  "logoRef",
  "coverRef",
  "links",
] as const;

/** A refusal shown to the publisher: `code` is the wire code, `field` the input to fix. */
export class RenownProfileError extends Error {
  override name = "RenownProfileError";
  constructor(
    readonly code: string,
    message: string,
    readonly field: string | null = null,
  ) {
    super(message);
  }
}

export interface RenownProfileRelay {
  /** Writes `fields` to `appDid`'s profile as the bearer's wallet. Throws RenownProfileError. */
  upsert(appDid: string, bearer: string, fields: AppProfileWrite): Promise<void>;
}

export interface RenownProfileRelayConfig {
  /** RENOWN_STATS_URL. Null: profiles off. */
  statsUrl: string | null;
  /** RENOWN_WORKLOAD_REGISTRATION_TOKEN. Null: profiles off. */
  registrationToken: string | null;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const UPSERT = `mutation UpsertAppProfile($appDid: String!, $name: String, $tagline: String, $website: String, $description: String, $category: String, $logoRef: String, $coverRef: String, $links: [AppProfileLinkInput!]) {
  upsertAppProfile(appDid: $appDid, name: $name, tagline: $tagline, website: $website, description: $description, category: $category, logoRef: $logoRef, coverRef: $coverRef, links: $links)
}`;

const UNAVAILABLE = "Renown is not reachable right now. Try again in a minute.";

/** Renown's answer, as the publisher surface states it. */
function refusal(code: unknown, message: string, field: unknown): RenownProfileError {
  switch (code) {
    case "BAD_USER_INPUT":
    case "INVALID_IMAGE":
      return new RenownProfileError("INVALID_INPUT", message, typeof field === "string" ? field : null);
    case "FORBIDDEN":
      return new RenownProfileError(
        "FORBIDDEN",
        "Renown refused: this wallet does not own the app's Renown identity.",
      );
    case "RATE_LIMITED":
      return new RenownProfileError("RATE_LIMITED", "Too many profile saves. Wait a minute and try again.");
    case "UNAUTHENTICATED":
      return new RenownProfileError("UNAUTHENTICATED", "Your login has expired. Log in again and retry.");
    default:
      return new RenownProfileError("PROFILE_UNAVAILABLE", UNAVAILABLE);
  }
}

type UpsertBody = {
  data?: { upsertAppProfile?: unknown } | null;
  errors?: { message?: string; extensions?: { code?: unknown; field?: unknown } }[];
} | null;

export function createRenownProfileRelay(cfg: RenownProfileRelayConfig): RenownProfileRelay | null {
  if (!cfg.statsUrl || !cfg.registrationToken) return null;
  const statsUrl = cfg.statsUrl;
  const registrationToken = cfg.registrationToken;
  const fetchImpl = cfg.fetch ?? fetch;
  const timeoutMs = cfg.timeoutMs ?? 10_000;

  return {
    async upsert(appDid, bearer, fields) {
      const variables: Record<string, unknown> = { appDid };
      for (const key of PROFILE_WRITE_KEYS) {
        if (fields[key] !== undefined) variables[key] = fields[key];
      }
      let res: Response;
      try {
        res = await fetchImpl(statsUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${bearer}`,
            [REGISTRATION_TOKEN_HEADER]: registrationToken,
          },
          body: JSON.stringify({ query: UPSERT, variables }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new RenownProfileError("PROFILE_UNAVAILABLE", UNAVAILABLE);
      }
      const body = (await res.json().catch(() => null)) as UpsertBody;
      const error = body?.errors?.[0];
      if (error) {
        throw refusal(
          error.extensions?.code,
          (error.message ?? "").trim() || "Renown refused the profile.",
          error.extensions?.field,
        );
      }
      if (res.status === 401) throw refusal("UNAUTHENTICATED", "", null);
      if (!res.ok || body?.data?.upsertAppProfile !== true) throw refusal(null, "", null);
    },
  };
}
```

In `subgraphs/vetra-licensing/publisher-auth.ts`, replace:

```ts
export interface OwnerAppRecord {
  id: string;
  name: string;
  status: string;
  owner_address: string;
}
```

with:

```ts
export interface OwnerAppRecord {
  id: string;
  name: string;
  status: string;
  owner_address: string;
  /** The app's Renown workload identity (did:key); absent/null before one exists. */
  identity_did?: string | null;
}
```

In `subgraphs/vetra-licensing/owner-apps.ts`, replace:

```ts
    return {
      id: STUDIO_APP_ID,
      name: doc.name ?? doc.slug ?? STUDIO_APP_ID,
      status: "ACTIVE",
      owner_address: deps.studioPublisher,
    };
```

with:

```ts
    return {
      id: STUDIO_APP_ID,
      name: doc.name ?? doc.slug ?? STUDIO_APP_ID,
      status: "ACTIVE",
      owner_address: deps.studioPublisher,
      // Only used to address its Renown profile; Renown itself checks that the
      // caller's wallet owns this identity.
      ...(doc.identityDid ? { identity_did: doc.identityDid } : {}),
    };
```

In `subgraphs/vetra-licensing/index.ts`:
1. In both `appsDb.selectFrom("apps").select(["id", "name", "status", "owner_address"])` calls inside `createOwnerAppLookup({ table: { byId, byOwner } })`, change the column list to `["id", "name", "status", "owner_address", "identity_did"]`.
2. Add the import below `import { createPublisherResolvers } from "./publisher-resolvers.js";`:

```ts
import { createRenownProfileRelay } from "./renown-profile.js";
```

3. In the `createPublisherResolvers({ … })` call, replace:

```ts
      newId: () => randomUUID(),
      now: () => new Date().toISOString(),
    }) as Record<string, Record<string, unknown>>;
```

with:

```ts
      newId: () => randomUUID(),
      now: () => new Date().toISOString(),
      // App profiles on Renown, relayed with the registration token. Off
      // while RENOWN_STATS_URL or RENOWN_WORKLOAD_REGISTRATION_TOKEN is unset.
      renownProfile: createRenownProfileRelay({
        statsUrl: cfg.renownStatsUrl,
        registrationToken: loadAppsConfig(process.env).renown?.registrationToken ?? null,
      }),
    }) as Record<string, Record<string, unknown>>;
```

(If the first `newId: () => randomUUID(),` match is ambiguous, it is the one directly inside `createPublisherResolvers({`, around line 246.)

In `subgraphs/vetra-licensing/publisher-schema.ts`, replace:

```ts
  type PublisherApp {
    id: String!
    name: String!
    status: String!
  }
```

with:

```ts
  type PublisherApp {
    id: String!
    name: String!
    status: String!
    "The app's Renown identity (did:key); null before one is registered."
    identityDid: String
  }

  input PublisherAppLinkInput {
    id: String!
    label: String!
    url: String!
  }

  "Absent or null: unchanged. Empty string: clear. links replaces the whole list."
  input UpdateAppProfileInput {
    appId: String!
    name: String
    tagline: String
    website: String
    "Markdown subset, at most 2000 characters"
    description: String
    category: String
    "attachment://v1:<sha256> from Renown's upload route"
    logoRef: String
    coverRef: String
    links: [PublisherAppLinkInput!]
  }
```

and replace:

```ts
    removeFromAllowList(appId: String!, user: String!): Boolean!
  }
```

with:

```ts
    removeFromAllowList(appId: String!, user: String!): Boolean!
    """
    Writes the app's public Renown profile (through Renown's relay).
    Errors: INVALID_INPUT (extensions.field), FORBIDDEN, NO_IDENTITY,
    RATE_LIMITED, PROFILE_UNAVAILABLE, plus the ownership codes.
    """
    updateAppProfile(input: UpdateAppProfileInput!): Boolean!
  }
```

In `subgraphs/vetra-licensing/publisher-resolvers.ts`:
1. Add imports below `import type { Action } from "document-model";`:

```ts
import { GraphQLError } from "graphql";
```

and below `import { normaliseUserDid } from "./did.js";`:

```ts
import { RenownProfileError, type AppProfileWrite, type RenownProfileRelay } from "./renown-profile.js";
```

2. In `interface PublisherDeps`, after `cfg: Pick<LicensingConfig, "enabled">;`, add:

```ts
  /** App profiles on Renown. Null or absent: updateAppProfile answers PROFILE_UNAVAILABLE. */
  renownProfile?: RenownProfileRelay | null;
```

3. Replace `type Ctx = AuthContext & { isAdmin?: (a: string) => boolean };` with:

```ts
type Ctx = AuthContext & {
  isAdmin?: (a: string) => boolean;
  headers?: Record<string, string | string[] | undefined>;
};
```

4. After `function callerAddress(ctx: Ctx): string { … }`, add:

```ts
/** The caller's own Renown bearer, forwarded to Renown with a profile write. */
function bearerOf(ctx: Ctx): string {
  const raw = ctx.headers?.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = /^Bearer\s+(\S+)$/i.exec(value ?? "");
  if (!match) throw new UnauthenticatedError("sign in to edit the app profile");
  return match[1];
}
```

5. Replace the `myApps` resolver body line:

```ts
        return apps.map((a) => ({ id: a.id, name: a.name, status: a.status }));
```

with:

```ts
        return apps.map((a) => ({ id: a.id, name: a.name, status: a.status, identityDid: a.identity_did ?? null }));
```

6. In `VetraPublisherMutations`, add as the first field (before `addTemplate`):

```ts
      updateAppProfile: async (
        _p: unknown,
        a: In<{ appId: string } & AppProfileWrite>,
        ctx: Ctx,
      ): Promise<boolean> => {
        try {
          // Ownership exactly as every publisher field; the licensing switch does not apply.
          const appId = await owned(a.input.appId, ctx, false);
          const bearer = bearerOf(ctx);
          if (!deps.renownProfile) {
            throw new RenownProfileError("PROFILE_UNAVAILABLE", "App profiles are not configured on this deployment.");
          }
          const appDid = (await deps.auth.findAppById(appId))?.identity_did ?? null;
          if (!appDid) {
            throw new RenownProfileError(
              "NO_IDENTITY",
              "This app has no Renown identity yet. Authorize its deploy identity first.",
            );
          }
          await deps.renownProfile.upsert(appDid, bearer, a.input);
          return true;
        } catch (err) {
          if (err instanceof RenownProfileError) {
            throw new GraphQLError(err.message, {
              extensions: { code: err.code, ...(err.field ? { field: err.field } : {}) },
            });
          }
          throw toLicensingGraphQLError(err);
        }
      },
```

In `docs/superpowers/specs/2026-10-08-licensing-api-contract.md` (§ vetraPublisher):
1. Replace `type PublisherApp { id: String!  name: String!  status: String! }` with:

```graphql
type PublisherApp { id: String!  name: String!  status: String!  identityDid: String }

input PublisherAppLinkInput { id: String!  label: String!  url: String! }

"Absent or null: unchanged. Empty string: clear. links replaces the whole list."
input UpdateAppProfileInput {
  appId: String!
  name: String  tagline: String  website: String
  description: String  category: String
  logoRef: String  coverRef: String
  links: [PublisherAppLinkInput!]
}
```

2. Replace `  removeFromAllowList(appId: String!, user: String!): Boolean!` (inside `type VetraPublisherMutations`) with:

```graphql
  removeFromAllowList(appId: String!, user: String!): Boolean!
  updateAppProfile(input: UpdateAppProfileInput!): Boolean!   # Renown app profile (relayed)
```

3. Append to the "Error codes" paragraph of the section: `` `updateAppProfile` adds `NO_IDENTITY` (the app has no Renown identity yet), `RATE_LIMITED`, `PROFILE_UNAVAILABLE` (relay off or Renown unreachable) and `INVALID_INPUT` with `extensions.field` naming the input to fix. ``

- [ ] **Step 4: Run tests, types, lint.** `pnpm exec vitest run subgraphs/vetra-licensing 2>&1 | tail -20` → PASS (incl. `contract.test.ts`, `schema-composition.test.ts`, `owner-apps.test.ts`, `publisher-api.test.ts`). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/vetra-licensing/renown-profile.ts subgraphs/vetra-licensing/publisher-schema.ts subgraphs/vetra-licensing/publisher-resolvers.ts subgraphs/vetra-licensing/publisher-auth.ts subgraphs/vetra-licensing/owner-apps.ts subgraphs/vetra-licensing/index.ts docs/superpowers/specs/2026-10-08-licensing-api-contract.md subgraphs/vetra-licensing/__tests__/renown-profile.test.ts subgraphs/vetra-licensing/__tests__/app-profile-relay.test.ts subgraphs/vetra-licensing/__tests__/publisher-api.test.ts
git commit -m "feat(licensing): relay app profile edits to Renown, expose app identity DIDs"
```

## Part C — renown.id

Precondition: Phase 1 Tasks 7–10 merged on `feat/identity-hub` in `/home/f/projects/renown-hub` (`services/media.ts`, `components/profile/*`, `pages/profile/[id].tsx`, `e2e/support/stub-switchboard*.{mjs,ts}` with `fixtureStub`). `cd /home/f/projects/renown-hub && git switch feat/identity-hub && git pull --ff-only`. Stop a dev server you started earlier before running Playwright.

### Task 6: App profile reads, `logo`/`cover` media fields, markdown subset

**Files:**
- Create: `services/app-profiles.ts`, `utils/markdown-lite.ts`, `components/app/markdown-lite.tsx`
- Modify: `services/media.ts`, `e2e/support/stub-switchboard.mjs`
- Test: `e2e/markdown-lite.spec.ts`

**Interfaces:**
- Consumes: Task 4 GraphQL (`appProfile`, `appProfilesByPublisher` on `<switchboard>/graphql/renown-stats`); Phase 1 `switchboardOrigin()`, `mediaUrl()`, `MEDIA_FIELDS`.
- Produces:
  - `MEDIA_FIELDS = ['avatar', 'logo', 'cover']` (`services/media.ts`) — `mediaUrl(documentId, 'logo' | 'cover', origin?)` now type-checks.
  - `RenownAppProfile { appDid, documentId, name, tagline, logo, website, publisherDid, description, category, logoRef, coverRef: string | null; links: RenownAppLink[] }`, `RenownAppLink { id, label, url }`, `APP_DID_RE`, `getAppProfile(appDid) → RenownAppProfile | null`, `getAppProfilesByPublisher(address) → RenownAppProfile[]` (`services/app-profiles.ts`; errors → null / []).
  - `Inline`, `Block`, `safeHref(url) → string | null`, `parseInline(text) → Inline[]`, `parseMarkdownLite(source) → Block[]` (`utils/markdown-lite.ts`); `<MarkdownLite text className? />` (`components/app/markdown-lite.tsx`).
  - Stub: `DEFAULT_DATA` gains `appProfile: null`, `appProfilesByPublisher: []`; media route 302s for document `stub-app-doc` fields `logo` and `cover`.

- [ ] **Step 1: Write the failing spec.**

Create `e2e/markdown-lite.spec.ts` with exactly:

```ts
import { test, expect } from '@playwright/test'
import { parseMarkdownLite, safeHref } from '../utils/markdown-lite'

// Runs in the Playwright worker (Node): the description parser behind /app/<did>.
const text = (t: string) => ({ type: 'text', text: t })

test.describe('markdown-lite', () => {
  test('parses headings, paragraphs with line breaks, lists and quotes', () => {
    expect(
      parseMarkdownLite('# Title\n\nLine one\nline two\n\n- a\n* **b**\n\n1. one\n2) two\n\n> quoted\n> more\n### Small'),
    ).toEqual([
      { type: 'heading', level: 1, children: [text('Title')] },
      { type: 'paragraph', children: [text('Line one'), { type: 'break' }, text('line two')] },
      { type: 'list', ordered: false, items: [[text('a')], [{ type: 'strong', children: [text('b')] }]] },
      { type: 'list', ordered: true, items: [[text('one')], [text('two')]] },
      { type: 'quote', children: [text('quoted'), { type: 'break' }, text('more')] },
      { type: 'heading', level: 3, children: [text('Small')] },
    ])
  })

  test('parses inline code, emphasis and safe links only', () => {
    expect(
      parseMarkdownLite(
        'Use `npm i` with *care*, _really_. [Docs](https://docs.example/a) [x](javascript:void0) [m](mailto:a@b.example)',
      ),
    ).toEqual([
      {
        type: 'paragraph',
        children: [
          text('Use '),
          { type: 'code', text: 'npm i' },
          text(' with '),
          { type: 'em', children: [text('care')] },
          text(', '),
          { type: 'em', children: [text('really')] },
          text('. '),
          { type: 'link', href: 'https://docs.example/a', children: [text('Docs')] },
          text(' '),
          text('x'),
          text(' '),
          { type: 'link', href: 'mailto:a@b.example', children: [text('m')] },
        ],
      },
    ])
  })

  test('never turns script-ish input into anything but text', () => {
    expect(parseMarkdownLite('<script>alert(1)</script>\n[e](javascript:alert(1))')).toEqual([
      { type: 'paragraph', children: [text('<script>alert(1)</script>'), { type: 'break' }, text('[e](javascript:alert(1))')] },
    ])
    expect(parseMarkdownLite('')).toEqual([])
    expect(parseMarkdownLite('\r\n\r\n  \n')).toEqual([])
  })

  test('safeHref allows http(s) and mailto only', () => {
    expect(safeHref('https://a.example')).toBe('https://a.example/')
    expect(safeHref('http://a.example/x')).toBe('http://a.example/x')
    expect(safeHref('mailto:x@y.example')).toBe('mailto:x@y.example')
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,hi')).toBeNull()
    expect(safeHref('/relative')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec playwright test e2e/markdown-lite.spec.ts 2>&1 | tail -15` → FAIL (`Cannot find module '../utils/markdown-lite'`).

- [ ] **Step 3: Implement.**

Create `utils/markdown-lite.ts` with exactly:

```ts
// The Markdown subset app descriptions may use, parsed to a small AST that is
// rendered as React elements (components/app/markdown-lite.tsx). There is no
// HTML path at all: unknown syntax, raw HTML and unsafe links stay plain text.
// vetra.io's preview uses a verbatim copy (modules/apps/lib/app-profile/markdown-lite.ts).
//
//   # / ## / ###     headings          - item / * item / 1. item / 1) item   lists
//   > quote          quotes            blank line   paragraph break, newline   line break
//   **bold**  *italic*  _italic_  `code`  [label](https://… | http://… | mailto:…)

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; children: Inline[] }
  | { type: 'break' }

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'quote'; children: Inline[] }

/** The href a link may render with: absolute http(s) or mailto, else null. */
export function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:' ? url.href : null
  } catch {
    return null
  }
}

const INLINE = /`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^()\s]+\)|\*[^*\s][^*\n]*\*|_[^_\s][^_\n]*_/
const LINK = /^\[([^\]\n]+)\]\(([^()\s]+)\)$/

export function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let rest = source
  while (rest.length > 0) {
    const match = INLINE.exec(rest)
    if (!match) {
      out.push({ type: 'text', text: rest })
      break
    }
    if (match.index > 0) out.push({ type: 'text', text: rest.slice(0, match.index) })
    const token = match[0]
    if (token.startsWith('`')) {
      out.push({ type: 'code', text: token.slice(1, -1) })
    } else if (token.startsWith('**')) {
      out.push({ type: 'strong', children: parseInline(token.slice(2, -2)) })
    } else if (token.startsWith('[')) {
      const link = LINK.exec(token)
      const label = link ? link[1] : token
      const href = link ? safeHref(link[2]) : null
      out.push(href ? { type: 'link', href, children: parseInline(label) } : { type: 'text', text: label })
    } else {
      out.push({ type: 'em', children: parseInline(token.slice(1, -1)) })
    }
    rest = rest.slice(match.index + token.length)
  }
  return out
}

const HEADING = /^(#{1,3})\s+(.+)$/
const BULLET = /^\s*[-*]\s+(.+)$/
const NUMBERED = /^\s*\d{1,3}[.)]\s+(.+)$/
const QUOTE = /^>\s?(.*)$/

function isSpecial(line: string): boolean {
  return HEADING.test(line) || BULLET.test(line) || NUMBERED.test(line) || QUOTE.test(line)
}

/** Lines joined by line breaks. */
function withBreaks(lines: string[]): Inline[] {
  const out: Inline[] = []
  lines.forEach((line, i) => {
    if (i > 0) out.push({ type: 'break' })
    out.push(...parseInline(line))
  })
  return out
}

export function parseMarkdownLite(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '') {
      i++
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      const hashes = heading[1].length
      blocks.push({ type: 'heading', level: hashes === 1 ? 1 : hashes === 2 ? 2 : 3, children: parseInline(heading[2].trim()) })
      i++
      continue
    }
    const ordered = NUMBERED.test(line)
    if (ordered || BULLET.test(line)) {
      const pattern = ordered ? NUMBERED : BULLET
      const items: Inline[][] = []
      for (;;) {
        const item = i < lines.length ? pattern.exec(lines[i]) : null
        if (!item) break
        items.push(parseInline(item[1].trim()))
        i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }
    if (QUOTE.test(line)) {
      const quoted: string[] = []
      for (;;) {
        const quote = i < lines.length ? QUOTE.exec(lines[i]) : null
        if (!quote) break
        quoted.push(quote[1].trim())
        i++
      }
      blocks.push({ type: 'quote', children: withBreaks(quoted) })
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && lines[i].trim() !== '' && !isSpecial(lines[i])) {
      paragraph.push(lines[i].trim())
      i++
    }
    blocks.push({ type: 'paragraph', children: withBreaks(paragraph) })
  }
  return blocks
}
```

Create `components/app/markdown-lite.tsx` with exactly:

```tsx
import { Fragment, type ReactNode } from 'react'
import { parseMarkdownLite, type Block, type Inline } from '../../utils/markdown-lite'

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>
      case 'break':
        return <br key={i} />
      case 'code':
        return (
          <code key={i} className="bg-foreground/10 rounded px-1 py-0.5 font-mono text-[0.9em]">
            {node.text}
          </code>
        )
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            {inline(node.children)}
          </strong>
        )
      case 'em':
        return <em key={i}>{inline(node.children)}</em>
      case 'link':
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {inline(node.children)}
          </a>
        )
    }
  })
}

function block(node: Block, i: number): ReactNode {
  switch (node.type) {
    case 'heading': {
      const Tag = node.level === 1 ? 'h2' : node.level === 2 ? 'h3' : 'h4'
      const size = node.level === 1 ? 'text-xl' : node.level === 2 ? 'text-lg' : 'text-base'
      return (
        <Tag key={i} className={`text-foreground font-semibold ${size}`}>
          {inline(node.children)}
        </Tag>
      )
    }
    case 'paragraph':
      return <p key={i}>{inline(node.children)}</p>
    case 'list': {
      const List = node.ordered ? 'ol' : 'ul'
      return (
        <List key={i} className={`space-y-1 pl-5 ${node.ordered ? 'list-decimal' : 'list-disc'}`}>
          {node.items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </List>
      )
    }
    case 'quote':
      return (
        <blockquote key={i} className="border-primary/40 text-muted-foreground border-l-4 pl-4 italic">
          {inline(node.children)}
        </blockquote>
      )
  }
}

/** A description in the markdown subset, as React elements only (no HTML is ever injected). */
export function MarkdownLite({ text, className = '' }: { text: string; className?: string }) {
  return <div className={`text-foreground/90 space-y-3 break-words ${className}`}>{parseMarkdownLite(text).map(block)}</div>
}
```

Create `services/app-profiles.ts` with exactly:

```ts
// App profiles from renown-stats (<switchboard>/graphql/renown-stats). Reads
// are public. Failures are logged and read as "no profile", like getProfile.
import { GraphQLClient } from 'graphql-request'
import { switchboardOrigin } from './media'

export interface RenownAppLink {
  id: string
  label: string
  url: string
}

export interface RenownAppProfile {
  appDid: string
  /** Its images are at /media/<documentId>/logo and /cover (when logoRef/coverRef are set). */
  documentId: string
  name: string | null
  tagline: string | null
  /** Legacy logo URL (https or raster data URL); prefer logoRef. */
  logo: string | null
  website: string | null
  publisherDid: string | null
  /** Markdown subset; render with <MarkdownLite>. */
  description: string | null
  category: string | null
  logoRef: string | null
  coverRef: string | null
  links: RenownAppLink[]
}

/** An app's Renown identity: did:key with a base58btc multibase key. */
export const APP_DID_RE = /^did:key:z[1-9A-HJ-NP-Za-km-z]{32,128}$/

const FIELDS = `appDid documentId name tagline logo website publisherDid description category logoRef coverRef links { id label url }`

function client(): GraphQLClient {
  return new GraphQLClient(`${switchboardOrigin()}/graphql/renown-stats`)
}

export async function getAppProfile(appDid: string): Promise<RenownAppProfile | null> {
  try {
    const data = await client().request<{ appProfile?: RenownAppProfile | null }>(
      `query AppProfile($appDid: String!) { appProfile(appDid: $appDid) { ${FIELDS} } }`,
      { appDid },
    )
    return data.appProfile ?? null
  } catch (error) {
    console.error('Failed to fetch app profile:', error)
    return null
  }
}

/** The app profiles a wallet publishes (oldest first). */
export async function getAppProfilesByPublisher(address: string): Promise<RenownAppProfile[]> {
  try {
    const data = await client().request<{ appProfilesByPublisher?: RenownAppProfile[] }>(
      `query AppProfilesByPublisher($publisherDid: String!) { appProfilesByPublisher(publisherDid: $publisherDid) { ${FIELDS} } }`,
      { publisherDid: address },
    )
    return data.appProfilesByPublisher ?? []
  } catch (error) {
    console.error('Failed to fetch published apps:', error)
    return []
  }
}
```

In `services/media.ts`, replace:

```ts
/** Image fields served publicly. App-profile `logo`/`cover` join in phase 2. */
export const MEDIA_FIELDS = ['avatar'] as const
```

with:

```ts
/** Image fields served publicly: profile avatars, app-profile logos and covers. */
export const MEDIA_FIELDS = ['avatar', 'logo', 'cover'] as const
```

In `e2e/support/stub-switchboard.mjs`:
1. Replace:

```js
const DEFAULT_DATA = {
  renownUsers: [],
  renownUser: null,
  renownCredentials: [],
}
```

with:

```js
const DEFAULT_DATA = {
  renownUsers: [],
  renownUser: null,
  renownCredentials: [],
  appProfile: null,
  appProfilesByPublisher: [],
}
```

2. Replace:

```js
    if (media[1] === 'stub-avatar-doc' && media[2] === 'avatar') {
```

with:

```js
    const stored =
      (media[1] === 'stub-avatar-doc' && media[2] === 'avatar') ||
      (media[1] === 'stub-app-doc' && (media[2] === 'logo' || media[2] === 'cover'))
    if (stored) {
```

3. In the header comment, replace the line `//        /__stub/s3/<STUB_AVATAR_SHA> for doc "stub-avatar-doc" + "avatar", else 404` with `//        /__stub/s3/<STUB_AVATAR_SHA> for "stub-avatar-doc" + avatar and "stub-app-doc" + logo/cover, else 404`.

- [ ] **Step 4: Run specs, types, lint.** `pnpm exec playwright test e2e/markdown-lite.spec.ts e2e/profile-pages.spec.ts 2>&1 | tail -15` → PASS (Phase 1's `/media/stub-avatar-doc/cover` case still 404s: the stub only serves covers for `stub-app-doc`). `pnpm exec tsc --noEmit -p . 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add utils/markdown-lite.ts components/app/markdown-lite.tsx services/app-profiles.ts services/media.ts e2e/support/stub-switchboard.mjs e2e/markdown-lite.spec.ts
git commit -m "feat(apps): app profile reads, logo and cover media URLs, markdown subset"
```

### Task 7: Public app page `/app/<did>`

**Files:**
- Create: `utils/site-origin.ts`, `components/ui/not-found-page.tsx`, `components/app/app-logo.tsx`, `components/app/app-cover.tsx`, `components/app/app-profile-card.tsx`, `pages/app/[did].tsx`
- Modify: `pages/profile/[id].tsx` (use the shared `siteOrigin` and `NotFoundPage`)
- Test: `e2e/app-pages.spec.ts`

**Interfaces:**
- Consumes: Task 6 `getAppProfile`, `APP_DID_RE`, `RenownAppProfile`, `MarkdownLite`, `mediaUrl(…, 'logo' | 'cover')`; Phase 1 `getProfile`, `ProfileAvatar`, `ProfileLinks`, `profileName`, `shortAddress`, `profilePath`, `PageBackground`.
- Produces: `siteOrigin(host?)` (`utils/site-origin.ts`); `<NotFoundPage title message />`; `<AppLogo documentId hasLogo legacyLogo name className? />` (uploaded → legacy https/raster data URL → monogram, falling through on load errors); `<AppCover documentId hasCover seed />`; `<AppProfileCard app />` (link to `/app/<did>`, used in Task 8); page `/app/<did>` (SSR, 404 for malformed or unknown DIDs, `Cache-Control: public, s-maxage=30, stale-while-revalidate=120`, OG/Twitter meta with the cover — else logo — as image).

- [ ] **Step 1: Write the failing spec.**

Create `e2e/app-pages.spec.ts` with exactly:

```ts
import { test, expect } from '@playwright/test'
import { fixtureStub } from './support/stub-switchboard-client'

// The public app page, server-rendered against the stub switchboard. Fixtures
// use ids no other spec uses (they survive renown-writes.spec.ts's resets).
const APP_DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const PUBLISHER = '0x5e00000000000000000000000000000000000a01'
const APP = {
  appDid: APP_DID,
  documentId: 'stub-app-doc',
  name: 'Vault Pages',
  tagline: 'Notes for teams',
  logo: null,
  website: 'https://vault.example',
  publisherDid: `did:pkh:eip155:1:${PUBLISHER}`,
  description: '## About\n\nKeeps **notes** in sync.\n\n- [Docs](https://docs.vault.example)\n- [Evil](javascript:alert(1))\n\n<script>alert(1)</script>',
  category: 'Productivity',
  logoRef: `attachment://v1:${'1'.repeat(64)}`,
  coverRef: `attachment://v1:${'2'.repeat(64)}`,
  links: [
    { id: 'l1', label: 'GitHub', url: 'https://github.com/acme/vault' },
    { id: 'l2', label: 'Bad', url: 'javascript:alert(1)' },
  ],
}
const PUBLISHER_PROFILE = {
  documentId: 'doc-app-publisher',
  username: 'vault-maker',
  ethAddress: PUBLISHER,
  userImage: null,
  displayName: 'Vera Vault',
  handle: 'vera-vault',
  bio: null,
  links: [],
  avatar: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

test.beforeAll(async () => {
  await fixtureStub({ match: 'appProfile(', variables: APP_DID, response: { data: { appProfile: APP } } })
  await fixtureStub({ match: 'renownUsers', variables: PUBLISHER, response: { data: { renownUsers: [PUBLISHER_PROFILE] } } })
})

test.describe('app page', () => {
  test('renders the profile, safe links only, and link-preview meta', async ({ page }) => {
    const response = await page.goto(`/app/${APP_DID}`)
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { level: 1, name: 'Vault Pages' })).toBeVisible()
    await expect(page.getByText('Notes for teams')).toBeVisible()
    await expect(page.getByText('Productivity', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'About' })).toBeVisible()
    await expect(page.locator('strong', { hasText: 'notes' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Docs' })).toHaveAttribute('href', 'https://docs.vault.example/')
    await expect(page.getByRole('link', { name: 'Evil' })).toHaveCount(0)
    await expect(page.getByText('<script>alert(1)</script>')).toBeVisible()
    await expect(page.getByRole('link', { name: /GitHub/ })).toHaveAttribute('href', 'https://github.com/acme/vault')
    await expect(page.getByRole('link', { name: /Bad/ })).toHaveCount(0)
    await expect(page.getByRole('link', { name: /vault\.example/ })).toHaveAttribute('href', 'https://vault.example')
    await expect(page.locator('img[alt="Vault Pages logo"]')).toHaveAttribute('src', '/media/stub-app-doc/logo')
    await expect(page.locator('img[src="/media/stub-app-doc/cover"]')).toHaveCount(1)
    await expect(page.getByRole('link', { name: /Vera Vault/ })).toHaveAttribute('href', '/@vera-vault')
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Vault Pages — Notes for teams')
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/media\/stub-app-doc\/cover$/)
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute('content', 'summary_large_image')
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', new RegExp(`/app/${APP_DID}$`))
  })

  test('an unknown or malformed app DID is a 404 page', async ({ page }) => {
    for (const path of ['/app/did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH', '/app/not-a-did']) {
      const response = await page.goto(path)
      expect(response?.status(), path).toBe(404)
      await expect(page.getByRole('heading', { name: 'App not found' })).toBeVisible()
    }
  })

  test('/media serves app logos and covers', async ({ request }) => {
    for (const field of ['logo', 'cover']) {
      const response = await request.get(`/media/stub-app-doc/${field}`, { maxRedirects: 0 })
      expect(response.status(), field).toBe(302)
    }
  })
})
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec playwright test e2e/app-pages.spec.ts 2>&1 | tail -15` → FAIL (`/app/<did>` 404s: no page; `/media/stub-app-doc/logo` already passes after Task 6).

- [ ] **Step 3: Implement.**

Create `utils/site-origin.ts` with exactly:

```ts
/** This site's public origin: NEXT_PUBLIC_RENOWN_URL, else the request host, else www.renown.id. */
export function siteOrigin(host: string | undefined): string {
  const configured = process.env.NEXT_PUBLIC_RENOWN_URL
  if (configured) return configured.replace(/\/+$/, '')
  return host ? `https://${host}` : 'https://www.renown.id'
}
```

Create `components/ui/not-found-page.tsx` with exactly:

```tsx
import Head from 'next/head'
import PageBackground from './page-background'

/** A full-page "not found" (or error) message that search engines skip. */
export function NotFoundPage({ title, message }: { title: string; message: string }) {
  return (
    <PageBackground>
      <Head>
        <title>{`${title} - Renown`}</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="relative flex min-h-screen flex-col items-center justify-center px-4 text-center">
        <h1 className="text-foreground mb-2 text-2xl font-bold">{title}</h1>
        <p className="text-muted-foreground">{message}</p>
      </main>
    </PageBackground>
  )
}
```

In `pages/profile/[id].tsx`:
1. Replace the import line `import PageBackground from '../../components/ui/page-background'` with:

```tsx
import PageBackground from '../../components/ui/page-background'
import { NotFoundPage } from '../../components/ui/not-found-page'
```

and add `import { siteOrigin } from '../../utils/site-origin'` below `import { profilePath } from '../../utils/profile-url'`.
2. Delete the local `function siteOrigin(…) { … }` and `function NotFound(…) { … }` definitions.
3. Replace both `<NotFound ` usages with `<NotFoundPage ` (same props).

Create `components/app/app-logo.tsx` with exactly:

```tsx
import { useMemo, useState } from 'react'
import { mediaUrl } from '../../services/media'

/** Legacy logos: https URLs and raster data URLs only. */
function safeLegacyLogo(url: string | null | undefined): string | null {
  if (!url) return null
  return /^https:\/\//i.test(url) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(url) ? url : null
}

interface AppLogoProps {
  documentId: string
  /** The profile has an uploaded logo (logoRef), served from /media. */
  hasLogo: boolean
  legacyLogo?: string | null
  name: string
  className?: string
}

/** The app's logo: uploaded → legacy URL → a monogram tile. An image that fails to load falls through. */
export function AppLogo({ documentId, hasLogo, legacyLogo, name, className = 'h-24 w-24 text-4xl ring-4' }: AppLogoProps) {
  const sources = useMemo(
    () =>
      [hasLogo ? mediaUrl(documentId, 'logo') : null, safeLegacyLogo(legacyLogo)].filter(
        (src): src is string => !!src,
      ),
    [documentId, hasLogo, legacyLogo],
  )
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const src = sources.find((candidate) => !failed.has(candidate))
  const shape = `shrink-0 rounded-2xl shadow-lg ring-white dark:ring-white/10 ${className}`
  if (!src) {
    return (
      <span aria-hidden="true" className={`bg-primary/15 text-primary flex items-center justify-center font-bold ${shape}`}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- /media 302s to signed storage URLs next/image can't allowlist
    <img
      src={src}
      alt={`${name} logo`}
      className={`bg-background object-cover ${shape}`}
      onError={() => setFailed((f) => new Set(f).add(src))}
    />
  )
}
```

Create `components/app/app-cover.tsx` with exactly:

```tsx
import { useState } from 'react'
import { mediaUrl } from '../../services/media'

/** A stable hue per seed (FNV-1a), for the gradient shown without a cover. */
function hueOf(seed: string): number {
  let h = 0x811c9dc5
  for (const char of seed) {
    h ^= char.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 360
}

/** The 3:1 cover: the uploaded image, or a gradient derived from the app DID. */
export function AppCover({ documentId, hasCover, seed }: { documentId: string; hasCover: boolean; seed: string }) {
  const [failed, setFailed] = useState(false)
  if (hasCover && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- /media 302s to signed storage URLs next/image can't allowlist
      <img src={mediaUrl(documentId, 'cover')} alt="" className="aspect-[3/1] w-full object-cover" onError={() => setFailed(true)} />
    )
  }
  const hue = hueOf(seed)
  return (
    <div
      aria-hidden="true"
      className="aspect-[3/1] w-full"
      style={{ backgroundImage: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 50) % 360} 70% 32%))` }}
    />
  )
}
```

Create `components/app/app-profile-card.tsx` with exactly:

```tsx
import Link from 'next/link'
import type { RenownAppProfile } from '../../services/app-profiles'
import { AppLogo } from './app-logo'

/** One app in a list: logo, name, tagline and category, linking to its page. */
export function AppProfileCard({ app }: { app: RenownAppProfile }) {
  const name = app.name || 'Untitled app'
  return (
    <Link
      href={`/app/${app.appDid}`}
      className="bg-secondary/60 hover:bg-secondary flex items-center gap-4 rounded-2xl p-4 text-left transition-colors"
    >
      <AppLogo documentId={app.documentId} hasLogo={!!app.logoRef} legacyLogo={app.logo} name={name} className="h-12 w-12 text-lg ring-2" />
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate font-semibold">{name}</span>
        {app.tagline && <span className="text-muted-foreground block truncate text-sm">{app.tagline}</span>}
      </span>
      {app.category && (
        <span className="bg-primary/10 text-primary hidden shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium sm:inline">
          {app.category}
        </span>
      )}
    </Link>
  )
}
```

Create `pages/app/[did].tsx` with exactly:

```tsx
import type { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import { AppCover } from '../../components/app/app-cover'
import { AppLogo } from '../../components/app/app-logo'
import { MarkdownLite } from '../../components/app/markdown-lite'
import { ProfileAvatar } from '../../components/profile/profile-avatar'
import { ProfileLinks } from '../../components/profile/profile-links'
import { profileName, shortAddress } from '../../components/profile/profile-summary'
import { NotFoundPage } from '../../components/ui/not-found-page'
import PageBackground from '../../components/ui/page-background'
import { APP_DID_RE, getAppProfile, type RenownAppProfile } from '../../services/app-profiles'
import { mediaUrl } from '../../services/media'
import { getProfile, type RenownProfile } from '../../services/switchboard'
import { profilePath } from '../../utils/profile-url'
import { siteOrigin } from '../../utils/site-origin'

interface AppPageProps {
  app: RenownAppProfile | null
  /** The publisher's Renown profile, when it has one. */
  publisher: RenownProfile | null
  /** Lowercase wallet of the publisher, from publisherDid. */
  publisherAddress: string | null
  canonicalUrl: string | null
  ogImage: string | null
}

const PKH_RE = /^did:pkh:eip155:\d+:(0x[0-9a-fA-F]{40})$/

function hostOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? host.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

function Publisher({ publisher, address }: { publisher: RenownProfile | null; address: string }) {
  const name = publisher
    ? profileName({ displayName: publisher.displayName, username: publisher.username, address })
    : shortAddress(address)
  const href = publisher ? profilePath(publisher) : `/profile/${address}`
  return (
    <Link
      href={href}
      className="bg-secondary/60 hover:bg-secondary inline-flex items-center gap-3 rounded-full py-1.5 pr-4 pl-1.5 transition-colors"
    >
      <ProfileAvatar
        documentId={publisher?.documentId}
        hasAvatar={!!publisher?.avatar}
        userImage={publisher?.userImage}
        seed={address}
        alt=""
        className="h-8 w-8"
      />
      <span className="text-sm">
        <span className="text-muted-foreground">Published by </span>
        <span className="text-foreground font-semibold">{name}</span>
      </span>
    </Link>
  )
}

const AppPage: NextPage<AppPageProps> = ({ app, publisher, publisherAddress, canonicalUrl, ogImage }) => {
  if (!app) return <NotFoundPage title="App not found" message="No app on Renown has this identity." />

  const name = app.name || 'Untitled app'
  const title = app.tagline ? `${name} — ${app.tagline}` : name
  const description = app.tagline || `${name} on Renown`
  const website = app.website ? hostOf(app.website) : null

  return (
    <PageBackground>
      <Head>
        <title>{`${title} - Renown`}</title>
        <meta name="description" content={description} />
        {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
        {ogImage && <meta property="og:image" content={ogImage} />}
        <meta name="twitter:card" content={app.coverRef ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {ogImage && <meta name="twitter:image" content={ogImage} />}
      </Head>

      <main className="relative flex min-h-screen justify-center px-4 pt-24 pb-12">
        <article className="w-full max-w-3xl overflow-hidden rounded-2xl border border-gray-200 bg-white/80 shadow-2xl backdrop-blur-lg dark:border-white/20 dark:bg-white/10">
          <AppCover documentId={app.documentId} hasCover={!!app.coverRef} seed={app.appDid} />
          <div className="space-y-8 px-6 pb-8 sm:px-10">
            <div className="-mt-12 flex flex-col gap-4 sm:flex-row sm:items-end">
              <AppLogo documentId={app.documentId} hasLogo={!!app.logoRef} legacyLogo={app.logo} name={name} />
              <div className="min-w-0 flex-1 space-y-1 sm:pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-foreground text-3xl font-bold break-words">{name}</h1>
                  {app.category && (
                    <span className="bg-primary/10 text-primary rounded-full px-3 py-1 text-xs font-semibold">{app.category}</span>
                  )}
                </div>
                {app.tagline && <p className="text-muted-foreground text-lg">{app.tagline}</p>}
              </div>
              {app.website && website && (
                <a
                  href={app.website}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="bg-primary text-primary-foreground hover:bg-primary/85 inline-flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors"
                >
                  {website}
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M7 17 17 7M8 7h9v9" />
                  </svg>
                </a>
              )}
            </div>

            {publisherAddress && <Publisher publisher={publisher} address={publisherAddress} />}

            {app.description && <MarkdownLite text={app.description} />}

            <div className="flex justify-start">
              <ProfileLinks links={app.links} />
            </div>

            {/* Phase 3: public app stats (appStats) render here. */}

            <p className="text-muted-foreground border-t border-gray-200 pt-4 font-mono text-xs break-all dark:border-white/10" title="App identity">
              {app.appDid}
            </p>
          </div>
        </article>
      </main>
    </PageBackground>
  )
}

export const getServerSideProps: GetServerSideProps<AppPageProps> = async (context) => {
  const did = String(context.params?.did ?? '')
  const empty: AppPageProps = { app: null, publisher: null, publisherAddress: null, canonicalUrl: null, ogImage: null }
  const app = APP_DID_RE.test(did) ? await getAppProfile(did) : null
  if (!app) {
    context.res.statusCode = 404
    return { props: empty }
  }

  const publisherAddress = PKH_RE.exec(app.publisherDid ?? '')?.[1]?.toLowerCase() ?? null
  const publisher = publisherAddress
    ? await getProfile({ driveId: `renown-${publisherAddress}`, ethAddress: publisherAddress })
    : null
  const origin = siteOrigin(context.req.headers.host)
  const ogImage = app.coverRef
    ? mediaUrl(app.documentId, 'cover', origin)
    : app.logoRef
      ? mediaUrl(app.documentId, 'logo', origin)
      : app.logo && /^https:\/\//i.test(app.logo)
        ? app.logo
        : null
  context.res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  return {
    props: { app, publisher, publisherAddress, canonicalUrl: `${origin}/app/${did}`, ogImage },
  }
}

export default AppPage
```

`ProfileLinks` centres its pills (`justify-center`); on this page that is fine inside the left-aligned wrapper. It renders nothing when no link is safe.

- [ ] **Step 4: Run specs, types, lint.** `pnpm exec playwright test e2e/app-pages.spec.ts e2e/profile-pages.spec.ts 2>&1 | tail -15` → PASS. `pnpm exec tsc --noEmit -p . 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add utils/site-origin.ts components/ui/not-found-page.tsx components/app/app-logo.tsx components/app/app-cover.tsx components/app/app-profile-card.tsx pages/app/[did].tsx pages/profile/[id].tsx e2e/app-pages.spec.ts
git commit -m "feat(apps): public app pages at /app/<did>"
```

### Task 8: "Apps published" and the Publisher badge on profiles

**Files:**
- Modify: `components/profile/profile-summary.tsx`, `pages/profile/[id].tsx`
- Test: `e2e/profile-apps.spec.ts`

**Interfaces:**
- Consumes: Task 6 `getAppProfilesByPublisher`; Task 7 `AppProfileCard`.
- Produces: `ProfileSummaryData.isPublisher?: boolean` (renders a "Publisher" badge); profile page prop `apps: RenownAppProfile[]` and an "Apps published" section (only when non-empty).

- [ ] **Step 1: Write the failing spec.**

Create `e2e/profile-apps.spec.ts` with exactly:

```ts
import { test, expect } from '@playwright/test'
import { fixtureStub } from './support/stub-switchboard-client'

const MAKER = '0x5e00000000000000000000000000000000000b01'
const NOBODY = '0x5e00000000000000000000000000000000000b02'
const profile = (handle: string, address: string, displayName: string) => ({
  documentId: `doc-${handle}`,
  username: handle,
  ethAddress: address,
  userImage: null,
  displayName,
  handle,
  bio: null,
  links: [],
  avatar: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})
const app = (appDid: string, name: string, extra: Record<string, unknown> = {}) => ({
  appDid,
  documentId: `doc-${name}`,
  name,
  tagline: `${name} tagline`,
  logo: null,
  website: null,
  publisherDid: `did:pkh:eip155:1:${MAKER}`,
  description: null,
  category: null,
  logoRef: null,
  coverRef: null,
  links: [],
  ...extra,
})
const ALPHA = 'did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG'
const BETA = 'did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169'

test.beforeAll(async () => {
  const users = (p: unknown) => ({ data: { renownUsers: [p] } })
  await fixtureStub({ match: 'renownUsers', variables: '"app-maker"', response: users(profile('app-maker', MAKER, 'Ada Maker')) })
  await fixtureStub({ match: 'renownUsers', variables: '"no-apps-maker"', response: users(profile('no-apps-maker', NOBODY, 'Nia None')) })
  await fixtureStub({
    match: 'appProfilesByPublisher(',
    variables: MAKER,
    response: {
      data: {
        appProfilesByPublisher: [
          app(ALPHA, 'Alpha', { logoRef: `attachment://v1:${'3'.repeat(64)}`, category: 'Tools' }),
          app(BETA, 'Beta', { logo: 'https://cdn.example/beta.png' }),
        ],
      },
    },
  })
})

test('a publisher profile lists its apps and shows the Publisher badge', async ({ page }) => {
  expect((await page.goto('/@app-maker'))?.status()).toBe(200)
  await expect(page.getByText('Publisher', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Apps published' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Alpha/ })).toHaveAttribute('href', `/app/${ALPHA}`)
  await expect(page.getByRole('link', { name: /Beta/ })).toHaveAttribute('href', `/app/${BETA}`)
  await expect(page.locator('img[alt="Alpha logo"]')).toHaveAttribute('src', '/media/doc-Alpha/logo')
  await expect(page.locator('img[alt="Beta logo"]')).toHaveAttribute('src', 'https://cdn.example/beta.png')
  await expect(page.getByText('Tools', { exact: true })).toBeVisible()
})

test('a profile without apps shows neither', async ({ page }) => {
  expect((await page.goto('/@no-apps-maker'))?.status()).toBe(200)
  await expect(page.getByRole('heading', { name: 'Nia None' })).toBeVisible()
  await expect(page.getByText('Publisher', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Apps published' })).toHaveCount(0)
})
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec playwright test e2e/profile-apps.spec.ts 2>&1 | tail -15` → FAIL (no "Publisher" badge, no "Apps published").

- [ ] **Step 3: Implement.**

In `components/profile/profile-summary.tsx`:
1. In `interface ProfileSummaryData`, after `ensVerified?: boolean`, add:

```tsx
  /** Publishes at least one app on Renown. */
  isPublisher?: boolean
```

2. Replace the whole ENS badge block:

```tsx
      {profile.ensVerified && profile.username && (
        <span
          className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
          title={`${profile.username} resolves to this address`}
        >
          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          ENS verified · {profile.username}
        </span>
      )}
```

with:

```tsx
      {((profile.ensVerified && profile.username) || profile.isPublisher) && (
        <div className="flex flex-wrap justify-center gap-2">
          {profile.ensVerified && profile.username && (
            <span
              className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
              title={`${profile.username} resolves to this address`}
            >
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              ENS verified · {profile.username}
            </span>
          )}
          {profile.isPublisher && (
            <span
              className="bg-secondary text-foreground inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold"
              title="Publishes apps on Renown"
            >
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M12 2 15 9h7l-5.5 4.5 2 7.5L12 16.5 5.5 21l2-7.5L2 9h7z" />
              </svg>
              <span>Publisher</span>
            </span>
          )}
        </div>
      )}
```

In `pages/profile/[id].tsx`:
1. Add imports:

```tsx
import { AppProfileCard } from '../../components/app/app-profile-card'
import { getAppProfilesByPublisher, type RenownAppProfile } from '../../services/app-profiles'
```

2. In `interface ProfilePageProps`, after `ensVerified: boolean`, add `  apps: RenownAppProfile[]`.
3. Change the component signature `({ profile, ensVerified, canonicalUrl, ogImage, error })` to `({ profile, ensVerified, apps, canonicalUrl, ogImage, error })`.
4. In the `<ProfileSummary profile={{ … }} />` props object, after `ensVerified,` add `isPublisher: apps.length > 0,`.
5. Directly after the closing `/>` of `<ProfileSummary … />`, insert:

```tsx
              {apps.length > 0 && (
                <section aria-labelledby="apps-published" className="space-y-3">
                  <h2 id="apps-published" className="text-foreground px-1 text-lg font-semibold">
                    Apps published
                  </h2>
                  <div className="grid gap-3">
                    {apps.map((app) => (
                      <AppProfileCard key={app.appDid} app={app} />
                    ))}
                  </div>
                </section>
              )}
```

6. In `getServerSideProps`, replace `const empty = { profile: null, ensVerified: false, canonicalUrl: null, ogImage: null }` with `const empty = { profile: null, ensVerified: false, apps: [], canonicalUrl: null, ogImage: null }`, and replace the final

```tsx
  return {
    props: {
      profile,
      ensVerified: await isEnsVerified(profile.username, profile.ethAddress),
      canonicalUrl: `${origin}${profilePath(profile)}`,
      ogImage,
    },
  }
```

with:

```tsx
  const address = profile.ethAddress ?? ''
  const [ensVerified, apps] = await Promise.all([
    isEnsVerified(profile.username, profile.ethAddress),
    ADDRESS_RE.test(address) ? getAppProfilesByPublisher(address.toLowerCase()) : Promise.resolve([]),
  ])
  return {
    props: {
      profile,
      ensVerified,
      apps,
      canonicalUrl: `${origin}${profilePath(profile)}`,
      ogImage,
    },
  }
```

- [ ] **Step 4: Run specs, types, lint.** `pnpm exec playwright test e2e/profile-apps.spec.ts e2e/profile-pages.spec.ts e2e/app-pages.spec.ts 2>&1 | tail -15` → PASS. `pnpm exec tsc --noEmit -p . 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add components/profile/profile-summary.tsx pages/profile/[id].tsx e2e/profile-apps.spec.ts
git commit -m "feat(profile): apps published and the Publisher badge"
```

## Part D — vetra.io

Work in `/home/f/projects/vetra.io-hub` on `feat/identity-hub` (`git switch feat/identity-hub && git pull --ff-only`). Style: shadcn components from `@/modules/shared/components/ui/*`, `cn` from `@/shared/lib/utils`, lucide icons, sentence-case copy, no new dependencies.

### Task 9: App-profile library — Renown URLs, reads, crop/resize, upload, form model, markdown

**Files:**
- Create: `modules/apps/lib/app-profile/renown.ts`, `modules/apps/lib/app-profile/api.ts`, `modules/apps/lib/app-profile/image.ts`, `modules/apps/lib/app-profile/upload.ts`, `modules/apps/lib/app-profile/form.ts`, `modules/apps/lib/app-profile/markdown-lite.ts`
- Test: `modules/apps/__tests__/app-profile-lib.test.ts`

**Interfaces:**
- Consumes: `readEnv`, `renownSwitchboardUrl` (`@/modules/shared/config/renown`); Phase 1 upload route contract; Task 4 `appProfile` GraphQL.
- Produces:
  - `renown.ts`: `renownWebUrl()` (`NEXT_PUBLIC_RENOWN_URL`, default `https://www.renown.id`), `renownSwitchboardOrigin(switchboard?)`, `renownStatsEndpoint(switchboard?)` (`…/graphql/renown-stats`), `renownPackageRoutes(switchboard?)` (`…/api/@powerhousedao/renown-package`), `appPageUrl(appDid)` (`<renown>/app/<did>`), `renownMediaUrl(documentId, field: 'logo' | 'cover')`.
  - `api.ts`: `type RenownAppLink`, `type RenownAppProfile` (same fields as renown.id's), `fetchAppProfile(appDid, fetchImpl?) → RenownAppProfile | null` (throws `Error` with Renown's message on failure).
  - `image.ts`: `type ImageKind = 'logo' | 'cover'`, `IMAGE_SPECS` (`logo` 1:1 512×512 ≤ 1 MiB, `cover` 3:1 1500×500 ≤ 2 MiB, with `label` and `hint`), `ACCEPTED_IMAGE_TYPES`, `MAX_SOURCE_BYTES` (2 MiB), `MIN_ZOOM`, `MAX_ZOOM`, `CropState`, `CropRegion {sx, sy, sw, sh}`, `INITIAL_CROP`, `sourceImageProblem(file)`, `cropRegion(width, height, aspect, crop)`, `panBy(crop, width, height, aspect, viewportWidth, dx, dy)`, `renderImage(image, kind, crop) → Blob` (browser), `sha256Hex(blob)`.
  - `upload.ts`: `ImageUploadError(message, code?)`, `uploadRenownImage(blob, purpose: ImageKind, bearer, fetchImpl?) → ref`.
  - `form.ts`: `PROFILE_LIMITS`, `CATEGORY_SUGGESTIONS`, `type AppProfileLinkDraft`, `type AppProfileForm`, `type AppProfileField`, `type AppProfileChanges`, `formFromProfile(profile | null)`, `isHttpUrl(s)`, `formProblems(form)`, `changedFields(initial, current)`, `hasChanges(changes)`, `fieldForServer(field)`, `newLinkId()`.
  - `markdown-lite.ts`: verbatim copy of renown.id `utils/markdown-lite.ts` (Task 6).

- [ ] **Step 1: Write the failing test.**

Create `modules/apps/__tests__/app-profile-lib.test.ts` with exactly:

```ts
import { describe, expect, it, vi } from 'vitest'
import { fetchAppProfile } from '../lib/app-profile/api'
import {
  changedFields,
  fieldForServer,
  formFromProfile,
  formProblems,
  hasChanges,
  type AppProfileForm,
} from '../lib/app-profile/form'
import { cropRegion, IMAGE_SPECS, INITIAL_CROP, panBy, sourceImageProblem } from '../lib/app-profile/image'
import { parseMarkdownLite } from '../lib/app-profile/markdown-lite'
import {
  appPageUrl,
  renownMediaUrl,
  renownPackageRoutes,
  renownStatsEndpoint,
} from '../lib/app-profile/renown'
import { ImageUploadError, uploadRenownImage } from '../lib/app-profile/upload'

const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const PROFILE = {
  appDid: DID,
  documentId: 'doc-9',
  name: 'Vault',
  tagline: 'Notes',
  logo: null,
  website: 'https://vault.example',
  publisherDid: null,
  description: 'Hi',
  category: 'Tools',
  logoRef: 'attachment://v1:aa',
  coverRef: null,
  links: [{ id: 'l1', label: 'Docs', url: 'https://docs.example' }],
}

describe('Renown URLs', () => {
  it('derives the stats endpoint, upload routes, app page and media URLs', () => {
    expect(renownStatsEndpoint('https://switchboard.renown-staging.vetra.io/graphql')).toBe(
      'https://switchboard.renown-staging.vetra.io/graphql/renown-stats',
    )
    expect(renownPackageRoutes('https://sb.example/graphql/')).toBe(
      'https://sb.example/api/@powerhousedao/renown-package',
    )
    expect(renownStatsEndpoint()).toBe('https://switchboard.renown.vetra.io/graphql/renown-stats')
    expect(appPageUrl(DID)).toBe(`https://www.renown.id/app/${DID}`)
    expect(renownMediaUrl('doc 9', 'cover')).toBe('https://www.renown.id/media/doc%209/cover')
  })
})

describe('fetchAppProfile', () => {
  it('reads a profile, null for none, and throws on a GraphQL error', async () => {
    const answer = (body: unknown) =>
      vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status: 200 }))
    const ok = answer({ data: { appProfile: PROFILE } })
    expect(await fetchAppProfile(DID, ok as unknown as typeof fetch)).toEqual(PROFILE)
    const sent = JSON.parse(ok.mock.calls[0]![1].body as string) as { query: string; variables: unknown }
    expect(sent.variables).toEqual({ appDid: DID })
    expect(sent.query).toContain('appProfile(appDid: $appDid)')
    expect(await fetchAppProfile(DID, answer({ data: { appProfile: null } }) as unknown as typeof fetch)).toBeNull()
    await expect(
      fetchAppProfile(DID, answer({ errors: [{ message: 'boom' }] }) as unknown as typeof fetch),
    ).rejects.toThrow('boom')
  })
})

describe('image crop math', () => {
  it('accepts PNG, JPEG and WebP sources up to 2 MB only', () => {
    expect(sourceImageProblem({ type: 'image/png', size: 2 * 1024 * 1024 })).toBeNull()
    expect(sourceImageProblem({ type: 'image/svg+xml', size: 10 })).toBe('Choose a PNG, JPEG or WebP image.')
    expect(sourceImageProblem({ type: 'image/webp', size: 2 * 1024 * 1024 + 1 })).toBe('Choose an image of at most 2 MB.')
  })

  it('selects the largest centred region of the aspect ratio, zoomed and panned', () => {
    expect(IMAGE_SPECS.logo).toMatchObject({ aspect: 1, width: 512, height: 512, maxBytes: 1024 * 1024 })
    expect(IMAGE_SPECS.cover).toMatchObject({ aspect: 3, width: 1500, height: 500, maxBytes: 2 * 1024 * 1024 })
    expect(cropRegion(1000, 1000, 3, INITIAL_CROP)).toEqual({ sx: 0, sy: 333, sw: 1000, sh: 333 })
    expect(cropRegion(3000, 1000, 3, INITIAL_CROP)).toEqual({ sx: 0, sy: 0, sw: 3000, sh: 1000 })
    expect(cropRegion(1000, 500, 1, INITIAL_CROP)).toEqual({ sx: 250, sy: 0, sw: 500, sh: 500 })
    expect(cropRegion(1000, 1000, 1, { zoom: 2, panX: 0, panY: 0 })).toEqual({ sx: 250, sy: 250, sw: 500, sh: 500 })
    expect(cropRegion(1000, 1000, 1, { zoom: 2, panX: 1, panY: -1 })).toEqual({ sx: 500, sy: 0, sw: 500, sh: 500 })
    // Out-of-range values are clamped.
    expect(cropRegion(1000, 1000, 1, { zoom: 9, panX: 5, panY: 0 })).toEqual({ sx: 750, sy: 375, sw: 250, sh: 250 })
  })

  it('pans by screen pixels within the image', () => {
    const zoomed = { zoom: 2, panX: 0, panY: 0 }
    // 250 px viewport shows 500 source px: dragging 50 px left moves the crop 100 px right of 250 slack.
    expect(panBy(zoomed, 1000, 1000, 1, 250, -50, 0)).toEqual({ zoom: 2, panX: 0.4, panY: 0 })
    expect(panBy(zoomed, 1000, 1000, 1, 250, -5000, 5000)).toEqual({ zoom: 2, panX: 1, panY: -1 })
    // No slack (the whole width is selected): no horizontal pan.
    expect(panBy(INITIAL_CROP, 1000, 1000, 1, 250, -50, 0)).toEqual(INITIAL_CROP)
  })
})

describe('uploadRenownImage', () => {
  const blob = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' })
  const SHA = '039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81'

  it('reserves with the purpose, then PUTs to the presigned target with its headers', async () => {
    const fetchImpl = vi.fn(async (url: string, _init: RequestInit) =>
      url.endsWith('/media/uploads')
        ? new Response(
            JSON.stringify({
              ref: `attachment://v1:${SHA}`,
              reservationId: 'r1',
              uploadTarget: { method: 'PUT', url: 'https://s3.example/put', headers: { 'content-type': 'image/webp' } },
            }),
            { status: 201 },
          )
        : new Response(null, { status: 200 }),
    )
    expect(await uploadRenownImage(blob(), 'logo', 'tok', fetchImpl as unknown as typeof fetch)).toBe(
      `attachment://v1:${SHA}`,
    )
    const [reserveUrl, reserve] = fetchImpl.mock.calls[0]!
    expect(reserveUrl).toBe('https://switchboard.renown.vetra.io/api/@powerhousedao/renown-package/media/uploads')
    expect(reserve.headers).toMatchObject({ authorization: 'Bearer tok' })
    expect(JSON.parse(reserve.body as string)).toEqual({ purpose: 'logo', mimeType: 'image/webp', sizeBytes: 3, sha256: SHA })
    const [putUrl, put] = fetchImpl.mock.calls[1]!
    expect(putUrl).toBe('https://s3.example/put')
    expect(put).toMatchObject({ method: 'PUT', headers: { 'content-type': 'image/webp' } })
  })

  it('skips the PUT for bytes Renown already has, and reports refusals with their code', async () => {
    const deduped = vi.fn(async () => new Response(JSON.stringify({ ref: 'attachment://v1:x', deduped: true }), { status: 200 }))
    expect(await uploadRenownImage(blob(), 'cover', 'tok', deduped as unknown as typeof fetch)).toBe('attachment://v1:x')
    expect(deduped).toHaveBeenCalledTimes(1)
    const refused = vi.fn(async () =>
      new Response(JSON.stringify({ code: 'TOO_LARGE', error: 'A logo may be at most 1048576 bytes' }), { status: 413 }),
    )
    const error = await uploadRenownImage(blob(), 'logo', 'tok', refused as unknown as typeof fetch).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ImageUploadError)
    expect(error).toMatchObject({ code: 'TOO_LARGE', message: 'A logo may be at most 1048576 bytes' })
  })
})

describe('profile form', () => {
  const base: AppProfileForm = formFromProfile(PROFILE)

  it('starts from the stored profile, or empty', () => {
    expect(base).toMatchObject({ name: 'Vault', category: 'Tools', logoRef: 'attachment://v1:aa', coverRef: null })
    expect(formFromProfile(null)).toEqual({
      name: '',
      tagline: '',
      website: '',
      description: '',
      category: '',
      logoRef: null,
      coverRef: null,
      links: [],
    })
  })

  it('sends only what changed: trimmed text, "" to clear, the whole link list', () => {
    expect(changedFields(base, { ...base, tagline: '  Notes  ' })).toEqual({})
    expect(hasChanges(changedFields(base, base))).toBe(false)
    expect(
      changedFields(base, {
        ...base,
        name: ' Vault Pro ',
        category: '',
        logoRef: null,
        coverRef: 'attachment://v1:bb',
        links: [{ id: 'l1', label: ' Docs ', url: 'https://docs.example' }, { id: 'l2', label: 'Blog', url: 'https://blog.example' }],
      }),
    ).toEqual({
      name: 'Vault Pro',
      category: '',
      logoRef: '',
      coverRef: 'attachment://v1:bb',
      links: [
        { id: 'l1', label: 'Docs', url: 'https://docs.example' },
        { id: 'l2', label: 'Blog', url: 'https://blog.example' },
      ],
    })
  })

  it('names every problem before anything is sent', () => {
    expect(formProblems(base)).toEqual({})
    expect(
      formProblems({
        ...base,
        name: 'n'.repeat(121),
        tagline: 't'.repeat(281),
        website: 'javascript:alert(1)',
        description: 'd'.repeat(2001),
        category: 'c'.repeat(41),
        links: [{ id: 'x', label: 'X', url: 'ftp://x.example' }],
      }),
    ).toEqual({
      name: 'At most 120 characters.',
      tagline: 'At most 280 characters.',
      website: 'Use an http(s) URL.',
      description: 'At most 2000 characters.',
      category: 'At most 40 characters.',
      links: 'Every link needs an http(s) URL.',
    })
    expect(formProblems({ ...base, links: [{ id: 'x', label: ' ', url: 'https://x.example' }] }).links).toBe(
      'Every link needs a label of 1–40 characters.',
    )
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `${i}`, label: 'L', url: 'https://x.example' }))
    expect(formProblems({ ...base, links: nine }).links).toBe('At most 8 links.')
  })

  it('maps server fields onto form fields', () => {
    expect(fieldForServer('logoRef')).toBe('logo')
    expect(fieldForServer('coverRef')).toBe('cover')
    expect(fieldForServer('description')).toBe('description')
    expect(fieldForServer('appDid')).toBeNull()
    expect(fieldForServer(null)).toBeNull()
  })
})

describe('markdown-lite (copy of renown.id)', () => {
  it('keeps unsafe links as text', () => {
    expect(parseMarkdownLite('[a](https://a.example) [b](javascript:void0)')).toEqual([
      {
        type: 'paragraph',
        children: [
          { type: 'link', href: 'https://a.example/', children: [{ type: 'text', text: 'a' }] },
          { type: 'text', text: ' ' },
          { type: 'text', text: 'b' },
        ],
      },
    ])
  })
})
```

- [ ] **Step 2: Run it to see it fail.** `pnpm test:unit -- modules/apps/__tests__/app-profile-lib.test.ts 2>&1 | tail -15` → FAIL (`Failed to resolve import "../lib/app-profile/api"`).

- [ ] **Step 3: Implement.**

Create `modules/apps/lib/app-profile/renown.ts` with exactly:

```ts
import { readEnv, renownSwitchboardUrl } from '@/modules/shared/config/renown'

/** Renown's public site (staging: renown-staging.vetra.io), for app pages and media URLs. */
export function renownWebUrl(): string {
  return (readEnv('NEXT_PUBLIC_RENOWN_URL') || 'https://www.renown.id').replace(/\/+$/, '')
}

/** The Renown switchboard's origin, from its GraphQL endpoint (`…/graphql`). */
export function renownSwitchboardOrigin(switchboard = renownSwitchboardUrl()): string {
  return switchboard.replace(/\/+$/, '').replace(/\/graphql$/, '')
}

/** renown-stats GraphQL: app profiles (public reads). */
export function renownStatsEndpoint(switchboard = renownSwitchboardUrl()): string {
  return `${renownSwitchboardOrigin(switchboard)}/graphql/renown-stats`
}

/** renown-package's HTTP routes on the Renown switchboard (the gated upload route). */
export function renownPackageRoutes(switchboard = renownSwitchboardUrl()): string {
  return `${renownSwitchboardOrigin(switchboard)}/api/@powerhousedao/renown-package`
}

/** The app's public page on Renown. */
export function appPageUrl(appDid: string): string {
  return `${renownWebUrl()}/app/${appDid}`
}

/** Stable URL of a profile image (302s to storage; 404 when unset). */
export function renownMediaUrl(documentId: string, field: 'logo' | 'cover'): string {
  return `${renownWebUrl()}/media/${encodeURIComponent(documentId)}/${field}`
}
```

Create `modules/apps/lib/app-profile/api.ts` with exactly:

```ts
import { renownStatsEndpoint } from './renown'

export type RenownAppLink = { id: string; label: string; url: string }

/** An app's public profile as Renown serves it (renown-stats AppProfile). */
export type RenownAppProfile = {
  appDid: string
  /** Its images are at <renown>/media/<documentId>/logo and /cover. */
  documentId: string
  name: string | null
  tagline: string | null
  /** Legacy logo URL; prefer logoRef. */
  logo: string | null
  website: string | null
  publisherDid: string | null
  description: string | null
  category: string | null
  logoRef: string | null
  coverRef: string | null
  links: RenownAppLink[]
}

const FIELDS = `appDid documentId name tagline logo website publisherDid description category logoRef coverRef links { id label url }`

type Body = { data?: { appProfile?: RenownAppProfile | null } | null; errors?: { message?: string }[] }

/** The app's Renown profile, or null when it has none yet. Public; no token. */
export async function fetchAppProfile(
  appDid: string,
  fetchImpl: typeof fetch = fetch,
): Promise<RenownAppProfile | null> {
  const res = await fetchImpl(renownStatsEndpoint(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      query: `query AppProfile($appDid: String!) { appProfile(appDid: $appDid) { ${FIELDS} } }`,
      variables: { appDid },
    }),
  })
  const body = (await res.json().catch(() => null)) as Body | null
  const error = body?.errors?.[0]
  if (error || !res.ok) throw new Error(error?.message ?? `Renown answered ${res.status}`)
  return body?.data?.appProfile ?? null
}
```

Create `modules/apps/lib/app-profile/image.ts` with exactly:

```ts
// Logo and cover preparation, ported from renown.id's avatar cropper
// (utils/image-crop.ts, identity hub phase 1) and generalised to an aspect
// ratio. The math is pure (and unit tested); rendering needs a canvas.

export type ImageKind = 'logo' | 'cover'

export const IMAGE_SPECS = {
  logo: {
    label: 'Logo',
    aspect: 1,
    width: 512,
    height: 512,
    maxBytes: 1024 * 1024,
    hint: 'Square, ideally 512×512 or larger. PNG, JPEG or WebP up to 2 MB.',
  },
  cover: {
    label: 'Cover',
    aspect: 3,
    width: 1500,
    height: 500,
    maxBytes: 2 * 1024 * 1024,
    hint: 'Wide 3:1, ideally 1500×500 or larger. PNG, JPEG or WebP up to 2 MB.',
  },
} as const

export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
/** Largest source file accepted (before resizing). */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export interface CropState {
  /** 1 = the largest centred region; 4 = a quarter of its width. */
  zoom: number
  /** Pan of the region's centre, -1 (left/top edge) … 1 (right/bottom edge). */
  panX: number
  panY: number
}

/** The source rectangle (in image pixels) a crop selects. */
export interface CropRegion {
  sx: number
  sy: number
  sw: number
  sh: number
}

export const INITIAL_CROP: CropState = { zoom: 1, panX: 0, panY: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Why `file` can't be used as a source image, or null when it can. */
export function sourceImageProblem(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'Choose a PNG, JPEG or WebP image.'
  }
  if (file.size > MAX_SOURCE_BYTES) return 'Choose an image of at most 2 MB.'
  return null
}

/** Unrounded region size and slack, shared by cropRegion and panBy. */
function geometry(width: number, height: number, aspect: number, zoom: number) {
  const sw = Math.min(width, height * aspect) / clamp(zoom, MIN_ZOOM, MAX_ZOOM)
  const sh = sw / aspect
  return { sw, sh, slackX: (width - sw) / 2, slackY: (height - sh) / 2 }
}

/** The largest centred `aspect` (width/height) region, shrunk by zoom and moved by pan; always inside the image. */
export function cropRegion(width: number, height: number, aspect: number, crop: CropState): CropRegion {
  const { sw, sh, slackX, slackY } = geometry(width, height, aspect, crop.zoom)
  return {
    sx: Math.round(slackX + clamp(crop.panX, -1, 1) * slackX),
    sy: Math.round(slackY + clamp(crop.panY, -1, 1) * slackY),
    sw: Math.round(sw),
    sh: Math.round(sh),
  }
}

/** The pan after dragging by (dx, dy) screen pixels in a viewport `viewportWidth` pixels wide. */
export function panBy(
  crop: CropState,
  width: number,
  height: number,
  aspect: number,
  viewportWidth: number,
  dx: number,
  dy: number,
): CropState {
  const { sw, slackX, slackY } = geometry(width, height, aspect, crop.zoom)
  const scale = sw / viewportWidth
  return {
    ...crop,
    panX: slackX > 0 ? clamp(crop.panX - (dx * scale) / slackX, -1, 1) : 0,
    panY: slackY > 0 ? clamp(crop.panY - (dy * scale) / slackY, -1, 1) : 0,
  }
}

/**
 * Draws the crop at the kind's output size and encodes WebP (PNG where the
 * browser cannot encode WebP), lowering the quality until it fits the cap.
 */
export async function renderImage(image: HTMLImageElement, kind: ImageKind, crop: CropState): Promise<Blob> {
  const spec = IMAGE_SPECS[kind]
  const { sx, sy, sw, sh } = cropRegion(image.naturalWidth, image.naturalHeight, spec.aspect, crop)
  const canvas = document.createElement('canvas')
  canvas.width = spec.width
  canvas.height = spec.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot resize images.')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, sx, sy, sw, sh, 0, 0, spec.width, spec.height)
  for (const quality of [0.9, 0.75, 0.6]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
    if (!blob) throw new Error('Could not encode the image.')
    if (blob.size <= spec.maxBytes) return blob
  }
  throw new Error(`This ${kind} is still too large after compression. Try a simpler image.`)
}

/** Lowercase hex SHA-256 of the bytes (WebCrypto). */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
```

Check of the expected numbers in the test: `cropRegion(1000, 1000, 1, { zoom: 9, … })` clamps zoom to 4 → `sw = 250`, slack 375, `panX` 5 → 1 → `sx = 750`, `sy = 375`. `panBy` at zoom 2 on a 1000 px square with a 250 px viewport: `sw = 500`, scale 2, slack 250 → `0 - (-50·2)/250 = 0.4`.

Create `modules/apps/lib/app-profile/upload.ts` with exactly:

```ts
// Browser upload of a prepared logo or cover through renown-package's gated
// upload route (POST <Renown switchboard>/api/@powerhousedao/renown-package/media/uploads),
// authorised by the signed-in user's Renown bearer — the same route and
// protocol renown.id uses for avatars (identity hub phase 1).
import { sha256Hex, type ImageKind } from './image'
import { renownPackageRoutes, renownSwitchboardOrigin } from './renown'

export class ImageUploadError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ImageUploadError'
  }
}

type ReserveResponse = {
  ref?: string
  deduped?: boolean
  reservationId?: string
  uploadTarget?: { method: 'PUT'; url: string; headers: Record<string, string> } | null
  code?: string
  error?: string
}

/**
 * Uploads `blob` as a `purpose` image and returns its attachment ref.
 * @throws {ImageUploadError} with the route's error code when it refuses.
 */
export async function uploadRenownImage(
  blob: Blob,
  purpose: ImageKind,
  bearer: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const sha256 = await sha256Hex(blob)
  const reserve = await fetchImpl(`${renownPackageRoutes()}/media/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ purpose, mimeType: blob.type, sizeBytes: blob.size, sha256 }),
  })
  const body = (await reserve.json().catch(() => ({}))) as ReserveResponse
  if (!reserve.ok || !body.ref) {
    throw new ImageUploadError(body.error ?? `Upload refused (${reserve.status})`, body.code)
  }
  if (body.deduped) return body.ref

  // S3: PUT to the presigned target with exactly its headers (it pins the
  // length, type and checksum). A filesystem switchboard (local development)
  // takes the bytes on its own reservation route.
  const put = body.uploadTarget
    ? await fetchImpl(body.uploadTarget.url, { method: 'PUT', headers: body.uploadTarget.headers, body: blob })
    : await fetchImpl(
        `${renownSwitchboardOrigin()}/attachments/reservations/${encodeURIComponent(body.reservationId ?? '')}`,
        {
          method: 'PUT',
          headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/octet-stream' },
          body: blob,
        },
      )
  if (!put.ok) throw new ImageUploadError(`Upload failed (${put.status})`, 'UPLOAD_FAILED')
  return body.ref
}
```

Create `modules/apps/lib/app-profile/form.ts` with exactly:

```ts
// The Profile tab's form model: what the publisher edits, what is checked
// before saving, and the patch that is sent (only what changed).
import type { RenownAppProfile } from './api'

export const PROFILE_LIMITS = {
  name: 120,
  tagline: 280,
  website: 2048,
  description: 2000,
  category: 40,
  links: 8,
  linkLabel: 40,
  linkUrl: 2048,
} as const

export const CATEGORY_SUGGESTIONS = [
  'AI',
  'Community',
  'Data',
  'Design',
  'Developer tools',
  'Finance',
  'Operations',
  'Productivity',
] as const

export type AppProfileLinkDraft = { id: string; label: string; url: string }

export type AppProfileForm = {
  name: string
  tagline: string
  website: string
  description: string
  category: string
  logoRef: string | null
  coverRef: string | null
  links: AppProfileLinkDraft[]
}

export type AppProfileField =
  | 'name'
  | 'tagline'
  | 'website'
  | 'description'
  | 'category'
  | 'logo'
  | 'cover'
  | 'links'

/** What updateAppProfile receives: absent = unchanged, "" = clear, links = the whole list. */
export type AppProfileChanges = {
  name?: string
  tagline?: string
  website?: string
  description?: string
  category?: string
  logoRef?: string
  coverRef?: string
  links?: AppProfileLinkDraft[]
}

const TEXT_FIELDS = ['name', 'tagline', 'website', 'description', 'category'] as const

export function formFromProfile(profile: RenownAppProfile | null): AppProfileForm {
  return {
    name: profile?.name ?? '',
    tagline: profile?.tagline ?? '',
    website: profile?.website ?? '',
    description: profile?.description ?? '',
    category: profile?.category ?? '',
    logoRef: profile?.logoRef ?? null,
    coverRef: profile?.coverRef ?? null,
    links: (profile?.links ?? []).map(({ id, label, url }) => ({ id, label, url })),
  }
}

export function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Every problem the server would refuse, per field (empty when the form can be saved). */
export function formProblems(form: AppProfileForm): Partial<Record<AppProfileField, string>> {
  const out: Partial<Record<AppProfileField, string>> = {}
  const max = PROFILE_LIMITS
  if (form.name.trim().length > max.name) out.name = `At most ${max.name} characters.`
  if (form.tagline.trim().length > max.tagline) out.tagline = `At most ${max.tagline} characters.`
  const website = form.website.trim()
  if (website && (!isHttpUrl(website) || website.length > max.website)) out.website = 'Use an http(s) URL.'
  if (form.description.trim().length > max.description) out.description = `At most ${max.description} characters.`
  if (form.category.trim().length > max.category) out.category = `At most ${max.category} characters.`
  if (form.links.length > max.links) {
    out.links = `At most ${max.links} links.`
  } else if (form.links.some((l) => !l.label.trim() || l.label.trim().length > max.linkLabel)) {
    out.links = `Every link needs a label of 1–${max.linkLabel} characters.`
  } else if (form.links.some((l) => !isHttpUrl(l.url.trim()) || l.url.trim().length > max.linkUrl)) {
    out.links = 'Every link needs an http(s) URL.'
  }
  return out
}

function trimmedLinks(links: AppProfileLinkDraft[]): AppProfileLinkDraft[] {
  return links.map(({ id, label, url }) => ({ id, label: label.trim(), url: url.trim() }))
}

/** The patch from `initial` to `current`: changed text trimmed ("" clears), image refs ("" clears), whole link list. */
export function changedFields(initial: AppProfileForm, current: AppProfileForm): AppProfileChanges {
  const out: AppProfileChanges = {}
  for (const key of TEXT_FIELDS) {
    const next = current[key].trim()
    if (next !== initial[key].trim()) out[key] = next
  }
  if (current.logoRef !== initial.logoRef) out.logoRef = current.logoRef ?? ''
  if (current.coverRef !== initial.coverRef) out.coverRef = current.coverRef ?? ''
  const links = trimmedLinks(current.links)
  if (JSON.stringify(links) !== JSON.stringify(trimmedLinks(initial.links))) out.links = links
  return out
}

export function hasChanges(changes: AppProfileChanges): boolean {
  return Object.keys(changes).length > 0
}

/** The form field a server error's `extensions.field` belongs to, or null. */
export function fieldForServer(field: string | null | undefined): AppProfileField | null {
  switch (field) {
    case 'logoRef':
    case 'logo':
      return 'logo'
    case 'coverRef':
      return 'cover'
    case 'name':
    case 'tagline':
    case 'website':
    case 'description':
    case 'category':
    case 'links':
      return field
    default:
      return null
  }
}

/** A new link's id (any unique string; Renown stores it as the link's OID). */
export function newLinkId(): string {
  return crypto.randomUUID()
}
```

Create `modules/apps/lib/app-profile/markdown-lite.ts` as a **verbatim copy** of renown.id's `utils/markdown-lite.ts` from Task 6, with only its header comment's last line changed to `// Verbatim copy of renown.id utils/markdown-lite.ts (the public app page renders the same AST).`:

```bash
sed 's#^// vetra.io.s preview uses a verbatim copy (modules/apps/lib/app-profile/markdown-lite.ts).$#// Verbatim copy of renown.id utils/markdown-lite.ts (the public app page renders the same AST).#' \
  /home/f/projects/renown-hub/utils/markdown-lite.ts > modules/apps/lib/app-profile/markdown-lite.ts
grep -c "Verbatim copy of renown.id" modules/apps/lib/app-profile/markdown-lite.ts   # → 1
```

- [ ] **Step 4: Run tests, types, lint.** `pnpm test:unit -- modules/apps/__tests__/app-profile-lib.test.ts 2>&1 | tail -15` → PASS. `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add modules/apps/lib/app-profile modules/apps/__tests__/app-profile-lib.test.ts
git commit -m "feat(apps): app profile library: Renown reads, image crop and upload, form model"
```

### Task 10: vetra.io data layer — `updateAppProfile`, `identityDid`, profile hooks

**Files:**
- Modify: `modules/publisher/graphql.ts`, `modules/publisher/types.ts`, `modules/publisher/__tests__/fixtures/licensing-contract.graphql`, `modules/publisher/__tests__/contract-schema.test.ts`, `modules/publisher/__tests__/queries.test.ts`
- Create: `modules/apps/hooks/use-app-profile.ts`
- Test: `modules/apps/__tests__/app-profile-api.test.ts`

**Interfaces:**
- Consumes: Task 5 GraphQL (`myApps { … identityDid }`, `updateAppProfile(input: UpdateAppProfileInput!): Boolean!`, codes `NO_IDENTITY | RATE_LIMITED | PROFILE_UNAVAILABLE`, `extensions.field`); Task 9 `fetchAppProfile`, `RenownAppProfile`, `AppProfileChanges`; `usePublisherToken` (`modules/publisher/hooks/use-publisher.ts`).
- Produces:
  - `PublisherApp.identityDid?: string | null`; `type UpdateAppProfileInput = { appId: string } & AppProfileChanges`-shaped (declared in `types.ts` without importing apps code).
  - `PublisherErrorCode` adds `'RATE_LIMITED' | 'PROFILE_UNAVAILABLE' | 'NO_IDENTITY'`; `PublisherApiError.field: string | null` (4th constructor argument, default null); `toPublisherError` keeps `extensions.field`.
  - `updateAppProfile(input, token, fetchImpl?) → Promise<boolean>` (`modules/publisher/graphql.ts`).
  - `appProfileKey(appDid)`, `useAppProfile(appDid)`, `useUpdateAppProfile(appId, appDid)` (`mutateAsync(changes)`), `useRenownBearer() → () => Promise<string>` (`modules/apps/hooks/use-app-profile.ts`).

- [ ] **Step 1: Write the failing test and update the fixtures.**

Create `modules/apps/__tests__/app-profile-api.test.ts` with exactly:

```ts
import { describe, expect, it } from 'vitest'
import {
  describePublisherError,
  fetchPublisherApps,
  PublisherApiError,
  toPublisherError,
  updateAppProfile,
  type FetchLike,
} from '@/modules/publisher/graphql'

const capture = (body: unknown, status = 200) => {
  const calls: Array<{ query: string; variables: Record<string, unknown> }> = []
  const fetchImpl: FetchLike = async (_url, init) => {
    calls.push(JSON.parse(init.body as string) as { query: string; variables: Record<string, unknown> })
    return new Response(JSON.stringify(body), { status })
  }
  return { calls, fetchImpl }
}

describe('app profile writes through vetraPublisher', () => {
  it('sends updateAppProfile with the input untouched', async () => {
    const { calls, fetchImpl } = capture({ data: { vetraPublisher: { updateAppProfile: true } } })
    const input = { appId: 'app-1', tagline: '', links: [{ id: 'l1', label: 'Docs', url: 'https://docs.example' }] }
    expect(await updateAppProfile(input, 't', fetchImpl)).toBe(true)
    expect(calls[0]?.query).toContain('mutation ($input: UpdateAppProfileInput!)')
    expect(calls[0]?.query).toContain('updateAppProfile(input: $input)')
    expect(calls[0]?.variables).toEqual({ input })
  })

  it('keeps the field a refusal names, and knows the profile codes', async () => {
    const { fetchImpl } = capture({
      data: null,
      errors: [{ message: 'Description must be at most 2000 characters', extensions: { code: 'INVALID_INPUT', field: 'description' } }],
    })
    const error = await updateAppProfile({ appId: 'app-1', description: 'x' }, 't', fetchImpl).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PublisherApiError)
    expect(error).toMatchObject({ code: 'INVALID_INPUT', field: 'description' })
    for (const code of ['NO_IDENTITY', 'RATE_LIMITED', 'PROFILE_UNAVAILABLE'] as const) {
      const mapped = toPublisherError({ message: 'm', extensions: { code } }, 200)
      expect(mapped.code).toBe(code)
      expect(mapped.field).toBeNull()
      expect(describePublisherError(mapped)).not.toBe('m')
    }
  })

  it('asks myApps for the identity DID', async () => {
    const { calls, fetchImpl } = capture({ data: { vetraPublisher: { myApps: [] } } })
    await fetchPublisherApps('t', fetchImpl)
    expect(calls[0]?.query).toContain('identityDid')
  })
})
```

In `modules/publisher/__tests__/queries.test.ts`, in the `fetchPublisherApps` entry of `READS`, replace `    fields: ['id', 'name', 'status'],` (the first occurrence, directly under `call: (f) => api.fetchPublisherApps('t', f),` / `variables: {},`) with `    fields: ['id', 'name', 'status', 'identityDid'],`.

In `modules/publisher/__tests__/fixtures/licensing-contract.graphql`, replace:

```graphql
type PublisherApp {
  id: String!
  name: String!
  status: String!
}
```

with:

```graphql
type PublisherApp {
  id: String!
  name: String!
  status: String!
  identityDid: String
}

input PublisherAppLinkInput {
  id: String!
  label: String!
  url: String!
}

input UpdateAppProfileInput {
  appId: String!
  name: String
  tagline: String
  website: String
  description: String
  category: String
  logoRef: String
  coverRef: String
  links: [PublisherAppLinkInput!]
}
```

and replace

```graphql
  removeFromAllowList(appId: String!, user: String!): Boolean!
}
```

(the end of `type VetraPublisherMutations`) with:

```graphql
  removeFromAllowList(appId: String!, user: String!): Boolean!
  updateAppProfile(input: UpdateAppProfileInput!): Boolean!
}
```

In `modules/publisher/__tests__/contract-schema.test.ts`, in `CALLS`, after the `removeFromAllowList: (f) => publisher.removeFromAllowList({ appId: A, user: '0x' + 'a'.repeat(40) }, 't', f),` entry, add:

```ts
  updateAppProfile: (f) =>
    publisher.updateAppProfile(
      { appId: A, name: 'Vault', logoRef: '', links: [{ id: 'l1', label: 'Docs', url: 'https://docs.example' }] },
      't',
      f,
    ),
```

- [ ] **Step 2: Run them to see them fail.** `pnpm test:unit -- modules/apps/__tests__/app-profile-api.test.ts modules/publisher/__tests__ 2>&1 | tail -20` → FAIL (`updateAppProfile` is not exported; `myApps` selection lacks `identityDid`).

- [ ] **Step 3: Implement.**

In `modules/publisher/types.ts`, replace `export type PublisherApp = { id: string; name: string; status: string }` with:

```ts
export type PublisherApp = {
  id: string
  name: string
  status: string
  /** The app's Renown identity (did:key); null before one is registered. Older servers omit it. */
  identityDid?: string | null
}
```

and append at the end of the file:

```ts
export type PublisherAppLinkInput = { id: string; label: string; url: string }

/** Absent: unchanged. Empty string: clear. links: the whole list. */
export type UpdateAppProfileInput = {
  appId: string
  name?: string
  tagline?: string
  website?: string
  description?: string
  category?: string
  logoRef?: string
  coverRef?: string
  links?: PublisherAppLinkInput[]
}
```

In `modules/publisher/graphql.ts`:
1. Add `UpdateAppProfileInput,` to the `import type { … } from './types'` list (after `SetTermDetailsInput,`).
2. In `export type PublisherErrorCode`, after `  | 'ALREADY_HOLDS'` add:

```ts
  | 'RATE_LIMITED'
  | 'PROFILE_UNAVAILABLE'
  | 'NO_IDENTITY'
```

3. In `KNOWN_CODES`, after `  'ALREADY_HOLDS',` add:

```ts
  'RATE_LIMITED',
  'PROFILE_UNAVAILABLE',
  'NO_IDENTITY',
```

4. Replace `type GqlError = { message?: string; extensions?: { code?: unknown } }` with `type GqlError = { message?: string; extensions?: { code?: unknown; field?: unknown } }`.
5. Replace the `PublisherApiError` class with:

```ts
export class PublisherApiError extends Error {
  code: PublisherErrorCode
  status: number | null
  /** The input a refusal names (extensions.field), so a form can show it inline. */
  field: string | null
  constructor(code: PublisherErrorCode, message: string, status: number | null, field: string | null = null) {
    super(message)
    this.name = 'PublisherApiError'
    this.code = code
    this.status = status
    this.field = field
  }
}
```

6. In `toPublisherError`, change the parameter type `gqlError: { message?: string; extensions?: { code?: unknown } } | undefined,` to `gqlError: GqlError | undefined,`, and replace

```ts
  if (typeof raw === 'string' && KNOWN_CODES.has(raw)) {
    return new PublisherApiError(raw as PublisherErrorCode, message, status)
  }
```

with:

```ts
  if (typeof raw === 'string' && KNOWN_CODES.has(raw)) {
    const field = gqlError?.extensions?.field
    return new PublisherApiError(raw as PublisherErrorCode, message, status, typeof field === 'string' ? field : null)
  }
```

(`GqlError` is declared above `PublisherApiError`; if your copy declares it below `toPublisherError`, move the type alias up.)
7. In `ERROR_COPY`, after the `ALREADY_HOLDS` entry add:

```ts
  RATE_LIMITED: 'Too many saves in a short time. Wait a minute and try again.',
  PROFILE_UNAVAILABLE: 'Renown is not reachable right now, so the profile was not saved. Try again in a minute.',
  NO_IDENTITY: 'This app has no Renown identity yet. Authorize its deploy identity first.',
```

8. Replace `const APP_FIELDS = \`id name status\`` with `const APP_FIELDS = \`id name status identityDid\``.
9. After `export const createInviteCode = inputWrite<…>(…)`, add:

```ts
/** The app's public Renown profile; Vetra relays it to Renown (see vetra-cloud-package renown-profile.ts). */
export const updateAppProfile = inputWrite<UpdateAppProfileInput, boolean>(
  'updateAppProfile',
  'UpdateAppProfileInput',
)
```

Create `modules/apps/hooks/use-app-profile.ts` with exactly:

```ts
'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { updateAppProfile } from '@/modules/publisher/graphql'
import { usePublisherToken } from '@/modules/publisher/hooks/use-publisher'
import { fetchAppProfile, type RenownAppProfile } from '../lib/app-profile/api'
import type { AppProfileChanges } from '../lib/app-profile/form'

export const appProfileKey = (appDid: string) => ['renown-app-profile', appDid] as const

/** The app's public Renown profile (null when it has none yet). Public read, no token. */
export function useAppProfile(appDid: string | null | undefined) {
  return useQuery<RenownAppProfile | null>({
    queryKey: appProfileKey(appDid ?? ''),
    queryFn: () => fetchAppProfile(appDid ?? ''),
    enabled: !!appDid,
    staleTime: 30_000,
    retry: 1,
  })
}

/** Saves a profile patch through Vetra's relay, then refreshes the profile. No retries. */
export function useUpdateAppProfile(appId: string, appDid: string | null | undefined) {
  const qc = useQueryClient()
  const token = usePublisherToken()
  return useMutation<boolean, Error, AppProfileChanges>({
    mutationFn: async (changes) => updateAppProfile({ appId, ...changes }, await token()),
    onSuccess: () => {
      if (appDid) void qc.invalidateQueries({ queryKey: appProfileKey(appDid) })
    },
  })
}

/** The signed-in user's Renown bearer, for Renown's upload route (the same session as Vetra's API). */
export function useRenownBearer(): () => Promise<string> {
  const token = usePublisherToken()
  return useCallback(async () => {
    const value = await token()
    if (!value) throw new Error('Log in again to upload images.')
    return value
  }, [token])
}
```

- [ ] **Step 4: Run tests, types, lint.** `pnpm test:unit -- modules/apps modules/publisher 2>&1 | tail -20` → PASS (contract test validates `updateAppProfile` against the fixture). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add modules/publisher/graphql.ts modules/publisher/types.ts modules/publisher/__tests__/fixtures/licensing-contract.graphql modules/publisher/__tests__/contract-schema.test.ts modules/publisher/__tests__/queries.test.ts modules/apps/hooks/use-app-profile.ts modules/apps/__tests__/app-profile-api.test.ts
git commit -m "feat(apps): save app profiles through Vetra, read them from Renown"
```

### Task 11: The Profile tab and the Overview card

**Files:**
- Create: `modules/apps/components/profile/markdown-lite.tsx`, `modules/apps/components/profile/app-logo.tsx`, `modules/apps/components/profile/profile-field.tsx`, `modules/apps/components/profile/image-crop-dialog.tsx`, `modules/apps/components/profile/image-field.tsx`, `modules/apps/components/profile/links-editor.tsx`, `modules/apps/components/profile/app-profile-preview.tsx`, `modules/apps/components/profile/profile-tab.tsx`, `modules/apps/components/profile/app-profile-card.tsx`
- Modify: `modules/apps/components/app-detail.tsx`, `modules/apps/components/app-overview.tsx`, `modules/apps/__tests__/app-detail-tabs.test.tsx`
- Test: `modules/apps/__tests__/profile-tab.test.tsx`

**Interfaces:**
- Consumes: Task 9 (`IMAGE_SPECS`, `cropRegion`, `panBy`, `renderImage`, `sourceImageProblem`, `uploadRenownImage`, form model, `parseMarkdownLite`, `appPageUrl`, `renownMediaUrl`); Task 10 (`useAppProfile`, `useUpdateAppProfile`, `useRenownBearer`, `PublisherApiError.field`, `PublisherApp.identityDid`); `TabHeader`, `TabSkeleton` (`modules/publisher/components/primitives.tsx`); `Banner`, `AppAvatar`, `hueFor`.
- Produces: `<AppProfileTab appId appName appDid />` (both app kinds); `<AppProfileCard appDid appName onEdit? />` (Overview); `<AppProfilePreview appName appDid form documentId previews legacyLogo compact? />`, `type ImagePreviews`; `<MarkdownLite text className? />`; `<AppLogo name seed src size? className? />`, `safeLegacyLogo(url)`; tab id `profile` (label "Profile") in `ALL_TABS` and `LICENSING_ONLY_TABS`; `AppOverview` prop `onEditProfile?: () => void`.

- [ ] **Step 1: Write the failing tests.**

Create `modules/apps/__tests__/profile-tab.test.tsx` with exactly:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { PublisherApiError } from '@/modules/publisher/graphql'
import type { RenownAppProfile } from '../lib/app-profile/api'

const DID = 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK'
const STORED: RenownAppProfile = {
  appDid: DID,
  documentId: 'doc-9',
  name: 'Vault',
  tagline: 'Notes for teams',
  logo: null,
  website: 'https://vault.example',
  publisherDid: 'did:pkh:eip155:1:0xabc0000000000000000000000000000000000001',
  description: 'Keeps **notes**.',
  category: 'Productivity',
  logoRef: null,
  coverRef: null,
  links: [{ id: 'l1', label: 'Docs', url: 'https://docs.vault.example' }],
}

let profile: { data: RenownAppProfile | null; isPending: boolean; error: Error | null; refetch: () => void }
const mutateAsync = vi.fn()

vi.mock('../hooks/use-app-profile', () => ({
  useAppProfile: () => profile,
  useUpdateAppProfile: () => ({ mutateAsync, isPending: false }),
  useRenownBearer: () => async () => 'bearer',
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { AppProfileCard } from '../components/profile/app-profile-card'
import { AppProfileTab } from '../components/profile/profile-tab'

const saveButton = () => screen.getByRole('button', { name: 'Save profile' }) as HTMLButtonElement

beforeEach(() => {
  cleanup()
  mutateAsync.mockReset()
  profile = { data: STORED, isPending: false, error: null, refetch: vi.fn() }
})

describe('AppProfileTab', () => {
  it('explains when the app has no Renown identity', () => {
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={null} />)
    expect(screen.getByText('No Renown identity yet')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Save profile' })).toBeNull()
  })

  it('loads the stored profile, previews it and links to its Renown page', () => {
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    expect((screen.getByLabelText('Tagline') as HTMLInputElement).value).toBe('Notes for teams')
    expect((screen.getByLabelText('Category') as HTMLInputElement).value).toBe('Productivity')
    expect(screen.getByRole('link', { name: /View on Renown/ }).getAttribute('href')).toBe(
      `https://www.renown.id/app/${DID}`,
    )
    expect(screen.getByText('notes').tagName).toBe('STRONG')
    expect(saveButton().disabled).toBe(true)
  })

  it('saves only what changed', async () => {
    mutateAsync.mockResolvedValue(true)
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    fireEvent.change(screen.getByLabelText('Tagline'), { target: { value: 'Shared notes' } })
    expect(screen.getByText('Unsaved changes')).toBeTruthy()
    fireEvent.click(saveButton())
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ tagline: 'Shared notes' }))
  })

  it('starts an empty profile from the app name', async () => {
    profile = { ...profile, data: null }
    mutateAsync.mockResolvedValue(true)
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Vault')
    fireEvent.click(saveButton())
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ name: 'Vault' }))
  })

  it('blocks saving an unsafe website and says why', () => {
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    fireEvent.change(screen.getByLabelText('Website'), { target: { value: 'javascript:alert(1)' } })
    expect(screen.getByText('Use an http(s) URL.')).toBeTruthy()
    expect(saveButton().disabled).toBe(true)
  })

  it('shows a field error from the server next to the field', async () => {
    mutateAsync.mockRejectedValue(
      new PublisherApiError('INVALID_INPUT', 'Description must be at most 2000 characters', 200, 'description'),
    )
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Shorter' } })
    fireEvent.click(saveButton())
    expect(await screen.findByText('Description must be at most 2000 characters')).toBeTruthy()
  })

  it('refuses an SVG before uploading anything', async () => {
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' })
    fireEvent.change(screen.getByLabelText('Upload logo'), { target: { files: [svg] } })
    expect(await screen.findByText('Choose a PNG, JPEG or WebP image.')).toBeTruthy()
  })

  it('adds, edits and removes links', async () => {
    mutateAsync.mockResolvedValue(true)
    render(<AppProfileTab appId="app-1" appName="Vault" appDid={DID} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    fireEvent.change(screen.getByLabelText('Link 2 label'), { target: { value: 'Blog' } })
    fireEvent.change(screen.getByLabelText('Link 2 URL'), { target: { value: 'https://blog.example' } })
    fireEvent.click(screen.getByRole('button', { name: 'Move link 2 up' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove link 2' }))
    fireEvent.click(saveButton())
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ links: [{ id: expect.any(String), label: 'Blog', url: 'https://blog.example' }] }),
    )
  })
})

describe('AppProfileCard', () => {
  it('previews the profile with edit and Renown links', () => {
    const onEdit = vi.fn()
    render(<AppProfileCard appDid={DID} appName="Vault" onEdit={onEdit} />)
    expect(screen.getByRole('heading', { name: 'Vault' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Edit profile/ }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('link', { name: /View on Renown/ }).getAttribute('href')).toBe(`https://www.renown.id/app/${DID}`)
  })

  it('invites setting up a missing profile, and renders nothing without an identity', () => {
    profile = { ...profile, data: null }
    render(<AppProfileCard appDid={DID} appName="Vault" onEdit={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Set up profile' })).toBeTruthy()
    cleanup()
    expect(render(<AppProfileCard appDid={null} appName="Vault" />).container.innerHTML).toBe('')
  })
})
```

Update `modules/apps/__tests__/app-detail-tabs.test.tsx`:
1. After the `vi.mock('../components/app-settings', …)` line, add:

```tsx
vi.mock('../components/profile/profile-tab', () => ({
  AppProfileTab: ({ appDid }: { appDid: string | null }) => <div>profile-content {appDid ?? 'none'}</div>,
}))
```

2. In `computes the tab list from ownership and read-only state`, insert `'profile',` after `'deployments',` in the first two expected arrays (publisher and non-publisher); the read-only array stays `['overview', 'deployments']`.
3. In `shows licensing tabs to the publisher, with readable labels`, insert `'Profile',` after `'Deployments',`.
4. In `hides licensing tabs from anyone else and ignores a deep link to them`, replace `expect(tabNames()).toEqual(['Overview', 'Deployments', 'Settings'])` with `expect(tabNames()).toEqual(['Overview', 'Deployments', 'Profile', 'Settings'])`.
5. In `shows only the licensing tabs, opening on Plans, for its publisher`, replace `expect(tabNames()).toEqual(['Templates', 'Plans', 'Holders', 'Invite codes'])` with `expect(tabNames()).toEqual(['Profile', 'Templates', 'Plans', 'Holders', 'Invite codes'])`.
6. Add these two tests inside `describe('AppDetail tabs', …)`, after `opens a licensing tab from the URL`:

```tsx
  it('opens the Profile tab with the app identity', () => {
    searchParams = new URLSearchParams('tab=profile')
    render(<AppDetail appId="app-1" />)
    expect(screen.getByText(`profile-content ${app.identityDid}`)).toBeTruthy()
  })

  it('gives a licensing-only app a Profile tab too', () => {
    appError = new AppsApiError('NOT_FOUND', 'no such app', 404)
    publisher = { isPublisher: true, app: { id: 'studio-1', name: 'Vetra Studio', status: 'ACTIVE' }, isPending: false }
    searchParams = new URLSearchParams('tab=profile')
    render(<AppDetail appId="studio-1" />)
    expect(screen.getByText('profile-content none')).toBeTruthy()
  })
```

(The outer `beforeEach` resets `appError`, `publisher` and `searchParams`, so the second test's overrides do not leak.)

- [ ] **Step 2: Run them to see them fail.** `pnpm test:unit -- modules/apps/__tests__/profile-tab.test.tsx modules/apps/__tests__/app-detail-tabs.test.tsx 2>&1 | tail -20` → FAIL (`Failed to resolve import "../components/profile/app-profile-card"`; tab lists lack Profile).

- [ ] **Step 3: Implement the components.**

Create `modules/apps/components/profile/markdown-lite.tsx` with exactly:

```tsx
import { Fragment, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { parseMarkdownLite, type Block, type Inline } from '../../lib/app-profile/markdown-lite'

function inline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return <Fragment key={i}>{node.text}</Fragment>
      case 'break':
        return <br key={i} />
      case 'code':
        return (
          <code key={i} className="bg-muted rounded px-1 py-0.5 font-mono text-[0.9em]">
            {node.text}
          </code>
        )
      case 'strong':
        return (
          <strong key={i} className="font-semibold">
            {inline(node.children)}
          </strong>
        )
      case 'em':
        return <em key={i}>{inline(node.children)}</em>
      case 'link':
        return (
          <a
            key={i}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow ugc"
            className="text-primary underline underline-offset-2 hover:opacity-80"
          >
            {inline(node.children)}
          </a>
        )
    }
  })
}

function block(node: Block, i: number): ReactNode {
  switch (node.type) {
    case 'heading':
      return (
        <p key={i} className={cn('text-foreground font-semibold', node.level === 1 ? 'text-base' : 'text-sm')}>
          {inline(node.children)}
        </p>
      )
    case 'paragraph':
      return <p key={i}>{inline(node.children)}</p>
    case 'list': {
      const List = node.ordered ? 'ol' : 'ul'
      return (
        <List key={i} className={cn('space-y-1 pl-5', node.ordered ? 'list-decimal' : 'list-disc')}>
          {node.items.map((item, j) => (
            <li key={j}>{inline(item)}</li>
          ))}
        </List>
      )
    }
    case 'quote':
      return (
        <blockquote key={i} className="border-border text-muted-foreground border-l-2 pl-3 italic">
          {inline(node.children)}
        </blockquote>
      )
  }
}

/** A description in Renown's markdown subset, as React elements only (as renown.id renders it). */
export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  return <div className={cn('text-foreground/90 space-y-2 break-words', className)}>{parseMarkdownLite(text).map(block)}</div>
}
```

(Headings render as styled paragraphs here so a preview never adds headings to vetra.io's page outline.)

Create `modules/apps/components/profile/app-logo.tsx` with exactly:

```tsx
'use client'

import { useState } from 'react'
import { cn } from '@/shared/lib/utils'
import { AppAvatar } from '../app-avatar'

/** Legacy profile logos that may be shown: https URLs and raster data URLs. */
export function safeLegacyLogo(url: string | null | undefined): string | null {
  if (!url) return null
  return /^https:\/\//i.test(url) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(url) ? url : null
}

/** The app's logo image, or its monogram tile when there is none (or it fails to load). */
export function AppLogo({
  name,
  seed,
  src,
  size = 'lg',
  className,
}: {
  name: string
  seed: string
  src: string | null
  size?: 'md' | 'lg'
  className?: string
}) {
  const [failed, setFailed] = useState<string | null>(null)
  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- Renown /media 302s to short-lived storage URLs
      <img
        src={src}
        alt={`${name} logo`}
        onError={() => setFailed(src)}
        className={cn(
          'bg-card shrink-0 object-cover shadow-sm',
          size === 'md' ? 'h-10 w-10 rounded-xl' : 'h-16 w-16 rounded-2xl',
          className,
        )}
      />
    )
  }
  return <AppAvatar name={name} seed={seed} size={size} className={cn(size === 'lg' && 'h-16 w-16 text-2xl', className)} />
}
```

Create `modules/apps/components/profile/profile-field.tsx` with exactly:

```tsx
import type { ReactNode } from 'react'
import { Label } from '@/modules/shared/components/ui/label'
import { cn } from '@/shared/lib/utils'

/** Label, control, then the error (or a hint); an optional character counter. */
export function ProfileField({
  id,
  label,
  hint,
  error,
  count,
  max,
  className,
  children,
}: {
  id: string
  label: string
  hint?: ReactNode
  error?: string
  count?: number
  max?: number
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {count !== undefined && max !== undefined && (
          <span aria-hidden className={cn('text-xs tabular-nums', count > max ? 'text-destructive' : 'text-muted-foreground')}>
            {count}/{max}
          </span>
        )}
      </div>
      {children}
      {error ? (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  )
}
```

Create `modules/apps/components/profile/image-crop-dialog.tsx` with exactly:

```tsx
'use client'

import { Loader2, ZoomIn, ZoomOut } from 'lucide-react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Button } from '@/modules/shared/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/modules/shared/components/ui/dialog'
import { Slider } from '@/modules/shared/components/ui/slider'
import { cn } from '@/shared/lib/utils'
import {
  cropRegion,
  IMAGE_SPECS,
  INITIAL_CROP,
  MAX_ZOOM,
  MIN_ZOOM,
  panBy,
  renderImage,
  type CropState,
  type ImageKind,
} from '../../lib/app-profile/image'

const VIEWPORT_WIDTH = 360

/** Drag to position, slide to zoom; produces the kind's output image (WebP). */
export function ImageCropDialog({
  image,
  kind,
  onCancel,
  onDone,
}: {
  image: HTMLImageElement
  kind: ImageKind
  onCancel: () => void
  onDone: (blob: Blob) => void
}) {
  const spec = IMAGE_SPECS[kind]
  const viewportHeight = Math.round(VIEWPORT_WIDTH / spec.aspect)
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [crop, setCrop] = useState<CropState>(INITIAL_CROP)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const width = image.naturalWidth
  const height = image.naturalHeight

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const { sx, sy, sw, sh } = cropRegion(width, height, spec.aspect, crop)
    context.clearRect(0, 0, VIEWPORT_WIDTH, viewportHeight)
    context.drawImage(image, sx, sy, sw, sh, 0, 0, VIEWPORT_WIDTH, viewportHeight)
  }, [image, width, height, crop, spec.aspect, viewportHeight])

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY }
  }

  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    drag.current = { x: e.clientX, y: e.clientY }
    // The canvas may be drawn narrower than its 360 px on small screens.
    const shown = e.currentTarget.clientWidth || VIEWPORT_WIDTH
    setCrop((c) => panBy(c, width, height, spec.aspect, shown, dx, dy))
  }

  function endDrag() {
    drag.current = null
  }

  async function done() {
    setBusy(true)
    setProblem(null)
    try {
      onDone(await renderImage(image, kind, crop))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Could not prepare the image.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel()
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Position the {kind}</DialogTitle>
          <DialogDescription>
            Drag to move it and use the slider to zoom. It is saved at {spec.width}×{spec.height}.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-center">
          <canvas
            ref={canvas}
            width={VIEWPORT_WIDTH}
            height={viewportHeight}
            aria-label={`Drag to position the ${kind}`}
            className={cn(
              'bg-muted ring-border h-auto w-full max-w-[360px] cursor-grab touch-none ring-1 active:cursor-grabbing',
              kind === 'logo' ? 'rounded-2xl' : 'rounded-xl',
            )}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          />
        </div>
        <div className="flex items-center gap-3">
          <ZoomOut className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
          <Slider
            aria-label="Zoom"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={[crop.zoom]}
            onValueChange={(values) => setCrop((c) => ({ ...c, zoom: values[0] ?? c.zoom }))}
          />
          <ZoomIn className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
        </div>
        {problem && (
          <p className="text-destructive text-sm" role="alert">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void done()} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            Use this crop
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

Create `modules/apps/components/profile/image-field.tsx` with exactly:

```tsx
'use client'

import { ImagePlus, Loader2, Trash2, Upload } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import { Button } from '@/modules/shared/components/ui/button'
import { cn } from '@/shared/lib/utils'
import { IMAGE_SPECS, sourceImageProblem, type ImageKind } from '../../lib/app-profile/image'
import { renownMediaUrl } from '../../lib/app-profile/renown'
import { uploadRenownImage } from '../../lib/app-profile/upload'
import { ImageCropDialog } from './image-crop-dialog'

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('This file could not be read as an image.'))
    }
    image.src = url
  })
}

/** Drop or pick an image → crop → upload to Renown; or remove the current one. */
export function ImageField({
  kind,
  documentId,
  value,
  previewUrl,
  fallbackUrl = null,
  getBearer,
  onUploaded,
  onClear,
  onBusyChange,
  error,
}: {
  kind: ImageKind
  /** The saved profile document, for showing the stored image. */
  documentId: string | null
  /** The ref the form holds (null = none). */
  value: string | null
  /** A local preview of an image uploaded in this session. */
  previewUrl: string | null
  /** Shown while there is no uploaded image (the legacy logo URL). */
  fallbackUrl?: string | null
  getBearer: () => Promise<string>
  onUploaded: (ref: string, previewUrl: string) => void
  onClear: () => void
  onBusyChange: (busy: boolean) => void
  error?: string
}) {
  const spec = IMAGE_SPECS[kind]
  const input = useRef<HTMLInputElement>(null)
  const [source, setSource] = useState<HTMLImageElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const shown = previewUrl ?? (value ? (documentId ? renownMediaUrl(documentId, kind) : null) : fallbackUrl)

  async function choose(file: File | undefined) {
    if (!file) return
    const refused = sourceImageProblem(file)
    if (refused) {
      setProblem(refused)
      return
    }
    setProblem(null)
    try {
      setSource(await loadImage(file))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'This file could not be read as an image.')
    }
  }

  async function upload(blob: Blob) {
    setSource(null)
    setUploading(true)
    onBusyChange(true)
    try {
      const ref = await uploadRenownImage(blob, kind, await getBearer())
      onUploaded(ref, URL.createObjectURL(blob))
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Upload failed.')
    } finally {
      setUploading(false)
      onBusyChange(false)
    }
  }

  function onDrop(e: DragEvent<HTMLButtonElement>) {
    e.preventDefault()
    setDragging(false)
    void choose(e.dataTransfer.files[0])
  }

  const message = problem ?? error
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">{spec.label}</p>
        <p className="text-muted-foreground text-xs">{spec.hint}</p>
      </div>
      <div className={cn('flex gap-4', kind === 'logo' ? 'items-center' : 'flex-col')}>
        <button
          type="button"
          aria-label={shown ? `Replace ${kind}` : `Add ${kind}`}
          disabled={uploading}
          onClick={() => input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'bg-muted/40 border-border hover:border-foreground/30 relative flex shrink-0 items-center justify-center overflow-hidden border border-dashed transition-colors',
            kind === 'logo' ? 'h-24 w-24 rounded-2xl' : 'aspect-[3/1] w-full rounded-xl',
            shown && 'border-solid',
            dragging && 'border-primary bg-primary/5',
          )}
        >
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- Renown /media 302s to short-lived storage URLs
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="text-muted-foreground flex flex-col items-center gap-1 px-2 text-center text-xs">
              <ImagePlus className="h-5 w-5" aria-hidden />
              {kind === 'logo' ? 'Add logo' : 'Drop a cover image here, or click to choose one'}
            </span>
          )}
          {uploading && (
            <span className="bg-background/70 absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            </span>
          )}
        </button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => input.current?.click()}>
            <Upload className="h-3.5 w-3.5" />
            {shown ? 'Replace' : 'Upload'}
          </Button>
          {value && (
            <Button type="button" size="sm" variant="ghost" disabled={uploading} onClick={onClear}>
              <Trash2 className="h-3.5 w-3.5" />
              Remove
            </Button>
          )}
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        aria-label={`Upload ${kind}`}
        onChange={(e) => {
          void choose(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {message && (
        <p className="text-destructive text-sm" role="alert">
          {message}
        </p>
      )}
      {source && (
        <ImageCropDialog image={source} kind={kind} onCancel={() => setSource(null)} onDone={(blob) => void upload(blob)} />
      )}
    </div>
  )
}
```

Create `modules/apps/components/profile/links-editor.tsx` with exactly:

```tsx
'use client'

import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/modules/shared/components/ui/button'
import { Input } from '@/modules/shared/components/ui/input'
import { newLinkId, PROFILE_LIMITS, type AppProfileLinkDraft } from '../../lib/app-profile/form'

/** Up to 8 labelled links: add, edit, reorder, remove. */
export function LinksEditor({
  links,
  onChange,
  error,
}: {
  links: AppProfileLinkDraft[]
  onChange: (links: AppProfileLinkDraft[]) => void
  error?: string
}) {
  function update(index: number, patch: Partial<AppProfileLinkDraft>) {
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)))
  }

  function move(index: number, by: -1 | 1) {
    const next = [...links]
    const [item] = next.splice(index, 1)
    if (!item) return
    next.splice(index + by, 0, item)
    onChange(next)
  }

  return (
    <div className="space-y-2">
      {links.length === 0 && (
        <p className="text-muted-foreground text-sm">No links yet. Add docs, source code or socials.</p>
      )}
      {links.map((link, index) => (
        <div key={link.id} className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Input
            aria-label={`Link ${index + 1} label`}
            placeholder="Label"
            value={link.label}
            className="sm:w-40"
            onChange={(e) => update(index, { label: e.target.value })}
          />
          <Input
            aria-label={`Link ${index + 1} URL`}
            placeholder="https://"
            type="url"
            inputMode="url"
            value={link.url}
            className="flex-1"
            onChange={(e) => update(index, { url: e.target.value })}
          />
          <div className="flex shrink-0 gap-1">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Move link ${index + 1} up`}
              disabled={index === 0}
              onClick={() => move(index, -1)}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Move link ${index + 1} down`}
              disabled={index === links.length - 1}
              onClick={() => move(index, 1)}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove link ${index + 1}`}
              onClick={() => onChange(links.filter((_, i) => i !== index))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={links.length >= PROFILE_LIMITS.links}
        onClick={() => onChange([...links, { id: newLinkId(), label: '', url: '' }])}
      >
        <Plus className="h-3.5 w-3.5" />
        Add link
      </Button>
      {error && (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
```

Create `modules/apps/components/profile/app-profile-preview.tsx` with exactly:

```tsx
import { ArrowUpRight } from 'lucide-react'
import { Badge } from '@/modules/shared/components/ui/badge'
import { cn } from '@/shared/lib/utils'
import { isHttpUrl, type AppProfileForm } from '../../lib/app-profile/form'
import type { ImageKind } from '../../lib/app-profile/image'
import { renownMediaUrl } from '../../lib/app-profile/renown'
import { hueFor } from '../app-avatar'
import { AppLogo, safeLegacyLogo } from './app-logo'
import { MarkdownLite } from './markdown-lite'

/** Local previews of images uploaded in this session (they win over stored ones). */
export type ImagePreviews = Record<ImageKind, string | null>

/** The profile as Renown will show it, from the form's current values. */
export function AppProfilePreview({
  appName,
  appDid,
  form,
  documentId,
  previews,
  legacyLogo,
  compact = false,
}: {
  appName: string
  appDid: string
  form: AppProfileForm
  documentId: string | null
  previews: ImagePreviews
  legacyLogo: string | null
  compact?: boolean
}) {
  const name = form.name.trim() || appName
  const category = form.category.trim()
  const tagline = form.tagline.trim()
  const description = form.description.trim()
  const coverSrc = previews.cover ?? (form.coverRef && documentId ? renownMediaUrl(documentId, 'cover') : null)
  const logoSrc =
    previews.logo ??
    (form.logoRef ? (documentId ? renownMediaUrl(documentId, 'logo') : null) : safeLegacyLogo(legacyLogo))
  const links = form.links.filter((link) => link.label.trim() && isHttpUrl(link.url.trim()))
  const hue = hueFor(appDid)

  return (
    <div className="bg-card border-border overflow-hidden rounded-2xl border shadow-sm">
      <div
        className="aspect-[3/1] w-full"
        style={
          coverSrc
            ? undefined
            : { backgroundImage: `linear-gradient(135deg, hsl(${hue} 70% 55%), hsl(${(hue + 40) % 360} 75% 35%))` }
        }
      >
        {coverSrc && (
          // eslint-disable-next-line @next/next/no-img-element -- Renown /media 302s to short-lived storage URLs
          <img src={coverSrc} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="space-y-3 px-5 pb-5">
        <AppLogo name={name} seed={appDid} src={logoSrc} className="ring-card -mt-8 ring-4" />
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg leading-tight font-semibold">{name}</h3>
            {category && <Badge variant="secondary">{category}</Badge>}
          </div>
          {tagline && <p className="text-muted-foreground text-sm">{tagline}</p>}
        </div>
        {description && <MarkdownLite text={description} className={cn('text-sm', compact && 'line-clamp-4')} />}
        {links.length > 0 && (
          <ul className="flex flex-wrap gap-2" aria-label="Links">
            {links.map((link) => (
              <li key={link.id}>
                <a
                  href={link.url.trim()}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="bg-muted hover:bg-muted/70 inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors"
                >
                  {link.label.trim()}
                  <ArrowUpRight className="h-3 w-3" aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

Create `modules/apps/components/profile/profile-tab.tsx` with exactly:

```tsx
'use client'

import { ArrowUpRight, Fingerprint, Loader2, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { TabHeader, TabSkeleton } from '@/modules/publisher/components/primitives'
import { describePublisherError, isPublisherError } from '@/modules/publisher/graphql'
import { Button } from '@/modules/shared/components/ui/button'
import { Input } from '@/modules/shared/components/ui/input'
import { Textarea } from '@/modules/shared/components/ui/textarea'

import { useAppProfile, useRenownBearer, useUpdateAppProfile } from '../../hooks/use-app-profile'
import type { RenownAppProfile } from '../../lib/app-profile/api'
import {
  CATEGORY_SUGGESTIONS,
  changedFields,
  fieldForServer,
  formFromProfile,
  formProblems,
  hasChanges,
  PROFILE_LIMITS,
  type AppProfileField,
  type AppProfileForm,
} from '../../lib/app-profile/form'
import type { ImageKind } from '../../lib/app-profile/image'
import { appPageUrl } from '../../lib/app-profile/renown'
import { Banner } from '../banner'
import { AppProfilePreview, type ImagePreviews } from './app-profile-preview'
import { ImageField } from './image-field'
import { LinksEditor } from './links-editor'
import { ProfileField } from './profile-field'

const NO_PREVIEWS: ImagePreviews = { logo: null, cover: null }

/** The Profile tab: the app's public Renown profile, edited by its publisher (both app kinds). */
export function AppProfileTab({
  appId,
  appName,
  appDid,
}: {
  appId: string
  appName: string
  appDid: string | null | undefined
}) {
  if (!appDid) {
    return (
      <Banner tone="neutral" icon={Fingerprint} title="No Renown identity yet">
        {appName} gets a public Renown profile once its deploy identity is registered. Authorize it from the
        Overview, then come back here.
      </Banner>
    )
  }
  return <ProfileEditor appId={appId} appName={appName} appDid={appDid} />
}

function ProfileEditor({ appId, appName, appDid }: { appId: string; appName: string; appDid: string }) {
  const profile = useAppProfile(appDid)
  if (profile.isPending) return <TabSkeleton rows={2} label="Loading profile" />
  if (profile.error) {
    return (
      <Banner
        tone="warning"
        icon={TriangleAlert}
        title="The Renown profile did not load"
        actions={
          <Button size="sm" variant="outline" onClick={() => void profile.refetch()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Try again
          </Button>
        }
      >
        {profile.error.message}
      </Banner>
    )
  }
  const stored = profile.data ?? null
  // A new document id (the first save) starts the form over from what Renown stored.
  return <ProfileForm key={stored?.documentId ?? 'new'} appId={appId} appName={appName} appDid={appDid} stored={stored} />
}

function ProfileForm({
  appId,
  appName,
  appDid,
  stored,
}: {
  appId: string
  appName: string
  appDid: string
  stored: RenownAppProfile | null
}) {
  const initial = useMemo(() => formFromProfile(stored), [stored])
  // An empty profile starts with the app's Vetra name, so the first save names it.
  const fresh = useMemo(() => ({ ...initial, name: initial.name || appName }), [initial, appName])
  const [form, setForm] = useState<AppProfileForm>(fresh)
  const [previews, setPreviews] = useState<ImagePreviews>(NO_PREVIEWS)
  const [uploading, setUploading] = useState<Record<ImageKind, boolean>>({ logo: false, cover: false })
  const [serverError, setServerError] = useState<{ field: AppProfileField | null; message: string } | null>(null)
  const update = useUpdateAppProfile(appId, appDid)
  const getBearer = useRenownBearer()

  const problems = formProblems(form)
  const changes = changedFields(initial, form)
  const dirty = hasChanges(changes)
  const busy = uploading.logo || uploading.cover || update.isPending
  const canSave = dirty && !busy && Object.keys(problems).length === 0
  const documentId = stored?.documentId ?? null

  const errorFor = (field: AppProfileField): string | undefined =>
    problems[field] ?? (serverError?.field === field ? serverError.message : undefined)

  function set<K extends keyof AppProfileForm>(key: K, value: AppProfileForm[K]) {
    setForm((current) => ({ ...current, [key]: value }))
    setServerError(null)
  }

  function setImage(kind: ImageKind, ref: string | null, previewUrl: string | null) {
    set(kind === 'logo' ? 'logoRef' : 'coverRef', ref)
    setPreviews((current) => ({ ...current, [kind]: previewUrl }))
  }

  function reset() {
    setForm(fresh)
    setPreviews(NO_PREVIEWS)
    setServerError(null)
  }

  async function save() {
    try {
      await update.mutateAsync(changes)
      toast.success('Profile saved. It is live on Renown.')
    } catch (err) {
      const field = isPublisherError(err) ? fieldForServer(err.field) : null
      const message = describePublisherError(err)
      setServerError({ field, message })
      if (!field) toast.error(message)
    }
  }

  const imageField = (kind: ImageKind) => (
    <ImageField
      kind={kind}
      documentId={documentId}
      value={kind === 'logo' ? form.logoRef : form.coverRef}
      previewUrl={previews[kind]}
      fallbackUrl={kind === 'logo' ? (stored?.logo ?? null) : null}
      getBearer={getBearer}
      onUploaded={(ref, url) => setImage(kind, ref, url)}
      onClear={() => setImage(kind, null, null)}
      onBusyChange={(value) => setUploading((current) => ({ ...current, [kind]: value }))}
      error={errorFor(kind)}
    />
  )

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_360px]">
      <form
        className="min-w-0 space-y-8"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (canSave) void save()
        }}
      >
        <TabHeader
          title="Public profile"
          description={
            <>
              How {appName} appears on Renown: its app page and the profile of whoever publishes it. Saving
              publishes immediately.
            </>
          }
          action={
            <Button asChild variant="outline" size="sm">
              <a href={appPageUrl(appDid)} target="_blank" rel="noopener noreferrer">
                View on Renown
                <ArrowUpRight className="h-3.5 w-3.5" />
              </a>
            </Button>
          }
        />

        <section className="space-y-6">
          {imageField('cover')}
          {imageField('logo')}
        </section>

        <section className="grid gap-6 sm:grid-cols-2">
          <ProfileField id="profile-name" label="Name" error={errorFor('name')} count={form.name.trim().length} max={PROFILE_LIMITS.name}>
            <Input id="profile-name" value={form.name} aria-invalid={!!errorFor('name')} onChange={(e) => set('name', e.target.value)} />
          </ProfileField>
          <ProfileField
            id="profile-category"
            label="Category"
            hint="Where it fits, for example Productivity."
            error={errorFor('category')}
            count={form.category.trim().length}
            max={PROFILE_LIMITS.category}
          >
            <Input
              id="profile-category"
              list="profile-category-suggestions"
              value={form.category}
              aria-invalid={!!errorFor('category')}
              onChange={(e) => set('category', e.target.value)}
            />
            <datalist id="profile-category-suggestions">
              {CATEGORY_SUGGESTIONS.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </ProfileField>
          <ProfileField
            id="profile-tagline"
            label="Tagline"
            hint="One line under the name."
            className="sm:col-span-2"
            error={errorFor('tagline')}
            count={form.tagline.trim().length}
            max={PROFILE_LIMITS.tagline}
          >
            <Input id="profile-tagline" value={form.tagline} aria-invalid={!!errorFor('tagline')} onChange={(e) => set('tagline', e.target.value)} />
          </ProfileField>
          <ProfileField id="profile-website" label="Website" className="sm:col-span-2" error={errorFor('website')}>
            <Input
              id="profile-website"
              type="url"
              inputMode="url"
              placeholder="https://"
              value={form.website}
              aria-invalid={!!errorFor('website')}
              onChange={(e) => set('website', e.target.value)}
            />
          </ProfileField>
          <ProfileField
            id="profile-description"
            label="Description"
            className="sm:col-span-2"
            hint="Markdown: **bold**, *italic*, `code`, [links](https://…), lists and > quotes."
            error={errorFor('description')}
            count={form.description.trim().length}
            max={PROFILE_LIMITS.description}
          >
            <Textarea
              id="profile-description"
              rows={8}
              value={form.description}
              aria-invalid={!!errorFor('description')}
              onChange={(e) => set('description', e.target.value)}
            />
          </ProfileField>
        </section>

        <section className="space-y-3" aria-labelledby="profile-links-heading">
          <div className="flex items-baseline justify-between gap-3">
            <h3 id="profile-links-heading" className="text-sm font-medium">
              Links
            </h3>
            <span className="text-muted-foreground text-xs tabular-nums">
              {form.links.length}/{PROFILE_LIMITS.links}
            </span>
          </div>
          <LinksEditor links={form.links} onChange={(links) => set('links', links)} error={errorFor('links')} />
        </section>

        <div className="border-border flex flex-wrap items-center justify-end gap-3 border-t pt-6">
          {dirty && <span className="text-muted-foreground mr-auto text-sm">Unsaved changes</span>}
          <Button type="button" variant="ghost" onClick={reset} disabled={!dirty || busy}>
            <RotateCcw className="h-4 w-4" />
            Reset
          </Button>
          <Button type="button" onClick={() => void save()} disabled={!canSave}>
            {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save profile
          </Button>
        </div>
      </form>

      <aside className="space-y-3 lg:sticky lg:top-24 lg:self-start" aria-label="Preview">
        <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Preview</p>
        <AppProfilePreview
          appName={appName}
          appDid={appDid}
          form={form}
          documentId={documentId}
          previews={previews}
          legacyLogo={stored?.logo ?? null}
        />
      </aside>
    </div>
  )
}
```

Create `modules/apps/components/profile/app-profile-card.tsx` with exactly:

```tsx
'use client'

import { ArrowUpRight, Pencil, Sparkles } from 'lucide-react'
import { Button } from '@/modules/shared/components/ui/button'
import { Skeleton } from '@/modules/shared/components/ui/skeleton'
import { useAppProfile } from '../../hooks/use-app-profile'
import { formFromProfile } from '../../lib/app-profile/form'
import { appPageUrl } from '../../lib/app-profile/renown'
import { AppProfilePreview } from './app-profile-preview'

/** The Overview's "Public profile" section: the Renown profile card, with edit and view links. */
export function AppProfileCard({
  appDid,
  appName,
  onEdit,
}: {
  appDid: string | null | undefined
  appName: string
  onEdit?: () => void
}) {
  const profile = useAppProfile(appDid)
  if (!appDid) return null
  return (
    <section className="space-y-4" aria-labelledby="public-profile-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="public-profile-heading" className="text-lg font-semibold">
          Public profile
        </h2>
        <div className="flex gap-2">
          {onEdit && (
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" />
              Edit profile
            </Button>
          )}
          <Button size="sm" variant="ghost" asChild>
            <a href={appPageUrl(appDid)} target="_blank" rel="noopener noreferrer">
              View on Renown
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>
      {profile.isPending ? (
        <Skeleton className="h-56 w-full max-w-md rounded-2xl" />
      ) : profile.data ? (
        <div className="max-w-md">
          <AppProfilePreview
            appName={appName}
            appDid={appDid}
            form={formFromProfile(profile.data)}
            documentId={profile.data.documentId}
            previews={{ logo: null, cover: null }}
            legacyLogo={profile.data.logo}
            compact
          />
        </div>
      ) : profile.error ? (
        <p className="text-muted-foreground text-sm">The Renown profile could not be loaded right now.</p>
      ) : (
        <div className="border-border bg-card flex max-w-md flex-col items-start gap-3 rounded-2xl border border-dashed p-6">
          <Sparkles className="text-primary h-5 w-5" aria-hidden />
          <div className="space-y-1">
            <p className="font-medium">Give {appName} a public face</p>
            <p className="text-muted-foreground text-sm">
              Add a logo, a cover, a description and links. They show on Renown, on the app’s page and on your profile.
            </p>
          </div>
          {onEdit && (
            <Button size="sm" onClick={onEdit}>
              Set up profile
            </Button>
          )}
        </div>
      )}
    </section>
  )
}
```

- [ ] **Step 4: Wire the tab and the Overview card.**

In `modules/apps/components/app-detail.tsx`:
1. Add `import { AppProfileTab } from './profile/profile-tab'` below `import { AppSettings } from './app-settings'`.
2. Replace `const ALL_TABS = ['overview', 'deployments', ...LICENSING_TABS, 'settings'] as const` with `const ALL_TABS = ['overview', 'deployments', 'profile', ...LICENSING_TABS, 'settings'] as const`.
3. In `APP_TAB_LABEL`, after `deployments: 'Deployments',` add `  profile: 'Profile',`.
4. Replace

```ts
/**
 * Tabs of a licensing-only app: one that exists only as a licensing document (Vetra Studio),
 * with no repository, so no Overview, Deployments, Artifacts or Settings. Opens on Plans.
 */
export const LICENSING_ONLY_TABS = ['templates', 'plans', 'holders', 'invite-codes'] as const
```

with:

```ts
/**
 * Tabs of a licensing-only app: one that exists only as a licensing document (Vetra Studio),
 * with no repository, so no Overview, Deployments, Artifacts or Settings. Opens on Plans.
 */
export const LICENSING_ONLY_TABS = ['profile', 'templates', 'plans', 'holders', 'invite-codes'] as const
```

5. In `LicensingOnlyAppDetail`, before `<TabsContent value="templates">`, add:

```tsx
        <TabsContent value="profile">
          <AppProfileTab appId={app.id} appName={app.name} appDid={app.identityDid ?? null} />
        </TabsContent>
```

6. In `visibleAppTabs`, replace

```ts
  const tabs: AppTab[] = ['overview', 'deployments']
  if (isPublisher && !readOnly) tabs.push(...LICENSING_TABS)
```

with:

```ts
  const tabs: AppTab[] = ['overview', 'deployments']
  if (!readOnly) tabs.push('profile')
  if (isPublisher && !readOnly) tabs.push(...LICENSING_TABS)
```

7. In `AppDetail`'s JSX, replace

```tsx
          <AppOverview
            app={app}
            deployments={deployments}
            deploymentsLoaded={!deploymentsQuery.isPending}
            onAuthorize={authorize}
          />
```

with:

```tsx
          <AppOverview
            app={app}
            deployments={deployments}
            deploymentsLoaded={!deploymentsQuery.isPending}
            onAuthorize={authorize}
            onEditProfile={readOnly ? undefined : () => setTab('profile')}
          />
```

and directly after the closing `</TabsContent>` of `value="deployments"` add:

```tsx
        {!readOnly && (
          <TabsContent value="profile">
            <AppProfileTab appId={appId} appName={app.name} appDid={app.identityDid} />
          </TabsContent>
        )}
```

In `modules/apps/components/app-overview.tsx`:
1. Add `import { AppProfileCard } from './profile/app-profile-card'` below `import { AppAvatar } from './app-avatar'`.
2. Replace the `AppOverview` signature

```tsx
export function AppOverview({
  app,
  deployments,
  deploymentsLoaded,
  onAuthorize,
}: {
  app: App
  deployments: AppDeployment[]
  deploymentsLoaded: boolean
  onAuthorize: () => void
}) {
```

with:

```tsx
export function AppOverview({
  app,
  deployments,
  deploymentsLoaded,
  onAuthorize,
  onEditProfile,
}: {
  app: App
  deployments: AppDeployment[]
  deploymentsLoaded: boolean
  onAuthorize: () => void
  /** Opens the Profile tab; absent on read-only apps. */
  onEditProfile?: () => void
}) {
```

3. Replace `      <ProductionCard app={app} deployment={production} />` with:

```tsx
      <ProductionCard app={app} deployment={production} />
      <AppProfileCard appDid={app.identityDid} appName={app.name} onEdit={onEditProfile} />
```

- [ ] **Step 5: Run tests, types, lint, build.** `pnpm test:unit 2>&1 | tail -20` → PASS (all suites). `pnpm tsc 2>&1 | tail -5`, `pnpm lint 2>&1 | tail -5` → no errors. `pnpm build 2>&1 | tail -8` → succeeds.

- [ ] **Step 6: Look at it.** `NEXT_PUBLIC_RENOWN_URL=https://renown-staging.vetra.io NEXT_PUBLIC_RENOWN_SWITCHBOARD_URL=https://switchboard.renown-staging.vetra.io/graphql pnpm dev`, sign in, open an app with an identity → **Profile**: light and dark theme, 375 px and desktop widths; the preview sticks beside the form on `lg`, stacks below it on mobile; the crop dialog fits a phone screen; long names and a 2000-character description wrap without horizontal scroll. Fix anything that looks broken before committing. (Saving needs Task 12's staging stack; reads work against staging already once Task 4 is released.)

- [ ] **Step 7: Commit.**

```bash
git add modules/apps/components/profile modules/apps/components/app-detail.tsx modules/apps/components/app-overview.tsx modules/apps/__tests__/profile-tab.test.tsx modules/apps/__tests__/app-detail-tabs.test.tsx
git commit -m "feat(apps): Profile tab and public profile card for every app"
```

## Part E — Rollout (controller-run)

Order in each environment: renown-package (Renown accepts the relay and the new fields) → vetra-cloud-package (the relay) → renown.id (pages) → vetra.io (the tab). Preconditions: Phase 1 is live on staging **and** prod (its Task 13 done); Tasks 1–11 committed on their branches with all checks green. Never print a secret: env checks below only say "set"/"MISSING" or "match"/"DIFFER".

### Task 12: Release Phase 2 to staging *(controller-run: pushes, workflows, hosting)*

- [ ] **Step 1: Check CORS for vetra.io's staging origin** (browser uploads go from `https://staging.vetra.io` to the Renown staging switchboard and bucket):

```bash
curl -s -D - -o /dev/null -X OPTIONS \
  "https://nbg1.your-objectstorage.com/renown-staging-attachments/attachments/00/00/probe" \
  -H "Origin: https://staging.vetra.io" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type,x-amz-checksum-sha256" | grep -i '^access-control-allow'
curl -s -D - -o /dev/null -X OPTIONS \
  "https://switchboard.renown-staging.vetra.io/api/@powerhousedao/renown-package/media/uploads" \
  -H "Origin: https://staging.vetra.io" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type" | grep -i '^access-control-allow-origin'
```

Expected: both name `https://staging.vetra.io` (or `*` for the switchboard) and the bucket allows `PUT`. If either is missing, stop: the Phase 0 CORS change (bucket + switchboard, vetra.io origins) has not landed for staging.vetra.io.

- [ ] **Step 2: Check the relay credentials are wired (no values printed).**

```bash
kubectl get deploy -A | grep -i switchboard   # note the renown-staging and the vetra staging switchboard (namespace, name)
RS_NS=renown-staging; RS_DEPLOY=switchboard           # adjust from the listing
VS_NS=<vetra staging namespace>; VS_DEPLOY=<its switchboard deployment>
check='for v in RENOWN_WORKLOAD_REGISTRATION_TOKEN RENOWN_STATS_URL RENOWN_STATS_PROFILE_APPS; do if [ -n "$(printenv $v)" ]; then echo "$v set"; else echo "$v MISSING"; fi; done'
kubectl -n "$RS_NS" exec "deploy/$RS_DEPLOY" -- sh -c "$check"   # token set; RENOWN_STATS_PROFILE_APPS MISSING (intended)
kubectl -n "$VS_NS" exec "deploy/$VS_DEPLOY" -- sh -c "$check"   # token set; RENOWN_STATS_URL set
a=$(kubectl -n "$RS_NS" exec "deploy/$RS_DEPLOY" -- sh -c 'printf %s "$RENOWN_WORKLOAD_REGISTRATION_TOKEN" | sha256sum')
b=$(kubectl -n "$VS_NS" exec "deploy/$VS_DEPLOY" -- sh -c 'printf %s "$RENOWN_WORKLOAD_REGISTRATION_TOKEN" | sha256sum')
[ "$a" = "$b" ] && echo "registration tokens match" || echo "registration tokens DIFFER"
unset a b
```

Expected: both tokens set and matching (both come from `tenants/renown-staging/oidc` in OpenBao), Vetra staging's `RENOWN_STATS_URL` set (it is `https://switchboard.renown-staging.vetra.io/graphql/renown-stats` in `tenants/staging/powerhouse-values.yaml`). `RENOWN_STATS_PROFILE_APPS` stays unset (Ruling 1). If the tokens differ, stop and fix the ExternalSecret source — do not paste values.

- [ ] **Step 3: renown-package → `staging` and release.**

```bash
cd /home/f/projects/renown-package-hub
git fetch origin
git switch -C staging origin/staging
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 2 (app profiles) into staging"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run --coverage 2>&1 | tail -15 && pnpm build 2>&1 | tail -3
git push git@github.com:powerhouse-inc/renown-package.git staging
gh workflow run sync-and-publish.yml -R powerhouse-inc/renown-package --ref staging -f channel=staging -f sync=false
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown-package --workflow sync-and-publish.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown-package "$RUN" --exit-status
git switch feat/identity-hub
```

Expected: a `v1.(n+1).0-staging.N` release, images pushed, and the deploy job's commit touching only `tenants/renown-staging/powerhouse-values.yaml`.

- [ ] **Step 4: Confirm the Renown staging switchboard serves Phase 2.**

```bash
git -C /home/f/projects/powerhouse-k8s-hosting pull --ff-only
kubectl -n renown-staging get pods
kubectl -n renown-staging logs deploy/switchboard --since=10m | grep -E "renown-media|renown-stats" || true   # no "disabled" lines
SB=https://switchboard.renown-staging.vetra.io
curl -s "$SB/graphql/renown-stats" -H 'content-type: application/json' \
  -d '{"query":"{ appProfiles(limit: 2) { items { appDid documentId } next } }"}'                       # data.appProfiles
curl -s "$SB/graphql/renown-stats" -H 'content-type: application/json' \
  -d '{"query":"mutation { upsertAppProfile(appDid: \"did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK\", name: \"x\") }"}' \
  | grep -o '"code":"[A-Z_]*"'                                                                         # FORBIDDEN
curl -s "$SB/graphql/renown-stats" -H 'content-type: application/json' \
  -H 'x-renown-workload-registration-token: guess' \
  -d '{"query":"mutation { upsertAppProfile(appDid: \"did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK\", name: \"x\") }"}' \
  | grep -o '"code":"[A-Z_]*"'                                                                         # FORBIDDEN
curl -s -o /dev/null -w "%{http_code}\n" "$SB/api/@powerhousedao/renown-package/media/nope/logo"        # 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SB/api/@powerhousedao/renown-package/media/uploads" \
  -H 'content-type: application/json' -d '{"purpose":"cover"}'                                         # 401
```

- [ ] **Step 5: vetra-cloud-package → `staging`, then pin it on the staging tenant.**

```bash
cd /home/f/projects/vetra-cloud-package-profiles
git fetch origin
git switch --detach origin/staging
git merge --no-ff feat/identity-hub-profiles -m "chore: merge identity hub phase 2 (app profile relay) into staging"
```

`origin/staging` trails `origin/main` (it lacks main's newest commits and carries its own `-staging.N` version bumps), so this merge also brings main's commits to staging — intended. If `package.json` conflicts only on `"version"`, keep the **staging** side's version line and `git add package.json && git commit --no-edit`; any other conflict: stop and resolve by hand. Then:

```bash
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run 2>&1 | tail -15
git push git@github.com:powerhouse-inc/vetra-cloud-package.git HEAD:staging
sleep 5; RUN=$(gh run list -R powerhouse-inc/vetra-cloud-package --workflow sync-and-publish.yml --branch staging -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/vetra-cloud-package "$RUN" --exit-status
git fetch -q origin staging && VER=$(git show origin/staging:package.json | jq -r .version) && echo "$VER"   # e.g. 0.0.56-staging.14
git switch feat/identity-hub-profiles
cd /home/f/projects/powerhouse-k8s-hosting
git pull --ff-only
sed -i -E "s#(@powerhousedao/vetra-cloud-package@)[0-9][^\",]*#\1${VER}#g" tenants/staging/powerhouse-values.yaml
git diff --stat   # exactly 2 lines in tenants/staging/powerhouse-values.yaml (switchboard + connect PH_REGISTRY_PACKAGES)
git add tenants/staging/powerhouse-values.yaml
git commit -m "chore(staging): vetra-cloud-package ${VER} (identity hub phase 2)"
git push
```

Wait for ArgoCD to roll the staging switchboard (`kubectl -n "$VS_NS" rollout status deploy/"$VS_DEPLOY" --timeout=10m`), then:

```bash
curl -s https://switchboard.staging.vetra.io/graphql -H 'content-type: application/json' \
  -d '{"query":"mutation { vetraPublisher { updateAppProfile(input: { appId: \"x\" }) } }"}' | grep -o '"code":"[A-Z_]*"'   # UNAUTHENTICATED (the field exists)
```

- [ ] **Step 6: renown.id → `deploy/staging`, then pin the image.**

```bash
cd /home/f/projects/renown-hub
git fetch origin
git switch -C deploy/staging origin/deploy/staging
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 2 (app pages) into deploy/staging"
git push git@github.com:powerhouse-inc/renown.git deploy/staging
SHA7=$(git rev-parse --short=7 HEAD)
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown --workflow semantic-release.yml --branch deploy/staging -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown "$RUN" --exit-status
git switch feat/identity-hub
cd /home/f/projects/powerhouse-k8s-hosting
git pull --ff-only
sed -i -E "s/^(    tag: )staging-[0-9a-f]{7}$/\1staging-${SHA7}/" tenants/renown-staging/powerhouse-values.yaml
git diff --stat   # exactly one line: app.image.tag in tenants/renown-staging/powerhouse-values.yaml
git add tenants/renown-staging/powerhouse-values.yaml
git commit -m "chore(renown-staging): renown-app staging-${SHA7} (identity hub phase 2)"
git push
```

Expected: `curl -s -o /dev/null -w "%{http_code}\n" https://renown-staging.vetra.io/app/did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK` → `404` (page exists; that app does not).

- [ ] **Step 7: vetra.io → `staging` (its workflow bumps the staging tenant itself).**

```bash
cd /home/f/projects/vetra.io-hub
git fetch origin
git switch -C staging origin/staging
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 2 (app profiles) into staging"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm test:unit 2>&1 | tail -10
git push git@github.com:powerhouse-inc/vetra.to.git staging
SHA7=$(git rev-parse --short=7 HEAD)
sleep 5; RUN=$(gh run list -R powerhouse-inc/vetra.to --workflow publish-docker-image.yml --branch staging -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/vetra.to "$RUN" --exit-status
git switch feat/identity-hub
git -C /home/f/projects/powerhouse-k8s-hosting pull --ff-only
grep -A3 "repository: cr.vetra.io/vetra/vetra-to" /home/f/projects/powerhouse-k8s-hosting/tenants/staging/powerhouse-values.yaml   # tag: staging-${SHA7}
```

`publish-docker-image.yml` builds `cr.vetra.io/vetra/vetra-to:staging-<sha7>` and its `update-k8s` job commits `chore(staging): update vetra-to image to staging-<sha7>` to `tenants/staging/powerhouse-values.yaml` on hosting `main`; ArgoCD rolls the `app` pod. No manual hosting edit.

### Task 13: Verify Phase 2 on staging *(controller-run, a person with a wallet)*

Old staging apps carry identity DIDs registered on **prod** Renown, so they cannot have a staging profile. Use a new app.

- [ ] **Step 1: A new staging app.** On `https://staging.vetra.io` (signed in through Renown staging): Apps → New app → a throwaway test repository → authorize its deploy identity on `renown-staging.vetra.io` → back on the app, status ACTIVE. Note the app id and its identity DID (Settings).
- [ ] **Step 2: Edit the profile.** App → **Profile**: drop a wide photo as cover (crop dialog, zoom, drag), a square logo, set name, tagline, category (pick from the suggestions), website, a description with `**bold**`, a list, a `[docs](https://…)` link and a `[x](javascript:alert(1))` line, two links (reorder them). The preview updates live. Save → toast "Profile saved. It is live on Renown." In devtools: `POST …/media/uploads` 201 (twice), `PUT` to the bucket 200, `vetraPublisher.updateAppProfile` → `true`. Check light/dark and a 375 px wide window.
- [ ] **Step 3: Renown has it.**

```bash
DID=<identity DID from step 1>
curl -s https://switchboard.renown-staging.vetra.io/graphql/renown-stats -H 'content-type: application/json' \
  -d "{\"query\":\"{ appProfile(appDid: \\\"$DID\\\") { documentId name category logoRef coverRef links { label url } } }\"}"
DOC=<documentId from the answer>
for f in logo cover; do curl -s -o /dev/null -w "$f %{http_code}\n" "https://renown-staging.vetra.io/media/$DOC/$f"; done   # logo 302, cover 302
curl -s https://switchboard.renown-staging.vetra.io/graphql/renown-stats -H 'content-type: application/json' \
  -d '{"query":"{ appProfiles(limit: 5) { items { appDid name } next } }"}'                                          # lists it first
curl -s "https://renown-staging.vetra.io/app/$DID" | grep -oE '<meta (property|name)="(og|twitter):[a-z:]+" content="[^"]*"'
```

- [ ] **Step 4: The pages.** "View on Renown" opens `https://renown-staging.vetra.io/app/<did>`: cover, logo, name, tagline, category, rendered description (the `javascript:` line is plain text), links, "Published by <you>" → `/@<handle>`. That profile shows the **Publisher** badge and **Apps published** with the app. Back on vetra.io, the app's **Overview** shows the Public profile card; "Edit profile" opens the tab.
- [ ] **Step 5: Edges.** Remove the logo and save → `https://renown-staging.vetra.io/media/$DOC/logo` → 404, pages show the monogram. Open an **old** staging app → Profile → change the tagline → Save → inline/toast "Renown refused: this wallet does not own the app's Renown identity." (expected: its identity lives on prod Renown). A licensing-only app without an identity shows "No Renown identity yet".
- [ ] **Step 6: Record** the curl outputs (no tokens) and browser findings in the hand-off note. Anything broken goes back to its task before Task 14.

### Task 14: Promote to production *(controller-run)*

- [ ] **Step 1: CORS on prod** — Task 12 Step 1 with bucket `renown-attachments`, switchboard `https://switchboard.renown.vetra.io`, origin `https://vetra.io` (and `https://www.vetra.io` if vetra.io serves it). Then Task 12 Step 2 against the prod Renown switchboard and the prod Vetra switchboard (`tenants/vetra`); tokens set and matching, `RENOWN_STATS_PROFILE_APPS` unset. Stop on any miss.
- [ ] **Step 2: renown-package → `main`, release `latest`.**

```bash
cd /home/f/projects/renown-package-hub
git fetch origin
git switch -C main origin/main
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 2 (app profiles)"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run --coverage 2>&1 | tail -15 && pnpm build 2>&1 | tail -3
git push git@github.com:powerhouse-inc/renown-package.git main
gh workflow run sync-and-publish.yml -R powerhouse-inc/renown-package --ref main -f channel=latest -f sync=false
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown-package --workflow sync-and-publish.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown-package "$RUN" --exit-status
git switch feat/identity-hub
```

Expected: release `v1.(n+1).0`; deploy commit touches only `tenants/renown/powerhouse-values.yaml`; Task 12 Step 4's curls against `https://switchboard.renown.vetra.io` answer the same (appProfiles data, FORBIDDEN ×2, 404, 401).

- [ ] **Step 3: vetra-cloud-package → `main`, then pin it on the prod tenant.**

```bash
cd /home/f/projects/vetra-cloud-package-profiles
git fetch origin
git switch --detach origin/main
git merge --no-ff feat/identity-hub-profiles -m "chore: merge identity hub phase 2 (app profile relay)"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run 2>&1 | tail -15
git push git@github.com:powerhouse-inc/vetra-cloud-package.git HEAD:main
sleep 5; RUN=$(gh run list -R powerhouse-inc/vetra-cloud-package --workflow sync-and-publish.yml --branch main -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/vetra-cloud-package "$RUN" --exit-status
git fetch -q origin main && VER=$(git show origin/main:package.json | jq -r .version) && echo "$VER"   # e.g. 0.0.62
git switch feat/identity-hub-profiles
cd /home/f/projects/powerhouse-k8s-hosting
git pull --ff-only
sed -i -E "s#(@powerhousedao/vetra-cloud-package@)[0-9][^\",]*#\1${VER}#g" tenants/vetra/powerhouse-values.yaml
git diff --stat   # exactly 2 lines in tenants/vetra/powerhouse-values.yaml
git add tenants/vetra/powerhouse-values.yaml
git commit -m "chore(vetra): vetra-cloud-package ${VER} (identity hub phase 2)"
git push
```

After the rollout: `curl -s https://switchboard.vetra.io/graphql -H 'content-type: application/json' -d '{"query":"mutation { vetraPublisher { updateAppProfile(input: { appId: \"x\" }) } }"}' | grep -o '"code":"[A-Z_]*"'` → `UNAUTHENTICATED`.

- [ ] **Step 4: renown.id → `main`.**

```bash
cd /home/f/projects/renown-hub
git fetch origin
git switch -C main origin/main
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 2 (app pages)"
git push git@github.com:powerhouse-inc/renown.git main
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown --workflow semantic-release.yml --branch main -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown "$RUN" --exit-status
VERSION=$(git fetch --tags -q && git describe --tags --abbrev=0 origin/main)
git switch feat/identity-hub
cd /home/f/projects/powerhouse-k8s-hosting
git pull --ff-only
sed -i -E "s/^(    tag: )1\.[0-9]+\.[0-9]+$/\1${VERSION#v}/" tenants/renown/powerhouse-values.yaml
git diff --stat   # exactly one line: app.image.tag in tenants/renown/powerhouse-values.yaml
git add tenants/renown/powerhouse-values.yaml
git commit -m "chore(renown): renown-app ${VERSION#v} (identity hub phase 2)"
git push
```

Vercel deploys `www.renown.id` from `main` on its own; wait until `curl -s -o /dev/null -w "%{http_code}\n" https://www.renown.id/app/did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK` → `404` (the page exists).

- [ ] **Step 5: vetra.io → `main` (its workflow bumps `tenants/vetra`).**

```bash
cd /home/f/projects/vetra.io-hub
git fetch origin
git switch -C main origin/main
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 2 (app profiles)"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm test:unit 2>&1 | tail -10
git push git@github.com:powerhouse-inc/vetra.to.git main
SHA7=$(git rev-parse --short=7 HEAD)
sleep 5; RUN=$(gh run list -R powerhouse-inc/vetra.to --workflow publish-docker-image.yml --branch main -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/vetra.to "$RUN" --exit-status
git switch feat/identity-hub
git -C /home/f/projects/powerhouse-k8s-hosting pull --ff-only
grep -A3 "repository: cr.vetra.io/vetra/vetra-to" /home/f/projects/powerhouse-k8s-hosting/tenants/vetra/powerhouse-values.yaml   # tag: main-${SHA7}
```

`main` and `staging` of vetra.io now both carry Phase 2.

- [ ] **Step 6: Prod verification.** Task 13 Steps 2–5 on `https://vetra.io` and `https://www.renown.id` with a real app you own (prod apps already have prod identities, so no new app is needed); check that an app whose profile predates Phase 2 (name/tagline/legacy logo only) still renders on `/app/<did>` and opens in the Profile tab with its fields filled. Record the results.

## Follow-ups (not in this plan)

- **F1 (Phase 1) covers app images too:** the unreferenced-upload sweep must also keep hashes referenced by `renown-stats.app_profile_images.logo_ref/cover_ref`.
- **Phase 3** adds `metrics` to the model, `upsertAppProfile` (another flat argument, relayed by Task 5's client through `PROFILE_WRITE_KEYS`) and the Profile tab's "Metrics" section; the app page's stats section goes where `pages/app/[did].tsx` marks it.
- **Ruling 1 alternative:** if bearer replay through Vetra's API is judged unacceptable later, add an EIP-712 "Update app profile" signature to `updateAppProfile` and verify it in renown-stats alongside the relay token.
