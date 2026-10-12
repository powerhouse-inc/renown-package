/**
 * WARNING: DO NOT EDIT
 * This file is auto-generated and updated by codegen
 * Factory methods for creating RenownOrganizationDocument instances
 */
import type { PHAuthState, PHBaseState, PHDocumentState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model";
import type {
  RenownOrganizationDocument,
  RenownOrganizationGlobalState,
  RenownOrganizationLocalState,
  RenownOrganizationPHState,
} from "./types.js";
import { utils } from "./utils.js";

export function defaultGlobalState(): RenownOrganizationGlobalState {
  return {
    handle: null,
    name: null,
    bio: null,
    website: null,
    avatar: null,
    links: [],
    listed: false,
    membersPublic: false,
    archived: false,
    takenDown: false,
    createdBy: null,
    members: [],
    teams: [],
    apps: [],
    domains: [],
    suspendedCredentialIds: [],
  };
}

export function defaultLocalState(): RenownOrganizationLocalState {
  return {};
}

export function defaultPHState(): RenownOrganizationPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<RenownOrganizationGlobalState>,
): RenownOrganizationGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  };
}

export function createLocalState(
  state?: Partial<RenownOrganizationLocalState>,
): RenownOrganizationLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as RenownOrganizationLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<RenownOrganizationGlobalState>,
  localState?: Partial<RenownOrganizationLocalState>,
): RenownOrganizationPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a RenownOrganizationDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createRenownOrganizationDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<RenownOrganizationGlobalState>;
    local?: Partial<RenownOrganizationLocalState>;
  }>,
): RenownOrganizationDocument {
  const document = utils.createDocument(
    createState(
      createBaseState(state?.auth, { version: 1, ...state?.document }),
      state?.global,
      state?.local,
    ),
  );

  return document;
}
