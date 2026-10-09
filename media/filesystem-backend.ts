import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import {
  readHead,
  refOf,
  reserveVia,
  type MediaBackend,
  type ReserveRequest,
  type ReserveResult,
  type ServeResult,
  type StoredObject,
} from "./backend.js";

type AttachmentClient = IProcessorHostModule["attachments"];

// The local store ignores the authorizing document; the name only labels the read.
const LOCAL_READER = "renown-media";

/** Development backend: the switchboard stores bytes on its own disk. */
export function createFilesystemMediaBackend(attachments: AttachmentClient): MediaBackend {
  async function open(hash: string) {
    try {
      return await attachments.download({
        documentId: LOCAL_READER,
        ref: refOf(hash) as `attachment://v${number}:${string}`,
      });
    } catch {
      // Unknown (AttachmentNotFound) or not yet uploaded (AttachmentPending).
      return null;
    }
  }

  return {
    kind: "filesystem",
    async reserve(request: ReserveRequest): Promise<ReserveResult> {
      const outcome = await reserveVia(attachments, request);
      if (outcome.kind === "deduped") return outcome;
      const { handle } = outcome;
      return {
        kind: "reserved",
        ref: handle.ref ?? refOf(request.sha256),
        reservationId: handle.reservationId,
        expiresAtUtc: handle.expiresAtUtc,
        uploadTarget: null,
      };
    },
    async inspect(hash: string): Promise<StoredObject | null> {
      const response = await open(hash);
      if (!response) return null;
      return {
        mimeType: response.header.mimeType,
        sizeBytes: response.header.sizeBytes,
        head: await readHead(response.body),
      };
    },
    async serve(hash: string): Promise<ServeResult | null> {
      const response = await open(hash);
      if (!response) return null;
      return {
        kind: "stream",
        mimeType: response.header.mimeType,
        sizeBytes: response.header.sizeBytes,
        body: response.body,
      };
    },
  };
}
