import { useDocumentById, useSelectedDocument } from "@powerhousedao/reactor-browser";
import type { EditorProps } from "document-model";
import { useCallback, useState } from "react";
import {
  type RenownUserDocument,
  actions,
} from "../../document-models/renown-user/index.js";
import { Form, StringField, UrlField, Button } from "@powerhousedao/document-engineering";

export type IProps = EditorProps;

export default function Editor(props: IProps) {
  const [document, dispatch] = useSelectedDocument()
  
  if (!document) {
    return <div>Loading...</div>;
  }
  
  const typedDocument = document as RenownUserDocument;
  
  // Local form state
  const [isEditingUser, setIsEditingUser] = useState(false);
  
  const { state: { global } } = typedDocument;
  const { username, ethAddress, userImage } = global;

  // User handlers
  const handleSetUsername = useCallback((newUsername: string) => {
    if (newUsername.trim() && newUsername !== username) {
      dispatch(actions.setUsername({ username: newUsername.trim() }));
    }
  }, [username, dispatch]);

  const handleSetEthAddress = useCallback((address: string) => {
    if (address.trim() && address !== ethAddress) {
      dispatch(actions.setEthAddress({ ethAddress: address.trim() }));
    }
  }, [ethAddress, dispatch]);

  const handleSetUserImage = useCallback((imageUrl: string) => {
    if (imageUrl !== userImage) {
      dispatch(actions.setUserImage({ userImage: imageUrl.trim() }));
    }
  }, [userImage, dispatch]);

  return (
    <div className="html-defaults-container min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex-shrink-0">
                  {userImage ? (
                    <img 
                      className="w-16 h-16 rounded-full object-cover border-2 border-blue-500" 
                      src={userImage} 
                      alt={username || "User"} 
                    />
                  ) : (
                    <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                      <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                  )}
                </div>
                <div>
                  <h1 className="text-3xl font-bold text-gray-900">
                    {username || "Renown User"}
                  </h1>
                  <p className="text-sm text-gray-500 font-mono">
                    {ethAddress || "No Ethereum address set"}
                  </p>
                </div>
              </div>
              <div className="flex items-center space-x-3">
                <Button 
                  color="light" 
                  onClick={() => setIsEditingUser(!isEditingUser)}
                >
                  {isEditingUser ? "Cancel" : "Edit User"}
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
          <div className="bg-white rounded-lg shadow-sm border">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-lg font-semibold text-gray-900">User Information</h2>
              <p className="text-sm text-gray-500">Manage your renown User details</p>
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

                    <div className="flex justify-end space-x-3 pt-4 border-t">
                      <Button color="light" onClick={() => setIsEditingUser(false)}>
                        Cancel
                      </Button>
                      <Button onClick={() => setIsEditingUser(false)}>
                        Save Changes
                      </Button>
                    </div>
                  </div>
                </Form>
              ) : (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Username</label>
                      <div className="flex items-center">
                        <p className="text-base text-gray-900">
                          {username || <span className="text-gray-400 italic">Not set</span>}
                        </p>
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Ethereum Address</label>
                      <div className="flex items-center">
                        <p className="text-sm font-mono text-gray-900 break-all">
                          {ethAddress || <span className="text-gray-400 italic">Not set</span>}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">User Image</label>
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
                            className="text-sm text-blue-600 hover:text-blue-800 hover:underline break-all"
                          >
                            {userImage}
                          </a>
                        </div>
                      </div>
                    ) : (
                      <p className="text-gray-400 italic">No image set</p>
                    )}
                  </div>

                  <div className="pt-4 border-t">
                    <Button onClick={() => setIsEditingUser(true)}>
                      Edit User
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* User Summary Card */}
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg shadow-sm border border-blue-100">
            <div className="px-6 py-4 border-b border-blue-100">
              <h3 className="text-lg font-semibold text-gray-900">User Summary</h3>
            </div>
            <div className="p-6">
              <div className="flex items-center space-x-6">
                <div className="flex-shrink-0">
                  {userImage ? (
                    <img 
                      src={userImage} 
                      alt={username || "User"} 
                      className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-lg"
                    />
                  ) : (
                    <div className="w-24 h-24 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center shadow-lg">
                      <span className="text-3xl text-white font-bold">
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
                      <svg className="w-5 h-5 text-gray-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M11.944 17.97L4.58 13.62 11.943 24l7.37-10.38-7.372 4.35h.003zM12.056 0L4.69 12.223l7.365 4.354 7.365-4.35L12.056 0z"/>
                      </svg>
                      <span className="text-sm font-mono text-gray-600">{ethAddress}</span>
                    </div>
                  )}
                  {!username && !ethAddress && (
                    <p className="text-gray-500 italic">No User information available. Click "Edit User" to get started.</p>
                  )}
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
