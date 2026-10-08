import { getAddress } from "viem";

const DID_PKH = /^did:pkh:eip155:([1-9][0-9]{0,19}):(0x[0-9a-fA-F]{40})$/;
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** One DID per wallet, whatever chain it signed on: the Renown OIDC `sub` form. */
export function pkhDidFor(address: string): string {
  return `did:pkh:eip155:1:${getAddress(address.toLowerCase())}`;
}

/** A user DID in canonical form (did:pkh → chain 1 + EIP-55; did:key unchanged), or null. */
export function canonicalUserDid(did: string): string | null {
  const value = did.trim();
  const pkh = DID_PKH.exec(value);
  if (pkh) return pkhDidFor(pkh[2]);
  return DID_KEY.test(value) ? value : null;
}

/** An app DID (did:key), trimmed, or null. */
export function canonicalAppDid(did: string): string | null {
  const value = did.trim();
  return DID_KEY.test(value) ? value : null;
}

/** The lowercase address behind a did:pkh:eip155 DID or a bare address, or null. */
export function addressOf(didOrAddress: string): string | null {
  const value = didOrAddress.trim();
  if (ADDRESS.test(value)) return value.toLowerCase();
  const pkh = DID_PKH.exec(value);
  return pkh ? pkh[2].toLowerCase() : null;
}
