/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { Action } from "document-model";
import type { SetStatInput, SetUserDidInput } from "../types.js";

export type SetUserDidAction = Action & {
  type: "SET_USER_DID";
  input: SetUserDidInput;
};
export type SetStatAction = Action & { type: "SET_STAT"; input: SetStatInput };

export type RenownUserStatsStatsAction = SetUserDidAction | SetStatAction;
