/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddAllowedSubjectInputSchema,
  AddRedirectUriInputSchema,
  RemoveAllowedSubjectInputSchema,
  RemoveRedirectUriInputSchema,
  SetAllowAnySubjectInputSchema,
  SetClientInfoInputSchema,
  SetClientSecretHashInputSchema,
  SetStatusInputSchema,
} from "../schema/zod.js";
import type {
  AddAllowedSubjectInput,
  AddRedirectUriInput,
  RemoveAllowedSubjectInput,
  RemoveRedirectUriInput,
  SetAllowAnySubjectInput,
  SetClientInfoInput,
  SetClientSecretHashInput,
  SetStatusInput,
} from "../types.js";
import type {
  AddAllowedSubjectAction,
  AddRedirectUriAction,
  RemoveAllowedSubjectAction,
  RemoveRedirectUriAction,
  SetAllowAnySubjectAction,
  SetClientInfoAction,
  SetClientSecretHashAction,
  SetStatusAction,
} from "./actions.js";

export const setClientInfo = (input: SetClientInfoInput) =>
  createAction<SetClientInfoAction>(
    "SET_CLIENT_INFO",
    { ...input },
    undefined,
    SetClientInfoInputSchema,
    "global",
  );

export const addRedirectUri = (input: AddRedirectUriInput) =>
  createAction<AddRedirectUriAction>(
    "ADD_REDIRECT_URI",
    { ...input },
    undefined,
    AddRedirectUriInputSchema,
    "global",
  );

export const removeRedirectUri = (input: RemoveRedirectUriInput) =>
  createAction<RemoveRedirectUriAction>(
    "REMOVE_REDIRECT_URI",
    { ...input },
    undefined,
    RemoveRedirectUriInputSchema,
    "global",
  );

export const addAllowedSubject = (input: AddAllowedSubjectInput) =>
  createAction<AddAllowedSubjectAction>(
    "ADD_ALLOWED_SUBJECT",
    { ...input },
    undefined,
    AddAllowedSubjectInputSchema,
    "global",
  );

export const removeAllowedSubject = (input: RemoveAllowedSubjectInput) =>
  createAction<RemoveAllowedSubjectAction>(
    "REMOVE_ALLOWED_SUBJECT",
    { ...input },
    undefined,
    RemoveAllowedSubjectInputSchema,
    "global",
  );

export const setAllowAnySubject = (input: SetAllowAnySubjectInput) =>
  createAction<SetAllowAnySubjectAction>(
    "SET_ALLOW_ANY_SUBJECT",
    { ...input },
    undefined,
    SetAllowAnySubjectInputSchema,
    "global",
  );

export const setClientSecretHash = (input: SetClientSecretHashInput) =>
  createAction<SetClientSecretHashAction>(
    "SET_CLIENT_SECRET_HASH",
    { ...input },
    undefined,
    SetClientSecretHashInputSchema,
    "global",
  );

export const setStatus = (input: SetStatusInput) =>
  createAction<SetStatusAction>(
    "SET_STATUS",
    { ...input },
    undefined,
    SetStatusInputSchema,
    "global",
  );
