import { describe, expect, it } from "vitest";
import { reducer, suspendCredentials, unsuspendCredential, utils } from "document-models/renown-organization/v1";

describe("RenownOrganization security module", () => {
  it("suspends credential ids once each and lifts suspensions", () => {
    let d = utils.createDocument();
    d = reducer(d, suspendCredentials({ credentialIds: ["urn:uuid:1", "urn:uuid:2", "urn:uuid:1"] }));
    d = reducer(d, suspendCredentials({ credentialIds: ["urn:uuid:2", "urn:uuid:3"] }));
    expect(d.state.global.suspendedCredentialIds).toEqual(["urn:uuid:1", "urn:uuid:2", "urn:uuid:3"]);
    d = reducer(d, unsuspendCredential({ credentialId: "urn:uuid:2" }));
    d = reducer(d, unsuspendCredential({ credentialId: "urn:uuid:2" }));
    expect(d.state.global.suspendedCredentialIds).toEqual(["urn:uuid:1", "urn:uuid:3"]);
    expect(d.operations.global.map((op) => op.error)).toEqual([
      undefined,
      undefined,
      undefined,
      "Credential urn:uuid:2 is not suspended",
    ]);
  });
});
