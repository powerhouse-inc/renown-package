import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  """
  Subgraph definition for Renown Read Model
  """
  type RenownUser {
    documentId: String!
    username: String
    ethAddress: String
    userImage: String
    createdAt: DateTime
    updatedAt: DateTime
  }

  input RenownUserInput {
    driveId: String!
    phid: String
    ethAddress: String
    username: String
  }

  input RenownUsersInput {
    driveId: String!
    phids: [String!]
    ethAddresses: [String!]
    usernames: [String!]
  }

  type Query {
    renownUser(input: RenownUserInput!): RenownUser
    renownUsers(input: RenownUsersInput!): [RenownUser!]!
  }
`;
