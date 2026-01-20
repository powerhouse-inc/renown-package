import type { DocumentDispatch } from "@powerhousedao/reactor-browser";
import {
  useDocumentById,
  useDocumentsInSelectedDrive,
  useDocumentsInSelectedFolder,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type {
  RenownCredentialAction,
  RenownCredentialDocument,
} from "@powerhousedao/renown-package/document-models/renown-credential";
import {
  assertIsRenownCredentialDocument,
  isRenownCredentialDocument,
} from "./gen/document-schema.js";

/** Hook to get a RenownCredential document by its id */
export function useRenownCredentialDocumentById(
  documentId: string | null | undefined,
):
  | [RenownCredentialDocument, DocumentDispatch<RenownCredentialAction>]
  | [undefined, undefined] {
  const [document, dispatch] = useDocumentById(documentId);
  if (!isRenownCredentialDocument(document)) return [undefined, undefined];
  return [document, dispatch];
}

/** Hook to get the selected RenownCredential document */
export function useSelectedRenownCredentialDocument(): [
  RenownCredentialDocument,
  DocumentDispatch<RenownCredentialAction>,
] {
  const [document, dispatch] = useSelectedDocument();

  assertIsRenownCredentialDocument(document);
  return [document, dispatch] as const;
}

/** Hook to get all RenownCredential documents in the selected drive */
export function useRenownCredentialDocumentsInSelectedDrive() {
  const documentsInSelectedDrive = useDocumentsInSelectedDrive();
  return documentsInSelectedDrive?.filter(isRenownCredentialDocument);
}

/** Hook to get all RenownCredential documents in the selected folder */
export function useRenownCredentialDocumentsInSelectedFolder() {
  const documentsInSelectedFolder = useDocumentsInSelectedFolder();
  return documentsInSelectedFolder?.filter(isRenownCredentialDocument);
}
