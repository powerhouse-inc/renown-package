import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { failure, harnessResolvers, openHarness, registerApp, resetHarness, type Harness } from "./harness.js";

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
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

describe("app profile contacts", () => {
  it("relays, returns and clears support and security contacts", async () => {
    await registerApp(h, APP);
    const t = harnessResolvers(h);
    await t.upsert({ appDid: APP, name: "Acme", supportContact: "help@acme.example", securityContact: "https://acme.example/.well-known/security.txt" });
    expect(await t.appProfile(APP)).toMatchObject({ supportContact: "help@acme.example", securityContact: "https://acme.example/.well-known/security.txt" });
    await t.upsert({ appDid: APP, supportContact: "" });
    expect(await t.appProfile(APP)).toMatchObject({ supportContact: null, securityContact: "https://acme.example/.well-known/security.txt" });
    expect(await failure(t.upsert({ appDid: APP, securityContact: "javascript:alert(1)" }))).toMatchObject({ code: "BAD_USER_INPUT", field: "securityContact" });
    expect(await failure(t.upsert({ appDid: APP, supportContact: `${"x".repeat(190)}@acme.example` }))).toMatchObject({ field: "supportContact" });
  });
});
