/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddTeamInput,
  InviteMemberInput,
  RemoveTeamInput,
  SetMemberAppScopeInput,
  SetMemberHiddenInput,
  SetMemberRoleInput,
  SetMemberStatusInput,
  SetTeamMembersInput,
  UpdateTeamInput,
} from "../types.js";

export type InviteMemberAction = Action & {
  type: "INVITE_MEMBER";
  input: InviteMemberInput;
};
export type SetMemberStatusAction = Action & {
  type: "SET_MEMBER_STATUS";
  input: SetMemberStatusInput;
};
export type SetMemberRoleAction = Action & {
  type: "SET_MEMBER_ROLE";
  input: SetMemberRoleInput;
};
export type SetMemberAppScopeAction = Action & {
  type: "SET_MEMBER_APP_SCOPE";
  input: SetMemberAppScopeInput;
};
export type SetMemberHiddenAction = Action & {
  type: "SET_MEMBER_HIDDEN";
  input: SetMemberHiddenInput;
};
export type AddTeamAction = Action & { type: "ADD_TEAM"; input: AddTeamInput };
export type UpdateTeamAction = Action & {
  type: "UPDATE_TEAM";
  input: UpdateTeamInput;
};
export type RemoveTeamAction = Action & {
  type: "REMOVE_TEAM";
  input: RemoveTeamInput;
};
export type SetTeamMembersAction = Action & {
  type: "SET_TEAM_MEMBERS";
  input: SetTeamMembersInput;
};

export type RenownOrganizationMembersAction =
  | InviteMemberAction
  | SetMemberStatusAction
  | SetMemberRoleAction
  | SetMemberAppScopeAction
  | SetMemberHiddenAction
  | AddTeamAction
  | UpdateTeamAction
  | RemoveTeamAction
  | SetTeamMembersAction;
