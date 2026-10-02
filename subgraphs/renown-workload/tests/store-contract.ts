import { describe, expect, it } from "vitest";
import type { StoredWorkloadIdentity } from "../core/types.js";
import type { WorkloadStore } from "../store/types.js";

const now = new Date("2026-10-02T12:00:00.000Z");

const identity = (
  did: string,
  repositoryId: string,
): StoredWorkloadIdentity => ({
  did,
  provider: "github",
  repositoryId,
  repository: "acme/shop",
  productionBranch: "main",
  ownerAddress: "0x1111111111111111111111111111111111111111",
  // > int4: chain_id is a bigint column.
  chainId: 3_000_000_000,
  encryptedKeyPair: "v1.iv.ct",
  createdAt: now,
  updatedAt: now,
});

/** The behaviour every `WorkloadStore` implementation must share. `makeStore` returns a fresh, empty store. */
export function describeWorkloadStoreContract(
  name: string,
  makeStore: () => Promise<WorkloadStore>,
): void {
  describe(`${name} (WorkloadStore contract)`, () => {
    it("inserts and reads by did and by repository id", async () => {
      const store = await makeStore();
      expect(await store.insert(identity("did:key:a", "1"))).toBe(true);
      expect(await store.getByDid("did:key:a")).toEqual(
        identity("did:key:a", "1"),
      );
      expect(await store.getByRepositoryId("1")).toEqual(
        identity("did:key:a", "1"),
      );
      expect(await store.getByDid("did:key:none")).toBeUndefined();
      expect(await store.getByRepositoryId("2")).toBeUndefined();
    });

    it("refuses a second identity for the same repository id", async () => {
      const store = await makeStore();
      await store.insert(identity("did:key:a", "1"));
      expect(await store.insert(identity("did:key:b", "1"))).toBe(false);
      expect(await store.getByDid("did:key:b")).toBeUndefined();
      expect((await store.getByRepositoryId("1"))?.did).toBe("did:key:a");
    });

    it("patches only the given fields", async () => {
      const store = await makeStore();
      await store.insert(identity("did:key:a", "1"));
      const later = new Date(now.getTime() + 1000);
      const updated = await store.update(
        "did:key:a",
        { productionBranch: "release" },
        later,
      );
      expect(updated).toEqual({
        ...identity("did:key:a", "1"),
        productionBranch: "release",
        updatedAt: later,
      });
      expect(
        await store.update("did:key:none", { repository: "x/y" }, later),
      ).toBeUndefined();
    });

    it("deletes", async () => {
      const store = await makeStore();
      await store.insert(identity("did:key:a", "1"));
      expect(await store.delete("did:key:a")).toBe(true);
      expect(await store.delete("did:key:a")).toBe(false);
      expect(await store.getByRepositoryId("1")).toBeUndefined();
    });
  });
}
