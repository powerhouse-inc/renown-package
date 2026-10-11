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
