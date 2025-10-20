/**
 * Factory methods for creating RenownUserDocument instances
 */

import {
  createBaseState,
  defaultBaseState,
  type PHAuthState,
  type PHDocumentState,
  type PHBaseState,
} from "document-model";
import type {
  RenownUserDocument,
  RenownUserLocalState,
  RenownUserState,
} from "./types.js";
import { createDocument } from "./utils.js";

export type RenownUserPHState = PHBaseState & {
  global: RenownUserState;
  local: RenownUserLocalState;
};

export function defaultGlobalState(): RenownUserState {
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
  state?: Partial<RenownUserState>,
): RenownUserState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as RenownUserState;
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
  globalState?: Partial<RenownUserState>,
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
    global?: Partial<RenownUserState>;
    local?: Partial<RenownUserLocalState>;
  }>,
): RenownUserDocument {
  const document = createDocument(
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
