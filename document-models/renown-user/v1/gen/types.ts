/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { RenownUserAction } from "./actions.js";
import type { RenownUserState as RenownUserGlobalState } from "./schema/types.js";

type RenownUserLocalState = Record<PropertyKey, never>;

type RenownUserPHState = PHBaseState & {
  global: RenownUserGlobalState;
  local: RenownUserLocalState;
};
type RenownUserDocument = PHDocument<RenownUserPHState>;

export * from "./schema/types.js";

export type {
  RenownUserAction,
  RenownUserDocument,
  RenownUserGlobalState,
  RenownUserLocalState,
  RenownUserPHState,
};
