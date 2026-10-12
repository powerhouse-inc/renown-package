import { actions as orgActions } from "../../../document-models/renown-organization/index.js";
import { badInput, orgError, unavailable } from "../core/errors.js";
import { handleError, normalizeHandle, orgHandleProblem } from "../core/handles.js";
import { ownersNotice, type ProposalHandler } from "../core/proposals.js";
import { iso } from "../output.js";
import type { OrgRuntime } from "../runtime.js";
import type { MemberRecord, ProposalKind } from "../store/types.js";
import { addressArg, endMembership, membershipEnded, restoreOf, writeDocument } from "./members.js";

const DAY_MS = 86_400_000;
export const HANDLE_CHANGE_RESERVATION_DAYS = 30;
export const ARCHIVE_RESERVATION_DAYS = 90;

/** A payload address, or BAD_USER_INPUT on field "payload". */
export function payloadAddress(value: string | null | undefined): string {
  try {
    return addressArg("payload", value ?? "");
  } catch {
    throw badInput("payload", "payload.address must be a 0x address");
  }
}

async function ownerCount(rt: OrgRuntime, orgId: string): Promise<number> {
  return (await rt.store().members(orgId, ["ACTIVE"])).filter((m) => m.role === "OWNER").length;
}

/**
 * Every handler below runs under the `org:<id>` lock (runProposal's caller
 * holds it) and writes the store first, then the document; a document that
 * cannot be written reverts the store and throws SERVICE_UNAVAILABLE, which
 * puts the proposal back to PENDING (see runProposal).
 */
const addOwner: ProposalHandler = {
  proposable: true,
  async validate(rt, org, input) {
    const address = payloadAddress(input.address);
    const member = await rt.store().openMember(org.id, address);
    if (!member || member.status !== "ACTIVE") throw badInput("payload", "ADD_OWNER needs an active member");
    if (member.role === "OWNER") throw badInput("payload", "Already an owner");
    return { address };
  },
  async execute({ rt, org, proposal, actor, now }) {
    const store = rt.store();
    const member = await store.openMember(org.id, proposal.payload.address ?? "");
    if (!member || member.status !== "ACTIVE") return "The member is no longer active";
    if (member.role === "OWNER") return "The member is already an owner";
    // Only the role: the stored scope stays explicit (owners get every app on read, D1).
    const updated = await store.updateMember(member.id, { role: "OWNER", updatedAt: now });
    if (!updated) throw unavailable();
    await writeDocument(rt, "proposal.ADD_OWNER", org.id, [orgActions.setMemberRole({ id: member.id, role: "OWNER", at: iso(now) })], () =>
      store.updateMember(member.id, restoreOf(member)),
    );
    const data = { address: member.address, from: member.role, to: "OWNER" };
    await rt.record({
      orgId: org.id,
      actor,
      action: "proposal.ADD_OWNER",
      at: now,
      details: { ...data, proposalId: proposal.id },
      event: { type: "member.role_changed", data },
      notify: [{ to: [member.address], kind: "ROLE_CHANGED", payload: { from: member.role, to: "OWNER" } }],
    });
    return null;
  },
};

const removeOwner: ProposalHandler = {
  proposable: true,
  async validate(rt, org, input) {
    const address = payloadAddress(input.address);
    const member = await rt.store().openMember(org.id, address);
    if (!member || member.status !== "ACTIVE" || member.role !== "OWNER") throw badInput("payload", "REMOVE_OWNER needs an active owner");
    if ((await ownerCount(rt, org.id)) < 2) throw orgError("LAST_OWNER", "The organization must keep at least one owner");
    return { address, demoteToAdmin: input.demoteToAdmin === true };
  },
  async execute({ rt, org, proposal, actor, now }) {
    const store = rt.store();
    const member = await store.openMember(org.id, proposal.payload.address ?? "");
    if (!member || member.status !== "ACTIVE" || member.role !== "OWNER") return "The member is no longer an active owner";
    if ((await ownerCount(rt, org.id)) < 2) return "LAST_OWNER: the organization must keep at least one owner";
    if (proposal.payload.demoteToAdmin) {
      const updated = await store.updateMember(member.id, { role: "ADMIN", updatedAt: now });
      if (!updated) throw unavailable();
      await writeDocument(rt, "proposal.REMOVE_OWNER", org.id, [orgActions.setMemberRole({ id: member.id, role: "ADMIN", at: iso(now) })], () =>
        store.updateMember(member.id, restoreOf(member)),
      );
      const data = { address: member.address, from: "OWNER", to: "ADMIN" };
      await rt.record({
        orgId: org.id,
        actor,
        action: "proposal.REMOVE_OWNER",
        at: now,
        details: { ...data, proposalId: proposal.id },
        event: { type: "member.role_changed", data },
        notify: [{ to: [member.address], kind: "ROLE_CHANGED", payload: { from: "OWNER", to: "ADMIN" } }],
      });
      return null;
    }
    // Store, document, compensation and the membership-ended hooks.
    await endMembership(rt, member, "REMOVED", actor, now);
    const data = { address: member.address, role: "OWNER" };
    await rt.record({
      orgId: org.id,
      actor,
      action: "proposal.REMOVE_OWNER",
      at: now,
      details: { ...data, proposalId: proposal.id },
      event: { type: "member.removed", data },
      notify: [{ to: [member.address], kind: "REMOVED", payload: { orgId: org.id } }],
    });
    return null;
  },
};

const changeHandle: ProposalHandler = {
  proposable: true,
  async validate(rt, org, input) {
    const handle = normalizeHandle(input.handle ?? "");
    if (handle === org.handle) throw badInput("payload", "That is already the handle");
    const problem = await orgHandleProblem({ store: rt.store(), relationalDb: rt.deps.relationalDb, now: rt.now() }, handle, org.id);
    if (problem) throw handleError(problem, handle);
    return { handle };
  },
  async execute({ rt, org, proposal, actor, now }) {
    const handle = proposal.payload.handle ?? "";
    // Lock order org -> handle (createOrganization takes creator -> handle; nothing takes handle -> org).
    return rt.lock(`handle:${handle}`, async () => {
      const store = rt.store();
      if (handle === org.handle) return "That is already the handle";
      const problem = await orgHandleProblem({ store, relationalDb: rt.deps.relationalDb, now }, handle, org.id);
      if (problem) return `HANDLE_${problem}: "${handle}" can no longer be used`;
      // The old handle is reserved for this organization (it may change back) in the same
      // transaction that releases it, so it is never free while the document is written.
      const previous = await store.reservedHandle(org.handle, now);
      try {
        await store.transaction(async (tx) => {
          await tx.updateOrganization(org.id, { handle }, now);
          await tx.reserveHandle({
            handle: org.handle,
            until: new Date(now.getTime() + HANDLE_CHANGE_RESERVATION_DAYS * DAY_MS),
            reason: "CHANGED",
            orgId: org.id,
          });
        });
      } catch {
        return `HANDLE_TAKEN: "${handle}" was taken`;
      }
      await writeDocument(rt, "proposal.CHANGE_HANDLE", org.id, [orgActions.setOrgHandle({ handle })], () =>
        store.transaction(async (tx) => {
          await tx.updateOrganization(org.id, { handle: org.handle }, org.updatedAt);
          if (previous) await tx.reserveHandle(previous);
          else await tx.deleteReservedHandle(org.handle);
        }),
      );
      const data = { fields: ["handle"], from: org.handle, to: handle };
      await rt.record({
        orgId: org.id,
        actor,
        action: "proposal.CHANGE_HANDLE",
        at: now,
        details: { ...data, proposalId: proposal.id },
        event: { type: "org.updated", data },
      });
      return null;
    });
  },
};

const deleteOrg: ProposalHandler = {
  proposable: true,
  async validate(rt, org) {
    if ((await rt.store().orgApps(org.id)).length > 0) {
      throw orgError("ORG_HAS_APPS", "Transfer or remove the organization's apps before deleting it");
    }
    return {};
  },
  async execute({ rt, org, proposal, actor, now }) {
    const store = rt.store();
    if ((await store.orgApps(org.id)).length > 0) return "ORG_HAS_APPS: the organization owns apps";
    const open = await store.members(org.id, ["INVITED", "ACTIVE"]);
    const owners = open.filter((m) => m.status === "ACTIVE" && m.role === "OWNER").map((m) => m.address);
    const teams = await store.teams(org.id);
    await store.transaction(async (tx) => {
      await tx.updateOrganization(org.id, { archived: true, listed: false }, now);
      for (const member of open) {
        await tx.updateMember(member.id, { status: member.status === "INVITED" ? "REVOKED" : "REMOVED", endedAt: now, updatedAt: now });
        await tx.removeMemberFromTeams(member.id);
      }
    });
    await writeDocument(rt, "proposal.DELETE_ORG", org.id, [orgActions.archiveOrg({ archivedAt: iso(now) })], () =>
      store.transaction(async (tx) => {
        await tx.updateOrganization(org.id, { archived: org.archived, listed: org.listed }, org.updatedAt);
        for (const member of open) await tx.updateMember(member.id, restoreOf(member));
        for (const team of teams) await tx.setTeamMembers(team.id, team.memberIds);
      }),
    );
    // The archive is done. Store-only follow-ups: an archived organization refuses every
    // write, so none needs undoing, and a failing one is logged, never a FAILED proposal.
    await afterwards("revoke invite links", async () => {
      for (const link of await store.inviteLinks(org.id)) if (!link.revoked) await store.revokeInviteLink(link.id);
    });
    await afterwards("cancel pending proposals", () => cancelPending(rt, org.id, proposal.id, owners, actor, now));
    await afterwards("reserve the handle", () =>
      store.reserveHandle({
        handle: org.handle,
        until: new Date(now.getTime() + ARCHIVE_RESERVATION_DAYS * DAY_MS),
        reason: "ARCHIVED",
        orgId: null,
      }),
    );
    for (const member of open) if (member.status === "ACTIVE") await membershipEnded(rt, member, "REMOVED", actor, now);
    await rt.record({
      orgId: org.id,
      actor,
      action: "proposal.DELETE_ORG",
      at: now,
      details: { proposalId: proposal.id },
      event: { type: "org.updated", data: { fields: ["archived", "listed"] } },
    });
    return null;
  },
};

/**
 * RECOVER (started by startOrgRecovery only): makes the address the domain
 * named an ACTIVE owner, if the domain is still VERIFIED for the org. An
 * active member is promoted; anyone else joins as an owner (an open invite
 * is revoked first). Member caps do not apply: recovery must not be blockable.
 */
const recover: ProposalHandler = {
  proposable: false,
  validate() {
    return Promise.reject(badInput("kind", "Recovery starts with startOrgRecovery"));
  },
  async execute({ rt, org, proposal, actor, now }) {
    const store = rt.store();
    const address = proposal.payload.address ?? "";
    const verified = (await store.domains(org.id)).some((d) => d.domain === proposal.payload.domain && d.status === "VERIFIED");
    if (!verified) return "The recovery domain is no longer verified";
    const at = iso(now);
    const existing = await store.openMember(org.id, address);
    if (existing?.status === "ACTIVE") {
      if (existing.role === "OWNER") return null;
      const updated = await store.updateMember(existing.id, { role: "OWNER", updatedAt: now });
      if (!updated) throw unavailable();
      await writeDocument(rt, "proposal.RECOVER", org.id, [orgActions.setMemberRole({ id: existing.id, role: "OWNER", at })], () =>
        store.updateMember(existing.id, restoreOf(existing)),
      );
    } else {
      const member: MemberRecord = {
        id: rt.newId(),
        orgId: org.id,
        address,
        role: "OWNER",
        status: "ACTIVE",
        appScopeAll: true,
        appDids: [],
        hidden: false,
        invitedBy: null,
        invitedAt: now,
        joinedAt: now,
        endedAt: null,
        updatedAt: now,
      };
      await store.transaction(async (tx) => {
        if (existing) await tx.updateMember(existing.id, { status: "REVOKED", endedAt: now, updatedAt: now });
        await tx.insertMember(member);
      });
      await writeDocument(
        rt,
        "proposal.RECOVER",
        org.id,
        [
          ...(existing ? [orgActions.setMemberStatus({ id: existing.id, status: "REVOKED", at })] : []),
          orgActions.inviteMember({ id: member.id, address, role: "OWNER", invitedAt: at }),
          orgActions.setMemberStatus({ id: member.id, status: "ACTIVE", at }),
        ],
        () =>
          store.transaction(async (tx) => {
            await tx.deleteMember(member.id);
            if (existing) await tx.updateMember(existing.id, restoreOf(existing));
          }),
      );
    }
    const data = { address, role: "OWNER" };
    await rt.record({
      orgId: org.id,
      actor,
      action: "proposal.RECOVER",
      at: now,
      details: { ...data, domain: proposal.payload.domain, proposalId: proposal.id },
      event: existing?.status === "ACTIVE" ? { type: "member.role_changed", data: { address, from: existing.role, to: "OWNER" } } : { type: "member.joined", data },
    });
    return null;
  },
};

/** A follow-up of an applied change: its failure is logged, the change stands. */
async function afterwards(what: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    console.error(`[renown-orgs] DELETE_ORG: could not ${what}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Cancels the other pending proposals of an archived organization, telling its former owners. */
async function cancelPending(rt: OrgRuntime, orgId: string, exceptId: string, owners: string[], actor: string, now: Date): Promise<void> {
  const store = rt.store();
  for (const pending of await store.proposals(orgId, "PENDING")) {
    if (pending.id === exceptId) continue;
    const cancelled = await store.updateProposal(pending.id, { status: "CANCELLED", reason: "The organization was archived" }, "PENDING");
    if (!cancelled) continue;
    const note = { proposalId: pending.id, kind: pending.kind, status: "CANCELLED" };
    await rt.record({
      orgId,
      actor,
      action: "proposal.DELETE_ORG.cancel",
      at: now,
      details: note,
      event: { type: "proposal.cancelled", data: note },
      // The owners were just removed: name them, "OWNERS" would reach nobody.
      notify: ownersNotice("proposal.cancelled", note, owners),
    });
  }
}

/** The executable kinds; Task 7 adds TRANSFER_APP_OUT, FREEZE_APP and UNFREEZE_APP. */
export const PROPOSAL_KINDS: Partial<Record<ProposalKind, ProposalHandler>> = {
  ADD_OWNER: addOwner,
  REMOVE_OWNER: removeOwner,
  CHANGE_HANDLE: changeHandle,
  DELETE_ORG: deleteOrg,
  RECOVER: recover,
};
