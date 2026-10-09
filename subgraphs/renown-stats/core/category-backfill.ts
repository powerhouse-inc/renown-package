import type { IReactorClient } from "@powerhousedao/reactor";
import type { RenownAppProfileDocument } from "../../../document-models/renown-app-profile/index.js";
import type { AppProfileCursor, StatsIndex } from "../store/types.js";

/** The job name in renown_stats_jobs; bump the suffix to run a new backfill. */
export const CATEGORY_BACKFILL_JOB = "app-profile-category-backfill-v1";

export interface CategoryBackfillResult {
  status: "done" | "skipped" | "incomplete";
  documents: number;
  failed: number;
}

export interface CategoryBackfillDeps {
  index: StatsIndex;
  reactorClient: Pick<IReactorClient, "get">;
  now: () => Date;
  logger?: Pick<Console, "info" | "warn">;
  /** Profiles read per page (default 200). */
  pageSize?: number;
}

/**
 * Copies the category of every existing app-profile document into
 * app_profile_documents.category, once. Idempotent: it writes what the
 * document holds, as every later save does. A document that cannot be read is
 * logged and leaves the job open, so the next start retries the whole pass.
 */
export async function backfillAppCategories(deps: CategoryBackfillDeps): Promise<CategoryBackfillResult> {
  const { index } = deps;
  const logger = deps.logger ?? console;
  const pageSize = deps.pageSize ?? 200;
  if (await index.jobDone(CATEGORY_BACKFILL_JOB)) {
    return { status: "skipped", documents: 0, failed: 0 };
  }
  let documents = 0;
  let failed = 0;
  let after: AppProfileCursor | undefined;
  for (;;) {
    const page = await index.appProfilesPage(pageSize, after);
    for (const entry of page) {
      try {
        const doc = await deps.reactorClient.get<RenownAppProfileDocument>(entry.documentId);
        // Profiles from before the rich fields have no category key at all.
        const state = doc.state.global as Partial<RenownAppProfileDocument["state"]["global"]>;
        await index.setAppCategory(entry.appDid, state.category ?? null);
        documents++;
      } catch (error) {
        failed++;
        const reason = error instanceof Error ? error.message : String(error);
        logger.warn(
          `[renown-stats] category backfill of ${entry.documentId} failed (${reason}); retried on the next start`,
        );
      }
    }
    const last = page.at(-1);
    if (page.length < pageSize || !last) break;
    after = { createdAt: last.createdAt, appDid: last.appDid };
  }
  if (failed > 0) return { status: "incomplete", documents, failed };
  await index.markJobDone(CATEGORY_BACKFILL_JOB, deps.now());
  if (documents > 0) logger.info(`[renown-stats] backfilled the category of ${documents} app profiles`);
  return { status: "done", documents, failed };
}
