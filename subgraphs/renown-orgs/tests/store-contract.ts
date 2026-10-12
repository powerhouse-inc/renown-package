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

    it("runs several writes in one transaction, rolled back together on failure", async () => {
      const { store } = await open();
      await store.insertMember(memberRecord("m1", "o1", ALICE, { status: "INVITED", joinedAt: null }));
      await expect(
        store.transaction(async (tx) => {
          await tx.updateMember("m1", { status: "REVOKED", endedAt: at(1), updatedAt: at(1) });
          await tx.insertMember(memberRecord("m2", "o1", ALICE));
          await tx.insertMember(memberRecord("m3", "o1", ALICE));
        }),
      ).rejects.toThrow();
      expect((await store.members("o1")).map((m) => [m.id, m.status])).toEqual([["m1", "INVITED"]]);
      const result = await store.transaction(async (tx) => {
        await tx.updateMember("m1", { status: "REVOKED", endedAt: at(1), updatedAt: at(1) });
        await tx.insertMember(memberRecord("m2", "o1", ALICE));
        await tx.insertTeam(team("t1", "o1", "core"));
        await tx.setTeamMembers("t1", ["m2"]);
        return "done";
      });
      expect(result).toBe("done");
      expect((await store.openMember("o1", ALICE))?.id).toBe("m2");
      expect((await store.team("t1"))?.memberIds).toEqual(["m2"]);
    });

    it("deletes a member record with its team places, and gives back an invite-link use", async () => {
      const { store } = await open();
      await store.insertMember(memberRecord("m1", "o1", ALICE));
      await store.insertTeam(team("t1", "o1", "core"));
      await store.setTeamMembers("t1", ["m1"]);
      await store.deleteMember("m1");
      expect(await store.member("m1")).toBeUndefined();
      expect((await store.team("t1"))?.memberIds).toEqual([]);
      const link = { id: "k1", orgId: "o1", tokenHash: "h1", role: "MEMBER" as const, maxUses: 1, uses: 0, expiresAt: at(60), revoked: false, createdBy: ALICE, createdAt: T0 };
      await store.insertInviteLink(link);
      await store.releaseInviteLinkUse("k1");
      expect((await store.inviteLink("k1"))?.uses).toBe(0);
      expect(await store.useInviteLink("k1", at(1))).toBe(true);
      expect(await store.useInviteLink("k1", at(1))).toBe(false);
      await store.releaseInviteLinkUse("k1");
      expect(await store.useInviteLink("k1", at(1))).toBe(true);
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
      await store.deleteReservedHandle("ACME");
      expect(await store.reservedHandle("acme", at(15))).toBeUndefined();
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

    it("keeps a used signature hash through its expiry instant (strict prune boundary)", async () => {
      const { store } = await open();
      expect(await store.useSignature("s1", at(10))).toBe(true);
      expect(await store.pruneUsedSignatures(at(10))).toBe(0);
      expect(await store.useSignature("s1", at(10))).toBe(false);
      expect(await store.pruneUsedSignatures(new Date(at(10).getTime() + 1))).toBe(1);
    });

    it("inserts an organization with its owner atomically, and deletes both", async () => {
      const { store } = await open();
      const owner = memberRecord("m1", "o1", "0x00000000000000000000000000000000000000a1", { role: "OWNER", status: "ACTIVE" });
      expect(await store.insertOrganizationWithOwner(org("o1", "acme"), owner)).toBe(true);
      expect((await store.openMember("o1", owner.address))?.role).toBe("OWNER");
      // A taken handle inserts neither row.
      const other = memberRecord("m2", "o2", "0x00000000000000000000000000000000000000b2", { role: "OWNER", status: "ACTIVE" });
      expect(await store.insertOrganizationWithOwner(org("o2", "acme"), other)).toBe(false);
      expect(await store.member("m2")).toBeUndefined();
      // A failing member insert rolls the organization back.
      expect(await store.insertOrganizationWithOwner(org("o3", "beta"), { ...owner, orgId: "o3" }).catch(() => "threw")).toBe("threw");
      expect(await store.organization("o3")).toBeUndefined();
      expect(await store.organizationByHandle("beta")).toBeUndefined();
      await store.deleteOrganization("o1");
      expect(await store.organization("o1")).toBeUndefined();
      expect(await store.member("m1")).toBeUndefined();
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

    it("claims each sweep job once per interval and undoes a claim", async () => {
      const { store } = await open();
      const MINUTE = 60_000;
      expect(await store.claimJob("proposals", T0, MINUTE)).toEqual({ previous: null });
      expect(await store.claimJob("proposals", T0, MINUTE)).toBeNull();
      expect(await store.claimJob("proposals", at(0.5), MINUTE)).toBeNull();
      const claims = await Promise.all([store.claimJob("proposals", at(1), MINUTE), store.claimJob("proposals", at(1), MINUTE)]);
      expect(claims.filter(Boolean)).toEqual([{ previous: T0 }]);
      await store.releaseJob("proposals", at(1), T0);
      expect(await store.jobLastRun("proposals")).toEqual(T0);
      expect(await store.claimJob("domains", at(2), MINUTE)).toEqual({ previous: null });
      await store.releaseJob("domains", at(2), null);
      expect(await store.jobLastRun("domains")).toBeUndefined();
    });

    it("lists unarmed pending proposals whose approvals reach their threshold", async () => {
      const { store } = await open();
      const base = {
        orgId: "o1",
        kind: "ADD_OWNER" as const,
        payload: { address: BOB },
        proposer: ALICE,
        status: "PENDING" as const,
        threshold: 2,
        createdAt: T0,
        executableAt: null,
        expiresAt: at(60),
        executedAt: null,
        reason: null,
      };
      await store.insertProposal({ ...base, id: "low", approvals: [ALICE] });
      await store.insertProposal({ ...base, id: "stuck", approvals: [ALICE, BOB] });
      await store.insertProposal({ ...base, id: "armed", approvals: [ALICE, BOB], executableAt: at(5) });
      await store.insertProposal({ ...base, id: "old", approvals: [ALICE, BOB], expiresAt: at(1) });
      expect((await store.rearmableProposals(at(2), 10)).map((p) => p.id)).toEqual(["stuck"]);
    });

    it("keeps proposals and moves them only from the expected status", async () => {
      const { store } = await open();
      const base = {
        orgId: "o1",
        kind: "ADD_OWNER" as const,
        payload: { address: BOB },
        proposer: ALICE,
        approvals: [ALICE],
        status: "PENDING" as const,
        threshold: 2,
        executableAt: null,
        expiresAt: at(60),
        executedAt: null,
        reason: null,
      };
      await store.insertProposal({ ...base, id: "p1", createdAt: T0 });
      await store.insertProposal({ ...base, id: "p2", createdAt: at(1), executableAt: at(5) });
      expect(await store.proposal("p1")).toEqual({ ...base, id: "p1", createdAt: T0 });
      expect((await store.proposals("o1")).map((p) => p.id)).toEqual(["p2", "p1"]);
      expect(await store.dueProposals(at(4), 10)).toEqual([]);
      expect((await store.dueProposals(at(5), 10)).map((p) => p.id)).toEqual(["p2"]);
      expect((await store.dueProposals(at(60), 10)).map((p) => p.id)).toEqual(["p1", "p2"]);
      const claimed = await Promise.all([
        store.updateProposal("p2", { status: "EXECUTED", executedAt: at(6) }, "PENDING"),
        store.updateProposal("p2", { status: "EXECUTED", executedAt: at(6) }, "PENDING"),
      ]);
      expect(claimed.filter(Boolean)).toHaveLength(1);
      expect(await store.updateProposal("p2", { status: "FAILED", executedAt: null, reason: "x" }, "EXECUTED")).toMatchObject({
        status: "FAILED",
        executedAt: null,
        reason: "x",
      });
      expect((await store.proposals("o1", "PENDING")).map((p) => p.id)).toEqual(["p1"]);
    });

    it("writes domains, verifies a domain for one organization only, lists those due for a re-check", async () => {
      const { store } = await open();
      const domain = (id: string, orgId: string, name: string) => ({
        id,
        orgId,
        domain: name,
        token: "t",
        status: "PENDING" as const,
        verifiedAt: null,
        lastCheckedAt: null,
        failures: 0,
        createdAt: T0,
      });
      await store.insertDomain(domain("d1", "o1", "acme.example"));
      await store.insertDomain(domain("d2", "o2", "acme.example"));
      expect(await store.updateDomain("d1", { status: "VERIFIED", verifiedAt: T0, lastCheckedAt: T0 })).toMatchObject({
        status: "VERIFIED",
        verifiedAt: T0,
      });
      await expect(store.updateDomain("d2", { status: "VERIFIED", verifiedAt: T0 })).rejects.toThrow();
      expect(await store.verifiedDomainOwner("ACME.example")).toBe("o1");
      expect(await store.verifiedDomainOwner("other.example")).toBeUndefined();
      expect((await store.domains("o1")).map((d) => d.id)).toEqual(["d1"]);
      expect((await store.domainsToRecheck(new Date(T0.getTime() - 1), 10)).map((d) => d.id)).toEqual([]);
      expect((await store.domainsToRecheck(T0, 10)).map((d) => d.id)).toEqual(["d1"]);
      expect(await store.updateDomain("missing", { failures: 1 })).toBeUndefined();
      expect(await store.updateDomain("d1", { failures: 1 }, { lastCheckedAt: null })).toBeUndefined();
      expect(await store.updateDomain("d1", { failures: 1 }, { lastCheckedAt: new Date(T0.getTime() + 1) })).toBeUndefined();
      expect(await store.updateDomain("d1", { failures: 1 }, { lastCheckedAt: T0 })).toMatchObject({ failures: 1 });
      expect(await store.updateDomain("d2", { failures: 2 }, { lastCheckedAt: null })).toMatchObject({ failures: 2 });
      expect(await store.deleteDomain("d2")).toBe(true);
      expect(await store.deleteDomain("d2")).toBe(false);
      expect(await store.domain("d2")).toBeUndefined();
    });

    it("suspends credentials once per organisation and lifts suspensions", async () => {
      const { store } = await open();
      const row = (credentialId: string, orgId = "o1") => ({ orgId, credentialId, reason: "ADMIN", memberAddress: null, at: T0 });
      expect(await store.suspendCredentials([row("c1"), row("c2")])).toEqual(["c1", "c2"]);
      expect(await store.suspendCredentials([row("c2"), row("c3"), row("c1", "o2")])).toEqual(["c3", "c1"]);
      expect(await store.suspendedCredentialIds("o1")).toEqual(["c1", "c2", "c3"]);
      expect(await store.credentialSuspension("o2", "c1")).toEqual(row("c1", "o2"));
      expect(await store.credentialSuspension("o2", "c2")).toBeUndefined();
      expect(await store.unsuspendCredential("o1", "c2")).toBe(true);
      expect(await store.unsuspendCredential("o1", "c2")).toBe(false);
      expect(await store.suspendedCredentialIds("o1")).toEqual(["c1", "c3"]);
    });

    it("keeps member-level suspensions per organisation and address, never moving them earlier", async () => {
      const { store } = await open();
      await store.suspendMember({ orgId: "o1", address: "0xABC", reason: "MEMBER_LEFT", at: at(10) });
      expect(await store.memberSuspension("o1", "0xabc")).toEqual({ orgId: "o1", address: "0xabc", reason: "MEMBER_LEFT", at: at(10) });
      await store.suspendMember({ orgId: "o1", address: "0xabc", reason: "MEMBER_REMOVED", at: at(5) });
      expect(await store.memberSuspension("o1", "0xabc")).toEqual({ orgId: "o1", address: "0xabc", reason: "MEMBER_REMOVED", at: at(10) });
      await store.suspendMember({ orgId: "o1", address: "0xabc", reason: "MEMBER_LEFT", at: at(20) });
      expect((await store.memberSuspension("o1", "0xabc"))?.at).toEqual(at(20));
      expect(await store.memberSuspension("o2", "0xabc")).toBeUndefined();
      expect(await store.liftMemberSuspension("o1", "0xabc")).toBe(true);
      expect(await store.liftMemberSuspension("o1", "0xabc")).toBe(false);
      expect(await store.memberSuspension("o1", "0xabc")).toBeUndefined();
    });

    it("keeps one pending transfer per app and moves transfers only from the expected status", async () => {
      const { store } = await open();
      const transfer = (id: string, appDid: string, createdAt = T0) => ({
        id,
        appDid,
        fromKind: "PERSON" as const,
        fromId: ALICE,
        toKind: "ORG" as const,
        toId: "o1",
        status: "PENDING" as const,
        createdAt,
        expiresAt: at(60),
        decidedAt: null,
        decidedBy: null,
        proposalId: null,
        reason: null,
      });
      await store.insertTransfer(transfer("t1", "did:key:za"));
      await expect(store.insertTransfer(transfer("t2", "did:key:za"))).rejects.toThrow();
      await store.insertTransfer(transfer("t3", "did:key:zb", at(1)));
      expect((await store.pendingTransferOf("did:key:za"))?.id).toBe("t1");
      expect((await store.transfers({ party: { kind: "ORG", id: "o1" } })).map((t) => t.id)).toEqual(["t3", "t1"]);
      expect((await store.transfers({ appDid: "did:key:zb", party: { kind: "PERSON", id: ALICE } })).map((t) => t.id)).toEqual(["t3"]);
      expect(await store.transfers({ party: { kind: "PERSON", id: BOB } })).toEqual([]);
      expect(await store.updateTransfer("t1", { status: "ACCEPTED", decidedAt: at(2), decidedBy: BOB }, "PENDING")).toMatchObject({ status: "ACCEPTED", decidedBy: BOB });
      expect(await store.updateTransfer("t1", { status: "DECLINED" }, "PENDING")).toBeUndefined();
      // Back to PENDING (a failed acceptance): the decision is cleared.
      expect(await store.updateTransfer("t1", { status: "PENDING", decidedAt: null, decidedBy: null }, "ACCEPTED")).toMatchObject({ status: "PENDING", decidedBy: null, decidedAt: null });
      expect(await store.updateTransfer("t1", { status: "ACCEPTED", decidedAt: at(3), decidedBy: BOB }, "PENDING")).toBeDefined();
      expect(await store.updateTransfer("t3", { status: "CANCELLED", reason: "app owner changed" }, "PENDING")).toMatchObject({ status: "CANCELLED", reason: "app owner changed" });
      expect(await store.updateTransfer("t3", { status: "PENDING", reason: null }, "CANCELLED")).toMatchObject({ reason: null });
      expect((await store.dueTransfers(at(60), 10)).map((t) => t.id)).toEqual(["t3"]);
      expect(await store.dueTransfers(at(59), 10)).toEqual([]);
      expect(await store.insertOrgApp({ appDid: "did:key:za", orgId: "o1", frozen: false, addedAt: T0 })).toBe(true);
      expect(await store.insertOrgApp({ appDid: "did:key:za", orgId: "o2", frozen: false, addedAt: T0 })).toBe(false);
      await store.setAppFrozen("did:key:za", true);
      expect((await store.orgOfApp("did:key:za"))?.frozen).toBe(true);
      expect(await store.deleteOrgApp("did:key:za", "o2")).toBeUndefined();
      expect(await store.deleteOrgApp("did:key:za", "o1")).toMatchObject({ orgId: "o1", frozen: true, addedAt: T0 });
      expect(await store.orgOfApp("did:key:za")).toBeUndefined();
    });
    it("keeps one attestation per app, version and signer, pages and counts them", async () => {
      const { store } = await open();
      const attestation = (id: string, version: string, createdAt: Date, signer = ALICE) => ({
        id,
        appDid: "did:key:za",
        version,
        artifactDigest: `sha256:${"a".repeat(64)}`,
        orgId: "o1",
        signer,
        signerRole: "PUBLISHER" as const,
        issuedAt: createdAt.toISOString(),
        signature: "0xsig",
        createdAt,
      });
      expect(await store.insertAttestation(attestation("a1", "1.0.0", T0))).toBe(true);
      expect(await store.insertAttestation(attestation("a2", "1.0.0", at(1)))).toBe(false);
      expect(await store.insertAttestation(attestation("a3", "1.0.0", at(1), BOB))).toBe(true);
      expect(await store.insertAttestation(attestation("a4", "1.1.0", at(2)))).toBe(true);
      expect(await store.insertAttestation({ ...attestation("a5", "1.0.0", at(3), "0xABC0000000000000000000000000000000000001") })).toBe(false);
      expect((await store.attestationBy("did:key:za", "1.0.0", BOB))?.id).toBe("a3");
      expect(await store.attestationBy("did:key:za", "9.9.9", BOB)).toBeUndefined();
      expect((await store.attestationsPage("did:key:za", 2)).map((a) => a.id)).toEqual(["a4", "a3"]);
      expect((await store.attestationsPage("did:key:za", 5, { createdAt: at(1), id: "a3" })).map((a) => a.id)).toEqual(["a1"]);
      expect(await store.countAttestationsSince("did:key:za", at(1))).toBe(2);
      expect(await store.countOrgAttestationsSince("o1", T0)).toBe(3);
      expect(await store.countOrgAttestationsSince("o2", T0)).toBe(0);
      expect(await store.attestation("a1")).toEqual(attestation("a1", "1.0.0", T0));
      expect(await store.attestation("a2")).toBeUndefined();
    });
    it("keeps notifications per recipient, pages them, marks only the recipient's own as read, prunes old ones", async () => {
      const { store } = await open();
      const note = (id: string, recipient: string, createdAt: Date) => ({ id, recipient, kind: "INVITED", orgId: "o1", payload: { n: id }, createdAt, readAt: null });
      await store.insertNotifications([note("n1", ALICE, T0), note("n2", ALICE, at(1)), note("n3", ALICE, at(2)), note("n4", BOB, at(2))]);
      expect((await store.notificationsPage(ALICE, { unreadOnly: false, limit: 2 })).map((n) => n.id)).toEqual(["n3", "n2"]);
      expect((await store.notificationsPage(ALICE, { unreadOnly: false, limit: 5, after: { createdAt: at(1), id: "n2" } })).map((n) => n.id)).toEqual(["n1"]);
      expect(await store.unreadNotificationCount(ALICE)).toBe(3);
      expect(await store.markNotificationsRead(ALICE, ["n1", "n4"], at(3))).toBe(1);
      expect(await store.markNotificationsRead(ALICE, ["n1"], at(4))).toBe(0);
      expect((await store.notificationsPage(ALICE, { unreadOnly: true, limit: 5 })).map((n) => n.id)).toEqual(["n3", "n2"]);
      expect(await store.markNotificationsRead(ALICE, "ALL", at(5))).toBe(2);
      expect(await store.unreadNotificationCount(BOB)).toBe(1);
      expect(await store.pruneNotifications(at(2))).toBe(2);
      expect((await store.notificationsPage(ALICE, { unreadOnly: false, limit: 5 })).map((n) => n.id)).toEqual(["n3"]);
    });
    it("keeps a job watermark, lists every org app, and claims each delegation alert once", async () => {
      const { store } = await open();
      expect(await store.jobWatermark("delegations")).toBeUndefined();
      await store.setJobWatermark("delegations", T0);
      await store.setJobWatermark("delegations", at(5));
      expect(await store.jobWatermark("delegations")).toEqual(at(5));
      await store.insertOrgApp({ appDid: "did:key:zb", orgId: "o2", frozen: false, addedAt: T0 });
      await store.insertOrgApp({ appDid: "did:key:za", orgId: "o1", frozen: false, addedAt: T0 });
      expect((await store.allOrgApps()).map((a) => [a.appDid, a.orgId])).toEqual([["did:key:za", "o1"], ["did:key:zb", "o2"]]);
      expect(await store.claimDelegationAlert("c1", "o1", T0)).toBe(true);
      expect(await store.claimDelegationAlert("c1", "o1", at(1))).toBe(false);
      expect(await store.claimDelegationAlert("c2", "o1", at(2))).toBe(true);
      expect(await store.pruneDelegationAlerts(at(1))).toBe(1);
      expect(await store.claimDelegationAlert("c1", "o1", at(3))).toBe(true);
    });
  });
}
