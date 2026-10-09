import type { MediaBackend } from "./backend.js";
import { storedImageProblem } from "./stored-image.js";

/** Why `ref` can't be a profile's avatar, or null when it can (see storedImageProblem). */
export function avatarProblem(ref: string, backend: MediaBackend): Promise<string | null> {
  return storedImageProblem(ref, backend, "avatar");
}
