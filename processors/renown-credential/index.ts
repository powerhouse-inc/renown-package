import {
  RelationalDbProcessor,
  type OperationWithContext,
  type ProcessorFilter,
  type IRelationalDb,
} from "@powerhousedao/reactor-browser";
import { up } from "./migrations.js";
import { type DB } from "./schema.js";
import type {
  RenownCredentialState,
  RevokeInput,
} from "../../document-models/renown-credential/index.js";

export interface IReactor {
  deleteDocument(documentId: string): Promise<boolean>;
}

export class RenownCredentialProcessor extends RelationalDbProcessor<DB> {
  private reactor?: IReactor;

  constructor(
    namespace: string,
    filter: ProcessorFilter,
    relationalDb: IRelationalDb<DB>,
    reactor?: IReactor,
  ) {
    super(namespace, filter, relationalDb);
    this.reactor = reactor;
  }

  static override getNamespace(driveId: string): string {
    return super.getNamespace(driveId);
  }

  override async initAndUpgrade(): Promise<void> {
    await up(this.relationalDb);
  }

  override async onOperations(
    operations: OperationWithContext[],
  ): Promise<void> {
    if (operations.length === 0) {
      return;
    }

    for (const { operation, context } of operations) {
      const documentId = context.documentId;

      const existingCredential = await this.relationalDb
        .selectFrom("renown_credential")
        .select(["document_id"])
        .where("document_id", "=", documentId)
        .executeTakeFirst();

      switch (operation.action.type) {
        case "INIT": {
          // Prefer action.input (the actual INIT payload) over resultingState
          // which may be the empty initial state from UPGRADE_DOCUMENT
          const input = operation.action.input as RenownCredentialState | undefined;
          const state = (input?.id || input?.issuer)
            ? input
            : (() => {
                const stateStr = operation.resultingState ?? context.resultingState;
                return stateStr ? (JSON.parse(stateStr) as RenownCredentialState | undefined) : undefined;
              })();

          if (state) {
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
                proof_verification_method:
                  state.proof?.verificationMethod || "",
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
                proof_eip712_primary_type:
                  state.proof?.eip712?.primaryType || "",
                revoked: state.revoked || false,
                revoked_at: state.revokedAt
                  ? new Date(state.revokedAt)
                  : null,
                revocation_reason: state.revocationReason || null,
                created_at: new Date(),
                updated_at: new Date(),
              })
              .onConflict((oc) => oc.column("document_id").doUpdateSet({
                context: state.context ? JSON.stringify(state.context) : "[]",
                credential_id: state.id || "",
                type: state.type ? JSON.stringify(state.type) : "[]",
                issuer_id: state.issuer?.id || "",
                issuer_ethereum_address: state.issuer?.ethereumAddress || "",
                credential_subject_id: state.credentialSubject?.id || null,
                credential_subject_app: state.credentialSubject?.app || "",
                proof_verification_method: state.proof?.verificationMethod || "",
                proof_ethereum_address: state.proof?.ethereumAddress || "",
                proof_type: state.proof?.type || "",
                proof_value: state.proof?.proofValue || "",
                proof_eip712_domain: state.proof?.eip712?.domain ? JSON.stringify(state.proof.eip712.domain) : "{}",
                proof_eip712_primary_type: state.proof?.eip712?.primaryType || "",
                updated_at: new Date(),
              }))
              .execute();
          }
          break;
        }
        case "REVOKE": {
          const input = operation.action.input as RevokeInput | undefined;
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

            if (this.reactor) {
              try {
                await this.reactor.deleteDocument(documentId);
              } catch (error) {
                console.error(
                  `[RenownCredentialProcessor] Failed to delete revoked credential document ${documentId}:`,
                  error,
                );
              }
            }
          }
          break;
        }
      }
    }
  }

  async onDisconnect() {}
}
