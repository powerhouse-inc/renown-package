# renown-workload

Exchanges a GitHub Actions OIDC token for a Renown auth bearer token. The token is signed by the repository's App did:key.

- `POST /api/@powerhousedao/renown-package/workload/token` with JSON `{ subject_token, audience }`. This route is public.
- GraphQL `registerWorkloadIdentity` / `updateWorkloadIdentity` / `deleteWorkloadIdentity` / `workloadIdentity`. All of them require the `x-renown-workload-registration-token` header.
- GraphQL `issueAppStatsToken(did)` (same header): a 10-minute bearer signed by the identity's did:key with `aud` = `RENOWN_STATS_AUDIENCE` (default `https://switchboard.renown.vetra.io/graphql/renown-stats`). Vetra's stats relay sends it to `reportUserStat` as `X-Renown-App-Token`.

## Which runs get a token

| GitHub run                                                       | Class      | Audiences it may request                                      |
| ---------------------------------------------------------------- | ---------- | ------------------------------------------------------------- |
| `push` or `workflow_dispatch` on `refs/heads/<productionBranch>` | PRODUCTION | every allowlisted audience                                    |
| `push` of a tag matching `^refs/tags/v\d`                        | RELEASE    | every allowlisted audience                                    |
| `pull_request` on `refs/pull/<n>/merge`                          | PREVIEW    | every allowlisted audience except `https://registry.vetra.io` |

Any other event or ref gets 403. That includes `pull_request_target`, `workflow_run` and `issue_comment`, even on the production branch.

## Environment

| Variable                             | Purpose                                                                                                                                                          | When unset or invalid                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RENOWN_WORKLOAD_KEY_ENCRYPTION_KEY` | Base64 of 32 bytes (`openssl rand -base64 32`). It is the AES-256-GCM key for the stored did:key private keys. Rotating it makes every stored identity unusable. | The exchange answers 503 `temporarily_unavailable`, and registration fails with `SERVICE_NOT_CONFIGURED`.                                                |
| `RENOWN_WORKLOAD_REGISTRATION_TOKEN` | Shared secret for the registration header.                                                                                                                       | All GraphQL fields fail with `SERVICE_NOT_CONFIGURED`.                                                                                                   |
| `RENOWN_WORKLOAD_AUDIENCES`          | Comma-separated audience allowlist. Trailing slashes are ignored.                                                                                                | Defaults to `https://registry.vetra.io`, `https://registry.dev.vetra.io` and `https://switchboard.vetra.io/api/@powerhousedao/vetra-cloud-package/apps`. |

The default allowlist leaves out the bare `https://switchboard.vetra.io` on purpose. A token for that audience would act as the App owner on the vetra switchboard's whole GraphQL API. The vetra-apps CI endpoints verify their own, narrower audience instead.

The subgraph starts even when none of these variables are set.
