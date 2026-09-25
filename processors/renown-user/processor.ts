import {
  RelationalDbProcessor,
  type OperationWithContext,
} from "@powerhousedao/reactor-browser";
import { up } from "./migrations.js";
import { type DB } from "./schema.js";

export class RenownUserProcessor extends RelationalDbProcessor<DB> {
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

      // Ensure the User exists in the database
      const existingUser = await this.relationalDb
        .selectFrom("renown_user")
        .select(["document_id"])
        .where("document_id", "=", documentId)
        .executeTakeFirst();

      if (!existingUser) {
        await this.relationalDb
          .insertInto("renown_user")
          .values({
            document_id: documentId,
            username: null,
            eth_address: null,
            user_image: null,
            created_at: new Date(),
            updated_at: new Date(),
          })
          .onConflict((oc) => oc.column("document_id").doNothing())
          .execute();
      }

      const updateData: Partial<{
        username: string | null;
        eth_address: string | null;
        user_image: string | null;
        updated_at: Date;
      }> = {
        updated_at: new Date(),
      };

      switch (operation.action.type) {
        case "SET_USERNAME": {
          const input = operation.action.input as
            | { username?: string }
            | undefined;
          if (input?.username) {
            updateData.username = input.username;
          }
          break;
        }
        case "SET_ETH_ADDRESS": {
          const input = operation.action.input as
            | { ethAddress?: string }
            | undefined;
          if (input?.ethAddress) {
            updateData.eth_address = input.ethAddress;
          }
          break;
        }
        case "SET_USER_IMAGE": {
          const input = operation.action.input as
            | { userImage?: string }
            | undefined;
          if (input?.userImage !== undefined) {
            updateData.user_image = input.userImage || null;
          }
          break;
        }
      }

      if (Object.keys(updateData).length > 1) {
        await this.relationalDb
          .updateTable("renown_user")
          .set(updateData)
          .where("document_id", "=", documentId)
          .execute();
      }
    }
  }

  async onDisconnect() {}
}
