import type { PHDocument, PHBaseState } from "document-model";
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
  RenownUserGlobalState,
  RenownUserLocalState,
  RenownUserPHState,
  RenownUserAction,
  RenownUserDocument,
};
