import { PGlite } from "@electric-sql/pglite";
import type { OperationWithContext } from "@powerhousedao/reactor-browser";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { RenownCredentialProcessor } from "../renown-credential/index.js";
import { up as upCredential } from "../renown-credential/migrations.js";
import type { DB as CredentialDB } from "../renown-credential/schema.js";
import { RenownUserProcessor } from "../renown-user/index.js";
import { up as upUser } from "../renown-user/migrations.js";
import type { DB as UserDB } from "../renown-user/schema.js";

const FILTER = { branch: ["main"], documentId: ["*"], documentType: [], scope: ["global"] };
let root: Kysely<CredentialDB & UserDB>;

beforeAll(async () => {
  root = new Kysely<CredentialDB & UserDB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema cred`.execute(root);
  await sql`create schema usr`.execute(root);
  await upCredential(root.withSchema("cred") as never);
  await upUser(root.withSchema("usr") as never);
});

afterAll(async () => {
  await root.destroy();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function op(documentId: string, index: number, type: string, input: unknown): OperationWithContext {
  return {
    operation: { index, action: { type, input } },
    context: { documentId, documentType: "x", scope: "global", branch: "main", ordinal: index },
  } as unknown as OperationWithContext;
}

function initInput(id: string, app: string) {
  const address = "0x1111111111111111111111111111111111111111";
  return {
    context: ["https://www.w3.org/2018/credentials/v1"],
    id,
    type: ["VerifiableCredential"],
    issuer: { id: `did:pkh:eip155:1:${address}`, ethereumAddress: address },
    issuanceDate: "2026-09-28T00:00:00.000Z",
    expirationDate: "2026-10-28T00:00:00.000Z",
    credentialSubject: { id: "did:key:z6MkApp", app },
    credentialSchema: { id: "schema", type: "JsonSchema" },
    proof: {
      type: "EthereumEip712Signature2021",
      created: "2026-09-28T00:00:00.000Z",
      verificationMethod: `did:pkh:eip155:1:${address}#controller`,
      proofPurpose: "assertionMethod",
      proofValue: "0x00",
      ethereumAddress: address,
      eip712: { domain: { version: "1", chainId: 1 }, primaryType: "VerifiableCredential" },
    },
  };
}

describe("processors skip an operation whose write fails", () => {
  it("renown-user logs the failed operation without its payload and indexes the next one", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const processor = new RenownUserProcessor("usr", FILTER, root.withSchema("usr") as never);
    const tooLong = "u".repeat(256);

    await expect(
      processor.onOperations([
        op("user-1", 0, "SET_USERNAME", { username: tooLong }),
        op("user-1", 1, "SET_USERNAME", { username: "alice" }),
      ]),
    ).resolves.toBeUndefined();

    const row = await root.withSchema("usr").selectFrom("renown_user").selectAll().where("document_id", "=", "user-1").executeTakeFirst();
    expect(row?.username).toBe("alice");
    expect(error).toHaveBeenCalledTimes(1);
    const [message] = error.mock.calls[0] as [string];
    expect(message).toMatch(/^\[RenownUserProcessor\] skipped operation 0 of user-1: /);
    expect(message).not.toContain(tooLong);
  });

  it("renown-credential logs the failed INIT without its payload and indexes the next one", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const processor = new RenownCredentialProcessor("cred", FILTER, root.withSchema("cred") as never);
    const tooLong = "a".repeat(256);

    await expect(
      processor.onOperations([
        op("cred-bad", 0, "INIT", initInput("urn:uuid:bad", tooLong)),
        op("cred-good", 0, "INIT", initInput("urn:uuid:good", "a".repeat(255))),
      ]),
    ).resolves.toBeUndefined();

    const rows = await root.withSchema("cred").selectFrom("renown_credential").select(["document_id", "credential_subject_app"]).execute();
    expect(rows.map((r) => r.document_id)).toEqual(["cred-good"]);
    expect(rows[0].credential_subject_app).toHaveLength(255);
    expect(error).toHaveBeenCalledTimes(1);
    const [message] = error.mock.calls[0] as [string];
    expect(message).toMatch(/^\[RenownCredentialProcessor\] skipped operation 0 of cred-bad: /);
    expect(message).not.toContain(tooLong);
  });
});
