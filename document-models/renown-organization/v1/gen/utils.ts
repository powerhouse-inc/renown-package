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
import { renownOrganizationUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsRenownOrganizationDocument,
  assertIsRenownOrganizationState,
  isRenownOrganizationDocument,
  isRenownOrganizationState,
} from "./document-schema.js";
import { renownOrganizationDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  RenownOrganizationGlobalState,
  RenownOrganizationLocalState,
  RenownOrganizationPHState,
} from "./types.js";

export const initialGlobalState: RenownOrganizationGlobalState = {
  handle: null,
  name: null,
  bio: null,
  website: null,
  avatar: null,
  links: [],
  listed: false,
  membersPublic: false,
  archived: false,
  takenDown: false,
  createdBy: null,
  members: [],
  teams: [],
  apps: [],
  domains: [],
  suspendedCredentialIds: [],
};
export const initialLocalState: RenownOrganizationLocalState = {};

export const utils: DocumentModelUtils<RenownOrganizationPHState> = {
  fileExtension: "rorg",
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
      renownOrganizationDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: renownOrganizationUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isRenownOrganizationState(state);
  },
  assertIsStateOfType(state) {
    return assertIsRenownOrganizationState(state);
  },
  isDocumentOfType(document) {
    return isRenownOrganizationDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsRenownOrganizationDocument(document);
  },
};
