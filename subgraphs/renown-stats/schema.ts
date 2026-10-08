import type { DocumentNode } from "graphql";
import { gql } from "graphql-tag";

export const schema: DocumentNode = gql`
  type UserStat {
    appDid: String!
    metric: String!
    value: Float!
    updatedAt: String!
  }

  type AppProfile {
    appDid: String!
    name: String
    tagline: String
    logo: String
    website: String
    publisherDid: String
  }

  type Query {
    userStats(userDid: String!): [UserStat!]!
    appProfile(appDid: String!): AppProfile
    appProfilesByPublisher(publisherDid: String!): [AppProfile!]!
  }

  type Mutation {
    "Caller must authenticate as appDid (bearer whose issuer/subject is the app DID)."
    reportUserStat(
      appDid: String!
      userDid: String!
      metric: String!
      value: Float!
    ): Boolean!
    "Caller must be the publisherDid."
    upsertAppProfile(
      appDid: String!
      name: String
      tagline: String
      logo: String
      website: String
    ): Boolean!
  }
`;
