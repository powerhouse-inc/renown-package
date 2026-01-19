import { baseActions } from "document-model";
import { managerActions } from "./gen/creators.js";

/** Actions for the RenownCredential document model */

export const actions = { ...baseActions, ...managerActions };
