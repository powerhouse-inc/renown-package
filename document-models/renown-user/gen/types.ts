import type { PHDocument, PHBaseState } from "document-model";
import type { RenownUserAction } from "./actions.js";
import type { RenownUserState as RenownUserGlobalState } from "./schema/types.js";

export { z } from "./schema/index.js";
export * from "./schema/types.js";
type RenownUserLocalState = Record<PropertyKey, never>;
type RenownUserPHState = PHBaseState & {
  global: RenownUserGlobalState;
  local: RenownUserLocalState;
};
type RenownUserDocument = PHDocument<RenownUserPHState>;

export type {
  RenownUserGlobalState,
  RenownUserLocalState,
  RenownUserPHState,
  RenownUserAction,
  RenownUserDocument,
};
