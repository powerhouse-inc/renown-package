/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  SuspendCredentialsInputSchema,
  UnsuspendCredentialInputSchema,
} from "../schema/zod.js";
import type {
  SuspendCredentialsInput,
  UnsuspendCredentialInput,
} from "../types.js";
import type {
  SuspendCredentialsAction,
  UnsuspendCredentialAction,
} from "./actions.js";

export const suspendCredentials = (input: SuspendCredentialsInput) =>
  createAction<SuspendCredentialsAction>(
    "SUSPEND_CREDENTIALS",
    { ...input },
    undefined,
    SuspendCredentialsInputSchema,
    "global",
  );

export const unsuspendCredential = (input: UnsuspendCredentialInput) =>
  createAction<UnsuspendCredentialAction>(
    "UNSUSPEND_CREDENTIAL",
    { ...input },
    undefined,
    UnsuspendCredentialInputSchema,
    "global",
  );
