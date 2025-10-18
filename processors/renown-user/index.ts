import { RelationalDbProcessor } from "document-drive/processors/relational";
import { type InternalTransmitterUpdate } from "document-drive/server/listener/transmitter/internal";
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
          case "ADD_AUTHORIZATION": {
            const input = operation.action.input as
              | {
                  id: string;
                  jwt: string;
                  issuer?: string | null;
                  subject?: string | null;
                  audience?: string | null;
                  payload?: string | null;
                  createdAt: string;
                }
              | undefined;
            if (input?.id && input?.jwt) {
              await this.relationalDb
                .insertInto("authorization")
                .values({
                  id: input.id,
                  document_id: documentId,
                  jwt: input.jwt,
                  issuer: input.issuer || null,
                  subject: input.subject || null,
                  audience: input.audience || null,
                  payload: input.payload || null,
                  revoked: false,
                  created_at: input.createdAt ? new Date(input.createdAt) : null,
                  revoked_at: null,
                })
                .execute();
            }
            break;
          }
          case "REVOKE_AUTHORIZATION": {
            const input = operation.action.input as
              | { id: string; revokedAt: string }
              | undefined;
            if (input?.id) {
              await this.relationalDb
                .updateTable("authorization")
                .set({
                  revoked: true,
                  revoked_at: input.revokedAt
                    ? new Date(input.revokedAt)
                    : new Date(),
                })
                .where("id", "=", input.id)
                .where("document_id", "=", documentId)
                .execute();
            }
            break;
          }
          case "REMOVE_AUTHORIZATION": {
            const input = operation.action.input as { id: string } | undefined;
            if (input?.id) {
              await this.relationalDb
                .deleteFrom("authorization")
                .where("id", "=", input.id)
                .where("document_id", "=", documentId)
                .execute();
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

  /**
   * Check if a JWT token is valid (exists and not revoked)
   * @param jwt The JWT token to check
   * @returns Object with validity status and authorization details
   */
  async checkTokenValidity(jwt: string): Promise<{
    isValid: boolean;
    status: "valid" | "revoked" | "not_found";
    authorization?: {
      id: string;
      documentId: string;
      issuer: string | null;
      subject: string | null;
      audience: string | null;
      revokedAt: Date | null;
      createdAt: Date | null;
    };
  }> {
    const authorization = await this.relationalDb
      .selectFrom("authorization")
      .select([
        "id",
        "document_id",
        "issuer",
        "subject",
        "audience",
        "revoked",
        "created_at",
        "revoked_at",
      ])
      .where("jwt", "=", jwt)
      .executeTakeFirst();

    if (!authorization) {
      return {
        isValid: false,
        status: "not_found",
      };
    }

    if (authorization.revoked) {
      return {
        isValid: false,
        status: "revoked",
        authorization: {
          id: authorization.id,
          documentId: authorization.document_id,
          issuer: authorization.issuer,
          subject: authorization.subject,
          audience: authorization.audience,
          revokedAt: authorization.revoked_at,
          createdAt: authorization.created_at,
        },
      };
    }

    return {
      isValid: true,
      status: "valid",
      authorization: {
        id: authorization.id,
        documentId: authorization.document_id,
        issuer: authorization.issuer,
        subject: authorization.subject,
        audience: authorization.audience,
        revokedAt: null,
        createdAt: authorization.created_at,
      },
    };
  }

  /**
   * Get all authorizations for a specific user document
   * @param documentId The document ID of the user
   * @param includeRevoked Whether to include revoked authorizations (default: true)
   * @returns Array of authorizations
   */
  async getUserAuthorizations(
    documentId: string,
    includeRevoked = true
  ): Promise<
    Array<{
      id: string;
      jwt: string;
      issuer: string | null;
      subject: string | null;
      audience: string | null;
      payload: string | null;
      revoked: boolean;
      createdAt: Date | null;
      revokedAt: Date | null;
    }>
  > {
    let query = this.relationalDb
      .selectFrom("authorization")
      .select([
        "id",
        "jwt",
        "issuer",
        "subject",
        "audience",
        "payload",
        "revoked",
        "created_at",
        "revoked_at",
      ])
      .where("document_id", "=", documentId);

    if (!includeRevoked) {
      query = query.where("revoked", "=", false);
    }

    const authorizations = await query.execute();

    return authorizations.map((auth) => ({
      id: auth.id,
      jwt: auth.jwt,
      issuer: auth.issuer,
      subject: auth.subject,
      audience: auth.audience,
      payload: auth.payload,
      revoked: auth.revoked,
      createdAt: auth.created_at,
      revokedAt: auth.revoked_at,
    }));
  }

  /**
   * Get all authorizations for a user by their Ethereum address
   * @param ethAddress The Ethereum address of the user
   * @param includeRevoked Whether to include revoked authorizations (default: true)
   * @returns Array of authorizations with user information
   */
  async getAuthorizationsByEthAddress(
    ethAddress: string,
    includeRevoked = true
  ): Promise<
    Array<{
      id: string;
      jwt: string;
      issuer: string | null;
      subject: string | null;
      audience: string | null;
      payload: string | null;
      revoked: boolean;
      createdAt: Date | null;
      revokedAt: Date | null;
      user: {
        documentId: string;
        username: string | null;
        ethAddress: string | null;
        userImage: string | null;
      };
    }>
  > {
    let query = this.relationalDb
      .selectFrom("authorization")
      .innerJoin("renown_user", "authorization.document_id", "renown_user.document_id")
      .select([
        "authorization.id",
        "authorization.jwt",
        "authorization.issuer",
        "authorization.subject",
        "authorization.audience",
        "authorization.payload",
        "authorization.revoked",
        "authorization.created_at",
        "authorization.revoked_at",
        "renown_user.document_id as user_document_id",
        "renown_user.username",
        "renown_user.eth_address",
        "renown_user.user_image",
      ])
      .where("renown_user.eth_address", "=", ethAddress);

    if (!includeRevoked) {
      query = query.where("authorization.revoked", "=", false);
    }

    const results = await query.execute();

    return results.map((row) => ({
      id: row.id,
      jwt: row.jwt,
      issuer: row.issuer,
      subject: row.subject,
      audience: row.audience,
      payload: row.payload,
      revoked: row.revoked,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      user: {
        documentId: row.user_document_id,
        username: row.username,
        ethAddress: row.eth_address,
        userImage: row.user_image,
      },
    }));
  }

  /**
   * Get a specific authorization by its ID
   * @param authorizationId The ID of the authorization
   * @returns Authorization with user information or null if not found
   */
  async getAuthorizationById(authorizationId: string): Promise<{
    id: string;
    jwt: string;
    issuer: string | null;
    subject: string | null;
    audience: string | null;
    payload: string | null;
    revoked: boolean;
    createdAt: Date | null;
    revokedAt: Date | null;
    user: {
      documentId: string;
      username: string | null;
      ethAddress: string | null;
      userImage: string | null;
    };
  } | null> {
    const result = await this.relationalDb
      .selectFrom("authorization")
      .innerJoin("renown_user", "authorization.document_id", "renown_user.document_id")
      .select([
        "authorization.id",
        "authorization.jwt",
        "authorization.issuer",
        "authorization.subject",
        "authorization.audience",
        "authorization.payload",
        "authorization.revoked",
        "authorization.created_at",
        "authorization.revoked_at",
        "renown_user.document_id as user_document_id",
        "renown_user.username",
        "renown_user.eth_address",
        "renown_user.user_image",
      ])
      .where("authorization.id", "=", authorizationId)
      .executeTakeFirst();

    if (!result) {
      return null;
    }

    return {
      id: result.id,
      jwt: result.jwt,
      issuer: result.issuer,
      subject: result.subject,
      audience: result.audience,
      payload: result.payload,
      revoked: result.revoked,
      createdAt: result.created_at,
      revokedAt: result.revoked_at,
      user: {
        documentId: result.user_document_id,
        username: result.username,
        ethAddress: result.eth_address,
        userImage: result.user_image,
      },
    };
  }

  async onDisconnect() {}
}
