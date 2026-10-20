import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDeepsec } from "./run-secure.mjs";

const workspace = dirname(fileURLToPath(import.meta.url));
const execution = JSON.parse(readFileSync(join(workspace, "execution.json"), "utf8"));
const root = resolve(execution.sourceRoot);
if (root !== resolve(workspace, "../src")) throw new Error("Use a prepared sibling audit workspace");
const artifacts = join(workspace, "artifacts");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
const files = [];
const excluded = [];

// Enumerate version-controlled inputs, never dependencies or runtime state.
for (const path of git("ls-files", "-z").split("\0").filter(Boolean).sort()) {
  if (/^(\.deepsec|node_modules|dist|coverage|\.ph)\//.test(path)) {
    excluded.push({ path, reason: "scanner/dependency/build/runtime output" });
    continue;
  }
  const absolute = join(root, path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    excluded.push({ path, reason: "deleted from working tree" });
    continue;
  }
  if (!stat.isFile()) {
    excluded.push({ path, reason: "not a regular file (including symlinks)" });
    continue;
  }
  const bytes = readFileSync(absolute);
  if (bytes.includes(0)) {
    excluded.push({ path, reason: "binary (NUL byte)" });
    continue;
  }
  if (/[\r\n]/.test(path) || path.trim() !== path) {
    throw new Error(`Path cannot be represented by DeepSec's line manifest: ${JSON.stringify(path)}`);
  }
  files.push({ path, sha256: createHash("sha256").update(bytes).digest("hex") });
}
if (!files.length) throw new Error("No tracked text files to review");
mkdirSync(artifacts, { recursive: true });
writeFileSync(join(artifacts, "full-repo-files.txt"), files.map((file) => file.path).join("\n") + "\n");
writeFileSync(join(artifacts, "full-repo-files.json"), JSON.stringify(files.map((file) => file.path), null, 2) + "\n");
writeFileSync(join(artifacts, "full-repo-scope.json"), JSON.stringify({
  createdAt: new Date().toISOString(),
  commit: git("rev-parse", "HEAD").trim(),
  workingTreeStatus: git("status", "--porcelain"),
  agent: "codex",
  model: "gpt-6.1-sol",
  thinkingLevel: "xhigh",
  files,
  excluded,
}, null, 2) + "\n");
// Independent evidence remains outside the source tree and scanner workspace.
writeFileSync(join(execution.baselineDir, "full-repo-scope.json"), readFileSync(join(artifacts, "full-repo-scope.json")));
console.log(`Full-repository scope: ${files.length} tracked text files; ${excluded.length} exclusions.`);
if (!process.argv.includes("--prepare-only")) {
  process.exitCode = runDeepsec([
    "process", "--project-id", "renown-package",
    "--agent", "codex", "--model", "gpt-6.1-sol", "--thinking-level", "xhigh",
    "--concurrency", "2", "--batch-size", "5",
    "--files-from", "artifacts/full-repo-files.txt", "--no-ignore",
  ]);
}
