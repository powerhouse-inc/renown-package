import type { IProcessorHostModule } from "@powerhousedao/reactor-browser";
import type { ScopedRouteHandle } from "@powerhousedao/shared/processors";
import { RenownUserProcessor } from "../processors/renown-user/processor.js";
import type { DB as RenownUserDB } from "../processors/renown-user/schema.js";
import { createMediaHandler } from "./media-route.js";
import { createMediaBackend } from "./registry.js";
import { mediaBackend, publishMediaBackend } from "./slot.js";
import { createUploadHandler } from "./upload-route.js";

let routes: ScopedRouteHandle[] = [];

/**
 * Wires Renown media into a switchboard host: publishes the media backend for
 * the renown-auth subgraph and mounts
 *   POST <package>/media/uploads                 (Renown bearer)
 *   GET  <package>/media/:documentId/:field      (public)
 * No-op where the host has no HTTP surface (Connect, tests). Idempotent: a
 * package reload replaces the previous routes.
 */
export function registerMedia(module: IProcessorHostModule): void {
  if (!module.http) return;
  try {
    publishMediaBackend(createMediaBackend(module.attachments));
  } catch (error) {
    // Broken attachment settings disable media, never the processor.
    const reason = error instanceof Error ? error.message : "unknown error";
    console.error(`[renown-media] attachment storage misconfigured (${reason}); uploads and media disabled`);
    publishMediaBackend(undefined);
  }

  for (const route of routes) route.dispose();
  const users = () =>
    RenownUserProcessor.query<RenownUserDB>("renown-user", module.relationalDb).selectFrom("renown_user");
  routes = [
    module.http.post("media/uploads", { auth: "renown", maxBodyBytes: 4096 }, createUploadHandler({ backend: mediaBackend })),
    module.http.get(
      "media/:documentId/:field",
      { auth: "public", body: "none" },
      createMediaHandler({
        backend: mediaBackend,
        fields: {
          avatar: async (documentId) =>
            (await users().select("avatar_ref").where("document_id", "=", documentId).executeTakeFirst())
              ?.avatar_ref ?? null,
        },
      }),
    ),
  ];
}
