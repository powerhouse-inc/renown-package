/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  SuspendCredentialsInput,
  UnsuspendCredentialInput,
} from "../types.js";

export type SuspendCredentialsAction = Action & {
  type: "SUSPEND_CREDENTIALS";
  input: SuspendCredentialsInput;
};
export type UnsuspendCredentialAction = Action & {
  type: "UNSUSPEND_CREDENTIAL";
  input: UnsuspendCredentialInput;
};

export type RenownOrganizationSecurityAction =
  | SuspendCredentialsAction
  | UnsuspendCredentialAction;
