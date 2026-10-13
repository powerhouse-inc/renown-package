import { effectiveAllScope } from "../../../document-models/renown-organization/index.js";
import { roleAtLeast } from "../../../sdk/orgs.js";
import type { MemberRecord, OrgRecord, OrgRole, OrgStore, TeamRecord } from "../store/types.js";
import { forbidden, notFound } from "./errors.js";

export interface Scope {
  all: boolean;
  appDids: string[];
}

export function isAdminRole(role: OrgRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/**
 * The membership's own scope: owners and admins always act for every app.
 * Derived on read (effectiveAllScope); the stored appScopeAll never holds a
 * role-derived value.
 */
export function ownScope(member: MemberRecord): Scope {
  return {
    all: effectiveAllScope({ role: member.role, appScope: { all: member.appScopeAll } }),
    appDids: [...member.appDids],
  };
}

/** ownScope plus the app DIDs of every team the member belongs to. */
export function effectiveScope(member: MemberRecord, teams: readonly TeamRecord[]): Scope {
  const own = ownScope(member);
  const teamApps = teams.filter((team) => team.memberIds.includes(member.id)).flatMap((team) => team.appDids);
  return { all: own.all, appDids: [...new Set([...own.appDids, ...teamApps])] };
}

/** The organization; NOT_FOUND when unknown, FORBIDDEN for writes to an archived or taken-down one. */
export async function requireOrg(store: OrgStore, orgId: string, options: { writable?: boolean } = {}): Promise<OrgRecord> {
  const org = await store.organization(orgId);
  if (!org) throw notFound("Organization");
  if ((options.writable ?? true) && (org.archived || org.takenDown)) {
    throw forbidden("The organization is archived or taken down");
  }
  return org;
}

/** The caller's ACTIVE membership with at least `minRole`, else FORBIDDEN. */
export async function requireRole(store: OrgStore, orgId: string, address: string, minRole: OrgRole): Promise<MemberRecord> {
  const member = await store.openMember(orgId, address);
  if (!member || member.status !== "ACTIVE" || !roleAtLeast(member.role, minRole)) throw forbidden();
  return member;
}

/**
 * Publisher capability for `appDid`: the app belongs to the org, and
 * `address` is an ACTIVE member with at least PUBLISHER whose effective
 * scope covers it. Frozen apps are the caller's concern.
 */
export async function hasAppCapability(store: OrgStore, orgId: string, address: string, appDid: string): Promise<boolean> {
  const app = await store.orgOfApp(appDid);
  if (!app || app.orgId !== orgId) return false;
  const member = await store.openMember(orgId, address);
  if (!member || member.status !== "ACTIVE" || !roleAtLeast(member.role, "PUBLISHER")) return false;
  const scope = effectiveScope(member, await store.teams(orgId));
  return scope.all || scope.appDids.includes(appDid);
}
