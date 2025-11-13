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
    context: [],
    id: "",
    type: [],
    issuer: {
      id: "",
      ethereumAddress: "0x0000000000000000000000000000000000000000",
    },
    issuanceDate: "",
    expirationDate: null,
    credentialSubject: { id: null, app: "" },
    credentialStatus: null,
    credentialSchema: { id: "", type: "" },
    proof: {
      verificationMethod: "",
      ethereumAddress: "0x0000000000000000000000000000000000000000",
      created: "",
      proofPurpose: "",
      type: "",
      proofValue: "",
      eip712: {
        domain: { version: "", chainId: 0 },
        primaryType: "VerifiableCredential",
      },
    },
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
