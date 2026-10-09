import type { Action } from "document-model";
import {
  actions as appActions,
  isAppImageRef,
  isValidLinkLabel,
  isValidLinkUrl,
  MAX_CATEGORY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LINKS,
} from "../../../document-models/renown-app-profile/index.js";
import { linkActions } from "../../renown-auth/core/profile-patch.js";

export interface AppProfileLink {
  id: string;
  label: string;
  url: string;
}

/** The rich fields upsertAppProfile takes besides name/tagline/logo/website. */
export interface RichProfileFields {
  description?: string | null;
  category?: string | null;
  logoRef?: string | null;
  coverRef?: string | null;
  links?: readonly AppProfileLink[] | null;
}

/**
 * Validated rich fields. `undefined` leaves a field unchanged; `""` clears it
 * (SET_PROFILE's own rule); `links` is the whole desired list.
 */
export interface RichProfilePatch {
  description?: string;
  category?: string;
  logoRef?: string;
  coverRef?: string;
  links?: AppProfileLink[];
}

/** Thrown for an input that fails validation; `field` names the offending argument. */
export class AppProfileInputError extends Error {
  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "AppProfileInputError";
  }
}

/**
 * Applies the patch rules to the raw input: absent or null means unchanged,
 * "" (or []) clears. Text and refs are trimmed.
 * @throws {AppProfileInputError} for a value the model would reject.
 */
export function toRichProfilePatch(input: RichProfileFields): RichProfilePatch {
  const patch: RichProfilePatch = {};

  if (input.description != null) {
    const description = input.description.trim();
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      throw new AppProfileInputError(
        "description",
        `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
      );
    }
    patch.description = description;
  }

  if (input.category != null) {
    const category = input.category.trim();
    if (category.length > MAX_CATEGORY_LENGTH) {
      throw new AppProfileInputError("category", `Category must be at most ${MAX_CATEGORY_LENGTH} characters`);
    }
    patch.category = category;
  }

  for (const field of ["logoRef", "coverRef"] as const) {
    const raw = input[field];
    if (raw == null) continue;
    const ref = raw.trim();
    if (ref !== "" && !isAppImageRef(ref)) {
      throw new AppProfileInputError(field, `${field} must be an attachment://v1:<sha256> reference`);
    }
    patch[field] = ref;
  }

  if (input.links != null) {
    if (input.links.length > MAX_LINKS) {
      throw new AppProfileInputError("links", `A profile holds at most ${MAX_LINKS} links`);
    }
    const ids = new Set<string>();
    patch.links = input.links.map((link) => {
      const label = link.label.trim();
      const url = link.url.trim();
      if (!link.id || ids.has(link.id)) throw new AppProfileInputError("links", "Every link needs a unique id");
      ids.add(link.id);
      if (!isValidLinkLabel(label)) throw new AppProfileInputError("links", "Link labels must be 1-40 characters");
      if (!isValidLinkUrl(url)) throw new AppProfileInputError("links", "Links must be http(s) URLs");
      return { id: link.id, label, url };
    });
  }

  return patch;
}

/** The renown-app-profile link operations that turn `current` into `desired`. */
export function appLinkActions(
  current: readonly AppProfileLink[],
  desired: readonly AppProfileLink[],
): Action[] {
  return linkActions(current, desired, appActions);
}
