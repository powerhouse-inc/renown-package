/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { RenownOidcClientAction } from "./actions.js";
import type { RenownOidcClientState as RenownOidcClientGlobalState } from "./schema/types.js";

type RenownOidcClientLocalState = Record<PropertyKey, never>;

type RenownOidcClientPHState = PHBaseState & {
  global: RenownOidcClientGlobalState;
  local: RenownOidcClientLocalState;
};
type RenownOidcClientDocument = PHDocument<RenownOidcClientPHState>;

export * from "./schema/types.js";

export type {
  RenownOidcClientAction,
  RenownOidcClientDocument,
  RenownOidcClientGlobalState,
  RenownOidcClientLocalState,
  RenownOidcClientPHState,
};
