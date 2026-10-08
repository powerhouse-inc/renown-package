import type { Kysely } from "kysely";

/** A `timestamptz` column: the driver returns a `Date`, but accepts either on write. */
export type Timestamp = Date | string;

export interface UserStatsDocumentRow {
  user_did: string;
  document_id: string;
  created_at: Timestamp;
}

export interface AppProfileDocumentRow {
  app_did: string;
  document_id: string;
  /** Lowercase wallet address of the publisher. */
  publisher_address: string;
  created_at: Timestamp;
}

export interface StatsDB {
  user_stats_documents: UserStatsDocumentRow;
  app_profile_documents: AppProfileDocumentRow;
}

export type StatsKysely = Kysely<StatsDB>;

export interface AppProfileEntry {
  appDid: string;
  documentId: string;
  publisherAddress: string;
}

/** Which document holds each user's stats and each app's profile. */
export interface StatsIndex {
  userStatsDocument(userDid: string): Promise<string | undefined>;
  /** Records `documentId` for `userDid` unless one is recorded; returns the recorded id. */
  claimUserStatsDocument(userDid: string, documentId: string, now: Date): Promise<string>;
  appProfile(appDid: string): Promise<AppProfileEntry | undefined>;
  /** Records `entry` unless the app DID is recorded; returns the recorded entry. */
  claimAppProfile(entry: AppProfileEntry, now: Date): Promise<AppProfileEntry>;
  appProfilesByPublisher(publisherAddress: string): Promise<AppProfileEntry[]>;
}
