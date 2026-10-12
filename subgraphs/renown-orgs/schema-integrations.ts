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

/** Every A3 block; later tasks append theirs. */
export const INTEGRATIONS_SDL = [NOTIFICATIONS_SDL].join("\n");
