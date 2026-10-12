import {
  actions as orgActions,
  isOrgAppDid,
  isTeamName,
  isTeamSlug,
  MAX_SCOPE_APPS,
  MAX_TEAMS,
} from "../../../document-models/renown-organization/index.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, limitReached, notFound, unavailable } from "../core/errors.js";
import { teamOutput } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { TeamPatch, TeamRecord } from "../store/types.js";
import { addressArg, writeDocument } from "./members.js";

function slugArg(value: string): string {
  const slug = value.trim();
  if (!isTeamSlug(slug)) throw badInput("slug", "slug: 1-40 lowercase letters, digits and inner hyphens");
  return slug;
}

function nameArg(value: string): string {
  const name = value.trim();
  if (!isTeamName(name)) throw badInput("name", "name must be 1-64 characters");
  return name;
}

function appDidsArg(values: readonly string[]): string[] {
  const appDids = [...new Set(values.map((value) => value.trim()))];
  if (appDids.length > MAX_SCOPE_APPS || !appDids.every(isOrgAppDid)) {
    throw badInput("appDids", `appDids must be at most ${MAX_SCOPE_APPS} did:key app DIDs`);
  }
  return appDids;
}

async function output(rt: OrgRuntime, team: TeamRecord) {
  return teamOutput(team, await rt.store().members(team.orgId, ["ACTIVE"]));
}

/** The admin's team of `orgId` (call under the org lock), or NOT_FOUND / FORBIDDEN. */
async function adminTeam(rt: OrgRuntime, orgId: string, caller: string, teamId: string): Promise<TeamRecord> {
  const store = rt.store();
  await requireOrg(store, orgId);
  await requireRole(store, orgId, caller, "ADMIN");
  const team = await store.team(teamId);
  if (!team || team.orgId !== orgId) throw notFound("Team");
  return team;
}

/** Team writes are store-first, then the document; `undo` reverts the store when the document write fails. */
export const teamResolvers: Area = (rt) => ({
  Mutation: {
    createOrgTeam: async (
      _: unknown,
      args: OrgArgs & { orgId: string; slug: string; name: string; appDids?: string[] | null },
      ctx: OrgContext,
    ) => {
      const caller = await rt.writer(ctx, "createOrgTeam", args);
      const slug = slugArg(args.slug);
      const name = nameArg(args.name);
      const appDids = appDidsArg(args.appDids ?? []);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        const teams = await store.teams(args.orgId);
        if (teams.length >= MAX_TEAMS) throw limitReached(`An organization has at most ${MAX_TEAMS} teams`);
        if (teams.some((team) => team.slug === slug)) throw badInput("slug", `Another team has the slug ${slug}`);
        const team: TeamRecord = { id: rt.newId(), orgId: args.orgId, slug, name, appDids, memberIds: [], createdAt: now };
        await store.insertTeam(team);
        await writeDocument(rt, "createOrgTeam", args.orgId, [orgActions.addTeam({ id: team.id, slug, name, appDids })], () => store.deleteTeam(team.id));
        const data = { teamId: team.id, slug, change: "created" };
        await rt.record({ orgId: args.orgId, actor: caller, action: "createOrgTeam", at: now, details: { ...data, name, appDids }, event: { type: "team.changed", data } });
        return output(rt, team);
      });
    },
    updateOrgTeam: async (
      _: unknown,
      args: OrgArgs & { orgId: string; teamId: string; slug?: string | null; name?: string | null; appDids?: string[] | null },
      ctx: OrgContext,
    ) => {
      const caller = await rt.writer(ctx, "updateOrgTeam", args);
      const patch: TeamPatch = {
        ...(args.slug != null && { slug: slugArg(args.slug) }),
        ...(args.name != null && { name: nameArg(args.name) }),
        ...(args.appDids != null && { appDids: appDidsArg(args.appDids) }),
      };
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const team = await adminTeam(rt, args.orgId, caller, args.teamId);
        if (Object.keys(patch).length === 0) return output(rt, team);
        if (patch.slug && (await store.teams(args.orgId)).some((other) => other.id !== team.id && other.slug === patch.slug)) {
          throw badInput("slug", `Another team has the slug ${patch.slug}`);
        }
        const updated = await store.updateTeam(team.id, patch);
        if (!updated) throw unavailable();
        await writeDocument(rt, "updateOrgTeam", args.orgId, [orgActions.updateTeam({ id: team.id, ...patch })], () =>
          store.updateTeam(team.id, { slug: team.slug, name: team.name, appDids: team.appDids }),
        );
        const data = { teamId: team.id, slug: updated.slug, change: "updated" };
        await rt.record({ orgId: args.orgId, actor: caller, action: "updateOrgTeam", at: now, details: { ...data, fields: Object.keys(patch) }, event: { type: "team.changed", data } });
        return output(rt, updated);
      });
    },
    deleteOrgTeam: async (_: unknown, args: OrgArgs & { orgId: string; teamId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "deleteOrgTeam", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const team = await adminTeam(rt, args.orgId, caller, args.teamId);
        await store.deleteTeam(team.id);
        await writeDocument(rt, "deleteOrgTeam", args.orgId, [orgActions.removeTeam({ id: team.id })], () =>
          store.transaction(async (tx) => {
            await tx.insertTeam(team);
            await tx.setTeamMembers(team.id, team.memberIds);
          }),
        );
        const data = { teamId: team.id, slug: team.slug, change: "deleted" };
        await rt.record({ orgId: args.orgId, actor: caller, action: "deleteOrgTeam", at: now, details: data, event: { type: "team.changed", data } });
        return true;
      });
    },
    setOrgTeamMembers: async (_: unknown, args: OrgArgs & { orgId: string; teamId: string; addresses: string[] }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "setOrgTeamMembers", args);
      const addresses = [...new Set(args.addresses.map((address) => addressArg("addresses", address)))];
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const team = await adminTeam(rt, args.orgId, caller, args.teamId);
        const memberIds: string[] = [];
        for (const address of addresses) {
          const member = await store.openMember(args.orgId, address);
          if (!member || member.status !== "ACTIVE") throw badInput("addresses", `${address} is not an active member`);
          memberIds.push(member.id);
        }
        await store.setTeamMembers(team.id, memberIds);
        await writeDocument(rt, "setOrgTeamMembers", args.orgId, [orgActions.setTeamMembers({ id: team.id, memberIds })], () =>
          store.setTeamMembers(team.id, team.memberIds),
        );
        const data = { teamId: team.id, slug: team.slug, change: "members" };
        await rt.record({ orgId: args.orgId, actor: caller, action: "setOrgTeamMembers", at: now, details: { ...data, addresses }, event: { type: "team.changed", data } });
        return output(rt, { ...team, memberIds });
      });
    },
  },
});
