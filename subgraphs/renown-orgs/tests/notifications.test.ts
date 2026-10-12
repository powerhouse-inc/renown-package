import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createSweeper } from "../core/sweeper.js";
import { delegationsJob, sweepJobs } from "../jobs.js";
import { resolversFor } from "../resolvers.js";
import { createRuntime } from "../runtime.js";
import { ALICE, BOB, CAROL, DAVE, addOwner, createOrg, failure, harnessResolvers, insertCredential, join, lower, openHarness, resetHarness, T0, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
interface Note {
  id: string;
  kind: string;
  orgId: string;
  org: { handle: string } | null;
  payload: string;
  readAt: string | null;
}
type Page = { items: Note[]; next: string | null };
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

const inbox = (t: TestResolvers, who: typeof ALICE, args: Record<string, unknown> = {}) => t.query<Page>("myNotifications", args, who);
const payloadOf = (n: Note) => JSON.parse(n.payload) as Record<string, unknown>;

describe("notifications", () => {
  it("notifies the invitee, then the admins (never the actor), once per recipient", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, CAROL, "ADMIN");
    const invite = await t.mutate<{ id: string }>("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE);
    expect((await inbox(t, BOB)).items.map((n) => [n.kind, n.org?.handle, payloadOf(n)])).toEqual([
      ["INVITED", "acme", { inviteId: invite.id, role: "MEMBER", orgId: id }],
    ]);
    await t.mutate("respondToOrgInvite", { orgId: id, inviteId: invite.id, accept: true }, BOB);
    // Newest first: BOB accepted after CAROL.
    expect((await inbox(t, ALICE)).items.filter((n) => n.kind === "INVITE_ACCEPTED").map((n) => payloadOf(n).address)).toEqual([
      lower(BOB),
      lower(CAROL),
    ]);
    expect((await inbox(t, CAROL)).items.filter((n) => n.kind === "INVITE_ACCEPTED")).toHaveLength(1);
    expect((await inbox(t, BOB)).items.filter((n) => n.kind === "INVITE_ACCEPTED")).toEqual([]);
    expect(await t.query("myUnreadNotificationCount", {}, ALICE)).toBe(2);
  });

  it("fans proposals out to the owners except the proposer", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    await join(t, id, CAROL, "MEMBER");
    await t.mutate("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: CAROL.address } }, ALICE);
    expect((await inbox(t, BOB)).items.slice(0, 2).map((n) => n.kind).sort()).toEqual(["PROPOSAL_CREATED", "PROPOSAL_NEEDS_APPROVAL"]);
    expect(
      (await inbox(t, ALICE)).items.filter((n) => n.kind.startsWith("PROPOSAL_") && payloadOf(n).kind === "ADD_OWNER" && n.kind !== "PROPOSAL_EXECUTED"),
    ).toEqual([]);
  });

  it("asks the owners still to approve again after an approval that leaves the threshold unmet, and says nothing once it is met", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    await addOwner(t, id, CAROL);
    const proposal = await t.mutate<{ id: string }>("proposeOrgChange", { orgId: id, kind: "CHANGE_HANDLE", payload: { handle: "acme-two" } }, ALICE);
    // ALICE stops being an owner (as a REMOVE_OWNER would make her): her approval no longer counts.
    const alice = await t.store.openMember(id, lower(ALICE));
    await t.store.updateMember(alice?.id ?? "", { role: "ADMIN", updatedAt: T0 });
    const needsApproval = async (who: typeof ALICE) =>
      (await inbox(t, who)).items.filter((n) => n.kind === "PROPOSAL_NEEDS_APPROVAL" && payloadOf(n).proposalId === proposal.id);
    await t.mutate("approveOrgProposal", { orgId: id, proposalId: proposal.id }, BOB);
    expect(await needsApproval(CAROL)).toHaveLength(2);
    expect(await needsApproval(BOB)).toHaveLength(1);
    const before = (await inbox(t, BOB)).items.length;
    await t.mutate("approveOrgProposal", { orgId: id, proposalId: proposal.id }, CAROL);
    expect((await inbox(t, BOB)).items).toHaveLength(before);
  });

  it("marks read by ids (own only) or all, pages, and validates arguments", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    for (const who of [BOB, CAROL]) await t.mutate("inviteOrgMember", { orgId: id, invitee: who.address, role: "MEMBER" }, ALICE);
    const [bobNote] = (await inbox(t, BOB)).items;
    const [carolNote] = (await inbox(t, CAROL)).items;
    expect(await t.mutate("markNotificationsRead", { ids: [carolNote.id] }, BOB)).toBe(0);
    expect(await t.mutate("markNotificationsRead", { ids: [bobNote.id] }, BOB)).toBe(1);
    expect((await inbox(t, BOB, { unreadOnly: true })).items).toEqual([]);
    expect(await t.mutate("markNotificationsRead", { all: true }, CAROL)).toBe(1);
    expect(await failure(t.mutate("markNotificationsRead", {}, CAROL))).toMatchObject({ field: "ids" });
    expect(await failure(t.mutate("markNotificationsRead", { ids: ["x"], all: true }, CAROL))).toMatchObject({ field: "ids" });
    expect(await failure(inbox(t, BOB, { limit: 0 }))).toMatchObject({ field: "limit" });
    expect(await failure(inbox(t, BOB, { after: "nonsense" }))).toMatchObject({ field: "after" });
    expect((await failure(t.query("myNotifications", {}))).code).toBe("FORBIDDEN");
    // Two INVITE_ACCEPTED for ALICE, one page at a time.
    for (const who of [BOB, CAROL]) {
      const [invite] = await t.query<{ id: string }[]>("myOrgInvites", {}, who);
      await t.mutate("respondToOrgInvite", { orgId: id, inviteId: invite.id, accept: true }, who);
    }
    const first = await inbox(t, ALICE, { limit: 1 });
    expect(first.next).not.toBeNull();
    const second = await inbox(t, ALICE, { limit: 1, after: first.next });
    expect([...first.items, ...second.items].map((n) => payloadOf(n).address)).toEqual([lower(CAROL), lower(BOB)]);
    expect(second.next).toBeNull();
  });

  it("never fails the mutation when a notification cannot be stored", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(t.store, "insertNotifications").mockRejectedValueOnce(new Error("disk full"));
    await expect(t.mutate("inviteOrgMember", { orgId: id, invitee: BOB.address, role: "MEMBER" }, ALICE)).resolves.toMatchObject({ orgId: id });
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("disk full"));
    expect((await inbox(t, BOB)).items).toEqual([]);
    vi.restoreAllMocks();
  });

  it("prunes notifications older than 90 days and tells admins about new delegations for org apps", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    await t.store.insertOrgApp({ appDid: APP, orgId: id, frozen: false, addedAt: T0 });
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    await sweeper.tick();
    await insertCredential(h, { credentialId: "c1", issuer: lower(BOB), appDid: APP, createdAt: new Date(T0.getTime() + MINUTE) });
    await insertCredential(h, { credentialId: "c2", issuer: lower(BOB), appDid: "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169", createdAt: new Date(T0.getTime() + MINUTE) });
    t.tick(5 * MINUTE);
    await sweeper.tick();
    expect((await inbox(t, ALICE)).items.filter((n) => n.kind === "DELEGATION_ADDED").map(payloadOf)).toEqual([
      { credentialId: "c1", appDid: APP, issuer: lower(BOB), orgId: id },
    ]);
    t.tick(91 * DAY);
    await sweeper.tick();
    expect((await inbox(t, BOB)).items).toEqual([]);
  });
  it("alerts each delegation once, only from active members, page by page over a lagged window, and repeats a failed run", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    await t.store.insertOrgApp({ appDid: APP, orgId: id, frozen: false, addedAt: T0 });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sweeper = createSweeper({ jobs: [delegationsJob(t.rt, { pageSize: 2 })], store: () => t.store, now: () => t.clock.now });
    await sweeper.tick();
    const later = (ms: number) => new Date(T0.getTime() + ms);
    for (const credentialId of ["c1", "c2", "c3"]) await insertCredential(h, { credentialId, issuer: lower(BOB), appDid: APP, createdAt: later(MINUTE) });
    await insertCredential(h, { credentialId: "c4", issuer: lower(DAVE), appDid: APP, createdAt: later(MINUTE) });
    await insertCredential(h, { credentialId: "c5", issuer: lower(BOB), appDid: "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169", createdAt: later(MINUTE) });
    // Inside the lag at the next run: left for the run after.
    await insertCredential(h, { credentialId: "c6", issuer: lower(BOB), appDid: APP, createdAt: later(5 * MINUTE - 30_000) });
    const alerted = async () =>
      (await inbox(t, ALICE)).items.filter((n) => n.kind === "DELEGATION_ADDED").map((n) => String(payloadOf(n).credentialId)).sort();
    t.tick(5 * MINUTE);
    // A read failing midway records nothing; the claim is given back and the same window is read again.
    vi.spyOn(t.store, "openMember").mockRejectedValueOnce(new Error("store down"));
    expect(await sweeper.tick()).toEqual([]);
    expect(await alerted()).toEqual([]);
    expect(await sweeper.tick()).toEqual(["delegations"]);
    expect(await alerted()).toEqual(["c1", "c2", "c3"]);
    t.tick(5 * MINUTE);
    await sweeper.tick();
    expect(await alerted()).toEqual(["c1", "c2", "c3", "c6"]);
    // A window read again (a crash before the watermark moved) alerts nothing twice.
    await t.store.setJobWatermark("delegations", new Date(T0.getTime() - MINUTE));
    t.tick(5 * MINUTE);
    await sweeper.tick();
    expect(await alerted()).toEqual(["c1", "c2", "c3", "c6"]);
    expect(errors).toHaveBeenCalledWith(expect.stringContaining("store down"));
    vi.restoreAllMocks();
  });

  it("registers the notification sink once, from the sweep jobs or the resolvers, whichever comes first", () => {
    const t = harnessResolvers(h);
    const rt = createRuntime({ ...t.rt.deps, sinks: [] });
    sweepJobs(rt);
    sweepJobs(rt);
    resolversFor(rt);
    expect(rt.sinks).toHaveLength(1);
  });
});
