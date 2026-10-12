import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { PGlite } from "@electric-sql/pglite";
import { Kysely } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrgPolicy, parseOrgDid } from "../core/org-policy.js";
import type { OrgTeamOutput } from "../output.js";
import { ALICE, BOB, CAROL, DAVE, createOrg, harnessResolvers, join, lower, openHarness, resetHarness, T0, type Harness } from "./harness.js";

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

describe("OrgPolicy", () => {
  it("knows org apps, roles, scopes (own and teams) and summaries", async () => {
    const t = harnessResolvers(h);
    const policy = createOrgPolicy(h.relationalDb, "renown.test");
    const { id } = await createOrg(t, ALICE, "acme", { name: "Acme" });
    await join(t, id, BOB, "PUBLISHER");
    await join(t, id, CAROL, "MEMBER");
    const later = new Date(T0.getTime() + 1000);
    expect(await policy.attachApp(id, APP_A, lower(ALICE), later)).toBe(true);
    expect(await policy.attachApp("other", APP_A, lower(ALICE), later)).toBe(false);
    expect(await policy.orgOfApp(APP_A)).toEqual({ orgId: id, frozen: false });
    expect(await policy.orgOfApp(APP_B)).toBeNull();
    expect((await t.store.auditPage(id, 1))[0]).toMatchObject({ action: "attachApp", actor: lower(ALICE), details: { appDid: APP_A } });
    expect(await policy.activeRole(id, BOB.address)).toBe("PUBLISHER");
    expect(await policy.activeRole(id, DAVE.address)).toBeNull();
    expect(await policy.coversApp(id, lower(ALICE), APP_B)).toBe(true);
    expect(await policy.coversApp(id, lower(BOB), APP_B)).toBe(false);
    const team = await t.mutate<OrgTeamOutput>("createOrgTeam", { orgId: id, slug: "b", name: "B", appDids: [APP_B] }, ALICE);
    await t.mutate("setOrgTeamMembers", { orgId: id, teamId: team.id, addresses: [BOB.address, CAROL.address] }, ALICE);
    expect(await policy.coversApp(id, lower(BOB), APP_B)).toBe(true);
    expect(await policy.coversApp(id, lower(CAROL), APP_B)).toBe(false);
    expect(await policy.orgSummary(id)).toEqual({ id, did: `did:web:renown.test:org:${id}`, handle: "acme", name: "Acme", verifiedDomains: [] });
    await t.store.updateOrganization(id, { takenDown: true }, T0);
    expect(await policy.orgSummary(id)).toBeNull();
    expect(await policy.activeRole(id, lower(BOB))).toBeNull();
    expect(await policy.coversApp(id, lower(ALICE), APP_A)).toBe(false);
  });

  it("parses org DIDs of any host", () => {
    expect(parseOrgDid("did:web:www.renown.id:org:abc-123")).toBe("abc-123");
    expect(parseOrgDid("did:web:localhost%3A3000:org:x")).toBe("x");
    expect(parseOrgDid("did:pkh:eip155:1:0x1")).toBeNull();
    expect(createOrgPolicy(h.relationalDb, "renown.test").orgDid("abc")).toBe("did:web:renown.test:org:abc");
  });

  it("reads a missing renown-orgs namespace as no organizations", async () => {
    const empty = new Kysely<any>({ dialect: new PGliteDialect(new PGlite()) });
    const db = {
      queryNamespace: (ns: string) => empty.withSchema(ns),
      createNamespace: (ns: string) => Promise.resolve(empty.withSchema(ns)),
    } as unknown as IRelationalDb<unknown>;
    const policy = createOrgPolicy(db, "renown.test");
    expect(await policy.orgOfApp(APP_A)).toBeNull();
    expect(await policy.activeRole("o", lower(ALICE))).toBeNull();
    expect(await policy.coversApp("o", lower(ALICE), APP_A)).toBe(false);
    expect(await policy.orgSummary("o")).toBeNull();
    expect(await policy.attachApp("o", APP_A, lower(ALICE), T0)).toBe(false);
    await empty.destroy();
  });
});
