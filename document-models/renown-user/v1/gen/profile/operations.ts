/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { type SignalDispatch } from "document-model";
import type { RenownUserGlobalState } from "../types.js";
import type {
  AddLinkAction,
  RemoveLinkAction,
  ReorderLinksAction,
  SetAvatarAction,
  SetBioAction,
  SetDisplayNameAction,
  SetEthAddressAction,
  SetHandleAction,
  SetUserImageAction,
  SetUsernameAction,
  UpdateLinkAction,
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
  setDisplayNameOperation: (
    state: RenownUserGlobalState,
    action: SetDisplayNameAction,
    dispatch?: SignalDispatch,
  ) => void;
  setHandleOperation: (
    state: RenownUserGlobalState,
    action: SetHandleAction,
    dispatch?: SignalDispatch,
  ) => void;
  setBioOperation: (
    state: RenownUserGlobalState,
    action: SetBioAction,
    dispatch?: SignalDispatch,
  ) => void;
  setAvatarOperation: (
    state: RenownUserGlobalState,
    action: SetAvatarAction,
    dispatch?: SignalDispatch,
  ) => void;
  addLinkOperation: (
    state: RenownUserGlobalState,
    action: AddLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  updateLinkOperation: (
    state: RenownUserGlobalState,
    action: UpdateLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  removeLinkOperation: (
    state: RenownUserGlobalState,
    action: RemoveLinkAction,
    dispatch?: SignalDispatch,
  ) => void;
  reorderLinksOperation: (
    state: RenownUserGlobalState,
    action: ReorderLinksAction,
    dispatch?: SignalDispatch,
  ) => void;
}
