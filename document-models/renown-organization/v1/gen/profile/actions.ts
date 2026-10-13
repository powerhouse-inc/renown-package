/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  ArchiveOrgInput,
  InitOrganizationInput,
  SetMembersPublicInput,
  SetOrgHandleInput,
  SetOrgListedInput,
  SetOrgProfileInput,
  SetTakenDownInput,
} from "../types.js";

export type InitOrganizationAction = Action & {
  type: "INIT_ORGANIZATION";
  input: InitOrganizationInput;
};
export type SetOrgProfileAction = Action & {
  type: "SET_ORG_PROFILE";
  input: SetOrgProfileInput;
};
export type SetOrgHandleAction = Action & {
  type: "SET_ORG_HANDLE";
  input: SetOrgHandleInput;
};
export type SetOrgListedAction = Action & {
  type: "SET_ORG_LISTED";
  input: SetOrgListedInput;
};
export type SetMembersPublicAction = Action & {
  type: "SET_MEMBERS_PUBLIC";
  input: SetMembersPublicInput;
};
export type ArchiveOrgAction = Action & {
  type: "ARCHIVE_ORG";
  input: ArchiveOrgInput;
};
export type SetTakenDownAction = Action & {
  type: "SET_TAKEN_DOWN";
  input: SetTakenDownInput;
};

export type RenownOrganizationProfileAction =
  | InitOrganizationAction
  | SetOrgProfileAction
  | SetOrgHandleAction
  | SetOrgListedAction
  | SetMembersPublicAction
  | ArchiveOrgAction
  | SetTakenDownAction;
