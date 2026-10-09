import type {
  AppImageField,
  AppImagesPatch,
  AppProfileCursor,
  AppProfileEntry,
  AppProfileListEntry,
  StatsIndex,
  StatsKysely,
} from "./types.js";

/** Kysely-backed `StatsIndex`. The `db` passed in is already namespace-scoped. */
export class KyselyStatsIndex implements StatsIndex {
  constructor(private readonly db: StatsKysely) {}

  async userStatsDocument(userDid: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom("user_stats_documents")
      .select("document_id")
      .where("user_did", "=", userDid)
      .executeTakeFirst();
    return row?.document_id;
  }

  async claimUserStatsDocument(userDid: string, documentId: string, now: Date): Promise<string> {
    await this.db
      .insertInto("user_stats_documents")
      .values({ user_did: userDid, document_id: documentId, created_at: now })
      .onConflict((oc) => oc.column("user_did").doNothing())
      .execute();
    const recorded = await this.userStatsDocument(userDid);
    if (recorded === undefined) throw new Error(`user_stats_documents lost the row for ${userDid}`);
    return recorded;
  }

  async appProfile(appDid: string): Promise<AppProfileEntry | undefined> {
    const row = await this.db
      .selectFrom("app_profile_documents")
      .select(["app_did", "document_id", "publisher_address"])
      .where("app_did", "=", appDid)
      .executeTakeFirst();
    return row && { appDid: row.app_did, documentId: row.document_id, publisherAddress: row.publisher_address };
  }

  async claimAppProfile(entry: AppProfileEntry, now: Date): Promise<AppProfileEntry> {
    await this.db
      .insertInto("app_profile_documents")
      .values({
        app_did: entry.appDid,
        document_id: entry.documentId,
        publisher_address: entry.publisherAddress,
        created_at: now,
      })
      .onConflict((oc) => oc.column("app_did").doNothing())
      .execute();
    const recorded = await this.appProfile(entry.appDid);
    if (recorded === undefined) throw new Error(`app_profile_documents lost the row for ${entry.appDid}`);
    return recorded;
  }

  async appProfilesByPublisher(publisherAddress: string): Promise<AppProfileEntry[]> {
    const rows = await this.db
      .selectFrom("app_profile_documents")
      .select(["app_did", "document_id", "publisher_address"])
      .where("publisher_address", "=", publisherAddress)
      .orderBy("created_at", "asc")
      .orderBy("app_did", "asc")
      .execute();
    return rows.map((row) => ({
      appDid: row.app_did,
      documentId: row.document_id,
      publisherAddress: row.publisher_address,
    }));
  }

  async setAppImages(documentId: string, images: AppImagesPatch, now: Date): Promise<void> {
    const changes: { logo_ref?: string | null; cover_ref?: string | null; updated_at: Date } = {
      updated_at: now,
    };
    if (images.logoRef !== undefined) changes.logo_ref = images.logoRef;
    if (images.coverRef !== undefined) changes.cover_ref = images.coverRef;
    await this.db
      .insertInto("app_profile_images")
      .values({
        document_id: documentId,
        logo_ref: images.logoRef ?? null,
        cover_ref: images.coverRef ?? null,
        updated_at: now,
      })
      .onConflict((oc) => oc.column("document_id").doUpdateSet(changes))
      .execute();
  }

  async appImageRef(documentId: string, field: AppImageField): Promise<string | null> {
    const row = await this.db
      .selectFrom("app_profile_images")
      .select(["logo_ref", "cover_ref"])
      .where("document_id", "=", documentId)
      .executeTakeFirst();
    if (!row) return null;
    return field === "logo" ? row.logo_ref : row.cover_ref;
  }

  async appProfilesPage(limit: number, after?: AppProfileCursor): Promise<AppProfileListEntry[]> {
    let query = this.db
      .selectFrom("app_profile_documents")
      .select(["app_did", "document_id", "publisher_address", "created_at"])
      .orderBy("created_at", "desc")
      .orderBy("app_did", "desc")
      .limit(limit);
    if (after) {
      query = query.where((eb) =>
        eb.or([
          eb("created_at", "<", after.createdAt),
          eb.and([eb("created_at", "=", after.createdAt), eb("app_did", "<", after.appDid)]),
        ]),
      );
    }
    const rows = await query.execute();
    return rows.map((row) => ({
      appDid: row.app_did,
      documentId: row.document_id,
      publisherAddress: row.publisher_address,
      createdAt: new Date(row.created_at),
    }));
  }
}
