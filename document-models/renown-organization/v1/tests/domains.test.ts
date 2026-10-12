import { describe, expect, it } from "vitest";
import { addDomain, reducer, removeDomain, setDomainStatus, utils } from "document-models/renown-organization/v1";

const AT = "2026-10-12T12:00:00.000Z";

describe("RenownOrganization domains module", () => {
  it("adds a PENDING domain, verifies it, lapses it keeping verifiedAt, removes it", () => {
    let d = utils.createDocument();
    d = reducer(d, addDomain({ id: "d1", domain: "acme.example" }));
    expect(d.state.global.domains).toEqual([{ id: "d1", domain: "acme.example", status: "PENDING", verifiedAt: null }]);
    d = reducer(d, setDomainStatus({ id: "d1", status: "VERIFIED", verifiedAt: AT }));
    d = reducer(d, setDomainStatus({ id: "d1", status: "LAPSED" }));
    expect(d.state.global.domains[0]).toMatchObject({ status: "LAPSED", verifiedAt: AT });
    d = reducer(d, removeDomain({ id: "d1" }));
    expect(d.state.global.domains).toEqual([]);
    expect(d.operations.global.every((op) => op.error === undefined)).toBe(true);
  });

  it("refuses invalid, duplicate and unknown domains", () => {
    let d = reducer(utils.createDocument(), addDomain({ id: "d1", domain: "acme.example" }));
    d = reducer(d, addDomain({ id: "d2", domain: "https://acme.example" }));
    d = reducer(d, addDomain({ id: "d1", domain: "other.example" }));
    d = reducer(d, addDomain({ id: "d3", domain: "acme.example" }));
    d = reducer(d, setDomainStatus({ id: "nope", status: "VERIFIED", verifiedAt: AT }));
    d = reducer(d, removeDomain({ id: "nope" }));
    expect(d.operations.global.map((op) => op.error)).toEqual([
      undefined,
      "Invalid domain: https://acme.example",
      "Domain id d1 or other.example is already present",
      "Domain id d3 or acme.example is already present",
      "No domain with id nope",
      "No domain with id nope",
    ]);
  });
});
