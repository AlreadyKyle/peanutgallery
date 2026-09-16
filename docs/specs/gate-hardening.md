# Gate hardening: renames, kernel names, secret shapes, CI coverage

Status: agreed. Card: none. Owner: board.

## Problem

An audit found gaps that let a card branch get past the kernel check or the secret scan.
1. `changed-paths.sh` lists a renamed file by its new name only. A card that moves `seed-1/tests/invariants.test.ts` to `seed-1/content/x.json` passes the kernel guard and is put in the config lane, which skips typecheck and tests. The dispatcher's `changedFiles` drops the original name of a rename too.
2. Some files change later sessions or the gate from inside a lane folder: a nested `CLAUDE.md` or `.claude` folder (Claude Code loads them), or a `seed-1/vitest.config.ts`, which vitest reads before the kernel `vite.config.ts` and which can exclude the invariants test. No kernel path lists them.
3. The secret scan has no shape for Anthropic, OpenAI, Google or Supabase secret keys. It also skips SVGs, source maps and minified bundles, which the seed serves publicly.
4. The gate workflow never runs the gate's own tests, the agent spec tests, the ops tests or the Stripe webhook function tests, so all four can break on main without a red check.

## Scope

In:
- Rename detection off in `changed-paths.sh` and in the dispatcher.
- A kernel name list, checked on every path segment, in the gate and the dispatcher.
- Four new secret shapes, and a scan of served text files.
- The missing test suites in the workflow's platform job.

Out:
- Changes to the lanes or to `kernel-paths.txt`.
- Other scanners' skip rules: banned phrases and runtime tokens still skip SVGs, maps and minified bundles.
- Any live system.

## Behaviour

**Renames.** `changed-paths.sh` turns rename detection off whatever the repository's config says (`-c diff.renames=false diff --no-renames`). A renamed file lists both names, and deletes and type changes are listed too. The dispatcher runs `git status` with `--no-renames`. If a rename or copy entry still appears, in either status column, it reports both names.

**Kernel names.** `platform/gate/kernel-names.txt` lists names, one per line, where `*` matches within a name:
- Claude Code configuration: `.claude`, `CLAUDE.md`, `CLAUDE.local.md`, `.mcp.json`
- git and package manager configuration: `.gitattributes`, `.gitmodules`, `.npmrc`, `.pnpmfile.cjs`, `package.json`
- build, test and deploy configuration: `vite.config.*`, `vitest.config.*`, `vitest.workspace.*`, `netlify.toml`

A changed file is kernel when any segment of its path matches one of them. `kernel-guard.sh` fails it with the same `FAIL: kernel-guard path=<file>` line. The dispatcher's `KERNEL_NAMES` is tested equal to the file. `isKernelPath` covers both lists, and `outsideLane` uses it. Every session prompt names the kernel names as never to be created or edited.

**Secret scan.**
- New shapes: `anthropic-key` (`sk-ant-` and a body), `openai-key` (`sk-proj-`, `sk-svcacct-` or `sk-admin-` and a body), `google-api-key` (`AIza` and 35 characters), and `supabase-secret-key` (`sb_secret_` and a body).
- A Supabase publishable key is public, is committed in the site's Netlify config, and is not a shape.
- The scan skips lock files and binary media only (`gate_is_binary_media`), so SVGs, source maps and minified bundles are scanned.

**CI.** The platform job runs these after the ship gate, as separate steps:
- `pnpm --filter @backseat/gate test`
- `pnpm test:agents`
- `pnpm test:ops`
- `pnpm test:functions`, on Deno 2.7.13 through `denoland/setup-deno@v2`

The card-branch step that restores `platform/gate` from the base commit still runs before any gate script.

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

## Verification

- `pnpm --filter @backseat/gate test`
- `pnpm --filter @backseat/dispatcher test`
- `bash platform/gate/secret-scan.sh --tracked` (first line PASS)
- The rename case in a temporary repository with `changed-paths.sh --list` and `kernel-guard.sh`, against the old gate and the new one.
- `pnpm verify`
- The first pull request after merge shows the four new steps green in the platform job.

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

Pending: the first pull request's platform job showing the four new steps green.

## Decisions

- 2026-09-16: kernel names are a second list, not more lines in `kernel-paths.txt`. A path list matches a prefix and a name list matches any segment, and one file with two meanings would be misread.
- 2026-09-16: `package.json` and `netlify.toml` are names as well as paths. A nested one inside a lane folder could add a workspace package or a deploy rule, and no card has needed one.
- 2026-09-16: the new CI steps run after the ship gate, so the gate still fails first on a secret or a deny-listed term. On a card branch they run the base commit's gate tests, because the restore step comes first.
- 2026-09-16: Deno is pinned to 2.7.13, the version `pnpm verify` runs the function tests on locally. The functions' `deno.json` sets no version.
