import { describe, expect, it, vi } from "vitest";
import { credentialInvalidatorOf } from "../core/credential-invalidator.js";

describe("credentialInvalidatorOf", () => {
  it("returns the host's invalidator", () => {
    const credentials = { invalidateCredential: vi.fn() };
    expect(credentialInvalidatorOf({ credentials })).toBe(credentials);
  });

  it("is undefined on a host without one", () => {
    expect(credentialInvalidatorOf({})).toBeUndefined();
    expect(credentialInvalidatorOf({ credentials: undefined })).toBeUndefined();
    expect(credentialInvalidatorOf({ credentials: {} })).toBeUndefined();
  });
});
