import {
  RelationalDbProcessor,
  type RelationalDbProcessorFilter,
  type IRelationalDb,
} from "document-drive";
import { type InternalTransmitterUpdate } from "document-drive";
import { up } from "./migrations.js";
import { type DB } from "./schema.js";

export interface IReactor {
  deleteDocument(documentId: string): Promise<boolean>;
}

export class RenownCredentialProcessor extends RelationalDbProcessor<DB> {
  private reactor?: IReactor;

  constructor(
    namespace: string,
    filter: RelationalDbProcessorFilter,
    relationalDb: IRelationalDb<DB>,
    reactor?: IReactor
  ) {
    super(namespace, filter, relationalDb);
    this.reactor = reactor;
    console.log(
      `[RenownCredentialProcessor] Constructor called - namespace: ${namespace}, has reactor: ${!!reactor}`
    );
  }

  static override getNamespace(driveId: string): string {
    // Default namespace: `${this.name}_${driveId.replaceAll("-", "_")}`
    const namespace = super.getNamespace(driveId);
    console.log(
      `[RenownCredentialProcessor] getNamespace called - driveId: ${driveId}, namespace: ${namespace}`
    );
    return namespace;
  }

  override async initAndUpgrade(): Promise<void> {
    console.log(
      `[RenownCredentialProcessor] initAndUpgrade called - running migrations`
    );
    await up(this.relationalDb);
    console.log(`[RenownCredentialProcessor] initAndUpgrade completed`);
  }

  override async onStrands(
    strands: InternalTransmitterUpdate[]
  ): Promise<void> {
    console.log(
      `[RenownCredentialProcessor] onStrands called with ${strands.length} strands`
    );

    if (strands.length === 0) {
      return;
    }

    for (const strand of strands) {
      if (strand.operations.length === 0) {
        continue;
      }

      const documentId = strand.documentId;
      console.log(
        `[RenownCredentialProcessor] Processing document ${documentId} with ${strand.operations.length} operations`
      );
      console.log(
        `[RenownCredentialProcessor] Strand keys:`,
        Object.keys(strand)
      );
      console.log(`[RenownCredentialProcessor] Has state:`, !!strand.state);
      console.log(
        `[RenownCredentialProcessor] State type:`,
        typeof strand.state,
        strand.state
      );

      // Ensure the Credential exists in the database
      const existingCredential = await this.relationalDb
        .selectFrom("renown_credential")
        .select(["document_id"])
        .where("document_id", "=", documentId)
        .executeTakeFirst();

      // Process each operation
      for (const operation of strand.operations) {
        console.log(
          `[RenownCredentialProcessor] Processing operation: ${operation.action.type}`
        );
        switch (operation.action.type) {
          case "INIT": {
            console.log(
              `[RenownCredentialProcessor] INIT - documentId: ${documentId}, existingCredential: ${!!existingCredential}`
            );
            // INIT operation receives full EIP-712 credential structure
            console.log(`[RenownCredentialProcessor] INIT - Processing state`);

            // State is directly the global state, not wrapped in a .global property
            const state = strand.state as
              | {
                  context?: string[];
                  id?: string;
                  type?: string[];
                  issuer?: {
                    id: string;
                    ethereumAddress: string;
                  };
                  issuanceDate?: string;
                  expirationDate?: string | null;
                  credentialSubject?: {
                    id?: string | null;
                    app: string;
                    name?: string | null;
                  };
                  credentialStatus?: {
                    id: string;
                    type: string;
                  } | null;
                  credentialSchema?: {
                    id: string;
                    type: string;
                  };
                  proof?: {
                    verificationMethod: string;
                    ethereumAddress: string;
                    created: string;
                    proofPurpose: string;
                    type: string;
                    proofValue: string;
                    eip712: {
                      domain: {
                        version: string;
                        chainId: number;
                      };
                      primaryType: string;
                    };
                  };
                  revoked?: boolean;
                  revokedAt?: string | null;
                  revocationReason?: string | null;
                }
              | undefined;

            console.log(`[RenownCredentialProcessor] INIT - Credential ID:`, state?.id);
            console.log(`[RenownCredentialProcessor] INIT - Issuer:`, state?.issuer?.id);

            if (state && !existingCredential) {
              console.log(
                `[RenownCredentialProcessor] INIT - Inserting credential: issuer=${state.issuer?.id}, credentialId=${state.id}`
              );
              await this.relationalDb
                .insertInto("renown_credential")
                .values({
                  document_id: documentId,
                  context: state.context ? JSON.stringify(state.context) : "[]",
                  credential_id: state.id || "",
                  type: state.type ? JSON.stringify(state.type) : "[]",
                  issuer_id: state.issuer?.id || "",
                  issuer_ethereum_address: state.issuer?.ethereumAddress || "",
                  issuance_date: state.issuanceDate
                    ? new Date(state.issuanceDate)
                    : new Date(),
                  expiration_date: state.expirationDate
                    ? new Date(state.expirationDate)
                    : null,
                  credential_subject_id: state.credentialSubject?.id || null,
                  credential_subject_app: state.credentialSubject?.app || "",
                  credential_status_id: state.credentialStatus?.id || null,
                  credential_status_type: state.credentialStatus?.type || null,
                  credential_schema_id: state.credentialSchema?.id || "",
                  credential_schema_type: state.credentialSchema?.type || "",
                  proof_verification_method: state.proof?.verificationMethod || "",
                  proof_ethereum_address: state.proof?.ethereumAddress || "",
                  proof_created: state.proof?.created
                    ? new Date(state.proof.created)
                    : new Date(),
                  proof_purpose: state.proof?.proofPurpose || "",
                  proof_type: state.proof?.type || "",
                  proof_value: state.proof?.proofValue || "",
                  proof_eip712_domain: state.proof?.eip712?.domain
                    ? JSON.stringify(state.proof.eip712.domain)
                    : "{}",
                  proof_eip712_primary_type: state.proof?.eip712?.primaryType || "",
                  revoked: state.revoked || false,
                  revoked_at: state.revokedAt
                    ? new Date(state.revokedAt)
                    : null,
                  revocation_reason: state.revocationReason || null,
                  created_at: new Date(),
                  updated_at: new Date(),
                })
                .execute();
              console.log(
                `[RenownCredentialProcessor] INIT - Credential inserted successfully`
              );
            } else {
              console.log(
                `[RenownCredentialProcessor] INIT - Skipped: state=${!!state}, existingCredential=${!!existingCredential}`
              );
            }
            break;
          }
          case "REVOKE": {
            console.log(
              `[RenownCredentialProcessor] REVOKE - documentId: ${documentId}`
            );
            const input = operation.action.input as
              | { revokedAt: string; reason?: string }
              | undefined;
            if (input && existingCredential) {
              console.log(
                `[RenownCredentialProcessor] REVOKE - Marking as revoked and deleting document`
              );
              // Update the database to mark as revoked
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

              // Delete the credential document using the reactor
              if (this.reactor) {
                try {
                  console.log(
                    `[RenownCredentialProcessor] REVOKE - Calling reactor.deleteDocument`
                  );
                  await this.reactor.deleteDocument(documentId);
                  console.log(
                    `[RenownCredentialProcessor] REVOKE - Document deleted successfully`
                  );
                } catch (error) {
                  // Log error but don't throw - database already updated
                  console.error(
                    `[RenownCredentialProcessor] REVOKE - Failed to delete revoked credential document ${documentId}:`,
                    error
                  );
                }
              } else {
                console.log(
                  `[RenownCredentialProcessor] REVOKE - No reactor available, skipping document deletion`
                );
              }
            } else {
              console.log(
                `[RenownCredentialProcessor] REVOKE - Skipped: input=${!!input}, existingCredential=${!!existingCredential}`
              );
            }
            break;
          }
        }
      }
    }
  }

  async onDisconnect() {}
}
