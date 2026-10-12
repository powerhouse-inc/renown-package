/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownOrganizationGlobalState } from "../types.js";
import type {
  AddTeamAction,
  InviteMemberAction,
  RemoveTeamAction,
  SetMemberAppScopeAction,
  SetMemberHiddenAction,
  SetMemberRoleAction,
  SetMemberStatusAction,
  SetTeamMembersAction,
  UpdateTeamAction,
} from "./actions.js";

export interface RenownOrganizationMembersOperations {
  inviteMemberOperation: (
    state: RenownOrganizationGlobalState,
    action: InviteMemberAction,
    dispatch?: SignalDispatch,
  ) => void;
  setMemberStatusOperation: (
    state: RenownOrganizationGlobalState,
    action: SetMemberStatusAction,
    dispatch?: SignalDispatch,
  ) => void;
  setMemberRoleOperation: (
    state: RenownOrganizationGlobalState,
    action: SetMemberRoleAction,
    dispatch?: SignalDispatch,
  ) => void;
  setMemberAppScopeOperation: (
    state: RenownOrganizationGlobalState,
    action: SetMemberAppScopeAction,
    dispatch?: SignalDispatch,
  ) => void;
  setMemberHiddenOperation: (
    state: RenownOrganizationGlobalState,
    action: SetMemberHiddenAction,
    dispatch?: SignalDispatch,
  ) => void;
  addTeamOperation: (
    state: RenownOrganizationGlobalState,
    action: AddTeamAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateTeamOperation: (
    state: RenownOrganizationGlobalState,
    action: UpdateTeamAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeTeamOperation: (
    state: RenownOrganizationGlobalState,
    action: RemoveTeamAction,
    dispatch?: SignalDispatch,
  ) => void;
  setTeamMembersOperation: (
    state: RenownOrganizationGlobalState,
    action: SetTeamMembersAction,
    dispatch?: SignalDispatch,
  ) => void;
}
