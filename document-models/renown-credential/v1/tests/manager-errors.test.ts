/**
 * Deterministic scenario tests for the manager reducer.
 * The scaffold manager.test.ts uses random generateMock inputs, which do not
 * reliably exercise the optional branches (credentialStatus/expirationDate/
 * subject.id present-vs-absent) or the already-revoked throw path. These tests
 * pin those branches with explicit inputs and use the operation.error pattern
 * (never .toThrow()) for the error case, per the project contract.
 */
import {
  init,
  reducer,
  revoke,
  utils,
  type InitInput,
} from "document-models/renown-credential/v1";
import { describe, expect, it } from "vitest";

const ADDRESS = "0x1111111111111111111111111111111111111111";

const baseInit: InitInput = {
  context: ["https://www.w3.org/2018/credentials/v1"],
  id: "urn:uuid:test-credential",
  type: ["VerifiableCredential"],
  issuer: { id: `did:ethr:${ADDRESS}`, ethereumAddress: ADDRESS },
  issuanceDate: "2026-01-01T00:00:00.000Z",
  expirationDate: null,
  credentialSubject: { id: null, app: "renown" },
  credentialStatus: null,
  credentialSchema: { id: "schema-1", type: "JsonSchemaValidator2018" },
  proof: {
    verificationMethod: `did:ethr:${ADDRESS}#key-1`,
    ethereumAddress: ADDRESS,
    created: "2026-01-01T00:00:00.000Z",
    proofPurpose: "assertionMethod",
    type: "EthereumEip712Signature2021",
    proofValue: "0xsignature",
    eip712: {
      domain: { version: "1", chainId: 1 },
      primaryType: "VerifiableCredential",
    },
  },
};

describe("manager reducer — deterministic branch coverage", () => {
  it("INIT with all optionals absent → null credentialStatus/expirationDate/subject.id", () => {
    const updated = reducer(utils.createDocument(), init(baseInit));
    expect(updated.operations.global[0].error).toBeUndefined();
    expect(updated.state.global.credentialStatus).toBeNull();
    expect(updated.state.global.expirationDate).toBeNull();
    expect(updated.state.global.credentialSubject.id).toBeNull();
    expect(updated.state.global.revoked).toBe(false);
  });

  it("INIT with all optionals present → stored verbatim", () => {
    const input: InitInput = {
      ...baseInit,
      expirationDate: "2027-01-01T00:00:00.000Z",
      credentialSubject: { id: `did:ethr:${ADDRESS}`, app: "renown" },
      credentialStatus: { id: "status-1", type: "RevocationList2020Status" },
    };
    const updated = reducer(utils.createDocument(), init(input));
    expect(updated.operations.global[0].error).toBeUndefined();
    expect(updated.state.global.credentialStatus).toEqual({
      id: "status-1",
      type: "RevocationList2020Status",
    });
    expect(updated.state.global.expirationDate).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    expect(updated.state.global.credentialSubject.id).toBe(
      `did:ethr:${ADDRESS}`,
    );
  });

  it("REVOKE with a reason sets revoked state", () => {
    const doc = reducer(utils.createDocument(), init(baseInit));
    const revoked = reducer(
      doc,
      revoke({ revokedAt: "2026-02-01T00:00:00.000Z", reason: "compromised" }),
    );
    expect(revoked.operations.global[1].error).toBeUndefined();
    expect(revoked.state.global.revoked).toBe(true);
    expect(revoked.state.global.revokedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(revoked.state.global.revocationReason).toBe("compromised");
  });

  it("REVOKE without a reason → revocationReason null", () => {
    const doc = reducer(utils.createDocument(), init(baseInit));
    const revoked = reducer(
      doc,
      revoke({ revokedAt: "2026-02-01T00:00:00.000Z", reason: null }),
    );
    expect(revoked.operations.global[1].error).toBeUndefined();
    expect(revoked.state.global.revocationReason).toBeNull();
  });

  it("REVOKE on an already-revoked credential → AlreadyRevokedError (operation.error)", () => {
    let doc = reducer(utils.createDocument(), init(baseInit));
    doc = reducer(
      doc,
      revoke({ revokedAt: "2026-02-01T00:00:00.000Z", reason: null }),
    );
    const second = reducer(
      doc,
      revoke({ revokedAt: "2026-03-01T00:00:00.000Z", reason: "retry" }),
    );
    const op = second.operations.global[2];
    expect(op.error).toBeTruthy();
    // state stays at the FIRST revoke — the second was rejected
    expect(second.state.global.revokedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(second.state.global.revocationReason).toBeNull();
  });
});
