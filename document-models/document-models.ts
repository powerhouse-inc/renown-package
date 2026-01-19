import type { DocumentModelModule } from "document-model";
import { RenownCredential } from "./renown-credential/module.js";
import { RenownUser } from "./renown-user/module.js";

export const documentModels: DocumentModelModule<any>[] = [
  RenownCredential,
  RenownUser,
];
