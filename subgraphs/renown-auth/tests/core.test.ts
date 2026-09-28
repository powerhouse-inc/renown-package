import { describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  buildAndSignCredential,
  type PowerhouseVerifiableCredential,
  type SignCredentialTypedData,
} from "@renown/sdk";
import type { InitInput } from "../../../document-models/renown-credential/index.js";
import {
  revokeMessage,
  profileMessage,
  isFreshTimestamp,
  verifySignedMessage,
  SIGNATURE_WINDOW_MS,
} from "../core/signed-message.js";
import { createRateLimiter } from "../core/rate-limit.js";
import { validateCredentialInput, issuerAddressOf } from "../core/credential-input.js";

const now = new Date("2026-09-28T12:00:00.000Z");

const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const sign: SignCredentialTypedData = (args) =>
  ACCOUNT.signTypedData(args as Parameters<typeof ACCOUNT.signTypedData>[0]);
const APP_DID = "did:key:z6MkApp";

function signCredential(
  overrides: { expiresInDays?: number; chainId?: number } = {},
): Promise<PowerhouseVerifiableCredential> {
  return buildAndSignCredential({
    signTypedData: sign,
    address: ACCOUNT.address,
    chainId: overrides.chainId ?? 1,
    app: "test-app",
    appId: APP_DID,
    expiresInDays: overrides.expiresInDays ?? 7,
  });
}

// The `renown_issueCredential` input mirrors the credential minus the redundant
// eip712.types (the reactor-generated RenownCredential_InitInput shape).
function toInput(credential: PowerhouseVerifiableCredential): InitInput {
  return {
    context: credential["@context"],
    id: credential.id,
    type: credential.type,
    issuer: {
      id: credential.issuer.id,
      ethereumAddress: credential.issuer.ethereumAddress,
    },
    issuanceDate: credential.issuanceDate,
    expirationDate: credential.expirationDate,
    credentialSubject: {
      id: credential.credentialSubject.id,
      app: credential.credentialSubject.app,
    },
    credentialSchema: {
      id: credential.credentialSchema.id,
      type: credential.credentialSchema.type,
    },
    proof: {
      type: credential.proof.type,
      created: credential.proof.created,
      verificationMethod: credential.proof.verificationMethod,
      proofPurpose: credential.proof.proofPurpose,
      proofValue: credential.proof.proofValue,
      ethereumAddress: credential.proof.ethereumAddress,
      eip712: {
        domain: {
          version: credential.proof.eip712.domain.version,
          chainId: credential.proof.eip712.domain.chainId,
        },
        primaryType: credential.proof.eip712.primaryType,
      },
    },
  };
}

describe("signed messages", () => {
  it("revoke message is exact", () => {
    expect(revokeMessage("cred-1", "2026-09-28T12:00:00.000Z")).toBe(
      "Revoke Renown credential cred-1 at 2026-09-28T12:00:00.000Z",
    );
  });
  it("profile message hashes the payload and lowercases the address", async () => {
    const m = await profileMessage(
      "0xABC0000000000000000000000000000000000001",
      { username: "frank" },
      "t",
    );
    expect(m).toMatch(
      /^Update Renown profile 0xabc0000000000000000000000000000000000001 [0-9a-f]{64} at t$/,
    );
    expect(
      await profileMessage(
        "0xabc0000000000000000000000000000000000001",
        { username: "frank", userImage: null },
        "t",
      ),
    ).toBe(m);
    expect(
      await profileMessage(
        "0xabc0000000000000000000000000000000000001",
        { username: "other" },
        "t",
      ),
    ).not.toBe(m);
  });
  it("timestamps must be within ±10 min", () => {
    expect(isFreshTimestamp(now.toISOString(), now)).toBe(true);
    expect(
      isFreshTimestamp(
        new Date(now.getTime() - SIGNATURE_WINDOW_MS - 60_000).toISOString(),
        now,
      ),
    ).toBe(false);
    expect(
      isFreshTimestamp(
        new Date(now.getTime() + SIGNATURE_WINDOW_MS + 60_000).toISOString(),
        now,
      ),
    ).toBe(false);
    expect(isFreshTimestamp("not a date", now)).toBe(false);
  });
  it("verifies personal_sign for the right address only; garbage is false", async () => {
    const a = privateKeyToAccount(generatePrivateKey()),
      b = privateKeyToAccount(generatePrivateKey());
    const message = revokeMessage("c", now.toISOString());
    const sig = await a.signMessage({ message });
    expect(
      await verifySignedMessage({ address: a.address, message, signature: sig }),
    ).toBe(true);
    expect(
      await verifySignedMessage({ address: b.address, message, signature: sig }),
    ).toBe(false);
    expect(
      await verifySignedMessage({ address: a.address, message, signature: "0x1234" }),
    ).toBe(false);
  });
});

describe("rate limiter", () => {
  it("allows `limit` per window per key", () => {
    const rl = createRateLimiter(2, 60_000);
    expect(rl.take("a", 0)).toBe(true);
    expect(rl.take("a", 1)).toBe(true);
    expect(rl.take("a", 2)).toBe(false);
    expect(rl.take("b", 2)).toBe(true);
    expect(rl.take("a", 60_001)).toBe(true);
  });
});

describe("validateCredentialInput", () => {
  it("accepts a valid signed credential and rebuilds the SDK shape", async () => {
    const credential = await signCredential();
    const input = toInput(credential);

    const result = validateCredentialInput(input);

    expect(result.id).toBe(credential.id);
    expect(result.issuer.ethereumAddress).toBe(credential.issuer.ethereumAddress);
    expect(result.proof.eip712.primaryType).toBe("VerifiableCredential");
    expect(issuerAddressOf(input)).toBe(ACCOUNT.address.toLowerCase());
  });

  it("rejects a proof with the wrong type", async () => {
    const input = toInput(await signCredential());
    input.proof.type = "SomeOtherSignature2020";

    expect(() => validateCredentialInput(input)).toThrow(/proof\.type/);
  });

  it("rejects an oversized string field", async () => {
    const input = toInput(await signCredential());
    input.id = "a".repeat(4097);

    expect(() => validateCredentialInput(input)).toThrow(/id exceeds 4096 characters/);
  });

  it("rejects an oversized context/type array", async () => {
    const input = toInput(await signCredential());
    input.context = Array.from({ length: 33 }, (_, i) => `ctx-${i}`);

    expect(() => validateCredentialInput(input)).toThrow(
      /too many context\/type entries/,
    );
  });

  it("rejects an issuance date beyond the clock skew", async () => {
    const input = toInput(await signCredential());
    input.issuanceDate = new Date(now.getTime() + 6 * 60 * 1000).toISOString();

    expect(() => validateCredentialInput(input, now)).toThrow(
      /issuanceDate is in the future/,
    );
  });

  it("rejects a chain id outside RENOWN_ALLOWED_CHAIN_IDS", async () => {
    const input = toInput(await signCredential({ chainId: 999 }));
    const previous = process.env.RENOWN_ALLOWED_CHAIN_IDS;
    process.env.RENOWN_ALLOWED_CHAIN_IDS = "1,137";

    try {
      expect(() => validateCredentialInput(input)).toThrow(
        /chainId 999 is not allowed/,
      );
    } finally {
      if (previous === undefined) delete process.env.RENOWN_ALLOWED_CHAIN_IDS;
      else process.env.RENOWN_ALLOWED_CHAIN_IDS = previous;
    }
  });
});
