import type { RouteHandler } from "@powerhousedao/shared/processors";
import type { MediaBackend } from "./backend.js";
import { isImageMimeType } from "./image.js";

/** Shared by the 302 and the bytes: browsers and CDNs may reuse it for a minute, then revalidate. */
export const MEDIA_CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=240";

/** Public image fields, per field name: where the attachment ref of a document is read from. */
export type MediaFieldLookup = (documentId: string) => Promise<string | null>;

export interface MediaRouteDeps {
  backend: () => MediaBackend | null;
  /** Whitelist: only these fields are ever served (avatar; app-profile logo and cover). */
  fields: Record<string, MediaFieldLookup>;
}

const REF_RE = /^attachment:\/\/v1:([0-9a-f]{64})$/;
const DOCUMENT_ID_MAX = 255;

function notFound(): Response {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "content-type": "application/json", "cache-control": "public, max-age=60" },
  });
}

function unavailable(): Response {
  return new Response(JSON.stringify({ error: "Media is temporarily unavailable" }), {
    status: 503,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

/**
 * `GET <package>/media/:documentId/:field` — the stable public URL of a
 * profile image. Reads the ref from the read model (never from the request),
 * then 302s to a 5-minute presigned URL (S3) or streams the bytes
 * (filesystem). 404 when the field is unknown, unset or not stored; 503
 * (`no-store`) when the read model cannot be read.
 */
export function createMediaHandler(deps: MediaRouteDeps): RouteHandler {
  return async (_request, ctx) => {
    const { documentId, field } = ctx.params;
    const lookup = Object.hasOwn(deps.fields, field) ? deps.fields[field] : undefined;
    if (!lookup || !documentId || documentId.length > DOCUMENT_ID_MAX) return notFound();
    let ref: string | null;
    try {
      ref = await lookup(documentId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[renown-media] ${field} lookup failed (${reason}); answering 503`);
      return unavailable();
    }
    const hash = REF_RE.exec(ref ?? "")?.[1];
    const backend = deps.backend();
    if (!hash || !backend) return notFound();

    const served = await backend.serve(hash);
    if (!served) return notFound();
    if (served.kind === "redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: served.url, "cache-control": MEDIA_CACHE_CONTROL },
      });
    }
    if (!isImageMimeType(served.mimeType)) return notFound();
    return new Response(served.body, {
      status: 200,
      headers: {
        "content-type": served.mimeType,
        "content-length": String(served.sizeBytes),
        "cache-control": MEDIA_CACHE_CONTROL,
        "x-content-type-options": "nosniff",
        "content-security-policy": "sandbox",
      },
    });
  };
}
