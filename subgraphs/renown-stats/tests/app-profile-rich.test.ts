import { PGlite } from "@electric-sql/pglite";
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { generateId, type Action, type PHDocument } from "document-model";
import { buildASTSchema, GraphQLError, parse, validate } from "graphql";
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
import { schema } from "../schema.js";
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
    expect((await failure(upsert({ appDid: APP, name: "x" }, ctx))).code).toBe("FORBIDDEN");
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

  it("checks each ref with its own purpose and answers storage faults SERVICE_UNAVAILABLE", async () => {
    // 1 MiB + 1 is over the logo cap but within the cover cap: the purpose decides.
    const { upsert } = setup({ media: storage({ [H1]: png(MIB + 1), [H2]: png(MIB + 1) }) });
    expect((await failure(upsert({ appDid: APP, logoRef: LOGO }))).field).toBe("logoRef");
    expect(await upsert({ appDid: APP, coverRef: COVER })).toBe(true);
    const down = { ...storage({}), inspect: vi.fn(() => Promise.reject(new Error("s3 down"))) } as MediaBackend;
    expect((await failure(setup({ media: down }).upsert({ appDid: APP_2, logoRef: LOGO }))).code).toBe(
      "SERVICE_UNAVAILABLE",
    );
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

describe("the Vetra relay contract", () => {
  // Byte-for-byte the document vetra-cloud-package (2d23de0,
  // subgraphs/vetra-licensing/renown-profile.ts) sends.
  const RELAY_UPSERT = `mutation UpsertAppProfile($appDid: String!, $name: String, $tagline: String, $website: String, $description: String, $category: String, $logoRef: String, $coverRef: String, $links: [AppProfileLinkInput!]) {
  upsertAppProfile(appDid: $appDid, name: $name, tagline: $tagline, website: $website, description: $description, category: $category, logoRef: $logoRef, coverRef: $coverRef, links: $links)
}`;

  it("validates against the schema and names the link input AppProfileLinkInput", () => {
    const built = buildASTSchema(schema);
    expect(validate(built, parse(RELAY_UPSERT))).toEqual([]);
    expect(built.getType("AppProfileLinkInput")).toBeDefined();
    expect(REGISTRAR_HEADER).toBe("x-renown-workload-registration-token");
  });
});
