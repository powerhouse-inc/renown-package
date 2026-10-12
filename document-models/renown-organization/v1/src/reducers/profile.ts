import type { RenownOrganizationProfileOperations } from "document-models/renown-organization/v1";
import {
  AlreadyInitializedError,
  BioTooLongError,
  InvalidAvatarError,
  InvalidHandleError,
  InvalidLinkError,
  InvalidWebsiteError,
  NameLengthError,
  TooManyLinksError,
} from "../../gen/profile/error.js";
import {
  isOrgAvatarRef,
  isOrgHandle,
  isOrgLinkLabel,
  isOrgLinkUrl,
  isOrgName,
  isOrgWebsite,
  MAX_ORG_BIO_LENGTH,
  MAX_ORG_LINKS,
} from "../utils.js";

const NAME_RULE = "The name must be 1-64 characters without surrounding whitespace";

/** undefined (absent) and null keep a field; "" (after trimming) clears it; otherwise the trimmed value. */
function patched(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export const renownOrganizationProfileOperations: RenownOrganizationProfileOperations = {
  initOrganizationOperation(state, action) {
    const { handle, name, createdBy } = action.input;
    if (state.createdBy) throw new AlreadyInitializedError("The organization is already initialized");
    if (!isOrgHandle(handle)) throw new InvalidHandleError(`Invalid handle: ${handle}`);
    if (!isOrgName(name)) throw new NameLengthError(NAME_RULE);
    state.handle = handle;
    state.name = name;
    state.createdBy = createdBy.toLowerCase();
  },
  setOrgProfileOperation(state, action) {
    const { name, links } = action.input;
    const bio = patched(action.input.bio);
    const website = patched(action.input.website);
    const avatar = patched(action.input.avatar);
    if (name != null && !isOrgName(name)) throw new NameLengthError(NAME_RULE);
    if (bio && bio.length > MAX_ORG_BIO_LENGTH) {
      throw new BioTooLongError(`The bio exceeds ${MAX_ORG_BIO_LENGTH} characters`);
    }
    if (website && !isOrgWebsite(website)) throw new InvalidWebsiteError(`Invalid website: ${website}`);
    if (avatar && !isOrgAvatarRef(avatar)) throw new InvalidAvatarError(`Invalid avatar reference: ${avatar}`);
    if (links) {
      if (links.length > MAX_ORG_LINKS) {
        throw new TooManyLinksError(`An organization holds at most ${MAX_ORG_LINKS} links`);
      }
      const ids = new Set<string>();
      for (const link of links) {
        if (ids.has(link.id)) throw new InvalidLinkError(`Duplicate link id ${link.id}`);
        ids.add(link.id);
        if (!isOrgLinkLabel(link.label) || !isOrgLinkUrl(link.url)) {
          throw new InvalidLinkError(`Link ${link.id} needs a 1-40 character label and an http(s) URL`);
        }
      }
    }
    if (name != null) state.name = name;
    if (bio !== undefined) state.bio = bio;
    if (website !== undefined) state.website = website;
    if (avatar !== undefined) state.avatar = avatar;
    if (links) state.links = links.map(({ id, label, url }) => ({ id, label, url }));
  },
  setOrgHandleOperation(state, action) {
    const { handle } = action.input;
    if (!isOrgHandle(handle)) throw new InvalidHandleError(`Invalid handle: ${handle}`);
    state.handle = handle;
  },
  setOrgListedOperation(state, action) {
    state.listed = action.input.listed;
  },
  setMembersPublicOperation(state, action) {
    state.membersPublic = action.input.membersPublic;
  },
  archiveOrgOperation(state, action) {
    const at = action.input.archivedAt;
    state.archived = true;
    state.listed = false;
    for (const member of state.members) {
      if (member.status === "INVITED") {
        member.status = "REVOKED";
        member.updatedAt = at;
      } else if (member.status === "ACTIVE") {
        member.status = "REMOVED";
        member.updatedAt = at;
      }
    }
    for (const team of state.teams) team.memberIds = [];
  },
  setTakenDownOperation(state, action) {
    state.takenDown = action.input.takenDown;
  },
};
