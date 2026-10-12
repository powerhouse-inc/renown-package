import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALICE, BOB, createOrg, failure, harnessResolvers, insertWorkload, join, lower, openHarness, resetHarness, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP_A = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const APP_B = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
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

describe("org service accounts", () => {
  it("lists the org's workload identities and lets admins disable and enable them", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const other = await createOrg(t, BOB, "other");
    await insertWorkload(h, { did: APP_A, owner: ALICE.address, ownerOrgId: id });
    await insertWorkload(h, { did: APP_B, owner: BOB.address, ownerOrgId: other.id });
    expect(await t.query("orgWorkloads", { orgId: id }, ALICE)).toEqual([
      { did: APP_A, repository: "acme/app", productionBranch: "main", ownerAddress: ALICE.address, disabled: false, createdAt: "2026-10-12T12:00:00.000Z" },
    ]);
    expect(await t.mutate("setOrgWorkloadDisabled", { orgId: id, did: APP_A, disabled: true }, ALICE)).toMatchObject({ did: APP_A, disabled: true });
    expect((await t.store.auditPage(id, 1))[0]).toMatchObject({ action: "setOrgWorkloadDisabled", actor: lower(ALICE), details: { did: APP_A, disabled: true } });
    expect((await h.root.withSchema("renown-workload").selectFrom("workload_identities").select("disabled").where("did", "=", APP_A).executeTakeFirstOrThrow()).disabled).toBe(true);
    expect((await failure(t.mutate("setOrgWorkloadDisabled", { orgId: id, did: APP_B, disabled: true }, ALICE))).code).toBe("NOT_FOUND");
    expect(await t.mutate("setOrgWorkloadDisabled", { orgId: id, did: APP_A, disabled: false }, ALICE)).toMatchObject({ did: APP_A, disabled: false });
    await join(t, id, BOB, "PUBLISHER");
    expect((await failure(t.query("orgWorkloads", { orgId: id }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("setOrgWorkloadDisabled", { orgId: id, did: APP_A, disabled: true }, BOB))).code).toBe("FORBIDDEN");
  });
});
