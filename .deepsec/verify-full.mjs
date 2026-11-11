import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const local = dirname(fileURLToPath(import.meta.url));
const execution = JSON.parse(readFileSync(process.argv[2] ?? join(local, "execution.json"), "utf8"));
const scope = JSON.parse(readFileSync(join(execution.baselineDir, "full-repo-scope.json"), "utf8"));
const unresolved = [];
const mutated = [];
const statuses = {};
let complete = 0;
let findings = 0;
const verdicts = {};
for (const file of scope.files) {
  const bytes = readFileSync(join(execution.sourceRoot, file.path));
  if (createHash("sha256").update(bytes).digest("hex") !== file.sha256) mutated.push(file.path);
  let record;
  try {
    record = JSON.parse(readFileSync(join(execution.workspace, "data/renown-package/files", file.path + ".json"), "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    unresolved.push({ path: file.path, reason: "no file record" });
    continue;
  }
  statuses[record.status] = (statuses[record.status] ?? 0) + 1;
  const history = (record.analysisHistory ?? []).filter((entry) => entry.phase === "process");
  const latest = history.at(-1);
  const reason = !latest ? "no investigation" :
    latest.model !== "gpt-6.1-sol" || latest.agentType !== "codex" || latest.modelConfig?.reasoningEffort !== "xhigh" ? "wrong model/reasoning" :
    Date.parse(latest.investigatedAt) < Date.parse(scope.createdAt) ? "analysis predates snapshot" :
    latest.refusal?.refused ? "refusal requires explicit retry" :
    !(latest.usage?.outputTokens > 0) ? "no productive model output" :
    record.status !== "analyzed" ? `status ${record.status}` : null;
  if (reason) unresolved.push({ path: file.path, reason });
  else complete++;
  for (const finding of record.findings ?? []) {
    findings++;
    const verdict = finding.revalidation?.verdict ?? "not-revalidated";
    verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
  }
}
const git = (...args) => execFileSync("git", args, { cwd: execution.sourceRoot, encoding: "utf8" }).trim();
const sourceStatus = git("status", "--porcelain", "--ignored");
const diff = git("diff", execution.commit, "--stat");
const unchanged = !mutated.length && !sourceStatus && !diff && git("rev-parse", "HEAD") === execution.commit;
const report = { verifiedAt: new Date().toISOString(), scoped: scope.files.length, complete,
  unresolved, statuses, findings, verdicts, mutated, sourceStatus, diff, unchanged };
writeFileSync(join(execution.baselineDir, "coverage-verification.json"), JSON.stringify(report, null, 2) + "\n");
writeFileSync(join(execution.workspace, "artifacts/retry-files.txt"), unresolved.map((file) => file.path).join("\n") + (unresolved.length ? "\n" : ""));
console.log(JSON.stringify({ ...report, unresolved: unresolved.slice(0, 8) }, null, 2));
process.exitCode = !unchanged || unresolved.length ? 1 : 0;
