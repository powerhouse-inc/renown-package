import type { IReactorClient } from "@powerhousedao/reactor";
import type { RenownUserStatsDocument } from "../../../document-models/renown-user-stats/index.js";
import type { MetricValue, StatsIndex } from "../store/types.js";

/** The job name in renown_stats_jobs; bump the suffix to run a new backfill. */
export const METRIC_BACKFILL_JOB = "app-metric-values-backfill-v1";

export interface BackfillResult {
  status: "done" | "skipped" | "incomplete";
  documents: number;
  values: number;
  failed: number;
}

export interface BackfillDeps {
  index: StatsIndex;
  reactorClient: Pick<IReactorClient, "get">;
  now: () => Date;
  logger?: Pick<Console, "info" | "warn">;
  /** User-stats documents read per page (default 200). */
  pageSize?: number;
}

/**
 * Builds app_metric_values from every existing renown-user-stats document,
 * once. Idempotent: rows are upserted "newer updatedAt wins", so a re-run,
 * or a run racing live reports, never regresses a value. A document that
 * cannot be read is logged and leaves the job open, so the next start
 * retries the whole (cheap, idempotent) pass.
 */
export async function backfillAppMetricValues(deps: BackfillDeps): Promise<BackfillResult> {
  const { index } = deps;
  const logger = deps.logger ?? console;
  const pageSize = deps.pageSize ?? 200;
  if (await index.jobDone(METRIC_BACKFILL_JOB)) {
    return { status: "skipped", documents: 0, values: 0, failed: 0 };
  }
  let documents = 0;
  let values = 0;
  let failed = 0;
  let after: string | undefined;
  for (;;) {
    const page = await index.userStatsDocumentsPage(pageSize, after);
    for (const entry of page) {
      try {
        const doc = await deps.reactorClient.get<RenownUserStatsDocument>(entry.documentId);
        const rows: MetricValue[] = doc.state.global.stats.map((stat) => ({
          appDid: stat.appDid,
          metric: stat.metric,
          userDid: entry.userDid,
          value: stat.value,
          updatedAt: new Date(stat.updatedAt),
        }));
        await index.recordMetricValues(rows);
        documents++;
        values += rows.length;
      } catch (error) {
        failed++;
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[renown-stats] metric backfill of ${entry.documentId} failed (${reason}); retried on the next start`,
        );
      }
    }
    const last = page.at(-1);
    if (page.length < pageSize || !last) break;
    after = last.userDid;
  }
  if (failed > 0) return { status: "incomplete", documents, values, failed };
  await index.markJobDone(METRIC_BACKFILL_JOB, deps.now());
  if (documents > 0) {
    logger.info(`[renown-stats] backfilled ${values} metric values from ${documents} user-stats documents`);
  }
  return { status: "done", documents, values, failed };
}
