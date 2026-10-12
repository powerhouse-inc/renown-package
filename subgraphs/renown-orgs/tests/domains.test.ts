import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import type { ProposalOutput } from "../areas/proposals.js";
import type { RecordedActivity } from "../core/activity.js";
import type { NetDeps } from "../core/net.js";
import { createSweeper } from "../core/sweeper.js";
import { sweepJobs } from "../jobs.js";
import type { OrganizationOutput } from "../output.js";
import { ALICE, BOB, CAROL, DAVE, addOwner, createOrg, failure, harnessResolvers, join, lower, openHarness, resetHarness, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
interface Domain {
  id: string;
  status: string;
  txtName: string;
  txtValue: string;
  wellKnownUrl: string;
  wellKnownJson: string;
  verifiedAt: string | null;
  failures: number;
}
let h: Harness;

/** DNS and HTTPS for tests: TXT records and renown.json bodies are set per test; every host resolves to `ip`. */
function world() {
  const txt = new Map<string, string[]>();
  const bodies = new Map<string, string>();
  const state = { ip: "93.184.216.34", requests: 0 };
  const net: NetDeps = {
    lookup: () => Promise.resolve([{ address: state.ip, family: 4 }]),
    resolveTxt: (name) => (txt.has(name) ? Promise.resolve((txt.get(name) ?? []).map((v) => [v])) : Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }))),
    request: (request) => {
      state.requests += 1;
      const body = bodies.get(request.url.href);
      return Promise.resolve({ status: body === undefined ? 404 : 200, body: new TextEncoder().encode(body ?? ""), truncated: false });
    },
  };
  return { txt, bodies, state, net };
}

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

describe("domains", () => {
  it("adds a domain with both proof instructions and verifies it by DNS TXT", async () => {
    const w = world();
    const t = harnessResolvers(h, { net: w.net });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: " Acme.Example. " }, ALICE);
    expect(d).toMatchObject({ status: "PENDING", txtName: "_renown.acme.example", wellKnownUrl: "https://acme.example/.well-known/renown.json" });
    expect(d.txtValue).toMatch(new RegExp(`^renown-org=${id};token=[A-Za-z0-9_-]{22}$`));
    expect(JSON.parse(d.wellKnownJson)).toEqual({ organizations: [{ id, token: d.txtValue.split("token=")[1] }] });
    expect((await failure(t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE))).code).toBe("DOMAIN_PROOF_MISSING");
    w.txt.set("_renown.acme.example", ["v=spf1 -all", d.txtValue]);
    expect(await t.mutate<Domain>("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE)).toMatchObject({ status: "VERIFIED", verifiedAt: t.clock.now.toISOString(), failures: 0 });
    expect((await t.query<OrganizationOutput>("organization", { id })).verifiedDomains).toEqual(["acme.example"]);
    expect(t.reactor.state<RenownOrganizationState>(id).domains).toMatchObject([{ domain: "acme.example", status: "VERIFIED" }]);
  });

  it("verifies by renown.json, never fetching from a private address", async () => {
    const w = world();
    const t = harnessResolvers(h, { net: w.net });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE);
    w.bodies.set(d.wellKnownUrl, d.wellKnownJson);
    w.state.ip = "10.0.0.7";
    expect((await failure(t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE))).code).toBe("DOMAIN_PROOF_MISSING");
    expect(w.state.requests).toBe(0);
    w.state.ip = "93.184.216.34";
    expect((await t.mutate<Domain>("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE)).status).toBe("VERIFIED");
  });

  it("gives a domain to the first organization that verifies it", async () => {
    const w = world();
    const t = harnessResolvers(h, { net: w.net });
    const a = await createOrg(t, ALICE, "acme");
    const b = await createOrg(t, BOB, "copycat");
    const late = await t.mutate<Domain>("addOrgDomain", { orgId: b.id, domain: "acme.example" }, BOB);
    const first = await t.mutate<Domain>("addOrgDomain", { orgId: a.id, domain: "acme.example" }, ALICE);
    w.txt.set("_renown.acme.example", [first.txtValue, late.txtValue]);
    await t.mutate("checkOrgDomain", { orgId: a.id, domainId: first.id }, ALICE);
    expect((await failure(t.mutate("checkOrgDomain", { orgId: b.id, domainId: late.id }, BOB))).code).toBe("DOMAIN_TAKEN");
    expect((await failure(t.mutate("addOrgDomain", { orgId: b.id, domain: "acme.example" }, BOB))).code).toBe("DOMAIN_TAKEN");
  });

  it("lapses after three failed daily re-checks; a later check re-verifies and restarts the clock", async () => {
    const w = world();
    const events: RecordedActivity[] = [];
    const t = harnessResolvers(h, { net: w.net, sinks: [(a) => Promise.resolve(void events.push(a))] });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE);
    w.txt.set("_renown.acme.example", [d.txtValue]);
    await t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE);
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    w.txt.clear();
    for (let day = 1; day <= 3; day++) {
      t.tick(DAY);
      await sweeper.tick();
    }
    expect(await t.store.domain(d.id)).toMatchObject({ status: "LAPSED", failures: 3 });
    expect(t.reactor.state<RenownOrganizationState>(id).domains[0].status).toBe("LAPSED");
    expect(events.find((e) => e.event?.type === "domain.lapsed")?.notify).toEqual([{ to: "ADMINS", kind: "DOMAIN_LAPSED", payload: { domainId: d.id, domain: "acme.example" } }]);
    w.txt.set("_renown.acme.example", [d.txtValue]);
    expect(await t.mutate<Domain>("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE)).toMatchObject({ status: "VERIFIED", verifiedAt: t.clock.now.toISOString() });
  });

  it("validates domains, caps them at 10 per organization and is for admins only", async () => {
    const t = harnessResolvers(h, { net: world().net });
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    for (const domain of ["localhost", "10.0.0.1", "https://acme.example", "acme"]) {
      expect(await failure(t.mutate("addOrgDomain", { orgId: id, domain }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "domain" });
    }
    expect((await failure(t.mutate("addOrgDomain", { orgId: id, domain: "acme.example" }, BOB))).code).toBe("FORBIDDEN");
    for (let i = 0; i < 10; i++) await t.mutate("addOrgDomain", { orgId: id, domain: `d${i}.example` }, ALICE);
    expect(await failure(t.mutate("addOrgDomain", { orgId: id, domain: "d0.example" }, ALICE))).toMatchObject({ code: "LIMIT_REACHED" });
    const [first] = await t.query<Domain[]>("orgDomains", { orgId: id }, ALICE);
    expect(await t.mutate("removeOrgDomain", { orgId: id, domainId: first.id }, ALICE)).toBe(true);
    expect(await failure(t.mutate("addOrgDomain", { orgId: id, domain: "d1.example" }, ALICE))).toMatchObject({ field: "domain" });
  });
});

describe("recovery", () => {
  async function verifiedOrg(w: ReturnType<typeof world>) {
    const t = harnessResolvers(h, { net: w.net });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE);
    w.txt.set("_renown.acme.example", [d.txtValue]);
    await t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE);
    return { t, id, d };
  }

  it("needs a domain verified for 14 days and a recovery record naming the new owner", async () => {
    const w = world();
    const { t, id } = await verifiedOrg(w);
    const start = () => t.mutate<ProposalOutput>("startOrgRecovery", { orgId: id, domain: "acme.example", newOwner: CAROL.address }, DAVE);
    expect(await failure(start())).toMatchObject({ code: "BAD_USER_INPUT", field: "domain" });
    t.tick(14 * DAY);
    expect((await failure(start())).code).toBe("DOMAIN_PROOF_MISSING");
    w.txt.set("_renown.acme.example", [`renown-org-recover=${id};owner=${CAROL.address}`]);
    const p = await start();
    expect(p).toMatchObject({ kind: "RECOVER", threshold: 0, approvals: [], proposer: lower(DAVE), payload: { domain: "acme.example", address: lower(CAROL) } });
    expect(p.executableAt).toBe(new Date(t.clock.now.getTime() + 7200 * 1000).toISOString());
    expect(await failure(start())).toMatchObject({ field: "domain" });
  });

  it("lets an owner cancel it, and otherwise makes the new owner an active owner after the delay", async () => {
    const w = world();
    const { t, id } = await verifiedOrg(w);
    t.tick(14 * DAY);
    w.bodies.set("https://acme.example/.well-known/renown.json", JSON.stringify({ organizations: [{ id, recover: CAROL.address.toUpperCase().replace("0X", "0x") }] }));
    w.txt.clear();
    const cancelled = await t.mutate<ProposalOutput>("startOrgRecovery", { orgId: id, domain: "acme.example", newOwner: CAROL.address }, DAVE);
    expect((await t.mutate<ProposalOutput>("cancelOrgProposal", { orgId: id, proposalId: cancelled.id }, ALICE)).status).toBe("CANCELLED");
    const p = await t.mutate<ProposalOutput>("startOrgRecovery", { orgId: id, domain: "acme.example", newOwner: CAROL.address }, DAVE);
    t.tick(2 * HOUR);
    expect((await t.mutate<ProposalOutput>("executeOrgProposal", { orgId: id, proposalId: p.id }, DAVE)).status).toBe("EXECUTED");
    expect(await t.store.openMember(id, lower(CAROL))).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    expect(t.reactor.state<RenownOrganizationState>(id).members.find((m) => m.address === lower(CAROL))).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    await addOwner(t, id, BOB);
    expect((await t.store.members(id, ["ACTIVE"])).filter((m) => m.role === "OWNER")).toHaveLength(3);
  });
});

describe("domain hardening", () => {
  it("a failed manual check never postpones the daily re-check of a verified domain", async () => {
    const w = world();
    const t = harnessResolvers(h, { net: w.net });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE);
    w.txt.set("_renown.acme.example", [d.txtValue]);
    await t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE);
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    w.txt.clear();
    for (let day = 1; day <= 3; day++) {
      t.tick(DAY - HOUR);
      expect((await failure(t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE))).code).toBe("DOMAIN_PROOF_MISSING");
      t.tick(HOUR);
      await sweeper.tick();
    }
    expect(await t.store.domain(d.id)).toMatchObject({ status: "LAPSED", failures: 3 });
  });

  it("keeps the store unchanged when the document cannot be written", async () => {
    const w = world();
    const t = harnessResolvers(h, { net: w.net });
    const { id } = await createOrg(t, ALICE, "acme");
    t.reactor.execute.mockRejectedValueOnce(new Error("reactor down"));
    expect((await failure(t.mutate("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.domains(id)).toEqual([]);
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE);
    w.txt.set("_renown.acme.example", [d.txtValue]);
    t.reactor.execute.mockRejectedValueOnce(new Error("reactor down"));
    expect((await failure(t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.domain(d.id)).toMatchObject({ status: "PENDING", verifiedAt: null });
    expect(await t.store.verifiedDomainOwner("acme.example")).toBeUndefined();
    t.reactor.execute.mockRejectedValueOnce(new Error("reactor down"));
    expect((await failure(t.mutate("removeOrgDomain", { orgId: id, domainId: d.id }, ALICE))).code).toBe("SERVICE_UNAVAILABLE");
    expect(await t.store.domain(d.id)).toMatchObject({ id: d.id });
  });

  it("re-checks each domain on its own: one that cannot be lapsed does not stop the others", async () => {
    const w = world();
    const t = harnessResolvers(h, { net: w.net });
    const verified: { orgId: string; domainId: string }[] = [];
    for (const [who, handle] of [[ALICE, "acme"], [BOB, "bobco"]] as const) {
      const { id } = await createOrg(t, who, handle);
      const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: `${handle}.example` }, who);
      w.txt.set(`_renown.${handle}.example`, [d.txtValue]);
      await t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, who);
      await t.store.updateDomain(d.id, { failures: 2 });
      verified.push({ orgId: id, domainId: d.id });
    }
    w.txt.clear();
    t.tick(DAY);
    t.reactor.execute.mockRejectedValueOnce(new Error("reactor down"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now }).tick();
    errors.mockRestore();
    const [first, second] = await Promise.all(verified.map((v) => t.store.domain(v.domainId)));
    expect(first).toMatchObject({ status: "VERIFIED", failures: 2, lastCheckedAt: t.clock.now });
    expect(second).toMatchObject({ status: "LAPSED", failures: 3 });
    expect(t.reactor.state<RenownOrganizationState>(verified[0].orgId).domains[0].status).toBe("VERIFIED");
  });
});

describe("recovery hardening", () => {
  it("tells the owners when a recovery starts, and fails it when the domain is gone by then", async () => {
    const w = world();
    const events: RecordedActivity[] = [];
    const t = harnessResolvers(h, { net: w.net, sinks: [(a) => Promise.resolve(void events.push(a))] });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE);
    w.txt.set("_renown.acme.example", [d.txtValue, `renown-org-recover=${id};owner=${CAROL.address}`]);
    await t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE);
    t.tick(14 * DAY);
    const p = await t.mutate<ProposalOutput>("startOrgRecovery", { orgId: id, domain: "acme.example", newOwner: CAROL.address }, DAVE);
    const started = events.find((e) => e.action === "startOrgRecovery");
    expect(started?.notify?.map((n) => [n.to, n.kind])).toEqual([
      ["OWNERS", "PROPOSAL_CREATED"],
      ["OWNERS", "RECOVERY_STARTED"],
    ]);
    expect((await failure(t.mutate("cancelOrgProposal", { orgId: id, proposalId: p.id }, BOB))).code).toBe("FORBIDDEN");
    await t.mutate("removeOrgDomain", { orgId: id, domainId: d.id }, ALICE);
    t.tick(2 * HOUR);
    expect(await t.mutate<ProposalOutput>("executeOrgProposal", { orgId: id, proposalId: p.id }, DAVE)).toMatchObject({
      status: "FAILED",
      reason: "The recovery domain is no longer verified",
    });
    expect(await t.store.openMember(id, lower(CAROL))).toBeUndefined();
  });

  it("refuses RECOVER through proposeOrgChange", async () => {
    const t = harnessResolvers(h, { net: world().net });
    const { id } = await createOrg(t, ALICE, "acme");
    expect(await failure(t.mutate("proposeOrgChange", { orgId: id, kind: "RECOVER", payload: { address: CAROL.address } }, ALICE))).toMatchObject({
      code: "BAD_USER_INPUT",
      field: "kind",
    });
  });
});
