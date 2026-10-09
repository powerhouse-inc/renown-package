import type { ColumnType, Kysely } from "kysely";
import type { StoredWorkloadIdentity } from "../core/types.js";

/** A `timestamptz` column: the driver returns a `Date`, but accepts either on write. */
export type Timestamp = Date | string;

export interface WorkloadIdentityRow {
  did: string;
  provider: string;
  repository_id: string;
  repository: string;
  production_branch: string;
  owner_address: string;
  /** `bigint`: EIP-155 chain ids can exceed int4. Drivers return int8 as a string, bigint or number. */
  chain_id: ColumnType<string | number | bigint, number, number>;
  /** AES-256-GCM sealed JWK key pair; never the cleartext key. */
  encrypted_key_pair: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface WorkloadDB {
  workload_identities: WorkloadIdentityRow;
}

export type WorkloadKysely = Kysely<WorkloadDB>;

/** The mutable fields of an identity. */
export interface WorkloadIdentityPatch {
  repository?: string;
  productionBranch?: string;
}

export interface WorkloadStore {
  /**
   * Inserts the identity unless one already exists for its repository id.
   * Returns false (and changes nothing) when it does.
   */
  insert(identity: StoredWorkloadIdentity): Promise<boolean>;
  getByDid(did: string): Promise<StoredWorkloadIdentity | undefined>;
  getByRepositoryId(
    repositoryId: string,
  ): Promise<StoredWorkloadIdentity | undefined>;
  /** Applies `patch`; undefined when the identity doesn't exist. */
  update(
    did: string,
    patch: WorkloadIdentityPatch,
    now: Date,
  ): Promise<StoredWorkloadIdentity | undefined>;
  /** True when an identity was deleted. */
  delete(did: string): Promise<boolean>;
}
