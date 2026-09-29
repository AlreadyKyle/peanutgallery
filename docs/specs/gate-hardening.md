# Gate hardening: renames, kernel names, links, secret shapes, CI coverage

Status: built. Card: none. Owner: board.

## Problem

An audit found gaps that let a card branch get past the kernel check or the secret scan.
1. `changed-paths.sh` lists a renamed file by its new name only. A card that moves `seed-1/tests/invariants.test.ts` to `seed-1/content/x.json` passes the kernel guard and is put in the config lane, which skips typecheck and tests. The dispatcher's `changedFiles` drops the original name of a rename too.
2. Some files change later sessions or the gate from inside a lane folder: a nested `CLAUDE.md` or `.claude` folder (Claude Code loads them), or a `seed-1/vitest.config.ts`, which vitest reads before the kernel `vite.config.ts` and which can exclude the invariants test. No kernel path lists them.
3. The secret scan has no shape for Anthropic, OpenAI, Google or Supabase secret keys. It also skips SVGs, source maps and minified bundles, which the seed serves publicly.
4. The gate workflow never runs the gate's own tests, the agent spec tests, the ops tests or the Stripe webhook function tests, so all four can break on main without a red check.

A review of the first fix found more:
5. `git diff --name-only` quotes a path with non-ASCII bytes, for example `".github/workflows/\303\261.yml"`. The quoted line matches no kernel path or name, so the guard passes it.
6. Every workflow job runs `pnpm install` before the kernel guard. The install runs lifecycle scripts and reads `.npmrc` and `.pnpmfile.cjs`, so a card could run code before the guard and fake its result.
7. Kernel names and paths match case-sensitively. On a case-insensitive checkout (macOS), `seed-1/content/claude.md` loads as `CLAUDE.md` and `.Claude` as `.claude`.
8. A symlink such as `seed-1/content/gh -> ../../.github` is listed under its own name only. A submodule is committed as one entry whose contents are never listed.
9. The dispatcher's name glob used `.*`, which stops at a newline where the shell `*` does not.
10. The secret scan had no shape for a legacy OpenAI key.

## Scope

In:
- Rename detection off in `changed-paths.sh` and in the dispatcher.
- A kernel name list, checked on every path segment, in the gate and the dispatcher.
- Five new secret shapes, and a scan of served text files.
- The missing test suites in the workflow's platform job.
- Unquoted path listing, a guard failure on any line it cannot read as a path, and case-insensitive kernel matching.
- A mode check that fails symlinks and submodules on card branches.
- The card-branch guards moved into the `detect` job, before any install, and a `gate` job that fails unless detect and every job it selected pass.

Out:
- Changes to the lanes or to `kernel-paths.txt`.
- Other scanners' skip rules: banned phrases and runtime tokens still skip SVGs, maps and minified bundles.
- Any live system.
- The dispatcher's side of symlinks and submodules, and of changes a session commits itself. The dispatcher reads only uncommitted changes (`git status`), so test code that runs `git commit -a` inside a session is not seen. The merge-safety change (`metering-reconciliation` branch) closes both by checking the committed range. Until then the gate's card-branch checks are the only guard for them.

## Behaviour

**Renames and quoting.**
- `changed-paths.sh` turns rename detection off whatever the repository's config says (`-c diff.renames=false diff --no-renames`). A renamed file lists both names, and deletes and type changes are listed too.
- It lists paths with `core.quotePath=false`, in `diff` and in `ls-tree`, so non-ASCII names arrive as they are. It never ignores submodules, whatever `.gitmodules` says.
- git still quotes a path holding a tab, newline, double quote or backslash. `kernel-guard.sh` fails any line that starts with `"` or holds a tab or other control character, as `FAIL: kernel-guard path=<line>`.
- The dispatcher runs `git status` with `--no-renames`. If a rename or copy entry still appears, in either status column, it reports both names.

**Kernel names.** `platform/gate/kernel-names.txt` lists names, one per line, where `*` matches within a name:
- Claude Code configuration: `.claude`, `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`
- git and package manager configuration: `.gitattributes`, `.gitmodules`, `.npmrc`, ~~`.pnpmfile.cjs`~~ `.pnpmfile.*` (superseded: pnpm 11 also loads `.pnpmfile.mjs`, `ops-separation.md`, 2026-09-16), `package.json`
- build, test and deploy configuration: `vite.config.*`, `vitest.config.*`, `vitest.workspace.*`, `netlify.toml`

A changed file is kernel when any segment of its path matches one of them. `kernel-guard.sh` fails it with the same `FAIL: kernel-guard path=<file>` line. The dispatcher's `KERNEL_NAMES` is tested equal to the file. `isKernelPath` covers both lists, and `outsideLane` uses it. Every session prompt names the kernel names as never to be created or edited.

Kernel names and kernel paths both match without regard to case: `nocasematch` in `kernel-guard.sh` (bash 3.2 has it), and lowercase paths with an `i` regex in the dispatcher. In the dispatcher a `*` matches any character, a newline included (`[\s\S]*`), as the shell glob does. The lane folders themselves still match case-sensitively, so `seed-1/Content/x.json` is outside the config lane.

**Symlinks and submodules.** `changed-paths.sh --check-modes <base> <head>` reads `git diff --raw -z --no-renames` over the same range as the list, or `ls-tree -r -z` when every file counts. It fails when a changed entry is mode 120000 (symlink) or 160000 (submodule) on either side: `FAIL: mode-check path=<file> mode=<mode>`, else `PASS: mode-check entries=<n>`.

**Secret scan.**
- New shapes: `anthropic-key` (`sk-ant-` and a body), `openai-key` (`sk-proj-`, `sk-svcacct-` or `sk-admin-` and a body), `google-api-key` (`AIza` and 35 characters), and `supabase-secret-key` (`sb_secret_` and a body).
- A Supabase publishable key is public, is committed in the site's Netlify config, and is not a shape.
- `openai-key-legacy`: `sk-`, at least 16 body characters, then the legacy key marker (`T3Blbk` followed by `FJ`).
- The scan skips lock files and binary media only (`gate_is_binary_media`), so SVGs, source maps and minified bundles are scanned.
- Three more shapes, each needing its body: `supabase-access-token` (`sbp_` and 40 hex characters), `discord-webhook` (a `discord.com/api/webhooks/<id>/<token>` address) and `age-secret-key` (`AGE-SECRET-KEY-1` and a body); the bare prefixes are not hits.
- The scan lists the files itself, so a listing that fails (a folder git refuses) or a repository path holding `&` or `|` fails the scan (`FAIL: secret-scan cannot list the files`) instead of passing `files=0`.
- `kernel-guard.sh` and `restore-kernel.sh` treat a module that resolves ahead of a kernel source file (the same name under `.mjs`, `.js` or `.mts` before `.ts`, and `.mjs`, `.js`, `.mts`, `.ts` or `.jsx` before `.tsx`) as a kernel path, because the bundler and the tests import it in place of the kernel file while the typecheck does not. The dispatcher's `isKernelPath` (`platform/dispatcher/src/worktree.ts`) does not yet apply the same rule.

**Card-branch checks.** On a `card/*` branch the `detect` job does four things, in order and before anything else runs:
1. It restores `platform/gate` from the base commit.
2. It lists the changed files.
3. It runs `kernel-guard.sh`.
4. It runs `changed-paths.sh --check-modes`.

`detect` never installs dependencies. A failure there skips every other job. The per-job guard steps after install are removed.

The aggregate `gate` job fails when any needed job failed or was cancelled, and also when `detect` did not succeed. It also fails when `detect` selected a job (from its `seed`, `platform` and `lane` outputs) and that job did not succeed. So a skipped job counts as a pass only when detect ran and did not select it.

**CI.** The platform job runs these after the ship gate, as separate steps:
- `pnpm --filter @backseat/gate test`
- `pnpm test:agents`
- `pnpm test:ops`
- `pnpm test:functions`, on Deno 2.7.13 through `denoland/setup-deno@v2`

In each job, the card-branch step that restores `platform/gate` from the base commit still runs before any gate script.

## Acceptance criteria

- [x] A commit renaming `seed-1/tests/invariants.test.ts` to `seed-1/content/x.json` lists both names with `changed-paths.sh --list`, is lane `code`, and fails `kernel-guard.sh` with `path=seed-1/tests/invariants.test.ts`, even with `diff.renames` set in the repository.
- [x] `kernel-guard.sh` fails `seed-1/content/CLAUDE.md`, `seed-1/render/.claude/settings.json`, `seed-1/vitest.config.ts` and `seed-1/config/.npmrc`, and passes `seed-1/config/spawn-table.json` and names that only resemble a kernel name.
- [x] Each new secret shape fails the scan without printing the value; a Supabase publishable key passes.
- [x] A GitHub token in a `.svg`, `.map`, `.min.js` or `.min.css` file fails the scan; a `.png` is still skipped.
- [x] No tracked file matches a new shape, and `secret-scan.sh --tracked` passes.
- [x] `changedFiles` reports both names of a staged rename, with and without `status.renames` set; `parseStatus` reads R and C entries in either column into both names.
- [x] `KERNEL_NAMES` equals the non-comment lines of `kernel-names.txt`, and `outsideLane` rejects a kernel name in every lane.
- [x] The session prompt names the kernel names in every lane.
- [x] The workflow's platform job runs the gate, agent, ops and function tests after the ship gate, with Deno pinned; the gate tests check this.
- [x] A non-ASCII path under `.github`, and a `CLAUDE.md` in a non-ASCII folder, each listed by `changed-paths.sh --list`, fail `kernel-guard.sh` by their real names.
- [x] A tab in a committed name, listed by `changed-paths.sh --list`, fails `kernel-guard.sh`; a listed tab, control character or leading double quote fails it directly.
- [x] `seed-1/content/claude.md`, `seed-1/render/.Claude/settings.json`, `seed-1/Vite.Config.ts`, `.GitHub/workflows/x.yml` and `Platform/Gate/ship-gate.sh` fail `kernel-guard.sh`; `isKernelPath` agrees, and a `*` in a name matches a newline.
- [x] `changed-paths.sh --check-modes` fails a symlink (also from a zero base) and a submodule (also with `ignore = all` in `.gitmodules`), and passes ordinary files.
- [x] The workflow runs the kernel guard once, in `detect`, which installs nothing, after the base gate is restored; `detect` runs the mode check too. The `gate` job requires `detect` and each selected job to succeed. The gate tests check all of this.
- [x] The legacy OpenAI shape fails the scan without printing the value, and no tracked file matches it.

## Verification

- `pnpm --filter @backseat/gate test`
- `pnpm --filter @backseat/dispatcher test`
- `bash platform/gate/secret-scan.sh --tracked` (first line PASS)
- The rename case in a temporary repository with `changed-paths.sh --list` and `kernel-guard.sh`, against the old gate and the new one.
- The review's bypasses (non-ASCII paths, a lowercase `claude.md`, a symlink, a submodule) in a temporary repository, against the gate at 0e6502f and the new one.
- `pnpm verify`
- The first pull request after merge shows the four new steps green in the platform job (run 35129960581, Evidence, 2026-09-26).

## Evidence

2026-09-16, branch `gate-hardening`:

Test first. Against the unchanged scripts, the new gate tests failed 20 times, for the expected reasons. Examples:
- `FAIL changed: a kernel file renamed into content is the code lane: ... first line: seed=true platform=false lane=config`
- `FAIL changed: kernel-guard fails the old name of a renamed kernel file: exit 0 (wanted 1), first line: PASS: kernel-guard files=1`
- `FAIL kernel-guard: seed-1/vitest.config.ts fails by name: exit 0 (wanted 1)`
- `FAIL secrets: anthropic-key shape fails: exit 0 (wanted 1)`
- `FAIL secrets: a token in icon.svg fails: exit 0 (wanted 1), first line: PASS: secret-scan files=0`
- the five workflow checks

The new dispatcher tests failed 7 times, including `expected [] to deeply equal [ 'seed-1/content/CLAUDE.md' ]` from `outsideLane`, and the rename case returned two files where three were expected.

After the change:
- `pnpm --filter @backseat/gate test`: `PASS: gate tests passed=184` (157 before).
- `pnpm --filter @backseat/dispatcher test`: `Tests  211 passed (211)` (207 before).
- `bash platform/gate/secret-scan.sh --tracked`: `PASS: secret-scan files=297`.
- `git grep -nE` for each new shape over tracked files: no match (exit 1 for all four).
- `shellcheck` 0.10.0 over `platform/ops/*.sh`: exit 0. With it on PATH, `node --test platform/ops/test/ops.test.mjs` gave `tests 21, pass 21, skipped 0`, so the ops step will not fail on the shellcheck test that Ubuntu runners now run.

Rename demonstration. A temporary repository with a `card/abcd1234-config` commit that runs `git mv seed-1/tests/invariants.test.ts seed-1/content/x.json`. With the gate from `origin/main` (4f60c7c):

```
$ changed-paths.sh --list $BASE $HEAD
seed-1/content/x.json
$ changed-paths.sh $BASE $HEAD
seed=true platform=false lane=config
$ kernel-guard.sh changed.txt
PASS: kernel-guard files=1
exit=0
```

With this branch's gate:

```
$ changed-paths.sh --list $BASE $HEAD
seed-1/content/x.json
seed-1/tests/invariants.test.ts
$ changed-paths.sh $BASE $HEAD
seed=true platform=false lane=code
$ kernel-guard.sh changed.txt
FAIL: kernel-guard path=seed-1/tests/invariants.test.ts
exit=1
```

`pnpm verify`: exit 0. The counts:
- supabase `Tests  122 passed (122)`
- seed-1 `Tests  77 passed (77)`
- site `Tests  123 passed (123)`
- dispatcher `Tests  211 passed (211)`
- gate `PASS: gate tests passed=184`
- agents `tests 64, pass 64`
- ops `tests 21, pass 20, skipped 1` (shellcheck is not installed locally)
- deno `ok | 58 passed (33 steps) | 0 failed`
- `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=297`

2026-09-16, review fixes (a new commit on the same branch):

Test first. Against 0e6502f the new gate tests failed 25 times, each for the reason under review. Examples:
- `FAIL kernel-guard: a non-ASCII workflow listed by changed-paths fails: exit 0 (wanted 1), first line: PASS: kernel-guard files=1`
- `FAIL kernel-guard: seed-1/content/claude.md fails by name: exit 0 (wanted 1)`
- `FAIL changed: a symlink fails the mode check: exit 2 (wanted 1)`
- `FAIL secrets: openai-key-legacy shape fails: exit 0 (wanted 1)`
- the eight workflow checks for the detect job and the gate job

The two new dispatcher tests (case and newline) failed with `expected false to be true`.

The bypasses in a temporary repository, one `card/abcd1234-config` commit each. With the gate at 0e6502f:

```
== non-ASCII workflow
list: ".github/workflows/\303\261.yml"
PASS: kernel-guard files=1
== CLAUDE.md in a non-ASCII folder
list: "seed-1/content/\303\251/CLAUDE.md"
PASS: kernel-guard files=1
== lowercase claude.md
list: seed-1/content/claude.md
PASS: kernel-guard files=1
== symlink to .github
list: seed-1/content/gh
PASS: kernel-guard files=1
== submodule
list: seed-1/content/sub
PASS: kernel-guard files=1
```

With this branch:

```
== non-ASCII workflow
list: .github/workflows/ñ.yml
FAIL: kernel-guard path=.github/workflows/ñ.yml
== CLAUDE.md in a non-ASCII folder
list: seed-1/content/é/CLAUDE.md
FAIL: kernel-guard path=seed-1/content/é/CLAUDE.md
== lowercase claude.md
list: seed-1/content/claude.md
FAIL: kernel-guard path=seed-1/content/claude.md
== symlink to .github
list: seed-1/content/gh
PASS: kernel-guard files=1
FAIL: mode-check path=seed-1/content/gh mode=120000
== submodule
list: seed-1/content/sub
PASS: kernel-guard files=1
FAIL: mode-check path=seed-1/content/sub mode=160000
```

After the change:
- `pnpm --filter @backseat/gate test`: `PASS: gate tests passed=211`.
- `pnpm --filter @backseat/dispatcher test`: `Tests  213 passed (213)`.
- `git grep -nE` for the legacy OpenAI shape over tracked files: no match (exit 1).
- `pnpm verify`: exit 0. Counts are supabase 122, seed-1 77, site 123, dispatcher 213, gate 211, agents 64, ops 20 passed with 1 skipped, and deno `58 passed (33 steps)`. It printed `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code` and `PASS: secret-scan files=299`.

Pending:
- the first pull request's platform job showing the four new steps green;
- a `card/*` pull request showing the detect job's guard steps run before any install.


2026-09-20, status corrected from agreed to built. The code merged as f0ebbdc (PR 33) and every
criterion a test can prove is ticked; the two pending lines are both CI observations:

- the first pull request's platform job showing the four new steps green;
- a `card/*` pull request showing the detect job's guard steps run before any install. No card has
  run since the merge, so no `card/*` pull request exists to read. This closes with the first
  unattended card.

2026-09-26, the first pending line, read from the Actions API. The first pull request after f0ebbdc
(PR 33, merged 2026-09-16T17:41:06Z) to run the gate was PR 35's branch `metering-reconciliation`, whose
head 71e3b70 has f0ebbdc as an ancestor: run 35129960581 (`created_at=2026-09-16T17:43:37Z`,
`conclusion=success`). Its platform job, in order: `Ship gate=success`, `Gate tests=success`,
`Agent role spec tests=success`, `Ops tests=success`, `Run denoland/setup-deno@v2=success`,
`Stripe webhook function tests=success`, then `Install Chromium for Playwright=success` and
`Site end-to-end=success`. The four new steps ran green after the ship gate, with Deno set up by
`denoland/setup-deno@v2`.

The second line stays open: no `card/*` pull request has run since the merge, and none can run the
gate until GitHub Actions minutes are back (`docs/BOARD-SETUP.md`, GitHub Actions minutes) and the first
card is built. It closes with that card's gate run.

## Decisions

- 2026-09-16: kernel names are a second list, not more lines in `kernel-paths.txt`. A path list matches a prefix and a name list matches any segment, and one file with two meanings would be misread.
- 2026-09-16: `package.json` and `netlify.toml` are names as well as paths. A nested one inside a lane folder could add a workspace package or a deploy rule, and no card has needed one.
- 2026-09-16: the new CI steps run after the ship gate, so the gate still fails first on a secret or a deny-listed term. On a card branch they run the base commit's gate tests, because the restore step comes first.
- 2026-09-16: Deno is pinned to 2.7.13, the version `pnpm verify` runs the function tests on locally. The functions' `deno.json` sets no version.
- 2026-09-16: the per-job kernel guard steps are removed, not kept as a second check. After an install they could be faked, so a pass there proves nothing, and a second copy is one more place for the lists to drift. The guard's input is kernel-guarded itself (`package.json`, `.npmrc` and `.pnpmfile.cjs` are kernel names), so a card that passes `detect` cannot change what the later installs run.
- 2026-09-16: the mode check is a flag on `changed-paths.sh`, not a new script. It reads the same range as the file list and shares its merge-base rule.
- 2026-09-16: a path the guard cannot read as a path fails rather than being decoded. A card has no need for a tab, newline, quote or backslash in a file name.
- 2026-09-16: kernel matching ignores case, but the lane folders do not. Ignoring case there would widen a lane, and a stricter lane only refuses more.
