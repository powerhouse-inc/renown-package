import type { ColumnType } from "kysely";

export type Generated<T> = T extends ColumnType<infer S, infer I, infer U>
  ? ColumnType<S, I | undefined, U>
  : ColumnType<T, T | undefined, T>;

export type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface RenownCredential {
  document_id: string;
  // W3C VC Fields
  context: string; // JSON array
  credential_id: string;
  type: string; // JSON array
  issuer_id: string;
  issuer_ethereum_address: string;
  issuance_date: Timestamp;
  expiration_date: Timestamp | null;
  credential_subject_id: string | null;
  credential_subject_app: string;
  credential_status_id: string | null;
  credential_status_type: string | null;
  credential_schema_id: string;
  credential_schema_type: string;
  // Proof fields (EIP-712)
  proof_verification_method: string;
  proof_ethereum_address: string;
  proof_created: Timestamp;
  proof_purpose: string;
  proof_type: string;
  proof_value: string; // EIP-712 signature
  proof_eip712_domain: string; // JSON object
  proof_eip712_primary_type: string;
  // Revocation
  revoked: boolean;
  revoked_at: Timestamp | null;
  revocation_reason: string | null;
  created_at: Generated<Timestamp | null>;
  updated_at: Generated<Timestamp | null>;
}

export interface DB {
  renown_credential: RenownCredential;
}
