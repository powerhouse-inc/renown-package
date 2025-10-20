/**
 * Factory methods for creating RenownCredentialDocument instances
 */

import {
  createBaseState,
  defaultBaseState,
  type PHAuthState,
  type PHDocumentState,
  type PHBaseState,
} from "document-model";
import type {
  RenownCredentialDocument,
  RenownCredentialLocalState,
  RenownCredentialState,
} from "./types.js";
import { createDocument } from "./utils.js";

export type RenownCredentialPHState = PHBaseState & {
  global: RenownCredentialState;
  local: RenownCredentialLocalState;
};

export function defaultGlobalState(): RenownCredentialState {
  return {
    context: ["https://www.w3.org/2018/credentials/v1"],
    id: null,
    type: ["VerifiableCredential"],
    issuer: "",
    issuanceDate: "",
    credentialSubject: "{}",
    expirationDate: null,
    credentialStatus: null,
    jwt: null,
    revoked: false,
    revokedAt: null,
    revocationReason: null,
  };
}

export function defaultLocalState(): RenownCredentialLocalState {
  return {};
}

export function defaultPHState(): RenownCredentialPHState {
  return {
    ...defaultBaseState(),
    global: defaultGlobalState(),
    local: defaultLocalState(),
  };
}

export function createGlobalState(
  state?: Partial<RenownCredentialState>,
): RenownCredentialState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as RenownCredentialState;
}

export function createLocalState(
  state?: Partial<RenownCredentialLocalState>,
): RenownCredentialLocalState {
  return {
    ...defaultLocalState(),
    ...(state || {}),
  } as RenownCredentialLocalState;
}

export function createState(
  baseState?: Partial<PHBaseState>,
  globalState?: Partial<RenownCredentialState>,
  localState?: Partial<RenownCredentialLocalState>,
): RenownCredentialPHState {
  return {
    ...createBaseState(baseState?.auth, baseState?.document),
    global: createGlobalState(globalState),
    local: createLocalState(localState),
  };
}

/**
 * Creates a RenownCredentialDocument with custom global and local state
 * This properly handles the PHBaseState requirements while allowing
 * document-specific state to be set.
 */
export function createRenownCredentialDocument(
  state?: Partial<{
    auth?: Partial<PHAuthState>;
    document?: Partial<PHDocumentState>;
    global?: Partial<RenownCredentialState>;
    local?: Partial<RenownCredentialLocalState>;
  }>,
): RenownCredentialDocument {
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
