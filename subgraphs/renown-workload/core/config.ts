import type { WorkloadConfig } from "./types.js";

/** The production npm registry: never reachable by PREVIEW (pull request) runs. */
export const PRODUCTION_REGISTRY_AUDIENCE = "https://registry.vetra.io";

export const DEFAULT_AUDIENCES = [
  PRODUCTION_REGISTRY_AUDIENCE,
  "https://registry.dev.vetra.io",
  "https://switchboard.vetra.io",
];

const KEY_BYTES = 32;

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined;
}

/** Strips trailing slashes, so `https://x/` and `https://x` are the same audience. */
export function normalizeAudience(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function decodeKey(raw: string): Uint8Array | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(raw)) return null;
  const bytes = Buffer.from(
    raw.replace(/-/g, "+").replace(/_/g, "/"),
    "base64",
  );
  return bytes.length === KEY_BYTES ? new Uint8Array(bytes) : null;
}

/**
 * Reads the workload config from the environment. Never throws: a missing
 * or malformed value disables only what depends on it, and `problems` says
 * why (without echoing key material).
 */
export function loadConfig(env: Record<string, string | undefined>): {
  config: WorkloadConfig;
  problems: string[];
} {
  const problems: string[] = [];

  const rawKey = nonEmpty(env.RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY);
  let encryptionKey: Uint8Array | null = null;
  if (rawKey === undefined) {
    problems.push(
      "RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY unset — token exchange and identity registration disabled",
    );
  } else {
    encryptionKey = decodeKey(rawKey);
    if (encryptionKey === null) {
      problems.push(
        "RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY invalid (must be base64 of 32 bytes) — token exchange and identity registration disabled",
      );
    }
  }

  const registrationToken =
    nonEmpty(env.RENOWN_WORKLOAD_REGISTRATION_TOKEN) ?? null;
  if (registrationToken === null) {
    problems.push(
      "RENOWN_WORKLOAD_REGISTRATION_TOKEN unset — workload identity API disabled",
    );
  }

  const rawAudiences = nonEmpty(env.RENOWN_WORKLOAD_AUDIENCES);
  const audiences =
    rawAudiences === undefined
      ? [...DEFAULT_AUDIENCES]
      : [
          ...new Set(
            rawAudiences
              .split(",")
              .map(normalizeAudience)
              .filter((a) => a.length > 0),
          ),
        ];

  return { config: { encryptionKey, registrationToken, audiences }, problems };
}
