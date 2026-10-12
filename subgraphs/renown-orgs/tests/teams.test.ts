import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import { effectiveScope, hasAppCapability } from "../core/authz.js";
import type { OrgMembershipOutput, OrganizationOutput, OrgTeamOutput } from "../output.js";
import { ALICE, BOB, CAROL, DAVE, createOrg, failure, harnessResolvers, join, lower, openHarness, resetHarness, T0, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP_A = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const APP_B = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
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

describe("teams", () => {
  it("creates, renames, staffs and deletes teams; members see them and their scopes grow", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    await join(t, id, CAROL, "MEMBER");
    const team = await t.mutate<OrgTeamOutput>("createOrgTeam", { orgId: id, slug: "core", name: "Core", appDids: [APP_A] }, ALICE);
    expect(team).toMatchObject({ orgId: id, slug: "core", name: "Core", appDids: [APP_A], memberAddresses: [] });
    const staffed = await t.mutate<OrgTeamOutput>("setOrgTeamMembers", { orgId: id, teamId: team.id, addresses: [BOB.address, CAROL.address] }, ALICE);
    expect(staffed.memberAddresses.sort()).toEqual([lower(BOB), lower(CAROL)].sort());
    expect(await t.query<OrgMembershipOutput>("orgMembership", { orgId: id, address: BOB.address })).toMatchObject({
      teams: ["core"],
      appScope: { all: false, appDids: [] },
      effectiveScope: { all: false, appDids: [APP_A] },
    });
    const renamed = await t.mutate<OrgTeamOutput>("updateOrgTeam", { orgId: id, teamId: team.id, name: "Core team", appDids: [APP_A, APP_B] }, ALICE);
    expect(renamed).toMatchObject({ slug: "core", name: "Core team", appDids: [APP_A, APP_B] });
    expect((await t.query<OrganizationOutput>("organization", { id }, CAROL)).teams.map((x) => x.slug)).toEqual(["core"]);
    expect((await t.query<OrganizationOutput>("organization", { id })).teams).toEqual([]);
    expect(t.reactor.state<RenownOrganizationState>(id).teams).toMatchObject([{ slug: "core", name: "Core team", appDids: [APP_A, APP_B] }]);
    expect(await t.mutate("deleteOrgTeam", { orgId: id, teamId: team.id }, ALICE)).toBe(true);
    expect(await t.store.teams(id)).toEqual([]);
    expect((await t.store.auditPage(id, 4)).map((e) => e.action)).toEqual(["deleteOrgTeam", "updateOrgTeam", "setOrgTeamMembers", "createOrgTeam"]);
  });

  it("validates slugs, names, app DIDs and members; caps teams at 50; admins only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "MEMBER");
    await t.mutate("inviteOrgMember", { orgId: id, invitee: DAVE.address, role: "MEMBER" }, ALICE);
    const create = (extra: Record<string, unknown>, who = ALICE) =>
      t.mutate<OrgTeamOutput>("createOrgTeam", { orgId: id, slug: "core", name: "Core", ...extra }, who);
    expect(await failure(create({ slug: "Core Team" }))).toMatchObject({ field: "slug" });
    expect(await failure(create({ name: " " }))).toMatchObject({ field: "name" });
    expect(await failure(create({ appDids: ["nope"] }))).toMatchObject({ field: "appDids" });
    expect((await failure(create({}, BOB))).code).toBe("FORBIDDEN");
    const core = await create({});
    expect(await failure(create({ name: "Again" }))).toMatchObject({ field: "slug" });
    const setMembers = (addresses: string[]) => t.mutate("setOrgTeamMembers", { orgId: id, teamId: core.id, addresses }, ALICE);
    expect(await failure(setMembers([DAVE.address]))).toMatchObject({ field: "addresses" });
    expect(await failure(setMembers(["0x1"]))).toMatchObject({ field: "addresses" });
    expect((await failure(t.mutate("updateOrgTeam", { orgId: id, teamId: "nope", name: "X" }, ALICE))).code).toBe("NOT_FOUND");
    for (let i = 1; i < 50; i++) {
      await t.store.insertTeam({ id: `t${i}`, orgId: id, slug: `team-${i}`, name: `Team ${i}`, appDids: [], memberIds: [], createdAt: T0 });
    }
    expect((await failure(create({ slug: "late" }))).code).toBe("LIMIT_REACHED");
  });
});

describe("team compensation", () => {
  it("undoes the store when the document write fails", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "MEMBER");
    const fail = () => t.reactor.execute.mockImplementationOnce(() => Promise.reject(new Error("reactor down")));
    fail();
    expect((await failure(t.mutate("createOrgTeam", { orgId: id, slug: "core", name: "Core" }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.teams(id)).toEqual([]);
    const team = await t.mutate<OrgTeamOutput>("createOrgTeam", { orgId: id, slug: "core", name: "Core" }, ALICE);
    fail();
    expect((await failure(t.mutate("setOrgTeamMembers", { orgId: id, teamId: team.id, addresses: [BOB.address] }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect((await t.store.team(team.id))?.memberIds).toEqual([]);
    fail();
    expect((await failure(t.mutate("updateOrgTeam", { orgId: id, teamId: team.id, name: "New" }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect((await t.store.team(team.id))?.name).toBe("Core");
    await t.mutate("setOrgTeamMembers", { orgId: id, teamId: team.id, addresses: [BOB.address] }, ALICE);
    fail();
    expect((await failure(t.mutate("deleteOrgTeam", { orgId: id, teamId: team.id }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.team(team.id)).toMatchObject({ slug: "core", memberIds: [expect.any(String)] });
  });
});

describe("publisher capability", () => {
  it("needs an org app, an ACTIVE publisher or above, and a scope or team that covers the app", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const other = await createOrg(t, DAVE, "other");
    await join(t, id, BOB, "PUBLISHER");
    await join(t, id, CAROL, "MEMBER");
    await t.store.db.insertInto("org_apps").values([
      { app_did: APP_A, org_id: id, frozen: false, added_at: T0 },
      { app_did: APP_B, org_id: other.id, frozen: false, added_at: T0 },
    ]).execute();
    const can = (who: { address: string }, appDid: string, orgId = id) => hasAppCapability(t.store, orgId, lower(who), appDid);
    expect(await can(ALICE, APP_A)).toBe(true);
    expect(await can(BOB, APP_A)).toBe(false);
    await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: false, appDids: [APP_A] } }, ALICE);
    expect(await can(BOB, APP_A)).toBe(true);
    expect(await can(BOB, APP_B)).toBe(false);
    expect(await can(BOB, APP_B, other.id)).toBe(false);
    await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: false, appDids: [] } }, ALICE);
    const team = await t.mutate<OrgTeamOutput>("createOrgTeam", { orgId: id, slug: "apps", name: "Apps", appDids: [APP_A] }, ALICE);
    await t.mutate("setOrgTeamMembers", { orgId: id, teamId: team.id, addresses: [BOB.address, CAROL.address] }, ALICE);
    expect(await can(BOB, APP_A)).toBe(true);
    expect(await can(CAROL, APP_A)).toBe(false);
    await t.mutate("removeOrgMember", { orgId: id, address: BOB.address }, ALICE);
    expect(await can(BOB, APP_A)).toBe(false);
    expect(await can(DAVE, APP_A)).toBe(false);
  });

  it("merges the member's own scope with every team's apps", () => {
    const member = {
      id: "m1", orgId: "o", address: "0x1", role: "PUBLISHER" as const, status: "ACTIVE" as const, appScopeAll: false,
      appDids: [APP_A], hidden: false, invitedBy: null, invitedAt: T0, joinedAt: T0, endedAt: null, updatedAt: T0,
    };
    const team = (id: string, appDids: string[], memberIds: string[]) => ({ id, orgId: "o", slug: id, name: id, appDids, memberIds, createdAt: T0 });
    expect(effectiveScope(member, [team("a", [APP_A, APP_B], ["m1"]), team("b", ["did:key:zX"], ["m2"])])).toEqual({ all: false, appDids: [APP_A, APP_B] });
    expect(effectiveScope({ ...member, role: "ADMIN" }, []).all).toBe(true);
  });
});
