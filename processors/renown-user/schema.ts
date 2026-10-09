import type { ColumnType } from "kysely";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

/** jsonb column: read as parsed JSON, written as a JSON string. */
export type Json<T> = ColumnType<T, string, string>;

export interface RenownUserLinkRow {
  id: string;
  label: string;
  url: string;
}

export interface RenownUser {
  avatar_ref: string | null;
  bio: string | null;
  created_at: Generated<Timestamp | null>;
  display_name: string | null;
  document_id: string;
  eth_address: string | null;
  handle: string | null;
  links: Generated<Json<RenownUserLinkRow[]>>;
  updated_at: Generated<Timestamp | null>;
  user_image: string | null;
  username: string | null;
}

export interface DB {
  renown_user: RenownUser;
}
