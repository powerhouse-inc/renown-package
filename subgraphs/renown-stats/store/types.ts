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
  /** The profile's category as last saved (trimmed); null when none. Absent on insert. */
  category?: string | null;
}

/** The uploaded images of one app-profile document (refs as stored on the document). */
export interface AppProfileImagesRow {
  document_id: string;
  logo_ref: string | null;
  cover_ref: string | null;
  updated_at: Timestamp;
}

/** One user's current value of one app metric (last accepted report). */
export interface AppMetricValueRow {
  app_did: string;
  metric: string;
  user_did: string;
  value: number;
  updated_at: Timestamp;
}

/** One-time jobs that have completed (e.g. the metric backfill). */
export interface StatsJobRow {
  name: string;
  completed_at: Timestamp;
}

export interface StatsDB {
  user_stats_documents: UserStatsDocumentRow;
  app_profile_documents: AppProfileDocumentRow;
  app_profile_images: AppProfileImagesRow;
  app_metric_values: AppMetricValueRow;
  renown_stats_jobs: StatsJobRow;
}

export interface MetricValue {
  appDid: string;
  metric: string;
  userDid: string;
  value: number;
  /** When the report was accepted (backfill: the document's updatedAt). */
  updatedAt: Date;
}

/** Raw aggregates of one metric over every user's current value. */
export interface MetricAggregate {
  metric: string;
  /** Users with a value. */
  users: number;
  sum: number;
  max: number;
  avg: number;
  /** Users whose value is above zero. */
  positiveUsers: number;
  /** Highest values first; ties: earlier report, then user DID. */
  top: { userDid: string; value: number }[];
}

/** A non-empty category and how many profiles carry it (case-insensitively). */
export interface AppCategoryCount {
  /** The smallest spelling (byte order) among the profiles that carry it. */
  category: string;
  count: number;
}

/** Network-wide counts from the stats index. */
export interface NetworkActivity {
  /** App profiles. */
  apps: number;
  /** Distinct users with any stat reported to any app since the given time. */
  activeUsers: number;
}

export interface AppActivity {
  /** Users with any stat for the app. */
  totalUsers: number;
  /** Users with any stat for the app reported since the given time. */
  activeUsers: number;
  /** The latest report for the app, or null. */
  updatedAt: Date | null;
}

export interface UserStatsDocumentEntry {
  userDid: string;
  documentId: string;
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
  /**
   * Up to `limit` profiles, newest first, strictly after `after`; with
   * `category`, only profiles whose category equals it case-insensitively.
   */
  appProfilesPage(limit: number, after?: AppProfileCursor, category?: string): Promise<AppProfileListEntry[]>;
  /** Records a profile's category ("" or blank stores null); a DID without a profile is ignored. */
  setAppCategory(appDid: string, category: string | null): Promise<void>;
  /** Non-empty categories with their profile counts: count desc, then name. */
  appProfileCategories(): Promise<AppCategoryCount[]>;
  /** App profiles, and distinct users reporting to any app since `since`. */
  networkActivity(since: Date): Promise<NetworkActivity>;
  /** Upserts current values; per key the newest updatedAt wins (equal overwrites, older is ignored). */
  recordMetricValues(values: readonly MetricValue[]): Promise<void>;
  /** Aggregates of the given metrics of an app that have at least one value. */
  metricAggregates(appDid: string, metrics: readonly string[], top: number): Promise<MetricAggregate[]>;
  appActivity(appDid: string, since: Date): Promise<AppActivity>;
  /** Up to `limit` user-stats documents ordered by user DID, strictly after `afterUserDid`. */
  userStatsDocumentsPage(limit: number, afterUserDid?: string): Promise<UserStatsDocumentEntry[]>;
  jobDone(name: string): Promise<boolean>;
  markJobDone(name: string, at: Date): Promise<void>;
}

export interface AppProfileListEntry extends AppProfileEntry {
  createdAt: Date;
}
