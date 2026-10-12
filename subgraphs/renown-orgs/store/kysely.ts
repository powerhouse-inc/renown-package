import { sql, type Selectable } from "kysely";
import type {
  AttestationCursor,
  AttestationRecord,
  AuditCursor,
  AuditRecord,
  DomainPatch,
  DomainRecord,
  InviteLinkRecord,
  MemberPatch,
  MemberRecord,
  OrgAppRecord,
  OrgAppsTable,
  OrgAppTransfersTable,
  PartyKind,
  SuspensionRecord,
  MemberSuspensionRecord,
  NotificationRecord,
  DeliveryPatch,
  DeliveryRecord,
  OrganizationsTable,
  OrgWebhookDeliveriesTable,
  OrgWebhooksTable,
  WebhookPatch,
  OrgOidcClientLink,
  WebhookRecord,
  OrgInviteLinksTable,
  OrgLink,
  OrgDomainsTable,
  OrgMembersTable,
  OrgNotificationsTable,
  OrgPatch,
  OrgProposalsTable,
  OrgRecord,
  OrgReleaseAttestationsTable,
  OrgReportsTable,
  ReportRecord,
  ReportResolution,
  ReportStatus,
  OrgSearch,
  OrgsKysely,
  OrgStore,
  OrgTeamsTable,
  ProposalPatch,
  ProposalPayload,
  ProposalRecord,
  ProposalStatus,
  ReservedHandleRecord,
  StoredMemberStatus,
  TeamPatch,
  TeamRecord,
  TransferPatch,
  TransferRecord,
  TransferStatus,
} from "./types.js";

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDateOrNull(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value);
}

function toReport(row: Selectable<OrgReportsTable>): ReportRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    reporter: row.reporter,
    reason: row.reason,
    details: row.details,
    status: row.status,
    resolution: row.resolution,
    resolvedBy: row.resolved_by,
    resolvedAt: toDateOrNull(row.resolved_at),
    note: row.note,
    createdAt: toDate(row.created_at),
  };
}

/** A jsonb value as the driver returned it (parsed, or a JSON string), or `fallback`. */
export function jsonValue<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
}

function stringList(value: unknown): string[] {
  const list = jsonValue<unknown>(value, []);
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

function linkList(value: unknown): OrgLink[] {
  const list = jsonValue<unknown>(value, []);
  if (!Array.isArray(list)) return [];
  return list.flatMap((item: unknown) => {
    const link = item as Partial<OrgLink> | null;
    return link && typeof link.id === "string" && typeof link.label === "string" && typeof link.url === "string"
      ? [{ id: link.id, label: link.label, url: link.url }]
      : [];
  });
}

function toOrg(row: Selectable<OrganizationsTable>): OrgRecord {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name,
    bio: row.bio,
    website: row.website,
    avatarRef: row.avatar_ref,
    links: linkList(row.links),
    listed: row.listed,
    membersPublic: row.members_public,
    archived: row.archived,
    takenDown: row.taken_down,
    createdBy: row.created_by,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toMember(row: Selectable<OrgMembersTable>): MemberRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    address: row.address,
    role: row.role,
    status: row.status,
    appScopeAll: row.app_scope_all,
    appDids: stringList(row.app_dids),
    hidden: row.hidden,
    invitedBy: row.invited_by,
    invitedAt: toDate(row.invited_at),
    joinedAt: toDateOrNull(row.joined_at),
    endedAt: toDateOrNull(row.ended_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toLink(row: Selectable<OrgInviteLinksTable>): InviteLinkRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    tokenHash: row.token_hash,
    role: row.role,
    maxUses: row.max_uses,
    uses: row.uses,
    expiresAt: toDate(row.expires_at),
    revoked: row.revoked,
    createdBy: row.created_by,
    createdAt: toDate(row.created_at),
  };
}

function toDomain(row: Selectable<OrgDomainsTable>): DomainRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    domain: row.domain,
    token: row.token,
    status: row.status,
    verifiedAt: toDateOrNull(row.verified_at),
    lastCheckedAt: toDateOrNull(row.last_checked_at),
    failures: row.failures,
    createdAt: toDate(row.created_at),
  };
}

function toOrgApp(row: Selectable<OrgAppsTable>): OrgAppRecord {
  return { appDid: row.app_did, orgId: row.org_id, frozen: row.frozen, addedAt: toDate(row.added_at) };
}

function toTransfer(row: Selectable<OrgAppTransfersTable>): TransferRecord {
  return {
    id: row.id,
    appDid: row.app_did,
    fromKind: row.from_kind,
    fromId: row.from_id,
    toKind: row.to_kind,
    toId: row.to_id,
    status: row.status,
    createdAt: toDate(row.created_at),
    expiresAt: toDate(row.expires_at),
    decidedAt: toDateOrNull(row.decided_at),
    decidedBy: row.decided_by,
    proposalId: row.proposal_id,
    reason: row.reason,
  };
}

function toAttestation(row: Selectable<OrgReleaseAttestationsTable>): AttestationRecord {
  return {
    id: row.id,
    appDid: row.app_did,
    version: row.version,
    artifactDigest: row.artifact_digest,
    orgId: row.org_id,
    signer: row.signer,
    signerRole: row.signer_role,
    issuedAt: row.issued_at,
    signature: row.signature,
    createdAt: toDate(row.created_at),
  };
}

function toProposal(row: Selectable<OrgProposalsTable>): ProposalRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    kind: row.kind,
    payload: jsonValue<ProposalPayload>(row.payload, {}),
    proposer: row.proposer,
    approvals: stringList(row.approvals),
    status: row.status,
    threshold: row.threshold,
    createdAt: toDate(row.created_at),
    executableAt: toDateOrNull(row.executable_at),
    expiresAt: toDate(row.expires_at),
    executedAt: toDateOrNull(row.executed_at),
    reason: row.reason,
  };
}

async function replaceTeamMembers(db: OrgsKysely, teamId: string, memberIds: readonly string[]): Promise<void> {
  await db.deleteFrom("org_team_members").where("team_id", "=", teamId).execute();
  const unique = [...new Set(memberIds)];
  if (unique.length === 0) return;
  await db
    .insertInto("org_team_members")
    .values(unique.map((memberId) => ({ team_id: teamId, member_id: memberId })))
    .execute();
}

function toWebhook(row: Selectable<OrgWebhooksTable>): WebhookRecord {
  return {
    id: row.id,
    orgId: row.org_id,
    url: row.url,
    events: stringList(row.events),
    secretSealed: row.secret_sealed,
    enabled: row.enabled,
    consecutiveFailures: row.consecutive_failures,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toDelivery(row: Selectable<OrgWebhookDeliveriesTable>): DeliveryRecord {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    orgId: row.org_id,
    eventId: row.event_id,
    eventType: row.event_type,
    body: row.body,
    status: row.status,
    attempts: row.attempts,
    responseStatus: row.response_status,
    lastError: row.last_error,
    createdAt: toDate(row.created_at),
    nextAttemptAt: toDateOrNull(row.next_attempt_at),
    deliveredAt: toDateOrNull(row.delivered_at),
  };
}

/** Kysely-backed `OrgStore`. The `db` passed in is already namespace-scoped. */
export class KyselyOrgStore implements OrgStore {
  constructor(readonly db: OrgsKysely) {}

  /** `fn` in a transaction, or inside the current one when this store already runs in a transaction. */
  private inTransaction<T>(fn: (trx: OrgsKysely) => Promise<T>): Promise<T> {
    return this.db.isTransaction ? fn(this.db) : this.db.transaction().execute(fn);
  }

  transaction<T>(fn: (store: OrgStore) => Promise<T>): Promise<T> {
    return this.inTransaction((trx) => fn(new KyselyOrgStore(trx)));
  }

  async insertOrganization(org: OrgRecord): Promise<boolean> {
    const inserted = await this.db
      .insertInto("organizations")
      .values({
        id: org.id,
        handle: org.handle,
        name: org.name,
        bio: org.bio,
        website: org.website,
        avatar_ref: org.avatarRef,
        links: JSON.stringify(org.links),
        listed: org.listed,
        members_public: org.membersPublic,
        archived: org.archived,
        taken_down: org.takenDown,
        created_by: org.createdBy.toLowerCase(),
        created_at: org.createdAt,
        updated_at: org.updatedAt,
      })
      .onConflict((oc) => oc.doNothing())
      .returning("id")
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async insertOrganizationWithOwner(org: OrgRecord, owner: MemberRecord): Promise<boolean> {
    return this.inTransaction(async (trx) => {
      const store = new KyselyOrgStore(trx);
      if (!(await store.insertOrganization(org))) return false;
      await store.insertMember(owner);
      return true;
    });
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.inTransaction(async (trx) => {
      const teams = trx.selectFrom("org_teams").select("id").where("org_id", "=", id);
      await trx.deleteFrom("org_team_members").where("team_id", "in", teams).execute();
      await trx.deleteFrom("org_teams").where("org_id", "=", id).execute();
      await trx.deleteFrom("org_members").where("org_id", "=", id).execute();
      await trx.deleteFrom("organizations").where("id", "=", id).execute();
    });
  }

  async organization(id: string): Promise<OrgRecord | undefined> {
    const row = await this.db.selectFrom("organizations").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toOrg(row);
  }

  async organizationByHandle(handle: string): Promise<OrgRecord | undefined> {
    const row = await this.db
      .selectFrom("organizations")
      .selectAll()
      .where(sql<string>`lower(handle)`, "=", handle.toLowerCase())
      .executeTakeFirst();
    return row && toOrg(row);
  }

  async organizationsByIds(ids: readonly string[]): Promise<OrgRecord[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.selectFrom("organizations").selectAll().where("id", "in", [...ids]).orderBy("id").execute();
    return rows.map(toOrg);
  }

  async updateOrganization(id: string, patch: OrgPatch, now: Date): Promise<OrgRecord | undefined> {
    const row = await this.db
      .updateTable("organizations")
      .set({
        ...(patch.handle !== undefined && { handle: patch.handle }),
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.bio !== undefined && { bio: patch.bio }),
        ...(patch.website !== undefined && { website: patch.website }),
        ...(patch.avatarRef !== undefined && { avatar_ref: patch.avatarRef }),
        ...(patch.links !== undefined && { links: JSON.stringify(patch.links) }),
        ...(patch.listed !== undefined && { listed: patch.listed }),
        ...(patch.membersPublic !== undefined && { members_public: patch.membersPublic }),
        ...(patch.archived !== undefined && { archived: patch.archived }),
        ...(patch.takenDown !== undefined && { taken_down: patch.takenDown }),
        updated_at: now,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row && toOrg(row);
  }

  async countOrganizationsCreatedBy(address: string): Promise<number> {
    const row = await this.db
      .selectFrom("organizations")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("created_by", "=", address.toLowerCase())
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async searchOrganizations(search: OrgSearch): Promise<OrgRecord[]> {
    const handleKey = sql<string>`lower(handle) COLLATE "C"`;
    const idKey = sql<string>`id COLLATE "C"`;
    let query = this.db
      .selectFrom("organizations")
      .selectAll()
      .where("listed", "=", true)
      .where("archived", "=", false)
      .where("taken_down", "=", false);
    if (search.pattern !== null) {
      query = query.where(
        sql<boolean>`(lower(handle) LIKE lower(${search.pattern}) ESCAPE '\\' OR lower(name) LIKE lower(${search.pattern}) ESCAPE '\\')`,
      );
    }
    const after = search.after;
    if (after) {
      query = query.where(
        sql<boolean>`(${handleKey} > ${after.handle} OR (${handleKey} = ${after.handle} AND ${idKey} > ${after.id}))`,
      );
    }
    const rows = await query
      .orderBy(sql`${handleKey} ASC`)
      .orderBy(sql`${idKey} ASC`)
      .limit(search.limit + 1)
      .execute();
    return rows.map(toOrg);
  }

  async insertMember(member: MemberRecord): Promise<void> {
    await this.db
      .insertInto("org_members")
      .values({
        id: member.id,
        org_id: member.orgId,
        address: member.address.toLowerCase(),
        role: member.role,
        status: member.status,
        app_scope_all: member.appScopeAll,
        app_dids: JSON.stringify(member.appDids),
        hidden: member.hidden,
        invited_by: member.invitedBy?.toLowerCase() ?? null,
        invited_at: member.invitedAt,
        joined_at: member.joinedAt,
        ended_at: member.endedAt,
        updated_at: member.updatedAt,
      })
      .execute();
  }

  async member(id: string): Promise<MemberRecord | undefined> {
    const row = await this.db.selectFrom("org_members").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toMember(row);
  }

  async openMember(orgId: string, address: string): Promise<MemberRecord | undefined> {
    const row = await this.db
      .selectFrom("org_members")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("address", "=", address.toLowerCase())
      .where("status", "in", ["INVITED", "ACTIVE"])
      .executeTakeFirst();
    return row && toMember(row);
  }

  async updateMember(id: string, patch: MemberPatch): Promise<MemberRecord | undefined> {
    const row = await this.db
      .updateTable("org_members")
      .set({
        ...(patch.role !== undefined && { role: patch.role }),
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.appScopeAll !== undefined && { app_scope_all: patch.appScopeAll }),
        ...(patch.appDids !== undefined && { app_dids: JSON.stringify(patch.appDids) }),
        ...(patch.hidden !== undefined && { hidden: patch.hidden }),
        ...(patch.joinedAt !== undefined && { joined_at: patch.joinedAt }),
        ...(patch.endedAt !== undefined && { ended_at: patch.endedAt }),
        updated_at: patch.updatedAt,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row && toMember(row);
  }

  async deleteMember(id: string): Promise<void> {
    await this.inTransaction(async (trx) => {
      await trx.deleteFrom("org_team_members").where("member_id", "=", id).execute();
      await trx.deleteFrom("org_members").where("id", "=", id).execute();
    });
  }

  async members(orgId: string, statuses?: readonly StoredMemberStatus[]): Promise<MemberRecord[]> {
    let query = this.db.selectFrom("org_members").selectAll().where("org_id", "=", orgId);
    if (statuses) query = query.where("status", "in", [...statuses]);
    const rows = await query.orderBy("invited_at").orderBy("id").execute();
    return rows.map(toMember);
  }

  async membershipsOf(address: string, statuses: readonly StoredMemberStatus[]): Promise<MemberRecord[]> {
    const rows = await this.db
      .selectFrom("org_members")
      .selectAll()
      .where("address", "=", address.toLowerCase())
      .where("status", "in", [...statuses])
      .orderBy("invited_at")
      .orderBy("id")
      .execute();
    return rows.map(toMember);
  }

  private async withMembers(rows: Selectable<OrgTeamsTable>[]): Promise<TeamRecord[]> {
    if (rows.length === 0) return [];
    const links = await this.db
      .selectFrom("org_team_members")
      .select(["team_id", "member_id"])
      .where(
        "team_id",
        "in",
        rows.map((row) => row.id),
      )
      .orderBy("member_id")
      .execute();
    return rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      slug: row.slug,
      name: row.name,
      appDids: stringList(row.app_dids),
      memberIds: links.filter((link) => link.team_id === row.id).map((link) => link.member_id),
      createdAt: toDate(row.created_at),
    }));
  }

  async insertTeam(team: TeamRecord): Promise<void> {
    await this.inTransaction(async (trx) => {
      await trx
        .insertInto("org_teams")
        .values({
          id: team.id,
          org_id: team.orgId,
          slug: team.slug,
          name: team.name,
          app_dids: JSON.stringify(team.appDids),
          created_at: team.createdAt,
        })
        .execute();
      await replaceTeamMembers(trx, team.id, team.memberIds);
    });
  }

  async team(id: string): Promise<TeamRecord | undefined> {
    const rows = await this.db.selectFrom("org_teams").selectAll().where("id", "=", id).execute();
    return (await this.withMembers(rows))[0];
  }

  async teams(orgId: string): Promise<TeamRecord[]> {
    const rows = await this.db
      .selectFrom("org_teams")
      .selectAll()
      .where("org_id", "=", orgId)
      .orderBy("created_at")
      .orderBy("id")
      .execute();
    return this.withMembers(rows);
  }

  async updateTeam(id: string, patch: TeamPatch): Promise<TeamRecord | undefined> {
    const updated = await this.db
      .updateTable("org_teams")
      .set({
        ...(patch.slug !== undefined && { slug: patch.slug }),
        ...(patch.name !== undefined && { name: patch.name }),
        ...(patch.appDids !== undefined && { app_dids: JSON.stringify(patch.appDids) }),
      })
      .where("id", "=", id)
      .returningAll()
      .execute();
    return (await this.withMembers(updated))[0];
  }

  async deleteTeam(id: string): Promise<boolean> {
    return this.inTransaction(async (trx) => {
      await trx.deleteFrom("org_team_members").where("team_id", "=", id).execute();
      const result = await trx.deleteFrom("org_teams").where("id", "=", id).executeTakeFirst();
      return Number(result.numDeletedRows) > 0;
    });
  }

  async setTeamMembers(teamId: string, memberIds: readonly string[]): Promise<void> {
    await this.inTransaction((trx) => replaceTeamMembers(trx, teamId, memberIds));
  }

  async removeMemberFromTeams(memberId: string): Promise<void> {
    await this.db.deleteFrom("org_team_members").where("member_id", "=", memberId).execute();
  }

  async insertInviteLink(link: InviteLinkRecord): Promise<void> {
    await this.db
      .insertInto("org_invite_links")
      .values({
        id: link.id,
        org_id: link.orgId,
        token_hash: link.tokenHash,
        role: link.role,
        max_uses: link.maxUses,
        uses: link.uses,
        expires_at: link.expiresAt,
        revoked: link.revoked,
        created_by: link.createdBy.toLowerCase(),
        created_at: link.createdAt,
      })
      .execute();
  }

  async inviteLink(id: string): Promise<InviteLinkRecord | undefined> {
    const row = await this.db.selectFrom("org_invite_links").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toLink(row);
  }

  async inviteLinkByHash(tokenHash: string): Promise<InviteLinkRecord | undefined> {
    const row = await this.db
      .selectFrom("org_invite_links")
      .selectAll()
      .where("token_hash", "=", tokenHash)
      .executeTakeFirst();
    return row && toLink(row);
  }

  async inviteLinks(orgId: string): Promise<InviteLinkRecord[]> {
    const rows = await this.db
      .selectFrom("org_invite_links")
      .selectAll()
      .where("org_id", "=", orgId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .execute();
    return rows.map(toLink);
  }

  async useInviteLink(id: string, now: Date): Promise<boolean> {
    const row = await this.db
      .updateTable("org_invite_links")
      .set((eb) => ({ uses: eb("uses", "+", 1) }))
      .where("id", "=", id)
      .where("revoked", "=", false)
      .where("expires_at", ">", now)
      .where((eb) => eb("uses", "<", eb.ref("max_uses")))
      .returning("id")
      .executeTakeFirst();
    return row !== undefined;
  }

  async releaseInviteLinkUse(id: string): Promise<void> {
    await this.db
      .updateTable("org_invite_links")
      .set((eb) => ({ uses: eb("uses", "-", 1) }))
      .where("id", "=", id)
      .where("uses", ">", 0)
      .execute();
  }

  async revokeInviteLink(id: string): Promise<void> {
    await this.db.updateTable("org_invite_links").set({ revoked: true }).where("id", "=", id).execute();
  }

  async orgApps(orgId: string): Promise<OrgAppRecord[]> {
    const rows = await this.db
      .selectFrom("org_apps")
      .selectAll()
      .where("org_id", "=", orgId)
      .orderBy("added_at")
      .orderBy("app_did")
      .execute();
    return rows.map(toOrgApp);
  }

  async orgOfApp(appDid: string): Promise<OrgAppRecord | undefined> {
    const row = await this.db.selectFrom("org_apps").selectAll().where("app_did", "=", appDid).executeTakeFirst();
    return row && toOrgApp(row);
  }

  async insertOrgApp(app: OrgAppRecord): Promise<boolean> {
    const inserted = await this.db
      .insertInto("org_apps")
      .values({ app_did: app.appDid, org_id: app.orgId, frozen: app.frozen, added_at: app.addedAt })
      .onConflict((oc) => oc.column("app_did").doNothing())
      .returning("app_did")
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async deleteOrgApp(appDid: string, orgId: string): Promise<OrgAppRecord | undefined> {
    const row = await this.db.deleteFrom("org_apps").where("app_did", "=", appDid).where("org_id", "=", orgId).returningAll().executeTakeFirst();
    return row && toOrgApp(row);
  }

  async setAppFrozen(appDid: string, frozen: boolean): Promise<void> {
    await this.db.updateTable("org_apps").set({ frozen }).where("app_did", "=", appDid).execute();
  }

  async insertTransfer(t: TransferRecord): Promise<void> {
    await this.db
      .insertInto("org_app_transfers")
      .values({
        id: t.id,
        app_did: t.appDid,
        from_kind: t.fromKind,
        from_id: t.fromId,
        to_kind: t.toKind,
        to_id: t.toId,
        status: t.status,
        created_at: t.createdAt,
        expires_at: t.expiresAt,
        decided_at: t.decidedAt,
        decided_by: t.decidedBy,
        proposal_id: t.proposalId,
        reason: t.reason,
      })
      .execute();
  }

  async transfer(id: string): Promise<TransferRecord | undefined> {
    const row = await this.db.selectFrom("org_app_transfers").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toTransfer(row);
  }

  async transfers(filter: { appDid?: string; party?: { kind: PartyKind; id: string } }): Promise<TransferRecord[]> {
    let query = this.db.selectFrom("org_app_transfers").selectAll();
    if (filter.appDid) query = query.where("app_did", "=", filter.appDid);
    const party = filter.party;
    if (party) {
      query = query.where((eb) =>
        eb.or([
          eb.and([eb("from_kind", "=", party.kind), eb("from_id", "=", party.id)]),
          eb.and([eb("to_kind", "=", party.kind), eb("to_id", "=", party.id)]),
        ]),
      );
    }
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").execute();
    return rows.map(toTransfer);
  }

  async pendingTransferOf(appDid: string): Promise<TransferRecord | undefined> {
    const row = await this.db
      .selectFrom("org_app_transfers")
      .selectAll()
      .where("app_did", "=", appDid)
      .where("status", "=", "PENDING")
      .executeTakeFirst();
    return row && toTransfer(row);
  }

  async updateTransfer(id: string, patch: TransferPatch, expected: TransferStatus): Promise<TransferRecord | undefined> {
    const row = await this.db
      .updateTable("org_app_transfers")
      .set({
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.decidedAt !== undefined && { decided_at: patch.decidedAt }),
        ...(patch.decidedBy !== undefined && { decided_by: patch.decidedBy }),
        ...(patch.reason !== undefined && { reason: patch.reason }),
      })
      .where("id", "=", id)
      .where("status", "=", expected)
      .returningAll()
      .executeTakeFirst();
    return row && toTransfer(row);
  }

  async dueTransfers(now: Date, limit: number): Promise<TransferRecord[]> {
    const rows = await this.db
      .selectFrom("org_app_transfers")
      .selectAll()
      .where("status", "=", "PENDING")
      .where("expires_at", "<=", now)
      .orderBy("expires_at")
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.map(toTransfer);
  }

  async suspendCredentials(rows: readonly SuspensionRecord[]): Promise<string[]> {
    const added: string[] = [];
    for (const row of rows) {
      const inserted = await this.db
        .insertInto("org_credential_suspensions")
        .values({ org_id: row.orgId, credential_id: row.credentialId, reason: row.reason, member_address: row.memberAddress, at: row.at })
        .onConflict((oc) => oc.columns(["org_id", "credential_id"]).doNothing())
        .returning("credential_id")
        .executeTakeFirst();
      if (inserted) added.push(inserted.credential_id);
    }
    return added;
  }

  async unsuspendCredential(orgId: string, credentialId: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("org_credential_suspensions")
      .where("org_id", "=", orgId)
      .where("credential_id", "=", credentialId)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async credentialSuspension(orgId: string, credentialId: string): Promise<SuspensionRecord | undefined> {
    const row = await this.db
      .selectFrom("org_credential_suspensions")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("credential_id", "=", credentialId)
      .executeTakeFirst();
    return (
      row && { orgId: row.org_id, credentialId: row.credential_id, reason: row.reason, memberAddress: row.member_address, at: toDate(row.at) }
    );
  }

  async suspendMember(record: MemberSuspensionRecord): Promise<void> {
    await this.db
      .insertInto("org_member_suspensions")
      .values({ org_id: record.orgId, address: record.address.toLowerCase(), suspended_at: record.at, reason: record.reason })
      .onConflict((oc) =>
        oc.columns(["org_id", "address"]).doUpdateSet({
          suspended_at: sql`greatest(org_member_suspensions.suspended_at, excluded.suspended_at)`,
          reason: (eb) => eb.ref("excluded.reason"),
        }),
      )
      .execute();
  }

  async memberSuspension(orgId: string, address: string): Promise<MemberSuspensionRecord | undefined> {
    const row = await this.db
      .selectFrom("org_member_suspensions")
      .selectAll()
      .where("org_id", "=", orgId)
      .where("address", "=", address.toLowerCase())
      .executeTakeFirst();
    return row && { orgId: row.org_id, address: row.address, reason: row.reason, at: toDate(row.suspended_at) };
  }

  async liftMemberSuspension(orgId: string, address: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom("org_member_suspensions")
      .where("org_id", "=", orgId)
      .where("address", "=", address.toLowerCase())
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async suspendedCredentialIds(orgId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom("org_credential_suspensions")
      .select("credential_id")
      .where("org_id", "=", orgId)
      .orderBy("credential_id")
      .execute();
    return rows.map((row) => row.credential_id);
  }

  async verifiedDomains(orgIds: readonly string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (orgIds.length === 0) return out;
    const rows = await this.db
      .selectFrom("org_domains")
      .select(["org_id", "domain"])
      .where("org_id", "in", [...orgIds])
      .where("status", "=", "VERIFIED")
      .orderBy("domain")
      .execute();
    for (const row of rows) out.set(row.org_id, [...(out.get(row.org_id) ?? []), row.domain]);
    return out;
  }

  async insertDomain(d: DomainRecord): Promise<void> {
    await this.db
      .insertInto("org_domains")
      .values({
        id: d.id,
        org_id: d.orgId,
        domain: d.domain,
        token: d.token,
        status: d.status,
        verified_at: d.verifiedAt,
        last_checked_at: d.lastCheckedAt,
        failures: d.failures,
        created_at: d.createdAt,
      })
      .execute();
  }

  async domain(id: string): Promise<DomainRecord | undefined> {
    const row = await this.db.selectFrom("org_domains").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toDomain(row);
  }

  async domains(orgId: string): Promise<DomainRecord[]> {
    const rows = await this.db.selectFrom("org_domains").selectAll().where("org_id", "=", orgId).orderBy("created_at").orderBy("id").execute();
    return rows.map(toDomain);
  }

  async updateDomain(id: string, patch: DomainPatch, expected?: { lastCheckedAt: Date | null }): Promise<DomainRecord | undefined> {
    let query = this.db
      .updateTable("org_domains")
      .set({
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.verifiedAt !== undefined && { verified_at: patch.verifiedAt }),
        ...(patch.lastCheckedAt !== undefined && { last_checked_at: patch.lastCheckedAt }),
        ...(patch.failures !== undefined && { failures: patch.failures }),
      })
      .where("id", "=", id);
    if (expected) {
      const checkedAt = expected.lastCheckedAt;
      query = checkedAt === null ? query.where("last_checked_at", "is", null) : query.where("last_checked_at", "=", checkedAt);
    }
    const row = await query.returningAll().executeTakeFirst();
    return row && toDomain(row);
  }

  async deleteDomain(id: string): Promise<boolean> {
    const result = await this.db.deleteFrom("org_domains").where("id", "=", id).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async verifiedDomainOwner(domain: string): Promise<string | undefined> {
    const row = await this.db
      .selectFrom("org_domains")
      .select("org_id")
      .where(sql<string>`lower(domain)`, "=", domain.toLowerCase())
      .where("status", "=", "VERIFIED")
      .executeTakeFirst();
    return row?.org_id;
  }

  async domainsToRecheck(checkedBefore: Date, limit: number): Promise<DomainRecord[]> {
    const rows = await this.db
      .selectFrom("org_domains")
      .selectAll()
      .where("status", "=", "VERIFIED")
      .where((eb) => eb.or([eb("last_checked_at", "is", null), eb("last_checked_at", "<=", checkedBefore)]))
      .orderBy("last_checked_at", sql`asc nulls first`)
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.map(toDomain);
  }

  async verifiedOrgNamed(name: string, exceptOrgId: string): Promise<OrgRecord | undefined> {
    const row = await this.db
      .selectFrom("organizations")
      .selectAll("organizations")
      .where(sql<string>`lower(organizations.name)`, "=", name.toLowerCase())
      .where("organizations.id", "<>", exceptOrgId)
      .where("organizations.taken_down", "=", false)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom("org_domains")
            .select("org_domains.id")
            .whereRef("org_domains.org_id", "=", "organizations.id")
            .where("org_domains.status", "=", "VERIFIED"),
        ),
      )
      .orderBy("organizations.created_at")
      .executeTakeFirst();
    return row && toOrg(row);
  }

  async appendAudit(entry: AuditRecord): Promise<void> {
    await this.db
      .insertInto("org_audit")
      .values({
        id: entry.id,
        org_id: entry.orgId,
        at: entry.at,
        actor: entry.actor.toLowerCase(),
        action: entry.action,
        details: JSON.stringify(entry.details),
      })
      .execute();
  }

  async auditPage(orgId: string, limit: number, after?: AuditCursor): Promise<AuditRecord[]> {
    let query = this.db.selectFrom("org_audit").selectAll().where("org_id", "=", orgId);
    if (after) {
      query = query.where((eb) =>
        eb.or([eb("at", "<", after.at), eb.and([eb("at", "=", after.at), eb("id", "<", after.id)])]),
      );
    }
    const rows = await query.orderBy("at", "desc").orderBy("id", "desc").limit(limit).execute();
    return rows.map((row) => ({
      id: row.id,
      orgId: row.org_id,
      at: toDate(row.at),
      actor: row.actor,
      action: row.action,
      details: jsonValue<Record<string, unknown>>(row.details, {}),
    }));
  }

  async reserveHandle(record: ReservedHandleRecord): Promise<void> {
    await this.db
      .insertInto("reserved_handles")
      .values({ handle: record.handle.toLowerCase(), until: record.until, reason: record.reason, org_id: record.orgId })
      .onConflict((oc) =>
        oc.column("handle").doUpdateSet({ until: record.until, reason: record.reason, org_id: record.orgId }),
      )
      .execute();
  }

  async reservedHandle(handle: string, now: Date): Promise<ReservedHandleRecord | undefined> {
    const row = await this.db
      .selectFrom("reserved_handles")
      .selectAll()
      .where("handle", "=", handle.toLowerCase())
      .where("until", ">", now)
      .executeTakeFirst();
    return row && { handle: row.handle, until: toDate(row.until), reason: row.reason, orgId: row.org_id };
  }

  async deleteReservedHandle(handle: string): Promise<void> {
    await this.db.deleteFrom("reserved_handles").where("handle", "=", handle.toLowerCase()).execute();
  }

  async useSignature(hash: string, expiresAt: Date): Promise<boolean> {
    const row = await this.db
      .insertInto("org_used_signatures")
      .values({ hash, expires_at: expiresAt })
      .onConflict((oc) => oc.doNothing())
      .returning("hash")
      .executeTakeFirst();
    return row !== undefined;
  }

  async pruneUsedSignatures(now: Date): Promise<number> {
    const result = await this.db.deleteFrom("org_used_signatures").where("expires_at", "<", now).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async insertProposal(p: ProposalRecord): Promise<void> {
    await this.db
      .insertInto("org_proposals")
      .values({
        id: p.id,
        org_id: p.orgId,
        kind: p.kind,
        payload: JSON.stringify(p.payload),
        proposer: p.proposer.toLowerCase(),
        approvals: JSON.stringify(p.approvals.map((a) => a.toLowerCase())),
        status: p.status,
        threshold: p.threshold,
        created_at: p.createdAt,
        executable_at: p.executableAt,
        expires_at: p.expiresAt,
        executed_at: p.executedAt,
        reason: p.reason,
      })
      .execute();
  }

  async proposal(id: string): Promise<ProposalRecord | undefined> {
    const row = await this.db.selectFrom("org_proposals").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toProposal(row);
  }

  async proposals(orgId: string, status?: ProposalStatus): Promise<ProposalRecord[]> {
    let query = this.db.selectFrom("org_proposals").selectAll().where("org_id", "=", orgId);
    if (status) query = query.where("status", "=", status);
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").execute();
    return rows.map(toProposal);
  }

  async updateProposal(id: string, patch: ProposalPatch, expected: ProposalStatus): Promise<ProposalRecord | undefined> {
    const row = await this.db
      .updateTable("org_proposals")
      .set({
        ...(patch.approvals !== undefined && { approvals: JSON.stringify(patch.approvals.map((a) => a.toLowerCase())) }),
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.executableAt !== undefined && { executable_at: patch.executableAt }),
        ...(patch.executedAt !== undefined && { executed_at: patch.executedAt }),
        ...(patch.reason !== undefined && { reason: patch.reason }),
      })
      .where("id", "=", id)
      .where("status", "=", expected)
      .returningAll()
      .executeTakeFirst();
    return row && toProposal(row);
  }

  async dueProposals(now: Date, limit: number): Promise<ProposalRecord[]> {
    const rows = await this.db
      .selectFrom("org_proposals")
      .selectAll()
      .where("status", "=", "PENDING")
      .where((eb) => eb.or([eb("executable_at", "<=", now), eb("expires_at", "<=", now)]))
      .orderBy("checked_at", sql`asc nulls first`)
      .orderBy("created_at")
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.map(toProposal);
  }

  async rearmableProposals(now: Date, limit: number): Promise<ProposalRecord[]> {
    const rows = await this.db
      .selectFrom("org_proposals")
      .selectAll()
      .where("status", "=", "PENDING")
      .where("executable_at", "is", null)
      .where("expires_at", ">", now)
      .where(sql<boolean>`jsonb_array_length(approvals) >= threshold`)
      .orderBy("checked_at", sql`asc nulls first`)
      .orderBy("created_at")
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.map(toProposal);
  }

  async claimJob(name: string, now: Date, everyMs: number): Promise<{ previous: Date | null } | null> {
    const row = await this.db.selectFrom("org_jobs").select("last_run_at").where("name", "=", name).executeTakeFirst();
    if (!row) {
      const inserted = await this.db
        .insertInto("org_jobs")
        .values({ name, last_run_at: now })
        .onConflict((oc) => oc.column("name").doNothing())
        .returning("name")
        .executeTakeFirst();
      return inserted ? { previous: null } : null;
    }
    const previous = toDate(row.last_run_at);
    if (now.getTime() - previous.getTime() < everyMs) return null;
    // Compare-and-set: of two replicas that read the same previous run, one wins.
    const claimed = await this.db
      .updateTable("org_jobs")
      .set({ last_run_at: now })
      .where("name", "=", name)
      .where("last_run_at", "=", previous)
      .returning("name")
      .executeTakeFirst();
    return claimed ? { previous } : null;
  }

  async releaseJob(name: string, claimedAt: Date, previous: Date | null): Promise<void> {
    if (previous === null) {
      await this.db.deleteFrom("org_jobs").where("name", "=", name).where("last_run_at", "=", claimedAt).execute();
      return;
    }
    await this.db.updateTable("org_jobs").set({ last_run_at: previous }).where("name", "=", name).where("last_run_at", "=", claimedAt).execute();
  }

  async jobLastRun(name: string): Promise<Date | undefined> {
    const row = await this.db.selectFrom("org_jobs").select("last_run_at").where("name", "=", name).executeTakeFirst();
    return row ? toDate(row.last_run_at) : undefined;
  }

  async markProposalChecked(id: string, now: Date): Promise<void> {
    await this.db.updateTable("org_proposals").set({ checked_at: now }).where("id", "=", id).execute();
  }

  async insertAttestation(a: AttestationRecord): Promise<boolean> {
    const inserted = await this.db
      .insertInto("org_release_attestations")
      .values({
        id: a.id,
        app_did: a.appDid,
        version: a.version,
        artifact_digest: a.artifactDigest,
        org_id: a.orgId,
        signer: a.signer.toLowerCase(),
        signer_role: a.signerRole,
        issued_at: a.issuedAt,
        signature: a.signature,
        created_at: a.createdAt,
      })
      .onConflict((oc) => oc.doNothing())
      .returning("id")
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async attestation(id: string): Promise<AttestationRecord | undefined> {
    const row = await this.db.selectFrom("org_release_attestations").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toAttestation(row);
  }

  async attestationBy(appDid: string, version: string, signer: string): Promise<AttestationRecord | undefined> {
    const row = await this.db
      .selectFrom("org_release_attestations")
      .selectAll()
      .where("app_did", "=", appDid)
      .where("version", "=", version)
      .where("signer", "=", signer.toLowerCase())
      .executeTakeFirst();
    return row && toAttestation(row);
  }

  async attestationsPage(appDid: string, limit: number, after?: AttestationCursor): Promise<AttestationRecord[]> {
    let query = this.db.selectFrom("org_release_attestations").selectAll().where("app_did", "=", appDid);
    if (after) {
      query = query.where((eb) =>
        eb.or([eb("created_at", "<", after.createdAt), eb.and([eb("created_at", "=", after.createdAt), eb("id", "<", after.id)])]),
      );
    }
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").limit(limit).execute();
    return rows.map(toAttestation);
  }

  async countAttestationsSince(appDid: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom("org_release_attestations")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("app_did", "=", appDid)
      .where("created_at", ">=", since)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async countOrgAttestationsSince(orgId: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom("org_release_attestations")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("org_id", "=", orgId)
      .where("created_at", ">=", since)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async insertNotifications(rows: readonly NotificationRecord[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insertInto("org_notifications")
      .values(
        rows.map((row) => ({
          id: row.id,
          recipient: row.recipient.toLowerCase(),
          kind: row.kind,
          org_id: row.orgId,
          payload: JSON.stringify(row.payload),
          created_at: row.createdAt,
          read_at: row.readAt,
        })),
      )
      .execute();
  }

  async notificationsPage(
    recipient: string,
    options: { unreadOnly: boolean; limit: number; after?: { createdAt: Date; id: string } },
  ): Promise<NotificationRecord[]> {
    let query = this.db.selectFrom("org_notifications").selectAll().where("recipient", "=", recipient.toLowerCase());
    if (options.unreadOnly) query = query.where("read_at", "is", null);
    const after = options.after;
    if (after) {
      query = query.where((eb) =>
        eb.or([eb("created_at", "<", after.createdAt), eb.and([eb("created_at", "=", after.createdAt), eb("id", "<", after.id)])]),
      );
    }
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").limit(options.limit).execute();
    return rows.map((row: Selectable<OrgNotificationsTable>) => ({
      id: row.id,
      recipient: row.recipient,
      kind: row.kind,
      orgId: row.org_id,
      payload: jsonValue<Record<string, unknown>>(row.payload, {}),
      createdAt: toDate(row.created_at),
      readAt: toDateOrNull(row.read_at),
    }));
  }

  async unreadNotificationCount(recipient: string): Promise<number> {
    const row = await this.db
      .selectFrom("org_notifications")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("recipient", "=", recipient.toLowerCase())
      .where("read_at", "is", null)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async markNotificationsRead(recipient: string, ids: readonly string[] | "ALL", now: Date): Promise<number> {
    if (ids !== "ALL" && ids.length === 0) return 0;
    let query = this.db
      .updateTable("org_notifications")
      .set({ read_at: now })
      .where("recipient", "=", recipient.toLowerCase())
      .where("read_at", "is", null);
    if (ids !== "ALL") query = query.where("id", "in", [...ids]);
    const result = await query.executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async pruneNotifications(before: Date): Promise<number> {
    const result = await this.db.deleteFrom("org_notifications").where("created_at", "<", before).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async allOrgApps(): Promise<OrgAppRecord[]> {
    const rows = await this.db.selectFrom("org_apps").selectAll().orderBy("app_did").execute();
    return rows.map(toOrgApp);
  }

  async jobWatermark(name: string): Promise<Date | undefined> {
    const row = await this.db.selectFrom("org_jobs").select("watermark").where("name", "=", name).executeTakeFirst();
    return row?.watermark ? toDate(row.watermark) : undefined;
  }

  async setJobWatermark(name: string, at: Date): Promise<void> {
    await this.db
      .insertInto("org_jobs")
      .values({ name, last_run_at: at, watermark: at })
      .onConflict((oc) => oc.column("name").doUpdateSet({ watermark: at }))
      .execute();
  }

  async claimDelegationAlert(credentialId: string, orgId: string, now: Date): Promise<boolean> {
    const inserted = await this.db
      .insertInto("org_delegation_alerts")
      .values({ credential_id: credentialId, org_id: orgId, created_at: now })
      .onConflict((oc) => oc.column("credential_id").doNothing())
      .returning("credential_id")
      .executeTakeFirst();
    return inserted !== undefined;
  }

  async pruneDelegationAlerts(before: Date): Promise<number> {
    const result = await this.db.deleteFrom("org_delegation_alerts").where("created_at", "<", before).executeTakeFirst();
    return Number(result.numDeletedRows);
  }

  async insertWebhook(w: WebhookRecord): Promise<void> {
    await this.db
      .insertInto("org_webhooks")
      .values({
        id: w.id,
        org_id: w.orgId,
        url: w.url,
        events: JSON.stringify(w.events),
        secret_sealed: w.secretSealed,
        enabled: w.enabled,
        consecutive_failures: w.consecutiveFailures,
        created_at: w.createdAt,
        updated_at: w.updatedAt,
      })
      .execute();
  }

  async webhook(id: string): Promise<WebhookRecord | undefined> {
    const row = await this.db.selectFrom("org_webhooks").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toWebhook(row);
  }

  async webhooks(orgId: string): Promise<WebhookRecord[]> {
    const rows = await this.db.selectFrom("org_webhooks").selectAll().where("org_id", "=", orgId).orderBy("created_at").orderBy("id").execute();
    return rows.map(toWebhook);
  }

  async updateWebhook(id: string, patch: WebhookPatch, now: Date): Promise<WebhookRecord | undefined> {
    const row = await this.db
      .updateTable("org_webhooks")
      .set({
        ...(patch.url !== undefined && { url: patch.url }),
        ...(patch.events !== undefined && { events: JSON.stringify(patch.events) }),
        ...(patch.secretSealed !== undefined && { secret_sealed: patch.secretSealed }),
        ...(patch.enabled !== undefined && { enabled: patch.enabled }),
        ...(patch.consecutiveFailures !== undefined && { consecutive_failures: patch.consecutiveFailures }),
        updated_at: now,
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row && toWebhook(row);
  }

  async incrementWebhookFailures(id: string, now: Date): Promise<WebhookRecord | undefined> {
    const row = await this.db
      .updateTable("org_webhooks")
      .set((eb) => ({ consecutive_failures: eb("consecutive_failures", "+", 1), updated_at: now }))
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row && toWebhook(row);
  }

  async resetWebhookFailures(id: string, now: Date): Promise<void> {
    await this.db
      .updateTable("org_webhooks")
      .set({ consecutive_failures: 0, updated_at: now })
      .where("id", "=", id)
      .where("consecutive_failures", "<>", 0)
      .execute();
  }

  async disableWebhook(id: string, now: Date): Promise<boolean> {
    const row = await this.db
      .updateTable("org_webhooks")
      .set({ enabled: false, updated_at: now })
      .where("id", "=", id)
      .where("enabled", "=", true)
      .returning("id")
      .executeTakeFirst();
    return row !== undefined;
  }

  async deleteWebhook(id: string): Promise<boolean> {
    // One statement: the foreign key cascades to the deliveries.
    const result = await this.db.deleteFrom("org_webhooks").where("id", "=", id).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async insertDeliveries(rows: readonly DeliveryRecord[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db
      .insertInto("org_webhook_deliveries")
      .values(
        rows.map((d) => ({
          id: d.id,
          webhook_id: d.webhookId,
          org_id: d.orgId,
          event_id: d.eventId,
          event_type: d.eventType,
          body: d.body,
          status: d.status,
          attempts: d.attempts,
          response_status: d.responseStatus,
          last_error: d.lastError,
          created_at: d.createdAt,
          next_attempt_at: d.nextAttemptAt,
          delivered_at: d.deliveredAt,
        })),
      )
      .execute();
  }

  async deliveries(webhookId: string, limit: number): Promise<DeliveryRecord[]> {
    const rows = await this.db
      .selectFrom("org_webhook_deliveries")
      .selectAll()
      .where("webhook_id", "=", webhookId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(limit)
      .execute();
    return rows.map(toDelivery);
  }

  async dueDeliveries(now: Date, options: { limit: number; perWebhook: number; perOrg: number }): Promise<DeliveryRecord[]> {
    const due = this.db
      .selectFrom("org_webhook_deliveries")
      .selectAll()
      .select(sql<number>`row_number() over (partition by webhook_id order by next_attempt_at, id)`.as("hook_rank"))
      .where("status", "=", "PENDING")
      .where("next_attempt_at", "<=", now);
    const perHook = this.db
      .selectFrom(due.as("due"))
      .selectAll()
      .select(sql<number>`row_number() over (partition by org_id order by next_attempt_at, id)`.as("org_rank"))
      .where("hook_rank", "<=", options.perWebhook);
    const rows = await this.db
      .selectFrom(perHook.as("fair"))
      .selectAll()
      .where("org_rank", "<=", options.perOrg)
      .orderBy("org_rank")
      .orderBy("next_attempt_at")
      .orderBy("id")
      .limit(options.limit)
      .execute();
    return rows.map(toDelivery);
  }

  async claimDelivery(id: string, expected: Date | null, leaseUntil: Date): Promise<DeliveryRecord | undefined> {
    const row = await this.db
      .updateTable("org_webhook_deliveries")
      .set((eb) => ({ attempts: eb("attempts", "+", 1), next_attempt_at: leaseUntil }))
      .where("id", "=", id)
      .where("status", "=", "PENDING")
      .where((eb) => (expected === null ? eb("next_attempt_at", "is", null) : eb("next_attempt_at", "=", expected)))
      .returningAll()
      .executeTakeFirst();
    return row && toDelivery(row);
  }

  async updateDelivery(id: string, patch: DeliveryPatch): Promise<DeliveryRecord | undefined> {
    const row = await this.db
      .updateTable("org_webhook_deliveries")
      .set({
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.attempts !== undefined && { attempts: patch.attempts }),
        ...(patch.responseStatus !== undefined && { response_status: patch.responseStatus }),
        ...(patch.lastError !== undefined && { last_error: patch.lastError }),
        ...(patch.nextAttemptAt !== undefined && { next_attempt_at: patch.nextAttemptAt }),
        ...(patch.deliveredAt !== undefined && { delivered_at: patch.deliveredAt }),
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
    return row && toDelivery(row);
  }

  async pruneDeliveries(webhookId: string, keep: number): Promise<void> {
    const keepIds = this.db
      .selectFrom("org_webhook_deliveries")
      .select("id")
      .where("webhook_id", "=", webhookId)
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(keep);
    await this.db
      .deleteFrom("org_webhook_deliveries")
      .where("webhook_id", "=", webhookId)
      // PENDING and PAUSED deliveries are still to be sent.
      .where("status", "not in", ["PENDING", "PAUSED"])
      .where("id", "not in", keepIds)
      .execute();
  }

  async insertOrgOidcClient(link: OrgOidcClientLink): Promise<void> {
    await this.db
      .insertInto("org_oidc_clients")
      .values({ client_id: link.clientId, org_id: link.orgId, created_by: link.createdBy, created_at: link.createdAt })
      .execute();
  }

  async orgOidcClients(orgId: string): Promise<OrgOidcClientLink[]> {
    const rows = await this.db
      .selectFrom("org_oidc_clients")
      .selectAll()
      .where("org_id", "=", orgId)
      .orderBy("created_at")
      .orderBy("client_id")
      .execute();
    return rows.map((row) => ({ clientId: row.client_id, orgId: row.org_id, createdBy: row.created_by, createdAt: toDate(row.created_at) }));
  }

  async insertReport(r: ReportRecord): Promise<void> {
    await this.db
      .insertInto("org_reports")
      .values({
        id: r.id,
        org_id: r.orgId,
        reporter: r.reporter.toLowerCase(),
        reason: r.reason,
        details: r.details,
        status: r.status,
        resolution: r.resolution,
        resolved_by: r.resolvedBy,
        resolved_at: r.resolvedAt,
        note: r.note,
        created_at: r.createdAt,
      })
      .execute();
  }

  async report(id: string): Promise<ReportRecord | undefined> {
    const row = await this.db.selectFrom("org_reports").selectAll().where("id", "=", id).executeTakeFirst();
    return row && toReport(row);
  }

  async reports(status?: ReportStatus): Promise<ReportRecord[]> {
    let query = this.db.selectFrom("org_reports").selectAll();
    if (status) query = query.where("status", "=", status);
    const rows = await query.orderBy("created_at", "desc").orderBy("id", "desc").execute();
    return rows.map(toReport);
  }

  async countReportsSince(reporter: string, since: Date): Promise<number> {
    const row = await this.db
      .selectFrom("org_reports")
      .select(sql<number>`count(*)::int`.as("n"))
      .where("reporter", "=", reporter.toLowerCase())
      .where("created_at", ">=", since)
      .executeTakeFirstOrThrow();
    return Number(row.n);
  }

  async resolveReport(id: string, resolution: ReportResolution, expectedResolution?: string): Promise<ReportRecord | undefined> {
    let query = this.db
      .updateTable("org_reports")
      .set({
        status: "RESOLVED",
        resolution: resolution.resolution,
        resolved_by: resolution.resolvedBy,
        resolved_at: resolution.resolvedAt,
        note: resolution.note,
      })
      .where("id", "=", id);
    query =
      expectedResolution === undefined
        ? query.where("status", "=", "OPEN")
        : query.where("status", "=", "RESOLVED").where("resolution", "=", expectedResolution);
    const row = await query.returningAll().executeTakeFirst();
    return row && toReport(row);
  }

  async restoreReport(previous: ReportRecord): Promise<void> {
    await this.db
      .updateTable("org_reports")
      .set({
        status: previous.status,
        resolution: previous.resolution,
        resolved_by: previous.resolvedBy,
        resolved_at: previous.resolvedAt,
        note: previous.note,
      })
      .where("id", "=", previous.id)
      .execute();
  }

  async pauseDeliveries(orgId: string): Promise<number> {
    const result = await this.db
      .updateTable("org_webhook_deliveries")
      .set({ status: "PAUSED" })
      .where("org_id", "=", orgId)
      .where("status", "=", "PENDING")
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  async resumeDeliveries(orgId: string, now: Date): Promise<number> {
    const result = await this.db
      .updateTable("org_webhook_deliveries")
      .set({ status: "PENDING", next_attempt_at: now })
      .where("org_id", "=", orgId)
      .where("status", "=", "PAUSED")
      .executeTakeFirst();
    return Number(result.numUpdatedRows);
  }
}
