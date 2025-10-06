import { createAction } from "document-model";
import {
  z,
  type SetUsernameInput,
  type SetEthAddressInput,
  type SetUserImageInput,
} from "../types.js";
import {
  type SetUsernameAction,
  type SetEthAddressAction,
  type SetUserImageAction,
} from "./actions.js";

export const setUsername = (input: SetUsernameInput) =>
  createAction<SetUsernameAction>(
    "SET_USERNAME",
    { ...input },
    undefined,
    z.SetUsernameInputSchema,
    "global",
  );

export const setEthAddress = (input: SetEthAddressInput) =>
  createAction<SetEthAddressAction>(
    "SET_ETH_ADDRESS",
    { ...input },
    undefined,
    z.SetEthAddressInputSchema,
    "global",
  );

export const setUserImage = (input: SetUserImageInput) =>
  createAction<SetUserImageAction>(
    "SET_USER_IMAGE",
    { ...input },
    undefined,
    z.SetUserImageInputSchema,
    "global",
  );
