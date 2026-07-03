/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 */
import type { DocumentModelUtils } from "document-model";
import {
  baseCreateDocument,
  baseLoadFromInput,
  baseSaveToFileHandle,
  defaultBaseState,
  generateId,
} from "document-model";
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
