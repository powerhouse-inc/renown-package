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

export const initialGlobalState: RenownUserGlobalState = {
  username: null,
  ethAddress: null,
  userImage: null,
};
export const initialLocalState: RenownUserLocalState = {};

const utils: DocumentModelUtils<RenownUserPHState> = {
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

    document.header.documentType = "powerhouse/renown-user";

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
