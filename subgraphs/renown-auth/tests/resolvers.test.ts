import { PGlite } from "@electric-sql/pglite";
import type { IRelationalDb, OperationWithContext } from "@powerhousedao/reactor-browser";
import {
  buildAndSignCredential,
  type PowerhouseVerifiableCredential,
  type SignCredentialTypedData,
} from "@renown/sdk";
import type { Action } from "document-model";
import { print } from "graphql";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { InitInput } from "../../../document-models/renown-credential/index.js";
import type { DB as CredentialDB } from "../../../processors/renown-credential/schema.js";
import type { DB as UserDB } from "../../../processors/renown-user/schema.js";
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import { up as upCredential } from "../../../processors/renown-credential/migrations.js";
import { RenownUserProcessor } from "../../../processors/renown-user/index.js";
import { up as upUser } from "../../../processors/renown-user/migrations.js";
import { createRateLimiter } from "../core/rate-limit.js";
import { profileMessage, revokeMessage } from "../core/signed-message.js";
import { createResolvers, type ResolverDeps } from "../resolvers.js";
import { schema } from "../schema.js";

const ALICE = privateKeyToAccount(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
);
const MALLORY = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const APP_DID = "did:key:z6MkApp";
const MINUTE = 60_000;

function signCredential(
  account: PrivateKeyAccount,
  app = "test-app",
): Promise<PowerhouseVerifiableCredential> {
  const sign: SignCredentialTypedData = (args) =>
    account.signTypedData(args as Parameters<typeof account.signTypedData>[0]);
  return buildAndSignCredential({
    signTypedData: sign,
    address: account.address,
    chainId: 1,
    app,
    appId: APP_DID,
    expiresInDays: 7,
  });
}

// The `renown_issueCredential` input mirrors the credential minus the redundant
// eip712.types (the reactor-generated RenownCredential_InitInput shape).
function toInput(credential: PowerhouseVerifiableCredential): InitInput {
  return {
    context: credential["@context"],
    id: credential.id,
    type: credential.type,
    issuer: { id: credential.issuer.id, ethereumAddress: credential.issuer.ethereumAddress },
    issuanceDate: credential.issuanceDate,
    expirationDate: credential.expirationDate,
    credentialSubject: { id: credential.credentialSubject.id, app: credential.credentialSubject.app },
    credentialSchema: { id: credential.credentialSchema.id, type: credential.credentialSchema.type },
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

const CRED_NS = RenownCredentialProcessor.getNamespace("renown-credential");
const USER_NS = RenownUserProcessor.getNamespace("renown-user");
const FILTER = { branch: ["main"], documentId: ["*"], documentType: [], scope: ["global"] };

let root: Kysely<CredentialDB & UserDB>;

beforeAll(async () => {
  root = new Kysely<CredentialDB & UserDB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ${sql.id(CRED_NS)}`.execute(root);
  await sql`create schema ${sql.id(USER_NS)}`.execute(root);
  await upCredential(root.withSchema(CRED_NS) as never);
  await upUser(root.withSchema(USER_NS) as never);
});

afterAll(async () => {
  await root.destroy();
});

beforeEach(async () => {
  await root.withSchema(CRED_NS).deleteFrom("renown_credential").execute();
  await root.withSchema(USER_NS).deleteFrom("renown_user").execute();
});

interface StoredOperation {
  index: number;
  action: Action;
  error?: string;
}

/**
 * A reactor client that keeps documents in memory and feeds every applied
 * operation through the real read-model processors (backed by PGlite), so the
 * resolvers read back what they wrote exactly as they would on a host.
 */
function fakeReactor() {
  let next = 0;
  const docs = new Map<string, { type: string; operations: StoredOperation[] }>();
  const failingActionTypes = new Set<string>();
  const deleteDocument = vi.fn(() => Promise.resolve());
  const processors: Record<string, { onOperations(ops: OperationWithContext[]): Promise<void> }> = {
    "powerhouse/renown-credential": new RenownCredentialProcessor(
      CRED_NS,
      FILTER,
      root.withSchema(CRED_NS) as never,
      { deleteDocument },
    ),
    "powerhouse/renown-user": new RenownUserProcessor(USER_NS, FILTER, root.withSchema(USER_NS) as never),
  };

  const createEmpty = vi.fn((documentType: string) => {
    const id = `doc-${++next}`;
    docs.set(id, { type: documentType, operations: [] });
    return Promise.resolve({ header: { id, documentType } });
  });

  const execute = vi.fn(async (id: string, branch: string, actions: Action[]) => {
    const doc = docs.get(id);
    if (!doc) throw new Error(`no document ${id}`);
    for (const action of actions) {
      const operation: StoredOperation = {
        index: doc.operations.length,
        action,
        ...(failingActionTypes.has(action.type) ? { error: `${action.type} rejected` } : {}),
      };
      doc.operations.push(operation);
      if (operation.error) continue;
      await processors[doc.type].onOperations([
        {
          operation,
          context: { documentId: id, documentType: doc.type, scope: "global", branch, ordinal: 0 },
        } as never,
      ]);
    }
    return { header: { id, documentType: doc.type }, operations: { global: doc.operations } };
  });

  /** The action types applied to `id`, in order. */
  const appliedTypes = (id: string) => docs.get(id)?.operations.map((op) => op.action.type) ?? [];
  const docsOfType = (type: string) => [...docs.entries()].filter(([, d]) => d.type === type).map(([id]) => id);

  return { createEmpty, execute, deleteDocument, failingActionTypes, appliedTypes, docsOfType };
}

const relationalDb = {
  queryNamespace: (namespace: string) => root.withSchema(namespace),
} as unknown as IRelationalDb<unknown>;

type Ctx = { user?: { address?: string } };
type Resolver<A, R> = (parent: unknown, args: A, ctx: Ctx) => Promise<R>;
interface Mutations {
  renown_issueCredential: Resolver<
    { input: InitInput; username?: string | null; userImage?: string | null; userDocId?: string | null },
    string
  >;
  renown_revokeCredential: Resolver<
    { credentialId: string; signature?: string | null; timestamp?: string | null },
    boolean
  >;
  renown_upsertProfile: Resolver<
    {
      address: string;
      username?: string | null;
      userImage?: string | null;
      signature?: string | null;
      timestamp?: string | null;
    },
    string
  >;
}

function setup(options: { issuanceLimit?: number; profileLimit?: number } = {}) {
  const reactor = fakeReactor();
  const resolvers = createResolvers({
    reactorClient: reactor as unknown as ResolverDeps["reactorClient"],
    relationalDb,
    ...(options.issuanceLimit !== undefined
      ? { issuanceRateLimiter: createRateLimiter(options.issuanceLimit, MINUTE) }
      : {}),
    ...(options.profileLimit !== undefined
      ? { profileRateLimiter: createRateLimiter(options.profileLimit, MINUTE) }
      : {}),
  }) as { Mutation: Mutations };
  return { reactor, ...resolvers.Mutation };
}

const ANON: Ctx = {};
const tokenFor = (address: string): Ctx => ({ user: { address } });

async function profileRows(address: string) {
  return root
    .withSchema(USER_NS)
    .selectFrom("renown_user")
    .selectAll()
    .where(sql`lower(eth_address)`, "=", address.toLowerCase())
    .execute();
}

async function credentialRows(credentialId: string) {
  return root
    .withSchema(CRED_NS)
    .selectFrom("renown_credential")
    .selectAll()
    .where("credential_id", "=", credentialId)
    .execute();
}

async function signRevoke(account: PrivateKeyAccount, credentialId: string, at: Date) {
  const timestamp = at.toISOString();
  const signature = await account.signMessage({ message: revokeMessage(credentialId, timestamp) });
  return { signature, timestamp };
}

async function signProfile(
  account: PrivateKeyAccount,
  address: string,
  profile: { username?: string | null; userImage?: string | null },
  at: Date = new Date(),
) {
  const timestamp = at.toISOString();
  const signature = await account.signMessage({
    message: await profileMessage(address, profile, timestamp),
  });
  return { signature, timestamp };
}

const FORBIDDEN = { extensions: { code: "FORBIDDEN" } };
const BAD_USER_INPUT = { extensions: { code: "BAD_USER_INPUT" } };
const RATE_LIMITED = { message: "Rate limited", extensions: { code: "RATE_LIMITED" } };
const INTERNAL = { extensions: { code: "INTERNAL_SERVER_ERROR" } };
const LONG_USERNAME = "u".repeat(256);
const LONG_IMAGE = "i".repeat(524_289);

/** Inserts a read-model row for `credentialId` claiming `issuer`, as a pre-closure junk write would. */
async function seedJunkCredential(
  reactor: ReturnType<typeof fakeReactor>,
  credentialId: string,
  issuer: string,
  createdAt: Date,
): Promise<string> {
  const junk = (await reactor.createEmpty("powerhouse/renown-credential")).header.id;
  await root
    .withSchema(CRED_NS)
    .insertInto("renown_credential")
    .values({
      document_id: junk,
      context: "[]",
      credential_id: credentialId,
      type: "[]",
      issuer_id: `did:pkh:eip155:1:${issuer}`,
      issuer_ethereum_address: issuer,
      issuance_date: createdAt,
      credential_subject_app: "junk",
      credential_schema_id: "x",
      credential_schema_type: "x",
      proof_verification_method: "x",
      proof_ethereum_address: issuer,
      proof_created: createdAt,
      proof_purpose: "x",
      proof_type: "x",
      proof_value: "0x00",
      proof_eip712_domain: "{}",
      proof_eip712_primary_type: "x",
      revoked: false,
      created_at: createdAt,
      updated_at: createdAt,
    })
    .execute();
  return junk;
}

describe("renown-auth schema", () => {
  const sdl = print(schema);

  it("declares the three mutations with their exact signatures", () => {
    expect(sdl).toContain(
      "renown_issueCredential(input: RenownCredential_InitInput!, username: String, userImage: String, userDocId: PHID): String",
    );
    expect(sdl).toContain(
      "renown_revokeCredential(credentialId: String!, signature: String, timestamp: String): Boolean",
    );
    expect(sdl).toContain(
      "renown_upsertProfile(address: String!, username: String, userImage: String, signature: String, timestamp: String): String",
    );
  });

  it("reuses the credential model's inputs under the reactor's prefix", () => {
    expect(sdl).toContain("input RenownCredential_InitInput");
    expect(sdl).toMatch(/issuer: RenownCredential_IssuerInput!/);
    expect(sdl).not.toMatch(/\binput InitInput\b/);
  });
});

describe("renown_issueCredential", () => {
  it("creates the credential and the issuer's first profile with username and image", async () => {
    const { reactor, renown_issueCredential } = setup();
    const input = toInput(await signCredential(ALICE));

    const documentId = await renown_issueCredential(
      null,
      { input, username: "alice", userImage: "https://img/alice.png", userDocId: "ignored" },
      ANON,
    );

    expect(reactor.createEmpty).toHaveBeenCalledWith("powerhouse/renown-credential");
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT"]);
    const [credential] = await credentialRows(input.id);
    expect(credential.document_id).toBe(documentId);

    const profiles = await profileRows(ALICE.address);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      eth_address: ALICE.address.toLowerCase(),
      username: "alice",
      user_image: "https://img/alice.png",
    });
    expect(profiles[0].document_id).not.toBe("ignored");
  });

  it("creates a profile with only the eth address when no username or image is given", async () => {
    const { renown_issueCredential } = setup();
    await renown_issueCredential(null, { input: toInput(await signCredential(ALICE)) }, ANON);

    const profiles = await profileRows(ALICE.address);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ username: null, user_image: null });
  });

  it("is idempotent: the same credential returns the same document and writes nothing", async () => {
    const { reactor, renown_issueCredential } = setup();
    const input = toInput(await signCredential(ALICE));

    const first = await renown_issueCredential(null, { input, username: "alice" }, ANON);
    const createCalls = reactor.createEmpty.mock.calls.length;
    const executeCalls = reactor.execute.mock.calls.length;
    const second = await renown_issueCredential(null, { input, username: "alice" }, ANON);

    expect(second).toBe(first);
    expect(reactor.createEmpty.mock.calls.length).toBe(createCalls);
    expect(reactor.execute.mock.calls.length).toBe(executeCalls);
    expect(await credentialRows(input.id)).toHaveLength(1);
  });

  it("a replayed credential with a different username leaves the profile untouched", async () => {
    const { reactor, renown_issueCredential } = setup();
    const input = toInput(await signCredential(ALICE));
    await renown_issueCredential(null, { input, username: "alice", userImage: "a.png" }, ANON);
    const [profile] = await profileRows(ALICE.address);
    const profileOps = reactor.appliedTypes(profile.document_id);

    // Someone replays Alice's public signed credential with their own profile fields.
    await renown_issueCredential(null, { input, username: "mallory", userImage: "m.png" }, ANON);

    const profiles = await profileRows(ALICE.address);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ username: "alice", user_image: "a.png" });
    expect(reactor.appliedTypes(profile.document_id)).toEqual(profileOps);
  });

  it("a new credential for an address that already has a profile never changes it", async () => {
    const { reactor, renown_issueCredential } = setup();
    await renown_issueCredential(
      null,
      { input: toInput(await signCredential(ALICE)), username: "alice" },
      ANON,
    );
    const [profile] = await profileRows(ALICE.address);
    const profileOps = reactor.appliedTypes(profile.document_id);

    await renown_issueCredential(
      null,
      { input: toInput(await signCredential(ALICE)), username: "renamed", userImage: "x.png" },
      ANON,
    );

    const profiles = await profileRows(ALICE.address);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ username: "alice", user_image: null });
    expect(reactor.appliedTypes(profile.document_id)).toEqual(profileOps);
    expect(reactor.docsOfType("powerhouse/renown-user")).toHaveLength(1);
  });

  it("rejects a credential whose proof signature does not match the issuer", async () => {
    const { reactor, renown_issueCredential } = setup();
    const credential = await signCredential(ALICE);
    const last = credential.proof.proofValue.slice(-1) === "0" ? "1" : "0";
    credential.proof.proofValue = credential.proof.proofValue.slice(0, -1) + last;

    await expect(
      renown_issueCredential(null, { input: toInput(credential), username: "x" }, ANON),
    ).rejects.toThrow(/^Invalid request: /);
    expect(reactor.createEmpty).not.toHaveBeenCalled();
    expect(reactor.execute).not.toHaveBeenCalled();
  });

  it("rejects a credential signed by another wallet than its issuer", async () => {
    const { reactor, renown_issueCredential } = setup();
    const alice = await signCredential(ALICE);
    const mallory = await signCredential(MALLORY);
    alice.proof.proofValue = mallory.proof.proofValue;

    await expect(renown_issueCredential(null, { input: toInput(alice) }, ANON)).rejects.toThrow(
      /^Invalid request: /,
    );
    expect(reactor.createEmpty).not.toHaveBeenCalled();
  });

  it("rejects a signed credential whose app exceeds its varchar(255) column, before any write", async () => {
    const { reactor, renown_issueCredential } = setup();
    const input = toInput(await signCredential(ALICE, "a".repeat(256)));

    await expect(renown_issueCredential(null, { input }, ANON)).rejects.toMatchObject({
      message: "Invalid request: credentialSubject.app exceeds 255 characters",
      ...BAD_USER_INPUT,
    });
    expect(reactor.createEmpty).not.toHaveBeenCalled();
    expect(reactor.execute).not.toHaveBeenCalled();
  });

  it("indexes a signed credential with a 255-character app through the real processor", async () => {
    const { renown_issueCredential } = setup();
    const input = toInput(await signCredential(ALICE, "a".repeat(255)));

    const documentId = await renown_issueCredential(null, { input }, ANON);

    const rows = await credentialRows(input.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ document_id: documentId });
    expect(rows[0].credential_subject_app).toHaveLength(255);
  });

  it("rejects structurally invalid input before verifying", async () => {
    const { reactor, renown_issueCredential } = setup();
    const input = toInput(await signCredential(ALICE));
    input.proof.type = "SomethingElse";

    await expect(renown_issueCredential(null, { input }, ANON)).rejects.toThrow(
      /^Invalid request: proof\.type/,
    );
    expect(reactor.createEmpty).not.toHaveBeenCalled();
  });

  it("rate limits issuance per issuer address, and only proven issuers consume the budget", async () => {
    const { renown_issueCredential } = setup({ issuanceLimit: 3 });
    const forged = toInput(await signCredential(ALICE));
    forged.proof.proofValue = (await signCredential(MALLORY)).proof.proofValue;

    // Rejected forgeries naming Alice as issuer do not eat into her budget.
    for (let i = 0; i < 5; i++) {
      await expect(renown_issueCredential(null, { input: forged }, ANON)).rejects.toThrow(
        /^Invalid request: /,
      );
    }
    for (let i = 0; i < 3; i++) {
      await renown_issueCredential(null, { input: toInput(await signCredential(ALICE)) }, ANON);
    }
    await expect(
      renown_issueCredential(null, { input: toInput(await signCredential(ALICE)) }, ANON),
    ).rejects.toMatchObject(RATE_LIMITED);

    // Another issuer has its own budget.
    await expect(
      renown_issueCredential(null, { input: toInput(await signCredential(MALLORY)) }, ANON),
    ).resolves.toEqual(expect.any(String));
  });

  it("defaults to 30 issuances per minute per issuer", async () => {
    const { renown_issueCredential } = setup();
    for (let i = 0; i < 30; i++) {
      await renown_issueCredential(null, { input: toInput(await signCredential(ALICE)) }, ANON);
    }
    await expect(
      renown_issueCredential(null, { input: toInput(await signCredential(ALICE)) }, ANON),
    ).rejects.toMatchObject(RATE_LIMITED);
  });

  it("replays of an existing credential never spend the issuer's budget", async () => {
    const { reactor, renown_issueCredential } = setup();
    const input = toInput(await signCredential(ALICE));
    const documentId = await renown_issueCredential(null, { input }, ANON);

    // Anyone can replay Alice's public credential; 40 replays exceed the limit of 30.
    for (let i = 0; i < 40; i++) {
      await expect(renown_issueCredential(null, { input }, ANON)).resolves.toBe(documentId);
    }
    expect(reactor.docsOfType("powerhouse/renown-credential")).toHaveLength(1);

    await expect(
      renown_issueCredential(null, { input: toInput(await signCredential(ALICE)) }, ANON),
    ).resolves.toEqual(expect.any(String));
  });

  it("is not fooled by a junk row claiming the credential id under another issuer", async () => {
    const { reactor, renown_issueCredential } = setup();
    const input = toInput(await signCredential(ALICE));
    const junk = await seedJunkCredential(reactor, input.id, MALLORY.address.toLowerCase(), new Date("2026-01-01T00:00:00Z"));

    const documentId = await renown_issueCredential(null, { input }, ANON);

    expect(documentId).not.toBe(junk);
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT"]);
    expect(await credentialRows(input.id)).toHaveLength(2);
    await expect(renown_issueCredential(null, { input }, ANON)).resolves.toBe(documentId);
  });

  it("rejects an oversized username or userImage before writing anything", async () => {
    const { reactor, renown_issueCredential } = setup();
    const input = toInput(await signCredential(ALICE));

    await expect(
      renown_issueCredential(null, { input, username: LONG_USERNAME }, ANON),
    ).rejects.toMatchObject(BAD_USER_INPUT);
    await expect(
      renown_issueCredential(null, { input, userImage: LONG_IMAGE }, ANON),
    ).rejects.toMatchObject(BAD_USER_INPUT);
    expect(reactor.createEmpty).not.toHaveBeenCalled();

    // At the caps is fine.
    await renown_issueCredential(
      null,
      { input, username: "u".repeat(255), userImage: "i".repeat(524_288) },
      ANON,
    );
    expect((await profileRows(ALICE.address))[0].username).toHaveLength(255);
  });

  it("throws when the reactor rejects the INIT operation", async () => {
    const { reactor, renown_issueCredential } = setup();
    reactor.failingActionTypes.add("INIT");

    await expect(
      renown_issueCredential(null, { input: toInput(await signCredential(ALICE)) }, ANON),
    ).rejects.toMatchObject({ ...INTERNAL, message: expect.stringMatching(/INIT rejected/) as unknown });
    expect(await profileRows(ALICE.address)).toHaveLength(0);
  });
});

describe("renown_revokeCredential", () => {
  async function issued() {
    const context = setup();
    const input = toInput(await signCredential(ALICE));
    const documentId = await context.renown_issueCredential(null, { input }, ANON);
    return { ...context, credentialId: input.id, documentId };
  }

  async function isRevoked(credentialId: string) {
    const rows = await credentialRows(credentialId);
    return rows.every((row) => row.revoked);
  }

  it("revokes with a login token for the issuer address (any case)", async () => {
    const { reactor, renown_revokeCredential, credentialId, documentId } = await issued();

    await expect(
      renown_revokeCredential(null, { credentialId }, tokenFor(ALICE.address.toUpperCase().replace("0X", "0x"))),
    ).resolves.toBe(true);

    expect(await isRevoked(credentialId)).toBe(true);
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT", "REVOKE"]);
    const [id, , actions] = reactor.execute.mock.calls.at(-1)!;
    expect(id).toBe(documentId);
    const revokeInput = actions[0].input as { revokedAt: string; reason: string };
    expect(revokeInput.reason).toBe("revoked by owner");
    expect(Date.parse(revokeInput.revokedAt)).not.toBeNaN();
  });

  it("revokes with the issuer's fresh signature", async () => {
    const { renown_revokeCredential, credentialId } = await issued();
    const signed = await signRevoke(ALICE, credentialId, new Date());

    await expect(renown_revokeCredential(null, { credentialId, ...signed }, ANON)).resolves.toBe(true);
    expect(await isRevoked(credentialId)).toBe(true);
  });

  it("is FORBIDDEN without a token or signature", async () => {
    const { renown_revokeCredential, credentialId } = await issued();
    await expect(renown_revokeCredential(null, { credentialId }, ANON)).rejects.toMatchObject(FORBIDDEN);
    expect(await isRevoked(credentialId)).toBe(false);
  });

  it("is FORBIDDEN with another wallet's signature", async () => {
    const { reactor, renown_revokeCredential, credentialId, documentId } = await issued();
    const signed = await signRevoke(MALLORY, credentialId, new Date());

    await expect(renown_revokeCredential(null, { credentialId, ...signed }, ANON)).rejects.toMatchObject(
      FORBIDDEN,
    );
    expect(await isRevoked(credentialId)).toBe(false);
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT"]);
  });

  it("is FORBIDDEN with a stale timestamp", async () => {
    const { renown_revokeCredential, credentialId } = await issued();
    const signed = await signRevoke(ALICE, credentialId, new Date(Date.now() - 11 * MINUTE));

    await expect(renown_revokeCredential(null, { credentialId, ...signed }, ANON)).rejects.toMatchObject(
      FORBIDDEN,
    );
    expect(await isRevoked(credentialId)).toBe(false);
  });

  it("is FORBIDDEN with a future timestamp", async () => {
    const { renown_revokeCredential, credentialId } = await issued();
    const signed = await signRevoke(ALICE, credentialId, new Date(Date.now() + 11 * MINUTE));

    await expect(renown_revokeCredential(null, { credentialId, ...signed }, ANON)).rejects.toMatchObject(
      FORBIDDEN,
    );
    expect(await isRevoked(credentialId)).toBe(false);
  });

  it("is FORBIDDEN with the issuer's signature over another credential id", async () => {
    const { renown_revokeCredential, credentialId } = await issued();
    const signed = await signRevoke(ALICE, "urn:uuid:another", new Date());

    await expect(renown_revokeCredential(null, { credentialId, ...signed }, ANON)).rejects.toMatchObject(
      FORBIDDEN,
    );
    expect(await isRevoked(credentialId)).toBe(false);
  });

  it("is FORBIDDEN with a login token for another address, even carrying a bad signature", async () => {
    const { renown_revokeCredential, credentialId } = await issued();
    const signed = await signRevoke(MALLORY, credentialId, new Date());

    await expect(
      renown_revokeCredential(null, { credentialId }, tokenFor(MALLORY.address)),
    ).rejects.toMatchObject(FORBIDDEN);
    await expect(
      renown_revokeCredential(null, { credentialId, ...signed }, tokenFor(MALLORY.address)),
    ).rejects.toMatchObject(FORBIDDEN);
    expect(await isRevoked(credentialId)).toBe(false);
  });

  it("returns true for an already revoked credential without revoking again", async () => {
    const { reactor, renown_revokeCredential, credentialId, documentId } = await issued();
    await renown_revokeCredential(null, { credentialId }, tokenFor(ALICE.address));
    const executeCalls = reactor.execute.mock.calls.length;

    await expect(renown_revokeCredential(null, { credentialId }, tokenFor(ALICE.address))).resolves.toBe(
      true,
    );
    expect(reactor.execute.mock.calls.length).toBe(executeCalls);
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT", "REVOKE"]);
  });

  it("still requires authorization for an already revoked credential", async () => {
    const { renown_revokeCredential, credentialId } = await issued();
    await renown_revokeCredential(null, { credentialId }, tokenFor(ALICE.address));

    await expect(
      renown_revokeCredential(null, { credentialId }, tokenFor(MALLORY.address)),
    ).rejects.toMatchObject(FORBIDDEN);
  });

  it("revokes every live copy of the credential, not just one", async () => {
    const { reactor, renown_revokeCredential, credentialId, documentId } = await issued();
    // A copy of the same signed credential written before writes were closed.
    const input = (await credentialRows(credentialId))[0];
    const copy = await reactor.createEmpty("powerhouse/renown-credential");
    await root
      .withSchema(CRED_NS)
      .insertInto("renown_credential")
      .values({ ...input, document_id: copy.header.id })
      .execute();

    await renown_revokeCredential(null, { credentialId }, tokenFor(ALICE.address));

    expect(await credentialRows(credentialId)).toHaveLength(2);
    expect(await isRevoked(credentialId)).toBe(true);
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT", "REVOKE"]);
    expect(reactor.appliedTypes(copy.header.id)).toEqual(["REVOKE"]);
  });

  it("a live junk copy under another issuer neither blocks the issuer nor lets its claimant revoke the real one", async () => {
    const { reactor, renown_revokeCredential, credentialId, documentId } = await issued();
    // Older than Alice's row, so it sorts first among the live copies.
    const junk = await seedJunkCredential(
      reactor,
      credentialId,
      MALLORY.address.toLowerCase(),
      new Date("2020-01-01T00:00:00Z"),
    );
    const revokedDocs = async () =>
      Object.fromEntries((await credentialRows(credentialId)).map((row) => [row.document_id, row.revoked]));

    // Mallory, "issuer" of the junk copy, can only ever touch her own copy.
    const byMallory = await signRevoke(MALLORY, credentialId, new Date());
    await renown_revokeCredential(null, { credentialId, ...byMallory }, ANON);
    await renown_revokeCredential(null, { credentialId }, tokenFor(MALLORY.address));
    expect((await revokedDocs())[documentId]).toBe(false);
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT"]);

    // Alice revokes hers by signature, despite the older junk row.
    const byAlice = await signRevoke(ALICE, credentialId, new Date());
    await expect(renown_revokeCredential(null, { credentialId, ...byAlice }, ANON)).resolves.toBe(true);
    expect((await revokedDocs())[documentId]).toBe(true);
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT", "REVOKE"]);
    expect(reactor.appliedTypes(junk)).toEqual(["REVOKE"]);
  });

  it("revokes by token for a live junk copy's issuer, not the real one", async () => {
    const { reactor, renown_revokeCredential, credentialId, documentId } = await issued();
    await seedJunkCredential(reactor, credentialId, MALLORY.address.toLowerCase(), new Date("2020-01-01T00:00:00Z"));

    await expect(renown_revokeCredential(null, { credentialId }, tokenFor(ALICE.address))).resolves.toBe(true);
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT", "REVOKE"]);
  });

  it("returns true for an already revoked credential when authorized by signature", async () => {
    const { reactor, renown_revokeCredential, credentialId, documentId } = await issued();
    await renown_revokeCredential(null, { credentialId }, tokenFor(ALICE.address));
    const signed = await signRevoke(ALICE, credentialId, new Date());

    await expect(renown_revokeCredential(null, { credentialId, ...signed }, ANON)).resolves.toBe(true);
    expect(reactor.appliedTypes(documentId)).toEqual(["INIT", "REVOKE"]);
  });

  it("is FORBIDDEN with an unrecoverable signature", async () => {
    const { renown_revokeCredential, credentialId } = await issued();
    for (const signature of ["0xdeadbeef", "not-hex", "0x" + "00".repeat(65)]) {
      await expect(
        renown_revokeCredential(null, { credentialId, signature, timestamp: new Date().toISOString() }, ANON),
      ).rejects.toMatchObject(FORBIDDEN);
    }
    expect(await isRevoked(credentialId)).toBe(false);
  });

  it("throws Not found for an unknown credential id", async () => {
    const { renown_revokeCredential } = setup();
    await expect(
      renown_revokeCredential(null, { credentialId: "urn:uuid:nope" }, tokenFor(ALICE.address)),
    ).rejects.toMatchObject({ message: "Not found", extensions: { code: "NOT_FOUND" } });
  });

  it("throws when the reactor rejects the REVOKE operation", async () => {
    const { reactor, renown_revokeCredential, credentialId } = await issued();
    reactor.failingActionTypes.add("REVOKE");

    await expect(
      renown_revokeCredential(null, { credentialId }, tokenFor(ALICE.address)),
    ).rejects.toMatchObject({ ...INTERNAL, message: expect.stringMatching(/REVOKE rejected/) as unknown });
  });
});

describe("renown_upsertProfile", () => {
  const alice = ALICE.address;

  it("creates the profile with a login token for the address", async () => {
    const { reactor, renown_upsertProfile } = setup();

    const documentId = await renown_upsertProfile(
      null,
      { address: alice, username: "alice", userImage: "a.png" },
      tokenFor(alice.toLowerCase()),
    );

    expect(reactor.appliedTypes(documentId)).toEqual(["SET_ETH_ADDRESS", "SET_USERNAME", "SET_USER_IMAGE"]);
    const profiles = await profileRows(alice);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      document_id: documentId,
      eth_address: alice.toLowerCase(),
      username: "alice",
      user_image: "a.png",
    });
  });

  it("updates the profile with the address's fresh signature", async () => {
    const { reactor, renown_upsertProfile } = setup();
    const created = await renown_upsertProfile(null, { address: alice, username: "alice" }, tokenFor(alice));
    const signed = await signProfile(ALICE, alice, { username: "alice2" });

    const documentId = await renown_upsertProfile(
      null,
      { address: alice, username: "alice2", ...signed },
      ANON,
    );

    expect(documentId).toBe(created);
    expect(reactor.appliedTypes(documentId)).toEqual(["SET_ETH_ADDRESS", "SET_USERNAME", "SET_USERNAME"]);
    const profiles = await profileRows(alice);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({ username: "alice2", user_image: null });
  });

  it("applies only the provided fields", async () => {
    const { reactor, renown_upsertProfile } = setup();
    const created = await renown_upsertProfile(
      null,
      { address: alice, username: "alice", userImage: "a.png" },
      tokenFor(alice),
    );

    await renown_upsertProfile(null, { address: alice, userImage: "b.png" }, tokenFor(alice));

    expect(reactor.appliedTypes(created).slice(-1)).toEqual(["SET_USER_IMAGE"]);
    expect((await profileRows(alice))[0]).toMatchObject({ username: "alice", user_image: "b.png" });
  });

  it("is FORBIDDEN with a signature over a different payload", async () => {
    const { reactor, renown_upsertProfile } = setup();
    const signed = await signProfile(ALICE, alice, { username: "alice" });

    await expect(
      renown_upsertProfile(null, { address: alice, username: "mallory", ...signed }, ANON),
    ).rejects.toMatchObject(FORBIDDEN);
    expect(reactor.createEmpty).not.toHaveBeenCalled();
  });

  it("is FORBIDDEN with another wallet's signature, a stale signature, or another address's token", async () => {
    const { reactor, renown_upsertProfile } = setup();
    const byMallory = await signProfile(MALLORY, alice, { username: "x" });
    const stale = await signProfile(ALICE, alice, { username: "x" }, new Date(Date.now() - 11 * MINUTE));
    const future = await signProfile(ALICE, alice, { username: "x" }, new Date(Date.now() + 11 * MINUTE));

    for (const signed of [byMallory, stale, future]) {
      await expect(
        renown_upsertProfile(null, { address: alice, username: "x", ...signed }, ANON),
      ).rejects.toMatchObject(FORBIDDEN);
    }
    await expect(
      renown_upsertProfile(null, { address: alice, username: "x" }, tokenFor(MALLORY.address)),
    ).rejects.toMatchObject(FORBIDDEN);
    await expect(renown_upsertProfile(null, { address: alice, username: "x" }, ANON)).rejects.toMatchObject(
      FORBIDDEN,
    );
    expect(reactor.createEmpty).not.toHaveBeenCalled();
    expect(reactor.execute).not.toHaveBeenCalled();
  });

  it("rejects an oversized username or userImage before writing anything", async () => {
    const { reactor, renown_upsertProfile } = setup();

    await expect(
      renown_upsertProfile(null, { address: alice, username: LONG_USERNAME }, tokenFor(alice)),
    ).rejects.toMatchObject(BAD_USER_INPUT);
    await expect(
      renown_upsertProfile(null, { address: alice, userImage: LONG_IMAGE }, tokenFor(alice)),
    ).rejects.toMatchObject(BAD_USER_INPUT);
    expect(reactor.createEmpty).not.toHaveBeenCalled();
    expect(reactor.execute).not.toHaveBeenCalled();

    await expect(
      renown_upsertProfile(
        null,
        { address: alice, username: "u".repeat(255), userImage: "i".repeat(524_288) },
        tokenFor(alice),
      ),
    ).resolves.toEqual(expect.any(String));
    const [row] = await profileRows(alice);
    expect(row.username).toHaveLength(255);
    expect(row.user_image).toHaveLength(524_288);
  });

  it("rate limits upserts per authorized address", async () => {
    const { renown_upsertProfile } = setup({ profileLimit: 3 });

    // Refused callers don't spend Alice's budget.
    for (let i = 0; i < 5; i++) {
      await expect(
        renown_upsertProfile(null, { address: alice, username: "x" }, tokenFor(MALLORY.address)),
      ).rejects.toMatchObject(FORBIDDEN);
    }
    for (let i = 0; i < 3; i++) {
      await renown_upsertProfile(null, { address: alice, username: `a${i}` }, tokenFor(alice));
    }
    await expect(
      renown_upsertProfile(null, { address: alice.toLowerCase(), username: "a4" }, tokenFor(alice)),
    ).rejects.toMatchObject(RATE_LIMITED);
    expect((await profileRows(alice))[0].username).toBe("a2");

    await expect(
      renown_upsertProfile(null, { address: MALLORY.address, username: "m" }, tokenFor(MALLORY.address)),
    ).resolves.toEqual(expect.any(String));
  });

  it("defaults to 30 upserts per minute per address", async () => {
    const { renown_upsertProfile } = setup();
    for (let i = 0; i < 30; i++) {
      await renown_upsertProfile(null, { address: alice, username: `a${i}` }, tokenFor(alice));
    }
    await expect(
      renown_upsertProfile(null, { address: alice, username: "late" }, tokenFor(alice)),
    ).rejects.toMatchObject(RATE_LIMITED);
  });

  it("updates the newest existing profile and never creates a duplicate", async () => {
    const { reactor, renown_upsertProfile } = setup();
    const older = (await reactor.createEmpty("powerhouse/renown-user")).header.id;
    const newer = (await reactor.createEmpty("powerhouse/renown-user")).header.id;
    await root
      .withSchema(USER_NS)
      .insertInto("renown_user")
      .values([
        { document_id: older, eth_address: alice, username: "old", created_at: new Date("2025-01-01T00:00:00Z"), updated_at: new Date("2026-09-01T00:00:00Z") },
        { document_id: newer, eth_address: alice.toLowerCase(), username: "new", created_at: new Date("2026-01-01T00:00:00Z"), updated_at: new Date("2026-02-01T00:00:00Z") },
      ])
      .execute();

    const documentId = await renown_upsertProfile(
      null,
      { address: alice, username: "alice" },
      tokenFor(alice),
    );

    expect(documentId).toBe(newer);
    expect(reactor.appliedTypes(newer)).toEqual(["SET_USERNAME"]);
    expect(reactor.appliedTypes(older)).toEqual([]);
    expect(reactor.docsOfType("powerhouse/renown-user")).toHaveLength(2);
    const byId = Object.fromEntries((await profileRows(alice)).map((row) => [row.document_id, row.username]));
    expect(byId).toEqual({ [older]: "old", [newer]: "alice" });
  });

  it("throws when the reactor rejects a profile operation", async () => {
    const { reactor, renown_upsertProfile } = setup();
    reactor.failingActionTypes.add("SET_USERNAME");

    await expect(
      renown_upsertProfile(null, { address: alice, username: "alice" }, tokenFor(alice)),
    ).rejects.toMatchObject({ ...INTERNAL, message: expect.stringMatching(/SET_USERNAME rejected/) as unknown });
  });
});
