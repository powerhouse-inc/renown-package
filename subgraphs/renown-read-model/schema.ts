import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  """
  Subgraph definition for Renown Read Model
  """
  type ReadRenownUser {
    documentId: String!
    username: String
    ethAddress: String
    userImage: String
    createdAt: DateTime
    updatedAt: DateTime
  }

  input RenownUserInput {
    driveId: String
    phid: String
    ethAddress: String
    username: String
  }

  input RenownUsersInput {
    driveId: String
    phids: [String!]
    ethAddresses: [String!]
    usernames: [String!]
  }

  type ReadRenownCredential {
    documentId: String!
    credentialId: String
    context: [String!]!
    type: [String!]!
    issuer: String!
    issuanceDate: DateTime!
    credentialSubject: String!
    expirationDate: DateTime
    credentialStatus: ReadCredentialStatus
    jwt: String
    revoked: Boolean!
    revokedAt: DateTime
    revocationReason: String
    createdAt: DateTime
    updatedAt: DateTime
  }

  type ReadCredentialStatus {
    id: String!
    type: String!
    statusPurpose: String!
    statusListIndex: String!
    statusListCredential: String!
  }

  input RenownCredentialsInput {
    driveId: String
    ethAddress: String
    did: String
    issuer: String
    includeRevoked: Boolean
  }

  type Query {
    renownUser(input: RenownUserInput!): ReadRenownUser
    renownUsers(input: RenownUsersInput!): [ReadRenownUser!]!
    renownCredentials(input: RenownCredentialsInput!): [ReadRenownCredential!]!
  }
`;
