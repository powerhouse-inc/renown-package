import type { DocumentModelModule } from "document-model";
import { createState } from "document-model";
import { defaultBaseState } from "document-model/core";
import type { RenownUserPHState } from "@powerhousedao/renown-package/document-models/renown-user";
import {
  actions,
  documentModel,
  reducer,
  utils,
} from "@powerhousedao/renown-package/document-models/renown-user";

/** Document model module for the Todo List document type */
export const RenownUser: DocumentModelModule<RenownUserPHState> = {
  version: 1,
  reducer,
  actions,
  utils,
  documentModel: createState(defaultBaseState(), documentModel),
};
