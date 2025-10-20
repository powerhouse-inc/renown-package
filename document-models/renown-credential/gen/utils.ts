import {
  type CreateDocument,
  type CreateState,
  type LoadFromFile,
  type LoadFromInput,
  baseCreateDocument,
  baseSaveToFile,
  baseSaveToFileHandle,
  baseLoadFromFile,
  baseLoadFromInput,
  defaultBaseState,
  generateId,
} from "document-model";
import {
  type RenownCredentialState,
  type RenownCredentialLocalState,
} from "./types.js";
import { type RenownCredentialPHState } from "./ph-factories.js";
import { reducer } from "./reducer.js";

export const initialGlobalState: RenownCredentialState = {
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
  jwtVerificationError: null,
  jwtPayload: null,
  revoked: false,
  revokedAt: null,
  revocationReason: null,
};
export const initialLocalState: RenownCredentialLocalState = {};

export const createState: CreateState<RenownCredentialPHState> = (state) => {
  return {
    ...defaultBaseState(),
    global: { ...initialGlobalState, ...(state?.global ?? {}) },
    local: { ...initialLocalState, ...(state?.local ?? {}) },
  };
};

export const createDocument: CreateDocument<RenownCredentialPHState> = (
  state,
) => {
  const document = baseCreateDocument(createState, state);
  document.header.documentType = "powerhouse/renown-credential";
  // for backwards compatibility, but this is NOT a valid signed document id
  document.header.id = generateId();
  return document;
};

export const saveToFile = (document: any, path: string, name?: string) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return baseSaveToFile(document, path, "phrc", name);
};

export const saveToFileHandle = (document: any, input: any) => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  return baseSaveToFileHandle(document, input);
};

export const loadFromFile: LoadFromFile<RenownCredentialPHState> = (path) => {
  return baseLoadFromFile(path, reducer);
};

export const loadFromInput: LoadFromInput<RenownCredentialPHState> = (
  input,
) => {
  return baseLoadFromInput(input, reducer);
};

const utils = {
  fileExtension: "phrc",
  createState,
  createDocument,
  saveToFile,
  saveToFileHandle,
  loadFromFile,
  loadFromInput,
};

export default utils;
