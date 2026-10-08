/** Most metrics one app may keep for one user; bounds document state. */
export const MAX_METRICS_PER_APP = 32;

const DID_PKH = /^did:pkh:eip155:[1-9][0-9]{0,19}:0x[0-9a-fA-F]{40}$/;
const DID_KEY = /^did:key:z[1-9A-HJ-NP-Za-km-z]{32,128}$/;
const METRIC = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;

/** A Renown user: a wallet (`did:pkh:eip155`) or a key (`did:key`). */
export function isUserDid(value: string): boolean {
  return DID_PKH.test(value) || DID_KEY.test(value);
}

/** An app identity: always a `did:key` (Vetra App identities are did:key). */
export function isAppDid(value: string): boolean {
  return DID_KEY.test(value);
}

export function isMetricName(value: string): boolean {
  return METRIC.test(value);
}
