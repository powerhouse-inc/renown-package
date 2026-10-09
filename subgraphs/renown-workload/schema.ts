import type { DocumentNode } from "graphql";
import { gql } from "graphql-tag";

/**
 * Every field requires the `X-Renown-Workload-Registration-Token` header and
 * is disabled (SERVICE_NOT_CONFIGURED) when
 * `RENOWN_WORKLOAD_REGISTRATION_TOKEN` is unset.
 */
export const schema: DocumentNode = gql`
  type WorkloadIdentity {
    did: String!
    provider: String!
    repositoryId: String!
    repository: String!
    productionBranch: String!
    ownerAddress: String!
    chainId: Int!
    createdAt: String!
  }

  type AppStatsToken {
    accessToken: String!
    audience: String!
    expiresIn: Int!
  }

  input RegisterWorkloadIdentityInput {
    repositoryId: String!
    repository: String!
    productionBranch: String!
    ownerAddress: String!
    chainId: Int!
  }

  type Query {
    workloadIdentity(did: String!): WorkloadIdentity
  }

  type Mutation {
    registerWorkloadIdentity(
      input: RegisterWorkloadIdentityInput!
    ): WorkloadIdentity!
    updateWorkloadIdentity(
      did: String!
      repository: String
      productionBranch: String
    ): WorkloadIdentity!
    deleteWorkloadIdentity(did: String!): Boolean!
    "A 10-minute Renown bearer signed by the identity's did:key, valid only for the renown-stats audience (send it as X-Renown-App-Token). For the Vetra stats relay."
    issueAppStatsToken(did: String!): AppStatsToken!
  }
`;
