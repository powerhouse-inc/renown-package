import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import { loadOrgsConfig, type OrgsConfig } from "./core/config.js";
import { createSweeper, SWEEP_INTERVAL_MS } from "./core/sweeper.js";
import { sweepJobs } from "./jobs.js";
import { resolversFor } from "./resolvers.js";
import { createRuntime, type OrgRuntime } from "./runtime.js";
import { schema } from "./schema.js";
import { KyselyOrgStore } from "./store/kysely.js";
import { migrate } from "./store/migrations.js";
import { ORGS_NAMESPACE, type OrgsKysely } from "./store/types.js";


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
  #timer: ReturnType<typeof setInterval> | undefined;

  name = "renown-orgs";
  typeDefs: DocumentNode = schema;
  #runtime: OrgRuntime = createRuntime({
    reactorClient: this.reactorClient,
    relationalDb: this.relationalDb as unknown as ReadModelDb,
    store: () => this.#store,
    config: () => this.#getConfig(),
  });
  resolvers: Record<string, unknown> = resolversFor(this.#runtime);
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
      this.#store = new KyselyOrgStore(db);
      this.#startSweeping();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.error(`[renown-orgs] relational namespace/migration failed (${reason}) — organizations disabled`);
    }
  }

  /** One timer per replica runs the sweep jobs (claimed atomically, so each runs on one replica); never keeps the process alive. */
  #startSweeping(): void {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    const sweeper = createSweeper({ jobs: sweepJobs(this.#runtime), store: () => this.#runtime.store(), now: () => new Date() });
    this.#timer = setInterval(() => {
      void sweeper.tick();
    }, SWEEP_INTERVAL_MS);
    (this.#timer as { unref?: () => void }).unref?.();
  }

  onDisconnect(): Promise<void> {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    this.#store = undefined;
    this.#setUp = false;
    return Promise.resolve();
  }
}
