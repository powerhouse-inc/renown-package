/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  ArchiveOrgInputSchema,
  InitOrganizationInputSchema,
  SetMembersPublicInputSchema,
  SetOrgHandleInputSchema,
  SetOrgListedInputSchema,
  SetOrgProfileInputSchema,
  SetTakenDownInputSchema,
} from "../schema/zod.js";
import type {
  ArchiveOrgInput,
  InitOrganizationInput,
  SetMembersPublicInput,
  SetOrgHandleInput,
  SetOrgListedInput,
  SetOrgProfileInput,
  SetTakenDownInput,
} from "../types.js";
import type {
  ArchiveOrgAction,
  InitOrganizationAction,
  SetMembersPublicAction,
  SetOrgHandleAction,
  SetOrgListedAction,
  SetOrgProfileAction,
  SetTakenDownAction,
} from "./actions.js";

export const initOrganization = (input: InitOrganizationInput) =>
  createAction<InitOrganizationAction>(
    "INIT_ORGANIZATION",
    { ...input },
    undefined,
    InitOrganizationInputSchema,
    "global",
  );

export const setOrgProfile = (input: SetOrgProfileInput) =>
  createAction<SetOrgProfileAction>(
    "SET_ORG_PROFILE",
    { ...input },
    undefined,
    SetOrgProfileInputSchema,
    "global",
  );

export const setOrgHandle = (input: SetOrgHandleInput) =>
  createAction<SetOrgHandleAction>(
    "SET_ORG_HANDLE",
    { ...input },
    undefined,
    SetOrgHandleInputSchema,
    "global",
  );

export const setOrgListed = (input: SetOrgListedInput) =>
  createAction<SetOrgListedAction>(
    "SET_ORG_LISTED",
    { ...input },
    undefined,
    SetOrgListedInputSchema,
    "global",
  );

export const setMembersPublic = (input: SetMembersPublicInput) =>
  createAction<SetMembersPublicAction>(
    "SET_MEMBERS_PUBLIC",
    { ...input },
    undefined,
    SetMembersPublicInputSchema,
    "global",
  );

export const archiveOrg = (input: ArchiveOrgInput) =>
  createAction<ArchiveOrgAction>(
    "ARCHIVE_ORG",
    { ...input },
    undefined,
    ArchiveOrgInputSchema,
    "global",
  );

export const setTakenDown = (input: SetTakenDownInput) =>
  createAction<SetTakenDownAction>(
    "SET_TAKEN_DOWN",
    { ...input },
    undefined,
    SetTakenDownInputSchema,
    "global",
  );
