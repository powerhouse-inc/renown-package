import { expect, it } from "vitest";
import { generateClientSecret } from "./secret.js";
import { hashSecret } from "../../subgraphs/renown-oidc/core/crypto.js";

it("generates a 256-bit secret and its sha256 hash", async () => {
  const { secret, hash } = await generateClientSecret();
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(hash).toBe(await hashSecret(secret));
});
