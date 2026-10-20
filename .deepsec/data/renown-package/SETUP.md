# Security review setup for renown-package

## Required configuration

- The committed `.deepsec/` is a template for the whole repo. Run AI commands
  only from its prepared sibling workspace, whose source root is `../src`.
- DeepSec is pinned to `2.3.10` with its own pnpm lockfile and dependencies.
  Codex SDK/CLI are overridden to `0.163.0` for this model's ChatGPT support.
- Use Codex model `gpt-6.1-sol`, thinking level `xhigh`, and local subscription
  authentication (`codex login status`). Do not substitute a benchmark profile.
- Persist authentication using `deepsec setup --model-auth local`; never put
  credentials into tracked configuration. Local mode needs no Vercel project.
- Keep concurrency at 2 for the initial run; DeepSec 2.3.10 local investigations use
  `workspace-write`, with network disabled; this is not enforced read-only. Cloud Sandbox needs separate credentials.

## Before any scan

Read `node_modules/deepsec/SKILL.md` and its version-matched docs, especially
`getting-started.md`, `configuration.md`, `models.md`, and `writing-matchers.md`.
Review `INFO.md`, this file, `.deepsec/AGENTS.md`, and the root `../AGENTS.md`
against representative source. Keep context concise and verify claims rather
than turning comments or intended safeguards into exclusions.

The user requires a Claude Opus 5.5 review of these files before the first scan.
Resolve that review's material findings before running the commands below.

## Coverage and first pass

Setup analysis and matcher tasks are read-only; process/revalidate are not.
Use the resumable setup coordinator to inventory ingress and reconcile matcher
coverage before candidate processing:

```bash
pnpm setup:coverage
```

Review accepted `generated-matchers.ts` for stable, narrowly scoped primitives,
representative examples and excessive match counts. Never weaken the coverage
gate to force setup through. Generated setup evidence and scan state stay local.

The normal matcher pipeline reviews candidates, not every repository file.
The full pass must explicitly enumerate tracked text files and use direct
`process --files-from <manifest> --no-ignore`, including tests and generated
code. Record the commit, file list, and any binary/deleted-file exclusions.
Exclude dependency/build/runtime output and DeepSec's own data; do not point an
unbounded filesystem traversal at the project. Do not silently omit unmatched
source files or claim a complete pass while batches remain pending/errored.

## After processing

Check status/run records for errors, refusals, limits and missing analyses.
DeepSec 2.3.10 records refusals in `analysisHistory` but can mark the file
`analyzed`; explicitly retry those files rather than trusting status/resume.
Direct `--files-from` reprocesses every listed file and ignores `--limit`;
use a smaller manifest for calibration, not a limit flag. Unknown model pricing
means `--max-cost-usd` is not a reliable bound for this model.
Revalidate findings using the same Codex model and reasoning level before
acting on them; report false-positive/uncertain verdicts accurately. Export a
local report and findings without committing raw analysis or secrets.
Only audit: do not modify production code, dispatch document actions, start
Vetra, contact production targets or enable scheduled/CI scans as part of this
pass. Any later reducer fixes must follow the root MCP/source workflow.

## Known upstream setup caveat

DeepSec 2.3.10 `init --plan` invokes `vercel whoami` even with local model auth;
the Vercel CLI can enter device login despite `--headless`. Abort that login;
use the local-auth setup command above. `--skip-install` can reject the first
setup before an install checkpoint exists; allow the coordinator's install.

## Pre-scan review status

Opus 5.5 pre-scan review completed 2026-10-20; corrections applied.
Process/revalidate must run in the sibling-workspace isolated layout with an
external hash check. Keep the root AGENTS.md and installed dependencies intact.

## Isolated execution

Run `node prepare-isolated.mjs` from the template workspace. It creates a clean
clone at `~/.local/state/renown-deepsec/run-*/src` and a sibling `deepsec/`
workspace, rewrites only the copied config to `root: "../src"`, and initializes
project.json with that source root. The location is outside /tmp and TMPDIR.
Install in the copy and let `deepsec setup --through install` record its install
checkpoint before using `pnpm setup:coverage` (which skips installation).

The secure runner requires this layout and validates project.json before each
command. Codex's native sandbox confines investigation writes to the disposable source
and temporary paths; the sibling scanner and original checkout are outside
that writable root. The independent scope/hash baseline remains in the original
repo's ignored artifacts directory, outside investigation writes. Source changes
are detectable rather than forbidden; verify hashes after each run. An outer
Bubblewrap layer was tested but prevents nested Codex namespaces on this host;
never disable Codex's sandbox to work around that.

After process/revalidate, run `node verify-full.mjs` to compare every source hash,
commit, git diff and ignored/untracked status, and check productive non-refused
analysis for every file. Refusal/error/incomplete lists are written for retry.
Keep all reports local; local subscription auth remains readable by Codex, so
inspect output for credentials before sharing it.
