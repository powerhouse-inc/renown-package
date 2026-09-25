/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { RenownCredentialAction } from "./actions.js";
import type { RenownCredentialState as RenownCredentialGlobalState } from "./schema/types.js";

type RenownCredentialLocalState = Record<PropertyKey, never>;

type RenownCredentialPHState = PHBaseState & {
  global: RenownCredentialGlobalState;
  local: RenownCredentialLocalState;
};
type RenownCredentialDocument = PHDocument<RenownCredentialPHState>;

export * from "./schema/types.js";

export type {
  RenownCredentialAction,
  RenownCredentialDocument,
  RenownCredentialGlobalState,
  RenownCredentialLocalState,
  RenownCredentialPHState,
};
