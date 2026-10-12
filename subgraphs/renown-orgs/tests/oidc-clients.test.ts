import { GraphQLError } from "graphql";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createClientDirectory, createOrgClientOwners } from "../../renown-oidc/directories.js";
import { createResolvers as createOidcResolvers, REGISTRATION_TOKEN_HEADER, type ResolverDeps } from "../../renown-oidc/resolvers.js";
import { KyselyOidcStore } from "../../renown-oidc/store/kysely.js";
import { ALICE, BOB, CAROL, createOrg, failure, harnessResolvers, join, lower, OIDC_NS, openHarness, resetHarness, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const REDIRECT = "https://wiki.acme.example/oidc/callback";
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

function register(t: TestResolvers, orgId: string, who = ALICE, name = "Acme wiki") {
  return t.mutate<{ clientId: string; clientSecret: string }>("registerOrgOidcClient", { orgId, name, redirectUris: [REDIRECT] }, who);
}

describe("org-owned OIDC clients", () => {
  it("registers a confidential client restricted to the organisation's members", async () => {
    const t = harnessResolvers(h);
    const oidc = new KyselyOidcStore(h.root.withSchema(OIDC_NS));
    const { id } = await createOrg(t, ALICE, "acme");
    const created = await register(t, id);
    expect(created.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await oidc.getClient(created.clientId)).toMatchObject({
      name: "Acme wiki",
      redirectUris: [REDIRECT],
      allowedSubjects: [],
      allowAnySubject: false,
      status: "ACTIVE",
      allowedOrgs: [{ orgId: id, minRole: "MEMBER" }],
    });
    // The renown/oidc-client audit mirror, as the generic registration writes it.
    expect(t.reactor.state<{ name: string; redirectUris: string[] }>(created.clientId)).toMatchObject({ name: "Acme wiki", redirectUris: [REDIRECT] });
    const audit = await t.store.auditPage(id, 5);
    expect(audit.map((row) => row.action)).toContain("registerOrgOidcClient");
    expect(JSON.stringify(audit)).not.toContain(created.clientSecret);
    expect(await t.query("orgOidcClients", { orgId: id }, ALICE)).toEqual([
      { clientId: created.clientId, orgId: id, name: "Acme wiki", redirectUris: [REDIRECT], status: "ACTIVE", createdAt: t.clock.now.toISOString() },
    ]);
    expect(JSON.stringify(await t.query("orgOidcClients", { orgId: id }, ALICE))).not.toContain(created.clientSecret);
  });

  it("lets admins update, disable and rotate their own organisation's clients only", async () => {
    const t = harnessResolvers(h);
    const oidc = new KyselyOidcStore(h.root.withSchema(OIDC_NS));
    const { id } = await createOrg(t, ALICE, "acme");
    const other = await createOrg(t, CAROL, "other");
    await join(t, id, BOB, "PUBLISHER");
    const { clientId, clientSecret } = await register(t, id, ALICE, "Wiki");
    const updated = await t.mutate<{ redirectUris: string[]; status: string; name: string }>(
      "updateOrgOidcClient",
      { orgId: id, clientId, name: "Acme Wiki", addRedirectUris: ["https://wiki2.acme.example/cb"], removeRedirectUris: [REDIRECT], status: "DISABLED" },
      ALICE,
    );
    expect(updated).toMatchObject({ name: "Acme Wiki", redirectUris: ["https://wiki2.acme.example/cb"], status: "DISABLED" });
    const rotated = await t.mutate<{ clientId: string; clientSecret: string }>("rotateOrgOidcClientSecret", { orgId: id, clientId }, ALICE);
    expect(rotated.clientSecret).not.toBe(clientSecret);
    expect(JSON.stringify(await t.store.auditPage(id, 10))).not.toContain(rotated.clientSecret);
    expect((await oidc.getClient(clientId))?.allowedOrgs).toEqual([{ orgId: id, minRole: "MEMBER" }]);
    expect((await failure(t.mutate("updateOrgOidcClient", { orgId: other.id, clientId, name: "Mine" }, CAROL))).code).toBe("NOT_FOUND");
    expect((await failure(t.mutate("rotateOrgOidcClientSecret", { orgId: other.id, clientId }, CAROL))).code).toBe("NOT_FOUND");
    expect((await failure(t.mutate("rotateOrgOidcClientSecret", { orgId: id, clientId }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("registerOrgOidcClient", { orgId: id, name: "Bob's", redirectUris: [REDIRECT] }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(t.query("orgOidcClients", { orgId: id }, BOB))).code).toBe("FORBIDDEN");
    expect(await t.query("orgOidcClients", { orgId: other.id }, CAROL)).toEqual([]);
    expect(await failure(t.mutate("registerOrgOidcClient", { orgId: id, name: "Bad", redirectUris: ["http://evil.example/cb"] }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "redirectUris" });
    expect(await failure(t.mutate("updateOrgOidcClient", { orgId: id, clientId, addRedirectUris: ["http://evil.example/cb"] }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "redirectUris" });
    expect(await failure(t.mutate("registerOrgOidcClient", { orgId: id, name: " ", redirectUris: [REDIRECT] }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "name" });
    // Localhost may use http, exactly as the generic registration allows.
    await expect(t.mutate("registerOrgOidcClient", { orgId: id, name: "Dev", redirectUris: ["http://localhost:3000/cb"] }, ALICE)).resolves.toHaveProperty("clientId");
  });

  it("disables the client again when the ownership row cannot be written", async () => {
    const t = harnessResolvers(h);
    const oidc = new KyselyOidcStore(h.root.withSchema(OIDC_NS));
    const { id } = await createOrg(t, ALICE, "acme");
    vi.spyOn(t.store, "insertOrgOidcClient").mockRejectedValueOnce(new Error("db down"));
    const error = await register(t, id).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Error);
    const rows = await h.root.withSchema(OIDC_NS).selectFrom("oidc_clients").select(["client_id", "status"]).execute();
    expect(rows).toHaveLength(1);
    expect((await oidc.getClient(rows[0].client_id as string))?.status).toBe("DISABLED");
    expect(await t.store.orgOidcClients(id)).toEqual([]);
    expect((await t.store.auditPage(id, 5)).map((row) => row.action)).not.toContain("registerOrgOidcClient");
  });

  it("stops the clients of archived or taken-down organisations from authenticating", async () => {
    const t = harnessResolvers(h);
    const oidc = new KyselyOidcStore(h.root.withSchema(OIDC_NS));
    const directory = createClientDirectory(oidc, createOrgClientOwners(h.relationalDb));
    const { id } = await createOrg(t, ALICE, "acme");
    const other = await createOrg(t, CAROL, "other");
    const { clientId } = await register(t, id);
    const second = await register(t, other.id, CAROL);
    expect((await directory.getClient(clientId))?.status).toBe("ACTIVE");

    await t.store.updateOrganization(id, { archived: true }, t.clock.now);
    expect((await directory.getClient(clientId))?.status).toBe("DISABLED");
    expect((await failure(register(t, id))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("updateOrgOidcClient", { orgId: id, clientId, status: "ACTIVE" }, ALICE))).code).toBe("FORBIDDEN");
    // Admins still see what they had.
    expect(await t.query<unknown[]>("orgOidcClients", { orgId: id }, ALICE)).toHaveLength(1);

    await t.store.updateOrganization(other.id, { takenDown: true }, t.clock.now);
    expect((await directory.getClient(second.clientId))?.status).toBe("DISABLED");
    // The table itself is untouched: restoring the organisation restores the client.
    await t.store.updateOrganization(other.id, { takenDown: false }, t.clock.now);
    expect((await directory.getClient(second.clientId))?.status).toBe("ACTIVE");
  });

  it("keeps the generic registration path from lifting an org-owned client's restriction", async () => {
    const t = harnessResolvers(h);
    const oidc = new KyselyOidcStore(h.root.withSchema(OIDC_NS));
    const generic = createOidcResolvers({
      config: () => ({ issuer: "https://sb.example/oidc", loginUrl: "https://renown.example/login", registrationToken: "tok", driveId: null }),
      store: () => oidc,
      reactorClient: t.reactor as unknown as ResolverDeps["reactorClient"],
      orgClients: createOrgClientOwners(h.relationalDb),
      log: () => undefined,
    }) as { Mutation: Record<string, (parent: unknown, args: unknown, ctx: unknown) => Promise<unknown>> };
    const ctx = { headers: { [REGISTRATION_TOKEN_HEADER]: "tok" } };
    const update = (clientId: string, input: Record<string, unknown>) => generic.Mutation.updateOidcClient(null, { clientId, input }, ctx);
    const { id } = await createOrg(t, ALICE, "acme");
    const { clientId } = await register(t, id);
    const restriction = [{ orgId: id, minRole: "MEMBER" }];

    for (const input of [{ allowedOrgs: [] }, { allowedOrgs: [{ orgId: "elsewhere", minRole: "MEMBER" }] }, { allowAnySubject: true }, { addAllowedSubjects: [BOB.address] }]) {
      const error = await update(clientId, input).then(
        () => undefined,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(GraphQLError);
      expect((error as GraphQLError).extensions.code).toBe("BAD_USER_INPUT");
    }
    const client = await oidc.getClient(clientId);
    expect(client).toMatchObject({ allowAnySubject: false, allowedSubjects: [], allowedOrgs: restriction });

    // Everything else still goes through, and the restriction stays.
    await expect(update(clientId, { name: "Renamed", allowedOrgs: restriction })).resolves.toMatchObject({ name: "Renamed", allowedOrgs: restriction });

    // A client nobody owns is unaffected.
    const free = (await generic.Mutation.registerOidcClient(null, { input: { name: "Free", redirectUris: [REDIRECT], allowedSubjects: [] } }, ctx)) as { clientId: string };
    await expect(update(free.clientId, { addAllowedSubjects: [BOB.address], allowAnySubject: true })).resolves.toMatchObject({ clientId: free.clientId });
    expect((await oidc.getClient(free.clientId))?.allowedSubjects).toEqual([lower(BOB)]);
  });
});
