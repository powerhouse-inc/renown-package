import { PutObjectCommand } from "@aws-sdk/client-s3";
import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import {
  createS3AttachmentPrimitives,
  deriveS3AttachmentKey,
  type S3AttachmentConfig,
} from "@powerhousedao/reactor-attachments";
import {
  refOf,
  reserveVia,
  type MediaBackend,
  type ReserveRequest,
  type ReserveResult,
  type ServeResult,
  type StoredObject,
} from "./backend.js";
import { SNIFF_BYTES } from "./image.js";

type AttachmentClient = IProcessorHostModule["attachments"];
type Primitives = ReturnType<typeof createS3AttachmentPrimitives>;

/** Upload targets live 15 minutes; download redirects 5 (the media route's cache window). */
const UPLOAD_TTL_SECONDS = 900;
export const DOWNLOAD_TTL_SECONDS = 300;

function hexToBase64(hex: string): string {
  const bytes = hex.match(/../g)?.map((pair) => Number.parseInt(pair, 16)) ?? [];
  return btoa(String.fromCharCode(...bytes));
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export interface S3MediaBackendDeps {
  attachments: AttachmentClient;
  config: S3AttachmentConfig;
  /** Injectable for tests. */
  primitives?: Primitives;
  fetch?: typeof fetch;
  now?: () => Date;
}

/**
 * Production backend: the switchboard's private S3 bucket.
 *
 * The upload target is presigned here rather than taken from the host's
 * reservation: the host signs content-type and checksum but not the length,
 * so its URL accepts any number of bytes. This one also signs
 * `content-length`, so the bucket refuses a body of any other size.
 */
export function createS3MediaBackend(deps: S3MediaBackendDeps): MediaBackend {
  const { attachments, config } = deps;
  const primitives = deps.primitives ?? createS3AttachmentPrimitives(config);
  const fetchImpl = deps.fetch ?? fetch;
  const now = deps.now ?? (() => new Date());

  async function presignedGet(hash: string): Promise<string> {
    const target = await primitives.createDownloadTarget(hash, DOWNLOAD_TTL_SECONDS);
    return target.url;
  }

  return {
    kind: "s3",
    async reserve(request: ReserveRequest): Promise<ReserveResult> {
      const outcome = await reserveVia(attachments, request);
      if (outcome.kind === "deduped") return outcome;
      const checksum = hexToBase64(request.sha256);
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: deriveS3AttachmentKey(request.sha256, config.prefix),
        ContentType: request.mimeType,
        ContentLength: request.sizeBytes,
        ChecksumSHA256: checksum,
      });
      const url = await primitives.presign(primitives.client, command, UPLOAD_TTL_SECONDS);
      return {
        kind: "reserved",
        ref: outcome.handle.ref ?? refOf(request.sha256),
        reservationId: outcome.handle.reservationId,
        expiresAtUtc: outcome.handle.expiresAtUtc,
        uploadTarget: {
          method: "PUT",
          url,
          headers: { "content-type": request.mimeType, "x-amz-checksum-sha256": checksum },
          expiresAtUtc: new Date(now().getTime() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
        },
      };
    },
    async inspect(hash: string): Promise<StoredObject | null> {
      let head: { ContentLength?: number; ContentType?: string };
      try {
        head = (await primitives.headObject(hash)) as typeof head;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw error;
      }
      const response = await fetchImpl(await presignedGet(hash), {
        headers: { range: `bytes=0-${SNIFF_BYTES - 1}` },
      });
      if (!response.ok) return null;
      return {
        mimeType: head.ContentType ?? "application/octet-stream",
        sizeBytes: head.ContentLength ?? 0,
        head: new Uint8Array(await response.arrayBuffer()).subarray(0, SNIFF_BYTES),
      };
    },
    async serve(hash: string): Promise<ServeResult | null> {
      return { kind: "redirect", url: await presignedGet(hash) };
    },
  };
}
