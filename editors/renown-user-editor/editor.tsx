import {
  useDocumentById,
  useSelectedDocument,
} from "@powerhousedao/reactor-browser";
import type { EditorProps } from "document-model";
import { useCallback, useState } from "react";
import { generateId } from "document-model";
import {
  type RenownUserDocument,
  actions,
} from "../../document-models/renown-user/index.js";
import {
  Form,
  StringField,
  UrlField,
  Button,
} from "@powerhousedao/document-engineering";
import { AuthorizationList } from "./components/AuthorizationList.js";
import { AddAuthorizationForm } from "./components/AddAuthorizationForm.js";

export type IProps = EditorProps;

export function Editor(props: IProps) {
  const [document, dispatch] = useSelectedDocument();

  if (!document) {
    return <div>Loading...</div>;
  }

  const typedDocument = document as RenownUserDocument;

  // Local form state
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [isAddingAuthorization, setIsAddingAuthorization] = useState(false);

  const {
    state: { global },
  } = typedDocument;
  const { username, ethAddress, userImage, authorizations } = global;

  // User handlers
  const handleSetUsername = useCallback(
    (newUsername: string) => {
      if (newUsername.trim() && newUsername !== username) {
        dispatch(actions.setUsername({ username: newUsername.trim() }));
      }
    },
    [username, dispatch]
  );

  const handleSetEthAddress = useCallback(
    (address: string) => {
      if (address.trim() && address !== ethAddress) {
        dispatch(actions.setEthAddress({ ethAddress: address.trim() }));
      }
    },
    [ethAddress, dispatch]
  );

  const handleSetUserImage = useCallback(
    (imageUrl: string) => {
      if (imageUrl !== userImage) {
        dispatch(actions.setUserImage({ userImage: imageUrl.trim() }));
      }
    },
    [userImage, dispatch]
  );

  // Authorization handlers
  const handleAddAuthorization = useCallback(
    (data: {
      jwt: string;
      issuer?: string;
      subject?: string;
      audience?: string;
      payload?: string;
    }) => {
      dispatch(
        actions.addAuthorization({
          id: generateId(),
          jwt: data.jwt,
          issuer: data.issuer || null,
          subject: data.subject || null,
          audience: data.audience || null,
          payload: data.payload || null,
          createdAt: new Date().toISOString(),
        })
      );
      setIsAddingAuthorization(false);
    },
    [dispatch]
  );

  const handleRevokeAuthorization = useCallback(
    (id: string) => {
      dispatch(
        actions.revokeAuthorization({
          id,
          revokedAt: new Date().toISOString(),
        })
      );
    },
    [dispatch]
  );

  return (
    <div className="html-defaults-container min-h-screen bg-gray-50">
      {/* Header */}
      <div>
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-5">
                <div className="flex-shrink-0">
                  {userImage ? (
                    <img
                      className="w-20 h-20 rounded-xl object-cover ring-2 ring-gray-200 shadow-sm"
                      src={userImage}
                      alt={username || "User"}
                    />
                  ) : (
                    <div className="w-20 h-20 bg-gray-100 rounded-xl flex items-center justify-center ring-2 ring-gray-200 shadow-sm">
                      <svg
                        className="w-10 h-10 text-gray-400"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    </div>
                  )}
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">
                    {username || "Renown User"}
                  </h1>
                  <p className="text-gray-600 mt-1 text-sm font-mono">
                    {ethAddress || "No Ethereum address set"}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <Button
                  color="light"
                  onClick={() => setIsEditingUser(!isEditingUser)}
                >
                  <span className="inline-flex items-center gap-2">
                    {isEditingUser ? (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M6 18L18 6M6 6l12 12"
                          />
                        </svg>
                        Cancel
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                        Edit User
                      </>
                    )}
                  </span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 gap-8">
          {/* User Section */}
          <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
            <div className="px-6 py-5 bg-gray-50">
              <div className="flex items-center gap-2">
                <svg
                  className="w-6 h-6 text-gray-600"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    User Information
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    Manage your Renown user profile details
                  </p>
                </div>
              </div>
            </div>
            <div className="p-6">
              {isEditingUser ? (
                <Form onSubmit={(e: React.FormEvent) => e.preventDefault()}>
                  <div className="space-y-6">
                    <StringField
                      name="username"
                      label="Username"
                      value={username || ""}
                      onChange={(e) => handleSetUsername(e.target.value)}
                      placeholder="Enter your username"
                      description="Your display name on the platform"
                    />

                    <StringField
                      name="ethAddress"
                      label="Ethereum Address"
                      value={ethAddress || ""}
                      onChange={(e) => handleSetEthAddress(e.target.value)}
                      placeholder="0x..."
                      description="Your Ethereum wallet address"
                    />

                    <UrlField
                      name="userImage"
                      label="User Image URL"
                      value={userImage || ""}
                      onChange={(e) => handleSetUserImage(e.target.value)}
                      placeholder="https://example.com/avatar.png"
                      description="URL to your User image"
                    />

                    <div className="flex justify-end space-x-3 pt-4">
                      <Button
                        color="light"
                        onClick={() => setIsEditingUser(false)}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                          Cancel
                        </span>
                      </Button>
                      <Button onClick={() => setIsEditingUser(false)}>
                        <span className="inline-flex items-center gap-1.5">
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          Save Changes
                        </span>
                      </Button>
                    </div>
                  </div>
                </Form>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Username
                      </label>
                      <p className="text-base font-medium text-gray-900">
                        {username || (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </p>
                    </div>
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                        Ethereum Address
                      </label>
                      <p className="text-sm font-mono text-gray-900 break-all">
                        {ethAddress || (
                          <span className="text-gray-400 italic">Not set</span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                      User Image
                    </label>
                    {userImage ? (
                      <div className="flex items-center space-x-4">
                        <img
                          src={userImage}
                          alt="User"
                          className="w-20 h-20 rounded-lg object-cover border border-gray-200"
                        />
                        <div className="flex-1">
                          <a
                            href={userImage}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-gray-600 hover:text-gray-900 hover:underline break-all"
                          >
                            {userImage}
                          </a>
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-500 italic">No image set</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* User Summary Card */}
          <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
            <div className="px-6 py-5 bg-gray-50">
              <h3 className="text-xl font-bold text-gray-900">User Summary</h3>
            </div>
            <div className="p-6">
              <div className="flex items-center space-x-6">
                <div className="flex-shrink-0">
                  {userImage ? (
                    <img
                      src={userImage}
                      alt={username || "User"}
                      className="w-24 h-24 rounded-full object-cover ring-4 ring-gray-200 shadow-sm"
                    />
                  ) : (
                    <div className="w-24 h-24 bg-gray-100 rounded-full flex items-center justify-center ring-4 ring-gray-200 shadow-sm">
                      <span className="text-3xl text-gray-600 font-bold">
                        {username ? username.charAt(0).toUpperCase() : "?"}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex-1">
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">
                    {username || "Anonymous User"}
                  </h3>
                  {ethAddress && (
                    <div className="flex items-center space-x-2">
                      <svg
                        className="w-5 h-5 text-gray-500"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z" />
                      </svg>
                      <span className="text-sm font-mono text-gray-600">
                        {ethAddress}
                      </span>
                    </div>
                  )}
                  {!username && !ethAddress && (
                    <p className="text-gray-500 italic">
                      No user information available. Click "Edit User" to get
                      started.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Authorizations Section */}
          <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
            <div className="px-6 py-5 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg
                    className="w-6 h-6 text-gray-600"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                    />
                  </svg>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">
                      Authorizations
                    </h2>
                    <p className="text-sm text-gray-600 mt-1">
                      Manage user authorization tokens and credentials
                    </p>
                  </div>
                </div>
                {!isAddingAuthorization && (
                  <Button onClick={() => setIsAddingAuthorization(true)}>
                    <span className="inline-flex items-center gap-1.5">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 4v16m8-8H4"
                        />
                      </svg>
                      Add Authorization
                    </span>
                  </Button>
                )}
              </div>
            </div>
            <div className="p-6">
              {isAddingAuthorization ? (
                <AddAuthorizationForm
                  onAdd={handleAddAuthorization}
                  onCancel={() => setIsAddingAuthorization(false)}
                />
              ) : (
                <AuthorizationList
                  authorizations={authorizations}
                  onRevoke={handleRevokeAuthorization}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
