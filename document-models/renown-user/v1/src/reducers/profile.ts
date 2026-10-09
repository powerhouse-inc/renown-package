import type {
  RenownUserLink,
  RenownUserProfileOperations,
  RenownUserState,
} from "document-models/renown-user/v1";
import {
  BioTooLongError,
  DisplayNameLengthError,
  DuplicateLinkIdError,
  InvalidAvatarRefError,
  InvalidHandleError,
  InvalidLinkError,
  LinkNotFoundError,
  TooManyLinksError,
} from "../../gen/profile/error.js";
import {
  isValidAvatarRef,
  isValidDisplayName,
  isValidHandle,
  isValidLinkLabel,
  isValidLinkUrl,
  MAX_BIO_LENGTH,
  MAX_LINKS,
} from "../utils.js";

/**
 * The document's links. Profiles created before links existed carry no
 * `links` key at all; they are treated as empty and the list is created on
 * first write.
 */
function linksOf(state: RenownUserState): RenownUserLink[] {
  const legacy = state as { links?: RenownUserLink[] };
  legacy.links ??= [];
  return legacy.links;
}

function assertLink(label: string, url: string): void {
  if (!isValidLinkLabel(label)) {
    throw new InvalidLinkError("Link label must be 1-40 characters without surrounding whitespace");
  }
  if (!isValidLinkUrl(url)) {
    throw new InvalidLinkError("Link URL must be an http(s) URL of at most 2048 characters");
  }
}

export const renownUserProfileOperations: RenownUserProfileOperations = {
  setUsernameOperation(state, action) {
    state.username = action.input.username;
  },
  setEthAddressOperation(state, action) {
    state.ethAddress = action.input.ethAddress;
  },
  setUserImageOperation(state, action) {
    state.userImage = action.input.userImage;
  },
  setDisplayNameOperation(state, action) {
    const { displayName } = action.input;
    if (displayName == null) {
      state.displayName = null;
      return;
    }
    if (!isValidDisplayName(displayName)) {
      throw new DisplayNameLengthError(
        "Display name must be 1-64 characters without surrounding whitespace",
      );
    }
    state.displayName = displayName;
  },
  setHandleOperation(state, action) {
    const { handle } = action.input;
    if (handle == null) {
      state.handle = null;
      return;
    }
    if (!isValidHandle(handle)) {
      throw new InvalidHandleError(`Invalid handle: ${handle}`);
    }
    state.handle = handle;
  },
  setBioOperation(state, action) {
    const { bio } = action.input;
    if (bio != null && bio.length > MAX_BIO_LENGTH) {
      throw new BioTooLongError(`Bio exceeds ${MAX_BIO_LENGTH} characters`);
    }
    state.bio = bio || null;
  },
  setAvatarOperation(state, action) {
    const { avatar } = action.input;
    if (avatar != null && !isValidAvatarRef(avatar)) {
      throw new InvalidAvatarRefError(`Invalid avatar reference: ${avatar}`);
    }
    state.avatar = avatar ?? null;
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
    if (index === -1) throw new LinkNotFoundError(`No link with id ${action.input.id}`);
    links.splice(index, 1);
  },
  reorderLinksOperation(state, action) {
    const links = linksOf(state);
    const byId = new Map(links.map((link) => [link.id, link]));
    const front: RenownUserLink[] = [];
    for (const id of action.input.linkIds) {
      const link = byId.get(id);
      if (!link) throw new LinkNotFoundError(`No link with id ${id}`);
      if (!front.includes(link)) front.push(link);
    }
    state.links = [...front, ...links.filter((link) => !front.includes(link))];
  },
};
