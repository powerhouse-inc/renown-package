import { type SignalDispatch } from "document-model";
import { type InitAction, type RevokeAction } from "./actions.js";
import { type RenownCredentialState } from "../types.js";

export interface RenownCredentialManagerOperations {
  initOperation: (
    state: RenownCredentialState,
    action: InitAction,
    dispatch?: SignalDispatch,
  ) => void;
  revokeOperation: (
    state: RenownCredentialState,
    action: RevokeAction,
    dispatch?: SignalDispatch,
  ) => void;
}
