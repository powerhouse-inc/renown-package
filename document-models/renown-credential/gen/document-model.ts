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
                  code: "MISSING_TYPE",
                  description:
                    "The type field is required and must include VerifiableCredential",
                  id: "missing-type-error",
                  name: "MissingTypeError",
                  template: "",
                },
                {
                  code: "INVALID_CLAIMS",
                  description: "The subject claims must be valid JSON",
                  id: "invalid-claims-error",
                  name: "InvalidClaimsError",
                  template: "",
                },
              ],
              examples: [],
              id: "366dfd44-377f-42d7-949d-a8d82b6a909d",
              name: "INIT",
              reducer:
                '// Validate context\nconst context = action.input.context && action.input.context.length > 0 \n  ? action.input.context \n  : ["https://www.w3.org/2018/credentials/v1"];\n\nif (!context.includes("https://www.w3.org/2018/credentials/v1")) {\n  throw new MissingContextError("Context must include https://www.w3.org/2018/credentials/v1");\n}\n\n// Validate type\nconst type = action.input.type && action.input.type.length > 0\n  ? action.input.type\n  : ["VerifiableCredential"];\n\nif (!type.includes("VerifiableCredential")) {\n  throw new MissingTypeError("Type must include VerifiableCredential");\n}\n\n// Validate credentialSubject is valid JSON\ntry {\n  JSON.parse(action.input.credentialSubject);\n} catch (e) {\n  throw new InvalidClaimsError("Credential subject must be valid JSON");\n}\n\nstate.context = context;\nstate.id = action.input.id || null;\nstate.type = type;\nstate.issuer = action.input.issuer;\nstate.issuanceDate = action.input.issuanceDate;\nstate.credentialSubject = action.input.credentialSubject;\nstate.expirationDate = action.input.expirationDate || null;\nstate.credentialStatus = null;\nstate.jwt = null;\nstate.revoked = false;\nstate.revokedAt = null;\nstate.revocationReason = null;',
              schema:
                "input InitInput {\n  context: [String!]\n  id: String\n  type: [String!]\n  issuer: String!\n  issuanceDate: DateTime!\n  credentialSubject: String!\n  expirationDate: DateTime\n}",
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
            '{\n  "context": ["https://www.w3.org/2018/credentials/v1"],\n  "id": null,\n  "type": ["VerifiableCredential"],\n  "issuer": "",\n  "issuanceDate": "",\n  "credentialSubject": "{}",\n  "expirationDate": null,\n  "credentialStatus": null,\n  "jwt": null,\n  "revoked": false,\n  "revokedAt": null,\n  "revocationReason": null\n}',
          schema:
            'type CredentialStatus {\n  id: String!\n  type: String!\n  statusPurpose: String!\n  statusListIndex: String!\n  statusListCredential: String!\n}\n\ntype RenownCredentialState {\n  "W3C VC Required Fields"\n  context: [String!]!\n  id: String\n  type: [String!]!\n  issuer: String!\n  issuanceDate: DateTime!\n  credentialSubject: String!\n  \n  "W3C VC Optional Fields"\n  expirationDate: DateTime\n  credentialStatus: CredentialStatus\n  \n  "JWT Representation"\n  jwt: String\n  \n  "Revocation tracking"\n  revoked: Boolean\n  revokedAt: DateTime\n  revocationReason: String\n}',
        },
        local: {
          examples: [],
          initialValue: "",
          schema: "",
        },
      },
      version: 1,
    },
  ],
};
