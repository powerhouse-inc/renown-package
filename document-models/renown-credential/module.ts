import type { DocumentModelModule } from "document-model";
import { createState } from "document-model";
import { defaultBaseState } from "document-model/core";
import type { RenownCredentialPHState } from "@powerhousedao/renown-package/document-models/renown-credential";
import {
  actions,
  documentModel,
  reducer,
  utils,
} from "@powerhousedao/renown-package/document-models/renown-credential";

/** Document model module for the Todo List document type */
export const RenownCredential: DocumentModelModule<RenownCredentialPHState> = {
  version: 1,
  reducer,
  actions,
  utils,
  documentModel: createState(defaultBaseState(), documentModel),
};
