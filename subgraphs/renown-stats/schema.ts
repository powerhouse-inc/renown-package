import type { DocumentNode } from "graphql";
import { gql } from "graphql-tag";

export const schema: DocumentNode = gql`
  type UserStat {
    appDid: String!
    metric: String!
    value: Float!
    updatedAt: String!
  }

  type AppProfileLink {
    id: String!
    label: String!
    url: String!
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

  type Query {
    userStats(userDid: String!): [UserStat!]!
    appProfile(appDid: String!): AppProfile
    appProfilesByPublisher(publisherDid: String!): [AppProfile!]!
    "Every app profile, newest first. limit 1-50 (default 20)."
    appProfiles(limit: Int, after: String): AppProfilePage!
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
    ): Boolean!
  }
`;
