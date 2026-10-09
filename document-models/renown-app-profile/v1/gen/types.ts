/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { RenownAppProfileAction } from "./actions.js";
import type { RenownAppProfileState as RenownAppProfileGlobalState } from "./schema/types.js";

type RenownAppProfileLocalState = Record<PropertyKey, never>;

type RenownAppProfilePHState = PHBaseState & {
  global: RenownAppProfileGlobalState;
  local: RenownAppProfileLocalState;
};
type RenownAppProfileDocument = PHDocument<RenownAppProfilePHState>;

export * from "./schema/types.js";

export type {
  RenownAppProfileAction,
  RenownAppProfileDocument,
  RenownAppProfileGlobalState,
  RenownAppProfileLocalState,
  RenownAppProfilePHState,
};
