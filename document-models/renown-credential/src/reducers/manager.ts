import {
  AlreadyRevokedError,
  InvalidJwtPayloadError,
  JwtVerificationError,
} from "../../gen/manager/error.js";
import type { RenownCredentialManagerOperations } from "@powerhousedao/renown-package/document-models/renown-credential";

export const renownCredentialManagerOperations: RenownCredentialManagerOperations =
  {
    initOperation(state, action, dispatch) {
      // Store the EIP-712 signed verifiable credential fields
      state.context = action.input.context;
      state.id = action.input.id;
      state.type = action.input.type;

      // Store issuer
      state.issuer = {
        id: action.input.issuer.id,
        ethereumAddress: action.input.issuer.ethereumAddress,
      };

      // Store dates
      state.issuanceDate = action.input.issuanceDate;
      state.expirationDate = action.input.expirationDate || null;

      // Store credential subject
      state.credentialSubject = {
        id: action.input.credentialSubject.id || null,
        app: action.input.credentialSubject.app,
      };

      // Store credential status (optional)
      if (action.input.credentialStatus) {
        state.credentialStatus = {
          id: action.input.credentialStatus.id,
          type: action.input.credentialStatus.type,
        };
      } else {
        state.credentialStatus = null;
      }

      // Store credential schema
      state.credentialSchema = {
        id: action.input.credentialSchema.id,
        type: action.input.credentialSchema.type,
      };

      // Store proof (EIP-712 signature)
      state.proof = {
        verificationMethod: action.input.proof.verificationMethod,
        ethereumAddress: action.input.proof.ethereumAddress,
        created: action.input.proof.created,
        proofPurpose: action.input.proof.proofPurpose,
        type: action.input.proof.type,
        proofValue: action.input.proof.proofValue,
        eip712: {
          domain: {
            version: action.input.proof.eip712.domain.version,
            chainId: action.input.proof.eip712.domain.chainId,
          },
          primaryType: action.input.proof.eip712.primaryType,
        },
      };

      // Initialize revocation tracking
      state.revoked = false;
      state.revokedAt = null;
      state.revocationReason = null;
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
