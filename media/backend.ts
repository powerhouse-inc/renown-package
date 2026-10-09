import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import { SNIFF_BYTES } from "./image.js";

type AttachmentClient = IProcessorHostModule["attachments"];
type ReserveOptions = Parameters<AttachmentClient["reserve"]>[0];
type UploadHandle = Parameters<Parameters<AttachmentClient["reserve"]>[1]>[0];

/** A browser-usable upload target: PUT these bytes with exactly these headers. */
export interface UploadTarget {
  method: "PUT";
  url: string;
  headers: Record<string, string>;
  expiresAtUtc: string;
}

export type ReserveResult =
  | { kind: "deduped"; ref: string }
  | {
      kind: "reserved";
      ref: string;
      reservationId: string;
      expiresAtUtc: string;
      /** Null on a filesystem backend (local development): bytes go to the switchboard's own PUT route. */
      uploadTarget: UploadTarget | null;
    };

/** What the bytes behind a hash really are, read from storage, never from the reservation. */
export interface StoredObject {
  mimeType: string;
  sizeBytes: number;
  /** The first bytes of the object (at most SNIFF_BYTES), for signature sniffing. */
  head: Uint8Array;
}

export type ServeResult =
  | { kind: "redirect"; url: string }
  | { kind: "stream"; mimeType: string; sizeBytes: number; body: ReadableStream<Uint8Array> };

export interface ReserveRequest {
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  extension: string;
}

/**
 * Renown's view of the switchboard's attachment storage, for package code.
 *
 * Reservations go through the host's attachment client (`module.attachments`,
 * reactor-api `IProcessorHostModule`), so the switchboard's own attachment
 * records stay authoritative. Reading the stored object and minting download
 * URLs can't: on S3 the host store only knows the reservation's claimed
 * metadata and serves bytes from local disk, and `getShareLink` rejects on a
 * server-side store. On S3 those go to the bucket directly, with the
 * switchboard's own S3 settings.
 */
export interface MediaBackend {
  readonly kind: "s3" | "filesystem";
  reserve(request: ReserveRequest): Promise<ReserveResult>;
  /** The stored object, or null when nothing (complete) is stored under `hash`. */
  inspect(hash: string): Promise<StoredObject | null>;
  /** How to hand the object to a browser, or null when it is not stored. */
  serve(hash: string): Promise<ServeResult | null>;
}

class Captured extends Error {
  constructor(readonly handle: UploadHandle) {
    super("reservation captured");
  }
}

/**
 * Reserves through the attachment client. Its `reserve` hands a live upload
 * handle to a `send` callback; the bytes come from the browser, not from us,
 * so the callback hands the handle back out by rejecting with it.
 */
export async function reserveVia(
  attachments: AttachmentClient,
  request: ReserveRequest,
): Promise<{ kind: "deduped"; ref: string } | { kind: "reserved"; handle: UploadHandle }> {
  const options: ReserveOptions = {
    mimeType: request.mimeType,
    fileName: request.fileName,
    extension: request.extension,
    clientHash: request.sha256,
    sizeBytes: request.sizeBytes,
  };
  try {
    const result = await attachments.reserve(options, (handle) => Promise.reject(new Captured(handle)));
    return { kind: "deduped", ref: result.ref };
  } catch (error) {
    if (error instanceof Captured) return { kind: "reserved", handle: error.handle };
    throw error;
  }
}

export function refOf(hash: string): string {
  return `attachment://v1:${hash}`;
}

/** Reads up to `limit` bytes from the start of a stream, then cancels it. */
export async function readHead(body: ReadableStream<Uint8Array>, limit = SNIFF_BYTES): Promise<Uint8Array> {
  const reader = body.getReader();
  const out = new Uint8Array(limit);
  let filled = 0;
  try {
    while (filled < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = value.subarray(0, limit - filled);
      out.set(take, filled);
      filled += take.length;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.subarray(0, filled);
}
