import { gql } from "graphql-tag";
import type { DocumentNode } from "graphql";

export const schema: DocumentNode = gql`
  """
  Subgraph definition for Renown Read Model
  """
  type ReadRenownUser {
    documentId: String!
    username: String
    ethAddress: String
    userImage: String
    displayName: String
    "Lowercase, unique across profiles"
    handle: String
    bio: String
    links: [ReadRenownUserLink!]!
    "attachment://v1:<sha256> of the uploaded avatar; serve it via the package media route"
    avatar: String
    createdAt: DateTime
    updatedAt: DateTime
  }

  type ReadRenownUserLink {
    id: String!
    label: String!
    url: String!
  }

  input RenownUserInput {
    driveId: String
    phid: String
    ethAddress: String
    username: String
    "Case-insensitive"
    handle: String
  }

  input RenownUsersInput {
    driveId: String
    phids: [String!]
    ethAddresses: [String!]
    usernames: [String!]
    handles: [String!]
  }

  enum RenownHandleProblem {
    INVALID
    RESERVED
    TAKEN
  }

  type RenownHandleAvailability {
    "The handle as it would be stored (trimmed, lowercased)"
    handle: String!
    available: Boolean!
    "Why it is not available; null when it is"
    reason: RenownHandleProblem
  }

  type ReadRenownCredential {
    documentId: String!
    credentialId: String!
    context: [String!]!
    type: [String!]!
    issuerId: String!
    issuerEthereumAddress: String!
    issuanceDate: DateTime!
    expirationDate: DateTime
    credentialSubjectId: String
    credentialSubjectApp: String!
    credentialStatusId: String
    credentialStatusType: String
    credentialSchemaId: String!
    credentialSchemaType: String!
    proofVerificationMethod: String!
    proofEthereumAddress: String!
    proofCreated: DateTime!
    proofPurpose: String!
    proofType: String!
    proofValue: String!
    proofEip712Domain: String!
    proofEip712PrimaryType: String!
    revoked: Boolean!
    revokedAt: DateTime
    revocationReason: String
    createdAt: DateTime
    updatedAt: DateTime
  }

  input RenownCredentialsInput {
    driveId: String
    ethAddress: String
    did: String
    issuer: String
    includeRevoked: Boolean
  }

  type Query {
    renownUser(input: RenownUserInput!): ReadRenownUser
    renownUsers(input: RenownUsersInput!): [ReadRenownUser!]!
    renownCredentials(input: RenownCredentialsInput!): [ReadRenownCredential!]!
    """
    Whether a handle can be claimed. A handle the profile of \`address\` already
    holds counts as available to that address.
    """
    renownHandleAvailability(handle: String!, address: String): RenownHandleAvailability!
  }
`;
