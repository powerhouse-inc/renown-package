/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddLinkInputSchema,
  RemoveLinkInputSchema,
  ReorderLinksInputSchema,
  SetAvatarInputSchema,
  SetBioInputSchema,
  SetDisplayNameInputSchema,
  SetEthAddressInputSchema,
  SetHandleInputSchema,
  SetUserImageInputSchema,
  SetUsernameInputSchema,
  UpdateLinkInputSchema,
} from "../schema/zod.js";
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

export const setDisplayName = (input: SetDisplayNameInput) =>
  createAction<SetDisplayNameAction>(
    "SET_DISPLAY_NAME",
    { ...input },
    undefined,
    SetDisplayNameInputSchema,
    "global",
  );

export const setHandle = (input: SetHandleInput) =>
  createAction<SetHandleAction>(
    "SET_HANDLE",
    { ...input },
    undefined,
    SetHandleInputSchema,
    "global",
  );

export const setBio = (input: SetBioInput) =>
  createAction<SetBioAction>(
    "SET_BIO",
    { ...input },
    undefined,
    SetBioInputSchema,
    "global",
  );

export const setAvatar = (input: SetAvatarInput) =>
  createAction<SetAvatarAction>(
    "SET_AVATAR",
    { ...input },
    undefined,
    SetAvatarInputSchema,
    "global",
  );

export const addLink = (input: AddLinkInput) =>
  createAction<AddLinkAction>(
    "ADD_LINK",
    { ...input },
    undefined,
    AddLinkInputSchema,
    "global",
  );

export const updateLink = (input: UpdateLinkInput) =>
  createAction<UpdateLinkAction>(
    "UPDATE_LINK",
    { ...input },
    undefined,
    UpdateLinkInputSchema,
    "global",
  );

export const removeLink = (input: RemoveLinkInput) =>
  createAction<RemoveLinkAction>(
    "REMOVE_LINK",
    { ...input },
    undefined,
    RemoveLinkInputSchema,
    "global",
  );

export const reorderLinks = (input: ReorderLinksInput) =>
  createAction<ReorderLinksAction>(
    "REORDER_LINKS",
    { ...input },
    undefined,
    ReorderLinksInputSchema,
    "global",
  );
