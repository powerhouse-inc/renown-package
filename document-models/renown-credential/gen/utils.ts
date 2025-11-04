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
  vcPayload: null,
  context: null,
  id: null,
  type: null,
  issuer: null,
  issuanceDate: null,
  credentialSubject: null,
  expirationDate: null,
  credentialStatus: null,
  jwt: null,
  jwtVerified: false,
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
