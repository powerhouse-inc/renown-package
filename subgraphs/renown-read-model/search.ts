import { GraphQLError } from "graphql";
import { sql } from "kysely";
import type { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";

export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_QUERY = 40;
export const SEARCH_DEFAULT_LIMIT = 20;
export const SEARCH_MAX_LIMIT = 50;
/** Longest handle the model allows (HANDLE_RE: 2-30 characters). */
const CURSOR_MAX_HANDLE = 30;
const CURSOR_MAX_DOCUMENT_ID = 255;

export interface UserSearchArgs {
  query: string;
  limit?: number | null;
  after?: string | null;
}

/** Keyset position: the last item's LOWER(handle) (null sorts last) and document id. */
export interface UserSearchCursor {
  handle: string | null;
  documentId: string;
}

export interface ParsedUserSearch {
  /** LIKE pattern: the trimmed query with \, % and _ escaped, plus a trailing %. */
  pattern: string;
  limit: number;
  after: UserSearchCursor | undefined;
}

function badInput(field: string, message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT", field } });
}

/** `value` as a prefix LIKE pattern; the escape character is the backslash. */
export function likePrefix(value: string): string {
  return `${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function encodeSearchCursor(cursor: UserSearchCursor): string {
  return Buffer.from(JSON.stringify({ h: cursor.handle, d: cursor.documentId })).toString("base64url");
}

export function decodeSearchCursor(raw: string): UserSearchCursor {
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as { h?: unknown; d?: unknown };
    if ((typeof parsed.h !== "string" && parsed.h !== null) || typeof parsed.d !== "string") {
      throw new Error("malformed cursor");
    }
    if (
      (parsed.h !== null && (parsed.h.length > CURSOR_MAX_HANDLE || parsed.h.includes("\u0000"))) ||
      parsed.d.length > CURSOR_MAX_DOCUMENT_ID ||
      parsed.d.includes("\u0000")
    ) {
      throw new Error("malformed cursor");
    }
    return { handle: parsed.h, documentId: parsed.d };
  } catch {
    throw badInput("after", "after is not a cursor from renownUserSearch");
  }
}

/**
 * Validates renownUserSearch arguments.
 * @throws {GraphQLError} BAD_USER_INPUT (extensions.field) for a query outside
 * 2-40 characters after trimming, a limit outside 1-50, or a foreign cursor.
 */
export function parseUserSearch(args: UserSearchArgs): ParsedUserSearch {
  const query = args.query.trim();
  const length = Array.from(query).length;
  if (query.includes("\u0000") || length < SEARCH_MIN_QUERY || length > SEARCH_MAX_QUERY) {
    throw badInput("query", `query must be ${SEARCH_MIN_QUERY}-${SEARCH_MAX_QUERY} characters`);
  }
  const limit = args.limit ?? SEARCH_DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_MAX_LIMIT) {
    throw badInput("limit", `limit must be an integer from 1 to ${SEARCH_MAX_LIMIT}`);
  }
  return {
    pattern: likePrefix(query),
    limit,
    after: args.after != null ? decodeSearchCursor(args.after) : undefined,
  };
}

type UserQueryBuilder = ReturnType<typeof RenownUserProcessor.query<RenownUserDB>>;

/**
 * Listed profiles whose handle or display name starts with the query
 * (case-insensitively), ordered by LOWER(handle) (profiles without a handle
 * last) then document id, byte-wise ("C" collation) so the keyset cursor
 * never depends on the database locale. Fetches one row more than the page
 * to know whether a next page exists.
 */
export async function searchListedUsers(db: UserQueryBuilder, search: ParsedUserSearch) {
  const handleKey = sql<string | null>`LOWER(renown_user.handle) COLLATE "C"`;
  const idKey = sql<string>`renown_user.document_id COLLATE "C"`;
  let query = db
    .selectFrom("renown_user")
    .selectAll()
    .select(sql<string | null>`LOWER(renown_user.handle)`.as("sort_handle"))
    .where("renown_user.listed", "=", true)
    .where(
      sql<boolean>`(LOWER(renown_user.handle) LIKE LOWER(${search.pattern}) ESCAPE '\\' OR LOWER(renown_user.display_name) LIKE LOWER(${search.pattern}) ESCAPE '\\')`,
    );
  const after = search.after;
  if (after) {
    query =
      after.handle === null
        ? query.where(sql<boolean>`(renown_user.handle IS NULL AND ${idKey} > ${after.documentId})`)
        : query.where(
            sql<boolean>`(${handleKey} > ${after.handle} OR (${handleKey} = ${after.handle} AND ${idKey} > ${after.documentId}) OR renown_user.handle IS NULL)`,
          );
  }
  const rows = await query
    .orderBy(sql`${handleKey} ASC NULLS LAST`)
    .orderBy(sql`${idKey} ASC`)
    .limit(search.limit + 1)
    .execute();
  const page = rows.slice(0, search.limit);
  const last = page.at(-1);
  const next =
    rows.length > search.limit && last
      ? encodeSearchCursor({ handle: last.sort_handle, documentId: last.document_id })
      : null;
  return { rows: page, next };
}
