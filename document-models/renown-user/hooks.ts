import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  RenownUserAction,
  RenownUserDocument,
} from "@powerhousedao/renown-package/document-models/renown-user";
import {
  assertIsRenownUserDocument,
  isRenownUserDocument,
} from "./gen/document-schema.js";

/** Hook to get a RenownUser document by its id */
export function useRenownUserDocumentById(
  documentId: string | null | undefined,
):
  | [RenownUserDocument, DocumentDispatch<RenownUserAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isRenownUserDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected RenownUser document */
export function useSelectedRenownUserDocument(): [
  RenownUserDocument,
  DocumentDispatch<RenownUserAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsRenownUserDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all RenownUser documents in the selected drive */
export function useRenownUserDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isRenownUserDocument);
}

/** Hook to get all RenownUser documents in the selected folder */
export function useRenownUserDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isRenownUserDocument);
}
