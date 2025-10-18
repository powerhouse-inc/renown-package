import { Button } from "@powerhousedao/document-engineering";
import type { Authorization } from "../../../document-models/renown-user/gen/types.js";

interface AuthorizationListProps {
  authorizations: Authorization[];
  onRevoke: (id: string) => void;
}

export function AuthorizationList({
  authorizations,
  onRevoke,
}: AuthorizationListProps) {
  if (authorizations.length === 0) {
    return (
      <div className="text-center py-12">
        <svg
          className="mx-auto h-12 w-12 text-gray-400"
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
        <h3 className="mt-2 text-sm font-medium text-gray-900">
          No authorizations
        </h3>
        <p className="mt-1 text-sm text-gray-500">
          Get started by adding a new authorization.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {authorizations.map((auth) => (
        <div
          key={auth.id}
          className="border border-gray-200 rounded-lg p-5 bg-white hover:shadow-md transition-shadow"
        >
          <div className="flex items-start justify-between">
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-3">
                {auth.revoked ? (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                    Revoked
                  </span>
                ) : (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                    Active
                  </span>
                )}
                <span className="text-xs text-gray-500 font-mono">
                  ID: {auth.id}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {auth.issuer && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Issuer
                    </label>
                    <p className="text-sm text-gray-900 font-mono break-all">
                      {auth.issuer}
                    </p>
                  </div>
                )}
                {auth.subject && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Subject
                    </label>
                    <p className="text-sm text-gray-900 font-mono break-all">
                      {auth.subject}
                    </p>
                  </div>
                )}
                {auth.audience && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                      Audience
                    </label>
                    <p className="text-sm text-gray-900 font-mono break-all">
                      {auth.audience}
                    </p>
                  </div>
                )}
              </div>

              {auth.jwt && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    JWT Token
                  </label>
                  <p className="text-xs text-gray-700 font-mono break-all bg-gray-50 p-2 rounded border border-gray-200">
                    {auth.jwt}
                  </p>
                </div>
              )}

              {auth.payload && (
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                    Payload
                  </label>
                  <pre className="text-xs text-gray-700 font-mono bg-gray-50 p-2 rounded border border-gray-200 overflow-x-auto">
                    {auth.payload}
                  </pre>
                </div>
              )}

              <div className="flex items-center gap-4 text-xs text-gray-500">
                {auth.createdAt && (
                  <div>
                    <span className="font-semibold">Created:</span>{" "}
                    {new Date(auth.createdAt).toLocaleString()}
                  </div>
                )}
                {auth.revokedAt && (
                  <div>
                    <span className="font-semibold">Revoked:</span>{" "}
                    {new Date(auth.revokedAt).toLocaleString()}
                  </div>
                )}
              </div>
            </div>

            {!auth.revoked && (
              <div className="ml-4">
                <Button
                  color="light"
                  onClick={() => onRevoke(auth.id)}
                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
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
                        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                      />
                    </svg>
                    Revoke
                  </span>
                </Button>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
