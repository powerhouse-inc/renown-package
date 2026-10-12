import { PGlite } from "@electric-sql/pglite";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import { print } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RenownUserProcessor } from "../../../processors/renown-user/index.js";
import { up } from "../../../processors/renown-user/migrations.js";
import { KyselyOrgStore } from "../../renown-orgs/store/kysely.js";
import { migrate } from "../../renown-orgs/store/migrations.js";
import { memberRecord, org } from "../../renown-orgs/tests/store-contract.js";
import { getResolvers } from "../resolvers.js";
import { schema } from "../schema.js";

const USER_NS = RenownUserProcessor.getNamespace("renown-user");
const ALICE = "0xabc0000000000000000000000000000000000001";
let root: Kysely<any>;
type Field = (parent: unknown, args: unknown) => Promise<unknown>;
let resolvers: { Query: Record<string, Field>; ReadRenownUser: Record<string, Field> };

beforeAll(async () => {
  root = new Kysely<any>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(USER_NS)}`.execute(root);
  await up(root.withSchema(USER_NS) as never);
  await sql`create schema "renown-orgs"`.execute(root);
  await migrate(root.withSchema("renown-orgs"));
  const store = new KyselyOrgStore(root.withSchema("renown-orgs"));
  await store.insertOrganization(org("o1", "acme", { name: "Acme", membersPublic: true }));
  await store.insertMember(memberRecord("m1", "o1", ALICE, { role: "PUBLISHER" }));
  await store.reserveHandle({ handle: "oldco", until: new Date(Date.now() + 60_000), reason: "ARCHIVED", orgId: null });
  const subgraph = { relationalDb: { queryNamespace: (ns: string) => root.withSchema(ns) } } as unknown as ISubgraph;
  resolvers = getResolvers(subgraph) as typeof resolvers;
});

afterAll(async () => {
  await root.destroy();
});

describe("renown read model and organizations", () => {
  it("reports organization handles as TAKEN and reserved handles as RESERVED", async () => {
    expect(await resolvers.Query.renownHandleAvailability(null, { handle: "ACME", address: ALICE })).toEqual({
      handle: "acme",
      available: false,
      reason: "TAKEN",
    });
    expect(await resolvers.Query.renownHandleAvailability(null, { handle: "oldco" })).toEqual({
      handle: "oldco",
      available: false,
      reason: "RESERVED",
    });
    expect(await resolvers.Query.renownHandleAvailability(null, { handle: "fresh" })).toMatchObject({ available: true });
  });

  it("resolves memberOf to the user's public memberships", async () => {
    expect(await resolvers.ReadRenownUser.memberOf({ ethAddress: ALICE }, {})).toEqual([
      { orgId: "o1", handle: "acme", name: "Acme", role: "PUBLISHER" },
    ]);
    expect(await resolvers.ReadRenownUser.memberOf({ ethAddress: null }, {})).toEqual([]);
  });

  it("declares memberOf on ReadRenownUser", () => {
    const sdl = print(schema);
    expect(sdl).toMatch(/type ReadRenownUser \{[^}]*memberOf: \[ReadRenownOrgMembership!\]!/);
    expect(sdl).toMatch(/type ReadRenownOrgMembership \{\s+orgId: String!\s+handle: String!\s+name: String!\s+role: String!\s+\}/);
  });
});
