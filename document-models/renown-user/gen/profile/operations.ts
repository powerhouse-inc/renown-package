import { type SignalDispatch } from "document-model";
import type {
  SetUsernameAction,
  SetEthAddressAction,
  SetUserImageAction,
} from "./actions.js";
import type { RenownUserState } from "../types.js";

export interface RenownUserProfileOperations {
  setUsernameOperation: (
    state: RenownUserState,
    action: SetUsernameAction,
    dispatch?: SignalDispatch,
  ) => void;
  setEthAddressOperation: (
    state: RenownUserState,
    action: SetEthAddressAction,
    dispatch?: SignalDispatch,
  ) => void;
  setUserImageOperation: (
    state: RenownUserState,
    action: SetUserImageAction,
    dispatch?: SignalDispatch,
  ) => void;
}
