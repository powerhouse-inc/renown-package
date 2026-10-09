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
import { renownUserUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsRenownUserDocument,
  assertIsRenownUserState,
  isRenownUserDocument,
  isRenownUserState,
} from "./document-schema.js";
import { renownUserDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  RenownUserGlobalState,
  RenownUserLocalState,
  RenownUserPHState,
} from "./types.js";

export const initialGlobalState: RenownUserGlobalState = {
  username: null,
  ethAddress: null,
  userImage: null,
};
export const initialLocalState: RenownUserLocalState = {};

export const utils: DocumentModelUtils<RenownUserPHState> = {
  fileExtension: "phru",
  createState(state) {
    return {
      ...createBaseState(state?.auth, { version: 1, ...state?.document }),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    return baseCreateDocument(utils.createState, state, renownUserDocumentType);
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: renownUserUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isRenownUserState(state);
  },
  assertIsStateOfType(state) {
    return assertIsRenownUserState(state);
  },
  isDocumentOfType(document) {
    return isRenownUserDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsRenownUserDocument(document);
  },
};
