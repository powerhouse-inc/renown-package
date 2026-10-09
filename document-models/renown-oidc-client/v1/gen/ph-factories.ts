/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating RenownOidcClientDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  RenownOidcClientDocument,
  RenownOidcClientGlobalState,
  RenownOidcClientLocalState,
  RenownOidcClientPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): RenownOidcClientGlobalState {
  return {
    name: null,
    redirectUris: [],
    allowedSubjects: [],
    allowAnySubject: false,
    clientSecretHash: null,
    status: "ACTIVE",
  };
}

export function defaultLocalState(): RenownOidcClientLocalState {
  return {};
}

export function defaultPHState(): RenownOidcClientPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<RenownOidcClientGlobalState>,
): RenownOidcClientGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<RenownOidcClientLocalState>,
): RenownOidcClientLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as RenownOidcClientLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<RenownOidcClientGlobalState>,
  localState?: Partial<RenownOidcClientLocalState>,
): RenownOidcClientPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a RenownOidcClientDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createRenownOidcClientDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<RenownOidcClientGlobalState>;
    local?: Partial<RenownOidcClientLocalState>;
  }>,
): RenownOidcClientDocument {
  const document = utils.createDocument(
    createState(
      createBaseState(state?.auth, { version: 1, ...state?.document }),
      state?.global,
      state?.local,
    ),
  );

  return document;
}
