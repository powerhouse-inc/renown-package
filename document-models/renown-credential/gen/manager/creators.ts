import { createAction } from "document-model";
import { z, type InitInput, type RevokeInput } from "../types.js";
import { type InitAction, type RevokeAction } from "./actions.js";

export const init = (input: InitInput) =>
  createAction<InitAction>(
    "INIT",
    { ...input },
    undefined,
    z.InitInputSchema,
    "global",
  );

export const revoke = (input: RevokeInput) =>
  createAction<RevokeAction>(
    "REVOKE",
    { ...input },
    undefined,
    z.RevokeInputSchema,
    "global",
  );
