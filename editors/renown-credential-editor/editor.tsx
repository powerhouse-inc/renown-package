import { useSelectedDocument } from "@powerhousedao/reactor-browser";
import type { EditorProps } from "document-model";
import { useCallback } from "react";
import {
  type RenownCredentialDocument,
  actions,
} from "../../document-models/renown-credential/index.js";
import { Button } from "@powerhousedao/document-engineering";

export type IProps = EditorProps;

export function Editor(props: IProps) {
  const [document, dispatch] = useSelectedDocument();

  if (!document) {
    return <div>Loading...</div>;
  }

  const typedDocument = document as RenownCredentialDocument;

  const {
    state: { global },
  } = typedDocument;

  const {
    context,
    id: credentialId,
    type,
    issuer,
    issuanceDate,
    credentialSubject,
    credentialSchema,
    credentialStatus,
    expirationDate,
    proof,
    revoked,
    revokedAt,
    revocationReason,
  } = global;

  const isInitialized = issuer?.id && issuanceDate;

  // Revoke credential
  const handleRevoke = useCallback(
    (reason?: string) => {
      if (window.confirm("Are you sure you want to revoke this credential?")) {
        dispatch(
          actions.revoke({
            revokedAt: new Date().toISOString(),
            reason,
          })
        );
      }
    },
    [dispatch]
  );

  return (
    <div className="html-defaults-container min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-8">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold text-gray-900">
                    EIP-712 Signed Credential
                  </h1>
                  {revoked && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-800">
                      Revoked
                    </span>
                  )}
                  {!isInitialized && (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-yellow-100 text-yellow-800">
                      Not Initialized
                    </span>
                  )}
                </div>
                {issuer?.id && (
                  <p className="text-gray-600 mt-2 text-sm">
                    Issued by: <span className="font-mono">{issuer.id}</span>
                  </p>
                )}
              </div>
              {isInitialized && !revoked && (
                <Button
                  color="danger"
                  onClick={() => {
                    const reason = window.prompt(
                      "Enter revocation reason (optional):"
                    );
                    if (reason !== null) {
                      handleRevoke(reason || undefined);
                    }
                  }}
                >
                  Revoke Credential
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 gap-8">
          {!isInitialized ? (
            <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden p-8">
              <p className="text-gray-500 text-center">
                This credential has not been initialized yet.
                <br />
                Use the API or mutations to create an EIP-712 signed credential.
              </p>
            </div>
          ) : (
            <>
              {/* Credential Information */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="px-6 py-5 bg-gray-50">
                  <h2 className="text-2xl font-bold text-gray-900">
                    Credential Information
                  </h2>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Credential ID
                      </label>
                      <p className="text-sm font-mono text-gray-900 break-all">
                        {credentialId}
                      </p>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Issuer ID
                      </label>
                      <p className="text-sm font-mono text-gray-900 break-all">
                        {issuer?.id}
                      </p>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Issuer Ethereum Address
                      </label>
                      <p className="text-sm font-mono text-gray-900 break-all">
                        {issuer?.ethereumAddress}
                      </p>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Issuance Date
                      </label>
                      <p className="text-sm text-gray-900">
                        {issuanceDate
                          ? new Date(issuanceDate).toLocaleString()
                          : "N/A"}
                      </p>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Expiration Date
                      </label>
                      <p className="text-sm text-gray-900">
                        {expirationDate ? (
                          new Date(expirationDate).toLocaleString()
                        ) : (
                          <span className="text-gray-400 italic">
                            No expiration
                          </span>
                        )}
                      </p>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Schema ID
                      </label>
                      <p className="text-sm font-mono text-gray-900 break-all">
                        {credentialSchema?.id}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Context
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {context && context.map((ctx, i) => (
                        <span
                          key={i}
                          className="inline-block px-2 py-1 text-xs font-mono bg-blue-100 text-blue-800 rounded"
                        >
                          {ctx}
                        </span>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Type
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {type && type.map((t, i) => (
                        <span
                          key={i}
                          className="inline-block px-2 py-1 text-xs font-mono bg-green-100 text-green-800 rounded"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Credential Subject */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="px-6 py-5 bg-gray-50">
                  <h2 className="text-2xl font-bold text-gray-900">
                    Credential Subject
                  </h2>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Subject ID
                      </label>
                      <p className="text-sm font-mono text-gray-900 break-all">
                        {credentialSubject?.id || (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        App
                      </label>
                      <p className="text-sm text-gray-900">
                        {credentialSubject?.app}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Proof (EIP-712 Signature) */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="px-6 py-5 bg-purple-50">
                  <h2 className="text-2xl font-bold text-gray-900">
                    EIP-712 Proof
                  </h2>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Verification Method
                      </label>
                      <p className="text-sm font-mono text-gray-900 break-all">
                        {proof?.verificationMethod}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Ethereum Address
                      </label>
                      <p className="text-sm font-mono text-gray-900 break-all">
                        {proof?.ethereumAddress}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Created
                      </label>
                      <p className="text-sm text-gray-900">
                        {proof?.created ? new Date(proof.created).toLocaleString() : "N/A"}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Type
                      </label>
                      <p className="text-sm text-gray-900">
                        {proof?.type}
                      </p>
                    </div>
                  </div>

                  <div className="mt-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      Signature (EIP-712)
                    </label>
                    <p className="text-xs font-mono text-gray-900 break-all">
                      {proof?.proofValue}
                    </p>
                  </div>

                  <div className="mt-6 bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                      EIP-712 Domain
                    </label>
                    <pre className="text-xs text-gray-900 overflow-auto">
                      {JSON.stringify(proof?.eip712?.domain, null, 2)}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Revocation Information */}
              {revoked && (
                <div className="bg-red-50 rounded-xl shadow-md border border-red-200 overflow-hidden">
                  <div className="px-6 py-5 bg-red-100">
                    <h2 className="text-2xl font-bold text-red-900">
                      Revocation Information
                    </h2>
                  </div>
                  <div className="p-6">
                    <div className="space-y-4">
                      <div className="bg-white p-4 rounded-lg border border-red-200">
                        <label className="block text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">
                          Revoked At
                        </label>
                        <p className="text-sm text-gray-900">
                          {revokedAt
                            ? new Date(revokedAt).toLocaleString()
                            : "N/A"}
                        </p>
                      </div>
                      {revocationReason && (
                        <div className="bg-white p-4 rounded-lg border border-red-200">
                          <label className="block text-xs font-semibold text-red-600 uppercase tracking-wider mb-2">
                            Revocation Reason
                          </label>
                          <p className="text-sm text-gray-900">
                            {revocationReason}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
