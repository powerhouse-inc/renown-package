import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  """
  Subgraph definition for RenownUser (powerhouse/renown-user)
  """
  type RenownUserState {
    "Add your global state fields here"
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
`;
