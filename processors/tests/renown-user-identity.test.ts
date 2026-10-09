import { PGlite } from "@electric-sql/pglite";
import type { OperationWithContext } from "@powerhousedao/reactor-browser";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RenownUserProcessor } from "../renown-user/index.js";
import { nextLinks } from "../renown-user/links.js";
import { up } from "../renown-user/migrations.js";
import type { DB } from "../renown-user/schema.js";

const FILTER = { branch: ["main"], documentId: ["*"], documentType: [], scope: ["global"] };
const REF = `attachment://v1:${"b".repeat(64)}`;
let root: Kysely<DB>;
let processor: RenownUserProcessor;

beforeAll(async () => {
  root = new Kysely<DB>({ dialect: new PGliteDialect(new PGlite()) });
  await sql`create schema ident`.execute(root);
  await up(root.withSchema("ident") as never);
  await up(root.withSchema("ident") as never); // idempotent on an existing table
  processor = new RenownUserProcessor("ident", FILTER, root.withSchema("ident") as never);
});

afterAll(async () => {
  await root.destroy();
});

let ordinal = 0;
function op(documentId: string, type: string, input: unknown, error?: string): OperationWithContext {
  ordinal += 1;
  return {
    operation: { index: ordinal, action: { type, input }, ...(error ? { error } : {}) },
    context: { documentId, documentType: "powerhouse/renown-user", scope: "global", branch: "main", ordinal },
  } as unknown as OperationWithContext;
}

function row(documentId: string) {
  return root.withSchema("ident").selectFrom("renown_user").selectAll().where("document_id", "=", documentId).executeTakeFirstOrThrow();
}

describe("renown-user read model identity columns", () => {
  it("indexes display name, handle, bio, avatar and links, and clears them", async () => {
    await processor.onOperations([
      op("u1", "SET_DISPLAY_NAME", { displayName: "Frank" }),
      op("u1", "SET_HANDLE", { handle: "frank" }),
      op("u1", "SET_BIO", { bio: "Hi" }),
      op("u1", "SET_AVATAR", { avatar: REF }),
      op("u1", "ADD_LINK", { id: "a", label: "Site", url: "https://a.example" }),
      op("u1", "ADD_LINK", { id: "b", label: "Code", url: "https://b.example" }),
      op("u1", "UPDATE_LINK", { id: "b", label: "Git" }),
      op("u1", "REORDER_LINKS", { linkIds: ["b"] }),
      op("u1", "ADD_LINK", { id: "c", label: "Bad", url: "javascript:x" }, "InvalidLinkError"),
    ]);
    expect(await row("u1")).toMatchObject({
      display_name: "Frank",
      handle: "frank",
      bio: "Hi",
      avatar_ref: REF,
      links: [
        { id: "b", label: "Git", url: "https://b.example" },
        { id: "a", label: "Site", url: "https://a.example" },
      ],
    });

    await processor.onOperations([
      op("u1", "REMOVE_LINK", { id: "a" }),
      op("u1", "SET_DISPLAY_NAME", { displayName: null }),
      op("u1", "SET_HANDLE", { handle: null }),
      op("u1", "SET_BIO", { bio: null }),
      op("u1", "SET_AVATAR", { avatar: null }),
    ]);
    expect(await row("u1")).toMatchObject({
      display_name: null,
      handle: null,
      bio: null,
      avatar_ref: null,
      links: [{ id: "b", label: "Git", url: "https://b.example" }],
    });
  });

  it("indexes a raced duplicate handle as no handle instead of wedging", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await processor.onOperations([
      op("u2", "SET_HANDLE", { handle: "taken" }),
      op("u3", "SET_HANDLE", { handle: "taken" }),
      op("u3", "SET_DISPLAY_NAME", { displayName: "Still indexed" }),
    ]);
    expect((await row("u2")).handle).toBe("taken");
    expect(await row("u3")).toMatchObject({ handle: null, display_name: "Still indexed" });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/handle of u3 is already taken/));
    log.mockRestore();
  });

  it("rejects a second handle differing only in case at the index", async () => {
    await expect(
      root.withSchema("ident").insertInto("renown_user").values({ document_id: "u4", username: null, eth_address: null, user_image: null, handle: "TAKEN" }).execute(),
    ).rejects.toMatchObject({ code: "23505" });
  });
});

describe("nextLinks", () => {
  const a = { id: "a", label: "A", url: "https://a.example" };
  const b = { id: "b", label: "B", url: "https://b.example" };
  it("mirrors the reducer for each link operation", () => {
    expect(nextLinks([a], "ADD_LINK", b)).toEqual([a, b]);
    expect(nextLinks([a, b], "UPDATE_LINK", { id: "a", url: "https://c.example" })).toEqual([{ ...a, url: "https://c.example" }, b]);
    expect(nextLinks([a, b], "REMOVE_LINK", { id: "a" })).toEqual([b]);
    expect(nextLinks([a, b], "REORDER_LINKS", { linkIds: ["b", "b", "zz"] })).toEqual([b, a]);
    expect(nextLinks([a, b], "REORDER_LINKS", {})).toEqual([a, b]);
    expect(nextLinks([a], "SET_USERNAME", { username: "x" })).toBeUndefined();
  });
});
