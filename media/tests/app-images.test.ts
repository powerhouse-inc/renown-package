import { PGlite } from "@electric-sql/pglite";
import type { RouteContext } from "@powerhousedao/shared/processors";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, describe, expect, it, vi } from "vitest";
import { KyselyStatsIndex } from "../../subgraphs/renown-stats/store/kysely.js";
import { appImageLookup, STATS_NAMESPACE } from "../../subgraphs/renown-stats/store/media-lookup.js";
import { migrate } from "../../subgraphs/renown-stats/store/migrations.js";
import type { StatsDB } from "../../subgraphs/renown-stats/store/types.js";
import type { MediaBackend, ReserveRequest, StoredObject } from "../backend.js";
import { UPLOAD_LIMITS } from "../image.js";
import { storedImageProblem } from "../stored-image.js";
import { createUploadHandler } from "../upload-route.js";

const HASH = "e".repeat(64);
const REF = `attachment://v1:${HASH}`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const MIB = 1024 * 1024;

function ctx(): RouteContext {
  return {
    params: {},
    user: { address: "0xAbC0000000000000000000000000000000000001", chainId: 1, networkId: "eip155", appKey: "did:key:zApp" },
    authEnabled: true,
    rawBody: undefined,
    signal: new AbortController().signal,
    transport: { proto: "https", host: "sb", prefix: "", baseUrl: "https://sb" },
  };
}

function backend(stored: StoredObject | null = null): MediaBackend & { reserved: ReserveRequest[] } {
  const reserved: ReserveRequest[] = [];
  return {
    kind: "s3",
    reserved,
    reserve: vi.fn(async (request: ReserveRequest) => {
      reserved.push(request);
      return { kind: "reserved" as const, ref: REF, reservationId: "r", expiresAtUtc: "t", uploadTarget: null };
    }),
    inspect: vi.fn(async () => stored),
    serve: vi.fn(async () => null),
  };
}

function post(body: unknown): Request {
  return new Request("https://sb/api/@powerhousedao/renown-package/media/uploads", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const opened: Kysely<StatsDB>[] = [];
afterAll(async () => {
  await Promise.all(opened.map((db) => db.destroy()));
});

describe("app image uploads", () => {
  it("caps logos at 1 MiB and covers at 2 MiB", async () => {
    expect(UPLOAD_LIMITS).toEqual({ avatar: 2 * MIB, logo: MIB, cover: 2 * MIB });
    const status = async (purpose: string, sizeBytes: number) =>
      (await createUploadHandler({ backend: () => backend() })(
        post({ purpose, mimeType: "image/webp", sizeBytes, sha256: HASH }),
        ctx(),
      )).status;
    expect(await status("logo", MIB)).toBe(201);
    expect(await status("logo", MIB + 1)).toBe(413);
    expect(await status("cover", 2 * MIB)).toBe(201);
    expect(await status("cover", 2 * MIB + 1)).toBe(413);
  });

  it("names the reservation after its purpose", async () => {
    const b = backend();
    await createUploadHandler({ backend: () => b })(
      post({ purpose: "cover", mimeType: "image/png", sizeBytes: 10, sha256: HASH }),
      ctx(),
    );
    expect(b.reserved[0]).toMatchObject({ fileName: `cover-${HASH.slice(0, 12)}.png`, extension: "png" });
  });

  it("lists every purpose when refusing an unknown one", async () => {
    const res = await createUploadHandler({ backend: () => backend() })(
      post({ purpose: "banner", mimeType: "image/png", sizeBytes: 10, sha256: HASH }),
      ctx(),
    );
    expect(await res.json()).toMatchObject({ code: "INVALID_UPLOAD", error: "purpose must be one of: avatar, logo, cover" });
  });
});

describe("storedImageProblem", () => {
  const png = (sizeBytes: number): StoredObject => ({ mimeType: "image/png", sizeBytes, head: PNG });

  it("applies the purpose's size cap to the stored object", async () => {
    expect(await storedImageProblem(REF, backend(png(MIB)), "logo")).toBeNull();
    expect(await storedImageProblem(REF, backend(png(MIB + 1)), "logo")).toBe(`larger than ${MIB} bytes`);
    expect(await storedImageProblem(REF, backend(png(MIB + 1)), "cover")).toBeNull();
    expect(await storedImageProblem(REF, backend(png(2 * MIB + 1)), "cover")).toBe(`larger than ${2 * MIB} bytes`);
  });

  it("rejects malformed refs, missing objects and lying bytes", async () => {
    expect(await storedImageProblem("https://x", backend(png(1)), "logo")).toMatch(/reference/);
    expect(await storedImageProblem(REF, backend(null), "logo")).toMatch(/not uploaded/);
    const html = { mimeType: "image/png", sizeBytes: 10, head: new TextEncoder().encode("<html>") };
    expect(await storedImageProblem(REF, backend(html), "cover")).toMatch(/not a PNG/);
  });
});

describe("appImageLookup", () => {
  async function statsDb(): Promise<Kysely<StatsDB>> {
    const root = new Kysely<StatsDB>({ dialect: new PGliteDialect(new PGlite()) });
    opened.push(root);
    await sql`create schema ${sql.id(STATS_NAMESPACE)}`.execute(root);
    await migrate(root.withSchema(STATS_NAMESPACE));
    return root;
  }

  it("reads the stored logo and cover of a profile document", async () => {
    const root = await statsDb();
    await new KyselyStatsIndex(root.withSchema(STATS_NAMESPACE)).setAppImages("doc-1", { logoRef: REF }, new Date());
    const db = { queryNamespace: (namespace: string) => root.withSchema(namespace) };
    expect(await appImageLookup(db, "logo")("doc-1")).toBe(REF);
    expect(await appImageLookup(db, "cover")("doc-1")).toBeNull();
    expect(await appImageLookup(db, "logo")("doc-2")).toBeNull();
  });

  it("answers null when the namespace or its table does not exist yet", async () => {
    const root = new Kysely<StatsDB>({ dialect: new PGliteDialect(new PGlite()) });
    opened.push(root);
    const db = { queryNamespace: (namespace: string) => root.withSchema(namespace) };
    // No schema at all (3F000), then a schema without the table (42P01).
    expect(await appImageLookup(db, "logo")("doc-1")).toBeNull();
    await sql`create schema ${sql.id(STATS_NAMESPACE)}`.execute(root);
    expect(await appImageLookup(db, "logo")("doc-1")).toBeNull();
  });

  it("rethrows any other failure", async () => {
    const broken = {
      queryNamespace: () => {
        throw new Error("connection reset");
      },
    };
    await expect(appImageLookup(broken, "logo")("doc-1")).rejects.toThrow("connection reset");
  });
});
