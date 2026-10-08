/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { PHBaseState, PHDocument } from "document-model";
import type { RenownUserStatsAction } from "./actions.js";
import type { RenownUserStatsState as RenownUserStatsGlobalState } from "./schema/types.js";

type RenownUserStatsLocalState = Record<PropertyKey, never>;

type RenownUserStatsPHState = PHBaseState & {
  global: RenownUserStatsGlobalState;
  local: RenownUserStatsLocalState;
};
type RenownUserStatsDocument = PHDocument<RenownUserStatsPHState>;

export * from "./schema/types.js";

export type {
  RenownUserStatsAction,
  RenownUserStatsDocument,
  RenownUserStatsGlobalState,
  RenownUserStatsLocalState,
  RenownUserStatsPHState,
};
