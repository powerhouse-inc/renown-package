import { useSelectedDocument } from "@powerhousedao/reactor-browser";
import type { EditorProps } from "document-model";
import { generateId } from "document-model/core";
import { useCallback, useState } from "react";
import {
  type RenownCredentialDocument,
  actions,
} from "../../document-models/renown-credential/index.js";
import {
  Form,
  StringField,
  TextareaField,
  Button,
} from "@powerhousedao/document-engineering";

export type IProps = EditorProps;

export function Editor(props: IProps) {
  const [document, dispatch] = useSelectedDocument();

  if (!document) {
    return <div>Loading...</div>;
  }

  const typedDocument = document as RenownCredentialDocument;

  // Local form state
  const [isInitializing, setIsInitializing] = useState(false);
  const [isEditingSubject, setIsEditingSubject] = useState(false);
  const [isSettingJwt, setIsSettingJwt] = useState(false);
  const [isSettingStatus, setIsSettingStatus] = useState(false);

  const {
    state: { global },
  } = typedDocument;

  const {
    vcPayload,
    context,
    id: credentialId,
    type,
    issuer,
    issuanceDate,
    credentialSubject,
    expirationDate,
    credentialStatus,
    jwt,
    revoked,
    revokedAt,
    revocationReason,
  } = global;

  const isInitialized = issuer && issuanceDate;

  // Initialize credential from JWT
  const handleInit = useCallback(
    (values: {
      jwt: string;
    }) => {
      try {
        dispatch(
          actions.init({
            jwt: values.jwt,
          })
        );
        setIsInitializing(false);
      } catch (error) {
        console.error("Error initializing credential:", error);
      }
    },
    [dispatch]
  );

  // Update credential subject
  const handleUpdateSubject = useCallback(
    (newSubject: string) => {
      try {
        JSON.parse(newSubject); // Validate JSON
        dispatch(actions.updateCredentialSubject({ credentialSubject: newSubject }));
        setIsEditingSubject(false);
      } catch (error) {
        console.error("Error updating credential subject:", error);
      }
    },
    [dispatch]
  );

  // Set JWT
  const handleSetJwt = useCallback(
    (newJwt: string) => {
      dispatch(actions.setJwt({ jwt: newJwt }));
      setIsSettingJwt(false);
    },
    [dispatch]
  );

  // Set credential status
  const handleSetStatus = useCallback(
    (values: {
      statusId: string;
      statusType: string;
      statusPurpose: string;
      statusListIndex: string;
      statusListCredential: string;
    }) => {
      dispatch(actions.setCredentialStatus(values));
      setIsSettingStatus(false);
    },
    [dispatch]
  );

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
                    Verifiable Credential
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
                {issuer && (
                  <p className="text-gray-600 mt-2 text-sm">
                    Issued by: <span className="font-mono">{issuer}</span>
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
            /* Initialize Section */
            <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
              <div className="px-6 py-5 bg-blue-50">
                <h2 className="text-2xl font-bold text-gray-900">
                  Initialize Credential
                </h2>
                <p className="text-sm text-gray-600 mt-1">
                  Create a new W3C Verifiable Credential
                </p>
              </div>
              <div className="p-6">
                <Form
                  onSubmit={(e: React.FormEvent) => {
                    e.preventDefault();
                    const formData = new FormData(e.target as HTMLFormElement);
                    handleInit({
                      jwt: formData.get("jwt") as string,
                    });
                  }}
                >
                  <div className="space-y-6">
                    <TextareaField
                      name="jwt"
                      label="JWT (JSON Web Token)"
                      required
                      placeholder="eyJhbGciOiJFUzI1NksifQ.eyJ2YyI6eyJAY29udGV4dCI6WyJodHRwczovL3d3dy53My5vcmcvMjAxOC9jcmVkZW50aWFscy92MSJdLCJ0eXBlIjpbIlZlcmlmaWFibGVDcmVkZW50aWFsIl0sImNyZWRlbnRpYWxTdWJqZWN0Ijp7ImlkIjoiZGlkOmV4YW1wbGU6MTIzIn19LCJzdWIiOiJkaWQ6ZXhhbXBsZToxMjMiLCJuYmYiOjE3MDkyMDAwMDAsImlzcyI6ImRpZDpleGFtcGxlOmlzc3VlciJ9.signature"
                      description="Paste the signed JWT representing a W3C Verifiable Credential. The JWT should be cryptographically verified before submitting."
                      rows={6}
                    />

                    <div className="flex justify-end pt-4">
                      <Button type="submit">Initialize Credential from JWT</Button>
                    </div>
                  </div>
                </Form>
              </div>
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
                        {credentialId || (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </p>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Issuer
                      </label>
                      <p className="text-sm font-mono text-gray-900 break-all">
                        {issuer}
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

              {/* Complete VC Payload */}
              {vcPayload && (
                <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                  <div className="px-6 py-5 bg-purple-50">
                    <h2 className="text-2xl font-bold text-gray-900">
                      Complete Verifiable Credential
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                      Full VC payload from JWT - supports any W3C VC structure
                    </p>
                  </div>
                  <div className="p-6">
                    <pre className="bg-gray-50 p-4 rounded-lg border border-gray-200 overflow-auto text-sm max-h-96">
                      {JSON.stringify(JSON.parse(vcPayload), null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* Credential Subject */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="px-6 py-5 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-900">
                      Credential Subject
                    </h2>
                    {!revoked && !isEditingSubject && (
                      <Button
                        color="light"
                        onClick={() => setIsEditingSubject(true)}
                      >
                        Edit Subject
                      </Button>
                    )}
                  </div>
                </div>
                <div className="p-6">
                  {isEditingSubject ? (
                    <Form
                      onSubmit={(e: React.FormEvent) => {
                        e.preventDefault();
                        const formData = new FormData(
                          e.target as HTMLFormElement
                        );
                        handleUpdateSubject(
                          formData.get("credentialSubject") as string
                        );
                      }}
                    >
                      <div className="space-y-4">
                        <TextareaField
                          name="credentialSubject"
                          label="Credential Subject (JSON)"
                          defaultValue={credentialSubject || ""}
                          required
                          rows={8}
                          description="JSON object containing the claims about the subject"
                        />
                        <div className="flex justify-end space-x-3">
                          <Button
                            color="light"
                            onClick={() => setIsEditingSubject(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit">Update Subject</Button>
                        </div>
                      </div>
                    </Form>
                  ) : (
                    <pre className="bg-gray-50 p-4 rounded-lg border border-gray-200 overflow-auto text-sm">
                      {JSON.stringify(
                        JSON.parse(credentialSubject || "{}"),
                        null,
                        2
                      )}
                    </pre>
                  )}
                </div>
              </div>

              {/* JWT Section */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="px-6 py-5 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-900">
                      JWT Representation
                    </h2>
                    {!isSettingJwt && (
                      <Button
                        color="light"
                        onClick={() => setIsSettingJwt(true)}
                      >
                        {jwt ? "Update JWT" : "Set JWT"}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="p-6">
                  {isSettingJwt ? (
                    <Form
                      onSubmit={(e: React.FormEvent) => {
                        e.preventDefault();
                        const formData = new FormData(
                          e.target as HTMLFormElement
                        );
                        handleSetJwt(formData.get("jwt") as string);
                      }}
                    >
                      <div className="space-y-4">
                        <TextareaField
                          name="jwt"
                          label="JWT Token"
                          defaultValue={jwt || ""}
                          required
                          rows={6}
                          description="Signed JWT representation of the credential"
                        />
                        <div className="flex justify-end space-x-3">
                          <Button
                            color="light"
                            onClick={() => setIsSettingJwt(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit">Set JWT</Button>
                        </div>
                      </div>
                    </Form>
                  ) : jwt ? (
                    <>
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <p className="text-xs font-mono text-gray-900 break-all">
                          {jwt}
                        </p>
                      </div>
                    </>
                  ) : (
                    <p className="text-gray-500 italic">No JWT set</p>
                  )}
                </div>
              </div>

              {/* Credential Status */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="px-6 py-5 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <h2 className="text-2xl font-bold text-gray-900">
                      Credential Status (StatusList2021)
                    </h2>
                    {!credentialStatus && !isSettingStatus && (
                      <Button
                        color="light"
                        onClick={() => setIsSettingStatus(true)}
                      >
                        Set Status
                      </Button>
                    )}
                  </div>
                </div>
                <div className="p-6">
                  {isSettingStatus ? (
                    <Form
                      onSubmit={(e: React.FormEvent) => {
                        e.preventDefault();
                        const formData = new FormData(
                          e.target as HTMLFormElement
                        );
                        handleSetStatus({
                          statusId: formData.get("statusId") as string,
                          statusType: formData.get("statusType") as string,
                          statusPurpose: formData.get("statusPurpose") as string,
                          statusListIndex: formData.get(
                            "statusListIndex"
                          ) as string,
                          statusListCredential: formData.get(
                            "statusListCredential"
                          ) as string,
                        });
                      }}
                    >
                      <div className="space-y-4">
                        <StringField
                          name="statusId"
                          label="Status ID"
                          required
                          placeholder="https://example.com/status/1"
                        />
                        <StringField
                          name="statusType"
                          label="Status Type"
                          required
                          placeholder="StatusList2021Entry"
                        />
                        <StringField
                          name="statusPurpose"
                          label="Status Purpose"
                          required
                          placeholder="revocation"
                          description="Either 'revocation' or 'suspension'"
                        />
                        <StringField
                          name="statusListIndex"
                          label="Status List Index"
                          required
                          placeholder="12345"
                        />
                        <TextareaField
                          name="statusListCredential"
                          label="Status List Credential URL"
                          required
                          placeholder="https://example.com/status-lists/1"
                          rows={2}
                        />
                        <div className="flex justify-end space-x-3">
                          <Button
                            color="light"
                            onClick={() => setIsSettingStatus(false)}
                          >
                            Cancel
                          </Button>
                          <Button type="submit">Set Status</Button>
                        </div>
                      </div>
                    </Form>
                  ) : credentialStatus ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Status ID
                        </label>
                        <p className="text-sm font-mono text-gray-900 break-all">
                          {credentialStatus.id}
                        </p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Type
                        </label>
                        <p className="text-sm text-gray-900">
                          {credentialStatus.type}
                        </p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Purpose
                        </label>
                        <p className="text-sm text-gray-900">
                          {credentialStatus.statusPurpose}
                        </p>
                      </div>
                      <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          List Index
                        </label>
                        <p className="text-sm text-gray-900">
                          {credentialStatus.statusListIndex}
                        </p>
                      </div>
                      <div className="col-span-2 bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Status List Credential
                        </label>
                        <p className="text-sm font-mono text-gray-900 break-all">
                          {credentialStatus.statusListCredential}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="text-gray-500 italic">
                      No credential status set
                    </p>
                  )}
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
