/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentModelUtils, PHBaseState, Reducer } from "document-model";
import {
  baseCreateDocument,
  baseLoadFromInputVersioned,
  baseSaveToFileHandle,
  createBaseState,
} from "document-model";
import { renownUserStatsUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsRenownUserStatsDocument,
  assertIsRenownUserStatsState,
  isRenownUserStatsDocument,
  isRenownUserStatsState,
} from "./document-schema.js";
import { renownUserStatsDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  RenownUserStatsGlobalState,
  RenownUserStatsLocalState,
  RenownUserStatsPHState,
} from "./types.js";

export const initialGlobalState: RenownUserStatsGlobalState = {
  userDid: null,
  stats: [],
};
export const initialLocalState: RenownUserStatsLocalState = {};

export const utils: DocumentModelUtils<RenownUserStatsPHState> = {
  fileExtension: "phus",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(
      utils.createState,
      state,
      renownUserStatsDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: renownUserStatsUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isRenownUserStatsState(state);
  },
  assertIsStateOfType(state) {
    return assertIsRenownUserStatsState(state);
  },
  isDocumentOfType(document) {
    return isRenownUserStatsDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsRenownUserStatsDocument(document);
  },
};
