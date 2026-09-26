const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Appends `params` to `uri`'s query, keeping its existing query untouched and
 * inserting before any fragment.
 */
export function appendQuery(uri: string, params: Record<string, string | null | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) query.set(key, value);
  }
  const hashAt = uri.indexOf("#");
  const base = hashAt === -1 ? uri : uri.slice(0, hashAt);
  const fragment = hashAt === -1 ? "" : uri.slice(hashAt);
  const separator = base.includes("?") ? (base.endsWith("?") || base.endsWith("&") ? "" : "&") : "?";
  return `${base}${separator}${query.toString()}${fragment}`;
}

/** A minimal, fully escaped HTML error page. Used when redirecting back to the client is unsafe. */
export function htmlError(status: number, title: string, detail: string): Response {
  const t = escapeHtml(title);
  const d = escapeHtml(detail);
  const body = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${t}</title></head>
<body><h1>${t}</h1><p>${d}</p></body>
</html>
`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

/** An OAuth-style JSON error body `{error, error_description?}`. */
export function jsonError(
  status: number,
  error: string,
  description?: string,
  headers?: Record<string, string>,
): Response {
  const body: Record<string, string> = { error };
  if (description !== undefined) body.error_description = description;
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

/** A 302 back to the client's (already validated) redirect URI carrying an OAuth error. */
export function redirectError(redirectUri: string, error: string, description: string, state: string | null): Response {
  return new Response(null, {
    status: 302,
    headers: {
      location: appendQuery(redirectUri, { error, error_description: description, state }),
      "cache-control": "no-store",
    },
  });
}
