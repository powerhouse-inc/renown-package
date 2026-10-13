# Renown organisations: rollout

## Per-tenant configuration

| Variable | Value | Notes |
| --- | --- | --- |
| `RENOWN_ORG_DID_HOST` | prod `www.renown.id`, staging `renown-staging.vetra.io` | The did:web host of org DIDs (`did:web:<host>:org:<id>`). Unset means `www.renown.id`, so staging MUST set it. |
| `RENOWN_PLATFORM_ADMINS` | comma-separated addresses | Resolve reports and take organisations down. Defaults to `ADMINS`. |
| `RENOWN_ORG_TIMELOCK_SECONDS` | default `172800` (48 h) | Delay of ADD_OWNER, REMOVE_OWNER, TRANSFER_APP_OUT, CHANGE_HANDLE and DELETE_ORG proposals. |
| `RENOWN_ORG_RECOVERY_SECONDS` | default `604800` (7 d) | Delay of RECOVER proposals. |
| `RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY` | base64 of 32 bytes | Required for webhooks (it seals the signing secrets); without it webhooks are unavailable. Already used by renown-workload. |
| `RENOWN_TRUSTED_READ_TOKEN` | random secret (e.g. `openssl rand -hex 32`) | Lets renown.id's server-side renders send `X-Renown-Read-Token` plus `X-Renown-Client-IP` so public read limits are keyed per visitor instead of sharing the renown.id pod's bucket. It only changes the limiter key, never bypasses limits. Unset disables it. Set the same value on renown.id as a server-only env (never `NEXT_PUBLIC_*`). |
| `RENOWN_OIDC_DRIVE_ID` | the OIDC client drive | Where org-owned OIDC clients are created. |

## Requirements

- The process timezone must be UTC (`TZ=UTC`).
- The reverse proxy must overwrite `X-Forwarded-For` (not append to a client-supplied value): the rate limiter keys on its first hop, so a spoofable header lets callers dodge the limits.
- New dependency: `tldts` (registrable-domain handle claims). Run `pnpm install` before building.
- Run a single switchboard replica per tenant. The `org:`, `app:` and `handle:` locks are in-process; with several replicas, serialisation falls back to the database constraints (handles, the one-pending-transfer rule, `org_apps.app_did`), which do not cover membership caps, owner counts or proposals.
- The `renown-oidc` subgraph must be registered on the same switchboard host: org-owned clients and the `orgs` scope/claim read its namespace.

## Order

1. Merge into `staging`, release on the staging channel, deploy the staging tenant with the variables above.
2. Run `node scripts/smoke/organisations.ts` against staging (it needs no secrets); it must end with `all checks passed`. Smoke orgs (`smoke-<random>`, unlisted) accumulate and stay.
   After the first deploy, restart the switchboard once and re-run the smoke script: migrations run on every boot, and only a second boot proves they are idempotent on the tenant's real (hashed) namespaces.
3. Give renown.id (B) and Vetra (C) the API contract (appendix of the A1 plan, `subgraphs/renown-orgs/tests/api-contract.test.ts`); they go to staging next.
4. Only after B and C pass on staging: promote `staging` to `main`, release, deploy prod (`RENOWN_ORG_DID_HOST` unset), then run `BASE=<prod switchboard> node scripts/smoke/organisations.ts --allow-prod` (read-only).

## Known limitations

- A second publisher of the same organisation who re-registers an org app's workload identity gets `CONFLICT`: renown-workload's same-owner check compares the registering address only, not the owning organisation. The same applies to an app transferred into an organisation, which keeps its original person as the registered owner address. Sub-project C's create/re-register flow must expect this until the check also accepts a covered publisher of the owning org.
