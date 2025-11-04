import type { PHDocument, PHBaseState } from "document-model";
import type { RenownCredentialAction } from "./actions.js";
import type { RenownCredentialState as RenownCredentialGlobalState } from "./schema/types.js";

export { z } from "./schema/index.js";
export * from "./schema/types.js";
type RenownCredentialLocalState = Record<PropertyKey, never>;
type RenownCredentialPHState = PHBaseState & {
  global: RenownCredentialGlobalState;
  local: RenownCredentialLocalState;
};
type RenownCredentialDocument = PHDocument<RenownCredentialPHState>;

export type {
  RenownCredentialGlobalState,
  RenownCredentialLocalState,
  RenownCredentialPHState,
  RenownCredentialAction,
  RenownCredentialDocument,
};
