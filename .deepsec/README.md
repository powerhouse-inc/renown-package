# DeepSec for Renown

DeepSec 2.3.10, Codex `gpt-6.1-sol`, `xhigh` reasoning, local ChatGPT login.
The Codex SDK/CLI are pinned to 0.163.0 via pnpm overrides: DeepSec's original
0.156.1 CLI rejects this model for ChatGPT accounts. No API key or Vercel
project is needed for this local workflow.

Opus 5.5 completed the pre-scan review on 2026-10-20. Its context and runner
corrections are applied; see `data/renown-package/SETUP.md`.

## Prepare an isolated pass

This directory is a tracked template, not the execution workspace. Linux with
Git, Node, pnpm and an existing Codex login are required.
Keep reports local; do not publish raw findings or credentials.

```bash
# From this template directory:
pnpm install --frozen-lockfile
codex login status
node prepare-isolated.mjs
# Change into the printed workspace: ~/.local/state/renown-deepsec/run-*/deepsec
pnpm install --frozen-lockfile
pnpm deepsec setup --headless --yes --agent codex --model gpt-6.1-sol \
  --thinking-level xhigh --model-auth local --through install --output jsonl
pnpm setup:coverage
# Review generated-matchers.ts and coverage evidence before proceeding.
pnpm scope
pnpm scan:full
node verify-full.mjs
pnpm revalidate
node verify-full.mjs
pnpm report
pnpm export
```

The installer-only coordinator command records a checkpoint; no AI or scanning
runs until `setup:coverage`. Setup inventories ingress and reconciles matcher
coverage, stopping before candidate processing. Do not weaken a failing gate.
Review accepted generated matchers and copy them to the template for future use.
`init --plan` in this version unexpectedly attempts Vercel authentication even
in local mode; use the explicit setup commands above.

## Scope and isolation

`prepare-isolated.mjs` clones the current clean commit into a disposable `src/`
and puts DeepSec in a **sibling** `deepsec/`. It refuses uncommitted tracked
application changes. The copied config and project.json both point to `src/`.
Root AGENTS.md and installed dependency files are not patched. The compatible
Codex SDK/CLI 0.163.0 is selected using pnpm overrides in the template lockfile. Execution lives
outside /tmp and TMPDIR, which Codex normally allows as writable temporary paths.

The secure runner validates that layout and target before every command.
Codex's native sandbox confines investigation writes to the disposable source
and temporary paths, excluding the sibling scanner and original checkout.
Source writes are detectable rather than forbidden; verify hashes after each run. The scope/hash baseline stays in the original repository's ignored
artifacts directory, outside both execution roots and outside the investigation's writable roots.

`scan:full` explicitly reviews all tracked text files, including tests, generated
source, docs, configuration and lockfiles, even without matcher hits. It bypasses
DeepSec's normal ignore filter. The initial scope is 554 files, zero exclusions.
It excludes scanner/dependency/build/runtime output, symlinks, deleted files
and binary files. Untracked application files are outside scope; commit them
first if they belong in the review. `scope` only prepares a manifest/snapshot.

## Resume and verify

After an interrupted pass in the same isolated workspace:

```bash
pnpm resume:full
node verify-full.mjs
```

Resume handles pending/error records in the saved manifest. DeepSec 2.3.10 can
mark refused files analyzed, so status/resume alone cannot prove completeness.
Verification checks the latest productive Codex/xhigh process entry for every
file and writes `artifacts/retry-files.txt` for explicit retries:

```bash
node run-secure.mjs process --files-from artifacts/retry-files.txt --no-ignore \
  --agent codex --model gpt-6.1-sol --thinking-level xhigh --concurrency 2
```

Running `scan:full` again starts a fresh review of every listed file. Direct
files-from mode ignores `--limit`; use a smaller manifest for a calibration run.
Exit 1 can mean findings or agent failure: inspect errors, refusals and quota
messages in output/run state. Zero findings alone do not establish coverage.

`verify-full.mjs` compares external SHA-256 baselines, commit, git diff and
ignored/untracked status. It records coverage and revalidation verdict counts.
Run it after every processing/revalidation wave. Revalidation verdicts are
true-positive, false-positive, fixed or uncertain; retain those distinctions.

Initial concurrency is 2, batch size 5. This full-file xhigh pass consumes time
and subscription allowance. DeepSec lacks pricing for this model, so dollar
estimates/cost limits are unreliable. This is source review, not live penetration
testing or a dependency advisory scan.

Commit config, context, reviewed matchers, scripts and the isolated lockfile.
Generated setup/run evidence, per-file state, exported findings and the latest
execution pointer are ignored. No CI schedule or automatic production changes
are configured.

`.gitignore` uses an explicit allowlist: only configuration, package manifests
and lockfile, reviewed matchers, runner scripts, agent instructions, this README,
and `data/renown-package/{INFO,SETUP}.md` are eligible for commit. Everything
else in this directory is ignored by default, including credentials, `.env`
files, dependencies, findings, reports, archives, logs and new scan output types.
Add new reusable template files to the allowlist deliberately; never force-add
scan results or local authentication/runtime state.

## References

Use version-matched docs in `node_modules/deepsec/dist/docs/`, starting with
`node_modules/deepsec/SKILL.md`. Upstream:

- https://deepsec.sh/docs/getting-started
- https://deepsec.sh/docs/configuration
- https://deepsec.sh/docs/models
- https://deepsec.sh/docs/writing-matchers
- https://github.com/vercel-labs/deepsec
