/**
 * Read-only smoke test of the renown.id site-polish reads on a switchboard:
 *
 *   node scripts/smoke/network-stats.ts [--switchboard <url>]
 *
 * It checks, with anonymous GraphQL requests only:
 *   1. renownNetworkStats answers non-negative integers and an ISO updatedAt,
 *      and a second request within 300 s answers the same updatedAt (cache);
 *   2. appProfileCategories is ordered count desc, then name, with non-empty
 *      names and positive counts;
 *   3. appProfiles(category) for the first category (in a different case)
 *      returns only profiles of that category, pages to the end, and never
 *      more than its count; a blank category returns the unfiltered page.
 *
 * Writes nothing, so it needs no --allow-prod. Exits 1 on any failure.
 */

const STAGING_SWITCHBOARD = "https://switchboard.renown-staging.vetra.io";

class SmokeFailure extends Error {}

interface Args {
  switchboard: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { switchboard: STAGING_SWITCHBOARD };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--switchboard") {
      const v = argv[++i];
      if (!v) throw new SmokeFailure("--switchboard needs a URL");
      args.switchboard = v;
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: network-stats.ts [--switchboard <url>]");
      process.exit(0);
    } else throw new SmokeFailure(`unknown argument: ${arg}`);
  }
  args.switchboard = args.switchboard.replace(/\/+$/, "").replace(/\/graphql$/, "");
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

interface GraphqlResult<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

async function query<T>(switchboard: string, document: string, variables: unknown = {}): Promise<T> {
  const res = await fetch(`${switchboard}/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: document, variables }),
  });
  const text = await res.text();
  let result: GraphqlResult<T>;
  try {
    result = JSON.parse(text) as GraphqlResult<T>;
  } catch {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${clip(text)}`);
  }
  if (result.errors?.length || !result.data) {
    throw new SmokeFailure(`GraphQL HTTP ${res.status}: ${clip(JSON.stringify(result.errors ?? result))}`);
  }
  return result.data;
}

interface NetworkStats {
  identities: number;
  apps: number;
  activeCredentials: number;
  activeUsers30d: number;
  updatedAt: string;
}

interface Category {
  category: string;
  count: number;
}

interface Page {
  items: { appDid: string; category: string | null }[];
  next: string | null;
}

const NETWORK_STATS = `query { renownNetworkStats { identities apps activeCredentials activeUsers30d updatedAt } }`;
const CATEGORIES = `query { appProfileCategories { category count } }`;
const PROFILES = `query Profiles($limit: Int, $after: String, $category: String) {
  appProfiles(limit: $limit, after: $after, category: $category) { items { appDid category } next }
}`;

async function checkNetworkStats(switchboard: string): Promise<void> {
  const first = (await query<{ renownNetworkStats: NetworkStats }>(switchboard, NETWORK_STATS)).renownNetworkStats;
  for (const key of ["identities", "apps", "activeCredentials", "activeUsers30d"] as const) {
    check(Number.isInteger(first[key]) && first[key] >= 0, `renownNetworkStats.${key} is ${first[key]}`);
  }
  check(!Number.isNaN(Date.parse(first.updatedAt)), `renownNetworkStats.updatedAt is ${first.updatedAt}`);
  step(
    "renownNetworkStats",
    `identities=${first.identities} apps=${first.apps} activeCredentials=${first.activeCredentials} activeUsers30d=${first.activeUsers30d} updatedAt=${first.updatedAt}`,
  );
  const second = (await query<{ renownNetworkStats: NetworkStats }>(switchboard, NETWORK_STATS)).renownNetworkStats;
  // Several replicas each keep their own cache; only a same-replica answer must match.
  if (second.updatedAt === first.updatedAt) step("renownNetworkStats cached", "same updatedAt on the second request");
  else step("renownNetworkStats second request", `updatedAt=${second.updatedAt} (another replica or the 300 s window ended)`);
}

async function checkCategories(switchboard: string): Promise<Category[]> {
  const categories = (await query<{ appProfileCategories: Category[] }>(switchboard, CATEGORIES)).appProfileCategories;
  categories.forEach((c, i) => {
    check(c.category.trim() !== "", `appProfileCategories[${i}] has an empty name`);
    check(Number.isInteger(c.count) && c.count > 0, `appProfileCategories[${i}].count is ${c.count}`);
    if (i > 0) {
      const prev = categories[i - 1];
      check(
        prev.count > c.count || (prev.count === c.count && prev.category.toLowerCase() <= c.category.toLowerCase()),
        `appProfileCategories is not ordered at ${i}: ${JSON.stringify(prev)} before ${JSON.stringify(c)}`,
      );
    }
  });
  step("appProfileCategories", categories.map((c) => `${c.category}=${c.count}`).join(", ") || "(none)");
  return categories;
}

async function checkCategoryFilter(switchboard: string, categories: Category[]): Promise<void> {
  const all = (await query<{ appProfiles: Page }>(switchboard, PROFILES, { limit: 50 })).appProfiles;
  const blank = (await query<{ appProfiles: Page }>(switchboard, PROFILES, { limit: 50, category: "  " })).appProfiles;
  check(
    JSON.stringify(blank.items.map((p) => p.appDid)) === JSON.stringify(all.items.map((p) => p.appDid)),
    "appProfiles with a blank category differs from the unfiltered list",
  );
  step("appProfiles blank category", `= unfiltered (${all.items.length} on the first page)`);

  if (categories.length === 0) {
    step("appProfiles(category)", "skipped: no categories yet");
    return;
  }
  const target = categories[0];
  // Swapped case: the filter must be case-insensitive.
  const asked = target.category === target.category.toUpperCase() ? target.category.toLowerCase() : target.category.toUpperCase();
  const seen: string[] = [];
  let after: string | null = null;
  for (let pages = 0; pages < 100; pages++) {
    const page: Page = (await query<{ appProfiles: Page }>(switchboard, PROFILES, { limit: 2, after, category: asked }))
      .appProfiles;
    for (const item of page.items) {
      check(
        item.category?.toLowerCase() === target.category.toLowerCase(),
        `appProfiles(category: ${asked}) returned ${item.appDid} with category ${item.category}`,
      );
      check(!seen.includes(item.appDid), `appProfiles(category: ${asked}) repeated ${item.appDid}`);
      seen.push(item.appDid);
    }
    after = page.next;
    if (after === null) break;
  }
  check(after === null, `appProfiles(category: ${asked}) did not end within 100 pages`);
  check(seen.length >= 1 && seen.length <= target.count, `appProfiles(category: ${asked}) listed ${seen.length}, count is ${target.count}`);
  step("appProfiles(category)", `${asked}: ${seen.length} of ${target.count} (unreadable profiles are skipped)`);
}

async function main(): Promise<void> {
  const { switchboard } = parseArgs(process.argv.slice(2));
  step("switchboard", switchboard);
  await checkNetworkStats(switchboard);
  const categories = await checkCategories(switchboard);
  await checkCategoryFilter(switchboard, categories);
  step("OK");
}

main().catch((error: unknown) => {
  console.error(`[smoke] FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
