import { sql, type Selectable } from "kysely";
import type {
  AuditCursor,
  AuditRecord,
  InviteLinkRecord,
  MemberPatch,
  MemberRecord,
  OrgAppRecord,
  OrganizationsTable,
  OrgInviteLinksTable,
  OrgLink,
  OrgMembersTable,
  OrgPatch,
  OrgProposalsTable,
  OrgRecord,
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
} from "./types.js";

export function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function toDateOrNull(value: Date | string | null): Date | null {
  return value === null ? null : toDate(value);
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
    return rows.map((row) => ({ appDid: row.app_did, orgId: row.org_id, frozen: row.frozen, addedAt: toDate(row.added_at) }));
  }

  async orgOfApp(appDid: string): Promise<OrgAppRecord | undefined> {
    const row = await this.db.selectFrom("org_apps").selectAll().where("app_did", "=", appDid).executeTakeFirst();
    return row && { appDid: row.app_did, orgId: row.org_id, frozen: row.frozen, addedAt: toDate(row.added_at) };
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
}
