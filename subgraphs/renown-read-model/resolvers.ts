import type { ISubgraph } from "@powerhousedao/reactor-api";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";
import { RenownCredentialProcessor } from "../../processors/renown-credential/index.js";
import type { DB as RenownCredentialDB } from "../../processors/renown-credential/schema.js";

interface RenownUserInput {
  driveId?: string;
  phid?: string;
  ethAddress?: string;
  username?: string;
}

interface RenownUsersInput {
  driveId?: string;
  phids?: string[];
  ethAddresses?: string[];
  usernames?: string[];
}

interface RenownCredentialsInput {
  driveId?: string;
  ethAddress?: string;
  did?: string;
  issuer?: string;
  includeRevoked?: boolean;
}

interface ReadRenownUser {
  documentId: string;
  username: string | null;
  ethAddress: string | null;
  userImage: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

interface ReadCredentialStatus {
  id: string;
  type: string;
  statusPurpose: string;
  statusListIndex: string;
  statusListCredential: string;
}

interface ReadRenownCredential {
  documentId: string;
  jwt: string | null;
  jwtVerified: boolean;
  vcPayload: string | null;
  credentialId: string | null;
  context: string[] | null;
  type: string[] | null;
  issuer: string | null;
  issuanceDate: Date | string | null;
  credentialSubject: string | null;
  expirationDate: Date | string | null;
  credentialStatus: ReadCredentialStatus | null;
  revoked: boolean;
  revokedAt: Date | string | null;
  revocationReason: string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

const mapToUser = (user: {
  document_id: string;
  username: string | null;
  eth_address: string | null;
  user_image: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}): ReadRenownUser => ({
  documentId: user.document_id,
  username: user.username,
  ethAddress: user.eth_address,
  userImage: user.user_image,
  createdAt: user.created_at,
  updatedAt: user.updated_at,
});

const mapToCredential = (credential: {
  document_id: string;
  jwt: string | null;
  jwt_verified: boolean;
  vc_payload: string | null;
  context: string | null;
  credential_id: string | null;
  type: string | null;
  issuer: string | null;
  issuance_date: Date | null;
  credential_subject: string | null;
  expiration_date: Date | null;
  credential_status_id: string | null;
  credential_status_type: string | null;
  credential_status_purpose: string | null;
  credential_status_list_index: string | null;
  credential_status_list_credential: string | null;
  revoked: boolean;
  revoked_at: Date | null;
  revocation_reason: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}): ReadRenownCredential => ({
  documentId: credential.document_id,
  jwt: credential.jwt,
  jwtVerified: credential.jwt_verified,
  vcPayload: credential.vc_payload,
  credentialId: credential.credential_id,
  context: credential.context ? (JSON.parse(credential.context) as string[]) : null,
  type: credential.type ? (JSON.parse(credential.type) as string[]) : null,
  issuer: credential.issuer,
  issuanceDate: credential.issuance_date,
  credentialSubject: credential.credential_subject,
  expirationDate: credential.expiration_date,
  credentialStatus:
    credential.credential_status_id &&
    credential.credential_status_type &&
    credential.credential_status_purpose &&
    credential.credential_status_list_index &&
    credential.credential_status_list_credential
      ? {
          id: credential.credential_status_id,
          type: credential.credential_status_type,
          statusPurpose: credential.credential_status_purpose,
          statusListIndex: credential.credential_status_list_index,
          statusListCredential: credential.credential_status_list_credential,
        }
      : null,
  revoked: credential.revoked,
  revokedAt: credential.revoked_at,
  revocationReason: credential.revocation_reason,
  createdAt: credential.created_at,
  updatedAt: credential.updated_at,
});

const getDriveId = (driveId?: string): string => {
  const resolvedDriveId = driveId || process.env.RENOWN_PROFILES_DRIVE_ID;
  if (!resolvedDriveId) {
    throw new Error(
      "Drive ID is required. Provide it in the input or set RENOWN_PROFILES_DRIVE_ID environment variable."
    );
  }
  return resolvedDriveId;
};

export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
  const db = subgraph.relationalDb;

  return {
    Query: {
      renownUser: async (
        parent: unknown,
        args: { input: RenownUserInput }
      ): Promise<ReadRenownUser | null> => {
        const { driveId, phid, ethAddress, username } = args.input;
        const resolvedDriveId = getDriveId(driveId);

        let query = RenownUserProcessor.query<RenownUserDB>(resolvedDriveId, db).selectFrom(
          "renown_user"
        );

        // Priority: phid > ethAddress > username
        if (phid) {
          query = query.where("renown_user.document_id", "=", phid);
        } else if (ethAddress) {
          query = query.where("renown_user.eth_address", "=", ethAddress);
        } else if (username) {
          query = query.where("renown_user.username", "=", username);
        } else {
          throw new Error(
            "At least one of phid, ethAddress, or username must be provided"
          );
        }

        const result = await query.selectAll().executeTakeFirst();

        return result ? mapToUser(result) : null;
      },

      renownUsers: async (
        parent: unknown,
        args: { input: RenownUsersInput }
      ): Promise<ReadRenownUser[]> => {
        const { driveId, phids, ethAddresses, usernames } = args.input;
        const resolvedDriveId = getDriveId(driveId);

        let query = RenownUserProcessor.query<RenownUserDB>(resolvedDriveId, db).selectFrom(
          "renown_user"
        );

        const hasPhids = phids && phids.length > 0;
        const hasEthAddresses = ethAddresses && ethAddresses.length > 0;
        const hasUsernames = usernames && usernames.length > 0;

        if (!hasPhids && !hasEthAddresses && !hasUsernames) {
          throw new Error(
            "At least one of phids, ethAddresses, or usernames must be provided"
          );
        }

        query = query.where((eb) => {
          const conditions: ReturnType<typeof eb>[] = [];

          if (hasPhids) {
            conditions.push(eb("renown_user.document_id", "in", phids));
          }

          if (hasEthAddresses) {
            conditions.push(eb("renown_user.eth_address", "in", ethAddresses));
          }

          if (hasUsernames) {
            conditions.push(eb("renown_user.username", "in", usernames));
          }

          return eb.or(conditions);
        });

        const results = await query.selectAll().execute();

        return results.map(mapToUser);
      },

      renownCredentials: async (
        parent: unknown,
        args: { input: RenownCredentialsInput }
      ): Promise<ReadRenownCredential[]> => {
        const { driveId, ethAddress, did, issuer, includeRevoked = true } =
          args.input;
        const resolvedDriveId = getDriveId(driveId);

        let query = RenownCredentialProcessor.query<RenownCredentialDB>(
          resolvedDriveId,
          db
        ).selectFrom("renown_credential");

        // Search by ethAddress or DID in credential_subject JSON
        if (ethAddress || did) {
          query = query.where((eb) => {
            const conditions: ReturnType<typeof eb>[] = [];

            if (ethAddress) {
              // Search for ethAddress in credential_subject JSON
              conditions.push(
                eb("renown_credential.credential_subject", "like", `%${ethAddress}%`)
              );
            }

            if (did) {
              // Search for DID in credential_subject JSON
              conditions.push(
                eb("renown_credential.credential_subject", "like", `%${did}%`)
              );
            }

            return eb.or(conditions);
          });
        }

        // Filter by issuer if provided
        if (issuer) {
          query = query.where("renown_credential.issuer", "=", issuer);
        }

        // Filter by revoked status
        if (!includeRevoked) {
          query = query.where("renown_credential.revoked", "=", false);
        }

        const results = await query.selectAll().execute();

        return results.map(mapToCredential);
      },
    },
  };
};
