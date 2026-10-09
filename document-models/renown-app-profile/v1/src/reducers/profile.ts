import type {
  RenownAppLink,
  RenownAppProfileProfileOperations,
  RenownAppProfileState,
} from "document-models/renown-app-profile/v1";
import {
  AppDidImmutableError,
  AppDidNotSetError,
  CategoryTooLongError,
  DescriptionTooLongError,
  DuplicateLinkIdError,
  InvalidAppDidError,
  InvalidImageRefError,
  InvalidLinkError,
  InvalidLogoError,
  InvalidPublisherDidError,
  InvalidWebsiteError,
  LinkNotFoundError,
  TooManyLinksError,
} from "../../gen/profile/error.js";
import {
  isAppDid,
  isAppImageRef,
  isLogo,
  isPublisherDid,
  isValidLinkLabel,
  isValidLinkUrl,
  isWebsite,
  MAX_CATEGORY_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MAX_LINKS,
  type AppImageRef,
} from "../utils.js";

/** undefined = leave unchanged, null = clear, string = set (trimmed). */
function patchValue(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** patchValue for an uploaded image: only attachment://v1:<sha256> refs are stored. */
function imageRefPatch(
  value: string | null | undefined,
): AppImageRef | null | undefined {
  const patched = patchValue(value);
  if (patched === undefined || patched === null) return patched;
  if (!isAppImageRef(patched)) {
    throw new InvalidImageRefError(
      `Not an attachment://v1:<sha256> reference: ${patched}`,
    );
  }
  return patched;
}

/**
 * The profile's links. Profiles created before links existed carry no
 * `links` key at all; they are treated as empty and the list is created on
 * first write.
 */
function linksOf(state: RenownAppProfileState): RenownAppLink[] {
  const legacy = state as { links?: RenownAppLink[] };
  legacy.links ??= [];
  return legacy.links;
}

function assertLink(label: string, url: string): void {
  if (!isValidLinkLabel(label)) {
    throw new InvalidLinkError(
      "Link label must be 1-40 characters without surrounding whitespace",
    );
  }
  if (!isValidLinkUrl(url)) {
    throw new InvalidLinkError(
      "Link URL must be an http(s) URL of at most 2048 characters",
    );
  }
}

export const renownAppProfileProfileOperations: RenownAppProfileProfileOperations =
  {
    setAppDidOperation(state, action) {
      const { appDid } = action.input;
      if (!isAppDid(appDid)) {
        throw new InvalidAppDidError(`Invalid app DID: ${appDid}`);
      }
      if (state.appDid && state.appDid !== appDid) {
        throw new AppDidImmutableError(
          `This profile belongs to ${state.appDid}`,
        );
      }
      state.appDid = appDid;
    },
    setPublisherDidOperation(state, action) {
      const { publisherDid } = action.input;
      if (!isPublisherDid(publisherDid)) {
        throw new InvalidPublisherDidError(
          `Invalid publisher DID: ${publisherDid}`,
        );
      }
      state.publisherDid = publisherDid;
    },
    setProfileOperation(state, action) {
      if (!state.appDid) {
        throw new AppDidNotSetError(
          "Set the app DID before editing the profile",
        );
      }
      const name = patchValue(action.input.name);
      const tagline = patchValue(action.input.tagline);
      const logo = patchValue(action.input.logo);
      const website = patchValue(action.input.website);
      const description = patchValue(action.input.description);
      const category = patchValue(action.input.category);
      const logoRef = imageRefPatch(action.input.logoRef);
      const coverRef = imageRefPatch(action.input.coverRef);
      if (website && !isWebsite(website)) {
        throw new InvalidWebsiteError(`Invalid website: ${website}`);
      }
      if (logo && !isLogo(logo)) {
        throw new InvalidLogoError(
          "The logo must be an https URL or a base64 image data URL",
        );
      }
      if (description && description.length > MAX_DESCRIPTION_LENGTH) {
        throw new DescriptionTooLongError(
          `The description exceeds ${MAX_DESCRIPTION_LENGTH} characters`,
        );
      }
      if (category && category.length > MAX_CATEGORY_LENGTH) {
        throw new CategoryTooLongError(
          `The category exceeds ${MAX_CATEGORY_LENGTH} characters`,
        );
      }
      if (name !== undefined) state.name = name;
      if (tagline !== undefined) state.tagline = tagline;
      if (logo !== undefined) state.logo = logo;
      if (website !== undefined) state.website = website;
      if (description !== undefined) state.description = description;
      if (category !== undefined) state.category = category;
      if (logoRef !== undefined) state.logoRef = logoRef;
      if (coverRef !== undefined) state.coverRef = coverRef;
    },
    addLinkOperation(state, action) {
      const { id, label, url } = action.input;
      const links = linksOf(state);
      if (links.some((link) => link.id === id)) {
        throw new DuplicateLinkIdError(`Link id ${id} is already used`);
      }
      if (links.length >= MAX_LINKS) {
        throw new TooManyLinksError(`A profile holds at most ${MAX_LINKS} links`);
      }
      assertLink(label, url);
      links.push({ id, label, url });
    },
    updateLinkOperation(state, action) {
      const { id, label, url } = action.input;
      const link = linksOf(state).find((l) => l.id === id);
      if (!link) throw new LinkNotFoundError(`No link with id ${id}`);
      const nextLabel = label ?? link.label;
      const nextUrl = url ?? link.url;
      assertLink(nextLabel, nextUrl);
      link.label = nextLabel;
      link.url = nextUrl;
    },
    removeLinkOperation(state, action) {
      const links = linksOf(state);
      const index = links.findIndex((l) => l.id === action.input.id);
      if (index === -1) {
        throw new LinkNotFoundError(`No link with id ${action.input.id}`);
      }
      links.splice(index, 1);
    },
    reorderLinksOperation(state, action) {
      const links = linksOf(state);
      const byId = new Map(links.map((link) => [link.id, link]));
      const front: RenownAppLink[] = [];
      for (const id of action.input.linkIds) {
        const link = byId.get(id);
        if (!link) throw new LinkNotFoundError(`No link with id ${id}`);
        if (!front.includes(link)) front.push(link);
      }
      state.links = [...front, ...links.filter((link) => !front.includes(link))];
    },
  };
