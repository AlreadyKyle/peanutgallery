# The Actions host: the dispatcher and the daily jobs on GitHub Actions

Status: built. Card: none. Owner: board.

## Problem

Live criterion 2 needs the dispatcher running unattended. The board's Mac cannot host it around the clock (`mac-host.md`), and on 6 October 2026 the board rejected the Google Cloud e2-micro of PLAN.md §10 decision 60, because an in-use public IPv4 address bills $0.005 an hour, which decision 35 does not allow. The same day the board made the repository public, so its GitHub Actions minutes are free. The dispatcher needs a host built on that, and the daily jobs, which also ran on the Mac, need one too.

## Scope

In:
- The dispatcher's drain: `DISPATCHER_DRAIN_AT` in `platform/dispatcher/src/config.ts`, `tick.ts` and `main.ts`, with unit tests.
- `.github/workflows/dispatcher.yml` and `platform/ops/actions/run-dispatcher.sh`, with tests in `platform/ops/test/ops.test.mjs` ("the GitHub Actions host").
- The daily jobs' workflow, live in the board's private repository AlreadyKyle/mobmachine-ops since 6 October 2026, recorded here with its template in `platform/ops/ops-repo/` (`jobs.yml`, `README.md`), replacing `platform/ops/backups-repo/` (the Oracle-era weekly fallback, never set up); its test is "the ops repository template".
- Docs: PLAN.md §10 decision 61 (38 and 60 marked superseded), §4 Not built yet, §6, §11 and the risks paragraph; ROADMAP criterion 2, the standing facts and the spec table; BACKLOG ("Move the dispatcher off the Mac" rewritten as the paid upgrade, and two new entries); BOARD-SETUP step 23 and step 39; the runbook's The GitHub Actions host; superseded notes in `mac-host.md`, `vps.md` and `jobs-only-install.md`; `money-safety.md`'s backups repository lines.

Out: creating the environment `dispatcher`, setting any secret, variable or environment, and starting a run (the operator's steps, below); the cutover itself; the weekly restore check and the quota job's Actions minutes read (backlog entries); branch protection on main; the paid always-on host (backlog).

## Behaviour

**The drain.** `DISPATCHER_DRAIN_AT`, an ISO 8601 time with its zone, is read by `loadConfig` (a malformed value is a fatal `ConfigError`, exit 78). From that time each tick claims no card and starts no job (`sleep` with reason `draining`); it still deals and resumes by rule, watches stuck cards, writes the heartbeat, pings and runs the outbound lane. After each tick `main` asks `drainState`: once no card and no job this process started is running it logs `dispatcher drained`, leaves the loop, releases the lease and exits 0. Unset, nothing changes.

**One run.** `dispatcher.yml` runs on `workflow_dispatch` and every 30 minutes, in the concurrency group `dispatcher` with `cancel-in-progress: false` (one run, at most one waiting), with `timeout-minutes: 355`. Its one job runs only on main in AlreadyKyle/peanutgallery and only while the repository variable `DISPATCHER_HOST` is `on`, in the GitHub environment `dispatcher`, whose deployment branch policy (set by the operator) allows main alone, with `contents: read` and `actions: write`. It records the start, checks out the run's sha with no credential kept, installs `node_modules` with no secret in the step, installs age, then runs `run-dispatcher.sh run` with `DISPATCHER_ENV` (the environment secret: the text `make-dispatcher-env.sh` writes). The script writes it to a 0600 file, masks every value of eight characters or more, checks it with `provision.sh`'s `check_env_lines` (and refuses `DISPATCHER_DRAIN_AT` in it), copies it to the checkout's `.env`, checks that the dispatcher's dotenv reads it as written, makes the checkout `chmod -R a-w` and checks nothing in it is still writable, clones the work clone fresh from main with the token in a one-off header, and runs `node --import tsx src/main.ts` from the checkout under `timeout --preserve-status --signal=TERM --kill-after=90`, with only PATH, HOME, USER, TMPDIR and LANG from its environment, the three roots, `DISPATCHER_CODE_READONLY=required`, `TSX_DISABLE_CACHE=1` and `DISPATCHER_DRAIN_AT` at the run's start plus 300 minutes. The hard stop is the start plus 350 minutes.

**Logs.** The dispatcher's output goes to a file only. The public log shows the script's own lines and `dispatcher: <message>` for a fixed list of lifecycle messages, never a field. The file is encrypted with age to `vars.BACKUP_AGE_RECIPIENT` and uploaded as `dispatcher-log-<run id>-<attempt>`, kept 14 days; with no recipient it is deleted and the step fails.

**The next run.** The script's outputs decide: exit 78 or a failed check is fatal (ntfy "Mob Machine dispatcher stopped on GitHub Actions: fatal startup error", no next run); a drain, a hard stop or a run of 600 seconds or more starts the next run with `gh workflow run dispatcher.yml --ref main` and the job token; a shorter failed run posts to ntfy and waits for the schedule. A failure the script did not alert on (the install, the log) posts to ntfy from the last step.

**The daily jobs.** `AlreadyKyle/mobmachine-ops/.github/workflows/jobs.yml` (template `platform/ops/ops-repo/jobs.yml`) runs the backup at 06:17, the Controller at 07:07 and the quota check at 07:37 UTC, and any one on `workflow_dispatch` with the input `job`. It sparse-checks-out this repository at `vars.STUDIO_REF`, a full sha, for `platform/ops` and `platform/supabase/functions/_shared`. The backup runs `platform/ops/mac/backup-mac.sh` with `BACKUP_PG_BIN=/usr/lib/postgresql/17/bin` (`postgresql-client-17` from the PostgreSQL apt repository) and `BACKUP_DIR=$RUNNER_TEMP/backups`, up to 3 attempts, then uploads the `.tar.age` as an artifact kept 90 days. The Controller and the quota check run `jobs/check-env.mjs`, then `jobs/main.mjs`. Its secrets are `BACKUP_ENV`, `CONTROLLER_ENV`, `QUOTA_ENV` (each job's env file text) and `NTFY_TOPIC_URL`; a failure posts to ntfy. Moving `STUDIO_REF` is part of a deploy that changes `platform/ops`.

## Acceptance criteria

- [x] `DISPATCHER_DRAIN_AT` unset changes nothing; set, from that time the tick claims no card and starts no job while it still deals and writes the heartbeat; `drainState` is off, draining or drained as running cards and jobs say; a time with no zone or that does not parse is a `ConfigError`.
- [x] `main` exits the loop with `dispatcher drained` once drained, then releases the lease and exits 0.
- [x] The workflow runs on `workflow_dispatch` and `*/30 * * * *`, in concurrency group `dispatcher` with `cancel-in-progress: false`, on main in this repository with `DISPATCHER_HOST` on, in environment `dispatcher`, with `timeout-minutes: 355`, `contents: read` at the top and `contents: read` with `actions: write` on its one job.
- [x] Every action is pinned to a commit sha; the checkout of the run's sha keeps no credential; only the run and alert steps reference a secret, and only `DISPATCHER_ENV`; the install step holds none; no step prints the secret.
- [x] Drain at 300 minutes and hard stop at 350, SIGKILL 90 seconds later, inside the 355-minute timeout; the script's defaults equal the workflow's.
- [x] The dispatcher runs from the read-only checkout with the Mac's environment rules plus `DISPATCHER_DRAIN_AT`, after `check_env_lines`, the `.env` copy and the dotenv check, in that order.
- [x] The next run starts with `gh workflow run dispatcher.yml --ref main` only when the script says so: never after a fatal exit, always after a drain or a hard stop, and after a run of 10 minutes or more.
- [x] The log is encrypted with age to `vars.BACKUP_AGE_RECIPIENT` and only the ciphertext is uploaded, for 14 days; the public log carries only fixed lifecycle lines.
- [x] The work clone is made with the token in git's environment only, never on its command line or in `.git/config`.
- [x] The daily jobs' template is in `platform/ops/ops-repo/` with only its own secrets, reads contents only, runs the three jobs at their times from `STUDIO_REF`, and is not a workflow of this repository; `backups-repo/` is gone.
- [x] The daily jobs run on Actions in AlreadyKyle/mobmachine-ops, and the Mac's LaunchAgents are removed.
- [ ] The operator's setup: the environment `dispatcher` allowing main alone, `DISPATCHER_ENV`, `BACKUP_AGE_RECIPIENT` (waits on: the board's allow and the managed agent's ids, which wait on Console credit).
- [ ] The cutover: `PASS: toolchain`, the first run's `code root is read-only`, `containment verified` and `startup probe passed` lines, the heartbeat, the ntfy test on the board's phone (waits on: the setup and Console credit).
- [ ] The restart and liveness checks, and a 24-hour soak across at least four drains with each run starting the next (waits on: the cutover).
- [ ] The Controller's first clean run after a payout clears its minimum balance item (waits on: the first payout).

## Verification

- `pnpm --filter @backseat/dispatcher test` (the drain tests in `tick.test.ts` and `config.test.ts`)
- `pnpm test:ops`
- `pnpm test:docs`
- `pnpm secret-scan`
- `pnpm verify`
- A scratch run of `run-dispatcher.sh run` on the Mac with a copied checkout, fixture env values and stand-ins for `timeout` and GitHub, through the dispatcher's first database call, and the fatal path.
- The operator's setup and the cutover's lines, quoted (waits on: the board).

## Evidence

EVIDENCE_GOES_HERE

## Decisions

- 2026-10-06 (board): the repository is public; the dispatcher's host is GitHub Actions in it; the Google Cloud e2-micro is rejected for its IPv4 charge; the Mac is retired (PLAN.md §10 decision 61).
- 2026-10-06: the run logic lives in `platform/ops/actions/run-dispatcher.sh`, not inline in the workflow, so the ops tests can run its functions and shellcheck can read it, as for the Mac's wrapper.
- 2026-10-06: a repository variable `DISPATCHER_HOST` switches the job on, a deviation from the brief. Without it, merging the workflow would start a run every 30 minutes before the environment and its secret exist; GitHub would also create the environment `dispatcher` on first use with no branch policy. It is also how the host is stopped, since a schedule cannot be paused otherwise without disabling the workflow.
- 2026-10-06: the next run starts at once only after a drain, a hard stop or a run of 10 minutes or more. A run that fails sooner (a crash at startup) waits for the 30-minute schedule, which is the restart delay the Mac's wrapper and systemd kept; immediate re-dispatch would loop.
- 2026-10-06: the drain claims no job either, and keeps dealing, the heartbeat, the ping and the outbound lane, so /board sees the dispatcher alive until it exits; a job already running finishes. The process waits for nothing else: a card still running at the hard stop is the fallback, interrupted on SIGTERM and paused by the next start's recovery.
- 2026-10-06: the hard stop is `timeout` with `--preserve-status`, so a dispatcher that stops cleanly on SIGTERM exits 0 and is not counted as a failure; the hard stop is detected from the clock.
- 2026-10-06: every value of eight characters or more in the env file is masked with `::add-mask::`, as defence in depth; the script prints key names only, and the dispatcher's output never reaches the public log. Shorter values (a mode, a number) would mask ordinary words.
- 2026-10-06: the toolchain check runs from the board's checkout with `node --env-file` on the written env file, not on a runner: it is a Managed Agents session, the same from any host, and a runner would need a second workflow holding the secret.
- 2026-10-06: every merge to main reaches the host at the next run, with no board-confirmed deploy as `deploy.sh` required on a server or the Mac. The kernel paths (`.github`, `platform/dispatcher`, `platform/ops`, the lockfile and the workspace files) keep cards from changing what the host runs, so only a board pull request does; the runbook names this as weaker than a server.
- 2026-10-06 (board): the daily jobs run in a private repository of the board's, AlreadyKyle/mobmachine-ops, never in this public one, so no job secret sits where card code or a public log reaches it; the job code is pinned by `STUDIO_REF`. Its template replaces `backups-repo/`, which uploaded to an Oracle bucket and was never set up.
