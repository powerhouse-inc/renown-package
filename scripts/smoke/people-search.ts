/**
 * Read-only smoke test of the verify / people-search reads on a switchboard:
 *
 *   node scripts/smoke/people-search.ts [--switchboard <url>] [--credential-id <urn:uuid:...>]
 *
 * It checks, with anonymous GraphQL requests only:
 *   1. renownCredentials(credentialId) alone answers [] for an unknown id and
 *      for "" (never the whole table); with --credential-id it answers exactly
 *      that credential;
 *   2. renownUserSearch for a few prefixes returns only listed profiles whose
 *      handle or display name starts with the query, ordered by handle
 *      (profiles without one last), and pages to the end without repeats;
 *   3. "%%" and "__" match literally (only names starting with them);
 *   4. a 1-character query, limit 51 and a foreign cursor are BAD_USER_INPUT.
 *
 * Writes nothing, so it needs no --allow-prod. Exits 1 on any failure.
 */

const STAGING_SWITCHBOARD = "https://switchboard.renown-staging.vetra.io";
const UNKNOWN_CREDENTIAL = "urn:uuid:00000000-0000-4000-8000-000000000000";
const PREFIXES = ["an", "ma", "jo", "da", "sm"];

class SmokeFailure extends Error {}

interface Args {
  switchboard: string;
  credentialId: string | undefined;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    switchboard: STAGING_SWITCHBOARD,
    credentialId: undefined,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--switchboard") {
      const v = argv[++i];
      if (!v) throw new SmokeFailure("--switchboard needs a URL");
      args.switchboard = v;
    } else if (arg === "--credential-id") {
      const v = argv[++i];
      if (!v) throw new SmokeFailure("--credential-id needs a credential id");
      args.credentialId = v;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "usage: people-search.ts [--switchboard <url>] [--credential-id <urn:uuid:...>]",
      );
      process.exit(0);
    } else throw new SmokeFailure(`unknown argument: ${arg}`);
  }
  args.switchboard = args.switchboard
    .replace(/\/+$/, "")
    .replace(/\/graphql$/, "");
  return args;
}

function step(label: string, detail = ""): void {
  console.log(`[smoke] ${label}${detail ? ` ${detail}` : ""}`);
}

function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new SmokeFailure(message);
}

function clip(text: string): string {
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

interface GraphqlError {
  message: string;
  extensions?: { code?: string; field?: string };
}

interface GraphqlResult<T> {
  data?: T | null;
  errors?: GraphqlError[];
}

async function post<T>(
  switchboard: string,
  document: string,
  variables: unknown,
): Promise<GraphqlResult<T>> {
  const res = await fetch(`${switchboard}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
  });
  const text = await res.text();
  try {
    return JSON.parse(text) as GraphqlResult<T>;
  } catch {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${clip(text)}`);
  }
}

async function query<T>(
  switchboard: string,
  document: string,
  variables: unknown = {},
): Promise<T> {
  const result = await post<T>(switchboard, document, variables);
  if (result.errors?.length || !result.data) {
    throw new SmokeFailure(
      `GraphQL: ${clip(JSON.stringify(result.errors ?? result))}`,
    );
  }
  return result.data;
}

interface Credential {
  credentialId: string;
  revoked: boolean;
}

interface Person {
  documentId: string;
  handle: string | null;
  displayName: string | null;
  listed: boolean;
}

interface Page {
  items: Person[];
  next: string | null;
}

const CREDENTIALS = `query Credential($id: String!) {
  renownCredentials(input: { credentialId: $id }) { credentialId revoked }
}`;
const SEARCH = `query Search($q: String!, $limit: Int, $after: String) {
  renownUserSearch(query: $q, limit: $limit, after: $after) { items { documentId handle displayName listed } next }
}`;

async function checkCredentialLookup(
  switchboard: string,
  credentialId: string | undefined,
): Promise<void> {
  for (const id of [UNKNOWN_CREDENTIAL, ""]) {
    const rows = (
      await query<{ renownCredentials: Credential[] }>(
        switchboard,
        CREDENTIALS,
        { id },
      )
    ).renownCredentials;
    check(
      rows.length === 0,
      `renownCredentials(credentialId: ${JSON.stringify(id)}) returned ${rows.length} rows`,
    );
  }
  step("renownCredentials(credentialId)", "unknown id and empty id answer []");
  if (!credentialId) {
    step(
      "renownCredentials(credentialId) known id",
      "skipped: pass --credential-id to check one",
    );
    return;
  }
  const rows = (
    await query<{ renownCredentials: Credential[] }>(switchboard, CREDENTIALS, {
      id: credentialId,
    })
  ).renownCredentials;
  check(
    rows.length === 1 && rows[0].credentialId === credentialId,
    `renownCredentials(credentialId) returned ${rows.length} rows`,
  );
  step(
    "renownCredentials(credentialId) known id",
    `found, revoked=${rows[0].revoked}`,
  );
}

function startsWith(person: Person, q: string): boolean {
  return [person.handle, person.displayName].some(
    (v) => v != null && v.toLowerCase().startsWith(q.toLowerCase()),
  );
}

function inOrder(a: Person, b: Person): boolean {
  if (a.handle === null)
    return b.handle === null && a.documentId < b.documentId;
  if (b.handle === null) return true;
  const ha = a.handle.toLowerCase();
  const hb = b.handle.toLowerCase();
  return ha < hb || (ha === hb && a.documentId < b.documentId);
}

async function searchAll(switchboard: string, q: string): Promise<Person[]> {
  const seen: Person[] = [];
  let after: string | null = null;
  for (let pages = 0; pages < 100; pages++) {
    const page: Page = (
      await query<{ renownUserSearch: Page }>(switchboard, SEARCH, {
        q,
        limit: 5,
        after,
      })
    ).renownUserSearch;
    check(
      page.items.length <= 5,
      `renownUserSearch(${q}) returned ${page.items.length} items for limit 5`,
    );
    for (const person of page.items) {
      check(
        person.listed,
        `renownUserSearch(${q}) returned unlisted ${person.documentId}`,
      );
      check(
        startsWith(person, q),
        `renownUserSearch(${q}) returned ${person.documentId} (${person.handle}/${person.displayName})`,
      );
      check(
        !seen.some((p) => p.documentId === person.documentId),
        `renownUserSearch(${q}) repeated ${person.documentId}`,
      );
      const prev = seen.at(-1);
      check(
        !prev || inOrder(prev, person),
        `renownUserSearch(${q}) out of order at ${person.documentId}`,
      );
      seen.push(person);
    }
    after = page.next;
    if (after === null) return seen;
  }
  throw new SmokeFailure(`renownUserSearch(${q}) did not end within 100 pages`);
}

async function checkSearch(switchboard: string): Promise<void> {
  for (const q of PREFIXES) {
    const people = await searchAll(switchboard, q.toUpperCase());
    step(`renownUserSearch(${q.toUpperCase()})`, `${people.length} listed`);
  }
  for (const q of ["%%", "__"]) {
    const people = await searchAll(switchboard, q);
    step(`renownUserSearch(${q})`, `${people.length} (only literal matches)`);
  }
}

async function checkErrors(switchboard: string): Promise<void> {
  const cases: [string, Record<string, unknown>, string][] = [
    ["1-character query", { q: " a " }, "query"],
    ["limit 51", { q: "an", limit: 51 }, "limit"],
    ["foreign cursor", { q: "an", after: "not-a-cursor" }, "after"],
  ];
  for (const [label, variables, field] of cases) {
    const result = await post<unknown>(switchboard, SEARCH, variables);
    const error = result.errors?.[0];
    check(
      error?.extensions?.code === "BAD_USER_INPUT" &&
        error.extensions.field === field,
      `renownUserSearch with a ${label} answered ${clip(JSON.stringify(result))}`,
    );
  }
  step("renownUserSearch errors", "BAD_USER_INPUT for query, limit and after");
}

async function main(): Promise<void> {
  const { switchboard, credentialId } = parseArgs(process.argv.slice(2));
  step("switchboard", switchboard);
  await checkCredentialLookup(switchboard, credentialId);
  await checkSearch(switchboard);
  await checkErrors(switchboard);
  step("OK");
}

main().catch((error: unknown) => {
  console.error(
    `[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
});
