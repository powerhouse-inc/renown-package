import { isValidHandle } from "../../../document-models/renown-user/index.js";

/** Handles nobody may claim: routes on renown.id and platform names. */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "admin", "api", "app", "apps", "media", "profile", "settings", "renown", "vetra",
  "powerhouse", "www", "help", "about", "login", "console", "oidc",
]);

export type HandleProblem = "INVALID" | "RESERVED";

/** Lowercases and trims what a user typed; the stored form of a handle. */
export function normalizeHandle(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Why a normalized handle can't be claimed (format or reserved), or null if it can. */
export function handleProblem(handle: string): HandleProblem | null {
  if (!isValidHandle(handle)) return "INVALID";
  if (RESERVED_HANDLES.has(handle)) return "RESERVED";
  return null;
}
