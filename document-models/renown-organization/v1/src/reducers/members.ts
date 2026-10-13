import type {
  RenownOrganizationMembersOperations,
  RenownOrganizationState,
  RenownOrgMember,
  RenownOrgTeam,
} from "document-models/renown-organization/v1";
import {
  DuplicateMemberError,
  DuplicateTeamIdError,
  DuplicateTeamSlugError,
  InvalidAppDidError,
  InvalidStatusTransitionError,
  InvalidTeamError,
  LastOwnerError,
  MemberNotActiveError,
  MemberNotFoundError,
  TeamNotFoundError,
  TooManyMembersError,
  TooManyTeamsError,
} from "../../gen/members/error.js";
import {
  isOrgAppDid,
  isTeamName,
  isTeamSlug,
  MAX_ACTIVE_MEMBERS,
  MAX_SCOPE_APPS,
  MAX_TEAMS,
} from "../utils.js";

type Role = RenownOrgMember["role"];
type Status = RenownOrgMember["status"];

/** The only status changes a membership record may make. */
const NEXT_STATUS: Partial<Record<Status, readonly Status[]>> = {
  INVITED: ["ACTIVE", "DECLINED", "REVOKED"],
  ACTIVE: ["LEFT", "REMOVED"],
};

function isOpen(status: Status): boolean {
  return status === "INVITED" || status === "ACTIVE";
}

function memberById(state: RenownOrganizationState, id: string): RenownOrgMember {
  const member = state.members.find((m) => m.id === id);
  if (!member) throw new MemberNotFoundError(`No member with id ${id}`);
  return member;
}

function teamById(state: RenownOrganizationState, id: string): RenownOrgTeam {
  const team = state.teams.find((t) => t.id === id);
  if (!team) throw new TeamNotFoundError(`No team with id ${id}`);
  return team;
}

/** LastOwnerError when `next` would take the organization from one active owner to none. */
function assertKeepsAnOwner(
  state: RenownOrganizationState,
  member: RenownOrgMember,
  next: { role: Role; status: Status },
): void {
  const ownsNow = member.status === "ACTIVE" && member.role === "OWNER";
  const ownsAfter = next.status === "ACTIVE" && next.role === "OWNER";
  if (!ownsNow || ownsAfter) return;
  const owners = state.members.filter((m) => m.status === "ACTIVE" && m.role === "OWNER").length;
  if (owners <= 1) throw new LastOwnerError("The organization must keep at least one owner");
}

/** Deduplicated, validated app DIDs (at most MAX_SCOPE_APPS). */
function appDidList(appDids: readonly string[]): string[] {
  const unique = [...new Set(appDids)];
  for (const appDid of unique) {
    if (!isOrgAppDid(appDid)) throw new InvalidAppDidError(`Invalid app DID: ${appDid}`);
  }
  if (unique.length > MAX_SCOPE_APPS) throw new InvalidAppDidError(`At most ${MAX_SCOPE_APPS} app DIDs`);
  return unique;
}

export const renownOrganizationMembersOperations: RenownOrganizationMembersOperations = {
  inviteMemberOperation(state, action) {
    const { id, address, role, invitedAt } = action.input;
    const lower = address.toLowerCase();
    if (state.members.some((m) => m.id === id || (m.address === lower && isOpen(m.status)))) {
      throw new DuplicateMemberError(`${lower} already has an open membership, or the id ${id} is used`);
    }
    state.members.push({
      id,
      address: lower,
      role,
      status: "INVITED",
      appScope: { all: false, appDids: [] },
      hidden: false,
      joinedAt: null,
      updatedAt: invitedAt,
    });
  },
  setMemberStatusOperation(state, action) {
    const { id, status, at } = action.input;
    const member = memberById(state, id);
    if (!(NEXT_STATUS[member.status] ?? []).includes(status)) {
      throw new InvalidStatusTransitionError(`${member.status} cannot become ${status}`);
    }
    if (status === "ACTIVE" && state.members.filter((m) => m.status === "ACTIVE").length >= MAX_ACTIVE_MEMBERS) {
      throw new TooManyMembersError(`The organization already has ${MAX_ACTIVE_MEMBERS} active members`);
    }
    assertKeepsAnOwner(state, member, { role: member.role, status });
    member.status = status;
    member.updatedAt = at;
    if (status === "ACTIVE") {
      member.joinedAt = at;
      return;
    }
    for (const team of state.teams) team.memberIds = team.memberIds.filter((memberId) => memberId !== id);
  },
  setMemberRoleOperation(state, action) {
    const { id, role, at } = action.input;
    const member = memberById(state, id);
    if (!isOpen(member.status)) throw new MemberNotActiveError(`Member ${id} is ${member.status}`);
    assertKeepsAnOwner(state, member, { role, status: member.status });
    member.role = role;
    member.updatedAt = at;
  },
  setMemberAppScopeOperation(state, action) {
    const { id, all, appDids, at } = action.input;
    const member = memberById(state, id);
    if (!isOpen(member.status)) throw new MemberNotActiveError(`Member ${id} is ${member.status}`);
    member.appScope = { all, appDids: appDidList(appDids) };
    member.updatedAt = at;
  },
  setMemberHiddenOperation(state, action) {
    const member = memberById(state, action.input.id);
    if (!isOpen(member.status)) {
      throw new MemberNotActiveError(`Member ${member.id} is ${member.status}`);
    }
    member.hidden = action.input.hidden;
    member.updatedAt = action.input.at;
  },
  addTeamOperation(state, action) {
    const { id, slug, name, appDids } = action.input;
    if (state.teams.some((t) => t.id === id)) throw new DuplicateTeamIdError(`Team id ${id} is used`);
    if (state.teams.length >= MAX_TEAMS) throw new TooManyTeamsError(`An organization holds at most ${MAX_TEAMS} teams`);
    if (!isTeamSlug(slug) || !isTeamName(name)) throw new InvalidTeamError("Team slug or name is malformed");
    if (state.teams.some((t) => t.slug === slug)) throw new DuplicateTeamSlugError(`Another team has the slug ${slug}`);
    state.teams.push({ id, slug, name, appDids: appDidList(appDids), memberIds: [] });
  },
  updateTeamOperation(state, action) {
    const { id } = action.input;
    const team = teamById(state, id);
    const slug = action.input.slug ?? team.slug;
    const name = action.input.name ?? team.name;
    if (!isTeamSlug(slug) || !isTeamName(name)) throw new InvalidTeamError("Team slug or name is malformed");
    if (state.teams.some((t) => t.id !== id && t.slug === slug)) {
      throw new DuplicateTeamSlugError(`Another team has the slug ${slug}`);
    }
    const appDids = action.input.appDids ? appDidList(action.input.appDids) : team.appDids;
    team.slug = slug;
    team.name = name;
    team.appDids = appDids;
  },
  removeTeamOperation(state, action) {
    const index = state.teams.findIndex((t) => t.id === action.input.id);
    if (index === -1) throw new TeamNotFoundError(`No team with id ${action.input.id}`);
    state.teams.splice(index, 1);
  },
  setTeamMembersOperation(state, action) {
    const team = teamById(state, action.input.id);
    const memberIds = [...new Set(action.input.memberIds)];
    for (const memberId of memberIds) {
      if (memberById(state, memberId).status !== "ACTIVE") {
        throw new MemberNotActiveError(`Member ${memberId} is not active`);
      }
    }
    team.memberIds = memberIds;
  },
};
