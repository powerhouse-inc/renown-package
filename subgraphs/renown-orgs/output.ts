import { effectiveScope, ownScope, type Scope } from "./core/authz.js";
import { orgDid } from "./core/config.js";
import { profilesOf } from "./core/people.js";
import type { OrgRuntime } from "./runtime.js";
import type { InviteLinkRecord, MemberRecord, OrgLink, OrgRecord, OrgRole, StoredMemberStatus, TeamRecord } from "./store/types.js";

/** Direct invites expire 14 days after they were sent. */
export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type MemberStatusOutput = StoredMemberStatus | "EXPIRED";

export interface OrgSummaryOutput {
  id: string;
  did: string;
  handle: string;
  name: string;
  avatar: string | null;
  verifiedDomains: string[];
}

export interface OrgAppOutput {
  appDid: string;
  addedAt: string;
  frozen: boolean;
}

export interface OrgTeamOutput {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  appDids: string[];
  memberAddresses: string[];
}

export interface OrgMembershipOutput {
  orgId: string;
  address: string;
  role: OrgRole;
  status: MemberStatusOutput;
  appScope: Scope;
  effectiveScope: Scope;
  teams: string[];
}

export interface OrganizationOutput {
  id: string;
  did: string;
  handle: string;
  name: string;
  bio: string | null;
  website: string | null;
  avatar: string | null;
  links: OrgLink[];
  listed: boolean;
  membersPublic: boolean;
  archived: boolean;
  takenDown: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  verifiedDomains: string[];
  notAffiliatedWith: OrgSummaryOutput | null;
  ownerCount: number;
  memberCount: number;
  securityWarnings: "SINGLE_OWNER"[];
  apps: OrgAppOutput[];
  teams: OrgTeamOutput[];
  viewerMembership: OrgMembershipOutput | null;
}

export interface OrgMemberOutput {
  id: string;
  orgId: string;
  address: string;
  role: OrgRole;
  status: MemberStatusOutput;
  appScope: Scope;
  hidden: boolean;
  invitedBy: string | null;
  invitedAt: string;
  joinedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  expiresAt: string | null;
  teams: string[];
  handle: string | null;
  displayName: string | null;
  avatar: string | null;
}

export interface OrgInviteOutput {
  id: string;
  orgId: string;
  org: OrgSummaryOutput;
  address: string;
  role: OrgRole;
  status: MemberStatusOutput;
  invitedBy: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface OrgInviteLinkOutput {
  id: string;
  orgId: string;
  role: OrgRole;
  maxUses: number;
  uses: number;
  expiresAt: string;
  revoked: boolean;
  createdBy: string;
  createdAt: string;
}

export function iso(value: Date): string {
  return value.toISOString();
}

export function isoOrNull(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

export function inviteExpiresAt(member: MemberRecord): Date {
  return new Date(member.invitedAt.getTime() + INVITE_TTL_MS);
}

export function isExpiredInvite(member: MemberRecord, now: Date): boolean {
  return member.status === "INVITED" && inviteExpiresAt(member).getTime() <= now.getTime();
}

export function memberStatus(member: MemberRecord, now: Date): MemberStatusOutput {
  return isExpiredInvite(member, now) ? "EXPIRED" : member.status;
}

export function summaryOf(rt: OrgRuntime, org: OrgRecord, verifiedDomains: string[]): OrgSummaryOutput {
  return {
    id: org.id,
    did: orgDid(rt.config().didHost, org.id),
    handle: org.handle,
    name: org.name,
    avatar: org.takenDown ? null : org.avatarRef,
    verifiedDomains: org.takenDown ? [] : verifiedDomains,
  };
}

export async function orgSummaries(rt: OrgRuntime, orgs: readonly OrgRecord[]): Promise<Map<string, OrgSummaryOutput>> {
  const domains = await rt.store().verifiedDomains(orgs.map((org) => org.id));
  return new Map(orgs.map((org) => [org.id, summaryOf(rt, org, domains.get(org.id) ?? [])]));
}

export function teamOutput(team: TeamRecord, members: readonly MemberRecord[]): OrgTeamOutput {
  const addresses = new Map(members.map((member) => [member.id, member.address]));
  return {
    id: team.id,
    orgId: team.orgId,
    slug: team.slug,
    name: team.name,
    appDids: [...team.appDids],
    memberAddresses: team.memberIds.flatMap((id) => {
      const address = addresses.get(id);
      return address ? [address] : [];
    }),
  };
}

export function membershipOutput(member: MemberRecord, teams: readonly TeamRecord[], now: Date): OrgMembershipOutput {
  return {
    orgId: member.orgId,
    address: member.address,
    role: member.role,
    status: memberStatus(member, now),
    appScope: ownScope(member),
    effectiveScope: effectiveScope(member, teams),
    teams: teams.filter((team) => team.memberIds.includes(member.id)).map((team) => team.slug),
  };
}

/** An organization as GraphQL returns it to `viewer` (lowercase address or null). */
export async function organizationOutput(rt: OrgRuntime, org: OrgRecord, viewer: string | null): Promise<OrganizationOutput> {
  const base = {
    id: org.id,
    did: orgDid(rt.config().didHost, org.id),
    handle: org.handle,
    name: org.name,
    listed: org.listed,
    membersPublic: org.membersPublic,
    archived: org.archived,
    takenDown: org.takenDown,
    createdBy: org.createdBy,
    createdAt: iso(org.createdAt),
    updatedAt: iso(org.updatedAt),
  };
  if (org.takenDown) {
    return {
      ...base,
      bio: null,
      website: null,
      avatar: null,
      links: [],
      verifiedDomains: [],
      notAffiliatedWith: null,
      ownerCount: 0,
      memberCount: 0,
      securityWarnings: [],
      apps: [],
      teams: [],
      viewerMembership: null,
    };
  }
  const store = rt.store();
  const [domains, active, apps] = await Promise.all([
    store.verifiedDomains([org.id]),
    store.members(org.id, ["ACTIVE"]),
    store.orgApps(org.id),
  ]);
  const verifiedDomains = domains.get(org.id) ?? [];
  const lookalike = verifiedDomains.length === 0 ? await store.verifiedOrgNamed(org.name, org.id) : undefined;
  const notAffiliatedWith = lookalike ? (await orgSummaries(rt, [lookalike])).get(lookalike.id) ?? null : null;
  const ownerCount = active.filter((member) => member.role === "OWNER").length;
  const mine = viewer ? active.find((member) => member.address === viewer) : undefined;
  const teams = mine ? await store.teams(org.id) : [];
  // Same visibility as organizationMembers: members see everyone active, others only the public list.
  const memberCount = mine ? active.length : org.membersPublic ? active.filter((member) => !member.hidden).length : 0;
  return {
    ...base,
    bio: org.bio,
    website: org.website,
    avatar: org.avatarRef,
    links: org.links,
    verifiedDomains,
    notAffiliatedWith,
    ownerCount,
    memberCount,
    securityWarnings: ownerCount === 1 ? ["SINGLE_OWNER"] : [],
    apps: apps.map((app) => ({ appDid: app.appDid, addedAt: iso(app.addedAt), frozen: app.frozen })),
    teams: teams.map((team) => teamOutput(team, active)),
    viewerMembership: mine ? membershipOutput(mine, teams, rt.now()) : null,
  };
}

/** Member rows with their team slugs and profile cards. */
export async function memberOutputs(
  rt: OrgRuntime,
  members: readonly MemberRecord[],
  teams: readonly TeamRecord[],
): Promise<OrgMemberOutput[]> {
  const profiles = await profilesOf(rt.deps.relationalDb, [...new Set(members.map((member) => member.address))]);
  const now = rt.now();
  return members.map((member) => {
    const profile = profiles.get(member.address);
    const status = memberStatus(member, now);
    return {
      id: member.id,
      orgId: member.orgId,
      address: member.address,
      role: member.role,
      status,
      appScope: ownScope(member),
      hidden: member.hidden,
      invitedBy: member.invitedBy,
      invitedAt: iso(member.invitedAt),
      joinedAt: isoOrNull(member.joinedAt),
      endedAt: isoOrNull(member.endedAt),
      updatedAt: iso(member.updatedAt),
      expiresAt: status === "INVITED" || status === "EXPIRED" ? iso(inviteExpiresAt(member)) : null,
      teams: teams.filter((team) => team.memberIds.includes(member.id)).map((team) => team.slug),
      handle: profile?.handle ?? null,
      displayName: profile?.displayName ?? null,
      avatar: profile?.avatar ?? null,
    };
  });
}

export function inviteOutput(member: MemberRecord, org: OrgSummaryOutput, now: Date): OrgInviteOutput {
  return {
    id: member.id,
    orgId: member.orgId,
    org,
    address: member.address,
    role: member.role,
    status: memberStatus(member, now),
    invitedBy: member.invitedBy,
    createdAt: iso(member.invitedAt),
    expiresAt: iso(inviteExpiresAt(member)),
  };
}

export function inviteLinkOutput(link: InviteLinkRecord): OrgInviteLinkOutput {
  return {
    id: link.id,
    orgId: link.orgId,
    role: link.role,
    maxUses: link.maxUses,
    uses: link.uses,
    expiresAt: iso(link.expiresAt),
    revoked: link.revoked,
    createdBy: link.createdBy,
    createdAt: iso(link.createdAt),
  };
}
