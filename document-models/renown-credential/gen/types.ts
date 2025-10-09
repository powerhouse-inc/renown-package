import type { PHDocument } from "document-model";
import type { RenownCredentialAction } from "./actions.js";
import type { RenownCredentialPHState } from "./ph-factories.js";
import type { RenownCredentialState } from "./schema/types.js";

export { z } from "./schema/index.js";
export type * from "./schema/types.js";
type RenownCredentialLocalState = Record<PropertyKey, never>;
export type RenownCredentialDocument = PHDocument<RenownCredentialPHState>;
export type {
  RenownCredentialState,
  RenownCredentialLocalState,
  RenownCredentialAction,
};
