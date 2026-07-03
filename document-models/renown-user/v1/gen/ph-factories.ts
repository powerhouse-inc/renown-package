/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating RenownUserDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  RenownUserDocument,
  RenownUserGlobalState,
  RenownUserLocalState,
  RenownUserPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): RenownUserGlobalState {
  return {
    username: null,
    ethAddress: null,
    userImage: null,
  };
}

export function defaultLocalState(): RenownUserLocalState {
  return {};
}

export function defaultPHState(): RenownUserPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<RenownUserGlobalState>,
): RenownUserGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<RenownUserLocalState>,
): RenownUserLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as RenownUserLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<RenownUserGlobalState>,
  localState?: Partial<RenownUserLocalState>,
): RenownUserPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a RenownUserDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createRenownUserDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<RenownUserGlobalState>;
    local?: Partial<RenownUserLocalState>;
  }>,
): RenownUserDocument {
  const document = utils.createDocument(
    state
      ? createState(
          createBaseState(state.auth, state.document),
          state.global,
          state.local,
        )
      : undefined,
  );

  return document;
}
