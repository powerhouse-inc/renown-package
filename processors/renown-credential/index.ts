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
            const input = operation.action.input as
              | {
                  context?: string[];
                  id?: string;
                  type?: string[];
                  issuer: string;
                  issuanceDate: string;
                  credentialSubject: string;
                  expirationDate?: string;
                }
              | undefined;

            if (input && !existingCredential) {
              await this.relationalDb
                .insertInto("renown_credential")
                .values({
                  document_id: documentId,
                  context: JSON.stringify(
                    input.context || ["https://www.w3.org/2018/credentials/v1"]
                  ),
                  credential_id: input.id || null,
                  type: JSON.stringify(input.type || ["VerifiableCredential"]),
                  issuer: input.issuer,
                  issuance_date: new Date(input.issuanceDate),
                  credential_subject: input.credentialSubject,
                  expiration_date: input.expirationDate
                    ? new Date(input.expirationDate)
                    : null,
                  credential_status_id: null,
                  credential_status_type: null,
                  credential_status_purpose: null,
                  credential_status_list_index: null,
                  credential_status_list_credential: null,
                  jwt: null,
                  revoked: false,
                  revoked_at: null,
                  revocation_reason: null,
                  created_at: new Date(),
                  updated_at: new Date(),
                })
                .execute();
            }
            break;
          }
          case "UPDATE_CREDENTIAL_SUBJECT": {
            const input = operation.action.input as
              | { credentialSubject: string }
              | undefined;
            if (input && existingCredential) {
              await this.relationalDb
                .updateTable("renown_credential")
                .set({
                  credential_subject: input.credentialSubject,
                  jwt: null, // Clear JWT when content changes
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
