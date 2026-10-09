/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownCredentialGlobalState } from "../types.js";
import type { InitAction, RevokeAction } from "./actions.js";

export interface RenownCredentialManagerOperations {
  initOperation: (
    state: RenownCredentialGlobalState,
    action: InitAction,
    dispatch?: SignalDispatch,
  ) => void;
  revokeOperation: (
    state: RenownCredentialGlobalState,
    action: RevokeAction,
    dispatch?: SignalDispatch,
  ) => void;
}
