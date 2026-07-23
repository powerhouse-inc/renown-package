import type { ISubgraph } from "@powerhousedao/reactor-api";
import {
  buildAndSignCredential,
  type PowerhouseVerifiableCredential,
  type SignCredentialTypedData,
} from "@renown/sdk";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InitInput } from "../../document-models/renown-credential/index.js";
import { RenownCredentialProcessor } from "../../processors/renown-credential/index.js";
import { getResolvers } from "./resolvers.js";

const ACCOUNT = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const sign: SignCredentialTypedData = (args) =>
  ACCOUNT.signTypedData(args as Parameters<typeof ACCOUNT.signTypedData>[0]);

const APP_DID = "did:key:z6MkApp";

function signCredential(expiresInDays = 7) {
  return buildAndSignCredential({
    signTypedData: sign,
    address: ACCOUNT.address,
    chainId: 1,
    app: "test-app",
    appId: APP_DID,
    expiresInDays,
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

type IssueResolver = (
  parent: unknown,
  args: { input: InitInput },
) => Promise<string>;

// `existing` is the row the dedup query resolves to (undefined = not yet issued).
function setup(existing?: { document_id: string }) {
  const execute = vi.fn().mockResolvedValue(undefined);
  const createEmpty = vi
    .fn()
    .mockResolvedValue({ header: { id: "cred-doc-1" } });
  const builder = {
    selectFrom: () => builder,
    select: () => builder,
    where: () => builder,
    executeTakeFirst: () => Promise.resolve(existing),
  };
  vi.spyOn(RenownCredentialProcessor, "query").mockReturnValue(
    builder as never,
  );
  const subgraph = {
    reactorClient: { createEmpty, execute },
    relationalDb: {},
  } as unknown as ISubgraph;
  const resolvers = getResolvers(subgraph) as {
    Mutation: { renown_issueCredential: IssueResolver };
  };
  return {
    issue: resolvers.Mutation.renown_issueCredential,
    createEmpty,
    execute,
  };
}

describe("renown_issueCredential", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates and INITs a document for a valid signed credential", async () => {
    const { issue, createEmpty, execute } = setup();
    const input = toInput(await signCredential());

    const documentId = await issue(null, { input });

    expect(documentId).toBe("cred-doc-1");
    expect(createEmpty).toHaveBeenCalledWith("powerhouse/renown-credential");
    const [docId, scope, actions] = execute.mock.calls[0] as [
      string,
      string,
      { type: string }[],
    ];
    expect(docId).toBe("cred-doc-1");
    expect(scope).toBe("main");
    expect(actions[0].type).toBe("INIT");
  });

  it("rejects a credential whose proof signature does not match the issuer", async () => {
    const { issue, createEmpty } = setup();
    const credential = await signCredential();
    // Flip the last hex nibble so the signature is valid hex but wrong.
    const last = credential.proof.proofValue.slice(-1) === "0" ? "1" : "0";
    credential.proof.proofValue =
      credential.proof.proofValue.slice(0, -1) + last;

    await expect(issue(null, { input: toInput(credential) })).rejects.toThrow(
      /signature/i,
    );
    expect(createEmpty).not.toHaveBeenCalled();
  });

  it("rejects an expired credential before persisting", async () => {
    const { issue, createEmpty } = setup();
    const input = toInput(await signCredential(-1));

    await expect(issue(null, { input })).rejects.toThrow(/expired/i);
    expect(createEmpty).not.toHaveBeenCalled();
  });

  it("rejects when the proof address does not match the issuer address", async () => {
    const { issue, createEmpty } = setup();
    const credential = await signCredential();
    credential.proof.ethereumAddress =
      "0x0000000000000000000000000000000000000009";

    await expect(issue(null, { input: toInput(credential) })).rejects.toThrow(
      /proof\.ethereumAddress/i,
    );
    expect(createEmpty).not.toHaveBeenCalled();
  });

  it("is idempotent: returns the existing document for an already-issued credential", async () => {
    const { issue, createEmpty, execute } = setup({
      document_id: "existing-doc",
    });
    const input = toInput(await signCredential());

    const documentId = await issue(null, { input });

    expect(documentId).toBe("existing-doc");
    expect(createEmpty).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });
});
