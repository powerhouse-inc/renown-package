import type { RenownCredentialManagerOperations } from "../../gen/manager/operations.js";
import {
  InvalidStatusPurposeError,
  MissingContextError,
  MissingTypeError,
  InvalidClaimsError,
  CredentialRevokedError,
  AlreadyRevokedError,
  JwtVerificationError,
  InvalidJwtPayloadError,
} from "../../gen/manager/error.js";
import { decodeJWT } from 'did-jwt';

// Type definitions for JWT payload structure
interface CredentialStatus {
  id: string;
  type: string;
  statusPurpose: string;
  statusListIndex: string;
  statusListCredential: string;
}

// Flexible VC payload interface - all fields optional to support various VC structures
interface VerifiableCredentialPayload {
  '@context'?: string | string[];
  type?: string | string[];
  credentialSubject?: unknown;
  id?: string;
  expirationDate?: string;
  credentialStatus?: CredentialStatus;
  // Allow any additional fields
  [key: string]: unknown;
}

interface JwtPayload {
  vc: VerifiableCredentialPayload;
  iss: string;
  sub?: string;
  iat?: number;
  nbf?: number;
  exp?: number;
  jti?: string;
}

export const reducer: RenownCredentialManagerOperations = {
  initOperation(state, action, dispatch) {
        // NOTE: JWT should be cryptographically verified using verifyCredential()
        // from did-jwt-vc BEFORE dispatching this action. This reducer only decodes
        // and extracts the credential fields from the JWT payload.

        // Decode the JWT to extract payload
        let decoded;
        try {
          decoded = decodeJWT(action.input.jwt);
        } catch (e) {
          const error = e as Error;
          throw new JwtVerificationError(`Failed to decode JWT: ${error.message}`);
        }

        const payload = decoded.payload as JwtPayload;

        // Validate minimum required JWT fields
        if (!payload.iss) {
          throw new InvalidJwtPayloadError('JWT payload missing issuer (iss field)');
        }

        // Extract the verifiable credential from the payload (if present)
        const vc = payload.vc as VerifiableCredentialPayload | undefined;

        if (!vc) {
          throw new InvalidJwtPayloadError('JWT payload does not contain a verifiable credential (vc field)');
        }

        // Store the complete VC payload for maximum flexibility
        state.vcPayload = JSON.stringify(vc);

        // Extract common W3C VC fields if present (but don't fail if missing)
        // Context
        if (vc['@context']) {
          const context = Array.isArray(vc['@context']) ? vc['@context'] : [vc['@context']];
          state.context = context;
        } else {
          state.context = null;
        }

        // Type
        if (vc.type) {
          const type = Array.isArray(vc.type) ? vc.type : [vc.type];
          state.type = type;
        } else {
          state.type = null;
        }

        // Credential Subject - store as JSON string for flexibility
        if (vc.credentialSubject !== undefined) {
          const credentialSubjectStr = typeof vc.credentialSubject === 'string'
            ? vc.credentialSubject
            : JSON.stringify(vc.credentialSubject);
          state.credentialSubject = credentialSubjectStr;
        } else {
          state.credentialSubject = null;
        }

        // Issuer (from JWT payload)
        state.issuer = payload.iss;

        // Issuance date (JWT uses 'iat' or 'nbf')
        if (payload.nbf || payload.iat) {
          const issuanceTimestamp = (payload.nbf || payload.iat)!;
          state.issuanceDate = new Date(issuanceTimestamp * 1000).toISOString();
        } else {
          state.issuanceDate = null;
        }

        // Expiration date (from JWT exp or VC expirationDate)
        if (payload.exp) {
          state.expirationDate = new Date(payload.exp * 1000).toISOString();
        } else if (vc.expirationDate) {
          state.expirationDate = vc.expirationDate;
        } else {
          state.expirationDate = null;
        }

        // Credential ID (JWT uses 'jti', VC uses 'id')
        state.id = payload.jti || vc.id || null;

        // Credential Status (optional W3C VC field)
        state.credentialStatus = vc.credentialStatus || null;

        // Store JWT token
        state.jwt = action.input.jwt;
        state.jwtVerified = true;

        // Initialize revocation tracking
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
      if (action.input.statusPurpose !== "revocation" && action.input.statusPurpose !== "suspension") {
        throw new InvalidStatusPurposeError("Status purpose must be 'revocation' or 'suspension'");
      }

      state.credentialStatus = {
        id: action.input.statusId,
        type: action.input.statusType,
        statusPurpose: action.input.statusPurpose,
        statusListIndex: action.input.statusListIndex,
        statusListCredential: action.input.statusListCredential
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
