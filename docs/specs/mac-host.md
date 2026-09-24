# The Mac host: the dispatcher unattended on the board's Mac

Status: built. Card: none. Owner: board.

## Problem

Live criterion 2 needs the dispatcher running unattended, restarting on its own and alerting the board. The plan put it on an Oracle Cloud Always Free instance (`vps.md`, `oracle-launch.md`), but on 23 September 2026 the board decided it cannot put a card on file for a cloud server now and does not trust Oracle (PLAN.md §10 decision 38). Nothing else can host the dispatcher and the daily jobs, and the backup's store was an Oracle bucket.

## Scope

In:
- The dispatcher under launchd on the board's Mac (a MacBook Pro on Apple Silicon, macOS, plugged in), in `~/peanutgallery-host`, outside the board's checkout: a read-only code clone, a work clone and a worktree folder, as on a server.
- `platform/ops/mac/`: `run-dispatcher.sh` (the wrapper), `run-job.sh` (the jobs), `backup-mac.sh` (the backup), `install.sh`, `deploy.sh`, `uninstall.sh`, `lib.sh`, and the LaunchAgent templates `studio.peanutgallery.dispatcher.plist` and `studio.peanutgallery.job.plist`.
- `make-jobs-env.sh`, `jobs-env.mjs`, `jobs/lib.mjs` and `jobs/check-env.mjs`: the Mac's backup env file (job `backup-mac`) and `JOBS_ENV_DIR`.
- Tests in `platform/ops/test/mac.test.mjs`, imported by `ops.test.mjs`.
- The docs that named Oracle as the host or the backup store: PLAN.md (§6, §10 decisions 17 and 38, §11), ROADMAP.md, BOARD-SETUP.md steps 3 and 8, the runbook, `vps.md`, `oracle-launch.md`, `money-safety.md`, `ops-separation.md`, `launch-managed.md`, the root README and the backups repository template; two backlog entries.

Out: the Google Cloud move (a backlog entry, waiting on the board's billing account); a new store for a server's backups; deleting the Oracle scripts or the server's units, which the Google Cloud server reuses; any install into `~/peanutgallery-host` or any LaunchAgent loaded by this change; the production steps, which are the board's (below).

## Behaviour

**Layout.** `~/peanutgallery-host` (`PEANUTGALLERY_HOST` names another): `code/` is a clone of main, the code root, holding the dispatcher's `.env`, `node_modules` and the pnpm store; `work/` is the work clone (`DISPATCHER_REPO_ROOT`); `work-worktrees/` holds card worktrees (`DISPATCHER_WORKTREE_ROOT`, which is also the dispatcher's default for that clone); `env/` (0700) holds `dispatcher.env`, the jobs' env files and `ntfy.url`, each 0600; `state/` and `logs/`. After every install the whole code clone is `chmod -R a-w`, so `DISPATCHER_CODE_READONLY=required` passes: `checkCodeReadonly` in `platform/dispatcher/src/startup.ts` asks `access(W_OK)` of each folder in `CODE_PATHS` and tries to create a file in it, and both fail for a non-root owner once the write bits are gone. The dispatcher reads `.env` from its code root only (`main.ts`), so `install.sh` copies `env/dispatcher.env`, written by `make-dispatcher-env.sh <path>` in the server's format, to `code/.env` while the clone is writable, and checks that the dispatcher's own dotenv reads every line back as written, `PRICE_TABLE_JSON` included.

**The dispatcher.** The LaunchAgent `studio.peanutgallery.dispatcher` runs `/bin/bash code/platform/ops/mac/run-dispatcher.sh` at login (`RunAtLoad`), with `KeepAlive {SuccessfulExit=false}`, `ThrottleInterval` 30 and `ExitTimeOut` 90. The wrapper:
- runs the entrypoint's checks (a dispatcher, `node_modules` and a `.env` in the code clone; a work clone whose origin is an https github.com URL; `caffeinate` and `node` on its PATH);
- holds `caffeinate -i -s -w <its pid>`, so the Mac does not idle-sleep, or sleep at all on power, while it runs; a closed lid still sleeps it;
- runs `node --import tsx src/main.ts` from `code/platform/dispatcher` with only PATH, HOME, USER, TMPDIR and LANG from its environment, the three roots, `DISPATCHER_CODE_READONLY=required` and `TSX_DISABLE_CACHE=1`;
- maps exits as systemd would: exit 78, or a failed check of its own, posts "Peanut Gallery dispatcher stopped on <host>: fatal startup error" to ntfy and exits 0, which launchd does not restart; any other exit, 0 included unless launchd asked it to stop, waits 30 seconds doubling at each failure in a row to 30 minutes at the seventh (a run of 10 minutes or more resets the count), then exits 1 so launchd starts it again; the ninth start within 6 hours is refused with an ntfy post and exit 0;
- passes launchd's SIGTERM to the dispatcher and exits 0 once it has stopped;
- writes its own lines and the dispatcher's to `logs/dispatcher.log`, rotated at 10 MB with three kept, and keeps its counts in `state/`.

**The jobs.** The LaunchAgents `studio.peanutgallery.backup`, `.controller` and `.quota` wake `run-job.sh <job>` every hour at the job's minute (17, 07, 37). launchd's calendar is local time, so the script runs each job once per UTC day at the first wake at or after its UTC time, the same times as the server's timers (06:17, 07:07, 07:37); a wake missed while the Mac slept runs at wake. The Controller and the quota check run `node --env-file=env/<job>.env platform/ops/jobs/main.mjs <job>` from the code clone after the file passes `check-env.mjs` and is the owner's at 0600. A job that fails posts "Peanut Gallery job <job> failed on <host>" to ntfy. `--now` runs a job at once.

**The backup.** `backup-mac.sh` needs no Docker, Supabase CLI or object store. It dumps with Homebrew's libpq (`/opt/homebrew/opt/libpq/bin`) as the read-only `peanutgallery_backup` login through the Session pooler, with backup.sh's refusals (the owner's connection string or a Stripe secret key under any name, another login, a missing key). The password reaches libpq in a service file inside the run's private folder. `pg_dump` must be at least the server's major version. The set: `roles.sql` (`pg_dumpall --roles-only --no-role-passwords`, Supabase's own roles commented out and `NOSUPERUSER`/`NOREPLICATION` dropped as the Supabase CLI does; the run fails if the login is refused it), `schema.sql` and `data.sql` (public and money: every schema the migrations create, since `pg_dump --schema` leaves out what a named schema depends on), `auth.sql` (unless `BACKUP_SKIP_AUTH=1`), `history_schema.sql`, `history_data.sql`, and `identity.json` (the live ledger identity). It tars them, encrypts to `BACKUP_AGE_RECIPIENT`, deletes the plaintext on every exit, and writes `peanutgallery-<UTC time>.tar.age` to `BACKUP_DIR` under a hidden name then renamed. `BACKUP_DIR` is a folder the board chooses inside a Google Drive for desktop folder, so the file leaves the Mac. It deletes backups older than `BACKUP_KEEP_DAYS` (30) while keeping the newest 7, and pings `BACKUP_HEALTHCHECK_URL` or its `/fail`. There is no weekly restore check: it needs a scratch Supabase Postgres, which the server ran in Docker. The restore drill is a documented step by hand (runbook, Restore a Mac backup); after the dumps it runs `platform/ops/after-restore.sql`, which makes what no dump carries (the sign-in trigger on `auth.users`, Realtime's tables, the backup login's grants and the pg_cron jobs).

**Install, deploy, uninstall.** `install.sh` checks the Mac (macOS, not root, node 22 or later, the pinned pnpm, the tools), creates the layout, checks `env/dispatcher.env` with `provision.sh`'s own `check_env_lines`, writes `env/ntfy.url`, clones both clones with the env file's token through a one-off header (never on a command line or in `.git/config`), refuses a dirty or altered code clone with the server's `check_clean` and `check_code_clone`, installs `node_modules` once per commit with no secret in pnpm's environment and a HOME of its own, copies and checks the `.env`, locks the clone and runs the read-only check, and writes the four LaunchAgents rendered from the code clone's commit, loading the jobs and leaving the dispatcher disabled so a login does not start it before the cutover. It prints key names and paths, never a value, and a second run reports `install: done: 0 change(s)`. `install.sh --start` refuses unless /board shows the agent mode unattended, then enables and loads the dispatcher and waits for this start's `code root is read-only` and `startup probe passed` lines. `deploy.sh` is the server's `deploy.sh` for the Mac: it refuses unless the studio is paused with nothing building or gated and the dispatcher is loaded, refuses a dirty clone, fetches main by the repository's URL, requires the gate green on the target through the GitHub API, prints the review and moves only on the confirmed sha, then `chmod -R u+w`, fast-forward (or `--ref` to a commit on main that has the Mac files), install, `chmod -R a-w`, the checks again, any changed LaunchAgent rewritten, `launchctl kickstart -k`, and the wait for the probe lines; the clone is locked again on every exit. `uninstall.sh` unloads and removes the LaunchAgents and leaves the host folder.

**One dispatcher.** The dispatcher lease already keeps two dispatchers from ticking. The attended dispatcher must not be started while the host runs; its attended mode would also disagree with /board's and stop it at startup.

## Acceptance criteria

- [x] PLAN.md records decision 38 and marks 17 superseded by it; §6, §11 and the appendix name the Mac host and no Oracle host; ROADMAP criterion 2 says the dispatcher runs on the board's Mac under launchd until a server exists; BOARD-SETUP step 3 is the Mac's preparation and step 8 the Mac cutover; `vps.md` and `oracle-launch.md` open with a superseded note; the runbook has The Mac host.
- [x] The backlog has "Move the dispatcher to Google Cloud" (later, rank 41) and "Split slider on the site, in place of the checkout dropdown" (later, rank 42), each linked from PLAN.md §4 Not built yet, and "Run the studio without an always-on server" no longer names Oracle.
- [x] `run-dispatcher.sh` runs the dispatcher from the code clone as the entrypoint does, with `DISPATCHER_CODE_READONLY=required`, the three roots, the tsx cache off and none of its own environment, and holds `caffeinate -i -s -w`.
- [x] Exit 78 and a failed layout check post the fatal alert and exit 0; any other exit waits 30, 60, ... 1800 seconds and exits 1; the ninth start in 6 hours is refused with an alert; starts older than 6 hours do not count; SIGTERM reaches the dispatcher and the wrapper exits 0.
- [x] The dispatcher's LaunchAgent renders with `RunAtLoad`, `KeepAlive {SuccessfulExit=false}`, `ThrottleInterval` 30 and `ExitTimeOut` 90, and each job's with its minute and no run at load; a host folder or PATH a plist cannot carry is refused.
- [x] `run-job.sh` runs each job once per UTC day at its systemd timer's time, and launchd wakes it at that minute; it checks the env file and runs `node --env-file`; a failure posts the job alert.
- [x] `backup-mac.sh` dumps as the backup login through a service file with no password on a command line, comments out Supabase's roles, encrypts, writes the folder at 0600, leaves no plaintext, pings the check; it leaves auth out with `BACKUP_SKIP_AUTH=1`; it refuses the owner's login under any name, a Stripe secret key, another login, a missing key or folder, a relative folder and an env file others can read; it stops on an old `pg_dump` and a refused role dump, pinging `/fail`; it prunes by age keeping the newest 7 and nothing it did not write.
- [x] `chmod -R a-w` satisfies the dispatcher's own `checkCodeReadonly`, and `check_readonly` checks the same folders and names one left writable.
- [x] The dispatcher's dotenv reads the file `make-dispatcher-env.sh` writes exactly as written, `PRICE_TABLE_JSON` included, and `check_dotenv` names a line it would cut.
- [x] `make-jobs-env.sh` writes `backup-mac.env`, `controller.env` and `quota.env` into `JOBS_ENV_DIR`, each passing `check-env.mjs` and read by `node --env-file` as written; it refuses a folder others can open and a relative `BACKUP_DIR`.
- [x] `deploy.sh` rolls back only to a commit on origin/main with the Mac files, and its steps run in order: loaded, quiet, clean, unlock, fetch, gate, review, confirm, move, install, lock, read-only check, dotenv check, restart, probe.
- [x] Every script passes `bash -n` and shellcheck, is executable in git, and every git call turns hooks and fsmonitor off.
- [ ] The board's preparation (step 3) done, and `install.sh` run twice on the Mac with the second run at `0 change(s)` (waits on: the board's step 3 and the env files).
- [ ] The Controller's dry run, the quota check and the first backup PASS on the Mac, with the backup file in the Drive folder (waits on: `STRIPE_READ_KEY`, the backup login's password, the age key and the backup check).
- [ ] The cutover: `PASS: toolchain`, `install.sh --start` quoting `code root is read-only` and `startup probe passed`, the heartbeat, the ntfy test on the board's phone (waits on: Console credit and board step 8).
- [ ] The restart, kill and login checks, the liveness alert email, and a 24-hour soak with no restart loop (waits on: the cutover).
- [ ] The restore drill of a Mac backup: `holds` prints `true` and matches `identity.json` (waits on: the first backup and the board with the offline key).

## Verification

- `pnpm verify`
- `pnpm test:ops` (imports `mac.test.mjs`)
- `shellcheck platform/ops/mac/*.sh platform/ops/make-jobs-env.sh`
- On the Mac, after the board's step 3: `platform/ops/mac/install.sh` twice, quoted (waits on: the board).
- The first job runs of the runbook's Install, quoted (waits on: the keys above).
- The cutover's lines, the restart checks and the soak (waits on: Console credit and the cutover).
- The restore drill (waits on: the board with the offline key).

## Production steps (need the board's allow)

1. After the board's step 3: write `env/dispatcher.env` with `make-dispatcher-env.sh` and the jobs' with `JOBS_ENV_DIR=~/peanutgallery-host/env make-jobs-env.sh backup-mac controller quota`, then `install.sh` twice. Quote both outputs.
2. The Controller's dry run (after the board is told what it reads), `run-job.sh quota --now` and `run-job.sh backup --now`. Quote each.
3. The cutover, board step 8, as the runbook's The cutover on the Mac lists it. Quote each line it names.

## Evidence

Built on branch `launch/mac-host`. Nothing was installed into `~/peanutgallery-host`, no LaunchAgent was loaded and no production service was called.

- `chmod -R a-w` against the dispatcher's own check, run with tsx on a scratch tree holding the six `CODE_PATHS` folders: `PASS: checkCodeReadonly accepts a tree after chmod -R a-w`, then with one folder made writable again, `refused as expected: the code root ... is writable by this process or incomplete: platform/dispatcher/src (writable)`.
- `install.sh` in a scratch host folder (`PEANUTGALLERY_HOST` and `LAUNCH_AGENTS_DIR` pointed at a scratch folder, launchctl replaced by a fake that records its calls, two local clones of this branch standing in for the GitHub clones, fixture env values), run twice: the first run installed `node_modules`, copied the env file (`the dispatcher reads all 17 keys of .env as written`), locked the clone, wrote the four agents, loaded the three jobs, disabled the dispatcher and ended `install: done: 16 change(s)`; the second ended `install: done: 0 change(s)`. The rendered dispatcher agent read back through `plutil -p` with `ExitTimeOut` 90, `KeepAlive` `SuccessfulExit` false, `RunAtLoad` true and `ThrottleInterval` 30.
- `run-dispatcher.sh` from that scratch host's read-only clone with the real node and dispatcher (a fake sleep and curl): the dispatcher loaded from the locked clone and stopped at its first database read on the fixture URL, `"db claim_dispatcher_lease: TypeError: fetch failed","exitCode":1,"restart":true`, and the wrapper logged `the dispatcher exited 1 after 6s; failure 1 in a row; starting again in 30s` and exited 1.
- `pnpm verify` on this branch: every step passes (`platform/supabase` 254, `seed-1` 77, `platform/site` 231, `platform/dispatcher` 608, `platform/gate` 427, `test:agents` 117, `test:ops` 116 with `mac.test.mjs`, `test:functions` 82, both `GATE PASS`, `PASS: secret-scan files=458`) except one docs test, "docs/PLAN.md numbers its decisions from 1 with no gaps": this branch adds decision 38, and decision 37 lands in a separate pull request. It passes once that merges and this branch is rebased on it.
- The criteria a test can prove: `platform/ops/test/mac.test.mjs` ("run-dispatcher.sh", "run-job.sh", "the LaunchAgent templates", "backup-mac.sh", "install.sh and deploy.sh on the Mac", "make-jobs-env.sh for the Mac host"), with `ops.test.mjs` ("shell scripts" listing the Mac scripts; "the jobs on the VPS" comparing provision's jobs with `VPS_JOBS`) and `docs/docs.test.mjs` (the backlog entries and their PLAN links).

## Decisions

- 2026-09-23 (board): the Mac hosts the dispatcher until the studio has a server; Oracle is dropped; Google Cloud is the planned later host (PLAN.md §10 decision 38).
- 2026-09-23: one user, with the code clone read-only by mode bits, rather than a second macOS user for the dispatcher. A second user needs an admin account change, a LaunchDaemon run as root and a separate login keychain on the board's own laptop, for a gap that only matters if code the dispatcher runs can be changed by what it processes; since Managed Agents no agent-written code runs on the host, and patches are checked and applied into worktrees outside the code clone. The spec and runbook name this as weaker than a server.
- 2026-09-23: a LaunchAgent, not a LaunchDaemon. A LaunchDaemon runs as root and would need the root-owned layout of a server; with FileVault on, neither runs before the board logs in after a restart, so a daemon buys nothing here.
- 2026-09-23: the jobs wake hourly and decide by UTC day in `run-job.sh`, rather than a `StartCalendarInterval` converted to local time, which would move by an hour twice a year and with travel.
- 2026-09-23: the wrapper does the restart delay and the start limit itself and exits 0 to stop launchd, because launchd has no RestartSteps, StartLimitBurst or RestartPreventExitStatus; `ThrottleInterval` 30 is the floor under it.
- 2026-09-23: the restore check is a drill by hand on the Mac. A scratch Postgres needs Supabase's roles and schemas, which the server got from Supabase's image in Docker; Homebrew's plain Postgres would fail on them, and a second Supabase project needs an owner login the jobs refuse to hold. `identity.json` in each backup gives the drill the figure to match.
- 2026-09-23: the dump set is pg_dump's own with the Supabase CLI's role filter, not the CLI's, since the CLI's `db dump` runs pg_dump in Docker. The first drill proves it restores; any fix it needs is recorded here.
- 2026-09-23: the code clone's `.env` is a copy of `env/dispatcher.env`, made by `install.sh` while the clone is writable, because the dispatcher reads `.env` from its code root only and the clone is read-only the rest of the time.
- 2026-09-23: the Mac backup's env file is its own job, `backup-mac`, in `jobs/lib.mjs`, so `check-env.mjs` and `make-jobs-env.sh` hold it to its own keys; `make-jobs-env.sh` writes it only when asked, so a server's run is unchanged.
