import { RelationalDbProcessor } from "document-drive/processors/relational";
import { type InternalTransmitterUpdate } from "document-drive/server/transmitter/types";
import { up } from "./migrations.js";
import { type DB } from "./schema.js";

export class RenownUserProcessor extends RelationalDbProcessor<DB> {
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

      // Ensure the User exists in the database
      const existingUser = await this.relationalDb
        .selectFrom("renown_user")
        .select(["document_id"])
        .where("document_id", "=", documentId)
        .executeTakeFirst();

      if (!existingUser) {
        // Create a new User entry
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
          .execute();
      }

      // Process each operation
      for (const operation of strand.operations) {
        // Update the User based on the operation type
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

        // Apply updates if there are any field changes
        if (Object.keys(updateData).length > 1) {
          await this.relationalDb
            .updateTable("renown_user")
            .set(updateData)
            .where("document_id", "=", documentId)
            .execute();
        }
      }
    }
  }

  async onDisconnect() {}
}
