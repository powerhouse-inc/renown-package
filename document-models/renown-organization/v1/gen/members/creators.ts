/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddTeamInputSchema,
  InviteMemberInputSchema,
  RemoveTeamInputSchema,
  SetMemberAppScopeInputSchema,
  SetMemberHiddenInputSchema,
  SetMemberRoleInputSchema,
  SetMemberStatusInputSchema,
  SetTeamMembersInputSchema,
  UpdateTeamInputSchema,
} from "../schema/zod.js";
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

export const inviteMember = (input: InviteMemberInput) =>
  createAction<InviteMemberAction>(
    "INVITE_MEMBER",
    { ...input },
    undefined,
    InviteMemberInputSchema,
    "global",
  );

export const setMemberStatus = (input: SetMemberStatusInput) =>
  createAction<SetMemberStatusAction>(
    "SET_MEMBER_STATUS",
    { ...input },
    undefined,
    SetMemberStatusInputSchema,
    "global",
  );

export const setMemberRole = (input: SetMemberRoleInput) =>
  createAction<SetMemberRoleAction>(
    "SET_MEMBER_ROLE",
    { ...input },
    undefined,
    SetMemberRoleInputSchema,
    "global",
  );

export const setMemberAppScope = (input: SetMemberAppScopeInput) =>
  createAction<SetMemberAppScopeAction>(
    "SET_MEMBER_APP_SCOPE",
    { ...input },
    undefined,
    SetMemberAppScopeInputSchema,
    "global",
  );

export const setMemberHidden = (input: SetMemberHiddenInput) =>
  createAction<SetMemberHiddenAction>(
    "SET_MEMBER_HIDDEN",
    { ...input },
    undefined,
    SetMemberHiddenInputSchema,
    "global",
  );

export const addTeam = (input: AddTeamInput) =>
  createAction<AddTeamAction>(
    "ADD_TEAM",
    { ...input },
    undefined,
    AddTeamInputSchema,
    "global",
  );

export const updateTeam = (input: UpdateTeamInput) =>
  createAction<UpdateTeamAction>(
    "UPDATE_TEAM",
    { ...input },
    undefined,
    UpdateTeamInputSchema,
    "global",
  );

export const removeTeam = (input: RemoveTeamInput) =>
  createAction<RemoveTeamAction>(
    "REMOVE_TEAM",
    { ...input },
    undefined,
    RemoveTeamInputSchema,
    "global",
  );

export const setTeamMembers = (input: SetTeamMembersInput) =>
  createAction<SetTeamMembersAction>(
    "SET_TEAM_MEMBERS",
    { ...input },
    undefined,
    SetTeamMembersInputSchema,
    "global",
  );
