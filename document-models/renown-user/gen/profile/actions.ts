import { type Action } from "document-model";
import type {
  SetUsernameInput,
  SetEthAddressInput,
  SetUserImageInput,
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

export type RenownUserProfileAction =
  | SetUsernameAction
  | SetEthAddressAction
  | SetUserImageAction;
