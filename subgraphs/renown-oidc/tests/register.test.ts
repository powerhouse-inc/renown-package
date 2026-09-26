import { describe, expect, it } from "vitest";
import type { Action } from "document-model";
import { documentToClient, registerClient } from "../register.js";
import { hashSecret } from "../core/crypto.js";

interface Call {
  method: "createEmpty" | "execute";
  args: unknown[];
}

function fakeReactor(opts: { errorOn?: number } = {}) {
  const calls: Call[] = [];
  const reactorClient = {
    createEmpty: (type: string, options?: unknown) => {
      calls.push({ method: "createEmpty", args: [type, options] });
      return Promise.resolve({ header: { id: "doc-1", documentType: type } } as never);
    },
    execute: (id: string, branch: string, actions: Action[]) => {
      calls.push({ method: "execute", args: [id, branch, actions] });
      const global = actions.map((action, index) => ({
        index,
        action,
        error: index === opts.errorOn ? "Invalid redirect URI: http://evil.example" : undefined,
      }));
      return Promise.resolve({ header: { id }, operations: { global } } as never);
    },
  };
  return { calls, reactorClient };
}

const input = {
  name: "Speckle",
  redirectUris: ["https://a.example/cb", "https://b.example/cb"],
  allowedSubjects: ["0xabc"],
  confidential: true,
};

const executedActions = (calls: Call[]) => calls.find((c) => c.method === "execute")!.args[2] as Action[];

describe("registerClient", () => {
  it("creates a renown/oidc-client document and dispatches the actions in order", async () => {
    const { calls, reactorClient } = fakeReactor();
    const result = await registerClient({ reactorClient, driveId: null }, input);
    expect(result.clientId).toBe("doc-1");
    expect(calls.map((c) => c.method)).toEqual(["createEmpty", "execute"]);
    expect(calls[0].args[0]).toBe("renown/oidc-client");
    expect(calls[1].args[0]).toBe("doc-1");
    expect(calls[1].args[1]).toBe("main");
    const actions = executedActions(calls);
    expect(actions.map((a) => a.type)).toEqual([
      "SET_CLIENT_INFO",
      "ADD_REDIRECT_URI",
      "ADD_REDIRECT_URI",
      "ADD_ALLOWED_SUBJECT",
      "SET_CLIENT_SECRET_HASH",
    ]);
    expect(actions.slice(0, 4).map((a) => a.input)).toEqual([
      { name: "Speckle" },
      { uri: "https://a.example/cb" },
      { uri: "https://b.example/cb" },
      { subject: "0xabc" },
    ]);
    expect(typeof (actions[4].input as { hash: unknown }).hash).toBe("string");
  });

  it("returns a 43-char secret for a confidential client whose hash is dispatched", async () => {
    const { calls, reactorClient } = fakeReactor();
    const { clientSecret } = await registerClient({ reactorClient, driveId: null }, input);
    expect(clientSecret).toHaveLength(43);
    const hashAction = executedActions(calls).at(-1)!;
    expect(hashAction.input).toEqual({ hash: await hashSecret(clientSecret!) });
  });

  it("returns a null secret and dispatches a null hash for a public client", async () => {
    const { calls, reactorClient } = fakeReactor();
    const { clientSecret } = await registerClient({ reactorClient, driveId: null }, { ...input, confidential: false });
    expect(clientSecret).toBeNull();
    expect(executedActions(calls).at(-1)!.input).toEqual({ hash: null });
  });

  it("passes parentIdentifier only when a drive id is set", async () => {
    const withoutDrive = fakeReactor();
    await registerClient({ reactorClient: withoutDrive.reactorClient, driveId: null }, input);
    expect(withoutDrive.calls[0].args[1]).toBeUndefined();

    const withDrive = fakeReactor();
    await registerClient({ reactorClient: withDrive.reactorClient, driveId: "drive-9" }, input);
    expect(withDrive.calls[0].args[1]).toEqual({ parentIdentifier: "drive-9" });
  });

  it("throws with the operation's error when an operation failed", async () => {
    const { reactorClient } = fakeReactor({ errorOn: 2 });
    await expect(registerClient({ reactorClient, driveId: null }, input)).rejects.toThrow(
      "Invalid redirect URI: http://evil.example",
    );
  });
});

describe("documentToClient", () => {
  const state = {
    name: "Speckle",
    redirectUris: ["https://a.example/cb"],
    allowedSubjects: ["0xabc"],
    allowAnySubject: false,
    clientSecretHash: "sha256:00",
    status: "ACTIVE",
  };

  it("maps a renown/oidc-client document", () => {
    const doc = { header: { id: "doc-1", documentType: "renown/oidc-client" }, state: { global: state } };
    expect(documentToClient(doc as never)).toEqual({ id: "doc-1", ...state });
  });

  it("returns undefined for another document type", () => {
    const doc = { header: { id: "doc-1", documentType: "powerhouse/renown-user" }, state: { global: state } };
    expect(documentToClient(doc as never)).toBeUndefined();
  });
});
