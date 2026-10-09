import { KyselyStatsIndex } from "./kysely.js";
import type { AppImageField, StatsKysely } from "./types.js";

/** The relational namespace renown-stats keeps its index in. */
export const STATS_NAMESPACE = "renown-stats";

/** Anything that can open a relational namespace (the host's relational db). */
export interface NamespaceSource {
  queryNamespace(namespace: string): unknown;
}

/**
 * The media route's lookup for an app-profile image field: the ref
 * upsertAppProfile recorded for the profile document, or null. Never throws:
 * before renown-stats has set up its namespace (or if it can't) the image is
 * simply not there, and the route answers 404.
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
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[renown-media] ${field} lookup failed (${reason}); answering 404`);
      return null;
    }
  };
}
