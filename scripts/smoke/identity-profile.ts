/**
 * End-to-end smoke test of Renown profile identity (identity hub phase 1):
 *
 *   node scripts/smoke/identity-profile.ts [--switchboard <url>] [--app <url>] [--allow-prod]
 *
 * With a throwaway wallet and no human interaction it:
 *   1. issues a delegation credential and mints a Renown bearer,
 *   2. checks the gated upload route refuses: no bearer (401), an SVG (415),
 *      3 MB (413); and that a PUT whose length differs from the declared
 *      size is refused by storage (the upload target pins content-length),
 *   3. uploads a PNG avatar through POST <package>/media/uploads + its target,
 *      then checks storage refuses tampered PUTs to a fresh target (extra
 *      bytes, wrong x-amz-checksum-sha256, different Content-Type),
 *   4. saves displayName, a fresh handle, bio, links and the avatar with ONE
 *      signed renown_upsertProfile, and waits for the read model,
 *   5. checks INVALID_AVATAR (a ref never uploaded) and HANDLE_TAKEN (a second
 *      wallet asking for the same handle),
 *   6. probes (report only) that a second identity cannot edit the profile
 *      through the generic reactor mutation (mutateDocument on /graphql/r);
 *      prints PROBE_BYPASS_POSSIBLE if it can,
 *   7. follows GET <package>/media/<doc>/avatar (302, cache policy) to the
 *      image and compares its sha256, then renown.id's /media, /@handle and
 *      /profile/<doc> → /@handle,
 *   8. releases the handle and avatar again and revokes the throwaway
 *      credentials (also when a step failed).
 *
 * Refuses a non-staging switchboard unless --allow-prod. Never prints keys,
 * bearers or presigned URLs. Exits 1 on any failure.
 */
import {
  DEFAULT_RENOWN_CHAIN_ID,
  MemoryKeyStorage,
  RenownCryptoBuilder,
  buildAndSignCredential,
} from "@renown/sdk";
import { createHash } from "node:crypto";
import { crc32, deflateSync } from "node:zlib";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import type * as SignedMessageModule from "../../subgraphs/renown-auth/core/signed-message.js";

// Imported by URL so Node's type stripping can load the .ts file; typed from the module itself.
const SIGNED_MESSAGE = new URL("../../subgraphs/renown-auth/core/signed-message.ts", import.meta.url).href;

const STAGING_SWITCHBOARD = "https://switchboard.renown-staging.vetra.io";
const STAGING_APP = "https://renown-staging.vetra.io";
const PACKAGE = "/api/@powerhousedao/renown-package";
const APP_NAME = "renown-identity-smoke";

class SmokeFailure extends Error {}

/** A GraphQL endpoint answered with something that is not JSON. */
class HttpFailure extends SmokeFailure {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

interface Args {
  switchboard: string;
  app: string;
  allowProd: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { switchboard: STAGING_SWITCHBOARD, app: STAGING_APP, allowProd: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new SmokeFailure(`${arg} needs a URL`);
      return v;
    };
    if (arg === "--switchboard") args.switchboard = value();
    else if (arg === "--app") args.app = value();
    else if (arg === "--allow-prod") args.allowProd = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("usage: identity-profile.ts [--switchboard <url>] [--app <url>] [--allow-prod]");
      process.exit(0);
    } else throw new SmokeFailure(`unknown argument: ${arg}`);
  }
  args.switchboard = args.switchboard.replace(/\/+$/, "").replace(/\/graphql$/, "");
  args.app = args.app.replace(/\/+$/, "");
  if (!args.allowProd && !isStagingSwitchboard(args.switchboard)) {
    throw new SmokeFailure(`${args.switchboard} is not a staging switchboard; pass --allow-prod to run against it`);
  }
  return args;
}

/** True for staging hosts (`*-staging.*` / `*.renown-staging.*`) and loopback (as attachment-upload.ts). */
function isStagingSwitchboard(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return false;
  }
  return /(^|[.-])staging([.-]|$)/.test(host) || host === "localhost" || host === "127.0.0.1";
}

function step(label: string, detail = ""): void {
  console.log(`[smoke] ${label}${detail ? ` ${detail}` : ""}`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

function clip(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const sha256Base64 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("base64");
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A solid-color RGB PNG, built in-process. */
function solidPng(size: number, rgb: [number, number, number]): Uint8Array<ArrayBuffer> {
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
  ihdr[8] = 8;
  ihdr[9] = 2;
  const row = Buffer.alloc(1 + size * 3);
  for (let x = 0; x < size; x++) row.set(rgb, 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: size }, () => row));
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const randomRgb = (): [number, number, number] => [0, 1, 2].map(() => Math.floor(Math.random() * 256)) as [number, number, number];

interface GraphqlResult<T> {
  /** HTTP status of the response. */
  status?: number;
  data?: T;
  errors?: { message: string; extensions?: { code?: string; field?: string } }[];
}

async function graphql<T>(switchboard: string, query: string, variables: unknown, options: { path?: string; bearer?: string } = {}): Promise<GraphqlResult<T>> {
  const res = await fetch(`${switchboard}${options.path ?? "/graphql"}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(options.bearer ? { authorization: `Bearer ${options.bearer}` } : {}) },
    body: JSON.stringify({ query, variables }),
  });
  const text = await res.text();
  try {
    return { ...(JSON.parse(text) as GraphqlResult<T>), status: res.status };
  } catch {
    throw new HttpFailure(res.status, `GraphQL HTTP ${res.status}: ${clip(text)}`);
  }
}

function data<T>(result: GraphqlResult<T>, what: string): T {
  if (result.errors?.length || !result.data) throw new SmokeFailure(`${what}: ${JSON.stringify(result.errors ?? result)}`);
  return result.data;
}

const ISSUE_CREDENTIAL = `mutation IssueCredential($input: RenownCredential_InitInput!) { renown_issueCredential(input: $input) }`;
const REVOKE_CREDENTIAL = `mutation Revoke($credentialId: String!, $signature: String, $timestamp: String) {
  renown_revokeCredential(credentialId: $credentialId, signature: $signature, timestamp: $timestamp)
}`;
const UPSERT = `mutation Upsert($address: String!, $displayName: String, $handle: String, $bio: String,
  $links: [RenownProfileLinkInput!], $avatar: String, $signature: String, $timestamp: String) {
  renown_upsertProfile(address: $address, displayName: $displayName, handle: $handle, bio: $bio,
    links: $links, avatar: $avatar, signature: $signature, timestamp: $timestamp)
}`;
const BY_HANDLE = `query ByHandle($handle: String!) {
  renownUser(input: { handle: $handle }) { documentId handle displayName bio avatar links { id label url } }
}`;
const MUTATE_DOCUMENT = `mutation Mutate($id: String!, $actions: [JSONObject!]!) {
  mutateDocument(documentIdentifier: $id, actions: $actions) { id }
}`;

interface Credential {
  account: PrivateKeyAccount;
  credentialId: string;
}

interface Identity extends Credential {
  bearer: string;
}

/** Throwaway wallet + app did:key, a stored delegation credential, and a bearer for it. */
async function identity(switchboard: string, onIssued: (credential: Credential) => void): Promise<Identity> {
  const account = privateKeyToAccount(generatePrivateKey());
  // @renown/sdk 6.2.3 ships DEFAULT_RENOWN_CHAIN_ID as the string "1".
  const chainId = Number(DEFAULT_RENOWN_CHAIN_ID);
  const crypto = await new RenownCryptoBuilder().withKeyPairStorage(new MemoryKeyStorage()).withChainId(chainId).build();
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
    credentialSubject: { id: vc.credentialSubject.id, app: vc.credentialSubject.app },
    credentialSchema: { id: vc.credentialSchema.id, type: vc.credentialSchema.type },
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
        domain: { version: vc.proof.eip712.domain.version, chainId: Number(vc.proof.eip712.domain.chainId) },
        primaryType: "VerifiableCredential",
      },
    },
  };
  data(await graphql<{ renown_issueCredential: string }>(switchboard, ISSUE_CREDENTIAL, { input }), "renown_issueCredential");
  onIssued({ account, credentialId: vc.id }); // recorded before anything else can fail, so it is always revoked
  const bearer = await crypto.getBearerToken(account.address, { expiresIn: 600 });
  return { account, bearer, credentialId: vc.id };
}

/** Revokes the throwaway credential with its wallet's signature; false if that failed. */
async function revoke(switchboard: string, account: PrivateKeyAccount, credentialId: string): Promise<boolean> {
  try {
    const { revokeMessage } = (await import(SIGNED_MESSAGE)) as typeof SignedMessageModule;
    const timestamp = new Date().toISOString();
    const signature = await account.signMessage({ message: revokeMessage(credentialId, timestamp) });
    data(await graphql<{ renown_revokeCredential: boolean }>(switchboard, REVOKE_CREDENTIAL, { credentialId, signature, timestamp }), "renown_revokeCredential");
    step("credential revoked");
    return true;
  } catch (error) {
    console.error(`[smoke] WARNING: could not revoke the throwaway credential: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function reserve(switchboard: string, bearer: string | null, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${switchboard}${PACKAGE}/media/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
}

interface Reservation {
  ref: string;
  deduped?: boolean;
  uploadTarget?: { url: string; method: "PUT"; headers: Record<string, string> } | null;
}

/** Reserves `bytes` (retrying while the fresh credential reaches the read model) and returns the reservation. */
async function reservePng(switchboard: string, bearer: string, bytes: Uint8Array, sizeBytes = bytes.length): Promise<Reservation> {
  const body = { purpose: "avatar", mimeType: "image/png", sizeBytes, sha256: sha256(bytes) };
  for (let attempt = 1; attempt <= 10; attempt++) {
    const res = await reserve(switchboard, bearer, body);
    const text = await res.text();
    if (res.status === 201 || res.status === 200) return JSON.parse(text) as Reservation;
    if (res.status !== 401) throw new SmokeFailure(`reserve -> HTTP ${res.status}: ${clip(text)}`);
    step("reserve", `401 (attempt ${attempt}/10, waiting for the read model)`);
    await sleep(2000);
  }
  throw new SmokeFailure("reserve kept answering 401");
}

async function signedUpsert(
  switchboard: string,
  account: PrivateKeyAccount,
  fields: Record<string, unknown>,
): Promise<GraphqlResult<{ renown_upsertProfile: string }>> {
  const { profileMessage } = (await import(SIGNED_MESSAGE)) as typeof SignedMessageModule;
  const timestamp = new Date().toISOString();
  const signature = await account.signMessage({ message: await profileMessage(account.address, fields, timestamp) });
  return graphql(switchboard, UPSERT, { address: account.address, ...fields, signature, timestamp });
}

async function main(): Promise<void> {
  const { switchboard, app } = parseArgs(process.argv.slice(2));
  step("switchboard", switchboard);
  step("app", app);

  const issued: Credential[] = [];
  const onIssued = (credential: Credential) => issued.push(credential);
  try {
    const first = await identity(switchboard, onIssued);
    step("wallet", first.account.address);
    await run(switchboard, app, first, () => identity(switchboard, onIssued));
  } finally {
    const results: boolean[] = [];
    for (const id of issued) results.push(await revoke(switchboard, id.account, id.credentialId));
    if (results.includes(false)) {
      console.error("[smoke] WARNING: at least one credential was not revoked");
      process.exitCode = 1;
    }
  }
  if (process.exitCode) throw new SmokeFailure("credential was not revoked");
  console.log("OK");
}

/** PUTs to an upload target with one thing tampered; storage must refuse (non-2xx). */
async function tamperedPuts(switchboard: string, bearer: string): Promise<void> {
  const bytes = solidPng(64, randomRgb());
  const reservation = await reservePng(switchboard, bearer, bytes);
  if (!reservation.uploadTarget || reservation.deduped) {
    step("tampered PUTs", "skipped (no fresh S3 upload target)");
    return;
  }
  const { url, headers } = reservation.uploadTarget;
  const wrongChecksum = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k, k.toLowerCase() === "x-amz-checksum-sha256" ? sha256Base64(Buffer.from("not the avatar")) : v]),
  );
  const wrongType = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, k.toLowerCase() === "content-type" ? "text/html" : v]));
  const hasChecksum = Object.keys(headers).some((k) => k.toLowerCase() === "x-amz-checksum-sha256");
  const cases: [string, Record<string, string>, Uint8Array][] = [["extra bytes", headers, new Uint8Array([...bytes, 0])]];
  if (hasChecksum) cases.push(["wrong checksum", wrongChecksum, bytes]);
  else step("tampered PUT", "wrong checksum: skipped (no checksum header to tamper)");
  cases.push(["wrong content-type", wrongType, bytes]);
  for (const [label, h, body] of cases) {
    const put = await fetch(url, { method: "PUT", headers: h, body: body as Uint8Array<ArrayBuffer> });
    step("tampered PUT", `${label}: HTTP ${put.status}`);
    check(!put.ok, `storage accepted a PUT with ${label}`);
  }
}

const AUTH_MESSAGE = /unauthori[sz]ed|forbidden|permission|not allowed/i;

type Verdict = { kind: "ok" } | { kind: "auth"; detail: string } | { kind: "other"; detail: string };

/** Runs mutateDocument as `bearer` and classifies the outcome: accepted, refused for authorization, or something else. */
async function mutate(switchboard: string, bearer: string, documentId: string, actions: unknown[]): Promise<Verdict> {
  let res: GraphqlResult<{ mutateDocument: { id: string } }>;
  try {
    res = await graphql(switchboard, MUTATE_DOCUMENT, { id: documentId, actions }, { path: "/graphql/r", bearer });
  } catch (error) {
    const detail = error instanceof Error ? clip(error.message) : String(error);
    if (error instanceof HttpFailure && (error.status === 401 || error.status === 403)) return { kind: "auth", detail };
    return { kind: "other", detail };
  }
  if (res.data?.mutateDocument && !res.errors?.length) return { kind: "ok" };
  const detail = clip(JSON.stringify(res.errors ?? res));
  const code = res.errors?.[0]?.extensions?.code;
  const message = res.errors?.map((e) => e.message).join(" ") ?? "";
  if (res.status === 401 || res.status === 403 || code === "UNAUTHENTICATED" || code === "FORBIDDEN" || AUTH_MESSAGE.test(message)) {
    return { kind: "auth", detail: `HTTP ${res.status ?? "?"} ${detail}` };
  }
  return { kind: "other", detail: `HTTP ${res.status ?? "?"} ${detail}` };
}

/** Polls until the bearer is accepted (the gated reserve route stops answering 401); false on timeout. */
async function waitForBearer(switchboard: string, bearer: string): Promise<boolean> {
  const body = { purpose: "avatar", mimeType: "image/png", sizeBytes: 3 * 1024 * 1024, sha256: "0".repeat(64) };
  for (let attempt = 1; attempt <= 15; attempt++) {
    if ((await reserve(switchboard, bearer, body)).status !== 401) return true;
    await sleep(2000);
  }
  return false;
}

/**
 * Probe only: can a second identity edit the first profile through the generic reactor mutation?
 * A positive control (the owner with a harmless action) shows whether the query shape is accepted at all.
 */
async function bypassProbe(switchboard: string, documentId: string, owner: Identity, attacker: Identity, handle: string, avatar: string): Promise<void> {
  const inconclusive = (reason: string) => console.error(`PROBE_INCONCLUSIVE: ${reason}`);
  if (!(await waitForBearer(switchboard, attacker.bearer))) return inconclusive("the second credential was never accepted (401), so its refusal proves nothing");

  const control = await mutate(switchboard, owner.bearer, documentId, [{ type: "SET_BIO", input: { bio: "Created by scripts/smoke/identity-profile.ts" }, scope: "global" }]);
  if (control.kind === "ok") step("bypass probe control", "mutateDocument shape accepted for the owner");
  else if (control.kind === "other") return inconclusive(`positive control failed for a non-auth reason, the query shape is unproven: ${control.detail}`);
  else step("bypass probe control", `owner also refused by authorization (generic path closed to everyone): ${control.detail}`);

  const hijacked = "hijacked-by-smoke";
  const verdict = await mutate(switchboard, attacker.bearer, documentId, [
    { type: "SET_HANDLE", input: { handle: hijacked }, scope: "global" },
    { type: "SET_AVATAR", input: { avatar: "" }, scope: "global" },
  ]);
  if (verdict.kind === "auth") return step("bypass probe", `REFUSED: ${verdict.detail}`);
  if (verdict.kind === "other") return inconclusive(verdict.detail);

  console.error("PROBE_BYPASS_POSSIBLE: a second identity mutated the profile through /graphql/r mutateDocument");
  type Indexed = { documentId: string; avatar: string | null } | null;
  const lookup = async (h: string) => data(await graphql<{ renownUser: Indexed }>(switchboard, BY_HANDLE, { handle: h }), "renownUser").renownUser;
  for (let attempt = 1; attempt <= 8; attempt++) {
    await sleep(1500);
    const original = await lookup(handle);
    const moved = await lookup(hijacked);
    const changed = [
      original?.documentId !== documentId ? "handle (original no longer resolves)" : null,
      moved?.documentId === documentId ? "handle (hijacked resolves)" : null,
      (moved ?? original)?.avatar !== avatar ? "avatar" : null,
    ].filter(Boolean);
    if (changed.length || attempt === 8) {
      console.error(`PROBE_BYPASS_POSSIBLE: read model shows changed fields: ${changed.length ? changed.join(", ") : "none yet"}`);
      return;
    }
  }
}

async function run(switchboard: string, app: string, owner: Identity, secondIdentity: () => Promise<Identity>): Promise<void> {
  const { account, bearer } = owner;
  // 2. The upload route's gates.
  const png = solidPng(64, randomRgb());
  const valid = { purpose: "avatar", mimeType: "image/png", sizeBytes: png.length, sha256: sha256(png) };
  check((await reserve(switchboard, null, valid)).status === 401, "anonymous upload was not refused with 401");
  check((await reserve(switchboard, bearer, { ...valid, mimeType: "image/svg+xml" })).status === 415, "SVG was not refused with 415");
  check((await reserve(switchboard, bearer, { ...valid, sizeBytes: 3 * 1024 * 1024 })).status === 413, "3 MB was not refused with 413");
  step("gates", "401 / 415 / 413 as expected");

  const liar = solidPng(64, randomRgb());
  const lie = await reservePng(switchboard, bearer, liar, liar.length + 1);
  if (lie.uploadTarget) {
    const put = await fetch(lie.uploadTarget.url, { method: "PUT", headers: lie.uploadTarget.headers, body: liar });
    check(!put.ok, `storage accepted ${liar.length} bytes for a reservation of ${liar.length + 1} (content-length not pinned)`);
    step("length pinning", `PUT refused with HTTP ${put.status}`);
  } else {
    step("length pinning", "skipped (filesystem backend)");
  }

  // 3. Upload the avatar.
  const reservation = await reservePng(switchboard, bearer, png);
  check(reservation.ref === `attachment://v1:${sha256(png)}`, `unexpected ref ${reservation.ref}`);
  if (!reservation.deduped) {
    check(reservation.uploadTarget, "no uploadTarget (expected an S3 backend)");
    const put = await fetch(reservation.uploadTarget.url, { method: "PUT", headers: reservation.uploadTarget.headers, body: png });
    check(put.ok, `upload PUT -> HTTP ${put.status}: ${clip(await put.text())}`);
  }
  step("uploaded", reservation.ref);
  await tamperedPuts(switchboard, bearer);

  // 4. One signed save of every identity field.
  const handle = `smoke-${Math.random().toString(36).slice(2, 8)}`;
  const fields = {
    displayName: "Smoke Test",
    handle,
    bio: "Created by scripts/smoke/identity-profile.ts",
    links: [{ id: "smoke-link", label: "Renown", url: "https://renown.id" }],
    avatar: reservation.ref,
  };
  const documentId = data(await signedUpsert(switchboard, account, fields), "renown_upsertProfile").renown_upsertProfile;
  step("saved", `doc=${documentId} handle=@${handle}`);

  type Indexed = { documentId: string; avatar: string | null } | null;
  const readBack = async (): Promise<Indexed> =>
    data(await graphql<{ renownUser: Indexed }>(switchboard, BY_HANDLE, { handle }), "renownUser").renownUser;
  let indexed = await readBack();
  for (let attempt = 1; attempt <= 15 && indexed?.avatar !== reservation.ref; attempt++) {
    await sleep(1000);
    indexed = await readBack();
  }
  check(indexed?.documentId === documentId && indexed.avatar === reservation.ref, "read model never showed the saved profile");
  step("read model", "renownUser(handle) returns the profile");

  // 5. Validation on the write path.
  const ghost = `attachment://v1:${sha256(solidPng(8, randomRgb()))}`;
  const invalid = await signedUpsert(switchboard, account, { avatar: ghost });
  check(invalid.errors?.[0]?.extensions?.code === "INVALID_AVATAR", `expected INVALID_AVATAR, got ${JSON.stringify(invalid.errors ?? invalid.data)}`);
  const other = privateKeyToAccount(generatePrivateKey());
  const taken = await signedUpsert(switchboard, other, { handle: handle.toUpperCase() });
  check(taken.errors?.[0]?.extensions?.code === "HANDLE_TAKEN", `expected HANDLE_TAKEN, got ${JSON.stringify(taken.errors ?? taken.data)}`);
  step("validation", "INVALID_AVATAR and HANDLE_TAKEN as expected");

  // 6. Probe: the generic reactor mutation must not let another identity edit the profile.
  await bypassProbe(switchboard, documentId, owner, await secondIdentity(), handle, reservation.ref);

  // 7. Public media and pages.
  const media = await fetch(`${switchboard}${PACKAGE}/media/${documentId}/avatar`, { redirect: "manual" });
  check(media.status === 302, `media route -> HTTP ${media.status}`);
  check(media.headers.get("cache-control") === "public, max-age=60, stale-while-revalidate=240", `media cache-control ${media.headers.get("cache-control")}`);
  const image = await fetch(media.headers.get("location") ?? "");
  const bytes = new Uint8Array(await image.arrayBuffer());
  check(image.ok && sha256(bytes) === sha256(png), `media target -> HTTP ${image.status}, sha256 ${sha256(bytes)}`);
  step("media", "302 → image bytes match");

  const appMedia = await fetch(`${app}/media/${documentId}/avatar`, { redirect: "manual" });
  check(appMedia.status === 302, `${app}/media -> HTTP ${appMedia.status}`);
  const page = await fetch(`${app}/@${handle}`);
  check(page.ok && (await page.text()).includes("Smoke Test"), `${app}/@${handle} -> HTTP ${page.status}`);
  const legacy = await fetch(`${app}/profile/${documentId}`, { redirect: "manual" });
  check(legacy.status === 307 && legacy.headers.get("location")?.endsWith(`/@${handle}`), `${app}/profile/<doc> -> HTTP ${legacy.status} ${legacy.headers.get("location")}`);
  step("renown.id", "/media 302, /@handle 200, /profile/<doc> → /@handle");

  // 8. Release the handle and avatar.
  data(await signedUpsert(switchboard, account, { displayName: "", bio: "", links: [], handle: "", avatar: "" }), "cleanup upsert");
  step("cleanup", "identity fields cleared");

  console.log("");
  console.log(`address: ${account.address}`);
  console.log(`profile: ${documentId}`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[smoke] FAILED: ${message}`);
  process.exit(1);
});
