import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import {
  Button,
  Checkbox,
  StringField,
  Toggle,
  UrlField,
  type CheckboxValue,
} from "@powerhousedao/document-engineering";
import type { EditorProps } from "document-model";
import { useEffect, useState } from "react";
import {
  actions,
  useSelectedRenownOidcClientDocument,
  type RenownOidcClientDocument,
} from "document-models/renown-oidc-client";
import { generateClientSecret } from "./secret.js";

export type IProps = EditorProps;

export default function Editor(_props: IProps) {
  const [document, dispatch] = useSelectedRenownOidcClientDocument();

  return <EditorContent document={document} dispatch={dispatch} />;
}

/** Reads the error of the last dispatched operation, when it belongs to one of `actionTypes`. */
function useLastOperationError(
  document: RenownOidcClientDocument,
  actionTypes: string[],
): string | undefined {
  const globalOps = document.operations.global;
  const lastOp = globalOps[globalOps.length - 1];
  if (lastOp && actionTypes.includes(lastOp.action.type)) {
    return lastOp.error;
  }
  return undefined;
}

function ErrorText({ children }: { children?: string }) {
  if (!children) return null;
  return <p className="mt-2 text-sm text-red-600">{children}</p>;
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
      <div className="px-6 py-5 bg-gray-50">
        <h2 className="text-xl font-bold text-gray-900">{title}</h2>
        {description ? (
          <p className="text-sm text-gray-600 mt-1">{description}</p>
        ) : null}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

// Hooks live here so they run unconditionally.
function EditorContent({
  document: typedDocument,
  dispatch,
}: {
  document: RenownOidcClientDocument;
  dispatch: ReturnType<typeof useSelectedRenownOidcClientDocument>[1];
}) {
  const {
    state: { global },
  } = typedDocument;
  const {
    name,
    redirectUris,
    allowedSubjects,
    allowAnySubject,
    clientSecretHash,
    status,
  } = global;

  // Name
  const [nameDraft, setNameDraft] = useState(name ?? "");
  useEffect(() => {
    setNameDraft(name ?? "");
  }, [name]);
  const nameError = useLastOperationError(typedDocument, ["SET_CLIENT_INFO"]);
  const nameIsDirty = nameDraft.trim() !== (name ?? "");
  const handleSaveName = () => {
    if (!nameDraft.trim()) return;
    dispatch(actions.setClientInfo({ name: nameDraft.trim() }));
  };

  // Client ID
  const [idCopied, setIdCopied] = useState(false);
  const handleCopyClientId = () => {
    void navigator.clipboard.writeText(typedDocument.header.id);
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 1500);
  };

  // Redirect URIs
  const [newRedirectUri, setNewRedirectUri] = useState("");
  const [redirectUriInputError, setRedirectUriInputError] = useState<
    string | undefined
  >();
  const redirectUriOperationError = useLastOperationError(typedDocument, [
    "ADD_REDIRECT_URI",
    "REMOVE_REDIRECT_URI",
  ]);
  const redirectUriError = redirectUriInputError ?? redirectUriOperationError;
  const handleAddRedirectUri = () => {
    const uri = newRedirectUri.trim();
    if (!uri) return;
    try {
      // `actions.addRedirectUri` validates the URL's shape synchronously and
      // throws before ever reaching the reducer/document, so it needs its own
      // try/catch alongside the reducer-recorded errors from `document.operations`.
      dispatch(actions.addRedirectUri({ uri }));
      setNewRedirectUri("");
      setRedirectUriInputError(undefined);
    } catch (error) {
      setRedirectUriInputError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };
  const handleRemoveRedirectUri = (uri: string) => {
    dispatch(actions.removeRedirectUri({ uri }));
  };

  // Allowed subjects
  const [newSubject, setNewSubject] = useState("");
  const subjectError = useLastOperationError(typedDocument, [
    "ADD_ALLOWED_SUBJECT",
    "REMOVE_ALLOWED_SUBJECT",
    "SET_ALLOW_ANY_SUBJECT",
  ]);
  const handleAddSubject = () => {
    if (!newSubject.trim()) return;
    dispatch(actions.addAllowedSubject({ subject: newSubject.trim() }));
    setNewSubject("");
  };
  const handleRemoveSubject = (subject: string) => {
    dispatch(actions.removeAllowedSubject({ subject }));
  };
  const handleToggleAllowAny = (allow: boolean) => {
    dispatch(actions.setAllowAnySubject({ allow }));
  };

  // Status
  const statusError = useLastOperationError(typedDocument, ["SET_STATUS"]);
  const handleToggleStatus = (checked: boolean) => {
    dispatch(actions.setStatus({ status: checked ? "ACTIVE" : "DISABLED" }));
  };

  // Client secret
  const [plaintextSecret, setPlaintextSecret] = useState<string | null>(null);
  const [isRotating, setIsRotating] = useState(false);
  const secretError = useLastOperationError(typedDocument, [
    "SET_CLIENT_SECRET_HASH",
  ]);
  const handleRotateSecret = async () => {
    setIsRotating(true);
    try {
      const { secret, hash } = await generateClientSecret();
      dispatch(actions.setClientSecretHash({ hash }));
      setPlaintextSecret(secret);
    } finally {
      setIsRotating(false);
    }
  };
  const handleMakePublic = () => {
    dispatch(actions.setClientSecretHash({ hash: null }));
    setPlaintextSecret(null);
  };
  const [secretCopied, setSecretCopied] = useState(false);
  const handleCopySecret = () => {
    if (!plaintextSecret) return;
    void navigator.clipboard.writeText(plaintextSecret);
    setSecretCopied(true);
    setTimeout(() => setSecretCopied(false), 1500);
  };

  return (
    <div className="html-defaults-container min-h-screen bg-gray-50">
      <DocumentToolbar document={typedDocument} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-8">
          Renown OIDC Client
        </h1>

        <div className="grid grid-cols-1 gap-6">
          {/* Name */}
          <Section
            title="Name"
            description="How this client shows up to users and admins."
          >
            <div className="flex items-start gap-3">
              <StringField
                name="clientName"
                label=""
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Enter client name"
                className="flex-1"
              />
              <Button onClick={handleSaveName} disabled={!nameIsDirty}>
                Save
              </Button>
            </div>
            <ErrorText>{nameError}</ErrorText>
          </Section>

          {/* Client ID */}
          <Section
            title="Client ID"
            description="The OIDC client_id, used by relying parties."
          >
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={typedDocument.header.id}
                readOnly
                className="flex-1 font-mono text-sm bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700"
              />
              <Button variant="outline" onClick={handleCopyClientId}>
                {idCopied ? "Copied" : "Copy"}
              </Button>
            </div>
          </Section>

          {/* Redirect URIs */}
          <Section
            title="Redirect URIs"
            description="Allowed callback URLs for the authorization code flow."
          >
            <ul className="space-y-2 mb-4">
              {redirectUris.length === 0 && (
                <li className="text-gray-500 italic text-sm">
                  No redirect URIs configured
                </li>
              )}
              {redirectUris.map((uri) => (
                <li
                  key={uri}
                  className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                >
                  <span className="font-mono text-sm break-all">{uri}</span>
                  <Button
                    variant="outline"
                    onClick={() => handleRemoveRedirectUri(uri)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex items-start gap-3">
              <UrlField
                name="newRedirectUri"
                label=""
                value={newRedirectUri}
                onChange={(e) => setNewRedirectUri(e.target.value)}
                placeholder="https://example.com/callback"
                className="flex-1"
              />
              <Button onClick={handleAddRedirectUri}>Add</Button>
            </div>
            <ErrorText>{redirectUriError}</ErrorText>
          </Section>

          {/* Allowed subjects */}
          <Section
            title="Allowed subjects"
            description="Renown users (subjects) permitted to authenticate with this client."
          >
            <div className="mb-4">
              <Checkbox
                id="allow-any-subject"
                label="Allow any Renown user"
                value={allowAnySubject}
                onChange={(checked: CheckboxValue) =>
                  handleToggleAllowAny(checked === true)
                }
              />
            </div>
            <ul className="space-y-2 mb-4">
              {allowedSubjects.length === 0 && (
                <li className="text-gray-500 italic text-sm">
                  No subjects allow-listed
                </li>
              )}
              {allowedSubjects.map((subject) => (
                <li
                  key={subject}
                  className="flex items-center justify-between gap-3 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2"
                >
                  <span className="font-mono text-sm break-all">{subject}</span>
                  <Button
                    variant="outline"
                    onClick={() => handleRemoveSubject(subject)}
                  >
                    Remove
                  </Button>
                </li>
              ))}
            </ul>
            <div className="flex items-start gap-3">
              <StringField
                name="newSubject"
                label=""
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                placeholder="did:... or subject identifier"
                disabled={allowAnySubject}
                className="flex-1"
              />
              <Button onClick={handleAddSubject} disabled={allowAnySubject}>
                Add
              </Button>
            </div>
            <ErrorText>{subjectError}</ErrorText>
          </Section>

          {/* Status */}
          <Section
            title="Status"
            description="Disabled clients cannot authenticate."
          >
            <Toggle
              label={status === "ACTIVE" ? "Active" : "Disabled"}
              value={status === "ACTIVE"}
              onChange={handleToggleStatus}
            />
            <ErrorText>{statusError}</ErrorText>
          </Section>

          {/* Client secret */}
          <Section
            title="Client secret"
            description="Confidential clients authenticate with a secret; public clients use PKCE."
          >
            <p className="text-sm font-semibold text-gray-900 mb-4">
              {clientSecretHash ? "Confidential" : "Public (PKCE)"}
            </p>

            {plaintextSecret ? (
              <div className="mb-4 bg-yellow-50 border border-yellow-300 rounded-lg p-4">
                <p className="text-sm text-yellow-800 font-semibold mb-2">
                  Copy it now — it is not stored.
                </p>
                <div className="flex items-center gap-3">
                  <code className="flex-1 font-mono text-sm break-all bg-white border border-yellow-200 rounded px-3 py-2">
                    {plaintextSecret}
                  </code>
                  <Button variant="outline" onClick={handleCopySecret}>
                    {secretCopied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex items-center gap-3">
              <Button
                onClick={() => void handleRotateSecret()}
                disabled={isRotating}
              >
                {isRotating ? "Rotating..." : "Rotate secret"}
              </Button>
              {clientSecretHash ? (
                <Button variant="outline" onClick={handleMakePublic}>
                  Make public
                </Button>
              ) : null}
            </div>
            <ErrorText>{secretError}</ErrorText>
          </Section>
        </div>
      </div>
    </div>
  );
}
