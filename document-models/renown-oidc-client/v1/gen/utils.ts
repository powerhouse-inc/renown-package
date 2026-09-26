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
import { renownOidcClientUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsRenownOidcClientDocument,
  assertIsRenownOidcClientState,
  isRenownOidcClientDocument,
  isRenownOidcClientState,
} from "./document-schema.js";
import { renownOidcClientDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  RenownOidcClientGlobalState,
  RenownOidcClientLocalState,
  RenownOidcClientPHState,
} from "./types.js";

export const initialGlobalState: RenownOidcClientGlobalState = {
  name: null,
  redirectUris: [],
  allowedSubjects: [],
  allowAnySubject: false,
  clientSecretHash: null,
  status: "ACTIVE",
};
export const initialLocalState: RenownOidcClientLocalState = {};

export const utils: DocumentModelUtils<RenownOidcClientPHState> = {
  fileExtension: "phdm",
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
      renownOidcClientDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: renownOidcClientUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isRenownOidcClientState(state);
  },
  assertIsStateOfType(state) {
    return assertIsRenownOidcClientState(state);
  },
  isDocumentOfType(document) {
    return isRenownOidcClientDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsRenownOidcClientDocument(document);
  },
};
