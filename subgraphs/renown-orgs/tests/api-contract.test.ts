import { buildASTSchema, isEnumType, isInputObjectType, isObjectType, type GraphQLSchema } from "graphql";
import { describe, expect, it } from "vitest";
import { schema } from "../schema.js";

type Phase = "A1" | "A2" | "A3";
const PHASES: readonly Phase[] = ["A1", "A2", "A3"];
/** Phases whose SDL is complete; A2 and A3 each add theirs in their last task. */
const SHIPPED: readonly Phase[] = ["A1"];

const AUTH = "auth: OrgAuthInput";

const ROOT_FIELDS: Record<Phase, { Query: string[]; Mutation: string[] }> = {
  A1: {
    Query: [
      `organization(id: String, handle: String, ${AUTH}): Organization`,
      "organizationSearch(query: String, limit: Int, after: String): OrgSearchPage!",
      `organizationsByMember(address: String!, ${AUTH}): [OrgAffiliation!]!`,
      `organizationMembers(orgId: String!, includeInactive: Boolean, ${AUTH}): [OrgMember!]!`,
      "orgMembership(orgId: String!, address: String!): OrgMembership",
      `orgInvites(orgId: String!, ${AUTH}): [OrgInvite!]!`,
      `orgInviteLinks(orgId: String!, ${AUTH}): [OrgInviteLink!]!`,
      `myOrgInvites(${AUTH}): [OrgInvite!]!`,
      "orgInviteLink(token: String!): OrgInviteLinkPreview",
      "orgHandleAvailability(handle: String!): OrgHandleAvailability!",
      `orgAuditLog(orgId: String!, limit: Int, after: String, ${AUTH}): OrgAuditPage!`,
    ],
    Mutation: [
      `createOrganization(handle: String!, name: String!, bio: String, website: String, links: [OrgLinkInput!], listed: Boolean, membersPublic: Boolean, ${AUTH}): Organization!`,
      `updateOrganization(orgId: String!, name: String, bio: String, website: String, avatar: String, links: [OrgLinkInput!], membersPublic: Boolean, ${AUTH}): Organization!`,
      `setOrgListed(orgId: String!, listed: Boolean!, ${AUTH}): Organization!`,
      `inviteOrgMember(orgId: String!, invitee: String!, role: OrgRole!, ${AUTH}): OrgInvite!`,
      `respondToOrgInvite(orgId: String!, inviteId: String!, accept: Boolean!, ${AUTH}): OrgMember!`,
      `revokeOrgInvite(orgId: String!, inviteId: String!, ${AUTH}): OrgInvite!`,
      `createOrgInviteLink(orgId: String!, role: OrgRole!, maxUses: Int!, expiresAt: String!, ${AUTH}): OrgInviteLinkCreated!`,
      `revokeOrgInviteLink(orgId: String!, linkId: String!, ${AUTH}): OrgInviteLink!`,
      `acceptOrgInviteLink(token: String!, ${AUTH}): OrgMember!`,
      `leaveOrganization(orgId: String!, ${AUTH}): Boolean!`,
      `removeOrgMember(orgId: String!, address: String!, ${AUTH}): OrgMember!`,
      `setOrgMemberRole(orgId: String!, address: String!, role: OrgRole!, ${AUTH}): OrgMember!`,
      `setOrgMemberAppScope(orgId: String!, address: String!, appScope: OrgAppScopeInput!, ${AUTH}): OrgMember!`,
      `setMyOrgMembershipHidden(orgId: String!, hidden: Boolean!, ${AUTH}): OrgMember!`,
      `createOrgTeam(orgId: String!, slug: String!, name: String!, appDids: [String!], ${AUTH}): OrgTeam!`,
      `updateOrgTeam(orgId: String!, teamId: String!, slug: String, name: String, appDids: [String!], ${AUTH}): OrgTeam!`,
      `deleteOrgTeam(orgId: String!, teamId: String!, ${AUTH}): Boolean!`,
      `setOrgTeamMembers(orgId: String!, teamId: String!, addresses: [String!]!, ${AUTH}): OrgTeam!`,
    ],
  },
  A2: {
    Query: [
      `orgProposals(orgId: String!, status: OrgProposalStatus, ${AUTH}): [OrgProposal!]!`,
      `orgDomains(orgId: String!, ${AUTH}): [OrgDomain!]!`,
      `orgCredentials(orgId: String!, ${AUTH}): [OrgCredential!]!`,
      "orgCredentialStatus(credentialId: String!): OrgCredentialStatus",
      `orgWorkloads(orgId: String!, ${AUTH}): [OrgWorkload!]!`,
      `appTransfers(appDid: String, orgId: String, address: String, ${AUTH}): [AppTransfer!]!`,
      "releaseAttestations(appDid: String!, limit: Int, after: String): ReleaseAttestationPage!",
      "releaseAttestation(id: String!): ReleaseAttestation",
      "organizationStats(orgId: String!): OrganizationStats",
      "organizationDidDocument(orgId: String!): String",
    ],
    Mutation: [
      `proposeOrgChange(orgId: String!, kind: OrgProposalKind!, payload: OrgProposalPayloadInput!, ${AUTH}): OrgProposal!`,
      `approveOrgProposal(orgId: String!, proposalId: String!, ${AUTH}): OrgProposal!`,
      `cancelOrgProposal(orgId: String!, proposalId: String!, ${AUTH}): OrgProposal!`,
      `executeOrgProposal(orgId: String!, proposalId: String!, ${AUTH}): OrgProposal!`,
      `startOrgRecovery(orgId: String!, domain: String!, newOwner: String!, ${AUTH}): OrgProposal!`,
      `addOrgDomain(orgId: String!, domain: String!, ${AUTH}): OrgDomain!`,
      `checkOrgDomain(orgId: String!, domainId: String!, ${AUTH}): OrgDomain!`,
      `removeOrgDomain(orgId: String!, domainId: String!, ${AUTH}): Boolean!`,
      `proposeAppTransfer(appDid: String!, toOrgId: String!, ${AUTH}): AppTransfer!`,
      `acceptAppTransfer(transferId: String!, ${AUTH}): AppTransfer!`,
      `declineAppTransfer(transferId: String!, ${AUTH}): AppTransfer!`,
      `suspendOrgCredentials(orgId: String!, credentialIds: [String!], memberAddress: String, ${AUTH}): [String!]!`,
      `unsuspendOrgCredential(orgId: String!, credentialId: String!, ${AUTH}): Boolean!`,
      `setOrgWorkloadDisabled(orgId: String!, did: String!, disabled: Boolean!, ${AUTH}): OrgWorkload!`,
      "attestRelease(appDid: String!, version: String!, artifactDigest: String!, orgId: String!, issuedAt: String!, signer: String!, signature: String!): ReleaseAttestation!",
    ],
  },
  A3: {
    Query: [
      `myNotifications(unreadOnly: Boolean, limit: Int, after: String, ${AUTH}): OrgNotificationPage!`,
      `myUnreadNotificationCount(${AUTH}): Int!`,
      `orgWebhooks(orgId: String!, ${AUTH}): [OrgWebhook!]!`,
      `orgWebhookDeliveries(orgId: String!, webhookId: String!, limit: Int, ${AUTH}): [OrgWebhookDelivery!]!`,
      `orgOidcClients(orgId: String!, ${AUTH}): [OrgOidcClient!]!`,
      `orgReports(status: OrgReportStatus, ${AUTH}): [OrgReport!]!`,
      `orgAuditExport(orgId: String!, ${AUTH}): String!`,
    ],
    Mutation: [
      `markNotificationsRead(ids: [String!], all: Boolean, ${AUTH}): Int!`,
      `createOrgWebhook(orgId: String!, url: String!, events: [String!]!, ${AUTH}): OrgWebhookCreated!`,
      `updateOrgWebhook(orgId: String!, webhookId: String!, url: String, events: [String!], enabled: Boolean, ${AUTH}): OrgWebhook!`,
      `deleteOrgWebhook(orgId: String!, webhookId: String!, ${AUTH}): Boolean!`,
      `testOrgWebhook(orgId: String!, webhookId: String!, ${AUTH}): OrgWebhookDelivery!`,
      `registerOrgOidcClient(orgId: String!, name: String!, redirectUris: [String!]!, ${AUTH}): OrgOidcClientCredentials!`,
      `updateOrgOidcClient(orgId: String!, clientId: String!, name: String, addRedirectUris: [String!], removeRedirectUris: [String!], status: OrgOidcClientStatus, ${AUTH}): OrgOidcClient!`,
      `rotateOrgOidcClientSecret(orgId: String!, clientId: String!, ${AUTH}): OrgOidcClientCredentials!`,
      `reportOrganization(orgId: String!, reason: OrgReportReason!, details: String, ${AUTH}): Boolean!`,
      `resolveOrgReport(reportId: String!, resolution: OrgReportResolution!, note: String, ${AUTH}): OrgReport!`,
    ],
  },
};

/** Every non-root type of each phase and its fields (or enum values), in declaration order. */
const TYPES: Record<Phase, Record<string, string>> = {
  A1: {
    OrgRole: "OWNER ADMIN PUBLISHER MEMBER",
    OrgMemberStatus: "INVITED ACTIVE DECLINED LEFT REMOVED REVOKED EXPIRED",
    OrgHandleProblem: "INVALID RESERVED TAKEN",
    OrgSecurityWarning: "SINGLE_OWNER",
    OrgAuthInput: "address signature timestamp",
    OrgLinkInput: "id label url",
    OrgAppScopeInput: "all appDids",
    OrgLink: "id label url",
    OrgAppScope: "all appDids",
    OrgSummary: "id did handle name avatar verifiedDomains",
    OrgApp: "appDid addedAt frozen",
    OrgTeam: "id orgId slug name appDids memberAddresses",
    OrgMembership: "orgId address role status appScope effectiveScope teams",
    Organization:
      "id did handle name bio website avatar links listed membersPublic archived takenDown createdBy createdAt updatedAt verifiedDomains notAffiliatedWith ownerCount memberCount securityWarnings apps teams viewerMembership",
    OrgMember:
      "id orgId address role status appScope hidden invitedBy invitedAt joinedAt endedAt updatedAt expiresAt teams handle displayName avatar",
    OrgAffiliation: "org role hidden",
    OrgSearchPage: "items next",
    OrgInvite: "id orgId org address role status invitedBy createdAt expiresAt",
    OrgInviteLink: "id orgId role maxUses uses expiresAt revoked createdBy createdAt",
    OrgInviteLinkCreated: "link token",
    OrgInviteLinkPreview: "org role expiresAt expired revoked full usable",
    OrgHandleAvailability: "handle available reason",
    OrgAuditEntry: "id orgId at actor action details",
    OrgAuditPage: "items next",
  },
  A2: {
    OrgProposalKind: "ADD_OWNER REMOVE_OWNER TRANSFER_APP_OUT CHANGE_HANDLE DELETE_ORG RECOVER FREEZE_APP UNFREEZE_APP",
    OrgProposalStatus: "PENDING EXECUTED CANCELLED EXPIRED FAILED",
    OrgDomainStatus: "PENDING VERIFIED LAPSED",
    OrgPartyKind: "PERSON ORG",
    AppTransferStatus: "PENDING ACCEPTED DECLINED CANCELLED EXPIRED",
    OrgCredentialReason: "ISSUER_NOT_MEMBER ISSUER_NOT_PUBLISHER SUSPENDED APP_FROZEN",
    OrgProposalPayloadInput: "address demoteToAdmin appDid toKind toId handle",
    OrgProposalPayload: "address demoteToAdmin appDid toKind toId handle domain",
    OrgProposal: "id orgId kind payload proposer approvals threshold status createdAt executableAt expiresAt executedAt reason",
    OrgDomain: "id orgId domain status verifiedAt lastCheckedAt failures createdAt txtName txtValue wellKnownUrl wellKnownJson",
    AppTransfer: "id appDid fromKind fromId toKind toId status createdAt expiresAt decidedAt decidedBy proposalId",
    OrgCredentialStatus: "credentialId appDid orgId counts reason",
    OrgCredential: "credentialId documentId appDid issuer issuerRole issuerStatus issuanceDate expirationDate revoked status",
    OrgWorkload: "did repository productionBranch ownerAddress disabled createdAt",
    ReleaseAttestation: "id appDid version artifactDigest orgId signer signerRole signerStillMember issuedAt signature createdAt",
    ReleaseAttestationPage: "items next",
    OrganizationStats: "orgId apps activeUsers30d activeDelegations attestations30d",
  },
  A3: {
    OrgNotificationKind:
      "INVITED INVITE_ACCEPTED ROLE_CHANGED REMOVED PROPOSAL_CREATED PROPOSAL_NEEDS_APPROVAL PROPOSAL_EXECUTED PROPOSAL_CANCELLED RECOVERY_STARTED APP_TRANSFER_REQUEST APP_TRANSFER_DONE APP_FROZEN DOMAIN_LAPSED DELEGATION_ADDED",
    OrgWebhookDeliveryStatus: "PENDING DELIVERED FAILED",
    OrgReportReason: "IMPERSONATION HANDLE_DISPUTE SPAM ABUSE OTHER",
    OrgReportStatus: "OPEN RESOLVED",
    OrgReportResolution: "DISMISS TAKE_DOWN RELEASE_HANDLE RESTORE",
    OrgOidcClientStatus: "ACTIVE DISABLED",
    OrgNotification: "id kind orgId org payload createdAt readAt",
    OrgNotificationPage: "items next",
    OrgWebhook: "id orgId url events enabled consecutiveFailures createdAt",
    OrgWebhookCreated: "webhook secret",
    OrgWebhookDelivery: "id webhookId eventId eventType status attempts responseStatus lastError createdAt nextAttemptAt deliveredAt",
    OrgOidcClient: "clientId orgId name redirectUris status createdAt",
    OrgOidcClientCredentials: "clientId clientSecret",
    OrgReport: "id orgId org reporter reason details status resolution resolvedBy resolvedAt note createdAt",
  },
};

function rootSignatures(built: GraphQLSchema, root: "Query" | "Mutation"): string[] {
  const type = built.getType(root);
  if (!isObjectType(type)) return [];
  return Object.values(type.getFields()).map((field) => {
    const args = field.args.map((arg) => `${arg.name}: ${String(arg.type)}`).join(", ");
    return `${field.name}${args ? `(${args})` : ""}: ${String(field.type)}`;
  });
}

function memberNames(built: GraphQLSchema, name: string): string | undefined {
  const type = built.getType(name);
  if (isEnumType(type)) return type.getValues().map((value) => value.name).join(" ");
  if (isObjectType(type) || isInputObjectType(type)) return Object.keys(type.getFields()).join(" ");
  return undefined;
}

describe("renown-orgs API contract", () => {
  const built = buildASTSchema(schema);

  for (const root of ["Query", "Mutation"] as const) {
    it(`serves every ${root} field of the shipped phases, and nothing outside the contract`, () => {
      const served = rootSignatures(built, root);
      for (const phase of SHIPPED) {
        for (const signature of ROOT_FIELDS[phase][root]) expect(served, phase).toContain(signature);
      }
      // A later phase grows task by task: what it already serves must match the contract too.
      const known = new Set(PHASES.flatMap((phase) => ROOT_FIELDS[phase][root]));
      for (const signature of served) expect(known.has(signature), signature).toBe(true);
    });
  }

  it("declares the types of the shipped phases (and any later-phase type already present) exactly", () => {
    for (const phase of PHASES) {
      for (const [name, members] of Object.entries(TYPES[phase])) {
        const actual = memberNames(built, name);
        if (actual === undefined && !SHIPPED.includes(phase)) continue;
        expect(actual, name).toBe(members);
      }
    }
  });

  it("declares no argument with a default value (signed messages hash the arguments as sent)", () => {
    for (const root of ["Query", "Mutation"] as const) {
      const type = built.getType(root);
      if (!isObjectType(type)) continue;
      for (const field of Object.values(type.getFields())) {
        for (const arg of field.args) expect(arg.defaultValue, `${field.name}.${arg.name}`).toBeUndefined();
      }
    }
  });
});
