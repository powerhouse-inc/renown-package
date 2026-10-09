import {
  RelationalDbProcessor,
  type OperationWithContext,
} from "@powerhousedao/reactor-browser";
import { nextLinks, type StoredLink } from "./links.js";
import { up } from "./migrations.js";
import { type DB } from "./schema.js";

type Input = Record<string, unknown>;

interface UpdateData {
  username?: string | null;
  eth_address?: string | null;
  user_image?: string | null;
  display_name?: string | null;
  handle?: string | null;
  bio?: string | null;
  links?: string;
  avatar_ref?: string | null;
  updated_at: Date;
}

/** A string input field, `null` when absent, null or empty. */
function text(input: Input, field: string): string | null {
  const value = input[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sqlState(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

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

    // One bad operation (e.g. a value too long for its column) must never
    // wedge the processor: a Postgres data exception (SQLSTATE class 22) is
    // logged without its payload and skipped. Anything else — a dropped
    // connection, a deadlock, an error with no SQLSTATE — is rethrown so the
    // reactor's at-least-once queue retries the batch instead of losing it.
    for (const { operation, context } of operations) {
      // A reducer error leaves the document unchanged; so does the read model.
      if (operation.error) continue;
      try {
        await this.applyOperation(operation, context);
      } catch (error) {
        const code = sqlState(error);
        if (code === undefined || !code.startsWith("22")) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        console.error(
          `[RenownUserProcessor] skipped operation ${operation.index} of ${context.documentId}: ${reason}`,
        );
      }
    }
  }

  private async applyOperation(
    operation: OperationWithContext["operation"],
    context: OperationWithContext["context"],
  ): Promise<void> {
    const documentId = context.documentId;

    // Ensure the User exists in the database
    const existingUser = await this.relationalDb
      .selectFrom("renown_user")
      .select(["document_id", "links"])
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

    const input = (operation.action.input ?? {}) as Input;
    const updateData: UpdateData = { updated_at: new Date() };

    switch (operation.action.type) {
      case "SET_USERNAME": {
        if (typeof input.username === "string" && input.username) {
          updateData.username = input.username;
        }
        break;
      }
      case "SET_ETH_ADDRESS": {
        if (typeof input.ethAddress === "string" && input.ethAddress) {
          updateData.eth_address = input.ethAddress;
        }
        break;
      }
      case "SET_USER_IMAGE": {
        if (input.userImage !== undefined) {
          updateData.user_image = text(input, "userImage");
        }
        break;
      }
      case "SET_DISPLAY_NAME":
        updateData.display_name = text(input, "displayName");
        break;
      case "SET_BIO":
        updateData.bio = text(input, "bio");
        break;
      case "SET_AVATAR":
        updateData.avatar_ref = text(input, "avatar");
        break;
      case "SET_HANDLE":
        await this.setHandle(documentId, text(input, "handle"));
        return;
      default: {
        const current: StoredLink[] = existingUser?.links ?? [];
        const links = nextLinks(current, operation.action.type, input);
        if (links) updateData.links = JSON.stringify(links);
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

  /**
   * Stores a handle. The write path refuses taken handles before it
   * dispatches, but two documents can still race to the same one; the unique
   * index then refuses the second, which is indexed without a handle (and
   * logged) instead of wedging the processor on a retry that can never pass.
   */
  private async setHandle(documentId: string, handle: string | null): Promise<void> {
    const write = (value: string | null) =>
      this.relationalDb
        .updateTable("renown_user")
        .set({ handle: value, updated_at: new Date() })
        .where("document_id", "=", documentId)
        .execute();
    try {
      await write(handle);
    } catch (error) {
      if (sqlState(error) !== "23505") throw error;
      console.error(
        `[RenownUserProcessor] handle of ${documentId} is already taken by another profile; indexed without a handle`,
      );
      await write(null);
    }
  }

  async onDisconnect() {}
}
