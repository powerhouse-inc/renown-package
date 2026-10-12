import { actions as orgActions } from "../../document-models/renown-organization/index.js";
import { domainRestoreOf } from "./areas/domains.js";
import { writeDocument } from "./areas/members.js";
import { expireProposal, rearmProposal, runProposal } from "./areas/proposals.js";
import { proveDomain } from "./core/domain-proof.js";
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

const HOUR_MS = 60 * MINUTE_MS;
/** A VERIFIED domain is re-checked once it was last checked this long ago. */
export const RECHECK_AFTER_MS = 24 * HOUR_MS;
/** Consecutive failed daily re-checks (so at least 3 days without a proof) that lapse a domain. */
export const LAPSE_AFTER_FAILURES = 3;
/** Domains per run: each check may take a DNS timeout plus an HTTPS timeout, and a run should end well within the hour. */
const DOMAIN_BATCH = 50;

/**
 * Hourly: re-checks every VERIFIED domain last checked a day ago or more;
 * LAPSE_AFTER_FAILURES failures in a row lapse it (store first, then the
 * document, the store reverted when the document cannot be written). Each
 * domain is isolated: one that throws is logged and marked checked, so it
 * neither stops the run nor holds the front of the next batch.
 */
export function domainsJob(rt: OrgRuntime): SweepJob {
  return {
    name: "domains",
    everyMs: HOUR_MS,
    async run(now) {
      const store = rt.store();
      const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));
      for (const due of await store.domainsToRecheck(new Date(now.getTime() - RECHECK_AFTER_MS), DOMAIN_BATCH)) {
        try {
          // The network check runs outside the org lock; the result is applied under it.
          const proved = await proveDomain(rt.net(), due.domain, due.orgId, due.token);
          await rt.lock(`org:${due.orgId}`, async () => {
            const domain = await rt.store().domain(due.id);
            // Removed, no longer VERIFIED, or checked since it was listed (a concurrent run, a manual check): nothing to apply.
            if (!domain || domain.status !== "VERIFIED" || domain.lastCheckedAt?.getTime() !== due.lastCheckedAt?.getTime()) return;
            if (proved) {
              await store.updateDomain(domain.id, { lastCheckedAt: now, failures: 0 });
              return;
            }
            const failures = domain.failures + 1;
            if (failures < LAPSE_AFTER_FAILURES) {
              await store.updateDomain(domain.id, { lastCheckedAt: now, failures });
              return;
            }
            await store.updateDomain(domain.id, { status: "LAPSED", lastCheckedAt: now, failures });
            await writeDocument(rt, "system.domainLapsed", domain.orgId, [orgActions.setDomainStatus({ id: domain.id, status: "LAPSED" })], () =>
              store.updateDomain(domain.id, domainRestoreOf(domain)),
            );
            const data = { domainId: domain.id, domain: domain.domain };
            await rt.record({
              orgId: domain.orgId,
              actor: "system",
              action: "system.domainLapsed",
              at: now,
              details: { ...data, failures },
              event: { type: "domain.lapsed", data },
              notify: [{ to: "ADMINS", kind: "DOMAIN_LAPSED", payload: data }],
            });
          });
        } catch (error) {
          console.error(`[renown-orgs] domain ${due.id} could not be re-checked: ${describe(error)}`);
          try {
            await store.updateDomain(due.id, { lastCheckedAt: now });
          } catch (markError) {
            console.error(`[renown-orgs] could not mark domain ${due.id} checked: ${describe(markError)}`);
          }
        }
      }
    },
  };
}

/** Every sweep job of renown-orgs; later tasks append theirs. */
export function sweepJobs(rt: OrgRuntime): SweepJob[] {
  return [proposalsJob(rt), signaturesJob(rt), domainsJob(rt)];
}
