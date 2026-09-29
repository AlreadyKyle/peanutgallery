# The jobs before the cutover: `install.sh --jobs-only`

Status: built. Card: none. Owner: board.

## Problem

Contributions are open, so the money database is live, but it has no scheduled backup. `platform/ops/mac/install.sh` installs the nightly backup, Controller and quota LaunchAgents only after `check_host_env` passes on `~/peanutgallery-host/env/dispatcher.env`. That file needs `MANAGED_AGENT_ID`, `MANAGED_AGENT_VERSION` and `MANAGED_ENVIRONMENT_ID` from `managed:apply`, which fails until the studio's Anthropic organisation has Console credit (`BOARD-SETUP.md` step 22), and the code clone is cloned with that file's `GITHUB_TOKEN`. So until the cutover (step 23) a backup runs only by hand (`sweep-27-sep.md`, Scope, Out).

## Scope

In:
- `install.sh --jobs-only`: the jobs' LaunchAgents from a read-only code clone, with no dispatcher env file, no `.env` in the clone, no `node_modules` and no work clone.
- The plain `install.sh` refusing the clone `--jobs-only` made, so the cutover never runs the dispatcher from main as it was when the jobs went in.
- Tests in `platform/ops/test/ops.test.mjs` ("install.sh --jobs-only").
- `BOARD-SETUP.md` steps 3 and 19, the runbook's The Mac host (`platform/ops/README.md`), `mac-host.md`'s install paragraph, and the ROADMAP.

Out: any change to `run-job.sh`, `backup-mac.sh`, the job template or the jobs themselves; `deploy.sh` for a jobs-only host (it still requires the dispatcher's LaunchAgent loaded, so the jobs' code moves only by moving the clone aside and installing again); running anything on the Mac, which is the board's (Production steps).

## Behaviour

`platform/ops/mac/install.sh --jobs-only`, from the board's checkout of reviewed main, with the values in `.env.vps` exported:

- It runs the same Mac check first as a plain install: macOS, not root (so never under sudo), node 22 or later, the pinned pnpm and the tools. It creates the host folders 0700 as a plain install does.
- It checks each job's env file that exists, `env/backup-mac.env`, `env/controller.env` and `env/quota.env`: the board's own, not a symlink, mode exactly 0600, and passing `platform/ops/jobs/check-env.mjs` from the board's checkout (so a Stripe secret key or the owner's connection string under any name, another job's key, or a malformed line is refused, naming keys only). `backup-mac.env` must exist; a job whose file is missing is left out and named.
- It writes `env/ntfy.url` from the exported `NTFY_TOPIC_URL` (one https address), or keeps the one already there; with neither it stops, since a failed job alerts through it.
- When `code/` is not a clone yet, it clones main from the repository's URL with the exported `GITHUB_READ_TOKEN` (Contents read only), or `VPS_GITHUB_TOKEN` when that is not exported. The token must be fine-grained (`github_pat_`). It reaches git as a one-off header, as a plain install sends it, through a 0600 file in the run's private folder that is deleted at once; it is never printed, on a command line or in `.git/config`. The commit is recorded in `state/code-jobs-only`. A second run with no token exported clones nothing and needs none.
- It refuses a code clone that is dirty or holds git state a clone does not have (the server's `check_clean` and `check_code_clone`), or whose origin is not the repository's URL, and never moves one.
- It makes the whole clone read-only (`chmod -R a-w`), then checks nothing in it is writable and that its root, `platform/ops`, `platform/ops/mac` and `platform/ops/jobs` refuse a new file. The clone is locked again on every exit.
- It writes and loads the LaunchAgents of the jobs whose env files passed, from the code clone's commit, as a plain install does. It writes no dispatcher LaunchAgent. It prints key names and paths, never a value, and a second run ends `install: done: 0 change(s)`.

A plain `install.sh` (and `--start`) first refuses a code clone made by `--jobs-only`, printing the commands that move it aside (`chmod -R u+w` then `mv` next to the host folder); once it is gone, it removes the record and clones main afresh with the dispatcher env file's token. So the cutover runs the dispatcher from main as the cutover finds it. `--jobs-only --start` is a usage error.

## Acceptance criteria

- [x] With only `backup-mac.env` and no `dispatcher.env`, `--jobs-only` clones with `GITHUB_READ_TOKEN` (the host token also exported), loads only `studio.peanutgallery.backup`, writes `ntfy.url`, leaves no `.env`, `node_modules`, work clone or dispatcher LaunchAgent, leaves nothing in the clone writable, records the commit, puts no token in `.git/config` or the output, and a second run with no token reports `0 change(s)`.
- [x] A job whose env file exists and passes is installed too; with only `VPS_GITHUB_TOKEN` exported, the clone uses it.
- [x] It stops, writing no LaunchAgent and printing no value, on: a missing `backup-mac.env`; one at 0644; one that is a symlink; another job's key in it; the owner's connection string; a Stripe secret key in `controller.env`; no token to clone with; a classic token; no `NTFY_TOPIC_URL` and no `ntfy.url`; an `http` alert address.
- [x] It refuses a dirty code clone and leaves it read-only on the way out.
- [x] A plain install refuses the clone `--jobs-only` made, naming its commit and the move-aside commands, and once it is moved removes the record.
- [x] The Mac check (not root) runs before either mode, and a plain install checks for a jobs-only clone before it reads the dispatcher env file.
- [x] `install.sh` passes `bash -n` and shellcheck.
- [ ] On the Mac: `install.sh --jobs-only` twice, the second at `0 change(s)`, and the first nightly backup PASS with its file in the Drive folder (waits on: the board's step 3 and its allow).

## Verification

- `pnpm verify`
- `node --test --test-name-pattern="jobs-only" platform/ops/test/ops.test.mjs`
- `shellcheck platform/ops/mac/*.sh`
- On the Mac, with the board's allow: `platform/ops/mac/install.sh --jobs-only` twice, then `~/peanutgallery-host/code/platform/ops/mac/run-job.sh backup --now; tail -n 10 ~/peanutgallery-host/logs/backup.log`, quoted (waits on: the board).

## Production steps (need the board's allow)

1. After the board's step 3 and the backup login's password (`money-safety.md`, production step 3): `JOBS_ENV_DIR=~/peanutgallery-host/env platform/ops/make-jobs-env.sh backup-mac` (and `controller`, `quota` once their keys exist), then, with `.env.vps` exported, `platform/ops/mac/install.sh --jobs-only` twice. Quote both.
2. `run-job.sh backup --now` and the file in the Drive folder. Quote them.
3. At the cutover (step 23): move the jobs-only clone aside as the refusal prints, then the plain install as the runbook lists it.

## Evidence

- `node --test --test-name-pattern="jobs-only" platform/ops/test/ops.test.mjs`: `tests 5`, `pass 5`, `fail 0` ("install.sh --jobs-only": the fresh install and second run, the other jobs and the host-token fallback, the ten refusals and the usage error, the dirty clone and the plain install's refusal, the order in `main`).
- `shellcheck platform/ops/mac/install.sh`: no output.
- `pnpm verify` on this branch, exit 0: `platform/dispatcher` 861, `platform/site` 531, `platform/supabase` 325, `platform/board` 103, `seed-1` 77, `test:ops` `pass 140` `fail 0` (135 before this change), `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=691`.

## Decisions

- 2026-09-27: the read token first. The clone only reads, so `GITHUB_READ_TOKEN` (Contents read only) is the least a clone needs; `VPS_GITHUB_TOKEN` is the fallback because the board already exports it for `make-jobs-env.sh`. Neither is kept on the host after the clone.
- 2026-09-27: no `node_modules` and no dispatcher read-only check in this mode. The jobs import nothing beyond Node (`platform/ops/jobs/lib.mjs`), and `backup-mac.sh` is bash, so installing packages would only add what an install script could run; the read-only check covers what the jobs run from instead.
- 2026-09-27: the plain install refuses the jobs-only clone rather than moving or fast-forwarding it. `install.sh` never moves a code clone (only `deploy.sh` does, behind the gate and the board's confirmed sha), and a jobs-only clone holds main as it was when the jobs went in; moving it aside by hand keeps that rule and makes the cutover clone main afresh.
- 2026-09-27: `NTFY_TOPIC_URL` is required, since `backup-mac.env` holds no alert address and a job that fails silently is what this change exists to stop.
