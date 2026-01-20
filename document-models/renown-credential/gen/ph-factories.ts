/**
 * Factory methods for creating RenownCredentialDocument instances
 */
import type { PHAuthState, PHDocumentState, PHBaseState } from "document-model";
import { createBaseState, defaultBaseState } from "document-model/core";
import type {
  RenownCredentialDocument,
  RenownCredentialLocalState,
  RenownCredentialGlobalState,
  RenownCredentialPHState,
} from "./types.js";
import { createDocument } from "./utils.js";

export function defaultGlobalState(): RenownCredentialGlobalState {
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
  state?: Partial<RenownCredentialGlobalState>,
): RenownCredentialGlobalState {
  return {
    ...defaultGlobalState(),
    ...(state || {}),
  } as RenownCredentialGlobalState;
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
  globalState?: Partial<RenownCredentialGlobalState>,
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
    global?: Partial<RenownCredentialGlobalState>;
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
