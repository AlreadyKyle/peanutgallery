# The ops repository: the daily jobs on GitHub Actions

The nightly backup, the Controller and the quota check run in a private repository of the board's, `AlreadyKyle/mobmachine-ops`, as `.github/workflows/jobs.yml`, of which `jobs.yml` here is the template (`docs/specs/actions-host.md`, `docs/PLAN.md` §10 decision 61). They moved there off the board's Mac on 6 October 2026, and the Mac's LaunchAgents were removed with `platform/ops/mac/uninstall.sh`.

They run in a private repository, never in this one: this repository is public, its Actions logs are public, and its gate runs card code. No job secret sits where card code or a public log reaches it. This replaces the earlier `backups-repo` template, a weekly fallback backup that uploaded to an Oracle bucket and was never set up.

## What runs

| Job | Schedule (UTC) | Does |
|---|---|---|
| `backup` | 06:17 daily | `platform/ops/mac/backup-mac.sh` with `BACKUP_PG_BIN=/usr/lib/postgresql/17/bin` (`postgresql-client-17` from the PostgreSQL apt repository) and `BACKUP_DIR=$RUNNER_TEMP/backups`, up to 3 attempts a minute apart, then the `.tar.age` uploaded as an artifact kept 90 days |
| `controller` | 07:07 daily | `jobs/check-env.mjs controller`, then `node --env-file jobs/main.mjs controller` |
| `quota` | 07:37 daily | `jobs/check-env.mjs quota`, then `node --env-file jobs/main.mjs quota` |

`workflow_dispatch` with the input `job` runs any one of them at once. A failure posts "Mob Machine job <job> failed on GitHub Actions: <run URL>" to ntfy.

The job code is this repository's `platform/ops` (and `platform/supabase/functions/_shared`, which the Controller imports) at the commit in the variable `STUDIO_REF`, a full sha, checked out sparsely with no credential kept. A commit on main reaches the jobs' secrets only once someone sets `STUDIO_REF` to it, so **moving `STUDIO_REF` to the deployed sha is part of every deploy** that changes `platform/ops`: review the diff of `platform/ops` since the old sha first.

## Set it up (once)

1. Create a private repository in the board's account (`AlreadyKyle/mobmachine-ops`) and commit `jobs.yml` as `.github/workflows/jobs.yml`.
2. Secrets, in Settings, Secrets and variables, Actions: `BACKUP_ENV`, `CONTROLLER_ENV` and `QUOTA_ENV`, each the text of that job's env file as `make-jobs-env.sh` writes it (`backup-mac controller quota`; the workflow replaces `BACKUP_DIR`), with `gh secret set BACKUP_ENV --repo AlreadyKyle/mobmachine-ops < <file>`; and `NTFY_TOPIC_URL`.
3. Variable `STUDIO_REF`: the full sha of main to run.
4. Run each job once (`gh workflow run jobs.yml --repo AlreadyKyle/mobmachine-ops -f job=backup`, then `controller`, then `quota`) and read its log: the backup ends `backup: done: peanutgallery-<time>.tar.age`.

## Restore

Download the artifact (`gh run download <run id> --repo AlreadyKyle/mobmachine-ops`), then follow `platform/ops/README.md`, Restore a Mac backup, from step 2. The weekly restore check is not on Actions yet (`docs/BACKLOG.md`, Weekly restore check on Actions).

## What it costs

A private repository's Actions minutes come from the account's free 2,000 a month; the three jobs use a few minutes a day. The dispatcher's own runs are in the public studio repository, where minutes are free.
