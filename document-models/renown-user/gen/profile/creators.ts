import { createAction } from "document-model/core";
import {
  SetUsernameInputSchema,
  SetEthAddressInputSchema,
  SetUserImageInputSchema,
} from "../schema/zod.js";
import type {
  SetUsernameInput,
  SetEthAddressInput,
  SetUserImageInput,
} from "../types.js";
import type {
  SetUsernameAction,
  SetEthAddressAction,
  SetUserImageAction,
} from "./actions.js";

export const setUsername = (input: SetUsernameInput) =>
  createAction<SetUsernameAction>(
    "SET_USERNAME",
    { ...input },
    undefined,
    SetUsernameInputSchema,
    "global",
  );

export const setEthAddress = (input: SetEthAddressInput) =>
  createAction<SetEthAddressAction>(
    "SET_ETH_ADDRESS",
    { ...input },
    undefined,
    SetEthAddressInputSchema,
    "global",
  );

export const setUserImage = (input: SetUserImageInput) =>
  createAction<SetUserImageAction>(
    "SET_USER_IMAGE",
    { ...input },
    undefined,
    SetUserImageInputSchema,
    "global",
  );
