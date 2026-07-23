/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { type ISubgraph } from "@powerhousedao/reactor-api";
import {
  CREDENTIAL_TYPES,
  parsePkhDid,
  verifyCredentialSignature,
  type PowerhouseVerifiableCredential,
} from "@renown/sdk";
import {
  actions,
  renownCredentialDocumentType,
  type InitInput,
  type RenownCredentialDocument,
} from "../../document-models/renown-credential/index.js";
import { RenownCredentialProcessor } from "../../processors/renown-credential/index.js";
import type { DB as RenownCredentialDB } from "../../processors/renown-credential/schema.js";

// Accept a small clock skew so an issuer whose clock runs slightly ahead is not
// rejected for a "future" issuance date.
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const EXPECTED_PROOF_TYPE = "EthereumEip712Signature2021";

// Guards against absurdly large payloads on this unauthenticated endpoint. Not
// rate limiting — just a cheap ceiling on obviously-abusive input.
const MAX_ARRAY_ITEMS = 32;
const MAX_STRING_LENGTH = 4096;

// Optional chain-id allowlist, e.g. RENOWN_ALLOWED_CHAIN_IDS="1,137". Unset ->
// any chain accepted.
function allowedChainIds(): number[] | undefined {
  const raw = process.env.RENOWN_ALLOWED_CHAIN_IDS?.trim();
  if (!raw) return undefined;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "")
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n > 0);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invalid request: ${message}`);
  }
}

function assertBoundedString(value: string, field: string): void {
  assert(
    value.length <= MAX_STRING_LENGTH,
    `${field} exceeds ${MAX_STRING_LENGTH} characters`,
  );
}

// Structural + semantic validation of the signed credential. Throws a clear
// error on the first failure; returns the credential rebuilt as the SDK type.
function validateStructure(input: InitInput): PowerhouseVerifiableCredential {
  assert(Array.isArray(input.context) && input.context.length > 0, "missing @context");
  assert(Array.isArray(input.type) && input.type.length > 0, "missing type");
  assert(
    input.context.length <= MAX_ARRAY_ITEMS && input.type.length <= MAX_ARRAY_ITEMS,
    "too many context/type entries",
  );
  assert(input.id, "missing id");
  assertBoundedString(input.id, "id");

  const { issuer, credentialSubject, credentialSchema, proof } = input;
  assert(issuer?.id && issuer.ethereumAddress, "missing issuer");
  assert(credentialSubject?.id, "missing credentialSubject.id (app DID)");
  assert(credentialSubject.app, "missing credentialSubject.app");
  assert(credentialSchema?.id && credentialSchema.type, "missing credentialSchema");
  assert(proof, "missing proof");
  assert(proof.type === EXPECTED_PROOF_TYPE, `proof.type must be ${EXPECTED_PROOF_TYPE}`);
  assert(/^0x[0-9a-fA-F]+$/.test(proof.proofValue), "proof.proofValue is not a hex string");
  assertBoundedString(proof.proofValue, "proof.proofValue");
  assert(proof.eip712?.domain, "missing proof.eip712.domain");
  assert(
    proof.eip712.primaryType === "VerifiableCredential",
    'proof.eip712.primaryType must be "VerifiableCredential"',
  );

  // Binding: issuer.id is `did:pkh:<net>:<chainId>:<address>`; every address in
  // the credential must be the same, and the chain id must match the domain.
  const pkh = parsePkhDid(issuer.id);
  const issuerAddress = issuer.ethereumAddress.toLowerCase();
  assert(pkh.address.toLowerCase() === issuerAddress, "issuer.id address != issuer.ethereumAddress");
  assert(
    proof.ethereumAddress.toLowerCase() === issuerAddress,
    "proof.ethereumAddress != issuer.ethereumAddress",
  );
  assert(pkh.chainId === proof.eip712.domain.chainId, "issuer chainId != proof domain chainId");

  const allowed = allowedChainIds();
  assert(
    !allowed || allowed.includes(pkh.chainId),
    `chainId ${pkh.chainId} is not allowed`,
  );

  // Temporal: issuance not future-dated (with skew); expiration present and in
  // the future.
  const issuedAt = Date.parse(input.issuanceDate);
  assert(!Number.isNaN(issuedAt), "issuanceDate is not a valid date");
  assert(issuedAt <= Date.now() + CLOCK_SKEW_MS, "issuanceDate is in the future");
  assert(input.expirationDate, "missing expirationDate");
  const expiresAt = Date.parse(input.expirationDate);
  assert(!Number.isNaN(expiresAt), "expirationDate is not a valid date");
  assert(expiresAt > Date.now(), "credential has expired");

  return {
    "@context": input.context,
    id: input.id,
    type: input.type,
    issuer: {
      id: issuer.id,
      ethereumAddress: issuer.ethereumAddress as `0x${string}`,
    },
    issuanceDate: input.issuanceDate,
    expirationDate: input.expirationDate,
    credentialSubject: {
      id: credentialSubject.id,
      app: credentialSubject.app,
    },
    credentialSchema: {
      id: credentialSchema.id,
      type: credentialSchema.type,
    },
    ...(input.credentialStatus
      ? {
          credentialStatus: {
            id: input.credentialStatus.id,
            type: input.credentialStatus.type,
          },
        }
      : {}),
    proof: {
      type: proof.type,
      created: proof.created,
      verificationMethod: proof.verificationMethod,
      proofPurpose: proof.proofPurpose,
      proofValue: proof.proofValue,
      ethereumAddress: proof.ethereumAddress as `0x${string}`,
      eip712: {
        domain: {
          version: proof.eip712.domain.version,
          chainId: proof.eip712.domain.chainId,
        },
        types: CREDENTIAL_TYPES,
        primaryType: "VerifiableCredential",
      },
    },
  };
}

export const getResolvers = (subgraph: ISubgraph): Record<string, unknown> => {
  const reactor = subgraph.reactorClient;
  const db: any = subgraph.relationalDb;

  return {
    Mutation: {
      // Public: no auth context required. Persists only after the EIP-712 proof
      // is cryptographically verified against the claimed issuer address.
      renown_issueCredential: async (
        _: unknown,
        args: { input: InitInput },
      ): Promise<string> => {
        const { input } = args;

        const credential = validateStructure(input);

        const signatureValid = await verifyCredentialSignature(credential);
        assert(signatureValid, "EIP-712 proof signature does not match issuer");

        // Idempotency / replay guard: if this signed credential was already
        // issued, return the existing document instead of creating a duplicate.
        const existing = await RenownCredentialProcessor.query<RenownCredentialDB>(
          "renown-credential",
          db,
        )
          .selectFrom("renown_credential")
          .select("document_id")
          .where("credential_id", "=", credential.id)
          .executeTakeFirst();
        if (existing) {
          return existing.document_id;
        }

        const document = await reactor.createEmpty<RenownCredentialDocument>(
          renownCredentialDocumentType,
        );
        await reactor.execute(document.header.id, "main", [actions.init(input)]);

        return document.header.id;
      },
    },
  };
};
