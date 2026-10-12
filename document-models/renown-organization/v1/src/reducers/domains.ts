import type { RenownOrganizationDomainsOperations } from "document-models/renown-organization/v1";
import { DomainNotFoundError, DuplicateDomainError, InvalidDomainError } from "../../gen/domains/error.js";
import { isOrgDomain } from "../utils.js";

export const renownOrganizationDomainsOperations: RenownOrganizationDomainsOperations = {
  addDomainOperation(state, action) {
    const { id, domain } = action.input;
    if (!isOrgDomain(domain)) throw new InvalidDomainError(`Invalid domain: ${domain}`);
    if (state.domains.some((d) => d.id === id || d.domain === domain)) {
      throw new DuplicateDomainError(`Domain id ${id} or ${domain} is already present`);
    }
    state.domains.push({ id, domain, status: "PENDING", verifiedAt: null });
  },
  setDomainStatusOperation(state, action) {
    const { id, status, verifiedAt } = action.input;
    const domain = state.domains.find((d) => d.id === id);
    if (!domain) throw new DomainNotFoundError(`No domain with id ${id}`);
    domain.status = status;
    if (verifiedAt) domain.verifiedAt = verifiedAt;
  },
  removeDomainOperation(state, action) {
    const index = state.domains.findIndex((d) => d.id === action.input.id);
    if (index === -1) throw new DomainNotFoundError(`No domain with id ${action.input.id}`);
    state.domains.splice(index, 1);
  },
};
