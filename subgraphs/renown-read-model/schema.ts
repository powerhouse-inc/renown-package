import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  """
  Subgraph definition for Renown Read Model
  """
  type RenownProfile {
    documentId: String!
    username: String
    ethAddress: String
    userImage: String
    createdAt: String
    updatedAt: String
  }

  input GetProfileInput {
    driveId: String!
    id: String
    username: String
    ethAddress: String
    searchInput: String
  }

  input GetProfilesInput {
    driveId: String!
    ids: [String!]
    usernames: [String!]
    ethAddresses: [String!]
    searchString: String
  }

  type Query {
    getProfile(input: GetProfileInput!): RenownProfile
    getProfiles(input: GetProfilesInput!): [RenownProfile!]!
  }
`;
