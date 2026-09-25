/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  SetEthAddressInputSchema,
  SetUserImageInputSchema,
  SetUsernameInputSchema,
} from "../schema/zod.js";
import type {
  SetEthAddressInput,
  SetUserImageInput,
  SetUsernameInput,
} from "../types.js";
import type {
  SetEthAddressAction,
  SetUserImageAction,
  SetUsernameAction,
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
