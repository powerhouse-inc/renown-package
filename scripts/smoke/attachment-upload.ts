/**
 * End-to-end smoke test of a Renown switchboard's attachment store.
 *
 *   node scripts/smoke/attachment-upload.ts [--switchboard <url>]
 *   npx tsx scripts/smoke/attachment-upload.ts [--switchboard <url>]
 *
 * With no human interaction it:
 *   1. creates a throwaway wallet and a throwaway app did:key,
 *   2. issues a delegation credential wallet -> did:key through the
 *      self-authenticating `renown_issueCredential` mutation,
 *   3. mints a Renown bearer token (the kind Connect / vetra.io send),
 *   4. reserves and uploads a generated 64x64 PNG through the attachment API,
 *   5. probes `GET /attachments/<hash>/download-target` anonymously and with
 *      the bearer, with and without `?documentId=`.
 *
 * Exits non-zero on any failure. Never prints private keys or bearer tokens.
 */
import {
  DEFAULT_RENOWN_CHAIN_ID,
  MemoryKeyStorage,
  RenownCryptoBuilder,
  buildAndSignCredential,
} from "@renown/sdk";
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const DEFAULT_SWITCHBOARD = "https://switchboard.renown-staging.vetra.io";
const APP_NAME = "renown-attachment-smoke";

class SmokeFailure extends Error {}

function parseArgs(argv: string[]): { switchboard: string } {
  let switchboard = DEFAULT_SWITCHBOARD;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--switchboard") {
      const value = argv[++i];
      if (!value) throw new SmokeFailure("--switchboard needs a URL");
      switchboard = value;
    } else if (arg.startsWith("--switchboard=")) {
      switchboard = arg.slice("--switchboard=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: attachment-upload.ts [--switchboard <url>]");
      process.exit(0);
    } else {
      throw new SmokeFailure(`unknown argument: ${arg}`);
    }
  }
  return {
    switchboard: switchboard.replace(/\/+$/, "").replace(/\/graphql$/, ""),
  };
}

function step(label: string, detail = ""): void {
  console.log(`[smoke] ${label}${detail ? ` ${detail}` : ""}`);
}

/** A solid-color RGB PNG, built in-process. */
function solidPng(
  size: number,
  rgb: [number, number, number],
): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Buffer): Buffer => {
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  const row = Buffer.alloc(1 + size * 3); // filter byte 0 + pixels
  for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return new Uint8Array(png); // own ArrayBuffer: a valid fetch body
}

/** Shortens a response body for display; never used before JSON.parse. */
function clip(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

async function graphql<T>(
  switchboard: string,
  query: string,
  variables: unknown,
): Promise<T> {
  const res = await fetch(`${switchboard}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  let json: { data?: T; errors?: unknown[] };
  try {
    json = JSON.parse(text) as { data?: T; errors?: unknown[] };
  } catch {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${text.slice(0, 500)}`);
  }
  if (json.errors?.length || !json.data) {
    throw new SmokeFailure(
      `GraphQL HTTP ${res.status}: ${JSON.stringify(json.errors ?? json)}`,
    );
  }
  return json.data;
}

const ISSUE_CREDENTIAL = /* GraphQL */ `
  mutation IssueCredential($input: RenownCredential_InitInput!) {
    renown_issueCredential(input: $input)
  }
`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const { switchboard } = parseArgs(process.argv.slice(2));
  step("switchboard", switchboard);

  // 1. Throwaway wallet + app did:key.
  const account = privateKeyToAccount(generatePrivateKey());
  // @renown/sdk 6.2.3 ships DEFAULT_RENOWN_CHAIN_ID as the string "1" despite
  // its number type; a string chainId in the signed EIP-712 domain does not
  // verify server-side, so coerce it.
  const chainId = Number(DEFAULT_RENOWN_CHAIN_ID);
  const crypto = await new RenownCryptoBuilder()
    .withKeyPairStorage(new MemoryKeyStorage())
    .withChainId(chainId)
    .build();
  step("wallet", account.address);
  step("app did", crypto.did);

  // 2. Delegation credential wallet -> did:key, stored by renown_issueCredential.
  //    Same shape renown.id sends (renown-hub services/renown-credential.ts).
  const vc = await buildAndSignCredential({
    signTypedData: (args) => account.signTypedData(args as never),
    address: account.address,
    chainId,
    app: APP_NAME,
    appId: crypto.did,
    expiresInDays: 1,
  });
  const input = {
    id: vc.id,
    context: vc["@context"],
    type: vc.type,
    issuer: { id: vc.issuer.id, ethereumAddress: vc.issuer.ethereumAddress },
    credentialSubject: {
      id: vc.credentialSubject.id,
      app: vc.credentialSubject.app,
    },
    credentialSchema: {
      id: vc.credentialSchema.id,
      type: vc.credentialSchema.type,
    },
    issuanceDate: vc.issuanceDate,
    expirationDate: vc.expirationDate,
    proof: {
      type: vc.proof.type,
      created: vc.proof.created,
      verificationMethod: vc.proof.verificationMethod,
      proofPurpose: vc.proof.proofPurpose,
      proofValue: vc.proof.proofValue,
      ethereumAddress: vc.proof.ethereumAddress,
      eip712: {
        domain: {
          version: vc.proof.eip712.domain.version,
          chainId: Number(vc.proof.eip712.domain.chainId),
        },
        primaryType: "VerifiableCredential",
      },
    },
  };
  const issued = await graphql<{ renown_issueCredential: string | null }>(
    switchboard,
    ISSUE_CREDENTIAL,
    { input },
  );
  if (!issued.renown_issueCredential) {
    throw new SmokeFailure("renown_issueCredential returned no document id");
  }
  step("credential issued", `vc=${vc.id} doc=${issued.renown_issueCredential}`);

  // 3. Bearer token: the app key signs a JWT VC naming the wallet address,
  //    exactly as Renown.getBearerToken does for Connect.
  const bearer = await crypto.getBearerToken(account.address, {
    expiresIn: 600,
  });
  step("bearer minted", `(${bearer.length} chars, not printed)`);
  const auth = { authorization: `Bearer ${bearer}` };

  // 4. Reserve (hash-first) and upload the PNG.
  const png = solidPng(64, [
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
  ]);
  const sha256 = createHash("sha256").update(png).digest("hex");
  step("png", `${png.length} bytes sha256=${sha256}`);

  const reserveBody = JSON.stringify({
    mimeType: "image/png",
    fileName: "smoke.png",
    extension: "png",
    clientHash: sha256,
    sizeBytes: png.length,
  });

  // Who may upload: an anonymous reservation must be refused.
  const anonReserve = await fetch(`${switchboard}/attachments/reservations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: reserveBody,
  });
  step(
    "reserve anonymous",
    `HTTP ${anonReserve.status} ${clip(await anonReserve.text())}`,
  );
  if (anonReserve.status !== 401) {
    throw new SmokeFailure(
      `anonymous reservation was not refused (HTTP ${anonReserve.status})`,
    );
  }

  // The bearer check reads the credential from the renown read model, which
  // the processor fills asynchronously; a fresh credential may lag briefly.
  let reserveRes: Response | undefined;
  let reserveText = "";
  for (let attempt = 1; attempt <= 10; attempt++) {
    reserveRes = await fetch(`${switchboard}/attachments/reservations`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: reserveBody,
    });
    reserveText = await reserveRes.text();
    if (reserveRes.status !== 401) break;
    step(
      "reserve",
      `HTTP 401 ${clip(reserveText)} (attempt ${attempt}/10, waiting for read model)`,
    );
    await sleep(2000);
  }
  if (!reserveRes || reserveRes.status !== 201) {
    throw new SmokeFailure(
      `POST /attachments/reservations -> HTTP ${reserveRes?.status}: ${clip(reserveText)}`,
    );
  }
  const reservation = JSON.parse(reserveText) as {
    reservationId: string;
    ref: string;
    expiresAtUtc: string | null;
    uploadTarget?: {
      url: string;
      method?: string;
      headers?: Record<string, string>;
    };
  };
  step(
    "reserved",
    `id=${reservation.reservationId} ref=${reservation.ref} expires=${reservation.expiresAtUtc}`,
  );

  // Filesystem backends take the bytes on PUT /attachments/reservations/:id;
  // S3 backends hand out an uploadTarget instead.
  let uploadRes: Response;
  if (reservation.uploadTarget) {
    step("upload via uploadTarget", new URL(reservation.uploadTarget.url).host);
    uploadRes = await fetch(reservation.uploadTarget.url, {
      method: reservation.uploadTarget.method ?? "PUT",
      headers: reservation.uploadTarget.headers ?? {},
      body: png,
    });
  } else {
    uploadRes = await fetch(
      `${switchboard}/attachments/reservations/${encodeURIComponent(reservation.reservationId)}`,
      {
        method: "PUT",
        headers: { ...auth, "content-type": "application/octet-stream" },
        body: png,
      },
    );
  }
  const uploadText = clip(await uploadRes.text());
  if (!uploadRes.ok) {
    throw new SmokeFailure(`upload -> HTTP ${uploadRes.status}: ${uploadText}`);
  }
  step("uploaded", `HTTP ${uploadRes.status} ${uploadText}`);

  const statusRes = await fetch(
    `${switchboard}/attachments/reservations/${encodeURIComponent(reservation.reservationId)}`,
    { headers: auth },
  );
  step(
    "reservation status",
    `HTTP ${statusRes.status} ${clip(await statusRes.text())}`,
  );

  const expectedRef = `attachment://v1:${sha256}`;
  if (reservation.ref !== expectedRef) {
    throw new SmokeFailure(`ref ${reservation.ref} != expected ${expectedRef}`);
  }

  // 5. download-target probes (informational: the ref is in no document yet).
  const base = `${switchboard}/attachments/${sha256}/download-target`;
  const probes: [string, string, Record<string, string>][] = [
    ["anonymous, no documentId", base, {}],
    [
      "anonymous, ?documentId",
      `${base}?documentId=${issued.renown_issueCredential}`,
      {},
    ],
    ["bearer, no documentId", base, auth],
    [
      "bearer, ?documentId",
      `${base}?documentId=${issued.renown_issueCredential}`,
      auth,
    ],
  ];
  for (const [label, url, headers] of probes) {
    const res = await fetch(url, { headers });
    step(
      `download-target ${label}`,
      `HTTP ${res.status} ${clip(await res.text())}`,
    );
  }

  console.log("");
  console.log(`address: ${account.address}`);
  console.log(`did:     ${crypto.did}`);
  console.log(`ref:     ${reservation.ref}`);
  console.log("OK");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[smoke] FAILED: ${message}`);
  process.exit(1);
});
