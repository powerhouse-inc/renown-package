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
export const WORKLOADS_SDL = `
  "A service account of the organisation: a renown-workload identity registered for it."
  type OrgWorkload {
    did: String!
    repository: String!
    productionBranch: String!
    ownerAddress: String!
    disabled: Boolean!
    createdAt: String!
  }

  extend type Query {
    "Admins: the organisation's service accounts (workload identities)."
    orgWorkloads(orgId: String!, auth: OrgAuthInput): [OrgWorkload!]!
  }

  extend type Mutation {
    "Admins: a disabled identity gets no tokens."
    setOrgWorkloadDisabled(orgId: String!, did: String!, disabled: Boolean!, auth: OrgAuthInput): OrgWorkload!
  }
`;

export const CREDENTIALS_SDL = `
  enum OrgCredentialReason {
    ISSUER_NOT_MEMBER
    ISSUER_NOT_PUBLISHER
    SUSPENDED
    APP_FROZEN
  }

  type OrgCredentialStatus {
    credentialId: String!
    appDid: String
    orgId: String
    "Whether organisation rules let the delegation count (revocation and expiry are reported by renownCredentials)."
    counts: Boolean!
    reason: OrgCredentialReason
  }

  type OrgCredential {
    credentialId: String!
    documentId: String!
    appDid: String!
    issuer: String!
    issuerRole: OrgRole
    issuerStatus: OrgMemberStatus
    issuanceDate: String!
    expirationDate: String
    revoked: Boolean!
    status: OrgCredentialStatus!
  }

  extend type Query {
    "Admins: delegations for the organisation's apps (newest 500)."
    orgCredentials(orgId: String!, auth: OrgAuthInput): [OrgCredential!]!
    "Public: whether a delegation credential counts under organisation rules; null for an unknown credential."
    orgCredentialStatus(credentialId: String!): OrgCredentialStatus
  }

  extend type Mutation {
    "Admins: exactly one of credentialIds (at most 100) and memberAddress (all of that member's live delegations for org apps). Returns the newly suspended ids."
    suspendOrgCredentials(orgId: String!, credentialIds: [String!], memberAddress: String, auth: OrgAuthInput): [String!]!
    unsuspendOrgCredential(orgId: String!, credentialId: String!, auth: OrgAuthInput): Boolean!
  }
`;

export const TRANSFERS_SDL = `
  enum AppTransferStatus {
    PENDING
    ACCEPTED
    DECLINED
    CANCELLED
    EXPIRED
  }

  type AppTransfer {
    id: String!
    appDid: String!
    fromKind: OrgPartyKind!
    "Lowercase address (PERSON) or organization id (ORG)."
    fromId: String!
    toKind: OrgPartyKind!
    toId: String!
    status: AppTransferStatus!
    createdAt: String!
    "PENDING transfers expire 14 days after they were made."
    expiresAt: String!
    decidedAt: String
    decidedBy: String
    "The TRANSFER_APP_OUT proposal that made it."
    proposalId: String
  }

  extend type Query {
    "Transfers the caller is part of: by orgId (admins), by address (that address), or by appDid (either side's)."
    appTransfers(appDid: String, orgId: String, address: String, auth: OrgAuthInput): [AppTransfer!]!
  }

  extend type Mutation {
    "The app's personal publisher offers it to an organization; an admin of that organization accepts."
    proposeAppTransfer(appDid: String!, toOrgId: String!, auth: OrgAuthInput): AppTransfer!
    "The recipient (the person, or an admin of the organization) accepts: the app, its profile and its workload identity move. Errors also APP_FROZEN."
    acceptAppTransfer(transferId: String!, auth: OrgAuthInput): AppTransfer!
    "The recipient declines (DECLINED) or the source withdraws (CANCELLED)."
    declineAppTransfer(transferId: String!, auth: OrgAuthInput): AppTransfer!
  }
`;

export const ATTESTATIONS_SDL = `
  type ReleaseAttestation {
    id: String!
    appDid: String!
    version: String!
    "sha256:<64 lowercase hex>"
    artifactDigest: String!
    "The owning organization when signed; empty for person-owned apps."
    orgId: String!
    "Lowercase address."
    signer: String!
    "The signer's role when the attestation was accepted; null for person-owned apps."
    signerRole: OrgRole
    "Organization apps: the signer's membership of that time is still ACTIVE (never ended since). Person apps: the signer still publishes the app."
    signerStillMember: Boolean!
    "As signed (ISO-8601)."
    issuedAt: String!
    signature: String!
    "When renown-orgs accepted it."
    createdAt: String!
  }

  type ReleaseAttestationPage {
    items: [ReleaseAttestation!]!
    next: String
  }

  extend type Query {
    "Public: an app's release attestations, newest first; limit 1-50 (20 when omitted)."
    releaseAttestations(appDid: String!, limit: Int, after: String): ReleaseAttestationPage!
    "Public: one attestation, for /verify's cross-check; null when unknown."
    releaseAttestation(id: String!): ReleaseAttestation
  }

  extend type Mutation {
    """
    Stores an EIP-712 ReleaseAttestation (domain Renown Release / 1 / chain 1; sdk RELEASE_DOMAIN and RELEASE_TYPES)
    signed by signer (EOA, or ERC-1271/6492 smart wallet): the signature is the authentication. The signer must publish
    the app at submit time: its personal publisher (orgId empty) or an ACTIVE PUBLISHER+ of the owning organization
    whose scope covers it (orgId that organization). issuedAt: at most 5 minutes ahead, at most 30 days old. One per
    app, version and signer (resubmitting the same signature returns it); at most 100 per app per day (LIMIT_REACHED).
    Errors also APP_FROZEN.
    """
    attestRelease(appDid: String!, version: String!, artifactDigest: String!, orgId: String!, issuedAt: String!, signer: String!, signature: String!): ReleaseAttestation!
  }
`;

export const INSIGHTS_SDL = `
  type OrganizationStats {
    orgId: String!
    apps: Int!
    "Each app's distinct users with a metric report in the last 30 days, summed: an upper bound (a user of two apps counts twice)."
    activeUsers30d: Int!
    "Unrevoked, unexpired delegations for the organization's apps that count under organization rules (the newest 2000 live ones are checked)."
    activeDelegations: Int!
    "Release attestations accepted in the last 30 days."
    attestations30d: Int!
  }

  extend type Query {
    "Public totals; null when the organization is unknown or taken down."
    organizationStats(orgId: String!): OrganizationStats
    "Public: the DID document (JSON) of did:web:<host>:org:<orgId>; null when unknown, archived or taken down (did.json answers 404)."
    organizationDidDocument(orgId: String!): String
  }
`;

export const SECURITY_SDL = [PROPOSALS_SDL, DOMAINS_SDL, WORKLOADS_SDL, CREDENTIALS_SDL, TRANSFERS_SDL, ATTESTATIONS_SDL, INSIGHTS_SDL].join("\n");
