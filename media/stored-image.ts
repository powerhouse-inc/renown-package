import type { MediaBackend } from "./backend.js";
import { isImageMimeType, sniffImage, UPLOAD_LIMITS, type UploadPurpose } from "./image.js";

const REF_RE = /^attachment:\/\/v1:([0-9a-f]{64})$/;

/**
 * Why `ref` can't be used as a `purpose` image (avatar, logo, cover), or null
 * when it can. Judged from the stored object itself — on S3 the host records
 * the reservation's claimed type and size before any byte arrives, so neither
 * is trusted: the bucket's size and type are checked against the purpose's
 * cap, and the leading bytes must be a PNG, JPEG or WebP signature of that
 * same type.
 */
export async function storedImageProblem(
  ref: string,
  backend: MediaBackend,
  purpose: UploadPurpose,
): Promise<string | null> {
  const hash = REF_RE.exec(ref)?.[1];
  if (!hash) return "not an attachment://v1 reference";
  const stored = await backend.inspect(hash);
  if (!stored) return "not uploaded (or the upload has not finished)";
  const limit = UPLOAD_LIMITS[purpose];
  if (stored.sizeBytes > limit) return `larger than ${limit} bytes`;
  if (!isImageMimeType(stored.mimeType)) return `stored as ${stored.mimeType}, not an image`;
  const sniffed = sniffImage(stored.head);
  if (sniffed === null) return "not a PNG, JPEG or WebP image";
  if (sniffed !== stored.mimeType) return `stored as ${stored.mimeType} but is ${sniffed}`;
  return null;
}
