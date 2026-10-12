import { isOrgAppDid } from "../../../document-models/renown-organization/index.js";
import type { ReleaseMessage } from "../../../sdk/orgs.js";
import { currentOwner } from "../core/app-ownership.js";
import { verifyRelease } from "../core/attestation.js";
import type { OrgContext } from "../core/auth.js";
import { hasAppCapability, requireOrg } from "../core/authz.js";
import { badInput, forbidden, limitReached, orgError } from "../core/errors.js";
import { iso } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { AttestationCursor, AttestationRecord } from "../store/types.js";
import { addressArg } from "./members.js";

/** At most this many attestations per app in any rolling 24 hours. */
export const MAX_ATTESTATIONS_PER_DAY = 100;
/** issuedAt may run this far ahead of the server's clock (client clock skew). */
export const ATTESTATION_FUTURE_SKEW_MS = 5 * 60_000;
/** issuedAt may be at most this old when submitted: a signed attestation cannot be banked for long. */
export const ATTESTATION_MAX_AGE_MS = 30 * 86_400_000;
const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const STRICT_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-](\d{2}):(\d{2}))$/;
/** Hex bytes; smart-wallet (ERC-6492) signatures can be long, but not unbounded. */
const SIGNATURE_RE = /^0x(?:[0-9a-fA-F]{2}){1,8192}$/;

export interface ReleaseAttestationOutput {
  id: string;
  appDid: string;
  version: string;
  artifactDigest: string;
  orgId: string;
  signer: string;
  signerRole: AttestationRecord["signerRole"];
  signerStillMember: boolean;
  issuedAt: string;
  signature: string;
  createdAt: string;
}

/**
 * Whether each signer still stands where they stood when their attestation
 * was accepted, keyed by attestation id. Organisation apps: the membership
 * interval that covered the acceptance is still open (ACTIVE, joined at or
 * before it; a member who left and re-joined started a new interval, so no).
 * Person apps: the signer is still the app's personal publisher. One members
 * read per organisation and one owner read per app, however long the list.
 */
async function standing(
  rt: OrgRuntime,
  list: readonly AttestationRecord[],
): Promise<Map<string, boolean>> {
  const store = rt.store();
  const orgIds = [...new Set(list.filter((a) => a.orgId).map((a) => a.orgId))];
  const personApps = [
    ...new Set(list.filter((a) => !a.orgId).map((a) => a.appDid)),
  ];
  const [members, owners] = await Promise.all([
    Promise.all(
      orgIds.map(
        async (orgId) =>
          [
            orgId,
            new Map(
              (await store.members(orgId, ["ACTIVE"])).map((m) => [
                m.address,
                m,
              ]),
            ),
          ] as const,
      ),
    ),
    Promise.all(
      personApps.map(
        async (appDid) => [appDid, await currentOwner(rt, appDid)] as const,
      ),
    ),
  ]);
  const activeByOrg = new Map(members);
  const ownerByApp = new Map(owners);
  return new Map(
    list.map((a) => {
      if (a.orgId) {
        const member = activeByOrg.get(a.orgId)?.get(a.signer);
        return [
          a.id,
          member?.joinedAt != null &&
            member.joinedAt.getTime() <= a.createdAt.getTime(),
        ];
      }
      const owner = ownerByApp.get(a.appDid);
      return [a.id, owner?.kind === "PERSON" && owner.address === a.signer];
    }),
  );
}

async function attestationOutputs(
  rt: OrgRuntime,
  list: readonly AttestationRecord[],
): Promise<ReleaseAttestationOutput[]> {
  const still = await standing(rt, list);
  return list.map((a) => ({
    id: a.id,
    appDid: a.appDid,
    version: a.version,
    artifactDigest: a.artifactDigest,
    orgId: a.orgId,
    signer: a.signer,
    signerRole: a.signerRole,
    signerStillMember: still.get(a.id) ?? false,
    issuedAt: a.issuedAt,
    signature: a.signature,
    createdAt: iso(a.createdAt),
  }));
}

async function attestationOutput(
  rt: OrgRuntime,
  a: AttestationRecord,
): Promise<ReleaseAttestationOutput> {
  return (await attestationOutputs(rt, [a]))[0];
}

function encodeCursor(a: AttestationRecord): string {
  return Buffer.from(JSON.stringify({ c: iso(a.createdAt), i: a.id })).toString(
    "base64url",
  );
}

function decodeCursor(raw: string): AttestationCursor {
  try {
    const cursor = JSON.parse(
      Buffer.from(raw, "base64url").toString("utf8"),
    ) as { c?: unknown; i?: unknown };
    const createdAt =
      typeof cursor.c === "string" ? new Date(cursor.c) : new Date(Number.NaN);
    if (!Number.isNaN(createdAt.getTime()) && typeof cursor.i === "string")
      return { createdAt, id: cursor.i };
  } catch {
    // Falls through to the error below.
  }
  throw badInput("after", "after is not a cursor from releaseAttestations");
}

/** The instant of an ISO-8601 time with a zone whose every field is in range (no 2026-02-30 rolling over), else NaN. */
function strictIsoTime(raw: string): number {
  const match = STRICT_ISO_RE.exec(raw);
  if (!match) return Number.NaN;
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    offsetHours = "0",
    offsetMinutes = "0",
  ] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const realDay =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
  const inRange =
    Number(hour) < 24 &&
    Number(minute) < 60 &&
    Number(second) < 60 &&
    Number(offsetHours) <= 14 &&
    Number(offsetMinutes) < 60;
  return realDay && inRange ? new Date(raw).getTime() : Number.NaN;
}

/**
 * Checks issuedAt and returns it unchanged: it is stored and served exactly
 * as signed, so the stored attestation verifies against its own signature.
 */
function issuedAtArg(raw: string, now: Date): string {
  const time = strictIsoTime(raw);
  if (
    Number.isNaN(time) ||
    time > now.getTime() + ATTESTATION_FUTURE_SKEW_MS ||
    time < now.getTime() - ATTESTATION_MAX_AGE_MS
  ) {
    throw badInput(
      "issuedAt",
      "issuedAt must be a valid ISO-8601 time with a zone, at most 5 minutes ahead and at most 30 days old",
    );
  }
  return raw;
}

type AttestArgs = ReleaseMessage & { signer: string; signature: string };

export const attestationResolvers: Area = (rt) => ({
  Query: {
    releaseAttestations: async (
      _: unknown,
      args: { appDid: string; limit?: number | null; after?: string | null },
      ctx: OrgContext,
    ) => {
      rt.throttleRead(ctx);
      const limit = args.limit ?? DEFAULT_LIMIT;
      if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT)
        throw badInput(
          "limit",
          `limit must be an integer from 1 to ${MAX_LIMIT}`,
        );
      const after = args.after == null ? undefined : decodeCursor(args.after);
      const rows = await rt
        .store()
        .attestationsPage(args.appDid.trim(), limit + 1, after);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: await attestationOutputs(rt, page),
        next: rows.length > limit && last ? encodeCursor(last) : null,
      };
    },
    releaseAttestation: async (
      _: unknown,
      args: { id: string },
      ctx: OrgContext,
    ) => {
      rt.throttleRead(ctx);
      const found = await rt.store().attestation(args.id);
      return found ? attestationOutput(rt, found) : null;
    },
  },
  Mutation: {
    attestRelease: async (_: unknown, args: AttestArgs, ctx: OrgContext) => {
      // No bearer or signed auth: the attestation's own signature authenticates.
      // Throttled per client like directory reads, since a bad signature may cost an RPC call.
      rt.throttleRead(ctx);
      const now = rt.now();
      const appDid = args.appDid;
      if (!isOrgAppDid(appDid))
        throw badInput("appDid", "appDid must be a did:key");
      if (!VERSION_RE.test(args.version))
        throw badInput(
          "version",
          "version: 1-64 letters, digits, '.', '+', '_' or '-', starting with a letter or digit",
        );
      if (!DIGEST_RE.test(args.artifactDigest))
        throw badInput(
          "artifactDigest",
          "artifactDigest must be sha256:<64 lowercase hex>",
        );
      const issuedAt = issuedAtArg(args.issuedAt, now);
      const signer = addressArg("signer", args.signer);
      if (!SIGNATURE_RE.test(args.signature))
        throw badInput("signature", "signature must be 0x-prefixed hex");
      if (!(await currentOwner(rt, appDid)))
        throw badInput("appDid", "No app profile has this appDid");
      // Verified and stored exactly as sent: /verify re-checks the stored fields against the signature.
      const message: ReleaseMessage = {
        appDid,
        version: args.version,
        artifactDigest: args.artifactDigest,
        orgId: args.orgId,
        issuedAt: args.issuedAt,
      };
      if (!(await verifyRelease(signer, message, args.signature)))
        throw forbidden("The signature does not match the signer");

      return rt.lock(`app:${appDid}`, async () => {
        const store = rt.store();
        const existing = await store.attestationBy(
          appDid,
          args.version,
          signer,
        );
        if (existing) {
          // Hex case is not part of a signature.
          if (existing.signature.toLowerCase() === args.signature.toLowerCase())
            return attestationOutput(rt, existing);
          throw badInput(
            "version",
            "This signer already attested this version",
          );
        }
        // Re-read under the app lock: a transfer may have moved the app meanwhile.
        const owner = await currentOwner(rt, appDid);
        if (!owner) throw badInput("appDid", "No app profile has this appDid");
        let signerRole: AttestationRecord["signerRole"] = null;
        if (owner.kind === "ORG") {
          if (args.orgId !== owner.orgId)
            throw badInput(
              "orgId",
              "orgId must be the organization that owns the app",
            );
          await requireOrg(store, owner.orgId);
          if ((await store.orgOfApp(appDid))?.frozen)
            throw orgError(
              "APP_FROZEN",
              "The app is frozen by its organization",
            );
          if (!(await hasAppCapability(store, owner.orgId, signer, appDid)))
            throw forbidden("The signer cannot publish this app");
          signerRole =
            (await store.openMember(owner.orgId, signer))?.role ?? null;
        } else {
          if (args.orgId !== "")
            throw badInput(
              "orgId",
              "orgId must be empty for a person-owned app",
            );
          if (owner.address !== signer)
            throw forbidden("Only the app's publisher attests its releases");
        }
        // After authorisation: an outsider learns nothing about the app's volume.
        if (
          (await store.countAttestationsSince(
            appDid,
            new Date(now.getTime() - DAY_MS),
          )) >= MAX_ATTESTATIONS_PER_DAY
        ) {
          throw limitReached(
            `At most ${MAX_ATTESTATIONS_PER_DAY} attestations per app per day`,
          );
        }
        const attestation: AttestationRecord = {
          id: rt.newId(),
          appDid,
          version: args.version,
          artifactDigest: args.artifactDigest,
          orgId: args.orgId,
          signer,
          signerRole,
          issuedAt,
          signature: args.signature,
          createdAt: now,
        };
        if (!(await store.insertAttestation(attestation)))
          throw badInput(
            "version",
            "This signer already attested this version",
          );
        if (owner.kind === "ORG") {
          const data = {
            attestationId: attestation.id,
            appDid,
            version: args.version,
            artifactDigest: args.artifactDigest,
            signer,
          };
          await rt.record({
            orgId: owner.orgId,
            actor: signer,
            action: "attestRelease",
            at: now,
            details: data,
            event: { type: "release.attested", data },
          });
        }
        return attestationOutput(rt, attestation);
      });
    },
  },
});
