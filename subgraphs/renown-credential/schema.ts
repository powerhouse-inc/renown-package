import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  """
  Subgraph definition for RenownCredential (renown/credential)
  """
  type CredentialStatus {
    id: String!
    type: String!
    statusPurpose: String!
    statusListIndex: String!
    statusListCredential: String!
  }

  type RenownCredentialState {
    "W3C VC Required Fields"
    context: [String!]!
    id: String
    type: [String!]!
    issuer: String!
    issuanceDate: DateTime!
    credentialSubject: String!

    "W3C VC Optional Fields"
    expirationDate: DateTime
    credentialStatus: CredentialStatus

    "JWT Representation"
    jwt: String

    "Revocation tracking"
    revoked: Boolean
    revokedAt: DateTime
    revocationReason: String
  }

  """
  Queries: RenownCredential
  """
  type RenownCredentialQueries {
    getDocument(docId: PHID!, driveId: PHID): RenownCredential
    getDocuments(driveId: String!): [RenownCredential!]
  }

  type Query {
    RenownCredential: RenownCredentialQueries
  }

  """
  Mutations: RenownCredential
  """
  type Mutation {
    RenownCredential_createDocument(name: String!, driveId: String): String

    RenownCredential_init(
      driveId: String
      docId: PHID
      input: RenownCredential_InitInput
    ): Int
    RenownCredential_revoke(
      driveId: String
      docId: PHID
      input: RenownCredential_RevokeInput
    ): Int
    RenownCredential_updateCredentialSubject(
      driveId: String
      docId: PHID
      input: RenownCredential_UpdateCredentialSubjectInput
    ): Int
    RenownCredential_setJwt(
      driveId: String
      docId: PHID
      input: RenownCredential_SetJwtInput
    ): Int
    RenownCredential_setCredentialStatus(
      driveId: String
      docId: PHID
      input: RenownCredential_SetCredentialStatusInput
    ): Int
  }

  """
  Module: Manager
  """
  input RenownCredential_InitInput {
    context: [String!]
    id: String
    type: [String!]
    issuer: String!
    issuanceDate: DateTime!
    credentialSubject: String!
    expirationDate: DateTime
  }
  input RenownCredential_RevokeInput {
    revokedAt: DateTime!
    reason: String
  }
  input RenownCredential_UpdateCredentialSubjectInput {
    credentialSubject: String!
  }
  input RenownCredential_SetJwtInput {
    jwt: String!
  }
  input RenownCredential_SetCredentialStatusInput {
    statusId: String!
    statusType: String!
    statusPurpose: String!
    statusListIndex: String!
    statusListCredential: String!
  }
`;
