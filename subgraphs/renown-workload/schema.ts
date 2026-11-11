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
    "Branches (exact names or * patterns) that may publish releases, besides productionBranch"
    releaseBranches: [String!]!
    ownerAddress: String!
    chainId: Int!
    "The owning organisation, when registered for one"
    ownerOrgId: String
    "Disabled by an organisation admin: no tokens"
    disabled: Boolean!
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
    "Branches (exact names, or patterns where * matches one or more non-/ characters) that may publish releases; none when omitted. At most 20. Registering an already registered repository leaves them unchanged: use updateWorkloadIdentity."
    releaseBranches: [String!]
    ownerAddress: String!
    chainId: Int!
    "Register for this organisation (ownerAddress must be a publisher there)"
    ownerOrgId: String
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
      "Replaces the release branches when given ([] clears them)"
      releaseBranches: [String!]
    ): WorkloadIdentity!
    deleteWorkloadIdentity(did: String!): Boolean!
    "A 10-minute Renown bearer signed by the identity's did:key, valid only for the renown-stats audience (send it as X-Renown-App-Token). For the Vetra stats relay."
    issueAppStatsToken(did: String!): AppStatsToken!
  }
`;
