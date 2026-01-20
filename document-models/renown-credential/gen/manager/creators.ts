import { createAction } from "document-model/core";
import { InitInputSchema, RevokeInputSchema } from "../schema/zod.js";
import type { InitInput, RevokeInput } from "../types.js";
import type { InitAction, RevokeAction } from "./actions.js";

export const init = (input: InitInput) =>
  createAction<InitAction>(
    "INIT",
    { ...input },
    undefined,
    InitInputSchema,
    "global",
  );

export const revoke = (input: RevokeInput) =>
  createAction<RevokeAction>(
    "REVOKE",
    { ...input },
    undefined,
    RevokeInputSchema,
    "global",
  );
