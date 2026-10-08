/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import {
  SetAppDidInputSchema,
  SetProfileInputSchema,
  SetPublisherDidInputSchema,
} from "../schema/zod.js";
import type {
  SetAppDidInput,
  SetProfileInput,
  SetPublisherDidInput,
} from "../types.js";
import type {
  SetAppDidAction,
  SetProfileAction,
  SetPublisherDidAction,
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
