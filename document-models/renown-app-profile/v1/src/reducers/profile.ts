import type { RenownAppProfileProfileOperations } from "document-models/renown-app-profile/v1";
import {
  AppDidImmutableError,
  AppDidNotSetError,
  InvalidAppDidError,
  InvalidLogoError,
  InvalidPublisherDidError,
  InvalidWebsiteError,
} from "../../gen/profile/error.js";
import { isAppDid, isLogo, isPublisherDid, isWebsite } from "../utils.js";

/** undefined = leave unchanged, null = clear, string = set (trimmed). */
function patchValue(
  value: string | null | undefined,
): string | null | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
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
      if (website && !isWebsite(website)) {
        throw new InvalidWebsiteError(`Invalid website: ${website}`);
      }
      if (logo && !isLogo(logo)) {
        throw new InvalidLogoError(
          "The logo must be an https URL or a base64 image data URL",
        );
      }
      if (name !== undefined) state.name = name;
      if (tagline !== undefined) state.tagline = tagline;
      if (logo !== undefined) state.logo = logo;
      if (website !== undefined) state.website = website;
    },
  };
