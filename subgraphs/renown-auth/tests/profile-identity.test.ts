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
