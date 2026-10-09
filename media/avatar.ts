import type { MediaBackend } from "./backend.js";
import { isImageMimeType, sniffImage, UPLOAD_LIMITS } from "./image.js";

const REF_RE = /^attachment:\/\/v1:([0-9a-f]{64})$/;

/**
 * Why `ref` can't be a profile's avatar, or null when it can. Judged from the
 * stored object itself — on S3 the host records the reservation's claimed
 * type and size before any byte arrives, so neither is trusted: the bucket's
 * size and type are checked, and the leading bytes must be a PNG, JPEG or
 * WebP signature of that same type.
 */
export async function avatarProblem(ref: string, backend: MediaBackend): Promise<string | null> {
  const hash = REF_RE.exec(ref)?.[1];
  if (!hash) return "not an attachment://v1 reference";
  const stored = await backend.inspect(hash);
  if (!stored) return "not uploaded (or the upload has not finished)";
  if (stored.sizeBytes > UPLOAD_LIMITS.avatar) return `larger than ${UPLOAD_LIMITS.avatar} bytes`;
  if (!isImageMimeType(stored.mimeType)) return `stored as ${stored.mimeType}, not an image`;
  const sniffed = sniffImage(stored.head);
  if (sniffed === null) return "not a PNG, JPEG or WebP image";
  if (sniffed !== stored.mimeType) return `stored as ${stored.mimeType} but is ${sniffed}`;
  return null;
}
