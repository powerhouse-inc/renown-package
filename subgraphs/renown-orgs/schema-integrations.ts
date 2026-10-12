/** A3 SDL, one block per area; each block extends the A1 root types. */
export const NOTIFICATIONS_SDL = `
  enum OrgNotificationKind {
    INVITED
    INVITE_ACCEPTED
    ROLE_CHANGED
    REMOVED
    PROPOSAL_CREATED
    PROPOSAL_NEEDS_APPROVAL
    PROPOSAL_EXECUTED
    PROPOSAL_CANCELLED
    RECOVERY_STARTED
    APP_TRANSFER_REQUEST
    APP_TRANSFER_DONE
    APP_FROZEN
    DOMAIN_LAPSED
    "An active member delegated a key for one of the organisation's apps (sent to admins)."
    DELEGATION_ADDED
  }

  type OrgNotification {
    id: String!
    kind: OrgNotificationKind!
    orgId: String!
    "Null when the organisation no longer exists"
    org: OrgSummary
    "JSON object"
    payload: String!
    createdAt: String!
    readAt: String
  }

  type OrgNotificationPage {
    items: [OrgNotification!]!
    next: String
  }

  extend type Query {
    "The caller's notifications, newest first; limit 1-50 (default 20)."
    myNotifications(unreadOnly: Boolean, limit: Int, after: String, auth: OrgAuthInput): OrgNotificationPage!
    myUnreadNotificationCount(auth: OrgAuthInput): Int!
  }

  extend type Mutation {
    "Exactly one of ids (the caller's own) and all: true. Returns how many became read."
    markNotificationsRead(ids: [String!], all: Boolean, auth: OrgAuthInput): Int!
  }
`;

export const WEBHOOKS_SDL = `
  enum OrgWebhookDeliveryStatus {
    PENDING
    DELIVERED
    FAILED
  }

  type OrgWebhook {
    id: String!
    orgId: String!
    url: String!
    events: [String!]!
    enabled: Boolean!
    consecutiveFailures: Int!
    createdAt: String!
  }

  type OrgWebhookCreated {
    webhook: OrgWebhook!
    "Shown once"
    secret: String!
  }

  type OrgWebhookDelivery {
    id: String!
    webhookId: String!
    eventId: String!
    eventType: String!
    status: OrgWebhookDeliveryStatus!
    attempts: Int!
    responseStatus: Int
    lastError: String
    createdAt: String!
    nextAttemptAt: String
    deliveredAt: String
  }

  extend type Query {
    "Admins."
    orgWebhooks(orgId: String!, auth: OrgAuthInput): [OrgWebhook!]!
    "Admins: newest first; limit 1-100 (default 20)."
    orgWebhookDeliveries(orgId: String!, webhookId: String!, limit: Int, auth: OrgAuthInput): [OrgWebhookDelivery!]!
  }

  extend type Mutation {
    "Admins; at most 10 endpoints; an https URL on port 443 or 8443 that resolves to public addresses; events from the documented list."
    createOrgWebhook(orgId: String!, url: String!, events: [String!]!, auth: OrgAuthInput): OrgWebhookCreated!
    "enabled: true also resets consecutiveFailures."
    updateOrgWebhook(orgId: String!, webhookId: String!, url: String, events: [String!], enabled: Boolean, auth: OrgAuthInput): OrgWebhook!
    deleteOrgWebhook(orgId: String!, webhookId: String!, auth: OrgAuthInput): Boolean!
    "Sends a ping event at once (one attempt)."
    testOrgWebhook(orgId: String!, webhookId: String!, auth: OrgAuthInput): OrgWebhookDelivery!
  }
`;

export const OIDC_SDL = `
  enum OrgOidcClientStatus {
    ACTIVE
    DISABLED
  }

  "An OIDC client owned by an organisation: only its active members may sign in to it."
  type OrgOidcClient {
    clientId: String!
    orgId: String!
    name: String!
    redirectUris: [String!]!
    status: OrgOidcClientStatus!
    createdAt: String!
  }

  type OrgOidcClientCredentials {
    clientId: String!
    "Shown once; only its hash is stored."
    clientSecret: String!
  }

  extend type Query {
    "Admins: the organisation's own OIDC clients (never their secrets); DISABLED while the organisation is archived or taken down."
    orgOidcClients(orgId: String!, auth: OrgAuthInput): [OrgOidcClient!]!
  }

  extend type Mutation {
    "Admins: a confidential client only the organisation's active members may sign in to. At most 20 per organisation, disabled ones included (LIMIT_REACHED)."
    registerOrgOidcClient(orgId: String!, name: String!, redirectUris: [String!]!, auth: OrgAuthInput): OrgOidcClientCredentials!
    "Admins: renames, changes redirect URIs (removals before additions) or disables/enables the client."
    updateOrgOidcClient(
      orgId: String!
      clientId: String!
      name: String
      addRedirectUris: [String!]
      removeRedirectUris: [String!]
      status: OrgOidcClientStatus
      auth: OrgAuthInput
    ): OrgOidcClient!
    "Admins: a new secret, shown once; the old one stops working."
    rotateOrgOidcClientSecret(orgId: String!, clientId: String!, auth: OrgAuthInput): OrgOidcClientCredentials!
  }
`;

/** Every A3 block; later tasks append theirs. */
export const MODERATION_SDL = `
  enum OrgReportReason {
    IMPERSONATION
    HANDLE_DISPUTE
    SPAM
    ABUSE
    OTHER
  }

  enum OrgReportStatus {
    OPEN
    RESOLVED
  }

  enum OrgReportResolution {
    DISMISS
    "takenDown=true: notice page; out of the directory, search, claims and did.json; OIDC clients and webhooks stop"
    TAKE_DOWN
    "Renames the organisation to org-<first 8 of id>; the old handle is reserved 30 days for the org verified for <handle>.<tld>"
    RELEASE_HANDLE
    "takenDown=false"
    RESTORE
  }

  type OrgReport {
    id: String!
    orgId: String!
    "Null when the organisation no longer exists"
    org: OrgSummary
    reporter: String!
    reason: OrgReportReason!
    details: String
    status: OrgReportStatus!
    resolution: OrgReportResolution
    resolvedBy: String
    resolvedAt: String
    note: String
    createdAt: String!
  }

  extend type Query {
    "Platform admins (RENOWN_PLATFORM_ADMINS) only; newest first."
    orgReports(status: OrgReportStatus, auth: OrgAuthInput): [OrgReport!]!
    "Admins: a JSON array of the newest 10 000 audit entries, newest first; 10 exports an hour per caller."
    orgAuditExport(orgId: String!, auth: OrgAuthInput): String!
  }

  extend type Mutation {
    "Anyone signed in; details at most 1000 characters; 5 reports per address per day."
    reportOrganization(orgId: String!, reason: OrgReportReason!, details: String, auth: OrgAuthInput): Boolean!
    "Platform admins only; each report is resolved once and audited on the organisation."
    resolveOrgReport(reportId: String!, resolution: OrgReportResolution!, note: String, auth: OrgAuthInput): OrgReport!
  }
`;

export const INTEGRATIONS_SDL = [NOTIFICATIONS_SDL, WEBHOOKS_SDL, OIDC_SDL, MODERATION_SDL].join("\n");
