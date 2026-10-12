# Renown organisations: rollout

## Per-tenant configuration

| Variable | Value | Notes |
| --- | --- | --- |
| `RENOWN_ORG_DID_HOST` | prod `www.renown.id`, staging `renown-staging.vetra.io` | The did:web host of org DIDs (`did:web:<host>:org:<id>`). Unset means `www.renown.id`, so staging MUST set it. |
| `RENOWN_PLATFORM_ADMINS` | comma-separated addresses | Resolve reports and take organisations down. Defaults to `ADMINS`. |
| `RENOWN_ORG_TIMELOCK_SECONDS` | default `172800` (48 h) | Delay of ADD_OWNER, REMOVE_OWNER, TRANSFER_APP_OUT, CHANGE_HANDLE and DELETE_ORG proposals. |
| `RENOWN_ORG_RECOVERY_SECONDS` | default `604800` (7 d) | Delay of RECOVER proposals. |
| `RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY` | base64 of 32 bytes | Required for webhooks (it seals the signing secrets); without it webhooks are unavailable. Already used by renown-workload. |
| `RENOWN_OIDC_DRIVE_ID` | the OIDC client drive | Where org-owned OIDC clients are created. |

## Requirements

- The process timezone must be UTC (`TZ=UTC`).
- The reverse proxy must overwrite `X-Forwarded-For` (not append to a client-supplied value): the rate limiter keys on its first hop, so a spoofable header lets callers dodge the limits.
- New dependency: `tldts` (registrable-domain handle claims). Run `pnpm install` before building.
- The `renown-oidc` subgraph must be registered on the same switchboard host: org-owned clients and the `orgs` scope/claim read its namespace.

## Order

1. Merge into `staging`, release on the staging channel, deploy the staging tenant with the variables above.
2. Run `node scripts/smoke/organisations.ts` against staging (it needs no secrets); it must end with `all checks passed`. Smoke orgs (`smoke-<random>`, unlisted) accumulate and stay.
3. Give renown.id (B) and Vetra (C) the API contract (appendix of the A1 plan, `subgraphs/renown-orgs/tests/api-contract.test.ts`); they go to staging next.
4. Only after B and C pass on staging: promote `staging` to `main`, release, deploy prod (`RENOWN_ORG_DID_HOST` unset), then run `BASE=<prod switchboard> node scripts/smoke/organisations.ts --allow-prod` (read-only).
