import { PRODUCTION_REGISTRY_AUDIENCE } from "./config.js";
import type { RefClass } from "./types.js";

const PULL_MERGE_REF = /^refs\/pull\/([1-9][0-9]{0,9})\/merge$/;

/**
 * Classifies a CI run's `ref`: the production branch → PRODUCTION, a `v*`
 * tag → RELEASE, a pull request merge ref → PREVIEW. Anything else is not
 * trusted (null).
 */
export function classifyRef(
  ref: string,
  productionBranch: string,
): { refClass: RefClass; prNumber: number | null } | null {
  if (ref === `refs/heads/${productionBranch}`) {
    return { refClass: "PRODUCTION", prNumber: null };
  }
  if (ref.startsWith("refs/tags/v") && ref.length > "refs/tags/v".length) {
    return { refClass: "RELEASE", prNumber: null };
  }
  const pull = PULL_MERGE_REF.exec(ref);
  if (pull) return { refClass: "PREVIEW", prNumber: Number(pull[1]) };
  return null;
}

/**
 * Whether a run of `refClass` may get a token for `audience`: it must be in
 * the allowlist, and PREVIEW runs never get the production registry.
 */
export function isAudienceAllowed(
  refClass: RefClass,
  audience: string,
  allowlist: readonly string[],
): boolean {
  if (!allowlist.includes(audience)) return false;
  if (refClass === "PREVIEW" && audience === PRODUCTION_REGISTRY_AUDIENCE) {
    return false;
  }
  return true;
}
