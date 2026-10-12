import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import { loadOrgsConfig, type OrgsConfig } from "./core/config.js";
import { createResolvers } from "./resolvers.js";
import { schema } from "./schema.js";
import { KyselyOrgStore } from "./store/kysely.js";
import { migrate } from "./store/migrations.js";
import { ORGS_NAMESPACE, type OrgsKysely } from "./store/types.js";

/** How often expired used-signature hashes are deleted. */
export const PRUNE_INTERVAL_MS = 5 * 60_000;

/**
 * Renown organisations. Every write goes to the organization document (the
 * signed record) through the in-process reactor client and to the
 * `renown-orgs` relational namespace (the source of truth for reads), under
 * one lock per organization; every field authorises its caller itself.
 *
 * Never fails the host: without its namespace every field answers
 * SERVICE_UNAVAILABLE.
 */
export class RenownOrgsSubgraph extends BaseSubgraph {
  #store: KyselyOrgStore | undefined;
  #config: OrgsConfig | undefined;
  #setUp = false;
  #pruneTimer: ReturnType<typeof setInterval> | undefined;

  name = "renown-orgs";
  typeDefs: DocumentNode = schema;
  resolvers: Record<string, unknown> = createResolvers({
    reactorClient: this.reactorClient,
    relationalDb: this.relationalDb as unknown as ReadModelDb,
    store: () => this.#store,
    config: () => this.#getConfig(),
  });
  additionalContextFields = {};

  #getConfig(): OrgsConfig {
    return (this.#config ??= loadOrgsConfig(process.env));
  }

  async onSetup() {
    // Idempotent: a second setup must not migrate twice.
    if (this.#setUp) return;
    this.#setUp = true;
    // Never throw from here, or the host's other subgraphs go down with this one.
    try {
      const db = (await this.relationalDb.createNamespace(ORGS_NAMESPACE)) as unknown as OrgsKysely;
      await migrate(db);
      const store = new KyselyOrgStore(db);
      this.#store = store;
      this.#startPruning(store);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.error(`[renown-orgs] relational namespace/migration failed (${reason}) — organizations disabled`);
    }
  }

  /** Deletes expired replay-guard hashes every PRUNE_INTERVAL_MS; never keeps the process alive. */
  #startPruning(store: KyselyOrgStore): void {
    if (this.#pruneTimer !== undefined) clearInterval(this.#pruneTimer);
    this.#pruneTimer = setInterval(() => {
      store.pruneUsedSignatures(new Date()).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : "unknown error";
        console.error(`[renown-orgs] used-signature cleanup failed: ${reason}`);
      });
    }, PRUNE_INTERVAL_MS);
    (this.#pruneTimer as { unref?: () => void }).unref?.();
  }

  onDisconnect(): Promise<void> {
    if (this.#pruneTimer !== undefined) {
      clearInterval(this.#pruneTimer);
      this.#pruneTimer = undefined;
    }
    this.#store = undefined;
    this.#setUp = false;
    return Promise.resolve();
  }
}
