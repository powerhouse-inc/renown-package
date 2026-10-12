import type { Action } from "document-model";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownAppProfileDocument } from "../../../document-models/renown-app-profile/index.js";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import { pkhDidFor } from "../../renown-stats/core/dids.js";
import { harnessResolvers as statsResolvers, relayed } from "../../renown-stats/tests/harness.js";
import type { ProposalOutput } from "../areas/proposals.js";
import type { RecordedActivity } from "../core/activity.js";
import { moveApp, OWNER_CHANGED } from "../core/app-ownership.js";
import { createOrgPolicy } from "../core/org-policy.js";
import { createSweeper } from "../core/sweeper.js";
import { sweepJobs } from "../jobs.js";
import type { OrgsResolverDeps } from "../runtime.js";
import { KyselyOrgStore } from "../store/kysely.js";
import { ORGS_NAMESPACE } from "../store/types.js";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  T0,
  createOrg,
  failure,
  harnessResolvers,
  insertAppProfile,
  insertCredential,
  insertWorkload,
  join,
  lower,
  openHarness,
  resetHarness,
  STATS_NS,
  WORKLOAD_NS,
  type Harness,
  type TestResolvers,
} from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const DAY = 86_400_000;
interface Transfer {
  id: string;
  appDid: string;
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  status: string;
  decidedBy: string | null;
  proposalId: string | null;
}
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

async function statsRow() {
  return h.root.withSchema(STATS_NS).selectFrom("app_profile_documents").selectAll().where("app_did", "=", APP).executeTakeFirstOrThrow();
}
async function workloadRow() {
  return h.root.withSchema(WORKLOAD_NS).selectFrom("workload_identities").selectAll().where("did", "=", APP).executeTakeFirstOrThrow();
}

/**
 * Resolvers whose writes fail on demand: a namespace name (its updateTable),
 * "org_apps" (the org-app transaction), or a document id (its reactor writes).
 */
function faultyResolvers(events?: RecordedActivity[]) {
  const failing = new Set<string>();
  const handle = (namespace: string) =>
    new Proxy(h.root.withSchema(namespace), {
      get(target, prop) {
        if (prop === "updateTable" && failing.has(namespace)) {
          return () => {
            throw new Error(`injected ${namespace} failure`);
          };
        }
        const value: unknown = Reflect.get(target, prop, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
  const relationalDb = {
    queryNamespace: (namespace: string) => h.root.withSchema(namespace),
    createNamespace: (namespace: string) => Promise.resolve(handle(namespace)),
  } as unknown as OrgsResolverDeps["relationalDb"];
  const real = new KyselyOrgStore(h.root.withSchema(ORGS_NAMESPACE));
  const store = new Proxy(real, {
    get(target, prop) {
      if (prop === "transaction" && failing.has("org_apps")) return () => Promise.reject(new Error("injected org_apps failure"));
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
  const t = harnessResolvers(h, {
    relationalDb,
    store: () => store,
    ...(events ? { sinks: [(a: RecordedActivity) => Promise.resolve(void events.push(a))] } : {}),
  });
  const execute = t.reactor.execute.getMockImplementation();
  if (!execute) throw new Error("the fake reactor has no execute");
  t.reactor.execute.mockImplementation((id: string, branch: string, actions: Action[]) =>
    failing.has(id) ? Promise.reject(new Error(`injected document ${id} failure`)) : execute(id, branch, actions),
  );
  return { t, failing };
}

/** ALICE publishes APP personally; BOB owns acme. */
async function world(events?: RecordedActivity[]) {
  const { t, failing } = faultyResolvers(events);
  const docId = await insertAppProfile(h, t, APP, lower(ALICE));
  await insertWorkload(h, { did: APP, owner: ALICE.address });
  const acme = await createOrg(t, BOB, "acme");
  return { t, failing, docId, acme };
}

const propose = (t: TestResolvers, who = ALICE, toOrgId: string) => t.mutate<Transfer>("proposeAppTransfer", { appDid: APP, toOrgId }, who);

function profileDid(t: TestResolvers, docId: string): string {
  return (t.reactor.docs.get(docId) as RenownAppProfileDocument).state.global.publisherDid ?? "";
}

/** Every record of APP names ALICE personally. */
async function expectAliceOwns(t: TestResolvers, docId: string, orgId: string) {
  expect(await statsRow()).toMatchObject({ publisher_org_id: null, publisher_address: lower(ALICE) });
  expect(await workloadRow()).toMatchObject({ owner_org_id: null, owner_address: ALICE.address });
  expect(await t.store.orgOfApp(APP)).toBeUndefined();
  expect(t.reactor.state<RenownOrganizationState>(orgId).apps).toEqual([]);
  expect(profileDid(t, docId)).toBe(pkhDidFor(ALICE.address));
}

/** Every record of APP names the organisation. */
async function expectOrgOwns(t: TestResolvers, docId: string, orgId: string) {
  expect(await statsRow()).toMatchObject({ publisher_org_id: orgId, publisher_address: lower(ALICE) });
  expect(await workloadRow()).toMatchObject({ owner_org_id: orgId, owner_address: ALICE.address });
  expect(await t.store.orgOfApp(APP)).toMatchObject({ orgId, frozen: false });
  expect(t.reactor.state<RenownOrganizationState>(orgId).apps.map((a) => a.appDid)).toEqual([APP]);
  expect(profileDid(t, docId)).toBe(`did:web:renown.test:org:${orgId}`);
}

/** A promise and its resolver. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve = () => {};
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** Waits for `promise` to settle, or 300 ms when the other side is (correctly) blocked behind a lock. */
async function settledOrTimeout(promise: Promise<unknown>): Promise<void> {
  await Promise.race([promise.then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, 300))]);
}

describe("ownership changes racing organisation deletion", () => {
  it("an acceptance arriving while DELETE_ORG executes fails, and the app keeps its original owner", async () => {
    const { t, docId, acme } = await world();
    const pending = await propose(t, ALICE, acme.id);
    const del = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "DELETE_ORG", payload: {} }, BOB);
    t.tick(3600 * 1000);
    // DELETE_ORG has counted zero apps and is about to archive when the acceptance arrives.
    const counted = deferred();
    let accept: Promise<unknown> = Promise.resolve();
    // Once: the inner this.teams() call reaches the real method.
    const spy = vi.spyOn(KyselyOrgStore.prototype, "teams").mockImplementationOnce(async function (this: KyselyOrgStore, orgId: string) {
      counted.resolve();
      await new Promise((r) => setTimeout(r, 0)); // lets the test start the acceptance
      await settledOrTimeout(accept);
      return this.teams(orgId);
    });
    let executed: ProposalOutput;
    try {
      const execution = t.mutate<ProposalOutput>("executeOrgProposal", { orgId: acme.id, proposalId: del.id }, BOB);
      await counted.promise;
      accept = t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB).then(
        () => null,
        (e: unknown) => e,
      );
      executed = await execution;
    } finally {
      spy.mockRestore();
    }
    expect(executed.status).toBe("EXECUTED");
    expect(await accept).toBeInstanceOf(Error);
    expect(await t.store.organization(acme.id)).toMatchObject({ archived: true });
    await expectAliceOwns(t, docId, acme.id);
  });
});

describe("person to organisation", () => {
  it("moves the app when an admin of the target accepts", async () => {
    const events: RecordedActivity[] = [];
    const { t, docId, acme } = await world(events);
    const pending = await propose(t, ALICE, acme.id);
    expect(pending).toMatchObject({ fromKind: "PERSON", fromId: lower(ALICE), toKind: "ORG", toId: acme.id, status: "PENDING" });
    expect((await t.query<Transfer[]>("appTransfers", { orgId: acme.id }, BOB)).map((x) => x.id)).toEqual([pending.id]);
    expect(events.find((e) => e.action === "proposeAppTransfer")?.notify).toEqual([
      { to: "ADMINS", kind: "APP_TRANSFER_REQUEST", payload: { transferId: pending.id, appDid: APP, from: lower(ALICE) } },
    ]);
    expect(await t.mutate<Transfer>("acceptAppTransfer", { transferId: pending.id }, BOB)).toMatchObject({ status: "ACCEPTED", decidedBy: lower(BOB) });
    await expectOrgOwns(t, docId, acme.id);
    expect(events.find((e) => e.event?.type === "app.transferred_in")?.event?.data).toEqual({ appDid: APP, transferId: pending.id, from: lower(ALICE), to: acme.id });
  });

  it("is proposed by the publisher only, once at a time, accepted by target admins only, and declined or withdrawn", async () => {
    const { t, acme } = await world();
    await join(t, acme.id, CAROL, "PUBLISHER", BOB);
    expect((await failure(propose(t, DAVE, acme.id))).code).toBe("FORBIDDEN");
    expect((await failure(propose(t, ALICE, "nope"))).code).toBe("NOT_FOUND");
    const first = await propose(t, ALICE, acme.id);
    expect(await failure(propose(t, ALICE, acme.id))).toMatchObject({ field: "appDid" });
    expect((await failure(t.mutate("acceptAppTransfer", { transferId: first.id }, CAROL))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("acceptAppTransfer", { transferId: first.id }, ALICE))).code).toBe("FORBIDDEN");
    expect((await t.mutate<Transfer>("declineAppTransfer", { transferId: first.id }, BOB)).status).toBe("DECLINED");
    const second = await propose(t, ALICE, acme.id);
    expect((await failure(t.mutate("declineAppTransfer", { transferId: second.id }, DAVE))).code).toBe("FORBIDDEN");
    expect((await t.mutate<Transfer>("declineAppTransfer", { transferId: second.id }, ALICE)).status).toBe("CANCELLED");
    expect((await failure(t.mutate("declineAppTransfer", { transferId: second.id }, ALICE))).field).toBe("transferId");
    expect((await t.query<Transfer[]>("appTransfers", { address: ALICE.address }, ALICE)).map((x) => x.status)).toEqual(["CANCELLED", "DECLINED"]);
    expect((await t.query<Transfer[]>("appTransfers", { appDid: APP }, BOB)).map((x) => x.id)).toEqual([second.id, first.id]);
    expect(await t.query<Transfer[]>("appTransfers", { appDid: APP }, DAVE)).toEqual([]);
    expect((await failure(t.query("appTransfers", { address: ALICE.address }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.query("appTransfers", { orgId: acme.id }, CAROL))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("acceptAppTransfer", { transferId: "nope" }, BOB))).code).toBe("NOT_FOUND");
  });

  it("refuses an acceptance after the source lost the app, and keeps it pending", async () => {
    const { t, acme } = await world();
    const pending = await propose(t, ALICE, acme.id);
    await h.root.withSchema(STATS_NS).updateTable("app_profile_documents").set({ publisher_address: lower(DAVE) }).execute();
    expect(await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB))).toMatchObject({ code: "BAD_USER_INPUT", field: "transferId" });
    expect((await statsRow()).publisher_org_id).toBeNull();
    expect(await t.store.orgOfApp(APP)).toBeUndefined();
    expect((await t.store.transfer(pending.id))?.status).toBe("PENDING");
  });

  it("refuses an acceptance when the workload identity belongs to someone else", async () => {
    const { t, docId, acme } = await world();
    const pending = await propose(t, ALICE, acme.id);
    await h.root.withSchema(WORKLOAD_NS).updateTable("workload_identities").set({ owner_address: DAVE.address }).execute();
    expect(await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB))).toMatchObject({ code: "BAD_USER_INPUT", field: "transferId" });
    expect(await statsRow()).toMatchObject({ publisher_org_id: null, publisher_address: lower(ALICE) });
    expect(await t.store.orgOfApp(APP)).toBeUndefined();
    expect(profileDid(t, docId)).toBe(pkhDidFor(ALICE.address));
    expect((await t.store.transfer(pending.id))?.status).toBe("PENDING");
  });

  it("expires after 14 days", async () => {
    const { t, acme } = await world();
    const pending = await propose(t, ALICE, acme.id);
    t.tick(14 * DAY - 1);
    expect(await t.store.dueTransfers(t.clock.now, 10)).toEqual([]);
    t.tick(1);
    await createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now }).tick();
    expect((await t.store.transfer(pending.id))?.status).toBe("EXPIRED");
    expect(await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB))).toMatchObject({ field: "transferId" });
    // A new offer can be made once the old one expired.
    expect((await propose(t, ALICE, acme.id)).status).toBe("PENDING");
  });

  it("expires each transfer on its own: one that cannot be written does not stop the others", async () => {
    const { t, acme } = await world();
    const first = await propose(t, ALICE, acme.id);
    const other = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
    await t.store.insertTransfer({
      id: "t-other",
      appDid: other,
      fromKind: "PERSON",
      fromId: lower(DAVE),
      toKind: "ORG",
      toId: acme.id,
      status: "PENDING",
      createdAt: T0,
      expiresAt: new Date(T0.getTime() + 1),
      decidedAt: null,
      decidedBy: null,
      proposalId: null,
      reason: null,
    });
    t.tick(14 * DAY);
    const store = t.rt.store();
    const real = store.updateTransfer.bind(store);
    const spy = vi.spyOn(store, "updateTransfer").mockImplementation((id, patch, expected) =>
      id === "t-other" ? Promise.reject(new Error("injected")) : real(id, patch, expected),
    );
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now }).tick();
    spy.mockRestore();
    expect(errors.mock.calls.flat().join(" ")).toMatch(/t-other/);
    errors.mockRestore();
    expect((await t.store.transfer(first.id))?.status).toBe("EXPIRED");
    expect((await t.store.transfer("t-other"))?.status).toBe("PENDING");
  });

  it("authorises the caller before telling whether a transfer is still open", async () => {
    const { t, acme } = await world();
    const first = await propose(t, ALICE, acme.id);
    await t.mutate("declineAppTransfer", { transferId: first.id }, BOB);
    expect((await failure(t.mutate("acceptAppTransfer", { transferId: first.id }, DAVE))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("declineAppTransfer", { transferId: first.id }, DAVE))).code).toBe("FORBIDDEN");
    expect(await failure(t.mutate("acceptAppTransfer", { transferId: first.id }, BOB))).toMatchObject({ code: "BAD_USER_INPUT", field: "transferId" });
  });

  it.each(["acceptAppTransfer", "declineAppTransfer"] as const)("marks a transfer past its expiry EXPIRED on %s, before the sweeper does", async (field) => {
    const { t, acme } = await world();
    const pending = await propose(t, ALICE, acme.id);
    t.tick(14 * DAY);
    expect((await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, DAVE))).code).toBe("FORBIDDEN");
    expect((await t.store.transfer(pending.id))?.status).toBe("PENDING");
    expect(await failure(t.mutate(field, { transferId: pending.id }, field === "acceptAppTransfer" ? BOB : ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "transferId" });
    expect(await t.store.transfer(pending.id)).toMatchObject({ status: "EXPIRED", decidedBy: null });
    expect(await t.store.orgOfApp(APP)).toBeUndefined();
  });

  it("cancels, with a reason, pending transfers whose source lost the app when it moves by another route", async () => {
    const { t, docId, acme } = await world();
    const globex = await createOrg(t, CAROL, "globex");
    const stale = await propose(t, ALICE, acme.id);
    await moveApp(t.rt, APP, { kind: "PERSON", address: lower(ALICE) }, { kind: "ORG", orgId: globex.id }, t.clock.now);
    expect(await t.store.transfer(stale.id)).toMatchObject({ status: "CANCELLED", decidedBy: "system", reason: OWNER_CHANGED });
    expect((await t.store.orgOfApp(APP))?.orgId).toBe(globex.id);
    expect(profileDid(t, docId)).toBe(`did:web:renown.test:org:${globex.id}`);
    expect(await failure(t.mutate("acceptAppTransfer", { transferId: stale.id }, BOB))).toMatchObject({ field: "transferId" });
  });

  it("lets the new owner offer the app when an earlier offer went stale, cancelling the stale one", async () => {
    const { t, acme } = await world();
    const stale = await propose(t, ALICE, acme.id);
    await h.root.withSchema(STATS_NS).updateTable("app_profile_documents").set({ publisher_address: lower(DAVE) }).execute();
    const fresh = await propose(t, DAVE, acme.id);
    expect(fresh).toMatchObject({ status: "PENDING", fromId: lower(DAVE) });
    expect(await t.store.transfer(stale.id)).toMatchObject({ status: "CANCELLED", reason: OWNER_CHANGED });
  });

  it("lists an app moved to an organisation under the organisation only, never under its former personal publisher", async () => {
    const { t, acme } = await world();
    const stats = statsResolvers(h, { orgPolicy: () => createOrgPolicy(h.relationalDb, "renown.test") });
    expect((await stats.index.appProfilesByPublisher(lower(ALICE))).map((e) => e.appDid)).toEqual([APP]);
    const pending = await propose(t, ALICE, acme.id);
    await t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB);
    expect(await stats.index.appProfilesByPublisher(lower(ALICE))).toEqual([]);
    const byPublisher = (publisherDid: string) =>
      (stats.resolvers as unknown as { Query: Record<string, (p: unknown, a: unknown, c: unknown) => Promise<unknown[]>> }).Query.appProfilesByPublisher(null, { publisherDid }, {});
    expect(await byPublisher(pkhDidFor(ALICE.address))).toEqual([]);
    expect((await stats.index.appProfilesByOrg(acme.id)).map((e) => e.appDid)).toEqual([APP]);
  });

  // Each step of the move fails in turn: every earlier step is undone, the
  // app stays ALICE's, the transfer stays PENDING, and a retry completes it.
  it.each(["stats", "org_apps", "workload", "profile document", "organisation document"] as const)(
    "leaves the app with its owner and the transfer pending when the %s write fails",
    async (step) => {
      const { t, failing, docId, acme } = await world();
      const pending = await propose(t, ALICE, acme.id);
      failing.add({ stats: STATS_NS, org_apps: "org_apps", workload: WORKLOAD_NS, "profile document": docId, "organisation document": acme.id }[step]);
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      expect((await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB))).code).toBe("SERVICE_UNAVAILABLE");
      errors.mockRestore();
      await expectAliceOwns(t, docId, acme.id);
      expect(await t.store.transfer(pending.id)).toMatchObject({ status: "PENDING", decidedAt: null, decidedBy: null });
      failing.clear();
      expect((await t.mutate<Transfer>("acceptAppTransfer", { transferId: pending.id }, BOB)).status).toBe("ACCEPTED");
      await expectOrgOwns(t, docId, acme.id);
    },
  );
});

describe("organisation to person, freezing", () => {
  async function orgApp(events?: RecordedActivity[]) {
    const w = await world(events);
    const pending = await propose(w.t, ALICE, w.acme.id);
    await w.t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB);
    return w;
  }

  async function transferOut(t: TestResolvers, orgId: string) {
    const p = await t.mutate<ProposalOutput>(
      "proposeOrgChange",
      { orgId, kind: "TRANSFER_APP_OUT", payload: { appDid: APP, toKind: "PERSON", toId: DAVE.address } },
      BOB,
    );
    t.tick(3600 * 1000);
    expect((await t.mutate<ProposalOutput>("executeOrgProposal", { orgId, proposalId: p.id }, BOB)).status).toBe("EXECUTED");
    const [pending] = await t.query<Transfer[]>("appTransfers", { address: DAVE.address }, DAVE);
    return { p, pending };
  }

  it("transfers out through a proposal, then the person accepts", async () => {
    const events: RecordedActivity[] = [];
    const { t, docId, acme } = await orgApp(events);
    const { p, pending } = await transferOut(t, acme.id);
    expect(pending).toMatchObject({ fromKind: "ORG", fromId: acme.id, toKind: "PERSON", toId: lower(DAVE), proposalId: p.id, status: "PENDING" });
    expect(events.find((e) => e.action === "proposal.TRANSFER_APP_OUT")?.notify).toEqual([
      { to: [lower(DAVE)], kind: "APP_TRANSFER_REQUEST", payload: { transferId: pending.id, appDid: APP, from: acme.id } },
    ]);
    expect((await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB))).code).toBe("FORBIDDEN");
    await t.mutate("acceptAppTransfer", { transferId: pending.id }, DAVE);
    expect(await statsRow()).toMatchObject({ publisher_org_id: null, publisher_address: lower(DAVE) });
    expect(await workloadRow()).toMatchObject({ owner_org_id: null, owner_address: DAVE.address });
    expect(await t.store.orgOfApp(APP)).toBeUndefined();
    expect(t.reactor.state<RenownOrganizationState>(acme.id).apps).toEqual([]);
    expect(profileDid(t, docId)).toBe(pkhDidFor(DAVE.address));
    expect(events.find((e) => e.event?.type === "app.transferred_out")?.event?.data).toEqual({ appDid: APP, transferId: pending.id, from: acme.id, to: lower(DAVE) });
  });

  it("leaves the old organisation's publishers no way back to the app (no re-attach, no profile write)", async () => {
    const { t, acme } = await orgApp();
    const { pending } = await transferOut(t, acme.id);
    await t.mutate("acceptAppTransfer", { transferId: pending.id }, DAVE);
    const stats = statsResolvers(h, { orgPolicy: () => createOrgPolicy(h.relationalDb, "renown.test") });
    // BOB owns acme (scope ALL): the profile no longer names acme, the workload is DAVE's.
    expect((await failure(stats.upsert({ appDid: APP, tagline: "ours" }, relayed(BOB.address)))).code).toBe("FORBIDDEN");
    expect(await failure(stats.upsert({ appDid: APP, tagline: "ours", publisherOrgId: acme.id }, relayed(BOB.address)))).toMatchObject({
      code: "BAD_USER_INPUT",
      field: "publisherOrgId",
    });
    expect(await t.store.orgOfApp(APP)).toBeUndefined();
    expect((await statsRow()).publisher_org_id).toBeNull();
  });

  it("takes an owner of the source to withdraw what a TRANSFER_APP_OUT proposal offered", async () => {
    const { t, acme } = await orgApp();
    await join(t, acme.id, CAROL, "ADMIN", BOB);
    const { pending } = await transferOut(t, acme.id);
    expect((await failure(t.mutate("declineAppTransfer", { transferId: pending.id }, CAROL))).code).toBe("FORBIDDEN");
    expect((await t.query<Transfer[]>("appTransfers", { orgId: acme.id }, CAROL)).map((x) => x.id)).toContain(pending.id);
    expect(await t.mutate<Transfer>("declineAppTransfer", { transferId: pending.id }, BOB)).toMatchObject({ status: "CANCELLED", decidedBy: lower(BOB) });
  });

  it("stops counting the old organisation's delegations once the app left it (renown-stats actsFor)", async () => {
    const { t, acme } = await orgApp();
    await insertCredential(h, { credentialId: "c-bob", issuer: lower(BOB), appDid: APP });
    const stats = statsResolvers(h, { orgPolicy: () => createOrgPolicy(h.relationalDb, "renown.test") });
    const report = () =>
      (stats.resolvers as unknown as { Mutation: Record<string, (p: unknown, a: unknown, c: unknown) => Promise<boolean>> }).Mutation.reportUserStat(
        null,
        { appDid: APP, userDid: "did:pkh:eip155:1:0x1111111111111111111111111111111111111111", metric: "notes", value: 1 },
        { user: { address: BOB.address, appKey: APP } },
      );
    expect(await report()).toBe(true);
    const { pending } = await transferOut(t, acme.id);
    await t.mutate("acceptAppTransfer", { transferId: pending.id }, DAVE);
    expect(await createOrgPolicy(h.relationalDb, "renown.test").credentialStatus({ credentialId: "c-bob", appDid: APP, issuer: lower(BOB), issuedAt: T0 })).toMatchObject({ orgId: null });
    expect((await failure(report())).code).toBe("FORBIDDEN");
  });

  it("leaves the app with the organisation and the transfer pending when the organisation document cannot be written", async () => {
    const { t, failing, docId, acme } = await orgApp();
    const { pending } = await transferOut(t, acme.id);
    failing.add(acme.id);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, DAVE))).code).toBe("SERVICE_UNAVAILABLE");
    errors.mockRestore();
    await expectOrgOwns(t, docId, acme.id);
    expect((await t.store.transfer(pending.id))?.status).toBe("PENDING");
    failing.clear();
    expect((await t.mutate<Transfer>("acceptAppTransfer", { transferId: pending.id }, DAVE)).status).toBe("ACCEPTED");
    expect(await t.store.orgOfApp(APP)).toBeUndefined();
  });

  it("transfers to another organisation, accepted by its admin", async () => {
    const { t, docId, acme } = await orgApp();
    const globex = await createOrg(t, CAROL, "globex");
    const p = await t.mutate<ProposalOutput>(
      "proposeOrgChange",
      { orgId: acme.id, kind: "TRANSFER_APP_OUT", payload: { appDid: APP, toKind: "ORG", toId: globex.id } },
      BOB,
    );
    expect(await failure(t.mutate("proposeOrgChange", { orgId: acme.id, kind: "TRANSFER_APP_OUT", payload: { appDid: APP, toKind: "ORG", toId: acme.id } }, BOB))).toMatchObject({ field: "payload" });
    t.tick(3600 * 1000);
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: p.id }, BOB);
    const [pending] = await t.query<Transfer[]>("appTransfers", { orgId: globex.id }, CAROL);
    await t.mutate("acceptAppTransfer", { transferId: pending.id }, CAROL);
    expect(await statsRow()).toMatchObject({ publisher_org_id: globex.id, publisher_address: lower(ALICE) });
    expect((await workloadRow()).owner_org_id).toBe(globex.id);
    expect((await t.store.orgOfApp(APP))?.orgId).toBe(globex.id);
    expect(t.reactor.state<RenownOrganizationState>(acme.id).apps).toEqual([]);
    expect(t.reactor.state<RenownOrganizationState>(globex.id).apps.map((a) => a.appDid)).toEqual([APP]);
    expect(profileDid(t, docId)).toBe(`did:web:renown.test:org:${globex.id}`);
  });

  it("freezes without delay once approved, refuses transfers of a frozen app, and unfreezes", async () => {
    const { t, acme } = await orgApp();
    const freeze = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "FREEZE_APP", payload: { appDid: APP } }, BOB);
    expect(freeze.executableAt).toBe(t.clock.now.toISOString());
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: freeze.id }, BOB);
    expect((await t.store.orgOfApp(APP))?.frozen).toBe(true);
    expect(t.reactor.state<RenownOrganizationState>(acme.id).apps[0].frozen).toBe(true);
    expect((await failure(t.mutate("proposeOrgChange", { orgId: acme.id, kind: "TRANSFER_APP_OUT", payload: { appDid: APP, toKind: "PERSON", toId: DAVE.address } }, BOB))).code).toBe("APP_FROZEN");
    expect(await failure(t.mutate("proposeOrgChange", { orgId: acme.id, kind: "FREEZE_APP", payload: { appDid: APP } }, BOB))).toMatchObject({ field: "payload" });
    expect(await failure(t.mutate("proposeOrgChange", { orgId: acme.id, kind: "FREEZE_APP", payload: { appDid: "did:key:z6Mknope" } }, BOB))).toMatchObject({ field: "payload" });
    const unfreeze = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "UNFREEZE_APP", payload: { appDid: APP } }, BOB);
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: unfreeze.id }, BOB);
    expect((await t.store.orgOfApp(APP))?.frozen).toBe(false);
    expect(t.reactor.state<RenownOrganizationState>(acme.id).apps[0].frozen).toBe(false);
  });

  it("a frozen app: delegations stop counting, profile writes and workload tokens are refused, until unfrozen", async () => {
    const { t, acme } = await orgApp();
    await insertCredential(h, { credentialId: "c-bob", issuer: lower(BOB), appDid: APP });
    const policy = createOrgPolicy(h.relationalDb, "renown.test");
    const stats = statsResolvers(h, { orgPolicy: () => policy });
    const status = () => policy.credentialStatus({ credentialId: "c-bob", appDid: APP, issuer: lower(BOB), issuedAt: T0 });
    expect(await status()).toMatchObject({ orgId: acme.id, counts: true });

    const freeze = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "FREEZE_APP", payload: { appDid: APP } }, BOB);
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: freeze.id }, BOB);
    expect(await status()).toEqual({ orgId: acme.id, counts: false, reason: "APP_FROZEN" });
    expect((await t.query<{ counts: boolean; reason: string }>("orgCredentialStatus", { credentialId: "c-bob" })).reason).toBe("APP_FROZEN");
    expect((await failure(stats.upsert({ appDid: APP, tagline: "x" }, relayed(BOB.address)))).code).toBe("APP_FROZEN");
    // renown-workload refuses tokens exactly when the policy reports the app frozen.
    expect(await policy.orgOfApp(APP)).toEqual({ orgId: acme.id, frozen: true });

    const unfreeze = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "UNFREEZE_APP", payload: { appDid: APP } }, BOB);
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: unfreeze.id }, BOB);
    expect(await status()).toMatchObject({ counts: true, reason: null });
    expect(await policy.orgOfApp(APP)).toEqual({ orgId: acme.id, frozen: false });
  });

  it("puts a freeze back to pending when the organisation document cannot be written", async () => {
    const { t, failing, acme } = await orgApp();
    const freeze = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "FREEZE_APP", payload: { appDid: APP } }, BOB);
    failing.add(acme.id);
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await failure(t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: freeze.id }, BOB))).code).toBe("SERVICE_UNAVAILABLE");
    errors.mockRestore();
    expect((await t.store.orgOfApp(APP))?.frozen).toBe(false);
    expect((await t.store.proposal(freeze.id))?.status).toBe("PENDING");
    failing.clear();
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: freeze.id }, BOB);
    expect((await t.store.orgOfApp(APP))?.frozen).toBe(true);
  });

  it("fails a transfer-out proposal whose app was frozen before it ran", async () => {
    const { t, acme } = await orgApp();
    const out = await t.mutate<ProposalOutput>(
      "proposeOrgChange",
      { orgId: acme.id, kind: "TRANSFER_APP_OUT", payload: { appDid: APP, toKind: "PERSON", toId: DAVE.address } },
      BOB,
    );
    const freeze = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "FREEZE_APP", payload: { appDid: APP } }, BOB);
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: freeze.id }, BOB);
    t.tick(3600 * 1000);
    const ran = await t.mutate<ProposalOutput>("executeOrgProposal", { orgId: acme.id, proposalId: out.id }, BOB);
    expect(ran.status).toBe("FAILED");
    expect(ran.reason).toMatch(/APP_FROZEN/);
    expect(await t.store.transfers({ appDid: APP, party: { kind: "PERSON", id: lower(DAVE) } })).toEqual([]);
  });

  it("refuses accepting a pending transfer of an app frozen meanwhile", async () => {
    const { t, acme } = await orgApp();
    const { pending } = await transferOut(t, acme.id);
    const freeze = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "FREEZE_APP", payload: { appDid: APP } }, BOB);
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: freeze.id }, BOB);
    expect((await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, DAVE))).code).toBe("APP_FROZEN");
    expect((await t.store.orgOfApp(APP))?.orgId).toBe(acme.id);
    expect((await t.store.transfer(pending.id))?.status).toBe("PENDING");
  });
  it("a profile edit racing an org-to-person acceptance cannot re-attach the app to the old organisation", async () => {
    const { t, acme } = await orgApp();
    const { pending } = await transferOut(t, acme.id);
    const stats = statsResolvers(h, { orgPolicy: () => createOrgPolicy(h.relationalDb, "renown.test") });
    // renown-stats reads the profile index (still naming acme), then yields until
    // the move has taken the app out of org_apps but not yet off the workload identity.
    const moved = deferred();
    let edit: Promise<unknown> = Promise.resolve();
    const readProfile = stats.index.appProfile.bind(stats.index);
    vi.spyOn(stats.index, "appProfile").mockImplementationOnce(async (appDid: string) => {
      const entry = await readProfile(appDid);
      await settledOrTimeout(moved.promise);
      return entry;
    });
    // Once: the inner this.transaction() call reaches the real method.
    const spy = vi.spyOn(KyselyOrgStore.prototype, "transaction").mockImplementationOnce(async function (this: KyselyOrgStore, fn) {
      const result = await this.transaction(fn);
      moved.resolve();
      await settledOrTimeout(edit);
      return result as never;
    });
    try {
      edit = stats.upsert({ appDid: APP, tagline: "ours" }, relayed(BOB.address)).catch((e: unknown) => e);
      await t.mutate("acceptAppTransfer", { transferId: pending.id }, DAVE);
      await edit;
    } finally {
      spy.mockRestore();
    }
    // DAVE owns the app everywhere; acme got nothing back.
    expect(await t.store.orgOfApp(APP)).toBeUndefined();
    expect(await statsRow()).toMatchObject({ publisher_org_id: null, publisher_address: lower(DAVE) });
    expect(await workloadRow()).toMatchObject({ owner_org_id: null, owner_address: DAVE.address });
  });
});

