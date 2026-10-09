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
