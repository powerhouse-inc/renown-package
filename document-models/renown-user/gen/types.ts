import type { PHDocument } from "document-model";
import type { RenownUserAction } from "./actions.js";
import type { RenownUserPHState } from "./ph-factories.js";
import type { RenownUserState } from "./schema/types.js";

export { z } from "./schema/index.js";
export type * from "./schema/types.js";
type RenownUserLocalState = Record<PropertyKey, never>;
export type RenownUserDocument = PHDocument<RenownUserPHState>;
export type { RenownUserState, RenownUserLocalState, RenownUserAction };
