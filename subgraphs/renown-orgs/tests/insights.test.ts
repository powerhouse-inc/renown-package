import { getAddress } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { STATS_TTL_MS } from "../areas/insights.js";
import { ALICE, BOB, addOwner, createOrg, failure, harnessResolvers, insertCredential, join, lower, openHarness, resetHarness, STATS_NS, T0, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP_A = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const APP_B = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const DAY = 86_400_000;
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

describe("organizationStats", () => {
  it("sums the org apps' 30-day users, counting live delegations and recent attestations", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    expect(await t.query("organizationStats", { orgId: id })).toEqual({ orgId: id, apps: 0, activeUsers30d: 0, activeDelegations: 0, attestations30d: 0 });
    await join(t, id, BOB, "MEMBER");
    for (const appDid of [APP_A, APP_B]) await t.store.insertOrgApp({ appDid, orgId: id, frozen: false, addedAt: T0 });
    const value = (app: string, user: string, daysAgo: number) => ({ app_did: app, metric: "m", user_did: user, value: 1, updated_at: new Date(T0.getTime() - daysAgo * DAY) });
    await h.root
      .withSchema(STATS_NS)
      .insertInto("app_metric_values")
      .values([value(APP_A, "u1", 1), { ...value(APP_A, "u1", 1), metric: "n" }, value(APP_A, "u2", 40), value(APP_B, "u1", 2), value("did:key:zElsewhere", "u3", 1)])
      .execute();
    await insertCredential(h, { credentialId: "c1", issuer: lower(ALICE), appDid: APP_A });
    // BOB is a plain member: his delegation does not count.
    await insertCredential(h, { credentialId: "c2", issuer: lower(BOB), appDid: APP_A });
    await insertCredential(h, { credentialId: "c3", issuer: lower(ALICE), appDid: APP_B, revoked: true });
    await insertCredential(h, { credentialId: "c4", issuer: lower(ALICE), appDid: APP_B, expiresAt: new Date(T0.getTime() - DAY) });
    await insertCredential(h, { credentialId: "c5", issuer: lower(ALICE), appDid: APP_B, expiresAt: null });
    const attestation = (id_: string, version: string, createdAt: Date) => ({
      id: id_,
      appDid: APP_A,
      version,
      artifactDigest: `sha256:${"a".repeat(64)}`,
      orgId: id,
      signer: lower(ALICE),
      signerRole: "OWNER" as const,
      issuedAt: createdAt.toISOString(),
      signature: "0x",
      createdAt,
    });
    await t.store.insertAttestation(attestation("a1", "1", T0));
    await t.store.insertAttestation(attestation("a0", "0", new Date(T0.getTime() - 31 * DAY)));
    const fresh = harnessResolvers(h);
    expect(await fresh.query("organizationStats", { orgId: id })).toEqual({ orgId: id, apps: 2, activeUsers30d: 2, activeDelegations: 2, attestations30d: 1 });
    // Cached for a minute per organisation, then recomputed.
    await t.store.insertAttestation({ ...attestation("a2", "2", T0), id: "a2" });
    expect(await fresh.query("organizationStats", { orgId: id })).toMatchObject({ attestations30d: 1 });
    fresh.tick(STATS_TTL_MS);
    expect(await fresh.query("organizationStats", { orgId: id })).toMatchObject({ attestations30d: 2 });
    expect(await t.query("organizationStats", { orgId: "nope" })).toBeNull();
    await t.store.updateOrganization(id, { takenDown: true }, T0);
    expect(await t.query("organizationStats", { orgId: id })).toBeNull();
  });

  it("is throttled per client", async () => {
    const t = harnessResolvers(h, { readLimiter: { take: () => false } });
    expect((await failure(t.query("organizationStats", { orgId: "o1" }))).code).toBe("RATE_LIMITED");
  });

  it("is SERVICE_UNAVAILABLE when a read model cannot be read", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await t.store.insertOrgApp({ appDid: APP_A, orgId: id, frozen: false, addedAt: T0 });
    const broken = harnessResolvers(h, {
      relationalDb: {
        queryNamespace: () => {
          throw new Error("down");
        },
        createNamespace: () => Promise.reject(new Error("down")),
      } as never,
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect((await failure(broken.query("organizationStats", { orgId: id }))).code).toBe("SERVICE_UNAVAILABLE");
    // A failure is not cached.
    expect((await failure(broken.query("organizationStats", { orgId: id }))).code).toBe("SERVICE_UNAVAILABLE");
    expect(errors).toHaveBeenCalledTimes(2);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });
});

describe("organizationDidDocument", () => {
  it("describes the org's owners, page and verified domains; null when unknown, archived or taken down", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    const domain = (rowId: string, name: string, status: "VERIFIED" | "PENDING") => ({
      id: rowId,
      org_id: id,
      domain: name,
      token: "t",
      status,
      verified_at: T0,
      last_checked_at: T0,
      failures: 0,
      created_at: T0,
    });
    await t.store.db.insertInto("org_domains").values([domain("d1", "acme.example", "VERIFIED"), domain("d2", "pending.example", "PENDING")]).execute();
    const did = `did:web:renown.test:org:${id}`;
    const key = (address: string) => `${did}#owner-${address.toLowerCase()}`;
    expect(JSON.parse(await t.query<string>("organizationDidDocument", { orgId: id }))).toEqual({
      "@context": ["https://www.w3.org/ns/did/v1", "https://w3id.org/security/suites/secp256k1recovery-2020/v2"],
      id: did,
      alsoKnownAs: ["https://renown.test/@acme", "https://acme.example"],
      controller: [`did:pkh:eip155:1:${getAddress(ALICE.address)}`, `did:pkh:eip155:1:${getAddress(BOB.address)}`],
      verificationMethod: [
        { id: key(ALICE.address), type: "EcdsaSecp256k1RecoveryMethod2020", controller: did, blockchainAccountId: `eip155:1:${getAddress(ALICE.address)}` },
        { id: key(BOB.address), type: "EcdsaSecp256k1RecoveryMethod2020", controller: did, blockchainAccountId: `eip155:1:${getAddress(BOB.address)}` },
      ],
      authentication: [key(ALICE.address), key(BOB.address)],
      assertionMethod: [key(ALICE.address), key(BOB.address)],
      service: [
        { id: `${did}#renown`, type: "RenownOrganization", serviceEndpoint: `https://renown.test/org/${id}` },
        { id: `${did}#domains`, type: "LinkedDomains", serviceEndpoint: { origins: ["https://acme.example"] } },
      ],
    });
    expect(await t.query("organizationDidDocument", { orgId: "nope" })).toBeNull();
    await t.store.updateOrganization(id, { archived: true }, T0);
    expect(await t.query("organizationDidDocument", { orgId: id })).toBeNull();
    await t.store.updateOrganization(id, { archived: false, takenDown: true }, T0);
    expect(await t.query("organizationDidDocument", { orgId: id })).toBeNull();
  });

  it("uses the configured host (a port is percent-encoded in the DID only) and omits LinkedDomains without verified domains", async () => {
    const t = harnessResolvers(h, { config: () => ({ didHost: "localhost%3A3000", timelockSeconds: 3600, recoverySeconds: 7200, platformAdmins: new Set<string>(), trustedReadToken: null }) });
    const { id } = await createOrg(t, ALICE, "acme");
    const doc = JSON.parse(await t.query<string>("organizationDidDocument", { orgId: id })) as { id: string; alsoKnownAs: string[]; service: { type: string; serviceEndpoint: unknown }[] };
    expect(doc.id).toBe(`did:web:localhost%3A3000:org:${id}`);
    expect(doc.alsoKnownAs).toEqual(["https://localhost:3000/@acme"]);
    expect(doc.service).toEqual([{ id: `${doc.id}#renown`, type: "RenownOrganization", serviceEndpoint: `https://localhost:3000/org/${id}` }]);
  });
});
