import { actions as orgActions, isOrgDomain } from "../../../document-models/renown-organization/index.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import {
  domainTxtName,
  domainTxtValue,
  proveDomain,
  proveRecovery,
  RECOVERY_MIN_VERIFIED_DAYS,
  recoveryTxtValue,
  wellKnownJson,
  wellKnownUrl,
} from "../core/domain-proof.js";
import { badInput, forbidden, limitReached, notFound, orgError, unavailable } from "../core/errors.js";
import { iso, isoOrNull } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { DomainRecord, OrgRecord } from "../store/types.js";
import { addressArg, writeDocument } from "./members.js";
import { createProposal, proposalOutput } from "./proposals.js";

export const MAX_DOMAINS = 10;
export { RECOVERY_MIN_VERIFIED_DAYS };
const DAY_MS = 86_400_000;

/** A lowercase DNS name without the trailing dot, or BAD_USER_INPUT on field "domain". */
export function normalizeDomain(raw: string): string {
  const domain = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!isOrgDomain(domain)) throw badInput("domain", "domain must be a DNS name like example.com");
  return domain;
}

export function domainOutput(d: DomainRecord) {
  return {
    id: d.id,
    orgId: d.orgId,
    domain: d.domain,
    status: d.status,
    verifiedAt: isoOrNull(d.verifiedAt),
    lastCheckedAt: isoOrNull(d.lastCheckedAt),
    failures: d.failures,
    createdAt: iso(d.createdAt),
    txtName: domainTxtName(d.domain),
    txtValue: domainTxtValue(d.orgId, d.token),
    wellKnownUrl: wellKnownUrl(d.domain),
    wellKnownJson: wellKnownJson(d.orgId, d.token),
  };
}

/** The fields a domain write may change, as they were (compensation). */
export function domainRestoreOf(d: DomainRecord) {
  return { status: d.status, verifiedAt: d.verifiedAt, lastCheckedAt: d.lastCheckedAt, failures: d.failures };
}

function domainTaken() {
  return orgError("DOMAIN_TAKEN", "Another organization has verified this domain");
}

/** The admin's domain of `orgId`, or NOT_FOUND / FORBIDDEN. */
async function adminDomain(rt: OrgRuntime, orgId: string, caller: string, domainId: string): Promise<DomainRecord> {
  const store = rt.store();
  await requireOrg(store, orgId);
  await requireRole(store, orgId, caller, "ADMIN");
  const domain = await store.domain(domainId);
  if (!domain || domain.orgId !== orgId) throw notFound("Domain");
  return domain;
}

/** The org's domain `name`, VERIFIED for at least RECOVERY_MIN_VERIFIED_DAYS, or BAD_USER_INPUT on field "domain". */
async function recoveryDomain(rt: OrgRuntime, org: OrgRecord, name: string, now: Date): Promise<DomainRecord> {
  const domain = (await rt.store().domains(org.id)).find((d) => d.domain === name && d.status === "VERIFIED");
  if (!domain?.verifiedAt) throw badInput("domain", "The domain is not verified for this organization");
  if (now.getTime() - domain.verifiedAt.getTime() < RECOVERY_MIN_VERIFIED_DAYS * DAY_MS) {
    throw badInput("domain", `The domain must have been verified for ${RECOVERY_MIN_VERIFIED_DAYS} days`);
  }
  return domain;
}

/** BAD_USER_INPUT on field "newOwner" when the address already is an active owner. */
async function assertNotOwner(rt: OrgRuntime, orgId: string, address: string): Promise<void> {
  const member = await rt.store().openMember(orgId, address);
  if (member?.status === "ACTIVE" && member.role === "OWNER") throw badInput("newOwner", "This address already is an owner");
}

async function assertNoPendingRecovery(rt: OrgRuntime, orgId: string): Promise<void> {
  if ((await rt.store().proposals(orgId, "PENDING")).some((p) => p.kind === "RECOVER")) {
    throw badInput("domain", "A recovery is already pending");
  }
}

export const domainResolvers: Area = (rt) => ({
  Query: {
    orgDomains: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgDomains", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      return (await store.domains(args.orgId)).map(domainOutput);
    },
  },
  Mutation: {
    addOrgDomain: async (_: unknown, args: OrgArgs & { orgId: string; domain: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "addOrgDomain", args);
      const name = normalizeDomain(args.domain);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        const owner = await store.verifiedDomainOwner(name);
        if (owner && owner !== args.orgId) throw domainTaken();
        const existing = await store.domains(args.orgId);
        if (existing.length >= MAX_DOMAINS) throw limitReached(`At most ${MAX_DOMAINS} domains`);
        if (existing.some((d) => d.domain === name)) throw badInput("domain", "The domain is already added");
        const domain: DomainRecord = {
          id: rt.newId(),
          orgId: args.orgId,
          domain: name,
          // 16 random bytes: 22 base64url characters.
          token: rt.token(16),
          status: "PENDING",
          verifiedAt: null,
          lastCheckedAt: null,
          failures: 0,
          createdAt: now,
        };
        await store.insertDomain(domain);
        await writeDocument(rt, "addOrgDomain", args.orgId, [orgActions.addDomain({ id: domain.id, domain: name })], () => store.deleteDomain(domain.id));
        await rt.record({ orgId: args.orgId, actor: caller, action: "addOrgDomain", at: now, details: { domainId: domain.id, domain: name } });
        return domainOutput(domain);
      });
    },
    checkOrgDomain: async (_: unknown, args: OrgArgs & { orgId: string; domainId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "checkOrgDomain", args);
      // DNS and HTTPS (up to seconds) run outside the org lock; the result is applied under it.
      const checked = await adminDomain(rt, args.orgId, caller, args.domainId);
      const owner = await rt.store().verifiedDomainOwner(checked.domain);
      if (owner && owner !== args.orgId) throw domainTaken();
      const proved = await proveDomain(rt.net(), checked.domain, args.orgId, checked.token);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const domain = await adminDomain(rt, args.orgId, caller, args.domainId);
        if (!proved) {
          // A VERIFIED domain keeps its re-check schedule: a failed manual check must not postpone the daily re-check.
          if (domain.status !== "VERIFIED") await store.updateDomain(domain.id, { lastCheckedAt: now });
          throw orgError("DOMAIN_PROOF_MISSING", `Neither ${domainTxtName(domain.domain)} nor ${wellKnownUrl(domain.domain)} proves the domain`);
        }
        const transition = domain.status !== "VERIFIED";
        const verifiedAt = transition ? now : domain.verifiedAt;
        let updated: DomainRecord | undefined;
        try {
          updated = await store.updateDomain(domain.id, { status: "VERIFIED", verifiedAt, lastCheckedAt: now, failures: 0 });
        } catch (error) {
          // The org_domains_verified_once index refuses it when another organization verified it first;
          // anything else is a store failure, not a taken domain.
          const holder = await store.verifiedDomainOwner(domain.domain).catch(() => undefined);
          if (holder && holder !== args.orgId) throw domainTaken();
          console.error(`[renown-orgs] checkOrgDomain: domain ${domain.id} could not be updated: ${error instanceof Error ? error.message : String(error)}`);
          throw unavailable();
        }
        if (!updated) throw unavailable();
        if (transition) {
          await writeDocument(rt, "checkOrgDomain", args.orgId, [orgActions.setDomainStatus({ id: domain.id, status: "VERIFIED", verifiedAt: iso(now) })], () =>
            store.updateDomain(domain.id, domainRestoreOf(domain)),
          );
          const data = { domainId: domain.id, domain: domain.domain };
          await rt.record({ orgId: args.orgId, actor: caller, action: "checkOrgDomain", at: now, details: data, event: { type: "domain.verified", data } });
        }
        return domainOutput(updated);
      });
    },
    removeOrgDomain: async (_: unknown, args: OrgArgs & { orgId: string; domainId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "removeOrgDomain", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const domain = await adminDomain(rt, args.orgId, caller, args.domainId);
        // A verified domain can recover the organization: only owners give it up; admins remove pending and lapsed ones.
        if (domain.status === "VERIFIED") {
          await requireRole(store, args.orgId, caller, "OWNER").catch(() => {
            throw forbidden("Only owners remove a verified domain");
          });
        }
        await store.deleteDomain(domain.id);
        await writeDocument(rt, "removeOrgDomain", args.orgId, [orgActions.removeDomain({ id: domain.id })], () => store.insertDomain(domain));
        await rt.record({ orgId: args.orgId, actor: caller, action: "removeOrgDomain", at: rt.now(), details: { domainId: domain.id, domain: domain.domain } });
        return true;
      });
    },
    startOrgRecovery: async (_: unknown, args: OrgArgs & { orgId: string; domain: string; newOwner: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "startOrgRecovery", args);
      const name = normalizeDomain(args.domain);
      const newOwner = addressArg("newOwner", args.newOwner);
      const org = await requireOrg(rt.store(), args.orgId);
      await recoveryDomain(rt, org, name, rt.now());
      await assertNotOwner(rt, org.id, newOwner);
      await assertNoPendingRecovery(rt, org.id);
      // The proof (DNS, HTTPS) runs outside the lock; everything is re-checked under it.
      if (!(await proveRecovery(rt.net(), name, org.id, newOwner))) {
        throw orgError("DOMAIN_PROOF_MISSING", `Publish ${recoveryTxtValue(org.id, newOwner)} at ${domainTxtName(name)}, or a recover entry in ${wellKnownUrl(name)}`);
      }
      return rt.lock(`org:${org.id}`, async () => {
        const now = rt.now();
        const current = await requireOrg(rt.store(), org.id);
        await recoveryDomain(rt, current, name, now);
        await assertNotOwner(rt, current.id, newOwner);
        await assertNoPendingRecovery(rt, current.id);
        // Threshold 0, executable after recoverySeconds; owners are told (PROPOSAL_CREATED, RECOVERY_STARTED) and any of them may cancel.
        return proposalOutput(await createProposal(rt, current, "RECOVER", { domain: name, address: newOwner }, caller, [], now));
      });
    },
  },
});
