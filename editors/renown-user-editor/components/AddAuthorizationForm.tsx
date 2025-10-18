import { Form, StringField, Button } from "@powerhousedao/document-engineering";
import { useState, useCallback } from "react";

interface AddAuthorizationFormProps {
  onAdd: (data: {
    jwt: string;
    issuer?: string;
    subject?: string;
    audience?: string;
    payload?: string;
  }) => void;
  onCancel: () => void;
}

export function AddAuthorizationForm({
  onAdd,
  onCancel,
}: AddAuthorizationFormProps) {
  const [jwt, setJwt] = useState("");
  const [issuer, setIssuer] = useState("");
  const [subject, setSubject] = useState("");
  const [audience, setAudience] = useState("");
  const [payload, setPayload] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!jwt.trim()) {
        return;
      }

      onAdd({
        jwt: jwt.trim(),
        issuer: issuer.trim() || undefined,
        subject: subject.trim() || undefined,
        audience: audience.trim() || undefined,
        payload: payload.trim() || undefined,
      });

      // Reset form
      setJwt("");
      setIssuer("");
      setSubject("");
      setAudience("");
      setPayload("");
    },
    [jwt, issuer, subject, audience, payload, onAdd]
  );

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 shadow-sm">
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900">
          Add New Authorization
        </h3>
        <p className="text-sm text-gray-600 mt-1">
          Enter the JWT token and optional metadata
        </p>
      </div>

      <Form onSubmit={handleSubmit}>
        <div className="space-y-5">
          <StringField
            name="jwt"
            label="JWT Token"
            value={jwt}
            onChange={(e) => setJwt(e.target.value)}
            placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
            description="The JSON Web Token string (required)"
            required
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <StringField
              name="issuer"
              label="Issuer"
              value={issuer}
              onChange={(e) => setIssuer(e.target.value)}
              placeholder="https://auth.example.com"
              description="Who issued the token"
            />

            <StringField
              name="subject"
              label="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="user@example.com"
              description="The subject of the token"
            />
          </div>

          <StringField
            name="audience"
            label="Audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value)}
            placeholder="https://api.example.com"
            description="Intended audience for the token"
          />

          <div>
            <label
              htmlFor="payload"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Payload
            </label>
            <textarea
              id="payload"
              name="payload"
              value={payload}
              onChange={(e) => setPayload(e.target.value)}
              placeholder='{"key": "value"}'
              rows={4}
              className="block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm font-mono"
            />
            <p className="mt-1 text-sm text-gray-500">
              Additional payload data (optional JSON)
            </p>
          </div>

          <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
            <Button color="light" onClick={onCancel} type="button">
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
            <Button type="submit" disabled={!jwt.trim()}>
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
          </div>
        </div>
      </Form>
    </div>
  );
}
