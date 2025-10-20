import type { ColumnType } from "kysely";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface RenownCredential {
  document_id: string;
  vc_payload: string | null; // Complete VC JSON object
  context: string | null; // JSON array - extracted for convenience
  credential_id: string | null;
  type: string | null; // JSON array - extracted for convenience
  issuer: string | null;
  issuance_date: Timestamp | null;
  credential_subject: string | null; // JSON object - extracted for convenience
  expiration_date: Timestamp | null;
  credential_status_id: string | null;
  credential_status_type: string | null;
  credential_status_purpose: string | null;
  credential_status_list_index: string | null;
  credential_status_list_credential: string | null;
  jwt: string | null;
  jwt_payload: string | null; // Complete JWT payload JSON object
  jwt_verified: boolean;
  revoked: boolean;
  revoked_at: Timestamp | null;
  revocation_reason: string | null;
  created_at: Generated<Timestamp | null>;
  updated_at: Generated<Timestamp | null>;
}

export interface DB {
  renown_credential: RenownCredential;
}
