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
  it("requires a strict ISO-8601 timestamp with an explicit zone", () => {
    expect(isFreshTimestamp(new Date(now.getTime() - SIGNATURE_WINDOW_MS).toISOString(), now)).toBe(true);
    expect(isFreshTimestamp(new Date(now.getTime() + SIGNATURE_WINDOW_MS).toISOString(), now)).toBe(true);
    expect(isFreshTimestamp(new Date(now.getTime() - SIGNATURE_WINDOW_MS - 1).toISOString(), now)).toBe(false);
    expect(isFreshTimestamp(new Date(now.getTime() + SIGNATURE_WINDOW_MS + 1).toISOString(), now)).toBe(false);
    expect(isFreshTimestamp("2026-09-28T12:00:00", now)).toBe(false); // no zone
    expect(isFreshTimestamp("2026-09-28", now)).toBe(false); // date-only
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

  it("evicts stale keys via the periodic sweep instead of growing forever", () => {
    const rl = createRateLimiter(5, 1000);
    rl.take("stale", 0); // only hit is at t=0, window [-1000, 1000)
    expect(rl.size()).toBe(1);

    // 256 takes on fresh keys, far outside "stale"'s window, forces a sweep
    // (every 256th take) that must find "stale" fully aged out and drop it.
    for (let i = 0; i < 256; i++) rl.take(`fresh-${i}`, 10_000);

    expect(rl.size()).toBe(256);
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
    input.id = "a".repeat(256);

    expect(() => validateCredentialInput(input)).toThrow(/id exceeds 255 characters/);
  });

  it.each([
    ["issuer.id", (i: InitInput) => (i.issuer.id = `did:pkh:eip155:${"0".repeat(250)}1:${i.issuer.ethereumAddress}`)],
    ["credentialSubject.id", (i: InitInput) => (i.credentialSubject.id = "d".repeat(256))],
    ["credentialSubject.app", (i: InitInput) => (i.credentialSubject.app = "a".repeat(256))],
    ["credentialStatus.id", (i: InitInput) => (i.credentialStatus = { id: "s".repeat(256), type: "t" })],
    ["credentialStatus.type", (i: InitInput) => (i.credentialStatus = { id: "s", type: "t".repeat(256) })],
    ["credentialSchema.id", (i: InitInput) => (i.credentialSchema.id = "s".repeat(256))],
    ["credentialSchema.type", (i: InitInput) => (i.credentialSchema.type = "t".repeat(256))],
    ["proof.proofPurpose", (i: InitInput) => (i.proof.proofPurpose = "p".repeat(256))],
  ])("rejects a %s longer than its varchar(255) column", async (field, mutate) => {
    const input = toInput(await signCredential());
    mutate(input);

    expect(() => validateCredentialInput(input)).toThrow(`Invalid request: ${field} exceeds 255 characters`);
  });

  it("caps text-column fields at 4096 characters", async () => {
    for (const mutate of [
      (i: InitInput) => (i.context = ["c".repeat(4097)]),
      (i: InitInput) => (i.type = ["t".repeat(4097)]),
      (i: InitInput) => (i.proof.verificationMethod = "v".repeat(4097)),
    ]) {
      const input = toInput(await signCredential());
      mutate(input);
      expect(() => validateCredentialInput(input)).toThrow(/exceeds 4096 characters/);
    }
  });

  it("rejects an unparseable proof.created", async () => {
    const input = toInput(await signCredential());
    input.proof.created = "not a date";

    expect(() => validateCredentialInput(input, now)).toThrow(/proof\.created is not a valid date/);
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

  it("rejects an expired credential", async () => {
    const input = toInput(await signCredential({ expiresInDays: -1 }));

    expect(() => validateCredentialInput(input)).toThrow(/expired/i);
  });

  it("rejects when proof.ethereumAddress does not match issuer.ethereumAddress", async () => {
    const input = toInput(await signCredential());
    input.proof.ethereumAddress = "0x0000000000000000000000000000000000000009";

    expect(() => validateCredentialInput(input)).toThrow(/proof\.ethereumAddress/i);
  });

  it("rejects a malformed issuer DID (non-eip155 network) through full validation", async () => {
    const input = toInput(await signCredential());
    input.issuer.id = `did:pkh:cosmos:1:${ACCOUNT.address}`;

    expect(() => validateCredentialInput(input)).toThrow(/issuer\.id network must be eip155/);
  });
});

describe("issuerAddressOf", () => {
  function withIssuerId(id: string): InitInput {
    return {
      issuer: { id, ethereumAddress: "0x0000000000000000000000000000000000000001" },
    } as unknown as InitInput;
  }

  it("returns the lowercased address for a valid did:pkh", () => {
    const address = `0x${"A".repeat(40)}`;
    expect(issuerAddressOf(withIssuerId(`did:pkh:eip155:1:${address}`))).toBe(
      address.toLowerCase(),
    );
  });

  it("rejects a DID with the wrong method", () => {
    expect(() => issuerAddressOf(withIssuerId("did:web:example.com"))).toThrow(
      /issuer\.id is not a did:pkh/,
    );
  });

  it("rejects a short address", () => {
    expect(() =>
      issuerAddressOf(withIssuerId("did:pkh:eip155:1:0x1234")),
    ).toThrow(/issuer\.id address is not a valid Ethereum address/);
  });

  it("rejects a long address", () => {
    const long = `0x${"a".repeat(41)}`;
    expect(() =>
      issuerAddressOf(withIssuerId(`did:pkh:eip155:1:${long}`)),
    ).toThrow(/issuer\.id address is not a valid Ethereum address/);
  });

  it("rejects a non-hex address", () => {
    const nonHex = `0x${"z".repeat(40)}`;
    expect(() =>
      issuerAddressOf(withIssuerId(`did:pkh:eip155:1:${nonHex}`)),
    ).toThrow(/issuer\.id address is not a valid Ethereum address/);
  });

  it("rejects a non-eip155 network", () => {
    const address = `0x${"a".repeat(40)}`;
    expect(() =>
      issuerAddressOf(withIssuerId(`did:pkh:cosmos:1:${address}`)),
    ).toThrow(/issuer\.id network must be eip155/);
  });
});
