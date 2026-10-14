/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { GraphQLError } from "graphql";
import type { ISubgraph } from "@powerhousedao/reactor-api";
import { handleProblem, normalizeHandle } from "../renown-auth/core/handle.js";
import { RenownUserProcessor } from "../../processors/renown-user/index.js";
import type { DB as RenownUserDB } from "../../processors/renown-user/schema.js";
import { RenownCredentialProcessor } from "../../processors/renown-credential/index.js";
import type { DB as RenownCredentialDB } from "../../processors/renown-credential/schema.js";
import { orgHandleStatus, publicMembershipsOf } from "../renown-orgs/store/lookups.js";
import type { ReadModelDb } from "../renown-auth/lookups.js";
import { parseUserSearch, searchListedUsers, type UserSearchArgs } from "./search.js";
import { createOrgPolicy, type OrgPolicy } from "../renown-orgs/core/org-policy.js";
import { loadOrgsConfig } from "../renown-orgs/core/config.js";
import { issuedAtUtc } from "../renown-orgs/store/foreign.js";

interface RenownUserInput {
  driveId?: string;
  phid?: string;
  ethAddress?: string;
  username?: string;
  handle?: string;
}

interface RenownUsersInput {
  driveId?: string;
  phids?: string[];
  ethAddresses?: string[];
  usernames?: string[];
  handles?: string[];
}

interface HandleAvailability {
  handle: string;
  available: boolean;
  reason: "INVALID" | "RESERVED" | "TAKEN" | null;
}

interface RenownCredentialsInput {
  driveId?: string;
  credentialId?: string | null;
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
  displayName: string | null;
  handle: string | null;
  bio: string | null;
  links: { id: string; label: string; url: string }[];
  avatar: string | null;
  listed: boolean;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
}

interface RenownUserSearchPage {
  items: ReadRenownUser[];
  next: string | null;
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
  display_name: string | null;
  handle: string | null;
  bio: string | null;
  links: { id: string; label: string; url: string }[] | null;
  avatar_ref: string | null;
  listed: boolean;
  created_at: Date | null;
  updated_at: Date | null;
}): ReadRenownUser => ({
  documentId: user.document_id,
  username: user.username,
  ethAddress: user.eth_address,
  userImage: user.user_image,
  displayName: user.display_name,
  handle: user.handle,
  bio: user.bio,
  links: user.links ?? [],
  avatar: user.avatar_ref,
  listed: user.listed,
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
      "Drive ID is required. Provide it in the input or set RENOWN_PROFILES_DRIVE_ID environment variable.",
    );
  }
  return resolvedDriveId;
};

/**
 * The rows that count under organisation rules (spec 3.7, derived
 * revocation): a delegation to an org app drops out when its issuer is no
 * longer an ACTIVE publisher covering the app, it is suspended, or the app is
 * frozen. Person-app delegations always count and cost one org_apps read per
 * call; with no organisations namespace every row counts. Any other
 * organisation read failure throws SERVICE_UNAVAILABLE (fail closed).
 */
async function countingRows<
  T extends {
    credential_id: string;
    credential_subject_id: string | null;
    issuer_ethereum_address: string;
    /** issuance_date read as UTC (issuedAtUtc), as the organisation suspensions compare it. */
    issued_at_utc: Date;
  },
>(
  policy: Pick<OrgPolicy, "orgsOfApps" | "credentialStatus">,
  rows: T[],
): Promise<T[]> {
  const appDids = [...new Set(rows.map((row) => row.credential_subject_id).filter((did): did is string => !!did))];
  try {
    const orgApps = await policy.orgsOfApps(appDids);
    if (orgApps.size === 0) return rows;
    const kept: T[] = [];
    for (const row of rows) {
      const appDid = row.credential_subject_id;
      if (!appDid || !orgApps.has(appDid)) {
        kept.push(row);
        continue;
      }
      const verdict = await policy.credentialStatus({
        credentialId: row.credential_id,
        appDid,
        issuer: row.issuer_ethereum_address.toLowerCase(),
        issuedAt: new Date(row.issued_at_utc),
      });
      if (verdict.counts) kept.push(row);
    }
    return kept;
  } catch (error) {
    console.warn(`[renown-read-model] organisation rules unreadable: ${error instanceof Error ? error.message : String(error)}`);
    throw new GraphQLError("Credentials cannot be checked right now", { extensions: { code: "SERVICE_UNAVAILABLE" } });
  }
}

export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
   
  const db: any = subgraph.relationalDb;
  let orgPolicy: OrgPolicy | undefined;
  const policy = (): OrgPolicy =>
    (orgPolicy ??= createOrgPolicy(db as ReadModelDb, loadOrgsConfig(process.env).didHost));

  return {
    ReadRenownUser: {
      /** Never fails the profile: an unreadable organizations namespace lists nothing. */
      memberOf: async (parent: { ethAddress?: string | null }) => {
        if (!parent.ethAddress) return [];
        try {
          return await publicMembershipsOf(db as ReadModelDb, parent.ethAddress);
        } catch (error) {
          console.warn(`[renown-read-model] memberOf failed: ${error instanceof Error ? error.message : String(error)}`);
          return [];
        }
      },
    },
    Query: {
      renownUser: async (
        parent: unknown,
        args: { input: RenownUserInput },
      ): Promise<ReadRenownUser | null> => {
        const { phid, ethAddress, username, handle } = args.input;

         
        let query = RenownUserProcessor.query<RenownUserDB>(
          "renown-user",
          db,
        ).selectFrom("renown_user");

        // Priority: phid > ethAddress > handle > username
        if (phid) {
          query = query.where("renown_user.document_id", "=", phid);
        } else if (ethAddress) {
          // Match case-insensitively so clients that send checksummed or
          // lowercase addresses resolve to the same user.
          const addr = ethAddress.toLowerCase();
          query = query.where((eb) =>
            eb(eb.fn("LOWER", ["renown_user.eth_address"]), "=", addr),
          );
        } else if (handle) {
          const wanted = normalizeHandle(handle);
          query = query.where((eb) =>
            eb(eb.fn("LOWER", ["renown_user.handle"]), "=", wanted),
          );
        } else if (username) {
          query = query.where("renown_user.username", "=", username);
        } else {
          throw new Error(
            "At least one of phid, ethAddress, handle, or username must be provided",
          );
        }

        // Deterministic order (newest first) so a stable, current row is
        // returned even if duplicate documents exist for the same address.
        const result = await query
          .selectAll()
          .orderBy("renown_user.created_at", "desc")
          .orderBy("renown_user.document_id", "desc")
          .executeTakeFirst();

        return result ? mapToUser(result) : null;
      },

      renownUsers: async (
        parent: unknown,
        args: { input: RenownUsersInput },
      ): Promise<ReadRenownUser[]> => {
        const { driveId, phids, ethAddresses, usernames, handles } = args.input;

         
        let query = RenownUserProcessor.query<RenownUserDB>(
          "renown-user",
          db,
        ).selectFrom("renown_user");

        const hasPhids = phids && phids.length > 0;
        const hasEthAddresses = ethAddresses && ethAddresses.length > 0;
        const hasUsernames = usernames && usernames.length > 0;
        const hasHandles = handles && handles.length > 0;

        if (!hasPhids && !hasEthAddresses && !hasUsernames && !hasHandles) {
          throw new Error(
            "At least one of phids, ethAddresses, usernames, or handles must be provided",
          );
        }

        query = query.where((eb) => {
          const conditions: ReturnType<typeof eb>[] = [];

          if (hasPhids) {
            conditions.push(eb("renown_user.document_id", "in", phids));
          }

          if (hasEthAddresses) {
            // Match case-insensitively (see renownUser above).
            conditions.push(
              eb(
                eb.fn("LOWER", ["renown_user.eth_address"]),
                "in",
                ethAddresses.map((a) => a.toLowerCase()),
              ),
            );
          }

          if (hasUsernames) {
            conditions.push(eb("renown_user.username", "in", usernames));
          }

          if (hasHandles) {
            conditions.push(
              eb(
                eb.fn("LOWER", ["renown_user.handle"]),
                "in",
                handles.map(normalizeHandle),
              ),
            );
          }

          return eb.or(conditions);
        });

        const results = await query
          .selectAll()
          .orderBy("renown_user.created_at", "desc")
          .orderBy("renown_user.document_id", "desc")
          .execute();

        return results.map(mapToUser);
      },

      renownHandleAvailability: async (
        parent: unknown,
        args: { handle: string; address?: string | null },
      ): Promise<HandleAvailability> => {
        const handle = normalizeHandle(args.handle);
        const problem = handleProblem(handle);
        if (problem) return { handle, available: false, reason: problem };
        let orgStatus: "TAKEN" | "RESERVED" | null;
        try {
          orgStatus = await orgHandleStatus(db as ReadModelDb, handle, new Date());
        } catch {
          throw new GraphQLError("Handles cannot be checked right now", { extensions: { code: "SERVICE_UNAVAILABLE" } });
        }
        if (orgStatus) return { handle, available: false, reason: orgStatus };
        const owner = await RenownUserProcessor.query<RenownUserDB>("renown-user", db)
          .selectFrom("renown_user")
          .select("eth_address")
          .where((eb) => eb(eb.fn("LOWER", ["renown_user.handle"]), "=", handle))
          .executeTakeFirst();
        const mine =
          owner !== undefined &&
          !!args.address &&
          owner.eth_address?.toLowerCase() === args.address.toLowerCase();
        return owner === undefined || mine
          ? { handle, available: true, reason: null }
          : { handle, available: false, reason: "TAKEN" };
      },

      renownUserSearch: async (
        parent: unknown,
        args: UserSearchArgs,
      ): Promise<RenownUserSearchPage> => {
        const search = parseUserSearch(args);
        try {
          const { rows, next } = await searchListedUsers(
            RenownUserProcessor.query<RenownUserDB>("renown-user", db),
            search,
          );
          return { items: rows.map(mapToUser), next };
        } catch (error) {
          console.error("renownUserSearch failed", error);
          throw new GraphQLError("People search is temporarily unavailable", {
            extensions: { code: "SERVICE_UNAVAILABLE" },
          });
        }
      },

      renownCredentials: async (
        parent: unknown,
        args: { input: RenownCredentialsInput },
      ): Promise<ReadRenownCredential[]> => {
        const {
          driveId,
          credentialId,
          ethAddress,
          did,
          issuer,
          includeRevoked = true,
        } = args.input;

        // Postgres rejects NUL in text (SQLSTATE 22021); no stored value
        // contains one, so such a filter matches nothing.
        if ([credentialId, ethAddress, did, issuer].some((v) => v?.includes("\u0000"))) {
          return [];
        }

        let query = RenownCredentialProcessor.query<RenownCredentialDB>(
          "renown-credential",
          db,
        ).selectFrom("renown_credential");

        // Exact credential id (idx_renown_credential_credential_id). Checked
        // against null, not truthiness: "" must match nothing, never everything.
        if (credentialId != null) {
          query = query.where("renown_credential.credential_id", "=", credentialId);
        }

        // Filter by ethAddress in issuer or proof fields
        if (ethAddress) {
          query = query.where((eb) =>
            eb.and([
              eb(
                eb.fn("LOWER", ["renown_credential.issuer_ethereum_address"]),
                "=",
                ethAddress.toLowerCase(),
              ),
              eb(
                eb.fn("LOWER", ["renown_credential.proof_ethereum_address"]),
                "=",
                ethAddress.toLowerCase(),
              ),
            ]),
          );
        }

        // Filter by app DID in credential_subject_id
        if (did) {
          query = query.where(
            "renown_credential.credential_subject_id",
            "=",
            did,
          );
        }

        // Filter by issuer if provided
        if (issuer) {
          query = query.where((eb) =>
            eb.or([
              eb("renown_credential.issuer_id", "=", issuer),
              eb(
                eb.fn("LOWER", ["renown_credential.issuer_ethereum_address"]),
                "=",
                issuer.toLowerCase(),
              ),
            ]),
          );
        }

        // Filter by revoked status
        if (!includeRevoked) {
          query = query.where("renown_credential.revoked", "=", false);
        }

        const results = await query.selectAll().select(issuedAtUtc().as("issued_at_utc")).execute();

        // Live results are what a host's credential check reads: a
        // delegation that organisation rules no longer count is not live.
        const live = includeRevoked ? results : await countingRows(policy(), results);
        return live.map(mapToCredential);
      },
    },
  };
};
