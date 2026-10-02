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
  }
`;
