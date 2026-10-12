import { PGlite } from "@electric-sql/pglite";
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { KyselyOrgStore } from "../store/kysely.js";
import { isMissingNamespace, orgAvatarRef, orgHandleStatus, publicMembershipsOf } from "../store/lookups.js";
import { migrate } from "../store/migrations.js";
import { ORGS_NAMESPACE, type OrgsDB } from "../store/types.js";
import { memberRecord, org } from "./store-contract.js";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const ALICE = "0xabc0000000000000000000000000000000000001";
const AVATAR = `attachment://v1:${"c".repeat(64)}`;
let root: Kysely<OrgsDB>;
let db: IRelationalDb<unknown>;

beforeAll(async () => {
  root = new Kysely<OrgsDB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(ORGS_NAMESPACE)}`.execute(root);
  await migrate(root.withSchema(ORGS_NAMESPACE));
  db = { queryNamespace: (ns: string) => root.withSchema(ns) } as unknown as IRelationalDb<unknown>;
  const store = new KyselyOrgStore(root.withSchema(ORGS_NAMESPACE));
  await store.insertOrganization(org("o1", "acme", { name: "Acme", membersPublic: true, avatarRef: AVATAR }));
  await store.insertOrganization(org("o2", "quiet", { membersPublic: false }));
  await store.insertOrganization(org("o3", "gone", { membersPublic: true, archived: true }));
  await store.insertOrganization(org("o4", "banned", { membersPublic: true, takenDown: true, avatarRef: AVATAR }));
  await store.insertOrganization(org("o5", "zeta", { name: "Zeta", membersPublic: true }));
  await store.insertMember(memberRecord("m1", "o1", ALICE, { role: "ADMIN" }));
  await store.insertMember(memberRecord("m2", "o2", ALICE));
  await store.insertMember(memberRecord("m3", "o3", ALICE));
  await store.insertMember(memberRecord("m4", "o4", ALICE));
  await store.insertMember(memberRecord("m5", "o5", ALICE, { hidden: true }));
  await store.insertMember(memberRecord("m6", "o5", "0xb0b0000000000000000000000000000000000002", { status: "INVITED" }));
  await store.reserveHandle({ handle: "oldco", until: new Date(NOW.getTime() + 1000), reason: "ARCHIVED", orgId: "o9" });
});

afterAll(async () => {
  await root.destroy();
});

describe("renown-orgs lookups for other subgraphs", () => {
  it("says whether an organization holds or reserves a handle, case-insensitively", async () => {
    expect(await orgHandleStatus(db, "ACME", NOW)).toBe("TAKEN");
    expect(await orgHandleStatus(db, "oldco", NOW)).toBe("RESERVED");
    expect(await orgHandleStatus(db, "oldco", new Date(NOW.getTime() + 1000))).toBeNull();
    expect(await orgHandleStatus(db, "free", NOW)).toBeNull();
  });

  it("lists only public memberships: active, not hidden, membersPublic, live organizations", async () => {
    expect(await publicMembershipsOf(db, ALICE.toUpperCase().replace("0X", "0x"))).toEqual([
      { orgId: "o1", handle: "acme", name: "Acme", role: "ADMIN" },
    ]);
    expect(await publicMembershipsOf(db, "0xb0b0000000000000000000000000000000000002")).toEqual([]);
  });

  it("serves the avatar of live organizations only", async () => {
    expect(await orgAvatarRef(db, "o1")).toBe(AVATAR);
    expect(await orgAvatarRef(db, "o4")).toBeNull();
    expect(await orgAvatarRef(db, "nope")).toBeNull();
  });

  it("reads a missing namespace as no organizations, and rethrows anything else", async () => {
    const empty = new Kysely<OrgsDB>({ dialect: new PGliteDialect(new PGlite()) });
    const bare = { queryNamespace: (ns: string) => empty.withSchema(ns) } as unknown as IRelationalDb<unknown>;
    expect(await orgHandleStatus(bare, "acme", NOW)).toBeNull();
    expect(await publicMembershipsOf(bare, ALICE)).toEqual([]);
    expect(await orgAvatarRef(bare, "o1")).toBeNull();
    await empty.destroy();
    const broken = { queryNamespace: () => { throw new Error("pool exhausted"); } } as unknown as IRelationalDb<unknown>;
    await expect(orgHandleStatus(broken, "acme", NOW)).rejects.toThrow("pool exhausted");
    expect(isMissingNamespace({ code: "42P01" })).toBe(true);
    expect(isMissingNamespace(new Error("x"))).toBe(false);
  });
});
