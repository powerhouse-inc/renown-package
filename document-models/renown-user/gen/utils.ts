import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseSaveToFileHandle,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model/core";
import type { RenownUserGlobalState, RenownUserLocalState } from "./types.js";
import type { RenownUserPHState } from "./types.js";
import { reducer } from "./reducer.js";
import { renownUserDocumentType } from "./document-type.js";
import {
  isRenownUserDocument,
  assertIsRenownUserDocument,
  isRenownUserState,
  assertIsRenownUserState,
} from "./document-schema.js";

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
      ...defaultBaseState(),
      global: { ...initialGlobalState, ...state?.global },
      local: { ...initialLocalState, ...state?.local },
    };
  },
  createDocument(state) {
    const document = baseCreateDocument(utils.createState, state);

    document.header.documentType = renownUserDocumentType;

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

export const createDocument = utils.createDocument;
export const createState = utils.createState;
export const saveToFileHandle = utils.saveToFileHandle;
export const loadFromInput = utils.loadFromInput;
export const isStateOfType = utils.isStateOfType;
export const assertIsStateOfType = utils.assertIsStateOfType;
export const isDocumentOfType = utils.isDocumentOfType;
export const assertIsDocumentOfType = utils.assertIsDocumentOfType;
