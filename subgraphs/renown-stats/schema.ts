import type { DocumentNode } from "graphql";
import { gql } from "graphql-tag";

export const schema: DocumentNode = gql`
  type UserStat {
    appDid: String!
    metric: String!
    value: Float!
    updatedAt: String!
    "The app's profile name, when it has a profile."
    appName: String
    "The app's profile document: its logo is <renown>/media/<appDocumentId>/logo when appHasLogo."
    appDocumentId: String
    appHasLogo: Boolean!
    "The app logo's attachment ref; media URL: <renown>/media/<appDocumentId>/logo?v=<first 12 hex of the ref's sha256>."
    appLogoRef: String
    "Legacy logo URL of the app (https or raster data URL)."
    appLogo: String
    "Set when the app declares this metric public; null for undeclared metrics."
    label: String
    unit: String
  }

  type MetricContributor {
    userDid: String!
    value: Float!
    "The wallet behind a did:pkh user; null for did:key users."
    address: String
    handle: String
    displayName: String
    "The contributor's Renown profile document (avatar at <renown>/media/<documentId>/avatar when hasAvatar)."
    documentId: String
    hasAvatar: Boolean!
    "The avatar's attachment ref; media URL: <renown>/media/<documentId>/avatar?v=<first 12 hex of the ref's sha256>."
    avatar: String
    userImage: String
  }

  type AppMetricStat {
    key: String!
    label: String!
    unit: String
    description: String
    aggregation: RenownMetricAggregation!
    "SUM, MAX or AVG of users' current values, or (COUNT_USERS) users with a value above zero."
    value: Float!
    "Users with a value."
    users: Int!
    "Top 5 by value."
    top: [MetricContributor!]!
  }

  type AppStats {
    appDid: String!
    "Users the app reported anything about in the last 30 days."
    activeUsers30d: Int!
    totalUsers: Int!
    "Declared public metrics, in the publisher's order."
    metrics: [AppMetricStat!]!
    "ISO time of the latest report, or null."
    updatedAt: String
  }

  type AppProfileLink {
    id: String!
    label: String!
    url: String!
  }

  enum RenownMetricAggregation {
    SUM
    MAX
    AVG
    COUNT_USERS
  }

  "A publisher-defined metric: what the app reports as key, and how Renown shows it."
  type AppMetric {
    id: String!
    key: String!
    label: String!
    unit: String
    description: String
    aggregation: RenownMetricAggregation!
    "Shown on the app page and on user profiles."
    public: Boolean!
  }

  type AppProfile {
    appDid: String!
    "The profile document; its images are at <renown>/media/<documentId>/logo and /cover."
    documentId: String!
    name: String
    tagline: String
    "Legacy logo (https or raster data URL); prefer logoRef."
    logo: String
    website: String
    publisherDid: String
    "Markdown subset; render it sanitized."
    description: String
    category: String
    logoRef: String
    coverRef: String
    links: [AppProfileLink!]!
    metrics: [AppMetric!]!
  }

  type AppProfilePage {
    items: [AppProfile!]!
    "Pass as after for the next page; null on the last page."
    next: String
  }

  input AppProfileLinkInput {
    id: String!
    label: String!
    url: String!
  }

  input AppMetricInput {
    id: String!
    "^[A-Za-z][A-Za-z0-9_.:-]{0,63}$, unique per app"
    key: String!
    "1-40 characters"
    label: String!
    "At most 16 characters; empty means none"
    unit: String
    "At most 200 characters; empty means none"
    description: String
    aggregation: RenownMetricAggregation!
    public: Boolean!
  }

  type Query {
    userStats(userDid: String!): [UserStat!]!
    appProfile(appDid: String!): AppProfile
    appProfilesByPublisher(publisherDid: String!): [AppProfile!]!
    "Every app profile, newest first. limit 1-50 (default 20)."
    appProfiles(limit: Int, after: String): AppProfilePage!
    "Public stats of an app; null when it has neither a profile nor any reported value."
    appStats(appDid: String!): AppStats
  }

  type Mutation {
    "Caller must authenticate as appDid (bearer whose issuer/subject is the app DID)."
    reportUserStat(
      appDid: String!
      userDid: String!
      metric: String!
      value: Float!
    ): Boolean!
    """
    Caller: the bearer of the identity owner's wallet (first write) or of the
    recorded publisher, relayed by the registration-token holder
    (X-Renown-Workload-Registration-Token) or signed by an app key listed in
    RENOWN_STATS_PROFILE_APPS. Absent or null fields are unchanged, "" clears,
    links replaces the whole list. Errors: FORBIDDEN, BAD_USER_INPUT and
    INVALID_IMAGE (extensions.field), RATE_LIMITED, SERVICE_UNAVAILABLE.
    """
    upsertAppProfile(
      appDid: String!
      name: String
      tagline: String
      logo: String
      website: String
      description: String
      category: String
      logoRef: String
      coverRef: String
      links: [AppProfileLinkInput!]
      "The whole metric list (at most 16); [] clears."
      metrics: [AppMetricInput!]
    ): Boolean!
  }
`;
