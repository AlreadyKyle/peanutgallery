# Ops separation: a read-only code clone, a work clone, and a deploy that trusts only commits

Status: agreed. Card: none. Owner: board.

## Problem

On the VPS the dispatcher container (uid 10001) runs `node --import tsx src/main.ts` straight from the bind-mounted clone at `/srv/peanutgallery`, and its entrypoint runs `pnpm install` there. uid 10001 owns that clone, and agent-written code runs as uid 10001 through the allowed `pnpm … test:*` scripts, so it can change `platform/dispatcher/src` or `node_modules` and the next start runs the change with every secret. `deploy.sh` then runs as root on the same tree: it fast-forwards it, installs unit files from the working tree and builds the image from `platform/ops` without checking the tree is clean, and its git calls set `safe.directory` without turning `core.fsmonitor` off, so a planted `.git/config` runs a program as root. uid 10001 can escalate to root.

## Scope

In:
- Two clones and a worktree folder on the host, with their owners, modes and mounts.
- `DISPATCHER_CODE_ROOT`, `DISPATCHER_REPO_ROOT`, `DISPATCHER_WORKTREE_ROOT` and `DISPATCHER_CODE_READONLY` in `config.ts`, and the read-only check at startup.
- `dispatcher.service`, `dispatcher-entrypoint.sh`, `Dockerfile.dispatcher` and its dockerignore, a new `managed-settings.json`.
- `deploy.sh` (including `--ref` for a roll back), `provision.sh`, the runbook and `vps.md`'s superseded lines.

Out:
- Turning on Claude Code's Bash sandbox for sessions, and a separate uid for sessions (the session-containment work). This change installs bubblewrap and socat and the managed settings; it does not change how sessions are launched.
- Reading the dispatcher's environment from `/proc` (`vps.md`, Known risk). The managed settings deny the Read tool there; code a session runs is not stopped by that.
- How card worktrees get dependencies. A worktree had no usable `node_modules` inside the old clone either: pnpm's root `node_modules` holds only `.pnpm`, which module resolution does not walk into.
- Any live system: nothing here runs against the VPS, Docker, GitHub or Supabase.

## Behaviour

**Host layout.**

| Host path | Owner, mode | In the container | Holds |
|---|---|---|---|
| `/srv/peanutgallery-code` | root, nothing writable by group or others | `/opt/peanutgallery`, `:ro` | the code clone: dispatcher code, `node_modules`, `.pnpm-store` (in `.git/info/exclude`) |
| `/srv/peanutgallery` | uid 10001, 0755 | same path, read-write | the work clone: git state the dispatcher fetches, pushes and adds worktrees from |
| `/srv/peanutgallery-worktrees` | uid 10001, 0700 | same path, read-write | card, smoke and probe worktrees |

Root never runs git or any program from the work clone or the worktree folder.

**Dispatcher.** `loadConfig(env, codeRoot)` takes the checkout the process runs from.
- `DISPATCHER_CODE_ROOT`, when set, must equal that checkout, else a `ConfigError`.
- `DISPATCHER_REPO_ROOT` resolves against the code root and defaults to it. `DISPATCHER_WORKTREE_ROOT` resolves against the repository root and defaults to `.worktrees`, as before.
- `DISPATCHER_CODE_READONLY` is `required` or `off` (the default); anything else is a `ConfigError`. With `required`, a repository or worktree root inside the code root is a `ConfigError`.
- With `required`, startup checks the code root before any database read. Each of `.`, `node_modules`, `node_modules/.pnpm`, `platform/dispatcher`, `platform/dispatcher/src` and `platform/dispatcher/node_modules` must exist, fail `access(W_OK)`, and refuse a new file. Any failure is a fatal `StartupError`: exit 78, no restart. On success it logs `code root is read-only`.
- `.env` is read from the code root only, never from the work clone. The probe's worktree comes from the repository root.
- On the Mac nothing changes: no variable set means the code root is the repository and nothing is checked.

**Unit.** `dispatcher.service` mounts `/srv/peanutgallery-code:/opt/peanutgallery:ro`, `/srv/peanutgallery` and `/srv/peanutgallery-worktrees` at their own paths, and sets `DISPATCHER_CODE_ROOT=/opt/peanutgallery`, `DISPATCHER_REPO_ROOT=/srv/peanutgallery`, `DISPATCHER_WORKTREE_ROOT=/srv/peanutgallery-worktrees` and `DISPATCHER_CODE_READONLY=required`. `provision.sh` refuses an env file that sets any of the four.

**Entrypoint.** Checks that the code clone has the dispatcher and `node_modules`, that the work clone has `.git`, that `claude --version` is the pinned version, and that the work clone's origin is an https github.com URL (git with fsmonitor and hooks off). It installs nothing. It sets `TSX_DISABLE_CACHE=1`, since tsx's transform cache sits in the container's temp folder where agent code can write, and execs `node --import tsx src/main.ts` from `/opt/peanutgallery/platform/dispatcher`.

**Image.** apt installs `bubblewrap` and `socat` beside git, ca-certificates and tini. `platform/ops/managed-settings.json` is copied as root, mode 0644, to `/etc/claude-code/managed-settings.json`, the path Claude Code 2.1.139 reads on Linux whatever `--setting-sources` says. It sets `disableAllHooks` and denies Read of `/proc`, `/etc/peanutgallery`, both clones' `.env*`, `~/.ssh`, `~/.aws`, `~/.config`, `~/.claude`, `~/.claude.json` and `~/.netrc`, and Edit under `/opt/peanutgallery` and `/srv/peanutgallery`. Edits under `/srv/peanutgallery-worktrees` stay allowed for the session policy to scope. The dockerignore admits the entrypoint and the settings. `WORKDIR` and the pnpm store move to `/opt/peanutgallery`.

**Deploy.** `deploy.sh [--ref <sha>]`, as root:
1. Refuses a bad `--ref` (not 40 hex characters) or an unknown argument, a missing env file, clone or worktree folder, a stopped unit, an unpaused studio or a card in flight.
2. Runs git only in the code clone, every call as `git -c safe.directory=<code clone> -c core.fsmonitor=false -c core.hooksPath=/dev/null -C <code clone>`.
3. Refuses when `git status --porcelain --untracked-files=all` is not empty, printing the first entries and the commands to inspect them.
4. Fetches `+refs/heads/main:refs/remotes/origin/main` with the token header in git's environment for that command only.
5. Without `--ref`: checks out `main` if detached, `merge --ff-only refs/remotes/origin/main`, and requires `HEAD` to equal it. With `--ref`: requires the sha to be an ancestor of `origin/main`, checks it out detached and requires `HEAD` to equal it.
6. Reuses `peanutgallery/dispatcher:<sha>`, or retags `:current` when `platform/ops` did not change, or builds with `git archive --format=tar <sha>:platform/ops | docker build -f Dockerfile.dispatcher -`.
7. Runs `pnpm install --frozen-lockfile --prefer-offline` in a throwaway container: `--user 0:0 --cap-drop ALL --security-opt no-new-privileges`, no env file, `env -i` with `PATH`, `HOME`, `CI` and the store path, the code clone mounted at `/opt/peanutgallery`.
8. Makes the code clone root-owned with nothing group- or other-writable, and refuses if it is dirty afterwards.
9. Installs a unit only when `git show <sha>:platform/ops/<unit>` differs from `/etc/systemd/system`, restarts and waits for `startup probe passed`.

It never touches the work clone; the dispatcher fetches `main` there before every card.

**Provision.** As before (host, packages, swap, Docker, firewall, sshd, upgrades, the env file checks including the price table and model rows), then:
- the code clone at `/srv/peanutgallery-code`, cloned by root, with the extraheader, origin and clean checks and `.pnpm-store` excluded;
- the image from the clone's commit; `node_modules` through the same throwaway container when the installed `node_modules/.pnpm/lock.yaml` differs from `pnpm-lock.yaml`; the clone locked to root;
- the work clone cloned inside the image as uid 10001 (`agent_git`: `--user 10001:10001 --cap-drop ALL`, fsmonitor and hooks off), its origin and extraheader checked the same way;
- `/srv/peanutgallery-worktrees` as uid 10001, 0700;
- the units from `git show`.

Every step checks before it acts, and folders are fixed one level only, never recursively in a tree uid 10001 writes. It accepts x86_64 and aarch64: the board's Oracle Ampere host is arm64.

**Runbook.** `platform/ops/README.md` describes the layout, the new deploy, a roll back with `deploy.sh --ref <sha>`, what to do when deploy refuses a dirty clone, and key rotation for both clones.

## Acceptance criteria

- [x] `loadConfig` reads `DISPATCHER_REPO_ROOT`, `DISPATCHER_WORKTREE_ROOT`, `DISPATCHER_CODE_ROOT` and `DISPATCHER_CODE_READONLY`, keeps today's defaults, and refuses a code root other than the running one, an unknown read-only value and a writable root inside a read-only code root.
- [x] With `DISPATCHER_CODE_READONLY=required`, startup exits 78 before any database read when the code root or its `node_modules` is writable or missing, and passes on a tree mode 0555.
- [x] `dispatcher.service` mounts the code clone `:ro` and the work clone and worktree folder read-write, and sets the three roots and `DISPATCHER_CODE_READONLY=required`.
- [x] Every git call in `deploy.sh`, `provision.sh` and the entrypoint carries `-c core.fsmonitor=false -c core.hooksPath=/dev/null`; `deploy.sh` runs git only with `-C` the code clone; `provision.sh` runs host git on the code clone only.
- [x] `check_clean` in both scripts passes a clean clone with ignored files, refuses an untracked and a modified file, and does not run a planted `core.fsmonitor`.
- [x] Units come from `git show` and the image context from `git archive`; nothing is read from the working tree's `platform/ops`.
- [x] `deploy.sh` fast-forwards to the fetched `origin/main` and asserts `HEAD`, supports `--ref` on main, and installs `node_modules` in a `docker run --rm` with no env file.
- [x] The entrypoint runs nothing from the work clone and no `pnpm install`.
- [x] The image installs bubblewrap and socat and copies `managed-settings.json` as root to `/etc/claude-code/managed-settings.json`; the dockerignore admits it; the settings parse and hold the deny list.
- [x] `provision.sh` refuses the unit's four variables in the env file, creates both clones and the worktree folder with their owners, and accepts aarch64.
- [x] Every ops script passes `bash -n` (the entrypoint `sh -n` and `dash -n` too).
- [ ] Every ops script passes shellcheck 0.9.0 (CI).
- [ ] The production steps below pass on the VPS.

## Verification

- `pnpm test:ops`
- `pnpm --filter @backseat/dispatcher test`
- `bash -n` on every changed script; `sh -n` and `dash -n` on the entrypoint.
- `shellcheck` on every script (CI's shellcheck 0.9.0 through `pnpm test:ops`).
- `pnpm verify` at the repository root exits 0.
- The production steps, quoted.

## Production steps (need the board's allow)

Each runs on the Oracle Cloud instance as root, during the cutover in `platform/ops/README.md`, and its output is quoted here.

1. **Provision.** `ssh root@$VPS_IP 'bash -s' < platform/ops/provision.sh`. Quote the output. Then quote `stat -c '%U:%G %a %n' /srv/peanutgallery-code /srv/peanutgallery /srv/peanutgallery-worktrees`, which must read `root:root 755`, `10001:10001 755` and `10001:10001 700`. Quote `find /srv/peanutgallery-code \( ! -user 0 -o -perm /022 \) ! -type l | head`, which must print nothing.
2. **Provision again.** The last line must read `provision: done: 0 change(s)`.
3. **bwrap inside the container.** Quote the command's output and exit status:
   `docker run --rm --user 10001:10001 --cap-drop ALL --security-opt no-new-privileges --entrypoint bwrap peanutgallery/dispatcher:current --unshare-all --ro-bind / / --proc /proc true; echo "exit $?"`.
   Docker's default seccomp profile may refuse the user namespace bwrap needs. A non-zero exit is recorded as the finding for the session-containment work and does not block this change.
4. **Managed settings in the image.** `docker run --rm --entrypoint stat peanutgallery/dispatcher:current -c '%U:%G %a' /etc/claude-code/managed-settings.json` reads `root:root 644`.
5. **Start and the startup check.** After the cutover start, `journalctl -u dispatcher -n 50 --no-pager` shows `code root is read-only` with `"codeRoot":"/opt/peanutgallery"`, then `startup probe passed`.
6. **Deploy twice.** `ssh root@$VPS_IP 'bash /srv/peanutgallery-code/platform/ops/deploy.sh'` twice with the studio paused. The first run restarts and quotes `startup probe passed`. The second prints `nothing to deploy`.
7. **Tamper drill.**
   - Run `touch /srv/peanutgallery-code/platform/ops/tamper-drill` and `deploy.sh`. It must stop with `refused: /srv/peanutgallery-code has uncommitted or untracked files` naming `platform/ops/tamper-drill`, and the running dispatcher and `/etc/systemd/system` must be unchanged.
   - Remove the file and run `deploy.sh` again: `nothing to deploy`.
8. **Write refusal drill.** Run `docker run --rm --user 10001:10001 -v /srv/peanutgallery-code:/opt/peanutgallery:ro --entrypoint touch peanutgallery/dispatcher:current /opt/peanutgallery/x`. It must fail with `Read-only file system`.

## Evidence

2026-09-16, branch `ops-separation` on `merge-safety` (3c357b4). Nothing was run against a VPS, Docker, GitHub or Supabase.

Test first. With the tests written and the source unchanged:
- `pnpm vitest run test/config.test.ts test/startup.test.ts` in `platform/dispatcher`: `Tests  11 failed | 24 passed (35)` (`CODE_PATHS is not iterable`, `checkCodeReadonly is not a function`, the new config fields missing).
- `node --test platform/ops/test/ops.test.mjs`: `tests 33`, `pass 18`, `fail 14`, `skipped 1`. Among the failures: `ENOENT … managed-settings.json`, the unit mounts, `check_clean`, the git switches, the entrypoint, and `account for every variable config.ts reads` for the new keys.

After the change:
- `pnpm --filter @backseat/dispatcher test`: `Test Files  25 passed (25)`, `Tests  308 passed (308)` (298 before).
- `pnpm --filter @backseat/dispatcher typecheck`: exit 0.
- `node --test platform/ops/test/ops.test.mjs`: `tests 33`, `pass 32`, `fail 0`, `skipped 1` (shellcheck is not installed on this Mac).
- `bash -n`: `deploy.sh`, `provision.sh` and `dispatcher-entrypoint.sh` exit 0; `dash -n dispatcher-entrypoint.sh` exit 0.
- `pnpm verify`, with this spec and `managed-settings.json` staged: exit 0, with these counts:
  - supabase `Tests  122 passed (122)`
  - site `Tests  123 passed (123)`
  - seed-1 `Tests  77 passed (77)`
  - dispatcher `Tests  308 passed (308)`
  - gate `PASS: gate tests passed=211`
  - agents `tests 64, pass 64`
  - ops `tests 33, pass 32, skipped 1`
  - deno `ok | 58 passed (33 steps) | 0 failed`
  - `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=309`

Criteria and the tests that prove them:
- Config: `config.test.ts`, "the code, repository and worktree roots".
- Startup check: `startup.test.ts`, "checkCodeReadonly" (writable, missing `node_modules`, a 0555 tree, skipped as root) and "startupChecks" (the check runs first and no probe runs; a read-only root reaches the probe).
- Unit, git switches, work clone, `check_clean` with the fsmonitor control, `git show` and `git archive` (run against a fixture repository with a tampered working tree), deploy's fetch, `--ref` and install, provision, entrypoint, image and managed settings: `ops.test.mjs`, "the code clone and the work clone".
- The unit's variables refused in the env file: `ops.test.mjs`, "provision.sh env file checks".
- The Linux managed-settings path: the 2.1.139 binary on the Mac (`~/.local/share/claude/versions/2.1.139`) resolves its managed folder as `/Library/Application Support/ClaudeCode` on macOS, `C:\Program Files\ClaudeCode` on Windows and `/etc/claude-code` otherwise, and reads `managed-settings.json` and `managed-settings.d` there.

Pending: shellcheck in CI, and every production step.

## Decisions

- 2026-09-16: the code clone is a root-owned host clone mounted read-only, not a `COPY` into the image. A deploy stays a fast-forward, an install and a restart, and the image stays the toolchain only.
- 2026-09-16: `DISPATCHER_CODE_ROOT` is checked against the path the process runs from rather than trusted. The read-only check must look at the code actually loaded.
- 2026-09-16: the startup check tests the top folders, not every file. The `:ro` mount covers the whole tree and `deploy.sh` locks ownership recursively; a full walk of `node_modules` at every start buys little.
- 2026-09-16: `.env` is read from the code root only. The work clone is writable by agent code, and a planted `.env` could set `CLAUDE_BIN`.
- 2026-09-16: tsx's cache is off in the container. Its cache folder is in `/tmp`, shared with agent sessions for the life of the container.
- 2026-09-16: `pnpm install` runs as root in the throwaway container, with no capability, no env file and a four-name environment. It writes a root-owned tree; dependency scripts see no secret and no host path but the code clone.
- 2026-09-16: the pnpm store lives in the code clone, excluded from git, so pnpm hard-links within one mount instead of copying.
- 2026-09-16: `deploy.sh` leaves the work clone to the dispatcher, which fetches `main` before every card, so root never runs git there. `provision.sh` creates it inside the image as uid 10001.
- 2026-09-16: a roll back is `deploy.sh --ref <sha>` with the sha on `origin/main`, replacing the hand-run `docker tag` and `git checkout`. A plain deploy returns the code clone to `main`.
- 2026-09-16: a dirty code clone is refused, not cleaned. Only the two scripts change it, so a difference needs a person to look.
- 2026-09-16: `provision.sh` accepts aarch64. Its x86_64-only check contradicted the 16 Sep decision for an Oracle Ampere host and would have stopped provisioning there.
- 2026-09-16: the smoke worktree moves with the rest, so `merge-safety.md`'s live line reads `/srv/peanutgallery-worktrees/smoke-` on the VPS rather than `.worktrees/smoke-`.
