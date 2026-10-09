import type { Action } from "document-model";
import {
  actions as userActions,
  isValidAvatarRef,
  isValidDisplayName,
  isValidLinkLabel,
  isValidLinkUrl,
  MAX_BIO_LENGTH,
  MAX_LINKS,
  type RenownUserLink,
} from "../../../document-models/renown-user/index.js";
import { handleProblem, normalizeHandle } from "./handle.js";
import type { ProfileFields, ProfileLink } from "./signed-message.js";

/**
 * A validated identity patch. `undefined` leaves a field unchanged, `null`
 * clears it; `links` is the complete desired list when present.
 */
export interface IdentityPatch {
  displayName?: string | null;
  handle?: string | null;
  bio?: string | null;
  links?: ProfileLink[];
  avatar?: string | null;
}

/** Thrown for an input that fails validation; `field` names the offending input. */
export class ProfileInputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ProfileInputError";
  }
}

/**
 * Applies the patch rules to the raw (signed) input: absent or null means
 * unchanged, "" (or []) clears. Text is trimmed and the handle lowercased.
 * @throws {ProfileInputError} for a value the model would reject, or a reserved handle.
 */
export function toIdentityPatch(input: ProfileFields): IdentityPatch {
  const patch: IdentityPatch = {};

  if (input.displayName != null) {
    const displayName = input.displayName.trim();
    if (displayName !== "" && !isValidDisplayName(displayName)) {
      throw new ProfileInputError("displayName", "Display name must be 1-64 characters");
    }
    patch.displayName = displayName || null;
  }

  if (input.handle != null) {
    const handle = normalizeHandle(input.handle);
    if (handle !== "") {
      const problem = handleProblem(handle);
      if (problem === "RESERVED") throw new ProfileInputError("handle", `The handle "${handle}" is reserved`);
      if (problem === "INVALID") {
        throw new ProfileInputError(
          "handle",
          "Handle must be 3-30 lowercase letters, digits or hyphens, not starting or ending with a hyphen",
        );
      }
    }
    patch.handle = handle || null;
  }

  if (input.bio != null) {
    const bio = input.bio.trim();
    if (bio.length > MAX_BIO_LENGTH) {
      throw new ProfileInputError("bio", `Bio must be at most ${MAX_BIO_LENGTH} characters`);
    }
    patch.bio = bio || null;
  }

  if (input.links != null) {
    if (input.links.length > MAX_LINKS) {
      throw new ProfileInputError("links", `A profile holds at most ${MAX_LINKS} links`);
    }
    const ids = new Set<string>();
    patch.links = input.links.map((link) => {
      const label = link.label.trim();
      const url = link.url.trim();
      if (!link.id || ids.has(link.id)) throw new ProfileInputError("links", "Every link needs a unique id");
      ids.add(link.id);
      if (!isValidLinkLabel(label)) throw new ProfileInputError("links", "Link labels must be 1-40 characters");
      if (!isValidLinkUrl(url)) throw new ProfileInputError("links", "Links must be http(s) URLs");
      return { id: link.id, label, url };
    });
  }

  if (input.avatar != null) {
    if (input.avatar !== "" && !isValidAvatarRef(input.avatar)) {
      throw new ProfileInputError("avatar", "Avatar must be an attachment://v1:<sha256> reference");
    }
    patch.avatar = input.avatar || null;
  }

  return patch;
}

/**
 * The renown-user actions that turn `current` links into `desired` (removes,
 * then updates, then adds, then one reorder if the order still differs).
 */
export function linkActions(current: readonly RenownUserLink[], desired: readonly ProfileLink[]): Action[] {
  const wanted = new Map(desired.map((link) => [link.id, link]));
  const out: Action[] = [];
  const kept: string[] = [];
  for (const link of current) {
    const next = wanted.get(link.id);
    if (!next) {
      out.push(userActions.removeLink({ id: link.id }));
      continue;
    }
    kept.push(link.id);
    if (next.label !== link.label || next.url !== link.url) {
      out.push(userActions.updateLink({ id: link.id, label: next.label, url: next.url }));
    }
  }
  const existing = new Set(kept);
  for (const link of desired) {
    if (!existing.has(link.id)) {
      out.push(userActions.addLink({ id: link.id, label: link.label, url: link.url }));
      kept.push(link.id);
    }
  }
  const order = desired.map((link) => link.id);
  if (kept.some((id, i) => id !== order[i])) out.push(userActions.reorderLinks({ linkIds: order }));
  return out;
}

/** The actions for the scalar identity fields of `patch`, in a fixed order. */
export function identityActions(patch: IdentityPatch): Action[] {
  const out: Action[] = [];
  if (patch.displayName !== undefined) out.push(userActions.setDisplayName({ displayName: patch.displayName }));
  if (patch.handle !== undefined) out.push(userActions.setHandle({ handle: patch.handle }));
  if (patch.bio !== undefined) out.push(userActions.setBio({ bio: patch.bio }));
  if (patch.avatar !== undefined) {
    out.push(
      userActions.setAvatar({ avatar: patch.avatar as `attachment://v${number}:${string}` | null }),
    );
  }
  return out;
}
