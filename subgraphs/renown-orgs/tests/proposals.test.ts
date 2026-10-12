import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import type { RecordedActivity } from "../core/activity.js";
import type { OrganizationOutput } from "../output.js";
import type { ProposalOutput } from "../areas/proposals.js";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  addOwner,
  createOrg,
  failure,
  harnessResolvers,
  join,
  lower,
  openHarness,
  resetHarness,
  T0,
  type Harness,
  type TestResolvers,
} from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
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

const propose = (t: TestResolvers, orgId: string, kind: string, payload: Record<string, unknown>, who = ALICE) =>
  t.mutate<ProposalOutput>("proposeOrgChange", { orgId, kind, payload }, who);
const act = (t: TestResolvers, field: string, orgId: string, proposalId: string, who = ALICE) =>
  t.mutate<ProposalOutput>(field, { orgId, proposalId }, who);

describe("proposals", () => {
  it("single-owner org: threshold 1, still timelocked; execution makes the member an owner", async () => {
    const events: RecordedActivity[] = [];
    const t = harnessResolvers(h, { sinks: [(a) => Promise.resolve(void events.push(a))] });
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const p = await propose(t, id, "ADD_OWNER", { address: BOB.address });
    expect(p).toMatchObject({
      kind: "ADD_OWNER",
      payload: { address: lower(BOB), demoteToAdmin: null, appDid: null, handle: null },
      approvals: [lower(ALICE)],
      threshold: 1,
      status: "PENDING",
      executableAt: new Date(T0.getTime() + HOUR).toISOString(),
      expiresAt: new Date(T0.getTime() + 14 * DAY).toISOString(),
    });
    expect((await failure(act(t, "executeOrgProposal", id, p.id))).code).toBe("PROPOSAL_NOT_EXECUTABLE");
    t.tick(HOUR);
    expect(await act(t, "executeOrgProposal", id, p.id)).toMatchObject({ status: "EXECUTED", executedAt: t.clock.now.toISOString() });
    expect((await t.store.openMember(id, lower(BOB)))?.role).toBe("OWNER");
    expect(t.reactor.state<RenownOrganizationState>(id).members.find((m) => m.address === lower(BOB))?.role).toBe("OWNER");
    expect((await t.query<OrganizationOutput | null>("organization", { id }))?.securityWarnings).toEqual([]);
    expect(events.filter((e) => e.event?.type.startsWith("proposal.")).map((e) => [e.event?.type, e.event?.data.status])).toEqual([
      ["proposal.created", "PENDING"],
      ["proposal.executed", "EXECUTED"],
    ]);
    expect(events.find((e) => e.action === "proposal.ADD_OWNER")?.event?.type).toBe("member.role_changed");
  });

  it("two owners: the second approval sets executableAt to max(createdAt + delay, approval time)", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    await join(t, id, CAROL, "MEMBER");
    const p = await propose(t, id, "ADD_OWNER", { address: CAROL.address });
    expect([p.threshold, p.executableAt]).toEqual([2, null]);
    t.tick(2 * HOUR);
    const approved = await act(t, "approveOrgProposal", id, p.id, BOB);
    expect(approved.executableAt).toBe(t.clock.now.toISOString());
    expect(approved.approvals).toEqual([lower(ALICE), lower(BOB)]);
    expect((await act(t, "approveOrgProposal", id, p.id, BOB)).approvals).toHaveLength(2);
    expect((await act(t, "executeOrgProposal", id, p.id, BOB)).status).toBe("EXECUTED");
  });

  it("only owners propose and approve; RECOVER is not proposable; the proposer withdraws and any owner cancels", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    expect((await failure(propose(t, id, "ADD_OWNER", { address: BOB.address }, BOB))).code).toBe("FORBIDDEN");
    expect(await failure(propose(t, id, "RECOVER", { address: BOB.address }))).toMatchObject({ field: "kind" });
    expect(await failure(propose(t, id, "ADD_OWNER", { address: CAROL.address }))).toMatchObject({ field: "payload" });
    const p = await propose(t, id, "ADD_OWNER", { address: BOB.address });
    expect(await failure(propose(t, id, "ADD_OWNER", { address: BOB.address }))).toMatchObject({ field: "payload" });
    expect((await failure(act(t, "approveOrgProposal", id, p.id, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(act(t, "cancelOrgProposal", id, p.id, BOB))).code).toBe("FORBIDDEN");
    expect(await act(t, "cancelOrgProposal", id, p.id)).toMatchObject({ status: "CANCELLED", reason: `Cancelled by ${lower(ALICE)}` });
    expect((await failure(act(t, "executeOrgProposal", id, p.id))).code).toBe("PROPOSAL_NOT_EXECUTABLE");
    expect((await t.query<ProposalOutput[]>("orgProposals", { orgId: id, status: "CANCELLED" }, BOB)).map((x) => x.id)).toEqual([p.id]);
    expect((await failure(t.query("orgProposals", { orgId: id }, CAROL))).code).toBe("FORBIDDEN");
  });

  it("REMOVE_OWNER refuses the last owner, then demotes or removes", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    expect((await failure(propose(t, id, "REMOVE_OWNER", { address: ALICE.address }))).code).toBe("LAST_OWNER");
    await addOwner(t, id, BOB);
    await addOwner(t, id, CAROL);
    const demote = await propose(t, id, "REMOVE_OWNER", { address: BOB.address, demoteToAdmin: true });
    await act(t, "approveOrgProposal", id, demote.id, CAROL);
    t.tick(HOUR);
    await act(t, "executeOrgProposal", id, demote.id);
    expect((await t.store.openMember(id, lower(BOB)))?.role).toBe("ADMIN");
    const remove = await propose(t, id, "REMOVE_OWNER", { address: CAROL.address });
    await act(t, "approveOrgProposal", id, remove.id, CAROL);
    t.tick(HOUR);
    await act(t, "executeOrgProposal", id, remove.id, CAROL);
    expect(await t.store.openMember(id, lower(CAROL))).toBeUndefined();
  });

  it("CHANGE_HANDLE switches the handle and reserves the old one for this org only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await createOrg(t, DAVE, "taken");
    expect((await failure(propose(t, id, "CHANGE_HANDLE", { handle: "taken" }))).code).toBe("HANDLE_TAKEN");
    expect(await failure(propose(t, id, "CHANGE_HANDLE", { handle: "acme" }))).toMatchObject({ field: "payload" });
    const p = await propose(t, id, "CHANGE_HANDLE", { handle: " Acme-Labs " });
    t.tick(HOUR);
    await act(t, "executeOrgProposal", id, p.id);
    expect((await t.query<OrganizationOutput | null>("organization", { id }))?.handle).toBe("acme-labs");
    expect(t.reactor.state<RenownOrganizationState>(id).handle).toBe("acme-labs");
    expect((await failure(createOrg(t, DAVE, "acme"))).code).toBe("HANDLE_RESERVED");
    const back = await propose(t, id, "CHANGE_HANDLE", { handle: "acme" });
    t.tick(HOUR);
    expect((await act(t, "executeOrgProposal", id, back.id)).status).toBe("EXECUTED");
  });

  it("DELETE_ORG needs zero apps and archives everything", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { listed: true });
    await join(t, id, BOB, "MEMBER");
    await t.mutate("inviteOrgMember", { orgId: id, invitee: CAROL.address, role: "MEMBER" }, ALICE);
    await t.store.db.insertInto("org_apps").values({ app_did: APP, org_id: id, frozen: false, added_at: T0 }).execute();
    expect((await failure(propose(t, id, "DELETE_ORG", {}))).code).toBe("ORG_HAS_APPS");
    await t.store.db.deleteFrom("org_apps").execute();
    const other = await propose(t, id, "CHANGE_HANDLE", { handle: "acme-two" });
    const del = await propose(t, id, "DELETE_ORG", {});
    t.tick(HOUR);
    expect((await act(t, "executeOrgProposal", id, del.id)).status).toBe("EXECUTED");
    expect(await t.store.organization(id)).toMatchObject({ archived: true, listed: false });
    expect((await t.store.members(id)).map((m) => m.status)).toEqual(["REMOVED", "REMOVED", "REVOKED"]);
    expect((await t.store.proposal(other.id))?.status).toBe("CANCELLED");
    expect((await t.store.reservedHandle("acme", t.clock.now))?.reason).toBe("ARCHIVED");
    expect(t.reactor.state<RenownOrganizationState>(id).archived).toBe(true);
  });

  it("re-validates at execution and fails with a reason instead of an error", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const p = await propose(t, id, "ADD_OWNER", { address: BOB.address });
    await t.mutate("leaveOrganization", { orgId: id }, BOB);
    t.tick(HOUR);
    expect(await act(t, "executeOrgProposal", id, p.id)).toMatchObject({ status: "FAILED", reason: "The member is no longer active", executedAt: null });
  });

  it("claims a proposal once under concurrent execution", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const p = await propose(t, id, "ADD_OWNER", { address: BOB.address });
    t.tick(HOUR);
    const results = await Promise.allSettled([act(t, "executeOrgProposal", id, p.id), act(t, "executeOrgProposal", id, p.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await t.store.auditPage(id, 20)).filter((e) => e.action === "proposal.ADD_OWNER")).toHaveLength(1);
  });

  it("refuses to approve or execute after expiry, and caps pending proposals at 20", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    await join(t, id, CAROL, "MEMBER");
    const p = await propose(t, id, "ADD_OWNER", { address: CAROL.address });
    t.tick(14 * DAY);
    expect((await failure(act(t, "approveOrgProposal", id, p.id, BOB))).code).toBe("PROPOSAL_NOT_EXECUTABLE");
    for (let i = 0; i < 20; i++) {
      await t.store.insertProposal({
        id: `x${i}`, orgId: id, kind: "CHANGE_HANDLE", payload: { handle: `h-${i}` }, proposer: lower(ALICE), approvals: [lower(ALICE)],
        status: "PENDING", threshold: 2, createdAt: t.clock.now, executableAt: null, expiresAt: new Date(t.clock.now.getTime() + DAY), executedAt: null, reason: null,
      });
    }
    expect((await failure(propose(t, id, "CHANGE_HANDLE", { handle: "fresh" }))).code).toBe("LIMIT_REACHED");
  });
  it("never persists role-derived scope: a promoted owner keeps an explicit stored scope", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    expect(await t.store.openMember(id, lower(BOB))).toMatchObject({ role: "OWNER", appScopeAll: false });
  });

  it("a document that cannot be written reverts the store, answers SERVICE_UNAVAILABLE and leaves the proposal PENDING", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const add = await propose(t, id, "ADD_OWNER", { address: BOB.address });
    const rename = await propose(t, id, "CHANGE_HANDLE", { handle: "acme-two" });
    const del = await propose(t, id, "DELETE_ORG", {});
    t.tick(HOUR);
    for (const p of [add, rename, del]) {
      t.reactor.execute.mockRejectedValueOnce(new Error("reactor down"));
      expect((await failure(act(t, "executeOrgProposal", id, p.id))).code).toBe("SERVICE_UNAVAILABLE");
      expect(await t.store.proposal(p.id)).toMatchObject({ status: "PENDING", executedAt: null });
    }
    expect((await t.store.openMember(id, lower(BOB)))?.role).toBe("ADMIN");
    expect(await t.store.organization(id)).toMatchObject({ handle: "acme", archived: false });
    expect((await t.store.members(id, ["ACTIVE"])).map((m) => m.address)).toEqual([lower(ALICE), lower(BOB)]);
    expect(await t.store.reservedHandle("acme", t.clock.now)).toBeUndefined();
    expect((await act(t, "executeOrgProposal", id, add.id)).status).toBe("EXECUTED");
  });

  it("notifies the owners of every proposal state change, naming them when the change removes them", async () => {
    const events: RecordedActivity[] = [];
    const t = harnessResolvers(h, { sinks: [(a) => Promise.resolve(void events.push(a))] });
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    const other = await propose(t, id, "CHANGE_HANDLE", { handle: "acme-two" });
    await act(t, "cancelOrgProposal", id, other.id, BOB);
    const del = await propose(t, id, "DELETE_ORG", {});
    await act(t, "approveOrgProposal", id, del.id, BOB);
    t.tick(HOUR);
    await act(t, "executeOrgProposal", id, del.id);
    const notices = events.flatMap((e) => (e.notify ?? []).filter((n) => n.kind.startsWith("PROPOSAL_")).map((n) => [n.kind, n.to]));
    expect(notices).toContainEqual(["PROPOSAL_CANCELLED", "OWNERS"]);
    expect(notices.at(-1)).toEqual(["PROPOSAL_EXECUTED", [lower(ALICE), lower(BOB)]]);
  });
});
