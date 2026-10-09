import type { RouteHandler } from "@powerhousedao/shared/processors";
import { createRateLimiter } from "../subgraphs/renown-auth/core/rate-limit.js";
import type { MediaBackend } from "./backend.js";
import { EXTENSIONS, isImageMimeType, UPLOAD_LIMITS, type UploadPurpose } from "./image.js";

/** Per uploading identity: 20 reservations an hour. */
export const UPLOADS_PER_HOUR = 20;
const HOUR_MS = 3_600_000;
const SHA256_RE = /^[0-9a-f]{64}$/;

export interface UploadRouteDeps {
  backend: () => MediaBackend | null;
  limiter?: { take(key: string, now?: number): boolean };
  now?: () => Date;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function fail(status: number, code: string, error: string): Response {
  return json(status, { code, error });
}

function isPurpose(value: unknown): value is UploadPurpose {
  return typeof value === "string" && Object.hasOwn(UPLOAD_LIMITS, value);
}

/**
 * `POST <package>/media/uploads` — the only way bytes enter Renown's
 * attachment store (the switchboard's raw `/attachments/reservations` is
 * closed at the ingress). Requires a Renown bearer; takes
 * `{ purpose, mimeType, sizeBytes, sha256 }`; allows only images within the
 * purpose's size cap; reserves server-side and returns where to PUT the bytes.
 * Also takes the raw reservation body (`clientHash` for `sha256`, no
 * `purpose` = avatar) so `scripts/smoke/attachment-upload.ts --reserve-path`
 * works against it; `fileName`/`extension` are ignored (derived here).
 *
 *   201 { ref, reservationId, expiresAtUtc, uploadTarget }  upload the bytes
 *   200 { ref, deduped: true }                              already stored
 *   400 INVALID_UPLOAD · 401 UNAUTHENTICATED · 413 TOO_LARGE
 *   415 UNSUPPORTED_TYPE · 429 RATE_LIMITED · 503 UNAVAILABLE
 */
export function createUploadHandler(deps: UploadRouteDeps): RouteHandler {
  const limiter = deps.limiter ?? createRateLimiter(UPLOADS_PER_HOUR, HOUR_MS);
  const now = deps.now ?? (() => new Date());

  return async (request, ctx) => {
    const identity = ctx.user?.address.toLowerCase();
    if (!identity) return fail(401, "UNAUTHENTICATED", "A Renown bearer token is required");

    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return fail(400, "INVALID_UPLOAD", "Body must be JSON");
    }
    const { mimeType, sizeBytes } = body;
    const purpose = body.purpose ?? "avatar";
    const sha256 = body.sha256 ?? body.clientHash;
    if (!isPurpose(purpose)) {
      return fail(400, "INVALID_UPLOAD", `purpose must be one of: ${Object.keys(UPLOAD_LIMITS).join(", ")}`);
    }
    if (typeof mimeType !== "string" || !isImageMimeType(mimeType)) {
      return fail(415, "UNSUPPORTED_TYPE", "Only image/png, image/jpeg and image/webp are accepted");
    }
    if (typeof sizeBytes !== "number" || !Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
      return fail(400, "INVALID_UPLOAD", "sizeBytes must be a positive integer");
    }
    if (sizeBytes > UPLOAD_LIMITS[purpose]) {
      return fail(413, "TOO_LARGE", `A ${purpose} may be at most ${UPLOAD_LIMITS[purpose]} bytes`);
    }
    if (typeof sha256 !== "string" || !SHA256_RE.test(sha256)) {
      return fail(400, "INVALID_UPLOAD", "sha256 must be 64 lowercase hex characters");
    }

    const backend = deps.backend();
    if (!backend) return fail(503, "UNAVAILABLE", "Uploads are not available on this switchboard");
    if (!limiter.take(identity, now().getTime())) {
      return fail(429, "RATE_LIMITED", `At most ${UPLOADS_PER_HOUR} uploads per hour`);
    }

    const extension = EXTENSIONS[mimeType];
    const result = await backend.reserve({
      sha256,
      mimeType,
      sizeBytes,
      extension,
      fileName: `${purpose}-${sha256.slice(0, 12)}.${extension}`,
    });
    if (result.kind === "deduped") return json(200, { ref: result.ref, deduped: true });
    return json(201, {
      ref: result.ref,
      reservationId: result.reservationId,
      expiresAtUtc: result.expiresAtUtc,
      uploadTarget: result.uploadTarget,
    });
  };
}
