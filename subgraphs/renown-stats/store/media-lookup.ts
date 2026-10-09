import { KyselyStatsIndex } from "./kysely.js";
import type { AppImageField, StatsKysely } from "./types.js";

/** The relational namespace renown-stats keeps its index in. */
export const STATS_NAMESPACE = "renown-stats";

/** Anything that can open a relational namespace (the host's relational db). */
export interface NamespaceSource {
  queryNamespace(namespace: string): unknown;
}

/** Postgres: undefined_table, invalid_schema_name. */
const MISSING = new Set(["42P01", "3F000"]);

/** True when `error` says the namespace or its table does not exist yet. */
function isMissingNamespace(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && MISSING.has(code);
}

/**
 * The media route's lookup for an app-profile image field: the ref
 * upsertAppProfile recorded for the profile document, or null. Null only when
 * renown-stats has not set up its namespace (or its table) yet, so the image
 * is simply not there. Any other failure is rethrown: the media route answers
 * it 503 (not cacheable) instead of a cacheable 404.
 */
export function appImageLookup(
  db: NamespaceSource,
  field: AppImageField,
): (documentId: string) => Promise<string | null> {
  return async (documentId) => {
    try {
      const index = new KyselyStatsIndex(db.queryNamespace(STATS_NAMESPACE) as StatsKysely);
      return await index.appImageRef(documentId, field);
    } catch (error) {
      if (!isMissingNamespace(error)) throw error;
      return null;
    }
  };
}
