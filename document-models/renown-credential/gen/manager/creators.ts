import { createAction } from "document-model";
import {
  z,
  type InitInput,
  type RevokeInput,
  type UpdateCredentialSubjectInput,
  type SetJwtInput,
  type SetCredentialStatusInput,
} from "../types.js";
import {
  type InitAction,
  type RevokeAction,
  type UpdateCredentialSubjectAction,
  type SetJwtAction,
  type SetCredentialStatusAction,
} from "./actions.js";

export const init = (input: InitInput) =>
  createAction<InitAction>(
    "INIT",
    { ...input },
    undefined,
    z.InitInputSchema,
    "global",
  );

export const revoke = (input: RevokeInput) =>
  createAction<RevokeAction>(
    "REVOKE",
    { ...input },
    undefined,
    z.RevokeInputSchema,
    "global",
  );

export const updateCredentialSubject = (input: UpdateCredentialSubjectInput) =>
  createAction<UpdateCredentialSubjectAction>(
    "UPDATE_CREDENTIAL_SUBJECT",
    { ...input },
    undefined,
    z.UpdateCredentialSubjectInputSchema,
    "global",
  );

export const setJwt = (input: SetJwtInput) =>
  createAction<SetJwtAction>(
    "SET_JWT",
    { ...input },
    undefined,
    z.SetJwtInputSchema,
    "global",
  );

export const setCredentialStatus = (input: SetCredentialStatusInput) =>
  createAction<SetCredentialStatusAction>(
    "SET_CREDENTIAL_STATUS",
    { ...input },
    undefined,
    z.SetCredentialStatusInputSchema,
    "global",
  );
