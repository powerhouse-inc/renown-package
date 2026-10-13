import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { actions as orgActions, type RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import type { RecordedActivity } from "../core/activity.js";
import type { OrgInviteLinkOutput, OrgInviteOutput, OrgMemberOutput, OrgMembershipOutput, OrganizationOutput } from "../output.js";
import type { MembershipEnded } from "../runtime.js";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  EVE,
  createOrg,
  failure,
  harnessResolvers,
  insertUser,
  join,
  lower,
  openHarness,
  resetHarness,
  T0,
  type Harness,
  type TestResolvers,
} from "./harness.js";
import { memberRecord } from "./store-contract.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const DAY = 86_400_000;
const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

function recording(extra: Parameters<typeof harnessResolvers>[1] = {}) {
  const events: RecordedActivity[] = [];
  const t = harnessResolvers(h, { sinks: [(activity) => Promise.resolve(void events.push(activity))], ...extra });
  return { t, events };
}

async function members(t: TestResolvers, orgId: string, who = ALICE, includeInactive = false) {
  return t.query<OrgMemberOutput[]>("organizationMembers", { orgId, includeInactive }, who);
}

/** Makes an existing ACTIVE member an OWNER (A1 has no mutation for it; A2's ADD_OWNER does this). */
async function promoteToOwner(t: TestResolvers, orgId: string, memberId: string) {
  await t.reactor.execute(orgId, "main", [orgActions.setMemberRole({ id: memberId, role: "OWNER", at: T0.toISOString() })]);
  await t.store.updateMember(memberId, { role: "OWNER", updatedAt: T0 });
}

describe("direct invites", () => {
  it("invites by handle; the invitee sees it, accepts and becomes an active member", async () => {
    const { t, events } = recording();
    const { id } = await createOrg(t, ALICE, "acme");
    await insertUser(h, { address: lower(BOB), handle: "bob", documentId: "u-bob", displayName: "Bob" });
    const invite = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: " Bob ", role: "PUBLISHER" }, ALICE);
    expect(invite).toMatchObject({ orgId: id, address: lower(BOB), role: "PUBLISHER", status: "INVITED", invitedBy: lower(ALICE), org: { handle: "acme" } });
    expect(invite.expiresAt).toBe(new Date(T0.getTime() + 14 * DAY).toISOString());
    expect((await t.query<OrgInviteOutput[]>("myOrgInvites", {}, BOB)).map((i) => i.id)).toEqual([invite.id]);
    expect((await t.query<OrgInviteOutput[]>("orgInvites", { orgId: id }, ALICE)).map((i) => i.id)).toEqual([invite.id]);
    const joined = await t.mutate<OrgMemberOutput>("respondToOrgInvite", { orgId: id, inviteId: invite.id, accept: true }, BOB);
    expect(joined).toMatchObject({ address: lower(BOB), status: "ACTIVE", role: "PUBLISHER", handle: "bob", displayName: "Bob", expiresAt: null });
    expect((await members(t, id)).map((m) => [m.address, m.role])).toEqual([[lower(ALICE), "OWNER"], [lower(BOB), "PUBLISHER"]]);
    expect(t.reactor.state<RenownOrganizationState>(id).members.map((m) => [m.address, m.status])).toEqual([
      [lower(ALICE), "ACTIVE"],
      [lower(BOB), "ACTIVE"],
    ]);
    expect(events.map((e) => [e.action, e.event?.type, e.notify?.map((n) => [n.to, n.kind])])).toEqual([
      ["createOrganization", undefined, undefined],
      ["inviteOrgMember", "member.invited", [[[lower(BOB)], "INVITED"]]],
      ["respondToOrgInvite", "member.joined", [["ADMINS", "INVITE_ACCEPTED"]]],
    ]);
  });

  it("lets the invitee decline and an admin revoke; only the invitee answers", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const first = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    expect((await failure(t.mutate("respondToOrgInvite", { orgId: id, inviteId: first.id, accept: true }, CAROL))).code).toBe("NOT_FOUND");
    expect((await t.mutate<OrgMemberOutput>("respondToOrgInvite", { orgId: id, inviteId: first.id, accept: false }, BOB)).status).toBe("DECLINED");
    expect((await failure(t.mutate("respondToOrgInvite", { orgId: id, inviteId: first.id, accept: true }, BOB))).field).toBe("inviteId");
    const second = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    expect((await t.mutate<OrgInviteOutput>("revokeOrgInvite", { orgId: id, inviteId: second.id }, ALICE)).status).toBe("REVOKED");
    expect(await t.query("myOrgInvites", {}, BOB)).toEqual([]);
  });

  it("enforces who invites whom: admins up to publisher, owners admins, nobody owners", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    await join(t, id, CAROL, "MEMBER");
    expect((await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: DAVE.address, role: "MEMBER" }, CAROL))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: DAVE.address, role: "ADMIN" }, BOB))).code).toBe("FORBIDDEN");
    expect(await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: DAVE.address, role: "OWNER" }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "role" });
    const adminInvite = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: DAVE.address, role: "ADMIN" }, ALICE);
    expect((await failure(t.mutate("revokeOrgInvite", { orgId: id, inviteId: adminInvite.id }, BOB))).code).toBe("FORBIDDEN");
    expect((await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: EVE.address, role: "PUBLISHER" }, BOB)).role).toBe("PUBLISHER");
    expect(await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: CAROL.address, role: "MEMBER" }, ALICE))).toMatchObject({ field: "invitee" });
    expect(await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: EVE.address, role: "MEMBER" }, ALICE))).toMatchObject({ field: "invitee" });
    expect(await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: "nobody", role: "MEMBER" }, ALICE))).toMatchObject({ field: "invitee" });
    expect(await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: "0x123", role: "MEMBER" }, ALICE))).toMatchObject({ field: "invitee" });
  });

  it("re-invites over an expired invite, and expired invites count toward no limit", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const old = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    t.tick(15 * DAY);
    expect((await t.query<OrgInviteOutput[]>("orgInvites", { orgId: id }, ALICE)).map((i) => i.status)).toEqual(["EXPIRED"]);
    expect(await failure(t.mutate("respondToOrgInvite", { orgId: id, inviteId: old.id, accept: true }, BOB))).toMatchObject({ field: "inviteId" });
    const fresh = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    expect((await t.store.member(old.id))?.status).toBe("REVOKED");
    expect(t.reactor.state<RenownOrganizationState>(id).members.map((m) => [m.id, m.status])).toEqual([
      [expect.any(String), "ACTIVE"],
      [old.id, "REVOKED"],
      [fresh.id, "INVITED"],
    ]);
    const stale = new Date(t.clock.now.getTime() - 15 * DAY);
    for (let i = 0; i < 200; i++) {
      await t.store.insertMember(memberRecord(`x${i}`, id, `0x${(i + 1).toString(16).padStart(40, "0")}`, { status: "INVITED", invitedAt: stale, joinedAt: null }));
    }
    await t.mutate("inviteOrgMember", { orgId: id, invitee: CAROL.address, role: "MEMBER" }, ALICE);
    for (let i = 0; i < 198; i++) {
      await t.store.insertMember(memberRecord(`y${i}`, id, `0x${(i + 1000).toString(16).padStart(40, "0")}`, { status: "INVITED", invitedAt: t.clock.now, joinedAt: null }));
    }
    expect((await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: DAVE.address, role: "MEMBER" }, ALICE))).code).toBe("LIMIT_REACHED");
  });

  it("rate limits invites per organization", async () => {
    const t = harnessResolvers(h, { inviteLimiter: { take: () => false } });
    const { id } = await createOrg(t, ALICE, "acme");
    expect((await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE))).code).toBe("RATE_LIMITED");
  });
});

describe("invite links", () => {
  async function link(t: TestResolvers, orgId: string, over: Record<string, unknown> = {}) {
    return t.mutate<{ link: OrgInviteLinkOutput; token: string }>(
      "createOrgInviteLink",
      { orgId, role: "PUBLISHER", maxUses: 2, expiresAt: new Date(t.clock.now.getTime() + DAY).toISOString(), ...over },
      ALICE,
    );
  }

  it("shows the token once, stores only its hash, previews and accepts it up to maxUses", async () => {
    const { t, events } = recording();
    const { id } = await createOrg(t, ALICE, "acme");
    const { link: created, token } = await link(t, id);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(await t.store.inviteLinks(id))).not.toContain(token);
    expect(JSON.stringify(await t.store.auditPage(id, 10))).not.toContain(token);
    expect(await t.query("orgInviteLink", { token })).toMatchObject({ org: { handle: "acme" }, role: "PUBLISHER", expired: false, revoked: false, full: false, usable: true });
    expect(await t.query("orgInviteLink", { token: "nope" })).toBeNull();
    expect((await t.mutate<OrgMemberOutput>("acceptOrgInviteLink", { token }, CAROL))).toMatchObject({ address: lower(CAROL), role: "PUBLISHER", status: "ACTIVE" });
    await t.mutate("acceptOrgInviteLink", { token }, DAVE);
    expect(await failure(t.mutate("acceptOrgInviteLink", { token }, EVE))).toMatchObject({ code: "BAD_USER_INPUT", field: "token" });
    expect(await t.query("orgInviteLink", { token })).toMatchObject({ full: true, usable: false });
    expect((await t.query<OrgInviteLinkOutput[]>("orgInviteLinks", { orgId: id }, ALICE))[0]).toMatchObject({ id: created.id, uses: 2 });
    expect(events.filter((e) => e.event?.type === "member.joined")).toHaveLength(2);
  });

  it("lets exactly one of two racing acceptors take the last use", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const { token } = await link(t, id, { maxUses: 1 });
    const results = await Promise.allSettled([
      t.mutate("acceptOrgInviteLink", { token }, CAROL),
      t.mutate("acceptOrgInviteLink", { token }, DAVE),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await members(t, id)).length).toBe(2);
  });

  it("refuses revoked, expired and foreign tokens, members and pending invitees", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const revoked = await link(t, id);
    expect((await t.mutate<OrgInviteLinkOutput>("revokeOrgInviteLink", { orgId: id, linkId: revoked.link.id }, ALICE)).revoked).toBe(true);
    expect(await failure(t.mutate("acceptOrgInviteLink", { token: revoked.token }, CAROL))).toMatchObject({ field: "token" });
    const live = await link(t, id);
    expect(await failure(t.mutate("acceptOrgInviteLink", { token: live.token }, ALICE))).toMatchObject({ field: "token" });
    await t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    expect(await failure(t.mutate("acceptOrgInviteLink", { token: live.token }, BOB))).toMatchObject({ field: "token" });
    expect(await failure(t.mutate("acceptOrgInviteLink", { token: "made-up" }, CAROL))).toMatchObject({ field: "token" });
    t.tick(DAY);
    expect(await failure(t.mutate("acceptOrgInviteLink", { token: live.token }, CAROL))).toMatchObject({ field: "token" });
    expect(await t.query("orgInviteLink", { token: live.token })).toMatchObject({ expired: true, usable: false });
  });

  it("validates role, maxUses and expiresAt, for admins only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const later = (ms: number) => new Date(t.clock.now.getTime() + ms).toISOString();
    expect(await failure(link(t, id, { role: "ADMIN" }))).toMatchObject({ field: "role" });
    expect(await failure(link(t, id, { maxUses: 0 }))).toMatchObject({ field: "maxUses" });
    expect(await failure(link(t, id, { maxUses: 101 }))).toMatchObject({ field: "maxUses" });
    expect(await failure(link(t, id, { expiresAt: later(31 * DAY) }))).toMatchObject({ field: "expiresAt" });
    expect(await failure(link(t, id, { expiresAt: later(-1000) }))).toMatchObject({ field: "expiresAt" });
    expect(await failure(link(t, id, { expiresAt: "tomorrow" }))).toMatchObject({ field: "expiresAt" });
    expect((await link(t, id, { maxUses: 100, expiresAt: later(30 * DAY) })).link.maxUses).toBe(100);
    const notAdmin = t.mutate("createOrgInviteLink", { orgId: id, role: "MEMBER", maxUses: 1, expiresAt: later(DAY) }, BOB);
    expect((await failure(notAdmin)).code).toBe("FORBIDDEN");
  });
});

describe("leaving and removal", () => {
  it("lets members leave, ends their teams and runs the membership-ended hooks; the last owner cannot leave", async () => {
    const ended: MembershipEnded[] = [];
    const t = harnessResolvers(h, { membershipHooks: [(event) => Promise.resolve(void ended.push(event))] });
    const { id } = await createOrg(t, ALICE, "acme");
    const bob = await join(t, id, BOB, "PUBLISHER");
    await t.store.insertTeam({ id: "t1", orgId: id, slug: "core", name: "Core", appDids: [], memberIds: [bob], createdAt: T0 });
    expect((await failure(t.mutate("leaveOrganization", { orgId: id }, ALICE))).code).toBe("LAST_OWNER");
    expect(await t.mutate("leaveOrganization", { orgId: id }, BOB)).toBe(true);
    expect(await t.store.member(bob)).toMatchObject({ status: "LEFT", endedAt: T0 });
    expect((await t.store.team("t1"))?.memberIds).toEqual([]);
    expect(ended).toEqual([{ orgId: id, memberId: bob, address: lower(BOB), reason: "LEFT", actor: lower(BOB), at: T0 }]);
    expect((await failure(t.mutate("leaveOrganization", { orgId: id }, BOB))).code).toBe("FORBIDDEN");
  });

  it("members of a taken-down organisation still leave it and decline its invites, but never accept them", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const bob = await join(t, id, BOB, "MEMBER");
    const carol = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: CAROL.address, role: "MEMBER" }, ALICE);
    const dave = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: DAVE.address, role: "MEMBER" }, ALICE);
    await t.store.updateOrganization(id, { takenDown: true }, T0);
    expect(await t.mutate("leaveOrganization", { orgId: id }, BOB)).toBe(true);
    expect(await t.store.member(bob)).toMatchObject({ status: "LEFT" });
    expect(await t.mutate<OrgMemberOutput>("respondToOrgInvite", { orgId: id, inviteId: carol.id, accept: false }, CAROL)).toMatchObject({ status: "DECLINED" });
    expect((await failure(t.mutate("respondToOrgInvite", { orgId: id, inviteId: dave.id, accept: true }, DAVE))).code).toBe("FORBIDDEN");
    expect(await t.store.member(dave.id)).toMatchObject({ status: "INVITED" });
  });

  it("serialises concurrent leaves under the org lock, so one owner always remains", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await promoteToOwner(t, id, await join(t, id, BOB, "ADMIN"));
    const results = await Promise.allSettled([
      t.mutate("leaveOrganization", { orgId: id }, ALICE),
      t.mutate("leaveOrganization", { orgId: id }, BOB),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await t.store.members(id, ["ACTIVE"])).filter((m) => m.role === "OWNER")).toHaveLength(1);
  });

  it("lets admins remove up to publisher and owners remove admins, never owners", async () => {
    const { t, events } = recording();
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    await join(t, id, CAROL, "PUBLISHER");
    await join(t, id, DAVE, "ADMIN");
    expect((await t.mutate<OrgMemberOutput>("removeOrgMember", { orgId: id, address: CAROL.address }, BOB)).status).toBe("REMOVED");
    expect((await failure(t.mutate("removeOrgMember", { orgId: id, address: DAVE.address }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("removeOrgMember", { orgId: id, address: ALICE.address }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("removeOrgMember", { orgId: id, address: BOB.address }, BOB))).field).toBe("address");
    expect((await failure(t.mutate("removeOrgMember", { orgId: id, address: EVE.address }, ALICE))).code).toBe("NOT_FOUND");
    expect((await t.mutate<OrgMemberOutput>("removeOrgMember", { orgId: id, address: DAVE.address }, ALICE)).status).toBe("REMOVED");
    expect(events.filter((e) => e.action === "removeOrgMember").map((e) => [e.event?.type, e.notify?.[0]?.to])).toEqual([
      ["member.removed", [lower(CAROL)]],
      ["member.removed", [lower(DAVE)]],
    ]);
  });
});

describe("roles, app scopes and hiding", () => {
  it("lets admins change roles up to publisher and owners manage admins", async () => {
    const { t, events } = recording();
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "MEMBER");
    await join(t, id, CAROL, "ADMIN");
    const role = (who: typeof BOB, value: string, by: typeof BOB) =>
      t.mutate<OrgMemberOutput>("setOrgMemberRole", { orgId: id, address: who.address, role: value }, by);
    expect((await role(BOB, "PUBLISHER", CAROL)).role).toBe("PUBLISHER");
    expect((await failure(role(BOB, "ADMIN", CAROL))).code).toBe("FORBIDDEN");
    expect((await failure(role(CAROL, "MEMBER", CAROL))).code).toBe("FORBIDDEN");
    expect((await failure(role(ALICE, "ADMIN", ALICE))).code).toBe("FORBIDDEN");
    expect(await failure(role(BOB, "OWNER", ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "role" });
    expect((await role(BOB, "ADMIN", ALICE)).appScope).toEqual({ all: true, appDids: [] });
    expect((await role(BOB, "ADMIN", ALICE)).role).toBe("ADMIN");
    expect(events.filter((e) => e.action === "setOrgMemberRole").map((e) => e.event?.data)).toEqual([
      { address: lower(BOB), from: "MEMBER", to: "PUBLISHER" },
      { address: lower(BOB), from: "PUBLISHER", to: "ADMIN" },
    ]);
  });

  it("sets the app scope of publishers and members; owners and admins always have all", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    await join(t, id, CAROL, "ADMIN");
    const scope = (who: typeof BOB, appScope: unknown) => t.mutate<OrgMemberOutput>("setOrgMemberAppScope", { orgId: id, address: who.address, appScope }, ALICE);
    expect((await scope(BOB, { all: false, appDids: [APP, APP] })).appScope).toEqual({ all: false, appDids: [APP] });
    expect(await t.query<OrgMembershipOutput>("orgMembership", { orgId: id, address: BOB.address })).toMatchObject({
      role: "PUBLISHER",
      appScope: { all: false, appDids: [APP] },
      effectiveScope: { all: false, appDids: [APP] },
    });
    expect(await failure(scope(BOB, { all: false, appDids: ["did:web:nope"] }))).toMatchObject({ field: "appScope" });
    expect(await failure(scope(CAROL, { all: false, appDids: [] }))).toMatchObject({ field: "address" });
  });

  it("lets a member hide their membership from public views", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { membersPublic: true });
    await join(t, id, BOB, "MEMBER");
    expect((await t.query<OrgMemberOutput[]>("organizationMembers", { orgId: id })).map((m) => m.address)).toEqual([lower(ALICE), lower(BOB)]);
    expect((await t.mutate<OrgMemberOutput>("setMyOrgMembershipHidden", { orgId: id, hidden: true }, BOB)).hidden).toBe(true);
    expect((await t.query<OrgMemberOutput[]>("organizationMembers", { orgId: id })).map((m) => m.address)).toEqual([lower(ALICE)]);
    expect((await members(t, id, ALICE)).map((m) => m.address)).toEqual([lower(ALICE), lower(BOB)]);
    expect(await t.query("organizationsByMember", { address: BOB.address })).toEqual([]);
    expect((await t.query<{ org: OrganizationOutput; hidden: boolean }[]>("organizationsByMember", { address: BOB.address }, BOB)).map((a) => [a.org.handle, a.hidden])).toEqual([["acme", true]]);
    expect(await t.query("orgMembership", { orgId: id, address: BOB.address })).toMatchObject({ role: "MEMBER", status: "ACTIVE" });
  });
});

describe("memberCount visibility", () => {
  const count = async (t: TestResolvers, id: string, who?: Parameters<typeof t.query>[2]) =>
    (await t.query<OrganizationOutput>("organization", { id }, who)).memberCount;

  it("counts only publicly visible members for outsiders and everyone for members", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { membersPublic: true });
    await join(t, id, BOB, "MEMBER");
    await join(t, id, CAROL, "MEMBER");
    await t.mutate("setMyOrgMembershipHidden", { orgId: id, hidden: true }, CAROL);
    expect(await count(t, id)).toBe(2);
    expect(await count(t, id, DAVE)).toBe(2);
    expect(await count(t, id, BOB)).toBe(3);
    expect(await count(t, id, CAROL)).toBe(3);
  });

  it("reports 0 to outsiders of a private org and the full count to members", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { membersPublic: false, listed: true });
    await join(t, id, BOB, "MEMBER");
    expect(await count(t, id)).toBe(0);
    expect(await count(t, id, DAVE)).toBe(0);
    expect(await count(t, id, BOB)).toBe(2);
    const search = await t.query<{ items: OrganizationOutput[] }>("organizationSearch", { query: "acme" });
    expect(search.items.map((o) => o.memberCount)).toEqual([0]);
  });
});

describe("visibility", () => {
  it("shows private member lists to members only and inactive records to admins only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "MEMBER");
    await t.mutate("inviteOrgMember", { orgId: id, invitee: CAROL.address, role: "MEMBER" }, ALICE);
    expect(await t.query("organizationMembers", { orgId: id })).toEqual([]);
    expect(await t.query("organizationMembers", { orgId: id }, DAVE)).toEqual([]);
    expect((await members(t, id, BOB, true)).map((m) => m.status)).toEqual(["ACTIVE", "ACTIVE"]);
    expect((await members(t, id, ALICE, true)).map((m) => m.status)).toEqual(["ACTIVE", "ACTIVE", "INVITED"]);
    expect(await t.query("organizationsByMember", { address: BOB.address })).toEqual([]);
    expect(await t.query("orgMembership", { orgId: id, address: CAROL.address })).toBeNull();
    expect(await t.query("orgMembership", { orgId: "nope", address: BOB.address })).toBeNull();
    expect((await failure(t.query("orgInvites", { orgId: id }, BOB))).code).toBe("FORBIDDEN");
  });

  it("drops archived organizations from memberships", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { membersPublic: true });
    expect((await t.query<unknown[]>("organizationsByMember", { address: ALICE.address })).length).toBe(1);
    await t.store.updateOrganization(id, { archived: true }, T0);
    expect(await t.query("organizationsByMember", { address: ALICE.address }, ALICE)).toEqual([]);
    expect(await t.query("orgMembership", { orgId: id, address: ALICE.address })).toBeNull();
  });
});

describe("stored scope is never role-derived", () => {
  it("stores an explicit scope for invited admins and promotions; owners and admins get all on read", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const carol = await join(t, id, CAROL, "ADMIN");
    expect(await t.store.member(carol)).toMatchObject({ role: "ADMIN", appScopeAll: false, appDids: [] });
    expect((await t.query<OrgMembershipOutput>("orgMembership", { orgId: id, address: CAROL.address })).effectiveScope.all).toBe(true);
    const bob = await join(t, id, BOB, "PUBLISHER");
    await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: false, appDids: [APP] } }, ALICE);
    expect((await t.mutate<OrgMemberOutput>("setOrgMemberRole", { orgId: id, address: BOB.address, role: "ADMIN" }, ALICE)).appScope.all).toBe(true);
    expect(await t.store.member(bob)).toMatchObject({ role: "ADMIN", appScopeAll: false, appDids: [APP] });
    const demoted = await t.mutate<OrgMemberOutput>("setOrgMemberRole", { orgId: id, address: BOB.address, role: "PUBLISHER" }, ALICE);
    expect(demoted.appScope).toEqual({ all: false, appDids: [APP] });
    const doc = t.reactor.state<RenownOrganizationState>(id).members.find((m) => m.id === bob);
    expect(doc?.appScope).toEqual({ all: false, appDids: [APP] });
  });
});

describe("store first, then the document", () => {
  function failNextWrite(t: TestResolvers) {
    t.reactor.execute.mockImplementationOnce(() => Promise.reject(new Error("reactor down")));
  }

  it("undoes an invite (and the re-invite's revocation) when the document write fails", async () => {
    const t = harnessResolvers(h);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { id } = await createOrg(t, ALICE, "acme");
    const old = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    t.tick(15 * DAY);
    failNextWrite(t);
    expect((await failure(t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect((await t.store.members(id)).map((m) => [m.id, m.status])).toEqual([[expect.any(String), "ACTIVE"], [old.id, "INVITED"]]);
    expect((await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE)).status).toBe("INVITED");
    quiet.mockRestore();
  });

  it("undoes an acceptance, a link join, a leave, a role change, a scope change and hiding", async () => {
    const t = harnessResolvers(h);
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { id } = await createOrg(t, ALICE, "acme");
    const invite = await t.mutate<OrgInviteOutput>("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "PUBLISHER" }, ALICE);
    failNextWrite(t);
    expect((await failure(t.mutate("respondToOrgInvite", { orgId: id, inviteId: invite.id, accept: true }, BOB))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.member(invite.id)).toMatchObject({ status: "INVITED", joinedAt: null });
    await t.mutate("respondToOrgInvite", { orgId: id, inviteId: invite.id, accept: true }, BOB);

    const { link, token } = await t.mutate<{ link: OrgInviteLinkOutput; token: string }>(
      "createOrgInviteLink",
      { orgId: id, role: "MEMBER", maxUses: 1, expiresAt: new Date(t.clock.now.getTime() + DAY).toISOString() },
      ALICE,
    );
    failNextWrite(t);
    expect((await failure(t.mutate("acceptOrgInviteLink", { token }, CAROL))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.openMember(id, lower(CAROL))).toBeUndefined();
    expect((await t.store.inviteLink(link.id))?.uses).toBe(0);
    await t.mutate("acceptOrgInviteLink", { token }, CAROL);

    await t.store.insertTeam({ id: "t1", orgId: id, slug: "core", name: "Core", appDids: [], memberIds: [invite.id], createdAt: T0 });
    failNextWrite(t);
    expect((await failure(t.mutate("leaveOrganization", { orgId: id }, BOB))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.member(invite.id)).toMatchObject({ status: "ACTIVE", endedAt: null });
    expect((await t.store.team("t1"))?.memberIds).toEqual([invite.id]);

    failNextWrite(t);
    await failure(t.mutate("setOrgMemberRole", { orgId: id, address: BOB.address, role: "MEMBER" }, ALICE));
    failNextWrite(t);
    await failure(t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: true, appDids: [APP] } }, ALICE));
    failNextWrite(t);
    await failure(t.mutate("setMyOrgMembershipHidden", { orgId: id, hidden: true }, BOB));
    expect(await t.store.member(invite.id)).toMatchObject({ role: "PUBLISHER", appScopeAll: false, appDids: [], hidden: false });
    const audited = (await t.store.auditPage(id, 50)).map((a) => a.action);
    expect(audited.filter((a) => a === "leaveOrganization" || a === "setOrgMemberRole" || a === "setMyOrgMembershipHidden")).toEqual([]);
    quiet.mockRestore();
  });
});

describe("spec rules", () => {
  it("never removes or re-roles an owner outside proposals", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await promoteToOwner(t, id, await join(t, id, BOB, "ADMIN"));
    expect((await failure(t.mutate("removeOrgMember", { orgId: id, address: BOB.address }, ALICE))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("setOrgMemberRole", { orgId: id, address: BOB.address, role: "ADMIN" }, ALICE))).code).toBe("FORBIDDEN");
    expect(await t.mutate("leaveOrganization", { orgId: id }, BOB)).toBe(true);
    expect((await failure(t.mutate("leaveOrganization", { orgId: id }, ALICE))).code).toBe("LAST_OWNER");
  });

  it("never logs an invite-link token", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const { token } = await t.mutate<{ token: string }>(
      "createOrgInviteLink",
      { orgId: id, role: "MEMBER", maxUses: 1, expiresAt: new Date(t.clock.now.getTime() + DAY).toISOString() },
      ALICE,
    );
    t.reactor.execute.mockImplementationOnce(() => Promise.reject(new Error("reactor down")));
    await failure(t.mutate("acceptOrgInviteLink", { token }, CAROL));
    await t.mutate("acceptOrgInviteLink", { token }, CAROL);
    await failure(t.mutate("acceptOrgInviteLink", { token }, DAVE));
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain(token);
    expect(JSON.stringify(await t.store.auditPage(id, 50))).not.toContain(token);
    for (const spy of spies) spy.mockRestore();
  });
});
