# Renown Organisations A2 — Security and Apps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make organisations safe to own apps: two-owner proposals with timelocks and a single-runner sweeper, domain verification with an SSRF-guarded fetcher, domain-based recovery, emergency freeze, org-owned apps in renown-stats, org-aware delegation checks with derived revocation and explicit suspensions, app transfers in and out, org service accounts (workload identities), EIP-712 release attestations, organisation totals and the org `did:web` document.

**Architecture:** Everything builds on the A1 `renown-orgs` subgraph (runtime, store, activity, authz). High-risk changes are `org_proposals` rows whose kinds are handled by a registry (`areas/proposal-kinds.ts`); a proposal is claimed atomically (`PENDING → EXECUTED` with a conditional update) before its effects run, so it executes once even across replicas. A single sweeper (one 60 s timer per replica, jobs claimed atomically per interval in `org_jobs`) runs proposals, transfers and domain re-checks. Other subgraphs consult organisations through `core/org-policy.ts`, a reader over the `renown-orgs` namespace that imports nothing of the renown-orgs runtime.

**Tech Stack:** TypeScript (nodenext, strict), Powerhouse 6.2.3, Kysely 0.28 / Postgres (PGlite in tests), graphql-tag, viem (EIP-712, ERC-1271/6492), `node:net` `BlockList`, `node:dns/promises`, `node:https`, vitest 4.1.1, oxlint.

**Spec:** `docs/superpowers/specs/2026-10-12-renown-organisations-design.md` — §3.5 (proposals and timelocks), §3.6 (domains, recovery, freeze), §3.7 (apps and provenance), §3.13 (totals, archive), §4.2 (store tables, sweeper, errors), §4.3 (renown-stats, renown-workload), §7, §9. Read with the A1 plan `docs/superpowers/plans/2026-10-12-orgs-a1-core.md` (its Rulings bind here too, and its appendix "API contract" is the surface this plan completes).

**Precondition:** A1 is merged on `feat/organisations` (all nine A1 tasks committed; `pnpm test` green).

## Rulings (A2; A1's rulings still apply)

1. **Proposal mechanics.** Threshold = `min(2, active owners when proposed)`, `RECOVER` 0; the proposer's approval counts. `executableAt = max(createdAt + delay, moment the threshold is reached)`, null until then. `expiresAt = createdAt + 14 days`. A proposal whose `executableAt` is before `expiresAt` may run later (the sweeper may be late); one that never matured in time is EXPIRED. At most 20 PENDING proposals per org (`LIMIT_REACHED`); an identical PENDING proposal (same kind, same canonical payload) is `BAD_USER_INPUT` (field `payload`).
2. **Who.** Only owners propose and approve. Any owner, or the proposer, cancels and executes (the proposer may always withdraw their own, also a RECOVER starter). Admins and owners read `orgProposals`.
3. **Execution.** The proposal is claimed with a conditional update `PENDING → EXECUTED` (exactly one caller wins, on any replica), then its handler re-validates and applies; if the handler reports a reason (or throws), the proposal moves `EXECUTED → FAILED` with that reason and the call still returns it (no GraphQL error). `PROPOSAL_NOT_EXECUTABLE` only for: not PENDING, not executable yet, matured after expiry.
4. **Notifications and events.** Created → `PROPOSAL_CREATED` to all owners, `PROPOSAL_NEEDS_APPROVAL` to owners who have not approved while the threshold is unmet, plus `RECOVERY_STARTED` for RECOVER; executed or failed → `PROPOSAL_EXECUTED` (payload carries the status); cancelled or expired → `PROPOSAL_CANCELLED` (status in payload). Webhooks: `proposal.created`, `proposal.approved`, `proposal.cancelled` (also for EXPIRED), `proposal.executed` (also for FAILED). Effects are recorded as their own activities with action `proposal.<KIND>`; the run itself as `executeOrgProposal` (or `system.executeOrgProposal` from the sweeper).
5. **CHANGE_HANDLE** reserves the old handle for 30 days with `orgId` = the org (reason `CHANGED`), so only that org may switch back. **DELETE_ORG** (zero apps, else `ORG_HAS_APPS` at proposal and at execution) archives: `ARCHIVE_ORG`, unlisted, INVITED→REVOKED and ACTIVE→REMOVED in the store, invite links revoked, other PENDING proposals CANCELLED, handle reserved 90 days (reason `ARCHIVED`, `orgId` null).
6. **Sweeper (deviation from "PG advisory lock", spec §4.2).** One `setInterval(60 s)` per replica, started in `onSetup` and `unref`'d, with an in-process re-entrancy guard. Instead of a session advisory lock, every job is **claimed atomically** in `org_jobs` (compare-and-set of `last_run_at`), which gives the same guarantee — one replica runs each job per interval — without pinning a connection: kysely-pglite-dialect serializes all queries on one connection, so a pinned `pg_try_advisory_lock` session would block every renown-orgs query during a sweep in local Vetra (PGlite). A failed run restores the previous `last_run_at`, so the job is retried on the next tick. Jobs: `proposals` (60 s), `transfers` (60 s), `domains` (hourly; re-checks VERIFIED domains last checked ≥ 24 h ago). A3 adds notification pruning, webhook delivery and the delegation scan.
7. **Domains.** Lowercase DNS names (`isOrgDomain`), at most 10 per org (`LIMIT_REACHED`). Token = 16 random bytes base64url. TXT `_renown.<domain>` must equal `renown-org=<orgId>;token=<token>` (one TXT record, chunks joined); `https://<domain>/.well-known/renown.json` must contain an entry `{"id": "<orgId>", "token": "<token>"}` in `organizations`. Fetch rules exactly per spec §3.6, with the resolved, vetted IP pinned for the connection (no DNS-rebinding window). A failed manual check keeps the status (`DOMAIN_PROOF_MISSING`); only the daily re-check counts failures; 3 consecutive failures → `LAPSED` (no longer counts as verified); a later successful check re-verifies and restarts the 14-day recovery clock.
8. **Recovery.** Proof: TXT value `renown-org-recover=<orgId>;owner=<lowercase 0x address>` or a renown.json entry `{"id": "<orgId>", "recover": "<0x address>"}` (address compared case-insensitively). The domain must be VERIFIED for the org with `verifiedAt` ≥ 14 days ago. One PENDING RECOVER per org. Anyone signed in may start it. Payload `{domain, address}`. Execution re-checks the domain is still VERIFIED, then makes `address` an ACTIVE OWNER (promoting an existing ACTIVE member, or revoking an open invite and adding a new ACTIVE OWNER record).
9. **OrgPolicy** (`subgraphs/renown-orgs/core/org-policy.ts`) reads the `renown-orgs`, `renown-stats` and credential namespaces through `queryNamespace` and writes only `org_apps` (first claims). It imports nothing from the renown-orgs runtime, so renown-stats and renown-workload use it without cycles. A missing namespace reads as "no organisations".
10. **Org-owned apps.** A workload registered with `ownerOrgId` can only be claimed for that org: `upsertAppProfile(publisherOrgId)` by an ACTIVE member with PUBLISHER+ whose effective scope covers the app DID (membership of the app in the org is not yet required); the claim sets `publisher_org_id`, writes `SET_PUBLISHER_DID(orgDid)` and attaches the app (`org_apps` + `ADD_ORG_APP`). `publisherOrgId` on an existing person-owned app is `BAD_USER_INPUT` (transfers do that). Writes to a frozen app: `APP_FROZEN`. renown-stats keeps `publisher_address` (the claimer) for history; org rules decide.
11. **Credential status** order: `APP_FROZEN`, `SUSPENDED`, `ISSUER_NOT_MEMBER`, `ISSUER_NOT_PUBLISHER`. `counts` reflects only the org rules (revocation and expiry stay with `renownCredentials`); person-owned apps always count. Leaving or removal suspends the member's live credentials for the org's apps (reason `MEMBER_LEFT` / `MEMBER_REMOVED`) in the store and the document.
12. **Transfers.** Need an app profile (the Renown "app"); the person side is the profile's `publisher_address`. Person → org: `proposeAppTransfer` by the publisher; org → person or org: a `TRANSFER_APP_OUT` proposal whose execution creates the PENDING transfer. Recipient declines → `DECLINED`; source side declines → `CANCELLED`. One PENDING transfer per app; expiry 14 days (sweeper). Acceptance re-validates the source still owns the app, then moves stats `publisher_org_id`/`publisher_address`, the profile's `SET_PUBLISHER_DID`, workload `owner_org_id`/`owner_address` (a person recipient becomes the owner address), and `org_apps` (+ `ADD_ORG_APP`/`REMOVE_ORG_APP`). Frozen apps cannot be transferred.
13. **Workload identities.** `registerWorkloadIdentity(input.ownerOrgId)` requires the owner address to be an ACTIVE PUBLISHER+ of that org (`FORBIDDEN` otherwise); registration does not attach the app (first claim or transfer does). Disabled identities and apps frozen by their org get no tokens: `issueAppStatsToken` answers `FORBIDDEN`, the CI exchange `access_denied`. `orgWorkloads` lists identities with `owner_org_id = orgId`; `setOrgWorkloadDisabled` (admins) flips `disabled` for those only.
14. **Attestations.** `issuedAt` strict ISO-8601 with zone, at most 10 minutes in the future; one per (appDid, version, signer): resubmitting the same signature returns the stored attestation, another signature is `BAD_USER_INPUT` (field `version`); at most 100 per app per rolling 24 hours (`LIMIT_REACHED`). Org apps: `orgId` must be the app's org and the signer must have publisher capability now (frozen → `APP_FROZEN`); person apps: `orgId = ""` and the signer must be the profile's publisher. `signerStillMember`: org apps → signer is an ACTIVE member now; person apps → signer is still the publisher.
15. **DID document** (`organizationDidDocument`): `{"@context": ["https://www.w3.org/ns/did/v1"], "id", "alsoKnownAs": ["https://<host>/@<handle>"], "controller": [did:pkh of each active owner], "verificationMethod": [{id: "<did>#owner-<n>", type: "EcdsaSecp256k1RecoveryMethod2020", controller: <did>, blockchainAccountId: "eip155:1:<EIP-55>"}], "assertionMethod": [those ids], "service": [{id: "<did>#renown", type: "RenownOrganization", serviceEndpoint: "https://<host>/org/<id>"}, one `LinkedDomains` per verified domain]}` with `<host>` = the did host with `%3A` decoded; archived orgs keep the document with empty controller/methods; unknown and taken-down → null.
16. **Totals.** `activeUsers30d` sums each org app's distinct users with a report in the last 30 days (an upper bound); `activeDelegations` counts distinct live credential ids for org apps that count under org rules (scanning at most 2000); `attestations30d` counts attestations created in the last 30 days.

## Global Constraints

- Conventional commits; **no `Co-Authored-By` or "Generated with" lines** in commits or PR descriptions.
- Never edit `gen/` by hand; model changes via JSON + `pnpm generate document-model --document <json>` (A2 changes only `v1/src/utils.ts` of renown-app-profile, no codegen).
- Reducers pure; reducer coverage ≥ 95 % on lines, branches, functions, statements.
- After every task: `pnpm tsc`, `pnpm lint`, `pnpm test` green; keep output short (`2>&1 | tail -20`, `grep -E "Test Files|Tests |FAIL"`).
- Relative imports carry `.js`; error codes only from the fixed list (A1 Global Constraints); `APP_FROZEN` is also used by renown-stats for frozen apps.
- Env defaults: `RENOWN_ORG_TIMELOCK_SECONDS` 172800, `RENOWN_ORG_RECOVERY_SECONDS` 604800 (read by A1's `loadOrgsConfig`).
- When a step appends code that begins with `import` lines to an existing file, move those imports up to the file's other imports.
- Staging first, then main/prod.

## Review Focus

1. **The same proposal executed twice at once** (an owner clicks execute while the sweeper, maybe on another replica, runs it). Expected: effects applied once; the loser gets `PROPOSAL_NOT_EXECUTABLE`. Pinned in Task 1 ("claims a proposal once under concurrent execution") and the store contract for `updateProposal(..., expected)`.
2. **A domain whose DNS answers include a private address (alone or mixed with a public one), an IPv4-mapped IPv6 loopback, or a redirect.** Expected: no request reaches the private address; the check reports the proof missing. Pinned in Task 3 ("never connects to a private address").
3. **A member who held delegations is removed and later re-joins.** Expected: the delegations stop counting at removal and still do not count after re-joining (suspended), until an admin unsuspends them. Pinned in Task 6.
4. **A transfer accepted after its source lost the app** (transferred elsewhere, or the org removed it). Expected: `BAD_USER_INPUT` (field `transferId`), no ownership change. Pinned in Task 7.
5. **A frozen app.** Expected: `upsertAppProfile` → `APP_FROZEN`, `issueAppStatsToken` → `FORBIDDEN`, delegations → `APP_FROZEN` reason, transfers and attestations refused. Pinned in Tasks 4, 5, 6, 7 and 8.

## File Structure

| File | Responsibility |
| --- | --- |
| `subgraphs/renown-orgs/store/{types,migrations,kysely}.ts` | new tables and store methods per task |
| `subgraphs/renown-orgs/schema-security.ts`, `schema.ts` | A2 SDL (grows per task) |
| `subgraphs/renown-orgs/core/proposals.ts` | thresholds, delays, the `ProposalHandler` contract |
| `subgraphs/renown-orgs/areas/proposal-kinds.ts` | the kind registry and the A2 handlers |
| `subgraphs/renown-orgs/areas/proposals.ts` | proposal resolvers, `runProposal`, `expireProposal` |
| `subgraphs/renown-orgs/core/sweeper.ts`, `jobs.ts` | sweeper (atomic job claims), job list |
| `subgraphs/renown-orgs/core/net.ts`, `core/domain-proof.ts` | SSRF-guarded HTTPS and DNS, domain and recovery proofs |
| `subgraphs/renown-orgs/areas/domains.ts` | domain resolvers, recovery, daily re-check |
| `subgraphs/renown-orgs/core/org-policy.ts` | the policy other subgraphs consult |
| `subgraphs/renown-orgs/store/foreign.ts` | cross-namespace reads/writes (stats, workload, credentials) |
| `subgraphs/renown-orgs/areas/{workloads,credentials,transfers,attestations,insights}.ts` | resolvers |
| `subgraphs/renown-orgs/core/app-ownership.ts` | moving an app between owners |
| `subgraphs/renown-orgs/core/attestation.ts` | EIP-712 types and verification |
| `subgraphs/renown-stats/**` | publisher orgs, filters, org branch of `upsertAppProfile`, org-aware `hasDelegation`/`actsFor` |
| `subgraphs/renown-workload/**` | `owner_org_id`, `disabled`, registration with `ownerOrgId`, no tokens when disabled or frozen |
| `document-models/renown-app-profile/v1/src/utils.ts` | `isPublisherDid` accepts org DIDs |

---

### Task 1: Proposals and timelocks — store, engine, ADD_OWNER, REMOVE_OWNER, CHANGE_HANDLE, DELETE_ORG

**Files:**
- Modify: `subgraphs/renown-orgs/store/types.ts`, `store/migrations.ts`, `store/kysely.ts` (proposals)
- Create: `subgraphs/renown-orgs/schema-security.ts`; modify `schema.ts`
- Create: `subgraphs/renown-orgs/core/proposals.ts`, `areas/proposal-kinds.ts`, `areas/proposals.ts`
- Modify: `subgraphs/renown-orgs/resolvers.ts` (area), `tests/harness.ts` (`addOwner`), `tests/store-contract.ts` (proposal contract)
- Test: `subgraphs/renown-orgs/tests/proposals.test.ts`

**Interfaces:**
- Consumes (A1): `OrgRuntime`, `Area`, `requireOrg`, `requireRole`, `endMembership`, `addressArg`, `orgHandleProblem`, `handleError`, `normalizeHandle`, `iso`, `isoOrNull`, `canonicalJson`, errors.
- Produces:
  - store: `type ProposalKind`, `type ProposalStatus`, `type PartyKind = "PERSON" | "ORG"`, `interface ProposalPayload { address?; demoteToAdmin?; appDid?; toKind?; toId?; handle?; domain? }`, `interface ProposalRecord`, `type ProposalPatch`, `OrgStore.insertProposal(p)`, `proposal(id)`, `proposals(orgId, status?)` (newest first), `updateProposal(id, patch, expected: ProposalStatus)` (only while the status is still `expected`), `dueProposals(now, limit)`.
  - `core/proposals.ts`: `PROPOSAL_TTL_MS`, `MAX_PENDING_PROPOSALS = 20`, `delayMs(kind, config)`, `thresholdFor(kind, owners)`, `executableAtFor(p, config, now)`, `interface ProposalInput`, `interface ExecuteContext { rt; org; proposal; actor; now }`, `interface ProposalHandler { proposable: boolean; validate(rt, org, input): Promise<ProposalPayload>; execute(ctx): Promise<string | null> }`.
  - `areas/proposal-kinds.ts`: `PROPOSAL_KINDS: Partial<Record<ProposalKind, ProposalHandler>>` (Tasks 3 and 7 add RECOVER, TRANSFER_APP_OUT, FREEZE_APP, UNFREEZE_APP), `payloadAddress(value)`.
  - `areas/proposals.ts`: `proposalResolvers: Area`, `createProposal(rt, org, kind, payload, proposer, approvals, now)`, `runProposal(rt, proposal, actor)`, `expireProposal(rt, proposal, now)`, `proposalOutput(p)`, `type ProposalOutput`.
  - `schema-security.ts`: `PROPOSALS_SDL`, `SECURITY_SDL` (= the joined A2 blocks; later tasks add theirs).
  - harness: `addOwner(t, orgId, who): Promise<void>` (joins as ADMIN, then a single-owner ADD_OWNER proposal executed after the test timelock).

- [ ] **Step 1: Write the failing tests**

Append to the `describe` in `subgraphs/renown-orgs/tests/store-contract.ts` (inside `describeOrgStoreContract`):

```ts
    it("keeps proposals and moves them only from the expected status", async () => {
      const { store } = await open();
      const base = {
        orgId: "o1",
        kind: "ADD_OWNER" as const,
        payload: { address: BOB },
        proposer: ALICE,
        approvals: [ALICE],
        status: "PENDING" as const,
        threshold: 2,
        executableAt: null,
        expiresAt: at(60),
        executedAt: null,
        reason: null,
      };
      await store.insertProposal({ ...base, id: "p1", createdAt: T0 });
      await store.insertProposal({ ...base, id: "p2", createdAt: at(1), executableAt: at(5) });
      expect(await store.proposal("p1")).toEqual({ ...base, id: "p1", createdAt: T0 });
      expect((await store.proposals("o1")).map((p) => p.id)).toEqual(["p2", "p1"]);
      expect(await store.dueProposals(at(4), 10)).toEqual([]);
      expect((await store.dueProposals(at(5), 10)).map((p) => p.id)).toEqual(["p2"]);
      expect((await store.dueProposals(at(60), 10)).map((p) => p.id)).toEqual(["p1", "p2"]);
      const claimed = await Promise.all([
        store.updateProposal("p2", { status: "EXECUTED", executedAt: at(6) }, "PENDING"),
        store.updateProposal("p2", { status: "EXECUTED", executedAt: at(6) }, "PENDING"),
      ]);
      expect(claimed.filter(Boolean)).toHaveLength(1);
      expect(await store.updateProposal("p2", { status: "FAILED", executedAt: null, reason: "x" }, "EXECUTED")).toMatchObject({
        status: "FAILED",
        executedAt: null,
        reason: "x",
      });
      expect((await store.proposals("o1", "PENDING")).map((p) => p.id)).toEqual(["p1"]);
    });
```

Create `subgraphs/renown-orgs/tests/proposals.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import type { RecordedActivity } from "../core/activity.js";
import type { OrganizationOutput } from "../output.js";
import type { ProposalOutput } from "../areas/proposals.js";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  addOwner,
  createOrg,
  failure,
  harnessResolvers,
  join,
  lower,
  openHarness,
  resetHarness,
  T0,
  type Harness,
  type TestResolvers,
} from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

const propose = (t: TestResolvers, orgId: string, kind: string, payload: Record<string, unknown>, who = ALICE) =>
  t.mutate<ProposalOutput>("proposeOrgChange", { orgId, kind, payload }, who);
const act = (t: TestResolvers, field: string, orgId: string, proposalId: string, who = ALICE) =>
  t.mutate<ProposalOutput>(field, { orgId, proposalId }, who);

describe("proposals", () => {
  it("single-owner org: threshold 1, still timelocked; execution makes the member an owner", async () => {
    const events: RecordedActivity[] = [];
    const t = harnessResolvers(h, { sinks: [(a) => Promise.resolve(void events.push(a))] });
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const p = await propose(t, id, "ADD_OWNER", { address: BOB.address });
    expect(p).toMatchObject({
      kind: "ADD_OWNER",
      payload: { address: lower(BOB), demoteToAdmin: null, appDid: null, handle: null },
      approvals: [lower(ALICE)],
      threshold: 1,
      status: "PENDING",
      executableAt: new Date(T0.getTime() + HOUR).toISOString(),
      expiresAt: new Date(T0.getTime() + 14 * DAY).toISOString(),
    });
    expect((await failure(act(t, "executeOrgProposal", id, p.id))).code).toBe("PROPOSAL_NOT_EXECUTABLE");
    t.tick(HOUR);
    expect(await act(t, "executeOrgProposal", id, p.id)).toMatchObject({ status: "EXECUTED", executedAt: t.clock.now.toISOString() });
    expect((await t.store.openMember(id, lower(BOB)))?.role).toBe("OWNER");
    expect(t.reactor.state<RenownOrganizationState>(id).members.find((m) => m.address === lower(BOB))?.role).toBe("OWNER");
    expect((await t.query<OrganizationOutput>("organization", { id }))?.securityWarnings).toEqual([]);
    expect(events.filter((e) => e.event?.type?.startsWith("proposal.")).map((e) => [e.event?.type, e.event?.data.status])).toEqual([
      ["proposal.created", "PENDING"],
      ["proposal.executed", "EXECUTED"],
    ]);
    expect(events.find((e) => e.action === "proposal.ADD_OWNER")?.event?.type).toBe("member.role_changed");
  });

  it("two owners: the second approval sets executableAt to max(createdAt + delay, approval time)", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    await join(t, id, CAROL, "MEMBER");
    const p = await propose(t, id, "ADD_OWNER", { address: CAROL.address });
    expect([p.threshold, p.executableAt]).toEqual([2, null]);
    t.tick(2 * HOUR);
    const approved = await act(t, "approveOrgProposal", id, p.id, BOB);
    expect(approved.executableAt).toBe(t.clock.now.toISOString());
    expect(approved.approvals).toEqual([lower(ALICE), lower(BOB)]);
    expect((await act(t, "approveOrgProposal", id, p.id, BOB)).approvals).toHaveLength(2);
    expect((await act(t, "executeOrgProposal", id, p.id, BOB)).status).toBe("EXECUTED");
  });

  it("only owners propose and approve; RECOVER is not proposable; the proposer withdraws and any owner cancels", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    expect((await failure(propose(t, id, "ADD_OWNER", { address: BOB.address }, BOB))).code).toBe("FORBIDDEN");
    expect(await failure(propose(t, id, "RECOVER", { address: BOB.address }))).toMatchObject({ field: "kind" });
    expect(await failure(propose(t, id, "ADD_OWNER", { address: CAROL.address }))).toMatchObject({ field: "payload" });
    const p = await propose(t, id, "ADD_OWNER", { address: BOB.address });
    expect(await failure(propose(t, id, "ADD_OWNER", { address: BOB.address }))).toMatchObject({ field: "payload" });
    expect((await failure(act(t, "approveOrgProposal", id, p.id, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(act(t, "cancelOrgProposal", id, p.id, BOB))).code).toBe("FORBIDDEN");
    expect(await act(t, "cancelOrgProposal", id, p.id)).toMatchObject({ status: "CANCELLED", reason: `Cancelled by ${lower(ALICE)}` });
    expect((await failure(act(t, "executeOrgProposal", id, p.id))).code).toBe("PROPOSAL_NOT_EXECUTABLE");
    expect((await t.query<ProposalOutput[]>("orgProposals", { orgId: id, status: "CANCELLED" }, BOB)).map((x) => x.id)).toEqual([p.id]);
    expect((await failure(t.query("orgProposals", { orgId: id }, CAROL))).code).toBe("FORBIDDEN");
  });

  it("REMOVE_OWNER refuses the last owner, then demotes or removes", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    expect((await failure(propose(t, id, "REMOVE_OWNER", { address: ALICE.address }))).code).toBe("LAST_OWNER");
    await addOwner(t, id, BOB);
    await addOwner(t, id, CAROL);
    const demote = await propose(t, id, "REMOVE_OWNER", { address: BOB.address, demoteToAdmin: true });
    await act(t, "approveOrgProposal", id, demote.id, CAROL);
    t.tick(HOUR);
    await act(t, "executeOrgProposal", id, demote.id);
    expect((await t.store.openMember(id, lower(BOB)))?.role).toBe("ADMIN");
    const remove = await propose(t, id, "REMOVE_OWNER", { address: CAROL.address });
    await act(t, "approveOrgProposal", id, remove.id, CAROL);
    t.tick(HOUR);
    await act(t, "executeOrgProposal", id, remove.id, CAROL);
    expect(await t.store.openMember(id, lower(CAROL))).toBeUndefined();
  });

  it("CHANGE_HANDLE switches the handle and reserves the old one for this org only", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await createOrg(t, DAVE, "taken");
    expect((await failure(propose(t, id, "CHANGE_HANDLE", { handle: "taken" }))).code).toBe("HANDLE_TAKEN");
    expect(await failure(propose(t, id, "CHANGE_HANDLE", { handle: "acme" }))).toMatchObject({ field: "payload" });
    const p = await propose(t, id, "CHANGE_HANDLE", { handle: " Acme-Labs " });
    t.tick(HOUR);
    await act(t, "executeOrgProposal", id, p.id);
    expect((await t.query<OrganizationOutput>("organization", { id }))?.handle).toBe("acme-labs");
    expect(t.reactor.state<RenownOrganizationState>(id).handle).toBe("acme-labs");
    expect((await failure(createOrg(t, DAVE, "acme"))).code).toBe("HANDLE_RESERVED");
    const back = await propose(t, id, "CHANGE_HANDLE", { handle: "acme" });
    t.tick(HOUR);
    expect((await act(t, "executeOrgProposal", id, back.id)).status).toBe("EXECUTED");
  });

  it("DELETE_ORG needs zero apps and archives everything", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme", { listed: true });
    await join(t, id, BOB, "MEMBER");
    await t.mutate("inviteOrgMember", { orgId: id, invitee: CAROL.address, role: "MEMBER" }, ALICE);
    await t.store.db.insertInto("org_apps").values({ app_did: APP, org_id: id, frozen: false, added_at: T0 }).execute();
    expect((await failure(propose(t, id, "DELETE_ORG", {}))).code).toBe("ORG_HAS_APPS");
    await t.store.db.deleteFrom("org_apps").execute();
    const other = await propose(t, id, "CHANGE_HANDLE", { handle: "acme-two" });
    const del = await propose(t, id, "DELETE_ORG", {});
    t.tick(HOUR);
    expect((await act(t, "executeOrgProposal", id, del.id)).status).toBe("EXECUTED");
    expect(await t.store.organization(id)).toMatchObject({ archived: true, listed: false });
    expect((await t.store.members(id)).map((m) => m.status)).toEqual(["REMOVED", "REMOVED", "REVOKED"]);
    expect((await t.store.proposal(other.id))?.status).toBe("CANCELLED");
    expect((await t.store.reservedHandle("acme", t.clock.now))?.reason).toBe("ARCHIVED");
    expect(t.reactor.state<RenownOrganizationState>(id).archived).toBe(true);
  });

  it("re-validates at execution and fails with a reason instead of an error", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const p = await propose(t, id, "ADD_OWNER", { address: BOB.address });
    await t.mutate("leaveOrganization", { orgId: id }, BOB);
    t.tick(HOUR);
    expect(await act(t, "executeOrgProposal", id, p.id)).toMatchObject({ status: "FAILED", reason: "The member is no longer active", executedAt: null });
  });

  it("claims a proposal once under concurrent execution", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const p = await propose(t, id, "ADD_OWNER", { address: BOB.address });
    t.tick(HOUR);
    const results = await Promise.allSettled([act(t, "executeOrgProposal", id, p.id), act(t, "executeOrgProposal", id, p.id)]);
    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    expect((await t.store.auditPage(id, 20)).filter((e) => e.action === "proposal.ADD_OWNER")).toHaveLength(1);
  });

  it("refuses to approve or execute after expiry, and caps pending proposals at 20", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    await join(t, id, CAROL, "MEMBER");
    const p = await propose(t, id, "ADD_OWNER", { address: CAROL.address });
    t.tick(14 * DAY);
    expect((await failure(act(t, "approveOrgProposal", id, p.id, BOB))).code).toBe("PROPOSAL_NOT_EXECUTABLE");
    for (let i = 0; i < 20; i++) {
      await t.store.insertProposal({
        id: `x${i}`, orgId: id, kind: "CHANGE_HANDLE", payload: { handle: `h-${i}` }, proposer: lower(ALICE), approvals: [lower(ALICE)],
        status: "PENDING", threshold: 2, createdAt: t.clock.now, executableAt: null, expiresAt: new Date(t.clock.now.getTime() + DAY), executedAt: null, reason: null,
      });
    }
    expect((await failure(propose(t, id, "CHANGE_HANDLE", { handle: "fresh" }))).code).toBe("LIMIT_REACHED");
  });
});
```

Append to `subgraphs/renown-orgs/tests/harness.ts`:

```ts
/** Makes `who` an owner the way production does: ADMIN, then a single-owner ADD_OWNER proposal past the timelock. */
export async function addOwner(t: TestResolvers, orgId: string, who: Account): Promise<void> {
  const owners = (await t.store.members(orgId, ["ACTIVE"])).filter((m) => m.role === "OWNER");
  const proposer = owners[0];
  if (!proposer) throw new Error("addOwner needs an owner");
  if (!(await t.store.openMember(orgId, who.address.toLowerCase()))) await join(t, orgId, who, "ADMIN");
  const proposerCtx = { user: { address: proposer.address } };
  const p = (await t.resolvers.Mutation.proposeOrgChange(null, { orgId, kind: "ADD_OWNER", payload: { address: who.address } }, proposerCtx)) as { id: string };
  for (const owner of owners.slice(1, 2)) {
    await t.resolvers.Mutation.approveOrgProposal(null, { orgId, proposalId: p.id }, { user: { address: owner.address } });
  }
  t.tick(TEST_CONFIG.timelockSeconds * 1000);
  await t.resolvers.Mutation.executeOrgProposal(null, { orgId, proposalId: p.id }, proposerCtx);
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Tests |FAIL" | head -6`
Expected: the store contract fails (`insertProposal is not a function`) and `proposals.test.ts` fails to resolve `../areas/proposals.js`.

- [ ] **Step 3: Store**

In `subgraphs/renown-orgs/store/types.ts` add:

```ts
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
```

add `org_proposals: OrgProposalsTable;` to `OrgsDB`, and to `OrgStore`:

```ts
  insertProposal(proposal: ProposalRecord): Promise<void>;
  proposal(id: string): Promise<ProposalRecord | undefined>;
  /** Newest first; only `status` when given. */
  proposals(orgId: string, status?: ProposalStatus): Promise<ProposalRecord[]>;
  /** Applies `patch` only while the proposal still has the `expected` status; undefined otherwise. */
  updateProposal(id: string, patch: ProposalPatch, expected: ProposalStatus): Promise<ProposalRecord | undefined>;
  /** PENDING proposals executable or expired at `now`, oldest first. */
  dueProposals(now: Date, limit: number): Promise<ProposalRecord[]>;
```

Append to `migrate()` in `subgraphs/renown-orgs/store/migrations.ts`:

```ts
  // A2: proposals and timelocks.
  await db.schema
    .createTable("org_proposals")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("kind", "text", (col) => col.notNull())
    .addColumn("payload", "jsonb", (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("proposer", "text", (col) => col.notNull())
    .addColumn("approvals", "jsonb", (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("threshold", "integer", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("executable_at", "timestamptz")
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("executed_at", "timestamptz")
    .addColumn("reason", "text")
    .execute();
  await db.schema.createIndex("org_proposals_org").ifNotExists().on("org_proposals").columns(["org_id", "created_at"]).execute();
  await db.schema.createIndex("org_proposals_status").ifNotExists().on("org_proposals").columns(["status", "executable_at"]).execute();
```

In `subgraphs/renown-orgs/store/kysely.ts` add the imports `OrgProposalsTable`, `ProposalPatch`, `ProposalPayload`, `ProposalRecord`, `ProposalStatus`, a mapper next to the others:

```ts
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
```

and these methods in `KyselyOrgStore`:

```ts
  async insertProposal(p: ProposalRecord): Promise<void> {
    await this.db
      .insertInto("org_proposals")
      .values({
        id: p.id,
        org_id: p.orgId,
        kind: p.kind,
        payload: JSON.stringify(p.payload),
        proposer: p.proposer,
        approvals: JSON.stringify(p.approvals),
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
        ...(patch.approvals !== undefined && { approvals: JSON.stringify(patch.approvals) }),
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
      .orderBy("created_at")
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.map(toProposal);
  }
```

- [ ] **Step 4: SDL for proposals**

Create `subgraphs/renown-orgs/schema-security.ts`:

```ts
/** A2 SDL, one block per area; each block extends the A1 root types. */
export const PROPOSALS_SDL = `
  enum OrgProposalKind {
    ADD_OWNER
    REMOVE_OWNER
    TRANSFER_APP_OUT
    CHANGE_HANDLE
    DELETE_ORG
    RECOVER
    FREEZE_APP
    UNFREEZE_APP
  }

  enum OrgProposalStatus {
    PENDING
    EXECUTED
    CANCELLED
    EXPIRED
    FAILED
  }

  enum OrgPartyKind {
    PERSON
    ORG
  }

  "Per kind: ADD_OWNER address; REMOVE_OWNER address, demoteToAdmin; TRANSFER_APP_OUT appDid, toKind, toId; CHANGE_HANDLE handle; DELETE_ORG nothing; FREEZE_APP and UNFREEZE_APP appDid. RECOVER only through startOrgRecovery."
  input OrgProposalPayloadInput {
    address: String
    demoteToAdmin: Boolean
    appDid: String
    toKind: OrgPartyKind
    toId: String
    handle: String
  }

  type OrgProposalPayload {
    address: String
    demoteToAdmin: Boolean
    appDid: String
    toKind: OrgPartyKind
    toId: String
    handle: String
    domain: String
  }

  type OrgProposal {
    id: String!
    orgId: String!
    kind: OrgProposalKind!
    payload: OrgProposalPayload!
    proposer: String!
    approvals: [String!]!
    threshold: Int!
    status: OrgProposalStatus!
    createdAt: String!
    "Set once approvals reach the threshold: max(createdAt + delay, when the threshold was reached)."
    executableAt: String
    expiresAt: String!
    executedAt: String
    "Why it FAILED or was CANCELLED"
    reason: String
  }

  extend type Query {
    "Admins and owners; newest first."
    orgProposals(orgId: String!, status: OrgProposalStatus, auth: OrgAuthInput): [OrgProposal!]!
  }

  extend type Mutation {
    proposeOrgChange(orgId: String!, kind: OrgProposalKind!, payload: OrgProposalPayloadInput!, auth: OrgAuthInput): OrgProposal!
    approveOrgProposal(orgId: String!, proposalId: String!, auth: OrgAuthInput): OrgProposal!
    cancelOrgProposal(orgId: String!, proposalId: String!, auth: OrgAuthInput): OrgProposal!
    "Runs a matured proposal; a proposal whose preconditions no longer hold comes back FAILED with a reason."
    executeOrgProposal(orgId: String!, proposalId: String!, auth: OrgAuthInput): OrgProposal!
  }
`;

/** Every A2 block; later tasks append theirs. */
export const SECURITY_SDL = [PROPOSALS_SDL].join("\n");
```

In `subgraphs/renown-orgs/schema.ts` import `SECURITY_SDL` from `./schema-security.js` and build the schema from `[CORE_SDL, SECURITY_SDL]`.

- [ ] **Step 5: The engine and the four kinds**

Create `subgraphs/renown-orgs/core/proposals.ts`:

```ts
import type { OrgRuntime } from "../runtime.js";
import type { OrgRecord, PartyKind, ProposalKind, ProposalPayload, ProposalRecord } from "../store/types.js";
import type { OrgsConfig } from "./config.js";

/** Proposals expire 14 days after they were made. */
export const PROPOSAL_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_PROPOSALS = 20;

/** The timelock of a kind: 0 for freezes, the recovery delay for RECOVER, the timelock otherwise. */
export function delayMs(kind: ProposalKind, config: OrgsConfig): number {
  if (kind === "FREEZE_APP" || kind === "UNFREEZE_APP") return 0;
  return (kind === "RECOVER" ? config.recoverySeconds : config.timelockSeconds) * 1000;
}

/** Owner approvals needed: min(2, owners), none for RECOVER. */
export function thresholdFor(kind: ProposalKind, owners: number): number {
  return kind === "RECOVER" ? 0 : Math.min(2, owners);
}

/** When the proposal may run: kept once set; null while approvals are below the threshold. */
export function executableAtFor(
  proposal: Pick<ProposalRecord, "kind" | "createdAt" | "approvals" | "threshold" | "executableAt">,
  config: OrgsConfig,
  now: Date,
): Date | null {
  if (proposal.executableAt) return proposal.executableAt;
  if (proposal.approvals.length < proposal.threshold) return null;
  return new Date(Math.max(proposal.createdAt.getTime() + delayMs(proposal.kind, config), now.getTime()));
}

/** The GraphQL payload input. */
export interface ProposalInput {
  address?: string | null;
  demoteToAdmin?: boolean | null;
  appDid?: string | null;
  toKind?: PartyKind | null;
  toId?: string | null;
  handle?: string | null;
}

export interface ExecuteContext {
  rt: OrgRuntime;
  org: OrgRecord;
  proposal: ProposalRecord;
  /** The executing owner or proposer, or "system" (the sweeper). */
  actor: string;
  now: Date;
}

export interface ProposalHandler {
  /** False for kinds only a dedicated mutation starts (RECOVER). */
  proposable: boolean;
  /** Normalizes and checks the payload when proposed; throws a GraphQLError (usually field "payload"). */
  validate(rt: OrgRuntime, org: OrgRecord, input: ProposalInput): Promise<ProposalPayload>;
  /** Re-validates and applies the change; returns why it cannot run (the proposal FAILs), or null when done. */
  execute(ctx: ExecuteContext): Promise<string | null>;
}
```

Create `subgraphs/renown-orgs/areas/proposal-kinds.ts`:

```ts
import { actions as orgActions } from "../../../document-models/renown-organization/index.js";
import { badInput, orgError } from "../core/errors.js";
import { handleError, normalizeHandle, orgHandleProblem } from "../core/handles.js";
import type { ProposalHandler } from "../core/proposals.js";
import { iso } from "../output.js";
import type { ProposalKind } from "../store/types.js";
import { addressArg, endMembership } from "./members.js";

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
    await rt.execute(org.id, [orgActions.setMemberRole({ id: member.id, role: "OWNER", at: iso(now) })]);
    await store.updateMember(member.id, { role: "OWNER", appScopeAll: true, updatedAt: now });
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

async function ownerCount(rt: Parameters<ProposalHandler["validate"]>[0], orgId: string): Promise<number> {
  return (await rt.store().members(orgId, ["ACTIVE"])).filter((m) => m.role === "OWNER").length;
}

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
      await rt.execute(org.id, [orgActions.setMemberRole({ id: member.id, role: "ADMIN", at: iso(now) })]);
      await store.updateMember(member.id, { role: "ADMIN", updatedAt: now });
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
    return rt.lock(`handle:${handle}`, async () => {
      const store = rt.store();
      const problem = await orgHandleProblem({ store, relationalDb: rt.deps.relationalDb, now }, handle, org.id);
      if (problem) return `HANDLE_${problem}: "${handle}" can no longer be used`;
      await rt.execute(org.id, [orgActions.setOrgHandle({ handle })]);
      try {
        await store.updateOrganization(org.id, { handle }, now);
      } catch {
        return `HANDLE_TAKEN: "${handle}" was taken`;
      }
      await store.reserveHandle({
        handle: org.handle,
        until: new Date(now.getTime() + HANDLE_CHANGE_RESERVATION_DAYS * DAY_MS),
        reason: "CHANGED",
        orgId: org.id,
      });
      const data = { fields: ["handle"], from: org.handle, to: handle };
      await rt.record({ orgId: org.id, actor, action: "proposal.CHANGE_HANDLE", at: now, details: { ...data, proposalId: proposal.id }, event: { type: "org.updated", data } });
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
    await rt.execute(org.id, [orgActions.archiveOrg({ archivedAt: iso(now) })]);
    await store.updateOrganization(org.id, { archived: true, listed: false }, now);
    for (const member of await store.members(org.id, ["INVITED", "ACTIVE"])) {
      await store.updateMember(member.id, { status: member.status === "INVITED" ? "REVOKED" : "REMOVED", endedAt: now, updatedAt: now });
      await store.removeMemberFromTeams(member.id);
    }
    for (const link of await store.inviteLinks(org.id)) if (!link.revoked) await store.revokeInviteLink(link.id);
    for (const pending of await store.proposals(org.id, "PENDING")) {
      if (pending.id !== proposal.id) {
        await store.updateProposal(pending.id, { status: "CANCELLED", reason: "The organization was archived" }, "PENDING");
      }
    }
    await store.reserveHandle({
      handle: org.handle,
      until: new Date(now.getTime() + ARCHIVE_RESERVATION_DAYS * DAY_MS),
      reason: "ARCHIVED",
      orgId: null,
    });
    const data = { fields: ["archived"] };
    await rt.record({ orgId: org.id, actor, action: "proposal.DELETE_ORG", at: now, details: { proposalId: proposal.id }, event: { type: "org.updated", data } });
    return null;
  },
};

/** The executable kinds; Tasks 3 and 7 add RECOVER, TRANSFER_APP_OUT, FREEZE_APP and UNFREEZE_APP. */
export const PROPOSAL_KINDS: Partial<Record<ProposalKind, ProposalHandler>> = {
  ADD_OWNER: addOwner,
  REMOVE_OWNER: removeOwner,
  CHANGE_HANDLE: changeHandle,
  DELETE_ORG: deleteOrg,
};
```

Create `subgraphs/renown-orgs/areas/proposals.ts`:

```ts
import { canonicalJson } from "../../../sdk/orgs.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, forbidden, limitReached, notFound, orgError } from "../core/errors.js";
import {
  executableAtFor,
  MAX_PENDING_PROPOSALS,
  PROPOSAL_TTL_MS,
  thresholdFor,
  type ProposalInput,
} from "../core/proposals.js";
import { iso, isoOrNull } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { OrgRecord, ProposalKind, ProposalPayload, ProposalRecord, ProposalStatus } from "../store/types.js";
import { PROPOSAL_KINDS } from "./proposal-kinds.js";

export interface ProposalOutput {
  id: string;
  orgId: string;
  kind: ProposalKind;
  payload: Record<keyof ProposalPayload, unknown>;
  proposer: string;
  approvals: string[];
  threshold: number;
  status: ProposalStatus;
  createdAt: string;
  executableAt: string | null;
  expiresAt: string;
  executedAt: string | null;
  reason: string | null;
}

export function proposalOutput(p: ProposalRecord): ProposalOutput {
  return {
    id: p.id,
    orgId: p.orgId,
    kind: p.kind,
    payload: {
      address: p.payload.address ?? null,
      demoteToAdmin: p.payload.demoteToAdmin ?? null,
      appDid: p.payload.appDid ?? null,
      toKind: p.payload.toKind ?? null,
      toId: p.payload.toId ?? null,
      handle: p.payload.handle ?? null,
      domain: p.payload.domain ?? null,
    },
    proposer: p.proposer,
    approvals: [...p.approvals],
    threshold: p.threshold,
    status: p.status,
    createdAt: iso(p.createdAt),
    executableAt: isoOrNull(p.executableAt),
    expiresAt: iso(p.expiresAt),
    executedAt: isoOrNull(p.executedAt),
    reason: p.reason,
  };
}

function notExecutable(message: string) {
  return orgError("PROPOSAL_NOT_EXECUTABLE", message);
}

async function activeOwners(rt: OrgRuntime, orgId: string): Promise<string[]> {
  return (await rt.store().members(orgId, ["ACTIVE"])).filter((m) => m.role === "OWNER").map((m) => m.address);
}

/** Stores a new PENDING proposal and records its creation. The caller holds the org lock. */
export async function createProposal(
  rt: OrgRuntime,
  org: OrgRecord,
  kind: ProposalKind,
  payload: ProposalPayload,
  proposer: string,
  approvals: string[],
  now: Date,
): Promise<ProposalRecord> {
  const owners = await activeOwners(rt, org.id);
  const draft: ProposalRecord = {
    id: rt.newId(),
    orgId: org.id,
    kind,
    payload,
    proposer,
    approvals,
    status: "PENDING",
    threshold: thresholdFor(kind, owners.length),
    createdAt: now,
    executableAt: null,
    expiresAt: new Date(now.getTime() + PROPOSAL_TTL_MS),
    executedAt: null,
    reason: null,
  };
  const proposal = { ...draft, executableAt: executableAtFor(draft, rt.config(), now) };
  await rt.store().insertProposal(proposal);
  const waiting = owners.filter((owner) => !approvals.includes(owner));
  const note = { proposalId: proposal.id, kind };
  await rt.record({
    orgId: org.id,
    actor: proposer,
    action: kind === "RECOVER" ? "startOrgRecovery" : "proposeOrgChange",
    at: now,
    details: { ...note, payload },
    event: { type: "proposal.created", data: { ...note, status: "PENDING" } },
    notify: [
      { to: "OWNERS", kind: "PROPOSAL_CREATED", payload: note },
      ...(proposal.executableAt === null && waiting.length > 0 ? [{ to: waiting, kind: "PROPOSAL_NEEDS_APPROVAL" as const, payload: note }] : []),
      ...(kind === "RECOVER" ? [{ to: "OWNERS" as const, kind: "RECOVERY_STARTED" as const, payload: { ...note, ...payload } }] : []),
    ],
  });
  return proposal;
}

/**
 * Runs a matured proposal once: claims it (PENDING → EXECUTED, conditional),
 * then lets its handler re-validate and apply; a reason or a throw moves it
 * to FAILED. The caller holds the org lock.
 */
export async function runProposal(rt: OrgRuntime, proposal: ProposalRecord, actor: string): Promise<ProposalRecord> {
  const store = rt.store();
  const now = rt.now();
  if (proposal.status !== "PENDING") throw notExecutable(`The proposal is ${proposal.status}`);
  const executableAt = proposal.executableAt;
  if (!executableAt || executableAt.getTime() > now.getTime()) throw notExecutable("The proposal is not executable yet");
  if (executableAt.getTime() >= proposal.expiresAt.getTime()) throw notExecutable("The proposal expired");
  const claimed = await store.updateProposal(proposal.id, { status: "EXECUTED", executedAt: now }, "PENDING");
  if (!claimed) throw notExecutable("The proposal is no longer pending");
  const org = await store.organization(proposal.orgId);
  const handler = PROPOSAL_KINDS[proposal.kind];
  let reason: string | null;
  if (!org || org.archived || org.takenDown) reason = "The organization is archived or taken down";
  else if (!handler) reason = `${proposal.kind} proposals cannot be executed`;
  else {
    try {
      reason = await handler.execute({ rt, org, proposal: claimed, actor, now });
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }
  const result = reason
    ? ((await store.updateProposal(proposal.id, { status: "FAILED", executedAt: null, reason }, "EXECUTED")) ?? claimed)
    : claimed;
  const note = { proposalId: proposal.id, kind: proposal.kind, status: result.status };
  await rt.record({
    orgId: proposal.orgId,
    actor,
    action: actor === "system" ? "system.executeOrgProposal" : "executeOrgProposal",
    at: now,
    details: { ...note, reason },
    event: { type: "proposal.executed", data: note },
    notify: [{ to: "OWNERS", kind: "PROPOSAL_EXECUTED", payload: { ...note, reason } }],
  });
  return result;
}

/** Marks an unmatured proposal EXPIRED. The caller holds the org lock. */
export async function expireProposal(rt: OrgRuntime, proposal: ProposalRecord, now: Date): Promise<void> {
  const expired = await rt.store().updateProposal(proposal.id, { status: "EXPIRED", reason: "Expired before it could run" }, "PENDING");
  if (!expired) return;
  const note = { proposalId: proposal.id, kind: proposal.kind, status: "EXPIRED" };
  await rt.record({
    orgId: proposal.orgId,
    actor: "system",
    action: "system.expireOrgProposal",
    at: now,
    details: note,
    event: { type: "proposal.cancelled", data: note },
    notify: [{ to: "OWNERS", kind: "PROPOSAL_CANCELLED", payload: note }],
  });
}

async function proposalOf(rt: OrgRuntime, orgId: string, proposalId: string): Promise<ProposalRecord> {
  const proposal = await rt.store().proposal(proposalId);
  if (!proposal || proposal.orgId !== orgId) throw notFound("Proposal");
  return proposal;
}

/** The caller is an ACTIVE owner of the org, or the proposal's proposer. */
async function assertOwnerOrProposer(rt: OrgRuntime, proposal: ProposalRecord, caller: string): Promise<void> {
  if (caller === proposal.proposer) return;
  await requireRole(rt.store(), proposal.orgId, caller, "OWNER");
}

type ProposalArgs = OrgArgs & { orgId: string; proposalId: string };

export const proposalResolvers: Area = (rt) => ({
  Query: {
    orgProposals: async (_: unknown, args: OrgArgs & { orgId: string; status?: ProposalStatus | null }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgProposals", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      return (await store.proposals(args.orgId, args.status ?? undefined)).map(proposalOutput);
    },
  },
  Mutation: {
    proposeOrgChange: async (
      _: unknown,
      args: OrgArgs & { orgId: string; kind: ProposalKind; payload: ProposalInput },
      ctx: OrgContext,
    ) => {
      const caller = await rt.writer(ctx, "proposeOrgChange", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const org = await requireOrg(store, args.orgId);
        await requireRole(store, org.id, caller, "OWNER");
        const handler = PROPOSAL_KINDS[args.kind];
        if (!handler || !handler.proposable) {
          throw badInput("kind", args.kind === "RECOVER" ? "Recovery starts with startOrgRecovery" : `${args.kind} proposals are not available`);
        }
        const payload = await handler.validate(rt, org, args.payload);
        const pending = await store.proposals(org.id, "PENDING");
        if (pending.length >= MAX_PENDING_PROPOSALS) throw limitReached(`At most ${MAX_PENDING_PROPOSALS} pending proposals`);
        if (pending.some((p) => p.kind === args.kind && canonicalJson(p.payload) === canonicalJson(payload))) {
          throw badInput("payload", "An identical proposal is already pending");
        }
        return proposalOutput(await createProposal(rt, org, args.kind, payload, caller, [caller], now));
      });
    },
    approveOrgProposal: async (_: unknown, args: ProposalArgs, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "approveOrgProposal", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "OWNER");
        const proposal = await proposalOf(rt, args.orgId, args.proposalId);
        if (proposal.status !== "PENDING") throw notExecutable(`The proposal is ${proposal.status}`);
        if (proposal.expiresAt.getTime() <= now.getTime()) throw notExecutable("The proposal expired");
        if (proposal.approvals.includes(caller)) return proposalOutput(proposal);
        const approvals = [...proposal.approvals, caller];
        const executableAt = executableAtFor({ ...proposal, approvals }, rt.config(), now);
        const updated = await store.updateProposal(proposal.id, { approvals, executableAt }, "PENDING");
        if (!updated) throw notExecutable("The proposal is no longer pending");
        const note = { proposalId: proposal.id, kind: proposal.kind, status: "PENDING" };
        await rt.record({ orgId: args.orgId, actor: caller, action: "approveOrgProposal", at: now, details: note, event: { type: "proposal.approved", data: note } });
        return proposalOutput(updated);
      });
    },
    cancelOrgProposal: async (_: unknown, args: ProposalArgs, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "cancelOrgProposal", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const proposal = await proposalOf(rt, args.orgId, args.proposalId);
        await assertOwnerOrProposer(rt, proposal, caller);
        if (proposal.status !== "PENDING") throw notExecutable(`The proposal is ${proposal.status}`);
        const cancelled = await store.updateProposal(proposal.id, { status: "CANCELLED", reason: `Cancelled by ${caller}` }, "PENDING");
        if (!cancelled) throw notExecutable("The proposal is no longer pending");
        const note = { proposalId: proposal.id, kind: proposal.kind, status: "CANCELLED" };
        await rt.record({
          orgId: args.orgId,
          actor: caller,
          action: "cancelOrgProposal",
          at: now,
          details: note,
          event: { type: "proposal.cancelled", data: note },
          notify: [{ to: "OWNERS", kind: "PROPOSAL_CANCELLED", payload: note }],
        });
        return proposalOutput(cancelled);
      });
    },
    executeOrgProposal: async (_: unknown, args: ProposalArgs, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "executeOrgProposal", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const proposal = await proposalOf(rt, args.orgId, args.proposalId);
        try {
          await assertOwnerOrProposer(rt, proposal, caller);
        } catch {
          throw forbidden();
        }
        return proposalOutput(await runProposal(rt, proposal, caller));
      });
    },
  },
});
```

In `subgraphs/renown-orgs/resolvers.ts` import `proposalResolvers` from `./areas/proposals.js` and append it to `AREAS`.

- [ ] **Step 6: Run the tests, types and lint**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass (the API contract test accepts the proposal fields as a partial A2; the resolver gate sees the five new fields resolved).

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-orgs
git commit -m "feat(orgs): owner proposals with thresholds and timelocks"
```

---

### Task 2: The sweeper — atomic job claims, proposals job, subgraph wiring

**Files:**
- Modify: `subgraphs/renown-orgs/store/{types,migrations,kysely}.ts` (`org_jobs`)
- Create: `subgraphs/renown-orgs/core/sweeper.ts`, `subgraphs/renown-orgs/jobs.ts`
- Modify: `subgraphs/renown-orgs/resolvers.ts` (`resolversFor`), `subgraphs/renown-orgs/index.ts` (shared runtime, timer), `tests/harness.ts` (expose `rt`), `tests/store-contract.ts`
- Test: `subgraphs/renown-orgs/tests/sweeper.test.ts`, `tests/subgraph.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 (`runProposal`, `expireProposal`, `OrgStore.dueProposals`).
- Produces: `OrgStore.claimJob(name, now, everyMs): Promise<{ previous: Date | null } | null>` (null when another run is still within the interval or another replica claimed it first), `OrgStore.releaseJob(name, claimedAt, previous): Promise<void>` (undoes a claim after a failed run), `OrgStore.jobLastRun(name): Promise<Date | undefined>`; `core/sweeper.ts`: `SWEEP_INTERVAL_MS = 60000`, `interface SweepJob { name; everyMs; run(now): Promise<void> }`, `createSweeper({ jobs, store, now, log? }): { tick(): Promise<string[]> }` (names of the jobs that ran successfully); `jobs.ts`: `proposalsJob(rt)`, `sweepJobs(rt): SweepJob[]` (Tasks 3 and 7, and A3, append theirs); `resolvers.ts`: `resolversFor(rt): Record<string, unknown>`; harness result gains `rt: OrgRuntime`.

- [ ] **Step 1: Write the failing tests**

Append inside `describeOrgStoreContract` in `subgraphs/renown-orgs/tests/store-contract.ts`:

```ts
    it("claims each sweep job once per interval and undoes a claim", async () => {
      const { store } = await open();
      const MINUTE = 60_000;
      expect(await store.claimJob("proposals", T0, MINUTE)).toEqual({ previous: null });
      expect(await store.claimJob("proposals", T0, MINUTE)).toBeNull();
      expect(await store.claimJob("proposals", at(0.5), MINUTE)).toBeNull();
      const claims = await Promise.all([store.claimJob("proposals", at(1), MINUTE), store.claimJob("proposals", at(1), MINUTE)]);
      expect(claims.filter(Boolean)).toEqual([{ previous: T0 }]);
      await store.releaseJob("proposals", at(1), T0);
      expect(await store.jobLastRun("proposals")).toEqual(T0);
      expect(await store.claimJob("domains", at(2), MINUTE)).toEqual({ previous: null });
      await store.releaseJob("domains", at(2), null);
      expect(await store.jobLastRun("domains")).toBeUndefined();
    });
```

Create `subgraphs/renown-orgs/tests/sweeper.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalOutput } from "../areas/proposals.js";
import { createSweeper, type SweepJob } from "../core/sweeper.js";
import { sweepJobs } from "../jobs.js";
import { openMemoryOrgStore } from "../store/memory.js";
import { ALICE, BOB, CAROL, createOrg, harnessResolvers, join, lower, openHarness, resetHarness, T0, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

describe("sweeper", () => {
  it("runs each job once its interval has passed and retries a failed run on the next tick", async () => {
    const { store, close } = await openMemoryOrgStore();
    const clock = { now: T0 };
    let failOnce = true;
    const job = (name: string, everyMs: number, run: () => Promise<void> = () => Promise.resolve()): SweepJob => ({ name, everyMs, run });
    const sweeper = createSweeper({
      jobs: [
        job("minute", MINUTE),
        job("daily", DAY),
        job("flaky", MINUTE, () => (failOnce ? ((failOnce = false), Promise.reject(new Error("boom"))) : Promise.resolve())),
      ],
      store: () => store,
      now: () => clock.now,
      log: () => undefined,
    });
    expect(await sweeper.tick()).toEqual(["minute", "daily"]);
    clock.now = new Date(T0.getTime() + 30_000);
    expect(await sweeper.tick()).toEqual(["flaky"]);
    clock.now = new Date(T0.getTime() + MINUTE);
    expect(await sweeper.tick()).toEqual(["minute"]);
    clock.now = new Date(T0.getTime() + DAY);
    expect(await sweeper.tick()).toEqual(["minute", "daily", "flaky"]);
    await close();
  });

  it("runs a job on one replica only, and never overlaps itself", async () => {
    const { store, close } = await openMemoryOrgStore();
    const runs: string[] = [];
    const jobs = (replica: string): SweepJob[] => [{ name: "shared", everyMs: MINUTE, run: () => Promise.resolve(void runs.push(replica)) }];
    const [a, b] = [createSweeper({ jobs: jobs("a"), store: () => store, now: () => T0 }), createSweeper({ jobs: jobs("b"), store: () => store, now: () => T0 })];
    await Promise.all([a.tick(), b.tick()]);
    expect(runs).toHaveLength(1);
    let release: () => void = () => undefined;
    const slow: SweepJob = { name: "slow", everyMs: 1, run: () => new Promise<void>((resolve) => (release = resolve)) };
    const sweeper = createSweeper({ jobs: [slow], store: () => store, now: () => T0 });
    const first = sweeper.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await sweeper.tick()).toEqual([]);
    release();
    expect(await first).toEqual(["slow"]);
    await close();
  });

  it("executes matured proposals as the system and expires the ones that never matured", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "ADMIN");
    const matures = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: BOB.address } }, ALICE);
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    t.tick(30 * MINUTE);
    await sweeper.tick();
    expect((await t.store.proposal(matures.id))?.status).toBe("PENDING");
    t.tick(30 * MINUTE);
    await sweeper.tick();
    expect((await t.store.proposal(matures.id))?.status).toBe("EXECUTED");
    expect((await t.store.auditPage(id, 5)).map((e) => [e.action, e.actor])).toContainEqual(["system.executeOrgProposal", "system"]);
    await join(t, id, CAROL, "MEMBER");
    const stale = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: id, kind: "ADD_OWNER", payload: { address: CAROL.address } }, ALICE);
    expect(stale.threshold).toBe(2);
    t.tick(14 * DAY);
    await sweeper.tick();
    expect(await t.store.proposal(stale.id)).toMatchObject({ status: "EXPIRED", reason: "Expired before it could run" });
    expect((await t.store.openMember(id, lower(CAROL)))?.role).toBe("MEMBER");
  });
});
```

Append to `subgraphs/renown-orgs/tests/subgraph.test.ts`:

```ts
describe("RenownOrgsSubgraph sweeper", () => {
  it("starts one 60 s timer after setup and stops it on disconnect", async () => {
    const setSpy = vi.spyOn(globalThis, "setInterval");
    const clearSpy = vi.spyOn(globalThis, "clearInterval");
    const { subgraph } = makeSubgraph(pgliteNamespace);
    await subgraph.onSetup();
    await subgraph.onSetup();
    expect(setSpy.mock.calls.filter(([, ms]) => ms === 60_000)).toHaveLength(1);
    await subgraph.onDisconnect();
    expect(clearSpy).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Tests |FAIL" | head -6`
Expected: `claimJob is not a function`; `../core/sweeper.js` and `../jobs.js` do not exist; the timer test fails.

- [ ] **Step 3: Store**

`subgraphs/renown-orgs/store/types.ts`: add

```ts
export interface OrgJobsTable {
  name: string;
  last_run_at: Timestamp;
}
```

`org_jobs: OrgJobsTable;` in `OrgsDB`, and in `OrgStore`:

```ts
  /** Claims a run of job `name` at `now` unless one started less than `everyMs` ago; the previous start, or null. */
  claimJob(name: string, now: Date, everyMs: number): Promise<{ previous: Date | null } | null>;
  /** Undoes the claim made at `claimedAt` (back to `previous`, or no row). */
  releaseJob(name: string, claimedAt: Date, previous: Date | null): Promise<void>;
  jobLastRun(name: string): Promise<Date | undefined>;
```

Append to `migrate()`:

```ts
  // A2: the last claimed run of each sweep job, shared by every replica.
  await db.schema
    .createTable("org_jobs")
    .ifNotExists()
    .addColumn("name", "text", (col) => col.primaryKey())
    .addColumn("last_run_at", "timestamptz", (col) => col.notNull())
    .execute();
```

Add to `KyselyOrgStore`:

```ts
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
    await this.db
      .updateTable("org_jobs")
      .set({ last_run_at: previous })
      .where("name", "=", name)
      .where("last_run_at", "=", claimedAt)
      .execute();
  }

  async jobLastRun(name: string): Promise<Date | undefined> {
    const row = await this.db.selectFrom("org_jobs").select("last_run_at").where("name", "=", name).executeTakeFirst();
    return row ? toDate(row.last_run_at) : undefined;
  }
```

- [ ] **Step 4: The sweeper and the jobs**

Create `subgraphs/renown-orgs/core/sweeper.ts`:

```ts
import type { OrgStore } from "../store/types.js";

export const SWEEP_INTERVAL_MS = 60_000;

export interface SweepJob {
  name: string;
  /** Minimum time between two runs. */
  everyMs: number;
  run(now: Date): Promise<void>;
}

/**
 * The sweeper: each tick (one interval per replica) claims every job whose
 * interval has passed — atomically in org_jobs, so exactly one replica runs
 * it — and runs it. A failed run gives its claim back and is retried on the
 * next tick. Ticks never overlap within a process.
 */
export function createSweeper(deps: {
  jobs: readonly SweepJob[];
  store: () => Pick<OrgStore, "claimJob" | "releaseJob">;
  now: () => Date;
  log?: (message: string) => void;
}): { tick(): Promise<string[]> } {
  const log = deps.log ?? ((message: string) => console.error(message));
  let running = false;
  return {
    async tick() {
      if (running) return [];
      running = true;
      const ran: string[] = [];
      try {
        const store = deps.store();
        for (const job of deps.jobs) {
          const now = deps.now();
          const claim = await store.claimJob(job.name, now, job.everyMs);
          if (!claim) continue;
          try {
            await job.run(now);
            ran.push(job.name);
          } catch (error) {
            log(`[renown-orgs] sweep job ${job.name} failed: ${error instanceof Error ? error.message : String(error)}`);
            await store.releaseJob(job.name, now, claim.previous);
          }
        }
      } catch (error) {
        log(`[renown-orgs] sweep failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        running = false;
      }
      return ran;
    },
  };
}
```

Create `subgraphs/renown-orgs/jobs.ts`:

```ts
import { expireProposal, runProposal } from "./areas/proposals.js";
import type { SweepJob } from "./core/sweeper.js";
import type { OrgRuntime } from "./runtime.js";

const MINUTE_MS = 60_000;
const BATCH = 100;

/** Runs proposals that matured before they expired; expires the ones that never matured. */
export function proposalsJob(rt: OrgRuntime): SweepJob {
  return {
    name: "proposals",
    everyMs: MINUTE_MS,
    async run(now) {
      for (const due of await rt.store().dueProposals(now, BATCH)) {
        await rt.lock(`org:${due.orgId}`, async () => {
          const proposal = await rt.store().proposal(due.id);
          if (!proposal || proposal.status !== "PENDING") return;
          const executableAt = proposal.executableAt;
          if (executableAt && executableAt.getTime() <= now.getTime() && executableAt.getTime() < proposal.expiresAt.getTime()) {
            try {
              await runProposal(rt, proposal, "system");
            } catch (error) {
              console.error(`[renown-orgs] proposal ${proposal.id} could not run: ${error instanceof Error ? error.message : String(error)}`);
            }
          } else if (proposal.expiresAt.getTime() <= now.getTime()) {
            await expireProposal(rt, proposal, now);
          }
        });
      }
    },
  };
}

/** Every sweep job of renown-orgs; later tasks append theirs. */
export function sweepJobs(rt: OrgRuntime): SweepJob[] {
  return [proposalsJob(rt)];
}
```

Replace the export in `subgraphs/renown-orgs/resolvers.ts` with (and import `type OrgRuntime` from `./runtime.js`):

```ts
/** All renown-orgs resolvers over one runtime (shared with the sweeper: one lock map, one set of limiters). */
export function resolversFor(rt: OrgRuntime): Record<string, unknown> {
  const Query: Record<string, Resolver> = {};
  const Mutation: Record<string, Resolver> = {};
  for (const area of AREAS) {
    const built = area(rt);
    for (const [target, fields] of [[Query, built.Query], [Mutation, built.Mutation]] as const) {
      for (const [name, resolver] of Object.entries(fields ?? {})) {
        if (name in target) throw new Error(`renown-orgs: ${name} is defined twice`);
        target[name] = resolver;
      }
    }
  }
  return { Query, Mutation };
}

export function createResolvers(deps: OrgsResolverDeps): Record<string, unknown> {
  return resolversFor(createRuntime(deps));
}
```

In `subgraphs/renown-orgs/index.ts` import `createRuntime, type OrgRuntime` from `./runtime.js`, `resolversFor` (instead of `createResolvers`) from `./resolvers.js`, `createSweeper, SWEEP_INTERVAL_MS` from `./core/sweeper.js`, `sweepJobs` from `./jobs.js`, and replace the fields and lifecycle methods with:

```ts
  #store: KyselyOrgStore | undefined;
  #config: OrgsConfig | undefined;
  #setUp = false;
  #timer: ReturnType<typeof setInterval> | undefined;
  #runtime: OrgRuntime = createRuntime({
    reactorClient: this.reactorClient,
    relationalDb: this.relationalDb as unknown as ReadModelDb,
    store: () => this.#store,
    config: () => this.#getConfig(),
  });

  name = "renown-orgs";
  typeDefs: DocumentNode = schema;
  resolvers: Record<string, unknown> = resolversFor(this.#runtime);
  additionalContextFields = {};

  #getConfig(): OrgsConfig {
    return (this.#config ??= loadOrgsConfig(process.env));
  }

  async onSetup() {
    if (this.#setUp) return;
    this.#setUp = true;
    try {
      const db = (await this.relationalDb.createNamespace(ORGS_NAMESPACE)) as unknown as OrgsKysely;
      await migrate(db);
      this.#store = new KyselyOrgStore(db);
      const sweeper = createSweeper({ jobs: sweepJobs(this.#runtime), store: () => this.#runtime.store(), now: () => new Date() });
      this.#timer = setInterval(() => {
        void sweeper.tick();
      }, SWEEP_INTERVAL_MS);
      // Never keep the process alive for the sweeper.
      (this.#timer as { unref?: () => void }).unref?.();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown error";
      console.error(`[renown-orgs] relational namespace/migration failed (${reason}) — organizations disabled`);
    }
  }

  onDisconnect(): Promise<void> {
    if (this.#timer !== undefined) {
      clearInterval(this.#timer);
      this.#timer = undefined;
    }
    this.#store = undefined;
    this.#setUp = false;
    return Promise.resolve();
  }
```

In `subgraphs/renown-orgs/tests/harness.ts`, `harnessResolvers` builds the runtime itself: replace the `const resolvers = createResolvers({...}) as {...};` statement with

```ts
  const rt = createRuntime({
    reactorClient: reactor as unknown as OrgsResolverDeps["reactorClient"],
    relationalDb: h.relationalDb as OrgsResolverDeps["relationalDb"],
    store: () => store,
    config: () => TEST_CONFIG,
    now: () => clock.now,
    newId: () => `id-${String(++ids).padStart(4, "0")}`,
    media: () => null,
    ...overrides,
  });
  const resolvers = resolversFor(rt) as { Query: Record<string, Resolver>; Mutation: Record<string, Resolver> };
```

import `createRuntime` from `../runtime.js` and `resolversFor` from `../resolvers.js` (drop the `createResolvers` import), and add `rt,` to the returned object.

- [ ] **Step 5: Run the suite, types and lint**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass.

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add subgraphs/renown-orgs
git commit -m "feat(orgs): single-runner sweeper that runs and expires proposals"
```

---

### Task 3: Domains — SSRF-guarded proofs, verification, daily re-check, recovery

**Files:**
- Create: `subgraphs/renown-orgs/core/net.ts`, `core/domain-proof.ts`, `areas/domains.ts`
- Modify: `subgraphs/renown-orgs/store/{types,kysely}.ts` (domain writers; the table exists since A1), `runtime.ts` (`net` dependency), `areas/proposal-kinds.ts` (RECOVER), `schema-security.ts` (`DOMAINS_SDL`), `resolvers.ts`, `jobs.ts` (`domainsJob`)
- Test: `subgraphs/renown-orgs/tests/net.test.ts`, `tests/domains.test.ts`, `tests/store-contract.ts` (append)

**Interfaces:**
- Consumes: Tasks 1–2 (`createProposal`, `proposalOutput`, `PROPOSAL_KINDS`, `ProposalHandler`, `sweepJobs`), A1 (`requireOrg`, `requireRole`, errors).
- Produces:
  - `core/net.ts`: `isPublicAddress(ip): boolean`, `interface ResolvedAddress`, `interface PinnedRequest`, `interface PinnedResponse`, `interface NetDeps { lookup; resolveTxt; request }`, `nodeNetDeps: NetDeps`, `class NetGuardError`, `guardedRequest(deps, url, init): Promise<{ status: number; body: Uint8Array }>`, `FETCH_TIMEOUT_MS = 5000`, `FETCH_MAX_BYTES = 65536`. A3's webhooks reuse `guardedRequest`.
  - `core/domain-proof.ts`: `domainTxtName`, `domainTxtValue`, `wellKnownUrl`, `wellKnownJson`, `recoveryTxtValue`, `proveDomain(deps, domain, orgId, token)`, `proveRecovery(deps, domain, orgId, owner)`.
  - store: `type DomainPatch`, `insertDomain`, `domain(id)`, `domains(orgId)`, `updateDomain(id, patch)` (throws on the verified-once index), `deleteDomain(id)`, `verifiedDomainOwner(domain)`, `domainsToRecheck(checkedBefore, limit)`.
  - runtime: `OrgsResolverDeps.net?: NetDeps`, `OrgRuntime.net(): NetDeps`.
  - `areas/domains.ts`: `domainResolvers: Area` (`orgDomains`, `addOrgDomain`, `checkOrgDomain`, `removeOrgDomain`, `startOrgRecovery`), `domainOutput(d)`, `normalizeDomain(raw)`, `MAX_DOMAINS = 10`, `RECOVERY_MIN_VERIFIED_DAYS = 14`; `jobs.ts`: `domainsJob(rt)`; `PROPOSAL_KINDS.RECOVER`.

- [ ] **Step 1: Write the failing tests**

Append inside `describeOrgStoreContract` in `subgraphs/renown-orgs/tests/store-contract.ts`:

```ts
    it("writes domains, verifies a domain for one organization only, lists those due for a re-check", async () => {
      const { store } = await open();
      const domain = (id: string, orgId: string, name: string) => ({
        id, orgId, domain: name, token: "t", status: "PENDING" as const, verifiedAt: null, lastCheckedAt: null, failures: 0, createdAt: T0,
      });
      await store.insertDomain(domain("d1", "o1", "acme.example"));
      await store.insertDomain(domain("d2", "o2", "acme.example"));
      expect(await store.updateDomain("d1", { status: "VERIFIED", verifiedAt: T0, lastCheckedAt: T0 })).toMatchObject({ status: "VERIFIED", verifiedAt: T0 });
      await expect(store.updateDomain("d2", { status: "VERIFIED", verifiedAt: T0 })).rejects.toThrow();
      expect(await store.verifiedDomainOwner("ACME.example")).toBe("o1");
      expect((await store.domains("o1")).map((d) => d.id)).toEqual(["d1"]);
      expect((await store.domainsToRecheck(new Date(T0.getTime() - 1), 10)).map((d) => d.id)).toEqual([]);
      expect((await store.domainsToRecheck(T0, 10)).map((d) => d.id)).toEqual(["d1"]);
      expect(await store.deleteDomain("d2")).toBe(true);
      expect(await store.domain("d2")).toBeUndefined();
    });
```

Create `subgraphs/renown-orgs/tests/net.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { guardedRequest, isPublicAddress, NetGuardError, type NetDeps, type PinnedRequest } from "../core/net.js";

function fakeNet(addresses: Record<string, string[]>, status = 200, body = "{}"): NetDeps & { requests: PinnedRequest[] } {
  const requests: PinnedRequest[] = [];
  return {
    requests,
    lookup: (host) => Promise.resolve((addresses[host] ?? []).map((address) => ({ address, family: address.includes(":") ? (6 as const) : (4 as const) }))),
    resolveTxt: () => Promise.reject(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })),
    request: (request) => {
      requests.push(request);
      const bytes = new TextEncoder().encode(body);
      return Promise.resolve({ status, body: bytes.slice(0, request.maxBytes), truncated: bytes.length > request.maxBytes });
    },
  };
}

describe("isPublicAddress", () => {
  it("refuses private, loopback, link-local, CGNAT, ULA, mapped and special ranges", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fe80::1", "fd12::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "64:ff9b::a00:1", "224.0.0.1", "fe80::1%eth0", "not-an-ip"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["93.184.216.34", "8.8.8.8", "2606:4700::1111", "::ffff:8.8.8.8"]) expect(isPublicAddress(ip), ip).toBe(true);
  });
});

describe("guardedRequest", () => {
  it("connects only to the vetted public address, with the original host name", async () => {
    const net = fakeNet({ "acme.example": ["93.184.216.34"] });
    expect(await guardedRequest(net, "https://acme.example/.well-known/renown.json", { method: "GET" })).toMatchObject({ status: 200 });
    expect(net.requests[0]).toMatchObject({ address: "93.184.216.34", family: 4, timeoutMs: 5000, maxBytes: 65536 });
    expect(net.requests[0].url.host).toBe("acme.example");
  });

  it("never connects to a private address, an http URL, credentials or an oversized body", async () => {
    const refuse = async (net: ReturnType<typeof fakeNet>, url: string) => {
      await expect(guardedRequest(net, url, { method: "GET" })).rejects.toBeInstanceOf(NetGuardError);
      expect(net.requests).toEqual([]);
    };
    await refuse(fakeNet({ "acme.example": ["10.0.0.1"] }), "https://acme.example/");
    await refuse(fakeNet({ "acme.example": ["93.184.216.34", "127.0.0.1"] }), "https://acme.example/");
    await refuse(fakeNet({}), "https://acme.example/");
    await refuse(fakeNet({}), "https://[::ffff:127.0.0.1]/");
    await refuse(fakeNet({ "acme.example": ["93.184.216.34"] }), "http://acme.example/");
    await refuse(fakeNet({ "acme.example": ["93.184.216.34"] }), "https://user:pw@acme.example/");
    await refuse(fakeNet({}), "not a url");
    const big = fakeNet({ "acme.example": ["93.184.216.34"] }, 200, "x".repeat(65_537));
    await expect(guardedRequest(big, "https://acme.example/", { method: "GET" })).rejects.toThrow(/larger than 65536/);
  });

  it("does not follow redirects: a 3xx comes back as is", async () => {
    const net = fakeNet({ "acme.example": ["93.184.216.34"] }, 302);
    expect((await guardedRequest(net, "https://acme.example/", { method: "GET" })).status).toBe(302);
  });
});
```

Create `subgraphs/renown-orgs/tests/domains.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import type { ProposalOutput } from "../areas/proposals.js";
import type { RecordedActivity } from "../core/activity.js";
import type { NetDeps } from "../core/net.js";
import { createSweeper } from "../core/sweeper.js";
import { sweepJobs } from "../jobs.js";
import type { OrganizationOutput } from "../output.js";
import { ALICE, BOB, CAROL, DAVE, addOwner, createOrg, failure, harnessResolvers, join, lower, openHarness, resetHarness, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
interface Domain {
  id: string;
  status: string;
  txtName: string;
  txtValue: string;
  wellKnownUrl: string;
  wellKnownJson: string;
  verifiedAt: string | null;
  failures: number;
}
let h: Harness;

/** DNS and HTTPS for tests: TXT records and renown.json bodies are set per test; every host resolves to `ip`. */
function world() {
  const txt = new Map<string, string[]>();
  const bodies = new Map<string, string>();
  const state = { ip: "93.184.216.34", requests: 0 };
  const net: NetDeps = {
    lookup: () => Promise.resolve([{ address: state.ip, family: 4 }]),
    resolveTxt: (name) => (txt.has(name) ? Promise.resolve((txt.get(name) ?? []).map((v) => [v])) : Promise.reject(Object.assign(new Error("ENODATA"), { code: "ENODATA" }))),
    request: (request) => {
      state.requests += 1;
      const body = bodies.get(request.url.href);
      return Promise.resolve({ status: body === undefined ? 404 : 200, body: new TextEncoder().encode(body ?? ""), truncated: false });
    },
  };
  return { txt, bodies, state, net };
}

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

describe("domains", () => {
  it("adds a domain with both proof instructions and verifies it by DNS TXT", async () => {
    const w = world();
    const t = harnessResolvers(h, { net: w.net });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: " Acme.Example. " }, ALICE);
    expect(d).toMatchObject({ status: "PENDING", txtName: "_renown.acme.example", wellKnownUrl: "https://acme.example/.well-known/renown.json" });
    expect(d.txtValue).toMatch(new RegExp(`^renown-org=${id};token=[A-Za-z0-9_-]{22}$`));
    expect(JSON.parse(d.wellKnownJson)).toEqual({ organizations: [{ id, token: d.txtValue.split("token=")[1] }] });
    expect((await failure(t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE))).code).toBe("DOMAIN_PROOF_MISSING");
    w.txt.set("_renown.acme.example", ["v=spf1 -all", d.txtValue]);
    expect(await t.mutate<Domain>("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE)).toMatchObject({ status: "VERIFIED", verifiedAt: t.clock.now.toISOString(), failures: 0 });
    expect((await t.query<OrganizationOutput>("organization", { id }))?.verifiedDomains).toEqual(["acme.example"]);
    expect(t.reactor.state<RenownOrganizationState>(id).domains).toMatchObject([{ domain: "acme.example", status: "VERIFIED" }]);
  });

  it("verifies by renown.json, never fetching from a private address", async () => {
    const w = world();
    const t = harnessResolvers(h, { net: w.net });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE);
    w.bodies.set(d.wellKnownUrl, d.wellKnownJson);
    w.state.ip = "10.0.0.7";
    expect((await failure(t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE))).code).toBe("DOMAIN_PROOF_MISSING");
    expect(w.state.requests).toBe(0);
    w.state.ip = "93.184.216.34";
    expect((await t.mutate<Domain>("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE)).status).toBe("VERIFIED");
  });

  it("gives a domain to the first organization that verifies it", async () => {
    const w = world();
    const t = harnessResolvers(h, { net: w.net });
    const a = await createOrg(t, ALICE, "acme");
    const b = await createOrg(t, BOB, "copycat");
    const late = await t.mutate<Domain>("addOrgDomain", { orgId: b.id, domain: "acme.example" }, BOB);
    const first = await t.mutate<Domain>("addOrgDomain", { orgId: a.id, domain: "acme.example" }, ALICE);
    w.txt.set("_renown.acme.example", [first.txtValue, late.txtValue]);
    await t.mutate("checkOrgDomain", { orgId: a.id, domainId: first.id }, ALICE);
    expect((await failure(t.mutate("checkOrgDomain", { orgId: b.id, domainId: late.id }, BOB))).code).toBe("DOMAIN_TAKEN");
    expect((await failure(t.mutate("addOrgDomain", { orgId: b.id, domain: "acme.example" }, BOB))).code).toBe("DOMAIN_TAKEN");
  });

  it("lapses after three failed daily re-checks; a later check re-verifies and restarts the clock", async () => {
    const w = world();
    const events: RecordedActivity[] = [];
    const t = harnessResolvers(h, { net: w.net, sinks: [(a) => Promise.resolve(void events.push(a))] });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE);
    w.txt.set("_renown.acme.example", [d.txtValue]);
    await t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE);
    const sweeper = createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now });
    w.txt.clear();
    for (let day = 1; day <= 3; day++) {
      t.tick(DAY);
      await sweeper.tick();
    }
    expect(await t.store.domain(d.id)).toMatchObject({ status: "LAPSED", failures: 3 });
    expect(t.reactor.state<RenownOrganizationState>(id).domains[0].status).toBe("LAPSED");
    expect(events.find((e) => e.event?.type === "domain.lapsed")?.notify).toEqual([{ to: "ADMINS", kind: "DOMAIN_LAPSED", payload: { domainId: d.id, domain: "acme.example" } }]);
    w.txt.set("_renown.acme.example", [d.txtValue]);
    expect(await t.mutate<Domain>("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE)).toMatchObject({ status: "VERIFIED", verifiedAt: t.clock.now.toISOString() });
  });

  it("validates domains, caps them at 10 per organization and is for admins only", async () => {
    const t = harnessResolvers(h, { net: world().net });
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    for (const domain of ["localhost", "10.0.0.1", "https://acme.example", "acme"]) {
      expect(await failure(t.mutate("addOrgDomain", { orgId: id, domain }, ALICE))).toMatchObject({ code: "BAD_USER_INPUT", field: "domain" });
    }
    expect((await failure(t.mutate("addOrgDomain", { orgId: id, domain: "acme.example" }, BOB))).code).toBe("FORBIDDEN");
    for (let i = 0; i < 10; i++) await t.mutate("addOrgDomain", { orgId: id, domain: `d${i}.example` }, ALICE);
    expect(await failure(t.mutate("addOrgDomain", { orgId: id, domain: "d0.example" }, ALICE))).toMatchObject({ code: "LIMIT_REACHED" });
    const [first] = await t.query<Domain[]>("orgDomains", { orgId: id }, ALICE);
    expect(await t.mutate("removeOrgDomain", { orgId: id, domainId: first.id }, ALICE)).toBe(true);
    expect(await failure(t.mutate("addOrgDomain", { orgId: id, domain: "d1.example" }, ALICE))).toMatchObject({ field: "domain" });
  });
});

describe("recovery", () => {
  async function verifiedOrg(w: ReturnType<typeof world>) {
    const t = harnessResolvers(h, { net: w.net });
    const { id } = await createOrg(t, ALICE, "acme");
    const d = await t.mutate<Domain>("addOrgDomain", { orgId: id, domain: "acme.example" }, ALICE);
    w.txt.set("_renown.acme.example", [d.txtValue]);
    await t.mutate("checkOrgDomain", { orgId: id, domainId: d.id }, ALICE);
    return { t, id, d };
  }

  it("needs a domain verified for 14 days and a recovery record naming the new owner", async () => {
    const w = world();
    const { t, id } = await verifiedOrg(w);
    const start = () => t.mutate<ProposalOutput>("startOrgRecovery", { orgId: id, domain: "acme.example", newOwner: CAROL.address }, DAVE);
    expect(await failure(start())).toMatchObject({ code: "BAD_USER_INPUT", field: "domain" });
    t.tick(14 * DAY);
    expect((await failure(start())).code).toBe("DOMAIN_PROOF_MISSING");
    w.txt.set("_renown.acme.example", [`renown-org-recover=${id};owner=${CAROL.address}`]);
    const p = await start();
    expect(p).toMatchObject({ kind: "RECOVER", threshold: 0, approvals: [], proposer: lower(DAVE), payload: { domain: "acme.example", address: lower(CAROL) } });
    expect(p.executableAt).toBe(new Date(t.clock.now.getTime() + 7200 * 1000).toISOString());
    expect(await failure(start())).toMatchObject({ field: "domain" });
  });

  it("lets an owner cancel it, and otherwise makes the new owner an active owner after the delay", async () => {
    const w = world();
    const { t, id } = await verifiedOrg(w);
    t.tick(14 * DAY);
    w.bodies.set("https://acme.example/.well-known/renown.json", JSON.stringify({ organizations: [{ id, recover: CAROL.address.toUpperCase().replace("0X", "0x") }] }));
    w.txt.clear();
    const cancelled = await t.mutate<ProposalOutput>("startOrgRecovery", { orgId: id, domain: "acme.example", newOwner: CAROL.address }, DAVE);
    expect((await t.mutate<ProposalOutput>("cancelOrgProposal", { orgId: id, proposalId: cancelled.id }, ALICE)).status).toBe("CANCELLED");
    const p = await t.mutate<ProposalOutput>("startOrgRecovery", { orgId: id, domain: "acme.example", newOwner: CAROL.address }, DAVE);
    t.tick(2 * HOUR);
    expect((await t.mutate<ProposalOutput>("executeOrgProposal", { orgId: id, proposalId: p.id }, DAVE)).status).toBe("EXECUTED");
    expect(await t.store.openMember(id, lower(CAROL))).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    expect(t.reactor.state<RenownOrganizationState>(id).members.find((m) => m.address === lower(CAROL))).toMatchObject({ role: "OWNER", status: "ACTIVE" });
    await addOwner(t, id, BOB);
    expect((await t.store.members(id, ["ACTIVE"])).filter((m) => m.role === "OWNER")).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Tests |FAIL" | head -6`
Expected: failures (`insertDomain is not a function`, `../core/net.js` missing, `addOrgDomain` missing).

- [ ] **Step 3: The network guard and the proofs**

Create `subgraphs/renown-orgs/core/net.ts`:

```ts
import { promises as dns } from "node:dns";
import https from "node:https";
import { BlockList, isIP } from "node:net";

export const FETCH_TIMEOUT_MS = 5_000;
export const FETCH_MAX_BYTES = 65_536;

// Everything that is not the public internet. IPv4 rules also cover
// IPv4-mapped IPv6 (::ffff:a.b.c.d), so no ::ffff:0:0/96 rule (which would
// match every IPv4 address).
const BLOCKED = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED.addSubnet(network, prefix, "ipv6");
}

/** True only for a literal IP address on the public internet. */
export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 0) return false;
  return !BLOCKED.check(ip, family === 4 ? "ipv4" : "ipv6");
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export interface PinnedRequest {
  url: URL;
  /** The vetted address the connection must use (no second DNS lookup). */
  address: string;
  family: 4 | 6;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
}

export interface PinnedResponse {
  status: number;
  body: Uint8Array;
  /** The body exceeded maxBytes and was cut off. */
  truncated: boolean;
}

/** DNS and HTTPS, injectable for tests. */
export interface NetDeps {
  lookup(host: string): Promise<ResolvedAddress[]>;
  resolveTxt(name: string): Promise<string[][]>;
  request(request: PinnedRequest): Promise<PinnedResponse>;
}

export class NetGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetGuardError";
  }
}

/** HTTPS to `target.address` with SNI and Host of the URL; never follows redirects; aborts at the timeout or the size cap. */
function pinnedHttpsRequest(target: PinnedRequest): Promise<PinnedResponse> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    const host = target.url.hostname.replace(/^\[|\]$/g, "");
    const request = https.request(
      {
        host,
        servername: isIP(host) ? undefined : host,
        port: target.url.port ? Number(target.url.port) : 443,
        path: `${target.url.pathname}${target.url.search}`,
        method: target.method,
        headers: { ...target.headers, host: target.url.host },
        lookup: ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
          if (options?.all) callback(null, [{ address: target.address, family: target.family }]);
          else callback(null, target.address, target.family);
        }) as never,
      },
      (response) => {
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > target.maxBytes) {
            settle(() => resolve({ status: response.statusCode ?? 0, body: new Uint8Array(), truncated: true }));
            request.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          settle(() => resolve({ status: response.statusCode ?? 0, body: new Uint8Array(Buffer.concat(chunks)), truncated: false })),
        );
        response.on("error", (error) => settle(() => reject(error)));
      },
    );
    timer = setTimeout(() => request.destroy(new Error("timeout")), target.timeoutMs);
    request.on("error", (error) => settle(() => reject(error)));
    if (target.body !== undefined) request.write(target.body);
    request.end();
  });
}

export const nodeNetDeps: NetDeps = {
  lookup: async (host) =>
    (await dns.lookup(host, { all: true, verbatim: true })).map(({ address, family }) => ({
      address,
      family: family === 6 ? 6 : 4,
    })),
  resolveTxt: (name) => dns.resolveTxt(name),
  request: pinnedHttpsRequest,
};

/**
 * Fetches `rawUrl` under the organisation fetch rules: HTTPS only, no
 * credentials in the URL, every resolved address public (checked after DNS
 * resolution, then pinned for the connection), 5 s, 64 KiB, no redirects
 * (a 3xx comes back as is). Throws NetGuardError when a rule refuses it.
 */
export async function guardedRequest(
  deps: NetDeps,
  rawUrl: string,
  init: { method: "GET" | "POST"; headers?: Record<string, string>; body?: string; timeoutMs?: number; maxBytes?: number },
): Promise<{ status: number; body: Uint8Array }> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new NetGuardError("Not a URL");
  }
  if (url.protocol !== "https:") throw new NetGuardError("Only https URLs are fetched");
  if (url.username || url.password) throw new NetGuardError("URLs with credentials are not fetched");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literal = isIP(host);
  let addresses: ResolvedAddress[];
  if (literal !== 0) {
    addresses = [{ address: host, family: literal === 6 ? 6 : 4 }];
  } else {
    try {
      addresses = await deps.lookup(host);
    } catch {
      throw new NetGuardError(`${host} does not resolve`);
    }
  }
  if (addresses.length === 0) throw new NetGuardError(`${host} does not resolve`);
  if (!addresses.every((entry) => isPublicAddress(entry.address))) {
    throw new NetGuardError(`${host} resolves to a non-public address`);
  }
  const maxBytes = init.maxBytes ?? FETCH_MAX_BYTES;
  const response = await deps.request({
    url,
    address: addresses[0].address,
    family: addresses[0].family,
    method: init.method,
    headers: init.headers ?? {},
    body: init.body,
    timeoutMs: init.timeoutMs ?? FETCH_TIMEOUT_MS,
    maxBytes,
  });
  if (response.truncated) throw new NetGuardError(`The response is larger than ${maxBytes} bytes`);
  return { status: response.status, body: response.body };
}
```

Create `subgraphs/renown-orgs/core/domain-proof.ts`:

```ts
import { guardedRequest, type NetDeps } from "./net.js";

const RECOVER_RE = /^renown-org-recover=(.+);owner=(0x[0-9a-fA-F]{40})$/;

export function domainTxtName(domain: string): string {
  return `_renown.${domain}`;
}

export function domainTxtValue(orgId: string, token: string): string {
  return `renown-org=${orgId};token=${token}`;
}

export function wellKnownUrl(domain: string): string {
  return `https://${domain}/.well-known/renown.json`;
}

export function wellKnownJson(orgId: string, token: string): string {
  return JSON.stringify({ organizations: [{ id: orgId, token }] });
}

export function recoveryTxtValue(orgId: string, owner: string): string {
  return `renown-org-recover=${orgId};owner=${owner.toLowerCase()}`;
}

interface WellKnownEntry {
  id?: unknown;
  token?: unknown;
  recover?: unknown;
}

/** The TXT records at _renown.<domain>, each record's chunks joined; [] on any DNS failure. */
async function txtRecords(deps: NetDeps, domain: string): Promise<string[]> {
  try {
    return (await deps.resolveTxt(domainTxtName(domain))).map((chunks) => chunks.join("").trim());
  } catch {
    return [];
  }
}

/** The organizations[] entries of renown.json; [] when it cannot be fetched or parsed. */
async function wellKnownEntries(deps: NetDeps, domain: string): Promise<WellKnownEntry[]> {
  try {
    const response = await guardedRequest(deps, wellKnownUrl(domain), { method: "GET", headers: { accept: "application/json" } });
    if (response.status !== 200) return [];
    const parsed = JSON.parse(new TextDecoder().decode(response.body)) as { organizations?: unknown };
    if (!Array.isArray(parsed.organizations)) return [];
    return parsed.organizations.filter((entry): entry is WellKnownEntry => entry !== null && typeof entry === "object");
  } catch {
    return [];
  }
}

/** True when the domain publishes this organization's token (TXT, else renown.json). */
export async function proveDomain(deps: NetDeps, domain: string, orgId: string, token: string): Promise<boolean> {
  if ((await txtRecords(deps, domain)).includes(domainTxtValue(orgId, token))) return true;
  return (await wellKnownEntries(deps, domain)).some((entry) => entry.id === orgId && entry.token === token);
}

/** True when the domain names `owner` as the recovery owner of this organization (TXT, else renown.json). */
export async function proveRecovery(deps: NetDeps, domain: string, orgId: string, owner: string): Promise<boolean> {
  const wanted = owner.toLowerCase();
  const viaTxt = (await txtRecords(deps, domain)).some((value) => {
    const match = RECOVER_RE.exec(value);
    return match !== null && match[1] === orgId && match[2].toLowerCase() === wanted;
  });
  if (viaTxt) return true;
  return (await wellKnownEntries(deps, domain)).some(
    (entry) => entry.id === orgId && typeof entry.recover === "string" && entry.recover.toLowerCase() === wanted,
  );
}
```

- [ ] **Step 4: Runtime dependency, store writers**

In `subgraphs/renown-orgs/runtime.ts`: import `nodeNetDeps, type NetDeps` from `./core/net.js`; add `net?: NetDeps;` to `OrgsResolverDeps` (doc: "DNS and HTTPS for domain proofs and webhooks; node's by default") and `net(): NetDeps;` to `OrgRuntime`; in `createRuntime`'s returned object add `net: () => deps.net ?? nodeNetDeps,`.

In `subgraphs/renown-orgs/store/types.ts` add

```ts
export type DomainPatch = Partial<Pick<DomainRecord, "status" | "verifiedAt" | "lastCheckedAt" | "failures">>;
```

and to `OrgStore`:

```ts
  insertDomain(domain: DomainRecord): Promise<void>;
  domain(id: string): Promise<DomainRecord | undefined>;
  /** createdAt order. */
  domains(orgId: string): Promise<DomainRecord[]>;
  /** Throws when a second organization would get the same VERIFIED domain. */
  updateDomain(id: string, patch: DomainPatch): Promise<DomainRecord | undefined>;
  deleteDomain(id: string): Promise<boolean>;
  /** The organization the domain is VERIFIED for (case-insensitive), if any. */
  verifiedDomainOwner(domain: string): Promise<string | undefined>;
  /** VERIFIED domains never checked or last checked at or before `checkedBefore`, oldest check first. */
  domainsToRecheck(checkedBefore: Date, limit: number): Promise<DomainRecord[]>;
```

In `subgraphs/renown-orgs/store/kysely.ts` (import `DomainPatch`, `DomainRecord`, `OrgDomainsTable`):

```ts
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
```

and in the class:

```ts
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

  async updateDomain(id: string, patch: DomainPatch): Promise<DomainRecord | undefined> {
    const row = await this.db
      .updateTable("org_domains")
      .set({
        ...(patch.status !== undefined && { status: patch.status }),
        ...(patch.verifiedAt !== undefined && { verified_at: patch.verifiedAt }),
        ...(patch.lastCheckedAt !== undefined && { last_checked_at: patch.lastCheckedAt }),
        ...(patch.failures !== undefined && { failures: patch.failures }),
      })
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
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
      .orderBy("last_checked_at")
      .orderBy("id")
      .limit(limit)
      .execute();
    return rows.map(toDomain);
  }
```

- [ ] **Step 5: SDL, resolvers, RECOVER, the daily job**

In `subgraphs/renown-orgs/schema-security.ts` add and include it in `SECURITY_SDL` (`[PROPOSALS_SDL, DOMAINS_SDL]`):

```ts
export const DOMAINS_SDL = `
  enum OrgDomainStatus {
    PENDING
    VERIFIED
    LAPSED
  }

  type OrgDomain {
    id: String!
    orgId: String!
    domain: String!
    status: OrgDomainStatus!
    verifiedAt: String
    lastCheckedAt: String
    failures: Int!
    createdAt: String!
    "DNS TXT record name: _renown.<domain>"
    txtName: String!
    "DNS TXT record value: renown-org=<orgId>;token=<token>"
    txtValue: String!
    "https://<domain>/.well-known/renown.json"
    wellKnownUrl: String!
    "A renown.json body that proves the domain"
    wellKnownJson: String!
  }

  extend type Query {
    "Admins."
    orgDomains(orgId: String!, auth: OrgAuthInput): [OrgDomain!]!
  }

  extend type Mutation {
    "Admins; at most 10 domains. DOMAIN_TAKEN when another organization has it verified."
    addOrgDomain(orgId: String!, domain: String!, auth: OrgAuthInput): OrgDomain!
    "Admins. DOMAIN_PROOF_MISSING when neither the TXT record nor renown.json proves it."
    checkOrgDomain(orgId: String!, domainId: String!, auth: OrgAuthInput): OrgDomain!
    removeOrgDomain(orgId: String!, domainId: String!, auth: OrgAuthInput): Boolean!
    "Anyone signed in: a RECOVER proposal (no approvals, recovery delay) proven by a domain verified for at least 14 days."
    startOrgRecovery(orgId: String!, domain: String!, newOwner: String!, auth: OrgAuthInput): OrgProposal!
  }
`;
```

Create `subgraphs/renown-orgs/areas/domains.ts`:

```ts
import { actions as orgActions, isOrgDomain } from "../../../document-models/renown-organization/index.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { domainTxtName, domainTxtValue, proveDomain, proveRecovery, wellKnownJson, wellKnownUrl } from "../core/domain-proof.js";
import { badInput, limitReached, notFound, orgError, unavailable } from "../core/errors.js";
import { iso, isoOrNull } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { DomainRecord } from "../store/types.js";
import { addressArg } from "./members.js";
import { createProposal, proposalOutput } from "./proposals.js";

export const MAX_DOMAINS = 10;
export const RECOVERY_MIN_VERIFIED_DAYS = 14;
const DAY_MS = 86_400_000;

export function normalizeDomain(raw: string): string {
  const domain = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!isOrgDomain(domain)) throw badInput("domain", "domain must be a DNS name like example.com");
  return domain;
}

export function domainOutput(d: DomainRecord) {
  return {
    id: d.id,
    orgId: d.orgId,
    domain: d.domain,
    status: d.status,
    verifiedAt: isoOrNull(d.verifiedAt),
    lastCheckedAt: isoOrNull(d.lastCheckedAt),
    failures: d.failures,
    createdAt: iso(d.createdAt),
    txtName: domainTxtName(d.domain),
    txtValue: domainTxtValue(d.orgId, d.token),
    wellKnownUrl: wellKnownUrl(d.domain),
    wellKnownJson: wellKnownJson(d.orgId, d.token),
  };
}

function domainTaken() {
  return orgError("DOMAIN_TAKEN", "Another organization has verified this domain");
}

/** The admin's domain of `orgId`, or NOT_FOUND / FORBIDDEN. */
async function adminDomain(rt: OrgRuntime, orgId: string, caller: string, domainId: string): Promise<DomainRecord> {
  const store = rt.store();
  await requireOrg(store, orgId);
  await requireRole(store, orgId, caller, "ADMIN");
  const domain = await store.domain(domainId);
  if (!domain || domain.orgId !== orgId) throw notFound("Domain");
  return domain;
}

export const domainResolvers: Area = (rt) => ({
  Query: {
    orgDomains: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgDomains", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      return (await store.domains(args.orgId)).map(domainOutput);
    },
  },
  Mutation: {
    addOrgDomain: async (_: unknown, args: OrgArgs & { orgId: string; domain: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "addOrgDomain", args);
      const name = normalizeDomain(args.domain);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        const owner = await store.verifiedDomainOwner(name);
        if (owner && owner !== args.orgId) throw domainTaken();
        const existing = await store.domains(args.orgId);
        if (existing.length >= MAX_DOMAINS) throw limitReached(`At most ${MAX_DOMAINS} domains`);
        if (existing.some((d) => d.domain === name)) throw badInput("domain", "The domain is already added");
        const domain: DomainRecord = {
          id: rt.newId(),
          orgId: args.orgId,
          domain: name,
          token: rt.token(16),
          status: "PENDING",
          verifiedAt: null,
          lastCheckedAt: null,
          failures: 0,
          createdAt: now,
        };
        await rt.execute(args.orgId, [orgActions.addDomain({ id: domain.id, domain: name })]);
        await store.insertDomain(domain);
        await rt.record({ orgId: args.orgId, actor: caller, action: "addOrgDomain", at: now, details: { domainId: domain.id, domain: name } });
        return domainOutput(domain);
      });
    },
    checkOrgDomain: async (_: unknown, args: OrgArgs & { orgId: string; domainId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "checkOrgDomain", args);
      // The network check runs outside the org lock; the result is applied under it.
      const checked = await adminDomain(rt, args.orgId, caller, args.domainId);
      const owner = await rt.store().verifiedDomainOwner(checked.domain);
      if (owner && owner !== args.orgId) throw domainTaken();
      const proved = await proveDomain(rt.net(), checked.domain, args.orgId, checked.token);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const domain = await adminDomain(rt, args.orgId, caller, args.domainId);
        if (!proved) {
          await store.updateDomain(domain.id, { lastCheckedAt: now });
          throw orgError("DOMAIN_PROOF_MISSING", `Neither ${domainTxtName(domain.domain)} nor ${wellKnownUrl(domain.domain)} proves the domain`);
        }
        const transition = domain.status !== "VERIFIED";
        const verifiedAt = transition ? now : domain.verifiedAt;
        let updated: DomainRecord | undefined;
        try {
          updated = await store.updateDomain(domain.id, { status: "VERIFIED", verifiedAt, lastCheckedAt: now, failures: 0 });
        } catch {
          throw domainTaken();
        }
        if (!updated) throw unavailable();
        if (transition) {
          await rt.execute(args.orgId, [orgActions.setDomainStatus({ id: domain.id, status: "VERIFIED", verifiedAt: iso(now) })]);
          const data = { domainId: domain.id, domain: domain.domain };
          await rt.record({ orgId: args.orgId, actor: caller, action: "checkOrgDomain", at: now, details: data, event: { type: "domain.verified", data } });
        }
        return domainOutput(updated);
      });
    },
    removeOrgDomain: async (_: unknown, args: OrgArgs & { orgId: string; domainId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "removeOrgDomain", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const domain = await adminDomain(rt, args.orgId, caller, args.domainId);
        await rt.execute(args.orgId, [orgActions.removeDomain({ id: domain.id })]);
        await rt.store().deleteDomain(domain.id);
        await rt.record({ orgId: args.orgId, actor: caller, action: "removeOrgDomain", at: rt.now(), details: { domainId: domain.id, domain: domain.domain } });
        return true;
      });
    },
    startOrgRecovery: async (_: unknown, args: OrgArgs & { orgId: string; domain: string; newOwner: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "startOrgRecovery", args);
      const name = normalizeDomain(args.domain);
      const newOwner = addressArg("newOwner", args.newOwner);
      const store = rt.store();
      const org = await requireOrg(store, args.orgId);
      const now = rt.now();
      const domain = (await store.domains(org.id)).find((d) => d.domain === name && d.status === "VERIFIED");
      if (!domain?.verifiedAt) throw badInput("domain", "The domain is not verified for this organization");
      if (now.getTime() - domain.verifiedAt.getTime() < RECOVERY_MIN_VERIFIED_DAYS * DAY_MS) {
        throw badInput("domain", `The domain must have been verified for ${RECOVERY_MIN_VERIFIED_DAYS} days`);
      }
      if ((await store.proposals(org.id, "PENDING")).some((p) => p.kind === "RECOVER")) {
        throw badInput("domain", "A recovery is already pending");
      }
      if (!(await proveRecovery(rt.net(), name, org.id, newOwner))) {
        throw orgError("DOMAIN_PROOF_MISSING", `Publish renown-org-recover=${org.id};owner=${newOwner} at ${domainTxtName(name)} or in renown.json`);
      }
      return rt.lock(`org:${org.id}`, async () => {
        if ((await rt.store().proposals(org.id, "PENDING")).some((p) => p.kind === "RECOVER")) {
          throw badInput("domain", "A recovery is already pending");
        }
        return proposalOutput(await createProposal(rt, org, "RECOVER", { domain: name, address: newOwner }, caller, [], rt.now()));
      });
    },
  },
});
```

In `subgraphs/renown-orgs/areas/proposal-kinds.ts` add the RECOVER handler (and register it in `PROPOSAL_KINDS` as `RECOVER: recover,`):

```ts
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
      await rt.execute(org.id, [orgActions.setMemberRole({ id: existing.id, role: "OWNER", at })]);
      await store.updateMember(existing.id, { role: "OWNER", appScopeAll: true, updatedAt: now });
    } else {
      const id = rt.newId();
      await rt.execute(org.id, [
        ...(existing ? [orgActions.setMemberStatus({ id: existing.id, status: "REVOKED", at })] : []),
        orgActions.inviteMember({ id, address, role: "OWNER", invitedAt: at }),
        orgActions.setMemberStatus({ id, status: "ACTIVE", at }),
      ]);
      if (existing) await store.updateMember(existing.id, { status: "REVOKED", endedAt: now, updatedAt: now });
      await store.insertMember({
        id,
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
      });
    }
    const data = { address, role: "OWNER" };
    await rt.record({
      orgId: org.id,
      actor,
      action: "proposal.RECOVER",
      at: now,
      details: { ...data, domain: proposal.payload.domain, proposalId: proposal.id },
      event: { type: "member.joined", data },
      notify: [{ to: "OWNERS", kind: "PROPOSAL_EXECUTED", payload: { proposalId: proposal.id, kind: "RECOVER", address } }],
    });
    return null;
  },
};
```

Append to `subgraphs/renown-orgs/jobs.ts` and add `domainsJob(rt)` to `sweepJobs`:

```ts
const HOUR_MS = 3_600_000;
const RECHECK_AFTER_MS = 24 * HOUR_MS;
export const LAPSE_AFTER_FAILURES = 3;

/** Hourly: re-checks every VERIFIED domain last checked a day ago or more; 3 failures in a row lapse it. */
export function domainsJob(rt: OrgRuntime): SweepJob {
  return {
    name: "domains",
    everyMs: HOUR_MS,
    async run(now) {
      for (const due of await rt.store().domainsToRecheck(new Date(now.getTime() - RECHECK_AFTER_MS), BATCH)) {
        const proved = await proveDomain(rt.net(), due.domain, due.orgId, due.token);
        await rt.lock(`org:${due.orgId}`, async () => {
          const store = rt.store();
          const domain = await store.domain(due.id);
          if (!domain || domain.status !== "VERIFIED") return;
          if (proved) {
            await store.updateDomain(domain.id, { lastCheckedAt: now, failures: 0 });
            return;
          }
          const failures = domain.failures + 1;
          if (failures < LAPSE_AFTER_FAILURES) {
            await store.updateDomain(domain.id, { lastCheckedAt: now, failures });
            return;
          }
          await store.updateDomain(domain.id, { status: "LAPSED", lastCheckedAt: now, failures });
          await rt.execute(domain.orgId, [orgActions.setDomainStatus({ id: domain.id, status: "LAPSED" })]);
          const data = { domainId: domain.id, domain: domain.domain };
          await rt.record({
            orgId: domain.orgId,
            actor: "system",
            action: "system.domainLapsed",
            at: now,
            details: { ...data, failures },
            event: { type: "domain.lapsed", data },
            notify: [{ to: "ADMINS", kind: "DOMAIN_LAPSED", payload: data }],
          });
        });
      }
    },
  };
}
```

(imports for `jobs.ts`: `actions as orgActions` from `../../document-models/renown-organization/index.js`, `proveDomain` from `./core/domain-proof.js`.)

In `subgraphs/renown-orgs/resolvers.ts` import `domainResolvers` from `./areas/domains.js` and append it to `AREAS`.

- [ ] **Step 6: Run the tests, types and lint**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass.

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-orgs
git commit -m "feat(orgs): domain verification with SSRF-guarded proofs, daily re-checks and recovery"
```

---

### Task 4: OrgPolicy, and org service accounts in renown-workload

**Files:**
- Create: `subgraphs/renown-orgs/core/org-policy.ts`, `subgraphs/renown-orgs/store/foreign.ts`, `subgraphs/renown-orgs/areas/workloads.ts`
- Modify: `subgraphs/renown-orgs/schema-security.ts` (`WORKLOADS_SDL`), `resolvers.ts`, `tests/harness.ts` (renown-workload namespace)
- Modify: `subgraphs/renown-workload/store/{migrations,types,kysely}.ts`, `core/types.ts`, `registry.ts`, `resolvers.ts`, `schema.ts`, `http/handlers.ts`, `index.ts`
- Test: `subgraphs/renown-orgs/tests/org-policy.test.ts`, `subgraphs/renown-orgs/tests/workloads.test.ts`, `subgraphs/renown-workload/tests/org-workloads.test.ts`, `subgraphs/renown-workload/tests/store-contract.ts` (append)

**Interfaces:**
- Consumes: A1 store schema and lookups (`isMissingNamespace`, `jsonValue`), `roleAtLeast`, `orgDid`, `loadOrgsConfig`.
- Produces:
  - `core/org-policy.ts`: `interface OrgAppInfo { orgId; frozen }`, `interface OrgPublisherSummary { id; did; handle; name; verifiedDomains }`, `interface OrgPolicy { orgOfApp(appDid); activeRole(orgId, address); coversApp(orgId, address, appDid); orgSummary(orgId); orgIdOfDid(did); orgDid(orgId); attachApp(orgId, appDid, actor, at) }`, `createOrgPolicy(db: ReadModelDb, didHost: string): OrgPolicy`, `parseOrgDid(did): string | null`. Task 6 adds `credentialStatus`.
  - `store/foreign.ts`: `WORKLOAD_NAMESPACE`, `interface OrgWorkloadRecord`, `workloadsOfOrg(db, orgId)`, `setWorkloadDisabled(db, orgId, did, disabled, now)`. Tasks 5–8 add stats and credential readers here.
  - renown-workload: column `owner_org_id text null`, `disabled boolean not null default false`; `WorkloadIdentity.ownerOrgId?: string | null`, `disabled?: boolean`; `RegisterWorkloadIdentityInput.ownerOrgId?: string | null`; `RegistryDeps.orgPolicy?: Pick<OrgPolicy, "activeRole">`; `WorkloadRegistryErrorCode` gains `"FORBIDDEN"`; resolver deps `orgPolicy?: () => Pick<OrgPolicy, "activeRole" | "orgOfApp">`; `ExchangeDeps.orgPolicy?: Pick<OrgPolicy, "orgOfApp">`; GraphQL `WorkloadIdentity.ownerOrgId: String`, `WorkloadIdentity.disabled: Boolean!`, `RegisterWorkloadIdentityInput.ownerOrgId: String`.
  - renown-orgs GraphQL: `type OrgWorkload`, `orgWorkloads`, `setOrgWorkloadDisabled`.

- [ ] **Step 1: Write the failing tests**

In `subgraphs/renown-orgs/tests/harness.ts` add `import { migrate as migrateWorkload } from "../../renown-workload/store/migrations.js";`, `export const WORKLOAD_NS = "renown-workload";`, create and migrate it in `openHarness` (after the credential namespace):

```ts
  await sql`create schema ${sql.id(WORKLOAD_NS)}`.execute(root);
  await migrateWorkload(root.withSchema(WORKLOAD_NS));
```

add `WORKLOAD_NS` to the schema list in `resetHarness`, and append:

```ts
/** A workload identity row as renown-workload stores it. */
export async function insertWorkload(
  h: Harness,
  row: { did: string; owner: string; ownerOrgId?: string | null; disabled?: boolean; repositoryId?: string },
): Promise<void> {
  await h.root
    .withSchema(WORKLOAD_NS)
    .insertInto("workload_identities")
    .values({
      did: row.did,
      provider: "github",
      repository_id: row.repositoryId ?? row.did.slice(-12),
      repository: "acme/app",
      production_branch: "main",
      owner_address: row.owner,
      chain_id: 1,
      encrypted_key_pair: "sealed",
      created_at: T0,
      updated_at: T0,
      owner_org_id: row.ownerOrgId ?? null,
      disabled: row.disabled ?? false,
    })
    .execute();
}
```

Create `subgraphs/renown-orgs/tests/org-policy.test.ts`:

```ts
import type { IRelationalDb } from "@powerhousedao/reactor-browser";
import { PGlite } from "@electric-sql/pglite";
import { Kysely } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createOrgPolicy, parseOrgDid } from "../core/org-policy.js";
import type { OrgTeamOutput } from "../output.js";
import { ALICE, BOB, CAROL, DAVE, createOrg, harnessResolvers, join, lower, openHarness, resetHarness, T0, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP_A = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const APP_B = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

describe("OrgPolicy", () => {
  it("knows org apps, roles, scopes (own and teams) and summaries", async () => {
    const t = harnessResolvers(h);
    const policy = createOrgPolicy(h.relationalDb, "renown.test");
    const { id } = await createOrg(t, ALICE, "acme", { name: "Acme" });
    await join(t, id, BOB, "PUBLISHER");
    await join(t, id, CAROL, "MEMBER");
    const later = new Date(T0.getTime() + 1000);
    expect(await policy.attachApp(id, APP_A, lower(ALICE), later)).toBe(true);
    expect(await policy.attachApp("other", APP_A, lower(ALICE), later)).toBe(false);
    expect(await policy.orgOfApp(APP_A)).toEqual({ orgId: id, frozen: false });
    expect(await policy.orgOfApp(APP_B)).toBeNull();
    expect((await t.store.auditPage(id, 1))[0]).toMatchObject({ action: "attachApp", actor: lower(ALICE), details: { appDid: APP_A } });
    expect(await policy.activeRole(id, BOB.address)).toBe("PUBLISHER");
    expect(await policy.activeRole(id, DAVE.address)).toBeNull();
    expect(await policy.coversApp(id, lower(ALICE), APP_B)).toBe(true);
    expect(await policy.coversApp(id, lower(BOB), APP_B)).toBe(false);
    const team = await t.mutate<OrgTeamOutput>("createOrgTeam", { orgId: id, slug: "b", name: "B", appDids: [APP_B] }, ALICE);
    await t.mutate("setOrgTeamMembers", { orgId: id, teamId: team.id, addresses: [BOB.address, CAROL.address] }, ALICE);
    expect(await policy.coversApp(id, lower(BOB), APP_B)).toBe(true);
    expect(await policy.coversApp(id, lower(CAROL), APP_B)).toBe(false);
    expect(await policy.orgSummary(id)).toEqual({ id, did: `did:web:renown.test:org:${id}`, handle: "acme", name: "Acme", verifiedDomains: [] });
    await t.store.updateOrganization(id, { takenDown: true }, T0);
    expect(await policy.orgSummary(id)).toBeNull();
    expect(await policy.activeRole(id, lower(BOB))).toBeNull();
    expect(await policy.coversApp(id, lower(ALICE), APP_A)).toBe(false);
  });

  it("parses org DIDs of any host", () => {
    expect(parseOrgDid("did:web:www.renown.id:org:abc-123")).toBe("abc-123");
    expect(parseOrgDid("did:web:localhost%3A3000:org:x")).toBe("x");
    expect(parseOrgDid("did:pkh:eip155:1:0x1")).toBeNull();
    expect(createOrgPolicy(h.relationalDb, "renown.test").orgDid("abc")).toBe("did:web:renown.test:org:abc");
  });

  it("reads a missing renown-orgs namespace as no organizations", async () => {
    const empty = new Kysely<any>({ dialect: new PGliteDialect(new PGlite()) });
    const policy = createOrgPolicy({ queryNamespace: (ns: string) => empty.withSchema(ns) } as unknown as IRelationalDb<unknown>, "renown.test");
    expect(await policy.orgOfApp(APP_A)).toBeNull();
    expect(await policy.activeRole("o", lower(ALICE))).toBeNull();
    expect(await policy.coversApp("o", lower(ALICE), APP_A)).toBe(false);
    expect(await policy.orgSummary("o")).toBeNull();
    expect(await policy.attachApp("o", APP_A, lower(ALICE), T0)).toBe(false);
    await empty.destroy();
  });
});
```

Create `subgraphs/renown-orgs/tests/workloads.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALICE, BOB, createOrg, failure, harnessResolvers, insertWorkload, join, lower, openHarness, resetHarness, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP_A = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const APP_B = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

describe("org service accounts", () => {
  it("lists the org's workload identities and lets admins disable and enable them", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    const other = await createOrg(t, BOB, "other");
    await insertWorkload(h, { did: APP_A, owner: ALICE.address, ownerOrgId: id });
    await insertWorkload(h, { did: APP_B, owner: BOB.address, ownerOrgId: other.id });
    expect(await t.query("orgWorkloads", { orgId: id }, ALICE)).toEqual([
      { did: APP_A, repository: "acme/app", productionBranch: "main", ownerAddress: ALICE.address, disabled: false, createdAt: "2026-10-12T12:00:00.000Z" },
    ]);
    expect(await t.mutate("setOrgWorkloadDisabled", { orgId: id, did: APP_A, disabled: true }, ALICE)).toMatchObject({ did: APP_A, disabled: true });
    expect((await h.root.withSchema("renown-workload").selectFrom("workload_identities").select("disabled").where("did", "=", APP_A).executeTakeFirstOrThrow()).disabled).toBe(true);
    expect((await failure(t.mutate("setOrgWorkloadDisabled", { orgId: id, did: APP_B, disabled: true }, ALICE))).code).toBe("NOT_FOUND");
    await join(t, id, BOB, "PUBLISHER");
    expect((await failure(t.query("orgWorkloads", { orgId: id }, BOB))).code).toBe("FORBIDDEN");
    expect((await t.store.auditPage(id, 1))[0]).toMatchObject({ action: "setOrgWorkloadDisabled", actor: lower(ALICE) });
  });
});
```

Create `subgraphs/renown-workload/tests/org-workloads.test.ts`:

```ts
import { GraphQLError } from "graphql";
import { getAddress } from "viem";
import { beforeEach, describe, expect, it } from "vitest";
import type { WorkloadConfig } from "../core/types.js";
import { createGithubVerifier } from "../core/github.js";
import { DEFAULT_AUDIENCES } from "../core/config.js";
import { createTokenHandler } from "../http/handlers.js";
import { createResolvers, REGISTRATION_TOKEN_HEADER } from "../resolvers.js";
import { MemoryWorkloadStore } from "../store/memory.js";
import { githubJwks, githubToken, pushClaims, REPOSITORY_ID } from "./github-fixture.js";

type Resolver = (parent: unknown, args: unknown, ctx: unknown) => Promise<unknown>;
const OWNER = getAddress("0xabcdef0123456789abcdef0123456789abcdef01");
const authorized = { headers: { [REGISTRATION_TOKEN_HEADER]: "right-token" } };
const config: WorkloadConfig = { encryptionKey: new Uint8Array(32).fill(5), registrationToken: "right-token", audiences: DEFAULT_AUDIENCES };
let store: MemoryWorkloadStore;
const policy = { roles: new Map<string, string>(), frozen: new Set<string>() };
const orgPolicy = () => ({
  activeRole: (orgId: string, address: string) => Promise.resolve((policy.roles.get(`${orgId}:${address.toLowerCase()}`) ?? null) as never),
  orgOfApp: (appDid: string) => Promise.resolve(policy.frozen.has(appDid) ? { orgId: "o1", frozen: true } : null),
});

function resolver(type: "Query" | "Mutation", field: string): Resolver {
  return (createResolvers({ config: () => config, store: () => store, orgPolicy, statsAudience: () => "https://stats.example" }) as Record<string, Record<string, Resolver>>)[type][field];
}

const register = (ownerOrgId?: string) =>
  resolver("Mutation", "registerWorkloadIdentity")(
    null,
    { input: { repositoryId: REPOSITORY_ID, repository: "acme/shop", productionBranch: "main", ownerAddress: OWNER, chainId: 1, ownerOrgId } },
    authorized,
  ) as Promise<{ did: string; ownerOrgId: string | null; disabled: boolean }>;

async function code(promise: Promise<unknown>): Promise<unknown> {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(GraphQLError);
  return (error as GraphQLError).extensions.code;
}

beforeEach(() => {
  store = new MemoryWorkloadStore();
  policy.roles.clear();
  policy.frozen.clear();
});

describe("org-owned workload identities", () => {
  it("registers for an organization only when the owner is a publisher there", async () => {
    expect(await code(register("o1"))).toBe("FORBIDDEN");
    policy.roles.set(`o1:${OWNER.toLowerCase()}`, "MEMBER");
    expect(await code(register("o1"))).toBe("FORBIDDEN");
    policy.roles.set(`o1:${OWNER.toLowerCase()}`, "PUBLISHER");
    expect(await register("o1")).toMatchObject({ ownerOrgId: "o1", disabled: false });
  });

  it("issues no tokens for a disabled identity or a frozen app", async () => {
    const { did } = await register();
    const stored = await store.getByDid(did);
    const issue = () => resolver("Mutation", "issueAppStatsToken")(null, { did }, authorized);
    await expect(issue()).resolves.toMatchObject({ audience: "https://stats.example" });
    policy.frozen.add(did);
    expect(await code(issue())).toBe("FORBIDDEN");
    policy.frozen.clear();
    store = new MemoryWorkloadStore();
    await store.insert({ ...stored!, disabled: true });
    expect(await code(issue())).toBe("FORBIDDEN");
    const handler = createTokenHandler(() => ({
      store,
      encryptionKey: config.encryptionKey!,
      audiences: DEFAULT_AUDIENCES,
      verifier: createGithubVerifier({ fetchJwks: githubJwks }),
      orgPolicy: orgPolicy(),
      log: () => undefined,
    }));
    const response = await handler(
      new Request("https://sb.example/workload/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ subject_token: await githubToken(pushClaims("refs/heads/main")), audience: "https://registry.dev.vetra.io" }),
      }),
    );
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error_description: string }).error_description).toMatch(/disabled/);
  });
});
```

Append inside `describeWorkloadStoreContract` in `subgraphs/renown-workload/tests/store-contract.ts`:

```ts
    it("keeps the owning organization and the disabled flag, omitting them when unset", async () => {
      const store = await makeStore();
      await store.insert({ ...identity("did:key:org", "9"), ownerOrgId: "o1", disabled: true });
      expect(await store.getByDid("did:key:org")).toEqual({ ...identity("did:key:org", "9"), ownerOrgId: "o1", disabled: true });
      await store.insert(identity("did:key:plain", "10"));
      expect(await store.getByDid("did:key:plain")).toEqual(identity("did:key:plain", "10"));
    });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs subgraphs/renown-workload 2>&1 | grep -E "Tests |FAIL" | head -8`
Expected: `owner_org_id` is not a column (harness insert), `../core/org-policy.js` missing, workload tests fail.

- [ ] **Step 3: renown-workload columns and types**

Append to `migrate()` in `subgraphs/renown-workload/store/migrations.ts` (and change its import to `import { sql, type Kysely } from "kysely";` if `sql` is needed — it is not here):

```ts
  // Organisations: the owning org of a service account, and an admin kill switch.
  // Probe first: ADD COLUMN IF NOT EXISTS still takes an ACCESS EXCLUSIVE lock.
  const hasOrgColumns = await db
    .selectFrom("workload_identities")
    .select(["owner_org_id", "disabled"])
    .limit(0)
    .execute()
    .then(
      () => true,
      () => false,
    );
  if (!hasOrgColumns) {
    await db.schema.alterTable("workload_identities").addColumn("owner_org_id", "text", (col) => col.ifNotExists()).execute();
    await db.schema
      .alterTable("workload_identities")
      .addColumn("disabled", "boolean", (col) => col.ifNotExists().notNull().defaultTo(false))
      .execute();
    await db.schema.createIndex("workload_identities_owner_org").ifNotExists().on("workload_identities").column("owner_org_id").execute();
  }
```

`subgraphs/renown-workload/store/types.ts`, `WorkloadIdentityRow` gains:

```ts
  /** The organisation that owns this service account, or null. */
  owner_org_id: ColumnType<string | null, string | null | undefined, string | null>;
  disabled: ColumnType<boolean, boolean | undefined, boolean>;
```

`subgraphs/renown-workload/core/types.ts`, `WorkloadIdentity` gains (optional so stored fixtures stay equal):

```ts
  /** The organisation that owns this identity; absent for person-owned identities. */
  ownerOrgId?: string | null;
  /** Set by an org admin: no tokens are issued. Absent means enabled. */
  disabled?: boolean;
```

`subgraphs/renown-workload/store/kysely.ts`: `toIdentity` returns `{ ...current fields, ...(row.owner_org_id ? { ownerOrgId: row.owner_org_id } : {}), ...(row.disabled ? { disabled: true } : {}) }`, and `insert` adds `owner_org_id: identity.ownerOrgId ?? null, disabled: identity.disabled ?? false` to its values.

- [ ] **Step 4: OrgPolicy and the cross-namespace workload access**

Create `subgraphs/renown-orgs/core/org-policy.ts`:

```ts
import { generateId } from "document-model";
import { roleAtLeast } from "../../../sdk/orgs.js";
import type { ReadModelDb } from "../../renown-auth/lookups.js";
import { jsonValue } from "../store/kysely.js";
import { isMissingNamespace } from "../store/lookups.js";
import { ORGS_NAMESPACE, type OrgRole, type OrgsDB } from "../store/types.js";
import { orgDid } from "./config.js";

const ORG_DID_RE = /^did:web:[^:]+:org:([A-Za-z0-9_-]{1,128})$/;

export interface OrgAppInfo {
  orgId: string;
  frozen: boolean;
}

export interface OrgPublisherSummary {
  id: string;
  did: string;
  handle: string;
  name: string;
  verifiedDomains: string[];
}

/** How other subgraphs see organisations. Never throws for a missing namespace (no organisations). */
export interface OrgPolicy {
  /** The organisation owning `appDid` and whether it froze it; null for person-owned apps. */
  orgOfApp(appDid: string): Promise<OrgAppInfo | null>;
  /** The ACTIVE role of `address` in a live organisation, else null. */
  activeRole(orgId: string, address: string): Promise<OrgRole | null>;
  /** ACTIVE PUBLISHER+ in a live organisation whose own or team scope (ALL for owners and admins) covers `appDid`. */
  coversApp(orgId: string, address: string, appDid: string): Promise<boolean>;
  /** Public card of a live organisation, null when unknown or taken down. */
  orgSummary(orgId: string): Promise<OrgPublisherSummary | null>;
  orgIdOfDid(did: string): string | null;
  orgDid(orgId: string): string;
  /** Records `appDid` as an app of `orgId` (with an audit row by `actor`); false when it already belongs to an organisation. */
  attachApp(orgId: string, appDid: string, actor: string, at: Date): Promise<boolean>;
}

/** The organisation id in did:web:<host>:org:<id>, or null. */
export function parseOrgDid(did: string): string | null {
  return ORG_DID_RE.exec(did.trim())?.[1] ?? null;
}

function stringList(value: unknown): string[] {
  const list = jsonValue<unknown>(value, []);
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

async function orEmpty<T>(fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isMissingNamespace(error)) return fallback;
    throw error;
  }
}

export function createOrgPolicy(db: ReadModelDb, didHost: string): OrgPolicy {
  const orgs = () => db.queryNamespace<OrgsDB>(ORGS_NAMESPACE);

  async function activeMember(orgId: string, address: string) {
    return orgs()
      .selectFrom("org_members")
      .innerJoin("organizations", "organizations.id", "org_members.org_id")
      .select(["org_members.id", "org_members.role", "org_members.app_scope_all", "org_members.app_dids"])
      .where("org_members.org_id", "=", orgId)
      .where("org_members.address", "=", address.toLowerCase())
      .where("org_members.status", "=", "ACTIVE")
      .where("organizations.archived", "=", false)
      .where("organizations.taken_down", "=", false)
      .executeTakeFirst();
  }

  return {
    orgOfApp: (appDid) =>
      orEmpty(null, async () => {
        const row = await orgs().selectFrom("org_apps").select(["org_id", "frozen"]).where("app_did", "=", appDid).executeTakeFirst();
        return row ? { orgId: row.org_id, frozen: row.frozen } : null;
      }),
    activeRole: (orgId, address) => orEmpty(null, async () => (await activeMember(orgId, address))?.role ?? null),
    coversApp: (orgId, address, appDid) =>
      orEmpty(false, async () => {
        const member = await activeMember(orgId, address);
        if (!member || !roleAtLeast(member.role, "PUBLISHER")) return false;
        if (member.role === "OWNER" || member.role === "ADMIN" || member.app_scope_all) return true;
        if (stringList(member.app_dids).includes(appDid)) return true;
        const teams = await orgs()
          .selectFrom("org_team_members")
          .innerJoin("org_teams", "org_teams.id", "org_team_members.team_id")
          .select("org_teams.app_dids")
          .where("org_team_members.member_id", "=", member.id)
          .execute();
        return teams.some((team) => stringList(team.app_dids).includes(appDid));
      }),
    orgSummary: (orgId) =>
      orEmpty(null, async () => {
        const org = await orgs()
          .selectFrom("organizations")
          .select(["id", "handle", "name"])
          .where("id", "=", orgId)
          .where("taken_down", "=", false)
          .executeTakeFirst();
        if (!org) return null;
        const domains = await orgs()
          .selectFrom("org_domains")
          .select("domain")
          .where("org_id", "=", orgId)
          .where("status", "=", "VERIFIED")
          .orderBy("domain")
          .execute();
        return { id: org.id, did: orgDid(didHost, org.id), handle: org.handle, name: org.name, verifiedDomains: domains.map((d) => d.domain) };
      }),
    orgIdOfDid: parseOrgDid,
    orgDid: (orgId) => orgDid(didHost, orgId),
    attachApp: (orgId, appDid, actor, at) =>
      orEmpty(false, async () => {
        const inserted = await orgs()
          .insertInto("org_apps")
          .values({ app_did: appDid, org_id: orgId, frozen: false, added_at: at })
          .onConflict((oc) => oc.column("app_did").doNothing())
          .returning("app_did")
          .executeTakeFirst();
        if (!inserted) return false;
        await orgs()
          .insertInto("org_audit")
          .values({ id: generateId(), org_id: orgId, at, actor, action: "attachApp", details: JSON.stringify({ appDid }) })
          .execute();
        return true;
      }),
  };
}

```

Create `subgraphs/renown-orgs/store/foreign.ts`:

```ts
import type { ReadModelDb } from "../../renown-auth/lookups.js";
import type { WorkloadDB } from "../../renown-workload/store/types.js";
import { toDate } from "./kysely.js";

/**
 * Reads and writes of other subgraphs' namespaces done on behalf of
 * organisations (renown-workload here; Tasks 5–8 add renown-stats and the
 * credential read model).
 */
export const WORKLOAD_NAMESPACE = "renown-workload";

export interface OrgWorkloadRecord {
  did: string;
  repository: string;
  productionBranch: string;
  ownerAddress: string;
  disabled: boolean;
  createdAt: Date;
}

function workloads(db: ReadModelDb) {
  return db.queryNamespace<WorkloadDB>(WORKLOAD_NAMESPACE);
}

function toWorkload(row: {
  did: string;
  repository: string;
  production_branch: string;
  owner_address: string;
  disabled: boolean;
  created_at: Date | string;
}): OrgWorkloadRecord {
  return {
    did: row.did,
    repository: row.repository,
    productionBranch: row.production_branch,
    ownerAddress: row.owner_address,
    disabled: row.disabled,
    createdAt: toDate(row.created_at),
  };
}

/** The workload identities owned by `orgId`, oldest first. */
export async function workloadsOfOrg(db: ReadModelDb, orgId: string): Promise<OrgWorkloadRecord[]> {
  const rows = await workloads(db)
    .selectFrom("workload_identities")
    .select(["did", "repository", "production_branch", "owner_address", "disabled", "created_at"])
    .where("owner_org_id", "=", orgId)
    .orderBy("created_at")
    .orderBy("did")
    .execute();
  return rows.map(toWorkload);
}

/** Enables or disables an identity owned by `orgId`; undefined when it is not one of the org's. */
export async function setWorkloadDisabled(
  db: ReadModelDb,
  orgId: string,
  did: string,
  disabled: boolean,
  now: Date,
): Promise<OrgWorkloadRecord | undefined> {
  const row = await workloads(db)
    .updateTable("workload_identities")
    .set({ disabled, updated_at: now })
    .where("did", "=", did)
    .where("owner_org_id", "=", orgId)
    .returning(["did", "repository", "production_branch", "owner_address", "disabled", "created_at"])
    .executeTakeFirst();
  return row && toWorkload(row);
}
```

- [ ] **Step 5: renown-orgs resolvers and SDL**

Add to `subgraphs/renown-orgs/schema-security.ts` and to `SECURITY_SDL`:

```ts
export const WORKLOADS_SDL = `
  type OrgWorkload {
    did: String!
    repository: String!
    productionBranch: String!
    ownerAddress: String!
    disabled: Boolean!
    createdAt: String!
  }

  extend type Query {
    "Admins: the organisation's service accounts (workload identities)."
    orgWorkloads(orgId: String!, auth: OrgAuthInput): [OrgWorkload!]!
  }

  extend type Mutation {
    "Admins: a disabled identity gets no tokens."
    setOrgWorkloadDisabled(orgId: String!, did: String!, disabled: Boolean!, auth: OrgAuthInput): OrgWorkload!
  }
`;
```

Create `subgraphs/renown-orgs/areas/workloads.ts`:

```ts
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { notFound, unavailable } from "../core/errors.js";
import { iso } from "../output.js";
import type { Area } from "../runtime.js";
import { setWorkloadDisabled, workloadsOfOrg, type OrgWorkloadRecord } from "../store/foreign.js";

function workloadOutput(w: OrgWorkloadRecord) {
  return { ...w, createdAt: iso(w.createdAt) };
}

export const workloadResolvers: Area = (rt) => ({
  Query: {
    orgWorkloads: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "orgWorkloads", args);
      const store = rt.store();
      await requireOrg(store, args.orgId, { writable: false });
      await requireRole(store, args.orgId, caller, "ADMIN");
      try {
        return (await workloadsOfOrg(rt.deps.relationalDb, args.orgId)).map(workloadOutput);
      } catch {
        throw unavailable("Workload identities cannot be read right now");
      }
    },
  },
  Mutation: {
    setOrgWorkloadDisabled: async (_: unknown, args: OrgArgs & { orgId: string; did: string; disabled: boolean }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "setOrgWorkloadDisabled", args);
      return rt.lock(`org:${args.orgId}`, async () => {
        const store = rt.store();
        const now = rt.now();
        await requireOrg(store, args.orgId);
        await requireRole(store, args.orgId, caller, "ADMIN");
        const updated = await setWorkloadDisabled(rt.deps.relationalDb, args.orgId, args.did, args.disabled, now);
        if (!updated) throw notFound("Workload identity");
        await rt.record({ orgId: args.orgId, actor: caller, action: "setOrgWorkloadDisabled", at: now, details: { did: args.did, disabled: args.disabled } });
        return workloadOutput(updated);
      });
    },
  },
});
```

Register `workloadResolvers` in `AREAS` (`subgraphs/renown-orgs/resolvers.ts`).

- [ ] **Step 6: renown-workload registration, tokens and SDL**

`subgraphs/renown-workload/registry.ts`:
- `WorkloadRegistryErrorCode` adds `| "FORBIDDEN"`.
- `RegistryDeps` adds `orgPolicy?: Pick<OrgPolicy, "activeRole">;` (import `type OrgPolicy` from `../renown-orgs/core/org-policy.js`, and `roleAtLeast` from `../../sdk/orgs.js`).
- `RegisterWorkloadIdentityInput` adds `ownerOrgId?: string | null;`.
- `validateInput` returns `...(input.ownerOrgId ? { ownerOrgId: input.ownerOrgId.trim() } : {})` in its result object.
- In `registerWorkloadIdentity`, right after `const input = validateInput(rawInput);`:

```ts
  if (input.ownerOrgId) {
    const role = await deps.orgPolicy?.activeRole(input.ownerOrgId, input.ownerAddress);
    if (!role || !roleAtLeast(role, "PUBLISHER")) {
      throw new WorkloadRegistryError("ownerAddress must be an active publisher of ownerOrgId", "FORBIDDEN");
    }
  }
```

(the stored identity carries `ownerOrgId` through `...input`; re-registering an existing repository returns it unchanged).

`subgraphs/renown-workload/resolvers.ts`:
- `ResolverDeps` adds `orgPolicy?: () => Pick<OrgPolicy, "activeRole" | "orgOfApp">;`.
- `authorized()` returns `orgPolicy: deps.orgPolicy?.()` in the registry deps.
- `output()` becomes:

```ts
function output(identity: WorkloadIdentity): WorkloadIdentityOutput {
  const { createdAt, updatedAt: _updatedAt, ownerOrgId, disabled, ...rest } = identity;
  return { ...rest, ownerOrgId: ownerOrgId ?? null, disabled: disabled === true, createdAt: createdAt.toISOString() };
}
```

(with `WorkloadIdentityOutput` = `Omit<WorkloadIdentity, "createdAt" | "updatedAt" | "ownerOrgId" | "disabled"> & { ownerOrgId: string | null; disabled: boolean; createdAt: string }`).
- In `issueAppStatsToken`, after `if (!identity) { ... }`:

```ts
        // A disabled service account, or an app its organisation froze, gets no tokens.
        if (identity.disabled || (await deps.orgPolicy?.().orgOfApp(identity.did))?.frozen) {
          throw new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } });
        }
```

`subgraphs/renown-workload/schema.ts`: `WorkloadIdentity` gains

```graphql
    "The owning organisation, when registered for one"
    ownerOrgId: String
    "Disabled by an organisation admin: no tokens"
    disabled: Boolean!
```

and `RegisterWorkloadIdentityInput` gains `"Register for this organisation (ownerAddress must be a publisher there)" ownerOrgId: String`.

`subgraphs/renown-workload/http/handlers.ts`: `ExchangeDeps` adds `orgPolicy?: Pick<OrgPolicy, "orgOfApp">;`, and after the repository check:

```ts
    if (identity.disabled) {
      return denied("The workload identity is disabled by its organisation");
    }
    if ((await d.orgPolicy?.orgOfApp(identity.did))?.frozen) {
      return denied("The app is frozen by its organisation");
    }
```

`subgraphs/renown-workload/index.ts`: import `createOrgPolicy` (`../renown-orgs/core/org-policy.js`), `loadOrgsConfig` (`../renown-orgs/core/config.js`) and `type ReadModelDb` (`../renown-auth/lookups.js`); add a lazily created policy

```ts
  #orgPolicy: OrgPolicy | undefined;
  #getOrgPolicy(): OrgPolicy {
    return (this.#orgPolicy ??= createOrgPolicy(this.relationalDb as unknown as ReadModelDb, loadOrgsConfig(process.env).didHost));
  }
```

pass `orgPolicy: () => this.#getOrgPolicy()` to `createResolvers` and `orgPolicy: this.#getOrgPolicy()` in `#exchangeDeps()`.

- [ ] **Step 7: Run the suites, types, lint**

Run: `pnpm vitest run subgraphs/renown-orgs subgraphs/renown-workload subgraphs/renown-stats 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass (renown-stats' harness migrates renown-workload, which now has the two columns; its fixtures leave them at their defaults).

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add subgraphs/renown-orgs subgraphs/renown-workload
git commit -m "feat(orgs): org policy and org service accounts (owner org, disable, no tokens when frozen)"
```

---

### Task 5: Org-owned apps in renown-stats (publisher org, first claims, filters, frozen)

**Files:**
- Modify: `document-models/renown-app-profile/v1/src/utils.ts` (`isPublisherDid`), `document-models/renown-app-profile/v1/tests/profile.test.ts` (append)
- Modify: `subgraphs/renown-stats/store/{migrations,types,kysely}.ts`, `lookups.ts`, `resolvers.ts`, `schema.ts`, `tests/harness.ts`, `tests/resolvers.test.ts` (one expectation)
- Test: `subgraphs/renown-stats/tests/org-apps.test.ts`, `subgraphs/renown-stats/tests/store.test.ts` (append)

**Interfaces:**
- Consumes: Task 4 `OrgPolicy` (`orgOfApp`, `coversApp`, `orgSummary`, `orgIdOfDid`, `orgDid`, `attachApp`), `createOrgPolicy`, `loadOrgsConfig`; renown-organization `actions.addOrgApp`.
- Produces:
  - `isPublisherDid` accepts `did:pkh:eip155:<chain>:<address>` and org DIDs `did:web:<host>:org:<id>`.
  - renown-stats: column `app_profile_documents.publisher_org_id text null` (+ index); `AppProfileEntry.publisherOrgId?: string` (present only for org apps); `StatsIndex.appProfilesPage(limit, after?, category?, orgId?)`, `StatsIndex.appProfilesByOrg(orgId)`; `lookups.ts`: `workloadIdentityOwner(db, appDid): Promise<{ ownerAddress: string; ownerOrgId: string | null } | undefined>`; `StatsResolverDeps.orgPolicy?: () => OrgPolicy`; GraphQL `type AppPublisherOrg`, `AppProfile.publisherOrg`, `AppProfile.frozen`, `appProfiles(..., orgId: String)`, `upsertAppProfile(..., publisherOrgId: String)`, error code `APP_FROZEN`.

- [ ] **Step 1: Write the failing tests**

Append to `document-models/renown-app-profile/v1/tests/profile.test.ts`:

```ts
describe("publisher DIDs", () => {
  it("accepts organisation did:web publishers", () => {
    let d = reducer(utils.createDocument(), setPublisherDid({ publisherDid: "did:web:www.renown.id:org:abc-123" }));
    expect(d.state.global.publisherDid).toBe("did:web:www.renown.id:org:abc-123");
    d = reducer(d, setPublisherDid({ publisherDid: "did:web:evil.example" }));
    expect(d.operations.global[1].error).toBe("Invalid publisher DID: did:web:evil.example");
    expect(isPublisherDid("did:web:localhost%3A3000:org:x")).toBe(true);
  });
});
```

Append inside the first `describe` of `subgraphs/renown-stats/tests/store.test.ts`:

```ts
  it("records the publishing organisation, lists and pages an organisation's apps", async () => {
    const index = await makeIndex();
    await index.claimAppProfile({ appDid: "did:org-app", documentId: "p-1", publisherAddress: ALICE, publisherOrgId: "o1" }, NOW);
    await index.claimAppProfile({ appDid: "did:person-app", documentId: "p-2", publisherAddress: ALICE }, LATER);
    expect(await index.appProfile("did:org-app")).toEqual({ appDid: "did:org-app", documentId: "p-1", publisherAddress: ALICE, publisherOrgId: "o1" });
    expect(await index.appProfile("did:person-app")).toEqual({ appDid: "did:person-app", documentId: "p-2", publisherAddress: ALICE });
    expect((await index.appProfilesByOrg("o1")).map((e) => e.appDid)).toEqual(["did:org-app"]);
    expect((await index.appProfilesPage(10, undefined, undefined, "o1")).map((e) => e.appDid)).toEqual(["did:org-app"]);
    expect((await index.appProfilesPage(10)).map((e) => e.appDid)).toEqual(["did:person-app", "did:org-app"]);
  });
```

In `subgraphs/renown-stats/tests/harness.ts`, `harnessResolvers` accepts `orgPolicy` and passes it on: change its options type to `{ now?: () => Date; relationalDb?: IRelationalDb<unknown>; orgPolicy?: StatsResolverDeps["orgPolicy"] }` and add `orgPolicy: options.orgPolicy,` to the `createResolvers` deps.

Create `subgraphs/renown-stats/tests/org-apps.test.ts`:

```ts
import { sql } from "kysely";
import { getAddress } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createOrgPolicy } from "../../renown-orgs/core/org-policy.js";
import { KyselyOrgStore } from "../../renown-orgs/store/kysely.js";
import { migrate as migrateOrgs } from "../../renown-orgs/store/migrations.js";
import { memberRecord, org } from "../../renown-orgs/tests/store-contract.js";
import { failure, harnessResolvers, OWNER, openHarness, registerApp, relayed, resetHarness, WORKLOAD_NS, type Harness } from "./harness.js";

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const PERSON_APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const BOB = "0xb0b0000000000000000000000000000000000002";
const CAROL = "0xca40000000000000000000000000000000000003";
let h: Harness;
let orgs: KyselyOrgStore;

beforeAll(async () => {
  h = await openHarness();
  await sql`create schema if not exists "renown-orgs"`.execute(h.root);
  await migrateOrgs(h.root.withSchema("renown-orgs"));
  orgs = new KyselyOrgStore(h.root.withSchema("renown-orgs"));
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
  for (const table of ["organizations", "org_members", "org_apps", "org_audit"] as const) await orgs.db.deleteFrom(table).execute();
  await orgs.insertOrganization(org("o1", "acme", { name: "Acme" }));
  await orgs.insertMember(memberRecord("m-owner", "o1", OWNER, { role: "OWNER", appScopeAll: true }));
  await orgs.insertMember(memberRecord("m-bob", "o1", BOB, { role: "PUBLISHER", appDids: [APP] }));
  await orgs.insertMember(memberRecord("m-carol", "o1", CAROL, { role: "PUBLISHER" }));
});

/** APP registered for organisation o1 (workload owner_org_id); PERSON_APP registered to OWNER. */
async function registerApps() {
  await registerApp(h, APP);
  await h.root.withSchema(WORKLOAD_NS).updateTable("workload_identities").set({ owner_org_id: "o1" }).where("did", "=", APP).execute();
  await registerApp(h, PERSON_APP);
}

function setup() {
  return harnessResolvers(h, { orgPolicy: () => createOrgPolicy(h.relationalDb, "renown.test") });
}

describe("org-owned apps", () => {
  it("lets a publisher whose scope covers the app claim an org workload for the organisation", async () => {
    await registerApps();
    const t = setup();
    expect(await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB))).toBe(true);
    expect(await t.appProfile(APP)).toMatchObject({
      name: "Acme App",
      publisherDid: "did:web:renown.test:org:o1",
      publisherOrg: { id: "o1", did: "did:web:renown.test:org:o1", handle: "acme", name: "Acme", verifiedDomains: [] },
      frozen: false,
    });
    expect(await orgs.orgOfApp(APP)).toMatchObject({ orgId: "o1", frozen: false });
    expect((await t.index.appProfile(APP))?.publisherOrgId).toBe("o1");
    expect((await t.appProfiles({ orgId: "o1" })).items.map((i) => i.appDid)).toEqual([APP]);
  });

  it("refuses outsiders, uncovered publishers, person claims of org workloads and org claims of person workloads", async () => {
    await registerApps();
    const t = setup();
    expect((await failure(t.upsert({ appDid: APP, name: "x", publisherOrgId: "o1" }, relayed("0xdead000000000000000000000000000000000004")))).code).toBe("FORBIDDEN");
    expect((await failure(t.upsert({ appDid: APP, name: "x", publisherOrgId: "o1" }, relayed(CAROL)))).code).toBe("FORBIDDEN");
    expect((await failure(t.upsert({ appDid: APP, name: "x" }, relayed(OWNER)))).code).toBe("FORBIDDEN");
    expect((await failure(t.upsert({ appDid: PERSON_APP, name: "x", publisherOrgId: "o1" }, relayed(OWNER)))).code).toBe("FORBIDDEN");
    expect(await t.upsert({ appDid: PERSON_APP, name: "Mine" }, relayed(OWNER))).toBe(true);
    expect(await failure(t.upsert({ appDid: PERSON_APP, name: "x", publisherOrgId: "o1" }, relayed(OWNER)))).toMatchObject({ code: "BAD_USER_INPUT", field: "publisherOrgId" });
    expect((await t.appProfile(PERSON_APP)) as Record<string, unknown>).toMatchObject({ publisherOrg: null, frozen: false });
  });

  it("lets covered publishers edit later, never a frozen app", async () => {
    await registerApps();
    const t = setup();
    await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB));
    expect(await t.upsert({ appDid: APP, tagline: "By Acme" }, relayed(OWNER))).toBe(true);
    expect((await failure(t.upsert({ appDid: APP, tagline: "Mine" }, relayed(CAROL)))).code).toBe("FORBIDDEN");
    await orgs.db.updateTable("org_apps").set({ frozen: true }).where("app_did", "=", APP).execute();
    expect((await failure(t.upsert({ appDid: APP, tagline: "Again" }, relayed(BOB)))).code).toBe("APP_FROZEN");
    expect(await t.appProfile(APP)).toMatchObject({ tagline: "By Acme", frozen: true });
  });

  it("finds an organisation's apps by its DID", async () => {
    await registerApps();
    const t = setup();
    await t.upsert({ appDid: APP, name: "Acme App", publisherOrgId: "o1" }, relayed(BOB));
    const byPublisher = (publisherDid: string) =>
      (t.resolvers as unknown as { Query: Record<string, (p: unknown, a: unknown, c: unknown) => Promise<{ appDid: string }[]>> }).Query.appProfilesByPublisher(null, { publisherDid }, {});
    expect((await byPublisher("did:web:www.renown.id:org:o1")).map((p) => p.appDid)).toEqual([APP]);
    expect((await byPublisher(`did:pkh:eip155:1:${getAddress(BOB)}`)).map((p) => p.appDid)).toEqual([APP]);
  });
});

```

The stats harness returns no `resolvers` today; add `resolvers,` to the object `harnessResolvers` returns, and widen the argument type of its `appProfiles` helper to `{ limit?: number | null; after?: string | null; category?: string | null; orgId?: string | null }`.

In `subgraphs/renown-stats/tests/resolvers.test.ts`, the `expected` object of "creates a profile and finds it by publisher …" (around line 594) gains two keys after `metrics: [],`:

```ts
      publisherOrg: null,
      frozen: false,
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run document-models/renown-app-profile subgraphs/renown-stats 2>&1 | grep -E "Tests |FAIL" | head -8`
Expected: the publisher-DID test, the store test and every org-apps test fail.

- [ ] **Step 3: Publisher DIDs**

In `document-models/renown-app-profile/v1/src/utils.ts` add `const ORG_DID = /^did:web:[^:]+:org:[A-Za-z0-9_-]{1,128}$/;` next to `DID_PKH` and change:

```ts
/** A person (did:pkh) or an organisation (did:web:<host>:org:<id>). */
export function isPublisherDid(value: string): boolean {
  return DID_PKH.test(value) || ORG_DID.test(value);
}
```

- [ ] **Step 4: renown-stats store**

Append to `migrate()` in `subgraphs/renown-stats/store/migrations.ts`:

```ts
  // Organisations: the org that publishes an org-owned app (null for person-owned apps).
  const hasPublisherOrg = await db
    .selectFrom("app_profile_documents")
    .select("publisher_org_id")
    .limit(0)
    .execute()
    .then(
      () => true,
      () => false,
    );
  if (!hasPublisherOrg) {
    await db.schema.alterTable("app_profile_documents").addColumn("publisher_org_id", "text", (col) => col.ifNotExists()).execute();
  }
  await db.schema
    .createIndex("app_profile_documents_publisher_org")
    .ifNotExists()
    .on("app_profile_documents")
    .column("publisher_org_id")
    .execute();
```

`subgraphs/renown-stats/store/types.ts`: `AppProfileDocumentRow` gains `publisher_org_id?: string | null;`; `AppProfileEntry` gains

```ts
  /** The publishing organisation of an org-owned app; absent for person-owned apps. */
  publisherOrgId?: string;
```

and `StatsIndex` changes `appProfilesPage(limit: number, after?: AppProfileCursor, category?: string, orgId?: string): Promise<AppProfileListEntry[]>;` and adds `appProfilesByOrg(orgId: string): Promise<AppProfileEntry[]>;` (oldest first).

`subgraphs/renown-stats/store/kysely.ts`: add

```ts
function entryOf(row: { app_did: string; document_id: string; publisher_address: string; publisher_org_id?: string | null }): AppProfileEntry {
  return {
    appDid: row.app_did,
    documentId: row.document_id,
    publisherAddress: row.publisher_address,
    ...(row.publisher_org_id ? { publisherOrgId: row.publisher_org_id } : {}),
  };
}
```

then: `appProfile` and `appProfilesByPublisher` select `"publisher_org_id"` too and map with `entryOf`; `claimAppProfile` inserts `publisher_org_id: entry.publisherOrgId ?? null`; `appProfilesPage` takes `orgId?: string`, selects `publisher_org_id`, adds `if (orgId !== undefined) query = query.where("publisher_org_id", "=", orgId);` and maps rows to `{ ...entryOf(row), createdAt: new Date(row.created_at) }`; and

```ts
  async appProfilesByOrg(orgId: string): Promise<AppProfileEntry[]> {
    const rows = await this.db
      .selectFrom("app_profile_documents")
      .select(["app_did", "document_id", "publisher_address", "publisher_org_id"])
      .where("publisher_org_id", "=", orgId)
      .orderBy("created_at", "asc")
      .orderBy("app_did", "asc")
      .execute();
    return rows.map(entryOf);
  }
```

`subgraphs/renown-stats/lookups.ts`: add

```ts
/** Owner of the registered workload identity `appDid`: lowercase address and owning organisation; undefined when unregistered. */
export async function workloadIdentityOwner(
  db: ReadModelDb,
  appDid: string,
): Promise<{ ownerAddress: string; ownerOrgId: string | null } | undefined> {
  const row = await db
    .queryNamespace<WorkloadDB>(WORKLOAD_NAMESPACE)
    .selectFrom("workload_identities")
    .select(["owner_address", "owner_org_id"])
    .where("did", "=", appDid)
    .executeTakeFirst();
  return row && { ownerAddress: row.owner_address.toLowerCase(), ownerOrgId: row.owner_org_id ?? null };
}
```

- [ ] **Step 5: renown-stats resolvers and SDL**

`subgraphs/renown-stats/resolvers.ts`:
- imports: `createOrgPolicy, type OrgPolicy` (`../renown-orgs/core/org-policy.js`), `loadOrgsConfig` (`../renown-orgs/core/config.js`), `actions as orgActions` (`../../document-models/renown-organization/index.js`), `workloadIdentityOwner` (with the other `./lookups.js` imports).
- `StatsResolverDeps` adds `/** Organisation rules; defaults to a policy over the host's relational db. */ orgPolicy?: () => OrgPolicy;`.
- `UpsertAppProfileArgs` adds `publisherOrgId?: string | null;`.
- `AppProfileOutput` adds `publisherOrg: OrgPublisherSummary | null; frozen: boolean;` (import `type OrgPublisherSummary`).
- next to `forbidden`: `const appFrozen = () => new GraphQLError("The app is frozen by its organisation", { extensions: { code: "APP_FROZEN" } });`
- inside `createResolvers`, after `const lock = createKeyedLock();`:

```ts
  let defaultPolicy: OrgPolicy | undefined;
  const orgPolicy = deps.orgPolicy ?? (() => (defaultPolicy ??= createOrgPolicy(relationalDb, loadOrgsConfig(process.env).didHost)));

  /** The owner of the registered workload identity `appDid`; undefined if none or on error. */
  async function identityOwnerOf(appDid: string) {
    try {
      return await workloadIdentityOwner(relationalDb, appDid);
    } catch (error) {
      warn("workload identity lookup", error);
      return undefined;
    }
  }

  /** The publishing org card and the frozen flag of an app; null/false when they cannot be read. */
  async function orgView(entry: AppProfileEntry): Promise<{ publisherOrg: OrgPublisherSummary | null; frozen: boolean }> {
    try {
      const policy = orgPolicy();
      const [publisherOrg, owning] = await Promise.all([
        entry.publisherOrgId ? policy.orgSummary(entry.publisherOrgId) : Promise.resolve(null),
        policy.orgOfApp(entry.appDid),
      ]);
      return { publisherOrg, frozen: owning?.frozen ?? false };
    } catch (error) {
      warn("organisation lookup", error);
      return { publisherOrg: null, frozen: false };
    }
  }
```

- `profileOutput` returns `...(await orgView(entry))` after `metrics`.
- In `upsertAppProfile`, replace the block from `let entry = await index.appProfile(appDid);` through `if (entry.publisherAddress !== caller) throw forbidden();` + its closing `}` with:

```ts
          let entry = await index.appProfile(appDid);
          const policy = orgPolicy();
          const owning = await policy.orgOfApp(appDid);
          if (owning?.frozen) throw appFrozen();
          const requestedOrg = args.publisherOrgId?.trim() || null;
          let allowed: boolean;
          if (entry) {
            if (requestedOrg && requestedOrg !== (entry.publisherOrgId ?? null)) {
              throw fieldError("BAD_USER_INPUT", "publisherOrgId", "An existing app changes publisher through a transfer");
            }
            // Org apps: publisher capability for this app now; person apps: the recorded publisher.
            allowed = entry.publisherOrgId
              ? owning?.orgId === entry.publisherOrgId && (await policy.coversApp(entry.publisherOrgId, caller, appDid))
              : entry.publisherAddress === caller;
          } else {
            // Only the registered identity's owner (person) or its organisation's covered publisher may claim it.
            const identity = await identityOwnerOf(appDid);
            allowed = requestedOrg
              ? identity?.ownerOrgId === requestedOrg && (await policy.coversApp(requestedOrg, caller, appDid))
              : identity !== undefined && identity.ownerOrgId === null && identity.ownerAddress === caller;
          }
          if (!allowed) throw forbidden();
          await assertImages(patch);
          if (!entry) {
            const created = (await reactorClient.createEmpty(renownAppProfileDocumentType)).header.id;
            await execute(created, [
              profileActions.setAppDid({ appDid }),
              profileActions.setPublisherDid({ publisherDid: requestedOrg ? policy.orgDid(requestedOrg) : pkhDidFor(caller) }),
            ]);
            entry = await index.claimAppProfile(
              { appDid, documentId: created, publisherAddress: caller, ...(requestedOrg ? { publisherOrgId: requestedOrg } : {}) },
              now(),
            );
            if (entry.publisherAddress !== caller || (entry.publisherOrgId ?? null) !== requestedOrg) throw forbidden();
            if (requestedOrg && (await policy.attachApp(requestedOrg, appDid, caller, now()))) {
              try {
                await reactorClient.execute(requestedOrg, "main", [orgActions.addOrgApp({ appDid, addedAt: now().toISOString() })]);
              } catch (error) {
                // The org_apps row is the source of truth; the document is its signed mirror.
                warn("organisation document mirror", error);
              }
            }
          }
```

(the previous first-claim check `(await ownerOf(appDid)) === caller` is now the person branch above; `ownerOf` stays for `actsFor`).
- `appProfilesByPublisher`: first line of the resolver becomes

```ts
        const orgId = orgPolicy().orgIdOfDid(args.publisherDid);
        if (orgId) return profileOutputs(await requireIndex().appProfilesByOrg(orgId));
```

- `appProfiles`: args gain `orgId?: string | null`, and the page call becomes `requireIndex().appProfilesPage(limit + 1, after, category, args.orgId?.trim() || undefined)`.

`subgraphs/renown-stats/schema.ts`: add

```graphql
  "The organisation publishing an org-owned app."
  type AppPublisherOrg {
    id: String!
    did: String!
    handle: String!
    name: String!
    verifiedDomains: [String!]!
  }
```

to `AppProfile` add

```graphql
    "Set for org-owned apps (publisherDid is then the org's did:web)."
    publisherOrg: AppPublisherOrg
    "Frozen by its organisation: no profile writes, tokens or counting delegations."
    frozen: Boolean!
```

`appProfiles(limit: Int, after: String, category: String, "Only apps published by this organisation" orgId: String): AppProfilePage!`, a doc line `appProfilesByPublisher` "publisherDid: a did:pkh, an address, or an organisation's did:web", and on `upsertAppProfile` the argument `"First write of an org-owned app: the organisation its workload identity was registered for. Errors also APP_FROZEN." publisherOrgId: String`.

- [ ] **Step 6: Run the suites, types, lint, coverage**

Run: `pnpm vitest run document-models/renown-app-profile subgraphs/renown-stats subgraphs/renown-orgs 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass.

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3 && pnpm vitest run --coverage 2>&1 | grep -E "All files"`
Expected: clean; coverage ≥ 95 in every column.

- [ ] **Step 7: Commit**

```bash
git add document-models/renown-app-profile subgraphs/renown-stats
git commit -m "feat(stats): org-owned apps with publisher orgs, first claims for orgs and frozen apps"
```

---

### Task 6: Delegations under organisation rules — credential status, suspensions, derived revocation

**Files:**
- Modify: `subgraphs/renown-orgs/store/{types,migrations,kysely}.ts` (`org_credential_suspensions`), `core/org-policy.ts` (`credentialStatus`), `store/foreign.ts` (credential readers), `runtime.ts` (`policy()`), `schema-security.ts` (`CREDENTIALS_SDL`), `resolvers.ts`, `tests/harness.ts` (`insertCredential`)
- Create: `subgraphs/renown-orgs/areas/credentials.ts`
- Modify: `subgraphs/renown-stats/lookups.ts` (`hasDelegation(..., policy?)`), `subgraphs/renown-stats/resolvers.ts` (`actsFor`)
- Test: `subgraphs/renown-orgs/tests/credentials.test.ts`, `subgraphs/renown-stats/tests/org-apps.test.ts` (append), `tests/store-contract.ts` (append)

**Interfaces:**
- Consumes: Tasks 4–5 (`OrgPolicy`, `createOrgPolicy`, `identityOwnerOf` in renown-stats), A1 `endMembership` hooks (`rt.hooks.membershipEnded`).
- Produces:
  - store: `interface SuspensionRecord { orgId; credentialId; reason; memberAddress; at }`, `suspendCredentials(rows): Promise<string[]>` (newly suspended ids), `unsuspendCredential(orgId, credentialId): Promise<boolean>`, `suspendedCredentialIds(orgId): Promise<string[]>`.
  - policy: `type OrgCredentialReason = "ISSUER_NOT_MEMBER" | "ISSUER_NOT_PUBLISHER" | "SUSPENDED" | "APP_FROZEN"`, `interface CredentialVerdict { orgId: string | null; counts: boolean; reason: OrgCredentialReason | null }`, `OrgPolicy.credentialStatus({ credentialId, appDid, issuer }): Promise<CredentialVerdict>`.
  - `store/foreign.ts`: `interface CredentialRow { credentialId; documentId; appDid; issuer; issuanceDate; expirationDate; revoked }`, `credentialById(db, credentialId)`, `credentialsForApps(db, appDids, limit)`, `liveCredentialsOf(db, issuer, appDids, now)`.
  - runtime: `OrgRuntime.policy(): OrgPolicy`.
  - renown-stats: `hasDelegation(db, address, appDid, now, policy?)` — with a policy, only credentials that count under org rules qualify; `actsFor` accepts, for an org-owned workload identity, any address whose scope covers the app (plus a counting delegation).
  - GraphQL: `enum OrgCredentialReason`, `type OrgCredentialStatus`, `type OrgCredential`, `orgCredentials`, `orgCredentialStatus`, `suspendOrgCredentials`, `unsuspendOrgCredential`.

- [ ] **Step 1: Write the failing tests**

Append to `subgraphs/renown-orgs/tests/harness.ts`:

```ts
/** A delegation credential row from `issuer` to `appDid`, as the renown-credential processor writes it. */
export async function insertCredential(
  h: Harness,
  row: { credentialId: string; issuer: string; appDid: string; revoked?: boolean; expiresAt?: Date | null; issuedAt?: Date },
): Promise<void> {
  await h.root
    .withSchema(CRED_NS)
    .insertInto("renown_credential")
    .values({
      document_id: `doc-${row.credentialId}`,
      context: "[]",
      credential_id: row.credentialId,
      type: "[]",
      issuer_id: `did:pkh:eip155:1:${row.issuer}`,
      issuer_ethereum_address: row.issuer,
      issuance_date: row.issuedAt ?? T0,
      expiration_date: row.expiresAt === undefined ? new Date("2027-10-12T00:00:00Z") : row.expiresAt,
      credential_subject_id: row.appDid,
      credential_subject_app: "test-app",
      credential_status_id: null,
      credential_status_type: null,
      credential_schema_id: "schema",
      credential_schema_type: "type",
      proof_verification_method: "method",
      proof_ethereum_address: row.issuer,
      proof_created: T0,
      proof_purpose: "assertionMethod",
      proof_type: "EthereumEip712Signature2021",
      proof_value: "0x",
      proof_eip712_domain: "{}",
      proof_eip712_primary_type: "VerifiableCredential",
      revoked: row.revoked ?? false,
      revoked_at: null,
      revocation_reason: null,
    })
    .execute();
}
```

Append inside `describeOrgStoreContract` in `subgraphs/renown-orgs/tests/store-contract.ts`:

```ts
    it("suspends credentials once per organisation and lifts suspensions", async () => {
      const { store } = await open();
      const row = (credentialId: string, orgId = "o1") => ({ orgId, credentialId, reason: "ADMIN", memberAddress: null, at: T0 });
      expect(await store.suspendCredentials([row("c1"), row("c2")])).toEqual(["c1", "c2"]);
      expect(await store.suspendCredentials([row("c2"), row("c3"), row("c1", "o2")])).toEqual(["c3", "c1"]);
      expect(await store.suspendedCredentialIds("o1")).toEqual(["c1", "c2", "c3"]);
      expect(await store.unsuspendCredential("o1", "c2")).toBe(true);
      expect(await store.unsuspendCredential("o1", "c2")).toBe(false);
      expect(await store.suspendedCredentialIds("o1")).toEqual(["c1", "c3"]);
    });
```

Create `subgraphs/renown-orgs/tests/credentials.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import { ALICE, BOB, CAROL, DAVE, createOrg, failure, harnessResolvers, insertCredential, join, lower, openHarness, resetHarness, T0, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const PERSON_APP = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
type Status = { credentialId: string; appDid: string | null; orgId: string | null; counts: boolean; reason: string | null };
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

/** acme owns APP; BOB publishes it (scope), CAROL is a plain member. */
async function setup() {
  const t = harnessResolvers(h);
  const { id } = await createOrg(t, ALICE, "acme");
  await join(t, id, BOB, "PUBLISHER");
  await join(t, id, CAROL, "MEMBER");
  await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: false, appDids: [APP] } }, ALICE);
  await t.store.db.insertInto("org_apps").values({ app_did: APP, org_id: id, frozen: false, added_at: T0 }).execute();
  await insertCredential(h, { credentialId: "c-bob", issuer: lower(BOB), appDid: APP });
  await insertCredential(h, { credentialId: "c-carol", issuer: lower(CAROL), appDid: APP });
  await insertCredential(h, { credentialId: "c-dave", issuer: lower(DAVE), appDid: APP });
  await insertCredential(h, { credentialId: "c-person", issuer: lower(DAVE), appDid: PERSON_APP });
  return { t, id };
}

const status = (t: TestResolvers, credentialId: string) => t.query<Status | null>("orgCredentialStatus", { credentialId });

describe("credential status under organisation rules", () => {
  it("explains whether each delegation counts", async () => {
    const { t, id } = await setup();
    expect(await status(t, "c-bob")).toEqual({ credentialId: "c-bob", appDid: APP, orgId: id, counts: true, reason: null });
    expect(await status(t, "c-carol")).toMatchObject({ counts: false, reason: "ISSUER_NOT_PUBLISHER" });
    expect(await status(t, "c-dave")).toMatchObject({ counts: false, reason: "ISSUER_NOT_MEMBER" });
    expect(await status(t, "c-person")).toEqual({ credentialId: "c-person", appDid: PERSON_APP, orgId: null, counts: true, reason: null });
    expect(await status(t, "nope")).toBeNull();
    await t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-bob"] }, ALICE);
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    await t.store.db.updateTable("org_apps").set({ frozen: true }).execute();
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "APP_FROZEN" });
  });

  it("suspends a leaving or removed member's delegations, and the suspension survives re-joining", async () => {
    const { t, id } = await setup();
    await t.mutate("removeOrgMember", { orgId: id, address: BOB.address }, ALICE);
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    expect(t.reactor.state<RenownOrganizationState>(id).suspendedCredentialIds).toEqual(["c-bob"]);
    await join(t, id, BOB, "PUBLISHER");
    await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: true, appDids: [] } }, ALICE);
    expect(await status(t, "c-bob")).toMatchObject({ counts: false, reason: "SUSPENDED" });
    expect(await t.mutate("unsuspendOrgCredential", { orgId: id, credentialId: "c-bob" }, ALICE)).toBe(true);
    expect(await status(t, "c-bob")).toMatchObject({ counts: true, reason: null });
    expect((await failure(t.mutate("unsuspendOrgCredential", { orgId: id, credentialId: "c-bob" }, ALICE))).code).toBe("NOT_FOUND");
  });

  it("suspends by credential ids or by member, for admins, only for the organisation's apps", async () => {
    const { t, id } = await setup();
    expect(await failure(t.mutate("suspendOrgCredentials", { orgId: id }, ALICE))).toMatchObject({ field: "credentialIds" });
    expect(await failure(t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-person"] }, ALICE))).toMatchObject({ field: "credentialIds" });
    expect((await failure(t.mutate("suspendOrgCredentials", { orgId: id, credentialIds: ["c-bob"] }, BOB))).code).toBe("FORBIDDEN");
    expect(await t.mutate("suspendOrgCredentials", { orgId: id, memberAddress: CAROL.address }, ALICE)).toEqual(["c-carol"]);
    const rows = await t.query<{ credentialId: string; issuerRole: string | null; issuerStatus: string | null; status: Status }[]>("orgCredentials", { orgId: id }, ALICE);
    expect(rows.map((r) => [r.credentialId, r.issuerRole, r.issuerStatus, r.status.reason]).sort()).toEqual([
      ["c-bob", "PUBLISHER", "ACTIVE", null],
      ["c-carol", "MEMBER", "ACTIVE", "SUSPENDED"],
      ["c-dave", null, null, "ISSUER_NOT_MEMBER"],
    ]);
  });
});
```

Append to `subgraphs/renown-stats/tests/org-apps.test.ts`:

```ts
describe("delegations of org apps", () => {
  it("count for covered publishers only, and never for a frozen app", async () => {
    await registerApps();
    await orgs.db.insertInto("org_apps").values({ app_did: APP, org_id: "o1", frozen: false, added_at: new Date() }).execute();
    const t = setup();
    const report = { appDid: APP, userDid: "did:pkh:eip155:1:0x1111111111111111111111111111111111111111", metric: "notes", value: 1 };
    expect(await t.report(report)).toBe(true);
    await orgs.db.updateTable("org_members").set({ status: "REMOVED" }).where("address", "=", OWNER).execute();
    expect((await failure(t.report(report))).code).toBe("FORBIDDEN");
    await orgs.db.updateTable("org_members").set({ status: "ACTIVE" }).where("address", "=", OWNER).execute();
    await orgs.db.updateTable("org_apps").set({ frozen: true }).execute();
    expect((await failure(t.report(report))).code).toBe("FORBIDDEN");
  });
});
```

(`registerApp` gives OWNER a live delegation to APP; OWNER is the org's owner in the `beforeEach`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs subgraphs/renown-stats 2>&1 | grep -E "Tests |FAIL" | head -8`
Expected: suspension store methods and the credential fields are missing; the stats test fails at the second report (the removed owner still counts).

- [ ] **Step 3: Store and policy**

`subgraphs/renown-orgs/store/types.ts`:

```ts
export interface OrgCredentialSuspensionsTable {
  org_id: string;
  credential_id: string;
  /** ADMIN, MEMBER_LEFT or MEMBER_REMOVED. */
  reason: string;
  member_address: string | null;
  at: Timestamp;
}

export interface SuspensionRecord {
  orgId: string;
  credentialId: string;
  reason: string;
  memberAddress: string | null;
  at: Date;
}
```

`org_credential_suspensions: OrgCredentialSuspensionsTable;` in `OrgsDB`; `OrgStore` gains:

```ts
  /** Inserts suspensions not present yet; returns the newly suspended credential ids, in input order. */
  suspendCredentials(rows: readonly SuspensionRecord[]): Promise<string[]>;
  unsuspendCredential(orgId: string, credentialId: string): Promise<boolean>;
  suspendedCredentialIds(orgId: string): Promise<string[]>;
```

Migration (append):

```ts
  await db.schema
    .createTable("org_credential_suspensions")
    .ifNotExists()
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("credential_id", "text", (col) => col.notNull())
    .addColumn("reason", "text", (col) => col.notNull())
    .addColumn("member_address", "text")
    .addColumn("at", "timestamptz", (col) => col.notNull())
    .addPrimaryKeyConstraint("org_credential_suspensions_pk", ["org_id", "credential_id"])
    .execute();
```

`KyselyOrgStore`:

```ts
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

  async suspendedCredentialIds(orgId: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom("org_credential_suspensions")
      .select("credential_id")
      .where("org_id", "=", orgId)
      .orderBy("credential_id")
      .execute();
    return rows.map((row) => row.credential_id);
  }
```

`subgraphs/renown-orgs/core/org-policy.ts`: add the exported types

```ts
export type OrgCredentialReason = "ISSUER_NOT_MEMBER" | "ISSUER_NOT_PUBLISHER" | "SUSPENDED" | "APP_FROZEN";

export interface CredentialVerdict {
  /** The organisation owning the delegated app, or null for person-owned apps. */
  orgId: string | null;
  counts: boolean;
  reason: OrgCredentialReason | null;
}
```

the interface member

```ts
  /** Whether a delegation by `issuer` for `appDid` counts under organisation rules (person apps always do). */
  credentialStatus(input: { credentialId: string; appDid: string; issuer: string }): Promise<CredentialVerdict>;
```

Inside `createOrgPolicy`, lift the scope check out of the object literal so `credentialStatus` can reuse it — add this local function after `activeMember`:

```ts
  async function covers(orgId: string, address: string, appDid: string): Promise<boolean> {
    const member = await activeMember(orgId, address);
    if (!member || !roleAtLeast(member.role, "PUBLISHER")) return false;
    if (member.role === "OWNER" || member.role === "ADMIN" || member.app_scope_all) return true;
    if (stringList(member.app_dids).includes(appDid)) return true;
    const teams = await orgs()
      .selectFrom("org_team_members")
      .innerJoin("org_teams", "org_teams.id", "org_team_members.team_id")
      .select("org_teams.app_dids")
      .where("org_team_members.member_id", "=", member.id)
      .execute();
    return teams.some((team) => stringList(team.app_dids).includes(appDid));
  }
```

replace the object's `coversApp` member with `coversApp: (orgId, address, appDid) => orEmpty(false, () => covers(orgId, address, appDid)),`, and add (the reasons in precedence order):

```ts
    credentialStatus: ({ credentialId, appDid, issuer }) =>
      orEmpty<CredentialVerdict>({ orgId: null, counts: true, reason: null }, async () => {
        const app = await orgs().selectFrom("org_apps").select(["org_id", "frozen"]).where("app_did", "=", appDid).executeTakeFirst();
        if (!app) return { orgId: null, counts: true, reason: null };
        const verdict = (reason: OrgCredentialReason | null): CredentialVerdict => ({ orgId: app.org_id, counts: reason === null, reason });
        if (app.frozen) return verdict("APP_FROZEN");
        const suspended = await orgs()
          .selectFrom("org_credential_suspensions")
          .select("credential_id")
          .where("org_id", "=", app.org_id)
          .where("credential_id", "=", credentialId)
          .executeTakeFirst();
        if (suspended) return verdict("SUSPENDED");
        if (!(await activeMember(app.org_id, issuer))) return verdict("ISSUER_NOT_MEMBER");
        return verdict((await covers(app.org_id, issuer, appDid)) ? null : "ISSUER_NOT_PUBLISHER");
      }),
```

- [ ] **Step 4: Credential readers, runtime policy, renown-stats**

Append to `subgraphs/renown-orgs/store/foreign.ts`:

```ts
import { RenownCredentialProcessor } from "../../../processors/renown-credential/index.js";
import type { DB as RenownCredentialDB } from "../../../processors/renown-credential/schema.js";

export interface CredentialRow {
  credentialId: string;
  documentId: string;
  /** credential_subject_id: the delegated app key. */
  appDid: string;
  /** Lowercase issuer address. */
  issuer: string;
  issuanceDate: Date;
  expirationDate: Date | null;
  revoked: boolean;
}

function credentials(db: ReadModelDb) {
  return RenownCredentialProcessor.query<RenownCredentialDB>("renown-credential", db).selectFrom("renown_credential");
}

const CREDENTIAL_COLUMNS = [
  "credential_id",
  "document_id",
  "credential_subject_id",
  "issuer_ethereum_address",
  "issuance_date",
  "expiration_date",
  "revoked",
] as const;

function toCredential(row: {
  credential_id: string;
  document_id: string;
  credential_subject_id: string | null;
  issuer_ethereum_address: string;
  issuance_date: Date | string;
  expiration_date: Date | string | null;
  revoked: boolean;
}): CredentialRow {
  return {
    credentialId: row.credential_id,
    documentId: row.document_id,
    appDid: row.credential_subject_id ?? "",
    issuer: row.issuer_ethereum_address.toLowerCase(),
    issuanceDate: toDate(row.issuance_date),
    expirationDate: row.expiration_date === null ? null : toDate(row.expiration_date),
    revoked: row.revoked,
  };
}

/** A credential by VC id: a live copy first, then the oldest. */
export async function credentialById(db: ReadModelDb, credentialId: string): Promise<CredentialRow | undefined> {
  const row = await credentials(db)
    .select([...CREDENTIAL_COLUMNS])
    .where("credential_id", "=", credentialId)
    .orderBy("revoked", "asc")
    .orderBy("created_at", "asc")
    .executeTakeFirst();
  return row && toCredential(row);
}

/** Delegations to any of `appDids`, newest first, at most `limit`. */
export async function credentialsForApps(db: ReadModelDb, appDids: readonly string[], limit: number): Promise<CredentialRow[]> {
  if (appDids.length === 0) return [];
  const rows = await credentials(db)
    .select([...CREDENTIAL_COLUMNS])
    .where("credential_subject_id", "in", [...appDids])
    .orderBy("issuance_date", "desc")
    .orderBy("credential_id", "desc")
    .limit(limit)
    .execute();
  return rows.map(toCredential);
}

/** Unrevoked, unexpired delegations by `issuer` to any of `appDids`. */
export async function liveCredentialsOf(db: ReadModelDb, issuer: string, appDids: readonly string[], now: Date): Promise<CredentialRow[]> {
  if (appDids.length === 0) return [];
  const rows = await credentials(db)
    .select([...CREDENTIAL_COLUMNS])
    .where((eb) => eb(eb.fn("LOWER", ["issuer_ethereum_address"]), "=", issuer.toLowerCase()))
    .where("credential_subject_id", "in", [...appDids])
    .where("revoked", "=", false)
    .where((eb) => eb.or([eb("expiration_date", "is", null), eb("expiration_date", ">", now)]))
    .execute();
  return rows.map(toCredential);
}
```

`subgraphs/renown-orgs/runtime.ts`: import `createOrgPolicy, type OrgPolicy` from `./core/org-policy.js`; add `policy(): OrgPolicy;` to `OrgRuntime`; in `createRuntime` keep `let policy: OrgPolicy | undefined;` and return `policy: () => (policy ??= createOrgPolicy(deps.relationalDb, deps.config().didHost)),`.

`subgraphs/renown-stats/lookups.ts`: `hasDelegation` becomes:

```ts
export async function hasDelegation(
  db: ReadModelDb,
  address: string,
  appDid: string,
  now: Date,
  policy?: Pick<OrgPolicy, "credentialStatus">,
): Promise<boolean> {
  const rows = await RenownCredentialProcessor.query<RenownCredentialDB>("renown-credential", db)
    .selectFrom("renown_credential")
    .select("credential_id")
    .where((eb) => eb(eb.fn("LOWER", ["issuer_ethereum_address"]), "=", address.toLowerCase()))
    .where("credential_subject_id", "=", appDid)
    .where("revoked", "=", false)
    .where((eb) => eb.or([eb("expiration_date", "is", null), eb("expiration_date", ">", now)]))
    .execute();
  if (rows.length === 0) return false;
  if (!policy) return true;
  // Org apps: only a delegation that counts under org rules (derived revocation).
  for (const row of rows) {
    if ((await policy.credentialStatus({ credentialId: row.credential_id, appDid, issuer: address.toLowerCase() })).counts) return true;
  }
  return false;
}
```

(import `type OrgPolicy` from `../renown-orgs/core/org-policy.js`).

`subgraphs/renown-stats/resolvers.ts`: replace `actsFor` with:

```ts
  /**
   * True when `address` may act as `appDid`: the registered workload identity
   * belongs to `address` (person) or to an organisation whose rules let
   * `address` publish the app, and `address` holds a live delegation to it that
   * counts under organisation rules. Never throws.
   */
  async function actsFor(address: string, appDid: string): Promise<boolean> {
    const caller = address.toLowerCase();
    const identity = await identityOwnerOf(appDid);
    if (!identity) return false;
    try {
      const policy = orgPolicy();
      if (identity.ownerOrgId) {
        if (!(await policy.coversApp(identity.ownerOrgId, caller, appDid))) return false;
      } else if (identity.ownerAddress !== caller) {
        return false;
      }
      return await hasDelegation(relationalDb, caller, appDid, now(), policy);
    } catch (error) {
      warn("delegation lookup", error);
      return false;
    }
  }
```

Then delete the `ownerOf` helper (nothing calls it any more) and drop `workloadOwner` from the `./lookups.js` import (the function stays exported from `lookups.ts`).

- [ ] **Step 5: GraphQL area**

Add to `subgraphs/renown-orgs/schema-security.ts` and to `SECURITY_SDL`:

```ts
export const CREDENTIALS_SDL = `
  enum OrgCredentialReason {
    ISSUER_NOT_MEMBER
    ISSUER_NOT_PUBLISHER
    SUSPENDED
    APP_FROZEN
  }

  type OrgCredentialStatus {
    credentialId: String!
    appDid: String
    orgId: String
    "Whether organisation rules let the delegation count (revocation and expiry are reported by renownCredentials)."
    counts: Boolean!
    reason: OrgCredentialReason
  }

  type OrgCredential {
    credentialId: String!
    documentId: String!
    appDid: String!
    issuer: String!
    issuerRole: OrgRole
    issuerStatus: OrgMemberStatus
    issuanceDate: String!
    expirationDate: String
    revoked: Boolean!
    status: OrgCredentialStatus!
  }

  extend type Query {
    "Admins: delegations for the organisation's apps (newest 500)."
    orgCredentials(orgId: String!, auth: OrgAuthInput): [OrgCredential!]!
    "Public: whether a delegation credential counts under organisation rules; null for an unknown credential."
    orgCredentialStatus(credentialId: String!): OrgCredentialStatus
  }

  extend type Mutation {
    "Admins: exactly one of credentialIds and memberAddress (all of that member's live delegations for org apps)."
    suspendOrgCredentials(orgId: String!, credentialIds: [String!], memberAddress: String, auth: OrgAuthInput): [String!]!
    unsuspendOrgCredential(orgId: String!, credentialId: String!, auth: OrgAuthInput): Boolean!
  }
`;
```

Create `subgraphs/renown-orgs/areas/credentials.ts`:

```ts
import { actions as orgActions } from "../../../document-models/renown-organization/index.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, notFound, unavailable } from "../core/errors.js";
import { iso, isoOrNull, memberStatus } from "../output.js";
import type { Area, MembershipEnded, OrgRuntime } from "../runtime.js";
import { credentialById, credentialsForApps, liveCredentialsOf, type CredentialRow } from "../store/foreign.js";
import { addressArg } from "./members.js";

const MAX_LISTED = 500;

async function statusOf(rt: OrgRuntime, row: CredentialRow) {
  const verdict = await rt.policy().credentialStatus({ credentialId: row.credentialId, appDid: row.appDid, issuer: row.issuer });
  return { credentialId: row.credentialId, appDid: row.appDid || null, orgId: verdict.orgId, counts: verdict.counts, reason: verdict.reason };
}

/** Suspends `credentialIds` for `orgId` in the store and the document, and records it. The caller holds the org lock. */
async function suspend(rt: OrgRuntime, orgId: string, credentialIds: string[], reason: string, memberAddress: string | null, actor: string, now: Date) {
  const added = await rt.store().suspendCredentials(credentialIds.map((credentialId) => ({ orgId, credentialId, reason, memberAddress, at: now })));
  if (added.length === 0) return;
  await rt.execute(orgId, [orgActions.suspendCredentials({ credentialIds: added })]);
  const data = { credentialIds: added, reason };
  await rt.record({ orgId, actor, action: reason === "ADMIN" ? "suspendOrgCredentials" : "system.suspendOnExit", at: now, details: { ...data, memberAddress }, event: { type: "credential.suspended", data } });
}

/** Leaving or removal suspends the member's live delegations for the organisation's apps. */
function suspendOnExit(rt: OrgRuntime) {
  return async (event: MembershipEnded) => {
    const apps = (await rt.store().orgApps(event.orgId)).map((app) => app.appDid);
    const live = await liveCredentialsOf(rt.deps.relationalDb, event.address, apps, event.at);
    await suspend(rt, event.orgId, live.map((row) => row.credentialId), event.reason === "LEFT" ? "MEMBER_LEFT" : "MEMBER_REMOVED", event.address, event.actor, event.at);
  };
}

export const credentialResolvers: Area = (rt) => {
  rt.hooks.membershipEnded.push(suspendOnExit(rt));
  return {
    Query: {
      orgCredentialStatus: async (_: unknown, args: { credentialId: string }) => {
        let row: CredentialRow | undefined;
        try {
          row = await credentialById(rt.deps.relationalDb, args.credentialId);
        } catch {
          throw unavailable("Credentials cannot be read right now");
        }
        return row ? statusOf(rt, row) : null;
      },
      orgCredentials: async (_: unknown, args: OrgArgs & { orgId: string }, ctx: OrgContext) => {
        const caller = await rt.caller(ctx, "orgCredentials", args);
        const store = rt.store();
        await requireOrg(store, args.orgId, { writable: false });
        await requireRole(store, args.orgId, caller, "ADMIN");
        const apps = (await store.orgApps(args.orgId)).map((app) => app.appDid);
        const rows = await credentialsForApps(rt.deps.relationalDb, apps, MAX_LISTED);
        const members = await store.members(args.orgId);
        const now = rt.now();
        return Promise.all(
          rows.map(async (row) => {
            // The issuer's current (or latest) membership record.
            const member = members.filter((m) => m.address === row.issuer).at(-1);
            return {
              credentialId: row.credentialId,
              documentId: row.documentId,
              appDid: row.appDid,
              issuer: row.issuer,
              issuerRole: member?.role ?? null,
              issuerStatus: member ? memberStatus(member, now) : null,
              issuanceDate: iso(row.issuanceDate),
              expirationDate: isoOrNull(row.expirationDate),
              revoked: row.revoked,
              status: await statusOf(rt, row),
            };
          }),
        );
      },
    },
    Mutation: {
      suspendOrgCredentials: async (
        _: unknown,
        args: OrgArgs & { orgId: string; credentialIds?: string[] | null; memberAddress?: string | null },
        ctx: OrgContext,
      ) => {
        const caller = await rt.writer(ctx, "suspendOrgCredentials", args);
        if ((args.credentialIds == null) === (args.memberAddress == null)) {
          throw badInput("credentialIds", "Pass exactly one of credentialIds and memberAddress");
        }
        return rt.lock(`org:${args.orgId}`, async () => {
          const store = rt.store();
          const now = rt.now();
          await requireOrg(store, args.orgId);
          await requireRole(store, args.orgId, caller, "ADMIN");
          const apps = (await store.orgApps(args.orgId)).map((app) => app.appDid);
          let ids: string[];
          let memberAddress: string | null = null;
          if (args.credentialIds != null) {
            ids = [...new Set(args.credentialIds)];
            for (const id of ids) {
              const row = await credentialById(rt.deps.relationalDb, id);
              if (!row || !apps.includes(row.appDid)) throw badInput("credentialIds", `${id} is not a delegation for an app of this organisation`);
            }
          } else {
            memberAddress = addressArg("memberAddress", args.memberAddress ?? "");
            ids = (await liveCredentialsOf(rt.deps.relationalDb, memberAddress, apps, now)).map((row) => row.credentialId);
          }
          await suspend(rt, args.orgId, ids, "ADMIN", memberAddress, caller, now);
          return ids;
        });
      },
      unsuspendOrgCredential: async (_: unknown, args: OrgArgs & { orgId: string; credentialId: string }, ctx: OrgContext) => {
        const caller = await rt.writer(ctx, "unsuspendOrgCredential", args);
        return rt.lock(`org:${args.orgId}`, async () => {
          const store = rt.store();
          await requireOrg(store, args.orgId);
          await requireRole(store, args.orgId, caller, "ADMIN");
          if (!(await store.unsuspendCredential(args.orgId, args.credentialId))) throw notFound("Suspension");
          await rt.execute(args.orgId, [orgActions.unsuspendCredential({ credentialId: args.credentialId })]);
          await rt.record({ orgId: args.orgId, actor: caller, action: "unsuspendOrgCredential", at: rt.now(), details: { credentialId: args.credentialId } });
          return true;
        });
      },
    },
  };
};
```

Register `credentialResolvers` in `AREAS`.

- [ ] **Step 6: Run the suites, types, lint**

Run: `pnpm vitest run subgraphs/renown-orgs subgraphs/renown-stats 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass (person-owned apps behave as before: their delegations always count).

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-orgs subgraphs/renown-stats
git commit -m "feat(orgs): delegations count only under organisation rules, with suspensions"
```

---

### Task 7: App transfers in and out, freeze and unfreeze

**Files:**
- Modify: `subgraphs/renown-orgs/store/{types,migrations,kysely}.ts` (`org_app_transfers`, org-app writers), `store/foreign.ts` (stats and workload owners), `areas/proposal-kinds.ts` (TRANSFER_APP_OUT, FREEZE_APP, UNFREEZE_APP), `schema-security.ts` (`TRANSFERS_SDL`), `resolvers.ts`, `jobs.ts` (`transfersJob`), `tests/harness.ts` (stats namespace, `insertAppProfile`)
- Create: `subgraphs/renown-orgs/core/app-ownership.ts`, `subgraphs/renown-orgs/areas/transfers.ts`
- Test: `subgraphs/renown-orgs/tests/transfers.test.ts`, `tests/store-contract.ts` (append)

**Interfaces:**
- Consumes: Tasks 1–6 (`ProposalHandler`, `PROPOSAL_KINDS`, `createSweeper`, `sweepJobs`, `rt.policy()`), `pkhDidFor` (renown-stats/core/dids.ts), renown-app-profile `actions.setPublisherDid`, `StatsDB` (renown-stats/store/types.ts).
- Produces:
  - store: `type TransferStatus`, `interface TransferRecord { id; appDid; fromKind; fromId; toKind; toId; status; createdAt; expiresAt; decidedAt; decidedBy; proposalId }`, `insertTransfer`, `transfer(id)`, `transfers({ appDid?, party? })` (newest first), `pendingTransferOf(appDid)`, `updateTransfer(id, patch, expected)`, `dueTransfers(now, limit)`, `insertOrgApp(app): Promise<boolean>`, `deleteOrgApp(appDid): Promise<boolean>`, `setAppFrozen(appDid, frozen)`.
  - `store/foreign.ts`: `STATS_NAMESPACE`, `appPublisher(db, appDid)`, `setAppPublisher(db, appDid, owner)`, `setWorkloadOwner(db, appDid, owner, now)`.
  - `core/app-ownership.ts`: `type AppOwner = { kind: "ORG"; orgId } | { kind: "PERSON"; address }`, `currentOwner(rt, appDid)`, `moveApp(rt, appDid, from, to, actor, now)`, `TRANSFER_TTL_MS`.
  - `areas/transfers.ts`: `transferResolvers: Area`, `transferOutput(t)`, `createTransfer(rt, input)`.
  - `PROPOSAL_KINDS`: `TRANSFER_APP_OUT`, `FREEZE_APP`, `UNFREEZE_APP`; `jobs.ts`: `transfersJob(rt)`.
  - harness: `STATS_NS`, `insertAppProfile(h, t, appDid, publisher): Promise<string>` (document id).

- [ ] **Step 1: Write the failing tests**

In `subgraphs/renown-orgs/tests/harness.ts`: import `migrate as migrateStats` from `../../renown-stats/store/migrations.js` and `actions as profileActions` from `../../../document-models/renown-app-profile/index.js` and `pkhDidFor` from `../../renown-stats/core/dids.js`; `export const STATS_NS = "renown-stats";`; create and migrate it in `openHarness` (`await sql\`create schema ${sql.id(STATS_NS)}\`.execute(root); await migrateStats(root.withSchema(STATS_NS));`); add `STATS_NS` to `resetHarness`'s schema list; append:

```ts
/** A person-owned app profile, as renown-stats' upsertAppProfile creates it. Returns its document id. */
export async function insertAppProfile(h: Harness, t: TestResolvers, appDid: string, publisher: string): Promise<string> {
  const doc = await t.reactor.createEmpty(renownAppProfileDocumentType);
  await t.reactor.execute(doc.header.id, "main", [
    profileActions.setAppDid({ appDid }),
    profileActions.setPublisherDid({ publisherDid: pkhDidFor(publisher) }),
  ]);
  await h.root
    .withSchema(STATS_NS)
    .insertInto("app_profile_documents")
    .values({ app_did: appDid, document_id: doc.header.id, publisher_address: publisher.toLowerCase(), created_at: T0 })
    .execute();
  return doc.header.id;
}
```

Append inside `describeOrgStoreContract` in `subgraphs/renown-orgs/tests/store-contract.ts`:

```ts
    it("keeps one pending transfer per app and moves transfers only from the expected status", async () => {
      const { store } = await open();
      const transfer = (id: string, appDid: string, createdAt = T0) => ({
        id, appDid, fromKind: "PERSON" as const, fromId: ALICE, toKind: "ORG" as const, toId: "o1", status: "PENDING" as const,
        createdAt, expiresAt: at(60), decidedAt: null, decidedBy: null, proposalId: null,
      });
      await store.insertTransfer(transfer("t1", "did:key:za"));
      await expect(store.insertTransfer(transfer("t2", "did:key:za"))).rejects.toThrow();
      await store.insertTransfer(transfer("t3", "did:key:zb", at(1)));
      expect((await store.pendingTransferOf("did:key:za"))?.id).toBe("t1");
      expect((await store.transfers({ party: { kind: "ORG", id: "o1" } })).map((t) => t.id)).toEqual(["t3", "t1"]);
      expect((await store.transfers({ appDid: "did:key:zb", party: { kind: "PERSON", id: ALICE } })).map((t) => t.id)).toEqual(["t3"]);
      expect(await store.updateTransfer("t1", { status: "ACCEPTED", decidedAt: at(2), decidedBy: BOB }, "PENDING")).toMatchObject({ status: "ACCEPTED", decidedBy: BOB });
      expect(await store.updateTransfer("t1", { status: "DECLINED" }, "PENDING")).toBeUndefined();
      expect((await store.dueTransfers(at(60), 10)).map((t) => t.id)).toEqual(["t3"]);
      expect(await store.insertOrgApp({ appDid: "did:key:za", orgId: "o1", frozen: false, addedAt: T0 })).toBe(true);
      expect(await store.insertOrgApp({ appDid: "did:key:za", orgId: "o2", frozen: false, addedAt: T0 })).toBe(false);
      await store.setAppFrozen("did:key:za", true);
      expect((await store.orgOfApp("did:key:za"))?.frozen).toBe(true);
      expect(await store.deleteOrgApp("did:key:za")).toBe(true);
    });
```

Create `subgraphs/renown-orgs/tests/transfers.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { RenownAppProfileDocument } from "../../../document-models/renown-app-profile/index.js";
import type { RenownOrganizationState } from "../../../document-models/renown-organization/index.js";
import type { ProposalOutput } from "../areas/proposals.js";
import type { RecordedActivity } from "../core/activity.js";
import { createSweeper } from "../core/sweeper.js";
import { sweepJobs } from "../jobs.js";
import {
  ALICE,
  BOB,
  CAROL,
  DAVE,
  createOrg,
  failure,
  harnessResolvers,
  insertAppProfile,
  insertWorkload,
  join,
  lower,
  openHarness,
  resetHarness,
  STATS_NS,
  WORKLOAD_NS,
  type Harness,
  type TestResolvers,
} from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const DAY = 86_400_000;
interface Transfer {
  id: string;
  appDid: string;
  fromKind: string;
  fromId: string;
  toKind: string;
  toId: string;
  status: string;
  decidedBy: string | null;
  proposalId: string | null;
}
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

async function statsRow() {
  return h.root.withSchema(STATS_NS).selectFrom("app_profile_documents").selectAll().where("app_did", "=", APP).executeTakeFirstOrThrow();
}
async function workloadRow() {
  return h.root.withSchema(WORKLOAD_NS).selectFrom("workload_identities").selectAll().where("did", "=", APP).executeTakeFirstOrThrow();
}

/** ALICE publishes APP personally; BOB owns acme. */
async function world(events?: RecordedActivity[]) {
  const t = harnessResolvers(h, events ? { sinks: [(a) => Promise.resolve(void events.push(a))] } : {});
  const docId = await insertAppProfile(h, t, APP, lower(ALICE));
  await insertWorkload(h, { did: APP, owner: ALICE.address });
  const acme = await createOrg(t, BOB, "acme");
  return { t, docId, acme };
}

const propose = (t: TestResolvers, who = ALICE, toOrgId: string) => t.mutate<Transfer>("proposeAppTransfer", { appDid: APP, toOrgId }, who);

describe("person to organisation", () => {
  it("moves the app when an admin of the target accepts", async () => {
    const events: RecordedActivity[] = [];
    const { t, docId, acme } = await world(events);
    const pending = await propose(t, ALICE, acme.id);
    expect(pending).toMatchObject({ fromKind: "PERSON", fromId: lower(ALICE), toKind: "ORG", toId: acme.id, status: "PENDING" });
    expect((await t.query<Transfer[]>("appTransfers", { orgId: acme.id }, BOB)).map((x) => x.id)).toEqual([pending.id]);
    expect(events.find((e) => e.action === "proposeAppTransfer")?.notify).toEqual([
      { to: "ADMINS", kind: "APP_TRANSFER_REQUEST", payload: { transferId: pending.id, appDid: APP, from: lower(ALICE) } },
    ]);
    expect(await t.mutate<Transfer>("acceptAppTransfer", { transferId: pending.id }, BOB)).toMatchObject({ status: "ACCEPTED", decidedBy: lower(BOB) });
    expect(await statsRow()).toMatchObject({ publisher_org_id: acme.id, publisher_address: lower(ALICE) });
    expect((await workloadRow()).owner_org_id).toBe(acme.id);
    expect((await t.store.orgOfApp(APP))?.orgId).toBe(acme.id);
    expect(t.reactor.state<RenownOrganizationState>(acme.id).apps.map((a) => a.appDid)).toEqual([APP]);
    expect((t.reactor.docs.get(docId) as RenownAppProfileDocument).state.global.publisherDid).toBe(`did:web:renown.test:org:${acme.id}`);
    expect(events.find((e) => e.event?.type === "app.transferred_in")?.event?.data).toEqual({ appDid: APP, transferId: pending.id, from: lower(ALICE), to: acme.id });
  });

  it("is proposed by the publisher only, once at a time, accepted by target admins only, and declined or withdrawn", async () => {
    const { t, acme } = await world();
    await join(t, acme.id, CAROL, "PUBLISHER", BOB);
    expect((await failure(propose(t, DAVE, acme.id))).code).toBe("FORBIDDEN");
    expect((await failure(propose(t, ALICE, "nope"))).code).toBe("NOT_FOUND");
    const first = await propose(t, ALICE, acme.id);
    expect(await failure(propose(t, ALICE, acme.id))).toMatchObject({ field: "appDid" });
    expect((await failure(t.mutate("acceptAppTransfer", { transferId: first.id }, CAROL))).code).toBe("FORBIDDEN");
    expect((await t.mutate<Transfer>("declineAppTransfer", { transferId: first.id }, BOB)).status).toBe("DECLINED");
    const second = await propose(t, ALICE, acme.id);
    expect((await t.mutate<Transfer>("declineAppTransfer", { transferId: second.id }, ALICE)).status).toBe("CANCELLED");
    expect((await failure(t.mutate("declineAppTransfer", { transferId: second.id }, ALICE))).field).toBe("transferId");
    expect((await t.query<Transfer[]>("appTransfers", { address: ALICE.address }, ALICE)).map((x) => x.status)).toEqual(["CANCELLED", "DECLINED"]);
    expect((await failure(t.query("appTransfers", { address: ALICE.address }, BOB))).code).toBe("FORBIDDEN");
  });

  it("refuses an acceptance after the source lost the app", async () => {
    const { t, acme } = await world();
    const pending = await propose(t, ALICE, acme.id);
    await h.root.withSchema(STATS_NS).updateTable("app_profile_documents").set({ publisher_address: lower(DAVE) }).execute();
    expect(await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB))).toMatchObject({ code: "BAD_USER_INPUT", field: "transferId" });
    expect((await statsRow()).publisher_org_id).toBeNull();
  });

  it("expires after 14 days", async () => {
    const { t, acme } = await world();
    const pending = await propose(t, ALICE, acme.id);
    t.tick(14 * DAY);
    await createSweeper({ jobs: sweepJobs(t.rt), store: () => t.store, now: () => t.clock.now }).tick();
    expect((await t.store.transfer(pending.id))?.status).toBe("EXPIRED");
    expect(await failure(t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB))).toMatchObject({ field: "transferId" });
  });
});

describe("organisation to person, freezing", () => {
  async function orgApp() {
    const w = await world();
    const pending = await propose(w.t, ALICE, w.acme.id);
    await w.t.mutate("acceptAppTransfer", { transferId: pending.id }, BOB);
    return w;
  }

  it("transfers out through a proposal, then the person accepts", async () => {
    const { t, docId, acme } = await orgApp();
    const p = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "TRANSFER_APP_OUT", payload: { appDid: APP, toKind: "PERSON", toId: DAVE.address } }, BOB);
    t.tick(3600 * 1000);
    expect((await t.mutate<ProposalOutput>("executeOrgProposal", { orgId: acme.id, proposalId: p.id }, BOB)).status).toBe("EXECUTED");
    const [pending] = await t.query<Transfer[]>("appTransfers", { address: DAVE.address }, DAVE);
    expect(pending).toMatchObject({ fromKind: "ORG", fromId: acme.id, toKind: "PERSON", toId: lower(DAVE), proposalId: p.id, status: "PENDING" });
    await t.mutate("acceptAppTransfer", { transferId: pending.id }, DAVE);
    expect(await statsRow()).toMatchObject({ publisher_org_id: null, publisher_address: lower(DAVE) });
    expect(await workloadRow()).toMatchObject({ owner_org_id: null, owner_address: DAVE.address });
    expect(await t.store.orgOfApp(APP)).toBeUndefined();
    expect(t.reactor.state<RenownOrganizationState>(acme.id).apps).toEqual([]);
    expect((t.reactor.docs.get(docId) as RenownAppProfileDocument).state.global.publisherDid).toBe(`did:pkh:eip155:1:${DAVE.address}`);
  });

  it("freezes without delay once approved, refuses transfers of a frozen app, and unfreezes", async () => {
    const { t, acme } = await orgApp();
    const freeze = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "FREEZE_APP", payload: { appDid: APP } }, BOB);
    expect(freeze.executableAt).toBe(t.clock.now.toISOString());
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: freeze.id }, BOB);
    expect((await t.store.orgOfApp(APP))?.frozen).toBe(true);
    expect(t.reactor.state<RenownOrganizationState>(acme.id).apps[0].frozen).toBe(true);
    expect((await failure(t.mutate("proposeOrgChange", { orgId: acme.id, kind: "TRANSFER_APP_OUT", payload: { appDid: APP, toKind: "PERSON", toId: DAVE.address } }, BOB))).code).toBe("APP_FROZEN");
    expect(await failure(t.mutate("proposeOrgChange", { orgId: acme.id, kind: "FREEZE_APP", payload: { appDid: APP } }, BOB))).toMatchObject({ field: "payload" });
    const unfreeze = await t.mutate<ProposalOutput>("proposeOrgChange", { orgId: acme.id, kind: "UNFREEZE_APP", payload: { appDid: APP } }, BOB);
    await t.mutate("executeOrgProposal", { orgId: acme.id, proposalId: unfreeze.id }, BOB);
    expect((await t.store.orgOfApp(APP))?.frozen).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Tests |FAIL" | head -6`
Expected: `insertTransfer is not a function`; transfer resolvers missing.

- [ ] **Step 3: Store**

`subgraphs/renown-orgs/store/types.ts`:

```ts
export type TransferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "CANCELLED" | "EXPIRED";

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
  proposalId: string | null;
}

export type TransferPatch = Partial<Pick<TransferRecord, "status" | "decidedAt" | "decidedBy">>;
```

`org_app_transfers: OrgAppTransfersTable;` in `OrgsDB`; `OrgStore` gains:

```ts
  insertTransfer(transfer: TransferRecord): Promise<void>;
  transfer(id: string): Promise<TransferRecord | undefined>;
  /** Newest first; `party` matches either side. */
  transfers(filter: { appDid?: string; party?: { kind: PartyKind; id: string } }): Promise<TransferRecord[]>;
  pendingTransferOf(appDid: string): Promise<TransferRecord | undefined>;
  updateTransfer(id: string, patch: TransferPatch, expected: TransferStatus): Promise<TransferRecord | undefined>;
  /** PENDING transfers whose expiry passed, oldest first. */
  dueTransfers(now: Date, limit: number): Promise<TransferRecord[]>;
  /** False when the app already belongs to an organisation. */
  insertOrgApp(app: OrgAppRecord): Promise<boolean>;
  deleteOrgApp(appDid: string): Promise<boolean>;
  setAppFrozen(appDid: string, frozen: boolean): Promise<void>;
```

Migration (append):

```ts
  await db.schema
    .createTable("org_app_transfers")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("app_did", "text", (col) => col.notNull())
    .addColumn("from_kind", "text", (col) => col.notNull())
    .addColumn("from_id", "text", (col) => col.notNull())
    .addColumn("to_kind", "text", (col) => col.notNull())
    .addColumn("to_id", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .addColumn("expires_at", "timestamptz", (col) => col.notNull())
    .addColumn("decided_at", "timestamptz")
    .addColumn("decided_by", "text")
    .addColumn("proposal_id", "text")
    .execute();
  // At most one PENDING transfer per app.
  await db.schema
    .createIndex("org_app_transfers_one_pending")
    .ifNotExists()
    .unique()
    .on("org_app_transfers")
    .column("app_did")
    .where(sql.ref("status"), "=", "PENDING")
    .execute();
```

`KyselyOrgStore` (import the new types):

```ts
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
  };
}
```

(top level, next to the other mappers) and in the class:

```ts
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
      .limit(limit)
      .execute();
    return rows.map(toTransfer);
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

  async deleteOrgApp(appDid: string): Promise<boolean> {
    const result = await this.db.deleteFrom("org_apps").where("app_did", "=", appDid).executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async setAppFrozen(appDid: string, frozen: boolean): Promise<void> {
    await this.db.updateTable("org_apps").set({ frozen }).where("app_did", "=", appDid).execute();
  }
```

- [ ] **Step 4: Owners across namespaces, and moving an app**

Append to `subgraphs/renown-orgs/store/foreign.ts`:

```ts
import { getAddress } from "viem";
import type { StatsDB } from "../../renown-stats/store/types.js";

export const STATS_NAMESPACE = "renown-stats";

function stats(db: ReadModelDb) {
  return db.queryNamespace<StatsDB>(STATS_NAMESPACE);
}

/** The app profile's document and publisher (lowercase address, organisation), or undefined without a profile. */
export async function appPublisher(
  db: ReadModelDb,
  appDid: string,
): Promise<{ documentId: string; publisherAddress: string; publisherOrgId: string | null } | undefined> {
  const row = await stats(db)
    .selectFrom("app_profile_documents")
    .select(["document_id", "publisher_address", "publisher_org_id"])
    .where("app_did", "=", appDid)
    .executeTakeFirst();
  return row && { documentId: row.document_id, publisherAddress: row.publisher_address.toLowerCase(), publisherOrgId: row.publisher_org_id ?? null };
}

/** Points the app profile at its new publisher: an organisation, or a person (who becomes the publisher address). */
export async function setAppPublisher(db: ReadModelDb, appDid: string, owner: { orgId: string } | { address: string }): Promise<void> {
  await stats(db)
    .updateTable("app_profile_documents")
    .set("orgId" in owner ? { publisher_org_id: owner.orgId } : { publisher_org_id: null, publisher_address: owner.address.toLowerCase() })
    .where("app_did", "=", appDid)
    .execute();
}

/** Moves the workload identity to an organisation, or to a person who becomes its owner address. */
export async function setWorkloadOwner(db: ReadModelDb, appDid: string, owner: { orgId: string } | { address: string }, now: Date): Promise<void> {
  await workloads(db)
    .updateTable("workload_identities")
    .set("orgId" in owner ? { owner_org_id: owner.orgId, updated_at: now } : { owner_org_id: null, owner_address: getAddress(owner.address), updated_at: now })
    .where("did", "=", appDid)
    .execute();
}
```

Create `subgraphs/renown-orgs/core/app-ownership.ts`:

```ts
import { actions as profileActions } from "../../../document-models/renown-app-profile/index.js";
import { actions as orgActions } from "../../../document-models/renown-organization/index.js";
import { pkhDidFor } from "../../renown-stats/core/dids.js";
import type { OrgRuntime } from "../runtime.js";
import { appPublisher, setAppPublisher, setWorkloadOwner } from "../store/foreign.js";

/** Transfers expire 14 days after they were made. */
export const TRANSFER_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type AppOwner = { kind: "ORG"; orgId: string } | { kind: "PERSON"; address: string };

/** Who owns the app according to its profile; undefined without a profile. */
export async function currentOwner(rt: OrgRuntime, appDid: string): Promise<AppOwner | undefined> {
  const publisher = await appPublisher(rt.deps.relationalDb, appDid);
  if (!publisher) return undefined;
  return publisher.publisherOrgId ? { kind: "ORG", orgId: publisher.publisherOrgId } : { kind: "PERSON", address: publisher.publisherAddress };
}

export function sameOwner(a: AppOwner | undefined, b: AppOwner): boolean {
  if (!a || a.kind !== b.kind) return false;
  return a.kind === "ORG" ? a.orgId === (b as { orgId: string }).orgId : a.address === (b as { address: string }).address;
}

/**
 * Moves an app from `from` to `to` everywhere it is recorded: the profile
 * index (renown-stats), the profile document's publisherDid, the workload
 * identity's owner, and org_apps plus the organisation documents. Stats,
 * metrics and history stay keyed by the app DID.
 */
export async function moveApp(rt: OrgRuntime, appDid: string, from: AppOwner, to: AppOwner, now: Date): Promise<void> {
  const db = rt.deps.relationalDb;
  const publisher = await appPublisher(db, appDid);
  if (!publisher) throw new Error(`${appDid} has no app profile`);
  const target = to.kind === "ORG" ? { orgId: to.orgId } : { address: to.address };
  await setAppPublisher(db, appDid, target);
  await rt.execute(publisher.documentId, [
    profileActions.setPublisherDid({ publisherDid: to.kind === "ORG" ? rt.policy().orgDid(to.orgId) : pkhDidFor(to.address) }),
  ]);
  await setWorkloadOwner(db, appDid, target, now);
  const store = rt.store();
  if (from.kind === "ORG") {
    await store.deleteOrgApp(appDid);
    await rt.execute(from.orgId, [orgActions.removeOrgApp({ appDid })]);
  }
  if (to.kind === "ORG") {
    await store.insertOrgApp({ appDid, orgId: to.orgId, frozen: false, addedAt: now });
    await rt.execute(to.orgId, [orgActions.addOrgApp({ appDid, addedAt: now.toISOString() })]);
  }
}
```

- [ ] **Step 5: Transfers area, the three proposal kinds, expiry**

Add to `subgraphs/renown-orgs/schema-security.ts` and to `SECURITY_SDL`:

```ts
export const TRANSFERS_SDL = `
  enum AppTransferStatus {
    PENDING
    ACCEPTED
    DECLINED
    CANCELLED
    EXPIRED
  }

  type AppTransfer {
    id: String!
    appDid: String!
    fromKind: OrgPartyKind!
    fromId: String!
    toKind: OrgPartyKind!
    toId: String!
    status: AppTransferStatus!
    createdAt: String!
    expiresAt: String!
    decidedAt: String
    decidedBy: String
    proposalId: String
  }

  extend type Query {
    "Transfers the caller is part of: by orgId (admins), by address (that address), or by appDid."
    appTransfers(appDid: String, orgId: String, address: String, auth: OrgAuthInput): [AppTransfer!]!
  }

  extend type Mutation {
    "The app's personal publisher offers it to an organisation; an admin of that organisation accepts."
    proposeAppTransfer(appDid: String!, toOrgId: String!, auth: OrgAuthInput): AppTransfer!
    acceptAppTransfer(transferId: String!, auth: OrgAuthInput): AppTransfer!
    "The recipient declines (DECLINED) or the source withdraws (CANCELLED)."
    declineAppTransfer(transferId: String!, auth: OrgAuthInput): AppTransfer!
  }
`;
```

Create `subgraphs/renown-orgs/areas/transfers.ts`:

```ts
import { isOrgAppDid } from "../../../document-models/renown-organization/index.js";
import { currentOwner, moveApp, sameOwner, TRANSFER_TTL_MS, type AppOwner } from "../core/app-ownership.js";
import type { OrgArgs, OrgContext } from "../core/auth.js";
import { requireOrg, requireRole } from "../core/authz.js";
import { badInput, forbidden, notFound, orgError } from "../core/errors.js";
import { iso, isoOrNull } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { PartyKind, TransferRecord } from "../store/types.js";
import { addressArg } from "./members.js";

export function transferOutput(t: TransferRecord) {
  return {
    id: t.id,
    appDid: t.appDid,
    fromKind: t.fromKind,
    fromId: t.fromId,
    toKind: t.toKind,
    toId: t.toId,
    status: t.status,
    createdAt: iso(t.createdAt),
    expiresAt: iso(t.expiresAt),
    decidedAt: isoOrNull(t.decidedAt),
    decidedBy: t.decidedBy,
    proposalId: t.proposalId,
  };
}

function ownerOf(kind: PartyKind, id: string): AppOwner {
  return kind === "ORG" ? { kind: "ORG", orgId: id } : { kind: "PERSON", address: id };
}

/** True when `caller` speaks for that side: the person, or an ACTIVE admin of the organisation. */
async function speaksFor(rt: OrgRuntime, kind: PartyKind, id: string, caller: string): Promise<boolean> {
  if (kind === "PERSON") return id === caller;
  try {
    await requireRole(rt.store(), id, caller, "ADMIN");
    return true;
  } catch {
    return false;
  }
}

/** Records a new PENDING transfer and tells the recipient. The caller holds the app lock. */
export async function createTransfer(
  rt: OrgRuntime,
  input: { appDid: string; from: AppOwner; to: AppOwner; actor: string; proposalId: string | null; now: Date },
): Promise<TransferRecord> {
  const transfer: TransferRecord = {
    id: rt.newId(),
    appDid: input.appDid,
    fromKind: input.from.kind,
    fromId: input.from.kind === "ORG" ? input.from.orgId : input.from.address,
    toKind: input.to.kind,
    toId: input.to.kind === "ORG" ? input.to.orgId : input.to.address,
    status: "PENDING",
    createdAt: input.now,
    expiresAt: new Date(input.now.getTime() + TRANSFER_TTL_MS),
    decidedAt: null,
    decidedBy: null,
    proposalId: input.proposalId,
  };
  await rt.store().insertTransfer(transfer);
  const payload = { transferId: transfer.id, appDid: transfer.appDid, from: transfer.fromId };
  // Recorded on the organisation involved: the recipient when it is one, else the source.
  const orgId = transfer.toKind === "ORG" ? transfer.toId : transfer.fromId;
  await rt.record({
    orgId,
    actor: input.actor,
    action: input.proposalId ? "proposal.TRANSFER_APP_OUT" : "proposeAppTransfer",
    at: input.now,
    details: { ...payload, to: transfer.toId },
    notify: [{ to: transfer.toKind === "ORG" ? "ADMINS" : [transfer.toId], kind: "APP_TRANSFER_REQUEST", payload }],
  });
  return transfer;
}

export const transferResolvers: Area = (rt) => ({
  Query: {
    appTransfers: async (_: unknown, args: OrgArgs & { appDid?: string | null; orgId?: string | null; address?: string | null }, ctx: OrgContext) => {
      const caller = await rt.caller(ctx, "appTransfers", args);
      const store = rt.store();
      const appDid = args.appDid?.trim() || undefined;
      if (args.orgId) {
        await requireRole(store, args.orgId, caller, "ADMIN");
        return (await store.transfers({ appDid, party: { kind: "ORG", id: args.orgId } })).map(transferOutput);
      }
      if (args.address) {
        if (addressArg("address", args.address) !== caller) throw forbidden();
        return (await store.transfers({ appDid, party: { kind: "PERSON", id: caller } })).map(transferOutput);
      }
      if (!appDid) throw badInput("appDid", "Pass appDid, orgId or address");
      const visible: TransferRecord[] = [];
      for (const t of await store.transfers({ appDid })) {
        if ((await speaksFor(rt, t.fromKind, t.fromId, caller)) || (await speaksFor(rt, t.toKind, t.toId, caller))) visible.push(t);
      }
      return visible.map(transferOutput);
    },
  },
  Mutation: {
    proposeAppTransfer: async (_: unknown, args: OrgArgs & { appDid: string; toOrgId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "proposeAppTransfer", args);
      const appDid = args.appDid.trim();
      if (!isOrgAppDid(appDid)) throw badInput("appDid", "appDid must be a did:key");
      return rt.lock(`app:${appDid}`, async () => {
        const owner = await currentOwner(rt, appDid);
        if (!owner) throw notFound("App profile");
        if (owner.kind !== "PERSON" || owner.address !== caller) throw forbidden("Only the app's publisher transfers it");
        await requireOrg(rt.store(), args.toOrgId);
        if (await rt.store().pendingTransferOf(appDid)) throw badInput("appDid", "A transfer of this app is pending");
        const to: AppOwner = { kind: "ORG", orgId: args.toOrgId };
        return transferOutput(await createTransfer(rt, { appDid, from: owner, to, actor: caller, proposalId: null, now: rt.now() }));
      });
    },
    acceptAppTransfer: async (_: unknown, args: OrgArgs & { transferId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "acceptAppTransfer", args);
      const found = await rt.store().transfer(args.transferId);
      if (!found) throw notFound("Transfer");
      return rt.lock(`app:${found.appDid}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const transfer = await store.transfer(found.id);
        if (!transfer || transfer.status !== "PENDING" || transfer.expiresAt.getTime() <= now.getTime()) {
          throw badInput("transferId", "The transfer is no longer pending");
        }
        if (!(await speaksFor(rt, transfer.toKind, transfer.toId, caller))) throw forbidden();
        if (transfer.toKind === "ORG") await requireOrg(store, transfer.toId);
        const from = ownerOf(transfer.fromKind, transfer.fromId);
        const to = ownerOf(transfer.toKind, transfer.toId);
        if (!sameOwner(await currentOwner(rt, transfer.appDid), from)) throw badInput("transferId", "The source no longer owns the app");
        if ((await rt.policy().orgOfApp(transfer.appDid))?.frozen) throw orgError("APP_FROZEN", "The app is frozen by its organisation");
        await moveApp(rt, transfer.appDid, from, to, now);
        const accepted = await store.updateTransfer(transfer.id, { status: "ACCEPTED", decidedAt: now, decidedBy: caller }, "PENDING");
        if (!accepted) throw badInput("transferId", "The transfer is no longer pending");
        const data = { appDid: transfer.appDid, transferId: transfer.id, from: transfer.fromId, to: transfer.toId };
        const done = { to: transfer.toKind === "ORG" ? ("ADMINS" as const) : [transfer.toId], kind: "APP_TRANSFER_DONE" as const, payload: data };
        if (transfer.toKind === "ORG") {
          await rt.record({
            orgId: transfer.toId,
            actor: caller,
            action: "acceptAppTransfer",
            at: now,
            details: data,
            event: { type: "app.transferred_in", data },
            notify: [done, ...(transfer.fromKind === "PERSON" ? [{ to: [transfer.fromId], kind: "APP_TRANSFER_DONE" as const, payload: data }] : [])],
          });
        }
        if (transfer.fromKind === "ORG") {
          await rt.record({
            orgId: transfer.fromId,
            actor: caller,
            action: "acceptAppTransfer",
            at: now,
            details: data,
            event: { type: "app.transferred_out", data },
            notify: [{ to: "ADMINS", kind: "APP_TRANSFER_DONE", payload: data }, ...(transfer.toKind === "PERSON" ? [done] : [])],
          });
        }
        return transferOutput(accepted);
      });
    },
    declineAppTransfer: async (_: unknown, args: OrgArgs & { transferId: string }, ctx: OrgContext) => {
      const caller = await rt.writer(ctx, "declineAppTransfer", args);
      const found = await rt.store().transfer(args.transferId);
      if (!found) throw notFound("Transfer");
      return rt.lock(`app:${found.appDid}`, async () => {
        const store = rt.store();
        const now = rt.now();
        const transfer = await store.transfer(found.id);
        if (!transfer || transfer.status !== "PENDING") throw badInput("transferId", "The transfer is no longer pending");
        const recipient = await speaksFor(rt, transfer.toKind, transfer.toId, caller);
        if (!recipient && !(await speaksFor(rt, transfer.fromKind, transfer.fromId, caller))) throw forbidden();
        const status = recipient ? "DECLINED" : "CANCELLED";
        const updated = await store.updateTransfer(transfer.id, { status, decidedAt: now, decidedBy: caller }, "PENDING");
        if (!updated) throw badInput("transferId", "The transfer is no longer pending");
        const orgId = transfer.toKind === "ORG" ? transfer.toId : transfer.fromId;
        await rt.record({ orgId, actor: caller, action: "declineAppTransfer", at: now, details: { transferId: transfer.id, appDid: transfer.appDid, status } });
        return transferOutput(updated);
      });
    },
  },
});
```

In `subgraphs/renown-orgs/areas/proposal-kinds.ts` add (imports: `isOrgAppDid` from the model, `orgError` already, `requireOrg` from `../core/authz.js`, `createTransfer` from `./transfers.js`, `currentOwner, sameOwner` from `../core/app-ownership.js`):

```ts
/** The org's app named in the payload (BAD_USER_INPUT otherwise) and its frozen flag. */
async function orgAppOf(rt: Parameters<ProposalHandler["validate"]>[0], orgId: string, appDid: string | null | undefined) {
  const app = appDid ? await rt.store().orgOfApp(appDid) : undefined;
  if (!app || app.orgId !== orgId) throw badInput("payload", "payload.appDid must be an app of this organisation");
  return app;
}

const transferOut: ProposalHandler = {
  proposable: true,
  async validate(rt, org, input) {
    const app = await orgAppOf(rt, org.id, input.appDid);
    if (app.frozen) throw orgError("APP_FROZEN", "A frozen app cannot be transferred");
    if (input.toKind !== "PERSON" && input.toKind !== "ORG") throw badInput("payload", "payload.toKind must be PERSON or ORG");
    let toId: string;
    if (input.toKind === "PERSON") {
      toId = payloadAddress(input.toId);
    } else {
      toId = (input.toId ?? "").trim();
      if (toId === org.id) throw badInput("payload", "The app already belongs to this organisation");
      await requireOrg(rt.store(), toId);
    }
    if (await rt.store().pendingTransferOf(app.appDid)) throw badInput("payload", "A transfer of this app is pending");
    return { appDid: app.appDid, toKind: input.toKind, toId };
  },
  async execute({ rt, org, proposal, actor, now }) {
    const appDid = proposal.payload.appDid ?? "";
    return rt.lock(`app:${appDid}`, async () => {
      const app = await rt.store().orgOfApp(appDid);
      if (!app || app.orgId !== org.id) return "The app no longer belongs to the organisation";
      if (app.frozen) return "APP_FROZEN: the app is frozen";
      if (!sameOwner(await currentOwner(rt, appDid), { kind: "ORG", orgId: org.id })) return "The app profile no longer names the organisation";
      if (await rt.store().pendingTransferOf(appDid)) return "A transfer of this app is pending";
      const to = proposal.payload.toKind === "ORG" ? { kind: "ORG" as const, orgId: proposal.payload.toId ?? "" } : { kind: "PERSON" as const, address: proposal.payload.toId ?? "" };
      await createTransfer(rt, { appDid, from: { kind: "ORG", orgId: org.id }, to, actor, proposalId: proposal.id, now });
      return null;
    });
  },
};

function freezeHandler(frozen: boolean): ProposalHandler {
  return {
    proposable: true,
    async validate(rt, org, input) {
      const app = await orgAppOf(rt, org.id, input.appDid);
      if (app.frozen === frozen) throw badInput("payload", frozen ? "The app is already frozen" : "The app is not frozen");
      return { appDid: app.appDid };
    },
    async execute({ rt, org, proposal, actor, now }) {
      const appDid = proposal.payload.appDid ?? "";
      const app = await rt.store().orgOfApp(appDid);
      if (!app || app.orgId !== org.id) return "The app no longer belongs to the organisation";
      if (app.frozen === frozen) return null;
      await rt.execute(org.id, [orgActions.setAppFrozen({ appDid, frozen })]);
      await rt.store().setAppFrozen(appDid, frozen);
      const data = { appDid };
      await rt.record({
        orgId: org.id,
        actor,
        action: frozen ? "proposal.FREEZE_APP" : "proposal.UNFREEZE_APP",
        at: now,
        details: { ...data, proposalId: proposal.id },
        event: { type: frozen ? "app.frozen" : "app.unfrozen", data },
        notify: frozen ? [{ to: "ADMINS", kind: "APP_FROZEN", payload: data }] : [],
      });
      return null;
    },
  };
}
```

and register `TRANSFER_APP_OUT: transferOut, FREEZE_APP: freezeHandler(true), UNFREEZE_APP: freezeHandler(false),` in `PROPOSAL_KINDS`.

Append to `subgraphs/renown-orgs/jobs.ts` (and add `transfersJob(rt)` to `sweepJobs`):

```ts
/** Expires PENDING transfers 14 days after they were made. */
export function transfersJob(rt: OrgRuntime): SweepJob {
  return {
    name: "transfers",
    everyMs: MINUTE_MS,
    async run(now) {
      for (const due of await rt.store().dueTransfers(now, BATCH)) {
        await rt.lock(`app:${due.appDid}`, async () => {
          await rt.store().updateTransfer(due.id, { status: "EXPIRED", decidedAt: now }, "PENDING");
        });
      }
    },
  };
}
```

Register `transferResolvers` in `AREAS`.

- [ ] **Step 6: Run the suite, types, lint**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass.

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add subgraphs/renown-orgs
git commit -m "feat(orgs): app transfers in and out, freeze and unfreeze"
```

---

### Task 8: Release attestations, organisation totals, the org DID document, and the A2 contract gate

**Files:**
- Modify: `subgraphs/renown-orgs/store/{types,migrations,kysely}.ts` (`org_release_attestations`), `store/foreign.ts` (`activeUsersOfApps`), `schema-security.ts` (`ATTESTATIONS_SDL`, `INSIGHTS_SDL`), `resolvers.ts`, `tests/api-contract.test.ts` (`SHIPPED`)
- Create: `subgraphs/renown-orgs/core/attestation.ts`, `areas/attestations.ts`, `areas/insights.ts`
- Test: `subgraphs/renown-orgs/tests/attestations.test.ts`, `tests/insights.test.ts`, `tests/store-contract.ts` (append)

**Interfaces:**
- Consumes: `currentOwner` (Task 7), `hasAppCapability` (A1 authz), `rt.policy()`, `credentialsForApps` (Task 6), `verifyTypedDataOnChain` (renown-auth/core/smart-wallet.ts), `pkhDidFor`.
- Produces:
  - `core/attestation.ts`: `RELEASE_DOMAIN = { name: "Renown Release", version: "1", chainId: 1 }`, `RELEASE_TYPES`, `interface ReleaseMessage { appDid; version; artifactDigest; orgId; issuedAt }`, `verifyRelease(signer, message, signature): Promise<boolean>`. A3's SDK and renown.id `/verify` use the same domain and types.
  - store: `interface AttestationRecord { id; appDid; version; artifactDigest; orgId; signer; signerRole; issuedAt; signature; createdAt }`, `insertAttestation(a): Promise<boolean>`, `attestation(id)`, `attestationBy(appDid, version, signer)`, `attestationsPage(appDid, limit, after?)`, `countAttestationsSince(appDid, since)`, `countOrgAttestationsSince(orgId, since)`.
  - `store/foreign.ts`: `activeUsersOfApps(db, appDids, since): Promise<number>` (sum of per-app distinct users).
  - GraphQL: `ReleaseAttestation`, `ReleaseAttestationPage`, `OrganizationStats`, `attestRelease`, `releaseAttestations`, `releaseAttestation`, `organizationStats`, `organizationDidDocument`; `SHIPPED = ["A1", "A2"]`.

- [ ] **Step 1: Write the failing tests**

Append inside `describeOrgStoreContract` in `subgraphs/renown-orgs/tests/store-contract.ts`:

```ts
    it("keeps one attestation per app, version and signer, pages and counts them", async () => {
      const { store } = await open();
      const attestation = (id: string, version: string, createdAt: Date, signer = ALICE) => ({
        id, appDid: "did:key:za", version, artifactDigest: `sha256:${"a".repeat(64)}`, orgId: "o1", signer, signerRole: "PUBLISHER" as const,
        issuedAt: createdAt, signature: "0xsig", createdAt,
      });
      expect(await store.insertAttestation(attestation("a1", "1.0.0", T0))).toBe(true);
      expect(await store.insertAttestation(attestation("a2", "1.0.0", at(1)))).toBe(false);
      expect(await store.insertAttestation(attestation("a3", "1.0.0", at(1), BOB))).toBe(true);
      expect(await store.insertAttestation(attestation("a4", "1.1.0", at(2)))).toBe(true);
      expect((await store.attestationBy("did:key:za", "1.0.0", BOB))?.id).toBe("a3");
      expect((await store.attestationsPage("did:key:za", 2)).map((a) => a.id)).toEqual(["a4", "a3"]);
      expect((await store.attestationsPage("did:key:za", 5, { createdAt: at(1), id: "a3" })).map((a) => a.id)).toEqual(["a1"]);
      expect(await store.countAttestationsSince("did:key:za", at(1))).toBe(2);
      expect(await store.countOrgAttestationsSince("o1", T0)).toBe(3);
      expect(await store.attestation("a1")).toMatchObject({ signer: ALICE, signerRole: "PUBLISHER" });
    });
```

Create `subgraphs/renown-orgs/tests/attestations.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { RELEASE_DOMAIN, RELEASE_TYPES, type ReleaseMessage } from "../core/attestation.js";
import { ALICE, BOB, CAROL, createOrg, failure, harnessResolvers, insertAppProfile, join, lower, openHarness, resetHarness, STATS_NS, T0, type Harness, type TestResolvers } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const DIGEST = `sha256:${"ab".repeat(32)}`;
type Account = typeof ALICE;
interface Attestation {
  id: string;
  orgId: string;
  signer: string;
  signerRole: string | null;
  signerStillMember: boolean;
  version: string;
}
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

async function attest(t: TestResolvers, who: Account, over: Partial<ReleaseMessage> = {}, signer: Account = who) {
  const message: ReleaseMessage = { appDid: APP, version: "1.4.0", artifactDigest: DIGEST, orgId: "", issuedAt: t.clock.now.toISOString(), ...over };
  const signature = await who.signTypedData({ domain: RELEASE_DOMAIN, types: RELEASE_TYPES, primaryType: "ReleaseAttestation", message });
  return t.mutate<Attestation>("attestRelease", { ...message, signer: signer.address, signature });
}

/** acme owns APP; BOB publishes it, CAROL is a plain member. */
async function orgOwned() {
  const t = harnessResolvers(h);
  await insertAppProfile(h, t, APP, lower(ALICE));
  const { id } = await createOrg(t, ALICE, "acme");
  await join(t, id, BOB, "PUBLISHER");
  await join(t, id, CAROL, "MEMBER");
  await t.mutate("setOrgMemberAppScope", { orgId: id, address: BOB.address, appScope: { all: false, appDids: [APP] } }, ALICE);
  await h.root.withSchema(STATS_NS).updateTable("app_profile_documents").set({ publisher_org_id: id }).execute();
  await t.store.insertOrgApp({ appDid: APP, orgId: id, frozen: false, addedAt: T0 });
  return { t, id };
}

describe("release attestations", () => {
  it("stores a publisher's signed attestation with the role at signing, idempotently", async () => {
    const { t, id } = await orgOwned();
    const stored = await attest(t, BOB, { orgId: id });
    expect(stored).toMatchObject({ orgId: id, signer: lower(BOB), signerRole: "PUBLISHER", signerStillMember: true, version: "1.4.0" });
    expect((await attest(t, BOB, { orgId: id })).id).toBe(stored.id);
    t.tick(1000);
    expect(await failure(attest(t, BOB, { orgId: id }))).toMatchObject({ code: "BAD_USER_INPUT", field: "version" });
    expect((await t.query<{ items: Attestation[] }>("releaseAttestations", { appDid: APP })).items.map((a) => a.id)).toEqual([stored.id]);
    await t.mutate("removeOrgMember", { orgId: id, address: BOB.address }, ALICE);
    expect(await t.query("releaseAttestation", { id: stored.id })).toMatchObject({ signerRole: "PUBLISHER", signerStillMember: false });
  });

  it("refuses forged, unauthorised, mismatched, frozen, malformed and excessive attestations", async () => {
    const { t, id } = await orgOwned();
    expect((await failure(attest(t, CAROL, { orgId: id }, BOB))).code).toBe("FORBIDDEN");
    expect((await failure(attest(t, CAROL, { orgId: id }))).code).toBe("FORBIDDEN");
    expect(await failure(attest(t, BOB, { orgId: "" }))).toMatchObject({ field: "orgId" });
    expect(await failure(attest(t, BOB, { orgId: id, artifactDigest: "sha256:nope" }))).toMatchObject({ field: "artifactDigest" });
    expect(await failure(attest(t, BOB, { orgId: id, issuedAt: new Date(t.clock.now.getTime() + 11 * 60_000).toISOString() }))).toMatchObject({ field: "issuedAt" });
    expect(await failure(attest(t, BOB, { orgId: id, version: "" }))).toMatchObject({ field: "version" });
    await t.store.setAppFrozen(APP, true);
    expect((await failure(attest(t, BOB, { orgId: id }))).code).toBe("APP_FROZEN");
    await t.store.setAppFrozen(APP, false);
    for (let i = 0; i < 100; i++) {
      await t.store.insertAttestation({
        id: `x${i}`, appDid: APP, version: `0.0.${i}`, artifactDigest: DIGEST, orgId: id, signer: lower(ALICE), signerRole: "OWNER",
        issuedAt: t.clock.now, signature: "0x", createdAt: t.clock.now,
      });
    }
    expect((await failure(attest(t, BOB, { orgId: id }))).code).toBe("LIMIT_REACHED");
  });

  it("accepts the publisher of a person-owned app with an empty orgId", async () => {
    const t = harnessResolvers(h);
    await insertAppProfile(h, t, APP, lower(ALICE));
    expect(await attest(t, ALICE)).toMatchObject({ orgId: "", signerRole: null, signerStillMember: true });
    expect(await failure(attest(t, ALICE, { orgId: "o1", version: "2.0.0" }))).toMatchObject({ field: "orgId" });
    expect((await failure(attest(t, BOB, { version: "2.0.0" }))).code).toBe("FORBIDDEN");
    expect((await failure(t.mutate("attestRelease", { appDid: "did:key:z6MkNope", version: "1", artifactDigest: DIGEST, orgId: "", issuedAt: T0.toISOString(), signer: ALICE.address, signature: "0x" }))).field).toBe("appDid");
  });
});
```

Create `subgraphs/renown-orgs/tests/insights.test.ts`:

```ts
import { getAddress } from "viem";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ALICE, BOB, addOwner, createOrg, harnessResolvers, insertCredential, join, lower, openHarness, resetHarness, STATS_NS, T0, type Harness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const APP_A = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";
const APP_B = "did:key:zDnaerDaTF5BXEavCrfRZEk316dpbLsfPDZ3WJ5hRTPFU2169";
const DAY = 86_400_000;
let h: Harness;

beforeAll(async () => {
  h = await openHarness();
});
afterAll(async () => {
  await h.root.destroy();
});
beforeEach(async () => {
  await resetHarness(h);
});

describe("organizationStats", () => {
  it("sums the org apps' 30-day users, counting delegations and recent attestations", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await join(t, id, BOB, "PUBLISHER");
    for (const appDid of [APP_A, APP_B]) await t.store.insertOrgApp({ appDid, orgId: id, frozen: false, addedAt: T0 });
    const value = (app: string, user: string, daysAgo: number) => ({ app_did: app, metric: "m", user_did: user, value: 1, updated_at: new Date(T0.getTime() - daysAgo * DAY) });
    await h.root.withSchema(STATS_NS).insertInto("app_metric_values").values([value(APP_A, "u1", 1), value(APP_A, "u2", 40), value(APP_B, "u1", 2)]).execute();
    await insertCredential(h, { credentialId: "c1", issuer: lower(ALICE), appDid: APP_A });
    await insertCredential(h, { credentialId: "c2", issuer: lower(BOB), appDid: APP_A });
    await insertCredential(h, { credentialId: "c3", issuer: lower(ALICE), appDid: APP_B, revoked: true });
    await t.store.insertAttestation({ id: "a1", appDid: APP_A, version: "1", artifactDigest: `sha256:${"a".repeat(64)}`, orgId: id, signer: lower(ALICE), signerRole: "OWNER", issuedAt: T0, signature: "0x", createdAt: T0 });
    expect(await t.query("organizationStats", { orgId: id })).toEqual({ orgId: id, apps: 2, activeUsers30d: 2, activeDelegations: 1, attestations30d: 1 });
    expect(await t.query("organizationStats", { orgId: "nope" })).toBeNull();
  });
});

describe("organizationDidDocument", () => {
  it("describes the org's owners, page and verified domains; null when unknown or taken down", async () => {
    const t = harnessResolvers(h);
    const { id } = await createOrg(t, ALICE, "acme");
    await addOwner(t, id, BOB);
    await t.store.db.insertInto("org_domains").values({ id: "d1", org_id: id, domain: "acme.example", token: "t", status: "VERIFIED", verified_at: T0, last_checked_at: T0, failures: 0, created_at: T0 }).execute();
    const did = `did:web:renown.test:org:${id}`;
    expect(JSON.parse((await t.query<string>("organizationDidDocument", { orgId: id })) ?? "null")).toEqual({
      "@context": ["https://www.w3.org/ns/did/v1"],
      id: did,
      alsoKnownAs: ["https://renown.test/@acme"],
      controller: [`did:pkh:eip155:1:${getAddress(ALICE.address)}`, `did:pkh:eip155:1:${getAddress(BOB.address)}`],
      verificationMethod: [
        { id: `${did}#owner-1`, type: "EcdsaSecp256k1RecoveryMethod2020", controller: did, blockchainAccountId: `eip155:1:${getAddress(ALICE.address)}` },
        { id: `${did}#owner-2`, type: "EcdsaSecp256k1RecoveryMethod2020", controller: did, blockchainAccountId: `eip155:1:${getAddress(BOB.address)}` },
      ],
      assertionMethod: [`${did}#owner-1`, `${did}#owner-2`],
      service: [
        { id: `${did}#renown`, type: "RenownOrganization", serviceEndpoint: `https://renown.test/org/${id}` },
        { id: `${did}#domain-1`, type: "LinkedDomains", serviceEndpoint: "https://acme.example" },
      ],
    });
    expect(await t.query("organizationDidDocument", { orgId: "nope" })).toBeNull();
    await t.store.updateOrganization(id, { takenDown: true }, T0);
    expect(await t.query("organizationDidDocument", { orgId: id })).toBeNull();
  });
});
```

In `subgraphs/renown-orgs/tests/api-contract.test.ts` set `const SHIPPED: readonly Phase[] = ["A1", "A2"];`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run subgraphs/renown-orgs 2>&1 | grep -E "Tests |FAIL" | head -8`
Expected: missing store methods, missing `../core/attestation.js`, and the API contract test lists the missing A2 fields (`attestRelease`, `organizationStats`, …).

- [ ] **Step 3: Store**

`subgraphs/renown-orgs/store/types.ts`:

```ts
export interface OrgReleaseAttestationsTable {
  id: string;
  app_did: string;
  version: string;
  artifact_digest: string;
  /** "" for person-owned apps. */
  org_id: string;
  signer: string;
  signer_role: OrgRole | null;
  issued_at: Timestamp;
  signature: string;
  created_at: Timestamp;
}

export interface AttestationRecord {
  id: string;
  appDid: string;
  version: string;
  artifactDigest: string;
  orgId: string;
  /** Lowercase. */
  signer: string;
  signerRole: OrgRole | null;
  issuedAt: Date;
  signature: string;
  createdAt: Date;
}
```

`org_release_attestations: OrgReleaseAttestationsTable;` in `OrgsDB`; `OrgStore` gains:

```ts
  /** False when the app, version and signer already have one. */
  insertAttestation(a: AttestationRecord): Promise<boolean>;
  attestation(id: string): Promise<AttestationRecord | undefined>;
  attestationBy(appDid: string, version: string, signer: string): Promise<AttestationRecord | undefined>;
  /** Newest first, strictly after the cursor. */
  attestationsPage(appDid: string, limit: number, after?: { createdAt: Date; id: string }): Promise<AttestationRecord[]>;
  countAttestationsSince(appDid: string, since: Date): Promise<number>;
  countOrgAttestationsSince(orgId: string, since: Date): Promise<number>;
```

Migration (append):

```ts
  await db.schema
    .createTable("org_release_attestations")
    .ifNotExists()
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("app_did", "text", (col) => col.notNull())
    .addColumn("version", "text", (col) => col.notNull())
    .addColumn("artifact_digest", "text", (col) => col.notNull())
    .addColumn("org_id", "text", (col) => col.notNull())
    .addColumn("signer", "text", (col) => col.notNull())
    .addColumn("signer_role", "text")
    .addColumn("issued_at", "timestamptz", (col) => col.notNull())
    .addColumn("signature", "text", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (col) => col.notNull())
    .execute();
  await db.schema
    .createIndex("org_release_attestations_once")
    .ifNotExists()
    .unique()
    .on("org_release_attestations")
    .columns(["app_did", "version", "signer"])
    .execute();
  await db.schema.createIndex("org_release_attestations_app").ifNotExists().on("org_release_attestations").columns(["app_did", "created_at"]).execute();
  await db.schema.createIndex("org_release_attestations_org").ifNotExists().on("org_release_attestations").columns(["org_id", "created_at"]).execute();
```

`KyselyOrgStore` (mapper at top level):

```ts
function toAttestation(row: Selectable<OrgReleaseAttestationsTable>): AttestationRecord {
  return {
    id: row.id,
    appDid: row.app_did,
    version: row.version,
    artifactDigest: row.artifact_digest,
    orgId: row.org_id,
    signer: row.signer,
    signerRole: row.signer_role,
    issuedAt: toDate(row.issued_at),
    signature: row.signature,
    createdAt: toDate(row.created_at),
  };
}
```

```ts
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

  async attestationsPage(appDid: string, limit: number, after?: { createdAt: Date; id: string }): Promise<AttestationRecord[]> {
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
```

Append to `subgraphs/renown-orgs/store/foreign.ts`:

```ts
/** For each app, the distinct users with a report since `since`, summed (a user of two apps counts twice). */
export async function activeUsersOfApps(db: ReadModelDb, appDids: readonly string[], since: Date): Promise<number> {
  if (appDids.length === 0) return 0;
  const rows = await stats(db)
    .selectFrom("app_metric_values")
    .select(["app_did", sql<number>`count(distinct user_did)::int`.as("users")])
    .where("app_did", "in", [...appDids])
    .where("updated_at", ">=", since)
    .groupBy("app_did")
    .execute();
  return rows.reduce((sum, row) => sum + Number(row.users), 0);
}
```

(add `import { sql } from "kysely";` at the top of `foreign.ts`).

- [ ] **Step 4: EIP-712 and the resolvers**

Create `subgraphs/renown-orgs/core/attestation.ts`:

```ts
import { verifyTypedData } from "viem";
import { verifyTypedDataOnChain } from "../../renown-auth/core/smart-wallet.js";

/** EIP-712 domain of release attestations (renown.id /verify and the SDK use the same). */
export const RELEASE_DOMAIN = { name: "Renown Release", version: "1", chainId: 1 } as const;

export const RELEASE_TYPES = {
  ReleaseAttestation: [
    { name: "appDid", type: "string" },
    { name: "version", type: "string" },
    { name: "artifactDigest", type: "string" },
    { name: "orgId", type: "string" },
    { name: "issuedAt", type: "string" },
  ],
} as const;

export interface ReleaseMessage {
  appDid: string;
  version: string;
  /** sha256:<64 lowercase hex> */
  artifactDigest: string;
  /** "" for person-owned apps. */
  orgId: string;
  /** ISO-8601 with a zone. */
  issuedAt: string;
}

/** True when `signer` (EOA offline, else ERC-1271/6492 on chain 1) signed the attestation. */
export async function verifyRelease(signer: string, message: ReleaseMessage, signature: string): Promise<boolean> {
  const typedData = { domain: RELEASE_DOMAIN, types: RELEASE_TYPES, primaryType: "ReleaseAttestation" as const, message };
  try {
    if (await verifyTypedData({ ...typedData, address: signer as `0x${string}`, signature: signature as `0x${string}` })) return true;
  } catch {
    // Malformed for an EOA: a smart wallet may still prove it.
  }
  return verifyTypedDataOnChain({ chainId: RELEASE_DOMAIN.chainId, address: signer, signature, typedData: typedData as never });
}
```

Add to `subgraphs/renown-orgs/schema-security.ts` and to `SECURITY_SDL` (final: `[PROPOSALS_SDL, DOMAINS_SDL, WORKLOADS_SDL, CREDENTIALS_SDL, TRANSFERS_SDL, ATTESTATIONS_SDL, INSIGHTS_SDL]`):

```ts
export const ATTESTATIONS_SDL = `
  type ReleaseAttestation {
    id: String!
    appDid: String!
    version: String!
    artifactDigest: String!
    "Empty for person-owned apps"
    orgId: String!
    signer: String!
    "The signer's role when signing; null for person-owned apps"
    signerRole: OrgRole
    signerStillMember: Boolean!
    issuedAt: String!
    signature: String!
    createdAt: String!
  }

  type ReleaseAttestationPage {
    items: [ReleaseAttestation!]!
    next: String
  }

  extend type Query {
    "Newest first; limit 1-50 (default 20)."
    releaseAttestations(appDid: String!, limit: Int, after: String): ReleaseAttestationPage!
    releaseAttestation(id: String!): ReleaseAttestation
  }

  extend type Mutation {
    "EIP-712 ReleaseAttestation (domain Renown Release / 1 / chain 1) signed by signer; the signature is the authentication."
    attestRelease(appDid: String!, version: String!, artifactDigest: String!, orgId: String!, issuedAt: String!, signer: String!, signature: String!): ReleaseAttestation!
  }
`;

export const INSIGHTS_SDL = `
  type OrganizationStats {
    orgId: String!
    apps: Int!
    "Sum of each app's 30-day active users: an upper bound."
    activeUsers30d: Int!
    activeDelegations: Int!
    attestations30d: Int!
  }

  extend type Query {
    organizationStats(orgId: String!): OrganizationStats
    "The DID document JSON for did:web:<host>:org:<orgId>; null when unknown or taken down."
    organizationDidDocument(orgId: String!): String
  }
`;
```

Create `subgraphs/renown-orgs/areas/attestations.ts`:

```ts
import { isOrgAppDid } from "../../../document-models/renown-organization/index.js";
import { currentOwner } from "../core/app-ownership.js";
import { verifyRelease, type ReleaseMessage } from "../core/attestation.js";
import { hasAppCapability } from "../core/authz.js";
import { badInput, forbidden, limitReached, notFound, orgError } from "../core/errors.js";
import { iso } from "../output.js";
import type { Area, OrgRuntime } from "../runtime.js";
import type { AttestationRecord } from "../store/types.js";
import { addressArg } from "./members.js";

export const MAX_ATTESTATIONS_PER_DAY = 100;
const DAY_MS = 86_400_000;
const FUTURE_SKEW_MS = 600_000;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const STRICT_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const SIGNATURE_RE = /^0x[0-9a-fA-F]+$/;

async function attestationOutput(rt: OrgRuntime, a: AttestationRecord) {
  let stillMember: boolean;
  if (a.orgId) {
    stillMember = (await rt.store().openMember(a.orgId, a.signer))?.status === "ACTIVE";
  } else {
    const owner = await currentOwner(rt, a.appDid);
    stillMember = owner?.kind === "PERSON" && owner.address === a.signer;
  }
  return {
    id: a.id,
    appDid: a.appDid,
    version: a.version,
    artifactDigest: a.artifactDigest,
    orgId: a.orgId,
    signer: a.signer,
    signerRole: a.signerRole,
    signerStillMember: stillMember,
    issuedAt: iso(a.issuedAt),
    signature: a.signature,
    createdAt: iso(a.createdAt),
  };
}

type AttestArgs = ReleaseMessage & { signer: string; signature: string };

export const attestationResolvers: Area = (rt) => ({
  Query: {
    releaseAttestations: async (_: unknown, args: { appDid: string; limit?: number | null; after?: string | null }) => {
      const limit = args.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw badInput("limit", "limit must be an integer from 1 to 50");
      let after: { createdAt: Date; id: string } | undefined;
      if (args.after != null) {
        try {
          const cursor = JSON.parse(Buffer.from(args.after, "base64url").toString("utf8")) as { c?: unknown; i?: unknown };
          const createdAt = typeof cursor.c === "string" ? new Date(cursor.c) : new Date(Number.NaN);
          if (Number.isNaN(createdAt.getTime()) || typeof cursor.i !== "string") throw new Error("malformed");
          after = { createdAt, id: cursor.i };
        } catch {
          throw badInput("after", "after is not a cursor from releaseAttestations");
        }
      }
      const rows = await rt.store().attestationsPage(args.appDid.trim(), limit + 1, after);
      const page = rows.slice(0, limit);
      const last = page.at(-1);
      return {
        items: await Promise.all(page.map((a) => attestationOutput(rt, a))),
        next: rows.length > limit && last ? Buffer.from(JSON.stringify({ c: iso(last.createdAt), i: last.id })).toString("base64url") : null,
      };
    },
    releaseAttestation: async (_: unknown, args: { id: string }) => {
      const found = await rt.store().attestation(args.id);
      return found ? attestationOutput(rt, found) : null;
    },
  },
  Mutation: {
    attestRelease: async (_: unknown, args: AttestArgs) => {
      const now = rt.now();
      const appDid = args.appDid.trim();
      if (!isOrgAppDid(appDid)) throw badInput("appDid", "appDid must be a did:key");
      if (!VERSION_RE.test(args.version)) throw badInput("version", "version: 1-64 letters, digits, '.', '+', '_' or '-'");
      if (!DIGEST_RE.test(args.artifactDigest)) throw badInput("artifactDigest", "artifactDigest must be sha256:<64 lowercase hex>");
      const issuedAt = STRICT_ISO_RE.test(args.issuedAt) ? new Date(args.issuedAt) : new Date(Number.NaN);
      if (Number.isNaN(issuedAt.getTime()) || issuedAt.getTime() > now.getTime() + FUTURE_SKEW_MS) {
        throw badInput("issuedAt", "issuedAt must be an ISO-8601 time, at most 10 minutes ahead");
      }
      const signer = addressArg("signer", args.signer);
      if (!SIGNATURE_RE.test(args.signature)) throw badInput("signature", "signature must be 0x-prefixed hex");
      const message: ReleaseMessage = { appDid, version: args.version, artifactDigest: args.artifactDigest, orgId: args.orgId, issuedAt: args.issuedAt };
      if (!(await verifyRelease(signer, message, args.signature))) throw forbidden("The signature does not match the signer");
      return rt.lock(`app:${appDid}`, async () => {
        const store = rt.store();
        const existing = await store.attestationBy(appDid, args.version, signer);
        if (existing) {
          if (existing.signature === args.signature) return attestationOutput(rt, existing);
          throw badInput("version", "This signer already attested this version");
        }
        if ((await store.countAttestationsSince(appDid, new Date(now.getTime() - DAY_MS))) >= MAX_ATTESTATIONS_PER_DAY) {
          throw limitReached(`At most ${MAX_ATTESTATIONS_PER_DAY} attestations per app per day`);
        }
        const owner = await currentOwner(rt, appDid);
        if (!owner) throw notFound("App profile");
        let signerRole: AttestationRecord["signerRole"] = null;
        if (owner.kind === "ORG") {
          if (args.orgId !== owner.orgId) throw badInput("orgId", "orgId must be the organisation that owns the app");
          if ((await store.orgOfApp(appDid))?.frozen) throw orgError("APP_FROZEN", "The app is frozen by its organisation");
          if (!(await hasAppCapability(store, owner.orgId, signer, appDid))) throw forbidden("The signer cannot publish this app");
          signerRole = (await store.openMember(owner.orgId, signer))?.role ?? null;
        } else {
          if (args.orgId !== "") throw badInput("orgId", "orgId must be empty for a person-owned app");
          if (owner.address !== signer) throw forbidden("Only the app's publisher attests its releases");
        }
        const attestation: AttestationRecord = {
          id: rt.newId(),
          appDid,
          version: args.version,
          artifactDigest: args.artifactDigest,
          orgId: args.orgId,
          signer,
          signerRole,
          issuedAt,
          signature: args.signature,
          createdAt: now,
        };
        if (!(await store.insertAttestation(attestation))) throw badInput("version", "This signer already attested this version");
        if (owner.kind === "ORG") {
          const data = { attestationId: attestation.id, appDid, version: args.version, signer };
          await rt.record({ orgId: owner.orgId, actor: signer, action: "attestRelease", at: now, details: data, event: { type: "release.attested", data } });
        }
        return attestationOutput(rt, attestation);
      });
    },
  },
});
```

Create `subgraphs/renown-orgs/areas/insights.ts`:

```ts
import { getAddress } from "viem";
import { pkhDidFor } from "../../renown-stats/core/dids.js";
import { orgDid } from "../core/config.js";
import { unavailable } from "../core/errors.js";
import type { Area } from "../runtime.js";
import { activeUsersOfApps, credentialsForApps } from "../store/foreign.js";

const DAY_MS = 86_400_000;
const MAX_DELEGATIONS_SCANNED = 2000;

export const insightResolvers: Area = (rt) => ({
  Query: {
    organizationStats: async (_: unknown, args: { orgId: string }) => {
      const store = rt.store();
      const org = await store.organization(args.orgId);
      if (!org || org.takenDown) return null;
      const now = rt.now();
      const since = new Date(now.getTime() - 30 * DAY_MS);
      const apps = (await store.orgApps(org.id)).map((app) => app.appDid);
      try {
        const activeUsers30d = await activeUsersOfApps(rt.deps.relationalDb, apps, since);
        const live = (await credentialsForApps(rt.deps.relationalDb, apps, MAX_DELEGATIONS_SCANNED)).filter(
          (row) => !row.revoked && (row.expirationDate === null || row.expirationDate.getTime() > now.getTime()),
        );
        const counting = new Set<string>();
        for (const row of live) {
          if ((await rt.policy().credentialStatus({ credentialId: row.credentialId, appDid: row.appDid, issuer: row.issuer })).counts) {
            counting.add(row.credentialId);
          }
        }
        return {
          orgId: org.id,
          apps: apps.length,
          activeUsers30d,
          activeDelegations: counting.size,
          attestations30d: await store.countOrgAttestationsSince(org.id, since),
        };
      } catch {
        throw unavailable("Organisation totals cannot be computed right now");
      }
    },
    organizationDidDocument: async (_: unknown, args: { orgId: string }) => {
      const store = rt.store();
      const org = await store.organization(args.orgId);
      if (!org || org.takenDown) return null;
      const didHost = rt.config().didHost;
      const host = didHost.replace(/%3A/gi, ":");
      const did = orgDid(didHost, org.id);
      const owners = (await store.members(org.id, ["ACTIVE"])).filter((member) => member.role === "OWNER");
      const methods = owners.map((owner, i) => ({
        id: `${did}#owner-${i + 1}`,
        type: "EcdsaSecp256k1RecoveryMethod2020",
        controller: did,
        blockchainAccountId: `eip155:1:${getAddress(owner.address)}`,
      }));
      const domains = (await store.verifiedDomains([org.id])).get(org.id) ?? [];
      return JSON.stringify({
        "@context": ["https://www.w3.org/ns/did/v1"],
        id: did,
        alsoKnownAs: [`https://${host}/@${org.handle}`],
        controller: owners.map((owner) => pkhDidFor(owner.address)),
        verificationMethod: methods,
        assertionMethod: methods.map((method) => method.id),
        service: [
          { id: `${did}#renown`, type: "RenownOrganization", serviceEndpoint: `https://${host}/org/${org.id}` },
          ...domains.map((domain, i) => ({ id: `${did}#domain-${i + 1}`, type: "LinkedDomains", serviceEndpoint: `https://${domain}` })),
        ],
      });
    },
  },
});
```

Register `attestationResolvers` and `insightResolvers` in `AREAS`.

- [ ] **Step 5: Run everything**

Run: `pnpm vitest run subgraphs 2>&1 | grep -E "Test Files|Tests |FAIL"`
Expected: all pass, including `api-contract.test.ts` with `SHIPPED = ["A1", "A2"]` and the resolver/SDL gate.

Run: `pnpm tsc 2>&1 | tail -3 && pnpm lint 2>&1 | tail -3 && pnpm test 2>&1 | grep -E "Test Files|Tests " && pnpm vitest run --coverage 2>&1 | grep -E "All files"`
Expected: clean; all pass; coverage ≥ 95 in every column.

- [ ] **Step 6: Commit**

```bash
git add subgraphs/renown-orgs
git commit -m "feat(orgs): release attestations, organisation totals and the org did:web document"
```

---

## A2 rollout

- [ ] Push, PR into `staging`, merge after CI, release on the staging channel, deploy the renown staging tenant. On staging: `organizationDidDocument(orgId: "<a staging org>")` returns JSON with the staging host; `orgCredentialStatus(credentialId: "urn:uuid:00000000-0000-4000-8000-000000000000")` returns null; the renown-orgs logs show the sweeper claiming `proposals` once per minute on one replica only (`org_jobs.last_run_at` advances). Promote to `main` only after A3 has passed staging too.
