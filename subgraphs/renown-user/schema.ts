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
`;
