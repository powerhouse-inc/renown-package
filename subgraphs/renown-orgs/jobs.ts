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
      const store = rt.store();
      const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
      // A proposal that cannot progress is marked checked, so it goes to the back of the batch order.
      const skip = async (id: string) => {
        try {
          await store.markProposalChecked(id, now);
        } catch (error) {
          console.error(`[renown-orgs] could not mark proposal ${id} checked: ${describe(error)}`);
        }
      };
      for (const due of await store.dueProposals(now, BATCH)) {
        try {
          await rt.lock(`org:${due.orgId}`, async () => {
            const proposal = await rt.store().proposal(due.id);
            if (!proposal || proposal.status !== "PENDING") return;
            const executableAt = proposal.executableAt;
            if (executableAt && executableAt.getTime() <= now.getTime() && executableAt.getTime() < proposal.expiresAt.getTime()) {
              const ran = await runProposal(rt, proposal, "system").then(
                () => true,
                (error: unknown) => {
                  console.error(`[renown-orgs] proposal ${proposal.id} could not run: ${describe(error)}`);
                  return false;
                },
              );
              if (!ran) await skip(proposal.id);
            } else if (proposal.expiresAt.getTime() <= now.getTime()) {
              await expireProposal(rt, proposal, now);
            } else {
              await skip(proposal.id);
            }
          });
        } catch (error) {
          console.error(`[renown-orgs] proposal ${due.id} could not be swept: ${describe(error)}`);
          await skip(due.id);
        }
      }
      for (const stuck of await store.rearmableProposals(now, BATCH)) {
        try {
          await rt.lock(`org:${stuck.orgId}`, async () => {
            const proposal = await rt.store().proposal(stuck.id);
            if (proposal && !(await rearmProposal(rt, proposal, now))) await skip(proposal.id);
          });
        } catch (error) {
          console.error(`[renown-orgs] proposal ${stuck.id} could not be re-armed: ${describe(error)}`);
          await skip(stuck.id);
        }
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
