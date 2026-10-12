import { verifyTypedData } from "viem";
import { RELEASE_DOMAIN, releaseTypedData, type ReleaseMessage } from "../../../sdk/orgs.js";
import { verifyTypedDataOnChain } from "../../renown-auth/core/smart-wallet.js";

/**
 * True when `signer` signed the release attestation `message`: offline
 * (EOA ecrecover) first, then ERC-1271 / ERC-6492 on chain 1 for smart
 * wallets. The domain and types are the SDK's (sdk/orgs.ts), shared with
 * renown.id /verify, so signing and verifying cannot drift apart.
 */
export async function verifyRelease(signer: string, message: ReleaseMessage, signature: string): Promise<boolean> {
  const typedData = releaseTypedData(message);
  try {
    if (await verifyTypedData({ ...typedData, address: signer as `0x${string}`, signature: signature as `0x${string}` })) return true;
  } catch {
    // Not a well-formed EOA signature: a smart wallet may still prove it.
  }
  return verifyTypedDataOnChain({ chainId: RELEASE_DOMAIN.chainId, address: signer, signature, typedData });
}
