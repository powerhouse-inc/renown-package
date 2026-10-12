import { createServer, type Server, type Socket } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { guardedRequest, isPublicAddress, NetGuardError, nodeNetDeps, type NetDeps, type PinnedRequest } from "../core/net.js";

function fakeNet(addresses: Record<string, string[]>, status = 200, body = "{}"): NetDeps & { requests: PinnedRequest[] } {
  const requests: PinnedRequest[] = [];
  return {
    requests,
    lookup: (host) =>
      Promise.resolve((addresses[host] ?? []).map((address) => ({ address, family: address.includes(":") ? (6 as const) : (4 as const) }))),
    resolveTxt: () => Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })),
    request: (request) => {
      requests.push(request);
      const bytes = new TextEncoder().encode(body);
      return Promise.resolve({ status, body: bytes.slice(0, request.maxBytes), truncated: bytes.length > request.maxBytes });
    },
  };
}

describe("isPublicAddress", () => {
  it("refuses private, loopback, link-local, CGNAT, ULA, mapped and special ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.5",
      "172.16.3.4",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "100.127.255.254",
      "0.0.0.0",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fd12::1",
      "fc00::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.1.2.3",
      "::ffff:169.254.169.254",
      "::ffff:100.64.0.1",
      "64:ff9b::a00:1",
      "224.0.0.1",
      "ff02::1",
      "fe80::1%eth0",
      "not-an-ip",
      "",
    ]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "100.128.0.1", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe("guardedRequest", () => {
  it("connects only to the vetted public address, with the original host name", async () => {
    const net = fakeNet({ "acme.example": ["93.184.216.34"] });
    expect(await guardedRequest(net, "https://acme.example/.well-known/renown.json", { method: "GET" })).toMatchObject({ status: 200 });
    expect(net.requests[0]).toMatchObject({ address: "93.184.216.34", family: 4, timeoutMs: 5000, maxBytes: 65536 });
    expect(net.requests[0].url.host).toBe("acme.example");
  });

  it("never connects to a private address, an http URL, credentials or an oversized body", async () => {
    const refuse = async (net: ReturnType<typeof fakeNet>, url: string) => {
      await expect(guardedRequest(net, url, { method: "GET" })).rejects.toBeInstanceOf(NetGuardError);
      expect(net.requests).toEqual([]);
    };
    await refuse(fakeNet({ "acme.example": ["10.0.0.1"] }), "https://acme.example/");
    await refuse(fakeNet({ "acme.example": ["93.184.216.34", "127.0.0.1"] }), "https://acme.example/");
    await refuse(fakeNet({ "acme.example": ["::ffff:169.254.169.254"] }), "https://acme.example/");
    await refuse(fakeNet({}), "https://acme.example/");
    await refuse(fakeNet({}), "https://[::ffff:127.0.0.1]/");
    await refuse(fakeNet({}), "https://169.254.169.254/latest/meta-data/");
    await refuse(fakeNet({ "acme.example": ["93.184.216.34"] }), "http://acme.example/");
    await refuse(fakeNet({ "acme.example": ["93.184.216.34"] }), "https://user:pw@acme.example/");
    await refuse(fakeNet({}), "not a url");
    const big = fakeNet({ "acme.example": ["93.184.216.34"] }, 200, "x".repeat(65_537));
    await expect(guardedRequest(big, "https://acme.example/", { method: "GET" })).rejects.toThrow(/larger than 65536/);
  });

  it("does not follow redirects: a 3xx comes back as is", async () => {
    const net = fakeNet({ "acme.example": ["93.184.216.34"] }, 302);
    expect((await guardedRequest(net, "https://acme.example/", { method: "GET" })).status).toBe(302);
    expect(net.requests).toHaveLength(1);
  });
});

describe("the default client", () => {
  let server: Server | undefined;
  const sockets: Socket[] = [];
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.destroy();
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = undefined;
  });

  /** A local TCP listener that records connections and never answers. */
  async function listen(): Promise<{ port: number; connections: () => number }> {
    let connections = 0;
    server = createServer((socket) => {
      connections += 1;
      sockets.push(socket);
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    return { port: address.port, connections: () => connections };
  }

  it("refuses http and non-public IP literals before any DNS lookup or connection", async () => {
    for (const url of ["http://example.com/", "https://127.0.0.1/", "https://[::1]/", "https://169.254.169.254/", "https://[::ffff:a9fe:a9fe]/"]) {
      await expect(guardedRequest(nodeNetDeps, url, { method: "GET" }), url).rejects.toBeInstanceOf(NetGuardError);
    }
  });

  it("connects to the pinned address, never re-resolving the host name, and gives up at the timeout", async () => {
    const { port, connections } = await listen();
    const started = Date.now();
    await expect(
      nodeNetDeps.request({
        // .invalid never resolves: a connection can only come from the pinned address.
        url: new URL(`https://pinned.invalid:${port}/`),
        address: "127.0.0.1",
        family: 4,
        method: "GET",
        headers: {},
        timeoutMs: 200,
        maxBytes: 1024,
      }),
    ).rejects.toThrow(/timeout/);
    expect(connections()).toBe(1);
    expect(Date.now() - started).toBeLessThan(4_000);
  });
});
