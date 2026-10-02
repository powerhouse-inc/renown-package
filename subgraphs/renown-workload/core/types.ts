/** How a CI run's git ref is trusted. */
export type RefClass = "PRODUCTION" | "RELEASE" | "PREVIEW";

/** A server-held App identity: a did:key acting for `ownerAddress` on behalf of one GitHub repository. */
export interface WorkloadIdentity {
  did: string;
  provider: "github";
  /** GitHub's stable numeric repository id (as a string). */
  repositoryId: string;
  /** `owner/name`, as registered (compared case-insensitively). */
  repository: string;
  /** Branch name (without `refs/heads/`) whose runs are PRODUCTION. */
  productionBranch: string;
  /** EIP-55 checksummed owner address. */
  ownerAddress: string;
  chainId: number;
  createdAt: Date;
  updatedAt: Date;
}

/** A workload identity with its private key, encrypted at rest. */
export interface StoredWorkloadIdentity extends WorkloadIdentity {
  /** AES-256-GCM sealed JWK key pair (see `core/crypto.ts`). Never the cleartext key. */
  encryptedKeyPair: string;
}

/** A P-256 key pair as WebCrypto exports it to JWK. */
export interface JwkKeyPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

export interface WorkloadConfig {
  /** 32-byte AES-256-GCM key, or null when unset/invalid (key generation and the exchange are disabled). */
  encryptionKey: Uint8Array | null;
  /** Registration token for the GraphQL API, or null when unset (the API is disabled). */
  registrationToken: string | null;
  /** Audiences a workload token may be issued for. */
  audiences: string[];
}

/** The `vetra` claim carried by an issued workload token. */
export interface VetraWorkloadClaim {
  ref: string;
  refClass: RefClass;
  sha: string | null;
  repository: string;
  repositoryId: string;
  runId: string | null;
  runAttempt: string | null;
  actor: string | null;
  prNumber: number | null;
}
