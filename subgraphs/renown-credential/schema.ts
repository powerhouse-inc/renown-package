import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  """
  Subgraph definition for RenownCredential (renown/credential)
  """
  type RenownCredentialState {
    "Add your global state fields here"
    jwt: String
    revoked: Boolean
    issuer: String
    subject: String
    audience: String
    payload: String
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
  }

  """
  Module: Manager
  """
  input RenownCredential_InitInput {
    "Add your inputs here"
    jwt: String!
    issuer: String
    subject: String
    audience: String
    payload: String
  }
  input RenownCredential_RevokeInput {
    jwt: String
  }
`;
