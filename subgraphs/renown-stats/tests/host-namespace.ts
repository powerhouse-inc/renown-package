import { PGlite } from "@electric-sql/pglite";
import { createRelationalDb, hashNamespace } from "@powerhousedao/shared/processors";
import { Kysely } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";

/**
 * Test support shared by the renown-oidc, renown-orgs, renown-stats and
 * renown-workload store suites: namespaces are opened exactly the way the host
 * opens them. `reactor-api` builds its relational db with
 * `createRelationalDb(db)` and no options, so `createNamespace(name)` lands in
 * a schema called `hashNamespace(name)`, never in a schema called `name`.
 */

/** The Postgres schema the host really uses for `namespace`. */
export const hostSchema = (namespace: string): string => hashNamespace(namespace);

/** A fresh in-memory Postgres. */
export function openPglite<DB = any>(): Kysely<DB> {
  return new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
}

/**
 * Opens `namespace` through the host's real `createRelationalDb` and runs
 * `migrate` once per boot (two by default): each boot asks for a fresh
 * namespace handle, as a restarted switchboard does.
 */
export async function bootNamespace<DB>(
  root: Kysely<any>,
  namespace: string,
  migrate: (db: Kysely<DB>) => Promise<void>,
  boots = 2,
): Promise<Kysely<DB>> {
  let db: Kysely<DB> | undefined;
  for (let boot = 0; boot < boots; boot++) {
    const relationalDb = createRelationalDb(root as never);
    db = (await relationalDb.createNamespace(namespace)) as unknown as Kysely<DB>;
    await migrate(db);
  }
  if (!db) throw new Error("bootNamespace needs at least one boot");
  return db;
}

/**
 * `root`, but every `withSchema(name)` resolves to the host's hashed schema, so
 * test fixtures that seed or inspect a namespace by its logical name hit the
 * same tables production code reaches through `createNamespace` / `queryNamespace`.
 */
export function hashedRoot<DB>(root: Kysely<DB>): Kysely<DB> {
  return new Proxy(root, {
    get(target, prop, receiver) {
      if (prop === "withSchema") return (schema: string) => target.withSchema(hostSchema(schema));
      const value: unknown = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    },
  });
}
