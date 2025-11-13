import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type {
  RenownCredentialGlobalState,
  RenownCredentialLocalState,
} from "./types.js";
import type { RenownCredentialPHState } from "./types.js";
import { reducer } from "./reducer.js";

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

const utils: DocumentModelUtils<RenownCredentialPHState> = {
  fileExtension: "phrc",
  createState(state) {
    return {
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = "powerhouse/renown-credential";

    // for backwards compatibility, but this is NOT a valid signed document id
    document.header.id = generateId();

    return document;
  },
  saveToFileHandle(document, input) {
    return baseSaveToFileHandle(document, input);
  },
  loadFromInput(input) {
    return baseLoadFromInput(input, reducer);
  },
};

export const createDocument = utils.createDocument;
export const createState = utils.createState;
export const saveToFileHandle = utils.saveToFileHandle;
export const loadFromInput = utils.loadFromInput;

export default utils;
