import { RelationalDbProcessor } from "document-drive/processors/relational";
import { type InternalTransmitterUpdate } from "document-drive/server/listener/transmitter/internal";
import { up } from "./migrations.js";
import { type DB } from "./schema.js";

export class RenownCredentialProcessor extends RelationalDbProcessor<DB> {
  static override getNamespace(driveId: string): string {
    // Default namespace: `${this.name}_${driveId.replaceAll("-", "_")}`
    return super.getNamespace(driveId);
  }

  override async initAndUpgrade(): Promise<void> {
    await up(this.relationalDb);
  }

  override async onStrands(
    strands: InternalTransmitterUpdate[]
  ): Promise<void> {
    if (strands.length === 0) {
      return;
    }

    for (const strand of strands) {
      if (strand.operations.length === 0) {
        continue;
      }

      const documentId = strand.documentId;

      // Ensure the Credential exists in the database
      const existingCredential = await this.relationalDb
        .selectFrom("renown_credential")
        .select(["document_id"])
        .where("document_id", "=", documentId)
        .executeTakeFirst();

      // Process each operation
      for (const operation of strand.operations) {
        switch (operation.action.type) {
          case "INIT": {
            // INIT operation now only receives JWT, all fields are extracted by the reducer
            // Access the document state to get the extracted fields
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const state = (strand.state)?.global as
              | {
                  vcPayload?: string;
                  context?: string[];
                  id?: string;
                  type?: string[];
                  issuer?: string;
                  issuanceDate?: string;
                  credentialSubject?: string;
                  expirationDate?: string;
                  credentialStatus?: {
                    id: string;
                    type: string;
                    statusPurpose: string;
                    statusListIndex: string;
                    statusListCredential: string;
                  } | null;
                  jwt?: string;
                  jwtPayload?: string;
                  jwtVerified?: boolean;
                  revoked?: boolean;
                  revokedAt?: string;
                  revocationReason?: string;
                }
              | undefined;

            if (state && !existingCredential) {
              await this.relationalDb
                .insertInto("renown_credential")
                .values({
                  document_id: documentId,
                  jwt: state.jwt || null,
                  jwt_verified: state.jwtVerified || false,
                  vc_payload: state.vcPayload || null,
                  context: state.context ? JSON.stringify(state.context) : null,
                  credential_id: state.id || null,
                  type: state.type ? JSON.stringify(state.type) : null,
                  issuer: state.issuer || null,
                  issuance_date: state.issuanceDate
                    ? new Date(state.issuanceDate)
                    : null,
                  credential_subject: state.credentialSubject || null,
                  expiration_date: state.expirationDate
                    ? new Date(state.expirationDate)
                    : null,
                  credential_status_id: state.credentialStatus?.id || null,
                  credential_status_type: state.credentialStatus?.type || null,
                  credential_status_purpose:
                    state.credentialStatus?.statusPurpose || null,
                  credential_status_list_index:
                    state.credentialStatus?.statusListIndex || null,
                  credential_status_list_credential:
                    state.credentialStatus?.statusListCredential || null,
                  revoked: state.revoked || false,
                  revoked_at: state.revokedAt ? new Date(state.revokedAt) : null,
                  revocation_reason: state.revocationReason || null,
                  created_at: new Date(),
                  updated_at: new Date(),
                })
                .execute();
            }
            break;
          }
          case "UPDATE_CREDENTIAL_SUBJECT": {
            // Access the updated state to get the synced vcPayload
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
            const state = (strand.state)?.global as
              | {
                  vcPayload?: string;
                  credentialSubject?: string;
                }
              | undefined;

            if (state && existingCredential) {
              await this.relationalDb
                .updateTable("renown_credential")
                .set({
                  credential_subject: state.credentialSubject || null,
                  vc_payload: state.vcPayload || null, // Sync vcPayload with updated credentialSubject
                  jwt: null, // Clear JWT when content changes
                  jwt_verified: false, // Mark as unverified since content changed
                  updated_at: new Date(),
                })
                .where("document_id", "=", documentId)
                .execute();
            }
            break;
          }
          case "SET_JWT": {
            const input = operation.action.input as { jwt: string } | undefined;
            if (input && existingCredential) {
              await this.relationalDb
                .updateTable("renown_credential")
                .set({
                  jwt: input.jwt,
                  updated_at: new Date(),
                })
                .where("document_id", "=", documentId)
                .execute();
            }
            break;
          }
          case "SET_CREDENTIAL_STATUS": {
            const input = operation.action.input as
              | {
                  statusId: string;
                  statusType: string;
                  statusPurpose: string;
                  statusListIndex: string;
                  statusListCredential: string;
                }
              | undefined;
            if (input && existingCredential) {
              await this.relationalDb
                .updateTable("renown_credential")
                .set({
                  credential_status_id: input.statusId,
                  credential_status_type: input.statusType,
                  credential_status_purpose: input.statusPurpose,
                  credential_status_list_index: input.statusListIndex,
                  credential_status_list_credential: input.statusListCredential,
                  updated_at: new Date(),
                })
                .where("document_id", "=", documentId)
                .execute();
            }
            break;
          }
          case "REVOKE": {
            const input = operation.action.input as
              | { revokedAt: string; reason?: string }
              | undefined;
            if (input && existingCredential) {
              await this.relationalDb
                .updateTable("renown_credential")
                .set({
                  revoked: true,
                  revoked_at: new Date(input.revokedAt),
                  revocation_reason: input.reason || null,
                  updated_at: new Date(),
                })
                .where("document_id", "=", documentId)
                .execute();
            }
            break;
          }
        }
      }
    }
  }

  async onDisconnect() {}
}
