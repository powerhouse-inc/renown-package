import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { loadOrgsConfig } from "../renown-orgs/core/config.js";
import { createOrgPolicy, type OrgPolicy } from "../renown-orgs/core/org-policy.js";
import { loadConfig } from "./core/config.js";
import { createGithubVerifier, type GithubVerifier } from "./core/github.js";
import type { WorkloadConfig } from "./core/types.js";
import { createTokenHandler, type ExchangeDeps } from "./http/handlers.js";
import { createResolvers } from "./resolvers.js";
import { schema } from "./schema.js";
import { KyselyWorkloadStore } from "./store/kysely.js";
import { migrate } from "./store/migrations.js";
import type { WorkloadKysely } from "./store/types.js";

const PUBLIC = { auth: "public" } as const;

/**
 * Workload identity for CI: exchanges a GitHub Actions OIDC token for a
 * Renown auth bearer token signed by the repository's App did:key, at
 * `POST <http.baseUrl>/workload/token`, plus a token-gated GraphQL API to
 * register App identities. Identities live in the `workload_identities` table
 * of the `renown-workload` relational namespace, private keys sealed with
 * `RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY`.
 *
 * Never fails the host: without its config (or database) the route answers
 * 503 and the GraphQL fields fail with SERVICE_NOT_CONFIGURED.
 */
export class RenownWorkloadSubgraph extends BaseSubgraph {
  name = "renown-workload";
  typeDefs: DocumentNode = schema;
  resolvers: Record<string, unknown> = createResolvers({
    config: () => this.#getConfig(),
    store: () => this.#store,
    orgPolicy: () => this.#getOrgPolicy(),
  });
  additionalContextFields = {};

  #config: WorkloadConfig | undefined;
  #setUp = false;
  #store: KyselyWorkloadStore | undefined;
  #verifier: GithubVerifier | undefined;
  #routes: { dispose(): void }[] = [];
  #orgPolicy: OrgPolicy | undefined;

  /** Organisations as renown-orgs stores them (read lazily: no organisations until it is set up). */
  #getOrgPolicy(): OrgPolicy {
    return (this.#orgPolicy ??= createOrgPolicy(
      this.relationalDb,
      loadOrgsConfig(process.env).didHost,
    ));
  }

  #getConfig(): WorkloadConfig {
    if (this.#config === undefined) {
      const { config, problems } = loadConfig(process.env);
      for (const problem of problems)
        console.warn(`[renown-workload] ${problem}`);
      this.#config = config;
    }
    return this.#config;
  }

  #exchangeDeps(): ExchangeDeps | null {
    const config = this.#getConfig();
    if (this.#store === undefined || config.encryptionKey === null) return null;
    this.#verifier ??= createGithubVerifier();
    return {
      store: this.#store,
      encryptionKey: config.encryptionKey,
      audiences: config.audiences,
      verifier: this.#verifier,
      orgPolicy: this.#getOrgPolicy(),
    };
  }

  async onSetup() {
    // Idempotent: a second setup must not register duplicate routes.
    if (this.#setUp) return;
    this.#setUp = true;
    this.#getConfig();

    // Registered first and unconditionally: it answers 503 until (and
    // unless) the store and encryption key are available.
    const handler = createTokenHandler(() => this.#exchangeDeps());
    this.#routes = [
      this.http.post("workload/token", PUBLIC, (req) => handler(req)),
    ];

    // Never throw from here, or the host's other subgraphs go down with this one.
    try {
      const db = (await this.relationalDb.createNamespace(
        "renown-workload",
      )) as unknown as WorkloadKysely;
      await migrate(db);
      this.#store = new KyselyWorkloadStore(db);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.error(
        `[renown-workload] relational namespace/migration failed (${reason}) — token exchange and identity API disabled`,
      );
    }
  }

  onDisconnect(): Promise<void> {
    for (const route of this.#routes) route.dispose();
    this.#routes = [];
    this.#store = undefined;
    this.#setUp = false;
    return Promise.resolve();
  }
}
