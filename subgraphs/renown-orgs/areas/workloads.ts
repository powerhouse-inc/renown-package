import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { notFound, unavailable } from "../core/errors.js";
import { iso } from "../output.js";
import type { Area } from "../runtime.js";
import { setWorkloadDisabled, workloadsOfOrg, type OrgWorkloadRecord } from "../store/foreign.js";

function workloadOutput(w: OrgWorkloadRecord) {
  return { ...w, createdAt: iso(w.createdAt) };
}

/** The renown-workload namespace failed (missing, or the host refused); never leak its error. */
async function workloadAccess<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.error(`[renown-orgs] workload identities unavailable: ${error instanceof Error ? error.message : "unknown error"}`);
    throw unavailable("Workload identities cannot be reached right now");
  }
}

/** Org service accounts: the renown-workload identities registered for an organisation. */
export const workloadResolvers: Area = (rt) => ({
  Query: {
    orgWorkloads: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgWorkloads", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      return (await workloadAccess(() => workloadsOfOrg(rt.deps.relationalDb, args.orgId))).map(workloadOutput);
    },
  },
  Mutation: {
    setOrgWorkloadDisabled: async (_: unknown, args: OrgArgs & { orgId: string; did: string; disabled: boolean }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "setOrgWorkloadDisabled", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        const updated = await workloadAccess(() => setWorkloadDisabled(rt.deps.relationalDb, args.orgId, args.did, args.disabled, now));
        if (!updated) throw notFound("Workload identity");
        await rt.record({ orgId: args.orgId, actor: caller, action: "setOrgWorkloadDisabled", at: now, details: { did: args.did, disabled: args.disabled } });
        return workloadOutput(updated);
      });
    },
  },
});
