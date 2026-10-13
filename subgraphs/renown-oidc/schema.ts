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

  "Members of orgId with at least minRole (OWNER, ADMIN, PUBLISHER or MEMBER) may sign in."
  input OidcAllowedOrgInput {
    orgId: String!
    minRole: String!
  }

  type OidcAllowedOrg {
    orgId: String!
    minRole: String!
  }

  input RegisterOidcClientInput {
    name: String!
    redirectUris: [String!]!
    allowedSubjects: [String!]!
    allowedOrgs: [OidcAllowedOrgInput!]
    confidential: Boolean = true
  }

  input UpdateOidcClientInput {
    name: String
    addRedirectUris: [String!]
    removeRedirectUris: [String!]
    addAllowedSubjects: [String!]
    removeAllowedSubjects: [String!]
    allowAnySubject: Boolean
    "Replaces the list."
    allowedOrgs: [OidcAllowedOrgInput!]
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
    allowedOrgs: [OidcAllowedOrg!]!
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
