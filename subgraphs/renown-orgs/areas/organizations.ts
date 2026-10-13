import {
  actions as orgActions,
  isOrgAvatarRef,
  isOrgLinkLabel,
  isOrgLinkUrl,
  isOrgName,
  isOrgWebsite,
  MAX_ORG_BIO_LENGTH,
  MAX_ORG_LINKS,
  renownOrganizationDocumentType,
} from "../../../document-models/renown-organization/index.js";
import { avatarProblem } from "../../../media/avatar.js";
import { likePrefix } from "../../renown-read-model/search.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, limitReached, unavailable } from "../core/errors.js";
import { handleError, normalizeHandle, orgHandleProblem } from "../core/handles.js";
import { iso, isExpiredInvite, organizationOutput, type OrganizationOutput } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { MemberRecord, OrgLink, OrgPatch, OrgRecord, OrgSearch, OrgStore } from "../store/types.js";
import { writeDocument } from "./members.js";

export const MAX_ORGS_PER_CREATOR = 20;
export const MAX_MEMBERSHIPS_PER_WALLET = 50;
const SEARCH_MIN = 2;
const SEARCH_MAX = 40;
const SEARCH_DEFAULT_LIMIT = 20;
const SEARCH_MAX_LIMIT = 50;
const AUDIT_DEFAULT_LIMIT = 50;
const AUDIT_MAX_LIMIT = 100;
const NAME_RULE = "name must be 1-64 characters";

interface LinkInput {
  id: string;
  label: string;
  url: string;
}

interface ProfileArgs {
  name?: string | null;
  bio?: string | null;
  website?: string | null;
  avatar?: string | null;
  links?: LinkInput[] | null;
}

/** undefined = keep, null = clear, string = set (trimmed). */
export interface ProfilePatch {
  name?: string;
  bio?: string | null;
  website?: string | null;
  avatar?: string | null;
  links?: OrgLink[];
}

function clearable(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Validates profile arguments into a patch; BAD_USER_INPUT names the field. */
export function validateProfile(args: ProfileArgs): ProfilePatch {
  const patch: ProfilePatch = {};
  if (args.name != null) {
    const name = args.name.trim();
    if (!isOrgName(name)) throw badInput("name", NAME_RULE);
    patch.name = name;
  }
  const bio = clearable(args.bio);
  if (bio && bio.length > MAX_ORG_BIO_LENGTH) throw badInput("bio", `bio must be at most ${MAX_ORG_BIO_LENGTH} characters`);
  if (bio !== undefined) patch.bio = bio;
  const website = clearable(args.website);
  if (website && !isOrgWebsite(website)) throw badInput("website", "website must be an http(s) URL");
  if (website !== undefined) patch.website = website;
  const avatar = clearable(args.avatar);
  if (avatar && !isOrgAvatarRef(avatar)) throw badInput("avatar", "avatar must be an attachment://v1:<sha256> reference");
  if (avatar !== undefined) patch.avatar = avatar;
  if (args.links != null) {
    if (args.links.length > MAX_ORG_LINKS) throw badInput("links", `at most ${MAX_ORG_LINKS} links`);
    const ids = new Set<string>();
    patch.links = args.links.map((raw) => {
      const link = { id: raw.id.trim(), label: raw.label.trim(), url: raw.url.trim() };
      if (link.id === "" || ids.has(link.id)) throw badInput("links", "link ids must be unique and non-empty");
      ids.add(link.id);
      if (!isOrgLinkLabel(link.label) || !isOrgLinkUrl(link.url)) {
        throw badInput("links", "each link needs a 1-40 character label and an http(s) URL");
      }
      return link;
    });
  }
  return patch;
}

/** The SET_ORG_PROFILE input for a patch ("" clears in the reducer), or null when nothing changes. */
function profileAction(patch: ProfilePatch) {
  const input = {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.bio !== undefined && { bio: patch.bio ?? "" }),
    ...(patch.website !== undefined && { website: patch.website ?? "" }),
    ...(patch.avatar !== undefined && { avatar: patch.avatar ?? "" }),
    ...(patch.links !== undefined && { links: patch.links }),
  };
  return Object.keys(input).length > 0 ? orgActions.setOrgProfile(input) : null;
}

/** ACTIVE memberships and unexpired invites of an address. */
export async function openMemberships(store: OrgStore, address: string, now: Date): Promise<MemberRecord[]> {
  const open = await store.membershipsOf(address, ["INVITED", "ACTIVE"]);
  return open.filter((member) => !isExpiredInvite(member, now));
}

function parseSearch(args: { query?: string | null; limit?: number | null; after?: string | null }): OrgSearch {
  const query = (args.query ?? "").trim();
  let pattern: string | null = null;
  if (query !== "") {
    const length = Array.from(query).length;
    if (query.includes("\u0000") || length < SEARCH_MIN || length > SEARCH_MAX) {
      throw badInput("query", `query must be ${SEARCH_MIN}-${SEARCH_MAX} characters`);
    }
    pattern = likePrefix(query);
  }
  const limit = args.limit ?? SEARCH_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) {
    throw badInput("limit", `limit must be an integer from 1 to ${SEARCH_MAX_LIMIT}`);
  }
  if (args.after == null) return { pattern, limit };
  try {
    const cursor = JSON.parse(Buffer.from(args.after, "base64url").toString("utf8")) as { h?: unknown; i?: unknown };
    if (typeof cursor.h !== "string" || typeof cursor.i !== "string" || cursor.h.length > 30 || cursor.i.length > 255) {
      throw new Error("malformed cursor");
    }
    return { pattern, limit, after: { handle: cursor.h, id: cursor.i } };
  } catch {
    throw badInput("after", "after is not a cursor from organizationSearch");
  }
}

function auditCursor(raw: string): { at: Date; id: string } {
  try {
    const cursor = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { a?: unknown; i?: unknown };
    const at = typeof cursor.a === "string" ? new Date(cursor.a) : new Date(Number.NaN);
    if (Number.isNaN(at.getTime()) || typeof cursor.i !== "string") throw new Error("malformed cursor");
    return { at, id: cursor.i };
  } catch {
    throw badInput("after", "after is not a cursor from orgAuditLog");
  }
}

interface CreateArgs extends OrgArgs {
  handle: string;
  name: string;
  bio?: string | null;
  website?: string | null;
  links?: LinkInput[] | null;
  listed?: boolean | null;
  membersPublic?: boolean | null;
}

interface UpdateArgs extends OrgArgs {
  orgId: string;
  name?: string | null;
  bio?: string | null;
  website?: string | null;
  avatar?: string | null;
  links?: LinkInput[] | null;
  membersPublic?: boolean | null;
}

async function assertAvatar(rt: OrgRuntime, ref: string): Promise<void> {
  const backend = rt.media();
  if (!backend) throw unavailable("Avatar uploads are not available");
  let problem: string | null;
  try {
    problem = await avatarProblem(ref, backend);
  } catch {
    throw unavailable("Avatar storage is unavailable");
  }
  if (problem) throw badInput("avatar", `Invalid avatar: ${problem}`);
}

/**
 * The rows first (organization + owner in one transaction, so the handle is
 * never held by an ownerless organization), then the document; when the
 * document cannot be written the rows are deleted again and the caller gets
 * SERVICE_UNAVAILABLE. A created-but-unwritten document is left empty and
 * logged: no row points at it.
 */
async function createLocked(
  rt: OrgRuntime,
  caller: string,
  handle: string,
  name: string,
  profile: ProfilePatch,
  args: CreateArgs,
): Promise<OrganizationOutput> {
  const store = rt.store();
  const now = rt.now();
  const problem = await orgHandleProblem({ store, relationalDb: rt.deps.relationalDb, now }, handle);
  if (problem) throw handleError(problem, handle);
  let orgId: string;
  try {
    orgId = await rt.createDocument(renownOrganizationDocumentType);
  } catch (error) {
    console.error(`[renown-orgs] createOrganization: document create failed: ${reason(error)}`);
    throw unavailable();
  }
  const memberId = rt.newId();
  const org: OrgRecord = {
    id: orgId,
    handle,
    name,
    bio: profile.bio ?? null,
    website: profile.website ?? null,
    avatarRef: null,
    links: profile.links ?? [],
    listed: args.listed === true,
    membersPublic: args.membersPublic === true,
    archived: false,
    takenDown: false,
    createdBy: caller,
    createdAt: now,
    updatedAt: now,
  };
  const inserted = await store.insertOrganizationWithOwner(org, {
    id: memberId,
    orgId,
    address: caller,
    role: "OWNER",
    status: "ACTIVE",
    // Stored scope is never role-derived; ownScope gives owners every app.
    appScopeAll: false,
    appDids: [],
    hidden: false,
    invitedBy: caller,
    invitedAt: now,
    joinedAt: now,
    endedAt: null,
    updatedAt: now,
  });
  if (!inserted) {
    console.error(`[renown-orgs] createOrganization: handle ${handle} taken concurrently; document ${orgId} left empty`);
    throw handleError("TAKEN", handle);
  }
  const at = iso(now);
  const setProfile = profileAction(profile);
  try {
    await rt.execute(orgId, [
      orgActions.initOrganization({ handle, name, createdBy: caller }),
      ...(setProfile ? [setProfile] : []),
      ...(args.listed ? [orgActions.setOrgListed({ listed: true })] : []),
      ...(args.membersPublic ? [orgActions.setMembersPublic({ membersPublic: true })] : []),
      orgActions.inviteMember({ id: memberId, address: caller, role: "OWNER", invitedAt: at }),
      orgActions.setMemberStatus({ id: memberId, status: "ACTIVE", at }),
    ]);
  } catch (error) {
    console.error(`[renown-orgs] createOrganization: document ${orgId} write failed (${reason(error)}); rolling back`);
    try {
      await store.deleteOrganization(orgId);
    } catch (cleanup) {
      console.error(`[renown-orgs] createOrganization: rollback of ${orgId} failed: ${reason(cleanup)}`);
    }
    throw unavailable();
  }
  await rt.record({ orgId, actor: caller, action: "createOrganization", at: now, details: { handle, name } });
  return organizationOutput(rt, org, caller);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const organizationResolvers: Area = (rt) => ({
  Query: {
    organization: async (_: unknown, args: OrgArgs & { id?: string | null; handle?: string | null }, ctx: OrgContext) => {
      if ((args.id == null) === (args.handle == null)) throw badInput("id", "pass exactly one of id and handle");
      const viewer = await rt.viewer(ctx, "organization", args);
      const store = rt.store();
      const org = args.id != null ? await store.organization(args.id) : await store.organizationByHandle(normalizeHandle(args.handle ?? ""));
      return org ? organizationOutput(rt, org, viewer) : null;
    },
    organizationSearch: async (
      _: unknown,
      args: { query?: string | null; limit?: number | null; after?: string | null },
      ctx: OrgContext,
    ) => {
      rt.throttleRead(ctx);
      const search = parseSearch(args);
      const rows = await rt.store().searchOrganizations(search);
      const page = rows.slice(0, search.limit);
      const last = page.at(-1);
      const next =
        rows.length > search.limit && last
          ? Buffer.from(JSON.stringify({ h: last.handle.toLowerCase(), i: last.id })).toString("base64url")
          : null;
      return { items: await Promise.all(page.map((org) => organizationOutput(rt, org, null))), next };
    },
    orgHandleAvailability: async (_: unknown, args: { handle: string }, ctx: OrgContext) => {
      rt.throttleRead(ctx);
      const handle = normalizeHandle(args.handle);
      const reason = await orgHandleProblem({ store: rt.store(), relationalDb: rt.deps.relationalDb, now: rt.now() }, handle);
      return { handle, available: reason === null, reason };
    },
    orgAuditLog: async (_: unknown, args: OrgArgs & { orgId: string; limit?: number | null; after?: string | null }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgAuditLog", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      const limit = args.limit ?? AUDIT_DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_MAX_LIMIT) {
        throw badInput("limit", `limit must be an integer from 1 to ${AUDIT_MAX_LIMIT}`);
      }
      const rows = await store.auditPage(args.orgId, limit + 1, args.after != null ? auditCursor(args.after) : undefined);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map((entry) => ({ ...entry, at: iso(entry.at), details: JSON.stringify(entry.details) })),
        next:
          rows.length > limit && last
            ? Buffer.from(JSON.stringify({ a: iso(last.at), i: last.id })).toString("base64url")
            : null,
      };
    },
  },
  Mutation: {
    createOrganization: async (_: unknown, args: CreateArgs, ctx: OrgContext): Promise<OrganizationOutput> => {
      const caller = await rt.writer(ctx, "createOrganization", args);
      const store = rt.store();
      const handle = normalizeHandle(args.handle);
      const { name, ...profile } = validateProfile({ name: args.name, bio: args.bio, website: args.website, links: args.links });
      if (name === undefined) throw badInput("name", NAME_RULE);
      // Creator lock: concurrent creates cannot overshoot the per-wallet limits. Handle lock inside it.
      return rt.lock(`creator:${caller}`, async () => {
        if ((await store.countOrganizationsCreatedBy(caller)) >= MAX_ORGS_PER_CREATOR) {
          throw limitReached(`A wallet creates at most ${MAX_ORGS_PER_CREATOR} organizations`);
        }
        if ((await openMemberships(store, caller, rt.now())).length >= MAX_MEMBERSHIPS_PER_WALLET) {
          throw limitReached(`A wallet holds at most ${MAX_MEMBERSHIPS_PER_WALLET} memberships`);
        }
        return rt.lock(`handle:${handle}`, () => createLocked(rt, caller, handle, name, profile, args));
      });
    },
    updateOrganization: async (_: unknown, args: UpdateArgs, ctx: OrgContext): Promise<OrganizationOutput> => {
      const caller = await rt.writer(ctx, "updateOrganization", args);
      const patch = validateProfile(args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const before = await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        // Only after authorisation: the check reveals whether a media object exists.
        if (patch.avatar) await assertAvatar(rt, patch.avatar);
        const now = rt.now();
        const setProfile = profileAction(patch);
        const membersPublic = args.membersPublic ?? undefined;
        const changes: OrgPatch = {
          ...(patch.name !== undefined && { name: patch.name }),
          ...(patch.bio !== undefined && { bio: patch.bio }),
          ...(patch.website !== undefined && { website: patch.website }),
          ...(patch.avatar !== undefined && { avatarRef: patch.avatar }),
          ...(patch.links !== undefined && { links: patch.links }),
          ...(membersPublic !== undefined && { membersPublic }),
        };
        // Store first, then the document; a failed document write undoes the store.
        const org = await store.updateOrganization(args.orgId, changes, now);
        if (!org) throw unavailable();
        const restore: OrgPatch = {
          ...(changes.name !== undefined && { name: before.name }),
          ...(changes.bio !== undefined && { bio: before.bio }),
          ...(changes.website !== undefined && { website: before.website }),
          ...(changes.avatarRef !== undefined && { avatarRef: before.avatarRef }),
          ...(changes.links !== undefined && { links: before.links }),
          ...(changes.membersPublic !== undefined && { membersPublic: before.membersPublic }),
        };
        await writeDocument(
          rt,
          "updateOrganization",
          args.orgId,
          [...(setProfile ? [setProfile] : []), ...(membersPublic !== undefined ? [orgActions.setMembersPublic({ membersPublic })] : [])],
          () => store.updateOrganization(args.orgId, restore, before.updatedAt),
        );
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "updateOrganization",
          at: now,
          details: { fields: Object.keys(changes) },
          event: { type: "org.updated", data: { fields: Object.keys(changes) } },
        });
        return organizationOutput(rt, org, caller);
      });
    },
    setOrgListed: async (_: unknown, args: OrgArgs & { orgId: string; listed: boolean }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "setOrgListed", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const before = await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        const now = rt.now();
        // Store first, then the document; a failed document write undoes the store.
        const org = await store.updateOrganization(args.orgId, { listed: args.listed }, now);
        if (!org) throw unavailable();
        await writeDocument(rt, "setOrgListed", args.orgId, [orgActions.setOrgListed({ listed: args.listed })], () =>
          store.updateOrganization(args.orgId, { listed: before.listed }, before.updatedAt),
        );
        await rt.record({
          orgId: org.id,
          actor: caller,
          action: "setOrgListed",
          at: now,
          details: { listed: args.listed },
          event: { type: "org.updated", data: { fields: ["listed"] } },
        });
        return organizationOutput(rt, org, caller);
      });
    },
  },
});
