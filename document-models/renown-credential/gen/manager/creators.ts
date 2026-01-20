import { createAction } from "document-model/core";
import {
  InitInputSchema,
  RevokeInputSchema,
  UpdateCredentialSubjectInputSchema,
  SetJwtInputSchema,
  SetCredentialStatusInputSchema,
} from "../schema/zod.js";
import type {
  InitInput,
  RevokeInput,
  UpdateCredentialSubjectInput,
  SetJwtInput,
  SetCredentialStatusInput,
} from "../types.js";
import type {
  InitAction,
  RevokeAction,
  UpdateCredentialSubjectAction,
  SetJwtAction,
  SetCredentialStatusAction,
} from "./actions.js";

export const init = (input: InitInput) =>
  createAction<InitAction>(
    "INIT",
    { ...input },
    undefined,
    InitInputSchema,
    "global",
  );

export const revoke = (input: RevokeInput) =>
  createAction<RevokeAction>(
    "REVOKE",
    { ...input },
    undefined,
    RevokeInputSchema,
    "global",
  );

export const updateCredentialSubject = (input: UpdateCredentialSubjectInput) =>
  createAction<UpdateCredentialSubjectAction>(
    "UPDATE_CREDENTIAL_SUBJECT",
    { ...input },
    undefined,
    UpdateCredentialSubjectInputSchema,
    "global",
  );

export const setJwt = (input: SetJwtInput) =>
  createAction<SetJwtAction>(
    "SET_JWT",
    { ...input },
    undefined,
    SetJwtInputSchema,
    "global",
  );

export const setCredentialStatus = (input: SetCredentialStatusInput) =>
  createAction<SetCredentialStatusAction>(
    "SET_CREDENTIAL_STATUS",
    { ...input },
    undefined,
    SetCredentialStatusInputSchema,
    "global",
  );
