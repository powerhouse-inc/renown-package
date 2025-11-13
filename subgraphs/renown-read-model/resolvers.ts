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

interface ReadRenownCredential {
  documentId: string;
  credentialId: string;
  context: string[];
  type: string[];
  issuerId: string;
  issuerEthereumAddress: string;
  issuanceDate: Date | string;
  expirationDate: Date | string | null;
  credentialSubjectId: string | null;
  credentialSubjectApp: string;
  credentialStatusId: string | null;
  credentialStatusType: string | null;
  credentialSchemaId: string;
  credentialSchemaType: string;
  proofVerificationMethod: string;
  proofEthereumAddress: string;
  proofCreated: Date | string;
  proofPurpose: string;
  proofType: string;
  proofValue: string;
  proofEip712Domain: string;
  proofEip712PrimaryType: string;
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
  context: string;
  credential_id: string;
  type: string;
  issuer_id: string;
  issuer_ethereum_address: string;
  issuance_date: Date;
  expiration_date: Date | null;
  credential_subject_id: string | null;
  credential_subject_app: string;
  credential_status_id: string | null;
  credential_status_type: string | null;
  credential_schema_id: string;
  credential_schema_type: string;
  proof_verification_method: string;
  proof_ethereum_address: string;
  proof_created: Date;
  proof_purpose: string;
  proof_type: string;
  proof_value: string;
  proof_eip712_domain: string;
  proof_eip712_primary_type: string;
  revoked: boolean;
  revoked_at: Date | null;
  revocation_reason: string | null;
  created_at: Date | null;
  updated_at: Date | null;
}): ReadRenownCredential => ({
  documentId: credential.document_id,
  credentialId: credential.credential_id,
  context: JSON.parse(credential.context) as string[],
  type: JSON.parse(credential.type) as string[],
  issuerId: credential.issuer_id,
  issuerEthereumAddress: credential.issuer_ethereum_address,
  issuanceDate: credential.issuance_date,
  expirationDate: credential.expiration_date,
  credentialSubjectId: credential.credential_subject_id,
  credentialSubjectApp: credential.credential_subject_app,
  credentialStatusId: credential.credential_status_id,
  credentialStatusType: credential.credential_status_type,
  credentialSchemaId: credential.credential_schema_id,
  credentialSchemaType: credential.credential_schema_type,
  proofVerificationMethod: credential.proof_verification_method,
  proofEthereumAddress: credential.proof_ethereum_address,
  proofCreated: credential.proof_created,
  proofPurpose: credential.proof_purpose,
  proofType: credential.proof_type,
  proofValue: credential.proof_value,
  proofEip712Domain: credential.proof_eip712_domain,
  proofEip712PrimaryType: credential.proof_eip712_primary_type,
  revoked: credential.revoked,
  revokedAt: credential.revoked_at,
  revocationReason: credential.revocation_reason,
  createdAt: credential.created_at,
  updatedAt: credential.updated_at,
});

const getDriveId = (driveId?: string): string => {
  const resolvedDriveId =
    driveId || process.env.RENOWN_PROFILES_DRIVE_ID || "renown-user";
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
        const { phid, ethAddress, username } = args.input;

        let query = RenownUserProcessor.query<RenownUserDB>(
          "renown-user",
          db
        ).selectFrom("renown_user");

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

        let query = RenownUserProcessor.query<RenownUserDB>(
          "renown-user",
          db
        ).selectFrom("renown_user");

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
        const {
          driveId,
          ethAddress,
          did,
          issuer,
          includeRevoked = true,
        } = args.input;

        let query = RenownCredentialProcessor.query<RenownCredentialDB>(
          "renown-credential",
          db
        ).selectFrom("renown_credential");

        // Search by ethAddress or DID in credential_subject fields
        if (ethAddress || did) {
          query = query.where((eb) => {
            const conditions: ReturnType<typeof eb>[] = [];

            if (ethAddress) {
              // Search for ethAddress in credential_subject_id (case-insensitive)
              conditions.push(
                eb(
                  eb.fn("LOWER", ["renown_credential.credential_subject_id"]),
                  "like",
                  `%${ethAddress.toLowerCase()}%`
                )
              );
              // Also search in proof_ethereum_address
              conditions.push(
                eb(
                  eb.fn("LOWER", ["renown_credential.proof_ethereum_address"]),
                  "=",
                  ethAddress.toLowerCase()
                )
              );
            }

            if (did) {
              // Search for DID in credential_subject_id (case-insensitive)
              conditions.push(
                eb(
                  eb.fn("LOWER", ["renown_credential.credential_subject_id"]),
                  "like",
                  `%${did.toLowerCase()}%`
                )
              );
            }

            return eb.or(conditions);
          });
        }

        // Filter by issuer if provided
        if (issuer) {
          query = query.where((eb) =>
            eb.or([
              eb("renown_credential.issuer_id", "=", issuer),
              eb(
                eb.fn("LOWER", ["renown_credential.issuer_ethereum_address"]),
                "=",
                issuer.toLowerCase()
              ),
            ])
          );
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
