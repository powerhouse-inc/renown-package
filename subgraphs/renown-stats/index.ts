import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import { statsAudience, statsProfileApps } from "./core/config.js";
import { createResolvers } from "./resolvers.js";
import { schema } from "./schema.js";
import { KyselyStatsIndex } from "./store/kysely.js";
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
        "renown-stats",
      )) as unknown as StatsKysely;
      await migrate(db);
      this.#index = new KyselyStatsIndex(db);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.error(
        `[renown-stats] relational namespace/migration failed (${reason}) — stats and app profiles disabled`,
      );
    }
  }

  onDisconnect(): Promise<void> {
    this.#index = undefined;
    this.#setUp = false;
    return Promise.resolve();
  }
}
