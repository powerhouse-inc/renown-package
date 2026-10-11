# renown.id Verify and People Search — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give renown-package the four backend pieces renown.id's `/verify` and `/people` need: `renownCredentials(credentialId)`, an opt-in `listed` flag on renown-user profiles (model, signed upsert, read model), and the public `renownUserSearch` query.

**Architecture:** `listed` is added in place to renown-user v1 (state field + `SET_LISTED` in the `profile` module, exactly like the identity fields in 603bd65), signed through `renown_upsertProfile` as an eighth payload key that only exists when sent (so every stored signature keeps its hash), mirrored into a `listed boolean not null default false` column of the `renown_user` read model with two partial `text_pattern_ops` indexes, and searched by a new read-model resolver that prefix-matches `LOWER(handle)`/`LOWER(display_name)` among listed rows with a keyset cursor. `renownCredentials` gains one exact-match `where` on `credential_id`.

**Tech Stack:** TypeScript (nodenext, strict), Powerhouse reactor package 6.2.3 (`ph-cli generate`, `RelationalDbProcessor`, `BaseSubgraph`), Kysely 0.28 on Postgres (PGlite in tests), graphql-tag SDL, viem, vitest, oxlint (type-aware).

**Spec:** `docs/superpowers/specs/2026-10-11-renown-verify-people-quality-design.md` — "3 … Backend (renown-package)", "4 … Backend (renown-package)", "Global constraints", the backend line of "Testing", "Rollout". The website side (renown.id) is a separate plan; it consumes "Interfaces produced" below.

## Interfaces produced

All fields are on the supergraph `<switchboard>/graphql` (read model also on `/graphql/renown-read-model`, auth on `/graphql/renown-auth`). Reads are public (no auth), like the existing `renownUser`.

### Read model (`subgraphs/renown-read-model/schema.ts`)

```graphql
type ReadRenownUser {
  # existing fields unchanged, plus:
  "Opted in to people search (renownUserSearch)"
  listed: Boolean!
}

"A page of renownUserSearch; pass next as after for the following page (null at the end)."
type RenownUserSearchPage {
  items: [ReadRenownUser!]!
  next: String
}

input RenownCredentialsInput {
  driveId: String
  "Exact VC id (e.g. urn:uuid:...); works alone or with the other filters. An empty string matches nothing."
  credentialId: String
  ethAddress: String
  did: String
  issuer: String
  includeRevoked: Boolean
}

type Query {
  # existing fields unchanged, plus:
  """
  People search: listed profiles whose handle or display name starts with
  query (trimmed, 2-40 characters, case-insensitive; % and _ are literal),
  ordered by handle (profiles without one last), then document id.
  limit 1-50 (default 20). Errors: BAD_USER_INPUT (extensions.field is
  query, limit or after).
  """
  renownUserSearch(query: String!, limit: Int, after: String): RenownUserSearchPage!
}
```

Error contract (`errors[].extensions`):

| Field | `code` | `field` | When |
| --- | --- | --- | --- |
| `renownUserSearch` | `BAD_USER_INPUT` | `query` | trimmed query shorter than 2 or longer than 40 characters (Unicode code points, so one emoji is 1) |
| `renownUserSearch` | `BAD_USER_INPUT` | `limit` | `limit` not an integer in 1–50 (absent/null = 20) |
| `renownUserSearch` | `BAD_USER_INPUT` | `after` | `after` is not a cursor this query produced |
| `renownCredentials` | (validation) | — | unchanged; an old server answers `GRAPHQL_VALIDATION_FAILED` for `credentialId` |

Queries the website will send:

```graphql
query CredentialById($id: String!) {
  renownCredentials(input: { credentialId: $id }) {
    credentialId issuerEthereumAddress credentialSubjectId expirationDate revoked revokedAt revocationReason
  }
}
query People($q: String!, $after: String) {
  renownUserSearch(query: $q, limit: 24, after: $after) {
    items { documentId ethAddress handle displayName bio avatar userImage listed }
    next
  }
}
```

### Write (`subgraphs/renown-auth/schema.ts`)

```graphql
renown_upsertProfile(
  address: String!
  username: String
  userImage: String
  displayName: String
  handle: String
  bio: String
  links: [RenownProfileLinkInput!]
  avatar: String
  listed: Boolean          # new: true/false opts in/out; absent or null = unchanged
  signature: String
  timestamp: String
): String
```

### Document model (`powerhouse/renown-user` v1, module `profile`)

```graphql
type RenownUserState {
  # existing fields unchanged, plus:
  "Opted in to people search; documents created before the field existed have no value, read as false"
  listed: Boolean
}

# operation SET_LISTED (scope global, no errors)
input SetListedInput {
  "true lists the profile in people search, false removes it"
  listed: Boolean!
}
```

Initial value gains `"listed": false`. Action creator: `actions.setListed({ listed: boolean })` from `document-models/renown-user`.

### Signed profile message (renown.id must match byte-for-byte)

`profileMessage(address, fields, timestamp)` = `Update Renown profile <lowercased address> <sha256 hex of profilePayload(fields)> at <timestamp>`.

`profilePayload` rule after this plan: if every one of `displayName, handle, bio, links, avatar, listed` is null/undefined → legacy `{"username":…,"userImage":…}`; otherwise the seven keys `username, userImage, displayName, handle, bio, links, avatar` in that order, then `"listed"` as an eighth key **only when `listed` is a boolean**. `listed: null` behaves exactly like absent.

Test vectors, all with address `0xABC0000000000000000000000000000000000001` and timestamp `2026-10-11T12:00:00.000Z` (`FULL` = `{ displayName: "Frank", handle: "frank", bio: "Hi", links: [{ id: "l1", label: "Site", url: "https://frank.example" }], avatar: "attachment://v1:" + "a".repeat(64) }`):

| Fields | Payload JSON | sha256 |
| --- | --- | --- |
| `{ username: "frank" }` (unchanged) | `{"username":"frank","userImage":null}` | `e586dca7432283bd3bc606f7650606a0407f43f27843c738a82b9146603e6130` |
| `FULL` (unchanged) | `{"username":null,"userImage":null,"displayName":"Frank","handle":"frank","bio":"Hi","links":[{"id":"l1","label":"Site","url":"https://frank.example"}],"avatar":"attachment://v1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}` | `4580e73ddd79972b5dd50d52aae493f1caed7a4025ec04ad402fd54c4a86ff55` |
| `{ ...FULL, listed: null }` | same as `FULL` | `4580e73ddd79972b5dd50d52aae493f1caed7a4025ec04ad402fd54c4a86ff55` |
| `{ listed: true }` | `{"username":null,"userImage":null,"displayName":null,"handle":null,"bio":null,"links":null,"avatar":null,"listed":true}` | `0a46ac991ff7e91d94d7d2ddff022fcbca86fcf7905fa09f77e46a3a3f5b93e0` |
| `{ listed: false }` | `{"username":null,"userImage":null,"displayName":null,"handle":null,"bio":null,"links":null,"avatar":null,"listed":false}` | `16dcce85d96df385580015dad07cf92524375040055ad19d9224022995a6e687` |
| `{ ...FULL, listed: true }` | `FULL`'s JSON with `,"listed":true` before the closing `}` | `ada9fa9d37a3d9f1b21e466272c02b4b136fec97e2fa57a11ed85dc814fa5296` |
| `{ username: "frank", listed: false }` | `{"username":"frank","userImage":null,"displayName":null,"handle":null,"bio":null,"links":null,"avatar":null,"listed":false}` | `cf1c6b7c982d816646bbebc956e6d0c32da3b478bc01f90e1957cc3d981a24cc` |

So, e.g., `profileMessage(addr, { listed: true }, "2026-10-11T12:00:00.000Z")` = `Update Renown profile 0xabc0000000000000000000000000000000000001 0a46ac991ff7e91d94d7d2ddff022fcbca86fcf7905fa09f77e46a3a3f5b93e0 at 2026-10-11T12:00:00.000Z`. renown.id's copy (`services/renown-signed-messages.ts`, today byte-identical in `profilePayload`) must apply the same three-line change shown in Task 3 Step 3.

## Planner rulings (binding for this plan)

1. **Model change in place, by JSON + codegen.** Like 603bd65 and the identity-hub phase-1 plan: edit `document-models/renown-user/renown-user.json`, run `pnpm generate document-model --document …`, restore the files the generator rewrites but must not change. No version bump, no upgrade transition.
2. **`listed: Boolean` (nullable) in the state**, as the spec writes it, initial `false`. Profiles created before this change have no key at all; everything downstream treats missing/null as not listed (read model column defaults to `false`). `SET_LISTED` takes `listed: Boolean!` and has no operation errors (the input schema already rejects a non-boolean, and any boolean is valid), so there is no error branch to cover.
3. **`listed` counts as an identity field for the legacy check.** `{ listed: true }` alone hashes the seven-key form plus `listed`; otherwise an opt-in sent without other identity fields would hash the two-key legacy payload and the flag would not be covered by the signature. Every payload without a boolean `listed` is unchanged.
4. **Upsert semantics.** `listed` absent/null = unchanged; `true`/`false` dispatches `SET_LISTED` every time it is sent (like the other scalar fields, no diffing), after `SET_AVATAR`. Listing does not require a handle or display name; such a profile simply never matches a search.
5. **`credentialId` filter** is exact (case-sensitive, untrimmed) and tested with `!= null`, so `""` matches nothing instead of disabling the filter; it ANDs with every other filter. (An empty input `{}` still returns every credential — pre-existing behaviour, out of scope.)
6. **Search semantics.** Query trimmed; length counted in code points. Prefix of the whole handle or display name (not of later words: "smith" does not find "Alice Smith"). Both sides lowered by Postgres (`LOWER(col) LIKE LOWER($pattern) ESCAPE '\'`), with `\`, `%`, `_` escaped in the pattern. Order `LOWER(handle) COLLATE "C" ASC NULLS LAST, document_id COLLATE "C"`, so handle-less listed profiles (found by display name) come last and the keyset never depends on the database locale. Cursor = base64url of `{"h": <lower(handle)|null>, "d": <documentId>}`; it is not bound to the query (another query's cursor merely positions). `limit` outside 1–50 is `BAD_USER_INPUT` (the `appProfiles` convention), not clamped.
7. **Indexes** are built with Kysely's schema builder (`createIndex(...).expression(sql\`LOWER(handle) text_pattern_ops\`).where(sql.ref("listed"), "=", true)`) so `withSchema(namespace)` still applies — raw `sql` would create them in `public` (the dd9a802 lesson). No `pg_trgm`.
8. **Privacy.** Search returns `ReadRenownUser`, which has no email, credentials or approvals; `renownUser`/`renownUsers` keep finding unlisted profiles (and now show `listed`).

## Global Constraints

- People search returns only profiles with `listed = true`; direct profile lookups are unchanged; no email, credentials or approvals are ever exposed.
- Profile signature compatibility: existing signed messages and stored signatures stay valid.
- Backend ships before the website that needs it; staging before prod.
- Do not add `pg_trgm`.
- Never edit `gen/` files by hand; restore codegen side effects outside `gen/`, `schema.graphql` and the model JSON.
- Reducers stay at ≥ 95 % coverage (lines, branches, functions, statements); `pnpm tsc`, `pnpm lint` and `pnpm test` are green after every task.
- Relative imports carry `.js`; no `@/` alias.

## Review Focus

1. **`renownCredentials(input: { credentialId: "" })`** — a website bug or an empty paste must not dump every credential; expected `[]`. Pinned in Task 4 ("treats an empty credentialId …").
2. **An older renown.id signing without `listed` while the request carries `listed: true`** (or a `listed: false` signature replayed as `true`) — expected `FORBIDDEN`, nothing written. Pinned in Task 3 ("rejects listed under a signature that did not cover it").
3. **Paging through matches that include handle-less profiles** (display-name matches, `handle` NULL) — expected every match exactly once, in order, across the NULL boundary. Pinned in Task 5 ("pages with a keyset cursor across the profiles without a handle").
4. **Queries whose length differs in code points vs UTF-16 units** (a single emoji, `"😀😀"`) — expected one emoji refused, two accepted. Pinned in Task 5 (the emoji rows).
5. **A profile document or read-model row from before `listed` existed** — expected `SET_LISTED` applies to the old document and the boot-time `up()` adds the column with `false` to existing rows. Pinned in Task 1 ("accepts SET_LISTED on a document created before the field existed") and Task 2 ("adds listed (default false) to an existing table on a re-run").

## File Structure

| File | Responsibility |
| --- | --- |
| `document-models/renown-user/renown-user.json` | model spec: `listed` state field, initial value, `SET_LISTED` (codegen input) |
| `document-models/renown-user/v1/gen/**`, `v1/schema.graphql` | regenerated, never hand-edited |
| `document-models/renown-user/v1/src/reducers/profile.ts` | `setListedOperation` |
| `document-models/renown-user/v1/tests/listed.test.ts` (new) | reducer tests |
| `processors/renown-user/schema.ts`, `migrations.ts`, `processor.ts` | `listed` column, partial indexes, `SET_LISTED` indexing |
| `processors/tests/renown-user-listed.test.ts` (new) | migration re-run, indexes, processor |
| `subgraphs/renown-auth/core/signed-message.ts` | `ProfileFields.listed`, payload rule |
| `subgraphs/renown-auth/core/profile-patch.ts` | `IdentityPatch.listed`, `SET_LISTED` action |
| `subgraphs/renown-auth/schema.ts`, `resolvers.ts` | `renown_upsertProfile(listed)` and signing it |
| `subgraphs/renown-auth/tests/profile-identity.test.ts`, `resolvers.test.ts` | vectors, upsert tests, SDL signature |
| `subgraphs/renown-read-model/search.ts` (new) | search argument parsing, LIKE escaping, cursor, the SQL |
| `subgraphs/renown-read-model/schema.ts`, `resolvers.ts` | `credentialId`, `listed`, `renownUserSearch` wiring |
| `subgraphs/renown-read-model/tests/credentials.test.ts`, `search.test.ts` (new) | read-model tests |
| `scripts/smoke/people-search.ts` (new), `scripts/smoke/README.md` | read-only staging/prod smoke |

Setup for every task: work on a branch `feat/verify-people-backend` cut from `origin/main` (`git switch -c feat/verify-people-backend origin/main`, then `pnpm install --frozen-lockfile`). Baseline on `origin/main` (b863162): 50 test files, 617 tests, all passing.

---

### Task 1: renown-user model — `listed` and `SET_LISTED`

**Files:**
- Modify: `document-models/renown-user/renown-user.json` (state schema, initial value, one operation)
- Regenerate: `document-models/renown-user/v1/gen/**`, `document-models/renown-user/v1/schema.graphql`
- Modify: `document-models/renown-user/v1/src/reducers/profile.ts` (end of `renownUserProfileOperations`)
- Test: `document-models/renown-user/v1/tests/listed.test.ts` (new)

**Interfaces:**
- Consumes: nothing.
- Produces: `RenownUserState.listed?: boolean | null`; action creator `setListed({ listed: boolean })` exported from `document-models/renown-user` and `document-models/renown-user/v1` (and as `actions.setListed`); action type `"SET_LISTED"` with input `{ listed: boolean }`.

- [ ] **Step 1: Add the field and the operation to the model spec**

Run from the repo root (the file has no trailing newline; keep it that way):

```bash
python3 - <<'PY'
import json
p = "document-models/renown-user/renown-user.json"
d = json.load(open(p))
s = d["specifications"][0]
g = s["state"]["global"]
old = '  "Uploaded avatar; userImage stays the external (ENS) image URL"\n  avatar: AttachmentRef\n}'
assert g["schema"].count(old) == 1
g["schema"] = g["schema"].replace(old, '  "Uploaded avatar; userImage stays the external (ENS) image URL"\n  avatar: AttachmentRef\n  "Opted in to people search; documents created before the field existed have no value, read as false"\n  listed: Boolean\n}')
iv = json.loads(g["initialValue"]); iv["listed"] = False
g["initialValue"] = json.dumps(iv, indent=2)
s["modules"][0]["operations"].append({
    "id": "set-listed", "name": "SET_LISTED",
    "description": "Opts the profile in to (true) or out of (false) people search",
    "schema": "input SetListedInput {\n  \"true lists the profile in people search, false removes it\"\n  listed: Boolean!\n}",
    "template": "", "reducer": "", "errors": [], "examples": [], "scope": "global",
})
open(p, "w").write(json.dumps(d, indent=2))
PY
git diff --stat
```

Expected: only `renown-user.json` changes (about 14 insertions, 3 deletions).

- [ ] **Step 2: Regenerate and restore the generator's side effects**

```bash
pnpm generate document-model --document document-models/renown-user/renown-user.json
git checkout -- powerhouse.manifest.json document-models/renown-user/v1/src document-models/renown-user/v1/tests
git diff --stat
```

Expected after the checkout: changes only in `renown-user.json`, `v1/gen/{document-model,ph-factories,reducer,utils}.ts`, `v1/gen/profile/{actions,creators,operations}.ts`, `v1/gen/schema/{types,zod}.ts` and `v1/schema.graphql`. (The generator also reformats `v1/src/**`, adds a stub to `profile.ts`, appends mock tests to `profile.test.ts` and reorders `powerhouse.manifest.json`; the checkout drops all of that. `pnpm tsc` now fails with "Property 'setListedOperation' is missing" — Step 5 fixes it.)

- [ ] **Step 3: Write the failing test**

Create `document-models/renown-user/v1/tests/listed.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { reducer, setHandle, setListed, utils } from "document-models/renown-user/v1";

describe("RenownUser listed (people search opt-in)", () => {
  it("starts unlisted, opts in and out again", () => {
    let d = utils.createDocument();
    expect(d.state.global.listed).toBe(false);

    d = reducer(d, setListed({ listed: true }));
    expect(d.state.global.listed).toBe(true);
    d = reducer(d, setListed({ listed: true }));
    expect(d.state.global.listed).toBe(true);
    d = reducer(d, setListed({ listed: false }));
    expect(d.state.global.listed).toBe(false);
    expect(d.operations.global.map((op) => op.error)).toEqual([undefined, undefined, undefined]);
  });

  it("accepts SET_LISTED on a document created before the field existed", () => {
    let d = utils.createDocument();
    // A profile written before `listed` existed has no key at all.
    const legacy = d.state.global as { listed?: boolean | null };
    delete legacy.listed;
    d = reducer(d, setHandle({ handle: "frank" }));
    expect("listed" in d.state.global).toBe(false);

    d = reducer(d, setListed({ listed: true }));
    expect(d.operations.global.map((op) => op.error)).toEqual([undefined, undefined]);
    expect(d.state.global).toMatchObject({ handle: "frank", listed: true });
  });

  it("the action creator refuses a listed that is not a boolean (input validation, not a reducer error)", () => {
    const d = utils.createDocument();
    expect(() => reducer(d, setListed({ listed: null as unknown as boolean }))).toThrow();
    expect(d.state.global.listed).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `pnpm vitest run document-models/renown-user/v1/tests/listed.test.ts`
Expected: 2 failed, 1 passed — "starts unlisted …" fails with `expected false to be true` and the legacy test with `expected [ undefined, …(1) ] to deeply equal [ undefined, undefined ]` (the generated reducer calls a `setListedOperation` that does not exist yet, so the operation records an error).

- [ ] **Step 5: Implement the reducer**

In `document-models/renown-user/v1/src/reducers/profile.ts`, add after `reorderLinksOperation` (last entry of `renownUserProfileOperations`):

```ts
  setListedOperation(state, action) {
    // Profiles created before `listed` existed carry no key; assigning adds it.
    state.listed = action.input.listed;
  },
```

- [ ] **Step 6: Run the model tests, types and coverage**

Run: `pnpm vitest run document-models/renown-user && pnpm tsc && pnpm vitest run --coverage document-models 2>&1 | grep -E "All files|profile.ts"`
Expected: all renown-user tests pass (25), `tsc` silent, `profile.ts` 100 % in every column.

- [ ] **Step 7: Commit**

```bash
git add document-models/renown-user
git commit -m "feat(renown-user): listed field and SET_LISTED"
```

---

### Task 2: Read model — `listed` column, partial search indexes, `SET_LISTED`

**Files:**
- Modify: `processors/renown-user/schema.ts` (`RenownUser` interface)
- Modify: `processors/renown-user/migrations.ts` (end of `up()`, start of `down()`)
- Modify: `processors/renown-user/processor.ts` (`UpdateData`, the `switch` in `applyOperation`)
- Test: `processors/tests/renown-user-listed.test.ts` (new)

**Interfaces:**
- Consumes: action type `"SET_LISTED"` with input `{ listed: boolean }` (Task 1).
- Produces: column `renown_user.listed boolean not null default false` (Kysely type `listed: Generated<boolean>`); indexes `idx_renown_user_listed_handle` on `LOWER(handle) text_pattern_ops WHERE listed = true` and `idx_renown_user_listed_display_name` on `LOWER(display_name) text_pattern_ops WHERE listed = true`.

- [ ] **Step 1: Write the failing test**

Create `processors/tests/renown-user-listed.test.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { OperationWithContext } from "@powerhousedao/reactor-browser";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenownUserProcessor } from "../renown-user/index.js";
import { up } from "../renown-user/migrations.js";
import type { DB } from "../renown-user/schema.js";

const NS = "listed";
const FILTER = { branch: ["main"], documentId: ["*"], documentType: [], scope: ["global"] };
let root: Kysely<DB>;
let processor: RenownUserProcessor;

beforeAll(async () => {
  root = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(NS)}`.execute(root);
  // A table as it existed before `listed`: the old migration ran, one row exists.
  await up(root.withSchema(NS) as never);
  await sql`alter table ${sql.id(NS)}.renown_user drop column if exists listed`.execute(root);
  await root.withSchema(NS).insertInto("renown_user").values({
    document_id: "old", username: null, eth_address: null, user_image: null,
  } as never).execute();
  // Boot again: up() re-runs against the existing table.
  await up(root.withSchema(NS) as never);
  await up(root.withSchema(NS) as never);
  processor = new RenownUserProcessor(NS, FILTER, root.withSchema(NS) as never);
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

async function listed(documentId: string): Promise<boolean> {
  const row = await root.withSchema(NS).selectFrom("renown_user").select("listed")
    .where("document_id", "=", documentId).executeTakeFirstOrThrow();
  return row.listed;
}

describe("renown-user read model: listed", () => {
  it("adds listed (default false) to an existing table on a re-run", async () => {
    expect(await listed("old")).toBe(false);
  });

  it("creates the partial prefix indexes for people search", async () => {
    const { rows } = await sql<{ indexname: string; indexdef: string }>`
      select indexname, indexdef from pg_indexes
      where schemaname = ${NS} and indexname like 'idx_renown_user_listed_%' order by indexname`.execute(root);
    expect(rows.map((r) => r.indexname)).toEqual([
      "idx_renown_user_listed_display_name",
      "idx_renown_user_listed_handle",
    ]);
    for (const { indexdef } of rows) {
      expect(indexdef).toMatch(/text_pattern_ops/);
      expect(indexdef).toMatch(/WHERE \(listed = true\)/);
    }
  });

  it("indexes SET_LISTED, creating the row when it is the first operation", async () => {
    await processor.onOperations([op("u1", "SET_LISTED", { listed: true })]);
    expect(await listed("u1")).toBe(true);
    await processor.onOperations([
      op("u1", "SET_LISTED", { listed: false }),
      op("u1", "SET_LISTED", { listed: true }, "SomeError"),
    ]);
    expect(await listed("u1")).toBe(false);
  });

  it("leaves listed alone for other operations", async () => {
    await processor.onOperations([
      op("u2", "SET_LISTED", { listed: true }),
      op("u2", "SET_DISPLAY_NAME", { displayName: "Ann" }),
      op("u2", "SET_HANDLE", { handle: "ann" }),
    ]);
    expect(await listed("u2")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run processors/tests/renown-user-listed.test.ts`
Expected: 4 failed (`column "listed" does not exist`, no indexes found).

- [ ] **Step 3: Add the column type**

In `processors/renown-user/schema.ts`, interface `RenownUser`, after `links: Generated<Json<RenownUserLinkRow[]>>;` add:

```ts
  /** Opted in to people search (renownUserSearch); false until SET_LISTED true. */
  listed: Generated<boolean>;
```

- [ ] **Step 4: Migrate (idempotent; `up()` re-runs on every boot)**

In `processors/renown-user/migrations.ts`, append to the end of `up()` (after the `idx_renown_user_handle_lower` block):

```ts

  // People search (opt-in). Additive and idempotent like the identity
  // columns; existing rows read as not listed.
  await db.schema
    .alterTable("renown_user")
    .addColumn("listed", "boolean", (col) => col.ifNotExists().notNull().defaultTo(false))
    .execute();

  // renownUserSearch prefix-matches LOWER(handle) / LOWER(display_name) with
  // LIKE 'q%' among listed profiles only. text_pattern_ops lets LIKE use the
  // index whatever the database collation; the partial WHERE keeps the
  // indexes as small as the opted-in set.
  await db.schema
    .createIndex("idx_renown_user_listed_handle")
    .on("renown_user")
    .expression(sql`LOWER(handle) text_pattern_ops`)
    .where(sql.ref("listed"), "=", true)
    .ifNotExists()
    .execute();
  await db.schema
    .createIndex("idx_renown_user_listed_display_name")
    .on("renown_user")
    .expression(sql`LOWER(display_name) text_pattern_ops`)
    .where(sql.ref("listed"), "=", true)
    .ifNotExists()
    .execute();
```

and make these the first two lines of `down()`:

```ts
  await db.schema.dropIndex("idx_renown_user_listed_display_name").ifExists().execute();
  await db.schema.dropIndex("idx_renown_user_listed_handle").ifExists().execute();
```

- [ ] **Step 5: Index the operation**

In `processors/renown-user/processor.ts`: add `listed?: boolean;` to `interface UpdateData` (after `avatar_ref?: string | null;`), and in the `switch (operation.action.type)` of `applyOperation`, after the `SET_AVATAR` case:

```ts
      case "SET_LISTED":
        updateData.listed = input.listed === true;
        break;
```

- [ ] **Step 6: Run the processor tests and types**

Run: `pnpm vitest run processors && pnpm tsc`
Expected: 16 passed; `tsc` silent.

- [ ] **Step 7: Commit**

```bash
git add processors/renown-user processors/tests/renown-user-listed.test.ts
git commit -m "feat(renown-user read model): listed column, SET_LISTED and search indexes"
```

---

### Task 3: `renown_upsertProfile(listed)` and the signed payload

**Files:**
- Modify: `subgraphs/renown-auth/core/signed-message.ts` (`ProfileFields`, `profilePayload`)
- Modify: `subgraphs/renown-auth/core/profile-patch.ts` (`IdentityPatch`, `toIdentityPatch`, `identityActions`)
- Modify: `subgraphs/renown-auth/resolvers.ts:92-103` (`UpsertProfileArgs`) and the `profileMessage(…)` call in `renown_upsertProfile` (~line 405)
- Modify: `subgraphs/renown-auth/schema.ts` (`renown_upsertProfile` doc string and arguments)
- Test: `subgraphs/renown-auth/tests/profile-identity.test.ts` (append), `subgraphs/renown-auth/tests/resolvers.test.ts:317` (SDL signature)

**Interfaces:**
- Consumes: `actions.setListed` / `setListed({ listed: boolean })` from `document-models/renown-user` (Task 1); the `listed` read-model column (Task 2) — the tests read it through the real processor.
- Produces: `ProfileFields.listed?: boolean | null`; `IdentityPatch.listed?: boolean`; GraphQL argument `renown_upsertProfile(listed: Boolean)`; the payload rule and vectors in "Interfaces produced".

- [ ] **Step 1: Write the failing tests**

Append to the end of `subgraphs/renown-auth/tests/profile-identity.test.ts` (it reuses the file's `setup`, `row`, `ALICE`, `BOB`, `profileMessage`, `profilePayload`):

```ts
describe("profile payload with listed", () => {
  const address = "0xABC0000000000000000000000000000000000001";
  const at = "2026-10-11T12:00:00.000Z";
  const full = {
    displayName: "Frank",
    handle: "frank",
    bio: "Hi",
    links: [{ id: "l1", label: "Site", url: "https://frank.example" }],
    avatar: `attachment://v1:${"a".repeat(64)}`,
  };

  it("leaves every payload without listed byte-identical (null and absent alike)", async () => {
    expect(profilePayload({ username: "frank", listed: null })).toBe('{"username":"frank","userImage":null}');
    expect(await profileMessage(address, { ...full, listed: null }, at)).toBe(
      `Update Renown profile 0xabc0000000000000000000000000000000000001 4580e73ddd79972b5dd50d52aae493f1caed7a4025ec04ad402fd54c4a86ff55 at ${at}`,
    );
  });

  it("appends listed as the eighth key, and uses the seven-key form when it is the only field", () => {
    expect(profilePayload({ listed: true })).toBe(
      '{"username":null,"userImage":null,"displayName":null,"handle":null,"bio":null,"links":null,"avatar":null,"listed":true}',
    );
    expect(profilePayload({ username: "frank", listed: false })).toBe(
      '{"username":"frank","userImage":null,"displayName":null,"handle":null,"bio":null,"links":null,"avatar":null,"listed":false}',
    );
  });

  it("matches the listed vectors renown.id pins", async () => {
    expect(await profileMessage(address, { listed: true }, at)).toBe(
      `Update Renown profile 0xabc0000000000000000000000000000000000001 0a46ac991ff7e91d94d7d2ddff022fcbca86fcf7905fa09f77e46a3a3f5b93e0 at ${at}`,
    );
    expect(await profileMessage(address, { listed: false }, at)).toBe(
      `Update Renown profile 0xabc0000000000000000000000000000000000001 16dcce85d96df385580015dad07cf92524375040055ad19d9224022995a6e687 at ${at}`,
    );
    expect(await profileMessage(address, { ...full, listed: true }, at)).toBe(
      `Update Renown profile 0xabc0000000000000000000000000000000000001 ada9fa9d37a3d9f1b21e466272c02b4b136fec97e2fa57a11ed85dc814fa5296 at ${at}`,
    );
    expect(await profileMessage(address, { username: "frank", listed: false }, at)).toBe(
      `Update Renown profile 0xabc0000000000000000000000000000000000001 cf1c6b7c982d816646bbebc956e6d0c32da3b478bc01f90e1957cc3d981a24cc at ${at}`,
    );
  });
});

describe("renown_upsertProfile listed", () => {
  it("opts in and out with SET_LISTED; absent and null leave it alone", async () => {
    const { reactor, signed } = setup();
    const id = await signed(ALICE, { handle: "alice", listed: true });
    expect(reactor.applied(id)).toEqual(["SET_ETH_ADDRESS", "SET_HANDLE", "SET_LISTED"]);
    expect((await row(id)).listed).toBe(true);
    expect((await reactor.get(id))?.state.global.listed).toBe(true);

    await signed(ALICE, { bio: "Hi" });
    await signed(ALICE, { bio: "Hi again", listed: null });
    expect((await row(id)).listed).toBe(true);
    expect(reactor.applied(id).filter((type) => type === "SET_LISTED")).toHaveLength(1);

    await signed(ALICE, { listed: false });
    expect(reactor.applied(id).at(-1)).toBe("SET_LISTED");
    expect((await row(id)).listed).toBe(false);
  });

  it("creates an unlisted profile unless listed is sent", async () => {
    const { signed } = setup();
    const id = await signed(BOB, { displayName: "Bob" });
    expect((await row(id)).listed).toBe(false);
  });

  it("rejects listed under a signature that did not cover it", async () => {
    const { upsert } = setup();
    const timestamp = new Date().toISOString();
    // An older client signs without listed; the request adds it.
    const old = await ALICE.signMessage({ message: await profileMessage(ALICE.address, { bio: "Hi" }, timestamp) });
    await expect(
      upsert(null, { address: ALICE.address, bio: "Hi", listed: true, signature: old, timestamp }, {}),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
    // A signature for listed: false cannot be replayed as listed: true.
    const off = await ALICE.signMessage({ message: await profileMessage(ALICE.address, { listed: false }, timestamp) });
    await expect(
      upsert(null, { address: ALICE.address, listed: true, signature: off, timestamp }, {}),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("still accepts a legacy username-only signature", async () => {
    const { reactor, signed } = setup();
    const id = await signed(ALICE, { username: "alice.eth" });
    expect(reactor.applied(id)).toEqual(["SET_ETH_ADDRESS", "SET_USERNAME"]);
    expect((await row(id)).listed).toBe(false);
  });
});
```

In `subgraphs/renown-auth/tests/resolvers.test.ts`, the `renown_upsertProfile` line of "declares the three mutations with their exact signatures" becomes:

```ts
      "renown_upsertProfile(address: String!, username: String, userImage: String, displayName: String, handle: String, bio: String, links: [RenownProfileLinkInput!], avatar: String, listed: Boolean, signature: String, timestamp: String): String",
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-auth`
Expected: failures in "appends listed as the eighth key …", "matches the listed vectors …", "opts in and out with SET_LISTED …", "rejects listed under a signature …" and the SDL signature test; "leaves every payload without listed byte-identical", "creates an unlisted profile unless listed is sent" and "still accepts a legacy username-only signature" already pass (they pin today's behaviour).

- [ ] **Step 3: Sign `listed`**

In `subgraphs/renown-auth/core/signed-message.ts`, replace `ProfileFields`'s closing lines and `profilePayload` with:

```ts
  avatar?: string | null;
  /** People-search opt-in. */
  listed?: boolean | null;
}

/**
 * The JSON a profile signature hashes. Legacy writes (username/userImage
 * only) keep the exact two-key payload older clients sign. As soon as any
 * identity field (or `listed`) is present, all seven keys are hashed in this
 * fixed order, and each link is reduced to `{id, label, url}` in that key
 * order, so the client and the server serialize the same bytes. `listed` is
 * appended as an eighth key only when it is a boolean, so every payload
 * signed before it existed hashes exactly as before.
 */
export function profilePayload(profile: ProfileFields): string {
  const legacy = { username: profile.username ?? null, userImage: profile.userImage ?? null };
  const listed = profile.listed ?? null;
  const identity = [profile.displayName, profile.handle, profile.bio, profile.links, profile.avatar, listed];
  if (identity.every((value) => value === undefined || value === null)) {
    return JSON.stringify(legacy);
  }
  return JSON.stringify({
    ...legacy,
    displayName: profile.displayName ?? null,
    handle: profile.handle ?? null,
    bio: profile.bio ?? null,
    links: profile.links ? profile.links.map(({ id, label, url }) => ({ id, label, url })) : null,
    avatar: profile.avatar ?? null,
    ...(listed === null ? {} : { listed }),
  });
}
```

(The website copy needs exactly the same three changes: the `listed` field, `listed` in the `identity` array, and the conditional spread.)

- [ ] **Step 4: Patch and dispatch it**

In `subgraphs/renown-auth/core/profile-patch.ts`:

`IdentityPatch` gains, after `avatar?: string | null;`:

```ts
  /** People-search opt-in; never null (null input means unchanged). */
  listed?: boolean;
```

In `toIdentityPatch`, just before `return patch;`:

```ts
  if (input.listed != null) patch.listed = input.listed;

```

In `identityActions`, just before `return out;`:

```ts
  if (patch.listed !== undefined) out.push(userActions.setListed({ listed: patch.listed }));
```

- [ ] **Step 5: Accept and sign the argument**

In `subgraphs/renown-auth/resolvers.ts`, `interface UpsertProfileArgs` gains `listed?: boolean | null;` after `avatar?: string | null;`, and the object passed to `profileMessage(` inside `renown_upsertProfile` gains `listed: args.listed,` after `avatar: args.avatar,`.

In `subgraphs/renown-auth/schema.ts`, in the `renown_upsertProfile` doc string replace

```
    field or the avatar; links replaces the whole list ([] clears it).
```

with

```
    field or the avatar; links replaces the whole list ([] clears it);
    listed true/false opts the profile in to or out of renownUserSearch.
    The signed JSON carries listed as an eighth key only when it is sent.
```

and add the argument `listed: Boolean` between `avatar: String` and `signature: String`.

- [ ] **Step 6: Run the auth tests and types**

Run: `pnpm vitest run subgraphs/renown-auth && pnpm tsc`
Expected: 119 passed; `tsc` silent. The pre-existing vector test ("matches the vectors renown.id pins") must still pass unchanged — that is the compatibility guarantee.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-auth
git commit -m "feat(renown-auth): renown_upsertProfile(listed) signed as the eighth payload key"
```

---

### Task 4: `renownCredentials(credentialId)`

**Files:**
- Modify: `subgraphs/renown-read-model/schema.ts` (`input RenownCredentialsInput`)
- Modify: `subgraphs/renown-read-model/resolvers.ts` (`interface RenownCredentialsInput`, `renownCredentials` resolver ~320-368)
- Test: `subgraphs/renown-read-model/tests/credentials.test.ts` (new)

**Interfaces:**
- Consumes: nothing from earlier tasks (independent; uses the existing `idx_renown_credential_credential_id`).
- Produces: `RenownCredentialsInput.credentialId: String` (SDL in "Interfaces produced").

- [ ] **Step 1: Write the failing test**

Create `subgraphs/renown-read-model/tests/credentials.test.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { print } from "graphql";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import { up } from "../../../processors/renown-credential/migrations.js";
import type { DB } from "../../../processors/renown-credential/schema.js";
import { getResolvers } from "../resolvers.js";
import { schema } from "../schema.js";

const NS = RenownCredentialProcessor.getNamespace("renown-credential");
const ALICE = "0xabc0000000000000000000000000000000000001";
const BOB = "0xabc0000000000000000000000000000000000002";
const APP = "did:key:z6MkAppAppAppAppAppAppAppAppAppAppAppAppAppApp";
const T0 = new Date("2026-10-01T00:00:00.000Z");
let root: Kysely<DB>;

type Query = Record<string, (parent: unknown, args: unknown) => Promise<unknown>>;
let query: Query;

async function credential(documentId: string, credentialId: string, owner: string, revoked = false): Promise<void> {
  await root.withSchema(NS).insertInto("renown_credential").values({
    document_id: documentId,
    context: "[]",
    credential_id: credentialId,
    type: '["VerifiableCredential","RenownCredential"]',
    issuer_id: `did:pkh:eip155:1:${owner}`,
    issuer_ethereum_address: owner,
    issuance_date: T0,
    expiration_date: null,
    credential_subject_id: APP,
    credential_subject_app: "test-app",
    credential_status_id: null,
    credential_status_type: null,
    credential_schema_id: "schema",
    credential_schema_type: "type",
    proof_verification_method: "method",
    proof_ethereum_address: owner,
    proof_created: T0,
    proof_purpose: "assertionMethod",
    proof_type: "EthereumEip712Signature2021",
    proof_value: "0x",
    proof_eip712_domain: "{}",
    proof_eip712_primary_type: "VerifiableCredential",
    revoked,
    revoked_at: revoked ? T0 : null,
    revocation_reason: revoked ? "user" : null,
  }).execute();
}

beforeAll(async () => {
  root = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(NS)}`.execute(root);
  await up(root.withSchema(NS) as never);
  await credential("doc-1", "urn:uuid:11111111-1111-4111-8111-111111111111", ALICE);
  await credential("doc-2", "urn:uuid:22222222-2222-4222-8222-222222222222", BOB, true);
  await credential("doc-3", "urn:uuid:33333333-3333-4333-8333-333333333333", ALICE);
  const subgraph = { relationalDb: { queryNamespace: (ns: string) => root.withSchema(ns) } } as unknown as ISubgraph;
  query = (getResolvers(subgraph) as { Query: Query }).Query;
});

afterAll(async () => {
  await root.destroy();
});

type Row = { documentId: string; credentialId: string; revoked: boolean };
const ids = (rows: unknown) => (rows as Row[]).map((r) => r.documentId).sort();

describe("renownCredentials(credentialId)", () => {
  it("declares credentialId on the input", () => {
    expect(print(schema)).toMatch(/input RenownCredentialsInput \{[^}]*credentialId: String/);
  });

  it("finds one credential by its exact id, without an address or issuer", async () => {
    const rows = (await query.renownCredentials(null, {
      input: { credentialId: "urn:uuid:22222222-2222-4222-8222-222222222222" },
    })) as Row[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ documentId: "doc-2", revoked: true });
  });

  it("matches exactly: no prefix, no case folding, unknown ids return nothing", async () => {
    for (const credentialId of ["urn:uuid:2222", "URN:UUID:22222222-2222-4222-8222-222222222222", "urn:uuid:nope"]) {
      expect(await query.renownCredentials(null, { input: { credentialId } })).toEqual([]);
    }
  });

  it("treats an empty credentialId as a filter that matches nothing, never as no filter", async () => {
    expect(await query.renownCredentials(null, { input: { credentialId: "" } })).toEqual([]);
  });

  it("combines with the other filters", async () => {
    const id2 = "urn:uuid:22222222-2222-4222-8222-222222222222";
    expect(await query.renownCredentials(null, { input: { credentialId: id2, includeRevoked: false } })).toEqual([]);
    expect(await query.renownCredentials(null, { input: { credentialId: id2, ethAddress: ALICE } })).toEqual([]);
    expect(ids(await query.renownCredentials(null, { input: { credentialId: id2, did: APP, issuer: BOB } }))).toEqual(["doc-2"]);
  });

  it("leaves the other filters unchanged when credentialId is absent", async () => {
    expect(ids(await query.renownCredentials(null, { input: { ethAddress: ALICE } }))).toEqual(["doc-1", "doc-3"]);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run subgraphs/renown-read-model/tests/credentials.test.ts`
Expected: 5 failed, 1 passed ("leaves the other filters unchanged …"); without the filter every query returns all three rows.

- [ ] **Step 3: Declare the field**

In `subgraphs/renown-read-model/schema.ts`, `input RenownCredentialsInput`, after `driveId: String`:

```graphql
    "Exact VC id (e.g. urn:uuid:...); works alone or with the other filters. An empty string matches nothing."
    credentialId: String
```

- [ ] **Step 4: Filter**

In `subgraphs/renown-read-model/resolvers.ts`: add `credentialId?: string | null;` after `driveId?: string;` in `interface RenownCredentialsInput`; add `credentialId,` after `driveId,` in the destructuring at the top of `renownCredentials`; and right after `).selectFrom("renown_credential");` in that resolver:

```ts

        // Exact credential id (idx_renown_credential_credential_id). Checked
        // against null, not truthiness: "" must match nothing, never everything.
        if (credentialId != null) {
          query = query.where("renown_credential.credential_id", "=", credentialId);
        }
```

- [ ] **Step 5: Run the read-model tests and types**

Run: `pnpm vitest run subgraphs/renown-read-model && pnpm tsc`
Expected: 14 passed; `tsc` silent.

- [ ] **Step 6: Commit**

```bash
git add subgraphs/renown-read-model
git commit -m "feat(read-model): renownCredentials(credentialId) exact lookup"
```

---

### Task 5: `renownUserSearch` and `ReadRenownUser.listed`

**Files:**
- Create: `subgraphs/renown-read-model/search.ts`
- Modify: `subgraphs/renown-read-model/schema.ts` (`type ReadRenownUser`, new `type RenownUserSearchPage`, `type Query`)
- Modify: `subgraphs/renown-read-model/resolvers.ts` (import, `interface ReadRenownUser`, new `interface RenownUserSearchPage`, `mapToUser` ~83-107, new resolver)
- Test: `subgraphs/renown-read-model/tests/search.test.ts` (new)

**Interfaces:**
- Consumes: the `listed` column and the two partial indexes (Task 2).
- Produces: `search.ts` exports `SEARCH_MIN_QUERY = 2`, `SEARCH_MAX_QUERY = 40`, `SEARCH_DEFAULT_LIMIT = 20`, `SEARCH_MAX_LIMIT = 50`, `interface UserSearchArgs { query: string; limit?: number | null; after?: string | null }`, `interface UserSearchCursor { handle: string | null; documentId: string }`, `interface ParsedUserSearch { pattern: string; limit: number; after: UserSearchCursor | undefined }`, `likePrefix(value: string): string`, `encodeSearchCursor(c: UserSearchCursor): string`, `decodeSearchCursor(raw: string): UserSearchCursor`, `parseUserSearch(args: UserSearchArgs): ParsedUserSearch`, `searchListedUsers(db, search): Promise<{ rows; next: string | null }>`; GraphQL `renownUserSearch`, `RenownUserSearchPage`, `ReadRenownUser.listed: Boolean!`.

- [ ] **Step 1: Write the failing test**

Create `subgraphs/renown-read-model/tests/search.test.ts`:

```ts
import { PGlite } from "@electric-sql/pglite";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import { print } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenownUserProcessor } from "../../../processors/renown-user/index.js";
import { up } from "../../../processors/renown-user/migrations.js";
import type { DB } from "../../../processors/renown-user/schema.js";
import { getResolvers } from "../resolvers.js";
import { schema } from "../schema.js";
import { likePrefix } from "../search.js";

const NS = RenownUserProcessor.getNamespace("renown-user");
let root: Kysely<DB>;

type Resolver = (parent: unknown, args: unknown) => Promise<unknown>;
let query: Record<string, Resolver>;

interface Item {
  documentId: string;
  handle: string | null;
  displayName: string | null;
  listed: boolean;
}
interface Page {
  items: Item[];
  next: string | null;
}

function profile(document_id: string, handle: string | null, display_name: string | null, listed = true) {
  return { document_id, handle, display_name, listed, username: null, eth_address: null, user_image: null };
}

beforeAll(async () => {
  root = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(NS)}`.execute(root);
  await up(root.withSchema(NS) as never);
  await root.withSchema(NS).insertInto("renown_user").values([
    profile("d-alice", "alice", "Alice Smith"),
    profile("d-alfred", "alfred", "Alfred"),
    profile("d-bob", "bob", "Ali Baba"),
    profile("d-alina", "alina", "Alina", false), // not listed
    profile("d-n2", null, "Alix"),
    profile("d-n1", null, "Alicia Keys"),
    profile("d-pct", "real-1", "100% Real"),
    profile("d-1000", "thousand", "1000 Ways"),
    profile("d-snake", "snake", "snake_case"),
    profile("d-snakes", "snakes", "snakes and ladders"),
    profile("d-slash", "slash", "back\\slash"),
    profile("d-back", "back", "backslash"),
    ...Array.from({ length: 22 }, (_, i) => profile(`d-zz-${i}`, `zz-${String(i).padStart(3, "0")}`, null)),
  ]).execute();
  const subgraph = { relationalDb: { queryNamespace: (ns: string) => root.withSchema(ns) } } as unknown as ISubgraph;
  query = (getResolvers(subgraph) as { Query: Record<string, Resolver> }).Query;
});

afterAll(async () => {
  await root.destroy();
});

const search = (args: Record<string, unknown>) => query.renownUserSearch(null, args) as Promise<Page>;
const ids = (page: Page) => page.items.map((item) => item.documentId);

describe("renownUserSearch", () => {
  it("declares the query, the page type and ReadRenownUser.listed", () => {
    const sdl = print(schema);
    expect(sdl).toContain("renownUserSearch(query: String!, limit: Int, after: String): RenownUserSearchPage!");
    expect(sdl).toMatch(/type RenownUserSearchPage \{\s+items: \[ReadRenownUser!\]!\s+next: String\s+\}/);
    expect(sdl).toMatch(/type ReadRenownUser \{[^}]*listed: Boolean!/);
  });

  it("prefix-matches handle or display name case-insensitively, listed only, handle order then nulls", async () => {
    const page = await search({ query: "  ALI " });
    expect(ids(page)).toEqual(["d-alice", "d-bob", "d-n1", "d-n2"]);
    expect(page.next).toBeNull();
    expect(page.items[0]).toMatchObject({ handle: "alice", displayName: "Alice Smith", listed: true });
  });

  it("matches only at the start of the handle or display name", async () => {
    expect(ids(await search({ query: "lice" }))).toEqual([]);
    expect(ids(await search({ query: "smith" }))).toEqual([]);
    expect(ids(await search({ query: "alfr" }))).toEqual(["d-alfred"]);
  });

  it("treats %, _ and \\ in the query literally", async () => {
    expect(likePrefix("a%b_c\\d")).toBe("a\\%b\\_c\\\\d%");
    expect(ids(await search({ query: "100%" }))).toEqual(["d-pct"]);
    expect(ids(await search({ query: "snake_" }))).toEqual(["d-snake"]);
    expect(ids(await search({ query: "%%" }))).toEqual([]);
    expect(ids(await search({ query: "__" }))).toEqual([]);
    expect(ids(await search({ query: "back\\" }))).toEqual(["d-slash"]);
  });

  it("never returns an unlisted profile, which a direct lookup still finds", async () => {
    expect(ids(await search({ query: "alina" }))).toEqual([]);
    expect(await query.renownUser(null, { input: { handle: "alina" } })).toMatchObject({
      documentId: "d-alina",
      listed: false,
    });
  });

  it("pages with a keyset cursor across the profiles without a handle", async () => {
    const all = ids(await search({ query: "al", limit: 50 }));
    expect(all).toEqual(["d-alfred", "d-alice", "d-bob", "d-n1", "d-n2"]);
    const seen: string[] = [];
    let after: string | null = null;
    for (let i = 0; i < 10; i++) {
      const page: Page = await search({ query: "al", limit: 2, after });
      seen.push(...ids(page));
      after = page.next;
      if (after === null) break;
    }
    expect(seen).toEqual(all);
    // The last page ends exactly: no empty trailing page.
    expect((await search({ query: "al", limit: 5 })).next).toBeNull();
  });

  it("defaults to 20 items and allows up to 50", async () => {
    const first = await search({ query: "zz" });
    expect(first.items).toHaveLength(20);
    expect(first.next).not.toBeNull();
    const rest = await search({ query: "zz", after: first.next });
    expect(ids(rest)).toEqual(["d-zz-20", "d-zz-21"]);
    expect(rest.next).toBeNull();
    expect((await search({ query: "zz", limit: 50 })).items).toHaveLength(22);
  });

  it.each([
    ["a one-character query", { query: " a " }, "query"],
    ["a blank query", { query: "    " }, "query"],
    ["a 41-character query", { query: "a".repeat(41) }, "query"],
    ["a single emoji (one character, two UTF-16 units)", { query: "😀" }, "query"],
    ["limit 0", { query: "al", limit: 0 }, "limit"],
    ["limit 51", { query: "al", limit: 51 }, "limit"],
    ["a fractional limit", { query: "al", limit: 2.5 }, "limit"],
    ["a foreign cursor", { query: "al", after: "not-a-cursor" }, "after"],
    ["a cursor of the wrong shape", { query: "al", after: Buffer.from('{"d":1}').toString("base64url") }, "after"],
  ])("refuses %s with BAD_USER_INPUT", async (_, args, field) => {
    await expect(search(args)).rejects.toMatchObject({ extensions: { code: "BAD_USER_INPUT", field } });
  });

  it("accepts a 40-character query and counts characters, not UTF-16 units", async () => {
    expect((await search({ query: "a".repeat(40) })).items).toEqual([]);
    expect((await search({ query: "😀😀" })).items).toEqual([]);
  });

  it("uses the partial prefix indexes", async () => {
    await sql`set enable_seqscan = off`.execute(root);
    try {
      const plan = await sql<{ "QUERY PLAN": string }>`
        explain select document_id from ${sql.id(NS)}.renown_user
        where listed = true
          and (LOWER(handle) LIKE LOWER(${"al%"}) ESCAPE '\\' OR LOWER(display_name) LIKE LOWER(${"al%"}) ESCAPE '\\')`.execute(root);
      const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
      expect(text).toContain("idx_renown_user_listed_handle");
      expect(text).toContain("idx_renown_user_listed_display_name");
    } finally {
      await sql`set enable_seqscan = on`.execute(root);
    }
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run subgraphs/renown-read-model/tests/search.test.ts`
Expected: FAIL — `Cannot find module '../search.js'`, `Tests  no tests`.

- [ ] **Step 3: Write the search module**

Create `subgraphs/renown-read-model/search.ts`:

```ts
import { GraphQLError } from "graphql";
import { sql } from "kysely";
import type { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";

export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_QUERY = 40;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;

export interface UserSearchArgs {
  query: string;
  limit?: number | null;
  after?: string | null;
}

/** Keyset position: the last item's LOWER(handle) (null sorts last) and document id. */
export interface UserSearchCursor {
  handle: string | null;
  documentId: string;
}

export interface ParsedUserSearch {
  /** LIKE pattern: the trimmed query with \, % and _ escaped, plus a trailing %. */
  pattern: string;
  limit: number;
  after: UserSearchCursor | undefined;
}

function badInput(field: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT", field } });
}

/** `value` as a prefix LIKE pattern; the escape character is the backslash. */
export function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function encodeSearchCursor(cursor: UserSearchCursor): string {
  return Buffer.from(JSON.stringify({ h: cursor.handle, d: cursor.documentId })).toString("base64url");
}

export function decodeSearchCursor(raw: string): UserSearchCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { h?: unknown; d?: unknown };
    if ((typeof parsed.h !== "string" && parsed.h !== null) || typeof parsed.d !== "string") {
      throw new Error("malformed cursor");
    }
    return { handle: parsed.h, documentId: parsed.d };
  } catch {
    throw badInput("after", "after is not a cursor from renownUserSearch");
  }
}

/**
 * Validates renownUserSearch arguments.
 * @throws {GraphQLError} BAD_USER_INPUT (extensions.field) for a query outside
 * 2-40 characters after trimming, a limit outside 1-50, or a foreign cursor.
 */
export function parseUserSearch(args: UserSearchArgs): ParsedUserSearch {
  const query = args.query.trim();
  const length = Array.from(query).length;
  if (length < SEARCH_MIN_QUERY || length > SEARCH_MAX_QUERY) {
    throw badInput("query", `query must be ${SEARCH_MIN_QUERY}-${SEARCH_MAX_QUERY} characters`);
  }
  const limit = args.limit ?? SEARCH_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) {
    throw badInput("limit", `limit must be an integer from 1 to ${SEARCH_MAX_LIMIT}`);
  }
  return {
    pattern: likePrefix(query),
    limit,
    after: args.after ? decodeSearchCursor(args.after) : undefined,
  };
}

type UserQueryBuilder = ReturnType<typeof RenownUserProcessor.query<RenownUserDB>>;

/**
 * Listed profiles whose handle or display name starts with the query
 * (case-insensitively), ordered by LOWER(handle) (profiles without a handle
 * last) then document id, byte-wise ("C" collation) so the keyset cursor
 * never depends on the database locale. Fetches one row more than the page
 * to know whether a next page exists.
 */
export async function searchListedUsers(db: UserQueryBuilder, search: ParsedUserSearch) {
  const handleKey = sql<string | null>`LOWER(renown_user.handle) COLLATE "C"`;
  const idKey = sql<string>`renown_user.document_id COLLATE "C"`;
  let query = db
    .selectFrom("renown_user")
    .selectAll()
    .select(sql<string | null>`LOWER(renown_user.handle)`.as("sort_handle"))
    .where("renown_user.listed", "=", true)
    .where(
      sql<boolean>`(LOWER(renown_user.handle) LIKE LOWER(${search.pattern}) ESCAPE '\\' OR LOWER(renown_user.display_name) LIKE LOWER(${search.pattern}) ESCAPE '\\')`,
    );
  const after = search.after;
  if (after) {
    query =
      after.handle === null
        ? query.where(sql<boolean>`(renown_user.handle IS NULL AND ${idKey} > ${after.documentId})`)
        : query.where(
            sql<boolean>`(${handleKey} > ${after.handle} OR (${handleKey} = ${after.handle} AND ${idKey} > ${after.documentId}) OR renown_user.handle IS NULL)`,
          );
  }
  const rows = await query
    .orderBy(sql`${handleKey} ASC NULLS LAST`)
    .orderBy(sql`${idKey} ASC`)
    .limit(search.limit + 1)
    .execute();
  const page = rows.slice(0, search.limit);
  const last = page.at(-1);
  const next =
    rows.length > search.limit && last
      ? encodeSearchCursor({ handle: last.sort_handle, documentId: last.document_id })
      : null;
  return { rows: page, next };
}
```

- [ ] **Step 4: Declare the schema**

In `subgraphs/renown-read-model/schema.ts`:

In `type ReadRenownUser`, after `avatar: String`:

```graphql
    "Opted in to people search (renownUserSearch)"
    listed: Boolean!
```

After the closing `}` of `type ReadRenownUser`:

```graphql

  "A page of renownUserSearch; pass next as after for the following page (null at the end)."
  type RenownUserSearchPage {
    items: [ReadRenownUser!]!
    next: String
  }
```

In `type Query`, after `renownHandleAvailability(…)`:

```graphql
    """
    People search: listed profiles whose handle or display name starts with
    query (trimmed, 2-40 characters, case-insensitive; % and _ are literal),
    ordered by handle (profiles without one last), then document id.
    limit 1-50 (default 20). Errors: BAD_USER_INPUT (extensions.field is
    query, limit or after).
    """
    renownUserSearch(query: String!, limit: Int, after: String): RenownUserSearchPage!
```

- [ ] **Step 5: Wire the resolver and `listed`**

In `subgraphs/renown-read-model/resolvers.ts`:

After the `RenownCredentialDB` import:

```ts
import { parseUserSearch, searchListedUsers, type UserSearchArgs } from "./search.js";
```

`interface ReadRenownUser` gains `listed: boolean;` after `avatar: string | null;`; after that interface add:

```ts
interface RenownUserSearchPage {
  items: ReadRenownUser[];
  next: string | null;
}
```

`mapToUser`'s parameter type gains `listed: boolean;` after `avatar_ref: string | null;`, and its result gains `listed: user.listed,` after `avatar: user.avatar_ref,`.

In `Query`, before `renownCredentials:`:

```ts
      renownUserSearch: async (
        parent: unknown,
        args: UserSearchArgs,
      ): Promise<RenownUserSearchPage> => {
        const search = parseUserSearch(args);
        const { rows, next } = await searchListedUsers(
          RenownUserProcessor.query<RenownUserDB>("renown-user", db),
          search,
        );
        return { items: rows.map(mapToUser), next };
      },

```

- [ ] **Step 6: Run the read-model tests, types and lint**

Run: `pnpm vitest run subgraphs/renown-read-model && pnpm tsc && pnpm lint 2>&1 | grep -E " error |renown-read-model/search" ; echo done`
Expected: 32 passed; `tsc` silent; no lint errors (the warnings already present in `resolvers.ts` about `getDriveId`/`driveId` predate this plan). If oxlint reports `consistent-type-imports` on `search.ts`, the `RenownUserProcessor` import must be `import type` — it is only used in `typeof`.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-read-model
git commit -m "feat(read-model): renownUserSearch and ReadRenownUser.listed"
```

---

### Task 6: Read-only smoke script, docs, whole-branch check

**Files:**
- Create: `scripts/smoke/people-search.ts`
- Modify: `scripts/smoke/README.md` (append a section)

**Interfaces:**
- Consumes: the GraphQL surface of Tasks 4 and 5.
- Produces: `node scripts/smoke/people-search.ts [--switchboard <url>] [--credential-id <urn:uuid:…>]` printing `[smoke] …` lines and `[smoke] OK`, exit 1 on failure.

- [ ] **Step 1: Write the script**

Create `scripts/smoke/people-search.ts`:

```ts
/**
 * Read-only smoke test of the verify / people-search reads on a switchboard:
 *
 *   node scripts/smoke/people-search.ts [--switchboard <url>] [--credential-id <urn:uuid:...>]
 *
 * It checks, with anonymous GraphQL requests only:
 *   1. renownCredentials(credentialId) alone answers [] for an unknown id and
 *      for "" (never the whole table); with --credential-id it answers exactly
 *      that credential;
 *   2. renownUserSearch for a few prefixes returns only listed profiles whose
 *      handle or display name starts with the query, ordered by handle
 *      (profiles without one last), and pages to the end without repeats;
 *   3. "%%" and "__" match literally (only names starting with them);
 *   4. a 1-character query, limit 51 and a foreign cursor are BAD_USER_INPUT.
 *
 * Writes nothing, so it needs no --allow-prod. Exits 1 on any failure.
 */

const STAGING_SWITCHBOARD = "https://switchboard.renown-staging.vetra.io";
const UNKNOWN_CREDENTIAL = "urn:uuid:00000000-0000-4000-8000-000000000000";
const PREFIXES = ["an", "ma", "jo", "da", "sm"];

class SmokeFailure extends Error {}

interface Args {
  switchboard: string;
  credentialId: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { switchboard: STAGING_SWITCHBOARD, credentialId: undefined };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--switchboard") {
      const v = argv[++i];
      if (!v) throw new SmokeFailure("--switchboard needs a URL");
      args.switchboard = v;
    } else if (arg === "--credential-id") {
      const v = argv[++i];
      if (!v) throw new SmokeFailure("--credential-id needs a credential id");
      args.credentialId = v;
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: people-search.ts [--switchboard <url>] [--credential-id <urn:uuid:...>]");
      process.exit(0);
    } else throw new SmokeFailure(`unknown argument: ${arg}`);
  }
  args.switchboard = args.switchboard.replace(/\/+$/, "").replace(/\/graphql$/, "");
  return args;
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

interface GraphqlError {
  message: string;
  extensions?: { code?: string; field?: string };
}

interface GraphqlResult<T> {
  data?: T | null;
  errors?: GraphqlError[];
}

async function post<T>(switchboard: string, document: string, variables: unknown): Promise<GraphqlResult<T>> {
  const res = await fetch(`${switchboard}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as GraphqlResult<T>;
  } catch {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${clip(text)}`);
  }
}

async function query<T>(switchboard: string, document: string, variables: unknown = {}): Promise<T> {
  const result = await post<T>(switchboard, document, variables);
  if (result.errors?.length || !result.data) {
    throw new SmokeFailure(`GraphQL: ${clip(JSON.stringify(result.errors ?? result))}`);
  }
  return result.data;
}

interface Credential {
  credentialId: string;
  revoked: boolean;
}

interface Person {
  documentId: string;
  handle: string | null;
  displayName: string | null;
  listed: boolean;
}

interface Page {
  items: Person[];
  next: string | null;
}

const CREDENTIALS = `query Credential($id: String!) {
  renownCredentials(input: { credentialId: $id }) { credentialId revoked }
}`;
const SEARCH = `query Search($q: String!, $limit: Int, $after: String) {
  renownUserSearch(query: $q, limit: $limit, after: $after) { items { documentId handle displayName listed } next }
}`;

async function checkCredentialLookup(switchboard: string, credentialId: string | undefined): Promise<void> {
  for (const id of [UNKNOWN_CREDENTIAL, ""]) {
    const rows = (await query<{ renownCredentials: Credential[] }>(switchboard, CREDENTIALS, { id })).renownCredentials;
    check(rows.length === 0, `renownCredentials(credentialId: ${JSON.stringify(id)}) returned ${rows.length} rows`);
  }
  step("renownCredentials(credentialId)", "unknown id and empty id answer []");
  if (!credentialId) {
    step("renownCredentials(credentialId) known id", "skipped: pass --credential-id to check one");
    return;
  }
  const rows = (await query<{ renownCredentials: Credential[] }>(switchboard, CREDENTIALS, { id: credentialId }))
    .renownCredentials;
  check(rows.length === 1 && rows[0].credentialId === credentialId, `renownCredentials(credentialId) returned ${rows.length} rows`);
  step("renownCredentials(credentialId) known id", `found, revoked=${rows[0].revoked}`);
}

function startsWith(person: Person, q: string): boolean {
  return [person.handle, person.displayName].some((v) => v != null && v.toLowerCase().startsWith(q.toLowerCase()));
}

function inOrder(a: Person, b: Person): boolean {
  if (a.handle === null) return b.handle === null && a.documentId < b.documentId;
  if (b.handle === null) return true;
  const ha = a.handle.toLowerCase();
  const hb = b.handle.toLowerCase();
  return ha < hb || (ha === hb && a.documentId < b.documentId);
}

async function searchAll(switchboard: string, q: string): Promise<Person[]> {
  const seen: Person[] = [];
  let after: string | null = null;
  for (let pages = 0; pages < 100; pages++) {
    const page: Page = (await query<{ renownUserSearch: Page }>(switchboard, SEARCH, { q, limit: 5, after })).renownUserSearch;
    check(page.items.length <= 5, `renownUserSearch(${q}) returned ${page.items.length} items for limit 5`);
    for (const person of page.items) {
      check(person.listed, `renownUserSearch(${q}) returned unlisted ${person.documentId}`);
      check(startsWith(person, q), `renownUserSearch(${q}) returned ${person.documentId} (${person.handle}/${person.displayName})`);
      check(!seen.some((p) => p.documentId === person.documentId), `renownUserSearch(${q}) repeated ${person.documentId}`);
      const prev = seen.at(-1);
      check(!prev || inOrder(prev, person), `renownUserSearch(${q}) out of order at ${person.documentId}`);
      seen.push(person);
    }
    after = page.next;
    if (after === null) return seen;
  }
  throw new SmokeFailure(`renownUserSearch(${q}) did not end within 100 pages`);
}

async function checkSearch(switchboard: string): Promise<void> {
  for (const q of PREFIXES) {
    const people = await searchAll(switchboard, q.toUpperCase());
    step(`renownUserSearch(${q.toUpperCase()})`, `${people.length} listed`);
  }
  for (const q of ["%%", "__"]) {
    const people = await searchAll(switchboard, q);
    step(`renownUserSearch(${q})`, `${people.length} (only literal matches)`);
  }
}

async function checkErrors(switchboard: string): Promise<void> {
  const cases: [string, Record<string, unknown>, string][] = [
    ["1-character query", { q: " a " }, "query"],
    ["limit 51", { q: "an", limit: 51 }, "limit"],
    ["foreign cursor", { q: "an", after: "not-a-cursor" }, "after"],
  ];
  for (const [label, variables, field] of cases) {
    const result = await post<unknown>(switchboard, SEARCH, variables);
    const error = result.errors?.[0];
    check(
      error?.extensions?.code === "BAD_USER_INPUT" && error.extensions.field === field,
      `renownUserSearch with a ${label} answered ${clip(JSON.stringify(result))}`,
    );
  }
  step("renownUserSearch errors", "BAD_USER_INPUT for query, limit and after");
}

async function main(): Promise<void> {
  const { switchboard, credentialId } = parseArgs(process.argv.slice(2));
  step("switchboard", switchboard);
  await checkCredentialLookup(switchboard, credentialId);
  await checkSearch(switchboard);
  await checkErrors(switchboard);
  step("OK");
}

main().catch((error: unknown) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
```

- [ ] **Step 2: See it fail against today's staging (the red run)**

Run: `node scripts/smoke/people-search.ts; node scripts/smoke/people-search.ts --bogus`
Expected (before the release): `[smoke] FAILED: GraphQL: [{"message":"Field \"credentialId\" is not defined by type \"RenownCredentialsInput\".", …` — an old backend cannot pass — then `[smoke] FAILED: unknown argument: --bogus`.

- [ ] **Step 3: Document it**

Append to `scripts/smoke/README.md`:

````markdown
## people-search.ts

Read-only check of the reads renown.id `/verify` and `/people` need
(`renownCredentials(credentialId)`, `renownUserSearch`) on a switchboard:

```sh
node scripts/smoke/people-search.ts                                                  # Renown staging
node scripts/smoke/people-search.ts --switchboard https://switchboard.renown.vetra.io # production
node scripts/smoke/people-search.ts --credential-id urn:uuid:<id>                    # also look one up
```

Anonymous queries only, so no `--allow-prod` and nothing to clean up. It
checks that a credential lookup by an unknown id and by `""` answers `[]`
(never the whole table) and, with `--credential-id`, that exactly that
credential comes back; that `renownUserSearch` for a few prefixes (sent in
upper case) returns only listed profiles whose handle or display name starts
with the query, ordered by handle with handle-less profiles last, and pages to
the end without repeats; that `%%` and `__` match literally; and that a
1-character query, `limit: 51` and a foreign cursor answer `BAD_USER_INPUT`
with the offending `extensions.field`. Against a switchboard without these
reads it fails on the first query (`credentialId` is not defined). Exits 1 on
any failure.
````

- [ ] **Step 4: Whole-branch verification**

Run: `pnpm tsc && pnpm lint > /tmp/lint.txt 2>&1; echo "lint exit $?"; pnpm vitest run --coverage 2>&1 | grep -E "Test Files|Tests |All files|profile.ts"`
Expected: `lint exit 0`; `Test Files 54 passed (54)`, `Tests 655 passed (655)` (617 baseline + 38 new); coverage `All files` ≥ 95 in every column and `profile.ts` 100 %.

(Optional local green run of the smoke, without a switchboard: serve `print(schema)` of `subgraphs/renown-read-model/schema.ts` plus `scalar DateTime` with graphql's `buildSchema` and a `fieldResolver` that calls `getResolvers(...).Query[info.fieldName](null, args)` over PGlite seeded with a few listed profiles, then run the script with `--switchboard http://127.0.0.1:<port>` — the planner did exactly this; expected `[smoke] OK`.)

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke/people-search.ts scripts/smoke/README.md
git commit -m "chore(smoke): people-search smoke for credentialId and renownUserSearch"
```

---

### Task 7: Rollout (controller)

Done by the controller, not by a task implementer. Backend before website, staging before prod. The release workflow (`.github/workflows/sync-and-publish.yml`, `prepare` job) builds the `staging` branch for `channel=staging` and `main` for `channel=latest`, then bumps the tenant values (`scripts/ci/deploy-target.sh`: `tenants/renown-staging/…` / `tenants/renown/…`).

- [ ] **Step 1:** Push and open a PR: `git push -u origin feat/verify-people-backend`, `gh pr create --base main` (no Co-Authored-By trailer in commits). Get the branch into `staging` (merge `feat/verify-people-backend` into `staging` and push).
- [ ] **Step 2:** Release staging: `gh workflow run sync-and-publish.yml --ref main -f channel=staging -f sync=false`, then `gh run watch` on the new run; confirm the staging tenant rolled to the new version.
- [ ] **Step 3:** Staging smoke: `node scripts/smoke/people-search.ts` → `[smoke] OK`; then `node scripts/smoke/people-search.ts --credential-id <a real staging urn:uuid>` (take one from `renownCredentials(input: { ethAddress: "<a staging test wallet>" })`) → `found`. Also `node scripts/smoke/identity-profile.ts` → `[smoke] OK` (proves existing signed profile writes still verify), and in the switchboard log no `[RenownUserProcessor] skipped operation` lines for `SET_LISTED`.
- [ ] **Step 4:** Merge the PR into `main`, then release prod: `gh workflow run sync-and-publish.yml --ref main -f channel=latest -f sync=false`, `gh run watch`.
- [ ] **Step 5:** Prod smoke: `node scripts/smoke/people-search.ts --switchboard https://switchboard.renown.vetra.io` → `[smoke] OK`. Only now hand over to the renown.id plan (its profile editor signs `listed`; an old backend would refuse those signatures).

---

## Self-Review

1. **Spec coverage.** §3 backend `credentialId` (exact, uses the existing index, combinable, alone needs no issuer/proof address) → Task 4. §4 backend: `listed: Boolean` initial false + `SET_LISTED { listed: Boolean! }` + tolerant reducer → Task 1; `renown_upsertProfile(listed)` + eighth key only when not null/undefined → Task 3 (vectors in "Interfaces produced" for the website's lockstep copy); read-model column (re-runnable), `SET_LISTED` processing, two partial `text_pattern_ops` indexes → Task 2; `renownUserSearch` (trim, 2–40, `BAD_USER_INPUT`, prefix on handle/display name, `%`/`_` escaped, listed only, order handle then id, keyset cursor, default 20 / max 50) and `ReadRenownUser.listed` → Task 5; deploy order → Task 7. Global constraints: listed-only search and unchanged direct lookups (Task 5 "never returns an unlisted profile, which a direct lookup still finds"); signature compatibility (Task 3 existing vectors + "leaves every payload without listed byte-identical" + legacy username-only test). Testing line: all named backend tests exist. Website, layout guards and cleanup are the other plans.
2. **Placeholder scan.** Every code step carries the full code; no TBD/TODO; the one generated stub (`throw new Error("Reducer … not implemented.")`) is removed by Step 2's checkout and replaced in Step 5.
3. **Type consistency.** `setListed({ listed })` (Task 1) is what `identityActions` calls (Task 3); `listed: Generated<boolean>` (Task 2) is what `mapToUser` reads as `listed: boolean` (Task 5); `ProfileFields.listed?: boolean | null` → `IdentityPatch.listed?: boolean`; the cursor `{h, d}` is produced and consumed only in `search.ts`.
4. **Review Focus.** Five lines, each pinned by a named test in its owning task (Tasks 1–5).

