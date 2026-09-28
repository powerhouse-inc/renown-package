import { createPublicClient, http, type PublicClient, type TypedDataDefinition } from "viem";

/**
 * Signature checks for smart-contract wallets (ERC-1271, and ERC-6492 for a
 * wallet not deployed yet — Privy smart wallets, Ambire, Safe, Coinbase Smart
 * Wallet). Offline ecrecover can't verify these; viem's universal verifier
 * asks the chain with a read-only eth_call. Only used after the offline check
 * failed, so an EOA never costs an RPC round trip.
 *
 * RPC per chain: RENOWN_RPC_URL_<chainId>. Chain 1 falls back to
 * RENOWN_RPC_URL, then a public endpoint. A chain without an RPC can't carry a
 * smart-wallet signature. The RPC is trusted to answer eth_call honestly.
 */
const DEFAULT_MAINNET_RPC = "https://ethereum-rpc.publicnode.com";
const RPC_TIMEOUT_MS = 8_000;

const clients = new Map<number, PublicClient>();

function rpcUrl(chainId: number): string | undefined {
  const specific = process.env[`RENOWN_RPC_URL_${chainId}`]?.trim();
  if (specific) return specific;
  if (chainId === 1) return process.env.RENOWN_RPC_URL?.trim() || DEFAULT_MAINNET_RPC;
  return undefined;
}

function clientFor(chainId: number): PublicClient | undefined {
  const cached = clients.get(chainId);
  if (cached) return cached;
  const url = rpcUrl(chainId);
  if (!url) return undefined;
  const client = createPublicClient({ transport: http(url, { timeout: RPC_TIMEOUT_MS, retryCount: 1 }) });
  clients.set(chainId, client);
  return client;
}

/** True when `address` (EOA or smart wallet) signed `typedData`; false on any failure. */
export async function verifyTypedDataOnChain(args: {
  chainId: number;
  address: string;
  signature: string;
  typedData: TypedDataDefinition;
}): Promise<boolean> {
  const client = clientFor(args.chainId);
  if (!client) return false;
  try {
    return await client.verifyTypedData({
      ...args.typedData,
      address: args.address as `0x${string}`,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

/** True when `address` (EOA or smart wallet) `personal_sign`ed `message`; false on any failure. */
export async function verifyMessageOnChain(args: {
  chainId: number;
  address: string;
  message: string;
  signature: string;
}): Promise<boolean> {
  const client = clientFor(args.chainId);
  if (!client) return false;
  try {
    return await client.verifyMessage({
      address: args.address as `0x${string}`,
      message: args.message,
      signature: args.signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
