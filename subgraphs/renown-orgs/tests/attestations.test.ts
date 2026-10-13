import { verifyTypedData } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_DOMAIN, RELEASE_PRIMARY_TYPE, RELEASE_TYPES, releaseTypedData, type ReleaseMessage } from "../../../sdk/orgs.js";
import { ATTESTATION_MAX_AGE_MS, ATTESTATION_FUTURE_SKEW_MS } from "../areas/attestations.js";
import {
  ALICE,
  BOB,
  CAROL,
  createOrg,
  DAVE,
  failure,
  harnessResolvers,
  insertAppProfile,
  join,
  lower,
  openHarness,
  resetHarness,
  STATS_NS,
  T0,
  type Harness,
  type TestResolvers,
} from "./harness.js";

const onChain = vi.hoisted(() => ({ verifyTypedDataOnChain: vi.fn((_: unknown) => Promise.resolve(false)) }));
vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: onChain.verifyTypedDataOnChain,
}));

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const DIGEST = `sha256:${"ab".repeat(32)}`;
type Account = typeof ALICE;
interface Attestation {
  id: string;
  appDid: string;
  artifactDigest: string;
  signature: string;
  orgId: string;
  signer: string;
  signerRole: string | null;
  signerStillMember: boolean;
  version: string;
  issuedAt: string;
  createdAt: string;
}
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
  onChain.verifyTypedDataOnChain.mockReset();
  onChain.verifyTypedDataOnChain.mockResolvedValue(false);
});

function release(t: TestResolvers, over: Partial<ReleaseMessage> = {}): ReleaseMessage {
  return { appDid: APP, version: "1.4.0", artifactDigest: DIGEST, orgId: "", issuedAt: t.clock.now.toISOString(), ...over };
}

async function attest(t: TestResolvers, who: Account, over: Partial<ReleaseMessage> = {}, signer: Account = who) {
  const message = release(t, over);
  const signature = await who.signTypedData({ domain: RELEASE_DOMAIN, types: RELEASE_TYPES, primaryType: RELEASE_PRIMARY_TYPE, message });
  return t.mutate<Attestation>("attestRelease", { ...message, signer: signer.address, signature });
}

/** acme owns APP; BOB publishes it, CAROL is a plain member. */
async function orgOwned() {
  const t = harnessResolvers(h);
  await insertAppProfile(h, t, APP, lower(ALICE));
  const { id } = await createOrg(t, ALICE, "acme");
  await join(t, id, BOB, "PUBLISHER");
  await join(t, id, CAROL, "MEMBER");
  await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: false, appDids: [APP] } }, ALICE);
  await h.root.withSchema(STATS_NS).updateTable("app_profile_documents").set({ publisher_org_id: id }).execute();
  await t.store.insertOrgApp({ appDid: APP, orgId: id, frozen: false, addedAt: T0 });
  return { t, id };
}

describe("release attestations", () => {
  it("stores a publisher's signed attestation with the role at signing, idempotently", async () => {
    const { t, id } = await orgOwned();
    const stored = await attest(t, BOB, { orgId: id });
    expect(stored).toMatchObject({ orgId: id, signer: lower(BOB), signerRole: "PUBLISHER", signerStillMember: true, version: "1.4.0" });
    expect(stored.issuedAt).toBe(T0.toISOString());
    expect((await attest(t, BOB, { orgId: id })).id).toBe(stored.id);
    // The same signature in upper-case hex is the same submission.
    const message = release(t, { orgId: id });
    expect((await t.mutate<Attestation>("attestRelease", { ...message, signer: BOB.address, signature: `0x${stored.signature.slice(2).toUpperCase()}` })).id).toBe(stored.id);
    t.tick(1000);
    expect(await failure(attest(t, BOB, { orgId: id }))).toMatchObject({ code: "BAD_USER_INPUT", field: "version" });
    expect((await t.query<{ items: Attestation[] }>("releaseAttestations", { appDid: APP })).items.map((a) => a.id)).toEqual([stored.id]);
    const audit = await t.store.auditPage(id, 50);
    expect(audit.find((entry) => entry.action === "attestRelease")).toMatchObject({ actor: lower(BOB), details: { attestationId: stored.id, appDid: APP, version: "1.4.0" } });
    // A promotion later does not rewrite the role at signing.
    await t.mutate("setOrgMemberRole", { orgId: id, address: BOB.address, role: "ADMIN" }, ALICE);
    expect(await t.query("releaseAttestation", { id: stored.id })).toMatchObject({ signerRole: "PUBLISHER", signerStillMember: true });
    await t.mutate("removeOrgMember", { orgId: id, address: BOB.address }, ALICE);
    expect(await t.query("releaseAttestation", { id: stored.id })).toMatchObject({ signerRole: "PUBLISHER", signerStillMember: false });
    // Re-joining starts a new membership interval: the signer did not stay a member.
    await join(t, id, BOB, "PUBLISHER");
    expect(await t.query("releaseAttestation", { id: stored.id })).toMatchObject({ signerStillMember: false });
    expect(await t.query("releaseAttestation", { id: "nope" })).toBeNull();
  });

  it("refuses forged, unauthorised, mismatched, frozen, malformed, stale and excessive attestations", async () => {
    const { t, id } = await orgOwned();
    const now = t.clock.now.getTime();
    expect((await failure(attest(t, CAROL, { orgId: id }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(attest(t, CAROL, { orgId: id }))).code).toBe("FORBIDDEN");
    expect((await failure(attest(t, DAVE, { orgId: id }))).code).toBe("FORBIDDEN");
    expect(await failure(attest(t, BOB, { orgId: "" }))).toMatchObject({ field: "orgId" });
    expect(await failure(attest(t, BOB, { orgId: id, artifactDigest: "sha256:nope" }))).toMatchObject({ field: "artifactDigest" });
    expect(await failure(attest(t, BOB, { orgId: id, artifactDigest: `sha256:${"AB".repeat(32)}` }))).toMatchObject({ field: "artifactDigest" });
    expect(await failure(attest(t, BOB, { orgId: id, issuedAt: new Date(now + ATTESTATION_FUTURE_SKEW_MS + 60_000).toISOString() }))).toMatchObject({ field: "issuedAt" });
    expect(await failure(attest(t, BOB, { orgId: id, issuedAt: new Date(now - ATTESTATION_MAX_AGE_MS - 60_000).toISOString() }))).toMatchObject({ field: "issuedAt" });
    for (const issuedAt of ["2026-10-12", "2026-09-31T12:00:00Z", "2026-10-12T11:60:00Z", "2026-10-12T11:00:60Z", "2026-10-12T12:00:00+15:00", "2026-10-12T12:00:00+01:60"]) {
      expect(await failure(attest(t, BOB, { orgId: id, issuedAt })), issuedAt).toMatchObject({ field: "issuedAt" });
    }
    expect(await failure(attest(t, BOB, { orgId: id, version: "" }))).toMatchObject({ field: "version" });
    expect(await failure(t.mutate("attestRelease", { ...release(t, { orgId: id }), signer: "bob", signature: "0x00" }))).toMatchObject({ field: "signer" });
    expect(await failure(t.mutate("attestRelease", { ...release(t, { orgId: id }), signer: BOB.address, signature: "zz" }))).toMatchObject({ field: "signature" });
    // Within the skew and the age window.
    expect(await attest(t, BOB, { orgId: id, version: "0.9.0", issuedAt: new Date(now + 60_000).toISOString() })).toMatchObject({ version: "0.9.0" });
    expect(await attest(t, BOB, { orgId: id, version: "0.8.0", issuedAt: new Date(now - ATTESTATION_MAX_AGE_MS + 60_000).toISOString() })).toMatchObject({ version: "0.8.0" });
    await t.store.setAppFrozen(APP, true);
    expect((await failure(attest(t, BOB, { orgId: id }))).code).toBe("APP_FROZEN");
    await t.store.setAppFrozen(APP, false);
    for (let i = 0; i < 98; i++) {
      await t.store.insertAttestation({
        id: `x${i}`,
        appDid: APP,
        version: `0.0.${i}`,
        artifactDigest: DIGEST,
        orgId: id,
        signer: lower(ALICE),
        signerRole: "OWNER",
        issuedAt: t.clock.now.toISOString(),
        signature: "0x",
        createdAt: t.clock.now,
      });
    }
    expect((await failure(attest(t, BOB, { orgId: id }))).code).toBe("LIMIT_REACHED");
    // Authorisation comes first: an outsider is refused, not told the app is saturated.
    expect((await failure(attest(t, CAROL, { orgId: id }))).code).toBe("FORBIDDEN");
    // The window is a rolling day.
    t.tick(86_400_001);
    expect(await attest(t, BOB, { orgId: id })).toMatchObject({ signerRole: "PUBLISHER" });
  });

  it("refuses attestations for an organisation that is taken down", async () => {
    const { t, id } = await orgOwned();
    await t.store.updateOrganization(id, { takenDown: true }, T0);
    expect((await failure(attest(t, BOB, { orgId: id }))).code).toBe("FORBIDDEN");
  });

  it("accepts a smart-wallet signature proven on chain", async () => {
    const { t, id } = await orgOwned();
    onChain.verifyTypedDataOnChain.mockResolvedValue(true);
    const message = release(t, { orgId: id });
    const stored = await t.mutate<Attestation>("attestRelease", { ...message, signer: BOB.address, signature: `0x${"12".repeat(100)}` });
    expect(stored).toMatchObject({ signer: lower(BOB), signerRole: "PUBLISHER" });
    expect(onChain.verifyTypedDataOnChain.mock.calls.at(-1)?.[0]).toMatchObject({ chainId: 1, address: lower(BOB), typedData: { domain: RELEASE_DOMAIN, message } });
  });

  it("accepts the publisher of a person-owned app with an empty orgId", async () => {
    const t = harnessResolvers(h);
    await insertAppProfile(h, t, APP, lower(ALICE));
    const stored = await attest(t, ALICE);
    expect(stored).toMatchObject({ orgId: "", signerRole: null, signerStillMember: true });
    expect(await failure(attest(t, ALICE, { orgId: "o1", version: "2.0.0" }))).toMatchObject({ field: "orgId" });
    expect((await failure(attest(t, BOB, { version: "2.0.0" }))).code).toBe("FORBIDDEN");
    expect(
      (await failure(t.mutate("attestRelease", { ...release(t, { appDid: "did:key:z6MkNope" }), signer: ALICE.address, signature: "0x00" }))).field,
    ).toBe("appDid");
    expect(
      (await failure(t.mutate("attestRelease", { ...release(t, { appDid: "did:web:example.com" }), signer: ALICE.address, signature: "0x00" }))).field,
    ).toBe("appDid");
    // Once the app moves to another publisher, the signer is no longer its publisher.
    await h.root.withSchema(STATS_NS).updateTable("app_profile_documents").set({ publisher_address: lower(BOB) }).execute();
    expect(await t.query("releaseAttestation", { id: stored.id })).toMatchObject({ signerStillMember: false });
  });

  it("pages newest first with an opaque cursor", async () => {
    const t = harnessResolvers(h);
    await insertAppProfile(h, t, APP, lower(ALICE));
    for (const version of ["1", "2", "3"]) {
      await attest(t, ALICE, { version });
      t.tick(1000);
    }
    const first = await t.query<{ items: Attestation[]; next: string | null }>("releaseAttestations", { appDid: APP, limit: 2 });
    expect(first.items.map((a) => a.version)).toEqual(["3", "2"]);
    const second = await t.query<{ items: Attestation[]; next: string | null }>("releaseAttestations", { appDid: APP, limit: 2, after: first.next });
    expect(second).toMatchObject({ next: null });
    expect(second.items.map((a) => a.version)).toEqual(["1"]);
    expect(await failure(t.query("releaseAttestations", { appDid: APP, limit: 0 }))).toMatchObject({ field: "limit" });
    expect(await failure(t.query("releaseAttestations", { appDid: APP, limit: 51 }))).toMatchObject({ field: "limit" });
    expect(await failure(t.query("releaseAttestations", { appDid: APP, after: "garbage" }))).toMatchObject({ field: "after" });
    const noId = Buffer.from(JSON.stringify({ c: T0.toISOString() })).toString("base64url");
    expect(await failure(t.query("releaseAttestations", { appDid: APP, after: noId }))).toMatchObject({ field: "after" });
    expect((await t.query<{ items: Attestation[] }>("releaseAttestations", { appDid: "did:key:zOther" })).items).toEqual([]);
  });

  it("keeps issuedAt exactly as signed, so the stored attestation verifies against its own signature", async () => {
    const t = harnessResolvers(h);
    await insertAppProfile(h, t, APP, lower(ALICE));
    const issuedAt = "2026-10-12T14:00:00.123456+02:00";
    const stored = await attest(t, ALICE, { issuedAt });
    const read = await t.query<Attestation>("releaseAttestation", { id: stored.id });
    expect(read.issuedAt).toBe(issuedAt);
    const fields: ReleaseMessage = { appDid: read.appDid, version: read.version, artifactDigest: read.artifactDigest, orgId: read.orgId, issuedAt: read.issuedAt };
    expect(await verifyTypedData({ ...releaseTypedData(fields), address: ALICE.address, signature: read.signature as `0x${string}` })).toBe(true);
  });

  it("throttles its public reads and writes per client", async () => {
    const t = harnessResolvers(h, { readLimiter: { take: () => false } });
    expect((await failure(t.query("releaseAttestations", { appDid: APP }))).code).toBe("RATE_LIMITED");
    expect((await failure(t.query("releaseAttestation", { id: "x" }))).code).toBe("RATE_LIMITED");
    expect((await failure(attest(t, ALICE))).code).toBe("RATE_LIMITED");
  });
});
