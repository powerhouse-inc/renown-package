import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const template = dirname(fileURLToPath(import.meta.url));
const originalRoot = dirname(template);
const git = (...args) => execFileSync("git", args, { cwd: originalRoot, encoding: "utf8" });
if (git("status", "--porcelain", "--untracked-files=no").trim()) {
  throw new Error("Commit tracked application changes before preparing a clean audit snapshot");
}
const commit = git("rev-parse", "HEAD").trim();
const base = join(homedir(), ".local/state/renown-deepsec");
mkdirSync(base, { recursive: true, mode: 0o700 });
const directory = mkdtempSync(join(base, "run-"));
const sourceRoot = join(directory, "src");
const workspace = join(directory, "deepsec");
const baselineDir = join(template, "artifacts", basename(directory));
execFileSync("git", ["clone", "--no-hardlinks", "--quiet", originalRoot, sourceRoot], { stdio: "inherit" });
mkdirSync(workspace);
for (const name of ["AGENTS.md", "README.md", "deepsec.config.ts", "generated-matchers.ts",
  "full-pass.mjs", "run-secure.mjs", "verify-full.mjs", "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".gitignore"]) {
  cpSync(join(template, name), join(workspace, name));
}
const project = join(workspace, "data/renown-package");
mkdirSync(project, { recursive: true });
for (const name of ["INFO.md", "SETUP.md"]) cpSync(join(template, "data/renown-package", name), join(project, name));
writeFileSync(join(project, "project.json"), JSON.stringify({
  projectId: "renown-package", rootPath: sourceRoot, createdAt: new Date().toISOString(),
}, null, 2) + "\n");
const config = readFileSync(join(workspace, "deepsec.config.ts"), "utf8");
if (!config.includes('root: ".."')) throw new Error("Expected template project root '..'");
writeFileSync(join(workspace, "deepsec.config.ts"), config.replace('root: ".."', 'root: "../src"'));
mkdirSync(baselineDir, { recursive: true, mode: 0o700 });
const execution = { sourceRoot, workspace, baselineDir, originalRoot, commit };
writeFileSync(join(workspace, "execution.json"), JSON.stringify(execution, null, 2) + "\n");
writeFileSync(join(baselineDir, "execution.json"), JSON.stringify(execution, null, 2) + "\n");
writeFileSync(join(template, "artifacts/latest-execution.json"), JSON.stringify(execution, null, 2) + "\n");
console.log(JSON.stringify(execution, null, 2));
