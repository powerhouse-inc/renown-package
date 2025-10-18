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
    createdAt: DateTime
    updatedAt: DateTime
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

  type Authorization {
    id: OID!
    jwt: String!
    issuer: String
    subject: String
    audience: String
    payload: String
    revoked: Boolean!
    createdAt: DateTime
    revokedAt: DateTime
    user: RenownProfile!
  }

  input GetAuthorizationsInput {
    driveId: String!
    ethAddress: String!
    subject: String
    includeRevoked: Boolean
  }

  type Query {
    getProfile(input: GetProfileInput!): RenownProfile
    getProfiles(input: GetProfilesInput!): [RenownProfile!]!
    getAuthorizations(input: GetAuthorizationsInput!): [Authorization!]!
  }
`;
