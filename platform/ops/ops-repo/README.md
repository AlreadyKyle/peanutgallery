# The daily jobs on GitHub Actions, and the ops repository

The nightly backup, the Controller, the quota check, the ship notices and the marketing engine run on GitHub Actions in this public repository, as `.github/workflows/ops-jobs.yml` with `platform/ops/actions/run-ops-job.sh` (`docs/PLAN.md` §10 decision 78). From 6 October 2026 they ran in a private repository of the board's, `AlreadyKyle/mobmachine-ops`, from a template that lived here; that repository stopped when the account's free private Actions minutes ran out on 18 October 2026 with a budget of $0, and a public repository's standard runners are free, so they moved. `AlreadyKyle/mobmachine-ops` keeps the promotion and itch.io workflows (its own README), which use the private minutes.

## What runs

| Job | Schedule (UTC) | Does |
|---|---|---|
| `backup` | 06:17 daily | `platform/ops/mac/backup-mac.sh` with `postgresql-client-17` from the PostgreSQL apt repository and `BACKUP_DIR` in the runner's temporary folder, up to 3 attempts a minute apart, then the `.tar.age` kept as the artifact `backup-<run id>` for 90 days |
| `controller` | 07:07 daily | `jobs/check-env.mjs controller`, then `node --env-file jobs/main.mjs controller` |
| `quota` | 07:37 daily | `jobs/check-env.mjs quota`, then `node --env-file jobs/main.mjs quota` |
| `notices` | 09:07 daily | `jobs/check-env.mjs notices`, then `node --env-file jobs/main.mjs notices`: the ship notices (`docs/specs/ship-notices.md`), then the emails for cards players follow (`docs/specs/card-follows.md`), at most 50 a run in all, payers first |
| `marketing` | minute 23 of every hour | `jobs/check-env.mjs marketing`, then `node --env-file jobs/main.mjs marketing`: the studio's ships, openings and weekly report on Bluesky, Mastodon and Discord, outbound only, at most 3 posts a channel a run (`docs/specs/marketing-engine.md`) |

`workflow_dispatch` with the input `job` runs any one of them at once (`gh workflow run ops-jobs.yml --repo AlreadyKyle/peanutgallery -f job=backup`). A failure posts "Mob Machine job <job> failed on GitHub Actions: <run URL>" to ntfy.

## Secrets and the public log

The job runs in the GitHub environment `ops`, which only main can deploy to, so a card branch, a pull request or a fork never receives a job's env, as for the dispatcher's environment `dispatcher`. Only the step that runs the job reads a secret, and only that job's own; the alert step reads `NTFY_TOPIC_URL`. The job code is the run's own commit of main: `.github` and `platform/ops` are kernel paths, so only a board pull request changes what runs, and a merge reaches the jobs at their next run (the private repository's `STUDIO_REF` pin is retired with it).

Actions logs of a public repository are public, so the job's output goes to a file that is encrypted with age to `vars.BACKUP_AGE_RECIPIENT`, the board's backup key, and kept as the artifact `ops-log-<job>-<run id>-<attempt>` for 14 days; every value of eight characters or more in the job's env is masked as well. The public log shows the job, its exit and the first word of its result: `PASS` or `FAIL` for the Controller, the quota check, the notices and the marketing engine, `done` for the backup. Anyone signed in to GitHub can download the artifacts; only the board's private key, which stays offline, opens them.

## Set it up (the board, once)

From the board's checkout of main on the Mac, with `.env` and `.env.vps` in place:

1. **The environment.** Create `ops` with a deployment branch policy that allows main alone, before any secret goes in:
   ```sh
   gh api -X PUT repos/AlreadyKyle/peanutgallery/environments/ops \
     -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
   gh api -X POST repos/AlreadyKyle/peanutgallery/environments/ops/deployment-branch-policies -f name=main -f type=branch
   gh api repos/AlreadyKyle/peanutgallery/environments/ops/deployment-branch-policies --jq '.branch_policies[].name'
   ```
   The last line must print `main` and nothing else.
2. **The env files.** With `.env.vps` exported (`set -a; . ./.env.vps; set +a`): `JOBS_ENV_DIR=<a new folder only you can open> platform/ops/make-jobs-env.sh backup-mac controller quota notices marketing`. The workflow replaces the backup's `BACKUP_DIR`. `marketing.env` holds each channel whose keys `.env` sets (`.env.example`, The marketing engine).
3. **The secrets.** `gh secret set BACKUP_ENV --env ops --repo AlreadyKyle/peanutgallery < <folder>/backup-mac.env`, and the same for `CONTROLLER_ENV`, `QUOTA_ENV`, `NOTICES_ENV` and `MARKETING_ENV` from `controller.env`, `quota.env`, `notices.env` and `marketing.env`; `NTFY_TOPIC_URL` from `.env.vps`. Then delete the folder.
4. **Run the backup once** (`gh workflow run ops-jobs.yml --repo AlreadyKyle/peanutgallery -f job=backup`) and read its log: it ends `ops-job: backup exited 0 (done)`, and the run keeps the artifact `backup-<run id>`.

`vars.BACKUP_AGE_RECIPIENT` is the dispatcher's, already set.

**The marketing engine's channels.** Before `MARKETING_ENV` gets a Bluesky, Mastodon or Discord key, take that channel's `PROMO_*` keys out of the private repository's `PROMO_ENV`, so the two engines never post the same news. Then check what it would post: `gh workflow run ops-jobs.yml --repo AlreadyKyle/peanutgallery -f job=marketing` posts for real, so first run `node --env-file <folder>/marketing.env platform/ops/jobs/main.mjs marketing --dry-run` on the Mac, which prints every post in full and posts nothing.

## Restore

Download the artifact (`gh run download <run id> --repo AlreadyKyle/peanutgallery -n backup-<run id>`), then follow `platform/ops/README.md`, Restore a Mac backup, from step 2. A job's log: download `ops-log-<job>-<run id>-<attempt>` the same way and `age -d -i <the backup key> ops-job-log.age`. The weekly restore check is not on Actions yet (`docs/BACKLOG.md`, Weekly restore check on Actions).

## What it costs

Nothing: a public repository's standard runners are free, with no monthly cap, and its artifact storage is free.
