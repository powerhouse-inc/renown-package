/** The A1 surface of renown-orgs: organizations, membership, teams, directory, audit log. */
export const CORE_SDL = `
  enum OrgRole {
    OWNER
    ADMIN
    PUBLISHER
    MEMBER
  }

  "EXPIRED is computed: an INVITED record older than 14 days."
  enum OrgMemberStatus {
    INVITED
    ACTIVE
    DECLINED
    LEFT
    REMOVED
    REVOKED
    EXPIRED
  }

  enum OrgHandleProblem {
    INVALID
    RESERVED
    TAKEN
  }

  enum OrgSecurityWarning {
    SINGLE_OWNER
  }

  """
  Proof for callers without a bearer: personal_sign by address over
  orgMessage(<field name>, <orgId argument or ->, <the other arguments>, timestamp)
  from sdk/orgs.ts. timestamp: ISO-8601 with a zone, within 10 minutes of the server clock.
  A present auth is always checked and never falls back to the bearer.
  """
  input OrgAuthInput {
    address: String!
    signature: String!
    timestamp: String!
  }

  input OrgLinkInput {
    id: String!
    label: String!
    url: String!
  }

  input OrgAppScopeInput {
    all: Boolean!
    appDids: [String!]!
  }

  type OrgLink {
    id: String!
    label: String!
    url: String!
  }

  type OrgAppScope {
    all: Boolean!
    appDids: [String!]!
  }

  type OrgSummary {
    id: String!
    did: String!
    handle: String!
    name: String!
    avatar: String
    verifiedDomains: [String!]!
  }

  type OrgApp {
    appDid: String!
    addedAt: String!
    frozen: Boolean!
  }

  type OrgTeam {
    id: String!
    orgId: String!
    slug: String!
    name: String!
    appDids: [String!]!
    memberAddresses: [String!]!
  }

  type OrgMembership {
    orgId: String!
    address: String!
    role: OrgRole!
    status: OrgMemberStatus!
    "The membership's own scope (all for owners and admins)."
    appScope: OrgAppScope!
    "appScope plus the app DIDs of the member's teams."
    effectiveScope: OrgAppScope!
    "Slugs of the member's teams."
    teams: [String!]!
  }

  type Organization {
    id: String!
    "did:web:<RENOWN_ORG_DID_HOST>:org:<id>"
    did: String!
    handle: String!
    name: String!
    bio: String
    website: String
    "attachment://v1:<sha256>; served at <renown>/media/<id>/avatar"
    avatar: String
    links: [OrgLink!]!
    listed: Boolean!
    membersPublic: Boolean!
    archived: Boolean!
    takenDown: Boolean!
    createdBy: String!
    createdAt: String!
    updatedAt: String!
    verifiedDomains: [String!]!
    "Another organization with a verified domain and the same name (case-insensitive), shown when this one has none."
    notAffiliatedWith: OrgSummary
    ownerCount: Int!
    memberCount: Int!
    securityWarnings: [OrgSecurityWarning!]!
    apps: [OrgApp!]!
    "Only for active members of the organization; [] otherwise."
    teams: [OrgTeam!]!
    "The caller's ACTIVE membership, when the caller proves an address."
    viewerMembership: OrgMembership
  }

  type OrgMember {
    "The membership record id; also the invite id while INVITED."
    id: String!
    orgId: String!
    address: String!
    role: OrgRole!
    status: OrgMemberStatus!
    appScope: OrgAppScope!
    hidden: Boolean!
    invitedBy: String
    invitedAt: String!
    joinedAt: String
    endedAt: String
    updatedAt: String!
    "invitedAt + 14 days while INVITED or EXPIRED; null otherwise."
    expiresAt: String
    teams: [String!]!
    handle: String
    displayName: String
    avatar: String
  }

  type OrgAffiliation {
    org: Organization!
    role: OrgRole!
    hidden: Boolean!
  }

  type OrgSearchPage {
    items: [Organization!]!
    next: String
  }

  type OrgInvite {
    id: String!
    orgId: String!
    org: OrgSummary!
    address: String!
    role: OrgRole!
    status: OrgMemberStatus!
    invitedBy: String
    createdAt: String!
    expiresAt: String!
  }

  type OrgInviteLink {
    id: String!
    orgId: String!
    role: OrgRole!
    maxUses: Int!
    uses: Int!
    expiresAt: String!
    revoked: Boolean!
    createdBy: String!
    createdAt: String!
  }

  type OrgInviteLinkCreated {
    link: OrgInviteLink!
    "Shown once; only its SHA-256 is stored."
    token: String!
  }

  type OrgInviteLinkPreview {
    org: OrgSummary!
    role: OrgRole!
    expiresAt: String!
    expired: Boolean!
    revoked: Boolean!
    "maxUses reached"
    full: Boolean!
    usable: Boolean!
  }

  type OrgHandleAvailability {
    "As it would be stored (trimmed, lowercased)"
    handle: String!
    available: Boolean!
    reason: OrgHandleProblem
  }

  type OrgAuditEntry {
    id: String!
    orgId: String!
    at: String!
    "Lowercase address, or system"
    actor: String!
    action: String!
    "JSON object"
    details: String!
  }

  type OrgAuditPage {
    items: [OrgAuditEntry!]!
    next: String
  }

  type Query {
    "By id or by handle (exactly one). Taken-down organizations come back with their profile emptied."
    organization(id: String, handle: String, auth: OrgAuthInput): Organization
    "Listed organizations; query (2-40 characters) prefix-matches handle or name, absent or blank lists all. limit 1-50 (default 20)."
    organizationSearch(query: String, limit: Int, after: String): OrgSearchPage!
    "Public memberships, or all ACTIVE ones (hidden included) when the caller proves address."
    organizationsByMember(address: String!, auth: OrgAuthInput): [OrgAffiliation!]!
    "Active members see everyone active (hidden included); admins with includeInactive see every record; others see the public list."
    organizationMembers(orgId: String!, includeInactive: Boolean, auth: OrgAuthInput): [OrgMember!]!
    "Public: an ACTIVE membership's role, status and scopes; null otherwise."
    orgMembership(orgId: String!, address: String!): OrgMembership
    "Admins: pending (INVITED and EXPIRED) direct invites."
    orgInvites(orgId: String!, auth: OrgAuthInput): [OrgInvite!]!
    "Admins: invite links, newest first."
    orgInviteLinks(orgId: String!, auth: OrgAuthInput): [OrgInviteLink!]!
    "The caller's pending invites."
    myOrgInvites(auth: OrgAuthInput): [OrgInvite!]!
    "Public preview of an invite link token."
    orgInviteLink(token: String!): OrgInviteLinkPreview
    orgHandleAvailability(handle: String!): OrgHandleAvailability!
    "Admins: newest first. limit 1-100 (default 50)."
    orgAuditLog(orgId: String!, limit: Int, after: String, auth: OrgAuthInput): OrgAuditPage!
  }

  type Mutation {
    createOrganization(
      handle: String!
      name: String!
      bio: String
      website: String
      links: [OrgLinkInput!]
      listed: Boolean
      membersPublic: Boolean
      auth: OrgAuthInput
    ): Organization!
    "Admins. Absent or null keeps a field, an empty string clears bio, website or avatar, links replaces the list."
    updateOrganization(
      orgId: String!
      name: String
      bio: String
      website: String
      avatar: String
      links: [OrgLinkInput!]
      membersPublic: Boolean
      auth: OrgAuthInput
    ): Organization!
    setOrgListed(orgId: String!, listed: Boolean!, auth: OrgAuthInput): Organization!
    "invitee: a 0x address or a Renown user handle. role up to ADMIN (ADMIN needs an owner)."
    inviteOrgMember(orgId: String!, invitee: String!, role: OrgRole!, auth: OrgAuthInput): OrgInvite!
    respondToOrgInvite(orgId: String!, inviteId: String!, accept: Boolean!, auth: OrgAuthInput): OrgMember!
    revokeOrgInvite(orgId: String!, inviteId: String!, auth: OrgAuthInput): OrgInvite!
    "role MEMBER or PUBLISHER; maxUses 1-100; expiresAt within 30 days."
    createOrgInviteLink(orgId: String!, role: OrgRole!, maxUses: Int!, expiresAt: String!, auth: OrgAuthInput): OrgInviteLinkCreated!
    revokeOrgInviteLink(orgId: String!, linkId: String!, auth: OrgAuthInput): OrgInviteLink!
    acceptOrgInviteLink(token: String!, auth: OrgAuthInput): OrgMember!
    leaveOrganization(orgId: String!, auth: OrgAuthInput): Boolean!
    removeOrgMember(orgId: String!, address: String!, auth: OrgAuthInput): OrgMember!
    "role up to ADMIN; owners change through proposals."
    setOrgMemberRole(orgId: String!, address: String!, role: OrgRole!, auth: OrgAuthInput): OrgMember!
    setOrgMemberAppScope(orgId: String!, address: String!, appScope: OrgAppScopeInput!, auth: OrgAuthInput): OrgMember!
    setMyOrgMembershipHidden(orgId: String!, hidden: Boolean!, auth: OrgAuthInput): OrgMember!
    createOrgTeam(orgId: String!, slug: String!, name: String!, appDids: [String!], auth: OrgAuthInput): OrgTeam!
    updateOrgTeam(orgId: String!, teamId: String!, slug: String, name: String, appDids: [String!], auth: OrgAuthInput): OrgTeam!
    deleteOrgTeam(orgId: String!, teamId: String!, auth: OrgAuthInput): Boolean!
    "addresses: ACTIVE members; replaces the team's members."
    setOrgTeamMembers(orgId: String!, teamId: String!, addresses: [String!]!, auth: OrgAuthInput): OrgTeam!
  }
`;
