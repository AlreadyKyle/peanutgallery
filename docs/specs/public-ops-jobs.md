# The daily jobs in the public repository

Status: agreed. Card: none. Owner: board.

## Problem

The nightly backup, the Controller, the quota check and the ship notices ran on GitHub Actions in the board's private repository AlreadyKyle/mobmachine-ops (`actions-host.md`). On 18 October 2026 the account's 2,000 free private minutes ran out with an Actions budget of $0, and every run since is refused before it starts ("recent account payments have failed or your spending limit needs to be increased"). The board adds no money to GitHub. Until the minutes reset there is no off-site backup, no Stripe reconciliation on /ledger and no supporter email. Standard runners are free in a public repository, and this one is public.

## Scope

In: `.github/workflows/ops-jobs.yml`; `platform/ops/actions/run-ops-job.sh`; their tests in `platform/ops/test/ops.test.mjs` ("the daily jobs on GitHub Actions") and the gate's workflow audit; `platform/ops/ops-repo/README.md` rewritten as the jobs' runbook and its `jobs.yml` template removed; PLAN.md §10 decision 78 and the lines that place the daily jobs; the quota check's fix lines; the ROADMAP row and standing fact.
Out: the promotion and itch.io workflows, which stay in the private repository on its minutes; the weekly restore check (backlog); any change to what a job does.

## Behaviour

The four jobs run at their old times (backup 06:17, the Controller 07:07, the quota check 07:37, the notices 09:07 UTC) and on `workflow_dispatch`, on main only, in the GitHub environment `ops`, whose deployment branch policy allows main alone. The step that runs a job reads that job's secret alone. The job's output goes to a 0600 file that is encrypted with age to `vars.BACKUP_AGE_RECIPIENT` and kept for 14 days; the public log shows the job, its exit and PASS, FAIL or done. The backup's `.tar.age` is kept for 90 days. A failure posts to ntfy. The job code is the run's own commit of main.

## Acceptance criteria

- [x] The workflow runs the four jobs at their times and on dispatch, on main in this repository only, in the environment `ops`, with contents: read and no job-level permissions.
- [x] Every action is pinned to a commit sha and the checkout of the run sha keeps no credential.
- [x] Only the run step reads a job env, each job its own; only the alert step reads `NTFY_TOPIC_URL`; no step puts an expression in its script.
- [x] The job's output reaches the public log only as the script's fixed lines; the full log is encrypted before upload and deleted when no recipient is set; every env value of eight characters or more is masked.
- [x] The gate's workflow audit allows `ops-jobs.yml` its five secrets and the environment `ops`, and nothing else.
- [ ] The board has created the environment `ops` (main only) and set its five secrets.
- [ ] A backup run on main ends `ops-job: backup exited 0 (done)` and keeps `backup-<run id>`.
- [ ] The private repository's `jobs.yml` is removed, so the jobs never run twice.

## Verification

- `pnpm verify`
- After the merge and the board's step: the first `backup` run's public line `ops-job: backup exited 0 (done)` and its artifact; the first `controller` run's `ops-job: controller exited 0 (PASS)` or `(FAIL)`, and its `controller_runs` row read back; the first `quota` and `notices` lines.

## Evidence

- `node --test platform/ops/test/ops.test.mjs`, "the daily jobs on GitHub Actions" and "shell scripts" (shellcheck over `actions/run-ops-job.sh`); `bash platform/gate/test/run-tests.sh`, "workflow audit: ops-jobs.yml ...".

## Decisions

- 2026-10-19 (board): the daily jobs move to this public repository (PLAN.md §10 decision 78), reversing the 6 October 2026 ruling that no job secret sits here. Twelve days without an off-site backup is the bigger risk, and the secrets sit where `DISPATCHER_ENV` already does, under the same main-only environment.
- 2026-10-19: one step reads the job's env through an expression that picks that job's secret and ends in an empty string, so no job can fall through to another's secret.
- 2026-10-19: no host switch variable, unlike the dispatcher's `DISPATCHER_HOST`: a run before the board's step finds no secret and stops with a fixed line, and the board's step creates the environment with its branch policy before any secret goes in.
- 2026-10-19: the job code is the run's commit of main rather than a pinned `STUDIO_REF`; the kernel paths already keep card code out of `.github` and `platform/ops`, as for the dispatcher.
