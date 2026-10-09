import type { MediaBackend } from "./backend.js";

// Processors receive the host's attachment client; subgraphs do not. The
// renown-user processor factory publishes the media backend here and the
// renown-auth subgraph reads it. A global symbol, not a module variable, so
// two bundled copies of this file still share one slot. Kept free of any
// storage import so subgraph bundles stay small.
const SLOT = Symbol.for("@powerhousedao/renown-package/media-backend");
type Slot = { [SLOT]?: MediaBackend };

export function publishMediaBackend(backend: MediaBackend | undefined): void {
  (globalThis as Slot)[SLOT] = backend;
}

/** The published backend, or null before the processor factory ran (or on a host without attachments). */
export function mediaBackend(): MediaBackend | null {
  return (globalThis as Slot)[SLOT] ?? null;
}
