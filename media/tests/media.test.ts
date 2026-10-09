import type { RouteContext } from "@powerhousedao/shared/processors";
import { describe, expect, it, vi } from "vitest";
import { createRateLimiter } from "../../subgraphs/renown-auth/core/rate-limit.js";
import { avatarProblem } from "../avatar.js";
import type { MediaBackend, ReserveRequest, StoredObject } from "../backend.js";
import { createFilesystemMediaBackend } from "../filesystem-backend.js";
import { sniffImage } from "../image.js";
import { createMediaHandler, MEDIA_CACHE_CONTROL } from "../media-route.js";
import { createS3MediaBackend } from "../s3-backend.js";
import { createUploadHandler } from "../upload-route.js";

const HASH = "c".repeat(64);
const REF = `attachment://v1:${HASH}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const HTML = new TextEncoder().encode("<html><script>");

function ctx(over: Partial<RouteContext> = {}): RouteContext {
  return {
    params: {},
    user: { address: "0xAbC0000000000000000000000000000000000001", chainId: 1, networkId: "eip155", appKey: "did:key:zApp" },
    authEnabled: true,
    rawBody: undefined,
    signal: new AbortController().signal,
    transport: { proto: "https", host: "sb", prefix: "", baseUrl: "https://sb" },
    ...over,
  };
}

function fakeBackend(over: Partial<MediaBackend> = {}): MediaBackend & { reserved: ReserveRequest[] } {
  const reserved: ReserveRequest[] = [];
  return {
    kind: "s3",
    reserved,
    reserve: vi.fn(async (request: ReserveRequest) => {
      reserved.push(request);
      return {
        kind: "reserved" as const,
        ref: REF,
        reservationId: "res-1",
        expiresAtUtc: "2026-10-09T12:15:00.000Z",
        uploadTarget: { method: "PUT" as const, url: "https://s3/put", headers: { "content-type": request.mimeType }, expiresAtUtc: "x" },
      };
    }),
    inspect: vi.fn(async () => null),
    serve: vi.fn(async () => ({ kind: "redirect" as const, url: "https://s3/get?sig" })),
    ...over,
  };
}

function post(body: unknown): Request {
  return new Request("https://sb/api/@powerhousedao/renown-package/media/uploads", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const VALID = { purpose: "avatar", mimeType: "image/webp", sizeBytes: 20_000, sha256: HASH };

describe("sniffImage", () => {
  it("recognises PNG, JPEG and WebP signatures and nothing else", () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(JPEG)).toBe("image/jpeg");
    expect(sniffImage(WEBP)).toBe("image/webp");
    expect(sniffImage(HTML)).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("POST media/uploads", () => {
  it("reserves an avatar for a bearer and returns the upload target", async () => {
    const backend = fakeBackend();
    const res = await createUploadHandler({ backend: () => backend })(post(VALID), ctx());
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      ref: REF,
      reservationId: "res-1",
      expiresAtUtc: "2026-10-09T12:15:00.000Z",
      uploadTarget: { method: "PUT", url: "https://s3/put", headers: { "content-type": "image/webp" }, expiresAtUtc: "x" },
    });
    expect(backend.reserved).toEqual([
      { sha256: HASH, mimeType: "image/webp", sizeBytes: 20_000, extension: "webp", fileName: `avatar-${HASH.slice(0, 12)}.webp` },
    ]);
  });

  it("answers 200 with the ref when the bytes are already stored", async () => {
    const backend = fakeBackend({ reserve: vi.fn(async () => ({ kind: "deduped" as const, ref: REF })) });
    const res = await createUploadHandler({ backend: () => backend })(post(VALID), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ref: REF, deduped: true });
  });

  it.each([
    ["no bearer", VALID, { user: undefined }, 401, "UNAUTHENTICATED"],
    ["a non-JSON body", "nope", {}, 400, "INVALID_UPLOAD"],
    ["an unknown purpose", { ...VALID, purpose: "banner" }, {}, 400, "INVALID_UPLOAD"],
    ["an SVG", { ...VALID, mimeType: "image/svg+xml" }, {}, 415, "UNSUPPORTED_TYPE"],
    ["a fractional size", { ...VALID, sizeBytes: 1.5 }, {}, 400, "INVALID_UPLOAD"],
    ["a zero size", { ...VALID, sizeBytes: 0 }, {}, 400, "INVALID_UPLOAD"],
    ["2 MB + 1 byte", { ...VALID, sizeBytes: 2 * 1024 * 1024 + 1 }, {}, 413, "TOO_LARGE"],
    ["an uppercase hash", { ...VALID, sha256: HASH.toUpperCase() }, {}, 400, "INVALID_UPLOAD"],
  ])("refuses %s", async (_, body, over, status, code) => {
    const backend = fakeBackend();
    const res = await createUploadHandler({ backend: () => backend })(post(body), ctx(over as Partial<RouteContext>));
    expect(res.status).toBe(status);
    expect(await res.json()).toMatchObject({ code });
    expect(backend.reserved).toEqual([]);
  });

  it("accepts the raw reservation body the attachment smoke script sends", async () => {
    const backend = fakeBackend();
    const raw = { mimeType: "image/png", fileName: "smoke.png", extension: "png", clientHash: HASH, sizeBytes: 64 };
    const res = await createUploadHandler({ backend: () => backend })(post(raw), ctx());
    expect(res.status).toBe(201);
    expect(backend.reserved[0]).toMatchObject({ sha256: HASH, mimeType: "image/png", fileName: `avatar-${HASH.slice(0, 12)}.png` });
  });

  it("accepts exactly 2 MB", async () => {
    const res = await createUploadHandler({ backend: () => fakeBackend() })(post({ ...VALID, sizeBytes: 2 * 1024 * 1024 }), ctx());
    expect(res.status).toBe(201);
  });

  it("is unavailable without a media backend", async () => {
    const res = await createUploadHandler({ backend: () => null })(post(VALID), ctx());
    expect(res.status).toBe(503);
  });

  it("rate limits per identity, not per request", async () => {
    const handler = createUploadHandler({ backend: () => fakeBackend(), limiter: createRateLimiter(2, 3_600_000) });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await handler(post(VALID), ctx())).status);
    const other = ctx({ user: { address: "0x0000000000000000000000000000000000000002", chainId: 1, networkId: "eip155", appKey: "did:key:z2" } });
    statuses.push((await handler(post(VALID), other)).status);
    expect(statuses).toEqual([201, 201, 429, 201]);
  });
});

describe("GET media/:documentId/:field", () => {
  const fields = { avatar: async (id: string) => (id === "doc-1" ? REF : id === "doc-junk" ? "https://x" : null) };
  const get = (handler: ReturnType<typeof createMediaHandler>, params: Record<string, string>) =>
    handler(new Request("https://sb/x"), ctx({ params, user: undefined, authEnabled: false }));

  it("302s to a presigned URL with the public cache policy", async () => {
    const res = await get(createMediaHandler({ backend: () => fakeBackend(), fields }), { documentId: "doc-1", field: "avatar" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://s3/get?sig");
    expect(res.headers.get("cache-control")).toBe(MEDIA_CACHE_CONTROL);
  });

  it("streams the bytes on a filesystem backend", async () => {
    const body = new Blob([PNG]).stream();
    const backend = fakeBackend({ serve: vi.fn(async () => ({ kind: "stream" as const, mimeType: "image/png", sizeBytes: PNG.length, body })) });
    const res = await get(createMediaHandler({ backend: () => backend, fields }), { documentId: "doc-1", field: "avatar" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("refuses to stream a non-image type, and sandboxes streamed images", async () => {
    const html = fakeBackend({ serve: vi.fn(async () => ({ kind: "stream" as const, mimeType: "text/html", sizeBytes: 1, body: new Blob(["x"]).stream() })) });
    expect((await get(createMediaHandler({ backend: () => html, fields }), { documentId: "doc-1", field: "avatar" })).status).toBe(404);
    const png = fakeBackend({ serve: vi.fn(async () => ({ kind: "stream" as const, mimeType: "image/png", sizeBytes: PNG.length, body: new Blob([PNG]).stream() })) });
    const res = await get(createMediaHandler({ backend: () => png, fields }), { documentId: "doc-1", field: "avatar" });
    expect(res.headers.get("content-security-policy")).toBe("sandbox");
  });

  it.each([
    ["an unknown field", { documentId: "doc-1", field: "constructor" }],
    ["an unset avatar", { documentId: "doc-2", field: "avatar" }],
    ["a stored value that is not a ref", { documentId: "doc-junk", field: "avatar" }],
    ["an oversized id", { documentId: "d".repeat(256), field: "avatar" }],
  ])("404s for %s", async (_, params) => {
    const res = await get(createMediaHandler({ backend: () => fakeBackend(), fields }), params);
    expect(res.status).toBe(404);
  });

  it("404s when nothing is stored or no backend exists", async () => {
    const empty = fakeBackend({ serve: vi.fn(async () => null) });
    expect((await get(createMediaHandler({ backend: () => empty, fields }), { documentId: "doc-1", field: "avatar" })).status).toBe(404);
    expect((await get(createMediaHandler({ backend: () => null, fields }), { documentId: "doc-1", field: "avatar" })).status).toBe(404);
  });
});

describe("avatarProblem", () => {
  const stored = (o: StoredObject) => fakeBackend({ inspect: vi.fn(async () => o) });
  it("accepts a stored image whose bytes match its type", async () => {
    expect(await avatarProblem(REF, stored({ mimeType: "image/png", sizeBytes: 1000, head: PNG }))).toBeNull();
  });
  it.each([
    ["a malformed ref", "attachment://v1:xyz", stored({ mimeType: "image/png", sizeBytes: 1, head: PNG }), /reference/],
    ["a missing object", REF, fakeBackend(), /not uploaded/],
    ["an object over 2 MB", REF, stored({ mimeType: "image/png", sizeBytes: 2 * 1024 * 1024 + 1, head: PNG }), /larger/],
    ["a non-image content type", REF, stored({ mimeType: "text/html", sizeBytes: 10, head: HTML }), /not an image/],
    ["HTML bytes labelled PNG", REF, stored({ mimeType: "image/png", sizeBytes: 10, head: HTML }), /not a PNG/],
    ["JPEG bytes labelled WebP", REF, stored({ mimeType: "image/webp", sizeBytes: 10, head: JPEG }), /is image\/jpeg/],
  ])("rejects %s", async (_, ref, backend, message) => {
    expect(await avatarProblem(ref, backend)).toMatch(message);
  });
});

describe("S3 media backend", () => {
  const config = {
    endpoint: "https://nbg1.your-objectstorage.com", region: "nbg1", bucket: "renown-staging-attachments",
    accessKeyId: "k", secretAccessKey: "s", prefix: "attachments", forcePathStyle: true,
    uploadTtlSeconds: 900, downloadTtlSeconds: 300,
  };
  function setup(head: () => Promise<unknown>) {
    const presign = vi.fn(async (_client: object, command: object) => `https://signed/${(command as { constructor: { name: string } }).constructor.name}`);
    const primitives = {
      client: {},
      presign,
      headObject: vi.fn(head),
      createDownloadTarget: vi.fn(async () => ({ url: "https://signed/get" })),
    };
    const reserve = vi.fn(async (_o: unknown, send: (h: unknown) => Promise<unknown>) =>
      send({ ref: REF, reservationId: "res-9", expiresAtUtc: "2026-10-09T12:15:00.000Z" }),
    );
    const fetchImpl = vi.fn(async () => new Response(PNG, { status: 206 }));
    const backend = createS3MediaBackend({
      attachments: { reserve } as never,
      config,
      primitives: primitives as never,
      fetch: fetchImpl as never,
      now: () => new Date("2026-10-09T12:00:00.000Z"),
    });
    return { backend, presign, primitives, reserve, fetchImpl };
  }

  it("presigns a PUT that pins the exact length, type and checksum", async () => {
    const { backend, presign } = setup(async () => ({}));
    const result = await backend.reserve({ sha256: HASH, mimeType: "image/webp", sizeBytes: 1234, extension: "webp", fileName: "a.webp" });
    const command = presign.mock.calls[0][1] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Bucket: "renown-staging-attachments",
      Key: `attachments/cc/cc/${HASH}`,
      ContentType: "image/webp",
      ContentLength: 1234,
    });
    expect(command.input.ChecksumSHA256).toBe(Buffer.from(HASH, "hex").toString("base64"));
    expect(result).toEqual({
      kind: "reserved",
      ref: REF,
      reservationId: "res-9",
      expiresAtUtc: "2026-10-09T12:15:00.000Z",
      uploadTarget: {
        method: "PUT",
        url: "https://signed/PutObjectCommand",
        headers: { "content-type": "image/webp", "x-amz-checksum-sha256": Buffer.from(HASH, "hex").toString("base64") },
        expiresAtUtc: "2026-10-09T12:15:00.000Z",
      },
    });
  });

  it("signs content-length, content-type and the checksum with the real presigner", async () => {
    const real = createS3MediaBackend({
      attachments: { reserve: async (_o: unknown, send: (h: unknown) => Promise<unknown>) => send({ ref: REF, reservationId: "r", expiresAtUtc: "t" }) } as never,
      config,
    });
    const result = await real.reserve({ sha256: HASH, mimeType: "image/webp", sizeBytes: 1234, extension: "webp", fileName: "a.webp" });
    if (result.kind !== "reserved" || !result.uploadTarget) throw new Error("expected an upload target");
    const signed = new URL(result.uploadTarget.url).searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
    expect(signed).toEqual(expect.arrayContaining(["content-length", "content-type", "x-amz-checksum-sha256"]));
  });

  it("inspects size and type from HEAD and the first bytes from a ranged GET", async () => {
    const { backend, fetchImpl } = setup(async () => ({ ContentLength: 4321, ContentType: "image/png" }));
    expect(await backend.inspect(HASH)).toEqual({ mimeType: "image/png", sizeBytes: 4321, head: PNG });
    expect(fetchImpl).toHaveBeenCalledWith("https://signed/get", { headers: { range: "bytes=0-15" } });
  });

  it("reports a missing object as null and rethrows other storage errors", async () => {
    const missing = setup(async () => Promise.reject(Object.assign(new Error("NotFound"), { name: "NotFound" })));
    expect(await missing.backend.inspect(HASH)).toBeNull();
    const broken = setup(async () => Promise.reject(new Error("socket hang up")));
    await expect(broken.backend.inspect(HASH)).rejects.toThrow("socket hang up");
  });

  it("redirects downloads to a presigned GET", async () => {
    const { backend } = setup(async () => ({}));
    expect(await backend.serve(HASH)).toEqual({ kind: "redirect", url: "https://signed/get" });
  });
});

describe("filesystem media backend", () => {
  it("reserves without an upload target, and reads headers and bytes through download()", async () => {
    const attachments = {
      reserve: vi.fn(async (_o: unknown, send: (h: unknown) => Promise<unknown>) =>
        send({ ref: null, reservationId: "res-2", expiresAtUtc: "t" }),
      ),
      download: vi.fn(async () => ({ header: { mimeType: "image/png", sizeBytes: PNG.length }, body: new Blob([PNG]).stream() })),
    };
    const backend = createFilesystemMediaBackend(attachments as never);
    expect(await backend.reserve({ sha256: HASH, mimeType: "image/png", sizeBytes: 12, extension: "png", fileName: "a.png" })).toEqual({
      kind: "reserved", ref: REF, reservationId: "res-2", expiresAtUtc: "t", uploadTarget: null,
    });
    expect(await backend.inspect(HASH)).toEqual({ mimeType: "image/png", sizeBytes: PNG.length, head: PNG });
    expect(await backend.serve(HASH)).toMatchObject({ kind: "stream", mimeType: "image/png" });
  });

  it("dedups, and treats unknown or pending hashes as not stored", async () => {
    const attachments = {
      reserve: vi.fn(async () => ({ hash: HASH, ref: REF, header: {} })),
      download: vi.fn(async () => Promise.reject(new Error("AttachmentPending"))),
    };
    const backend = createFilesystemMediaBackend(attachments as never);
    expect(await backend.reserve({ sha256: HASH, mimeType: "image/png", sizeBytes: 12, extension: "png", fileName: "a.png" })).toEqual({ kind: "deduped", ref: REF });
    expect(await backend.inspect(HASH)).toBeNull();
    expect(await backend.serve(HASH)).toBeNull();
  });

  it("passes reservation failures through", async () => {
    const attachments = { reserve: vi.fn(async () => Promise.reject(new Error("db down"))), download: vi.fn() };
    await expect(createFilesystemMediaBackend(attachments as never).reserve({ sha256: HASH, mimeType: "image/png", sizeBytes: 1, extension: "png", fileName: "a" })).rejects.toThrow("db down");
  });
});
