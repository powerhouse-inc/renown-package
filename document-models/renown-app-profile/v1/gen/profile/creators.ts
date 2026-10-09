/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  AddLinkInputSchema,
  RemoveLinkInputSchema,
  ReorderLinksInputSchema,
  SetAppDidInputSchema,
  SetProfileInputSchema,
  SetPublisherDidInputSchema,
  UpdateLinkInputSchema,
} from "../schema/zod.js";
import type {
  AddLinkInput,
  RemoveLinkInput,
  ReorderLinksInput,
  SetAppDidInput,
  SetProfileInput,
  SetPublisherDidInput,
  UpdateLinkInput,
} from "../types.js";
import type {
  AddLinkAction,
  RemoveLinkAction,
  ReorderLinksAction,
  SetAppDidAction,
  SetProfileAction,
  SetPublisherDidAction,
  UpdateLinkAction,
} from "./actions.js";

export const setAppDid = (input: SetAppDidInput) =>
  createAction<SetAppDidAction>(
    "SET_APP_DID",
    { ...input },
    undefined,
    SetAppDidInputSchema,
    "global",
  );

export const setPublisherDid = (input: SetPublisherDidInput) =>
  createAction<SetPublisherDidAction>(
    "SET_PUBLISHER_DID",
    { ...input },
    undefined,
    SetPublisherDidInputSchema,
    "global",
  );

export const setProfile = (input: SetProfileInput) =>
  createAction<SetProfileAction>(
    "SET_PROFILE",
    { ...input },
    undefined,
    SetProfileInputSchema,
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
