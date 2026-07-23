import { print } from "graphql";
import { describe, expect, it } from "vitest";
import { schema } from "./schema.js";

describe("renown-credential-issuance subgraph schema", () => {
  it("reuses the document model's inputs, prefixed to match the reactor", () => {
    const sdl = print(schema);
    expect(sdl).toContain("input RenownCredential_InitInput");
    expect(sdl).toContain("input RenownCredential_ProofInput");
    expect(sdl).toContain("input RenownCredential_IssuerInput");
    expect(sdl).toContain("input RenownCredential_CredentialSubjectInput");
  });

  it("references prefixed inputs consistently (no bare InitInput)", () => {
    const sdl = print(schema);
    expect(sdl).not.toMatch(/\binput InitInput\b/);
    expect(sdl).toMatch(/issuer: RenownCredential_IssuerInput!/);
  });

  it("exposes the renown_issueCredential mutation", () => {
    const sdl = print(schema);
    expect(sdl).toContain(
      "renown_issueCredential(input: RenownCredential_InitInput!): String",
    );
  });
});
