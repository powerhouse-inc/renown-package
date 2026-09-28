import type { IReactorClient } from "@powerhousedao/reactor";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { verifyCredentialSignature } from "@renown/sdk";
import type { Action, PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import {
  actions as credentialActions,
  renownCredentialDocumentType,
  type InitInput,
} from "../../document-models/renown-credential/index.js";
import {
  actions as userActions,
  renownUserDocumentType,
} from "../../document-models/renown-user/index.js";
import { issuerAddressOf, validateCredentialInput } from "./core/credential-input.js";
import { createRateLimiter } from "./core/rate-limit.js";
import {
  isFreshTimestamp,
  profileMessage,
  revokeMessage,
  verifySignedMessage,
} from "./core/signed-message.js";
import {
  findCredentialDoc,
  findLiveCredentialDocIds,
  findNewestProfileDoc,
  type ReadModelDb,
} from "./lookups.js";

const ISSUANCE_LIMIT = 30;
const ISSUANCE_WINDOW_MS = 60_000;
const REVOCATION_REASON = "revoked by owner";
const ETHEREUM_ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** The host's resolver context: `user` is set only when the host resolved a login token. */
interface ResolverContext {
  user?: { address?: string };
}

interface SignedMessage {
  message: string;
  signature?: string | null;
  timestamp?: string | null;
}

export interface ResolverDeps {
  reactorClient: Pick<IReactorClient, "createEmpty" | "execute">;
  relationalDb: ReadModelDb;
  now?: () => Date;
  rateLimiter?: { take(key: string, now?: number): boolean };
}

interface IssueCredentialArgs {
  input: InitInput;
  username?: string | null;
  userImage?: string | null;
  /** Accepted for SDK compatibility and ignored: the issuer address picks the profile. */
  userDocId?: string | null;
}

interface RevokeCredentialArgs {
  credentialId: string;
  signature?: string | null;
  timestamp?: string | null;
}

interface UpsertProfileArgs {
  address: string;
  username?: string | null;
  userImage?: string | null;
  signature?: string | null;
  timestamp?: string | null;
}

function forbidden(): GraphQLError {
  return new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
}

function invalidRequest(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

/**
 * Passes when the caller proves control of `expected`: either the host
 * resolved a login token to that address, or `signed` carries that address's
 * `personal_sign` over `signed.message` with a timestamp inside the window.
 * Anything else is FORBIDDEN, with no hint which check failed.
 */
async function authorizeAddress(
  ctx: ResolverContext,
  expected: string,
  signed: SignedMessage | undefined,
  now: Date,
): Promise<void> {
  const want = expected.toLowerCase();
  if (ctx.user?.address && ctx.user.address.toLowerCase() === want) return;
  if (
    signed?.signature &&
    signed.timestamp &&
    isFreshTimestamp(signed.timestamp, now) &&
    (await verifySignedMessage({ address: want, message: signed.message, signature: signed.signature }))
  ) {
    return;
  }
  throw forbidden();
}

/** Validates the signed credential and proves it was signed by its issuer; returns the issuer address. */
async function verifiedIssuer(input: InitInput, now: Date): Promise<`0x${string}`> {
  let credential: ReturnType<typeof validateCredentialInput>;
  try {
    credential = validateCredentialInput(input, now);
  } catch (error) {
    throw invalidRequest(error instanceof Error ? error.message : "Invalid request");
  }
  let valid = false;
  try {
    valid = await verifyCredentialSignature(credential);
  } catch {
    valid = false;
  }
  if (!valid) throw invalidRequest("Invalid request: EIP-712 proof signature does not match issuer");
  return issuerAddressOf(input);
}

export function createResolvers(deps: ResolverDeps): Record<string, unknown> {
  const { reactorClient, relationalDb } = deps;
  const now = deps.now ?? (() => new Date());
  const rateLimiter = deps.rateLimiter ?? createRateLimiter(ISSUANCE_LIMIT, ISSUANCE_WINDOW_MS);

  /** Applies `actions` and throws if the reactor rejected any of them. */
  async function execute(documentId: string, actions: Action[]): Promise<void> {
    const document: PHDocument = await reactorClient.execute(documentId, "main", actions);
    const sent = new Set(actions.map((action) => action.id));
    const failed = Object.values(document.operations)
      .flat()
      .find((operation) => operation.error && sent.has(operation.action.id));
    if (failed?.error) {
      throw new GraphQLError(`${failed.action.type} failed: ${failed.error}`);
    }
  }

  async function create(documentType: string): Promise<string> {
    const document = await reactorClient.createEmpty(documentType);
    return document.header.id;
  }

  function profileActions(profile: { username?: string | null; userImage?: string | null }): Action[] {
    return [
      ...(profile.username != null ? [userActions.setUsername({ username: profile.username })] : []),
      ...(profile.userImage != null ? [userActions.setUserImage({ userImage: profile.userImage })] : []),
    ];
  }

  return {
    Mutation: {
      renown_issueCredential: async (_: unknown, args: IssueCredentialArgs): Promise<string> => {
        const { input, username, userImage } = args;
        const issuer = await verifiedIssuer(input, now());

        // Keyed by a proven issuer address, so a forger can't spend someone else's budget.
        if (!rateLimiter.take(issuer, now().getTime())) {
          throw new GraphQLError("Rate limited", { extensions: { code: "RATE_LIMITED" } });
        }

        const existing = await findCredentialDoc(relationalDb, input.id);
        if (existing) return existing.documentId;

        const credentialDocId = await create(renownCredentialDocumentType);
        await execute(credentialDocId, [credentialActions.init(input)]);

        // A signed credential is public, so anyone can replay it: its profile
        // fields may only seed a profile that doesn't exist yet, never change one.
        if ((await findNewestProfileDoc(relationalDb, issuer)) === undefined) {
          const profileDocId = await create(renownUserDocumentType);
          await execute(profileDocId, [
            userActions.setEthAddress({ ethAddress: issuer }),
            ...profileActions({ username, userImage }),
          ]);
        }

        return credentialDocId;
      },

      renown_revokeCredential: async (
        _: unknown,
        args: RevokeCredentialArgs,
        ctx: ResolverContext,
      ): Promise<boolean> => {
        const { credentialId, signature, timestamp } = args;
        const credential = await findCredentialDoc(relationalDb, credentialId);
        if (!credential) {
          throw new GraphQLError("Not found", { extensions: { code: "NOT_FOUND" } });
        }

        await authorizeAddress(
          ctx,
          credential.issuerAddress,
          { message: revokeMessage(credentialId, timestamp ?? ""), signature, timestamp },
          now(),
        );

        if (credential.revoked) return true;

        const revokedAt = now().toISOString();
        const live = await findLiveCredentialDocIds(relationalDb, credentialId, credential.issuerAddress);
        for (const documentId of live) {
          await execute(documentId, [credentialActions.revoke({ revokedAt, reason: REVOCATION_REASON })]);
        }
        return true;
      },

      renown_upsertProfile: async (
        _: unknown,
        args: UpsertProfileArgs,
        ctx: ResolverContext,
      ): Promise<string> => {
        const { address, username, userImage, signature, timestamp } = args;
        if (!ETHEREUM_ADDRESS_RE.test(address)) {
          throw invalidRequest("Invalid request: address is not a valid Ethereum address");
        }

        await authorizeAddress(
          ctx,
          address,
          {
            message: await profileMessage(address, { username, userImage }, timestamp ?? ""),
            signature,
            timestamp,
          },
          now(),
        );

        const lowercased = address.toLowerCase();
        const existing = await findNewestProfileDoc(relationalDb, lowercased);
        const documentId = existing ?? (await create(renownUserDocumentType));
        const actions = [
          ...(existing ? [] : [userActions.setEthAddress({ ethAddress: lowercased })]),
          ...profileActions({ username, userImage }),
        ];
        if (actions.length > 0) await execute(documentId, actions);
        return documentId;
      },
    },
  };
}

export const getResolvers = (subgraph: BaseSubgraph): Record<string, unknown> =>
  createResolvers({
    reactorClient: subgraph.reactorClient,
    relationalDb: subgraph.relationalDb as unknown as ReadModelDb,
  });
