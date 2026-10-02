import { getAddress, isAddress } from "viem";
import { seal } from "./core/crypto.js";
import { generateWorkloadKey } from "./core/keys.js";
import type { StoredWorkloadIdentity, WorkloadIdentity } from "./core/types.js";
import type { WorkloadStore } from "./store/types.js";

export type WorkloadRegistryErrorCode =
  | "BAD_USER_INPUT"
  | "NOT_FOUND"
  | "CONFLICT";

export class WorkloadRegistryError extends Error {
  constructor(
    message: string,
    public readonly code: WorkloadRegistryErrorCode,
  ) {
    super(message);
    this.name = "WorkloadRegistryError";
  }
}

export interface RegistryDeps {
  store: WorkloadStore;
  /** Needed only to register (seal a new private key). */
  encryptionKey: Uint8Array | null;
  now(): Date;
}

export interface RegisterWorkloadIdentityInput {
  repositoryId: string;
  repository: string;
  productionBranch: string;
  ownerAddress: string;
  chainId: number;
}

const REPOSITORY_ID = /^[1-9][0-9]{0,19}$/;
const REPOSITORY = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;
// A git branch name, conservatively (a subset of git-check-ref-format):
// ASCII letters, digits, `.`, `_`, `-`, `/`; no `..` or `//`.
const BRANCH_ALLOWED = /^[A-Za-z0-9._/-]+$/;
const BRANCH_FORBIDDEN = /\.\.|\/\//;

function badInput(message: string): WorkloadRegistryError {
  return new WorkloadRegistryError(message, "BAD_USER_INPUT");
}

export function validateRepository(repository: string): string {
  if (!REPOSITORY.test(repository) || repository.endsWith(".git")) {
    throw badInput("repository must be 'owner/name'");
  }
  return repository;
}

export function validateProductionBranch(branch: string): string {
  if (
    branch.length === 0 ||
    branch.length > 255 ||
    !BRANCH_ALLOWED.test(branch) ||
    BRANCH_FORBIDDEN.test(branch) ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.startsWith("refs/")
  ) {
    throw badInput(
      "productionBranch must be a plain branch name (without refs/heads/)",
    );
  }
  return branch;
}

function validateInput(
  input: RegisterWorkloadIdentityInput,
): RegisterWorkloadIdentityInput {
  if (!REPOSITORY_ID.test(input.repositoryId)) {
    throw badInput("repositoryId must be GitHub's numeric repository id");
  }
  if (!isAddress(input.ownerAddress, { strict: false })) {
    throw badInput("ownerAddress must be an Ethereum address");
  }
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw badInput("chainId must be a positive integer");
  }
  return {
    repositoryId: input.repositoryId,
    repository: validateRepository(input.repository),
    productionBranch: validateProductionBranch(input.productionBranch),
    ownerAddress: getAddress(input.ownerAddress),
    chainId: input.chainId,
  };
}

/** The identity without its sealed key: the only shape that leaves the registry. */
export function publicIdentity(
  identity: StoredWorkloadIdentity,
): WorkloadIdentity {
  const { encryptedKeyPair: _sealed, ...rest } = identity;
  return rest;
}

function sameOwner(
  existing: StoredWorkloadIdentity,
  input: RegisterWorkloadIdentityInput,
): boolean {
  return (
    existing.ownerAddress.toLowerCase() === input.ownerAddress.toLowerCase() &&
    existing.chainId === input.chainId
  );
}

function resolveExisting(
  existing: StoredWorkloadIdentity,
  input: RegisterWorkloadIdentityInput,
): WorkloadIdentity {
  if (!sameOwner(existing, input)) {
    throw new WorkloadRegistryError(
      "This repository is already registered to another owner",
      "CONFLICT",
    );
  }
  return publicIdentity(existing);
}

/**
 * Registers the App identity for a repository: generates a P-256 did:key and
 * stores its key pair sealed with the encryption key. Idempotent per
 * repository id for the same owner (returns the existing identity, unchanged);
 * another owner gets CONFLICT.
 */
export async function registerWorkloadIdentity(
  deps: RegistryDeps & { encryptionKey: Uint8Array },
  rawInput: RegisterWorkloadIdentityInput,
): Promise<WorkloadIdentity> {
  const input = validateInput(rawInput);

  const existing = await deps.store.getByRepositoryId(input.repositoryId);
  if (existing) return resolveExisting(existing, input);

  const { did, keyPair } = await generateWorkloadKey();
  const now = deps.now();
  const identity: StoredWorkloadIdentity = {
    did,
    provider: "github",
    ...input,
    encryptedKeyPair: await seal(
      deps.encryptionKey,
      JSON.stringify(keyPair),
      did,
    ),
    createdAt: now,
    updatedAt: now,
  };
  if (await deps.store.insert(identity)) return publicIdentity(identity);

  // Lost a race with a concurrent registration of the same repository.
  const winner = await deps.store.getByRepositoryId(input.repositoryId);
  if (!winner)
    throw new Error("Workload identity insert conflicted but no row found");
  return resolveExisting(winner, input);
}

export async function updateWorkloadIdentity(
  deps: RegistryDeps,
  did: string,
  patch: { repository?: string | null; productionBranch?: string | null },
): Promise<WorkloadIdentity> {
  const updated = await deps.store.update(
    did,
    {
      ...(patch.repository != null && {
        repository: validateRepository(patch.repository),
      }),
      ...(patch.productionBranch != null && {
        productionBranch: validateProductionBranch(patch.productionBranch),
      }),
    },
    deps.now(),
  );
  if (!updated) {
    throw new WorkloadRegistryError("Workload identity not found", "NOT_FOUND");
  }
  return publicIdentity(updated);
}

export function deleteWorkloadIdentity(
  deps: RegistryDeps,
  did: string,
): Promise<boolean> {
  return deps.store.delete(did);
}

export async function getWorkloadIdentity(
  deps: RegistryDeps,
  did: string,
): Promise<WorkloadIdentity | null> {
  const identity = await deps.store.getByDid(did);
  return identity ? publicIdentity(identity) : null;
}
