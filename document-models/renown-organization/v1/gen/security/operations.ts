/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownOrganizationGlobalState } from "../types.js";
import type {
  SuspendCredentialsAction,
  UnsuspendCredentialAction,
} from "./actions.js";

export interface RenownOrganizationSecurityOperations {
  suspendCredentialsOperation: (
    state: RenownOrganizationGlobalState,
    action: SuspendCredentialsAction,
    dispatch?: SignalDispatch,
  ) => void;
  unsuspendCredentialOperation: (
    state: RenownOrganizationGlobalState,
    action: UnsuspendCredentialAction,
    dispatch?: SignalDispatch,
  ) => void;
}
