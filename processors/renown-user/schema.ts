import type { ColumnType } from "kysely";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface RenownUser {
  created_at: Generated<Timestamp | null>;
  document_id: string;
  eth_address: string | null;
  updated_at: Generated<Timestamp | null>;
  user_image: string | null;
  username: string | null;
}

export interface DB {
  renown_user: RenownUser;
}
