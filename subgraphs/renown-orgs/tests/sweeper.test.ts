import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalOutput } from "../areas/proposals.js";
import { createSweeper, type SweepJob } from "../core/sweeper.js";
import { sweepJobs } from "../jobs.js";
import { openMemoryOrgStore } from "../store/memory.js";
import { ALICE, BOB, CAROL, createOrg, harnessResolvers, join, lower, openHarness, resetHarness, T0, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
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

describe("sweeper", () => {
  it("runs each job once its interval has passed and retries a failed run on the next tick", async () => {
    const mem = await openMemoryOrgStore();
    const store = mem.store;
    const clock = { now: T0 };
    let failOnce = true;
    const job = (name: string, everyMs: number, run: () => Promise<void> = () => Promise.resolve()): SweepJob => ({ name, everyMs, run });
    const sweeper = createSweeper({
      jobs: [
        job("minute", MINUTE),
        job("daily", DAY),
        job("flaky", MINUTE, () => {
          if (!failOnce) return Promise.resolve();
          failOnce = false;
          return Promise.reject(new Error("boom"));
        }),
      ],
      store: () => store,
      now: () => clock.now,
      log: () => undefined,
    });
    expect(await sweeper.tick()).toEqual(["minute", "daily"]);
    clock.now = new Date(T0.getTime() + 30_000);
    expect(await sweeper.tick()).toEqual(["flaky"]);
    clock.now = new Date(T0.getTime() + MINUTE);
    expect(await sweeper.tick()).toEqual(["minute"]);
    clock.now = new Date(T0.getTime() + DAY);
    expect(await sweeper.tick()).toEqual(["minute", "daily", "flaky"]);
    await mem.close();
  });

  it("runs a job on one replica only, and never overlaps itself", async () => {
    const mem = await openMemoryOrgStore();
    const store = mem.store;
    const runs: string[] = [];
    const jobs = (replica: string): SweepJob[] => [{ name: "shared", everyMs: MINUTE, run: () => Promise.resolve(void runs.push(replica)) }];
    const [a, b] = [createSweeper({ jobs: jobs("a"), store: () => store, now: () => T0 }), createSweeper({ jobs: jobs("b"), store: () => store, now: () => T0 })];
    await Promise.all([a.tick(), b.tick()]);
    expect(runs).toHaveLength(1);
    let release: () => void = () => undefined;
    const slow: SweepJob = { name: "slow", everyMs: 1, run: () => new Promise<void>((resolve) => (release = resolve)) };
    const sweeper = createSweeper({ jobs: [slow], store: () => store, now: () => T0 });
    const first = sweeper.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await sweeper.tick()).toEqual([]);
    release();
    expect(await first).toEqual(["slow"]);
    await mem.close();
  });

  it("executes matured proposals as the system and expires the ones that never matured", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const matures = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: BOB.address } }, ALICE);
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    t.tick(30 * MINUTE);
    await sweeper.tick();
    expect((await t.store.proposal(matures.id))?.status).toBe("PENDING");
    t.tick(30 * MINUTE);
    await sweeper.tick();
    expect((await t.store.proposal(matures.id))?.status).toBe("EXECUTED");
    expect((await t.store.auditPage(id, 5)).map((e) => [e.action, e.actor])).toContainEqual(["system.executeOrgProposal", "system"]);
    await join(t, id, CAROL, "MEMBER");
    const stale = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: CAROL.address } }, ALICE);
    expect(stale.threshold).toBe(2);
    t.tick(14 * DAY);
    await sweeper.tick();
    expect(await t.store.proposal(stale.id)).toMatchObject({ status: "EXPIRED", reason: "Expired before it could run" });
    expect((await t.store.openMember(id, lower(CAROL)))?.role).toBe("MEMBER");
  });

  it("re-arms a proposal whose threshold is met again but lost its countdown, then runs it later", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    await join(t, id, CAROL, "ADMIN");
    const p = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: CAROL.address } }, ALICE);
    expect(p.executableAt).not.toBeNull();
    // A transient drop: the countdown is lost although the approvals still suffice.
    await t.store.updateProposal(p.id, { executableAt: null }, "PENDING");
    const created = (await t.store.proposal(p.id))!.createdAt;
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    t.tick(2 * 60 * MINUTE);
    await sweeper.tick();
    const rearmed = (await t.store.proposal(p.id))!;
    expect(rearmed.status).toBe("PENDING");
    expect(rearmed.executableAt).toEqual(new Date(Math.max(created.getTime() + 60 * MINUTE, t.clock.now.getTime())));
    t.tick(2 * MINUTE);
    await sweeper.tick();
    expect((await t.store.proposal(p.id))?.status).toBe("EXECUTED");
  });

  it("re-arms on execute without running it in the same call", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const p = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: BOB.address } }, ALICE);
    await t.store.updateProposal(p.id, { executableAt: null }, "PENDING");
    t.tick(2 * 60 * MINUTE);
    await expect(t.mutate("executeOrgProposal", { orgId: id, proposalId: p.id }, ALICE)).rejects.toThrow("not executable yet");
    const after = (await t.store.proposal(p.id))!;
    expect(after.status).toBe("PENDING");
    expect(after.executableAt).toEqual(t.clock.now);
    expect((await t.mutate<ProposalOutput>("executeOrgProposal", { orgId: id, proposalId: p.id }, ALICE)).status).toBe("EXECUTED");
  });

  it("keeps going when releasing a failed claim fails too", async () => {
    const mem = await openMemoryOrgStore();
    vi.spyOn(mem.store, "releaseJob").mockRejectedValue(new Error("release down"));
    const log = vi.fn();
    const ran: string[] = [];
    const sweeper = createSweeper({
      jobs: [
        { name: "bad", everyMs: MINUTE, run: () => Promise.reject(new Error("boom")) },
        { name: "good", everyMs: MINUTE, run: () => Promise.resolve(void ran.push("good")) },
      ],
      store: () => mem.store,
      now: () => T0,
      log,
    });
    expect(await sweeper.tick()).toEqual(["good"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("release down"));
    await mem.close();
  });

  const ghost = (i: number, extra: Record<string, unknown> = {}) => ({
    id: `ghost-${String(i).padStart(3, "0")}`,
    orgId: "ghost",
    kind: "ADD_OWNER" as const,
    payload: { address: BOB.address },
    proposer: ALICE.address,
    approvals: [ALICE.address, BOB.address],
    status: "PENDING" as const,
    threshold: 2,
    createdAt: new Date(T0.getTime() - MINUTE),
    executableAt: null,
    expiresAt: new Date(T0.getTime() + 14 * DAY),
    executedAt: null,
    reason: null,
    ...extra,
  });

  it("does not let 101 un-rearmable proposals starve a newer rearmable one", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const p = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: BOB.address } }, ALICE);
    await t.store.updateProposal(p.id, { executableAt: null }, "PENDING");
    for (let i = 0; i < 101; i++) await t.store.insertProposal(ghost(i));
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    t.tick(2 * 60 * MINUTE);
    await sweeper.tick();
    t.tick(MINUTE);
    await sweeper.tick();
    expect((await t.store.proposal(p.id))?.executableAt).not.toBeNull();
  });

  it("does not let proposals that keep failing block a later due one, and survives expireProposal throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const p = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: BOB.address } }, ALICE);
    for (let i = 0; i < 101; i++) await t.store.insertProposal(ghost(i, { expiresAt: new Date(T0.getTime() + MINUTE) }));
    const update = t.store.updateProposal.bind(t.store);
    vi.spyOn(t.store, "updateProposal").mockImplementation((pid, patch, expected) =>
      pid.startsWith("ghost") ? Promise.reject(new Error("poison")) : update(pid, patch, expected),
    );
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    t.tick(2 * 60 * MINUTE);
    await sweeper.tick();
    t.tick(MINUTE);
    await sweeper.tick();
    expect((await t.store.proposal(p.id))?.status).toBe("EXECUTED");
  });
});
