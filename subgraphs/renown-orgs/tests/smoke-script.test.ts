import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildASTSchema, execute, parse, GraphQLError } from "graphql";
import { expect, it, vi } from "vitest";
import { schema } from "../schema.js";
import { harnessResolvers, openHarness } from "./harness.js";

vi.mock("../../renown-auth/core/smart-wallet.js", () => ({
  verifyMessageOnChain: () => Promise.resolve(false),
  verifyTypedDataOnChain: () => Promise.resolve(false),
}));

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const SCRIPT = fileURLToPath(new URL("../../../scripts/smoke/organisations.ts", import.meta.url));

/** Runs scripts/smoke/organisations.ts (a real node process) against these resolvers behind a local HTTP server. */
it("the staging smoke script passes against the in-process subgraph", async () => {
  const h = await openHarness();
  const t = harnessResolvers(h, { now: () => new Date() });
  const built = buildASTSchema(schema);
  const res = t.resolvers as Record<
    string,
    Record<string, (p: unknown, a: unknown, c: unknown) => unknown>
  >;
  const server = createServer((req, rsp) => {
    if (req.method !== "POST") {
      rsp.statusCode = 404;
      rsp.end();
      return;
    }
    let body = "";
    req.on("data", (c) => (body += c));
    req.on(
      "end",
      () =>
        void (async () => {
          const { query, variables } = JSON.parse(body) as {
            query: string;
            variables: Record<string, unknown>;
          };
          const out = await execute({
            schema: built,
            document: parse(query),
            variableValues: variables,
            contextValue: {},
            fieldResolver: (src, args, ctx, info) => {
              const r = (
                res[info.parentType.name] as
                  | Record<
                      string,
                      | ((p: unknown, a: unknown, c: unknown) => unknown)
                      | undefined
                    >
                  | undefined
              )?.[info.fieldName];
              return r
                ? r(src, args, ctx)
                : (src as Record<string, unknown> | null)?.[info.fieldName];
            },
          });
          const errors = out.errors?.map((e) => ({
            message: e.message,
            extensions: (e.originalError instanceof GraphQLError
              ? e.originalError
              : e
            ).extensions,
          }));
          rsp.setHeader("content-type", "application/json");
          rsp.end(JSON.stringify({ data: out.data ?? null, errors }));
        })(),
    );
  });
  try {
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const output = await new Promise<string>((resolve) =>
      execFile(
        "node",
        [SCRIPT],
        // Independent of the test runner's cwd; killed rather than hanging the suite.
        { cwd: REPO_ROOT, timeout: 50_000, env: { ...process.env, BASE: `http://localhost:${port}` } },
        (e, so, se) =>
          resolve(`${so}${se}exit=${e ? ((e as { code?: number | null }).code ?? `killed (${String(e.signal)})`) : 0}`),
      ),
    );
    expect(output).toContain("all checks passed");
    expect(output).not.toContain("FAIL");
    expect(output).toContain("exit=0");
  } finally {
    server.close();
    await h.root.destroy();
  }
}, 60000);
