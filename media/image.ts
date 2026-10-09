/** Image types Renown accepts for avatars (and, later, app logos and covers). */
export const IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMimeType = (typeof IMAGE_MIME_TYPES)[number];

/** What an upload is for, and the most bytes it may have. */
export const UPLOAD_LIMITS = { avatar: 2 * 1024 * 1024 } as const;
export type UploadPurpose = keyof typeof UPLOAD_LIMITS;

export const EXTENSIONS: Record<ImageMimeType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** Bytes the sniffer needs from the start of a file. */
export const SNIFF_BYTES = 16;

export function isImageMimeType(value: string): value is ImageMimeType {
  return (IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

/** The image type the leading bytes prove (PNG, JPEG or WebP signature), or null. */
export function sniffImage(head: Uint8Array): ImageMimeType | null {
  const at = (offset: number, bytes: number[]) => bytes.every((b, i) => head[offset + i] === b);
  if (at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (at(0, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (at(0, [0x52, 0x49, 0x46, 0x46]) && at(8, [0x57, 0x45, 0x42, 0x50])) return "image/webp";
  return null;
}
