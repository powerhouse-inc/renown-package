import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  input RegisterOidcClientInput {
    name: String!
    redirectUris: [String!]!
    allowedSubjects: [String!]!
    confidential: Boolean = true
  }

  type RegisteredOidcClient {
    clientId: String!
    clientSecret: String
  }

  type OidcClientInfo {
    clientId: String!
    name: String
    redirectUris: [String!]!
    status: String!
  }

  type Query {
    oidcClient(clientId: String!): OidcClientInfo
  }

  type Mutation {
    registerOidcClient(input: RegisterOidcClientInput!): RegisteredOidcClient!
  }
`;
