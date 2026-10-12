/**
 * Smoke test of Renown organisations on a switchboard:
 *
 *   BASE=https://switchboard.renown-staging.vetra.io node scripts/smoke/organisations.ts [--read-only] [--dry-run] [--allow-prod]
 *
 * BASE is the switchboard URL (default: Renown staging). One line per check; exit 1 if any failed.
 *
 * Anonymous checks:
 *   handle availability (reserved words, a fresh handle), a missing organization is null, the directory only lists
 *   listed live organizations and refuses limit 51, unknown credential and invite link are null, anonymous writes
 *   and the inbox are FORBIDDEN, OIDC discovery (when served) advertises the orgs scope and claim.
 * Signed checks (a throwaway wallet generated per run, never printed or stored):
 *   creates the UNLISTED org @smoke-<random>, creates/previews/revokes an invite link, creates and deletes a team,
 *   reads the audit log back. Archiving an org is timelocked, so smoke orgs accumulate on staging (all prefixed
 *   `smoke-`, all unlisted). Secrets (invite token, keys) are never printed.
 *
 * Non-staging hosts are refused without --allow-prod, and then only the anonymous checks run.
 * --dry-run: no network; generates the wallet, signs a sample message and lists the checks.
 */
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import { randomBytes } from "node:crypto";
import type * as OrgsSdk from "../../sdk/orgs.js";

const ORGS_SDK = new URL("../../sdk/orgs.ts", import.meta.url).href;
const STAGING_SWITCHBOARD = "https://switchboard.renown-staging.vetra.io";
const PACKAGE = "/api/@powerhousedao/renown-package";
const REQUEST_TIMEOUT_MS = 15_000;

class SmokeFailure extends Error {}

const secrets = new Set<string>();
function redact(text: string): string {
  let out = text.replace(/0x[0-9a-fA-F]{64,}/g, "[redacted]");
  for (const secret of secrets) out = out.split(secret).join("[redacted]");
  return out;
}
function clip(text: string): string {
  const safe = redact(text);
  return safe.length > 300 ? `${safe.slice(0, 300)}...` : safe;
}

let failures = 0;
async function check(
  name: string,
  run: () => Promise<string | void>,
): Promise<boolean> {
  try {
    const detail = await run();
    console.log(`ok   ${name}${detail ? ` - ${redact(detail)}` : ""}`);
    return true;
  } catch (error) {
    failures++;
    console.log(
      `FAIL ${name} - ${clip(error instanceof Error ? error.message : String(error))}`,
    );
    return false;
  }
}
function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

interface GraphqlResult<T> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

async function post<T>(
  endpoint: string,
  document: string,
  variables: unknown,
): Promise<GraphqlResult<T>> {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as GraphqlResult<T>;
  } catch {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${clip(text)}`);
  }
}

async function query<T>(
  endpoint: string,
  document: string,
  variables: unknown = {},
): Promise<T> {
  const result = await post<T>(endpoint, document, variables);
  if (result.errors?.length || !result.data)
    throw new SmokeFailure(
      `GraphQL: ${clip(JSON.stringify(result.errors ?? result))}`,
    );
  return result.data;
}

async function expectCode(
  endpoint: string,
  document: string,
  variables: unknown,
  code: string,
): Promise<void> {
  const result = await post<unknown>(endpoint, document, variables);
  const got = result.errors?.[0]?.extensions?.code;
  expect(got === code, `expected ${code}, got ${clip(JSON.stringify(result))}`);
}

const AVAILABILITY = `query A($h: String!) { orgHandleAvailability(handle: $h) { handle available reason } }`;

async function readOnly(
  endpoint: string,
  base: string,
  fresh: string,
): Promise<void> {
  for (const handle of ["admin", "orgs"]) {
    await check(`handle "${handle}" is reserved`, async () => {
      const { orgHandleAvailability: a } = await query<{
        orgHandleAvailability: { available: boolean; reason: string | null };
      }>(endpoint, AVAILABILITY, { h: handle });
      expect(
        !a.available && a.reason === "RESERVED",
        `got ${JSON.stringify(a)}`,
      );
    });
  }
  await check("a fresh handle is available", async () => {
    const { orgHandleAvailability: a } = await query<{
      orgHandleAvailability: { available: boolean };
    }>(endpoint, AVAILABILITY, { h: fresh });
    expect(a.available, `${fresh} should be available`);
  });
  await check("a missing organization is null", async () => {
    const { organization } = await query<{ organization: unknown }>(
      endpoint,
      `query O($h: String) { organization(handle: $h) { id } }`,
      { h: fresh },
    );
    expect(organization === null, "a missing handle should resolve to null");
  });
  await check(
    "the directory lists only listed, live organizations",
    async () => {
      const { organizationSearch } = await query<{
        organizationSearch: {
          items: { listed: boolean; archived: boolean; takenDown: boolean }[];
        };
      }>(
        endpoint,
        `query S { organizationSearch(limit: 50) { items { listed archived takenDown } } }`,
      );
      expect(
        organizationSearch.items.every(
          (o) => o.listed && !o.archived && !o.takenDown,
        ),
        "search returned an unlisted or dead organization",
      );
      return `${organizationSearch.items.length} organizations`;
    },
  );
  await check("the directory refuses limit 51", () =>
    expectCode(
      endpoint,
      `query S { organizationSearch(limit: 51) { next } }`,
      {},
      "BAD_USER_INPUT",
    ),
  );
  await check("an unknown credential and invite link are null", async () => {
    const unknown = await query<{
      orgCredentialStatus: unknown;
      orgInviteLink: unknown;
    }>(
      endpoint,
      `query U($c: String!, $t: String!) { orgCredentialStatus(credentialId: $c) { counts } orgInviteLink(token: $t) { usable } }`,
      { c: "urn:uuid:00000000-0000-4000-8000-000000000000", t: "not-a-token" },
    );
    expect(
      unknown.orgCredentialStatus === null && unknown.orgInviteLink === null,
      "expected null for both",
    );
  });
  await check("an anonymous createOrganization is FORBIDDEN", () =>
    expectCode(
      endpoint,
      `mutation C($h: String!) { createOrganization(handle: $h, name: "x") { id } }`,
      { h: fresh },
      "FORBIDDEN",
    ),
  );
  await check("an anonymous inbox is FORBIDDEN", () =>
    expectCode(
      endpoint,
      `query N { myNotifications { next } }`,
      {},
      "FORBIDDEN",
    ),
  );
  await check(
    "OIDC discovery advertises the orgs scope and claim",
    async () => {
      const res = await fetch(
        `${base}${PACKAGE}/oidc/.well-known/openid-configuration`,
        { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
      );
      if (!res.ok) return `not served (${res.status}); skipped`;
      const d = (await res.json()) as {
        scopes_supported?: string[];
        claims_supported?: string[];
      };
      expect(
        d.scopes_supported?.includes("orgs") &&
          d.claims_supported?.includes("orgs"),
        "discovery lacks the orgs scope or claim",
      );
    },
  );
}

type Signer = <T>(
  field: string,
  document: string,
  variables: Record<string, unknown>,
) => Promise<T>;

async function makeSigner(
  endpoint: string,
  account: PrivateKeyAccount,
): Promise<Signer> {
  const { orgMessage } = (await import(ORGS_SDK)) as typeof OrgsSdk;
  return async (field, document, variables) => {
    const timestamp = new Date().toISOString();
    const orgId = typeof variables.orgId === "string" ? variables.orgId : null;
    const signature = await account.signMessage({
      message: await orgMessage(field, orgId, variables, timestamp),
    });
    return query(endpoint, document, {
      ...variables,
      auth: { address: account.address, signature, timestamp },
    });
  };
}

async function writeFlow(
  endpoint: string,
  signed: Signer,
  account: PrivateKeyAccount,
  handle: string,
): Promise<void> {
  let orgId = "";
  const created = await check(
    `create the unlisted org @${handle}`,
    async () => {
      const r = await signed<{
        createOrganization: { id: string; createdBy: string; listed: boolean };
      }>(
        "createOrganization",
        `mutation C($handle: String!, $name: String!, $listed: Boolean, $auth: OrgAuthInput) { createOrganization(handle: $handle, name: $name, listed: $listed, auth: $auth) { id createdBy listed } }`,
        { handle, name: "Renown smoke", listed: false },
      );
      expect(
        r.createOrganization.createdBy === account.address.toLowerCase(),
        "createdBy is not the smoke wallet",
      );
      expect(!r.createOrganization.listed, "the smoke org must be unlisted");
      orgId = r.createOrganization.id;
    },
  );
  if (!created) return;

  await check("an unlisted org is absent from the directory", async () => {
    const { organizationSearch } = await query<{
      organizationSearch: { items: { handle: string }[] };
    }>(
      endpoint,
      `query S($q: String) { organizationSearch(query: $q, limit: 50) { items { handle } } }`,
      { q: handle },
    );
    expect(
      !organizationSearch.items.some((o) => o.handle === handle),
      "the unlisted org is listed",
    );
  });

  await check("invite link: create, preview, revoke", async () => {
    const link = await signed<{
      createOrgInviteLink: { link: { id: string }; token: string };
    }>(
      "createOrgInviteLink",
      `mutation L($orgId: String!, $role: OrgRole!, $maxUses: Int!, $expiresAt: String!, $auth: OrgAuthInput) { createOrgInviteLink(orgId: $orgId, role: $role, maxUses: $maxUses, expiresAt: $expiresAt, auth: $auth) { link { id } token } }`,
      {
        orgId,
        role: "MEMBER",
        maxUses: 1,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      },
    );
    secrets.add(link.createOrgInviteLink.token);
    const preview = await query<{ orgInviteLink: { usable: boolean } | null }>(
      endpoint,
      `query P($t: String!) { orgInviteLink(token: $t) { usable } }`,
      {
        t: link.createOrgInviteLink.token,
      },
    );
    expect(
      preview.orgInviteLink?.usable === true,
      "a fresh invite link should be usable",
    );
    const revoked = await signed<{ revokeOrgInviteLink: { revoked: boolean } }>(
      "revokeOrgInviteLink",
      `mutation R($orgId: String!, $linkId: String!, $auth: OrgAuthInput) { revokeOrgInviteLink(orgId: $orgId, linkId: $linkId, auth: $auth) { revoked } }`,
      { orgId, linkId: link.createOrgInviteLink.link.id },
    );
    expect(revoked.revokeOrgInviteLink.revoked, "the link should be revoked");
  });

  await check("team: create and delete", async () => {
    const team = await signed<{ createOrgTeam: { id: string } }>(
      "createOrgTeam",
      `mutation T($orgId: String!, $slug: String!, $name: String!, $auth: OrgAuthInput) { createOrgTeam(orgId: $orgId, slug: $slug, name: $name, auth: $auth) { id } }`,
      { orgId, slug: "smoke", name: "Smoke" },
    );
    const deleted = await signed<{ deleteOrgTeam: boolean }>(
      "deleteOrgTeam",
      `mutation D($orgId: String!, $teamId: String!, $auth: OrgAuthInput) { deleteOrgTeam(orgId: $orgId, teamId: $teamId, auth: $auth) }`,
      { orgId, teamId: team.createOrgTeam.id },
    );
    expect(deleted.deleteOrgTeam === true, "deleteOrgTeam should return true");
  });

  await check("the audit log records the smoke actions", async () => {
    const audit = await signed<{
      orgAuditLog: { items: { action: string }[] };
    }>(
      "orgAuditLog",
      `query A($orgId: String!, $limit: Int, $auth: OrgAuthInput) { orgAuditLog(orgId: $orgId, limit: $limit, auth: $auth) { items { action } } }`,
      { orgId, limit: 10 },
    );
    const actions = audit.orgAuditLog.items.map((i) => i.action);
    for (const action of [
      "createOrgInviteLink",
      "revokeOrgInviteLink",
      "createOrgTeam",
      "deleteOrgTeam",
    ]) {
      expect(actions.includes(action), `audit log lacks ${action}`);
    }
  });
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const known = new Set([
    "--read-only",
    "--dry-run",
    "--allow-prod",
    "--help",
    "-h",
  ]);
  for (const arg of argv)
    if (!known.has(arg))
      throw new SmokeFailure(
        `unknown argument: ${arg} (the switchboard URL is the BASE env var)`,
      );
  if (argv.includes("--help") || argv.includes("-h")) {
    console.log(
      "usage: BASE=<switchboard url> organisations.ts [--read-only] [--dry-run] [--allow-prod]",
    );
    return;
  }
  const dryRun = argv.includes("--dry-run");
  const base = (process.env.BASE?.trim() || STAGING_SWITCHBOARD)
    .replace(/\/+$/, "")
    .replace(/\/graphql$/, "");
  const host = new URL(base).hostname;
  const staging = /staging|^localhost$|^127\.0\.0\.1$/.test(host);
  if (!staging && !argv.includes("--allow-prod"))
    throw new SmokeFailure(
      `${host} is not a staging host; pass --allow-prod to run read-only checks against it`,
    );
  const write = staging && !argv.includes("--read-only");
  const endpoint = `${base}/graphql/renown-orgs`;
  const suffix = randomBytes(4).toString("hex");
  const handle = `smoke-${suffix}`;
  console.log(
    `smoke organisations on ${host} (${write ? "signed writes as @" + handle : "read-only"}${dryRun ? ", dry run" : ""})`,
  );

  const account = write ? privateKeyToAccount(generatePrivateKey()) : null;
  if (dryRun) {
    if (account) {
      const { orgMessage } = (await import(ORGS_SDK)) as typeof OrgsSdk;
      const message = await orgMessage(
        "createOrganization",
        null,
        { handle, name: "Renown smoke" },
        new Date().toISOString(),
      );
      const signature = await account.signMessage({ message });
      expect(/^0x[0-9a-f]+$/i.test(signature), "signing failed");
      console.log(
        `ok   throwaway wallet ${account.address} signs "${message.slice(0, 40)}..."`,
      );
    }
    console.log("dry run: no request was sent");
    return;
  }

  await readOnly(endpoint, base, handle);
  if (account)
    await writeFlow(
      endpoint,
      await makeSigner(endpoint, account),
      account,
      handle,
    );
  console.log(failures ? `${failures} check(s) failed` : "all checks passed");
  if (failures) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(
    `FAIL ${clip(error instanceof Error ? error.message : String(error))}`,
  );
  process.exit(1);
});
