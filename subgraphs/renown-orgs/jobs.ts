import { actions as orgActions } from "../../document-models/renown-organization/index.js";
import { domainRestoreOf } from "./areas/domains.js";
import { NOTIFICATION_RETENTION_DAYS, registerNotificationSink } from "./areas/notifications.js";
import { writeDocument } from "./areas/members.js";
import { expireProposal, rearmProposal, runProposal } from "./areas/proposals.js";
import { expireTransfer } from "./areas/transfers.js";
import { proveDomain } from "./core/domain-proof.js";
import type { SweepJob } from "./core/sweeper.js";
import type { OrgRuntime } from "./runtime.js";
import { credentialsCreatedBetween } from "./store/foreign.js";

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
            // Compare-and-set on last_checked_at: another replica that checked it meanwhile wins, nothing is counted twice.
            const read = { lastCheckedAt: domain.lastCheckedAt };
            if (proved) {
              await store.updateDomain(domain.id, { lastCheckedAt: now, failures: 0 }, read);
              return;
            }
            const failures = domain.failures + 1;
            if (failures < LAPSE_AFTER_FAILURES) {
              await store.updateDomain(domain.id, { lastCheckedAt: now, failures }, read);
              return;
            }
            if (!(await store.updateDomain(domain.id, { status: "LAPSED", lastCheckedAt: now, failures }, read))) return;
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

/**
 * Expires PENDING app transfers 14 days after they were made, each under its
 * app lock. Each transfer is isolated: one that throws is logged and the
 * run goes on.
 */
export function transfersJob(rt: OrgRuntime): SweepJob {
  return {
    name: "transfers",
    everyMs: MINUTE_MS,
    async run(now) {
      for (const due of await rt.store().dueTransfers(now, BATCH)) {
        try {
          await rt.lock(`app:${due.appDid}`, () => expireTransfer(rt, due, now));
        } catch (error) {
          console.error(`[renown-orgs] transfer ${due.id} could not be expired: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    },
  };
}

const DAY_MS = 24 * HOUR_MS;
/** Delegations per run of delegationsJob. */
const DELEGATION_BATCH = 500;

/** Daily: deletes notifications (and delegation-alert claims) older than the retention period. */
export function notificationsPruneJob(rt: OrgRuntime): SweepJob {
  return {
    name: "notifications-prune",
    everyMs: DAY_MS,
    async run(now) {
      const before = new Date(now.getTime() - NOTIFICATION_RETENTION_DAYS * DAY_MS);
      await rt.store().pruneNotifications(before);
      await rt.store().pruneDelegationAlerts(before);
    },
  };
}

/** How far behind the clock delegationsJob reads: covers commit latency and clock skew between replicas. */
export const DELEGATION_LAG_MS = 60_000;
/** Org app DIDs per credentials query. */
const APP_CHUNK = 500;

interface DelegationAlert {
  credentialId: string;
  appDid: string;
  issuer: string;
  orgId: string;
}

/**
 * Every 5 minutes: tells an organisation's admins (DELEGATION_ADDED) about
 * delegations an ACTIVE member created for one of its apps. It reads the
 * contiguous window (watermark, now - DELEGATION_LAG_MS] of the read model,
 * only for org apps, page by page until exhausted; the first run only sets
 * the watermark (no backlog). Everything is resolved before anything is
 * recorded, each credential is alerted at most once (claimDelegationAlert),
 * and the watermark advances only after a successful run, so a failed or
 * crashed run is repeated without duplicates.
 */
export function delegationsJob(rt: OrgRuntime, options: { pageSize?: number } = {}): SweepJob {
  const pageSize = options.pageSize ?? DELEGATION_BATCH;
  const name = "delegations";
  return {
    name,
    everyMs: 5 * MINUTE_MS,
    async run(now) {
      const store = rt.store();
      const to = new Date(now.getTime() - DELEGATION_LAG_MS);
      const from = await store.jobWatermark(name);
      if (!from) return store.setJobWatermark(name, to);
      if (to.getTime() <= from.getTime()) return;
      const orgOf = new Map((await store.allOrgApps()).map((app) => [app.appDid, app.orgId]));
      const appDids = [...orgOf.keys()];
      const membership = new Map<string, boolean>();
      const alerts: DelegationAlert[] = [];
      for (let i = 0; i < appDids.length; i += APP_CHUNK) {
        const chunk = appDids.slice(i, i + APP_CHUNK);
        let after: { createdKey: string; credentialId: string } | undefined;
        for (;;) {
          const page = await credentialsCreatedBetween(rt.deps.relationalDb, chunk, { from, to }, pageSize, after);
          for (const row of page) {
            const orgId = orgOf.get(row.appDid);
            if (!orgId) continue;
            const key = `${orgId}\u0000${row.issuer}`;
            let active = membership.get(key);
            if (active === undefined) {
              active = (await store.openMember(orgId, row.issuer))?.status === "ACTIVE";
              membership.set(key, active);
            }
            if (active) alerts.push({ credentialId: row.credentialId, appDid: row.appDid, issuer: row.issuer, orgId });
          }
          const last = page.at(-1);
          if (page.length < pageSize || !last) break;
          if (after && last.createdKey === after.createdKey && last.credentialId === after.credentialId) throw new Error("delegations: the credentials cursor did not advance");
          after = { createdKey: last.createdKey, credentialId: last.credentialId };
        }
      }
      for (const alert of alerts) {
        if (!(await store.claimDelegationAlert(alert.credentialId, alert.orgId, now))) continue;
        const payload = { credentialId: alert.credentialId, appDid: alert.appDid, issuer: alert.issuer };
        // record never throws: an audit or notification write that fails is logged.
        await rt.record({
          orgId: alert.orgId,
          actor: "system",
          action: "system.delegationAdded",
          at: now,
          details: payload,
          notify: [{ to: "ADMINS", kind: "DELEGATION_ADDED", payload }],
        });
      }
      await store.setJobWatermark(name, to);
    },
  };
}

/** Every sweep job of renown-orgs; later tasks append theirs. */
export function sweepJobs(rt: OrgRuntime): SweepJob[] {
  // The jobs record notifications: the sink must exist even if no resolvers were built on this runtime.
  registerNotificationSink(rt);
  return [proposalsJob(rt), signaturesJob(rt), domainsJob(rt), transfersJob(rt), notificationsPruneJob(rt), delegationsJob(rt)];
}
