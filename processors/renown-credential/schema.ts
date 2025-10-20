import type { ColumnType } from "kysely";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface RenownCredential {
  document_id: string;
  context: string; // JSON array
  credential_id: string | null;
  type: string; // JSON array
  issuer: string;
  issuance_date: Timestamp;
  credential_subject: string; // JSON object
  expiration_date: Timestamp | null;
  credential_status_id: string | null;
  credential_status_type: string | null;
  credential_status_purpose: string | null;
  credential_status_list_index: string | null;
  credential_status_list_credential: string | null;
  jwt: string | null;
  revoked: boolean;
  revoked_at: Timestamp | null;
  revocation_reason: string | null;
  created_at: Generated<Timestamp | null>;
  updated_at: Generated<Timestamp | null>;
}

export interface DB {
  renown_credential: RenownCredential;
}
