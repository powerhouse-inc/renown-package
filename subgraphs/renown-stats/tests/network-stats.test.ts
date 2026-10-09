import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { generateId } from "document-model";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NETWORK_STATS_FAILURE_BACKOFF_MS } from "../resolvers.js";
import { pkhDidFor } from "../core/dids.js";
import {
  CRED_NS,
  failure,
  harnessResolvers,
  insertProfile,
  openHarness,
  registerApp,
  resetHarness,
  type Harness,
} from "./harness.js";

const APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const APP_2 = "did:key:z6MkjchhfUsD6mmvni8mCdXHw216Xrm9bQe2mBH1P5RDjVJG";
const NOW = new Date("2026-10-09T12:00:00Z");
const DAY = 86_400_000;
const addr = (n: number) => `0x${"0".repeat(38)}b${n}`;

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
afterEach(() => {
  vi.restoreAllMocks();
});

/** A credential row as the renown-credential processor writes it. */
async function credential(row: { expiration: Date | null; revoked?: boolean; credentialId?: string }): Promise<void> {
  const T0 = new Date("2026-01-01T00:00:00Z");
  const owner = addr(9);
  await h.root
    .withSchema(CRED_NS)
    .insertInto("renown_credential")
    .values({
      document_id: generateId(),
      context: "[]",
      credential_id: row.credentialId ?? generateId(),
      type: "[]",
      issuer_id: pkhDidFor(owner),
      issuer_ethereum_address: owner,
      issuance_date: T0,
      expiration_date: row.expiration,
      credential_subject_id: APP,
      credential_subject_app: "test-app",
      credential_status_id: null,
      credential_status_type: null,
      credential_schema_id: "schema",
      credential_schema_type: "type",
      proof_verification_method: "method",
      proof_ethereum_address: owner,
      proof_created: T0,
      proof_purpose: "assertionMethod",
      proof_type: "EthereumEip712Signature2021",
      proof_value: "0x",
      proof_eip712_domain: "{}",
      proof_eip712_primary_type: "VerifiableCredential",
      revoked: row.revoked ?? false,
      revoked_at: row.revoked ? T0 : null,
      revocation_reason: null,
    })
    .execute();
}

/** A clock the test moves by hand. */
function clock(start = NOW) {
  let t = start.getTime();
  return { now: () => new Date(t), advance: (ms: number) => (t += ms) };
}

describe("renownNetworkStats", () => {
  it("counts identities, apps, live credentials and users active in the last 30 days", async () => {
    const c = clock();
    const r = harnessResolvers(h, { now: c.now });
    // Identities: distinct lower-cased addresses; two profile documents of one wallet count once.
    await insertProfile(h, { address: addr(1), documentId: "doc-1" });
    await insertProfile(h, { address: addr(1).toUpperCase().replace("0X", "0x"), documentId: "doc-1b" });
    await insertProfile(h, { address: addr(2), documentId: "doc-2" });
    // Apps: profiles. registerApp also writes one live delegation credential each.
    await registerApp(h, APP);
    await registerApp(h, APP_2);
    await r.upsert({ appDid: APP, name: "One" });
    await r.upsert({ appDid: APP_2, name: "Two" });
    // Credentials: live = unrevoked and (no expiry or expiry after now); copies of one VC count once.
    await credential({ expiration: null });
    await credential({ expiration: new Date(NOW.getTime() + 1000), credentialId: "vc-dup" });
    await credential({ expiration: new Date(NOW.getTime() + 1000), credentialId: "vc-dup" });
    await credential({ expiration: new Date(NOW.getTime() - 1000) });
    await credential({ expiration: NOW });
    await credential({ expiration: null, revoked: true });
    // Active users: any report to any app in the last 30 days, each user once.
    const record = (userDid: string, appDid: string, at: Date) =>
      r.index.recordMetricValues([{ appDid, metric: "m", userDid, value: 1, updatedAt: at }]);
    await record("u1", APP, new Date(NOW.getTime() - DAY));
    await record("u1", APP_2, new Date(NOW.getTime() - 2 * DAY));
    await record("u2", "did:key:zNoProfile", new Date(NOW.getTime() - 30 * DAY));
    await record("u3", APP, new Date(NOW.getTime() - 31 * DAY));

    expect(await r.networkStats()).toEqual({
      identities: 2,
      apps: 2,
      activeCredentials: 4, // registerApp x2, no-expiry, vc-dup
      activeUsers30d: 2,
      updatedAt: NOW.toISOString(),
    });
  });

  it("answers zeros on an empty network", async () => {
    const r = harnessResolvers(h, { now: clock().now });
    expect(await r.networkStats()).toEqual({
      identities: 0,
      apps: 0,
      activeCredentials: 0,
      activeUsers30d: 0,
      updatedAt: NOW.toISOString(),
    });
  });

  it("serves the cached answer for 300 s, then recomputes", async () => {
    const c = clock();
    const r = harnessResolvers(h, { now: c.now });
    await insertProfile(h, { address: addr(1), documentId: "doc-1" });
    expect((await r.networkStats()).identities).toBe(1);

    await insertProfile(h, { address: addr(2), documentId: "doc-2" });
    c.advance(299_999);
    expect(await r.networkStats()).toMatchObject({ identities: 1, updatedAt: NOW.toISOString() });

    c.advance(1);
    expect(await r.networkStats()).toMatchObject({
      identities: 2,
      updatedAt: new Date(NOW.getTime() + 300_000).toISOString(),
    });
  });

  it("shares one computation between concurrent requests", async () => {
    const r = harnessResolvers(h, { now: clock().now });
    const activity = vi.spyOn(r.index, "networkActivity");
    const [a, b] = await Promise.all([r.networkStats(), r.networkStats()]);
    expect(a).toEqual(b);
    expect(activity).toHaveBeenCalledTimes(1);
  });

  it("answers SERVICE_UNAVAILABLE when a read model fails, and does not cache the failure", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    let down = true;
    const relationalDb = {
      queryNamespace: (namespace: string) => {
        if (down) throw new Error("relation does not exist");
        return h.root.withSchema(namespace);
      },
    } as unknown as IRelationalDb<unknown>;
    const c = clock();
    const r = harnessResolvers(h, { now: c.now, relationalDb });
    expect(await failure(r.networkStats())).toEqual({
      code: "SERVICE_UNAVAILABLE",
      field: undefined,
      message: "Stats are temporarily unavailable",
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("relation does not exist"));
    down = false;
    c.advance(NETWORK_STATS_FAILURE_BACKOFF_MS); // past the failure backoff
    expect((await r.networkStats()).identities).toBe(0);
  });

  it("answers SERVICE_UNAVAILABLE when the stats index fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const r = harnessResolvers(h, { now: clock().now });
    vi.spyOn(r.index, "networkActivity").mockRejectedValue(new Error("db down"));
    expect((await failure(r.networkStats())).code).toBe("SERVICE_UNAVAILABLE");
  });

  it("fails fast for 5 s after a failure without querying or logging, then retries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const c = clock();
    const r = harnessResolvers(h, { now: c.now });
    const activity = vi.spyOn(r.index, "networkActivity").mockRejectedValueOnce(new Error("db down"));
    expect((await failure(r.networkStats())).code).toBe("SERVICE_UNAVAILABLE");
    expect(activity).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    c.advance(NETWORK_STATS_FAILURE_BACKOFF_MS - 1);
    expect(await failure(r.networkStats())).toEqual({
      code: "SERVICE_UNAVAILABLE",
      field: undefined,
      message: "Stats are temporarily unavailable",
    });
    expect(activity).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);

    c.advance(1);
    expect((await r.networkStats()).identities).toBe(0);
    expect(activity).toHaveBeenCalledTimes(2);
  });
});
