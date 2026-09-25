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
import { renownCredentialUpgradeManifest } from "../../upgrades/upgrade-manifest.js";
import {
  assertIsRenownCredentialDocument,
  assertIsRenownCredentialState,
  isRenownCredentialDocument,
  isRenownCredentialState,
} from "./document-schema.js";
import { renownCredentialDocumentType } from "./document-type.js";
import { reducer } from "./reducer.js";
import type {
  RenownCredentialGlobalState,
  RenownCredentialLocalState,
  RenownCredentialPHState,
} from "./types.js";

export const initialGlobalState: RenownCredentialGlobalState = {
  context: [],
  id: "",
  type: [],
  issuer: {
    id: "",
    ethereumAddress: "0x0000000000000000000000000000000000000000",
  },
  issuanceDate: "",
  expirationDate: null,
  credentialSubject: { id: null, app: "" },
  credentialStatus: null,
  credentialSchema: { id: "", type: "" },
  proof: {
    verificationMethod: "",
    ethereumAddress: "0x0000000000000000000000000000000000000000",
    created: "",
    proofPurpose: "",
    type: "",
    proofValue: "",
    eip712: {
      domain: { version: "", chainId: 0 },
      primaryType: "VerifiableCredential",
    },
  },
  revoked: false,
  revokedAt: null,
  revocationReason: null,
};
export const initialLocalState: RenownCredentialLocalState = {};

export const utils: DocumentModelUtils<RenownCredentialPHState> = {
  fileExtension: "phrc",
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
      renownCredentialDocumentType,
    );
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInputVersioned(input, {
      reducers: { 1: reducer as unknown as Reducer<PHBaseState> },
      upgradeManifest: renownCredentialUpgradeManifest,
    });
  },
  isStateOfType(state) {
    return isRenownCredentialState(state);
  },
  assertIsStateOfType(state) {
    return assertIsRenownCredentialState(state);
  },
  isDocumentOfType(document) {
    return isRenownCredentialDocument(document);
  },
  assertIsDocumentOfType(document) {
    return assertIsRenownCredentialDocument(document);
  },
};
