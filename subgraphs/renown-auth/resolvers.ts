import type { IReactorClient } from "@powerhousedao/reactor";
import type { BaseSubgraph } from "@powerhousedao/reactor-api";
import { verifyCredentialSignature } from "@renown/sdk";
import type { Action, PHDocument } from "document-model";
import { GraphQLError } from "graphql";
import { recoverMessageAddress } from "viem";
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
import { findCredentialDocs, findNewestProfileDoc, type ReadModelDb } from "./lookups.js";
import { verifyMessageOnChain, verifyTypedDataOnChain } from "./core/smart-wallet.js";

// Signed revoke/profile messages carry no chain; smart-wallet signatures over
// them are checked on Renown's default chain.
const MESSAGE_CHAIN_ID = 1;

// Per address, in memory: 30 issuances and 30 profile upserts per minute.
const WRITE_LIMIT = 30;
const WRITE_WINDOW_MS = 60_000;
// Profile field bounds. The username fits the read model's varchar(255)
// column (a longer one would be stored in the document but never indexed);
// the image may be a data URL, hence 512 KiB of text.
const MAX_USERNAME_LENGTH = 255;
const MAX_USER_IMAGE_LENGTH = 524_288;
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
  issuanceRateLimiter?: RateLimiter;
  profileRateLimiter?: RateLimiter;
}

type RateLimiter = { take(key: string, now?: number): boolean };

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

function rateLimited(): GraphQLError {
  return new GraphQLError("Rate limited", { extensions: { code: "RATE_LIMITED" } });
}

/** Rejects oversized profile fields before anything is written. */
function assertProfileBounds(profile: { username?: string | null; userImage?: string | null }): void {
  if (profile.username != null && profile.username.length > MAX_USERNAME_LENGTH) {
    throw invalidRequest(`Invalid request: username exceeds ${MAX_USERNAME_LENGTH} characters`);
  }
  if (profile.userImage != null && profile.userImage.length > MAX_USER_IMAGE_LENGTH) {
    throw invalidRequest(`Invalid request: userImage exceeds ${MAX_USER_IMAGE_LENGTH} characters`);
  }
}

/** True when `signed` carries a fresh `personal_sign` by `address` over `signed.message`. */
async function isSignedBy(address: string, signed: SignedMessage, now: Date): Promise<boolean> {
  return Boolean(
    signed.signature &&
      signed.timestamp &&
      isFreshTimestamp(signed.timestamp, now) &&
      ((await verifySignedMessage({ address, message: signed.message, signature: signed.signature })) ||
        (await verifyMessageOnChain({
          chainId: MESSAGE_CHAIN_ID,
          address,
          message: signed.message,
          signature: signed.signature,
        }))),
  );
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
  signed: SignedMessage,
  now: Date,
): Promise<void> {
  const want = expected.toLowerCase();
  if (ctx.user?.address && ctx.user.address.toLowerCase() === want) return;
  if (await isSignedBy(want, signed, now)) return;
  throw forbidden();
}

/**
 * The address the caller proves control of, among `candidates` (lowercased):
 * the login token's address when the host resolved one, else the signer of
 * a fresh `personal_sign` over `signed.message` if it is one of them.
 * Undefined if neither. The signer is recovered once (EOA, offline), however
 * many candidates there are.
 */
async function provenAddress(
  ctx: ResolverContext,
  candidates: string[],
  signed: SignedMessage,
  now: Date,
): Promise<string | undefined> {
  if (ctx.user?.address) return ctx.user.address.toLowerCase();
  if (!signed.signature || !signed.timestamp || !isFreshTimestamp(signed.timestamp, now)) {
    return undefined;
  }
  const signer = await recoverSigner(signed.message, signed.signature);
  if (signer !== null && candidates.includes(signer)) return signer;
  // A smart wallet's signature recovers to no candidate: ask the chain.
  for (const candidate of candidates) {
    const signature = signed.signature;
    if (await verifyMessageOnChain({ chainId: MESSAGE_CHAIN_ID, address: candidate, message: signed.message, signature })) {
      return candidate;
    }
  }
  return undefined;
}

/** The lowercased address that produced `signature` over `message`, or null if it can't be recovered. */
async function recoverSigner(message: string, signature: string): Promise<string | null> {
  try {
    const address = await recoverMessageAddress({ message, signature: signature as `0x${string}` });
    return address.toLowerCase();
  } catch {
    return null;
  }
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
  if (!valid) {
    // Not an EOA signature: a smart wallet (ERC-1271 / ERC-6492) can still prove it.
    const { proof, ...message } = credential;
    valid = await verifyTypedDataOnChain({
      chainId: proof.eip712.domain.chainId,
      address: issuerAddressOf(input),
      signature: proof.proofValue,
      typedData: {
        domain: proof.eip712.domain,
        types: proof.eip712.types,
        primaryType: "VerifiableCredential",
        message,
      } as never,
    });
  }
  if (!valid) throw invalidRequest("Invalid request: EIP-712 proof signature does not match issuer");
  return issuerAddressOf(input);
}

export function createResolvers(deps: ResolverDeps): Record<string, unknown> {
  const { reactorClient, relationalDb } = deps;
  const now = deps.now ?? (() => new Date());
  const issuanceRateLimiter = deps.issuanceRateLimiter ?? createRateLimiter(WRITE_LIMIT, WRITE_WINDOW_MS);
  const profileRateLimiter = deps.profileRateLimiter ?? createRateLimiter(WRITE_LIMIT, WRITE_WINDOW_MS);

  /** Applies `actions` and throws if the reactor rejected any of them. */
  async function execute(documentId: string, actions: Action[]): Promise<void> {
    const document: PHDocument = await reactorClient.execute(documentId, "main", actions);
    const sent = new Set(actions.map((action) => action.id));
    const failed = Object.values(document.operations)
      .flat()
      .find((operation) => operation.error && sent.has(operation.action.id));
    if (failed?.error) {
      throw new GraphQLError(`${failed.action.type} failed: ${failed.error}`, {
        extensions: { code: "INTERNAL_SERVER_ERROR" },
      });
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
        assertProfileBounds({ username, userImage });
        const issuer = await verifiedIssuer(input, now());

        // Idempotent before rate limiting: a signed credential is public, so
        // replays of it must never spend its issuer's budget. Only a row from
        // the same issuer counts; a junk copy claiming the VC id under another
        // issuer must not swallow the real credential.
        const existing = (await findCredentialDocs(relationalDb, input.id)).find(
          (doc) => doc.issuerAddress === issuer,
        );
        if (existing) return existing.documentId;

        // Keyed by a proven issuer address, so a forger can't spend someone else's budget.
        if (!issuanceRateLimiter.take(issuer, now().getTime())) throw rateLimited();

        const credentialDocId = await create(renownCredentialDocumentType);
        await execute(credentialDocId, [credentialActions.init(input)]);

        // A signed credential is public, so anyone can replay it: its profile
        // fields may only seed a profile that doesn't exist yet, never change one.
        // A replay of an already stored credential never reaches this point
        // (the idempotent return above), so only the first storage of a given
        // credential can seed. Anyone holding a not-yet-stored credential of
        // an address with no profile could seed that profile's fields; the
        // owner can overwrite them with renown_upsertProfile.
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
        const docs = await findCredentialDocs(relationalDb, credentialId);
        if (docs.length === 0) {
          throw new GraphQLError("Not found", { extensions: { code: "NOT_FOUND" } });
        }

        // Copies of a VC id may claim different issuers. The caller revokes
        // exactly the copies issued by the address they prove, and nothing else.
        const issuers = [...new Set(docs.map((doc) => doc.issuerAddress))];
        const caller = await provenAddress(
          ctx,
          issuers,
          { message: revokeMessage(credentialId, timestamp ?? ""), signature, timestamp },
          now(),
        );
        const own = docs.filter((doc) => doc.issuerAddress === caller);
        if (caller === undefined || own.length === 0) throw forbidden();

        const revokedAt = now().toISOString();
        for (const doc of own.filter((d) => !d.revoked)) {
          await execute(doc.documentId, [
            credentialActions.revoke({ revokedAt, reason: REVOCATION_REASON }),
          ]);
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
        assertProfileBounds({ username, userImage });

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
        if (!profileRateLimiter.take(lowercased, now().getTime())) throw rateLimited();

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
