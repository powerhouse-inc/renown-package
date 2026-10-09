import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import { parseAttachmentStorageConfig } from "@powerhousedao/reactor-attachments";
import type { MediaBackend } from "./backend.js";
import { createFilesystemMediaBackend } from "./filesystem-backend.js";
import { createS3MediaBackend } from "./s3-backend.js";

type AttachmentClient = IProcessorHostModule["attachments"];

/** Builds the backend the switchboard's own attachment settings (PH_ATTACHMENT_STORAGE, PH_ATTACHMENT_S3_*) describe. */
export function createMediaBackend(
  attachments: AttachmentClient,
  env: Readonly<Record<string, string | undefined>> = process.env,
): MediaBackend {
  const storage = parseAttachmentStorageConfig(env);
  return storage.kind === "s3"
    ? createS3MediaBackend({ attachments, config: storage.s3 })
    : createFilesystemMediaBackend(attachments);
}
