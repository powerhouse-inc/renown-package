import { describe, expect, it } from "vitest";
import type { MemberRecord, OrgRecord, OrgStore, OrgsKysely, TeamRecord } from "../store/types.js";

export interface OpenedStore {
  store: OrgStore;
  /** The same database, for rows A1 has no writer for yet (org_apps, org_domains). */
  db: OrgsKysely;
}

const T0 = new Date("2026-10-12T12:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const ALICE = "0xabc0000000000000000000000000000000000001";
const BOB = "0xb0b0000000000000000000000000000000000002";

export function org(id: string, handle: string, over: Partial<OrgRecord> = {}): OrgRecord {
  return {
    id,
    handle,
    name: handle.toUpperCase(),
    bio: null,
    website: null,
    avatarRef: null,
    links: [],
    listed: true,
    membersPublic: false,
    archived: false,
    takenDown: false,
    createdBy: ALICE,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function memberRecord(id: string, orgId: string, address: string, over: Partial<MemberRecord> = {}): MemberRecord {
  return {
    id,
    orgId,
    address,
    role: "MEMBER",
    status: "ACTIVE",
    appScopeAll: false,
    appDids: [],
    hidden: false,
    invitedBy: ALICE,
    invitedAt: T0,
    joinedAt: T0,
    endedAt: null,
    updatedAt: T0,
    ...over,
  };
}

function team(id: string, orgId: string, slug: string, createdAt = T0): TeamRecord {
  return { id, orgId, slug, name: slug, appDids: [], memberIds: [], createdAt };
}

export function describeOrgStoreContract(name: string, open: () => Promise<OpenedStore>): void {
  describe(name, () => {
    it("stores one organization per id and per handle, case-insensitively", async () => {
      const { store } = await open();
      expect(await store.insertOrganization(org("o1", "acme", { links: [{ id: "l1", label: "Docs", url: "https://d.example" }] }))).toBe(true);
      expect(await store.insertOrganization(org("o2", "ACME"))).toBe(false);
      expect(await store.insertOrganization(org("o1", "other"))).toBe(false);
      expect(await store.organization("o1")).toEqual(org("o1", "acme", { links: [{ id: "l1", label: "Docs", url: "https://d.example" }] }));
      expect((await store.organizationByHandle("Acme"))?.id).toBe("o1");
      expect(await store.organization("o2")).toBeUndefined();
      expect((await store.organizationsByIds(["o1", "nope"])).map((o) => o.id)).toEqual(["o1"]);
      expect(await store.organizationsByIds([])).toEqual([]);
    });

    it("patches an organization and counts what an address created", async () => {
      const { store } = await open();
      await store.insertOrganization(org("o1", "acme"));
      await store.insertOrganization(org("o2", "beta", { createdBy: BOB }));
      const updated = await store.updateOrganization("o1", { name: "Acme Inc.", bio: "Hi", listed: false, archived: true }, at(5));
      expect(updated).toMatchObject({ name: "Acme Inc.", bio: "Hi", listed: false, archived: true, handle: "acme", updatedAt: at(5) });
      expect(await store.updateOrganization("nope", { name: "x" }, at(5))).toBeUndefined();
      expect(await store.countOrganizationsCreatedBy(ALICE)).toBe(1);
      expect(await store.countOrganizationsCreatedBy(BOB)).toBe(1);
    });

    it("searches listed, live organizations by handle or name prefix with a keyset cursor", async () => {
      const { store } = await open();
      await store.insertOrganization(org("o1", "acme", { name: "Acme" }));
      await store.insertOrganization(org("o2", "acorn", { name: "Oak Labs" }));
      await store.insertOrganization(org("o3", "zeta", { name: "Ace Ventures" }));
      await store.insertOrganization(org("o4", "acid", { listed: false }));
      await store.insertOrganization(org("o5", "aced", { archived: true }));
      await store.insertOrganization(org("o6", "ace", { takenDown: true }));
      await store.insertOrganization(org("o7", "a_b", { name: "Under" }));
      const handles = (rows: OrgRecord[]) => rows.map((o) => o.handle);
      expect(handles(await store.searchOrganizations({ pattern: "ac%", limit: 10 }))).toEqual(["acme", "acorn", "zeta"]);
      const first = await store.searchOrganizations({ pattern: "ac%", limit: 1 });
      expect(handles(first)).toEqual(["acme", "acorn"]);
      expect(handles(await store.searchOrganizations({ pattern: "ac%", limit: 1, after: { handle: "acme", id: "o1" } }))).toEqual(["acorn", "zeta"]);
      expect(handles(await store.searchOrganizations({ pattern: "a\\_%", limit: 10 }))).toEqual(["a_b"]);
      expect(handles(await store.searchOrganizations({ pattern: null, limit: 10 }))).toEqual(["a_b", "acme", "acorn", "zeta"]);
    });

    it("keeps membership records, one open record per address and org", async () => {
      const { store } = await open();
      await store.insertMember(memberRecord("m1", "o1", ALICE, { role: "OWNER", appScopeAll: true }));
      await store.insertMember(memberRecord("m2", "o1", BOB, { status: "INVITED", joinedAt: null, invitedAt: at(1), appDids: ["did:key:z1"] }));
      await expect(store.insertMember(memberRecord("m3", "o1", BOB))).rejects.toThrow();
      expect(await store.member("m2")).toEqual(memberRecord("m2", "o1", BOB, { status: "INVITED", joinedAt: null, invitedAt: at(1), appDids: ["did:key:z1"] }));
      expect((await store.openMember("o1", BOB))?.id).toBe("m2");
      const declined = await store.updateMember("m2", { status: "DECLINED", endedAt: at(2), updatedAt: at(2) });
      expect(declined).toMatchObject({ status: "DECLINED", endedAt: at(2), appDids: ["did:key:z1"] });
      expect(await store.openMember("o1", BOB)).toBeUndefined();
      await store.insertMember(memberRecord("m3", "o1", BOB, { invitedAt: at(3) }));
      expect((await store.members("o1")).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
      expect((await store.members("o1", ["ACTIVE"])).map((m) => m.id)).toEqual(["m1", "m3"]);
      await store.insertMember(memberRecord("m4", "o2", BOB, { status: "INVITED" }));
      expect((await store.membershipsOf(BOB, ["ACTIVE", "INVITED"])).map((m) => m.id).sort()).toEqual(["m3", "m4"]);
      expect(await store.updateMember("nope", { hidden: true, updatedAt: at(4) })).toBeUndefined();
    });

    it("keeps teams with their members", async () => {
      const { store } = await open();
      await store.insertMember(memberRecord("m1", "o1", ALICE));
      await store.insertMember(memberRecord("m2", "o1", BOB));
      await store.insertTeam({ ...team("t1", "o1", "core"), appDids: ["did:key:za"] });
      await store.insertTeam(team("t2", "o1", "web", at(1)));
      await expect(store.insertTeam(team("t3", "o1", "core"))).rejects.toThrow();
      await store.setTeamMembers("t1", ["m1", "m2"]);
      await store.setTeamMembers("t2", ["m2"]);
      expect(await store.team("t1")).toEqual({ ...team("t1", "o1", "core"), appDids: ["did:key:za"], memberIds: ["m1", "m2"] });
      await store.setTeamMembers("t1", ["m1"]);
      await store.removeMemberFromTeams("m2");
      expect((await store.teams("o1")).map((t) => [t.slug, t.memberIds])).toEqual([["core", ["m1"]], ["web", []]]);
      expect(await store.updateTeam("t2", { name: "Web team", appDids: ["did:key:zb"] })).toMatchObject({ slug: "web", name: "Web team", appDids: ["did:key:zb"] });
      expect(await store.updateTeam("nope", { name: "x" })).toBeUndefined();
      expect(await store.deleteTeam("t1")).toBe(true);
      expect(await store.deleteTeam("t1")).toBe(false);
      expect((await store.teams("o1")).map((t) => t.id)).toEqual(["t2"]);
    });

    it("uses an invite link atomically, never after revocation or expiry", async () => {
      const { store } = await open();
      const link = { id: "k1", orgId: "o1", tokenHash: "h1", role: "MEMBER" as const, maxUses: 2, uses: 0, expiresAt: at(60), revoked: false, createdBy: ALICE, createdAt: T0 };
      await store.insertInviteLink(link);
      await store.insertInviteLink({ ...link, id: "k2", tokenHash: "h2", createdAt: at(1) });
      expect((await store.inviteLinkByHash("h1"))?.id).toBe("k1");
      const uses = await Promise.all([store.useInviteLink("k1", at(1)), store.useInviteLink("k1", at(1)), store.useInviteLink("k1", at(1))]);
      expect(uses.filter(Boolean)).toHaveLength(2);
      expect((await store.inviteLink("k1"))?.uses).toBe(2);
      expect(await store.useInviteLink("k2", at(61))).toBe(false);
      await store.revokeInviteLink("k2");
      expect(await store.useInviteLink("k2", at(2))).toBe(false);
      expect((await store.inviteLinks("o1")).map((l) => [l.id, l.revoked])).toEqual([["k2", true], ["k1", false]]);
    });

    it("reads org apps, verified domains and verified organizations by name", async () => {
      const { store, db } = await open();
      await store.insertOrganization(org("o1", "acme", { name: "Acme" }));
      await store.insertOrganization(org("o2", "acme-real", { name: "ACME" }));
      await db.insertInto("org_apps").values({ app_did: "did:key:za", org_id: "o1", frozen: true, added_at: T0 }).execute();
      await db
        .insertInto("org_domains")
        .values([
          { id: "d1", org_id: "o2", domain: "acme.example", token: "t", status: "VERIFIED", verified_at: T0, last_checked_at: T0, failures: 0, created_at: T0 },
          { id: "d2", org_id: "o2", domain: "pending.example", token: "t", status: "PENDING", verified_at: null, last_checked_at: null, failures: 0, created_at: T0 },
        ])
        .execute();
      expect(await store.orgApps("o1")).toEqual([{ appDid: "did:key:za", orgId: "o1", frozen: true, addedAt: T0 }]);
      expect((await store.orgOfApp("did:key:za"))?.orgId).toBe("o1");
      expect(await store.orgOfApp("did:key:zz")).toBeUndefined();
      expect(await store.verifiedDomains(["o1", "o2"])).toEqual(new Map([["o2", ["acme.example"]]]));
      expect(await store.verifiedDomains([])).toEqual(new Map());
      expect((await store.verifiedOrgNamed("acme", "o1"))?.id).toBe("o2");
      expect(await store.verifiedOrgNamed("acme", "o2")).toBeUndefined();
    });

    it("pages the audit log newest first", async () => {
      const { store } = await open();
      for (const [id, minutes] of [["a1", 1], ["a2", 2], ["a3", 2], ["a4", 3]] as const) {
        await store.appendAudit({ id, orgId: "o1", at: at(minutes), actor: ALICE, action: "x", details: { n: id } });
      }
      await store.appendAudit({ id: "b1", orgId: "o2", at: at(9), actor: "system", action: "y", details: {} });
      const first = await store.auditPage("o1", 2);
      expect(first.map((e) => e.id)).toEqual(["a4", "a3"]);
      expect(first[0]).toEqual({ id: "a4", orgId: "o1", at: at(3), actor: ALICE, action: "x", details: { n: "a4" } });
      expect((await store.auditPage("o1", 5, { at: at(2), id: "a3" })).map((e) => e.id)).toEqual(["a2", "a1"]);
    });

    it("reserves handles until a time, and re-reserving replaces the window", async () => {
      const { store } = await open();
      await store.reserveHandle({ handle: "acme", until: at(10), reason: "ARCHIVED", orgId: "o1" });
      expect(await store.reservedHandle("acme", at(5))).toEqual({ handle: "acme", until: at(10), reason: "ARCHIVED", orgId: "o1" });
      expect(await store.reservedHandle("acme", at(10))).toBeUndefined();
      await store.reserveHandle({ handle: "acme", until: at(20), reason: "RELEASED", orgId: null });
      expect((await store.reservedHandle("acme", at(15)))?.reason).toBe("RELEASED");
    });

    it("guards replays: a signature hash is usable once until pruned", async () => {
      const { store } = await open();
      expect(await store.useSignature("s1", at(10))).toBe(true);
      expect(await store.useSignature("s1", at(10))).toBe(false);
      expect(await store.useSignature("s2", at(30))).toBe(true);
      expect(await store.pruneUsedSignatures(at(20))).toBe(1);
      expect(await store.useSignature("s1", at(40))).toBe(true);
      expect(await store.useSignature("s2", at(40))).toBe(false);
      expect(await store.pruneUsedSignatures(at(20))).toBe(0);
    });

    it("normalises addresses and handles to lowercase on write", async () => {
      const { store } = await open();
      const MIXED = "0xABC0000000000000000000000000000000000001";
      await store.insertOrganization(org("o1", "acme", { createdBy: MIXED }));
      expect(await store.countOrganizationsCreatedBy(MIXED)).toBe(1);
      expect((await store.organization("o1"))?.createdBy).toBe(MIXED.toLowerCase());
      await store.reserveHandle({ handle: "MixedCase", until: at(10), reason: "ARCHIVED", orgId: null });
      expect((await store.reservedHandle("mixedcase", at(5)))?.handle).toBe("mixedcase");
      expect((await store.reservedHandle("MIXEDCASE", at(5)))?.reason).toBe("ARCHIVED");
    });

    it("enforces domain uniqueness in the database", async () => {
      const { store, db } = await open();
      await store.insertOrganization(org("o1", "acme"));
      await store.insertOrganization(org("o2", "beta"));
      const row = (id: string, orgId: string, domain: string, status: "PENDING" | "VERIFIED") => ({
        id, org_id: orgId, domain, token: "t", status, verified_at: null, last_checked_at: null, failures: 0, created_at: T0,
      });
      await db.insertInto("org_domains").values(row("d1", "o1", "x.example", "PENDING")).execute();
      await expect(db.insertInto("org_domains").values(row("d2", "o1", "X.example", "PENDING")).execute()).rejects.toThrow();
      await db.insertInto("org_domains").values(row("d3", "o1", "y.example", "VERIFIED")).execute();
      await db.insertInto("org_domains").values(row("d4", "o2", "y.example", "PENDING")).execute();
      await expect(db.updateTable("org_domains").set({ status: "VERIFIED" }).where("id", "=", "d4").execute()).rejects.toThrow();
    });
  });
}
