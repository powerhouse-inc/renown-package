import type { Selectable } from "kysely";
import type { StoredWorkloadIdentity } from "../core/types.js";
import type {
  WorkloadIdentityPatch,
  WorkloadIdentityRow,
  WorkloadKysely,
  WorkloadStore,
} from "./types.js";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toIdentity(
  row: Selectable<WorkloadIdentityRow>,
): StoredWorkloadIdentity {
  return {
    did: row.did,
    provider: "github",
    repositoryId: row.repository_id,
    repository: row.repository,
    productionBranch: row.production_branch,
    ownerAddress: row.owner_address,
    chainId: Number(row.chain_id),
    encryptedKeyPair: row.encrypted_key_pair,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

/** Kysely-backed `WorkloadStore`. The `db` passed in is already namespace-scoped. */
export class KyselyWorkloadStore implements WorkloadStore {
  constructor(private readonly db: WorkloadKysely) {}

  async insert(identity: StoredWorkloadIdentity): Promise<boolean> {
    const inserted = await this.db
      .insertInto("workload_identities")
      .values({
        did: identity.did,
        provider: identity.provider,
        repository_id: identity.repositoryId,
        repository: identity.repository,
        production_branch: identity.productionBranch,
        owner_address: identity.ownerAddress,
        chain_id: identity.chainId,
        encrypted_key_pair: identity.encryptedKeyPair,
        created_at: identity.createdAt,
        updated_at: identity.updatedAt,
      })
      .onConflict((oc) => oc.doNothing())
      .returning("did")
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async getByDid(did: string): Promise<StoredWorkloadIdentity | undefined> {
    const row = await this.db
      .selectFrom("workload_identities")
      .selectAll()
      .where("did", "=", did)
      .executeTakeFirst();
    return row ? toIdentity(row) : undefined;
  }

  async getByRepositoryId(
    repositoryId: string,
  ): Promise<StoredWorkloadIdentity | undefined> {
    const row = await this.db
      .selectFrom("workload_identities")
      .selectAll()
      .where("repository_id", "=", repositoryId)
      .executeTakeFirst();
    return row ? toIdentity(row) : undefined;
  }

  async update(
    did: string,
    patch: WorkloadIdentityPatch,
    now: Date,
  ): Promise<StoredWorkloadIdentity | undefined> {
    const row = await this.db
      .updateTable("workload_identities")
      .set({
        ...(patch.repository !== undefined && { repository: patch.repository }),
        ...(patch.productionBranch !== undefined && {
          production_branch: patch.productionBranch,
        }),
        updated_at: now,
      })
      .where("did", "=", did)
      .returningAll()
      .executeTakeFirst();
    return row ? toIdentity(row) : undefined;
  }

  async delete(did: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("workload_identities")
      .where("did", "=", did)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }
}
