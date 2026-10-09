# Identity Hub — Phase 1 (User Identity) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Renown user gets an editable public profile — uploaded avatar, display name, unique handle, bio and links — saved with one wallet signature, served at `renown.id/@handle` with a stable, embeddable image URL.

**Architecture:** The `renown-user` model grows additively in v1 (new optional fields + eight operations). `renown_upsertProfile` gains the fields with patch semantics, validates handles (format, reserved list, case-insensitive uniqueness) and avatars (the stored object itself: size, type and magic bytes) before dispatching. A new `media/` module in renown-package, mounted from the `renown-user` processor factory (the only place a package receives the host's attachment client and HTTP scope), serves the gated upload route and the public media route on the switchboard. renown.id uploads straight from the browser with the user's Renown bearer, signs one profile upsert, and renders `/@handle`, `/profile/edit` and `/media/<doc>/<field>`.

**Tech Stack:** Powerhouse 6.2.3 (`ph-cli generate`, reactor-api package HTTP routes, `@powerhousedao/reactor-attachments` S3 primitives), Kysely + PGlite (tests), Vitest, viem; Next 16 pages router, Tailwind 4, wagmi, `@powerhousedao/reactor-browser/renown`, Playwright (with the local stub switchboard).

**Spec:** `/home/f/projects/renown-package-hub/docs/superpowers/specs/2026-10-09-renown-identity-hub-design.md` (Phase 1, Global constraints; spec Phase 0 item 5 "stable media URLs" is delivered here)

## Ruling needed

Decisions taken in this plan that differ from (or sharpen) the brief. Each has a default the plan implements; overrule before Task 4/7 starts if you disagree.

1. **Uploads go browser → package route with the user's bearer; no renown.id upload API, no service wallet, no OpenBao/ExternalSecret work.** Brief decision 5 put uploads behind a renown.id server API with a service credential. After the Phase 0 review closed raw `/attachments/reservations` at the ingress, the gate is the new package route `POST /api/@powerhousedao/renown-package/media/uploads` (Renown bearer required, png/jpeg/webp only, ≤ 2 MB, 20 reservations/hour per identity). The browser on renown.id already holds a Renown bearer (`useRenown().getBearerToken`), the switchboard's CORS middleware covers package routes (`cors()` on the whole router, `adapter-http-express.ts`), and the bucket gets CORS for renown.id/vetra.io (coordinator item 3). A server hop adds a second credential to protect and nothing the gate does not already enforce. vetra.io (Phase 2) uses the same route the same way.
2. **The server-side "attachment service" can reserve but cannot read or presign on S3, so the media code talks to the bucket with the switchboard's own S3 settings.** In 6.2.3 a package gets the host attachment client only through the processor host module (`IProcessorHostModule.attachments = createAttachmentClient(attachments.service)`, `packages/reactor-api/src/server.ts` `_setupAPI`; subgraph args carry none). Its `reserve()` works (it inserts the attachment row and, on S3, presigns a PUT). But `getShareLink`/`service.getDownloadTarget` reject server-side (`KyselyAttachmentStore` has no `getDownloadTarget`), and `download()` reads bytes from local disk even when the backend is S3 (`storage/kysely/attachment-store.ts` `get()`), and on S3 the attachment row is written as `available` with the client's claimed type/size at reservation time (`storage/s3/backend.ts` `prepareUploadTarget`). So `media/s3-backend.ts` builds `createS3AttachmentPrimitives(parseAttachmentStorageConfig(process.env).s3)` (both exported from `@powerhousedao/reactor-attachments` 6.2.3 root) for HEAD, ranged GET (magic bytes) and presigned GET; reservations still go through `module.attachments.reserve`. The media route therefore 302s to a presigned S3 URL exactly as preferred; no fallback credential is needed.
3. **The upload target is re-presigned with a signed `content-length`.** The host's presigned PUT signs content-type and checksum, not length. `media/s3-backend.ts` presigns its own `PutObjectCommand` with `ContentLength` (signable per `@smithy/signature-v4`; `s3-request-presigner` only unsigns `content-type`), so the bucket refuses any other size. Task 12's smoke proves it on staging; if Hetzner ignored the signed length the smoke fails loudly and the avatar check (real HEAD size) plus the follow-up GC remain the backstop.
4. **Model additions beyond the spec's error list:** `InvalidLinkError` (`INVALID_LINK`) on `ADD_LINK`/`UPDATE_LINK` — the generated `URL` scalar is `z.url()`, which accepts `javascript:alert(1)`, so the reducer itself only stores http(s) URLs ≤ 2048 chars and labels of 1–40 chars. `REORDER_LINKS` moves the listed ids to the front (unlisted keep their order; unknown id → `LinkNotFoundError`), so no extra "invalid order" error. `SET_DISPLAY_NAME` rejects surrounding whitespace (the write path trims first). `SET_BIO` with `""` or `null` clears.
5. **Unreferenced-upload GC is deferred** to a follow-up (see "Follow-up F1" at the end), per the coordinator's option. Exposure until then: ≤ 20 reservations/hour/identity, each ≤ 2 MB (length-pinned).
6. **Spec says GraphQL type `RenownUser`; the read model's type is `ReadRenownUser`.** The new fields go on `ReadRenownUser` (+ `ReadRenownUserLink`), plus a new public query `renownHandleAvailability(handle, address)` for the editor's live check.
7. **Test seam on renown.id:** the Playwright dev server runs with `NEXT_PUBLIC_E2E_AUTH=1`, which lets `/profile/edit` take its upload bearer from `window.__renownE2eBearer` (the real Renown SDK login cannot complete against the stub). Inert in every other build (the CI build args never set it).
8. **ENS "fill empty" treats the short-address username issuance seeds (`0x1234...abcd`) as empty**, otherwise wallets that logged in before having an ENS name would never get it.

## Global Constraints

- Staging first, then prod, for every phase (renown, vetra-cloud-package, vetra.io).
- No `Co-Authored-By` / "Generated with" trailers in commits or PRs. Stage explicit paths only (never `git add -A`/`.`).
- Never edit `gen/` folders; document-model changes go through the model JSON + `pnpm generate document-model --document <json>` (never `generate all`); reducer code lives in `v1/src/reducers`.
- Reducers pure; new reducer code ≥ 95 % coverage (lines, branches, functions, statements); every new error code has a test; reducer errors are asserted via `operations.global[i].error`, never `.toThrow()`.
- Existing documents must stay valid: model changes are **additive within v1** (new optional fields, new operations; nothing removed or retyped). Legacy profiles have no `links` key at all — every reader/reducer treats it as `[]`.
- Every image is validated client-side (png/jpeg/webp, ≤ 2 MB before resize) and server-side (type + size from the stored object, not the reservation) before a profile references it.
- Secrets never printed or pasted.
- Handle: `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`, reserved: `admin, api, app, apps, media, profile, settings, renown, vetra, powerhouse, www, help, about, login, console, oidc`; unique case-insensitively. displayName 1–64, bio ≤ 280, links ≤ 8.
- Signed message (unchanged scheme): `Update Renown profile <lowercase address> <sha256hex(payload)> at <ISO timestamp>`, ±600 000 ms. Payload: `{"username","userImage"}` (legacy, when no identity field is present) else exactly `{"username","userImage","displayName","handle","bio","links":[{"id","label","url"}],"avatar"}` with `null` for absent keys. renown.id keeps a verbatim copy; both sides pin the same vectors.
- Patch semantics on `renown_upsertProfile`: absent/`null` → unchanged; `""` → clear (text fields, avatar); `links` is the whole desired list (`[]` clears).
- Media URL contract: switchboard `GET /api/@powerhousedao/renown-package/media/<documentId>/<field>` and renown.id `GET /media/<documentId>/<field>`; `302` with `Cache-Control: public, max-age=60, stale-while-revalidate=240`, `404` (cacheable 60 s) when unknown/unset. Fields now: `avatar`.
- `@renown/sdk` 6.2.3 `DEFAULT_RENOWN_CHAIN_ID` is the string `"1"`: anything passing it to `buildAndSignCredential` must `Number()` it.
- Repos: renown-package `/home/f/projects/renown-package-hub` (branch `feat/identity-hub`); renown.id `/home/f/projects/renown-hub` (branch `feat/identity-hub`); hosting `/home/f/projects/powerhouse-k8s-hosting` (`main`, push directly — ArgoCD syncs). Pushes to GitHub use SSH: `git@github.com:powerhouse-inc/renown-package.git`, `git@github.com:powerhouse-inc/renown.git`.
- Checks — renown-package: `pnpm tsc`, `pnpm lint`, `pnpm exec vitest run --coverage` (the coverage include is `document-models/**/src/reducers/**`); renown.id: `pnpm exec tsc --noEmit -p .`, `pnpm lint`, `pnpm exec playwright test <spec>`. Warnings that already exist on `feat/identity-hub` are not yours to fix.

## Review Focus

1. **Old signers keep working:** a client that signs only `{username, userImage}` (vetra.io, pfnur, `@renown/sdk`, login refresh) must produce byte-identical messages — Task 5 and Task 7 pin the legacy vector `e586dca7…6130` next to the new ones.
2. **A raced duplicate handle must never wedge the read model:** two documents claiming `taken` within the processor's lag must index the second without a handle, not retry forever on the unique index — Task 2 test "indexes a raced duplicate handle as no handle"; the write path also holds in-process claims (Task 5 "claimed a moment ago").
3. **Bytes that lie about themselves:** HTML uploaded as `image/png`, or JPEG bytes labelled WebP, or an object larger than declared, must never become an avatar — Task 4 `avatarProblem` tests, Task 5 `INVALID_AVATAR` tests, Task 12 smoke (length pinning on real storage).
4. **Legacy profiles without a `links` key** must accept link operations and link patches — Task 1 "legacy profile" test, Task 5 "legacy profile without a links list".
5. **A `javascript:` link** must be refused by the write path, never stored by the reducer, and never rendered as an anchor — Task 1 (`InvalidLinkError`), Task 5 (`BAD_USER_INPUT`), Task 8 (`/@handle` renders no `Bad` link).

## File structure

renown-package (`/home/f/projects/renown-package-hub`):

| Path | Responsibility |
|---|---|
| `document-models/renown-user/renown-user.json` | model spec: identity fields + 8 operations + errors (codegen input) |
| `document-models/renown-user/v1/src/utils.ts` | limits + validators shared by reducers and the write path |
| `document-models/renown-user/v1/src/reducers/profile.ts` | reducers (incl. legacy `links` guard) |
| `processors/renown-user/{migrations,schema,processor,links}.ts` | read model columns, unique `lower(handle)`, link mirroring, race-safe handle write |
| `processors/renown-user/factory.ts` | lazily mounts `media/register.ts` on switchboard hosts |
| `media/image.ts` | image types, size caps, magic-byte sniffing |
| `media/backend.ts`, `media/s3-backend.ts`, `media/filesystem-backend.ts`, `media/registry.ts` | storage access (reserve / inspect / serve) |
| `media/slot.ts` | global slot through which the subgraph finds the backend (no storage imports) |
| `media/upload-route.ts`, `media/media-route.ts`, `media/register.ts` | the two HTTP routes and their registration |
| `media/avatar.ts` | "can this ref be an avatar?" |
| `subgraphs/renown-auth/core/{handle,handle-claims,profile-patch}.ts` | handle policy, in-process claims, patch validation + action diffing |
| `subgraphs/renown-auth/{resolvers,schema,lookups}.ts`, `core/signed-message.ts` | extended `renown_upsertProfile` |
| `subgraphs/renown-read-model/{schema,resolvers}.ts` | fields, handle lookup, `renownHandleAvailability` |
| `scripts/smoke/identity-profile.ts` | staging/prod end-to-end proof |

renown.id (`/home/f/projects/renown-hub`):

| Path | Responsibility |
|---|---|
| `services/renown-signed-messages.ts` | verbatim copy of the server's message code |
| `services/renown-profile-write.ts`, `pages/api/profile/update.ts`, `services/renown-credential.ts` | forward identity fields, relay codes + field |
| `services/switchboard.ts` | profile reads (new fields, handle), handle availability |
| `services/media.ts`, `pages/api/media/[documentId]/[field].ts`, `next.config.ts` | stable `/media/…` URL, `/@handle` rewrite |
| `utils/{identicon,ens,profile-url}.ts`, `components/profile/*` | public profile rendering |
| `pages/profile/[id].tsx` | SSR profile, canonical redirects, OG/Twitter meta |
| `services/wallet/profile-refresh.ts` | ENS fills only empty fields |
| `utils/{image-crop,profile-form}.ts`, `services/avatar-upload.ts`, `hooks/use-profile-editor-auth.ts`, `components/profile-edit/*`, `pages/profile/edit.tsx` | the editor |
| `components/auth/renown-login-button.tsx` | header avatar + "Edit profile" |
| `e2e/*` | specs; `e2e/support/stub-switchboard*.{mjs,ts}` gains package routes + fixtures |

---

## Part A — renown-package

### Task 1: `renown-user` identity fields (model + reducers)

**Files:**
- Modify: `document-models/renown-user/renown-user.json` (state schema, initial value, 8 operations)
- Regenerate: `document-models/renown-user/v1/gen/**`, `v1/schema.graphql` (codegen only)
- Replace: `document-models/renown-user/v1/src/utils.ts`, `document-models/renown-user/v1/src/reducers/profile.ts`
- Test: `document-models/renown-user/v1/tests/identity.test.ts`

**Interfaces:**
- Produces (all re-exported from `document-models/renown-user/index.js` and `document-models/renown-user/v1`):
  - state: `displayName?: string|null`, `handle?: string|null`, `bio?: string|null`, `links: RenownUserLink[]` (`{id,label,url}`), `avatar?: \`attachment://v${number}:${string}\`|null`
  - action creators: `setDisplayName({displayName})`, `setHandle({handle})`, `setBio({bio})`, `setAvatar({avatar})` (all nullable → clear), `addLink({id,label,url})`, `updateLink({id,label?,url?})`, `removeLink({id})`, `reorderLinks({linkIds})`; also on `actions.*`
  - utils: `MAX_LINKS=8`, `MAX_DISPLAY_NAME_LENGTH=64`, `MAX_BIO_LENGTH=280`, `MAX_LINK_LABEL_LENGTH=40`, `MAX_LINK_URL_LENGTH=2048`, `HANDLE_RE`, `isValidHandle(s)`, `isValidAvatarRef(s)` (`^attachment://v1:[0-9a-f]{64}$`), `isValidDisplayName(s)`, `isValidLinkLabel(s)`, `isValidLinkUrl(s)`
  - errors (`v1/gen/profile/error.ts`): `DisplayNameLengthError`, `InvalidHandleError`, `BioTooLongError`, `InvalidAvatarRefError`, `TooManyLinksError`, `DuplicateLinkIdError`, `InvalidLinkError`, `LinkNotFoundError`

- [ ] **Step 1: Extend the model spec and generate.** From the repo root:

```bash
python3 - <<'PLAN_EOF'
import json
p = "document-models/renown-user/renown-user.json"
d = json.load(open(p))
spec = d["specifications"][0]
spec["state"]["global"]["schema"] = (
    "type RenownUserState {\n"
    "  \"Add your global state fields here\"\n"
    "  username: String\n"
    "  ethAddress: EthereumAddress\n"
    "  userImage: String\n"
    "  \"Display name, 1-64 characters\"\n"
    "  displayName: String\n"
    "  \"Unique handle; uniqueness is enforced by the write path, not the reducer\"\n"
    "  handle: String\n"
    "  \"Short bio, at most 280 characters\"\n"
    "  bio: String\n"
    "  \"Profile links, at most 8, in display order\"\n"
    "  links: [RenownUserLink!]!\n"
    "  \"Uploaded avatar; userImage stays the external (ENS) image URL\"\n"
    "  avatar: AttachmentRef\n"
    "}\n\n"
    "type RenownUserLink {\n"
    "  id: OID!\n"
    "  label: String!\n"
    "  url: URL!\n"
    "}"
)
spec["state"]["global"]["initialValue"] = json.dumps(
    {"username": None, "ethAddress": None, "userImage": None, "displayName": None,
     "handle": None, "bio": None, "links": [], "avatar": None}, indent=2)

def err(eid, name, code, desc):
    return {"id": eid, "name": name, "code": code, "description": desc, "template": ""}

def op(oid, name, desc, schema, errors):
    return {"id": oid, "name": name, "description": desc, "schema": schema, "template": "",
            "reducer": "", "errors": errors, "examples": [], "scope": "global"}

new_ops = [
    op("set-display-name", "SET_DISPLAY_NAME", "Sets or clears (null) the display name",
       "input SetDisplayNameInput {\n  \"1-64 characters after trimming; null clears\"\n  displayName: String\n}",
       [err("display-name-length-error", "DisplayNameLengthError", "DISPLAY_NAME_LENGTH",
            "The display name is blank, has surrounding whitespace, or is longer than 64 characters")]),
    op("set-handle", "SET_HANDLE", "Sets or clears (null) the handle; uniqueness is checked by the write path",
       "input SetHandleInput {\n  \"^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$; null clears\"\n  handle: String\n}",
       [err("invalid-handle-error", "InvalidHandleError", "INVALID_HANDLE",
            "The handle does not match ^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$")]),
    op("set-bio", "SET_BIO", "Sets or clears (null or empty) the bio",
       "input SetBioInput {\n  \"At most 280 characters; null or empty clears\"\n  bio: String\n}",
       [err("bio-too-long-error", "BioTooLongError", "BIO_TOO_LONG", "The bio is longer than 280 characters")]),
    op("set-avatar", "SET_AVATAR", "Sets or clears (null) the uploaded avatar",
       "input SetAvatarInput {\n  \"attachment://v1:<sha256>; null clears\"\n  avatar: AttachmentRef\n}",
       [err("invalid-avatar-ref-error", "InvalidAvatarRefError", "INVALID_AVATAR_REF",
            "The avatar is not an attachment://v1:<64 lowercase hex> reference")]),
    op("add-link", "ADD_LINK", "Appends a profile link",
       "input AddLinkInput {\n  id: OID!\n  \"1-40 characters after trimming\"\n  label: String!\n  \"http(s) URL, at most 2048 characters\"\n  url: URL!\n}",
       [err("too-many-links-error", "TooManyLinksError", "TOO_MANY_LINKS", "The profile already has 8 links"),
        err("duplicate-link-id-error", "DuplicateLinkIdError", "DUPLICATE_LINK_ID", "A link with this id already exists"),
        err("invalid-link-error", "InvalidLinkError", "INVALID_LINK",
            "The label is blank or longer than 40 characters, or the URL is not an http(s) URL of at most 2048 characters")]),
    op("update-link", "UPDATE_LINK", "Changes the label and/or URL of a link",
       "input UpdateLinkInput {\n  id: OID!\n  label: String\n  url: URL\n}",
       [err("link-not-found-error", "LinkNotFoundError", "LINK_NOT_FOUND", "No link with this id exists")]),
    op("remove-link", "REMOVE_LINK", "Removes a link",
       "input RemoveLinkInput {\n  id: OID!\n}", []),
    op("reorder-links", "REORDER_LINKS",
       "Moves the listed links to the front in the given order; unlisted links keep their relative order after them",
       "input ReorderLinksInput {\n  linkIds: [OID!]!\n}", []),
]
spec["modules"][0]["operations"].extend(new_ops)
json.dump(d, open(p, "w"), indent=2)
open(p, "a").write("\n")
PLAN_EOF
pnpm generate document-model --document document-models/renown-user/renown-user.json
```

Expected: `v1/gen/**`, `v1/schema.graphql` change; `v1/src/reducers/profile.ts` gains eight stub methods that `throw new Error("Reducer for '…' not implemented.")`. The generator also rewrites `v1/tests/profile.test.ts` (adds imports) and may reorder keys in `powerhouse.manifest.json` — restore both: `git checkout -- document-models/renown-user/v1/tests/profile.test.ts powerhouse.manifest.json` (then `git diff --stat` must show only `renown-user.json`, `v1/gen/**`, `v1/schema.graphql`, `v1/src/reducers/profile.ts`).

- [ ] **Step 2: Write the failing tests.**

Create `document-models/renown-user/v1/tests/identity.test.ts` with exactly:

```ts
import { describe, expect, it } from "vitest";
import {
  addLink,
  isValidHandle,
  MAX_LINKS,
  reducer,
  removeLink,
  reorderLinks,
  setAvatar,
  setBio,
  setDisplayName,
  setHandle,
  updateLink,
  utils,
} from "document-models/renown-user/v1";

const REF = `attachment://v1:${"a".repeat(64)}` as const;
const L1 = { id: "link-1", label: "Website", url: "https://frank.example" };
const L2 = { id: "link-2", label: "GitHub", url: "https://github.com/frank" };
const L3 = { id: "link-3", label: "Blog", url: "http://blog.example/feed" };

type Doc = ReturnType<typeof utils.createDocument>;

/** Each global operation's error message (undefined when it applied). */
function errors(doc: Doc): (string | undefined)[] {
  return doc.operations.global.map((op) => op.error);
}

describe("RenownUser identity fields", () => {
  it("edits a full profile and clears it again", () => {
    let d = utils.createDocument();
    d = reducer(d, setDisplayName({ displayName: "Frank" }));
    d = reducer(d, setHandle({ handle: "frank-p" }));
    d = reducer(d, setBio({ bio: "Builds Renown." }));
    d = reducer(d, setAvatar({ avatar: REF }));
    d = reducer(d, addLink(L1));
    d = reducer(d, addLink(L2));
    d = reducer(d, addLink(L3));
    d = reducer(d, updateLink({ id: "link-2", label: "Code" }));
    d = reducer(d, updateLink({ id: "link-2", url: "https://codeberg.org/frank" }));
    d = reducer(d, reorderLinks({ linkIds: ["link-3", "link-1", "link-3"] }));
    expect(errors(d)).toEqual(Array(10).fill(undefined));
    expect(d.state.global).toMatchObject({
      displayName: "Frank",
      handle: "frank-p",
      bio: "Builds Renown.",
      avatar: REF,
      links: [L3, L1, { id: "link-2", label: "Code", url: "https://codeberg.org/frank" }],
    });

    d = reducer(d, removeLink({ id: "link-1" }));
    d = reducer(d, setDisplayName({ displayName: null }));
    d = reducer(d, setHandle({ handle: null }));
    d = reducer(d, setBio({ bio: "" }));
    d = reducer(d, setAvatar({ avatar: null }));
    d = reducer(d, setBio({ bio: null }));
    expect(errors(d).slice(10)).toEqual(Array(6).fill(undefined));
    expect(d.state.global).toMatchObject({
      displayName: null,
      handle: null,
      bio: null,
      avatar: null,
      links: [L3, { id: "link-2", label: "Code", url: "https://codeberg.org/frank" }],
    });
  });

  it("rejects invalid scalar fields and leaves state unchanged", () => {
    let d = utils.createDocument();
    d = reducer(d, setDisplayName({ displayName: "" }));
    d = reducer(d, setDisplayName({ displayName: " Frank" }));
    d = reducer(d, setDisplayName({ displayName: "x".repeat(65) }));
    d = reducer(d, setHandle({ handle: "Frank" }));
    d = reducer(d, setHandle({ handle: "ab" }));
    d = reducer(d, setHandle({ handle: "-frank" }));
    d = reducer(d, setBio({ bio: "b".repeat(281) }));
    d = reducer(d, setAvatar({ avatar: "attachment://v1:not-a-hash" }));
    d = reducer(d, setAvatar({ avatar: `attachment://v2:${"a".repeat(64)}` }));
    const e = errors(d);
    expect(e.slice(0, 3).every((m) => /display name/i.test(m ?? ""))).toBe(true);
    expect(e.slice(3, 6).every((m) => /invalid handle/i.test(m ?? ""))).toBe(true);
    expect(e[6]).toMatch(/280/);
    expect(e.slice(7).every((m) => /avatar/i.test(m ?? ""))).toBe(true);
    expect(d.state.global).toMatchObject({ displayName: null, handle: null, bio: null, avatar: null });
    // Boundaries that are valid.
    d = reducer(d, setDisplayName({ displayName: "x".repeat(64) }));
    d = reducer(d, setBio({ bio: "b".repeat(280) }));
    d = reducer(d, setHandle({ handle: `a${"-".repeat(28)}z` }));
    expect(errors(d).slice(9)).toEqual([undefined, undefined, undefined]);
    expect(isValidHandle("abc")).toBe(true);
    expect(isValidHandle(`a${"b".repeat(29)}`)).toBe(true);
    expect(isValidHandle(`a${"b".repeat(30)}`)).toBe(false);
  });

  it("enforces the link rules", () => {
    let d = utils.createDocument();
    for (let i = 0; i < MAX_LINKS; i++) {
      d = reducer(d, addLink({ id: `l${i}`, label: `L${i}`, url: `https://x.example/${i}` }));
    }
    d = reducer(d, addLink({ id: "l9", label: "Ninth", url: "https://x.example/9" }));
    d = reducer(d, addLink({ id: "l0", label: "Dup", url: "https://x.example/d" }));
    expect(errors(d)[MAX_LINKS]).toMatch(/at most 8/);
    expect(errors(d)[MAX_LINKS + 1]).toMatch(/already used/);

    d = reducer(utils.createDocument(), addLink({ id: "a", label: "", url: "https://ok.example" }));
    d = reducer(d, addLink({ id: "b", label: "x".repeat(41), url: "https://ok.example" }));
    d = reducer(d, addLink({ id: "c", label: "XSS", url: "javascript:alert(1)" }));
    d = reducer(d, addLink({ id: "d", label: "Long", url: `https://x.example/${"p".repeat(2048)}` }));
    d = reducer(d, addLink(L1));
    d = reducer(d, updateLink({ id: "link-1", url: "data:text/html,hi" }));
    d = reducer(d, updateLink({ id: "missing", label: "x" }));
    d = reducer(d, removeLink({ id: "missing" }));
    d = reducer(d, reorderLinks({ linkIds: ["missing"] }));
    const e = errors(d);
    expect(e.slice(0, 2).every((m) => /label/i.test(m ?? ""))).toBe(true);
    expect(e.slice(2, 4).every((m) => /URL/.test(m ?? ""))).toBe(true);
    expect(e[4]).toBeUndefined();
    expect(e[5]).toMatch(/URL/);
    expect(e.slice(6).every((m) => /No link with id missing/.test(m ?? ""))).toBe(true);
    expect(d.state.global.links).toEqual([L1]);
  });

  it("treats a legacy profile without a links list as empty", () => {
    const legacy = () => {
      const doc = utils.createDocument();
      delete (doc.state.global as { links?: unknown }).links;
      return doc;
    };
    expect(reducer(legacy(), addLink(L1)).state.global.links).toEqual([L1]);
    expect(reducer(legacy(), removeLink({ id: "x" })).operations.global[0].error).toMatch(/No link/);
    expect(reducer(legacy(), updateLink({ id: "x" })).operations.global[0].error).toMatch(/No link/);
    expect(reducer(legacy(), reorderLinks({ linkIds: [] })).state.global.links).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them to see them fail.** `pnpm exec vitest run document-models/renown-user` → FAIL: the identity tests report `Reducer for 'setDisplayNameOperation' not implemented.` as operation errors (and `isValidHandle`/`MAX_LINKS` are not exported yet).

- [ ] **Step 4: Implement utils and reducers.**

Replace the whole of `document-models/renown-user/v1/src/utils.ts` with exactly:

```ts
/** Most links one profile may hold. */
export const MAX_LINKS = 8;
export const MAX_DISPLAY_NAME_LENGTH = 64;
export const MAX_BIO_LENGTH = 280;
export const MAX_LINK_LABEL_LENGTH = 40;
export const MAX_LINK_URL_LENGTH = 2048;

/** 3-30 chars, lowercase letters/digits/hyphens, no leading or trailing hyphen. */
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const AVATAR_REF_RE = /^attachment:\/\/v1:[0-9a-f]{64}$/;

export function isValidHandle(value: string): boolean {
  return HANDLE_RE.test(value);
}

export function isValidAvatarRef(value: string): boolean {
  return AVATAR_REF_RE.test(value);
}

/** A display name is non-blank, carries no surrounding whitespace and fits 64 chars. */
export function isValidDisplayName(value: string): boolean {
  return value.length > 0 && value === value.trim() && value.length <= MAX_DISPLAY_NAME_LENGTH;
}

export function isValidLinkLabel(value: string): boolean {
  return value.length > 0 && value === value.trim() && value.length <= MAX_LINK_LABEL_LENGTH;
}

/** Only http(s) links are stored, so a profile never renders a javascript: or data: href. */
export function isValidLinkUrl(value: string): boolean {
  if (value.length > MAX_LINK_URL_LENGTH) return false;
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
```

Replace the whole of `document-models/renown-user/v1/src/reducers/profile.ts` with exactly:

```ts
import type {
  RenownUserLink,
  RenownUserProfileOperations,
  RenownUserState,
} from "document-models/renown-user/v1";
import {
  BioTooLongError,
  DisplayNameLengthError,
  DuplicateLinkIdError,
  InvalidAvatarRefError,
  InvalidHandleError,
  InvalidLinkError,
  LinkNotFoundError,
  TooManyLinksError,
} from "../../gen/profile/error.js";
import {
  isValidAvatarRef,
  isValidDisplayName,
  isValidHandle,
  isValidLinkLabel,
  isValidLinkUrl,
  MAX_BIO_LENGTH,
  MAX_LINKS,
} from "../utils.js";

/**
 * The document's links. Profiles created before links existed carry no
 * `links` key at all; they are treated as empty and the list is created on
 * first write.
 */
function linksOf(state: RenownUserState): RenownUserLink[] {
  const legacy = state as { links?: RenownUserLink[] };
  legacy.links ??= [];
  return legacy.links;
}

function assertLink(label: string, url: string): void {
  if (!isValidLinkLabel(label)) {
    throw new InvalidLinkError("Link label must be 1-40 characters without surrounding whitespace");
  }
  if (!isValidLinkUrl(url)) {
    throw new InvalidLinkError("Link URL must be an http(s) URL of at most 2048 characters");
  }
}

export const renownUserProfileOperations: RenownUserProfileOperations = {
  setUsernameOperation(state, action) {
    state.username = action.input.username;
  },
  setEthAddressOperation(state, action) {
    state.ethAddress = action.input.ethAddress;
  },
  setUserImageOperation(state, action) {
    state.userImage = action.input.userImage;
  },
  setDisplayNameOperation(state, action) {
    const { displayName } = action.input;
    if (displayName == null) {
      state.displayName = null;
      return;
    }
    if (!isValidDisplayName(displayName)) {
      throw new DisplayNameLengthError(
        "Display name must be 1-64 characters without surrounding whitespace",
      );
    }
    state.displayName = displayName;
  },
  setHandleOperation(state, action) {
    const { handle } = action.input;
    if (handle == null) {
      state.handle = null;
      return;
    }
    if (!isValidHandle(handle)) {
      throw new InvalidHandleError(`Invalid handle: ${handle}`);
    }
    state.handle = handle;
  },
  setBioOperation(state, action) {
    const { bio } = action.input;
    if (bio != null && bio.length > MAX_BIO_LENGTH) {
      throw new BioTooLongError(`Bio exceeds ${MAX_BIO_LENGTH} characters`);
    }
    state.bio = bio || null;
  },
  setAvatarOperation(state, action) {
    const { avatar } = action.input;
    if (avatar != null && !isValidAvatarRef(avatar)) {
      throw new InvalidAvatarRefError(`Invalid avatar reference: ${avatar}`);
    }
    state.avatar = avatar ?? null;
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
    if (index === -1) throw new LinkNotFoundError(`No link with id ${action.input.id}`);
    links.splice(index, 1);
  },
  reorderLinksOperation(state, action) {
    const links = linksOf(state);
    const byId = new Map(links.map((link) => [link.id, link]));
    const front: RenownUserLink[] = [];
    for (const id of action.input.linkIds) {
      const link = byId.get(id);
      if (!link) throw new LinkNotFoundError(`No link with id ${id}`);
      if (!front.includes(link)) front.push(link);
    }
    state.links = [...front, ...links.filter((link) => !front.includes(link))];
  },
};
```

- [ ] **Step 5: Run tests, coverage, types, lint.** `pnpm exec vitest run document-models/renown-user` → PASS (all renown-user tests, incl. the untouched `profile.test.ts`). `pnpm exec vitest run --coverage` → `renown-user …/profile.ts` 100 % in every column and the global 95 % thresholds pass. `pnpm tsc` and `pnpm lint` → no errors.

- [ ] **Step 6: Commit.**

```bash
git add document-models/renown-user/renown-user.json document-models/renown-user/v1/gen document-models/renown-user/v1/schema.graphql document-models/renown-user/v1/src/utils.ts document-models/renown-user/v1/src/reducers/profile.ts document-models/renown-user/v1/tests/identity.test.ts
git commit -m "feat(renown-user): display name, handle, bio, links and avatar"
```

### Task 2: Read model — identity columns, unique handle, link mirroring

**Files:**
- Replace: `processors/renown-user/migrations.ts`, `processors/renown-user/schema.ts`, `processors/renown-user/processor.ts`
- Create: `processors/renown-user/links.ts`
- Test: `processors/tests/renown-user-identity.test.ts`

**Interfaces:**
- Consumes: Task 1 action types and inputs (`SET_DISPLAY_NAME {displayName}`, `SET_HANDLE {handle}`, `SET_BIO {bio}`, `SET_AVATAR {avatar}`, `ADD_LINK`, `UPDATE_LINK`, `REMOVE_LINK`, `REORDER_LINKS`).
- Produces: table `renown_user` gains `display_name varchar(64)`, `handle varchar(30)`, `bio varchar(280)`, `links jsonb not null default '[]'`, `avatar_ref varchar(90)`; unique index `idx_renown_user_handle_lower` on `LOWER(handle)`. Kysely type `DB.renown_user` with `links: Generated<Json<RenownUserLinkRow[]>>` (read as parsed array, written as JSON string). `nextLinks(links, type, input): StoredLink[] | undefined`. The processor skips operations that carry `operation.error`, and on a `23505` for a handle indexes the row with `handle = null` (logged) instead of throwing.

- [ ] **Step 1: Write the failing test.**

Create `processors/tests/renown-user-identity.test.ts` with exactly:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { OperationWithContext } from "@powerhousedao/reactor-browser";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RenownUserProcessor } from "../renown-user/index.js";
import { nextLinks } from "../renown-user/links.js";
import { up } from "../renown-user/migrations.js";
import type { DB } from "../renown-user/schema.js";

const FILTER = { branch: ["main"], documentId: ["*"], documentType: [], scope: ["global"] };
const REF = `attachment://v1:${"b".repeat(64)}`;
let root: Kysely<DB>;
let processor: RenownUserProcessor;

beforeAll(async () => {
  root = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ident`.execute(root);
  await up(root.withSchema("ident") as never);
  await up(root.withSchema("ident") as never); // idempotent on an existing table
  processor = new RenownUserProcessor("ident", FILTER, root.withSchema("ident") as never);
});

afterAll(async () => {
  await root.destroy();
});

let ordinal = 0;
function op(documentId: string, type: string, input: unknown, error?: string): OperationWithContext {
  ordinal += 1;
  return {
    operation: { index: ordinal, action: { type, input }, ...(error ? { error } : {}) },
    context: { documentId, documentType: "powerhouse/renown-user", scope: "global", branch: "main", ordinal },
  } as unknown as OperationWithContext;
}

function row(documentId: string) {
  return root.withSchema("ident").selectFrom("renown_user").selectAll().where("document_id", "=", documentId).executeTakeFirstOrThrow();
}

describe("renown-user read model identity columns", () => {
  it("indexes display name, handle, bio, avatar and links, and clears them", async () => {
    await processor.onOperations([
      op("u1", "SET_DISPLAY_NAME", { displayName: "Frank" }),
      op("u1", "SET_HANDLE", { handle: "frank" }),
      op("u1", "SET_BIO", { bio: "Hi" }),
      op("u1", "SET_AVATAR", { avatar: REF }),
      op("u1", "ADD_LINK", { id: "a", label: "Site", url: "https://a.example" }),
      op("u1", "ADD_LINK", { id: "b", label: "Code", url: "https://b.example" }),
      op("u1", "UPDATE_LINK", { id: "b", label: "Git" }),
      op("u1", "REORDER_LINKS", { linkIds: ["b"] }),
      op("u1", "ADD_LINK", { id: "c", label: "Bad", url: "javascript:x" }, "InvalidLinkError"),
    ]);
    expect(await row("u1")).toMatchObject({
      display_name: "Frank",
      handle: "frank",
      bio: "Hi",
      avatar_ref: REF,
      links: [
        { id: "b", label: "Git", url: "https://b.example" },
        { id: "a", label: "Site", url: "https://a.example" },
      ],
    });

    await processor.onOperations([
      op("u1", "REMOVE_LINK", { id: "a" }),
      op("u1", "SET_DISPLAY_NAME", { displayName: null }),
      op("u1", "SET_HANDLE", { handle: null }),
      op("u1", "SET_BIO", { bio: null }),
      op("u1", "SET_AVATAR", { avatar: null }),
    ]);
    expect(await row("u1")).toMatchObject({
      display_name: null,
      handle: null,
      bio: null,
      avatar_ref: null,
      links: [{ id: "b", label: "Git", url: "https://b.example" }],
    });
  });

  it("indexes a raced duplicate handle as no handle instead of wedging", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await processor.onOperations([
      op("u2", "SET_HANDLE", { handle: "taken" }),
      op("u3", "SET_HANDLE", { handle: "taken" }),
      op("u3", "SET_DISPLAY_NAME", { displayName: "Still indexed" }),
    ]);
    expect((await row("u2")).handle).toBe("taken");
    expect(await row("u3")).toMatchObject({ handle: null, display_name: "Still indexed" });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/handle of u3 is already taken/));
    log.mockRestore();
  });

  it("rejects a second handle differing only in case at the index", async () => {
    await expect(
      root.withSchema("ident").insertInto("renown_user").values({ document_id: "u4", username: null, eth_address: null, user_image: null, handle: "TAKEN" }).execute(),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("nextLinks", () => {
  const a = { id: "a", label: "A", url: "https://a.example" };
  const b = { id: "b", label: "B", url: "https://b.example" };
  it("mirrors the reducer for each link operation", () => {
    expect(nextLinks([a], "ADD_LINK", b)).toEqual([a, b]);
    expect(nextLinks([a, b], "UPDATE_LINK", { id: "a", url: "https://c.example" })).toEqual([{ ...a, url: "https://c.example" }, b]);
    expect(nextLinks([a, b], "REMOVE_LINK", { id: "a" })).toEqual([b]);
    expect(nextLinks([a, b], "REORDER_LINKS", { linkIds: ["b", "b", "zz"] })).toEqual([b, a]);
    expect(nextLinks([a, b], "REORDER_LINKS", {})).toEqual([a, b]);
    expect(nextLinks([a], "SET_USERNAME", { username: "x" })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec vitest run processors/tests/renown-user-identity.test.ts` → FAIL (`Cannot find module '../renown-user/links.js'`).

- [ ] **Step 3: Implement.**

Create `processors/renown-user/links.ts` with exactly:

```ts
/** A link as the read model stores it (`renown_user.links`, jsonb). */
export interface StoredLink {
  id: string;
  label: string;
  url: string;
}

/**
 * The links after one link operation, mirroring the renown-user reducer for
 * operations that succeeded (failed ones never reach this function). Returns
 * `undefined` for any other action type.
 */
export function nextLinks(
  links: StoredLink[],
  type: string,
  input: Record<string, unknown>,
): StoredLink[] | undefined {
  switch (type) {
    case "ADD_LINK":
      return [...links, { id: String(input.id), label: String(input.label), url: String(input.url) }];
    case "UPDATE_LINK":
      return links.map((link) =>
        link.id === input.id
          ? {
              id: link.id,
              label: typeof input.label === "string" ? input.label : link.label,
              url: typeof input.url === "string" ? input.url : link.url,
            }
          : link,
      );
    case "REMOVE_LINK":
      return links.filter((link) => link.id !== input.id);
    case "REORDER_LINKS": {
      const ids = Array.isArray(input.linkIds) ? input.linkIds.map(String) : [];
      const front: StoredLink[] = [];
      for (const id of ids) {
        const link = links.find((l) => l.id === id);
        if (link && !front.includes(link)) front.push(link);
      }
      return [...front, ...links.filter((link) => !front.includes(link))];
    }
    default:
      return undefined;
  }
}
```

Replace the whole of `processors/renown-user/migrations.ts` with exactly:

```ts
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { sql } from "kysely";

export async function up(db: IRelationalDb<any>): Promise<void> {
  // Create renown_user table
  await db.schema
    .createTable("renown_user")
    .addColumn("document_id", "varchar(255)")
    .addColumn("username", "varchar(255)")
    .addColumn("eth_address", "varchar(42)")
    .addColumn("user_image", "text")
    .addColumn("created_at", "timestamp", (col) => col.defaultTo(db.fn("now")))
    .addColumn("updated_at", "timestamp", (col) => col.defaultTo(db.fn("now")))
    .addPrimaryKeyConstraint("renown_user_pkey", ["document_id"])
    .ifNotExists()
    .execute();

  // Create index on username for faster lookups
  await db.schema
    .createIndex("idx_renown_user_username")
    .on("renown_user")
    .column("username")
    .ifNotExists()
    .execute();

  // Expression index matching the resolver's LOWER(eth_address) lookup so the
  // case-insensitive match stays an index scan.
  await db.schema
    .createIndex("idx_renown_user_eth_address_lower")
    .on("renown_user")
    .expression(sql`LOWER(eth_address)`)
    .ifNotExists()
    .execute();

  // Drop the plain-column eth_address index superseded by the LOWER() one above;
  // resolvers filter eth_address only via LOWER, so the raw index is unused.
  await db.schema
    .dropIndex("idx_renown_user_eth_address")
    .ifExists()
    .execute();

  // Identity fields (identity hub phase 1). Additive and idempotent: every
  // boot re-runs up() against an existing table.
  await db.schema
    .alterTable("renown_user")
    .addColumn("display_name", "varchar(64)", (col) => col.ifNotExists())
    .addColumn("handle", "varchar(30)", (col) => col.ifNotExists())
    .addColumn("bio", "varchar(280)", (col) => col.ifNotExists())
    .addColumn("links", "jsonb", (col) => col.ifNotExists().notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("avatar_ref", "varchar(90)", (col) => col.ifNotExists())
    .execute();

  // Handles are unique case-insensitively across all profiles. The write
  // path checks before dispatching; this index is the last line of defence.
  await db.schema
    .createIndex("idx_renown_user_handle_lower")
    .on("renown_user")
    .unique()
    .expression(sql`LOWER(handle)`)
    .ifNotExists()
    .execute();
}

export async function down(db: IRelationalDb<any>): Promise<void> {
  await db.schema.dropIndex("idx_renown_user_handle_lower").ifExists().execute();
  // Drop renown_user indexes
  await db.schema
    .dropIndex("idx_renown_user_eth_address_lower")
    .ifExists()
    .execute();
  await db.schema.dropIndex("idx_renown_user_eth_address").ifExists().execute();
  await db.schema.dropIndex("idx_renown_user_username").ifExists().execute();

  // Drop renown_user table with CASCADE to drop dependent objects
  await db.schema.dropTable("renown_user").ifExists().cascade().execute();
}
```

Replace the whole of `processors/renown-user/schema.ts` with exactly:

```ts
import type { ColumnType } from "kysely";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

/** jsonb column: read as parsed JSON, written as a JSON string. */
export type Json<T> = ColumnType<T, string, string>;

export interface RenownUserLinkRow {
  id: string;
  label: string;
  url: string;
}

export interface RenownUser {
  avatar_ref: string | null;
  bio: string | null;
  created_at: Generated<Timestamp | null>;
  display_name: string | null;
  document_id: string;
  eth_address: string | null;
  handle: string | null;
  links: Generated<Json<RenownUserLinkRow[]>>;
  updated_at: Generated<Timestamp | null>;
  user_image: string | null;
  username: string | null;
}

export interface DB {
  renown_user: RenownUser;
}
```

Replace the whole of `processors/renown-user/processor.ts` with exactly:

```ts
import {
  RelationalDbProcessor,
  type OperationWithContext,
} from "@powerhousedao/reactor-browser";
import { nextLinks, type StoredLink } from "./links.js";
import { up } from "./migrations.js";
import { type DB } from "./schema.js";

type Input = Record<string, unknown>;

interface UpdateData {
  username?: string | null;
  eth_address?: string | null;
  user_image?: string | null;
  display_name?: string | null;
  handle?: string | null;
  bio?: string | null;
  links?: string;
  avatar_ref?: string | null;
  updated_at: Date;
}

/** A string input field, `null` when absent, null or empty. */
function text(input: Input, field: string): string | null {
  const value = input[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

export class RenownUserProcessor extends RelationalDbProcessor<DB> {
  static override getNamespace(driveId: string): string {
    return super.getNamespace(driveId);
  }

  override async initAndUpgrade(): Promise<void> {
    await up(this.relationalDb);
  }

  override async onOperations(
    operations: OperationWithContext[],
  ): Promise<void> {
    if (operations.length === 0) {
      return;
    }

    // One bad operation (e.g. a value too long for its column) must never
    // wedge the processor: a Postgres data exception (SQLSTATE class 22) is
    // logged without its payload and skipped. Anything else — a dropped
    // connection, a deadlock, an error with no SQLSTATE — is rethrown so the
    // reactor's at-least-once queue retries the batch instead of losing it.
    for (const { operation, context } of operations) {
      // A reducer error leaves the document unchanged; so does the read model.
      if (operation.error) continue;
      try {
        await this.applyOperation(operation, context);
      } catch (error) {
        const code = sqlState(error);
        if (code === undefined || !code.startsWith("22")) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `[RenownUserProcessor] skipped operation ${operation.index} of ${context.documentId}: ${reason}`,
        );
      }
    }
  }

  private async applyOperation(
    operation: OperationWithContext["operation"],
    context: OperationWithContext["context"],
  ): Promise<void> {
    const documentId = context.documentId;

    // Ensure the User exists in the database
    const existingUser = await this.relationalDb
      .selectFrom("renown_user")
      .select(["document_id", "links"])
      .where("document_id", "=", documentId)
      .executeTakeFirst();

    if (!existingUser) {
      await this.relationalDb
        .insertInto("renown_user")
        .values({
          document_id: documentId,
          username: null,
          eth_address: null,
          user_image: null,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict((oc) => oc.column("document_id").doNothing())
        .execute();
    }

    const input = (operation.action.input ?? {}) as Input;
    const updateData: UpdateData = { updated_at: new Date() };

    switch (operation.action.type) {
      case "SET_USERNAME": {
        if (typeof input.username === "string" && input.username) {
          updateData.username = input.username;
        }
        break;
      }
      case "SET_ETH_ADDRESS": {
        if (typeof input.ethAddress === "string" && input.ethAddress) {
          updateData.eth_address = input.ethAddress;
        }
        break;
      }
      case "SET_USER_IMAGE": {
        if (input.userImage !== undefined) {
          updateData.user_image = text(input, "userImage");
        }
        break;
      }
      case "SET_DISPLAY_NAME":
        updateData.display_name = text(input, "displayName");
        break;
      case "SET_BIO":
        updateData.bio = text(input, "bio");
        break;
      case "SET_AVATAR":
        updateData.avatar_ref = text(input, "avatar");
        break;
      case "SET_HANDLE":
        await this.setHandle(documentId, text(input, "handle"));
        return;
      default: {
        const current: StoredLink[] = existingUser?.links ?? [];
        const links = nextLinks(current, operation.action.type, input);
        if (links) updateData.links = JSON.stringify(links);
      }
    }

    if (Object.keys(updateData).length > 1) {
      await this.relationalDb
        .updateTable("renown_user")
        .set(updateData)
        .where("document_id", "=", documentId)
        .execute();
    }
  }

  /**
   * Stores a handle. The write path refuses taken handles before it
   * dispatches, but two documents can still race to the same one; the unique
   * index then refuses the second, which is indexed without a handle (and
   * logged) instead of wedging the processor on a retry that can never pass.
   */
  private async setHandle(documentId: string, handle: string | null): Promise<void> {
    const write = (value: string | null) =>
      this.relationalDb
        .updateTable("renown_user")
        .set({ handle: value, updated_at: new Date() })
        .where("document_id", "=", documentId)
        .execute();
    try {
      await write(handle);
    } catch (error) {
      if (sqlState(error) !== "23505") throw error;
      console.error(
        `[RenownUserProcessor] handle of ${documentId} is already taken by another profile; indexed without a handle`,
      );
      await write(null);
    }
  }

  async onDisconnect() {}
}
```

- [ ] **Step 4: Run the processor tests.** `pnpm exec vitest run processors` → PASS (new file and the existing `skip-bad-operation.test.ts`). `pnpm tsc` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add processors/renown-user/links.ts processors/renown-user/migrations.ts processors/renown-user/schema.ts processors/renown-user/processor.ts processors/tests/renown-user-identity.test.ts
git commit -m "feat(read-model): index profile identity with a unique case-insensitive handle"
```

### Task 3: Read-model GraphQL — fields, handle lookup, handle availability

**Files:**
- Create: `subgraphs/renown-auth/core/handle.ts` (handle policy; also used by Task 5)
- Modify: `subgraphs/renown-read-model/schema.ts`, `subgraphs/renown-read-model/resolvers.ts`
- Test: `subgraphs/renown-read-model/tests/identity.test.ts`

**Interfaces:**
- Consumes: Task 2 columns; Task 1 `isValidHandle`.
- Produces:
  - `core/handle.ts`: `RESERVED_HANDLES: ReadonlySet<string>`, `normalizeHandle(raw) → raw.trim().toLowerCase()`, `handleProblem(handle) → "INVALID" | "RESERVED" | null`, `type HandleProblem`.
  - GraphQL: `ReadRenownUser { …, displayName, handle, bio, links: [ReadRenownUserLink!]!, avatar }`, `ReadRenownUserLink { id label url }`, `RenownUserInput.handle`, `RenownUsersInput.handles`, `renownHandleAvailability(handle: String!, address: String): RenownHandleAvailability!` → `{ handle, available, reason: INVALID|RESERVED|TAKEN|null }` (a handle held by `address`'s own profile is available to it).

- [ ] **Step 1: Write the failing test.**

Create `subgraphs/renown-read-model/tests/identity.test.ts` with exactly:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenownUserProcessor } from "../../../processors/renown-user/index.js";
import { up } from "../../../processors/renown-user/migrations.js";
import type { DB } from "../../../processors/renown-user/schema.js";
import { getResolvers } from "../resolvers.js";

const NS = RenownUserProcessor.getNamespace("renown-user");
const ALICE = "0xabc0000000000000000000000000000000000001";
const BOB = "0xabc0000000000000000000000000000000000002";
let root: Kysely<DB>;

type Query = Record<string, (parent: unknown, args: unknown) => Promise<unknown>>;
let query: Query;

beforeAll(async () => {
  root = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(NS)}`.execute(root);
  await up(root.withSchema(NS) as never);
  await root.withSchema(NS).insertInto("renown_user").values([
    {
      document_id: "doc-a", username: "alice.eth", eth_address: ALICE, user_image: null,
      display_name: "Alice", handle: "alice", bio: "Hi", avatar_ref: `attachment://v1:${"e".repeat(64)}`,
      links: JSON.stringify([{ id: "l1", label: "Site", url: "https://a.example" }]),
    },
    { document_id: "doc-b", username: null, eth_address: BOB, user_image: null },
  ]).execute();
  const subgraph = { relationalDb: { queryNamespace: (ns: string) => root.withSchema(ns) } } as unknown as ISubgraph;
  query = (getResolvers(subgraph) as { Query: Query }).Query;
});

afterAll(async () => {
  await root.destroy();
});

describe("renown read model: identity", () => {
  it("returns the identity fields and finds a profile by handle, case-insensitively", async () => {
    expect(await query.renownUser(null, { input: { handle: " ALICE " } })).toMatchObject({
      documentId: "doc-a",
      displayName: "Alice",
      handle: "alice",
      bio: "Hi",
      avatar: `attachment://v1:${"e".repeat(64)}`,
      links: [{ id: "l1", label: "Site", url: "https://a.example" }],
    });
    expect(await query.renownUser(null, { input: { handle: "nobody" } })).toBeNull();
  });

  it("lists profiles by handles and returns empty links for profiles without any", async () => {
    const users = (await query.renownUsers(null, { input: { handles: ["Alice"], ethAddresses: [BOB] } })) as { documentId: string; links: unknown[] }[];
    expect(users.map((u) => u.documentId).sort()).toEqual(["doc-a", "doc-b"]);
    expect(users.find((u) => u.documentId === "doc-b")?.links).toEqual([]);
  });

  it.each([
    ["a free handle", { handle: "Bobby" }, { handle: "bobby", available: true, reason: null }],
    ["a taken handle", { handle: "alice" }, { handle: "alice", available: false, reason: "TAKEN" }],
    ["your own handle", { handle: "alice", address: ALICE.toUpperCase().replace("0X", "0x") }, { handle: "alice", available: true, reason: null }],
    ["someone else asking for it", { handle: "alice", address: BOB }, { handle: "alice", available: false, reason: "TAKEN" }],
    ["a reserved handle", { handle: "media" }, { handle: "media", available: false, reason: "RESERVED" }],
    ["a malformed handle", { handle: "a" }, { handle: "a", available: false, reason: "INVALID" }],
  ])("reports availability of %s", async (_, args, expected) => {
    expect(await query.renownHandleAvailability(null, args)).toEqual(expected);
  });
});
```

- [ ] **Step 2: Run it to see it fail.** `pnpm exec vitest run subgraphs/renown-read-model` → FAIL (`query.renownHandleAvailability is not a function`; `renownUser` by handle returns the wrong row and no `displayName`).

- [ ] **Step 3: Implement.**

Create `subgraphs/renown-auth/core/handle.ts` with exactly:

```ts
import { isValidHandle } from "../../../document-models/renown-user/index.js";

/** Handles nobody may claim: routes on renown.id and platform names. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin", "api", "app", "apps", "media", "profile", "settings", "renown", "vetra",
  "powerhouse", "www", "help", "about", "login", "console", "oidc",
]);

export type HandleProblem = "INVALID" | "RESERVED";

/** Lowercases and trims what a user typed; the stored form of a handle. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Why a normalized handle can't be claimed (format or reserved), or null if it can. */
export function handleProblem(handle: string): HandleProblem | null {
  if (!isValidHandle(handle)) return "INVALID";
  if (RESERVED_HANDLES.has(handle)) return "RESERVED";
  return null;
}
```

```bash
git apply <<'PLAN_EOF'
diff --git a/subgraphs/renown-read-model/schema.ts b/subgraphs/renown-read-model/schema.ts
--- a/subgraphs/renown-read-model/schema.ts
+++ b/subgraphs/renown-read-model/schema.ts
@@ -10,15 +10,30 @@ export const schema: DocumentNode = gql`
     username: String
     ethAddress: String
     userImage: String
+    displayName: String
+    "Lowercase, unique across profiles"
+    handle: String
+    bio: String
+    links: [ReadRenownUserLink!]!
+    "attachment://v1:<sha256> of the uploaded avatar; serve it via the package media route"
+    avatar: String
     createdAt: DateTime
     updatedAt: DateTime
   }
 
+  type ReadRenownUserLink {
+    id: String!
+    label: String!
+    url: String!
+  }
+
   input RenownUserInput {
     driveId: String
     phid: String
     ethAddress: String
     username: String
+    "Case-insensitive"
+    handle: String
   }
 
   input RenownUsersInput {
@@ -26,6 +41,21 @@ export const schema: DocumentNode = gql`
     phids: [String!]
     ethAddresses: [String!]
     usernames: [String!]
+    handles: [String!]
+  }
+
+  enum RenownHandleProblem {
+    INVALID
+    RESERVED
+    TAKEN
+  }
+
+  type RenownHandleAvailability {
+    "The handle as it would be stored (trimmed, lowercased)"
+    handle: String!
+    available: Boolean!
+    "Why it is not available; null when it is"
+    reason: RenownHandleProblem
   }
 
   type ReadRenownCredential {
@@ -70,5 +100,10 @@ export const schema: DocumentNode = gql`
     renownUser(input: RenownUserInput!): ReadRenownUser
     renownUsers(input: RenownUsersInput!): [ReadRenownUser!]!
     renownCredentials(input: RenownCredentialsInput!): [ReadRenownCredential!]!
+    """
+    Whether a handle can be claimed. A handle the profile of \`address\` already
+    holds counts as available to that address.
+    """
+    renownHandleAvailability(handle: String!, address: String): RenownHandleAvailability!
   }
 `;
diff --git a/subgraphs/renown-read-model/resolvers.ts b/subgraphs/renown-read-model/resolvers.ts
--- a/subgraphs/renown-read-model/resolvers.ts
+++ b/subgraphs/renown-read-model/resolvers.ts
@@ -1,5 +1,6 @@
 /* eslint-disable @typescript-eslint/no-unsafe-argument */
 import type { ISubgraph } from "@powerhousedao/reactor-api";
+import { handleProblem, normalizeHandle } from "../renown-auth/core/handle.js";
 import { RenownUserProcessor } from "../../processors/renown-user/index.js";
 import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";
 import { RenownCredentialProcessor } from "../../processors/renown-credential/index.js";
@@ -10,6 +11,7 @@ interface RenownUserInput {
   phid?: string;
   ethAddress?: string;
   username?: string;
+  handle?: string;
 }
 
 interface RenownUsersInput {
@@ -17,6 +19,13 @@ interface RenownUsersInput {
   phids?: string[];
   ethAddresses?: string[];
   usernames?: string[];
+  handles?: string[];
+}
+
+interface HandleAvailability {
+  handle: string;
+  available: boolean;
+  reason: "INVALID" | "RESERVED" | "TAKEN" | null;
 }
 
 interface RenownCredentialsInput {
@@ -32,6 +41,11 @@ interface ReadRenownUser {
   username: string | null;
   ethAddress: string | null;
   userImage: string | null;
+  displayName: string | null;
+  handle: string | null;
+  bio: string | null;
+  links: { id: string; label: string; url: string }[];
+  avatar: string | null;
   createdAt: Date | string | null;
   updatedAt: Date | string | null;
 }
@@ -71,6 +85,11 @@ const mapToUser = (user: {
   username: string | null;
   eth_address: string | null;
   user_image: string | null;
+  display_name: string | null;
+  handle: string | null;
+  bio: string | null;
+  links: { id: string; label: string; url: string }[] | null;
+  avatar_ref: string | null;
   created_at: Date | null;
   updated_at: Date | null;
 }): ReadRenownUser => ({
@@ -78,6 +97,11 @@ const mapToUser = (user: {
   username: user.username,
   ethAddress: user.eth_address,
   userImage: user.user_image,
+  displayName: user.display_name,
+  handle: user.handle,
+  bio: user.bio,
+  links: user.links ?? [],
+  avatar: user.avatar_ref,
   createdAt: user.created_at,
   updatedAt: user.updated_at,
 });
@@ -161,7 +185,7 @@ export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
         parent: unknown,
         args: { input: RenownUserInput },
       ): Promise<ReadRenownUser | null> => {
-        const { phid, ethAddress, username } = args.input;
+        const { phid, ethAddress, username, handle } = args.input;
 
          
         let query = RenownUserProcessor.query<RenownUserDB>(
@@ -169,7 +193,7 @@ export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
           db,
         ).selectFrom("renown_user");
 
-        // Priority: phid > ethAddress > username
+        // Priority: phid > ethAddress > handle > username
         if (phid) {
           query = query.where("renown_user.document_id", "=", phid);
         } else if (ethAddress) {
@@ -179,11 +203,16 @@ export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
           query = query.where((eb) =>
             eb(eb.fn("LOWER", ["renown_user.eth_address"]), "=", addr),
           );
+        } else if (handle) {
+          const wanted = normalizeHandle(handle);
+          query = query.where((eb) =>
+            eb(eb.fn("LOWER", ["renown_user.handle"]), "=", wanted),
+          );
         } else if (username) {
           query = query.where("renown_user.username", "=", username);
         } else {
           throw new Error(
-            "At least one of phid, ethAddress, or username must be provided",
+            "At least one of phid, ethAddress, handle, or username must be provided",
           );
         }
 
@@ -202,7 +231,7 @@ export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
         parent: unknown,
         args: { input: RenownUsersInput },
       ): Promise<ReadRenownUser[]> => {
-        const { driveId, phids, ethAddresses, usernames } = args.input;
+        const { driveId, phids, ethAddresses, usernames, handles } = args.input;
 
          
         let query = RenownUserProcessor.query<RenownUserDB>(
@@ -213,10 +242,11 @@ export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
         const hasPhids = phids && phids.length > 0;
         const hasEthAddresses = ethAddresses && ethAddresses.length > 0;
         const hasUsernames = usernames && usernames.length > 0;
+        const hasHandles = handles && handles.length > 0;
 
-        if (!hasPhids && !hasEthAddresses && !hasUsernames) {
+        if (!hasPhids && !hasEthAddresses && !hasUsernames && !hasHandles) {
           throw new Error(
-            "At least one of phids, ethAddresses, or usernames must be provided",
+            "At least one of phids, ethAddresses, usernames, or handles must be provided",
           );
         }
 
@@ -242,6 +272,16 @@ export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
             conditions.push(eb("renown_user.username", "in", usernames));
           }
 
+          if (hasHandles) {
+            conditions.push(
+              eb(
+                eb.fn("LOWER", ["renown_user.handle"]),
+                "in",
+                handles.map(normalizeHandle),
+              ),
+            );
+          }
+
           return eb.or(conditions);
         });
 
@@ -254,6 +294,27 @@ export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
         return results.map(mapToUser);
       },
 
+      renownHandleAvailability: async (
+        parent: unknown,
+        args: { handle: string; address?: string | null },
+      ): Promise<HandleAvailability> => {
+        const handle = normalizeHandle(args.handle);
+        const problem = handleProblem(handle);
+        if (problem) return { handle, available: false, reason: problem };
+        const owner = await RenownUserProcessor.query<RenownUserDB>("renown-user", db)
+          .selectFrom("renown_user")
+          .select("eth_address")
+          .where((eb) => eb(eb.fn("LOWER", ["renown_user.handle"]), "=", handle))
+          .executeTakeFirst();
+        const mine =
+          owner !== undefined &&
+          !!args.address &&
+          owner.eth_address?.toLowerCase() === args.address.toLowerCase();
+        return owner === undefined || mine
+          ? { handle, available: true, reason: null }
+          : { handle, available: false, reason: "TAKEN" };
+      },
+
       renownCredentials: async (
         parent: unknown,
         args: { input: RenownCredentialsInput },
PLAN_EOF
```

- [ ] **Step 4: Run.** `pnpm exec vitest run subgraphs/renown-read-model` → PASS; `pnpm tsc`, `pnpm lint` → no new errors (the existing `getDriveId`/`driveId` unused-var warnings stay).

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/renown-auth/core/handle.ts subgraphs/renown-read-model/schema.ts subgraphs/renown-read-model/resolvers.ts subgraphs/renown-read-model/tests/identity.test.ts
git commit -m "feat(read-model): profile identity fields, handle lookup and availability"
```

### Task 4: Media — gated uploads and public media URLs on the switchboard

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml` (dev deps `@powerhousedao/reactor-attachments@6.2.3`, `@aws-sdk/client-s3@3.1087.0` — the exact versions already in the lockfile through reactor-api)
- Create: `media/image.ts`, `media/backend.ts`, `media/filesystem-backend.ts`, `media/s3-backend.ts`, `media/registry.ts`, `media/slot.ts`, `media/upload-route.ts`, `media/media-route.ts`, `media/avatar.ts`, `media/register.ts`
- Replace: `processors/renown-user/factory.ts`
- Test: `media/tests/media.test.ts`

**Interfaces:**
- Consumes: Task 2 `renown_user.avatar_ref`; `createRateLimiter` from `subgraphs/renown-auth/core/rate-limit.ts`; host `IProcessorHostModule` (`attachments`, `http`, `relationalDb`); `RouteHandler`/`RouteContext`/`ScopedRouteHandle` from `@powerhousedao/shared/processors`.
- Produces:
  - `MediaBackend { kind: "s3"|"filesystem"; reserve(ReserveRequest) → ReserveResult; inspect(hash) → StoredObject|null; serve(hash) → ServeResult|null }`; `ReserveRequest {sha256,mimeType,sizeBytes,fileName,extension}`; `ReserveResult = {kind:"deduped",ref} | {kind:"reserved",ref,reservationId,expiresAtUtc,uploadTarget: UploadTarget|null}`; `UploadTarget {method:"PUT",url,headers,expiresAtUtc}`; `StoredObject {mimeType,sizeBytes,head: Uint8Array}`.
  - `mediaBackend(): MediaBackend | null` and `publishMediaBackend(b)` (`media/slot.ts`), `createMediaBackend(attachments, env?)` (`media/registry.ts`).
  - `avatarProblem(ref, backend): Promise<string | null>` (`media/avatar.ts`).
  - `IMAGE_MIME_TYPES`, `UPLOAD_LIMITS = { avatar: 2 MiB }`, `sniffImage(head)`, `EXTENSIONS` (`media/image.ts`).
  - Routes (under `https://<switchboard>/api/@powerhousedao/renown-package/`): `POST media/uploads` (auth `renown`; body `{purpose:"avatar", mimeType, sizeBytes, sha256}` — also the raw reservation body `{mimeType, fileName, extension, clientHash, sizeBytes}` that `attachment-upload.ts --reserve-path` sends (`clientHash` = `sha256`, no `purpose` = avatar) → 201 `{ref,reservationId,expiresAtUtc,uploadTarget}` | 200 `{ref,deduped:true}` | 400 `INVALID_UPLOAD` | 401 `UNAUTHENTICATED` | 413 `TOO_LARGE` | 415 `UNSUPPORTED_TYPE` | 429 `RATE_LIMITED` | 503 `UNAVAILABLE`); `GET media/:documentId/:field` (public; 302 + `MEDIA_CACHE_CONTROL` | 200 bytes on filesystem | 404).

- [ ] **Step 1: Add the dependencies.** `pnpm add -D --save-exact @powerhousedao/reactor-attachments@6.2.3 @aws-sdk/client-s3@3.1087.0` → `package.json` devDependencies gain both, lockfile changes only by those two importers.

- [ ] **Step 2: Write the failing test.**

Create `media/tests/media.test.ts` with exactly:

```ts
import type { RouteContext } from "@powerhousedao/shared/processors";
import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../../subgraphs/renown-auth/core/rate-limit.js";
import { avatarProblem } from "../avatar.js";
import type { MediaBackend, ReserveRequest, StoredObject } from "../backend.js";
import { createFilesystemMediaBackend } from "../filesystem-backend.js";
import { sniffImage } from "../image.js";
import { createMediaHandler, MEDIA_CACHE_CONTROL } from "../media-route.js";
import { createS3MediaBackend } from "../s3-backend.js";
import { createUploadHandler } from "../upload-route.js";

const HASH = "c".repeat(64);
const REF = `attachment://v1:${HASH}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const HTML = new TextEncoder().encode("<html><script>");

function ctx(over: Partial<RouteContext> = {}): RouteContext {
  return {
    params: {},
    user: { address: "0xAbC0000000000000000000000000000000000001", chainId: 1, networkId: "eip155", appKey: "did:key:zApp" },
    authEnabled: true,
    rawBody: undefined,
    signal: new AbortController().signal,
    transport: { proto: "https", host: "sb", prefix: "", baseUrl: "https://sb" },
    ...over,
  };
}

function fakeBackend(over: Partial<MediaBackend> = {}): MediaBackend & { reserved: ReserveRequest[] } {
  const reserved: ReserveRequest[] = [];
  return {
    kind: "s3",
    reserved,
    reserve: vi.fn(async (request: ReserveRequest) => {
      reserved.push(request);
      return {
        kind: "reserved" as const,
        ref: REF,
        reservationId: "res-1",
        expiresAtUtc: "2026-10-09T12:15:00.000Z",
        uploadTarget: { method: "PUT" as const, url: "https://s3/put", headers: { "content-type": request.mimeType }, expiresAtUtc: "x" },
      };
    }),
    inspect: vi.fn(async () => null),
    serve: vi.fn(async () => ({ kind: "redirect" as const, url: "https://s3/get?sig" })),
    ...over,
  };
}

function post(body: unknown): Request {
  return new Request("https://sb/api/@powerhousedao/renown-package/media/uploads", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = { purpose: "avatar", mimeType: "image/webp", sizeBytes: 20_000, sha256: HASH };

describe("sniffImage", () => {
  it("recognises PNG, JPEG and WebP signatures and nothing else", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(WEBP)).toBe("image/webp");
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("POST media/uploads", () => {
  it("reserves an avatar for a bearer and returns the upload target", async () => {
    const backend = fakeBackend();
    const res = await createUploadHandler({ backend: () => backend })(post(VALID), ctx());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ref: REF,
      reservationId: "res-1",
      expiresAtUtc: "2026-10-09T12:15:00.000Z",
      uploadTarget: { method: "PUT", url: "https://s3/put", headers: { "content-type": "image/webp" }, expiresAtUtc: "x" },
    });
    expect(backend.reserved).toEqual([
      { sha256: HASH, mimeType: "image/webp", sizeBytes: 20_000, extension: "webp", fileName: `avatar-${HASH.slice(0, 12)}.webp` },
    ]);
  });

  it("answers 200 with the ref when the bytes are already stored", async () => {
    const backend = fakeBackend({ reserve: vi.fn(async () => ({ kind: "deduped" as const, ref: REF })) });
    const res = await createUploadHandler({ backend: () => backend })(post(VALID), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ref: REF, deduped: true });
  });

  it.each([
    ["no bearer", VALID, { user: undefined }, 401, "UNAUTHENTICATED"],
    ["a non-JSON body", "nope", {}, 400, "INVALID_UPLOAD"],
    ["an unknown purpose", { ...VALID, purpose: "banner" }, {}, 400, "INVALID_UPLOAD"],
    ["an SVG", { ...VALID, mimeType: "image/svg+xml" }, {}, 415, "UNSUPPORTED_TYPE"],
    ["a fractional size", { ...VALID, sizeBytes: 1.5 }, {}, 400, "INVALID_UPLOAD"],
    ["a zero size", { ...VALID, sizeBytes: 0 }, {}, 400, "INVALID_UPLOAD"],
    ["2 MB + 1 byte", { ...VALID, sizeBytes: 2 * 1024 * 1024 + 1 }, {}, 413, "TOO_LARGE"],
    ["an uppercase hash", { ...VALID, sha256: HASH.toUpperCase() }, {}, 400, "INVALID_UPLOAD"],
  ])("refuses %s", async (_, body, over, status, code) => {
    const backend = fakeBackend();
    const res = await createUploadHandler({ backend: () => backend })(post(body), ctx(over as Partial<RouteContext>));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
    expect(backend.reserved).toEqual([]);
  });

  it("accepts the raw reservation body the attachment smoke script sends", async () => {
    const backend = fakeBackend();
    const raw = { mimeType: "image/png", fileName: "smoke.png", extension: "png", clientHash: HASH, sizeBytes: 64 };
    const res = await createUploadHandler({ backend: () => backend })(post(raw), ctx());
    expect(res.status).toBe(201);
    expect(backend.reserved[0]).toMatchObject({ sha256: HASH, mimeType: "image/png", fileName: `avatar-${HASH.slice(0, 12)}.png` });
  });

  it("accepts exactly 2 MB", async () => {
    const res = await createUploadHandler({ backend: () => fakeBackend() })(post({ ...VALID, sizeBytes: 2 * 1024 * 1024 }), ctx());
    expect(res.status).toBe(201);
  });

  it("is unavailable without a media backend", async () => {
    const res = await createUploadHandler({ backend: () => null })(post(VALID), ctx());
    expect(res.status).toBe(503);
  });

  it("rate limits per identity, not per request", async () => {
    const handler = createUploadHandler({ backend: () => fakeBackend(), limiter: createRateLimiter(2, 3_600_000) });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await handler(post(VALID), ctx())).status);
    const other = ctx({ user: { address: "0x0000000000000000000000000000000000000002", chainId: 1, networkId: "eip155", appKey: "did:key:z2" } });
    statuses.push((await handler(post(VALID), other)).status);
    expect(statuses).toEqual([201, 201, 429, 201]);
  });
});

describe("GET media/:documentId/:field", () => {
  const fields = { avatar: async (id: string) => (id === "doc-1" ? REF : id === "doc-junk" ? "https://x" : null) };
  const get = (handler: ReturnType<typeof createMediaHandler>, params: Record<string, string>) =>
    handler(new Request("https://sb/x"), ctx({ params, user: undefined, authEnabled: false }));

  it("302s to a presigned URL with the public cache policy", async () => {
    const res = await get(createMediaHandler({ backend: () => fakeBackend(), fields }), { documentId: "doc-1", field: "avatar" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://s3/get?sig");
    expect(res.headers.get("cache-control")).toBe(MEDIA_CACHE_CONTROL);
  });

  it("streams the bytes on a filesystem backend", async () => {
    const body = new Blob([PNG]).stream();
    const backend = fakeBackend({ serve: vi.fn(async () => ({ kind: "stream" as const, mimeType: "image/png", sizeBytes: PNG.length, body })) });
    const res = await get(createMediaHandler({ backend: () => backend, fields }), { documentId: "doc-1", field: "avatar" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it.each([
    ["an unknown field", { documentId: "doc-1", field: "constructor" }],
    ["an unset avatar", { documentId: "doc-2", field: "avatar" }],
    ["a stored value that is not a ref", { documentId: "doc-junk", field: "avatar" }],
    ["an oversized id", { documentId: "d".repeat(256), field: "avatar" }],
  ])("404s for %s", async (_, params) => {
    const res = await get(createMediaHandler({ backend: () => fakeBackend(), fields }), params);
    expect(res.status).toBe(404);
  });

  it("404s when nothing is stored or no backend exists", async () => {
    const empty = fakeBackend({ serve: vi.fn(async () => null) });
    expect((await get(createMediaHandler({ backend: () => empty, fields }), { documentId: "doc-1", field: "avatar" })).status).toBe(404);
    expect((await get(createMediaHandler({ backend: () => null, fields }), { documentId: "doc-1", field: "avatar" })).status).toBe(404);
  });
});

describe("avatarProblem", () => {
  const stored = (o: StoredObject) => fakeBackend({ inspect: vi.fn(async () => o) });
  it("accepts a stored image whose bytes match its type", async () => {
    expect(await avatarProblem(REF, stored({ mimeType: "image/png", sizeBytes: 1000, head: PNG }))).toBeNull();
  });
  it.each([
    ["a malformed ref", "attachment://v1:xyz", stored({ mimeType: "image/png", sizeBytes: 1, head: PNG }), /reference/],
    ["a missing object", REF, fakeBackend(), /not uploaded/],
    ["an object over 2 MB", REF, stored({ mimeType: "image/png", sizeBytes: 2 * 1024 * 1024 + 1, head: PNG }), /larger/],
    ["a non-image content type", REF, stored({ mimeType: "text/html", sizeBytes: 10, head: HTML }), /not an image/],
    ["HTML bytes labelled PNG", REF, stored({ mimeType: "image/png", sizeBytes: 10, head: HTML }), /not a PNG/],
    ["JPEG bytes labelled WebP", REF, stored({ mimeType: "image/webp", sizeBytes: 10, head: JPEG }), /is image\/jpeg/],
  ])("rejects %s", async (_, ref, backend, message) => {
    expect(await avatarProblem(ref, backend)).toMatch(message);
  });
});

describe("S3 media backend", () => {
  const config = {
    endpoint: "https://nbg1.your-objectstorage.com", region: "nbg1", bucket: "renown-staging-attachments",
    accessKeyId: "k", secretAccessKey: "s", prefix: "attachments", forcePathStyle: true,
    uploadTtlSeconds: 900, downloadTtlSeconds: 300,
  };
  function setup(head: () => Promise<unknown>) {
    const presign = vi.fn(async (_client: object, command: object) => `https://signed/${(command as { constructor: { name: string } }).constructor.name}`);
    const primitives = {
      client: {},
      presign,
      headObject: vi.fn(head),
      createDownloadTarget: vi.fn(async () => ({ url: "https://signed/get" })),
    };
    const reserve = vi.fn(async (_o: unknown, send: (h: unknown) => Promise<unknown>) =>
      send({ ref: REF, reservationId: "res-9", expiresAtUtc: "2026-10-09T12:15:00.000Z" }),
    );
    const fetchImpl = vi.fn(async () => new Response(PNG, { status: 206 }));
    const backend = createS3MediaBackend({
      attachments: { reserve } as never,
      config,
      primitives: primitives as never,
      fetch: fetchImpl as never,
      now: () => new Date("2026-10-09T12:00:00.000Z"),
    });
    return { backend, presign, primitives, reserve, fetchImpl };
  }

  it("presigns a PUT that pins the exact length, type and checksum", async () => {
    const { backend, presign } = setup(async () => ({}));
    const result = await backend.reserve({ sha256: HASH, mimeType: "image/webp", sizeBytes: 1234, extension: "webp", fileName: "a.webp" });
    const command = presign.mock.calls[0][1] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Bucket: "renown-staging-attachments",
      Key: `attachments/cc/cc/${HASH}`,
      ContentType: "image/webp",
      ContentLength: 1234,
    });
    expect(command.input.ChecksumSHA256).toBe(Buffer.from(HASH, "hex").toString("base64"));
    expect(result).toEqual({
      kind: "reserved",
      ref: REF,
      reservationId: "res-9",
      expiresAtUtc: "2026-10-09T12:15:00.000Z",
      uploadTarget: {
        method: "PUT",
        url: "https://signed/PutObjectCommand",
        headers: { "content-type": "image/webp", "x-amz-checksum-sha256": Buffer.from(HASH, "hex").toString("base64") },
        expiresAtUtc: "2026-10-09T12:15:00.000Z",
      },
    });
  });

  it("inspects size and type from HEAD and the first bytes from a ranged GET", async () => {
    const { backend, fetchImpl } = setup(async () => ({ ContentLength: 4321, ContentType: "image/png" }));
    expect(await backend.inspect(HASH)).toEqual({ mimeType: "image/png", sizeBytes: 4321, head: PNG });
    expect(fetchImpl).toHaveBeenCalledWith("https://signed/get", { headers: { range: "bytes=0-15" } });
  });

  it("reports a missing object as null and rethrows other storage errors", async () => {
    const missing = setup(async () => Promise.reject(Object.assign(new Error("NotFound"), { name: "NotFound" })));
    expect(await missing.backend.inspect(HASH)).toBeNull();
    const broken = setup(async () => Promise.reject(new Error("socket hang up")));
    await expect(broken.backend.inspect(HASH)).rejects.toThrow("socket hang up");
  });

  it("redirects downloads to a presigned GET", async () => {
    const { backend } = setup(async () => ({}));
    expect(await backend.serve(HASH)).toEqual({ kind: "redirect", url: "https://signed/get" });
  });
});

describe("filesystem media backend", () => {
  it("reserves without an upload target, and reads headers and bytes through download()", async () => {
    const attachments = {
      reserve: vi.fn(async (_o: unknown, send: (h: unknown) => Promise<unknown>) =>
        send({ ref: null, reservationId: "res-2", expiresAtUtc: "t" }),
      ),
      download: vi.fn(async () => ({ header: { mimeType: "image/png", sizeBytes: PNG.length }, body: new Blob([PNG]).stream() })),
    };
    const backend = createFilesystemMediaBackend(attachments as never);
    expect(await backend.reserve({ sha256: HASH, mimeType: "image/png", sizeBytes: 12, extension: "png", fileName: "a.png" })).toEqual({
      kind: "reserved", ref: REF, reservationId: "res-2", expiresAtUtc: "t", uploadTarget: null,
    });
    expect(await backend.inspect(HASH)).toEqual({ mimeType: "image/png", sizeBytes: PNG.length, head: PNG });
    expect(await backend.serve(HASH)).toMatchObject({ kind: "stream", mimeType: "image/png" });
  });

  it("dedups, and treats unknown or pending hashes as not stored", async () => {
    const attachments = {
      reserve: vi.fn(async () => ({ hash: HASH, ref: REF, header: {} })),
      download: vi.fn(async () => Promise.reject(new Error("AttachmentPending"))),
    };
    const backend = createFilesystemMediaBackend(attachments as never);
    expect(await backend.reserve({ sha256: HASH, mimeType: "image/png", sizeBytes: 12, extension: "png", fileName: "a.png" })).toEqual({ kind: "deduped", ref: REF });
    expect(await backend.inspect(HASH)).toBeNull();
    expect(await backend.serve(HASH)).toBeNull();
  });

  it("passes reservation failures through", async () => {
    const attachments = { reserve: vi.fn(async () => Promise.reject(new Error("db down"))), download: vi.fn() };
    await expect(createFilesystemMediaBackend(attachments as never).reserve({ sha256: HASH, mimeType: "image/png", sizeBytes: 1, extension: "png", fileName: "a" })).rejects.toThrow("db down");
  });
});
```

- [ ] **Step 3: Run it to see it fail.** `pnpm exec vitest run media` → FAIL (`Cannot find module '../avatar.js'`).

- [ ] **Step 4: Implement the media module.**

Create `media/image.ts` with exactly:

```ts
/** Image types Renown accepts for avatars (and, later, app logos and covers). */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** What an upload is for, and the most bytes it may have. */
export const UPLOAD_LIMITS = { avatar: 2 * 1024 * 1024 } as const;
export type UploadPurpose = keyof typeof UPLOAD_LIMITS;

export const EXTENSIONS: Record<ImageMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Bytes the sniffer needs from the start of a file. */
export const SNIFF_BYTES = 16;

export function isImageMimeType(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** The image type the leading bytes prove (PNG, JPEG or WebP signature), or null. */
export function sniffImage(head: Uint8Array): ImageMimeType | null {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}
```

Create `media/backend.ts` with exactly:

```ts
import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import { SNIFF_BYTES } from "./image.js";

type AttachmentClient = IProcessorHostModule["attachments"];
type ReserveOptions = Parameters<AttachmentClient["reserve"]>[0];
type UploadHandle = Parameters<Parameters<AttachmentClient["reserve"]>[1]>[0];

/** A browser-usable upload target: PUT these bytes with exactly these headers. */
export interface UploadTarget {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAtUtc: string;
}

export type ReserveResult =
  | { kind: "deduped"; ref: string }
  | {
      kind: "reserved";
      ref: string;
      reservationId: string;
      expiresAtUtc: string;
      /** Null on a filesystem backend (local development): bytes go to the switchboard's own PUT route. */
      uploadTarget: UploadTarget | null;
    };

/** What the bytes behind a hash really are, read from storage, never from the reservation. */
export interface StoredObject {
  mimeType: string;
  sizeBytes: number;
  /** The first bytes of the object (at most SNIFF_BYTES), for signature sniffing. */
  head: Uint8Array;
}

export type ServeResult =
  | { kind: "redirect"; url: string }
  | { kind: "stream"; mimeType: string; sizeBytes: number; body: ReadableStream<Uint8Array> };

export interface ReserveRequest {
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  extension: string;
}

/**
 * Renown's view of the switchboard's attachment storage, for package code.
 *
 * Reservations go through the host's attachment client (`module.attachments`,
 * reactor-api `IProcessorHostModule`), so the switchboard's own attachment
 * records stay authoritative. Reading the stored object and minting download
 * URLs can't: on S3 the host store only knows the reservation's claimed
 * metadata and serves bytes from local disk, and `getShareLink` rejects on a
 * server-side store. On S3 those go to the bucket directly, with the
 * switchboard's own S3 settings.
 */
export interface MediaBackend {
  readonly kind: "s3" | "filesystem";
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  /** The stored object, or null when nothing (complete) is stored under `hash`. */
  inspect(hash: string): Promise<StoredObject | null>;
  /** How to hand the object to a browser, or null when it is not stored. */
  serve(hash: string): Promise<ServeResult | null>;
}

class Captured extends Error {
  constructor(readonly handle: UploadHandle) {
    super("reservation captured");
  }
}

/**
 * Reserves through the attachment client. Its `reserve` hands a live upload
 * handle to a `send` callback; the bytes come from the browser, not from us,
 * so the callback hands the handle back out by rejecting with it.
 */
export async function reserveVia(
  attachments: AttachmentClient,
  request: ReserveRequest,
): Promise<{ kind: "deduped"; ref: string } | { kind: "reserved"; handle: UploadHandle }> {
  const options: ReserveOptions = {
    mimeType: request.mimeType,
    fileName: request.fileName,
    extension: request.extension,
    clientHash: request.sha256,
    sizeBytes: request.sizeBytes,
  };
  try {
    const result = await attachments.reserve(options, (handle) => Promise.reject(new Captured(handle)));
    return { kind: "deduped", ref: result.ref };
  } catch (error) {
    if (error instanceof Captured) return { kind: "reserved", handle: error.handle };
    throw error;
  }
}

export function refOf(hash: string): string {
  return `attachment://v1:${hash}`;
}

/** Reads up to `limit` bytes from the start of a stream, then cancels it. */
export async function readHead(body: ReadableStream<Uint8Array>, limit = SNIFF_BYTES): Promise<Uint8Array> {
  const reader = body.getReader();
  const out = new Uint8Array(limit);
  let filled = 0;
  try {
    while (filled < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, limit - filled);
      out.set(take, filled);
      filled += take.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.subarray(0, filled);
}
```

Create `media/filesystem-backend.ts` with exactly:

```ts
import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import {
  readHead,
  refOf,
  reserveVia,
  type MediaBackend,
  type ReserveRequest,
  type ReserveResult,
  type ServeResult,
  type StoredObject,
} from "./backend.js";

type AttachmentClient = IProcessorHostModule["attachments"];

// The local store ignores the authorizing document; the name only labels the read.
const LOCAL_READER = "renown-media";

/** Development backend: the switchboard stores bytes on its own disk. */
export function createFilesystemMediaBackend(attachments: AttachmentClient): MediaBackend {
  async function open(hash: string) {
    try {
      return await attachments.download({
        documentId: LOCAL_READER,
        ref: refOf(hash) as `attachment://v${number}:${string}`,
      });
    } catch {
      // Unknown (AttachmentNotFound) or not yet uploaded (AttachmentPending).
      return null;
    }
  }

  return {
    kind: "filesystem",
    async reserve(request: ReserveRequest): Promise<ReserveResult> {
      const outcome = await reserveVia(attachments, request);
      if (outcome.kind === "deduped") return outcome;
      const { handle } = outcome;
      return {
        kind: "reserved",
        ref: handle.ref ?? refOf(request.sha256),
        reservationId: handle.reservationId,
        expiresAtUtc: handle.expiresAtUtc,
        uploadTarget: null,
      };
    },
    async inspect(hash: string): Promise<StoredObject | null> {
      const response = await open(hash);
      if (!response) return null;
      return {
        mimeType: response.header.mimeType,
        sizeBytes: response.header.sizeBytes,
        head: await readHead(response.body),
      };
    },
    async serve(hash: string): Promise<ServeResult | null> {
      const response = await open(hash);
      if (!response) return null;
      return {
        kind: "stream",
        mimeType: response.header.mimeType,
        sizeBytes: response.header.sizeBytes,
        body: response.body,
      };
    },
  };
}
```

Create `media/s3-backend.ts` with exactly:

```ts
import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import {
  createS3AttachmentPrimitives,
  deriveS3AttachmentKey,
  type S3AttachmentConfig,
} from "@powerhousedao/reactor-attachments";
import {
  refOf,
  reserveVia,
  type MediaBackend,
  type ReserveRequest,
  type ReserveResult,
  type ServeResult,
  type StoredObject,
} from "./backend.js";
import { SNIFF_BYTES } from "./image.js";

type AttachmentClient = IProcessorHostModule["attachments"];
type Primitives = ReturnType<typeof createS3AttachmentPrimitives>;

/** Upload targets live 15 minutes; download redirects 5 (the media route's cache window). */
const UPLOAD_TTL_SECONDS = 900;
export const DOWNLOAD_TTL_SECONDS = 300;

function hexToBase64(hex: string): string {
  const bytes = hex.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [];
  return btoa(String.fromCharCode(...bytes));
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export interface S3MediaBackendDeps {
  attachments: AttachmentClient;
  config: S3AttachmentConfig;
  /** Injectable for tests. */
  primitives?: Primitives;
  fetch?: typeof fetch;
  now?: () => Date;
}

/**
 * Production backend: the switchboard's private S3 bucket.
 *
 * The upload target is presigned here rather than taken from the host's
 * reservation: the host signs content-type and checksum but not the length,
 * so its URL accepts any number of bytes. This one also signs
 * `content-length`, so the bucket refuses a body of any other size.
 */
export function createS3MediaBackend(deps: S3MediaBackendDeps): MediaBackend {
  const { attachments, config } = deps;
  const primitives = deps.primitives ?? createS3AttachmentPrimitives(config);
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  async function presignedGet(hash: string): Promise<string> {
    const target = await primitives.createDownloadTarget(hash, DOWNLOAD_TTL_SECONDS);
    return target.url;
  }

  return {
    kind: "s3",
    async reserve(request: ReserveRequest): Promise<ReserveResult> {
      const outcome = await reserveVia(attachments, request);
      if (outcome.kind === "deduped") return outcome;
      const checksum = hexToBase64(request.sha256);
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: deriveS3AttachmentKey(request.sha256, config.prefix),
        ContentType: request.mimeType,
        ContentLength: request.sizeBytes,
        ChecksumSHA256: checksum,
      });
      const url = await primitives.presign(primitives.client, command, UPLOAD_TTL_SECONDS);
      return {
        kind: "reserved",
        ref: outcome.handle.ref ?? refOf(request.sha256),
        reservationId: outcome.handle.reservationId,
        expiresAtUtc: outcome.handle.expiresAtUtc,
        uploadTarget: {
          method: "PUT",
          url,
          headers: { "content-type": request.mimeType, "x-amz-checksum-sha256": checksum },
          expiresAtUtc: new Date(now().getTime() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
        },
      };
    },
    async inspect(hash: string): Promise<StoredObject | null> {
      let head: { ContentLength?: number; ContentType?: string };
      try {
        head = (await primitives.headObject(hash)) as typeof head;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      const response = await fetchImpl(await presignedGet(hash), {
        headers: { range: `bytes=0-${SNIFF_BYTES - 1}` },
      });
      if (!response.ok) return null;
      return {
        mimeType: head.ContentType ?? "application/octet-stream",
        sizeBytes: head.ContentLength ?? 0,
        head: new Uint8Array(await response.arrayBuffer()).subarray(0, SNIFF_BYTES),
      };
    },
    async serve(hash: string): Promise<ServeResult | null> {
      return { kind: "redirect", url: await presignedGet(hash) };
    },
  };
}
```

Create `media/slot.ts` with exactly:

```ts
import type { MediaBackend } from "./backend.js";

// Processors receive the host's attachment client; subgraphs do not. The
// renown-user processor factory publishes the media backend here and the
// renown-auth subgraph reads it. A global symbol, not a module variable, so
// two bundled copies of this file still share one slot. Kept free of any
// storage import so subgraph bundles stay small.
const SLOT = Symbol.for("@powerhousedao/renown-package/media-backend");
type Slot = { [SLOT]?: MediaBackend };

export function publishMediaBackend(backend: MediaBackend | undefined): void {
  (globalThis as Slot)[SLOT] = backend;
}

/** The published backend, or null before the processor factory ran (or on a host without attachments). */
export function mediaBackend(): MediaBackend | null {
  return (globalThis as Slot)[SLOT] ?? null;
}
```

Create `media/registry.ts` with exactly:

```ts
import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import { parseAttachmentStorageConfig } from "@powerhousedao/reactor-attachments";
import type { MediaBackend } from "./backend.js";
import { createFilesystemMediaBackend } from "./filesystem-backend.js";
import { createS3MediaBackend } from "./s3-backend.js";

type AttachmentClient = IProcessorHostModule["attachments"];

/** Builds the backend the switchboard's own attachment settings (PH_ATTACHMENT_STORAGE, PH_ATTACHMENT_S3_*) describe. */
export function createMediaBackend(
  attachments: AttachmentClient,
  env: Readonly<Record<string, string | undefined>> = process.env,
): MediaBackend {
  const storage = parseAttachmentStorageConfig(env);
  return storage.kind === "s3"
    ? createS3MediaBackend({ attachments, config: storage.s3 })
    : createFilesystemMediaBackend(attachments);
}
```

Create `media/upload-route.ts` with exactly:

```ts
import type { RouteHandler } from "@powerhousedao/shared/processors";
import { createRateLimiter } from "../subgraphs/renown-auth/core/rate-limit.js";
import type { MediaBackend } from "./backend.js";
import { EXTENSIONS, isImageMimeType, UPLOAD_LIMITS, type UploadPurpose } from "./image.js";

/** Per uploading identity: 20 reservations an hour. */
export const UPLOADS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface UploadRouteDeps {
  backend: () => MediaBackend | null;
  limiter?: { take(key: string, now?: number): boolean };
  now?: () => Date;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function fail(status: number, code: string, error: string): Response {
  return json(status, { code, error });
}

function isPurpose(value: unknown): value is UploadPurpose {
  return typeof value === "string" && Object.hasOwn(UPLOAD_LIMITS, value);
}

/**
 * `POST <package>/media/uploads` — the only way bytes enter Renown's
 * attachment store (the switchboard's raw `/attachments/reservations` is
 * closed at the ingress). Requires a Renown bearer; takes
 * `{ purpose, mimeType, sizeBytes, sha256 }`; allows only images within the
 * purpose's size cap; reserves server-side and returns where to PUT the bytes.
 * Also takes the raw reservation body (`clientHash` for `sha256`, no
 * `purpose` = avatar) so `scripts/smoke/attachment-upload.ts --reserve-path`
 * works against it; `fileName`/`extension` are ignored (derived here).
 *
 *   201 { ref, reservationId, expiresAtUtc, uploadTarget }  upload the bytes
 *   200 { ref, deduped: true }                              already stored
 *   400 INVALID_UPLOAD · 401 UNAUTHENTICATED · 413 TOO_LARGE
 *   415 UNSUPPORTED_TYPE · 429 RATE_LIMITED · 503 UNAVAILABLE
 */
export function createUploadHandler(deps: UploadRouteDeps): RouteHandler {
  const limiter = deps.limiter ?? createRateLimiter(UPLOADS_PER_HOUR, HOUR_MS);
  const now = deps.now ?? (() => new Date());

  return async (request, ctx) => {
    const identity = ctx.user?.address.toLowerCase();
    if (!identity) return fail(401, "UNAUTHENTICATED", "A Renown bearer token is required");

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail(400, "INVALID_UPLOAD", "Body must be JSON");
    }
    const { mimeType, sizeBytes } = body;
    const purpose = body.purpose ?? "avatar";
    const sha256 = body.sha256 ?? body.clientHash;
    if (!isPurpose(purpose)) return fail(400, "INVALID_UPLOAD", "purpose must be one of: avatar");
    if (typeof mimeType !== "string" || !isImageMimeType(mimeType)) {
      return fail(415, "UNSUPPORTED_TYPE", "Only image/png, image/jpeg and image/webp are accepted");
    }
    if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      return fail(400, "INVALID_UPLOAD", "sizeBytes must be a positive integer");
    }
    if (sizeBytes > UPLOAD_LIMITS[purpose]) {
      return fail(413, "TOO_LARGE", `A ${purpose} may be at most ${UPLOAD_LIMITS[purpose]} bytes`);
    }
    if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) {
      return fail(400, "INVALID_UPLOAD", "sha256 must be 64 lowercase hex characters");
    }

    const backend = deps.backend();
    if (!backend) return fail(503, "UNAVAILABLE", "Uploads are not available on this switchboard");
    if (!limiter.take(identity, now().getTime())) {
      return fail(429, "RATE_LIMITED", `At most ${UPLOADS_PER_HOUR} uploads per hour`);
    }

    const extension = EXTENSIONS[mimeType];
    const result = await backend.reserve({
      sha256,
      mimeType,
      sizeBytes,
      extension,
      fileName: `${purpose}-${sha256.slice(0, 12)}.${extension}`,
    });
    if (result.kind === "deduped") return json(200, { ref: result.ref, deduped: true });
    return json(201, {
      ref: result.ref,
      reservationId: result.reservationId,
      expiresAtUtc: result.expiresAtUtc,
      uploadTarget: result.uploadTarget,
    });
  };
}
```

Create `media/media-route.ts` with exactly:

```ts
import type { RouteHandler } from "@powerhousedao/shared/processors";
import type { MediaBackend } from "./backend.js";

/** Shared by the 302 and the bytes: browsers and CDNs may reuse it for a minute, then revalidate. */
export const MEDIA_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=240";

/** Public image fields, per field name: where the attachment ref of a document is read from. */
export type MediaFieldLookup = (documentId: string) => Promise<string | null>;

export interface MediaRouteDeps {
  backend: () => MediaBackend | null;
  /** Whitelist: only these fields are ever served. Phase 2 adds app-profile `logo`/`cover`. */
  fields: Record<string, MediaFieldLookup>;
}

const REF_RE = /^attachment:\/\/v1:([0-9a-f]{64})$/;
const DOCUMENT_ID_MAX = 255;

function notFound(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
}

/**
 * `GET <package>/media/:documentId/:field` — the stable public URL of a
 * profile image. Reads the ref from the read model (never from the request),
 * then 302s to a 5-minute presigned URL (S3) or streams the bytes
 * (filesystem). 404 when the field is unknown, unset or not stored.
 */
export function createMediaHandler(deps: MediaRouteDeps): RouteHandler {
  return async (_request, ctx) => {
    const { documentId, field } = ctx.params;
    const lookup = Object.hasOwn(deps.fields, field) ? deps.fields[field] : undefined;
    if (!lookup || !documentId || documentId.length > DOCUMENT_ID_MAX) return notFound();
    const hash = REF_RE.exec((await lookup(documentId)) ?? "")?.[1];
    const backend = deps.backend();
    if (!hash || !backend) return notFound();

    const served = await backend.serve(hash);
    if (!served) return notFound();
    if (served.kind === "redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: served.url, "cache-control": MEDIA_CACHE_CONTROL },
      });
    }
    return new Response(served.body, {
      status: 200,
      headers: {
        "content-type": served.mimeType,
        "content-length": String(served.sizeBytes),
        "cache-control": MEDIA_CACHE_CONTROL,
        "x-content-type-options": "nosniff",
      },
    });
  };
}
```

Create `media/avatar.ts` with exactly:

```ts
import type { MediaBackend } from "./backend.js";
import { isImageMimeType, sniffImage, UPLOAD_LIMITS } from "./image.js";

const REF_RE = /^attachment:\/\/v1:([0-9a-f]{64})$/;

/**
 * Why `ref` can't be a profile's avatar, or null when it can. Judged from the
 * stored object itself — on S3 the host records the reservation's claimed
 * type and size before any byte arrives, so neither is trusted: the bucket's
 * size and type are checked, and the leading bytes must be a PNG, JPEG or
 * WebP signature of that same type.
 */
export async function avatarProblem(ref: string, backend: MediaBackend): Promise<string | null> {
  const hash = REF_RE.exec(ref)?.[1];
  if (!hash) return "not an attachment://v1 reference";
  const stored = await backend.inspect(hash);
  if (!stored) return "not uploaded (or the upload has not finished)";
  if (stored.sizeBytes > UPLOAD_LIMITS.avatar) return `larger than ${UPLOAD_LIMITS.avatar} bytes`;
  if (!isImageMimeType(stored.mimeType)) return `stored as ${stored.mimeType}, not an image`;
  const sniffed = sniffImage(stored.head);
  if (sniffed === null) return "not a PNG, JPEG or WebP image";
  if (sniffed !== stored.mimeType) return `stored as ${stored.mimeType} but is ${sniffed}`;
  return null;
}
```

Create `media/register.ts` with exactly:

```ts
import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import type { ScopedRouteHandle } from "@powerhousedao/shared/processors";
import { RenownUserProcessor } from "../processors/renown-user/processor.js";
import type { DB as RenownUserDB } from "../processors/renown-user/schema.js";
import { createMediaHandler } from "./media-route.js";
import { createMediaBackend } from "./registry.js";
import { mediaBackend, publishMediaBackend } from "./slot.js";
import { createUploadHandler } from "./upload-route.js";

let routes: ScopedRouteHandle[] = [];

/**
 * Wires Renown media into a switchboard host: publishes the media backend for
 * the renown-auth subgraph and mounts
 *   POST <package>/media/uploads                 (Renown bearer)
 *   GET  <package>/media/:documentId/:field      (public)
 * No-op where the host has no HTTP surface (Connect, tests). Idempotent: a
 * package reload replaces the previous routes.
 */
export function registerMedia(module: IProcessorHostModule): void {
  if (!module.http) return;
  try {
    publishMediaBackend(createMediaBackend(module.attachments));
  } catch (error) {
    // Broken attachment settings disable media, never the processor.
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error(`[renown-media] attachment storage misconfigured (${reason}); uploads and media disabled`);
    publishMediaBackend(undefined);
  }

  for (const route of routes) route.dispose();
  const users = () =>
    RenownUserProcessor.query<RenownUserDB>("renown-user", module.relationalDb).selectFrom("renown_user");
  routes = [
    module.http.post("media/uploads", { auth: "renown", maxBodyBytes: 4096 }, createUploadHandler({ backend: mediaBackend })),
    module.http.get(
      "media/:documentId/:field",
      { auth: "public", body: "none" },
      createMediaHandler({
        backend: mediaBackend,
        fields: {
          avatar: async (documentId) =>
            (await users().select("avatar_ref").where("document_id", "=", documentId).executeTakeFirst())
              ?.avatar_ref ?? null,
        },
      }),
    ),
  ];
}
```

- [ ] **Step 5: Mount it from the processor factory** (lazily, so the S3 client stays out of the bundles that import `RenownUserProcessor`, e.g. every subgraph).

Replace the whole of `processors/renown-user/factory.ts` with exactly:

```ts
import type {
  IProcessorHostModule,
  ProcessorFactoryBuilder,
  ProcessorFilter,
} from "@powerhousedao/reactor-browser";
import { RenownUserProcessor } from "./processor.js";

// One namespace for all drives: the renown read model is global.
export const renownUserFactoryBuilder: ProcessorFactoryBuilder =
  (module: IProcessorHostModule) => {
    // Uploads and public media URLs ride on this processor's host module: it
    // is where a package gets the attachment client and its HTTP scope.
    // Loaded lazily so the S3 client stays out of every bundle that only
    // needs the processor class (the subgraphs import it for its queries).
    if (module.http) {
      void import("../../media/register.js")
        .then(({ registerMedia }) => registerMedia(module))
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : "unknown error";
          console.error(`[renown-media] failed to start (${reason}); uploads and media disabled`);
        });
    }
    return async () => {
    const namespace = RenownUserProcessor.getNamespace("renown-user");
    const store =
      await module.relationalDb.createNamespace<RenownUserProcessor>(namespace);

    const filter: ProcessorFilter = {
      branch: ["main"],
      documentId: ["*"],
      documentType: ["powerhouse/renown-user"],
      scope: ["global"],
    };

    const processor = new RenownUserProcessor(namespace, filter, store);
    await processor.initAndUpgrade();
    return [{ processor, filter }];
    };
  };
```

- [ ] **Step 6: Run tests, types, lint, build.** `pnpm exec vitest run media processors` → PASS (36 media tests). `pnpm tsc`, `pnpm lint` → no errors. `pnpm build` → succeeds; `grep -l PutObjectCommand dist/node/*.mjs dist/browser/*.js` lists only the lazy `register-*` chunks (not `renown-user-*`, not any subgraph chunk).

- [ ] **Step 7: Commit.**

```bash
git add package.json pnpm-lock.yaml media processors/renown-user/factory.ts
git commit -m "feat(media): gated avatar uploads and public media URLs on the switchboard"
```

### Task 5: `renown_upsertProfile` — identity fields, patch semantics, handle + avatar checks

**Files:**
- Modify: `subgraphs/renown-auth/core/signed-message.ts`, `subgraphs/renown-auth/lookups.ts`, `subgraphs/renown-auth/resolvers.ts`, `subgraphs/renown-auth/schema.ts`, `subgraphs/renown-auth/tests/resolvers.test.ts` (schema signature assertion)
- Create: `subgraphs/renown-auth/core/handle-claims.ts`, `subgraphs/renown-auth/core/profile-patch.ts`
- Test: `subgraphs/renown-auth/tests/profile-identity.test.ts`

**Interfaces:**
- Consumes: Task 1 actions/utils/`RenownUserDocument`; Task 2 read model (`findHandleOwner` reads `LOWER(handle)`); Task 3 `handleProblem`/`normalizeHandle`; Task 4 `avatarProblem`, `mediaBackend`, `MediaBackend`.
- Produces:
  - `profilePayload(fields)`, `profileMessage(address, fields: ProfileFields, timestamp)`, types `ProfileFields`, `ProfileLink` (`core/signed-message.ts`; renown.id copies these verbatim in Task 7).
  - `toIdentityPatch(fields) → IdentityPatch` (throws `ProfileInputError(field, message)`), `linkActions(current, desired) → Action[]`, `identityActions(patch) → Action[]`.
  - `createHandleClaims(ttlMs = 120_000) → { holder(handle, now), claim(handle, documentId, now) }`.
  - `findHandleOwner(db, handle) → documentId | undefined`.
  - Mutation: `renown_upsertProfile(address: String!, username: String, userImage: String, displayName: String, handle: String, bio: String, links: [RenownProfileLinkInput!], avatar: String, signature: String, timestamp: String): String`; `input RenownProfileLinkInput { id: String! label: String! url: String! }`. Errors: `BAD_USER_INPUT` with `extensions.field`, `HANDLE_TAKEN` (`field: "handle"`), `INVALID_AVATAR` (`field: "avatar"`), `SERVICE_UNAVAILABLE` (avatar without a media backend), `FORBIDDEN`, `RATE_LIMITED` as before.
  - `ResolverDeps` gains `reactorClient.get`, `media?: () => MediaBackend | null`, `handleClaims?`.

- [ ] **Step 1: Write the failing tests.**

Create `subgraphs/renown-auth/tests/profile-identity.test.ts` with exactly:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import type { Action } from "document-model";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { reducer, utils, type RenownUserDocument } from "../../../document-models/renown-user/index.js";
import type { MediaBackend, StoredObject } from "../../../media/backend.js";
import { RenownUserProcessor } from "../../../processors/renown-user/index.js";
import { up as upUser } from "../../../processors/renown-user/migrations.js";
import type { DB as UserDB } from "../../../processors/renown-user/schema.js";
import { createHandleClaims } from "../core/handle-claims.js";
import { profileMessage, profilePayload, type ProfileFields } from "../core/signed-message.js";
import { createResolvers, type ResolverDeps } from "../resolvers.js";

vi.mock("../core/smart-wallet.js", () => ({
  verifyTypedDataOnChain: () => Promise.resolve(false),
  verifyMessageOnChain: () => Promise.resolve(false),
}));

const ALICE = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const BOB = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const USER_NS = RenownUserProcessor.getNamespace("renown-user");
const FILTER = { branch: ["main"], documentId: ["*"], documentType: [], scope: ["global"] };
const HASH = "d".repeat(64);
const REF = `attachment://v1:${HASH}`;
const PNG_HEAD = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

let root: Kysely<UserDB>;

beforeAll(async () => {
  root = new Kysely<UserDB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(USER_NS)}`.execute(root);
  await upUser(root.withSchema(USER_NS) as never);
});

afterAll(async () => {
  await root.destroy();
});

beforeEach(async () => {
  await root.withSchema(USER_NS).deleteFrom("renown_user").execute();
});

/**
 * Reactor stand-in that runs the real renown-user reducer (so a reducer
 * error shows up exactly as on a host) and feeds every successful
 * operation through the real read-model processor.
 */
function fakeReactor() {
  let next = 0;
  const docs = new Map<string, RenownUserDocument>();
  const processor = new RenownUserProcessor(USER_NS, FILTER, root.withSchema(USER_NS) as never);
  const applied = new Map<string, string[]>();
  return {
    applied: (id: string) => applied.get(id) ?? [],
    createEmpty: vi.fn((documentType: string) => {
      const id = `doc-${++next}`;
      const doc = utils.createDocument();
      doc.header.id = id;
      docs.set(id, doc);
      return Promise.resolve({ header: { id, documentType } });
    }),
    get: vi.fn((id: string) => Promise.resolve(docs.get(id))),
    execute: vi.fn(async (id: string, branch: string, actions: Action[]) => {
      let doc = docs.get(id);
      if (!doc) throw new Error(`no document ${id}`);
      for (const action of actions) {
        doc = reducer(doc, action as never);
        const operation = doc.operations.global.at(-1)!;
        applied.set(id, [...(applied.get(id) ?? []), action.type]);
        if (operation.error) continue;
        await processor.onOperations([
          { operation, context: { documentId: id, documentType: "powerhouse/renown-user", scope: "global", branch, ordinal: 0 } } as never,
        ]);
      }
      docs.set(id, doc);
      return doc;
    }),
  };
}

const relationalDb = { queryNamespace: (ns: string) => root.withSchema(ns) } as unknown as IRelationalDb<unknown>;

function storedAvatar(over: Partial<StoredObject> = {}): MediaBackend {
  return {
    kind: "s3",
    reserve: vi.fn(),
    serve: vi.fn(),
    inspect: vi.fn(() => Promise.resolve({ mimeType: "image/png", sizeBytes: 50_000, head: PNG_HEAD, ...over })),
  };
}

type Upsert = (parent: unknown, args: Record<string, unknown>, ctx: { user?: { address?: string } }) => Promise<string>;

function setup(media: MediaBackend | null = storedAvatar()) {
  const reactor = fakeReactor();
  const resolvers = createResolvers({
    reactorClient: reactor as unknown as ResolverDeps["reactorClient"],
    relationalDb,
    media: () => media,
    handleClaims: createHandleClaims(),
  }) as { Mutation: { renown_upsertProfile: Upsert } };
  const upsert = resolvers.Mutation.renown_upsertProfile;
  /** Upsert as `account`, signing the fields exactly as sent. */
  const signed = async (account = ALICE, fields: ProfileFields = {}) => {
    const timestamp = new Date().toISOString();
    const signature = await account.signMessage({ message: await profileMessage(account.address, fields, timestamp) });
    return upsert(null, { address: account.address, ...fields, signature, timestamp }, {});
  };
  return { reactor, upsert, signed };
}

/** The error `promise` rejects with (fails the test if it resolves). */
async function rejection(promise: Promise<unknown>): Promise<{ message: string; extensions: Record<string, unknown> }> {
  try {
    await promise;
  } catch (error) {
    return error as { message: string; extensions: Record<string, unknown> };
  }
  throw new Error("expected a rejection");
}

async function row(documentId: string) {
  return root.withSchema(USER_NS).selectFrom("renown_user").selectAll().where("document_id", "=", documentId).executeTakeFirstOrThrow();
}

const L1 = { id: "l1", label: "Site", url: "https://alice.example" };
const L2 = { id: "l2", label: "Code", url: "https://code.example/alice" };
const L3 = { id: "l3", label: "Blog", url: "https://blog.example" };

describe("profile payload", () => {
  it("keeps the legacy two-key payload when no identity field is present", () => {
    expect(profilePayload({ username: "frank" })).toBe('{"username":"frank","userImage":null}');
    expect(profilePayload({ username: "frank", handle: null, links: null })).toBe('{"username":"frank","userImage":null}');
  });

  it("matches the vectors renown.id pins (e2e/renown-signed-messages.spec.ts)", async () => {
    const address = "0xABC0000000000000000000000000000000000001";
    const at = "2026-10-09T12:00:00.000Z";
    expect(await profileMessage(address, { username: "frank" }, "t")).toBe(
      "Update Renown profile 0xabc0000000000000000000000000000000000001 e586dca7432283bd3bc606f7650606a0407f43f27843c738a82b9146603e6130 at t",
    );
    expect(
      await profileMessage(
        address,
        {
          displayName: "Frank",
          handle: "frank",
          bio: "Hi",
          links: [{ id: "l1", label: "Site", url: "https://frank.example" }],
          avatar: `attachment://v1:${"a".repeat(64)}`,
        },
        at,
      ),
    ).toBe(
      `Update Renown profile 0xabc0000000000000000000000000000000000001 4580e73ddd79972b5dd50d52aae493f1caed7a4025ec04ad402fd54c4a86ff55 at ${at}`,
    );
    expect(await profileMessage(address, { links: [] }, at)).toBe(
      `Update Renown profile 0xabc0000000000000000000000000000000000001 2de3522753823feab751ee8b58c4684f30d285ddfbf1dcae520db06c7772a629 at ${at}`,
    );
  });

  it("hashes all seven keys in a fixed order once an identity field is present", () => {
    expect(
      profilePayload({ links: [{ url: "https://a.example", label: "A", id: "x" }], displayName: "" }),
    ).toBe(
      '{"username":null,"userImage":null,"displayName":"","handle":null,"bio":null,"links":[{"id":"x","label":"A","url":"https://a.example"}],"avatar":null}',
    );
    expect(profilePayload({ links: [] })).toBe(
      '{"username":null,"userImage":null,"displayName":null,"handle":null,"bio":null,"links":[],"avatar":null}',
    );
  });
});

describe("renown_upsertProfile identity fields", () => {
  it("creates a full profile with one signature and indexes it", async () => {
    const { reactor, signed } = setup();
    const id = await signed(ALICE, {
      displayName: "  Alice  ",
      handle: " Alice-1 ",
      bio: "Hello",
      links: [L1, L2],
      avatar: REF,
    });
    expect(reactor.applied(id)).toEqual([
      "SET_ETH_ADDRESS", "SET_DISPLAY_NAME", "SET_HANDLE", "SET_BIO", "SET_AVATAR", "ADD_LINK", "ADD_LINK",
    ]);
    expect(await row(id)).toMatchObject({
      display_name: "Alice",
      handle: "alice-1",
      bio: "Hello",
      avatar_ref: REF,
      links: [L1, L2],
    });
  });

  it("patches: absent and null leave fields alone, '' and [] clear them", async () => {
    const { reactor, signed } = setup();
    const id = await signed(ALICE, { displayName: "Alice", handle: "alice", bio: "Hi", links: [L1], avatar: REF });
    await signed(ALICE, { bio: "New bio", displayName: null });
    expect(await row(id)).toMatchObject({ display_name: "Alice", handle: "alice", bio: "New bio", avatar_ref: REF, links: [L1] });
    await signed(ALICE, { displayName: "", handle: "", bio: "", links: [], avatar: "" });
    expect(await row(id)).toMatchObject({ display_name: null, handle: null, bio: null, avatar_ref: null, links: [] });
    expect(reactor.applied(id).slice(-5)).toEqual(["SET_DISPLAY_NAME", "SET_HANDLE", "SET_BIO", "SET_AVATAR", "REMOVE_LINK"]);
  });

  it("turns a desired link list into removes, updates, adds and one reorder", async () => {
    const { reactor, signed } = setup();
    const id = await signed(ALICE, { links: [L1, L2] });
    await signed(ALICE, { links: [L3, { ...L2, label: "Git" }] });
    expect(reactor.applied(id).slice(-4)).toEqual(["REMOVE_LINK", "UPDATE_LINK", "ADD_LINK", "REORDER_LINKS"]);
    expect((await row(id)).links).toEqual([L3, { ...L2, label: "Git" }]);
    const before = reactor.applied(id).length;
    await signed(ALICE, { links: [L3, { ...L2, label: "Git" }] });
    expect(reactor.applied(id)).toHaveLength(before); // nothing to change
  });

  it("treats a legacy profile without a links list as having none", async () => {
    const { reactor, signed } = setup();
    const id = await signed(ALICE, { displayName: "Alice" });
    const doc = await reactor.get(id);
    delete (doc!.state.global as { links?: unknown }).links;
    await signed(ALICE, { links: [L1] });
    expect((await row(id)).links).toEqual([L1]);
  });

  it("refuses a handle another profile holds, case-insensitively", async () => {
    const { signed } = setup();
    await signed(ALICE, { handle: "shared" });
    await expect(signed(BOB, { handle: "SHARED" })).rejects.toMatchObject({
      extensions: { code: "HANDLE_TAKEN", field: "handle" },
    });
    // Re-sending your own handle is fine.
    await expect(signed(ALICE, { handle: "shared", bio: "x" })).resolves.toBeTruthy();
  });

  it("refuses a handle claimed a moment ago that the read model has not indexed yet", async () => {
    const { signed, reactor } = setup();
    await signed(ALICE, { handle: "racer" });
    await root.withSchema(USER_NS).updateTable("renown_user").set({ handle: null }).execute(); // simulate lag
    await expect(signed(BOB, { handle: "racer" })).rejects.toMatchObject({ extensions: { code: "HANDLE_TAKEN" } });
    expect(reactor.createEmpty).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a reserved handle", { handle: "Admin" }, "handle", /reserved/],
    ["a malformed handle", { handle: "a_b" }, "handle", /3-30/],
    ["a 65-character display name", { displayName: "x".repeat(65) }, "displayName", /1-64/],
    ["a 281-character bio", { bio: "b".repeat(281) }, "bio", /280/],
    ["nine links", { links: Array.from({ length: 9 }, (_, i) => ({ id: `i${i}`, label: "L", url: "https://x.example" })) }, "links", /at most 8/],
    ["duplicate link ids", { links: [L1, { ...L2, id: "l1" }] }, "links", /unique id/],
    ["a link without an id", { links: [{ ...L1, id: "" }] }, "links", /unique id/],
    ["an empty link label", { links: [{ ...L1, label: "  " }] }, "links", /labels/],
    ["a javascript: link", { links: [{ ...L1, url: "javascript:alert(1)" }] }, "links", /http/],
    ["a non-ref avatar", { avatar: "https://evil.example/a.png" }, "avatar", /attachment/],
  ])("refuses %s as BAD_USER_INPUT before writing", async (_, fields, field, message) => {
    const { reactor, signed } = setup();
    const error = await rejection(signed(ALICE, fields as ProfileFields));
    expect(error.message).toMatch(message);
    expect(error.extensions).toMatchObject({ code: "BAD_USER_INPUT", field });
    expect(reactor.createEmpty).not.toHaveBeenCalled();
  });

  it.each([
    ["not uploaded", null, /not uploaded/],
    ["over 2 MB", { sizeBytes: 2 * 1024 * 1024 + 1 }, /larger/],
    ["an SVG", { mimeType: "image/svg+xml" }, /not an image/],
    ["HTML bytes labelled PNG", { head: new TextEncoder().encode("<html>") }, /not a PNG/],
  ])("refuses an avatar that is %s as INVALID_AVATAR", async (_, over, message) => {
    const media: MediaBackend =
      over === null ? { ...storedAvatar(), inspect: vi.fn(() => Promise.resolve(null)) } : storedAvatar(over);
    const { reactor, signed } = setup(media);
    const error = await rejection(signed(ALICE, { avatar: REF }));
    expect(error.message).toMatch(message);
    expect(error.extensions).toMatchObject({ code: "INVALID_AVATAR", field: "avatar" });
    expect(reactor.createEmpty).not.toHaveBeenCalled();
  });

  it("is unavailable for avatars without a media backend, but clears one without it", async () => {
    const { signed } = setup(null);
    await expect(signed(ALICE, { avatar: REF })).rejects.toMatchObject({ extensions: { code: "SERVICE_UNAVAILABLE" } });
    await expect(signed(ALICE, { avatar: "" })).resolves.toBeTruthy();
  });

  it("rejects a signature over different identity fields", async () => {
    const { upsert } = setup();
    const timestamp = new Date().toISOString();
    const signature = await ALICE.signMessage({ message: await profileMessage(ALICE.address, { handle: "alice" }, timestamp) });
    await expect(
      upsert(null, { address: ALICE.address, handle: "mallory", signature, timestamp }, {}),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });
});
```

And update the existing schema assertion:

```bash
git apply <<'PLAN_EOF'
diff --git a/subgraphs/renown-auth/tests/resolvers.test.ts b/subgraphs/renown-auth/tests/resolvers.test.ts
--- a/subgraphs/renown-auth/tests/resolvers.test.ts
+++ b/subgraphs/renown-auth/tests/resolvers.test.ts
@@ -314,7 +314,7 @@ describe("renown-auth schema", () => {
       "renown_revokeCredential(credentialId: String!, signature: String, timestamp: String): Boolean",
     );
     expect(sdl).toContain(
-      "renown_upsertProfile(address: String!, username: String, userImage: String, signature: String, timestamp: String): String",
+      "renown_upsertProfile(address: String!, username: String, userImage: String, displayName: String, handle: String, bio: String, links: [RenownProfileLinkInput!], avatar: String, signature: String, timestamp: String): String",
     );
   });
 
PLAN_EOF
```

- [ ] **Step 2: Run them to see them fail.** `pnpm exec vitest run subgraphs/renown-auth` → FAIL (`Cannot find module '../core/handle-claims.js'`, and the schema signature test).

- [ ] **Step 3: Implement.**

Create `subgraphs/renown-auth/core/handle-claims.ts` with exactly:

```ts
/** How long a dispatched handle is held for its profile before the read model is trusted alone. */
export const HANDLE_CLAIM_TTL_MS = 120_000;

/**
 * Handles dispatched by this process but maybe not yet visible in the read
 * model (the processor indexes asynchronously). Without it, two upserts a
 * few milliseconds apart could both see a handle as free.
 */
export function createHandleClaims(ttlMs = HANDLE_CLAIM_TTL_MS) {
  const claims = new Map<string, { documentId: string; until: number }>();
  return {
    /** The document holding a live claim on `handle`, if any. */
    holder(handle: string, now: number): string | undefined {
      const claim = claims.get(handle);
      if (!claim || claim.until <= now) {
        claims.delete(handle);
        return undefined;
      }
      return claim.documentId;
    },
    claim(handle: string, documentId: string, now: number): void {
      claims.set(handle, { documentId, until: now + ttlMs });
    },
  };
}

export type HandleClaims = ReturnType<typeof createHandleClaims>;
```

Create `subgraphs/renown-auth/core/profile-patch.ts` with exactly:

```ts
import type { Action } from "document-model";
import {
  actions as userActions,
  isValidAvatarRef,
  isValidDisplayName,
  isValidLinkLabel,
  isValidLinkUrl,
  MAX_BIO_LENGTH,
  MAX_LINKS,
  type RenownUserLink,
} from "../../../document-models/renown-user/index.js";
import { handleProblem, normalizeHandle } from "./handle.js";
import type { ProfileFields, ProfileLink } from "./signed-message.js";

/**
 * A validated identity patch. `undefined` leaves a field unchanged, `null`
 * clears it; `links` is the complete desired list when present.
 */
export interface IdentityPatch {
  displayName?: string | null;
  handle?: string | null;
  bio?: string | null;
  links?: ProfileLink[];
  avatar?: string | null;
}

/** Thrown for an input that fails validation; `field` names the offending input. */
export class ProfileInputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfileInputError";
  }
}

/**
 * Applies the patch rules to the raw (signed) input: absent or null means
 * unchanged, "" (or []) clears. Text is trimmed and the handle lowercased.
 * @throws {ProfileInputError} for a value the model would reject, or a reserved handle.
 */
export function toIdentityPatch(input: ProfileFields): IdentityPatch {
  const patch: IdentityPatch = {};

  if (input.displayName != null) {
    const displayName = input.displayName.trim();
    if (displayName !== "" && !isValidDisplayName(displayName)) {
      throw new ProfileInputError("displayName", "Display name must be 1-64 characters");
    }
    patch.displayName = displayName || null;
  }

  if (input.handle != null) {
    const handle = normalizeHandle(input.handle);
    if (handle !== "") {
      const problem = handleProblem(handle);
      if (problem === "RESERVED") throw new ProfileInputError("handle", `The handle "${handle}" is reserved`);
      if (problem === "INVALID") {
        throw new ProfileInputError(
          "handle",
          "Handle must be 3-30 lowercase letters, digits or hyphens, not starting or ending with a hyphen",
        );
      }
    }
    patch.handle = handle || null;
  }

  if (input.bio != null) {
    const bio = input.bio.trim();
    if (bio.length > MAX_BIO_LENGTH) {
      throw new ProfileInputError("bio", `Bio must be at most ${MAX_BIO_LENGTH} characters`);
    }
    patch.bio = bio || null;
  }

  if (input.links != null) {
    if (input.links.length > MAX_LINKS) {
      throw new ProfileInputError("links", `A profile holds at most ${MAX_LINKS} links`);
    }
    const ids = new Set<string>();
    patch.links = input.links.map((link) => {
      const label = link.label.trim();
      const url = link.url.trim();
      if (!link.id || ids.has(link.id)) throw new ProfileInputError("links", "Every link needs a unique id");
      ids.add(link.id);
      if (!isValidLinkLabel(label)) throw new ProfileInputError("links", "Link labels must be 1-40 characters");
      if (!isValidLinkUrl(url)) throw new ProfileInputError("links", "Links must be http(s) URLs");
      return { id: link.id, label, url };
    });
  }

  if (input.avatar != null) {
    if (input.avatar !== "" && !isValidAvatarRef(input.avatar)) {
      throw new ProfileInputError("avatar", "Avatar must be an attachment://v1:<sha256> reference");
    }
    patch.avatar = input.avatar || null;
  }

  return patch;
}

/**
 * The renown-user actions that turn `current` links into `desired` (removes,
 * then updates, then adds, then one reorder if the order still differs).
 */
export function linkActions(current: readonly RenownUserLink[], desired: readonly ProfileLink[]): Action[] {
  const wanted = new Map(desired.map((link) => [link.id, link]));
  const out: Action[] = [];
  const kept: string[] = [];
  for (const link of current) {
    const next = wanted.get(link.id);
    if (!next) {
      out.push(userActions.removeLink({ id: link.id }));
      continue;
    }
    kept.push(link.id);
    if (next.label !== link.label || next.url !== link.url) {
      out.push(userActions.updateLink({ id: link.id, label: next.label, url: next.url }));
    }
  }
  const existing = new Set(kept);
  for (const link of desired) {
    if (!existing.has(link.id)) {
      out.push(userActions.addLink({ id: link.id, label: link.label, url: link.url }));
      kept.push(link.id);
    }
  }
  const order = desired.map((link) => link.id);
  if (kept.some((id, i) => id !== order[i])) out.push(userActions.reorderLinks({ linkIds: order }));
  return out;
}

/** The actions for the scalar identity fields of `patch`, in a fixed order. */
export function identityActions(patch: IdentityPatch): Action[] {
  const out: Action[] = [];
  if (patch.displayName !== undefined) out.push(userActions.setDisplayName({ displayName: patch.displayName }));
  if (patch.handle !== undefined) out.push(userActions.setHandle({ handle: patch.handle }));
  if (patch.bio !== undefined) out.push(userActions.setBio({ bio: patch.bio }));
  if (patch.avatar !== undefined) {
    out.push(
      userActions.setAvatar({ avatar: patch.avatar as `attachment://v${number}:${string}` | null }),
    );
  }
  return out;
}
```

```bash
git apply <<'PLAN_EOF'
diff --git a/subgraphs/renown-auth/core/signed-message.ts b/subgraphs/renown-auth/core/signed-message.ts
--- a/subgraphs/renown-auth/core/signed-message.ts
+++ b/subgraphs/renown-auth/core/signed-message.ts
@@ -19,6 +19,47 @@ export function revokeMessage(credentialId: string, timestamp: string): string {
   return `Revoke Renown credential ${credentialId} at ${timestamp}`;
 }
 
+/** A profile link as signed and stored. */
+export interface ProfileLink {
+  id: string;
+  label: string;
+  url: string;
+}
+
+/** Every field a signed profile upsert may carry. Absent and null mean "unchanged". */
+export interface ProfileFields {
+  username?: string | null;
+  userImage?: string | null;
+  displayName?: string | null;
+  handle?: string | null;
+  bio?: string | null;
+  links?: readonly ProfileLink[] | null;
+  avatar?: string | null;
+}
+
+/**
+ * The JSON a profile signature hashes. Legacy writes (username/userImage
+ * only) keep the exact two-key payload older clients sign. As soon as any
+ * identity field is present, all seven keys are hashed in this fixed order,
+ * and each link is reduced to `{id, label, url}` in that key order, so the
+ * client and the server serialize the same bytes.
+ */
+export function profilePayload(profile: ProfileFields): string {
+  const legacy = { username: profile.username ?? null, userImage: profile.userImage ?? null };
+  const identity = [profile.displayName, profile.handle, profile.bio, profile.links, profile.avatar];
+  if (identity.every((value) => value === undefined || value === null)) {
+    return JSON.stringify(legacy);
+  }
+  return JSON.stringify({
+    ...legacy,
+    displayName: profile.displayName ?? null,
+    handle: profile.handle ?? null,
+    bio: profile.bio ?? null,
+    links: profile.links ? profile.links.map(({ id, label, url }) => ({ id, label, url })) : null,
+    avatar: profile.avatar ?? null,
+  });
+}
+
 /**
  * Canonical message a caller signs to authorize a profile upsert. The payload
  * is hashed (rather than embedded raw) so the signed message has a fixed
@@ -26,14 +67,10 @@ export function revokeMessage(credentialId: string, timestamp: string): string {
  */
 export async function profileMessage(
   address: string,
-  profile: { username?: string | null; userImage?: string | null },
+  profile: ProfileFields,
   timestamp: string,
 ): Promise<string> {
-  const payload = JSON.stringify({
-    username: profile.username ?? null,
-    userImage: profile.userImage ?? null,
-  });
-  const hash = await sha256hex(payload);
+  const hash = await sha256hex(profilePayload(profile));
   return `Update Renown profile ${address.toLowerCase()} ${hash} at ${timestamp}`;
 }
 
diff --git a/subgraphs/renown-auth/lookups.ts b/subgraphs/renown-auth/lookups.ts
--- a/subgraphs/renown-auth/lookups.ts
+++ b/subgraphs/renown-auth/lookups.ts
@@ -60,3 +60,16 @@ export async function findNewestProfileDoc(
     .executeTakeFirst();
   return row?.document_id;
 }
+
+/**
+ * The profile document holding `handle` (case-insensitive), if any. The
+ * unique index on LOWER(handle) allows at most one.
+ */
+export async function findHandleOwner(db: ReadModelDb, handle: string): Promise<string | undefined> {
+  const row = await RenownUserProcessor.query<RenownUserDB>("renown-user", db)
+    .selectFrom("renown_user")
+    .select("document_id")
+    .where((eb) => eb(eb.fn("LOWER", ["renown_user.handle"]), "=", handle.toLowerCase()))
+    .executeTakeFirst();
+  return row?.document_id;
+}
diff --git a/subgraphs/renown-auth/schema.ts b/subgraphs/renown-auth/schema.ts
--- a/subgraphs/renown-auth/schema.ts
+++ b/subgraphs/renown-auth/schema.ts
@@ -18,6 +18,13 @@ const inputTypeDefs = inputNames.reduce(
 export const schema: DocumentNode = gql`
   ${inputTypeDefs}
 
+  "A profile link as renown_upsertProfile takes it; the id is chosen by the client."
+  input RenownProfileLinkInput {
+    id: String!
+    label: String!
+    url: String!
+  }
+
   """
   Renown writes that authorize themselves. They are public (no host policy
   applies to them) and write through the in-process reactor client, so each
@@ -49,11 +56,19 @@ export const schema: DocumentNode = gql`
     Creates or updates the profile of an address; returns its document id.
     Authorized by a login token for the address, or by its personal_sign of
     "Update Renown profile <address> <sha256(json)> at <timestamp>".
+    Patch semantics: an absent or null field is unchanged; "" clears a text
+    field or the avatar; links replaces the whole list ([] clears it).
+    Errors: BAD_USER_INPUT (extensions.field), HANDLE_TAKEN, INVALID_AVATAR.
     """
     renown_upsertProfile(
       address: String!
       username: String
       userImage: String
+      displayName: String
+      handle: String
+      bio: String
+      links: [RenownProfileLinkInput!]
+      avatar: String
       signature: String
       timestamp: String
     ): String
diff --git a/subgraphs/renown-auth/resolvers.ts b/subgraphs/renown-auth/resolvers.ts
--- a/subgraphs/renown-auth/resolvers.ts
+++ b/subgraphs/renown-auth/resolvers.ts
@@ -12,7 +12,19 @@ import {
 import {
   actions as userActions,
   renownUserDocumentType,
+  type RenownUserDocument,
 } from "../../document-models/renown-user/index.js";
+import { avatarProblem } from "../../media/avatar.js";
+import type { MediaBackend } from "../../media/backend.js";
+import { mediaBackend } from "../../media/slot.js";
+import { createHandleClaims, type HandleClaims } from "./core/handle-claims.js";
+import {
+  identityActions,
+  linkActions,
+  ProfileInputError,
+  toIdentityPatch,
+  type IdentityPatch,
+} from "./core/profile-patch.js";
 import { issuerAddressOf, validateCredentialInput } from "./core/credential-input.js";
 import { createRateLimiter } from "./core/rate-limit.js";
 import {
@@ -21,7 +33,7 @@ import {
   revokeMessage,
   verifySignedMessage,
 } from "./core/signed-message.js";
-import { findCredentialDocs, findNewestProfileDoc, type ReadModelDb } from "./lookups.js";
+import { findCredentialDocs, findHandleOwner, findNewestProfileDoc, type ReadModelDb } from "./lookups.js";
 import { verifyMessageOnChain, verifyTypedDataOnChain } from "./core/smart-wallet.js";
 
 // Signed revoke/profile messages carry no chain; smart-wallet signatures over
@@ -51,11 +63,14 @@ interface SignedMessage {
 }
 
 export interface ResolverDeps {
-  reactorClient: Pick<IReactorClient, "createEmpty" | "execute">;
+  reactorClient: Pick<IReactorClient, "createEmpty" | "execute" | "get">;
   relationalDb: ReadModelDb;
   now?: () => Date;
   issuanceRateLimiter?: RateLimiter;
   profileRateLimiter?: RateLimiter;
+  /** Where avatar uploads are checked; defaults to the backend the media processor published. */
+  media?: () => MediaBackend | null;
+  handleClaims?: HandleClaims;
 }
 
 type RateLimiter = { take(key: string, now?: number): boolean };
@@ -78,6 +93,11 @@ interface UpsertProfileArgs {
   address: string;
   username?: string | null;
   userImage?: string | null;
+  displayName?: string | null;
+  handle?: string | null;
+  bio?: string | null;
+  links?: { id: string; label: string; url: string }[] | null;
+  avatar?: string | null;
   signature?: string | null;
   timestamp?: string | null;
 }
@@ -90,6 +110,11 @@ function invalidRequest(message: string): GraphQLError {
   return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
 }
 
+/** A profile field the caller must fix; `field` lets a form show it inline. */
+function fieldError(code: string, field: string, message: string): GraphQLError {
+  return new GraphQLError(message, { extensions: { code, field } });
+}
+
 function rateLimited(): GraphQLError {
   return new GraphQLError("Rate limited", { extensions: { code: "RATE_LIMITED" } });
 }
@@ -215,6 +240,46 @@ export function createResolvers(deps: ResolverDeps): Record<string, unknown> {
   const now = deps.now ?? (() => new Date());
   const issuanceRateLimiter = deps.issuanceRateLimiter ?? createRateLimiter(WRITE_LIMIT, WRITE_WINDOW_MS);
   const profileRateLimiter = deps.profileRateLimiter ?? createRateLimiter(WRITE_LIMIT, WRITE_WINDOW_MS);
+  const media = deps.media ?? mediaBackend;
+  const handleClaims = deps.handleClaims ?? createHandleClaims();
+
+  /** Validates the raw identity fields into a patch, as BAD_USER_INPUT naming the field. */
+  function identityPatch(args: UpsertProfileArgs): IdentityPatch {
+    try {
+      return toIdentityPatch(args);
+    } catch (error) {
+      if (error instanceof ProfileInputError) throw fieldError("BAD_USER_INPUT", error.field, error.message);
+      throw error;
+    }
+  }
+
+  /** HANDLE_TAKEN unless `handle` is free or already this profile's. */
+  async function assertHandleFree(handle: string, documentId: string | undefined): Promise<void> {
+    const owner = handleClaims.holder(handle, now().getTime()) ?? (await findHandleOwner(relationalDb, handle));
+    if (owner !== undefined && owner !== documentId) {
+      throw fieldError("HANDLE_TAKEN", "handle", `The handle "${handle}" is taken`);
+    }
+  }
+
+  /** INVALID_AVATAR unless `ref` is a stored image within the avatar limits. */
+  async function assertAvatar(ref: string): Promise<void> {
+    const backend = media();
+    if (!backend) {
+      throw new GraphQLError("Avatar uploads are not available", { extensions: { code: "SERVICE_UNAVAILABLE" } });
+    }
+    const problem = await avatarProblem(ref, backend);
+    if (problem) throw fieldError("INVALID_AVATAR", "avatar", `Invalid avatar: ${problem}`);
+  }
+
+  /** The actions that bring `documentId`'s links to `desired` (a new profile has none). */
+  async function linkPatch(documentId: string | undefined, desired: IdentityPatch["links"]): Promise<Action[]> {
+    if (desired === undefined) return [];
+    if (documentId === undefined) return linkActions([], desired);
+    const document = await reactorClient.get<RenownUserDocument>(documentId);
+    // Profiles from before links existed have no list at all.
+    const current = (document.state.global as { links?: typeof desired }).links ?? [];
+    return linkActions(current, desired);
+  }
 
   /** Applies `actions` and throws if the reactor rejected any of them. */
   async function execute(documentId: string, actions: Action[]): Promise<void> {
@@ -324,12 +389,26 @@ export function createResolvers(deps: ResolverDeps): Record<string, unknown> {
           throw invalidRequest("Invalid request: address is not a valid Ethereum address");
         }
         assertProfileBounds({ username, userImage });
+        const patch = identityPatch(args);
 
+        // The signature covers the fields exactly as sent, before any trimming.
         await authorizeAddress(
           ctx,
           address,
           {
-            message: await profileMessage(address, { username, userImage }, timestamp ?? ""),
+            message: await profileMessage(
+              address,
+              {
+                username,
+                userImage,
+                displayName: args.displayName,
+                handle: args.handle,
+                bio: args.bio,
+                links: args.links,
+                avatar: args.avatar,
+              },
+              timestamp ?? "",
+            ),
             signature,
             timestamp,
           },
@@ -340,11 +419,18 @@ export function createResolvers(deps: ResolverDeps): Record<string, unknown> {
         if (!profileRateLimiter.take(lowercased, now().getTime())) throw rateLimited();
 
         const existing = await findNewestProfileDoc(relationalDb, lowercased);
+        if (patch.handle) await assertHandleFree(patch.handle, existing);
+        if (patch.avatar) await assertAvatar(patch.avatar);
+        const links = await linkPatch(existing, patch.links);
+
         const documentId = existing ?? (await create(renownUserDocumentType));
         const actions = [
           ...(existing ? [] : [userActions.setEthAddress({ ethAddress: lowercased })]),
           ...profileActions({ username, userImage }),
+          ...identityActions(patch),
+          ...links,
         ];
+        if (patch.handle) handleClaims.claim(patch.handle, documentId, now().getTime());
         if (actions.length > 0) await execute(documentId, actions);
         return documentId;
       },
PLAN_EOF
```

Order inside the resolver is deliberate: validate input → verify the signature over the fields **as sent** (before trimming) → rate limit → handle uniqueness (read model + in-process claims) → avatar check → link diff from the current document → dispatch; the claim is recorded before dispatch.

- [ ] **Step 4: Run everything.** `pnpm exec vitest run` → all suites PASS (the existing 1 000-line `resolvers.test.ts` unchanged apart from the signature line). `pnpm exec vitest run --coverage` → thresholds pass. `pnpm tsc`, `pnpm lint` → no errors.

- [ ] **Step 5: Commit.**

```bash
git add subgraphs/renown-auth/core/signed-message.ts subgraphs/renown-auth/core/handle-claims.ts subgraphs/renown-auth/core/profile-patch.ts subgraphs/renown-auth/lookups.ts subgraphs/renown-auth/resolvers.ts subgraphs/renown-auth/schema.ts subgraphs/renown-auth/tests/resolvers.test.ts subgraphs/renown-auth/tests/profile-identity.test.ts
git commit -m "feat(renown-auth): profile identity fields with patch semantics on renown_upsertProfile"
```

### Task 6: Identity smoke script

**Files:**
- Create: `scripts/smoke/identity-profile.ts`
- Modify: `scripts/smoke/README.md`

**Interfaces:**
- Consumes: Task 4 routes, Task 5 mutation, `profileMessage` (imported by URL so Node's type stripping loads the `.ts`), renown.id routes from Tasks 7–8 (`/media`, `/@handle`, `/profile/<doc>` → 307).
- Produces: `node scripts/smoke/identity-profile.ts [--switchboard <url>] [--app <url>] [--allow-prod]`, exit 0 + `OK` on success; like `attachment-upload.ts` (commit 8245baa) it refuses non-staging switchboards without `--allow-prod` and revokes its throwaway credential at the end, also on failure.

- [ ] **Step 1: Write the script.**

Create `scripts/smoke/identity-profile.ts` with exactly:

```ts
/**
 * End-to-end smoke test of Renown profile identity (identity hub phase 1):
 *
 *   node scripts/smoke/identity-profile.ts [--switchboard <url>] [--app <url>] [--allow-prod]
 *
 * With a throwaway wallet and no human interaction it:
 *   1. issues a delegation credential and mints a Renown bearer,
 *   2. checks the gated upload route refuses: no bearer (401), an SVG (415),
 *      3 MB (413); and that a PUT whose length differs from the declared
 *      size is refused by storage (the upload target pins content-length),
 *   3. uploads a PNG avatar through POST <package>/media/uploads + its target,
 *   4. saves displayName, a fresh handle, bio, links and the avatar with ONE
 *      signed renown_upsertProfile, and waits for the read model,
 *   5. checks INVALID_AVATAR (a ref never uploaded) and HANDLE_TAKEN (a second
 *      wallet asking for the same handle),
 *   6. follows GET <package>/media/<doc>/avatar (302, cache policy) to the
 *      image and compares its sha256, then renown.id's /media, /@handle and
 *      /profile/<doc> → /@handle,
 *   7. releases the handle and avatar again and revokes the throwaway
 *      credential (also when a step failed).
 *
 * Refuses a non-staging switchboard unless --allow-prod. Never prints keys,
 * bearers or presigned URLs. Exits 1 on any failure.
 */
import {
  DEFAULT_RENOWN_CHAIN_ID,
  MemoryKeyStorage,
  RenownCryptoBuilder,
  buildAndSignCredential,
} from "@renown/sdk";
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type * as SignedMessageModule from "../../subgraphs/renown-auth/core/signed-message.js";

// Imported by URL so Node's type stripping can load the .ts file; typed from the module itself.
const SIGNED_MESSAGE = new URL("../../subgraphs/renown-auth/core/signed-message.ts", import.meta.url).href;

const STAGING_SWITCHBOARD = "https://switchboard.renown-staging.vetra.io";
const STAGING_APP = "https://renown-staging.vetra.io";
const PACKAGE = "/api/@powerhousedao/renown-package";
const APP_NAME = "renown-identity-smoke";

class SmokeFailure extends Error {}

interface Args {
  switchboard: string;
  app: string;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { switchboard: STAGING_SWITCHBOARD, app: STAGING_APP, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new SmokeFailure(`${arg} needs a URL`);
      return v;
    };
    if (arg === "--switchboard") args.switchboard = value();
    else if (arg === "--app") args.app = value();
    else if (arg === "--allow-prod") args.allowProd = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: identity-profile.ts [--switchboard <url>] [--app <url>] [--allow-prod]");
      process.exit(0);
    } else throw new SmokeFailure(`unknown argument: ${arg}`);
  }
  args.switchboard = args.switchboard.replace(/\/+$/, "").replace(/\/graphql$/, "");
  args.app = args.app.replace(/\/+$/, "");
  if (!args.allowProd && !isStagingSwitchboard(args.switchboard)) {
    throw new SmokeFailure(`${args.switchboard} is not a staging switchboard; pass --allow-prod to run against it`);
  }
  return args;
}

/** True for staging hosts (`*-staging.*` / `*.renown-staging.*`) and loopback (as attachment-upload.ts). */
function isStagingSwitchboard(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return /(^|[.-])staging([.-]|$)/.test(host) || host === "localhost" || host === "127.0.0.1";
}

function step(label: string, detail = ""): void {
  console.log(`[smoke] ${label}${detail ? ` ${detail}` : ""}`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

function clip(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A solid-color RGB PNG, built in-process. */
function solidPng(size: number, rgb: [number, number, number]): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Buffer): Buffer => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const randomRgb = (): [number, number, number] => [0, 1, 2].map(() => Math.floor(Math.random() * 256)) as [number, number, number];

interface GraphqlResult<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string; field?: string } }[];
}

async function graphql<T>(switchboard: string, query: string, variables: unknown): Promise<GraphqlResult<T>> {
  const res = await fetch(`${switchboard}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as GraphqlResult<T>;
  } catch {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${clip(text)}`);
  }
}

function data<T>(result: GraphqlResult<T>, what: string): T {
  if (result.errors?.length || !result.data) throw new SmokeFailure(`${what}: ${JSON.stringify(result.errors ?? result)}`);
  return result.data;
}

const ISSUE_CREDENTIAL = `mutation IssueCredential($input: RenownCredential_InitInput!) { renown_issueCredential(input: $input) }`;
const REVOKE_CREDENTIAL = `mutation Revoke($credentialId: String!, $signature: String, $timestamp: String) {
  renown_revokeCredential(credentialId: $credentialId, signature: $signature, timestamp: $timestamp)
}`;
const UPSERT = `mutation Upsert($address: String!, $displayName: String, $handle: String, $bio: String,
  $links: [RenownProfileLinkInput!], $avatar: String, $signature: String, $timestamp: String) {
  renown_upsertProfile(address: $address, displayName: $displayName, handle: $handle, bio: $bio,
    links: $links, avatar: $avatar, signature: $signature, timestamp: $timestamp)
}`;
const BY_HANDLE = `query ByHandle($handle: String!) {
  renownUser(input: { handle: $handle }) { documentId handle displayName bio avatar links { id label url } }
}`;

/** Throwaway wallet + app did:key, a stored delegation credential, and a bearer for it. */
async function identity(switchboard: string) {
  const account = privateKeyToAccount(generatePrivateKey());
  // @renown/sdk 6.2.3 ships DEFAULT_RENOWN_CHAIN_ID as the string "1".
  const chainId = Number(DEFAULT_RENOWN_CHAIN_ID);
  const crypto = await new RenownCryptoBuilder().withKeyPairStorage(new MemoryKeyStorage()).withChainId(chainId).build();
  const vc = await buildAndSignCredential({
    signTypedData: (args) => account.signTypedData(args as never),
    address: account.address,
    chainId,
    app: APP_NAME,
    appId: crypto.did,
    expiresInDays: 1,
  });
  const input = {
    id: vc.id,
    context: vc["@context"],
    type: vc.type,
    issuer: { id: vc.issuer.id, ethereumAddress: vc.issuer.ethereumAddress },
    credentialSubject: { id: vc.credentialSubject.id, app: vc.credentialSubject.app },
    credentialSchema: { id: vc.credentialSchema.id, type: vc.credentialSchema.type },
    issuanceDate: vc.issuanceDate,
    expirationDate: vc.expirationDate,
    proof: {
      type: vc.proof.type,
      created: vc.proof.created,
      verificationMethod: vc.proof.verificationMethod,
      proofPurpose: vc.proof.proofPurpose,
      proofValue: vc.proof.proofValue,
      ethereumAddress: vc.proof.ethereumAddress,
      eip712: {
        domain: { version: vc.proof.eip712.domain.version, chainId: Number(vc.proof.eip712.domain.chainId) },
        primaryType: "VerifiableCredential",
      },
    },
  };
  data(await graphql<{ renown_issueCredential: string }>(switchboard, ISSUE_CREDENTIAL, { input }), "renown_issueCredential");
  const bearer = await crypto.getBearerToken(account.address, { expiresIn: 600 });
  return { account, bearer, credentialId: vc.id };
}

/** Revokes the throwaway credential with its wallet's signature; false if that failed. */
async function revoke(switchboard: string, account: PrivateKeyAccount, credentialId: string): Promise<boolean> {
  const { revokeMessage } = (await import(SIGNED_MESSAGE)) as typeof SignedMessageModule;
  try {
    const timestamp = new Date().toISOString();
    const signature = await account.signMessage({ message: revokeMessage(credentialId, timestamp) });
    data(await graphql<{ renown_revokeCredential: boolean }>(switchboard, REVOKE_CREDENTIAL, { credentialId, signature, timestamp }), "renown_revokeCredential");
    step("credential revoked");
    return true;
  } catch (error) {
    console.error(`[smoke] WARNING: could not revoke the throwaway credential: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function reserve(switchboard: string, bearer: string | null, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${switchboard}${PACKAGE}/media/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
}

interface Reservation {
  ref: string;
  deduped?: boolean;
  uploadTarget?: { url: string; method: "PUT"; headers: Record<string, string> } | null;
}

/** Reserves `bytes` (retrying while the fresh credential reaches the read model) and returns the reservation. */
async function reservePng(switchboard: string, bearer: string, bytes: Uint8Array, sizeBytes = bytes.length): Promise<Reservation> {
  const body = { purpose: "avatar", mimeType: "image/png", sizeBytes, sha256: sha256(bytes) };
  for (let attempt = 1; attempt <= 10; attempt++) {
    const res = await reserve(switchboard, bearer, body);
    const text = await res.text();
    if (res.status === 201 || res.status === 200) return JSON.parse(text) as Reservation;
    if (res.status !== 401) throw new SmokeFailure(`reserve -> HTTP ${res.status}: ${clip(text)}`);
    step("reserve", `401 (attempt ${attempt}/10, waiting for the read model)`);
    await sleep(2000);
  }
  throw new SmokeFailure("reserve kept answering 401");
}

async function signedUpsert(
  switchboard: string,
  account: PrivateKeyAccount,
  fields: Record<string, unknown>,
): Promise<GraphqlResult<{ renown_upsertProfile: string }>> {
  const { profileMessage } = (await import(SIGNED_MESSAGE)) as typeof SignedMessageModule;
  const timestamp = new Date().toISOString();
  const signature = await account.signMessage({ message: await profileMessage(account.address, fields, timestamp) });
  return graphql(switchboard, UPSERT, { address: account.address, ...fields, signature, timestamp });
}

async function main(): Promise<void> {
  const { switchboard, app } = parseArgs(process.argv.slice(2));
  step("switchboard", switchboard);
  step("app", app);

  const { account, bearer, credentialId } = await identity(switchboard);
  step("wallet", account.address);
  let revoked = false;
  try {
    await run(switchboard, app, account, bearer);
  } finally {
    revoked = await revoke(switchboard, account, credentialId);
  }
  if (!revoked) throw new SmokeFailure("credential was not revoked");
  console.log("OK");
}

async function run(switchboard: string, app: string, account: PrivateKeyAccount, bearer: string): Promise<void> {
  // 2. The upload route's gates.
  const png = solidPng(64, randomRgb());
  const valid = { purpose: "avatar", mimeType: "image/png", sizeBytes: png.length, sha256: sha256(png) };
  check((await reserve(switchboard, null, valid)).status === 401, "anonymous upload was not refused with 401");
  check((await reserve(switchboard, bearer, { ...valid, mimeType: "image/svg+xml" })).status === 415, "SVG was not refused with 415");
  check((await reserve(switchboard, bearer, { ...valid, sizeBytes: 3 * 1024 * 1024 })).status === 413, "3 MB was not refused with 413");
  step("gates", "401 / 415 / 413 as expected");

  const liar = solidPng(64, randomRgb());
  const lie = await reservePng(switchboard, bearer, liar, liar.length + 1);
  if (lie.uploadTarget) {
    const put = await fetch(lie.uploadTarget.url, { method: "PUT", headers: lie.uploadTarget.headers, body: liar });
    check(!put.ok, `storage accepted ${liar.length} bytes for a reservation of ${liar.length + 1} (content-length not pinned)`);
    step("length pinning", `PUT refused with HTTP ${put.status}`);
  } else {
    step("length pinning", "skipped (filesystem backend)");
  }

  // 3. Upload the avatar.
  const reservation = await reservePng(switchboard, bearer, png);
  check(reservation.ref === `attachment://v1:${sha256(png)}`, `unexpected ref ${reservation.ref}`);
  if (!reservation.deduped) {
    check(reservation.uploadTarget, "no uploadTarget (expected an S3 backend)");
    const put = await fetch(reservation.uploadTarget.url, { method: "PUT", headers: reservation.uploadTarget.headers, body: png });
    check(put.ok, `upload PUT -> HTTP ${put.status}: ${clip(await put.text())}`);
  }
  step("uploaded", reservation.ref);

  // 4. One signed save of every identity field.
  const handle = `smoke-${Math.random().toString(36).slice(2, 8)}`;
  const fields = {
    displayName: "Smoke Test",
    handle,
    bio: "Created by scripts/smoke/identity-profile.ts",
    links: [{ id: "smoke-link", label: "Renown", url: "https://renown.id" }],
    avatar: reservation.ref,
  };
  const documentId = data(await signedUpsert(switchboard, account, fields), "renown_upsertProfile").renown_upsertProfile;
  step("saved", `doc=${documentId} handle=@${handle}`);

  type Indexed = { documentId: string; avatar: string | null } | null;
  const readBack = async (): Promise<Indexed> =>
    data(await graphql<{ renownUser: Indexed }>(switchboard, BY_HANDLE, { handle }), "renownUser").renownUser;
  let indexed = await readBack();
  for (let attempt = 1; attempt <= 15 && indexed?.avatar !== reservation.ref; attempt++) {
    await sleep(1000);
    indexed = await readBack();
  }
  check(indexed?.documentId === documentId && indexed.avatar === reservation.ref, "read model never showed the saved profile");
  step("read model", "renownUser(handle) returns the profile");

  // 5. Validation on the write path.
  const ghost = `attachment://v1:${sha256(solidPng(8, randomRgb()))}`;
  const invalid = await signedUpsert(switchboard, account, { avatar: ghost });
  check(invalid.errors?.[0]?.extensions?.code === "INVALID_AVATAR", `expected INVALID_AVATAR, got ${JSON.stringify(invalid.errors ?? invalid.data)}`);
  const other = privateKeyToAccount(generatePrivateKey());
  const taken = await signedUpsert(switchboard, other, { handle: handle.toUpperCase() });
  check(taken.errors?.[0]?.extensions?.code === "HANDLE_TAKEN", `expected HANDLE_TAKEN, got ${JSON.stringify(taken.errors ?? taken.data)}`);
  step("validation", "INVALID_AVATAR and HANDLE_TAKEN as expected");

  // 6. Public media and pages.
  const media = await fetch(`${switchboard}${PACKAGE}/media/${documentId}/avatar`, { redirect: "manual" });
  check(media.status === 302, `media route -> HTTP ${media.status}`);
  check(media.headers.get("cache-control") === "public, max-age=60, stale-while-revalidate=240", `media cache-control ${media.headers.get("cache-control")}`);
  const image = await fetch(media.headers.get("location") ?? "");
  const bytes = new Uint8Array(await image.arrayBuffer());
  check(image.ok && sha256(bytes) === sha256(png), `media target -> HTTP ${image.status}, sha256 ${sha256(bytes)}`);
  step("media", "302 → image bytes match");

  const appMedia = await fetch(`${app}/media/${documentId}/avatar`, { redirect: "manual" });
  check(appMedia.status === 302, `${app}/media -> HTTP ${appMedia.status}`);
  const page = await fetch(`${app}/@${handle}`);
  check(page.ok && (await page.text()).includes("Smoke Test"), `${app}/@${handle} -> HTTP ${page.status}`);
  const legacy = await fetch(`${app}/profile/${documentId}`, { redirect: "manual" });
  check(legacy.status === 307 && legacy.headers.get("location")?.endsWith(`/@${handle}`), `${app}/profile/<doc> -> HTTP ${legacy.status} ${legacy.headers.get("location")}`);
  step("renown.id", "/media 302, /@handle 200, /profile/<doc> → /@handle");

  // 7. Release the handle and avatar.
  data(await signedUpsert(switchboard, account, { handle: "", avatar: "" }), "cleanup upsert");
  step("cleanup", "handle and avatar cleared");

  console.log("");
  console.log(`address: ${account.address}`);
  console.log(`profile: ${documentId}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[smoke] FAILED: ${message}`);
  process.exit(1);
});
```

```bash
git apply <<'PLAN_EOF'
diff --git a/scripts/smoke/README.md b/scripts/smoke/README.md
--- a/scripts/smoke/README.md
+++ b/scripts/smoke/README.md
@@ -46,3 +46,40 @@ What it does:
 Prints only the wallet address, the did, and the ref — never private keys,
 bearer tokens or presigned URLs. Exits 1 with the server's response on any
 failure.
+
+Against a switchboard with renown-package ≥ identity hub phase 1, pass the
+gated route: `--reserve-path /api/@powerhousedao/renown-package/media/uploads`
+(it accepts this script's reservation body; a status `GET <reserve-path>/:id`
+is informational and may 404).
+
+## identity-profile.ts
+
+End-to-end check of profile identity (identity hub phase 1) on a switchboard
+and the renown.id app in front of it:
+
+```sh
+node scripts/smoke/identity-profile.ts                                   # Renown staging
+node scripts/smoke/identity-profile.ts --switchboard <url> --app <url>   # another staging/local stack
+node scripts/smoke/identity-profile.ts --switchboard https://switchboard.renown.vetra.io \
+  --app https://www.renown.id --allow-prod                               # production
+```
+
+Same guard and cleanup as attachment-upload.ts: non-staging switchboards
+need `--allow-prod`; the throwaway credential is revoked at the end (also on
+failure). With a throwaway wallet it:
+
+1. Issues a credential and mints a bearer.
+2. Checks the gated upload route (`POST /api/@powerhousedao/renown-package/media/uploads`)
+   refuses no bearer (401), SVG (415) and 3 MB (413), and that storage refuses
+   a PUT whose length differs from the declared size.
+3. Uploads a PNG avatar, saves display name, a fresh `smoke-xxxxxx` handle,
+   bio, a link and the avatar with one signed `renown_upsertProfile`, and waits
+   for `renownUser(input: { handle })`.
+4. Checks `INVALID_AVATAR` (a ref never uploaded) and `HANDLE_TAKEN` (a second
+   wallet, different case).
+5. Follows the switchboard media route (302 + cache policy) to the image and
+   compares its sha256; checks renown.id `/media/<doc>/avatar` (302),
+   `/@<handle>` (200) and `/profile/<doc>` (307 → `/@<handle>`).
+6. Clears the handle and avatar, then revokes the credential.
+
+Prints only the wallet address and the profile document id.
PLAN_EOF
```

- [ ] **Step 2: Check it offline.** `pnpm tsc` and `pnpm lint` → no errors. `node scripts/smoke/identity-profile.ts --help` → prints the usage line. `node scripts/smoke/identity-profile.ts --switchboard https://switchboard.renown.vetra.io; echo $?` → `[smoke] FAILED: https://switchboard.renown.vetra.io is not a staging switchboard; pass --allow-prod to run against it` and `1`. (It runs for real in Task 12.)

- [ ] **Step 3: Commit.**

```bash
git add scripts/smoke/identity-profile.ts scripts/smoke/README.md
git commit -m "chore(smoke): end-to-end profile identity smoke script"
```

## Part B — renown.id

### Task 7: Signed identity writes through `/api/profile/update`

**Files:**
- Modify: `services/renown-signed-messages.ts`, `services/renown-credential.ts`, `e2e/support/stub-switchboard-client.ts` (`graphqlError` extensions), `e2e/renown-signed-messages.spec.ts`, `e2e/renown-writes.spec.ts`
- Replace: `services/renown-profile-write.ts`, `pages/api/profile/update.ts`

**Interfaces:**
- Consumes: Task 5 mutation signature, error codes, message vectors.
- Produces: `profilePayload`, `profileMessage(address, fields: ProfileFields, timestamp)`, `ProfileFields`, `ProfileLink` (verbatim copy); `upsertProfile(fields & {address, signature, timestamp})`; `CredentialWriteError(status, message, code?, field?)`; `STATUS_BY_CODE` adds `HANDLE_TAKEN: 409`, `INVALID_AVATAR: 400`, `SERVICE_UNAVAILABLE: 503`; `POST /api/profile/update` accepts `displayName, handle, bio, links, avatar` and answers errors as `{ error, code, field }`; identity fields on a switchboard without `renown_*` → `501 UNSUPPORTED` (no legacy write).

- [ ] **Step 1: Write the failing tests.**

```bash
git apply <<'PLAN_EOF'
diff --git a/e2e/support/stub-switchboard-client.ts b/e2e/support/stub-switchboard-client.ts
--- a/e2e/support/stub-switchboard-client.ts
+++ b/e2e/support/stub-switchboard-client.ts
@@ -38,6 +38,6 @@ export async function stubRequests(match: string): Promise<RecordedRequest[]> {
 }
 
 /** A GraphQL error response as the switchboard sends it. */
-export function graphqlError(message: string, code?: string): unknown {
-  return { data: null, errors: [{ message, ...(code ? { extensions: { code } } : {}) }] }
+export function graphqlError(message: string, code?: string, extra: Record<string, unknown> = {}): unknown {
+  return { data: null, errors: [{ message, ...(code ? { extensions: { code, ...extra } } : {}) }] }
 }
diff --git a/e2e/renown-writes.spec.ts b/e2e/renown-writes.spec.ts
--- a/e2e/renown-writes.spec.ts
+++ b/e2e/renown-writes.spec.ts
@@ -1,7 +1,7 @@
 import { test, expect } from '@playwright/test'
 import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
 import { verifyMessage } from 'viem'
-import { profileMessage, revokeMessage } from '../services/renown-signed-messages'
+import { profileMessage, revokeMessage, type ProfileFields } from '../services/renown-signed-messages'
 import { installInjectedWallet, type InjectedWallet } from './support/injected-wallet'
 import { graphqlError, resetStub, scriptStub, stubRequests } from './support/stub-switchboard-client'
 
@@ -289,7 +289,7 @@ test.describe('POST /api/credential/renown', () => {
 })
 
 async function signedProfile(
-  profile: { username: string; userImage: string | null },
+  profile: ProfileFields,
   key = generatePrivateKey(),
 ) {
   const account = privateKeyToAccount(key)
@@ -351,6 +351,55 @@ test.describe('POST /api/profile/update', () => {
     })
   }
 
+  test('forwards the identity fields exactly as signed', async ({ request }) => {
+    const fields = {
+      displayName: 'Frank',
+      handle: 'frank',
+      bio: 'Hi',
+      links: [{ id: 'l1', label: 'Site', url: 'https://frank.example' }],
+      avatar: `attachment://v1:${'a'.repeat(64)}`,
+    }
+    const body = await signedProfile(fields)
+    await scriptStub({ match: 'renown_upsertProfile', variables: body.address, response: { data: { renown_upsertProfile: 'doc-id' } } })
+
+    const response = await request.post('/api/profile/update', { data: body })
+    expect(response.status()).toBe(200)
+    const call = (await stubRequests('renown_upsertProfile')).find((c) => c.variables.address === body.address)
+    expect(call?.variables).toEqual({ address: body.address, username: null, userImage: null, ...fields, signature: body.signature, timestamp: body.timestamp })
+  })
+
+  test('relays HANDLE_TAKEN as 409 naming the field', async ({ request }) => {
+    const body = await signedProfile({ handle: 'taken' })
+    await scriptStub({
+      match: 'renown_upsertProfile',
+      variables: body.address,
+      response: graphqlError('The handle "taken" is taken', 'HANDLE_TAKEN', { field: 'handle' }),
+    })
+    const response = await request.post('/api/profile/update', { data: body })
+    expect(response.status()).toBe(409)
+    expect(await response.json()).toMatchObject({ code: 'HANDLE_TAKEN', field: 'handle' })
+  })
+
+  test('relays INVALID_AVATAR as 400 naming the field', async ({ request }) => {
+    const body = await signedProfile({ avatar: `attachment://v1:${'b'.repeat(64)}` })
+    await scriptStub({
+      match: 'renown_upsertProfile',
+      variables: body.address,
+      response: graphqlError('Invalid avatar: not uploaded', 'INVALID_AVATAR', { field: 'avatar' }),
+    })
+    const response = await request.post('/api/profile/update', { data: body })
+    expect(response.status()).toBe(400)
+    expect(await response.json()).toMatchObject({ code: 'INVALID_AVATAR', field: 'avatar' })
+  })
+
+  test('refuses identity fields on a switchboard without renown_* mutations', async ({ request }) => {
+    const body = await signedProfile({ handle: 'frank' })
+    await scriptStub({ match: 'renown_upsertProfile', variables: body.address, response: graphqlError(UNKNOWN_UPSERT) })
+    const response = await request.post('/api/profile/update', { data: body })
+    expect(response.status()).toBe(501)
+    expect(await stubRequests('mutateDocument')).toHaveLength(0)
+  })
+
   test('falls back to the legacy profile write on a switchboard without renown_* mutations', async ({ request }) => {
     const body = await signedProfile({ username: 'frank.eth', userImage: null })
     const documentId = uniqueId('doc-profile-legacy')
PLAN_EOF
```

```bash
git apply <<'PLAN_EOF'
diff --git a/e2e/renown-signed-messages.spec.ts b/e2e/renown-signed-messages.spec.ts
--- a/e2e/renown-signed-messages.spec.ts
+++ b/e2e/renown-signed-messages.spec.ts
@@ -37,4 +37,31 @@ test.describe('Renown signed messages', () => {
       'Update Renown profile 0xabc0000000000000000000000000000000000001 cad71ba7aa480cb0c72fd95c95cdcb63bfcc85666e5f66358e1f3f6221b0deb6 at 2026-09-28T12:00:00.000Z',
     )
   })
+
+  test('profile message keeps the legacy payload until an identity field is present', async () => {
+    expect(await profileMessage('0xABC0000000000000000000000000000000000001', { username: 'frank', handle: null }, 't')).toBe(
+      'Update Renown profile 0xabc0000000000000000000000000000000000001 e586dca7432283bd3bc606f7650606a0407f43f27843c738a82b9146603e6130 at t',
+    )
+  })
+
+  test('profile message hashes all identity fields in a fixed order', async () => {
+    expect(
+      await profileMessage(
+        '0xABC0000000000000000000000000000000000001',
+        {
+          displayName: 'Frank',
+          handle: 'frank',
+          bio: 'Hi',
+          links: [{ id: 'l1', label: 'Site', url: 'https://frank.example' }],
+          avatar: `attachment://v1:${'a'.repeat(64)}`,
+        },
+        '2026-10-09T12:00:00.000Z',
+      ),
+    ).toBe(
+      'Update Renown profile 0xabc0000000000000000000000000000000000001 4580e73ddd79972b5dd50d52aae493f1caed7a4025ec04ad402fd54c4a86ff55 at 2026-10-09T12:00:00.000Z',
+    )
+    expect(await profileMessage('0xABC0000000000000000000000000000000000001', { links: [] }, '2026-10-09T12:00:00.000Z')).toBe(
+      'Update Renown profile 0xabc0000000000000000000000000000000000001 2de3522753823feab751ee8b58c4684f30d285ddfbf1dcae520db06c7772a629 at 2026-10-09T12:00:00.000Z',
+    )
+  })
 })
PLAN_EOF
```

- [ ] **Step 2: Run them to see them fail.** `pnpm exec playwright test e2e/renown-signed-messages.spec.ts e2e/renown-writes.spec.ts -g "profile"` → FAIL (identity vector mismatch; the forwarded variables lack the identity fields; HANDLE_TAKEN relayed as 500).

- [ ] **Step 3: Implement.**

```bash
git apply <<'PLAN_EOF'
diff --git a/services/renown-signed-messages.ts b/services/renown-signed-messages.ts
--- a/services/renown-signed-messages.ts
+++ b/services/renown-signed-messages.ts
@@ -24,6 +24,47 @@ export function revokeMessage(credentialId: string, timestamp: string): string {
   return `Revoke Renown credential ${credentialId} at ${timestamp}`;
 }
 
+/** A profile link as signed and stored. */
+export interface ProfileLink {
+  id: string;
+  label: string;
+  url: string;
+}
+
+/** Every field a signed profile upsert may carry. Absent and null mean "unchanged". */
+export interface ProfileFields {
+  username?: string | null;
+  userImage?: string | null;
+  displayName?: string | null;
+  handle?: string | null;
+  bio?: string | null;
+  links?: readonly ProfileLink[] | null;
+  avatar?: string | null;
+}
+
+/**
+ * The JSON a profile signature hashes. Legacy writes (username/userImage
+ * only) keep the exact two-key payload older clients sign. As soon as any
+ * identity field is present, all seven keys are hashed in this fixed order,
+ * and each link is reduced to `{id, label, url}` in that key order, so the
+ * client and the server serialize the same bytes.
+ */
+export function profilePayload(profile: ProfileFields): string {
+  const legacy = { username: profile.username ?? null, userImage: profile.userImage ?? null };
+  const identity = [profile.displayName, profile.handle, profile.bio, profile.links, profile.avatar];
+  if (identity.every((value) => value === undefined || value === null)) {
+    return JSON.stringify(legacy);
+  }
+  return JSON.stringify({
+    ...legacy,
+    displayName: profile.displayName ?? null,
+    handle: profile.handle ?? null,
+    bio: profile.bio ?? null,
+    links: profile.links ? profile.links.map(({ id, label, url }) => ({ id, label, url })) : null,
+    avatar: profile.avatar ?? null,
+  });
+}
+
 /**
  * Canonical message a caller signs to authorize a profile upsert. The payload
  * is hashed (rather than embedded raw) so the signed message has a fixed
@@ -31,14 +72,10 @@ export function revokeMessage(credentialId: string, timestamp: string): string {
  */
 export async function profileMessage(
   address: string,
-  profile: { username?: string | null; userImage?: string | null },
+  profile: ProfileFields,
   timestamp: string,
 ): Promise<string> {
-  const payload = JSON.stringify({
-    username: profile.username ?? null,
-    userImage: profile.userImage ?? null,
-  });
-  const hash = await sha256hex(payload);
+  const hash = await sha256hex(profilePayload(profile));
   return `Update Renown profile ${address.toLowerCase()} ${hash} at ${timestamp}`;
 }
 
diff --git a/services/renown-credential.ts b/services/renown-credential.ts
--- a/services/renown-credential.ts
+++ b/services/renown-credential.ts
@@ -79,6 +79,8 @@ export class CredentialWriteError extends Error {
     readonly status: number,
     message: string,
     readonly code?: string,
+    /** The profile field a validation error is about, for inline form errors. */
+    readonly field?: string,
   ) {
     super(message)
     this.name = 'CredentialWriteError'
@@ -89,12 +91,17 @@ const STATUS_BY_CODE: Record<string, number> = {
   BAD_USER_INPUT: 400,
   FORBIDDEN: 403,
   NOT_FOUND: 404,
+  HANDLE_TAKEN: 409,
+  INVALID_AVATAR: 400,
   RATE_LIMITED: 429,
+  SERVICE_UNAVAILABLE: 503,
 }
 
-function graphqlErrors(error: unknown): { message: string; extensions?: { code?: unknown } }[] {
+type GraphqlError = { message: string; extensions?: { code?: unknown; field?: unknown } }
+
+function graphqlErrors(error: unknown): GraphqlError[] {
   if (!(error instanceof ClientError)) return []
-  return (error.response.errors ?? []) as { message: string; extensions?: { code?: unknown } }[]
+  return (error.response.errors ?? []) as GraphqlError[]
 }
 
 /**
@@ -147,7 +154,8 @@ export function toWriteError(error: unknown, fallbackMessage: string): Credentia
   const [first] = graphqlErrors(error)
   if (first) {
     const code = typeof first.extensions?.code === 'string' ? first.extensions.code : undefined
-    return new CredentialWriteError((code && STATUS_BY_CODE[code]) || 500, first.message, code)
+    const field = typeof first.extensions?.field === 'string' ? first.extensions.field : undefined
+    return new CredentialWriteError((code && STATUS_BY_CODE[code]) || 500, first.message, code, field)
   }
   return new CredentialWriteError(500, `${fallbackMessage}: ${String(error)}`)
 }
PLAN_EOF
```

Replace the whole of `services/renown-profile-write.ts` with exactly:

```ts
// Profile writes through the switchboard's self-authenticating
// renown_upsertProfile mutation, authorized by the address's personal_sign of
// profileMessage(). Like the credential writes, no request carries an
// Authorization header, and a switchboard without the renown_* schema falls
// back to the legacy document writes with the signature checked here.
import { gql } from 'graphql-request'
import {
  CredentialWriteError,
  assertSignedBy,
  client,
  isUnknownSchemaError,
  toWriteError,
} from './renown-credential'
import { legacyUpsertProfile } from './renown-credential-legacy'
import { profileMessage, type ProfileFields } from './renown-signed-messages'

const UPSERT_PROFILE = gql`
  mutation UpsertProfile(
    $address: String!
    $username: String
    $userImage: String
    $displayName: String
    $handle: String
    $bio: String
    $links: [RenownProfileLinkInput!]
    $avatar: String
    $signature: String
    $timestamp: String
  ) {
    renown_upsertProfile(
      address: $address
      username: $username
      userImage: $userImage
      displayName: $displayName
      handle: $handle
      bio: $bio
      links: $links
      avatar: $avatar
      signature: $signature
      timestamp: $timestamp
    )
  }
`

const IDENTITY_FIELDS = ['displayName', 'handle', 'bio', 'links', 'avatar'] as const

/**
 * Create or update `address`'s profile; returns its document id. Identity
 * fields left undefined are not sent at all (JSON drops them), so the
 * switchboard sees exactly what was signed.
 * @throws {CredentialWriteError} when the switchboard refuses or fails the write.
 */
export async function upsertProfile(
  params: ProfileFields & { address: string; signature: string; timestamp: string },
): Promise<string> {
  const { address, signature, timestamp } = params
  const username = params.username ?? null
  const userImage = params.userImage ?? null

  let documentId: string | null
  try {
    const data = await client().request<{ renown_upsertProfile: string | null }>(UPSERT_PROFILE, {
      address,
      username,
      userImage,
      displayName: params.displayName,
      handle: params.handle,
      bio: params.bio,
      links: params.links,
      avatar: params.avatar,
      signature,
      timestamp,
    })
    documentId = data.renown_upsertProfile
  } catch (error) {
    if (!isUnknownSchemaError(error)) throw toWriteError(error, 'Failed to update profile')
    // The legacy document writes predate the identity fields.
    if (IDENTITY_FIELDS.some((field) => params[field] != null)) {
      throw new CredentialWriteError(
        501,
        'This Renown switchboard does not support profile identity fields yet',
        'UNSUPPORTED',
      )
    }
    await assertSignedBy(
      address,
      await profileMessage(address, { username, userImage }, timestamp),
      signature,
      timestamp,
    )
    return legacyUpsertProfile({ ethAddress: address.toLowerCase(), username, userImage })
  }
  if (!documentId) throw new CredentialWriteError(500, 'Failed to update profile')
  return documentId
}
```

Replace the whole of `pages/api/profile/update.ts` with exactly:

```ts
// Profile write, forwarded to the switchboard's self-authenticating
// renown_upsertProfile (see services/renown-profile-write.ts).
import { NextApiRequest, NextApiResponse } from 'next/types'
import { allowCors } from '../../../utils/allow-cors'
import { CredentialWriteError } from '../../../services/renown-credential'
import { upsertProfile } from '../../../services/renown-profile-write'
import type { ProfileFields } from '../../../services/renown-signed-messages'

type Body = ProfileFields & { address?: string; signature?: string; timestamp?: string }

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = (req.body ?? {}) as Body
  const { address, signature, timestamp } = body

  if (!address) {
    res.status(400).json({ error: 'address is required' })
    return
  }
  if (!signature || !timestamp) {
    res.status(401).json({ error: 'A signature and timestamp are required to update a profile' })
    return
  }

  try {
    const documentId = await upsertProfile({
      address,
      username: body.username,
      userImage: body.userImage,
      displayName: body.displayName,
      handle: body.handle,
      bio: body.bio,
      links: body.links,
      avatar: body.avatar,
      signature,
      timestamp,
    })
    res.status(200).json({ result: true, documentId })
  } catch (e) {
    if (e instanceof CredentialWriteError) {
      res.status(e.status).json({ error: e.message, code: e.code, field: e.field })
      return
    }
    console.error('Failed to update profile:', e)
    res.status(500).json({ error: 'Failed to update profile', details: String(e) })
  }
}

export default allowCors(handler)
```

- [ ] **Step 4: Run.** `pnpm exec playwright test e2e/renown-signed-messages.spec.ts e2e/renown-writes.spec.ts` → PASS. `pnpm exec tsc --noEmit -p .`, `pnpm lint` → clean.

- [ ] **Step 5: Commit.**

```bash
git add services/renown-signed-messages.ts services/renown-credential.ts services/renown-profile-write.ts pages/api/profile/update.ts e2e/support/stub-switchboard-client.ts e2e/renown-signed-messages.spec.ts e2e/renown-writes.spec.ts
git commit -m "feat(profile): forward signed identity fields and relay field errors"
```

### Task 8: Public profile — `/@handle`, `/media/…`, OG meta

**Files:**
- Create: `services/media.ts`, `pages/api/media/[documentId]/[field].ts`, `utils/identicon.ts`, `utils/ens.ts`, `utils/profile-url.ts`, `components/profile/identicon.tsx`, `components/profile/profile-avatar.tsx`, `components/profile/profile-links.tsx`, `components/profile/copy-address.tsx`, `components/profile/profile-summary.tsx`, `components/profile/own-profile-actions.tsx`
- Replace: `services/switchboard.ts`, `pages/profile/[id].tsx`
- Modify: `next.config.ts` (rewrites), `e2e/support/stub-switchboard.mjs` (package routes, fake S3, fixtures), `e2e/support/stub-switchboard-client.ts` (`fixtureStub`)
- Test: `e2e/profile-pages.spec.ts`

**Interfaces:**
- Consumes: Task 3 GraphQL fields and `handles` lookup; Task 4 media route contract.
- Produces: `mediaUrl(documentId, field, origin = "")`, `packageRoutesBase()`, `switchboardOrigin()`, `isMediaField()`, `MEDIA_FIELDS` (`services/media.ts`); `RenownProfile` with `displayName, handle, bio, links, avatar`; `getProfile({…, handle})`; `getHandleAvailability(handle, address?) → HandleAvailability`; `profilePath(profile)`; `<ProfileAvatar>` (preview → `/media/<doc>/avatar` → `userImage` → identicon, falling through on load errors; plain `<img>` because `/media` 302s to S3, which `next/image` would need allowlisted); `<ProfileSummary profile={…}>` (also the editor preview in Task 10); `profileName()`, `shortAddress()`; rewrites `/media/:documentId/:field → /api/media/:documentId/:field` and `/@:handle → /profile/:handle?by=handle`; stub `fixtureStub(entry)`.

- [ ] **Step 1: Teach the stub switchboard the package routes and fixtures.**

```bash
git apply <<'PLAN_EOF'
diff --git a/e2e/support/stub-switchboard-client.ts b/e2e/support/stub-switchboard-client.ts
--- a/e2e/support/stub-switchboard-client.ts
+++ b/e2e/support/stub-switchboard-client.ts
@@ -30,6 +30,18 @@ export async function scriptStub(entry: ScriptEntry): Promise<void> {
   })
 }
 
+/**
+ * A standing answer for every matching request; survives resetStub(). For
+ * specs outside renown-writes.spec.ts — use variables no other test uses.
+ */
+export async function fixtureStub(entry: ScriptEntry): Promise<void> {
+  await fetch(`${STUB_SWITCHBOARD_URL}/__stub/fixture`, {
+    method: 'POST',
+    headers: { 'Content-Type': 'application/json' },
+    body: JSON.stringify(entry),
+  })
+}
+
 /** Recorded requests whose query contains `match`. */
 export async function stubRequests(match: string): Promise<RecordedRequest[]> {
   const res = await fetch(`${STUB_SWITCHBOARD_URL}/__stub/requests`)
PLAN_EOF
```

```bash
git apply <<'PLAN_EOF'
diff --git a/e2e/support/stub-switchboard.mjs b/e2e/support/stub-switchboard.mjs
--- a/e2e/support/stub-switchboard.mjs
+++ b/e2e/support/stub-switchboard.mjs
@@ -10,15 +10,38 @@
 //                            answered with `response`; one use per entry
 //   GET  /__stub/requests    every recorded GraphQL request
 //   POST /__stub/reset       clears script and recordings
+//   POST /__stub/fixture     { match, variables?, response } — answers every
+//                            matching GraphQL request (after the script), and
+//                            survives /__stub/reset; for specs that run in
+//                            parallel with the scripting ones (unique variables!)
+//
+// renown-package HTTP routes (stateless, safe in parallel):
+//   POST /api/@powerhousedao/renown-package/media/uploads   401 without a
+//        bearer; else 201 with an uploadTarget on this stub
+//   PUT  /__stub/s3/<sha256>   stores the bytes (checks the hash)
+//   GET  /__stub/s3/<sha256>   serves them
+//   GET  /api/@powerhousedao/renown-package/media/<doc>/<field>   302 to
+//        /__stub/s3/<STUB_AVATAR_SHA> for doc "stub-avatar-doc" + "avatar", else 404
 //
 // Unscripted requests get empty read-model results, so pages rendered by other
 // specs keep working.
+import { createHash } from 'node:crypto'
 import http from 'node:http'
 
 const port = Number(process.env.STUB_SWITCHBOARD_PORT || 4799)
 
 let script = []
 let requests = []
+const fixtures = []
+const objects = new Map()
+const PACKAGE = '/api/@powerhousedao/renown-package'
+// sha256 of the 1x1 PNG below, served for doc "stub-avatar-doc".
+const STUB_PNG = Buffer.from(
+  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
+  'base64',
+)
+const STUB_AVATAR_SHA = createHash('sha256').update(STUB_PNG).digest('hex')
+objects.set(STUB_AVATAR_SHA, { type: 'image/png', bytes: STUB_PNG })
 
 const DEFAULT_DATA = {
   renownUsers: [],
@@ -31,11 +54,65 @@ function send(res, status, body) {
     'Content-Type': 'application/json',
     'Access-Control-Allow-Origin': '*',
     'Access-Control-Allow-Headers': '*',
-    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
+    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
   })
   res.end(JSON.stringify(body))
 }
 
+function readRaw(req) {
+  return new Promise((resolve, reject) => {
+    const chunks = []
+    req.on('data', (chunk) => chunks.push(chunk))
+    req.on('end', () => resolve(Buffer.concat(chunks)))
+    req.on('error', reject)
+  })
+}
+
+async function packageRoute(req, res) {
+  const url = new URL(req.url, 'http://stub')
+  if (url.pathname === `${PACKAGE}/media/uploads` && req.method === 'POST') {
+    if (!/^Bearer \S+/.test(req.headers.authorization ?? '')) {
+      return send(res, 401, { code: 'UNAUTHENTICATED', error: 'A Renown bearer token is required' })
+    }
+    const body = JSON.parse((await readRaw(req)).toString() || '{}')
+    return send(res, 201, {
+      ref: `attachment://v1:${body.sha256}`,
+      reservationId: `res-${body.sha256.slice(0, 8)}`,
+      expiresAtUtc: new Date(Date.now() + 900_000).toISOString(),
+      uploadTarget: {
+        method: 'PUT',
+        url: `http://localhost:${port}/__stub/s3/${body.sha256}`,
+        headers: { 'content-type': body.mimeType },
+      },
+    })
+  }
+  const media = /^\/api\/@powerhousedao\/renown-package\/media\/([^/]+)\/([^/]+)$/.exec(url.pathname)
+  if (media && req.method === 'GET') {
+    if (media[1] === 'stub-avatar-doc' && media[2] === 'avatar') {
+      res.writeHead(302, {
+        Location: `http://localhost:${port}/__stub/s3/${STUB_AVATAR_SHA}`,
+        'Cache-Control': 'public, max-age=60, stale-while-revalidate=240',
+      })
+      return res.end()
+    }
+    return send(res, 404, { error: 'Not found' })
+  }
+  const object = /^\/__stub\/s3\/([0-9a-f]{64})$/.exec(url.pathname)
+  if (object && req.method === 'PUT') {
+    const bytes = await readRaw(req)
+    if (createHash('sha256').update(bytes).digest('hex') !== object[1]) return send(res, 400, { error: 'BadDigest' })
+    objects.set(object[1], { type: req.headers['content-type'] ?? 'application/octet-stream', bytes })
+    return send(res, 200, {})
+  }
+  if (object && req.method === 'GET') {
+    const stored = objects.get(object[1])
+    if (!stored) return send(res, 404, { error: 'NoSuchKey' })
+    res.writeHead(200, { 'Content-Type': stored.type, 'Access-Control-Allow-Origin': '*' })
+    return res.end(stored.bytes)
+  }
+  return false
+}
+
 function readBody(req) {
   return new Promise((resolve, reject) => {
     let raw = ''
@@ -63,6 +140,14 @@ const server = http.createServer(async (req, res) => {
       script.push(await readBody(req))
       return send(res, 200, { ok: true })
     }
+    if (req.url === '/__stub/fixture' && req.method === 'POST') {
+      fixtures.push(await readBody(req))
+      return send(res, 200, { ok: true })
+    }
+    if (req.url?.startsWith(PACKAGE) || req.url?.startsWith('/__stub/s3/')) {
+      const handled = await packageRoute(req, res)
+      if (handled !== false) return
+    }
     if (req.url === '/__stub/requests' && req.method === 'GET') {
       return send(res, 200, requests)
     }
@@ -78,6 +163,10 @@ const server = http.createServer(async (req, res) => {
         const [entry] = script.splice(index, 1)
         return send(res, entry.status ?? 200, entry.response)
       }
+      const fixture = fixtures.find(
+        (entry) => query.includes(entry.match) && (!entry.variables || variables.includes(entry.variables)),
+      )
+      if (fixture) return send(res, fixture.status ?? 200, fixture.response)
       return send(res, 200, { data: DEFAULT_DATA })
     }
     if (req.method === 'GET') return send(res, 200, { ok: true })
PLAN_EOF
```

- [ ] **Step 2: Write the failing spec.**

Create `e2e/profile-pages.spec.ts` with exactly:

```ts
import { test, expect } from '@playwright/test'
import { identicon } from '../utils/identicon'
import { fixtureStub, STUB_SWITCHBOARD_URL } from './support/stub-switchboard-client'

// Public profile pages and media URLs, server-rendered against the stub
// switchboard. Uses fixtures with ids no other spec uses (fixtures survive
// the resets renown-writes.spec.ts does), so it runs in parallel.
const ADDRESS = '0x5e00000000000000000000000000000000000001'
const PROFILE = {
  documentId: 'doc-pages-1',
  username: 'pages-user',
  ethAddress: ADDRESS,
  userImage: null,
  displayName: 'Pat Pages',
  handle: 'pat-pages',
  bio: 'Line one\nLine two',
  links: [
    { id: 'l1', label: 'Site', url: 'https://pat.example' },
    { id: 'l2', label: 'Bad', url: 'javascript:alert(1)' },
  ],
  avatar: `attachment://v1:${'f'.repeat(64)}`,
  createdAt: '2026-01-15T10:00:00.000Z',
  updatedAt: '2026-10-09T10:00:00.000Z',
}
const NO_HANDLE = { ...PROFILE, documentId: 'doc-pages-2', handle: null, avatar: null, displayName: null, username: 'plain-user', ethAddress: '0x5e00000000000000000000000000000000000002' }

test.beforeAll(async () => {
  const users = (profile: unknown) => ({ data: { renownUsers: [profile] } })
  await fixtureStub({ match: 'renownUsers', variables: '"pat-pages"', response: users(PROFILE) })
  await fixtureStub({ match: 'renownUsers', variables: '"doc-pages-1"', response: users(PROFILE) })
  await fixtureStub({ match: 'renownUsers', variables: ADDRESS, response: users(PROFILE) })
  await fixtureStub({ match: 'renownUsers', variables: '"doc-pages-2"', response: users(NO_HANDLE) })
})

test.describe('public profile', () => {
  test('/@handle renders the identity, safe links only, and link-preview meta', async ({ page }) => {
    const response = await page.goto('/@pat-pages')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'Pat Pages' })).toBeVisible()
    await expect(page.getByText('@pat-pages')).toBeVisible()
    await expect(page.getByText('Line one')).toBeVisible()
    await expect(page.getByRole('link', { name: /Site/ })).toHaveAttribute('href', 'https://pat.example')
    await expect(page.getByRole('link', { name: /Bad/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Copy address' })).toContainText(ADDRESS)
    await expect(page.locator('img[alt="Pat Pages"]').first()).toHaveAttribute('src', '/media/doc-pages-1/avatar')
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', 'Pat Pages (@pat-pages)')
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/media\/doc-pages-1\/avatar$/)
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', /\/@pat-pages$/)
  })

  test('document-id and address URLs redirect to /@handle', async ({ request }) => {
    for (const path of ['/profile/doc-pages-1', `/profile/${ADDRESS}`, '/@PAT-PAGES']) {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status(), path).toBe(307)
      expect(response.headers().location).toBe('/@pat-pages')
    }
  })

  test('a profile without a handle stays on its document URL with a generated avatar', async ({ page }) => {
    const response = await page.goto('/profile/doc-pages-2')
    expect(response?.status()).toBe(200)
    await expect(page.getByRole('heading', { name: 'plain-user' })).toBeVisible()
    await expect(page.getByRole('img', { name: 'Generated avatar' })).toBeVisible()
    await expect(page.locator('meta[property="og:image"]')).toHaveCount(0)
  })

  test('an unknown handle is a 404 page', async ({ page }) => {
    const response = await page.goto('/@nobody-here-404')
    expect(response?.status()).toBe(404)
    await expect(page.getByRole('heading', { name: 'Profile not found' })).toBeVisible()
  })
})

test.describe('/media', () => {
  test('redirects a set avatar to the signed storage URL with the public cache policy', async ({ request }) => {
    const response = await request.get('/media/stub-avatar-doc/avatar', { maxRedirects: 0 })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toMatch(new RegExp(`^${STUB_SWITCHBOARD_URL}/__stub/s3/[0-9a-f]{64}$`))
    expect(response.headers()['cache-control']).toBe('public, max-age=60, stale-while-revalidate=240')
    const image = await request.get('/media/stub-avatar-doc/avatar')
    expect(image.status()).toBe(200)
    expect(image.headers()['content-type']).toBe('image/png')
  })

  for (const [label, path] of [
    ['an unset avatar', '/media/doc-without-avatar/avatar'],
    ['an unknown field', '/media/stub-avatar-doc/cover'],
    ['a malformed document id', '/media/bad%20id/avatar'],
  ]) {
    test(`404s for ${label}`, async ({ request }) => {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.status()).toBe(404)
      expect(response.headers()['cache-control']).toBe('public, max-age=60')
    })
  }
})

test('identicons are deterministic per address and mirrored', () => {
  const a = identicon('0xAbC0000000000000000000000000000000000001')
  expect(identicon('0xabc0000000000000000000000000000000000001')).toEqual(a)
  expect(identicon('0xabc0000000000000000000000000000000000002')).not.toEqual(a)
  for (let row = 0; row < 5; row++) {
    expect(a.cells[row * 5]).toBe(a.cells[row * 5 + 4])
    expect(a.cells[row * 5 + 1]).toBe(a.cells[row * 5 + 3])
  }
})
```

- [ ] **Step 3: Run it to see it fail.** `pnpm exec playwright test e2e/profile-pages.spec.ts` → FAIL (`/@pat-pages` 404s: no rewrite; `/media/…` 404s; `../utils/identicon` missing).

- [ ] **Step 4: Implement.**

Create `services/media.ts` with exactly:

```ts
// Renown's public media URLs. Pages and other apps embed
// `<renown origin>/media/<documentId>/<field>`; renown.id answers it from the
// switchboard's media route (renown-package media/media-route.ts), which
// 302s to a short-lived signed URL or 404s when the field is unset.

const SWITCHBOARD_ENDPOINT =
  process.env.NEXT_PUBLIC_SWITCHBOARD_ENDPOINT || 'http://localhost:4001/graphql'

/** Package routes live under the switchboard's /api/<package name>. */
const PACKAGE_PATH = '/api/@powerhousedao/renown-package'

/** Image fields served publicly. App-profile `logo`/`cover` join in phase 2. */
export const MEDIA_FIELDS = ['avatar'] as const
export type MediaField = (typeof MEDIA_FIELDS)[number]

export function isMediaField(value: string): value is MediaField {
  return (MEDIA_FIELDS as readonly string[]).includes(value)
}

/** Origin of the switchboard, from the GraphQL endpoint (`…/graphql`). */
export function switchboardOrigin(endpoint = SWITCHBOARD_ENDPOINT): string {
  return endpoint.replace(/\/+$/, '').replace(/\/graphql$/, '')
}

/** Base URL of renown-package's HTTP routes on the switchboard. */
export function packageRoutesBase(endpoint = SWITCHBOARD_ENDPOINT): string {
  return `${switchboardOrigin(endpoint)}${PACKAGE_PATH}`
}

/** Stable, embeddable URL of a document's image (same origin, or absolute with `origin`). */
export function mediaUrl(documentId: string, field: MediaField, origin = ''): string {
  return `${origin}/media/${encodeURIComponent(documentId)}/${field}`
}
```

Create `pages/api/media/[documentId]/[field].ts` with exactly:

```ts
// GET /media/<documentId>/<field> (rewritten here by next.config.ts): asks the
// switchboard's media route and passes its answer on — a 302 to a short-lived
// signed URL, or (on a switchboard storing files on disk) the bytes. The
// redirect is cacheable for a minute; a missing image is a cacheable 404 so
// <img> falls back quickly.
import type { NextApiRequest, NextApiResponse } from 'next'
import { isMediaField, packageRoutesBase } from '../../../../services/media'

const CACHE_CONTROL = 'public, max-age=60, stale-while-revalidate=240'
const DOCUMENT_ID_RE = /^[A-Za-z0-9._:-]{1,255}$/

function notFound(res: NextApiResponse): void {
  res.setHeader('Cache-Control', 'public, max-age=60')
  res.status(404).json({ error: 'Not found' })
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const documentId = String(req.query.documentId ?? '')
  const field = String(req.query.field ?? '')
  if (!DOCUMENT_ID_RE.test(documentId) || !isMediaField(field)) return notFound(res)

  let upstream: Response
  try {
    upstream = await fetch(
      `${packageRoutesBase()}/media/${encodeURIComponent(documentId)}/${field}`,
      { redirect: 'manual' },
    )
  } catch (error) {
    console.error('Media lookup failed:', error)
    res.status(502).json({ error: 'Media unavailable' })
    return
  }

  const location = upstream.headers.get('location')
  if (upstream.status === 302 && location) {
    res.setHeader('Cache-Control', CACHE_CONTROL)
    res.redirect(302, location)
    return
  }
  if (upstream.status === 200) {
    res.setHeader('Cache-Control', CACHE_CONTROL)
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.status(200).send(Buffer.from(await upstream.arrayBuffer()))
    return
  }
  notFound(res)
}
```

```bash
git apply <<'PLAN_EOF'
diff --git a/next.config.ts b/next.config.ts
--- a/next.config.ts
+++ b/next.config.ts
@@ -24,6 +24,14 @@ const nextConfig: NextConfig = {
         ];
         return config;
     },
+    async rewrites() {
+        return [
+            // Stable public image URLs (pages/api/media/[documentId]/[field].ts).
+            { source: "/media/:documentId/:field", destination: "/api/media/:documentId/:field" },
+            // renown.id/@handle is the canonical profile URL.
+            { source: "/@:handle", destination: "/profile/:handle?by=handle" },
+        ];
+    },
     async headers() {
         return [
             {
PLAN_EOF
```

Replace the whole of `services/switchboard.ts` with exactly:

```ts
import { GraphQLClient } from 'graphql-request'

const SWITCHBOARD_ENDPOINT =
  process.env.NEXT_PUBLIC_SWITCHBOARD_ENDPOINT ||
  'http://localhost:4001/graphql'

const client = new GraphQLClient(SWITCHBOARD_ENDPOINT)

interface GetProfileInput {
  driveId: string
  id?: string
  username?: string
  ethAddress?: string
  handle?: string
}

export interface RenownProfileLink {
  id: string
  label: string
  url: string
}

export interface RenownProfile {
  documentId: string
  username?: string | null
  ethAddress?: string | null
  userImage?: string | null
  displayName?: string | null
  handle?: string | null
  bio?: string | null
  links?: RenownProfileLink[]
  /** attachment://v1:<sha256> of the uploaded avatar; render it via mediaUrl(). */
  avatar?: string | null
  createdAt?: string | null
  updatedAt?: string | null
}

interface RenownUsersInput {
  driveId?: string
  phids?: string[]
  ethAddresses?: string[]
  usernames?: string[]
  handles?: string[]
}

const GET_PROFILE_QUERY = `
  query RenownUsers($input: RenownUsersInput!) {
    renownUsers(input: $input) {
      documentId
      username
      ethAddress
      userImage
      displayName
      handle
      bio
      links { id label url }
      avatar
      createdAt
      updatedAt
    }
  }
`

const HANDLE_AVAILABILITY_QUERY = `
  query HandleAvailability($handle: String!, $address: String) {
    renownHandleAvailability(handle: $handle, address: $address) {
      handle
      available
      reason
    }
  }
`

export interface HandleAvailability {
  handle: string
  available: boolean
  reason: 'INVALID' | 'RESERVED' | 'TAKEN' | null
}

export async function getProfile(input: GetProfileInput): Promise<RenownProfile | null> {
  try {
    const renownUsersInput: RenownUsersInput = {
      driveId: input.driveId,
      ...(input.id && { phids: [input.id] }),
      ...(input.ethAddress && { ethAddresses: [input.ethAddress] }),
      ...(input.username && { usernames: [input.username] }),
      ...(input.handle && { handles: [input.handle] }),
    }

    const data = await client.request<{ renownUsers: RenownProfile[] }>(GET_PROFILE_QUERY, {
      input: renownUsersInput,
    })

    // Return first result or null
    return data.renownUsers.length > 0 ? data.renownUsers[0] : null
  } catch (error) {
    console.error('Failed to fetch profile from switchboard:', error)
    return null
  }
}

/** Whether `handle` can be claimed by `address` (its own handle counts as available). */
export async function getHandleAvailability(
  handle: string,
  address?: string,
): Promise<HandleAvailability> {
  const data = await client.request<{ renownHandleAvailability: HandleAvailability }>(
    HANDLE_AVAILABILITY_QUERY,
    { handle, address },
  )
  return data.renownHandleAvailability
}
```

Create `utils/identicon.ts` with exactly:

```ts
// A deterministic 5×5 mirrored identicon for profiles without any image.

export interface Identicon {
  /** HSL colour of the filled cells. */
  color: string
  /** Row-major 5×5, mirrored left↔right. */
  cells: boolean[]
}

/** FNV-1a over the lowercased seed: stable across runtimes, no crypto needed. */
function hash(seed: string): number {
  let h = 0x811c9dc5
  for (const char of seed.toLowerCase()) {
    h ^= char.codePointAt(0) ?? 0
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

export function identicon(seed: string): Identicon {
  const h = hash(seed)
  const cells: boolean[] = []
  for (let row = 0; row < 5; row++) {
    for (let col = 0; col < 5; col++) {
      const mirrored = col < 3 ? col : 4 - col
      cells.push(((h >>> (row * 3 + mirrored)) & 1) === 1)
    }
  }
  return { color: `hsl(${h % 360} 70% 55%)`, cells }
}
```

Create `utils/ens.ts` with exactly:

```ts
// Server-side ENS check behind the profile's "ENS verified" badge: the
// stored username is an ENS name that resolves to the profile's address.
import { createPublicClient, http, type PublicClient } from 'viem'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'

const TIMEOUT_MS = 2_000
const TTL_MS = 10 * 60_000
const cache = new Map<string, { verified: boolean; until: number }>()
let client: PublicClient | undefined

/** True when `name` (a .eth name) resolves to `address`. Never throws; false on any failure or timeout. */
export async function isEnsVerified(name: string | null | undefined, address: string | null | undefined): Promise<boolean> {
  if (!name || !address || !name.toLowerCase().endsWith('.eth')) return false
  const key = `${name.toLowerCase()} ${address.toLowerCase()}`
  const hit = cache.get(key)
  if (hit && hit.until > Date.now()) return hit.verified

  let verified = false
  try {
    client ??= createPublicClient({ chain: mainnet, transport: http(process.env.ENS_RPC_URL || undefined) })
    const resolved = await Promise.race([
      client.getEnsAddress({ name: normalize(name) }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS)),
    ])
    verified = !!resolved && resolved.toLowerCase() === address.toLowerCase()
  } catch {
    verified = false
  }
  cache.set(key, { verified, until: Date.now() + TTL_MS })
  return verified
}
```

Create `utils/profile-url.ts` with exactly:

```ts
/** A profile's canonical path: /@handle when it has one, else /profile/<documentId>. */
export function profilePath(profile: { handle?: string | null; documentId: string }): string {
  return profile.handle ? `/@${profile.handle}` : `/profile/${encodeURIComponent(profile.documentId)}`
}
```

Create `components/profile/identicon.tsx` with exactly:

```tsx
import { identicon } from '../../utils/identicon'

interface IdenticonProps {
  seed: string
  className?: string
}

/** Generated fallback avatar: a mirrored 5×5 pattern derived from `seed`. */
export function Identicon({ seed, className = '' }: IdenticonProps) {
  const { color, cells } = identicon(seed)
  return (
    <svg viewBox="0 0 5 5" className={`bg-secondary ${className}`} role="img" aria-label="Generated avatar">
      {cells.map((filled, i) =>
        filled ? <rect key={i} x={i % 5} y={Math.floor(i / 5)} width={1} height={1} fill={color} /> : null,
      )}
    </svg>
  )
}
```

Create `components/profile/profile-avatar.tsx` with exactly:

```tsx
import { useMemo, useState } from 'react'
import { mediaUrl } from '../../services/media'
import { Identicon } from './identicon'

interface ProfileAvatarProps {
  /** Profile document id; with `hasAvatar`, the uploaded avatar is served from /media. */
  documentId?: string | null
  hasAvatar?: boolean
  /** External image (ENS avatar or legacy URL); used when there is no upload. */
  userImage?: string | null
  /** A local preview (object URL) that wins over everything else. */
  previewUrl?: string | null
  /** Seed for the generated fallback, usually the address. */
  seed: string
  alt: string
  className?: string
}

/** Only images a page can safely load: http(s) URLs and inline images. */
function isSafeImageUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || /^data:image\/(png|jpeg|webp|gif);/i.test(url)
}

/**
 * The profile picture: local preview → uploaded avatar → external image →
 * generated identicon. An image that fails to load falls through to the next.
 */
export function ProfileAvatar({
  documentId,
  hasAvatar,
  userImage,
  previewUrl,
  seed,
  alt,
  className = 'h-32 w-32',
}: ProfileAvatarProps) {
  const sources = useMemo(
    () =>
      [
        previewUrl,
        hasAvatar && documentId ? mediaUrl(documentId, 'avatar') : null,
        userImage && isSafeImageUrl(userImage) ? userImage : null,
      ].filter((src): src is string => !!src),
    [previewUrl, hasAvatar, documentId, userImage],
  )
  const [failed, setFailed] = useState<ReadonlySet<string>>(new Set())
  const src = sources.find((candidate) => !failed.has(candidate))
  const shape = `rounded-full object-cover ${className}`

  if (!src) return <Identicon seed={seed} className={shape} />
  return (
    // eslint-disable-next-line @next/next/no-img-element -- /media 302s to signed storage URLs next/image can't allowlist
    <img src={src} alt={alt} className={shape} onError={() => setFailed((f) => new Set(f).add(src))} />
  )
}
```

Create `components/profile/profile-links.tsx` with exactly:

```tsx
import type { RenownProfileLink } from '../../services/switchboard'

function hostOf(url: string): string | null {
  try {
    const { protocol, host } = new URL(url)
    return protocol === 'https:' || protocol === 'http:' ? host.replace(/^www\./, '') : null
  } catch {
    return null
  }
}

/** A profile's links as pills; anything that is not an http(s) URL is never rendered as a link. */
export function ProfileLinks({ links }: { links: RenownProfileLink[] }) {
  const safe = links.flatMap((link) => {
    const host = hostOf(link.url)
    return host ? [{ ...link, host }] : []
  })
  if (safe.length === 0) return null
  return (
    <ul className="flex flex-wrap justify-center gap-2" aria-label="Links">
      {safe.map((link) => (
        <li key={link.id}>
          <a
            href={link.url}
            target="_blank"
            rel="me noopener noreferrer nofollow"
            className="bg-secondary text-foreground hover:bg-foreground/10 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm transition-colors"
          >
            <span className="font-medium">{link.label}</span>
            <span className="text-muted-foreground text-xs">{link.host}</span>
          </a>
        </li>
      ))}
    </ul>
  )
}
```

Create `components/profile/copy-address.tsx` with exactly:

```tsx
import { useState } from 'react'

/** The full address, with a copy button that confirms for two seconds. */
export function CopyAddress({ address }: { address: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className="border-border bg-secondary text-foreground hover:bg-foreground/10 flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors"
      aria-label="Copy address"
    >
      <span className="break-all font-mono text-xs">{address}</span>
      <span className="text-muted-foreground shrink-0 text-xs">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}
```

Create `components/profile/profile-summary.tsx` with exactly:

```tsx
import type { RenownProfileLink } from '../../services/switchboard'
import { ProfileAvatar } from './profile-avatar'
import { ProfileLinks } from './profile-links'

export interface ProfileSummaryData {
  documentId?: string | null
  address: string
  displayName?: string | null
  username?: string | null
  handle?: string | null
  bio?: string | null
  links?: RenownProfileLink[]
  hasAvatar?: boolean
  userImage?: string | null
  previewUrl?: string | null
  ensVerified?: boolean
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** The name a profile is shown under: display name, then username, then the short address. */
export function profileName(p: Pick<ProfileSummaryData, 'displayName' | 'username' | 'address'>): string {
  return p.displayName || p.username || shortAddress(p.address)
}

/** Avatar, name, @handle, badges, bio and links — the public face of a profile (also the editor preview). */
export function ProfileSummary({ profile }: { profile: ProfileSummaryData }) {
  const name = profileName(profile)
  return (
    <div className="flex flex-col items-center gap-4 text-center">
      <ProfileAvatar
        documentId={profile.documentId}
        hasAvatar={profile.hasAvatar}
        userImage={profile.userImage}
        previewUrl={profile.previewUrl}
        seed={profile.address}
        alt={name}
        className="h-32 w-32 border-4 border-white shadow-lg dark:border-white/20"
      />
      <div className="space-y-1">
        <h1 className="text-foreground text-3xl font-bold break-words">{name}</h1>
        {profile.handle && <p className="text-muted-foreground font-medium">@{profile.handle}</p>}
      </div>
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
      {profile.bio && (
        <p className="text-foreground/90 max-w-prose whitespace-pre-line break-words">{profile.bio}</p>
      )}
      <ProfileLinks links={profile.links ?? []} />
    </div>
  )
}
```

Create `components/profile/own-profile-actions.tsx` with exactly:

```tsx
import { useRenownAuth } from '@powerhousedao/reactor-browser/renown'
import Link from 'next/link'

/** "Edit profile" for the signed-in owner of the profile being viewed; nothing for anyone else. */
export function OwnProfileActions({ address }: { address: string }) {
  const { address: signedIn } = useRenownAuth()
  if (!signedIn || signedIn.toLowerCase() !== address.toLowerCase()) return null
  return (
    <div className="flex justify-center">
      <Link
        href="/profile/edit"
        className="bg-primary text-primary-foreground hover:bg-primary/80 rounded-lg px-5 py-2 text-sm font-semibold transition-colors"
      >
        Edit profile
      </Link>
    </div>
  )
}
```

Replace the whole of `pages/profile/[id].tsx` with exactly:

```tsx
import type { GetServerSideProps, NextPage } from 'next'
import Head from 'next/head'
import PageBackground from '../../components/ui/page-background'
import RenownCard from '../../components/ui/renown-card'
import { CopyAddress } from '../../components/profile/copy-address'
import { OwnProfileActions } from '../../components/profile/own-profile-actions'
import { ProfileSummary, profileName } from '../../components/profile/profile-summary'
import { mediaUrl } from '../../services/media'
import { getProfile, type RenownProfile } from '../../services/switchboard'
import { DEFAULT_DRIVE_ID } from '../../utils/constants'
import { isEnsVerified } from '../../utils/ens'
import { profilePath } from '../../utils/profile-url'

interface ProfilePageProps {
  profile: RenownProfile | null
  ensVerified: boolean
  /** Absolute canonical URL of this profile. */
  canonicalUrl: string | null
  /** Absolute image for link previews, if the profile has one. */
  ogImage: string | null
  error?: string
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

function siteOrigin(host: string | undefined): string {
  const configured = process.env.NEXT_PUBLIC_RENOWN_URL
  if (configured) return configured.replace(/\/+$/, '')
  return host ? `https://${host}` : 'https://www.renown.id'
}

function NotFound({ title, message }: { title: string; message: string }) {
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

const ProfilePage: NextPage<ProfilePageProps> = ({ profile, ensVerified, canonicalUrl, ogImage, error }) => {
  if (error) return <NotFound title="Something went wrong" message={error} />
  if (!profile) {
    return <NotFound title="Profile not found" message="The profile you're looking for doesn't exist or has been removed." />
  }

  const address = profile.ethAddress ?? ''
  const name = profileName({ displayName: profile.displayName, username: profile.username, address: address || profile.documentId })
  const title = profile.handle ? `${name} (@${profile.handle})` : name
  const description = profile.bio || `${name} on Renown`

  return (
    <PageBackground>
      <Head>
        <title>{`${title} - Renown`}</title>
        <meta name="description" content={description} />
        {canonicalUrl && <link rel="canonical" href={canonicalUrl} />}
        <meta property="og:type" content="profile" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        {canonicalUrl && <meta property="og:url" content={canonicalUrl} />}
        {ogImage && <meta property="og:image" content={ogImage} />}
        {profile.handle && <meta property="profile:username" content={profile.handle} />}
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        {ogImage && <meta name="twitter:image" content={ogImage} />}
      </Head>

      <main className="relative flex min-h-screen items-center justify-center px-4 pt-24 pb-12">
        <div className="w-full max-w-2xl">
          <RenownCard>
            <div className="space-y-8 p-8">
              <ProfileSummary
                profile={{
                  documentId: profile.documentId,
                  address: address || profile.documentId,
                  displayName: profile.displayName,
                  username: profile.username,
                  handle: profile.handle,
                  bio: profile.bio,
                  links: profile.links,
                  hasAvatar: !!profile.avatar,
                  userImage: profile.userImage,
                  ensVerified,
                }}
              />
              <div className="space-y-3">
                {ADDRESS_RE.test(address) && <CopyAddress address={address} />}
                <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 px-1 text-sm">
                  {profile.createdAt && (
                    <span>
                      Member since{' '}
                      {new Date(profile.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long' })}
                    </span>
                  )}
                  <span className="font-mono text-xs" title="RenownID">
                    {profile.documentId}
                  </span>
                </div>
              </div>
              {ADDRESS_RE.test(address) && <OwnProfileActions address={address} />}
            </div>
          </RenownCard>
        </div>
      </main>
    </PageBackground>
  )
}

export const getServerSideProps: GetServerSideProps<ProfilePageProps> = async (context) => {
  const id = String(context.params?.id ?? '')
  const byHandle = context.query.by === 'handle'
  const empty = { profile: null, ensVerified: false, canonicalUrl: null, ogImage: null }
  if (!id) return { props: { ...empty, error: 'No profile identifier provided' } }

  let profile: RenownProfile | null
  if (byHandle) {
    profile = await getProfile({ driveId: DEFAULT_DRIVE_ID, handle: id.toLowerCase() })
  } else if (ADDRESS_RE.test(id)) {
    profile = await getProfile({ driveId: `renown-${id.toLowerCase()}`, ethAddress: id.toLowerCase() })
  } else {
    profile =
      (await getProfile({ driveId: DEFAULT_DRIVE_ID, id })) ??
      (await getProfile({ driveId: DEFAULT_DRIVE_ID, username: id }))
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
  const ogImage = profile.avatar
    ? mediaUrl(profile.documentId, 'avatar', origin)
    : profile.userImage && /^https:\/\//i.test(profile.userImage)
      ? profile.userImage
      : null
  context.res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120')
  return {
    props: {
      profile,
      ensVerified: await isEnsVerified(profile.username, profile.ethAddress),
      canonicalUrl: `${origin}${profilePath(profile)}`,
      ogImage,
    },
  }
}

export default ProfilePage
```

The page keeps accepting a document id, a `0x` address or a legacy username, and redirects (307) every one of them — and `/@Mixed-Case` — to `/@<handle>` once the profile has a handle. "Publisher" badge: not rendered until Phase 2 adds `appProfilesByPublisher`.

- [ ] **Step 5: Run.** `pnpm exec playwright test e2e/profile-pages.spec.ts` → PASS (9 tests). `pnpm exec tsc --noEmit -p .`, `pnpm lint` → clean. `pnpm build` → succeeds and lists `ƒ /api/media/[documentId]/[field]` and `ƒ /profile/[id]`.

- [ ] **Step 6: Look at it.** `pnpm dev` with the stub (`node e2e/support/stub-switchboard.mjs` + `NEXT_PUBLIC_SWITCHBOARD_ENDPOINT=http://localhost:4799/graphql`), script a profile with `fixtureStub` as in the spec, open `/@pat-pages` in light and dark mode (theme toggle) at 390 px and 1280 px wide: card centred, avatar ring, name wraps, link pills wrap, copy button works. Fix anything that looks broken before committing.

- [ ] **Step 7: Commit.**

```bash
git add services/media.ts "pages/api/media/[documentId]/[field].ts" next.config.ts services/switchboard.ts utils/identicon.ts utils/ens.ts utils/profile-url.ts components/profile "pages/profile/[id].tsx" e2e/support/stub-switchboard.mjs e2e/support/stub-switchboard-client.ts e2e/profile-pages.spec.ts
git commit -m "feat(profile): public /@handle pages, stable /media URLs and link previews"
```

### Task 9: ENS fills only empty profile fields

**Files:**
- Modify: `services/wallet/profile-refresh.ts`, `e2e/profile-refresh.spec.ts`

**Interfaces:**
- Produces: `refreshProfile(...)` signs and sends only when it fills a gap: `username` when `isUsernameEmpty(stored.username)` (unset or the short-address placeholder `0x1234...abcd`), `userImage` when unset and ENS has an avatar; the unchanged field is sent as `null` (= unchanged). `UpdateProfileBody.username: string | null`. `isUsernameEmpty(username)`.

- [ ] **Step 1: Write the failing spec changes.**

```bash
git apply <<'PLAN_EOF'
diff --git a/e2e/profile-refresh.spec.ts b/e2e/profile-refresh.spec.ts
--- a/e2e/profile-refresh.spec.ts
+++ b/e2e/profile-refresh.spec.ts
@@ -47,44 +47,46 @@ test.describe('login profile refresh', () => {
     expect(s.updates).toEqual([])
   })
 
-  test('does not sign when the stored profile already matches', async () => {
-    const s = setup({ username: 'frank.eth', userImage: 'https://example.com/a.png' })
-    expect(await s.run({ ensName: 'frank.eth', ensAvatar: 'https://example.com/a.png' })).toBe('unchanged')
+  test('never overwrites a username or image the profile already has', async () => {
+    const s = setup({ username: 'chosen-name', userImage: 'https://example.com/mine.png' })
+    expect(await s.run({ ensName: 'frank.eth', ensAvatar: 'https://example.com/ens.png' })).toBe('unchanged')
     expect(s.signed).toEqual([])
     expect(s.updates).toEqual([])
   })
 
-  test('treats a missing avatar and a null one as the same', async () => {
-    const s = setup({ username: 'frank.eth' })
-    expect(await s.run({ ensName: 'frank.eth', ensAvatar: null })).toBe('unchanged')
-    expect(s.signed).toEqual([])
-  })
-
   test('does not sign for a profile the read model does not show yet', async () => {
     const s = setup(null)
     expect(await s.run({ ensName: 'frank.eth' })).toBe('unchanged')
     expect(s.signed).toEqual([])
   })
 
-  test('signs the canonical profile message and sends it when the ENS name changed', async () => {
-    const s = setup({ username: 'old.eth', userImage: null })
+  test('fills an empty username and image from ENS with one signed update', async () => {
+    const s = setup({ username: null, userImage: null })
     expect(await s.run({ ensName: 'frank.eth', ensAvatar: 'https://example.com/a.png' })).toBe('updated')
 
     expect(s.updates).toHaveLength(1)
     const [update] = s.updates
-    expect(update).toMatchObject({
-      address: s.account.address,
-      username: 'frank.eth',
-      userImage: 'https://example.com/a.png',
-    })
+    expect(update).toMatchObject({ address: s.account.address, username: 'frank.eth', userImage: 'https://example.com/a.png' })
     const expected = await profileMessage(
       s.account.address,
       { username: 'frank.eth', userImage: 'https://example.com/a.png' },
       update.timestamp,
     )
     expect(s.signed).toEqual([expected])
-    expect(await verifyMessage({ address: s.account.address, message: expected, signature: update.signature })).toBe(
-      true,
-    )
+    expect(await verifyMessage({ address: s.account.address, message: expected, signature: update.signature })).toBe(true)
+  })
+
+  test('replaces the short-address placeholder username but keeps an existing image', async () => {
+    const s = setup({ username: '0x1234...abcd', userImage: 'https://example.com/mine.png' })
+    expect(await s.run({ ensName: 'frank.eth', ensAvatar: 'https://example.com/ens.png' })).toBe('updated')
+    expect(s.updates[0]).toMatchObject({ username: 'frank.eth', userImage: null })
+  })
+
+  test('fills only the image when the username is set', async () => {
+    const s = setup({ username: 'frank.eth', userImage: null })
+    expect(await s.run({ ensName: 'frank.eth', ensAvatar: 'https://example.com/a.png' })).toBe('updated')
+    expect(s.updates[0]).toMatchObject({ username: null, userImage: 'https://example.com/a.png' })
+    const t = setup({ username: 'frank.eth', userImage: null })
+    expect(await t.run({ ensName: 'frank.eth', ensAvatar: null })).toBe('unchanged')
   })
 })
PLAN_EOF
```

- [ ] **Step 2: Run to see them fail.** `pnpm exec playwright test e2e/profile-refresh.spec.ts` → FAIL ("never overwrites…" gets `updated`).

- [ ] **Step 3: Implement.**

```bash
git apply <<'PLAN_EOF'
diff --git a/services/wallet/profile-refresh.ts b/services/wallet/profile-refresh.ts
--- a/services/wallet/profile-refresh.ts
+++ b/services/wallet/profile-refresh.ts
@@ -13,7 +13,7 @@ export interface StoredProfile {
 /** Request body for a signed profile update (`POST /api/profile/update`). */
 export interface UpdateProfileBody {
   address: Hex
-  username: string
+  username: string | null
   userImage: string | null
   signature: Hex
   timestamp: string
@@ -21,14 +21,23 @@ export interface UpdateProfileBody {
 
 export type ProfileRefreshOutcome = 'skipped' | 'unchanged' | 'updated'
 
+/** The short-address username issuance seeds when a wallet has no ENS name ("0x1234...abcd"). */
+const PLACEHOLDER_USERNAME = /^0x[0-9a-fA-F]{4}\.\.\.[0-9a-fA-F]{4}$/
+
+/** True when the stored username is unset or only the short-address placeholder. */
+export function isUsernameEmpty(username: string | null | undefined): boolean {
+  return !username || PLACEHOLDER_USERNAME.test(username)
+}
+
 /**
- * Bring the stored profile in line with the wallet's ENS name and avatar.
+ * Fill a stored profile's missing username/avatar from the wallet's ENS.
  *
- * Issuance only seeds a profile that doesn't exist yet, so a changed ENS name
- * on an existing profile needs its own signed update. Only runs with a real
- * ENS name (never the short-address fallback), and only signs, which prompts
- * an external wallet, when the stored fields differ. A profile the read model
- * doesn't show yet was just seeded by issuance with these same fields.
+ * ENS only fills gaps (a missing username counts the short-address
+ * placeholder issuance seeds): a username or image the profile already has — set by
+ * the user in the profile editor, or by an earlier ENS fill — is never
+ * overwritten. Issuance seeds a profile that doesn't exist yet, so a profile
+ * the read model doesn't show yet needs nothing. Only signs (which prompts an
+ * external wallet) when something is actually filled.
  *
  * The update is sent without waiting for its response, so the only delay it
  * can add to login is the signature prompt.
@@ -43,7 +52,6 @@ export async function refreshProfile(params: {
 }): Promise<ProfileRefreshOutcome> {
   const { address, ensName, signer, readProfile, updateProfile } = params
   if (!ensName) return 'skipped'
-  const userImage = params.ensAvatar ?? null
 
   let timer: ReturnType<typeof setTimeout> | undefined
   const stored = await Promise.race([
@@ -53,13 +61,15 @@ export async function refreshProfile(params: {
     }),
   ]).finally(() => clearTimeout(timer))
   if (!stored) return 'unchanged'
-  if (stored.username === ensName && (stored.userImage ?? null) === userImage) return 'unchanged'
+
+  // null in the signed payload means "leave unchanged".
+  const username = isUsernameEmpty(stored.username) ? ensName : null
+  const userImage = stored.userImage || !params.ensAvatar ? null : params.ensAvatar
+  if (username === null && userImage === null) return 'unchanged'
 
   const timestamp = new Date().toISOString()
-  const signature = await signer.signMessage(
-    await profileMessage(address, { username: ensName, userImage }, timestamp),
-  )
-  void updateProfile({ address, username: ensName, userImage, signature, timestamp }).catch((e) => {
+  const signature = await signer.signMessage(await profileMessage(address, { username, userImage }, timestamp))
+  void updateProfile({ address, username, userImage, signature, timestamp }).catch((e) => {
     console.warn('Failed to update the Renown profile:', e)
   })
   return 'updated'
PLAN_EOF
```

- [ ] **Step 4: Run.** `pnpm exec playwright test e2e/profile-refresh.spec.ts e2e/renown-writes.spec.ts` → PASS (the web-flow tests still sign nothing without ENS). `pnpm exec tsc --noEmit -p .`, `pnpm lint` → clean.

- [ ] **Step 5: Commit.**

```bash
git add services/wallet/profile-refresh.ts e2e/profile-refresh.spec.ts
git commit -m "fix(profile): ENS fills empty profile fields instead of overwriting edits"
```

### Task 10: `/profile/edit` and the header

**Files:**
- Create: `utils/image-crop.ts`, `utils/profile-form.ts`, `services/avatar-upload.ts`, `hooks/use-profile-editor-auth.ts`, `components/profile-edit/field.tsx`, `components/profile-edit/handle-field.tsx`, `components/profile-edit/links-editor.tsx`, `components/profile-edit/avatar-cropper.tsx`, `components/profile-edit/avatar-uploader.tsx`, `pages/profile/edit.tsx`
- Modify: `components/auth/renown-login-button.tsx`, `playwright.config.ts`, `e2e/renown-writes.spec.ts` (hoist `authorize`, add the editor suite)
- Test: `e2e/profile-form.spec.ts`, `e2e/renown-writes.spec.ts` ("profile editor")

**Interfaces:**
- Consumes: Task 7 `profileMessage`, `ProfileFields`, `/api/profile/update` `{error, code, field}`; Task 8 `ProfileSummary`, `ProfileAvatar`, `getProfile`, `getHandleAvailability`, `packageRoutesBase`, `switchboardOrigin`, `profilePath`; Task 4 upload route contract; wagmi `useEnsName`/`useEnsAvatar`; `useRenown`/`useRenownAuth` (`@powerhousedao/reactor-browser/renown`); `useSession`/`useAuthInitializing`.
- Produces: `cropRect`, `panBy`, `renderAvatar` (256×256 WebP, PNG where the browser can't encode WebP), `sha256Hex`, `sourceImageProblem`, `AVATAR_SIZE`, `INITIAL_CROP`; `ProfileForm`, `formFromProfile`, `changedFields`, `formProblems`, `handleFromEns`, `hasChanges`, `LIMITS`, `HANDLE_RE`; `uploadAvatar(blob, bearer) → ref` / `AvatarUploadError(message, code)`; `useProfileEditorAuth() → {status:"loading"} | {status:"signed-out", login} | {status:"ready", address, profileId, signMessage, getBearer}`.

- [ ] **Step 1: Write the failing unit spec.**

Create `e2e/profile-form.spec.ts` with exactly:

```ts
import { test, expect } from '@playwright/test'
import { cropRect, panBy, sourceImageProblem, INITIAL_CROP } from '../utils/image-crop'
import { changedFields, formFromProfile, formProblems, handleFromEns, type ProfileForm } from '../utils/profile-form'

// Runs in the Playwright worker (Node): the editor's pure helpers.
const base: ProfileForm = formFromProfile({
  documentId: 'doc-1',
  displayName: 'Frank',
  handle: 'frank',
  bio: 'Hi',
  links: [{ id: 'l1', label: 'Site', url: 'https://frank.example' }],
  avatar: `attachment://v1:${'a'.repeat(64)}`,
  userImage: null,
})

test.describe('profile form', () => {
  test('signs only what changed, with "" for cleared fields and whole link lists', () => {
    expect(changedFields(base, base)).toEqual({})
    expect(changedFields(base, { ...base, displayName: ' Frank ' })).toEqual({})
    expect(changedFields(base, { ...base, handle: 'Frank-2 ' })).toEqual({ handle: 'frank-2' })
    expect(changedFields(base, { ...base, displayName: '', bio: '', avatar: null })).toEqual({
      displayName: '',
      bio: '',
      avatar: '',
    })
    expect(
      changedFields(base, { ...base, links: [...base.links, { id: 'l2', label: ' Code ', url: 'https://code.example ' }] }),
    ).toEqual({
      links: [
        { id: 'l1', label: 'Site', url: 'https://frank.example' },
        { id: 'l2', label: 'Code', url: 'https://code.example' },
      ],
    })
    expect(changedFields(base, { ...base, avatar: null, userImage: 'https://ens.example/a.png' })).toEqual({
      avatar: '',
      userImage: 'https://ens.example/a.png',
    })
  })

  test('reports the problems the switchboard would refuse', () => {
    expect(formProblems(base)).toEqual({})
    expect(formProblems({ ...base, displayName: 'x'.repeat(65) }).displayName).toMatch(/64/)
    expect(formProblems({ ...base, handle: 'ab' }).handle).toMatch(/3–30/)
    expect(formProblems({ ...base, handle: '' })).toEqual({})
    expect(formProblems({ ...base, bio: 'b'.repeat(281) }).bio).toMatch(/280/)
    expect(formProblems({ ...base, links: [{ id: 'x', label: '', url: 'https://a.example' }] }).links).toMatch(/label/)
    expect(formProblems({ ...base, links: [{ id: 'x', label: 'X', url: 'javascript:alert(1)' }] }).links).toMatch(/https/)
    const nine = Array.from({ length: 9 }, (_, i) => ({ id: `${i}`, label: 'L', url: 'https://a.example' }))
    expect(formProblems({ ...base, links: nine }).links).toMatch(/8/)
  })

  test('suggests a handle from an ENS name only when it is a valid handle', () => {
    expect(handleFromEns('Frank.eth')).toBe('frank')
    expect(handleFromEns('vitalik.eth')).toBe('vitalik')
    expect(handleFromEns('my_name.eth')).toBe('my-name')
    expect(handleFromEns('ab.eth')).toBeNull()
    expect(handleFromEns(null)).toBeNull()
  })
})

test.describe('avatar cropping', () => {
  test('accepts only PNG/JPEG/WebP up to 2 MB', () => {
    expect(sourceImageProblem({ type: 'image/png', size: 2 * 1024 * 1024 })).toBeNull()
    expect(sourceImageProblem({ type: 'image/png', size: 2 * 1024 * 1024 + 1 })).toMatch(/2 MB/)
    expect(sourceImageProblem({ type: 'image/gif', size: 10 })).toMatch(/PNG/)
    expect(sourceImageProblem({ type: 'image/svg+xml', size: 10 })).toMatch(/PNG/)
  })

  test('selects a centred square, zooms in, and never leaves the image when panned', () => {
    expect(cropRect(400, 200, INITIAL_CROP)).toEqual({ sx: 100, sy: 0, size: 200 })
    expect(cropRect(400, 200, { zoom: 2, panX: 0, panY: 0 })).toEqual({ sx: 150, sy: 50, size: 100 })
    expect(cropRect(400, 200, { zoom: 1, panX: -5, panY: 0 })).toEqual({ sx: 0, sy: 0, size: 200 })
    expect(cropRect(400, 200, { zoom: 99, panX: 1, panY: 1 })).toEqual({ sx: 350, sy: 150, size: 50 })
    // Dragging right by the whole viewport moves the crop towards the left edge.
    const panned = panBy(INITIAL_CROP, 400, 200, 240, 240, 0)
    expect(panned.panX).toBe(-1)
    expect(panned.panY).toBe(0) // no vertical slack at zoom 1
  })
})
```

- [ ] **Step 2: Write the failing browser spec** (hoists the existing `authorize()` helper to module scope unchanged and adds the editor suite) **and enable the test seam.**

```bash
git apply <<'PLAN_EOF'
diff --git a/e2e/renown-writes.spec.ts b/e2e/renown-writes.spec.ts
--- a/e2e/renown-writes.spec.ts
+++ b/e2e/renown-writes.spec.ts
@@ -3,7 +3,13 @@ import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
 import { verifyMessage } from 'viem'
 import { profileMessage, revokeMessage, type ProfileFields } from '../services/renown-signed-messages'
 import { installInjectedWallet, type InjectedWallet } from './support/injected-wallet'
-import { graphqlError, resetStub, scriptStub, stubRequests } from './support/stub-switchboard-client'
+import {
+  graphqlError,
+  resetStub,
+  scriptStub,
+  stubRequests,
+  STUB_SWITCHBOARD_URL,
+} from './support/stub-switchboard-client'
 
 // The write routes call the switchboard server-side, so these tests drive the
 // stub switchboard the dev server is pointed at (see playwright.config.ts) and
@@ -434,66 +440,67 @@ test.describe('POST /api/profile/update', () => {
 // read (GET /api/auth/credential) is answered in the browser once the
 // credential was posted, since the stub has no read model; the writes go
 // through the real API routes to the stub switchboard.
-test.describe('web flow credential revocation', () => {
-  const APP_DID = 'did:web:test.example'
-  const FLOW_URL = `/?app=${APP_DID}&returnUrl=${encodeURIComponent('http://localhost:3000/done')}`
-
-  interface Flow {
-    wallet: InjectedWallet
-    /** DELETE requests the browser sent. */
-    deletes: string[]
-    /** Profile updates the browser sent. */
-    profileUpdates: string[]
-    credentialId: () => string
-  }
+const APP_DID = 'did:web:test.example'
+const FLOW_URL = `/?app=${APP_DID}&returnUrl=${encodeURIComponent('http://localhost:3000/done')}`
+
+interface Flow {
+  wallet: InjectedWallet
+  /** DELETE requests the browser sent. */
+  deletes: string[]
+  /** Profile updates the browser sent. */
+  profileUpdates: string[]
+  credentialId: () => string
+}
 
-  async function authorize(page: import('@playwright/test').Page): Promise<Flow> {
-    // Nothing leaves localhost: ENS lookups fail fast, so the flow has no ENS name.
-    await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort())
-    const wallet = await installInjectedWallet(page)
-    let issued: { credential: { id: string; credentialSubject: unknown } } | null = null
-    let revoked = false
-    await page.route('**/api/credential/renown', async (route) => {
-      const method = route.request().method()
-      if (method === 'POST') issued = route.request().postDataJSON()
-      const response = await route.fetch()
-      if (method === 'DELETE' && response.ok()) revoked = true
-      await route.fulfill({ response })
-    })
-    // Like the real read (includeRevoked: false), a revoked credential is gone.
-    await page.route('**/api/auth/credential?*', (route) =>
-      issued && !revoked
-        ? route.fulfill({
-            json: { credential: { id: issued.credential.id, credentialSubject: issued.credential.credentialSubject } },
-          })
-        : route.fulfill({ status: 404, json: { error: 'Credential not found' } }),
-    )
-    const deletes: string[] = []
-    const profileUpdates: string[] = []
-    page.on('request', (r) => {
-      if (r.method() === 'DELETE') deletes.push(r.url())
-      if (r.url().includes('/api/profile/update')) profileUpdates.push(r.url())
-    })
-    await scriptStub({
-      match: 'renown_issueCredential',
-      variables: wallet.address.toLowerCase(),
-      response: { data: { renown_issueCredential: uniqueId('doc-ui') } },
-    })
-
-    await page.goto(FLOW_URL)
-    await page.getByRole('button', { name: 'Confirm Authorization' }).click({ timeout: 30_000 })
-    await expect(page.getByRole('button', { name: 'Revoke' })).toBeVisible({ timeout: 30_000 })
-    return {
-      wallet,
-      deletes,
-      profileUpdates,
-      credentialId: () => {
-        if (!issued) throw new Error('no credential was issued')
-        return issued.credential.id
-      },
-    }
+async function authorize(page: import('@playwright/test').Page): Promise<Flow> {
+  // Nothing leaves localhost: ENS lookups fail fast, so the flow has no ENS name.
+  await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort())
+  const wallet = await installInjectedWallet(page)
+  let issued: { credential: { id: string; credentialSubject: unknown } } | null = null
+  let revoked = false
+  await page.route('**/api/credential/renown', async (route) => {
+    const method = route.request().method()
+    if (method === 'POST') issued = route.request().postDataJSON()
+    const response = await route.fetch()
+    if (method === 'DELETE' && response.ok()) revoked = true
+    await route.fulfill({ response })
+  })
+  // Like the real read (includeRevoked: false), a revoked credential is gone.
+  await page.route('**/api/auth/credential?*', (route) =>
+    issued && !revoked
+      ? route.fulfill({
+          json: { credential: { id: issued.credential.id, credentialSubject: issued.credential.credentialSubject } },
+        })
+      : route.fulfill({ status: 404, json: { error: 'Credential not found' } }),
+  )
+  const deletes: string[] = []
+  const profileUpdates: string[] = []
+  page.on('request', (r) => {
+    if (r.method() === 'DELETE') deletes.push(r.url())
+    if (r.url().includes('/api/profile/update')) profileUpdates.push(r.url())
+  })
+  await scriptStub({
+    match: 'renown_issueCredential',
+    variables: wallet.address.toLowerCase(),
+    response: { data: { renown_issueCredential: uniqueId('doc-ui') } },
+  })
+
+  await page.goto(FLOW_URL)
+  await page.getByRole('button', { name: 'Confirm Authorization' }).click({ timeout: 30_000 })
+  await expect(page.getByRole('button', { name: 'Revoke' })).toBeVisible({ timeout: 30_000 })
+  return {
+    wallet,
+    deletes,
+    profileUpdates,
+    credentialId: () => {
+      if (!issued) throw new Error('no credential was issued')
+      return issued.credential.id
+    },
   }
+}
+
 
+test.describe('web flow credential revocation', () => {
   test.beforeEach(() => {
     test.setTimeout(90_000)
   })
@@ -570,3 +577,126 @@ test.describe('web flow credential revocation', () => {
     expect(flow.deletes).toEqual([])
   })
 })
+
+// The profile editor in the browser: the wallet session comes from the web
+// flow (authorize), the upload bearer from window.__renownE2eBearer, uploads
+// go to the stub's media route and its fake S3, and the save goes through
+// /api/profile/update to the stub switchboard.
+test.describe('profile editor', () => {
+  // 1×1 PNG.
+  const PNG = Buffer.from(
+    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
+    'base64',
+  )
+
+  test.beforeEach(() => {
+    test.setTimeout(120_000)
+  })
+
+  async function openEditor(page: import('@playwright/test').Page, taken: string[] = []) {
+    await page.addInitScript(() => {
+      ;(window as { __renownE2eBearer?: string }).__renownE2eBearer = 'e2e-bearer'
+    })
+    const flow = await authorize(page)
+    const uploads: { authorization?: string; body: unknown }[] = []
+    page.on('request', (r) => {
+      if (r.url().endsWith('/media/uploads')) uploads.push({ authorization: r.headers().authorization, body: r.postDataJSON() })
+    })
+    // The editor reads the profile and checks handles from the browser.
+    await page.route(`${STUB_SWITCHBOARD_URL}/graphql`, async (route) => {
+      const { query, variables } = route.request().postDataJSON() as { query: string; variables: Record<string, unknown> }
+      if (query.includes('renownHandleAvailability')) {
+        const handle = String(variables.handle)
+        const isTaken = taken.includes(handle)
+        return route.fulfill({
+          json: { data: { renownHandleAvailability: { handle, available: !isTaken, reason: isTaken ? 'TAKEN' : null } } },
+        })
+      }
+      if (query.includes('renownUsers')) {
+        return route.fulfill({
+          json: {
+            data: {
+              renownUsers: [
+                { documentId: 'doc-edit', ethAddress: flow.wallet.address.toLowerCase(), username: null, userImage: null, displayName: null, handle: null, bio: null, links: [], avatar: null, createdAt: null, updatedAt: null },
+              ],
+            },
+          },
+        })
+      }
+      return route.continue()
+    })
+    await page.goto('/profile/edit')
+    await expect(page.getByRole('heading', { name: 'Edit profile' })).toBeVisible({ timeout: 30_000 })
+    return { ...flow, uploads }
+  }
+
+  test('is gated behind sign-in', async ({ page }) => {
+    await page.route((url) => !['localhost', '127.0.0.1'].includes(url.hostname), (route) => route.abort())
+    await page.goto('/profile/edit')
+    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible({ timeout: 30_000 })
+  })
+
+  test('uploads an avatar and saves the whole profile with one signature', async ({ page }) => {
+    const editor = await openEditor(page)
+
+    await page.getByTestId('avatar-file').setInputFiles({ name: 'me.png', mimeType: 'image/png', buffer: PNG })
+    await page.getByRole('button', { name: 'Use this crop' }).click()
+    await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible()
+    expect(editor.uploads).toHaveLength(1)
+    expect(editor.uploads[0].authorization).toBe('Bearer e2e-bearer')
+    expect(editor.uploads[0].body).toMatchObject({ purpose: 'avatar', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown })
+
+    await page.getByLabel('Display name').fill('Edie Editor')
+    await page.getByLabel('Handle').fill('edie-editor')
+    await expect(page.getByText('renown.id/@edie-editor is available.')).toBeVisible()
+    await page.getByLabel('Bio').fill('Edits profiles.')
+    await page.getByRole('button', { name: '+ Add link' }).click()
+    await page.getByLabel('Link 1 label').fill('Site')
+    await page.getByLabel('Link 1 URL').fill('https://edie.example')
+    // The preview follows the form.
+    await expect(page.getByRole('complementary', { name: 'Preview' }).getByRole('heading', { name: 'Edie Editor' })).toBeVisible()
+
+    await scriptStub({
+      match: 'renown_upsertProfile',
+      variables: editor.wallet.address,
+      response: { data: { renown_upsertProfile: 'doc-edit' } },
+    })
+    await page.getByRole('button', { name: 'Save profile' }).click()
+    await expect(page.getByRole('status')).toContainText('Profile saved.')
+
+    const call = (await stubRequests('renown_upsertProfile')).find((c) => c.variables.address === editor.wallet.address)
+    expect(call?.variables).toMatchObject({
+      displayName: 'Edie Editor',
+      handle: 'edie-editor',
+      bio: 'Edits profiles.',
+      links: [{ label: 'Site', url: 'https://edie.example' }],
+      avatar: expect.stringMatching(/^attachment:\/\/v1:[0-9a-f]{64}$/) as unknown,
+    })
+    const v = call!.variables as Record<string, unknown> & { links: { id: string; label: string; url: string }[]; timestamp: string }
+    const expected = await profileMessage(
+      editor.wallet.address,
+      { displayName: 'Edie Editor', handle: 'edie-editor', bio: 'Edits profiles.', links: v.links, avatar: v.avatar as string },
+      v.timestamp,
+    )
+    expect(editor.wallet.personalSignRequests).toEqual([expected])
+    expect(await verifyMessage({ address: editor.wallet.address, message: expected, signature: v.signature as `0x${string}` })).toBe(true)
+  })
+
+  test('shows a taken handle inline, before and after saving', async ({ page }) => {
+    const editor = await openEditor(page, ['taken-live'])
+    await page.getByLabel('Handle').fill('taken-live')
+    await expect(page.getByRole('alert').filter({ hasText: 'This handle is taken.' })).toBeVisible()
+
+    // Taken between the check and the save: the switchboard's HANDLE_TAKEN lands on the field.
+    await page.getByLabel('Handle').fill('raced-handle')
+    await expect(page.getByText('renown.id/@raced-handle is available.')).toBeVisible()
+    await scriptStub({
+      match: 'renown_upsertProfile',
+      variables: editor.wallet.address,
+      response: graphqlError('The handle "raced-handle" is taken', 'HANDLE_TAKEN', { field: 'handle' }),
+    })
+    await page.getByRole('button', { name: 'Save profile' }).click()
+    await expect(page.getByRole('alert').filter({ hasText: 'The handle "raced-handle" is taken' })).toBeVisible()
+  })
+})
+
PLAN_EOF
```

```bash
git apply <<'PLAN_EOF'
diff --git a/playwright.config.ts b/playwright.config.ts
--- a/playwright.config.ts
+++ b/playwright.config.ts
@@ -31,7 +31,9 @@ export default defineConfig({
       url: 'http://localhost:3000',
       // A reused dev server must also point at the stub switchboard, or the
       // credential API tests fail.
-      env: { NEXT_PUBLIC_SWITCHBOARD_ENDPOINT: `${STUB_SWITCHBOARD_URL}/graphql` },
+      // NEXT_PUBLIC_E2E_AUTH lets the profile editor take its upload bearer
+      // from window.__renownE2eBearer (hooks/use-profile-editor-auth.ts).
+      env: { NEXT_PUBLIC_SWITCHBOARD_ENDPOINT: `${STUB_SWITCHBOARD_URL}/graphql`, NEXT_PUBLIC_E2E_AUTH: '1' },
       reuseExistingServer: !process.env.CI,
       timeout: 120 * 1000,
     },
PLAN_EOF
```

- [ ] **Step 3: Run them to see them fail.** `pnpm exec playwright test e2e/profile-form.spec.ts e2e/renown-writes.spec.ts -g "profile (form|editor)|avatar cropping"` → FAIL (`../utils/image-crop` missing; `/profile/edit` 404). Stop a dev server you started earlier first: the seam needs `NEXT_PUBLIC_E2E_AUTH=1` at server start.

- [ ] **Step 4: Implement the helpers.**

Create `utils/image-crop.ts` with exactly:

```ts
// Square avatar cropping. The math is pure (and tested in Node); rendering
// uses a canvas and runs only in the browser.

/** Avatars are stored as this many pixels square. */
export const AVATAR_SIZE = 256
/** Accepted source images, checked before any processing. */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const
/** Largest source file accepted (before resizing). */
export const MAX_SOURCE_BYTES = 2 * 1024 * 1024
export const MIN_ZOOM = 1
export const MAX_ZOOM = 4

export interface CropState {
  /** 1 = the largest centred square; 4 = a quarter of its side. */
  zoom: number
  /** Pan of the crop centre, -1 (left/top edge) … 1 (right/bottom edge). */
  panX: number
  panY: number
}

export interface CropRect {
  sx: number
  sy: number
  size: number
}

export const INITIAL_CROP: CropState = { zoom: 1, panX: 0, panY: 0 }

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Why `file` can't be used as an avatar source, or null when it can. */
export function sourceImageProblem(file: { type: string; size: number }): string | null {
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
    return 'Choose a PNG, JPEG or WebP image.'
  }
  if (file.size > MAX_SOURCE_BYTES) return 'Choose an image of at most 2 MB.'
  return null
}

/** The source square (in image pixels) a crop state selects; always inside the image. */
export function cropRect(width: number, height: number, crop: CropState): CropRect {
  const zoom = clamp(crop.zoom, MIN_ZOOM, MAX_ZOOM)
  const size = Math.min(width, height) / zoom
  const slackX = (width - size) / 2
  const slackY = (height - size) / 2
  return {
    sx: Math.round(slackX + clamp(crop.panX, -1, 1) * slackX),
    sy: Math.round(slackY + clamp(crop.panY, -1, 1) * slackY),
    size: Math.round(size),
  }
}

/**
 * The pan after dragging by (dx, dy) screen pixels in a viewport `viewport`
 * pixels wide that shows `rect.size` source pixels.
 */
export function panBy(
  crop: CropState,
  width: number,
  height: number,
  viewport: number,
  dx: number,
  dy: number,
): CropState {
  const { size } = cropRect(width, height, crop)
  const scale = size / viewport
  const slackX = (width - size) / 2
  const slackY = (height - size) / 2
  return {
    ...crop,
    panX: slackX > 0 ? clamp(crop.panX - (dx * scale) / slackX, -1, 1) : 0,
    panY: slackY > 0 ? clamp(crop.panY - (dy * scale) / slackY, -1, 1) : 0,
  }
}

/**
 * Draws the crop into a 256×256 canvas and encodes it as WebP. Browsers that
 * cannot encode WebP (older Safari) return PNG instead, which is also accepted.
 */
export async function renderAvatar(image: HTMLImageElement, crop: CropState): Promise<Blob> {
  const { sx, sy, size } = cropRect(image.naturalWidth, image.naturalHeight, crop)
  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot resize images')
  context.imageSmoothingQuality = 'high'
  context.drawImage(image, sx, sy, size, size, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', 0.9),
  )
  if (!blob) throw new Error('Could not encode the image')
  return blob
}

/** Lowercase hex SHA-256 of the bytes (WebCrypto). */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
```

Create `utils/profile-form.ts` with exactly:

```ts
// The profile editor's form model: what the user edits, how it is checked
// before signing, and the patch that is signed (only what changed).
import type { ProfileFields, ProfileLink } from '../services/renown-signed-messages'
import type { RenownProfile } from '../services/switchboard'

export const LIMITS = { displayName: 64, bio: 280, links: 8, linkLabel: 40, linkUrl: 2048 } as const
export const HANDLE_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/

export interface ProfileForm {
  displayName: string
  handle: string
  bio: string
  links: ProfileLink[]
  /** attachment://v1 ref of the uploaded avatar, or null for none. */
  avatar: string | null
  /** External image URL (ENS avatar); shown when there is no upload. */
  userImage: string | null
}

export type FormField = 'displayName' | 'handle' | 'bio' | 'links' | 'avatar'
export type FormProblems = Partial<Record<FormField, string>>

export function formFromProfile(profile: RenownProfile | null): ProfileForm {
  return {
    displayName: profile?.displayName ?? '',
    handle: profile?.handle ?? '',
    bio: profile?.bio ?? '',
    links: (profile?.links ?? []).map(({ id, label, url }) => ({ id, label, url })),
    avatar: profile?.avatar ?? null,
    userImage: profile?.userImage ?? null,
  }
}

/** Lowercased, trimmed: the form a handle is stored and checked in. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase()
}

/** A handle suggestion from an ENS name: "Frank.eth" → "frank", or null when it can't be a handle. */
export function handleFromEns(ensName: string | null | undefined): string | null {
  if (!ensName) return null
  const candidate = normalizeHandle(ensName.replace(/\.eth$/i, '')).replace(/[^a-z0-9-]/g, '-')
  return HANDLE_RE.test(candidate) ? candidate : null
}

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** Problems that would make the switchboard refuse the save (same rules, checked first for inline errors). */
export function formProblems(form: ProfileForm): FormProblems {
  const problems: FormProblems = {}
  if (form.displayName.trim().length > LIMITS.displayName) {
    problems.displayName = `At most ${LIMITS.displayName} characters.`
  }
  const handle = normalizeHandle(form.handle)
  if (handle && !HANDLE_RE.test(handle)) {
    problems.handle = '3–30 lowercase letters, digits or hyphens; no hyphen at the start or end.'
  }
  if (form.bio.trim().length > LIMITS.bio) problems.bio = `At most ${LIMITS.bio} characters.`
  if (form.links.length > LIMITS.links) problems.links = `At most ${LIMITS.links} links.`
  for (const link of form.links) {
    const label = link.label.trim()
    if (!label || label.length > LIMITS.linkLabel) {
      problems.links = `Every link needs a label of 1–${LIMITS.linkLabel} characters.`
      break
    }
    if (!isHttpUrl(link.url.trim()) || link.url.length > LIMITS.linkUrl) {
      problems.links = 'Links must start with https:// or http://.'
      break
    }
  }
  return problems
}

function sameLinks(a: ProfileLink[], b: ProfileLink[]): boolean {
  return a.length === b.length && a.every((l, i) => l.id === b[i].id && l.label === b[i].label && l.url === b[i].url)
}

/**
 * The signed patch: only fields that differ from what was loaded. Cleared
 * text and a removed avatar become "" (clear); links are sent whole.
 */
export function changedFields(initial: ProfileForm, current: ProfileForm): ProfileFields {
  const out: ProfileFields = {}
  const text = (a: string, b: string) => a.trim() !== b.trim()
  if (text(initial.displayName, current.displayName)) out.displayName = current.displayName.trim()
  if (normalizeHandle(initial.handle) !== normalizeHandle(current.handle)) out.handle = normalizeHandle(current.handle)
  if (text(initial.bio, current.bio)) out.bio = current.bio.trim()
  const links = current.links.map((l) => ({ id: l.id, label: l.label.trim(), url: l.url.trim() }))
  if (!sameLinks(initial.links, links)) out.links = links
  if (initial.avatar !== current.avatar) out.avatar = current.avatar ?? ''
  if (initial.userImage !== current.userImage && current.userImage) out.userImage = current.userImage
  return out
}

export function hasChanges(fields: ProfileFields): boolean {
  return Object.keys(fields).length > 0
}
```

Create `services/avatar-upload.ts` with exactly:

```ts
// Browser upload of a prepared avatar through renown-package's gated upload
// route (POST <switchboard>/api/@powerhousedao/renown-package/media/uploads),
// authorized by the signed-in user's Renown bearer. The switchboard's raw
// /attachments routes are closed to the public.
import { sha256Hex } from '../utils/image-crop'
import { packageRoutesBase, switchboardOrigin } from './media'

export class AvatarUploadError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'AvatarUploadError'
  }
}

interface UploadTarget {
  method: 'PUT'
  url: string
  headers: Record<string, string>
}

interface ReserveResponse {
  ref: string
  deduped?: boolean
  reservationId?: string
  uploadTarget?: UploadTarget | null
  code?: string
  error?: string
}

/**
 * Uploads `blob` (≤ 2 MB PNG/JPEG/WebP) and returns its attachment ref.
 * @throws {AvatarUploadError} with the route's error code when it refuses.
 */
export async function uploadAvatar(blob: Blob, bearer: string, fetchImpl: typeof fetch = fetch): Promise<string> {
  const sha256 = await sha256Hex(blob)
  const reserve = await fetchImpl(`${packageRoutesBase()}/media/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${bearer}` },
    body: JSON.stringify({ purpose: 'avatar', mimeType: blob.type, sizeBytes: blob.size, sha256 }),
  })
  const body = (await reserve.json().catch(() => ({}))) as ReserveResponse
  if (!reserve.ok) {
    throw new AvatarUploadError(body.error ?? `Upload refused (${reserve.status})`, body.code)
  }
  if (body.deduped) return body.ref

  // S3: PUT to the presigned target with exactly its headers (it pins the
  // length, type and checksum). Filesystem switchboards (local development)
  // take the bytes on their own reservation route.
  const put = body.uploadTarget
    ? await fetchImpl(body.uploadTarget.url, { method: 'PUT', headers: body.uploadTarget.headers, body: blob })
    : await fetchImpl(`${switchboardOrigin()}/attachments/reservations/${encodeURIComponent(body.reservationId ?? '')}`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/octet-stream' },
        body: blob,
      })
  if (!put.ok) throw new AvatarUploadError(`Upload failed (${put.status})`, 'UPLOAD_FAILED')
  return body.ref
}
```

Create `hooks/use-profile-editor-auth.ts` with exactly:

```ts
import { useRenown, useRenownAuth } from '@powerhousedao/reactor-browser/renown'
import { useCallback } from 'react'
import type { Hex } from 'viem'
import { useAuthInitializing, useSession } from './use-wallet-adapter'

/**
 * What the profile editor needs from the signed-in user:
 *  - the wallet session, to personal_sign the profile upsert;
 *  - the Renown session (same address), whose bearer authorizes avatar uploads.
 */
export type ProfileEditorAuth =
  | { status: 'loading' }
  | { status: 'signed-out'; login: () => void }
  | { status: 'ready'; address: Hex; profileId: string | null; signMessage: (m: string) => Promise<Hex>; getBearer: () => Promise<string> }

// Playwright runs the dev server with NEXT_PUBLIC_E2E_AUTH=1 and sets
// window.__renownE2eBearer, standing in for the Renown session (the upload
// route that checks bearers is stubbed there). Inert in every other build.
const E2E_AUTH = process.env.NEXT_PUBLIC_E2E_AUTH === '1'
function e2eBearer(): string | undefined {
  if (!E2E_AUTH || typeof window === 'undefined') return undefined
  return (window as { __renownE2eBearer?: string }).__renownE2eBearer
}

export function useProfileEditorAuth(): ProfileEditorAuth {
  const session = useSession()
  const initializing = useAuthInitializing()
  const renownAuth = useRenownAuth()
  const renown = useRenown()

  const getBearer = useCallback(async (): Promise<string> => {
    const injected = e2eBearer()
    if (injected) return injected
    if (!renown?.user) throw new Error('Sign in to Renown to upload an avatar')
    return renown.getBearerToken({ expiresIn: 600 })
  }, [renown])

  if (initializing || renownAuth.status === 'loading' || renownAuth.status === 'checking') return { status: 'loading' }
  const renownAddress = e2eBearer() ? session?.address : renownAuth.address
  if (!session || !renownAddress || renownAddress.toLowerCase() !== session.address.toLowerCase()) {
    return { status: 'signed-out', login: () => renownAuth.login() }
  }
  return {
    status: 'ready',
    address: session.address,
    profileId: renownAuth.profileId ?? null,
    signMessage: (message) => session.signer.signMessage(message),
    getBearer,
  }
}
```

- [ ] **Step 5: Implement the editor components and page.**

Create `components/profile-edit/field.tsx` with exactly:

```tsx
import type { ReactNode } from 'react'

interface FieldProps {
  id: string
  label: string
  hint?: ReactNode
  error?: string
  /** e.g. "12/280", shown right-aligned under the input. */
  counter?: string
  /** A group of controls (not one input): the label names the group instead of pointing at an input. */
  group?: boolean
  children: ReactNode
}

/** Label, control, then the error (or the hint) and an optional counter. */
export function Field({ id, label, hint, error, counter, group, children }: FieldProps) {
  const labelClass = 'text-foreground block text-sm font-semibold'
  return (
    <div className="space-y-1.5" role={group ? 'group' : undefined} aria-labelledby={group ? `${id}-label` : undefined}>
      {group ? (
        <span id={`${id}-label`} className={labelClass}>
          {label}
        </span>
      ) : (
        <label htmlFor={id} className={labelClass}>
          {label}
        </label>
      )}
      {children}
      <div className="flex items-start justify-between gap-3 text-xs">
        {error ? (
          <p id={`${id}-error`} role="alert" className="text-destructive">
            {error}
          </p>
        ) : (
          <p className="text-muted-foreground">{hint}</p>
        )}
        {counter && <span className="text-muted-foreground shrink-0 tabular-nums">{counter}</span>}
      </div>
    </div>
  )
}

export const inputClass =
  'border-input bg-background/60 text-foreground placeholder:text-muted-foreground focus:ring-ring w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 aria-[invalid=true]:border-destructive'
```

Create `components/profile-edit/handle-field.tsx` with exactly:

```tsx
import { useEffect, useState } from 'react'
import { getHandleAvailability, type HandleAvailability } from '../../services/switchboard'
import { HANDLE_RE, normalizeHandle } from '../../utils/profile-form'
import { Field, inputClass } from './field'

const DEBOUNCE_MS = 400
const REASONS: Record<NonNullable<HandleAvailability['reason']>, string> = {
  INVALID: '3–30 lowercase letters, digits or hyphens; no hyphen at the start or end.',
  RESERVED: 'This handle is reserved.',
  TAKEN: 'This handle is taken.',
}


interface HandleFieldProps {
  value: string
  onChange: (value: string) => void
  address: string
  /** The handle the profile already has (always available to its owner). */
  current: string
  /** An error from the last save attempt (e.g. HANDLE_TAKEN), shown until the value changes. */
  serverError?: string
  ensSuggestion?: string | null
}

/** @handle input with a live availability check against the read model. */
export function HandleField({ value, onChange, address, current, serverError, ensSuggestion }: HandleFieldProps) {
  const handle = normalizeHandle(value)
  const needsCheck = !!handle && handle !== current && HANDLE_RE.test(handle)
  // The latest answer; it only counts while it is about the handle in the input.
  const [answer, setAnswer] = useState<HandleAvailability | null>(null)

  useEffect(() => {
    if (!needsCheck) return
    const timer = setTimeout(() => {
      getHandleAvailability(handle, address)
        .then(setAnswer)
        .catch(() => setAnswer(null))
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [needsCheck, handle, address])

  const result = needsCheck && answer?.handle === handle ? answer : null
  const check = !needsCheck
    ? null
    : result
      ? ({ state: 'done', result } as const)
      : ({ state: 'checking' } as const)

  const formatError = handle && !HANDLE_RE.test(handle) ? REASONS.INVALID : undefined
  const availabilityError =
    check?.state === 'done' && !check.result.available && check.result.reason ? REASONS[check.result.reason] : undefined
  const error = formatError ?? availabilityError ?? serverError
  const hint =
    check?.state === 'checking'
      ? 'Checking…'
      : check?.state === 'done' && check.result.available
        ? `renown.id/@${handle} is available.`
        : handle
          ? `Your profile: renown.id/@${handle}`
          : 'Pick a handle to get a short profile URL.'

  return (
    <Field id="handle" label="Handle" error={error} hint={hint}>
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm">@</span>
          <input
            id="handle"
            className={`${inputClass} pl-7`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            maxLength={30}
            aria-invalid={!!error}
            aria-describedby={error ? 'handle-error' : undefined}
            placeholder="your-name"
          />
        </div>
        {ensSuggestion && ensSuggestion !== handle && (
          <button
            type="button"
            onClick={() => onChange(ensSuggestion)}
            className="border-border text-foreground hover:bg-foreground/10 shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors"
          >
            Use @{ensSuggestion}
          </button>
        )}
      </div>
    </Field>
  )
}
```

Create `components/profile-edit/links-editor.tsx` with exactly:

```tsx
import type { ProfileLink } from '../../services/renown-signed-messages'
import { LIMITS } from '../../utils/profile-form'
import { Field, inputClass } from './field'

interface LinksEditorProps {
  links: ProfileLink[]
  onChange: (links: ProfileLink[]) => void
  error?: string
}

const iconButton =
  'text-muted-foreground hover:bg-foreground/10 hover:text-foreground disabled:opacity-30 rounded-md p-2 transition-colors disabled:pointer-events-none'

function newId(): string {
  return typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
}

/** Up to 8 labelled links: add, edit, move up/down, remove. */
export function LinksEditor({ links, onChange, error }: LinksEditorProps) {
  const update = (index: number, patch: Partial<ProfileLink>) =>
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)))
  const move = (index: number, by: -1 | 1) => {
    const next = [...links]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    onChange(next)
  }

  return (
    <Field id="links" group label="Links" error={error} counter={`${links.length}/${LIMITS.links}`} hint="Website, GitHub, X, anything with an https:// address.">
      <ol className="space-y-2">
        {links.map((link, index) => (
          <li key={link.id} className="border-border bg-background/40 flex flex-col gap-2 rounded-lg border p-2 sm:flex-row sm:items-center">
            <input
              className={`${inputClass} sm:w-40`}
              value={link.label}
              maxLength={LIMITS.linkLabel}
              placeholder="Label"
              aria-label={`Link ${index + 1} label`}
              onChange={(e) => update(index, { label: e.target.value })}
            />
            <input
              className={inputClass}
              value={link.url}
              type="url"
              inputMode="url"
              placeholder="https://"
              aria-label={`Link ${index + 1} URL`}
              onChange={(e) => update(index, { url: e.target.value })}
            />
            <div className="flex shrink-0 justify-end">
              <button type="button" className={iconButton} disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move link ${index + 1} up`}>
                ↑
              </button>
              <button type="button" className={iconButton} disabled={index === links.length - 1} onClick={() => move(index, 1)} aria-label={`Move link ${index + 1} down`}>
                ↓
              </button>
              <button type="button" className={`${iconButton} hover:text-destructive`} onClick={() => onChange(links.filter((_, i) => i !== index))} aria-label={`Remove link ${index + 1}`}>
                ✕
              </button>
            </div>
          </li>
        ))}
      </ol>
      {links.length < LIMITS.links && (
        <button
          type="button"
          onClick={() => onChange([...links, { id: newId(), label: '', url: '' }])}
          className="border-border text-foreground hover:bg-foreground/10 mt-2 w-full rounded-lg border border-dashed px-3 py-2 text-sm font-semibold transition-colors"
        >
          + Add link
        </button>
      )}
    </Field>
  )
}
```

Create `components/profile-edit/avatar-cropper.tsx` with exactly:

```tsx
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { cropRect, INITIAL_CROP, MAX_ZOOM, MIN_ZOOM, panBy, renderAvatar, type CropState } from '../../utils/image-crop'

const VIEWPORT = 240

interface AvatarCropperProps {
  image: HTMLImageElement
  onCancel: () => void
  onDone: (blob: Blob) => void
}

/** Square crop: drag to position, slider to zoom; produces a 256×256 WebP. */
export function AvatarCropper({ image, onCancel, onDone }: AvatarCropperProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const [crop, setCrop] = useState<CropState>(INITIAL_CROP)
  const [busy, setBusy] = useState(false)
  const width = image.naturalWidth
  const height = image.naturalHeight

  useEffect(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return
    const { sx, sy, size } = cropRect(width, height, crop)
    context.clearRect(0, 0, VIEWPORT, VIEWPORT)
    context.drawImage(image, sx, sy, size, size, 0, 0, VIEWPORT, VIEWPORT)
  }, [image, width, height, crop])

  function onPointerDown(e: PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY }
  }
  function onPointerMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x
    const dy = e.clientY - drag.current.y
    drag.current = { x: e.clientX, y: e.clientY }
    setCrop((c) => panBy(c, width, height, VIEWPORT, dx, dy))
  }

  async function done() {
    setBusy(true)
    try {
      onDone(await renderAvatar(image, crop))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Crop avatar" className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="border-border bg-background w-full max-w-sm space-y-5 rounded-2xl border p-6 shadow-modal">
        <h2 className="text-foreground text-lg font-semibold">Position your avatar</h2>
        <div className="flex justify-center">
          <canvas
            ref={canvas}
            width={VIEWPORT}
            height={VIEWPORT}
            className="cursor-grab touch-none rounded-full ring-4 ring-white/20 active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
            aria-label="Drag to position"
          />
        </div>
        <label className="text-muted-foreground flex items-center gap-3 text-sm">
          Zoom
          <input
            type="range"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            onChange={(e) => setCrop((c) => ({ ...c, zoom: Number(e.target.value) }))}
            className="accent-primary flex-1"
          />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="text-foreground hover:bg-foreground/10 rounded-lg px-4 py-2 text-sm font-semibold transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void done()}
            disabled={busy}
            className="bg-primary text-primary-foreground hover:bg-primary/80 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {busy ? 'Preparing…' : 'Use this crop'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

Create `components/profile-edit/avatar-uploader.tsx` with exactly:

```tsx
import { useRef, useState, type DragEvent } from 'react'
import { AvatarUploadError, uploadAvatar } from '../../services/avatar-upload'
import { sourceImageProblem } from '../../utils/image-crop'
import { AvatarCropper } from './avatar-cropper'

export type AvatarUploadState = 'idle' | 'uploading' | 'error'

interface AvatarUploaderProps {
  hasAvatar: boolean
  ensAvatar?: string | null
  getBearer: () => Promise<string>
  /** A finished upload: its ref and a local preview URL. */
  onUploaded: (ref: string, previewUrl: string) => void
  onClear: () => void
  onUseEnsAvatar: (url: string) => void
  onBusyChange: (busy: boolean) => void
  error?: string
}

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

/** Drop or pick an image → crop → upload; plus clear and "Use ENS avatar". */
export function AvatarUploader({ hasAvatar, ensAvatar, getBearer, onUploaded, onClear, onUseEnsAvatar, onBusyChange, error }: AvatarUploaderProps) {
  const input = useRef<HTMLInputElement>(null)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [state, setState] = useState<AvatarUploadState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  async function choose(file: File | undefined) {
    if (!file) return
    const problem = sourceImageProblem(file)
    if (problem) {
      setState('error')
      setMessage(problem)
      return
    }
    try {
      setImage(await loadImage(file))
      setMessage(null)
      setState('idle')
    } catch (e) {
      setState('error')
      setMessage(e instanceof Error ? e.message : 'This file could not be read as an image.')
    }
  }

  async function upload(blob: Blob) {
    setImage(null)
    setState('uploading')
    onBusyChange(true)
    try {
      const ref = await uploadAvatar(blob, await getBearer())
      onUploaded(ref, URL.createObjectURL(blob))
      setState('idle')
      setMessage(null)
    } catch (e) {
      setState('error')
      setMessage(
        e instanceof AvatarUploadError && e.code === 'RATE_LIMITED'
          ? 'Too many uploads. Try again in an hour.'
          : e instanceof Error
            ? e.message
            : 'Upload failed.',
      )
    } finally {
      onBusyChange(false)
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    void choose(e.dataTransfer.files[0])
  }

  const shown = message ?? error
  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-4 text-center transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        <p className="text-muted-foreground text-sm">
          {state === 'uploading' ? 'Uploading…' : 'Drop an image here, or'}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={state === 'uploading'}
            className="bg-primary text-primary-foreground hover:bg-primary/80 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
          >
            {hasAvatar ? 'Change avatar' : 'Upload avatar'}
          </button>
          {hasAvatar && (
            <button type="button" onClick={onClear} className="border-border text-foreground hover:bg-foreground/10 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors">
              Remove
            </button>
          )}
          {ensAvatar && (
            <button type="button" onClick={() => onUseEnsAvatar(ensAvatar)} className="border-border text-foreground hover:bg-foreground/10 rounded-lg border px-4 py-2 text-sm font-semibold transition-colors">
              Use ENS avatar
            </button>
          )}
        </div>
        <p className="text-muted-foreground text-xs">PNG, JPEG or WebP, up to 2 MB. Cropped to a square.</p>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          data-testid="avatar-file"
          onChange={(e) => {
            void choose(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </div>
      {shown && (
        <p role="alert" className="text-destructive text-xs">
          {shown}
        </p>
      )}
      {image && <AvatarCropper image={image} onCancel={() => setImage(null)} onDone={(blob) => void upload(blob)} />}
    </div>
  )
}
```

Create `pages/profile/edit.tsx` with exactly:

```tsx
import type { NextPage } from 'next'
import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import type { Hex } from 'viem'
import { useEnsAvatar, useEnsName } from 'wagmi'
import { AvatarUploader } from '../../components/profile-edit/avatar-uploader'
import { Field, inputClass } from '../../components/profile-edit/field'
import { HandleField } from '../../components/profile-edit/handle-field'
import { LinksEditor } from '../../components/profile-edit/links-editor'
import { ProfileSummary } from '../../components/profile/profile-summary'
import PageBackground from '../../components/ui/page-background'
import RenownCard from '../../components/ui/renown-card'
import { useProfileEditorAuth } from '../../hooks/use-profile-editor-auth'
import { profileMessage } from '../../services/renown-signed-messages'
import { getProfile, type RenownProfile } from '../../services/switchboard'
import {
  changedFields,
  formFromProfile,
  formProblems,
  handleFromEns,
  hasChanges,
  LIMITS,
  type FormField,
  type FormProblems,
  type ProfileForm,
} from '../../utils/profile-form'
import { profilePath } from '../../utils/profile-url'

type Toast = { kind: 'success' | 'error'; text: string } | null

const glass =
  'rounded-2xl border border-gray-200 bg-white/80 shadow-2xl backdrop-blur-lg dark:border-white/20 dark:bg-white/10'

function Editor({ address, profileId, signMessage, getBearer }: {
  address: Hex
  profileId: string | null
  signMessage: (message: string) => Promise<Hex>
  getBearer: () => Promise<string>
}) {
  const [loaded, setLoaded] = useState<RenownProfile | null | undefined>(undefined)
  const [initial, setInitial] = useState<ProfileForm>(formFromProfile(null))
  const [form, setForm] = useState<ProfileForm>(formFromProfile(null))
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [serverErrors, setServerErrors] = useState<FormProblems>({})
  const [toast, setToast] = useState<Toast>(null)
  const { data: ensName } = useEnsName({ address, chainId: 1 })
  const { data: ensAvatar } = useEnsAvatar({ name: ensName ?? undefined, chainId: 1 })

  useEffect(() => {
    let cancelled = false
    void getProfile({ driveId: `renown-${address.toLowerCase()}`, ethAddress: address.toLowerCase() }).then((profile) => {
      if (cancelled) return
      const start = formFromProfile(profile)
      setLoaded(profile)
      setInitial(start)
      setForm(start)
    })
    return () => {
      cancelled = true
    }
  }, [address])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(timer)
  }, [toast])

  const ensHandle = useMemo(() => handleFromEns(ensName), [ensName])
  const fields = changedFields(initial, form)
  const problems = { ...formProblems(form), ...serverErrors }
  const documentId = loaded?.documentId ?? profileId

  function set<K extends keyof ProfileForm>(key: K, value: ProfileForm[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    if (key in serverErrors) setServerErrors((e) => ({ ...e, [key as FormField]: undefined }))
  }

  async function save() {
    if (!hasChanges(fields) || Object.values(formProblems(form)).some(Boolean)) return
    setSaving(true)
    setServerErrors({})
    try {
      const timestamp = new Date().toISOString()
      let signature: Hex
      try {
        signature = await signMessage(await profileMessage(address, fields, timestamp))
      } catch {
        setToast({ kind: 'error', text: 'Signature declined — nothing was saved.' })
        return
      }
      const response = await fetch('/api/profile/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, ...fields, signature, timestamp }),
      })
      const body = (await response.json().catch(() => ({}))) as { documentId?: string; error?: string; field?: FormField }
      if (!response.ok) {
        if (body.field) setServerErrors({ [body.field]: body.error ?? 'Invalid value' })
        setToast({ kind: 'error', text: body.error ?? `Saving failed (${response.status}).` })
        return
      }
      setInitial(form)
      setLoaded((p) => ({ ...(p ?? { documentId: body.documentId ?? '' }), documentId: body.documentId ?? p?.documentId ?? '' }))
      setToast({ kind: 'success', text: 'Profile saved.' })
    } finally {
      setSaving(false)
    }
  }

  if (loaded === undefined) {
    return <p className="text-muted-foreground py-24 text-center">Loading your profile…</p>
  }

  const handle = form.handle.trim().toLowerCase()
  const viewHref = documentId ? profilePath({ handle: initial.handle || null, documentId }) : null

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <form
        className={`${glass} space-y-6 p-6 sm:p-8`}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        noValidate
      >
        <div>
          <h1 className="text-foreground text-2xl font-bold">Edit profile</h1>
          <p className="text-muted-foreground text-sm">One signature saves everything below.</p>
        </div>

        <div className="space-y-1.5">
          <span className="text-foreground block text-sm font-semibold">Avatar</span>
          <AvatarUploader
            hasAvatar={!!form.avatar}
            ensAvatar={ensAvatar}
            getBearer={getBearer}
            onBusyChange={setUploading}
            onUploaded={(ref, url) => {
              set('avatar', ref)
              setPreviewUrl(url)
            }}
            onClear={() => {
              set('avatar', null)
              setPreviewUrl(null)
            }}
            onUseEnsAvatar={(url) => {
              set('avatar', null)
              set('userImage', url)
              setPreviewUrl(null)
            }}
            error={serverErrors.avatar}
          />
        </div>

        <Field
          id="displayName"
          label="Display name"
          error={problems.displayName}
          counter={`${form.displayName.trim().length}/${LIMITS.displayName}`}
          hint={ensName ? (
            <button type="button" className="text-accent underline underline-offset-2" onClick={() => set('displayName', ensName)}>
              Use ENS name ({ensName})
            </button>
          ) : 'How your name appears on Renown.'}
        >
          <input
            id="displayName"
            className={inputClass}
            value={form.displayName}
            maxLength={LIMITS.displayName + 10}
            onChange={(e) => set('displayName', e.target.value)}
            aria-invalid={!!problems.displayName}
            placeholder={loaded?.username ?? 'Your name'}
          />
        </Field>

        <HandleField
          value={form.handle}
          onChange={(value) => set('handle', value)}
          address={address}
          current={initial.handle}
          serverError={serverErrors.handle}
          ensSuggestion={!initial.handle ? ensHandle : null}
        />

        <Field id="bio" label="Bio" error={problems.bio} counter={`${form.bio.trim().length}/${LIMITS.bio}`}>
          <textarea
            id="bio"
            className={`${inputClass} min-h-24 resize-y`}
            value={form.bio}
            onChange={(e) => set('bio', e.target.value)}
            aria-invalid={!!problems.bio}
            placeholder="A few words about you"
          />
        </Field>

        <LinksEditor links={form.links} onChange={(links) => set('links', links)} error={problems.links} />

        <div className="border-border flex flex-wrap items-center justify-end gap-3 border-t pt-6">
          {viewHref && (
            <Link href={viewHref} className="text-muted-foreground hover:text-foreground mr-auto text-sm underline underline-offset-4">
              View profile
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              setForm(initial)
              setPreviewUrl(null)
              setServerErrors({})
            }}
            disabled={!hasChanges(fields) || saving}
            className="text-foreground hover:bg-foreground/10 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40"
          >
            Discard
          </button>
          <button
            type="submit"
            disabled={!hasChanges(fields) || saving || uploading || Object.values(formProblems(form)).some(Boolean)}
            className="bg-primary text-primary-foreground hover:bg-primary/80 rounded-lg px-5 py-2 text-sm font-semibold transition-colors disabled:opacity-40"
          >
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Preview">
        <p className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">Preview</p>
        <RenownCard>
          <div className="p-6">
            <ProfileSummary
              profile={{
                documentId,
                address,
                displayName: form.displayName.trim() || null,
                username: loaded?.username,
                handle: handle || null,
                bio: form.bio.trim() || null,
                links: form.links,
                hasAvatar: !!form.avatar,
                userImage: form.userImage,
                previewUrl,
              }}
            />
          </div>
        </RenownCard>
      </aside>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg px-4 py-3 text-sm font-semibold shadow-modal ${
            toast.kind === 'success' ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'
          }`}
        >
          {toast.text}
          {toast.kind === 'success' && viewHref && (
            <Link href={profilePath({ handle: handle || null, documentId: documentId ?? '' })} className="ml-3 underline underline-offset-2">
              View
            </Link>
          )}
        </div>
      )}
    </div>
  )
}

const EditProfilePage: NextPage = () => {
  const auth = useProfileEditorAuth()
  return (
    <PageBackground>
      <Head>
        <title>Edit profile - Renown</title>
        <meta name="robots" content="noindex" />
      </Head>
      <main className="relative mx-auto min-h-screen w-full max-w-5xl px-4 pt-24 pb-16">
        {auth.status === 'loading' && <p className="text-muted-foreground py-24 text-center">Loading…</p>}
        {auth.status === 'signed-out' && (
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
        )}
        {auth.status === 'ready' && (
          <Editor address={auth.address} profileId={auth.profileId} signMessage={auth.signMessage} getBearer={auth.getBearer} />
        )}
      </main>
    </PageBackground>
  )
}

export default EditProfilePage
```

- [ ] **Step 6: Header avatar + "Edit profile".**

```bash
git apply <<'PLAN_EOF'
diff --git a/components/auth/renown-login-button.tsx b/components/auth/renown-login-button.tsx
--- a/components/auth/renown-login-button.tsx
+++ b/components/auth/renown-login-button.tsx
@@ -2,7 +2,8 @@
 
 import { useRenownAuth } from "@powerhousedao/reactor-browser/renown";
 import { useState, useRef, useEffect } from "react";
-import Image from "next/image";
+import Link from "next/link";
+import { ProfileAvatar } from "../profile/profile-avatar";
 
 interface RenownLoginButtonProps {
   className?: string;
@@ -90,21 +91,14 @@ const RenownLoginButton: React.FC<RenownLoginButtonProps> = ({
         onClick={() => setIsDropdownOpen(!isDropdownOpen)}
         className="flex h-10 items-center gap-2 rounded-lg bg-foreground/10 px-3 transition-colors hover:bg-foreground/20"
       >
-        {avatarUrl ? (
-          <Image
-            src={avatarUrl}
-            alt={displayName || user.address}
-            width={24}
-            height={24}
-            className="rounded-full"
-          />
-        ) : (
-          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 to-blue-500">
-            <span className="text-xs font-bold text-white">
-              {(displayName || user.address)[0].toUpperCase()}
-            </span>
-          </div>
-        )}
+        <ProfileAvatar
+          documentId={profileId}
+          hasAvatar={!!profileId}
+          userImage={avatarUrl}
+          seed={user.address}
+          alt={displayName || user.address}
+          className="h-6 w-6"
+        />
         <span className="font-medium text-foreground">
           {displayName || truncateAddress(user.address)}
         </span>
@@ -135,6 +129,27 @@ const RenownLoginButton: React.FC<RenownLoginButtonProps> = ({
             </p>
           </div>
           <div className="py-1">
+            <Link
+              href="/profile/edit"
+              onClick={() => setIsDropdownOpen(false)}
+              className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-foreground/10"
+            >
+              <svg
+                xmlns="http://www.w3.org/2000/svg"
+                width="16"
+                height="16"
+                viewBox="0 0 24 24"
+                fill="none"
+                stroke="currentColor"
+                strokeWidth="2"
+                strokeLinecap="round"
+                strokeLinejoin="round"
+              >
+                <path d="M12 20h9" />
+                <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
+              </svg>
+              Edit profile
+            </Link>
             <button
               onClick={handleViewProfile}
               className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-foreground/10"
PLAN_EOF
```

- [ ] **Step 7: Run the whole suite.** `pnpm exec playwright test` → all PASS (≈ 92 tests). Under full parallelism on a cold dev server the pre-existing `console-page`/`oidc-login` specs can hit their 5 s `toBeVisible` timeouts; re-run those files alone (`pnpm exec playwright test e2e/console-page.spec.ts e2e/oidc-login.spec.ts`) — they must pass there. `pnpm exec tsc --noEmit -p .`, `pnpm lint` → clean; `pnpm build` → succeeds with `ƒ /profile/edit`.

- [ ] **Step 8: Look at it.** With the stub (see Task 8 Step 6), sign in through the web flow with a browser wallet, open `/profile/edit`: drop a large JPEG (crop dialog, drag + zoom), upload (preview updates immediately), type a handle (debounced "available"/"taken"), add/reorder/remove links, watch the preview card, Save (one wallet prompt, toast with "View"), Discard. Check light/dark and 390 px width (form above preview, no horizontal scroll). Fix visual issues before committing.

- [ ] **Step 9: Commit.**

```bash
git add utils/image-crop.ts utils/profile-form.ts services/avatar-upload.ts hooks/use-profile-editor-auth.ts components/profile-edit pages/profile/edit.tsx components/auth/renown-login-button.tsx playwright.config.ts e2e/profile-form.spec.ts e2e/renown-writes.spec.ts
git commit -m "feat(profile): profile editor with avatar upload, handle check and links"
```

## Part C — Rollout (controller-run)

### Task 11: Release Phase 1 to staging *(controller-run: pushes, workflows, hosting)*

Preconditions (Phase 0 / coordinator): `renown-staging` tenant on 6.2.3 with S3 attachments; raw `/attachments/reservations` blocked at the ingress (`tenants/renown-staging/extras/10-block-raw-attachment-uploads.yaml`); bucket CORS for PUT/GET from renown.id + vetra.io origins; renown.id `NEXT_PUBLIC_*` build args per branch.

- [ ] **Step 1: Verify bucket CORS** (no secrets involved):

```bash
curl -s -D - -o /dev/null -X OPTIONS \
  "https://nbg1.your-objectstorage.com/renown-staging-attachments/attachments/00/00/probe" \
  -H "Origin: https://renown-staging.vetra.io" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type,x-amz-checksum-sha256" | grep -i '^access-control-allow'
```

Expected: `access-control-allow-origin: https://renown-staging.vetra.io` and `access-control-allow-methods` containing `PUT`. If absent, stop: the coordinator's bucket-CORS change has not landed.

- [ ] **Step 2: renown-package → `staging` and release.**

```bash
cd /home/f/projects/renown-package-hub
git fetch origin
git switch -C staging origin/staging
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 1 into staging"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run --coverage && pnpm build
git push git@github.com:powerhouse-inc/renown-package.git staging
gh workflow run sync-and-publish.yml -R powerhouse-inc/renown-package --ref staging -f channel=staging -f sync=false
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown-package --workflow sync-and-publish.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown-package "$RUN" --exit-status
git switch feat/identity-hub
```

Expected: semantic-release cuts a `v1.(n+1).0-staging.N` (the `feat:` commits), images `cr.vetra.io/renown/{switchboard,connect}:<that tag>` are pushed, and the deploy job commits `deploy: update tenants/renown-staging to …` touching only `tenants/renown-staging/powerhouse-values.yaml`.

- [ ] **Step 3: Confirm the switchboard rolled and the routes answer.**

```bash
git -C /home/f/projects/powerhouse-k8s-hosting pull --ff-only
grep -n "tag:" /home/f/projects/powerhouse-k8s-hosting/tenants/renown-staging/powerhouse-values.yaml
kubectl -n renown-staging get pods
kubectl -n renown-staging logs deploy/switchboard --since=10m | grep -E "renown-media|RenownUserProcessor" || true
SB=https://switchboard.renown-staging.vetra.io/api/@powerhousedao/renown-package
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SB/media/uploads" -H 'content-type: application/json' -d '{}'   # 401
curl -s -o /dev/null -w "%{http_code}\n" "$SB/media/nope/avatar"                                                    # 404
curl -s https://switchboard.renown-staging.vetra.io/graphql -H 'content-type: application/json' \
  -d '{"query":"{ renownHandleAvailability(handle:\"admin\"){ available reason } }"}'                               # RESERVED
```

(If the deployment is not named `switchboard`, use the name from `kubectl -n renown-staging get deploy`.) No `[renown-media] … disabled` line may appear.

- [ ] **Step 4: renown.id → `deploy/staging`, then pin the image.**

```bash
cd /home/f/projects/renown-hub
git fetch origin
git switch -C deploy/staging origin/deploy/staging
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 1 into deploy/staging"
git push git@github.com:powerhouse-inc/renown.git deploy/staging
SHA7=$(git rev-parse --short=7 HEAD)
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown --workflow semantic-release.yml --branch deploy/staging -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown "$RUN" --exit-status
git switch feat/identity-hub
cd /home/f/projects/powerhouse-k8s-hosting
sed -i -E "s/^(    tag: )staging-[0-9a-f]{7}$/\1staging-${SHA7}/" tenants/renown-staging/powerhouse-values.yaml
git diff --stat   # exactly one line changed in tenants/renown-staging/powerhouse-values.yaml (app.image.tag)
git add tenants/renown-staging/powerhouse-values.yaml
git commit -m "chore(renown-staging): renown-app staging-${SHA7} (identity hub phase 1)"
git push
```

Expected: image `cr.vetra.io/renown/renown-app:staging-${SHA7}` exists (workflow summary), ArgoCD rolls the `app` pod; `curl -s -o /dev/null -w "%{http_code}\n" https://renown-staging.vetra.io/profile/edit` → `200`.

### Task 12: Verify Phase 1 on staging *(controller-run)*

- [ ] **Step 1: Scripted end-to-end.** `cd /home/f/projects/renown-package-hub && node scripts/smoke/identity-profile.ts` → every step logged and `OK`: gates 401/415/413, **length pinning: PUT refused**, upload, one signed save, read model by handle, `INVALID_AVATAR`, `HANDLE_TAKEN`, switchboard media 302 → identical bytes, renown.id `/media` 302, `/@smoke-xxxxxx` 200, `/profile/<doc>` → 307 `/@smoke-xxxxxx`, cleanup. Also run `node scripts/smoke/attachment-upload.ts --reserve-path /api/@powerhousedao/renown-package/media/uploads` → `OK` (anonymous 401, gated reserve + S3 PUT), and `curl -s -o /dev/null -w "%{http_code}\n" -X POST https://switchboard.renown-staging.vetra.io/attachments/reservations` → `403` from the ingress block, never `401`.
- [ ] **Step 2: Real browser pass** (a person with a wallet): on `https://renown-staging.vetra.io` sign in from the header, open "Edit profile", upload a photo (crop, zoom), set display name, handle, bio, two links, Save (one signature). Then: header shows the new avatar; `/@<handle>` shows avatar, name, @handle, bio, links, address copy, member since; sharing `/@<handle>` in a link-preview debugger shows `og:image`; "Use ENS avatar" / "Remove" and a second save work; a second wallet cannot take the same handle (inline "This handle is taken."). Log out and back in: the edited name/avatar are **not** overwritten by ENS.
- [ ] **Step 3: Record** the smoke output (minus addresses) and the browser findings in the PR/hand-off note. Anything broken goes back to the owning task before Task 13.

### Task 13: Promote to production *(controller-run)*

- [ ] **Step 1: Bucket CORS on prod** — Task 11 Step 1 with bucket `renown-attachments` and origin `https://www.renown.id` (and `https://renown.vetra.io`); stop if missing.
- [ ] **Step 2: renown-package → `main`, release `latest`.**

```bash
cd /home/f/projects/renown-package-hub
git fetch origin
git switch -C main origin/main
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 1"
pnpm install --frozen-lockfile && pnpm tsc && pnpm lint && pnpm exec vitest run --coverage && pnpm build
git push git@github.com:powerhouse-inc/renown-package.git main
gh workflow run sync-and-publish.yml -R powerhouse-inc/renown-package --ref main -f channel=latest -f sync=false
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown-package --workflow sync-and-publish.yml -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown-package "$RUN" --exit-status
git switch feat/identity-hub
```

Expected: release `v1.(n+1).0`, deploy commit touches only `tenants/renown/powerhouse-values.yaml`; prod pods roll; the Task 11 Step 3 curls against `https://switchboard.renown.vetra.io` give 401 / 404 / `RESERVED`.

- [ ] **Step 3: renown.id → `main`.**

```bash
cd /home/f/projects/renown-hub
git fetch origin
git switch -C main origin/main
git merge --no-ff feat/identity-hub -m "chore: merge identity hub phase 1"
git push git@github.com:powerhouse-inc/renown.git main
sleep 5; RUN=$(gh run list -R powerhouse-inc/renown --workflow semantic-release.yml --branch main -L 1 --json databaseId -q '.[0].databaseId')
gh run watch -R powerhouse-inc/renown "$RUN" --exit-status
VERSION=$(git fetch --tags -q && git describe --tags --abbrev=0 origin/main)   # e.g. v1.19.0
git switch feat/identity-hub
cd /home/f/projects/powerhouse-k8s-hosting
sed -i -E "s/^(    tag: )1\.[0-9]+\.[0-9]+$/\1${VERSION#v}/" tenants/renown/powerhouse-values.yaml
git diff --stat   # exactly one line: app.image.tag in tenants/renown/powerhouse-values.yaml
git add tenants/renown/powerhouse-values.yaml
git commit -m "chore(renown): renown-app ${VERSION#v} (identity hub phase 1)"
git push
```

Vercel deploys `www.renown.id` from `main` on its own; wait for it (`curl -s -o /dev/null -w "%{http_code}\n" https://www.renown.id/profile/edit` → 200).

- [ ] **Step 4: Prod smoke.** `node scripts/smoke/identity-profile.ts --switchboard https://switchboard.renown.vetra.io --app https://www.renown.id --allow-prod` → `OK`. Then the Task 12 Step 2 browser pass on `https://www.renown.id` with a real account; check that an existing profile created before Phase 1 still renders (no handle → stays on `/profile/<doc>`, identicon or ENS image).

## Follow-up F1 (not in this plan): sweep unreferenced uploads

Uploads that never become an avatar stay in the bucket. Next step, owned by renown-package: record each reservation of `POST media/uploads` in a `renown_media_upload(hash, uploader, purpose, declared_size, created_at)` table (renown-user namespace); an hourly timer started in `media/register.ts` deletes S3 objects for rows older than 24 h whose hash is referenced by no `renown_user.avatar_ref` (and, from Phase 2, no app-profile `logo_ref`/`cover_ref`), using `DeleteObjectCommand` with the same S3 settings, then drops the row. Until then the length-pinned, rate-limited route bounds the exposure (≤ 20 × 2 MB per identity per hour).
