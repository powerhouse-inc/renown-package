# Renown Organisations — Design

Date: 2026-10-12. Status: approved for one-shot execution (user: "do it all, except for the achra part").

## 1. Goal

A group, company or team can publish, operate and be the identity behind apps on the Powerhouse platform. An **organisation** is a Renown identity with its own handle, page and DID, whose members are existing Renown identities holding roles. Organisations own app profiles, sign off releases, appear in OIDC tokens and own Vetra environments and apps.

Out of scope (explicitly):
- Achra selling: business details, payouts, billing-admin role, org as licence issuer, reviews. The role set leaves room for `billing` later, but it is not added now.
- Ethereum multisig wallets. Two-owner approval and timelocks replace them.
- Connect drives owned by orgs. The reactor (powerhouse monorepo) has no group primitive (groups were removed in reactor-api migration 003). Follow-up spec: "org grants in reactor-api". Org roles are already exposed via OIDC and the GraphQL API, so a later reactor change can consume them.
- Migrating vetra.io BuilderTeam documents. They stay as they are. A follow-up may link a BuilderTeam to an org.

## 2. Sub-projects and order

| | Repo | Ships |
|---|---|---|
| A | renown-package (`powerhouse-inc/renown-package`) | `powerhouse/renown-organization` model, `renown-orgs` subgraph + store, proposals/timelocks, domains, recovery, freeze, invites, notifications, webhooks, reports, audit log, release attestations, OIDC `orgs` scope + org-restricted clients, org-owned apps in renown-stats, org-aware delegation and workload checks, app contacts, SDK helpers |
| B | renown (renown.id site) | org pages, `/orgs`, create + manage org UI, invite acceptance, notifications inbox, account-menu org switcher, org publishers on app pages, "Member of", `/apps?org=`, `/verify` org + release attestations, `did.json`, admin reports page |
| C | vetra-cloud-package + vetra.io | org-owned environments and apps, membership-aware access checks, org context switcher, create-in-org flows, contacts fields |

Order: A → B → C, each staging first, then main/prod. B and C only call A's GraphQL API.

## 3. Concepts

### 3.1 Identifiers
- `orgId`: the organisation document id (PHID), immutable.
- Org DID: `did:web:<RENOWN_ORG_DID_HOST>:org:<orgId>`. The host defaults to `www.renown.id` (staging: `renown-staging.vetra.io`). It resolves to `https://<host>/org/<orgId>/did.json`, served by the site (B) from `organizationDidDocument(orgId)` (A).
- Handle: the same regex as user handles, `^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$`. Users and orgs share **one namespace**: a handle taken by either is unavailable to both. `/@<handle>` resolves to whichever owns it.

### 3.2 Roles (ranked)
`owner` > `admin` > `publisher` > `member`. A capability granted to a role is granted to every higher role.

| Capability | member | publisher | admin | owner |
|---|---|---|---|---|
| Listed in OIDC `orgs` claim; sees the private member list | ✓ | ✓ | ✓ | ✓ |
| Edit app profiles of org apps in scope; delegate app keys for them; sign release attestations; operate Vetra envs/apps in scope | | ✓ | ✓ | ✓ |
| Edit org profile; invite, change role (up to `publisher`) and remove members/publishers; teams; app scopes; domains; webhooks; org OIDC clients; suspend credentials; accept app transfers in; read audit log | | | ✓ | ✓ |
| Promote to/demote `admin`; propose and approve high-risk changes (§3.5); cancel proposals | | | | ✓ |

**App scope.** Each membership has an `appScope`: `ALL`, or a list of app DIDs. Team grants (§3.3) extend it. Publisher capabilities apply only to apps in scope; owners and admins always have `ALL`.

### 3.3 Teams
Flat (no nesting) named groups inside an org: `{id, slug, name, appDids[]}` plus members. A team adds its `appDids` to its members' publisher scope. Teams appear in the OIDC claim as slugs. Limit 50 teams per org.

### 3.4 Membership lifecycle (two-sided consent)
- **Direct invite.** An admin invites an address or handle with a role ≤ `admin` (only owners may invite `admin`). The record is `invited`. The invitee accepts (`active`) or declines (`declined`) by signing; an admin may revoke the invite (`revoked`). Invites expire after 14 days (`expired`, computed on read).
- **Invite link.** An admin creates a link token (32 random bytes, base64url, only the SHA-256 hash is stored) with role `member` or `publisher`, `maxUses` 1–100 and `expiresAt` ≤ 30 days. Anyone signed in may accept by signing; that creates an `active` membership. The link can be revoked.
- **Leave / remove.** An active member may leave (`left`). An admin removes members up to `publisher`, and owners remove admins (`removed`). Owners are removed only through a proposal.
- **Last-owner rule.** The org always has ≥ 1 owner. An owner cannot leave while they are the only owner.
- **Visibility.** The org setting `membersPublic` (default `false`), plus a per-member `hidden` flag the member controls. Public views and the `memberOf` query show only active members where `membersPublic && !hidden`.
- Limits: 500 active members, 200 pending invites, 20 orgs created per wallet, 50 memberships per wallet.

### 3.5 High-risk changes: proposals and timelocks
Kinds: `ADD_OWNER` (promote an active member), `REMOVE_OWNER` (demote to admin or remove), `TRANSFER_APP_OUT`, `CHANGE_HANDLE`, `DELETE_ORG`, `RECOVER`, `FREEZE_APP`, `UNFREEZE_APP`.

- **Threshold** = `min(2, ownerCount)` owner approvals (`RECOVER`: 0). The proposer's own approval counts.
- **Delay** (`executableAt = max(createdAt + delay, time threshold reached)`): 48 h (`RENOWN_ORG_TIMELOCK_SECONDS`, default 172800) for `ADD_OWNER`, `REMOVE_OWNER`, `TRANSFER_APP_OUT`, `CHANGE_HANDLE` and `DELETE_ORG`; 7 days (`RENOWN_ORG_RECOVERY_SECONDS`, default 604800) for `RECOVER`; 0 for `FREEZE_APP` and `UNFREEZE_APP`, which therefore run once approved.
- **Cancellation.** Any owner cancels a pending proposal before execution; a proposer may always withdraw their own. Proposals expire 14 days after `createdAt` if not executed.
- **Execution.** `executeOrgProposal` (any owner or the proposer), or the store sweeper (every 60 s), runs matured proposals. Execution re-validates preconditions (e.g. the member is still active, the app is still owned) and marks the proposal `FAILED` with a reason otherwise.
- **Single-owner orgs.** The threshold is 1 and the delay still applies. UI and API (`organization.securityWarnings`) flag `SINGLE_OWNER` until a second owner exists.
- Every proposal state change notifies all owners (§3.10).

### 3.6 Domains, recovery, trust
- **Verification.** `addOrgDomain(domain)` returns a token `renown-org=<orgId>;token=<random>`. Proof is either a DNS TXT record at `_renown.<domain>` containing the token string, or `https://<domain>/.well-known/renown.json` containing `{"organizations":[{"id":"<orgId>","token":"<token>"}]}`.
- **Fetch rules** (`checkOrgDomain`): HTTPS only; the resolved IP must be public (no private, loopback, link-local, CGNAT or ULA ranges, checked after DNS resolution); 5 s timeout; 64 KiB cap; no redirects.
- **Uniqueness.** A domain is verified for at most one org; the first verified wins. A later claim gets `DOMAIN_TAKEN`.
- **Re-checks.** A daily sweeper re-checks verified domains. After 3 consecutive failures (≥ 3 days) the domain lapses to `LAPSED` and stops counting as verified.
- **Badge.** "Verified: <domain>" for each verified domain; "Unverified organisation" when there are none. If an org's display name equals, case-insensitively, the name of a *different* org that has a verified domain, its page and directory row show "Not affiliated with the verified <name>".
- **Recovery.** Anyone controlling a domain that has been `VERIFIED` for the org ≥ 14 days publishes `renown-org-recover=<orgId>;owner=<0xaddress>` (TXT `_renown.<domain>` or `recover` field in `renown.json`) and calls `startOrgRecovery(orgId, domain, newOwner)`. That creates a `RECOVER` proposal (threshold 0, 7-day delay). All owners are notified and any owner can cancel. Execution makes `newOwner` an active owner (creating the membership).
- **Emergency freeze.** `FREEZE_APP` (threshold `min(2, owners)`, no delay) marks an org app frozen. While frozen: delegation credentials for the app do not count (`hasDelegation` false); app-profile writes and workload tokens are refused; the app page shows "Frozen by <org>". `UNFREEZE_APP` reverses it.

### 3.7 Apps and provenance
- **Org-owned apps.** `renown-stats.app_profile_documents` gains `publisher_org_id` (nullable). For org-owned apps, `publisherDid` in the document is the org DID and `appProfile.publisherOrg` resolves the org.
- **App writes** (`upsertAppProfile`, still relayed by Vetra with the registration token): if the app is org-owned, the caller must be an active member with publisher capability for the app, and the app must not be frozen. A first claim with `publisherOrgId` requires the same, plus a workload identity whose `owner_org_id` equals the org.
- **Transfer in** (person → org): the current publisher calls `proposeAppTransfer(appDid, toOrgId)`, then an admin of the target org calls `acceptAppTransfer(transferId)`. On acceptance `publisher_org_id` is set, the document gets `SET_PUBLISHER_DID(orgDid)` and the workload identity gets `owner_org_id`. Stats, metrics and history are keyed by appDid and stay intact. Transfers expire after 14 days.
- **Transfer out** (org → person or another org): a `TRANSFER_APP_OUT` proposal. On execution it becomes a pending transfer that the receiving address or org admin must accept.
- **Delegations for org apps.** A delegation credential for an org app counts (`hasDelegation`, `actsFor`, `/verify` "valid") only if, at check time:
  - its issuer is an active member with publisher capability for that app;
  - it is not org-suspended;
  - the app is not frozen.

  This gives derived revocation: removing or demoting a member immediately stops their delegations counting.
- **Explicit suspension.** Admins suspend individual credentials, or all of a member's credentials for org apps. Leaving or being removed auto-suspends that member's org-app credentials (recorded in `org_credential_suspensions`), so the effect survives re-joining.
- **`orgCredentialStatus(credentialId)`** returns `{appDid, orgId, counts, reason: ISSUER_NOT_MEMBER | ISSUER_NOT_PUBLISHER | SUSPENDED | APP_FROZEN | null}`.
- **Service accounts.** Workload identities gain `owner_org_id` (set at registration from Vetra, or on transfer) and `disabled` (bool). Org admins list them and disable/enable them (`setOrgWorkloadDisabled`). Disabled identities get no tokens.
- **Release attestations.** A member with publisher capability signs EIP-712:
  ```
  domain {name:"Renown Release", version:"1", chainId:1}
  ReleaseAttestation {appDid string, version string, artifactDigest string, orgId string, issuedAt string}
  ```
  `artifactDigest` is `sha256:<64 hex>`, `issuedAt` is ISO-8601, and `orgId` is `""` for person-owned apps. `attestRelease` verifies the signature (EOA, or ERC-1271/6492), checks the signer's capability at submit time, and stores it. Rules: an `(appDid, version)` pair holds at most one attestation per signer; at most 100 per app per day.
  - Queries: `releaseAttestations(appDid, limit, after)` and `releaseAttestation(id)` return the signer, their role at signing and whether the signer is still a member.
  - **On `/verify`:** an attestation JSON is detected and verified client-side, then cross-checked with `releaseAttestation`. It reads "Release 1.4 of <App> — published by Acme, signed off by Alice".
- **Contacts.** `renown-app-profile` gains `supportContact` and `securityContact`, each optional and ≤ 200 chars, an email (`mailto:` added on render) or an https URL. Set through `SET_PROFILE` (same patch semantics), relayed through `upsertAppProfile`.

### 3.8 OIDC
- **`orgs` scope.** New scope `orgs` → claim `orgs: [{id, did, handle, name, role, teams: [slug], verifiedDomains: [domain]}]`. It lists the subject's active memberships, including hidden ones (the subject consents). Archived or taken-down orgs are excluded. The claim is added to `claims_supported` and `/userinfo`.
- **Client restriction.** OIDC clients gain `allowedOrgs: [{orgId, minRole}]`. A subject is allowed if `isSubjectAllowed(...)` (existing) OR they are an active member of a listed org with role ≥ `minRole`.
- **Org-owned clients.** `registerOrgOidcClient(orgId, name, redirectUris)` is signed by an admin. The client is owned by the org and restricted to it (`allowedOrgs=[{orgId, member}]`, `allowAnySubject=false`). The secret is shown once. Admins update, rotate and disable it.

### 3.9 Webhooks
- **Registration.** Admins register up to 10 endpoints: an HTTPS URL (same public-IP rules as §3.6) plus an event list. The secret (32 bytes) is shown once and stored encrypted with the existing AES-256-GCM key helper (the `RENOWN_WORKLOAD_ENCRYPTION_KEY` mechanism; reuse its module).
- **Events:** `member.invited`, `member.joined`, `member.left`, `member.removed`, `member.role_changed`, `team.changed`, `app.transferred_in`, `app.transferred_out`, `app.frozen`, `app.unfrozen`, `credential.suspended`, `proposal.created`, `proposal.approved`, `proposal.cancelled`, `proposal.executed`, `domain.verified`, `domain.lapsed`, `release.attested`, `org.updated`.
- **Delivery.** POST JSON `{id, type, orgId, createdAt, data}` with header `Renown-Signature: t=<unix>,v1=<hex hmac-sha256(secret, "<t>.<body>")>`. Retries back off at 1 min, 5 min, 30 min, 2 h and 12 h, then the delivery is `FAILED`. After 50 consecutive failures the endpoint auto-disables. The last 100 deliveries per endpoint are kept for the UI. A `testOrgWebhook` mutation sends a ping.

### 3.10 Notifications (decided: in-app inbox; no email)
- Table `org_notifications(recipient address, kind, org_id, payload jsonb, created_at, read_at)`.
- Kinds: `INVITED`, `INVITE_ACCEPTED`, `ROLE_CHANGED`, `REMOVED`, `PROPOSAL_CREATED`, `PROPOSAL_NEEDS_APPROVAL`, `PROPOSAL_EXECUTED`, `PROPOSAL_CANCELLED`, `RECOVERY_STARTED`, `APP_TRANSFER_REQUEST`, `APP_TRANSFER_DONE`, `APP_FROZEN`, `DOMAIN_LAPSED`, `DELEGATION_ADDED` (a member delegated a key for an org app; sent to admins).
- Queries (bearer-authenticated, `ctx.user.address`): `myNotifications(unreadOnly, limit, after)` and `myUnreadNotificationCount`. Mutation `markNotificationsRead(ids | all)`.
- Retention: 90 days.

### 3.11 Reports, moderation, handle disputes
- **Reports.** `reportOrganization(orgId, reason: IMPERSONATION | HANDLE_DISPUTE | SPAM | ABUSE | OTHER, details ≤ 1000)`: any signed-in address, at most 5 per address per day.
- **Platform admins** (`RENOWN_PLATFORM_ADMINS`, comma-separated addresses) see `orgReports(status)` and resolve each one:
  - `DISMISS`.
  - `TAKE_DOWN`: the org gets `takenDown=true`; its page shows a takedown notice; it is excluded from the directory, search, claims and `did.json` (404).
  - `RELEASE_HANDLE`: the org is renamed to `org-<first 8 of id>` and the old handle is reserved for 30 days. During that window a verified-domain org whose domain label equals the handle may claim it.
  - `RESTORE`.
- Every resolution is audited.

### 3.12 Audit log
- **What is logged.** Every successful org mutation and every system action (sweeper execution, domain lapse) writes `org_audit(org_id, at, actor address|"system", action, details jsonb)`.
- **Access.** Admins query `orgAuditLog(orgId, limit, after)` and export it with `orgAuditExport(orgId)` (JSON, ≤ 10 000 rows). Members see nothing.
- **Signed record.** The org document's operation history mirrors the state-changing actions as the signed record.

### 3.13 Directory, pages, totals
- **Directory.** Orgs are listed in `/orgs` and in `organizationSearch(query, limit, after)` only when `listed=true` (opt-in, like people), prefix-matched on handle/name, with a keyset cursor.
- **Totals.** `organizationStats(orgId)` sums org apps: app count, `activeUsers30d` (sum per app; documented as an upper bound), active delegations, and release attestations in the last 30 days.
- **Archive.** `DELETE_ORG` requires zero owned apps (otherwise `ORG_HAS_APPS`). It archives: `archived=true`, the page shows "Archived", the org is out of the directory and claims, all memberships end, and the handle is reserved for 90 days.

## 4. Sub-project A — backend design (renown-package)

### 4.1 Document model `powerhouse/renown-organization` (extension `.rorg`, name "Renown Organization")
- **Modules:** `profile`, `members`, `apps`, `domains`, `security`. It is a signed record mirror. The reducers validate shapes and invariants that are pure (last-owner, unique ids, limits); authorization is in the subgraph (as for every other renown model).
- **State:** `handle, name, bio (≤280), website, avatar (AttachmentRef), links[≤8]{id,label,url}, listed (Boolean!) , membersPublic (Boolean!), archived (Boolean!), takenDown (Boolean!), createdBy (EthereumAddress), members[{id, address, role, status, appScope{all:Boolean!, appDids[]}, hidden(Boolean!), joinedAt, updatedAt}], teams[{id, slug, name, appDids[], memberIds[]}], apps[{appDid, addedAt, frozen(Boolean!)}], domains[{id, domain, status: PENDING|VERIFIED|LAPSED, verifiedAt}], suspendedCredentialIds[String!]!`.
  - Enums: `OrgRole{OWNER ADMIN PUBLISHER MEMBER}` and `MemberStatus{INVITED ACTIVE DECLINED LEFT REMOVED REVOKED}`.
- **Operations** (the input carries every id and timestamp):
  - Profile: `SET_ORG_PROFILE` (patch), `SET_ORG_HANDLE`, `SET_ORG_LISTED`, `SET_MEMBERS_PUBLIC`, `ARCHIVE_ORG`, `SET_TAKEN_DOWN`.
  - Members: `INVITE_MEMBER`, `SET_MEMBER_STATUS`, `SET_MEMBER_ROLE`, `SET_MEMBER_APP_SCOPE`, `SET_MEMBER_HIDDEN`, `ADD_TEAM`, `UPDATE_TEAM`, `REMOVE_TEAM`, `SET_TEAM_MEMBERS`.
  - Apps: `ADD_ORG_APP`, `REMOVE_ORG_APP`, `SET_APP_FROZEN`.
  - Domains: `ADD_DOMAIN`, `SET_DOMAIN_STATUS`, `REMOVE_DOMAIN`.
  - Security: `SUSPEND_CREDENTIALS`, `UNSUSPEND_CREDENTIAL`.
- **Errors include** `InvalidHandleError`, `LastOwnerError` (a role/status change would leave 0 active owners), `MemberNotFoundError`, `DuplicateMemberError` (an active/invited record for the same address), `TeamNotFoundError`, `DuplicateTeamSlugError`, `AppNotFoundError`, `DuplicateAppError`, `DomainNotFoundError`, `DuplicateDomainError`, `TooManyLinksError`, `InvalidLinkError`, `NameLengthError`, `BioTooLongError`, `TooManyTeamsError`, `TooManyMembersError`.
- **Coverage.** Reducer coverage stays ≥ 95%.

### 4.2 `renown-orgs` subgraph (new, `subgraphs/renown-orgs`)
- **Store.** Kysely namespace `renown-orgs`, with a memory store plus a PG/PGlite contract-tested store, like renown-stats. Tables:
  - `organizations(id, handle unique lower, name, listed, members_public, archived, taken_down, created_by, created_at, updated_at, avatar_ref, bio, website, links)`;
  - `org_members(id, org_id, address, role, status, app_scope_all, app_dids, hidden, invited_by, joined_at, ended_at, updated_at)` with membership intervals kept (rows are not deleted) for "role at time T";
  - `org_teams`, `org_team_members`, `org_invite_links(id, org_id, token_hash, role, max_uses, uses, expires_at, revoked)`;
  - `org_proposals(id, org_id, kind, payload, proposer, approvals jsonb, status PENDING|EXECUTED|CANCELLED|EXPIRED|FAILED, threshold, created_at, executable_at, executed_at, reason)`;
  - `org_domains(id, org_id, domain unique-when-verified, token, status, verified_at, last_checked_at, failures)`;
  - `org_app_transfers(id, app_did, from_kind, from_id, to_kind, to_id, status, created_at, decided_at)`;
  - `org_credential_suspensions(org_id, credential_id, reason, at)`, `org_apps(org_id, app_did unique, frozen, added_at)`;
  - `org_webhooks`, `org_webhook_deliveries`, `org_notifications`, `org_reports`, `org_audit`, `org_release_attestations(id, app_did, version, artifact_digest, org_id, signer, signer_role, issued_at, signature, created_at)`, `org_oidc_clients(client_id, org_id)`, `reserved_handles(handle, until, reason)`.
- **Authentication for writes.** Same patterns as renown-auth:
  - either a host-resolved `ctx.user.address` (bearer), or a signed-message `auth: {address, signature, timestamp}`;
  - the message is `Renown organization <MUTATION_NAME> <orgId or "-"> <sha256 hex of canonical JSON of the mutation's other args> at <timestamp>`;
  - canonical JSON means keys sorted recursively, no whitespace, undefined dropped;
  - the 10-minute window and ERC-1271/6492 fallback come from `core/signed-message.ts` + `core/smart-wallet.ts` (reuse; move to a shared `core/` if they are subgraph-local).
- **Authorization.** One module, `authz.ts`: `requireRole(store, orgId, address, minRole)`, `hasAppCapability(store, orgId, address, appDid)`.
- **Dispatch.** Mutations dispatch to the org document through the in-process reactorClient (create on `createOrganization`), then update the store in one keyed lock per orgId. Store-only state (proposal approvals, webhooks, notifications, reports, invite-link hashes) is never put in the document.
- **GraphQL surface** (names are binding for B and C):
  - **Queries:**
    - `organization(id | handle)`, `organizationSearch`, `organizationsByMember(address)` (public memberships only unless the caller is that address), `organizationMembers(orgId, includeInactive)` (private lists for members only), `orgMembership(orgId, address)` → `{role, status, appScope, teams}` (public endpoint used by Vetra: returns role/status only for active members, `null` otherwise; no private fields), `organizationStats`, `organizationDidDocument`;
    - `orgProposals(orgId, status)`, `orgInvites(orgId)`, `myOrgInvites`, `orgInviteLink(token)` (preview: org name/handle/role/expired), `orgDomains`, `orgWebhooks`, `orgWebhookDeliveries`, `orgAuditLog`, `orgAuditExport`, `orgCredentials(orgId)` (delegations for org apps with issuer membership + `orgCredentialStatus`), `orgCredentialStatus(credentialId)`, `orgWorkloads(orgId)`, `appTransfers(appDid | orgId | address)`;
    - `releaseAttestations`, `releaseAttestation`, `myNotifications`, `myUnreadNotificationCount`, `orgReports(status)`, `orgHandleAvailability(handle)`.
  - **Mutations:**
    - Org and membership: `createOrganization`, `updateOrganization`, `setOrgListed`, `inviteOrgMember`, `respondToOrgInvite(accept)`, `revokeOrgInvite`, `createOrgInviteLink`, `revokeOrgInviteLink`, `acceptOrgInviteLink`, `leaveOrganization`, `removeOrgMember`, `setOrgMemberRole` (≤ admin), `setOrgMemberAppScope`, `setMyOrgMembershipHidden`, `createOrgTeam`, `updateOrgTeam`, `deleteOrgTeam`, `setOrgTeamMembers`.
    - Proposals and recovery: `proposeOrgChange(kind, payload)`, `approveOrgProposal`, `cancelOrgProposal`, `executeOrgProposal`, `startOrgRecovery`.
    - Domains: `addOrgDomain`, `checkOrgDomain`, `removeOrgDomain`.
    - Apps and credentials: `proposeAppTransfer`, `acceptAppTransfer`, `declineAppTransfer`, `suspendOrgCredentials(credentialIds | memberAddress)`, `unsuspendOrgCredential`, `setOrgWorkloadDisabled`, `attestRelease`.
    - Webhooks: `createOrgWebhook`, `updateOrgWebhook`, `deleteOrgWebhook`, `testOrgWebhook`.
    - OIDC clients: `registerOrgOidcClient`, `updateOrgOidcClient`, `rotateOrgOidcClientSecret`.
    - Notifications and reports: `markNotificationsRead`, `reportOrganization`, `resolveOrgReport`.
- **Errors** are GraphQL errors with `extensions.code` from: `BAD_USER_INPUT`, `FORBIDDEN`, `NOT_FOUND`, `HANDLE_TAKEN`, `HANDLE_RESERVED`, `LAST_OWNER`, `LIMIT_REACHED`, `DOMAIN_TAKEN`, `DOMAIN_PROOF_MISSING`, `ORG_HAS_APPS`, `APP_FROZEN`, `PROPOSAL_NOT_EXECUTABLE`, `RATE_LIMITED`, `SERVICE_UNAVAILABLE`.
- **Rate limits.** 60 org writes per address per minute; invites 50/org/hour.
- **Sweeper.** One 60 s interval, started from the subgraph's `onSetup`, guarded by a PG advisory lock so that only one replica runs it. It executes and expires proposals, expires transfers, re-checks domains daily, delivers webhooks, and prunes notifications.

### 4.3 Changes to existing subgraphs
- **renown-stats:** `publisher_org_id` column; `upsertAppProfile` org branch (§3.7); `appProfile.publisherOrg { id handle name did verifiedDomains }`; `appProfiles(..., orgId)` filter; `appProfilesByPublisher` accepts the org DID; `hasDelegation`/`actsFor` consult the org rules through an `OrgPolicy` interface injected from renown-orgs (no import cycle: a shared `core/org-policy.ts` with the store reader); frozen apps are refused; contacts fields.
- **renown-workload:** `owner_org_id` and `disabled` columns; `registerWorkloadIdentity(ownerOrgId?)` (the registration token still gates it; when present the address must be a publisher in the org); a disabled identity gets no tokens.
- **renown-read-model:** `renownHandleAvailability` also checks org handles and reserved handles. The renown-auth `renown_upsertProfile` handle check also refuses org handles. `renownUser` gains `memberOf: [{orgId, handle, name, role}]` (public memberships).
- **renown-oidc:** the `orgs` scope and claim; `allowedOrgs` on clients (column `allowed_orgs jsonb default '[]'`); org-owned clients created through the renown-orgs mutations, which call the oidc store.
- **renown-app-profile model:** `supportContact` and `securityContact` in place on v1 (JSON + codegen, like `listed`).

### 4.4 SDK helpers
`sdk/orgs.ts`, exported as `renown-package/orgs` in the `package.json` exports, framework-free:
- `ORG_ROLES`, `roleAtLeast(role, min)`, `orgsFromClaims(idTokenClaims)`, `hasOrgRole(claims, orgIdOrHandle, minRole)`;
- `verifyWebhookSignature(secret, header, rawBody, toleranceSec=300)`;
- `fetchOrgMembership(endpoint, orgId, address)`;
- `orgMessage(mutation, orgId, args, timestamp)` and `canonicalJson(value)`, which clients use to sign writes.

The site and vetra.io copy-pin the message vectors in tests (as with the profile message).

## 5. Sub-project B — renown.id site
- **Routes:**
  - `/orgs` (directory + search);
  - `/org/new` (create, signed);
  - `/@<handle>`, which resolves user or org: the `profile/[id]` page branches on `organization(handle)`, or uses a new `pages/org/[id].tsx` routed by a rewrite after lookup. Ruling for the plan: `/@handle` → server-side lookup → render the org page component when the handle belongs to an org;
  - `/org/[id]` canonical-by-handle;
  - `/org/[id]/manage/{members,teams,apps,security,domains,webhooks,oidc,audit,settings}`;
  - `/org/[id]/did.json` (API route, JSON from `organizationDidDocument`; 404 when absent);
  - `/invite/[token]` (link preview + accept);
  - `/notifications`;
  - `/admin/reports` (platform admins only; others get 404).
- **Org page.** Hero (avatar, name, @handle, verified domains or "Unverified organisation", affiliation warning), bio and links, apps grid with totals (`organizationStats`), public members, Report button, JSON-LD `Organization`.
- **Manage pages:**
  - **members:** invite by address/handle, invite links, roles, app scope, remove, pending;
  - **teams;**
  - **apps:** org apps, frozen state, pending transfers in and out, accept transfer, propose transfer out, freeze proposal;
  - **security:** single-owner warning, owners, proposals with countdowns, approve/cancel/execute, delegations view with status and suspend/unsuspend (per credential, per member), service accounts with disable, recovery explainer;
  - **domains:** add, instructions for both methods, check, status;
  - **webhooks:** create (secret shown once), events, deliveries, test;
  - **oidc:** org clients (secret shown once);
  - **audit:** table + export;
  - **settings:** profile, handle-change proposal, listed, membersPublic, delete-org proposal.
- **Changes to existing pages:**
  - account menu: an org switcher section "Your organisations" (links to each org's manage page; the selected org is remembered in localStorage under `renown.activeOrg`) and "Create organisation";
  - header: a notifications bell with unread count (bearer, polled every 60 s while the tab is visible);
  - app page: the publisher card shows the org (logo, name, verified badge) plus "signed off by" for the latest attestation, contacts, and a "Frozen by <org>" banner;
  - profile: "Member of" chips;
  - `/apps`: `?org=<handle>` filter chip;
  - `/me`: memberships and pending invites;
  - `/verify`: org publisher on credential parties, `orgCredentialStatus` reasons, a new "Release attestation" detection type.
- **Writes.** A signed-message helper `services/org-signed-messages.ts`, mirroring the backend vectors, plus `/api/org/[mutation]` passthrough POST routes like `/api/profile/update`. Mutations that accept the bearer may call directly. Ruling: all writes go through the signed message via the wallet shell (consistent with profile edits); reads go direct to GraphQL.
- **Tests.** Playwright with stub-switchboard fixtures for every new page; `PAGES` entries for the layout invariants (public pages: `/orgs`, the org page, the invite page) and STATES for manage pages; unit specs for the message vectors and helpers. The new specs are added to `.github/workflows/e2e.yml`.

## 6. Sub-project C — Vetra
- **vetra-cloud-package:**
  - shared `shared/renown-orgs.ts`: `orgMembership(orgId, address)` over HTTP against `RENOWN_ORGS_ENDPOINT` (default `<renown switchboard>/graphql/renown-orgs`), with a 30 s positive / 10 s negative LRU cache and fail-closed on error;
  - `canOperate(caller, {owner, ownerOrgId, appDid?})` = owner match || admin || active org member with publisher capability (for an app-linked env: capability for that app); `canView` = owner || admin || any active member.
- **vetra-cloud-environment model:**
  - `ownerOrgId: String` and `orgOperators: [EthereumAddress!]!` (initial `[]`);
  - op `SET_OWNER_ORG {ownerOrgId, operators}`, accepted from the current owner or system;
  - op `SYNC_ORG_OPERATORS {operators}`, system-only;
  - `assertOwner`: when `ownerOrgId` is set, a user signer must be in `orgOperators`.
  - A sync job in the observability subgraph (every 5 min, plus on-demand `syncEnvironmentOrg(envId)` that vetra.io calls before signed actions) writes `SYNC_ORG_OPERATORS` with active members whose capability covers the env.
- **Resolvers:**
  - observability (`myEnvironments` gains scope `ORG` with `orgId`; owner checks become `canOperate`);
  - vetra-apps (`apps.owner_org_id`; `myApps(orgId)`; `createApp(orgId?)` requires publisher in org and registers the workload with `ownerOrgId`; `loadAppForOwner` → `canOperate`; `owner_org_id` lazily synced from Renown `appProfile.publisherOrg` on read);
  - vetra-licensing `resolveOwnerApp` → `canOperate` (access only; no Achra/licensing features changed);
  - app-profile relay passes `supportContact` and `securityContact`.
- **vetra.io** (both `main` and `staging`): an org context switcher in the navbar (personal + orgs from `organizationsByMember(me)`, stored in localStorage `vetra.activeOrg`); apps and environments lists follow the context; "New app" and "New environment" create in the context; app settings get a "Transfer to organisation" link to renown.id; the profile tab gets contact fields; an org badge shows on app and env pages.

## 7. Think-beyond items included
- Org DID (`did:web`) resolvable by third parties.
- Derived revocation of delegations.
- Membership intervals so "role at signing time" is provable.
- Org-restricted and org-owned OIDC clients (internal SSO).
- Impersonation-name warning.
- Recovery that owners can veto.
- An advisory-locked single sweeper.
- Webhook replay protection (timestamped HMAC).
- Audit export.
- Service-account disable.
- The single-owner warning.

## 8. Recorded follow-ups (not built)
- Connect drive grants from org roles (reactor-api group primitive).
- BuilderTeam ↔ org linking.
- Email notifications.
- Nested sub-teams.
- Achra selling (business details, payouts, billing role, licence issuer, reviews).

## 9. Testing and rollout
- **Testing by sub-project:**
  - A: vitest (reducers ≥ 95%, store contract tests on memory + PGlite, resolver tests with harness, signed-message vectors, SSRF guard tests with a fake resolver, sweeper tests with an injected clock), tsc, oxlint.
  - B: Playwright + layout invariants, pnpm lint/build.
  - C: vitest for `canOperate`/sync/resolvers, the vetra.io unit + licensing journeys.
- **Rollout:** staging first per repo (renown-package staging channel → renown deploy/staging → vetra staging), smoke on staging, then main/prod.
- **Configuration:** new env vars default to safe values (`RENOWN_PLATFORM_ADMINS` defaults to `ADMINS`; `RENOWN_ORG_DID_HOST` per tenant).

## 10. Clarifications made during implementation (binding)

- **Owners in the DID document.** `did.json` lists every active owner as a controller and verification method, regardless of `membersPublic` or a member's `hidden` flag. Owners are the organisation's keys, so they are always public.
- **Credential status privacy.** `orgCredentialStatus` is public. Its reason reveals whether the credential's own signer is still a member or publisher of the owning org. It describes only the signer of a credential the caller already holds, never arbitrary addresses.
- **Release attestation timing.** `issuedAt` must be no more than 5 minutes ahead of the server clock and no more than 30 days old. It is stored and returned exactly as signed.
- **Role at signing.** `signerRole` is the role at acceptance time. `signerStillMember` turns false once the signer leaves, even if they rejoin later.
- **Member-level suspensions.** If a departing member's credentials can't be read, the member is suspended as a whole (`org_member_suspensions`). This covers every delegation they issued for the org's apps up to the suspension time, compared in UTC. An admin lifts it by unsuspending one of the covered credentials.
- **Proposal approvals.** Only approvals from currently active owners count. The effective threshold is max(stored threshold, min(2, current active owners)).
- **Signed-write replay.** A signed write is accepted once. The key is sha256(lowercased address + "\n" + message).
- **Verified domains.** Only owners may remove a verified domain.
