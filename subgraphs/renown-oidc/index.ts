import { BaseSubgraph } from "@powerhousedao/reactor-api";
import type { DocumentNode } from "graphql";
import { loadConfig } from "./core/config.js";
import { loadSigningKeys, type SigningKeys } from "./core/keys.js";
import type { OidcConfig } from "./core/types.js";
import { createClientDirectory, createProfileDirectory } from "./directories.js";
import { createOidcHandlers } from "./http/handlers.js";
import { createResolvers } from "./resolvers.js";
import { schema } from "./schema.js";
import { KyselyOidcStore } from "./store/kysely.js";
import { migrate } from "./store/migrations.js";
import type { OidcKysely } from "./store/types.js";

const CLEANUP_INTERVAL_MS = 300_000;
const PUBLIC = { auth: "public" } as const;

/**
 * Renown as an OpenID Connect provider. Serves the OIDC endpoints as public
 * HTTP routes under `<http.baseUrl>/oidc` (only when `RENOWN_OIDC_SIGNING_KEYS`
 * is configured) and a token-gated GraphQL API to register and manage
 * clients. Clients live in the `oidc_clients` table of the `renown-oidc`
 * relational namespace — the source of truth — and are mirrored to
 * `renown/oidc-client` documents for audit only. Short-lived login state
 * lives in the same namespace and is swept every 5 minutes.
 */
export class RenownOidcSubgraph extends BaseSubgraph {
  name = "renown-oidc";
  typeDefs: DocumentNode = schema;
  resolvers: Record<string, unknown> = createResolvers({
    config: () => this.#getConfig(),
    store: () => this.#store,
    reactorClient: this.reactorClient,
  });
  additionalContextFields = {};

  #config: OidcConfig | undefined;
  #setUp = false;
  #store: KyselyOidcStore | undefined;
  #routes: { dispose(): void }[] = [];
  #cleanupTimer: ReturnType<typeof setInterval> | undefined;

  #getConfig(): OidcConfig {
    this.#config ??= loadConfig(process.env, this.http.baseUrl);
    return this.#config;
  }

  async onSetup() {
    // Idempotent: a second setup must not register duplicate routes or timers.
    if (this.#setUp) return;
    this.#setUp = true;
    const config = this.#getConfig();

    // Never throw from here, or the host's other subgraphs go down with this
    // one: a failure disables only what depends on it.
    let store: KyselyOidcStore;
    try {
      const db = (await this.relationalDb.createNamespace("renown-oidc")) as unknown as OidcKysely;
      await migrate(db);
      store = new KyselyOidcStore(db);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.error(
        `[renown-oidc] relational namespace/migration failed (${reason}) — OIDC endpoints and client registry disabled`,
      );
      return;
    }
    this.#store = store;

    // A missing or broken signing key disables only the OIDC endpoints (the
    // registry keeps working). Never log the key itself either
    // (loadSigningKeys' errors don't contain it).
    let keys: SigningKeys | null;
    try {
      keys = await loadSigningKeys(process.env.RENOWN_OIDC_SIGNING_KEYS, config.issuer);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.error(`[renown-oidc] RENOWN_OIDC_SIGNING_KEYS invalid (${reason}) — OIDC endpoints disabled`);
      return;
    }
    if (keys === null) {
      console.warn("[renown-oidc] RENOWN_OIDC_SIGNING_KEYS unset — OIDC endpoints disabled");
      return;
    }

    const handlers = createOidcHandlers({
      config,
      keys,
      store,
      clients: createClientDirectory(store),
      profiles: createProfileDirectory(this.relationalDb),
      now: () => new Date(),
    });

    this.#routes = [
      this.http.get("oidc/.well-known/openid-configuration", PUBLIC, (req) => handlers.discovery(req)),
      this.http.get("oidc/jwks", PUBLIC, (req) => handlers.jwks(req)),
      this.http.get("oidc/authorize", PUBLIC, (req) => handlers.authorize(req)),
      this.http.post("oidc/authorize", PUBLIC, (req) => handlers.authorize(req)),
      this.http.get("oidc/interaction/:id", PUBLIC, (req, ctx) => handlers.interaction(req, ctx.params.id)),
      this.http.post("oidc/interaction/:id/complete", PUBLIC, (req, ctx) => handlers.complete(req, ctx.params.id)),
      this.http.post("oidc/token", PUBLIC, (req) => handlers.token(req)),
      this.http.get("oidc/userinfo", PUBLIC, (req) => handlers.userinfo(req)),
      this.http.post("oidc/userinfo", PUBLIC, (req) => handlers.userinfo(req)),
    ];

    this.#cleanupTimer = setInterval(() => {
      store.deleteExpired(new Date()).catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : "unknown error";
        console.error(`[renown-oidc] expired-row cleanup failed: ${reason}`);
      });
    }, CLEANUP_INTERVAL_MS);
    // Don't let the sweep keep the process alive on shutdown.
    (this.#cleanupTimer as { unref?: () => void }).unref?.();
  }

  onDisconnect(): Promise<void> {
    for (const route of this.#routes) route.dispose();
    this.#routes = [];
    this.#store = undefined;
    this.#setUp = false;
    if (this.#cleanupTimer !== undefined) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = undefined;
    }
    return Promise.resolve();
  }
}
