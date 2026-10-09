/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type {
  AddLinkInput,
  RemoveLinkInput,
  ReorderLinksInput,
  SetAvatarInput,
  SetBioInput,
  SetDisplayNameInput,
  SetEthAddressInput,
  SetHandleInput,
  SetUserImageInput,
  SetUsernameInput,
  UpdateLinkInput,
} from "../types.js";

export type SetUsernameAction = Action & {
  type: "SET_USERNAME";
  input: SetUsernameInput;
};
export type SetEthAddressAction = Action & {
  type: "SET_ETH_ADDRESS";
  input: SetEthAddressInput;
};
export type SetUserImageAction = Action & {
  type: "SET_USER_IMAGE";
  input: SetUserImageInput;
};
export type SetDisplayNameAction = Action & {
  type: "SET_DISPLAY_NAME";
  input: SetDisplayNameInput;
};
export type SetHandleAction = Action & {
  type: "SET_HANDLE";
  input: SetHandleInput;
};
export type SetBioAction = Action & { type: "SET_BIO"; input: SetBioInput };
export type SetAvatarAction = Action & {
  type: "SET_AVATAR";
  input: SetAvatarInput;
};
export type AddLinkAction = Action & { type: "ADD_LINK"; input: AddLinkInput };
export type UpdateLinkAction = Action & {
  type: "UPDATE_LINK";
  input: UpdateLinkInput;
};
export type RemoveLinkAction = Action & {
  type: "REMOVE_LINK";
  input: RemoveLinkInput;
};
export type ReorderLinksAction = Action & {
  type: "REORDER_LINKS";
  input: ReorderLinksInput;
};

export type RenownUserProfileAction =
  | SetUsernameAction
  | SetEthAddressAction
  | SetUserImageAction
  | SetDisplayNameAction
  | SetHandleAction
  | SetBioAction
  | SetAvatarAction
  | AddLinkAction
  | UpdateLinkAction
  | RemoveLinkAction
  | ReorderLinksAction;
