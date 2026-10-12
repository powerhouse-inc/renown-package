/** A2 SDL, one block per area; each block extends the A1 root types. */
export const PROPOSALS_SDL = `
  enum OrgProposalKind {
    ADD_OWNER
    REMOVE_OWNER
    TRANSFER_APP_OUT
    CHANGE_HANDLE
    DELETE_ORG
    RECOVER
    FREEZE_APP
    UNFREEZE_APP
  }

  enum OrgProposalStatus {
    PENDING
    EXECUTED
    CANCELLED
    EXPIRED
    FAILED
  }

  enum OrgPartyKind {
    PERSON
    ORG
  }

  "Per kind: ADD_OWNER address; REMOVE_OWNER address, demoteToAdmin; TRANSFER_APP_OUT appDid, toKind, toId; CHANGE_HANDLE handle; DELETE_ORG nothing; FREEZE_APP and UNFREEZE_APP appDid. RECOVER only through startOrgRecovery."
  input OrgProposalPayloadInput {
    address: String
    demoteToAdmin: Boolean
    appDid: String
    toKind: OrgPartyKind
    toId: String
    handle: String
  }

  type OrgProposalPayload {
    address: String
    demoteToAdmin: Boolean
    appDid: String
    toKind: OrgPartyKind
    toId: String
    handle: String
    domain: String
  }

  type OrgProposal {
    id: String!
    orgId: String!
    kind: OrgProposalKind!
    payload: OrgProposalPayload!
    proposer: String!
    approvals: [String!]!
    threshold: Int!
    status: OrgProposalStatus!
    createdAt: String!
    "Set once approvals reach the threshold: max(createdAt + delay, when the threshold was reached)."
    executableAt: String
    expiresAt: String!
    executedAt: String
    "Why it FAILED or was CANCELLED"
    reason: String
  }

  extend type Query {
    "Admins and owners; newest first."
    orgProposals(orgId: String!, status: OrgProposalStatus, auth: OrgAuthInput): [OrgProposal!]!
  }

  extend type Mutation {
    proposeOrgChange(orgId: String!, kind: OrgProposalKind!, payload: OrgProposalPayloadInput!, auth: OrgAuthInput): OrgProposal!
    approveOrgProposal(orgId: String!, proposalId: String!, auth: OrgAuthInput): OrgProposal!
    cancelOrgProposal(orgId: String!, proposalId: String!, auth: OrgAuthInput): OrgProposal!
    "Runs a matured proposal; a proposal whose preconditions no longer hold comes back FAILED with a reason."
    executeOrgProposal(orgId: String!, proposalId: String!, auth: OrgAuthInput): OrgProposal!
  }
`;

export const DOMAINS_SDL = `
  enum OrgDomainStatus {
    PENDING
    VERIFIED
    LAPSED
  }

  type OrgDomain {
    id: String!
    orgId: String!
    domain: String!
    status: OrgDomainStatus!
    verifiedAt: String
    lastCheckedAt: String
    failures: Int!
    createdAt: String!
    "DNS TXT record name: _renown.<domain>"
    txtName: String!
    "DNS TXT record value: renown-org=<orgId>;token=<token>"
    txtValue: String!
    "https://<domain>/.well-known/renown.json"
    wellKnownUrl: String!
    "A renown.json body that proves the domain"
    wellKnownJson: String!
  }

  extend type Query {
    "Admins."
    orgDomains(orgId: String!, auth: OrgAuthInput): [OrgDomain!]!
  }

  extend type Mutation {
    "Admins; at most 10 domains. DOMAIN_TAKEN when another organization has it verified."
    addOrgDomain(orgId: String!, domain: String!, auth: OrgAuthInput): OrgDomain!
    "Admins. DOMAIN_PROOF_MISSING when neither the TXT record nor renown.json proves it."
    checkOrgDomain(orgId: String!, domainId: String!, auth: OrgAuthInput): OrgDomain!
    removeOrgDomain(orgId: String!, domainId: String!, auth: OrgAuthInput): Boolean!
    "Anyone signed in: a RECOVER proposal (no approvals, recovery delay) proven by a domain verified for at least 14 days."
    startOrgRecovery(orgId: String!, domain: String!, newOwner: String!, auth: OrgAuthInput): OrgProposal!
  }
`;

/** Every A2 block; later tasks append theirs. */
export const SECURITY_SDL = [PROPOSALS_SDL, DOMAINS_SDL].join("\n");
