import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const workspace = dirname(fileURLToPath(import.meta.url));

export function runDeepsec(args) {
  const execution = JSON.parse(readFileSync(join(workspace, "execution.json"), "utf8"));
  if (execution.workspace !== workspace || execution.sourceRoot !== join(dirname(workspace), "src") || workspace.startsWith("/tmp/")) {
    throw new Error("Use a prepared sibling audit workspace outside /tmp");
  }
  const project = JSON.parse(readFileSync(join(workspace, "data/renown-package/project.json"), "utf8"));
  if (project.rootPath !== execution.sourceRoot) throw new Error("Project root does not match the isolated source");
  // Codex enforces its own sandbox: the sibling scanner and original checkout
  // are outside its writable source root. Verify the disposable source against
  // the external baseline after each run. An outer bwrap prevents Codex from
  // creating its own namespaces on this host, so do not nest the sandboxes.
  const result = spawnSync(process.execPath, [
    join(workspace, "node_modules/deepsec/dist/cli.mjs"),
    ...args,
  ], { cwd: workspace, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.signal) throw new Error(`DeepSec terminated by ${result.signal}`);
  return result.status ?? 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (!process.argv[2]) throw new Error("Usage: node run-secure.mjs <deepsec command> [args]");
  process.exitCode = runDeepsec(process.argv.slice(2));
}
