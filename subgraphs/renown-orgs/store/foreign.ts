import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import type { ReadModelDb } from "../../renown-auth/lookups.js";
import type { WorkloadDB } from "../../renown-workload/store/types.js";
import { toDate } from "./kysely.js";

/**
 * Reads and writes of other subgraphs' namespaces done on behalf of
 * organisations (renown-workload here; later tasks add renown-stats and the
 * credential read model).
 *
 * `queryNamespace` is read-only on the host (selectFrom/selectNoFrom/with/
 * withRecursive only), so every write goes through a memoized
 * `createNamespace` handle.
 */
export const WORKLOAD_NAMESPACE = "renown-workload";

/**
 * `open(db)` once per database, cached in `cache`. A failed open is
 * forgotten, so the next write retries it.
 */
export function memoizedNamespace<T>(cache: WeakMap<ReadModelDb, Promise<T>>, db: ReadModelDb, open: () => Promise<T>): Promise<T> {
  let handle = cache.get(db);
  if (!handle) {
    handle = open();
    cache.set(db, handle);
    handle.catch(() => cache.delete(db));
  }
  return handle;
}

const workloadHandles = new WeakMap<ReadModelDb, Promise<IRelationalDb<WorkloadDB>>>();

/** A writable handle on the renown-workload namespace. */
function writableWorkloads(db: ReadModelDb): Promise<IRelationalDb<WorkloadDB>> {
  return memoizedNamespace(workloadHandles, db, () => db.createNamespace<WorkloadDB>(WORKLOAD_NAMESPACE));
}

export interface OrgWorkloadRecord {
  did: string;
  repository: string;
  productionBranch: string;
  ownerAddress: string;
  disabled: boolean;
  createdAt: Date;
}

const WORKLOAD_COLUMNS = ["did", "repository", "production_branch", "owner_address", "disabled", "created_at"] as const;

function toWorkload(row: {
  did: string;
  repository: string;
  production_branch: string;
  owner_address: string;
  disabled: boolean;
  created_at: Date | string;
}): OrgWorkloadRecord {
  return {
    did: row.did,
    repository: row.repository,
    productionBranch: row.production_branch,
    ownerAddress: row.owner_address,
    disabled: row.disabled,
    createdAt: toDate(row.created_at),
  };
}

/** The workload identities owned by `orgId`, oldest first. */
export async function workloadsOfOrg(db: ReadModelDb, orgId: string): Promise<OrgWorkloadRecord[]> {
  const rows = await db
    .queryNamespace<WorkloadDB>(WORKLOAD_NAMESPACE)
    .selectFrom("workload_identities")
    .select(WORKLOAD_COLUMNS)
    .where("owner_org_id", "=", orgId)
    .orderBy("created_at")
    .orderBy("did")
    .execute();
  return rows.map(toWorkload);
}

/** Enables or disables an identity owned by `orgId`; undefined when it is not one of the org's. */
export async function setWorkloadDisabled(
  db: ReadModelDb,
  orgId: string,
  did: string,
  disabled: boolean,
  now: Date,
): Promise<OrgWorkloadRecord | undefined> {
  const workloads = await writableWorkloads(db);
  const row = await workloads
    .updateTable("workload_identities")
    .set({ disabled, updated_at: now })
    .where("did", "=", did)
    .where("owner_org_id", "=", orgId)
    .returning(WORKLOAD_COLUMNS)
    .executeTakeFirst();
  return row && toWorkload(row);
}
