import { sql } from "kysely";
import type {
  AppActivity,
  AppImageField,
  AppImagesPatch,
  AppProfileCursor,
  AppProfileEntry,
  AppProfileListEntry,
  MetricAggregate,
  MetricValue,
  StatsIndex,
  StatsKysely,
  UserStatsDocumentEntry,
} from "./types.js";

const keyOf = (v: MetricValue) => `${v.appDid}\u0000${v.metric}\u0000${v.userDid}`;

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

  async recordMetricValues(values: readonly MetricValue[]): Promise<void> {
    // One statement cannot touch a row twice: keep the newest per key.
    const newest = new Map<string, MetricValue>();
    for (const v of values) {
      const seen = newest.get(keyOf(v));
      if (!seen || seen.updatedAt.getTime() <= v.updatedAt.getTime()) newest.set(keyOf(v), v);
    }
    if (newest.size === 0) return;
    await this.db
      .insertInto("app_metric_values")
      .values(
        [...newest.values()].map((v) => ({
          app_did: v.appDid,
          metric: v.metric,
          user_did: v.userDid,
          value: v.value,
          updated_at: v.updatedAt,
        })),
      )
      .onConflict((oc) =>
        oc
          .columns(["app_did", "metric", "user_did"])
          .doUpdateSet((eb) => ({
            value: eb.ref("excluded.value"),
            updated_at: eb.ref("excluded.updated_at"),
          }))
          .where(sql<boolean>`app_metric_values.updated_at <= excluded.updated_at`),
      )
      .execute();
  }

  async metricAggregates(appDid: string, metrics: readonly string[], top: number): Promise<MetricAggregate[]> {
    if (metrics.length === 0) return [];
    const totals = await this.db
      .selectFrom("app_metric_values")
      .select([
        "metric",
        sql<number>`count(*)::int`.as("users"),
        sql<number>`coalesce(sum(value), 0)::float8`.as("sum"),
        sql<number>`coalesce(max(value), 0)::float8`.as("max"),
        sql<number>`coalesce(avg(value), 0)::float8`.as("avg"),
        sql<number>`(count(*) filter (where value > 0))::int`.as("positive"),
      ])
      .where("app_did", "=", appDid)
      .where("metric", "in", [...metrics])
      .groupBy("metric")
      .orderBy("metric")
      .execute();
    const ranked = this.db
      .selectFrom("app_metric_values")
      .select([
        "metric",
        "user_did",
        "value",
        sql<number>`row_number() over (partition by metric order by value desc, updated_at asc, user_did asc)`.as(
          "place",
        ),
      ])
      .where("app_did", "=", appDid)
      .where("metric", "in", [...metrics]);
    const leaders =
      top > 0
        ? await this.db
            .selectFrom(ranked.as("ranked"))
            .select(["metric", "user_did", "value"])
            .where("place", "<=", top)
            .orderBy("metric")
            .orderBy("place")
            .execute()
        : [];
    return totals.map((row) => ({
      metric: row.metric,
      users: Number(row.users),
      sum: Number(row.sum),
      max: Number(row.max),
      avg: Number(row.avg),
      positiveUsers: Number(row.positive),
      top: leaders
        .filter((leader) => leader.metric === row.metric)
        .map((leader) => ({ userDid: leader.user_did, value: Number(leader.value) })),
    }));
  }

  async appActivity(appDid: string, since: Date): Promise<AppActivity> {
    const row = await this.db
      .selectFrom("app_metric_values")
      .select([
        sql<number>`count(distinct user_did)::int`.as("total"),
        sql<number>`(count(distinct user_did) filter (where updated_at >= ${since.toISOString()}::timestamptz))::int`.as(
          "active",
        ),
        sql<Date | string | null>`max(updated_at)`.as("latest"),
      ])
      .where("app_did", "=", appDid)
      .executeTakeFirstOrThrow();
    return {
      totalUsers: Number(row.total),
      activeUsers: Number(row.active),
      updatedAt: row.latest === null ? null : new Date(row.latest),
    };
  }

  async userStatsDocumentsPage(limit: number, afterUserDid?: string): Promise<UserStatsDocumentEntry[]> {
    let query = this.db
      .selectFrom("user_stats_documents")
      .select(["user_did", "document_id"])
      .orderBy("user_did")
      .limit(limit);
    if (afterUserDid !== undefined) query = query.where("user_did", ">", afterUserDid);
    const rows = await query.execute();
    return rows.map((row) => ({ userDid: row.user_did, documentId: row.document_id }));
  }

  async jobDone(name: string): Promise<boolean> {
    const row = await this.db
      .selectFrom("renown_stats_jobs")
      .select("name")
      .where("name", "=", name)
      .executeTakeFirst();
    return row !== undefined;
  }

  async markJobDone(name: string, at: Date): Promise<void> {
    await this.db
      .insertInto("renown_stats_jobs")
      .values({ name, completed_at: at })
      .onConflict((oc) => oc.column("name").doNothing())
      .execute();
  }
}
