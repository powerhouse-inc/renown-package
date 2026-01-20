import {
  InvalidStatusPurposeError,
  MissingContextError,
  MissingTypeError,
  InvalidClaimsError,
  CredentialRevokedError,
  AlreadyRevokedError,
} from "../../gen/manager/error.js";
import type { RenownCredentialManagerOperations } from "@powerhousedao/renown-package/document-models/renown-credential";

export const renownCredentialManagerOperations: RenownCredentialManagerOperations = {
  initOperation(state, action, dispatch) {
    // Validate context
    const context =
      action.input.context && action.input.context.length > 0
        ? action.input.context
        : ["https://www.w3.org/2018/credentials/v1"];

    if (!context.includes("https://www.w3.org/2018/credentials/v1")) {
      throw new MissingContextError(
        "Context must include https://www.w3.org/2018/credentials/v1",
      );
    }

    // Validate type
    const type =
      action.input.type && action.input.type.length > 0
        ? action.input.type
        : ["VerifiableCredential"];

    if (!type.includes("VerifiableCredential")) {
      throw new MissingTypeError("Type must include VerifiableCredential");
    }

    // Validate credentialSubject is valid JSON
    try {
      JSON.parse(action.input.credentialSubject);
    } catch (e) {
      throw new InvalidClaimsError("Credential subject must be valid JSON");
    }

    state.context = context;
    state.id = action.input.id || null;
    state.type = type;
    state.issuer = action.input.issuer;
    state.issuanceDate = action.input.issuanceDate;
    state.credentialSubject = action.input.credentialSubject;
    state.expirationDate = action.input.expirationDate || null;
    state.credentialStatus = null;
    state.jwt = null;
    state.revoked = false;
    state.revokedAt = null;
    state.revocationReason = null;
  },
  updateCredentialSubjectOperation(state, action, dispatch) {
    if (state.revoked) {
      throw new CredentialRevokedError("Cannot update a revoked credential");
    }

    // Validate credentialSubject is valid JSON
    try {
      JSON.parse(action.input.credentialSubject);
    } catch (e) {
      throw new InvalidClaimsError("Credential subject must be valid JSON");
    }

    state.credentialSubject = action.input.credentialSubject;

    // Clear JWT as credential content has changed
    state.jwt = null;
  },
  setJwtOperation(state, action, dispatch) {
    state.jwt = action.input.jwt;
  },
  setCredentialStatusOperation(state, action, dispatch) {
    // Validate statusPurpose
    if (
      action.input.statusPurpose !== "revocation" &&
      action.input.statusPurpose !== "suspension"
    ) {
      throw new InvalidStatusPurposeError(
        "Status purpose must be 'revocation' or 'suspension'",
      );
    }

    state.credentialStatus = {
      id: action.input.statusId,
      type: action.input.statusType,
      statusPurpose: action.input.statusPurpose,
      statusListIndex: action.input.statusListIndex,
      statusListCredential: action.input.statusListCredential,
    };
  },
  revokeOperation(state, action, dispatch) {
    if (state.revoked) {
      throw new AlreadyRevokedError("Credential is already revoked");
    }

    state.revoked = true;
    state.revokedAt = action.input.revokedAt;
    state.revocationReason = action.input.reason || null;
  },
};
