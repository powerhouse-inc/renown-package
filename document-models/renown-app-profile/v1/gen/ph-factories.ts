/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating RenownAppProfileDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  RenownAppProfileDocument,
  RenownAppProfileGlobalState,
  RenownAppProfileLocalState,
  RenownAppProfilePHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): RenownAppProfileGlobalState {
  return {
    appDid: null,
    publisherDid: null,
    name: null,
    tagline: null,
    logo: null,
    website: null,
    description: null,
    category: null,
    logoRef: null,
    coverRef: null,
    links: [],
  };
}

export function defaultLocalState(): RenownAppProfileLocalState {
  return {};
}

export function defaultPHState(): RenownAppProfilePHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<RenownAppProfileGlobalState>,
): RenownAppProfileGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<RenownAppProfileLocalState>,
): RenownAppProfileLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as RenownAppProfileLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<RenownAppProfileGlobalState>,
  localState?: Partial<RenownAppProfileLocalState>,
): RenownAppProfilePHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a RenownAppProfileDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createRenownAppProfileDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<RenownAppProfileGlobalState>;
    local?: Partial<RenownAppProfileLocalState>;
  }>,
): RenownAppProfileDocument {
  const document = utils.createDocument(
    createState(
      createBaseState(state?.auth, { version: 1, ...state?.document }),
      state?.global,
      state?.local,
    ),
  );

  return document;
}
