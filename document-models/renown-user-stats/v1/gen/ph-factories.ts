/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating RenownUserStatsDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  RenownUserStatsDocument,
  RenownUserStatsGlobalState,
  RenownUserStatsLocalState,
  RenownUserStatsPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): RenownUserStatsGlobalState {
  return {
    userDid: null,
    stats: [],
  };
}

export function defaultLocalState(): RenownUserStatsLocalState {
  return {};
}

export function defaultPHState(): RenownUserStatsPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<RenownUserStatsGlobalState>,
): RenownUserStatsGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<RenownUserStatsLocalState>,
): RenownUserStatsLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as RenownUserStatsLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<RenownUserStatsGlobalState>,
  localState?: Partial<RenownUserStatsLocalState>,
): RenownUserStatsPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a RenownUserStatsDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createRenownUserStatsDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<RenownUserStatsGlobalState>;
    local?: Partial<RenownUserStatsLocalState>;
  }>,
): RenownUserStatsDocument {
  const document = utils.createDocument(
    createState(
      createBaseState(state?.auth, { version: 1, ...state?.document }),
      state?.global,
      state?.local,
    ),
  );

  return document;
}
