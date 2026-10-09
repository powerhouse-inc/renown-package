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

/** The uploaded images of one app-profile document (refs as stored on the document). */
export interface AppProfileImagesRow {
  document_id: string;
  logo_ref: string | null;
  cover_ref: string | null;
  updated_at: Timestamp;
}

export interface StatsDB {
  user_stats_documents: UserStatsDocumentRow;
  app_profile_documents: AppProfileDocumentRow;
  app_profile_images: AppProfileImagesRow;
}

export type AppImageField = "logo" | "cover";

/** undefined leaves an image unchanged; null clears it. */
export interface AppImagesPatch {
  logoRef?: string | null;
  coverRef?: string | null;
}

/** Position in the newest-first profile listing. */
export interface AppProfileCursor {
  createdAt: Date;
  appDid: string;
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
  /** Records the given image refs of a profile document; others are kept. */
  setAppImages(documentId: string, images: AppImagesPatch, now: Date): Promise<void>;
  /** The stored ref of a profile document's image, or null. */
  appImageRef(documentId: string, field: AppImageField): Promise<string | null>;
  /** Up to `limit` profiles, newest first, strictly after `after`. */
  appProfilesPage(limit: number, after?: AppProfileCursor): Promise<AppProfileListEntry[]>;
}

export interface AppProfileListEntry extends AppProfileEntry {
  createdAt: Date;
}
