/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { RenownOrganizationAction } from "./actions.js";
import type { RenownOrganizationState as RenownOrganizationGlobalState } from "./schema/types.js";

type RenownOrganizationLocalState = Record<PropertyKey, never>;

type RenownOrganizationPHState = PHBaseState & {
  global: RenownOrganizationGlobalState;
  local: RenownOrganizationLocalState;
};
type RenownOrganizationDocument = PHDocument<RenownOrganizationPHState>;

export * from "./schema/types.js";

export type {
  RenownOrganizationAction,
  RenownOrganizationDocument,
  RenownOrganizationGlobalState,
  RenownOrganizationLocalState,
  RenownOrganizationPHState,
};
