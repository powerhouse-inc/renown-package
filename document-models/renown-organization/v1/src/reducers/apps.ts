import type { RenownOrganizationAppsOperations } from "document-models/renown-organization/v1";
import { AppNotFoundError, DuplicateAppError, InvalidAppDidError } from "../../gen/apps/error.js";
import { isOrgAppDid } from "../utils.js";

export const renownOrganizationAppsOperations: RenownOrganizationAppsOperations = {
  addOrgAppOperation(state, action) {
    const { appDid, addedAt } = action.input;
    if (!isOrgAppDid(appDid)) throw new InvalidAppDidError(`Invalid app DID: ${appDid}`);
    if (state.apps.some((app) => app.appDid === appDid)) {
      throw new DuplicateAppError(`${appDid} already belongs to the organization`);
    }
    state.apps.push({ appDid, addedAt, frozen: false });
  },
  removeOrgAppOperation(state, action) {
    const { appDid } = action.input;
    const index = state.apps.findIndex((app) => app.appDid === appDid);
    if (index === -1) throw new AppNotFoundError(`${appDid} is not an app of the organization`);
    state.apps.splice(index, 1);
  },
  setAppFrozenOperation(state, action) {
    const { appDid, frozen } = action.input;
    const app = state.apps.find((a) => a.appDid === appDid);
    if (!app) throw new AppNotFoundError(`${appDid} is not an app of the organization`);
    app.frozen = frozen;
  },
};
