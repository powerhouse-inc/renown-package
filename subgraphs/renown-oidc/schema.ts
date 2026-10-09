import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

/**
 * Every mutation requires the `X-Renown-OIDC-Registration-Token` header and is
 * disabled when `RENOWN_OIDC_REGISTRATION_TOKEN` is unset.
 */
export const schema: DocumentNode = gql`
  enum OidcClientStatus {
    ACTIVE
    DISABLED
  }

  input RegisterOidcClientInput {
    name: String!
    redirectUris: [String!]!
    allowedSubjects: [String!]!
    confidential: Boolean = true
  }

  input UpdateOidcClientInput {
    name: String
    addRedirectUris: [String!]
    removeRedirectUris: [String!]
    addAllowedSubjects: [String!]
    removeAllowedSubjects: [String!]
    allowAnySubject: Boolean
    status: OidcClientStatus
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
    updateOidcClient(clientId: String!, input: UpdateOidcClientInput!): OidcClientInfo!
    rotateOidcClientSecret(clientId: String!, confidential: Boolean = true): RegisteredOidcClient!
  }
`;
