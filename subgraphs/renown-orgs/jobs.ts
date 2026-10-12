import { expireProposal, rearmProposal, runProposal } from "./areas/proposals.js";
import type { SweepJob } from "./core/sweeper.js";
import type { OrgRuntime } from "./runtime.js";

const MINUTE_MS = 60_000;
/** How often expired used-signature hashes are deleted. */
export const PRUNE_INTERVAL_MS = 5 * MINUTE_MS;
const BATCH = 100;

/**
 * Runs proposals that matured, expires the ones that never matured, and
 * re-arms the ones whose threshold is met again but lost their countdown.
 * Everything goes through the same per-org lock and execute path as
 * executeOrgProposal.
 */
export function proposalsJob(rt: OrgRuntime): SweepJob {
  return {
    name: "proposals",
    everyMs: MINUTE_MS,
    async run(now) {
      for (const due of await rt.store().dueProposals(now, BATCH)) {
        await rt.lock(`org:${due.orgId}`, async () => {
          const proposal = await rt.store().proposal(due.id);
          if (!proposal || proposal.status !== "PENDING") return;
          const executableAt = proposal.executableAt;
          if (executableAt && executableAt.getTime() <= now.getTime() && executableAt.getTime() < proposal.expiresAt.getTime()) {
            try {
              await runProposal(rt, proposal, "system");
            } catch (error) {
              console.error(`[renown-orgs] proposal ${proposal.id} could not run: ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (proposal.expiresAt.getTime() <= now.getTime()) {
            await expireProposal(rt, proposal, now);
          }
        });
      }
      for (const stuck of await rt.store().rearmableProposals(now, BATCH)) {
        await rt.lock(`org:${stuck.orgId}`, async () => {
          const proposal = await rt.store().proposal(stuck.id);
          if (proposal) await rearmProposal(rt, proposal, now);
        });
      }
    },
  };
}

/** Deletes expired replay-guard hashes. */
export function signaturesJob(rt: OrgRuntime): SweepJob {
  return { name: "signatures", everyMs: PRUNE_INTERVAL_MS, run: async (now) => void (await rt.store().pruneUsedSignatures(now)) };
}

/** Every sweep job of renown-orgs; later tasks append theirs. */
export function sweepJobs(rt: OrgRuntime): SweepJob[] {
  return [proposalsJob(rt), signaturesJob(rt)];
}
