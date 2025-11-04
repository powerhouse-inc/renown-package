import type { DocumentModelGlobalState } from "document-model";

export const documentModel: DocumentModelGlobalState = {
  author: {
    name: "Powerhouse Inc.",
    website: "https://www.powerhouse.inc",
  },
  description: "A Renown Credential",
  extension: "phrc",
  id: "powerhouse/renown-credential",
  name: "RenownCredential",
  specifications: [
    {
      changeLog: [],
      modules: [
        {
          description: "",
          id: "ea1ea725-62a9-4e97-8f89-6b153b7af4ee",
          name: "manager",
          operations: [
            {
              description:
                "Initialize a W3C Verifiable Credential with required fields",
              errors: [
                {
                  code: "MISSING_CONTEXT",
                  description:
                    "The @context field is required for W3C VC compliance",
                  id: "missing-context-error",
                  name: "MissingContextError",
                  template: "",
                },
                {
                  code: "INVALID_JWT_PAYLOAD",
                  description:
                    "JWT payload does not contain valid W3C Verifiable Credential fields",
                  id: "invalid-jwt-payload-error",
                  name: "InvalidJwtPayloadError",
                  template: "",
                },
                {
                  code: "JWT_VERIFICATION_FAILED",
                  description:
                    "Failed to verify the JWT signature or the JWT is malformed",
                  id: "jwt-verification-error",
                  name: "JwtVerificationError",
                  template: "",
                },
                {
                  code: "INVALID_CLAIMS",
                  description: "The subject claims must be valid JSON",
                  id: "invalid-claims-error",
                  name: "InvalidClaimsError",
                  template: "",
                },
                {
                  code: "MISSING_TYPE",
                  description:
                    "The type field is required and must include VerifiableCredential",
                  id: "missing-type-error",
                  name: "MissingTypeError",
                  template: "",
                },
              ],
              examples: [],
              id: "366dfd44-377f-42d7-949d-a8d82b6a909d",
              name: "INIT",
              reducer:
                "// NOTE: JWT should be cryptographically verified using verifyCredential()\n// from did-jwt-vc BEFORE dispatching this action. This reducer only decodes\n// and extracts the credential fields from the JWT payload.\n\n// Decode the JWT to extract payload\nlet decoded;\ntry {\n  decoded = decodeJWT(action.input.jwt);\n} catch (e) {\n  const error = e as Error;\n  throw new JwtVerificationError(`Failed to decode JWT: ${error.message}`);\n}\n\nconst payload = decoded.payload as JwtPayload;\n\n// Validate minimum required JWT fields\nif (!payload.iss) {\n  throw new InvalidJwtPayloadError('JWT payload missing issuer (iss field)');\n}\n\n// Extract the verifiable credential from the payload (if present)\nconst vc = payload.vc as VerifiableCredentialPayload | undefined;\n\nif (!vc) {\n  throw new InvalidJwtPayloadError('JWT payload does not contain a verifiable credential (vc field)');\n}\n\n// Store the complete VC payload for maximum flexibility\nstate.vcPayload = JSON.stringify(vc);\n\n// Extract common W3C VC fields if present (but don't fail if missing)\n// Context\nif (vc['@context']) {\n  const context = Array.isArray(vc['@context']) ? vc['@context'] : [vc['@context']];\n  state.context = context;\n} else {\n  state.context = null;\n}\n\n// Type\nif (vc.type) {\n  const type = Array.isArray(vc.type) ? vc.type : [vc.type];\n  state.type = type;\n} else {\n  state.type = null;\n}\n\n// Credential Subject - store as JSON string for flexibility\nif (vc.credentialSubject !== undefined) {\n  const credentialSubjectStr = typeof vc.credentialSubject === 'string'\n    ? vc.credentialSubject\n    : JSON.stringify(vc.credentialSubject);\n  state.credentialSubject = credentialSubjectStr;\n} else {\n  state.credentialSubject = null;\n}\n\n// Issuer (from JWT payload)\nstate.issuer = payload.iss;\n\n// Issuance date (JWT uses 'iat' or 'nbf')\nif (payload.nbf || payload.iat) {\n  const issuanceTimestamp = (payload.nbf || payload.iat)!;\n  state.issuanceDate = new Date(issuanceTimestamp * 1000).toISOString();\n} else {\n  state.issuanceDate = null;\n}\n\n// Expiration date (from JWT exp or VC expirationDate)\nif (payload.exp) {\n  state.expirationDate = new Date(payload.exp * 1000).toISOString();\n} else if (vc.expirationDate) {\n  state.expirationDate = vc.expirationDate;\n} else {\n  state.expirationDate = null;\n}\n\n// Credential ID (JWT uses 'jti', VC uses 'id')\nstate.id = payload.jti || vc.id || null;\n\n// Credential Status (optional W3C VC field)\nstate.credentialStatus = vc.credentialStatus || null;\n\n// Store JWT token\nstate.jwt = action.input.jwt;\nstate.jwtVerified = true;\n\n// Initialize revocation tracking\nstate.revoked = false;\nstate.revokedAt = null;\nstate.revocationReason = null;",
              schema: "input InitInput {\n  jwt: String!\n}",
              scope: "global",
              template: "",
            },
            {
              description: "Marks the credential as revoked",
              errors: [
                {
                  code: "ALREADY_REVOKED",
                  description: "The credential is already revoked",
                  id: "already-revoked-error",
                  name: "AlreadyRevokedError",
                  template: "",
                },
              ],
              examples: [],
              id: "8d8ed639-f7c4-43a5-8644-85729bd5b7dc",
              name: "REVOKE",
              reducer:
                'if (state.revoked) {\n  throw new AlreadyRevokedError("Credential is already revoked");\n}\n\nstate.revoked = true;\nstate.revokedAt = action.input.revokedAt;\nstate.revocationReason = action.input.reason || null;',
              schema:
                "input RevokeInput {\n  revokedAt: DateTime!\n  reason: String\n}",
              scope: "global",
              template: "",
            },
            {
              description: "Updates the credential subject claims",
              errors: [
                {
                  code: "INVALID_CLAIMS",
                  description: "The subject claims must be valid JSON",
                  id: "invalid-claims-error-2",
                  name: "InvalidClaimsError",
                  template: "",
                },
                {
                  code: "CREDENTIAL_REVOKED",
                  description: "Cannot update a revoked credential",
                  id: "credential-revoked-error",
                  name: "CredentialRevokedError",
                  template: "",
                },
              ],
              examples: [],
              id: "update-credential-subject-op",
              name: "UPDATE_CREDENTIAL_SUBJECT",
              reducer:
                'if (state.revoked) {\n  throw new CredentialRevokedError("Cannot update a revoked credential");\n}\n\n// Validate credentialSubject is valid JSON\ntry {\n  JSON.parse(action.input.credentialSubject);\n} catch (e) {\n  throw new InvalidClaimsError("Credential subject must be valid JSON");\n}\n\nstate.credentialSubject = action.input.credentialSubject;\n\n// Clear JWT as credential content has changed\nstate.jwt = null;',
              schema:
                "input UpdateCredentialSubjectInput {\n  credentialSubject: String!\n}",
              scope: "global",
              template: "Updates the credential subject claims",
            },
            {
              description:
                "Sets the signed JWT representation of the credential",
              errors: [],
              examples: [],
              id: "set-jwt-op",
              name: "SET_JWT",
              reducer: "state.jwt = action.input.jwt;",
              schema: "input SetJwtInput {\n  jwt: String!\n}",
              scope: "global",
              template: "Sets the signed JWT representation of the credential",
            },
            {
              description:
                "Sets the credential status for revocation support (StatusList2021)",
              errors: [
                {
                  code: "INVALID_STATUS_PURPOSE",
                  description:
                    "Status purpose must be either 'revocation' or 'suspension'",
                  id: "invalid-status-purpose-error",
                  name: "InvalidStatusPurposeError",
                  template: "",
                },
              ],
              examples: [],
              id: "set-credential-status-op",
              name: "SET_CREDENTIAL_STATUS",
              reducer:
                '// Validate statusPurpose\nif (action.input.statusPurpose !== "revocation" && action.input.statusPurpose !== "suspension") {\n  throw new InvalidStatusPurposeError("Status purpose must be \'revocation\' or \'suspension\'");\n}\n\nstate.credentialStatus = {\n  id: action.input.statusId,\n  type: action.input.statusType,\n  statusPurpose: action.input.statusPurpose,\n  statusListIndex: action.input.statusListIndex,\n  statusListCredential: action.input.statusListCredential\n};',
              schema:
                "input SetCredentialStatusInput {\n  statusId: String!\n  statusType: String!\n  statusPurpose: String!\n  statusListIndex: String!\n  statusListCredential: String!\n}",
              scope: "global",
              template:
                "Sets the credential status for revocation support (StatusList2021)",
            },
          ],
        },
      ],
      state: {
        global: {
          examples: [],
          initialValue:
            '"{\\n  \\"vcPayload\\": null,\\n  \\"context\\": null,\\n  \\"id\\": null,\\n  \\"type\\": null,\\n  \\"issuer\\": null,\\n  \\"issuanceDate\\": null,\\n  \\"credentialSubject\\": null,\\n  \\"expirationDate\\": null,\\n  \\"credentialStatus\\": null,\\n  \\"jwt\\": null,\\n  \\"jwtVerified\\": false,\\n  \\"revoked\\": false,\\n  \\"revokedAt\\": null,\\n  \\"revocationReason\\": null\\n}"',
          schema:
            'type CredentialStatus {\n  id: String!\n  type: String!\n  statusPurpose: String!\n  statusListIndex: String!\n  statusListCredential: String!\n}\n\ntype RenownCredentialState {\n  "JWT token containing the Verifiable Credential"\n  jwt: String\n  jwtVerified: Boolean\n\n  "Complete VC Payload - extracted from JWT for convenience and flexibility"\n  vcPayload: String\n\n  "W3C VC Common Fields - extracted for querying convenience, may be null for non-standard VCs"\n  context: [String!]\n  id: String\n  type: [String!]\n  issuer: String\n  issuanceDate: DateTime\n  credentialSubject: String\n\n  "W3C VC Optional Fields"\n  expirationDate: DateTime\n  credentialStatus: CredentialStatus\n\n  "Revocation tracking"\n  revoked: Boolean\n  revokedAt: DateTime\n  revocationReason: String\n}',
        },
        local: {
          examples: [],
          initialValue: '""',
          schema: "",
        },
      },
      version: 1,
    },
  ],
};
