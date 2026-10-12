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

/** Every A3 block; later tasks append theirs. */
export const INTEGRATIONS_SDL = [NOTIFICATIONS_SDL, WEBHOOKS_SDL].join("\n");
