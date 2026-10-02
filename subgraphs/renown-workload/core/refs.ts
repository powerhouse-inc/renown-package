import { PRODUCTION_REGISTRY_AUDIENCE } from "./config.js";
import type { RefClass } from "./types.js";

const PULL_MERGE_REF = /^refs\/pull\/([1-9][0-9]{0,9})\/merge$/;
const RELEASE_TAG_REF = /^refs\/tags\/v[0-9]/;

/** Events whose run is the repository's own code at `ref`, started by a push or a maintainer. */
const PRODUCTION_EVENTS = new Set(["push", "workflow_dispatch"]);

/**
 * Classifies a CI run by its GitHub `event_name` and `ref`. The ref alone is
 * not enough: `pull_request_target`, `workflow_run`, `issue_comment`,
 * `pull_request_review_comment` and others run with `ref` = the default
 * branch, yet may be triggered by (and run code from) a fork.
 *
 * - `push` / `workflow_dispatch` on the production branch → PRODUCTION
 * - `push` of a tag `v<digit>…` → RELEASE
 * - `pull_request` on `refs/pull/<n>/merge` → PREVIEW
 *
 * Anything else is not trusted (null).
 */
export function classifyRun(
  eventName: string,
  ref: string,
  productionBranch: string,
): { refClass: RefClass; prNumber: number | null } | null {
  if (
    PRODUCTION_EVENTS.has(eventName) &&
    ref === `refs/heads/${productionBranch}`
  ) {
    return { refClass: "PRODUCTION", prNumber: null };
  }
  if (eventName === "push" && RELEASE_TAG_REF.test(ref)) {
    return { refClass: "RELEASE", prNumber: null };
  }
  if (eventName === "pull_request") {
    const pull = PULL_MERGE_REF.exec(ref);
    if (pull) return { refClass: "PREVIEW", prNumber: Number(pull[1]) };
  }
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
