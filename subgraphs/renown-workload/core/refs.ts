import { PRODUCTION_REGISTRY_AUDIENCE } from "./config.js";
import type { RefClass } from "./types.js";

const PULL_MERGE_REF = /^refs\/pull\/([1-9][0-9]{0,9})\/merge$/;
const RELEASE_TAG_REF = /^refs\/tags\/v[0-9]/;

// A git branch name, conservatively (a subset of git-check-ref-format):
// ASCII letters, digits, `.`, `_`, `-`, `/`; no `..` or `//`.
const BRANCH_ALLOWED = /^[A-Za-z0-9._/-]+$/;
const BRANCH_FORBIDDEN = /\.\.|\/\//;

/** Whether `branch` is a plain branch name (without `refs/heads/`) we accept. */
export function isValidBranchName(branch: string): boolean {
  return !(
    branch.length === 0 ||
    branch.length > 255 ||
    !BRANCH_ALLOWED.test(branch) ||
    BRANCH_FORBIDDEN.test(branch) ||
    branch.startsWith("-") ||
    branch.startsWith("/") ||
    branch.endsWith("/") ||
    branch.endsWith(".") ||
    branch.endsWith(".lock") ||
    branch.startsWith("refs/")
  );
}

/**
 * Whether `branch` matches a release branch `pattern`: an exact name, or a
 * name in which each `*` matches one or more characters other than `/`
 * (`*.x` matches `1.x`; `release/*` matches `release/2.0`, not
 * `release/2.0/rc`). No other glob syntax.
 */
export function matchesBranchPattern(branch: string, pattern: string): boolean {
  if (!pattern.includes("*")) return branch === pattern;
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${source}$`).test(branch);
}

/** Whether `branch` may publish releases: the production branch, or one matching `releaseBranches`. */
export function isReleaseBranch(
  branch: string,
  productionBranch: string,
  releaseBranches: readonly string[],
): boolean {
  return (
    branch === productionBranch ||
    releaseBranches.some((pattern) => matchesBranchPattern(branch, pattern))
  );
}

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
