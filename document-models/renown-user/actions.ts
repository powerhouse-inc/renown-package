import { baseActions } from "document-model";
import { profileActions } from "./gen/creators.js";

/** Actions for the RenownUser document model */

export const actions = { ...baseActions, ...profileActions };
