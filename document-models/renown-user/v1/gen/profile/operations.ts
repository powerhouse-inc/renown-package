/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownUserGlobalState } from "../types.js";
import type {
  SetEthAddressAction,
  SetUserImageAction,
  SetUsernameAction,
} from "./actions.js";

export interface RenownUserProfileOperations {
  setUsernameOperation: (
    state: RenownUserGlobalState,
    action: SetUsernameAction,
    dispatch?: SignalDispatch,
  ) => void;
  setEthAddressOperation: (
    state: RenownUserGlobalState,
    action: SetEthAddressAction,
    dispatch?: SignalDispatch,
  ) => void;
  setUserImageOperation: (
    state: RenownUserGlobalState,
    action: SetUserImageAction,
    dispatch?: SignalDispatch,
  ) => void;
}
