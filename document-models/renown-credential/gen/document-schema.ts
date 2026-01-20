import {
  BaseDocumentHeaderSchema,
  BaseDocumentStateSchema,
} from "document-model";
import { z } from "zod";
import { renownCredentialDocumentType } from "./document-type.js";
import { RenownCredentialStateSchema } from "./schema/zod.js";
import type {
  RenownCredentialDocument,
  RenownCredentialPHState,
} from "./types.js";

/** Schema for validating the header object of a RenownCredential document */
export const RenownCredentialDocumentHeaderSchema =
  BaseDocumentHeaderSchema.extend({
    documentType: z.literal(renownCredentialDocumentType),
  });

/** Schema for validating the state object of a RenownCredential document */
export const RenownCredentialPHStateSchema = BaseDocumentStateSchema.extend({
  global: RenownCredentialStateSchema(),
});

export const RenownCredentialDocumentSchema = z.object({
  header: RenownCredentialDocumentHeaderSchema,
  state: RenownCredentialPHStateSchema,
  initialState: RenownCredentialPHStateSchema,
});

/** Simple helper function to check if a state object is a RenownCredential document state object */
export function isRenownCredentialState(
  state: unknown,
): state is RenownCredentialPHState {
  return RenownCredentialPHStateSchema.safeParse(state).success;
}

/** Simple helper function to assert that a document state object is a RenownCredential document state object */
export function assertIsRenownCredentialState(
  state: unknown,
): asserts state is RenownCredentialPHState {
  RenownCredentialPHStateSchema.parse(state);
}

/** Simple helper function to check if a document is a RenownCredential document */
export function isRenownCredentialDocument(
  document: unknown,
): document is RenownCredentialDocument {
  return RenownCredentialDocumentSchema.safeParse(document).success;
}

/** Simple helper function to assert that a document is a RenownCredential document */
export function assertIsRenownCredentialDocument(
  document: unknown,
): asserts document is RenownCredentialDocument {
  RenownCredentialDocumentSchema.parse(document);
}
