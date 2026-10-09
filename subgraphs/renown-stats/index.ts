import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import {
  statsAudience,
  statsProfileApps,
  statsRegistrationToken,
} from "./core/config.js";
import { createResolvers } from "./resolvers.js";
import { backfillAppMetricValues } from "./core/backfill.js";
import { backfillAppCategories } from "./core/category-backfill.js";
import { schema } from "./schema.js";
import { KyselyStatsIndex } from "./store/kysely.js";
import { STATS_NAMESPACE } from "./store/media-lookup.js";
import { migrate } from "./store/migrations.js";
import type { StatsKysely } from "./store/types.js";

/**
 * App profiles and per-user app stats. Documents are written with the
 * in-process reactor client (system writes); every mutation authorises its
 * caller itself. Which document belongs to which DID lives in the
 * `renown-stats` relational namespace.
 *
 * Never fails the host: without its namespace every field answers
 * SERVICE_NOT_CONFIGURED.
 */
export class RenownStatsSubgraph extends BaseSubgraph {
  #index: KyselyStatsIndex | undefined;
  #audience: string | undefined;
  #profileApps: ReadonlySet<string> | undefined;
  #setUp = false;
  #backfill: Promise<void> = Promise.resolve();

  name = "renown-stats";
  typeDefs: DocumentNode = schema;
  resolvers: Record<string, unknown> = createResolvers({
    reactorClient: this.reactorClient,
    // The host's shared relational db, exactly as renown-workload's subgraph
    // sees it: the resolvers read its `renown-workload` namespace and the
    // delegation read model through queryNamespace at request time.
    relationalDb: this.relationalDb as unknown as ReadModelDb,
    index: () => this.#index,
    audience: () => this.#getAudience(),
    profileApps: () => (this.#profileApps ??= statsProfileApps(process.env)),
    // The Vetra relay's credential; read per call (cheap, and follows a rotated secret on restart).
    registrationToken: () => statsRegistrationToken(process.env),
  });
  additionalContextFields = {};

  #getAudience(): string {
    return (this.#audience ??= statsAudience(process.env));
  }

  async onSetup() {
    // Idempotent: a second setup must not migrate twice.
    if (this.#setUp) return;
    this.#setUp = true;
    // Never throw from here, or the host's other subgraphs go down with this one.
    try {
      const db = (await this.relationalDb.createNamespace(
        STATS_NAMESPACE,
      )) as unknown as StatsKysely;
      await migrate(db);
      const index = new KyselyStatsIndex(db);
      this.#index = index;
      // One-time and idempotent: app_metric_values from the user-stats
      // documents written before Phase 3, then each profile's category. In
      // the background, so the host's startup never waits for them; one
      // failing never stops the other.
      const deps = { index, reactorClient: this.reactorClient, now: () => new Date() };
      const settle = (what: string) => (error: unknown) => {
        const reason = error instanceof Error ? error.message : "unknown error";
        console.warn(`[renown-stats] ${what} backfill failed (${reason}); retried on the next start`);
      };
      this.#backfill = backfillAppMetricValues(deps)
        .then(() => undefined, settle("metric"))
        .then(() => backfillAppCategories(deps))
        .then(() => undefined, settle("category"));
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.error(
        `[renown-stats] relational namespace/migration failed (${reason}) — stats and app profiles disabled`,
      );
    }
  }

  /** Resolves once the setup backfill has finished (successfully or not). */
  backfillSettled(): Promise<void> {
    return this.#backfill;
  }

  onDisconnect(): Promise<void> {
    this.#index = undefined;
    this.#setUp = false;
    return Promise.resolve();
  }
}
