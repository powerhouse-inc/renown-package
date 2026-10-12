export const DEFAULT_ORG_DID_HOST = "www.renown.id";
const DEFAULT_TIMELOCK_SECONDS = 172_800;
const DEFAULT_RECOVERY_SECONDS = 604_800;
const HOST_RE = /^[a-z0-9.-]+(?::[0-9]{1,5})?$/;
const ADDRESS_RE = /^0x[0-9a-f]{40}$/;

export interface OrgsConfig {
  /** did:web host, ":" percent-encoded (did:web rules). */
  didHost: string;
  /** Delay of ADD_OWNER, REMOVE_OWNER, TRANSFER_APP_OUT, CHANGE_HANDLE and DELETE_ORG proposals. */
  timelockSeconds: number;
  /** Delay of RECOVER proposals. */
  recoverySeconds: number;
  /** Lowercase addresses that resolve organization reports. */
  platformAdmins: ReadonlySet<string>;
}

function positiveSeconds(raw: string | undefined, fallback: number): number {
  const value = Number(raw?.trim());
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function addresses(raw: string): Set<string> {
  return new Set(
    raw
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => ADDRESS_RE.test(entry)),
  );
}

/** Reads the renown-orgs settings; every malformed value falls back to its safe default. */
export function loadOrgsConfig(env: Record<string, string | undefined>): OrgsConfig {
  const host = env.RENOWN_ORG_DID_HOST?.trim().toLowerCase();
  const admins = env.RENOWN_PLATFORM_ADMINS?.trim() ? env.RENOWN_PLATFORM_ADMINS : (env.ADMINS ?? "");
  return {
    didHost: host && HOST_RE.test(host) ? host.replace(":", "%3A") : DEFAULT_ORG_DID_HOST,
    timelockSeconds: positiveSeconds(env.RENOWN_ORG_TIMELOCK_SECONDS, DEFAULT_TIMELOCK_SECONDS),
    recoverySeconds: positiveSeconds(env.RENOWN_ORG_RECOVERY_SECONDS, DEFAULT_RECOVERY_SECONDS),
    platformAdmins: addresses(admins),
  };
}

/** did:web:<host>:org:<orgId>, served by renown.id at https://<host>/org/<orgId>/did.json. */
export function orgDid(didHost: string, orgId: string): string {
  return `did:web:${didHost}:org:${orgId}`;
}
