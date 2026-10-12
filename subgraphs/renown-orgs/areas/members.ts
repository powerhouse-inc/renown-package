import {
  actions as orgActions,
  isOrgAppDid,
  MAX_ACTIVE_MEMBERS,
  MAX_SCOPE_APPS,
} from "../../../document-models/renown-organization/index.js";
import { sha256Hex } from "../../../sdk/orgs.js";
import type { Action } from "document-model";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { isAdminRole, requireOrg, requireRole } from "../core/authz.js";
import { badInput, forbidden, limitReached, notFound, orgError, unavailable } from "../core/errors.js";
import { normalizeHandle } from "../core/handles.js";
import { addressOfHandle } from "../core/people.js";
import {
  inviteLinkOutput,
  inviteOutput,
  isExpiredInvite,
  iso,
  memberOutputs,
  membershipOutput,
  organizationOutput,
  orgSummaries,
  summaryOf,
  type OrgMemberOutput,
} from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { MemberRecord, OrgRecord, OrgRole, OrgStore } from "../store/types.js";
import { MAX_MEMBERSHIPS_PER_WALLET, openMemberships } from "./organizations.js";

export const MAX_PENDING_INVITES = 200;
export const MAX_LINK_USES = 100;
export const MAX_LINK_DAYS = 30;
const DAY_MS = 86_400_000;
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const STRICT_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** A lowercase address argument, or BAD_USER_INPUT naming `field`. */
export function addressArg(field: string, value: string): string {
  const trimmed = value.trim();
  if (!ADDRESS_RE.test(trimmed)) throw badInput(field, `${field} must be a 0x address`);
  return trimmed.toLowerCase();
}

/** FORBIDDEN unless `actor` may give or take every role in `roles`: OWNER never here, ADMIN by owners only. */
export function assertManages(actor: MemberRecord, roles: readonly OrgRole[]): void {
  if (roles.includes("OWNER")) throw forbidden("Owners change through proposals");
  if (roles.includes("ADMIN") && actor.role !== "OWNER") throw forbidden("Only owners manage admins");
}

async function resolveInvitee(rt: OrgRuntime, raw: string): Promise<string> {
  const value = raw.trim();
  if (value.startsWith("0x")) return addressArg("invitee", value);
  let address: string | undefined;
  try {
    address = await addressOfHandle(rt.deps.relationalDb, normalizeHandle(value));
  } catch {
    throw unavailable("Renown profiles cannot be read right now");
  }
  if (!address) throw badInput("invitee", `No Renown user has the handle "${value}"`);
  return address;
}

async function assertRoomFor(store: OrgStore, orgId: string): Promise<void> {
  if ((await store.members(orgId, ["ACTIVE"])).length >= MAX_ACTIVE_MEMBERS) {
    throw limitReached(`An organization has at most ${MAX_ACTIVE_MEMBERS} active members`);
  }
}

async function assertMembershipsLeft(store: OrgStore, address: string, now: Date): Promise<void> {
  if ((await openMemberships(store, address, now)).length >= MAX_MEMBERSHIPS_PER_WALLET) {
    throw limitReached(`A wallet holds at most ${MAX_MEMBERSHIPS_PER_WALLET} memberships`);
  }
}

async function summaryFor(rt: OrgRuntime, org: OrgRecord) {
  return summaryOf(rt, org, (await rt.store().verifiedDomains([org.id])).get(org.id) ?? []);
}

async function oneMember(rt: OrgRuntime, member: MemberRecord): Promise<OrgMemberOutput> {
  const [output] = await memberOutputs(rt, [member], await rt.store().teams(member.orgId));
  return output;
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The document half of a membership write, after the store half committed
 * (the createOrganization order): when the document cannot be written,
 * `undo` reverts the store and the caller gets SERVICE_UNAVAILABLE. Never
 * log action payloads here; nothing secret is in them today, keep it so.
 */
async function writeDocument(rt: OrgRuntime, field: string, orgId: string, actions: Action[], undo: () => Promise<unknown>): Promise<void> {
  try {
    await rt.execute(orgId, actions);
  } catch (error) {
    console.error(`[renown-orgs] ${field}: document ${orgId} write failed (${reason(error)}); rolling back`);
    try {
      await undo();
    } catch (cleanup) {
      console.error(`[renown-orgs] ${field}: rollback in ${orgId} failed: ${reason(cleanup)}`);
    }
    throw unavailable();
  }
}

/** The fields a member update may have changed, as they were (for an undo). */
function restoreOf(member: MemberRecord) {
  return {
    role: member.role,
    status: member.status,
    appScopeAll: member.appScopeAll,
    appDids: member.appDids,
    hidden: member.hidden,
    joinedAt: member.joinedAt,
    endedAt: member.endedAt,
    updatedAt: member.updatedAt,
  };
}

/**
 * Ends a membership record (call under the org lock): the store first (the
 * status and every team place, in one transaction), then the document, then,
 * for LEFT and REMOVED, the membership-ended hooks (A2 suspends the member's
 * org-app credentials; hook failures are logged). The last ACTIVE owner
 * cannot leave or be removed: LAST_OWNER.
 */
export async function endMembership(
  rt: OrgRuntime,
  member: MemberRecord,
  status: "LEFT" | "REMOVED" | "DECLINED" | "REVOKED",
  actor: string,
  now: Date,
): Promise<MemberRecord> {
  const store = rt.store();
  if (member.status === "ACTIVE" && member.role === "OWNER") {
    const owners = (await store.members(member.orgId, ["ACTIVE"])).filter((m) => m.role === "OWNER");
    if (owners.length <= 1) throw orgError("LAST_OWNER", "The only owner cannot leave; add another owner first");
  }
  const places = (await store.teams(member.orgId)).filter((team) => team.memberIds.includes(member.id));
  const ended = await store.transaction(async (tx) => {
    const updated = await tx.updateMember(member.id, { status, endedAt: now, updatedAt: now });
    await tx.removeMemberFromTeams(member.id);
    return updated;
  });
  if (!ended) throw unavailable();
  await writeDocument(rt, "endMembership", member.orgId, [orgActions.setMemberStatus({ id: member.id, status, at: iso(now) })], () =>
    store.transaction(async (tx) => {
      await tx.updateMember(member.id, restoreOf(member));
      for (const team of places) await tx.setTeamMembers(team.id, team.memberIds);
    }),
  );
  if (status === "LEFT" || status === "REMOVED") {
    for (const hook of rt.hooks.membershipEnded) {
      try {
        await hook({ orgId: member.orgId, memberId: member.id, address: member.address, reason: status, actor, at: now });
      } catch (error) {
        console.error(`[renown-orgs] membership-ended hook failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return ended;
}

export const memberResolvers: Area = (rt) => ({
  Query: {
    organizationsByMember: async (_: unknown, args: OrgArgs & { address: string }, ctx: OrgContext) => {
      const address = addressArg("address", args.address);
      const viewer = await rt.viewer(ctx, "organizationsByMember", args);
      const store = rt.store();
      const memberships = await store.membershipsOf(address, ["ACTIVE"]);
      const orgs = new Map((await store.organizationsByIds(memberships.map((m) => m.orgId))).map((org) => [org.id, org]));
      const visible = memberships.flatMap((member) => {
        const org = orgs.get(member.orgId);
        if (!org || org.archived || org.takenDown) return [];
        return viewer === address || (org.membersPublic && !member.hidden) ? [{ org, member }] : [];
      });
      return Promise.all(
        visible.map(async ({ org, member }) => ({ org: await organizationOutput(rt, org, viewer), role: member.role, hidden: member.hidden })),
      );
    },
    organizationMembers: async (_: unknown, args: OrgArgs & { orgId: string; includeInactive?: boolean | null }, ctx: OrgContext) => {
      const viewer = await rt.viewer(ctx, "organizationMembers", args);
      const store = rt.store();
      const org = await requireOrg(store, args.orgId, { writable: false });
      if (org.takenDown) return [];
      const all = await store.members(org.id);
      const me = viewer ? all.find((m) => m.address === viewer && m.status === "ACTIVE") : undefined;
      let shown: MemberRecord[];
      if (me && args.includeInactive && isAdminRole(me.role)) shown = all;
      else if (me) shown = all.filter((m) => m.status === "ACTIVE");
      else if (org.membersPublic) shown = all.filter((m) => m.status === "ACTIVE" && !m.hidden);
      else shown = [];
      return memberOutputs(rt, shown, me ? await store.teams(org.id) : []);
    },
    orgMembership: async (_: unknown, args: { orgId: string; address: string }) => {
      const address = addressArg("address", args.address);
      const store = rt.store();
      const org = await store.organization(args.orgId);
      if (!org || org.archived || org.takenDown) return null;
      const member = await store.openMember(org.id, address);
      if (!member || member.status !== "ACTIVE") return null;
      return membershipOutput(member, await store.teams(org.id), rt.now());
    },
    orgInvites: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgInvites", args);
      const store = rt.store();
      const org = await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, org.id, caller, "ADMIN");
      const summary = await summaryFor(rt, org);
      return (await store.members(org.id, ["INVITED"])).map((member) => inviteOutput(member, summary, rt.now()));
    },
    orgInviteLinks: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgInviteLinks", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      return (await store.inviteLinks(args.orgId)).map(inviteLinkOutput);
    },
    myOrgInvites: async (_: unknown, args: OrgArgs, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "myOrgInvites", args);
      const store = rt.store();
      const now = rt.now();
      const invites = (await store.membershipsOf(caller, ["INVITED"])).filter((m) => !isExpiredInvite(m, now));
      const orgs = (await store.organizationsByIds(invites.map((m) => m.orgId))).filter((o) => !o.archived && !o.takenDown);
      const summaries = await orgSummaries(rt, orgs);
      return invites.flatMap((member) => {
        const summary = summaries.get(member.orgId);
        return summary ? [inviteOutput(member, summary, now)] : [];
      });
    },
    orgInviteLink: async (_: unknown, args: { token: string }) => {
      const store = rt.store();
      const link = await store.inviteLinkByHash(await sha256Hex(args.token.trim()));
      if (!link) return null;
      const org = await store.organization(link.orgId);
      if (!org || org.takenDown) return null;
      const expired = link.expiresAt.getTime() <= rt.now().getTime();
      const full = link.uses >= link.maxUses;
      return {
        org: await summaryFor(rt, org),
        role: link.role,
        expiresAt: iso(link.expiresAt),
        expired,
        revoked: link.revoked,
        full,
        usable: !expired && !link.revoked && !full && !org.archived,
      };
    },
  },
  Mutation: {
    inviteOrgMember: async (_: unknown, args: OrgArgs & { orgId: string; invitee: string; role: OrgRole }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "inviteOrgMember", args);
      if (args.role === "OWNER") throw badInput("role", "Owners are added through an ADD_OWNER proposal");
      const invitee = await resolveInvitee(rt, args.invitee);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        const actor = await requireRole(store, org.id, caller, "ADMIN");
        assertManages(actor, [args.role]);
        const existing = await store.openMember(org.id, invitee);
        if (existing?.status === "ACTIVE") throw badInput("invitee", "Already a member");
        if (existing && !isExpiredInvite(existing, now)) throw badInput("invitee", "Already invited");
        const pending = (await store.members(org.id, ["INVITED"])).filter((m) => !isExpiredInvite(m, now));
        if (pending.length >= MAX_PENDING_INVITES) throw limitReached(`At most ${MAX_PENDING_INVITES} pending invites`);
        await assertMembershipsLeft(store, invitee, now);
        rt.takeInvite(org.id);
        const id = rt.newId();
        const at = iso(now);
        // Stored scope is explicit, never role-derived: owners and admins get every app on read.
        const member: MemberRecord = {
          id,
          orgId: org.id,
          address: invitee,
          role: args.role,
          status: "INVITED",
          appScopeAll: false,
          appDids: [],
          hidden: false,
          invitedBy: caller,
          invitedAt: now,
          joinedAt: null,
          endedAt: null,
          updatedAt: now,
        };
        await store.transaction(async (tx) => {
          if (existing) await tx.updateMember(existing.id, { status: "REVOKED", endedAt: now, updatedAt: now });
          await tx.insertMember(member);
        });
        await writeDocument(
          rt,
          "inviteOrgMember",
          org.id,
          [
            ...(existing ? [orgActions.setMemberStatus({ id: existing.id, status: "REVOKED", at })] : []),
            orgActions.inviteMember({ id, address: invitee, role: args.role, invitedAt: at }),
          ],
          () =>
            store.transaction(async (tx) => {
              await tx.deleteMember(id);
              if (existing) await tx.updateMember(existing.id, restoreOf(existing));
            }),
        );
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "inviteOrgMember",
          at: now,
          details: { address: invitee, role: args.role },
          event: { type: "member.invited", data: { address: invitee, role: args.role } },
          notify: [{ to: [invitee], kind: "INVITED", payload: { inviteId: id, role: args.role } }],
        });
        return inviteOutput(member, await summaryFor(rt, org), now);
      });
    },
    respondToOrgInvite: async (_: unknown, args: OrgArgs & { orgId: string; inviteId: string; accept: boolean }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "respondToOrgInvite", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        const invite = await store.member(args.inviteId);
        if (!invite || invite.orgId !== org.id || invite.address !== caller) throw notFound("Invite");
        if (invite.status !== "INVITED") throw badInput("inviteId", `The invite is ${invite.status}`);
        if (isExpiredInvite(invite, now)) throw badInput("inviteId", "The invite expired");
        if (!args.accept) {
          const declined = await endMembership(rt, invite, "DECLINED", caller, now);
          await rt.record({ orgId: org.id, actor: caller, action: "respondToOrgInvite", at: now, details: { inviteId: invite.id, accept: false } });
          return oneMember(rt, declined);
        }
        await assertRoomFor(store, org.id);
        const joined = await store.updateMember(invite.id, { status: "ACTIVE", joinedAt: now, updatedAt: now });
        if (!joined) throw unavailable();
        await writeDocument(rt, "respondToOrgInvite", org.id, [orgActions.setMemberStatus({ id: invite.id, status: "ACTIVE", at: iso(now) })], () =>
          store.updateMember(invite.id, restoreOf(invite)),
        );
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "respondToOrgInvite",
          at: now,
          details: { inviteId: invite.id, accept: true },
          event: { type: "member.joined", data: { address: caller, role: joined.role } },
          notify: [{ to: "ADMINS", kind: "INVITE_ACCEPTED", payload: { address: caller, role: joined.role } }],
        });
        return oneMember(rt, joined);
      });
    },
    revokeOrgInvite: async (_: unknown, args: OrgArgs & { orgId: string; inviteId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "revokeOrgInvite", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        const actor = await requireRole(store, org.id, caller, "ADMIN");
        const invite = await store.member(args.inviteId);
        if (!invite || invite.orgId !== org.id) throw notFound("Invite");
        if (invite.status !== "INVITED") throw badInput("inviteId", `The invite is ${invite.status}`);
        assertManages(actor, [invite.role]);
        const revoked = await endMembership(rt, invite, "REVOKED", caller, now);
        await rt.record({ orgId: org.id, actor: caller, action: "revokeOrgInvite", at: now, details: { inviteId: invite.id, address: invite.address } });
        return inviteOutput(revoked, await summaryFor(rt, org), now);
      });
    },
    createOrgInviteLink: async (
      _: unknown,
      args: OrgArgs & { orgId: string; role: OrgRole; maxUses: number; expiresAt: string },
      ctx: OrgContext,
    ) => {
      const caller = await rt.writer(ctx, "createOrgInviteLink", args);
      if (args.role !== "MEMBER" && args.role !== "PUBLISHER") throw badInput("role", "Invite links grant MEMBER or PUBLISHER");
      if (!Number.isInteger(args.maxUses) || args.maxUses < 1 || args.maxUses > MAX_LINK_USES) {
        throw badInput("maxUses", `maxUses must be 1-${MAX_LINK_USES}`);
      }
      const now = rt.now();
      const expiresAt = STRICT_ISO_RE.test(args.expiresAt) ? new Date(args.expiresAt) : new Date(Number.NaN);
      if (
        Number.isNaN(expiresAt.getTime()) ||
        expiresAt.getTime() <= now.getTime() ||
        expiresAt.getTime() > now.getTime() + MAX_LINK_DAYS * DAY_MS
      ) {
        throw badInput("expiresAt", `expiresAt must be an ISO-8601 time within the next ${MAX_LINK_DAYS} days`);
      }
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        rt.takeInvite(args.orgId);
        const token = rt.token(32);
        const link = {
          id: rt.newId(),
          orgId: args.orgId,
          tokenHash: await sha256Hex(token),
          role: args.role,
          maxUses: args.maxUses,
          uses: 0,
          expiresAt,
          revoked: false,
          createdBy: caller,
          createdAt: now,
        };
        await store.insertInviteLink(link);
        await rt.record({
          orgId: args.orgId,
          actor: caller,
          action: "createOrgInviteLink",
          at: now,
          details: { linkId: link.id, role: link.role, maxUses: link.maxUses, expiresAt: iso(expiresAt) },
        });
        return { link: inviteLinkOutput(link), token };
      });
    },
    revokeOrgInviteLink: async (_: unknown, args: OrgArgs & { orgId: string; linkId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "revokeOrgInviteLink", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        const link = await store.inviteLink(args.linkId);
        if (!link || link.orgId !== args.orgId) throw notFound("Invite link");
        await store.revokeInviteLink(link.id);
        await rt.record({ orgId: args.orgId, actor: caller, action: "revokeOrgInviteLink", at: rt.now(), details: { linkId: link.id } });
        return inviteLinkOutput({ ...link, revoked: true });
      });
    },
    acceptOrgInviteLink: async (_: unknown, args: OrgArgs & { token: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "acceptOrgInviteLink", args);
      const link = await rt.store().inviteLinkByHash(await sha256Hex(args.token.trim()));
      if (!link) throw badInput("token", "This invite link is not valid");
      return rt.lock(`org:${link.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, link.orgId);
        if (link.revoked) throw badInput("token", "This invite link was revoked");
        if (link.expiresAt.getTime() <= now.getTime()) throw badInput("token", "This invite link expired");
        const existing = await store.openMember(org.id, caller);
        if (existing?.status === "ACTIVE") throw badInput("token", "You are already a member");
        if (existing && !isExpiredInvite(existing, now)) throw badInput("token", "You have a pending invite; accept it instead");
        await assertRoomFor(store, org.id);
        await assertMembershipsLeft(store, caller, now);
        const id = rt.newId();
        const at = iso(now);
        const member: MemberRecord = {
          id,
          orgId: org.id,
          address: caller,
          role: link.role,
          status: "ACTIVE",
          appScopeAll: false,
          appDids: [],
          hidden: false,
          invitedBy: link.createdBy,
          invitedAt: now,
          joinedAt: now,
          endedAt: null,
          updatedAt: now,
        };
        const used = await store.transaction(async (tx) => {
          if (!(await tx.useInviteLink(link.id, now))) return false;
          if (existing) await tx.updateMember(existing.id, { status: "REVOKED", endedAt: now, updatedAt: now });
          await tx.insertMember(member);
          return true;
        });
        if (!used) throw badInput("token", "This invite link has been used up");
        await writeDocument(
          rt,
          "acceptOrgInviteLink",
          org.id,
          [
            ...(existing ? [orgActions.setMemberStatus({ id: existing.id, status: "REVOKED", at })] : []),
            orgActions.inviteMember({ id, address: caller, role: link.role, invitedAt: at }),
            orgActions.setMemberStatus({ id, status: "ACTIVE", at }),
          ],
          () =>
            store.transaction(async (tx) => {
              await tx.deleteMember(id);
              if (existing) await tx.updateMember(existing.id, restoreOf(existing));
              await tx.releaseInviteLinkUse(link.id);
            }),
        );
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "acceptOrgInviteLink",
          at: now,
          details: { linkId: link.id, role: link.role },
          event: { type: "member.joined", data: { address: caller, role: link.role } },
          notify: [{ to: "ADMINS", kind: "INVITE_ACCEPTED", payload: { address: caller, role: link.role } }],
        });
        return oneMember(rt, member);
      });
    },
    leaveOrganization: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "leaveOrganization", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        const member = await requireRole(store, org.id, caller, "MEMBER");
        await endMembership(rt, member, "LEFT", caller, now);
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "leaveOrganization",
          at: now,
          details: { address: caller, role: member.role },
          event: { type: "member.left", data: { address: caller, role: member.role } },
        });
        return true;
      });
    },
    removeOrgMember: async (_: unknown, args: OrgArgs & { orgId: string; address: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "removeOrgMember", args);
      const target = addressArg("address", args.address);
      if (target === caller) throw badInput("address", "Use leaveOrganization to leave");
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        const actor = await requireRole(store, org.id, caller, "ADMIN");
        const member = await store.openMember(org.id, target);
        if (!member || member.status !== "ACTIVE") throw notFound("Member");
        assertManages(actor, [member.role]);
        const removed = await endMembership(rt, member, "REMOVED", caller, now);
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "removeOrgMember",
          at: now,
          details: { address: target, role: member.role },
          event: { type: "member.removed", data: { address: target, role: member.role } },
          notify: [{ to: [target], kind: "REMOVED", payload: { orgId: org.id } }],
        });
        return oneMember(rt, removed);
      });
    },
    setOrgMemberRole: async (_: unknown, args: OrgArgs & { orgId: string; address: string; role: OrgRole }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "setOrgMemberRole", args);
      if (args.role === "OWNER") throw badInput("role", "Owners are added and removed through proposals");
      const target = addressArg("address", args.address);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        const actor = await requireRole(store, org.id, caller, "ADMIN");
        const member = await store.openMember(org.id, target);
        if (!member) throw notFound("Member");
        assertManages(actor, [member.role, args.role]);
        if (member.role === args.role) return oneMember(rt, member);
        // Only the role: the stored scope stays explicit (owners and admins get every app on read).
        const updated = await store.updateMember(member.id, { role: args.role, updatedAt: now });
        if (!updated) throw unavailable();
        await writeDocument(rt, "setOrgMemberRole", org.id, [orgActions.setMemberRole({ id: member.id, role: args.role, at: iso(now) })], () =>
          store.updateMember(member.id, restoreOf(member)),
        );
        const data = { address: target, from: member.role, to: args.role };
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "setOrgMemberRole",
          at: now,
          details: data,
          event: { type: "member.role_changed", data },
          notify: [{ to: [target], kind: "ROLE_CHANGED", payload: { from: member.role, to: args.role } }],
        });
        return oneMember(rt, updated);
      });
    },
    setOrgMemberAppScope: async (
      _: unknown,
      args: OrgArgs & { orgId: string; address: string; appScope: { all: boolean; appDids: string[] } },
      ctx: OrgContext,
    ) => {
      const caller = await rt.writer(ctx, "setOrgMemberAppScope", args);
      const target = addressArg("address", args.address);
      const appDids = [...new Set(args.appScope.appDids.map((did) => did.trim()))];
      if (appDids.length > MAX_SCOPE_APPS || !appDids.every(isOrgAppDid)) {
        throw badInput("appScope", `appDids must be at most ${MAX_SCOPE_APPS} did:key app DIDs`);
      }
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        const actor = await requireRole(store, org.id, caller, "ADMIN");
        const member = await store.openMember(org.id, target);
        if (!member) throw notFound("Member");
        if (isAdminRole(member.role)) throw badInput("address", "Owners and admins always act for every app");
        assertManages(actor, [member.role]);
        const all = args.appScope.all;
        const updated = await store.updateMember(member.id, { appScopeAll: all, appDids, updatedAt: now });
        if (!updated) throw unavailable();
        await writeDocument(rt, "setOrgMemberAppScope", org.id, [orgActions.setMemberAppScope({ id: member.id, all, appDids, at: iso(now) })], () =>
          store.updateMember(member.id, restoreOf(member)),
        );
        const data = { address: target, appScope: { all, appDids } };
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "setOrgMemberAppScope",
          at: now,
          details: data,
          event: { type: "member.role_changed", data },
        });
        return oneMember(rt, updated);
      });
    },
    setMyOrgMembershipHidden: async (_: unknown, args: OrgArgs & { orgId: string; hidden: boolean }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "setMyOrgMembershipHidden", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        const member = await requireRole(store, org.id, caller, "MEMBER");
        const updated = await store.updateMember(member.id, { hidden: args.hidden, updatedAt: now });
        if (!updated) throw unavailable();
        await writeDocument(rt, "setMyOrgMembershipHidden", org.id, [orgActions.setMemberHidden({ id: member.id, hidden: args.hidden, at: iso(now) })], () =>
          store.updateMember(member.id, restoreOf(member)),
        );
        await rt.record({ orgId: org.id, actor: caller, action: "setMyOrgMembershipHidden", at: now, details: { hidden: args.hidden } });
        return oneMember(rt, updated);
      });
    },
  },
});
