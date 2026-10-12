import type { ColumnType, Kysely } from "kysely";

/** The relational namespace of the renown-orgs store. Other subgraphs read it through store/lookups.ts. */
export const ORGS_NAMESPACE = "renown-orgs";

/** A `timestamptz` column: the driver returns a `Date`, but accepts either on write. */
export type Timestamp = Date | string;
/** A `jsonb` column: written as a JSON string, read back parsed (see jsonValue). */
export type JsonColumn = ColumnType<unknown, string, string>;
type Defaulted<T> = ColumnType<T, T | undefined, T>;

export type OrgRole = "OWNER" | "ADMIN" | "PUBLISHER" | "MEMBER";
export type StoredMemberStatus = "INVITED" | "ACTIVE" | "DECLINED" | "LEFT" | "REMOVED" | "REVOKED";
export type DomainStatus = "PENDING" | "VERIFIED" | "LAPSED";

export interface OrgLink {
  id: string;
  label: string;
  url: string;
}

export interface OrganizationsTable {
  id: string;
  handle: string;
  name: string;
  bio: string | null;
  website: string | null;
  avatar_ref: string | null;
  links: JsonColumn;
  listed: boolean;
  members_public: boolean;
  archived: boolean;
  taken_down: boolean;
  created_by: string;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface OrgMembersTable {
  id: string;
  org_id: string;
  address: string;
  role: OrgRole;
  status: StoredMemberStatus;
  app_scope_all: boolean;
  app_dids: JsonColumn;
  hidden: boolean;
  invited_by: string | null;
  invited_at: Timestamp;
  joined_at: Timestamp | null;
  ended_at: Timestamp | null;
  updated_at: Timestamp;
}

export interface OrgTeamsTable {
  id: string;
  org_id: string;
  slug: string;
  name: string;
  app_dids: JsonColumn;
  created_at: Timestamp;
}

export interface OrgTeamMembersTable {
  team_id: string;
  member_id: string;
}

export interface OrgInviteLinksTable {
  id: string;
  org_id: string;
  token_hash: string;
  role: OrgRole;
  max_uses: number;
  uses: Defaulted<number>;
  expires_at: Timestamp;
  revoked: Defaulted<boolean>;
  created_by: string;
  created_at: Timestamp;
}

export interface OrgAppsTable {
  app_did: string;
  org_id: string;
  frozen: Defaulted<boolean>;
  added_at: Timestamp;
}

/** A2: delegation credentials an organisation suspended (they stop counting under org rules). */
export interface OrgCredentialSuspensionsTable {
  org_id: string;
  credential_id: string;
  /** ADMIN, MEMBER_LEFT or MEMBER_REMOVED. */
  reason: string;
  member_address: string | null;
  at: Timestamp;
}

/** A2: member-level suspensions (an exit whose delegations could not be listed). */
export interface OrgMemberSuspensionsTable {
  org_id: string;
  /** Lowercase. */
  address: string;
  /** Delegations issued at or before this instant are suspended. */
  suspended_at: Timestamp;
  /** MEMBER_LEFT or MEMBER_REMOVED. */
  reason: string;
}

export interface OrgDomainsTable {
  id: string;
  org_id: string;
  domain: string;
  token: string;
  status: DomainStatus;
  verified_at: Timestamp | null;
  last_checked_at: Timestamp | null;
  failures: Defaulted<number>;
  created_at: Timestamp;
}

export interface OrgAuditTable {
  id: string;
  org_id: string;
  at: Timestamp;
  /** Lowercase address, or "system". */
  actor: string;
  action: string;
  details: JsonColumn;
}

export interface ReservedHandlesTable {
  handle: string;
  until: Timestamp;
  reason: string;
  org_id: string | null;
}

export type ProposalKind =
  | "ADD_OWNER"
  | "REMOVE_OWNER"
  | "TRANSFER_APP_OUT"
  | "CHANGE_HANDLE"
  | "DELETE_ORG"
  | "RECOVER"
  | "FREEZE_APP"
  | "UNFREEZE_APP";
export type ProposalStatus = "PENDING" | "EXECUTED" | "CANCELLED" | "EXPIRED" | "FAILED";
export type PartyKind = "PERSON" | "ORG";

/** Normalized proposal payload; each kind uses its own fields. */
export interface ProposalPayload {
  address?: string;
  demoteToAdmin?: boolean;
  appDid?: string;
  toKind?: PartyKind;
  toId?: string;
  handle?: string;
  domain?: string;
}

export type TransferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED";

/** A2: app transfers between people and organisations; at most one PENDING per app. */
export interface OrgAppTransfersTable {
  id: string;
  app_did: string;
  from_kind: PartyKind;
  from_id: string;
  to_kind: PartyKind;
  to_id: string;
  status: TransferStatus;
  created_at: Timestamp;
  expires_at: Timestamp;
  decided_at: Timestamp | null;
  decided_by: string | null;
  proposal_id: string | null;
  /** Why the system ended it (e.g. "app owner changed"); null otherwise. */
  reason: string | null;
}

export interface TransferRecord {
  id: string;
  appDid: string;
  fromKind: PartyKind;
  /** Lowercase address (PERSON) or organisation id (ORG). */
  fromId: string;
  toKind: PartyKind;
  toId: string;
  status: TransferStatus;
  createdAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  /** The TRANSFER_APP_OUT proposal that made it; null for a person's offer. */
  proposalId: string | null;
  /** Why the system ended it (e.g. "app owner changed"); null otherwise. */
  reason: string | null;
}

export type TransferPatch = Partial<Pick<TransferRecord, "status" | "decidedAt" | "decidedBy" | "reason">>;

export interface OrgJobsTable {
  name: string;
  last_run_at: Timestamp;
  /** How far a windowed job (delegations) has processed; advanced only after a successful run. */
  watermark: ColumnType<Timestamp | null, Timestamp | null | undefined, Timestamp | null>;
}

/** One DELEGATION_ADDED alert per credential, whatever re-reads its window. */
export interface OrgDelegationAlertsTable {
  credential_id: string;
  org_id: string;
  created_at: Timestamp;
}

export interface OrgProposalsTable {
  id: string;
  org_id: string;
  kind: ProposalKind;
  payload: JsonColumn;
  proposer: string;
  approvals: JsonColumn;
  status: ProposalStatus;
  threshold: number;
  created_at: Timestamp;
  executable_at: Timestamp | null;
  expires_at: Timestamp;
  executed_at: Timestamp | null;
  reason: string | null;
  /** When the sweeper last examined it without progressing it; null if never. */
  checked_at: Timestamp | null;
}

export interface ProposalRecord {
  id: string;
  orgId: string;
  kind: ProposalKind;
  payload: ProposalPayload;
  proposer: string;
  /** Lowercase owner addresses, in approval order. */
  approvals: string[];
  status: ProposalStatus;
  threshold: number;
  createdAt: Date;
  executableAt: Date | null;
  expiresAt: Date;
  executedAt: Date | null;
  reason: string | null;
}

export type ProposalPatch = Partial<Pick<ProposalRecord, "approvals" | "status" | "executableAt" | "executedAt" | "reason">>;

export interface OrgUsedSignaturesTable {
  hash: string;
  expires_at: Timestamp;
}

export interface OrgNotificationsTable {
  id: string;
  recipient: string;
  kind: string;
  org_id: string;
  payload: JsonColumn;
  created_at: Timestamp;
  read_at: Timestamp | null;
}

export interface NotificationRecord {
  id: string;
  /** Lowercase address. */
  recipient: string;
  kind: string;
  orgId: string;
  payload: Record<string, unknown>;
  createdAt: Date;
  readAt: Date | null;
}

export interface OrgReleaseAttestationsTable {
  id: string;
  app_did: string;
  version: string;
  artifact_digest: string;
  /** "" for person-owned apps. */
  org_id: string;
  /** Lowercase. */
  signer: string;
  signer_role: OrgRole | null;
  /** Exactly as signed (ISO-8601 text, never normalised). */
  issued_at: string;
  signature: string;
  created_at: Timestamp;
}

export interface OrgsDB {
  organizations: OrganizationsTable;
  org_members: OrgMembersTable;
  org_teams: OrgTeamsTable;
  org_team_members: OrgTeamMembersTable;
  org_invite_links: OrgInviteLinksTable;
  org_apps: OrgAppsTable;
  org_domains: OrgDomainsTable;
  org_audit: OrgAuditTable;
  reserved_handles: ReservedHandlesTable;
  org_used_signatures: OrgUsedSignaturesTable;
  org_proposals: OrgProposalsTable;
  org_jobs: OrgJobsTable;
  org_credential_suspensions: OrgCredentialSuspensionsTable;
  org_member_suspensions: OrgMemberSuspensionsTable;
  org_app_transfers: OrgAppTransfersTable;
  org_release_attestations: OrgReleaseAttestationsTable;
  org_notifications: OrgNotificationsTable;
  org_delegation_alerts: OrgDelegationAlertsTable;
}

export type OrgsKysely = Kysely<OrgsDB>;

export interface OrgRecord {
  id: string;
  handle: string;
  name: string;
  bio: string | null;
  website: string | null;
  avatarRef: string | null;
  links: OrgLink[];
  listed: boolean;
  membersPublic: boolean;
  archived: boolean;
  takenDown: boolean;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export type OrgPatch = Partial<
  Pick<OrgRecord, "handle" | "name" | "bio" | "website" | "avatarRef" | "links" | "listed" | "membersPublic" | "archived" | "takenDown">
>;

export interface MemberRecord {
  id: string;
  orgId: string;
  /** Lowercase. */
  address: string;
  role: OrgRole;
  status: StoredMemberStatus;
  appScopeAll: boolean;
  appDids: string[];
  hidden: boolean;
  invitedBy: string | null;
  invitedAt: Date;
  joinedAt: Date | null;
  endedAt: Date | null;
  updatedAt: Date;
}

export type MemberPatch = Partial<
  Pick<MemberRecord, "role" | "status" | "appScopeAll" | "appDids" | "hidden" | "joinedAt" | "endedAt">
> & { updatedAt: Date };

export interface TeamRecord {
  id: string;
  orgId: string;
  slug: string;
  name: string;
  appDids: string[];
  /** Member record ids. */
  memberIds: string[];
  createdAt: Date;
}

export type TeamPatch = Partial<Pick<TeamRecord, "slug" | "name" | "appDids">>;

export type DomainPatch = Partial<Pick<DomainRecord, "status" | "verifiedAt" | "lastCheckedAt" | "failures">>;

export interface InviteLinkRecord {
  id: string;
  orgId: string;
  /** sha256 hex of the token; the token itself is never stored. */
  tokenHash: string;
  role: OrgRole;
  maxUses: number;
  uses: number;
  expiresAt: Date;
  revoked: boolean;
  createdBy: string;
  createdAt: Date;
}

export interface OrgAppRecord {
  appDid: string;
  orgId: string;
  frozen: boolean;
  addedAt: Date;
}

/**
 * A member-level suspension: written when a member's exit could not list
 * their delegations. Every delegation the address issued for the
 * organisation's apps at or before `at` is suspended until an admin lifts it.
 */
export interface MemberSuspensionRecord {
  orgId: string;
  /** Lowercase. */
  address: string;
  /** MEMBER_LEFT or MEMBER_REMOVED. */
  reason: string;
  at: Date;
}

export interface SuspensionRecord {
  orgId: string;
  credentialId: string;
  /** ADMIN, MEMBER_LEFT or MEMBER_REMOVED. */
  reason: string;
  memberAddress: string | null;
  at: Date;
}

export interface DomainRecord {
  id: string;
  orgId: string;
  domain: string;
  /** The random part of the proof token. */
  token: string;
  status: DomainStatus;
  verifiedAt: Date | null;
  lastCheckedAt: Date | null;
  failures: number;
  createdAt: Date;
}

export interface AuditRecord {
  id: string;
  orgId: string;
  at: Date;
  actor: string;
  action: string;
  details: Record<string, unknown>;
}

export interface AuditCursor {
  at: Date;
  id: string;
}

export interface ReservedHandleRecord {
  handle: string;
  until: Date;
  /** ARCHIVED, CHANGED or RELEASED. */
  reason: string;
  orgId: string | null;
}

export interface OrgSearch {
  /** A LIKE prefix pattern (escape character \), or null for every listed organization. */
  pattern: string | null;
  limit: number;
  after?: { handle: string; id: string };
}

/** A signed release attestation as stored (spec 3.7). */
export interface AttestationRecord {
  id: string;
  appDid: string;
  version: string;
  /** sha256:<64 lowercase hex> */
  artifactDigest: string;
  /** The owning organisation when signed; "" for person-owned apps. */
  orgId: string;
  /** Lowercase. */
  signer: string;
  /** The signer's role when the attestation was accepted; null for person-owned apps. */
  signerRole: OrgRole | null;
  /** Exactly as signed (the client's clock, ISO-8601 text): /verify re-checks the signature over it. */
  issuedAt: string;
  signature: string;
  /** When renown-orgs accepted it. */
  createdAt: Date;
}

export interface AttestationCursor {
  createdAt: Date;
  id: string;
}

export interface OrgStore {
  /**
   * Runs `fn` against a store bound to one transaction: every write commits
   * together or not at all. Nested calls join the outer transaction.
   */
  transaction<T>(fn: (store: OrgStore) => Promise<T>): Promise<T>;
  insertOrganization(org: OrgRecord): Promise<boolean>;
  /**
   * The organization and its first owner in one transaction: false (nothing
   * written) when the id or handle is taken; a failed member insert rolls the
   * organization back.
   */
  insertOrganizationWithOwner(org: OrgRecord, owner: MemberRecord): Promise<boolean>;
  /** Deletes an organization with its members and teams (compensation for a failed create). */
  deleteOrganization(id: string): Promise<void>;
  organization(id: string): Promise<OrgRecord | undefined>;
  organizationByHandle(handle: string): Promise<OrgRecord | undefined>;
  organizationsByIds(ids: readonly string[]): Promise<OrgRecord[]>;
  updateOrganization(id: string, patch: OrgPatch, now: Date): Promise<OrgRecord | undefined>;
  countOrganizationsCreatedBy(address: string): Promise<number>;
  searchOrganizations(search: OrgSearch): Promise<OrgRecord[]>;
  insertMember(member: MemberRecord): Promise<void>;
  member(id: string): Promise<MemberRecord | undefined>;
  openMember(orgId: string, address: string): Promise<MemberRecord | undefined>;
  updateMember(id: string, patch: MemberPatch): Promise<MemberRecord | undefined>;
  /** Deletes a member record and its team places (compensation for a join whose document write failed). */
  deleteMember(id: string): Promise<void>;
  members(orgId: string, statuses?: readonly StoredMemberStatus[]): Promise<MemberRecord[]>;
  membershipsOf(address: string, statuses: readonly StoredMemberStatus[]): Promise<MemberRecord[]>;
  insertTeam(team: TeamRecord): Promise<void>;
  team(id: string): Promise<TeamRecord | undefined>;
  teams(orgId: string): Promise<TeamRecord[]>;
  updateTeam(id: string, patch: TeamPatch): Promise<TeamRecord | undefined>;
  deleteTeam(id: string): Promise<boolean>;
  setTeamMembers(teamId: string, memberIds: readonly string[]): Promise<void>;
  removeMemberFromTeams(memberId: string): Promise<void>;
  insertInviteLink(link: InviteLinkRecord): Promise<void>;
  inviteLink(id: string): Promise<InviteLinkRecord | undefined>;
  inviteLinkByHash(tokenHash: string): Promise<InviteLinkRecord | undefined>;
  inviteLinks(orgId: string): Promise<InviteLinkRecord[]>;
  useInviteLink(id: string, now: Date): Promise<boolean>;
  /** Gives back one use of an invite link (compensation for a join whose document write failed). */
  releaseInviteLinkUse(id: string): Promise<void>;
  revokeInviteLink(id: string): Promise<void>;
  orgApps(orgId: string): Promise<OrgAppRecord[]>;
  orgOfApp(appDid: string): Promise<OrgAppRecord | undefined>;
  /** False (nothing written) when the app already belongs to an organisation. */
  insertOrgApp(app: OrgAppRecord): Promise<boolean>;
  /** Removes the app from `orgId`; the removed record, or undefined when it was not that organisation's. */
  deleteOrgApp(appDid: string, orgId: string): Promise<OrgAppRecord | undefined>;
  setAppFrozen(appDid: string, frozen: boolean): Promise<void>;
  /** Throws when the app already has a PENDING transfer (org_app_transfers_one_pending). */
  insertTransfer(transfer: TransferRecord): Promise<void>;
  transfer(id: string): Promise<TransferRecord | undefined>;
  /** Newest first; `party` matches either side. */
  transfers(filter: { appDid?: string; party?: { kind: PartyKind; id: string } }): Promise<TransferRecord[]>;
  pendingTransferOf(appDid: string): Promise<TransferRecord | undefined>;
  /** Applies `patch` only while the transfer still has the `expected` status; undefined otherwise. */
  updateTransfer(id: string, patch: TransferPatch, expected: TransferStatus): Promise<TransferRecord | undefined>;
  /** PENDING transfers whose expiry passed, oldest expiry first. */
  dueTransfers(now: Date, limit: number): Promise<TransferRecord[]>;
  /** Inserts suspensions not present yet; returns the newly suspended credential ids, in input order. */
  suspendCredentials(rows: readonly SuspensionRecord[]): Promise<string[]>;
  /** Lifts a suspension; false when there was none. */
  unsuspendCredential(orgId: string, credentialId: string): Promise<boolean>;
  credentialSuspension(orgId: string, credentialId: string): Promise<SuspensionRecord | undefined>;
  /**
   * Records a member-level suspension; an existing one for the address moves
   * to the later `at` (it never shrinks).
   */
  suspendMember(record: MemberSuspensionRecord): Promise<void>;
  memberSuspension(orgId: string, address: string): Promise<MemberSuspensionRecord | undefined>;
  /** Lifts a member-level suspension; false when there was none. */
  liftMemberSuspension(orgId: string, address: string): Promise<boolean>;
  /** Suspended credential ids of `orgId`, sorted. */
  suspendedCredentialIds(orgId: string): Promise<string[]>;
  verifiedDomains(orgIds: readonly string[]): Promise<Map<string, string[]>>;
  insertDomain(domain: DomainRecord): Promise<void>;
  domain(id: string): Promise<DomainRecord | undefined>;
  /** createdAt order. */
  domains(orgId: string): Promise<DomainRecord[]>;
  /**
   * Throws when a second organization would get the same VERIFIED domain (the
   * org_domains_verified_once index). With `expected`, applies only while
   * last_checked_at still equals it (compare-and-set); undefined otherwise.
   */
  updateDomain(id: string, patch: DomainPatch, expected?: { lastCheckedAt: Date | null }): Promise<DomainRecord | undefined>;
  deleteDomain(id: string): Promise<boolean>;
  /** The organization the domain is VERIFIED for (case-insensitive), if any. */
  verifiedDomainOwner(domain: string): Promise<string | undefined>;
  /** VERIFIED domains never checked or last checked at or before `checkedBefore`, never-checked first, then oldest check. */
  domainsToRecheck(checkedBefore: Date, limit: number): Promise<DomainRecord[]>;
  verifiedOrgNamed(name: string, exceptOrgId: string): Promise<OrgRecord | undefined>;
  appendAudit(entry: AuditRecord): Promise<void>;
  auditPage(orgId: string, limit: number, after?: AuditCursor): Promise<AuditRecord[]>;
  reserveHandle(record: ReservedHandleRecord): Promise<void>;
  reservedHandle(handle: string, now: Date): Promise<ReservedHandleRecord | undefined>;
  /** Drops a handle reservation (compensation for a handle change whose document write failed). */
  deleteReservedHandle(handle: string): Promise<void>;
  /** Replay guard: true iff the signature hash was not seen before. */
  useSignature(hash: string, expiresAt: Date): Promise<boolean>;
  /** Deletes signature hashes that expired strictly before `now`; returns how many. */
  pruneUsedSignatures(now: Date): Promise<number>;
  insertProposal(proposal: ProposalRecord): Promise<void>;
  proposal(id: string): Promise<ProposalRecord | undefined>;
  /** Newest first; only `status` when given. */
  proposals(orgId: string, status?: ProposalStatus): Promise<ProposalRecord[]>;
  /** Applies `patch` only while the proposal still has the `expected` status; undefined otherwise. */
  updateProposal(id: string, patch: ProposalPatch, expected: ProposalStatus): Promise<ProposalRecord | undefined>;
  /** PENDING proposals executable or expired at `now`; never-checked first, then least recently checked, then oldest. */
  dueProposals(now: Date, limit: number): Promise<ProposalRecord[]>;
  /** Unexpired PENDING proposals without a countdown whose approvals could already reach their threshold; never-checked first, then least recently checked, then oldest. */
  rearmableProposals(now: Date, limit: number): Promise<ProposalRecord[]>;
  /** Claims a run of job `name` at `now` unless one started less than `everyMs` ago; the previous start, or null. */
  claimJob(name: string, now: Date, everyMs: number): Promise<{ previous: Date | null } | null>;
  /** Undoes the claim made at `claimedAt` (back to `previous`, or no row). */
  releaseJob(name: string, claimedAt: Date, previous: Date | null): Promise<void>;
  jobLastRun(name: string): Promise<Date | undefined>;
  /** Notes that the sweeper examined a proposal without progressing it, so others get their turn in the batch. */
  markProposalChecked(id: string, now: Date): Promise<void>;
  /** False when the app, version and signer already have one. */
  insertAttestation(attestation: AttestationRecord): Promise<boolean>;
  attestation(id: string): Promise<AttestationRecord | undefined>;
  attestationBy(appDid: string, version: string, signer: string): Promise<AttestationRecord | undefined>;
  /** Newest first (createdAt, then id), strictly after the cursor. */
  attestationsPage(appDid: string, limit: number, after?: AttestationCursor): Promise<AttestationRecord[]>;
  /** Attestations of `appDid` accepted at or after `since`. */
  countAttestationsSince(appDid: string, since: Date): Promise<number>;
  /** Attestations signed for `orgId` accepted at or after `since`. */
  countOrgAttestationsSince(orgId: string, since: Date): Promise<number>;
  insertNotifications(rows: readonly NotificationRecord[]): Promise<void>;
  /** Newest first, strictly after the cursor. */
  notificationsPage(recipient: string, options: { unreadOnly: boolean; limit: number; after?: { createdAt: Date; id: string } }): Promise<NotificationRecord[]>;
  unreadNotificationCount(recipient: string): Promise<number>;
  /** Marks the recipient's unread notifications (`ids`, or every one) read; returns how many changed. */
  markNotificationsRead(recipient: string, ids: readonly string[] | "ALL", now: Date): Promise<number>;
  /** Deletes notifications created before `before`; returns how many. */
  pruneNotifications(before: Date): Promise<number>;
  /** Every app any organisation owns. */
  allOrgApps(): Promise<OrgAppRecord[]>;
  /** How far the windowed job `name` has processed, if ever. */
  jobWatermark(name: string): Promise<Date | undefined>;
  /** Records how far the job `name` has processed (creating its row when needed). */
  setJobWatermark(name: string, at: Date): Promise<void>;
  /** True the first time only: the DELEGATION_ADDED alert of `credentialId` is now taken. */
  claimDelegationAlert(credentialId: string, orgId: string, now: Date): Promise<boolean>;
  /** Forgets delegation alerts taken before `before`; returns how many. */
  pruneDelegationAlerts(before: Date): Promise<number>;
}
