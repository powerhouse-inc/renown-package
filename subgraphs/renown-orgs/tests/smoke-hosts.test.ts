import { describe, expect, it } from "vitest";
import { discoveryProblem, isLocalHost, isStagingHost } from "../../../scripts/smoke/hosts.js";

describe("smoke script host rules", () => {
  it("treats only anchored staging labels and loopback as staging", () => {
    for (const host of ["switchboard.renown-staging.vetra.io", "renown-staging.vetra.io", "staging.vetra.io", "localhost", "127.0.0.1"]) {
      expect(isStagingHost(host), host).toBe(true);
    }
    for (const host of ["switchboard.renown.id", "www.renown.id", "nostaging.example", "stagingx.example", "my-stagingfoo.io"]) {
      expect(isStagingHost(host), host).toBe(false);
    }
  });

  it("skips an unserved OIDC discovery only on a local host", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("switchboard.renown-staging.vetra.io")).toBe(false);
    expect(discoveryProblem(404, "localhost")).toEqual({ skip: "not served (404); skipped" });
    expect(discoveryProblem(404, "switchboard.renown-staging.vetra.io")).toEqual({ fail: "OIDC discovery not served (404)" });
    expect(discoveryProblem(200, "switchboard.renown-staging.vetra.io")).toBeNull();
  });
});
