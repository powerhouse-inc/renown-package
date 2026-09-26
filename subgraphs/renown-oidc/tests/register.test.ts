import { describe, expect, it } from "vitest";
import type { Action } from "document-model";
import { hashSecret } from "../core/crypto.js";
import {
  ClientRegistryError,
  registerClient,
  rotateClientSecret,
  updateClient,
  type ClientRegistryDeps,
} from "../register.js";
import { MemoryOidcStore } from "../store/memory.js";

const ADDRESS = "0xAbC0000000000000000000000000000000000001";
const OTHER = "0xabc0000000000000000000000000000000000002";

function fakeRegistry(opts: { rejectAction?: string; executeThrows?: boolean; driveId?: string | null } = {}) {
  const executed: { id: string; actions: Action[] }[] = [];
  const created: unknown[][] = [];
  const logs: string[] = [];
  const store = new MemoryOidcStore();
  const deps: ClientRegistryDeps = {
    store,
    driveId: opts.driveId ?? null,
    now: () => new Date("2026-09-26T12:00:00Z"),
    log: (message) => logs.push(message),
    reactorClient: {
      createEmpty: ((type: string, options?: unknown) => {
        created.push([type, options]);
        return Promise.resolve({ header: { id: `doc-${created.length}`, documentType: type } });
      }) as never,
      execute: ((id: string, _branch: string, actions: Action[]) => {
        executed.push({ id, actions });
        if (opts.executeThrows) return Promise.reject(new Error("reactor down"));
        const global = actions.map((action, index) => ({
          index,
          action,
          error: action.type === opts.rejectAction ? "rejected by reducer" : undefined,
        }));
        return Promise.resolve({ header: { id }, operations: { global } });
      }) as never,
    },
  };
  return { deps, store, executed, created, logs };
}

const input = {
  name: " Speckle ",
  redirectUris: ["https://a.example/cb", "https://b.example/cb"],
  allowedSubjects: [ADDRESS, `did:pkh:eip155:1:${OTHER}`],
  confidential: true,
};

describe("registerClient", () => {
  it("writes the client row (the source of truth) with normalized input and a hashed secret", async () => {
    const { deps, store } = fakeRegistry();
    const { clientId, clientSecret } = await registerClient(deps, input);
    expect(clientId).toBe("doc-1");
    expect(clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.getClient("doc-1")).toEqual({
      id: "doc-1",
      name: "Speckle",
      redirectUris: input.redirectUris,
      allowedSubjects: [ADDRESS.toLowerCase(), OTHER],
      allowAnySubject: false,
      clientSecretHash: await hashSecret(clientSecret!),
      status: "ACTIVE",
    });
  });

  it("mirrors the configuration onto a renown/oidc-client document", async () => {
    const { deps, created, executed } = fakeRegistry({ driveId: "drive-9" });
    const { clientSecret } = await registerClient(deps, input);
    expect(created).toEqual([["renown/oidc-client", { parentIdentifier: "drive-9" }]]);
    expect(executed).toHaveLength(1);
    expect(executed[0].id).toBe("doc-1");
    expect(executed[0].actions.map((a) => [a.type, a.input])).toEqual([
      ["SET_CLIENT_INFO", { name: "Speckle" }],
      ["ADD_REDIRECT_URI", { uri: "https://a.example/cb" }],
      ["ADD_REDIRECT_URI", { uri: "https://b.example/cb" }],
      ["ADD_ALLOWED_SUBJECT", { subject: ADDRESS.toLowerCase() }],
      ["ADD_ALLOWED_SUBJECT", { subject: OTHER }],
      ["SET_CLIENT_SECRET_HASH", { hash: await hashSecret(clientSecret!) }],
    ]);
  });

  it("registers a public client with no secret", async () => {
    const { deps, store } = fakeRegistry();
    const { clientSecret } = await registerClient(deps, { ...input, confidential: false });
    expect(clientSecret).toBeNull();
    expect((await store.getClient("doc-1"))?.clientSecretHash).toBeNull();
  });

  it("rejects invalid redirect URIs, subjects or names before writing anything", async () => {
    for (const bad of [
      { redirectUris: ["http://evil.example/cb"] },
      { redirectUris: ["https://a.example/cb#frag"] },
      { allowedSubjects: ["alice"] },
      { name: "   " },
    ]) {
      const { deps, created, executed, store } = fakeRegistry();
      const attempt = registerClient(deps, { ...input, ...bad });
      await expect(attempt).rejects.toBeInstanceOf(ClientRegistryError);
      await expect(attempt).rejects.toMatchObject({ code: "BAD_USER_INPUT" });
      expect(created).toEqual([]);
      expect(executed).toEqual([]);
      expect(await store.getClient("doc-1")).toBeUndefined();
    }
  });

  it("logs a mirror failure without failing the registration", async () => {
    for (const opts of [{ executeThrows: true }, { rejectAction: "ADD_REDIRECT_URI" }]) {
      const { deps, store, logs } = fakeRegistry(opts);
      const { clientId } = await registerClient(deps, input);
      expect(await store.getClient(clientId)).toBeDefined();
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain(clientId);
    }
  });

  it("never logs the plaintext secret or its hash", async () => {
    const { deps, logs } = fakeRegistry({ rejectAction: "SET_CLIENT_SECRET_HASH" });
    const { clientSecret } = await registerClient(deps, input);
    const logged = logs.join("\n");
    expect(logged).not.toContain(clientSecret!);
    expect(logged).not.toContain(await hashSecret(clientSecret!));
  });
});

describe("updateClient", () => {
  async function registered() {
    const registry = fakeRegistry();
    const { clientId } = await registerClient(registry.deps, input);
    registry.executed.length = 0;
    return { ...registry, clientId };
  }

  it("applies removals and additions, normalizing subjects, and mirrors only the changes", async () => {
    const { deps, store, executed, clientId } = await registered();
    const updated = await updateClient(deps, clientId, {
      name: "Speckle 2",
      removeRedirectUris: ["https://a.example/cb"],
      addRedirectUris: ["https://c.example/cb", "https://b.example/cb"],
      removeAllowedSubjects: [`did:pkh:eip155:10:${OTHER}`],
      addAllowedSubjects: ["0xDEF0000000000000000000000000000000000003"],
      allowAnySubject: true,
      status: "DISABLED",
    });
    const expected = {
      id: clientId,
      name: "Speckle 2",
      redirectUris: ["https://b.example/cb", "https://c.example/cb"],
      allowedSubjects: [ADDRESS.toLowerCase(), "0xdef0000000000000000000000000000000000003"],
      allowAnySubject: true,
      status: "DISABLED",
    };
    expect(updated).toMatchObject(expected);
    expect(await store.getClient(clientId)).toMatchObject(expected);
    expect(executed[0].actions.map((a) => [a.type, a.input])).toEqual([
      ["SET_CLIENT_INFO", { name: "Speckle 2" }],
      ["REMOVE_REDIRECT_URI", { uri: "https://a.example/cb" }],
      ["ADD_REDIRECT_URI", { uri: "https://c.example/cb" }],
      ["REMOVE_ALLOWED_SUBJECT", { subject: OTHER }],
      ["ADD_ALLOWED_SUBJECT", { subject: "0xdef0000000000000000000000000000000000003" }],
      ["SET_ALLOW_ANY_SUBJECT", { allow: true }],
      ["SET_STATUS", { status: "DISABLED" }],
    ]);
  });

  it("is a no-op (no write, no mirror) when nothing changes", async () => {
    const { deps, executed, clientId } = await registered();
    const before = await deps.store.getClient(clientId);
    expect(await updateClient(deps, clientId, { name: "Speckle", status: "ACTIVE" })).toEqual(before);
    expect(executed).toEqual([]);
  });

  it("rejects invalid input and unknown clients", async () => {
    const { deps, store, clientId } = await registered();
    const before = await store.getClient(clientId);
    await expect(updateClient(deps, clientId, { addRedirectUris: ["ftp://x/cb"] })).rejects.toMatchObject({
      code: "BAD_USER_INPUT",
    });
    await expect(updateClient(deps, clientId, { addAllowedSubjects: ["nope"] })).rejects.toMatchObject({
      code: "BAD_USER_INPUT",
    });
    expect(await store.getClient(clientId)).toEqual(before);
    await expect(updateClient(deps, "missing", { name: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("rotateClientSecret", () => {
  it("replaces the stored hash, returns the new secret once and mirrors the hash", async () => {
    const { deps, store, executed } = fakeRegistry();
    const { clientId, clientSecret: first } = await registerClient(deps, input);
    const rotated = await rotateClientSecret(deps, clientId, true);
    expect(rotated.clientId).toBe(clientId);
    expect(rotated.clientSecret).not.toBe(first);
    const hash = await hashSecret(rotated.clientSecret!);
    expect((await store.getClient(clientId))?.clientSecretHash).toBe(hash);
    expect(executed.at(-1)!.actions.map((a) => [a.type, a.input])).toEqual([["SET_CLIENT_SECRET_HASH", { hash }]]);
  });

  it("makes a client public when confidential is false", async () => {
    const { deps, store } = fakeRegistry();
    const { clientId } = await registerClient(deps, input);
    expect(await rotateClientSecret(deps, clientId, false)).toEqual({ clientId, clientSecret: null });
    expect((await store.getClient(clientId))?.clientSecretHash).toBeNull();
  });

  it("rejects an unknown client", async () => {
    const { deps } = fakeRegistry();
    await expect(rotateClientSecret(deps, "missing", true)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
