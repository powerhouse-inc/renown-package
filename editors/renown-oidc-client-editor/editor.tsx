import { DocumentToolbar } from "@powerhousedao/design-system/connect";
import { Button } from "@powerhousedao/document-engineering";
import type { EditorProps } from "document-model";
import { useState } from "react";
import {
  useSelectedRenownOidcClientDocument,
  type RenownOidcClientDocument,
} from "document-models/renown-oidc-client";

export type IProps = EditorProps;

/**
 * A read-only view of a `renown/oidc-client` document. The document only
 * mirrors the client registry (the `oidc_clients` table behind the
 * `renown-oidc` GraphQL API) for audit; sign-in never reads it, so there is
 * nothing here to edit.
 */
export default function Editor(_props: IProps) {
  const [document] = useSelectedRenownOidcClientDocument();

  return <EditorContent document={document} />;
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

function ValueList({ values, empty }: { values: string[]; empty: string }) {
  return (
    <ul className="space-y-2">
      {values.length === 0 && (
        <li className="text-gray-500 italic text-sm">{empty}</li>
      )}
      {values.map((value) => (
        <li
          key={value}
          className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 font-mono text-sm break-all"
        >
          {value}
        </li>
      ))}
    </ul>
  );
}

// Hooks live here so they run unconditionally.
function EditorContent({
  document: typedDocument,
}: {
  document: RenownOidcClientDocument;
}) {
  const {
    name,
    redirectUris,
    allowedSubjects,
    allowAnySubject,
    clientSecretHash,
    status,
  } = typedDocument.state.global;

  const [idCopied, setIdCopied] = useState(false);
  const handleCopyClientId = () => {
    void navigator.clipboard.writeText(typedDocument.header.id);
    setIdCopied(true);
    setTimeout(() => setIdCopied(false), 1500);
  };

  return (
    <div className="html-defaults-container min-h-screen bg-gray-50">
      <DocumentToolbar document={typedDocument} />

      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Renown OIDC Client
        </h1>

        <div
          role="note"
          className="mb-8 bg-yellow-50 border border-yellow-300 rounded-lg p-4 text-sm text-yellow-800"
        >
          Managed by the Renown OIDC registration API — changes made here have
          no effect on sign-in.
        </div>

        <div className="grid grid-cols-1 gap-6">
          <Section title="Name" description="Shown to users when they sign in.">
            <p className="text-gray-900">
              {name ?? <span className="text-gray-500 italic">Unnamed</span>}
            </p>
          </Section>

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

          <Section
            title="Redirect URIs"
            description="Allowed callback URLs for the authorization code flow."
          >
            <ValueList values={redirectUris} empty="No redirect URIs" />
          </Section>

          <Section
            title="Allowed subjects"
            description="Renown users permitted to sign in with this client."
          >
            {allowAnySubject ? (
              <p className="mb-4 text-sm font-semibold text-gray-900">
                Any Renown user may sign in.
              </p>
            ) : null}
            <ValueList
              values={allowedSubjects}
              empty="No subjects allow-listed"
            />
          </Section>

          <Section
            title="Status"
            description="Disabled clients cannot sign in."
          >
            <p className="text-gray-900">
              {status === "ACTIVE" ? "Active" : "Disabled"}
            </p>
          </Section>

          <Section
            title="Client type"
            description="Confidential clients authenticate with a secret; public clients use PKCE."
          >
            <p className="text-gray-900">
              {clientSecretHash ? "Confidential" : "Public (PKCE)"}
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
