# Launch gate: close the kernel holes

Status: built. Card: none. Owner: board.

## Problem

A logic pass and an audit of the gate found holes a card could use before launch.
1. Card tests ran in the same job as the headless bot, the build and the scan of the build, so card code could rewrite the bot's package script, its report module or the gate script on disk and forge a green result. The bot's verdict was read from its output.
2. A deny-listed word written with JSON `\u` escapes passed the deny-list, though the game's `JSON.parse` shows it. A file with a NUL byte or a UTF-16 byte order mark was skipped by every scanner. The config lane took any file under `seed-1/config` and `seed-1/content`, which the build copies into the game as they are. The runtime-token scan skipped test files, test folders and the built bundle, and read only four seed-1 folders.
3. The kernel list missed the board's client code (`board.ts`, `env.ts`), the determinism harness (`sim/hash.ts`, `sim/rng.ts`, `tests/timeline.test.ts`), the game page that carries the rating, and build configs a build tool runs from the folder it builds (a PostCSS config runs its code during the Vite build).
4. Card pull requests could get public Netlify deploy previews of ungated code. Checkouts left the job token in `.git/config`. An older run of a pull request kept running after a newer push.
5. The secret scan missed the gh command line's `gho_` token, the other GitHub token prefixes and private key blocks.
6. The dispatcher took the first check run named `gate` from any app.
7. The board shares the site's origin, so card-built site code could reach the board's session.

## Scope

In: `.github/workflows/gate.yml`, `platform/gate/**` (a new `restore-kernel.sh`), both `netlify.toml` files, the kernel lists and the config-lane rule in `platform/dispatcher/src/worktree.ts`, `gateStatus` in `platform/dispatcher/src/github.ts`, and the protected list in `seed-1/CLAUDE.md`.

Out:
- `platform/dispatcher/src/smoke.ts` and production smoke (the managed workstream owns them). The bot runner's `--report-file` mode is here for any caller.
- The dispatcher refusing platform code-lane cards in selection, and the database refusing horizon `now` for them (the dispatcher and database workstreams). This change closes that lane at the gate, which every merge passes.
- The board on its own origin, and enforcing the site CSP (backlog and site workstreams).
- `docs/PLAN.md`'s description of the gate and the builder prompts' list of protected seed-1 files (the docs workstream).

## Behaviour

**Order of checks.** Every step that runs no card code comes before the first step that does.
- `detect` installs nothing. On a `card/*` branch it restores `platform/gate` from the base commit and then runs three checks: the kernel guard, the symlink and submodule check, and the new lane check. On every event it then runs the scans phase for each selected folder: secret scan, deny-list and runtime-token scan.
- ~~`seed-code` and `platform` install and run the checks phase: typecheck and tests, card code. The platform job then runs the gate, agent, ops, function and end-to-end suites as before. It builds the site once more, only so the end-to-end suite has something to serve. The `seed-config` job is gone, because the config lane has no checks phase.~~ Superseded in part by `gate-e2e-job.md` (2026-10-03): the end-to-end suites and their site build run in their own `end-to-end` job beside the platform job.
- `build` is a new job on a fresh runner that never runs card tests. On a card branch it restores `platform/gate` and then every kernel file from the base commit (`restore-kernel.sh`). It installs with `--ignore-scripts` and no dependency cache, since a cache can be written by a run that ran card tests. It builds each selected folder and scans every built file, and only then runs the headless bot, the one step here that runs card code.
- `gate` requires `detect`, then every job `detect` selected, `build` included. It runs unless the run was cancelled.

**What is containment and what is not.** Containment is:
- the detect job's kernel guard, mode check and lane check, before any install;
- the dispatcher's lane, range and patch checks;
- the scans, all of which run before any card code;
- rollback.

Card tests, the headless bot and the end-to-end suite all run card code. The bot imports the card's sim code into its own process, so it catches a confused agent's regressions. It is not containment against a malicious one. Its report file, whose name holds a random nonce, stops a stray output line from standing in for its verdict, and no more.

**`ship-gate.sh --phase all|scans|build|checks|bot`.** `all` is the default and the local form. It runs scans, build and its scan, checks, then the bot. A phase a folder or lane lacks is a usage error: platform has no bot phase, and the seed config lane has no checks phase. The bot phase passes only when the runner exits 0 and its report file's first line is a PASS line.

**`run.mjs --report-file <path>`.** The runner writes its verdict to a new file. A file that exists beforehand is a usage error. A file someone else created during the run fails it, because the runner creates the file only after the bot exits.

**`restore-kernel.sh <base>`.** A file is kernel when it lies under a kernel path or has a kernel name as a path segment, both ignoring case.
- Every kernel file the base commit holds is checked out from it.
- Every kernel file the working tree holds and the base commit does not is deleted. This covers tracked files and untracked files that are not ignored.
- Ignored files are left alone.
- It reports `PASS: restore-kernel files=<n> restored=<r> removed=<m>`.

**Card lanes at the gate.** `changed-paths.sh --check-lane <branch> <base> <head>` fails a card branch that changes anything outside `seed-1/`, because the platform code lane is closed until the board has its own origin. It also fails a `-config` branch that changes anything other than a `.json` file under `seed-1/config` or `seed-1/content`. Lane detection calls a change the config lane only when every file is such a `.json` file.

**Scanners.**
- The deny-list decodes a `.json` line's string escapes before it normalizes the line: `\uXXXX` becomes the character (printable ASCII, else a space), `\n \r \t \b \f` become a space, and `\" \\ \/` become the character.
- A file with a NUL byte or a UTF-16 byte order mark fails every scanner as `unreadable`. The only exceptions are binary media and lock files. Finder `.DS_Store` files are pruned.
- The runtime-token scan reads all of `seed-1`, and `platform/site` with `platform/agents`, test files and test folders included.
- It reads every file of a build. A bundle under `dist/assets/` is read as plain text for the unfinished-work markers only. The language names and the object-to-string text sit in the libraries' own strings, and the source scan still reads every string a card writes with the full list.

**Secret shapes.** `github-token` is now `gh[pousr]_` and a body. `private-key` is the first line of a PEM private key block.

**Kernel lists** (`kernel-paths.txt` equals the dispatcher's `KERNEL_PATHS`; `seed-1/CLAUDE.md` lists the seed-1 entries).
- New paths: `platform/site/src/lib/board.ts`, `platform/site/src/lib/env.ts`, `seed-1/index.html`, `seed-1/sim/hash.ts`, `seed-1/sim/rng.ts`, `seed-1/tests/timeline.test.ts`.
- New names (at any depth, in `kernel-names.txt` and `KERNEL_NAMES`): `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `package-lock.json`, `npm-shrinkwrap.json`, `yarn.lock`, `tsconfig*.json`, `postcss.config.*`, `.postcssrc*`, `tailwind.config.*`, `babel.config.*`, `.babelrc*`, `.env*`, `_headers`, `_redirects`. Vite loads PostCSS config and env files from the folder it builds. Netlify reads `_headers` and `_redirects` from the published folder, over `netlify.toml`. A nested tsconfig or package-manager file changes what typecheck or an install does.
- `platform/agents/managed` and a future `.github/workflows/smoke.yml` are already under kernel paths.

**Dispatcher.**
- `outsideLane` refuses any file that is not `.json` when the allowed paths are the config lane's.
- `gateStatus` counts only check runs named `gate` that the GitHub Actions app created. It fails when any of them concluded other than success, cancelled included. It is pending while one is still running, and passes only when all succeeded.
- Among workflows, only `gate.yml` may define a job named `gate`. The gate tests read every workflow file for that, since `.github` is kernel. The dispatcher does not look up the workflow path at run time; see Decisions.

**Workflow hygiene.**
- The token has top-level `permissions: contents: read` and nothing else.
- No step names a secret, and there is no `pull_request_target` or `workflow_run` trigger.
- Every checkout sets `persist-credentials: false`.
- A newer push to a pull request cancels its older run (`cancel-in-progress` on pull request events only).

**Netlify.** Both `netlify.toml` ignore commands start with `case "$HEAD" in card/*) exit 0 ;; esac`, so a card branch never builds a deploy preview or a branch deploy. Every other pull request still gets its preview, and production builds are unchanged.

## Acceptance criteria

- [x] A deny-listed term written in JSON `\u` escapes (lower- or uppercase hex, fully or partly escaped) or after an escaped newline fails the deny-list; other escapes in clean JSON pass.
- [x] A file with a NUL byte, or a UTF-16 byte order mark (either order), fails the deny-list, the runtime-token scan and the secret scan as `unreadable`; an empty file and a `.DS_Store` file pass.
- [x] A non-`.json` file on a config branch fails the lane check, and lane detection calls it the code lane; the dispatcher's `outsideLane` refuses it in the config lane and allows it in the code lane.
- [x] A card branch that changes `platform/` or a root file fails the lane check; a branch that names no lane fails.
- [x] The runtime-token scan fails a token in a test file, a tests folder, a new seed-1 folder, a site end-to-end spec, a built bundle and a built stylesheet; the language names and the object-to-string text in a built bundle pass.
- [x] `gho_`, `ghu_`, `ghs_` and `ghr_` tokens and four kinds of private key block fail the secret scan without printing the value; no tracked file matches.
- [x] Each new kernel path and name fails the kernel guard and `isKernelPath`; near names pass; `KERNEL_PATHS` and `KERNEL_NAMES` equal the gate files; `seed-1/CLAUDE.md`'s protected list equals the seed-1 kernel paths.
- [x] A card test that rewrites `seed-1/package.json`'s bot script, or the bot's report module, forges a green bot with nothing restored; after `restore-kernel.sh` the real bot runs and fails. Changed and deleted kernel files come back, new kernel files and new build and env configs are removed, and lane files stay.
- [x] `ship-gate.sh` runs the build and its scan before typecheck and tests, and tests before the bot, for both folders; each phase runs alone; missing phases are usage errors.
- [x] `run.mjs --report-file` writes the verdict; an existing file is a usage error; a report file the bot wrote itself fails the run; a stray pass line from a failing bot does not pass.
- [x] The workflow: scans in `detect` before any install and after the guards; a `build` job with the kernel restore before the install, `--ignore-scripts`, no cache, no card tests, and the bot last; checks-only card-code jobs; `gate` requiring `build`; `!cancelled()`; `cancel-in-progress` for pull requests. Every workflow file: `contents: read` only, no job-level permissions or write, no secrets, no `pull_request_target` or `workflow_run`, `persist-credentials: false` on every checkout, and only `gate.yml` has a job named `gate`.
- [x] `gateStatus` ignores a `gate` run from another app, fails when any Actions `gate` run failed or was cancelled, and passes only when all passed.
- [x] Both `netlify.toml` ignore commands skip `card/*` branches, with or without a cached build, and build a board branch's preview, a branch that only starts like `card`, and main with no cached build.
- [x] A clean install with `--ignore-scripts` builds both folders, the builds scan clean, and the bot runs.
- [x] This pull request's own gate run shows the new `detect` scans and the `build` job green.
- [ ] A card pull request after merge shows the lane check, the kernel restore and the bot in the `build` job green, and no Netlify deploy preview (waits on: the first card run after merge).
- [ ] Both Netlify sites' build settings read back, and any existing deploy preview of a `card/*` branch deleted (waits on: the board's allow for the Netlify read and delete).

## Verification

- `pnpm --filter @backseat/gate test`
- The new gate tests against the unchanged scripts (an export of `main` with only `platform/gate/test/run-tests.sh` replaced).
- `pnpm --filter @backseat/dispatcher test`
- `pnpm test:docs`, `pnpm test:agents`, `pnpm test:ops`
- Each phase of `ship-gate.sh` on this repository.
- A clean install with `pnpm install --frozen-lockfile --ignore-scripts` and no side-effects cache, then both builds, the build scan and the bot.
- `pnpm verify`
- This pull request's gate run.
- The first card pull request after merge (waits on: the first card run after merge).
- The Netlify build settings read (waits on: the board's allow).

## Production steps (need the board's allow)

1. After merge, read both Netlify sites (`GET /api/v1/sites/{site_id}` for peanutgallerygames and peanutgallery-seed-1) and quote the deploy-preview and branch-deploy settings. Previews of board pull requests stay on; the `ignore` command already skips `card/*` branches.
2. List each site's deploys with context `deploy-preview` or `branch-deploy` whose branch starts with `card/`, and delete them so their public URLs stop serving. Quote the list before and after.

## Evidence

Branch `launch/gate`.

Test first. The new gate test file run against the unchanged scripts, from an export of `main` with only `platform/gate/test/run-tests.sh` replaced:

```
FAIL: gate tests failed=110 passed=237
```

Each failure is the hole under test. Examples:
- `FAIL banned: a term spelled in JSON \u escapes fails`
- `FAIL banned: a file with a NUL byte fails as unreadable`
- `FAIL tokens: a built bundle is scanned for unfinished-work markers`
- `FAIL secrets: a GitHub gho_ token fails as github-token`
- `FAIL lane: a platform change fails on a card branch while the platform code lane is closed` (`--check-lane` did not exist: usage, exit 2)
- `FAIL ship: the build and its scan run before the tests`
- `FAIL restore: a clean checkout changes nothing` (no `restore-kernel.sh`: exit 127)
- `FAIL kernel-guard: platform/site/postcss.config.mjs is kernel`
- `FAIL workflow audit: every checkout in gate.yml sets persist-credentials: false`
- `FAIL netlify: seed-1/netlify.toml skips a card branch's deploy preview`

After the change:
- `pnpm --filter @backseat/gate test`: `PASS: gate tests passed=348` (213 before).
- `pnpm --filter @backseat/dispatcher test`: `Tests  379 passed (379)`. New tests: "protects the board client, the determinism harness, the game page and every build config", "accepts only .json files in the config lane", "counts only gate runs the GitHub Actions app created", "fails when one gate run on the sha failed, whatever the others say", "passes only when every Actions gate run completed with success".
- `pnpm test:docs`: `pass 4`; `pnpm test:agents` and `pnpm test:ops` (`pass 41`) pass.

Each phase on this repository:

```
GATE PASS folder=seed-1 lane=code phase=scans
GATE PASS folder=platform lane=code phase=scans
gate: step=build package=@backseat/seed-1 ok 2s
PASS: runtime-token-deny files=6
GATE PASS folder=seed-1 lane=code phase=build
gate: step=build package=@backseat/site ok 3s
PASS: runtime-token-deny files=4
GATE PASS folder=platform lane=code phase=build
PASS: headless-bot simulatedSeconds=36000 unlocks=13 finalTotalDust=210706643.11118117 stateHash=4b268106c8053ca8
GATE PASS folder=seed-1 lane=code phase=bot
```

Clean install. An export of `main` installed with `pnpm install --frozen-lockfile --ignore-scripts --config.side-effects-cache=false` built seed-1 (`postbuild: copied config and content, wrote version.json`) and the site. The bot then ran (`state hash 4b268106c8053ca8`), and the new scan over both builds printed `PASS: runtime-token-deny files=10`.

This pull request's first gate run (#48, run 35793958086). It changes root files, so every job ran:
- `detect` scanned both folders with nothing installed: `PASS: secret-scan files=334`, `PASS: banned-phrases files=103 paths=118 message=yes`, `PASS: runtime-token-deny files=42`, then `GATE PASS folder=seed-1 lane=code phase=scans` and `GATE PASS folder=platform lane=code phase=scans`.
- `build`, on a fresh runner with no cache, installed with `--ignore-scripts`. It then printed:
  - `gate: step=build package=@backseat/seed-1 ok 6s` and `PASS: runtime-token-deny files=6`
  - `gate: step=build package=@backseat/site ok 7s` and `PASS: runtime-token-deny files=4`
  - `PASS: headless-bot simulatedSeconds=36000 unlocks=13 finalTotalDust=210706643.11118117 stateHash=4b268106c8053ca8`
- `seed-code` passed.
- `platform` failed at the end-to-end suite: `Error: The directory "dist" does not exist. Did you build your project?` The suite had served the build the old ship gate left in that job. The fix is the platform job's own build step before the suite, with a gate test that pins the order.

The second run, at a8ef416 (run 35794424681), was green in every job. Every check run on the sha came from `github-actions` with conclusion `success`.
- `build`:
  - `GATE PASS folder=seed-1 lane=code phase=build`
  - `GATE PASS folder=platform lane=code phase=build`
  - `PASS: headless-bot simulatedSeconds=36000 unlocks=13 finalTotalDust=210706643.11118117 stateHash=4b268106c8053ca8`
  - `GATE PASS folder=seed-1 lane=code phase=bot`
- `seed-code`: `Tests  77 passed (77)`, then `GATE PASS folder=seed-1 lane=code phase=checks`.
- `platform`:
  - `Tests  379 passed (379)`, `Tests  146 passed (146)` and `Tests  163 passed (163)`, then `GATE PASS folder=platform lane=code phase=checks`
  - `PASS: gate tests passed=348`
  - `71 passed (47 steps) | 0 failed`
  - the end-to-end suite: `11 passed (4.6s)`
- `gate`: `gate passed`.

Bundle scan cost. The code view over the two built bundles took 95 seconds and flagged eight library strings (the language names and the object-to-string text). Read as plain text for the unfinished-work markers, the same bundles take under a second and flag nothing. That is why a bundle gets the marker list only.

`pnpm verify`: exit 0. The counts:
- supabase `Tests  146 passed (146)`
- seed-1 `Tests  77 passed (77)`
- site `Tests  163 passed (163)`
- dispatcher `Tests  379 passed (379)`
- gate `PASS: gate tests passed=348`
- agents `tests 64, pass 64`
- ops `tests 41, pass 41, skipped 0`
- deno `ok | 71 passed (47 steps) | 0 failed`
- `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`
- `PASS: secret-scan files=334`
- docs `tests 4, pass 4`

## Decisions

- 22 September 2026: the bot and the build scan run in a separate `build` job on a fresh runner. On a card branch every kernel file is restored from the base commit, and the install runs with `--ignore-scripts` and no dependency cache (audit F52, ruled binding). The bot still imports card sim code, so the spec states it is not containment.
- 22 September 2026: the platform code lane is closed at the gate by the lane check until the board has its own origin (audit F11). The gate is the one place every merge passes, and this change owns it; the dispatcher's selection and the database refuse the lane in their own workstreams.
- 22 September 2026: `gateStatus` takes only GitHub Actions `gate` runs and requires all of them to pass (audit F75). "One from gate.yml" is enforced by the gate tests, which fail any other workflow with a job named `gate`; `.github` is kernel, so only the board can add a workflow. The dispatcher does not read the workflow path at run time. That lookup needs the Actions API, which the dispatcher's token has no permission for, and the second F75 reviewer advised against it.
- 22 September 2026: the build-config kernel names go beyond PostCSS to the files a build tool, the package manager or Netlify loads from a folder: tsconfig, env, `_headers`, `_redirects` and nested lock and workspace files. Each is cheap to protect, and a card has no reason to write one.
- 22 September 2026: a superseded pull request run's `gate` check fails or is skipped, never passes, and the dispatcher reads only the head sha. So `cancel-in-progress` on pull requests and `if: !cancelled()` on the gate job cannot let a card through (audit F37).
