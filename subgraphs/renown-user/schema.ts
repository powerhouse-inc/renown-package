import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  """
  Subgraph definition for RenownUser (powerhouse/renown-user)
  """
  type Authorization {
    id: OID!
    jwt: String!
    issuer: String
    subject: String
    audience: String
    payload: String
    revoked: Boolean
    createdAt: DateTime
    revokedAt: DateTime
  }

  type RenownUserState {
    "Add your global state fields here"
    username: String
    ethAddress: EthereumAddress
    userImage: String
    authorizations: [Authorization!]!
  }

  type AuthorizationWithUser {
    id: OID!
    jwt: String!
    issuer: String
    subject: String
    audience: String
    payload: String
    revoked: Boolean
    createdAt: DateTime
    revokedAt: DateTime
    user: RenownUserInfo!
  }

  type RenownUserInfo {
    documentId: String!
    username: String
    ethAddress: EthereumAddress
    userImage: String
  }

  """
  Queries: RenownUser
  """
  type RenownUserQueries {
    getDocument(docId: PHID!, driveId: PHID): RenownUser
    getDocuments(driveId: String!): [RenownUser!]
    getAuthorizationsByEthAddress(
      ethAddress: EthereumAddress!
      subject: String
      includeRevoked: Boolean
    ): [AuthorizationWithUser!]!
  }

  type Query {
    RenownUser: RenownUserQueries
  }

  """
  Mutations: RenownUser
  """
  type Mutation {
    RenownUser_createDocument(name: String!, driveId: String): String

    RenownUser_setUsername(
      driveId: String
      docId: PHID
      input: RenownUser_SetUsernameInput
    ): Int
    RenownUser_setEthAddress(
      driveId: String
      docId: PHID
      input: RenownUser_SetEthAddressInput
    ): Int
    RenownUser_setUserImage(
      driveId: String
      docId: PHID
      input: RenownUser_SetUserImageInput
    ): Int
    RenownUser_addAuthorization(
      driveId: String
      docId: PHID
      input: RenownUser_AddAuthorizationInput
    ): Int
    RenownUser_revokeAuthorization(
      driveId: String
      docId: PHID
      input: RenownUser_RevokeAuthorizationInput
    ): Int
    RenownUser_removeAuthorization(
      driveId: String
      docId: PHID
      input: RenownUser_RemoveAuthorizationInput
    ): Int
  }

  """
  Module: Profile
  """
  input RenownUser_SetUsernameInput {
    "Add your inputs here"
    username: String!
  }
  input RenownUser_SetEthAddressInput {
    "Add your inputs here"
    ethAddress: EthereumAddress!
  }
  input RenownUser_SetUserImageInput {
    "Add your inputs here"
    userImage: String!
  }

  """
  Module: Authorization
  """
  input RenownUser_AddAuthorizationInput {
    id: OID!
    jwt: String!
    issuer: String
    subject: String
    audience: String
    payload: String
    createdAt: DateTime!
  }
  input RenownUser_RevokeAuthorizationInput {
    id: OID!
    revokedAt: DateTime!
  }
  input RenownUser_RemoveAuthorizationInput {
    id: OID!
  }
`;
