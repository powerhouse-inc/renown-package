import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { sql } from "kysely";
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import type { DB as RenownCredentialDB } from "../../../processors/renown-credential/schema.js";
import type { ReadModelDb } from "../../renown-auth/lookups.js";
import type { WorkloadDB } from "../../renown-workload/store/types.js";
import { toDate } from "./kysely.js";

/**
 * Reads and writes of other subgraphs' namespaces done on behalf of
 * organisations: renown-workload identities and the renown-credential
 * delegation read model.
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

export interface CredentialRow {
  credentialId: string;
  documentId: string;
  /** credential_subject_id: the delegated app key. */
  appDid: string;
  /** Lowercase issuer address. */
  issuer: string;
  issuanceDate: Date;
  expirationDate: Date | null;
  revoked: boolean;
}

function credentials(db: ReadModelDb) {
  return RenownCredentialProcessor.query<RenownCredentialDB>("renown-credential", db).selectFrom("renown_credential");
}

/**
 * The read model's issuance_date is a timestamp without time zone holding UTC
 * wall time; read and compare it as UTC explicitly, so neither the database
 * session's nor the node process's time zone shifts it.
 */
export function issuedAtUtc() {
  return sql<Date>`(issuance_date at time zone 'UTC')`;
}

const CREDENTIAL_COLUMNS = [
  "credential_id",
  "document_id",
  "credential_subject_id",
  "issuer_ethereum_address",
  "expiration_date",
  "revoked",
] as const;

function toCredential(row: {
  credential_id: string;
  document_id: string;
  credential_subject_id: string | null;
  issuer_ethereum_address: string;
  issuance_date: Date | string;
  expiration_date: Date | string | null;
  revoked: boolean;
}): CredentialRow {
  return {
    credentialId: row.credential_id,
    documentId: row.document_id,
    appDid: row.credential_subject_id ?? "",
    issuer: row.issuer_ethereum_address.toLowerCase(),
    issuanceDate: toDate(row.issuance_date),
    expirationDate: row.expiration_date === null ? null : toDate(row.expiration_date),
    revoked: row.revoked,
  };
}

/** A credential by VC id: a live copy first, then the oldest. */
export async function credentialById(db: ReadModelDb, credentialId: string): Promise<CredentialRow | undefined> {
  const row = await credentials(db)
    .select([...CREDENTIAL_COLUMNS, issuedAtUtc().as("issuance_date")])
    .where("credential_id", "=", credentialId)
    .orderBy("revoked", "asc")
    .orderBy("created_at", "asc")
    .executeTakeFirst();
  return row && toCredential(row);
}

/** Delegations to any of `appDids`, newest first, at most `limit`. */
export async function credentialsForApps(db: ReadModelDb, appDids: readonly string[], limit: number): Promise<CredentialRow[]> {
  if (appDids.length === 0) return [];
  const rows = await credentials(db)
    .select([...CREDENTIAL_COLUMNS, issuedAtUtc().as("issuance_date")])
    .where("credential_subject_id", "in", [...appDids])
    .orderBy("issuance_date", "desc")
    .orderBy("credential_id", "desc")
    .limit(limit)
    .execute();
  return rows.map(toCredential);
}

/** Unrevoked, unexpired delegations by `issuer` to any of `appDids`; with `issuedBy`, only those issued at or before it. */
export async function liveCredentialsOf(
  db: ReadModelDb,
  issuer: string,
  appDids: readonly string[],
  now: Date,
  issuedBy?: Date,
): Promise<CredentialRow[]> {
  if (appDids.length === 0) return [];
  let query = credentials(db)
    .select([...CREDENTIAL_COLUMNS, issuedAtUtc().as("issuance_date")])
    .where((eb) => eb(eb.fn("LOWER", ["issuer_ethereum_address"]), "=", issuer.toLowerCase()))
    .where("credential_subject_id", "in", [...appDids])
    .where("revoked", "=", false)
    .where((eb) => eb.or([eb("expiration_date", "is", null), eb("expiration_date", ">", now)]));
  if (issuedBy) query = query.where(issuedAtUtc(), "<=", issuedBy);
  const rows = await query.orderBy("credential_id").execute();
  return rows.map(toCredential);
}
