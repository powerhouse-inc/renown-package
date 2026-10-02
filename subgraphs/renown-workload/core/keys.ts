import {
  DEFAULT_RENOWN_NETWORK_ID,
  MemoryKeyStorage,
  RenownCryptoBuilder,
} from "@renown/sdk";
import { createVerifiableCredentialJwt } from "did-jwt-vc";
import type { JwkKeyPair, VetraWorkloadClaim } from "./types.js";

/**
 * Generates a P-256 did:key exactly as the Renown SDK does for a CLI or
 * browser login (`RenownCryptoBuilder`: WebCrypto ECDSA P-256, did:key
 * multicodec encoding), so the DID resolves with the standard key resolver.
 */
export async function generateWorkloadKey(): Promise<{
  did: string;
  keyPair: JwkKeyPair;
}> {
  const storage = new MemoryKeyStorage();
  const renownCrypto = await new RenownCryptoBuilder()
    .withKeyPairStorage(storage)
    .build();
  const keyPair = await storage.loadKeyPair();
  if (!keyPair) throw new Error("Key generation produced no key pair");
  return { did: renownCrypto.did, keyPair };
}

export interface IssueTokenInput {
  keyPair: JwkKeyPair;
  /** The DID the key pair must resolve to (guards against a mismatched row). */
  did: string;
  chainId: number;
  address: string;
  audience: string;
  expiresInSec: number;
  vetra: VetraWorkloadClaim;
}

/**
 * Issues a Renown auth bearer token: the same VC-JWT (ES256) that the SDK's
 * `createAuthBearerToken(chainId, "eip155", address, issuer, {aud, expiresIn})`
 * produces, signed by the identity's did:key, plus a top-level `vetra` claim.
 */
export async function issueWorkloadToken(
  input: IssueTokenInput,
): Promise<string> {
  const renownCrypto = await new RenownCryptoBuilder()
    .withKeyPairStorage(new MemoryKeyStorage(input.keyPair))
    .withChainId(input.chainId)
    .build();
  if (renownCrypto.did !== input.did) {
    throw new Error("Stored key pair does not match the identity's DID");
  }
  const issuer = renownCrypto.issuer;
  const payload = {
    sub: issuer.did,
    vc: {
      "@context": ["https://www.w3.org/2018/credentials/v1"],
      type: ["VerifiableCredential"],
      credentialSubject: {
        chainId: input.chainId,
        networkId: DEFAULT_RENOWN_NETWORK_ID,
        address: input.address,
      },
    },
    aud: input.audience,
    vetra: input.vetra,
  };
  return createVerifiableCredentialJwt(payload, issuer, {
    expiresIn: input.expiresInSec,
  });
}
