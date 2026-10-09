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
import { renownAppProfileUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsRenownAppProfileDocument,
  assertIsRenownAppProfileState,
  isRenownAppProfileDocument,
  isRenownAppProfileState,
} from "./document-schema.js";
import { renownAppProfileDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  RenownAppProfileGlobalState,
  RenownAppProfileLocalState,
  RenownAppProfilePHState,
} from "./types.js";

export const initialGlobalState: RenownAppProfileGlobalState = {
  appDid: null,
  publisherDid: null,
  name: null,
  tagline: null,
  logo: null,
  website: null,
  description: null,
  category: null,
  logoRef: null,
  coverRef: null,
  links: [],
  metrics: [],
};
export const initialLocalState: RenownAppProfileLocalState = {};

export const utils: DocumentModelUtils<RenownAppProfilePHState> = {
  fileExtension: "phap",
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
      renownAppProfileDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: renownAppProfileUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isRenownAppProfileState(state);
  },
  assertIsStateOfType(state) {
    return assertIsRenownAppProfileState(state);
  },
  isDocumentOfType(document) {
    return isRenownAppProfileDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsRenownAppProfileDocument(document);
  },
};
