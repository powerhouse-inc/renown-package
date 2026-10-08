/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import { createAction } from "document-model";
import { SetStatInputSchema, SetUserDidInputSchema } from "../schema/zod.js";
import type { SetStatInput, SetUserDidInput } from "../types.js";
import type { SetStatAction, SetUserDidAction } from "./actions.js";

export const setUserDid = (input: SetUserDidInput) =>
  createAction<SetUserDidAction>(
    "SET_USER_DID",
    { ...input },
    undefined,
    SetUserDidInputSchema,
    "global",
  );

export const setStat = (input: SetStatInput) =>
  createAction<SetStatAction>(
    "SET_STAT",
    { ...input },
    undefined,
    SetStatInputSchema,
    "global",
  );
