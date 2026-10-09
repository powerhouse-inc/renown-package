import type { StoredWorkloadIdentity } from "../core/types.js";
import type { WorkloadIdentityPatch, WorkloadStore } from "./types.js";

/** In-memory `WorkloadStore`. For tests and local dev only. */
export class MemoryWorkloadStore implements WorkloadStore {
  private readonly identities = new Map<string, StoredWorkloadIdentity>();

  insert(identity: StoredWorkloadIdentity): Promise<boolean> {
    for (const existing of this.identities.values()) {
      if (existing.repositoryId === identity.repositoryId) {
        return Promise.resolve(false);
      }
    }
    if (this.identities.has(identity.did)) return Promise.resolve(false);
    this.identities.set(identity.did, { ...identity });
    return Promise.resolve(true);
  }

  getByDid(did: string): Promise<StoredWorkloadIdentity | undefined> {
    const identity = this.identities.get(did);
    return Promise.resolve(identity ? { ...identity } : undefined);
  }

  getByRepositoryId(
    repositoryId: string,
  ): Promise<StoredWorkloadIdentity | undefined> {
    for (const identity of this.identities.values()) {
      if (identity.repositoryId === repositoryId) {
        return Promise.resolve({ ...identity });
      }
    }
    return Promise.resolve(undefined);
  }

  update(
    did: string,
    patch: WorkloadIdentityPatch,
    now: Date,
  ): Promise<StoredWorkloadIdentity | undefined> {
    const existing = this.identities.get(did);
    if (!existing) return Promise.resolve(undefined);
    const updated: StoredWorkloadIdentity = {
      ...existing,
      ...(patch.repository !== undefined && { repository: patch.repository }),
      ...(patch.productionBranch !== undefined && {
        productionBranch: patch.productionBranch,
      }),
      updatedAt: now,
    };
    this.identities.set(did, updated);
    return Promise.resolve({ ...updated });
  }

  delete(did: string): Promise<boolean> {
    return Promise.resolve(this.identities.delete(did));
  }
}
