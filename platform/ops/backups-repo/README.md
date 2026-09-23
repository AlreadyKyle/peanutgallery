# The backups repository

A weekly fallback for the VPS's nightly database backup (`docs/specs/money-safety.md`). It lives in its own private repository, never in the studio repository: the studio's gate runs card code, so no backup secret may sit where that code runs. `workflows/backup.yml` here is its template.

It dumps the database as the VPS does (`platform/ops/backup/backup.sh`): the roles, the schema, the data, the auth schema's data and the migration history, through the Session pooler as the read-only `peanutgallery_backup` login and no other. It encrypts the dumps to the board's age public key and uploads them to the backup bucket through a write-only pre-authenticated request of its own. It holds no GitHub token (`permissions: {}`), nothing that can read a backup back, and never the database owner's password.

## Set it up (once)

1. On GitHub, create a private repository in the board's account, for example `peanutgallery-backups`, with nothing else in it.
2. Copy `workflows/backup.yml` to `.github/workflows/backup.yml` there and commit it.
3. In that repository's Settings, Secrets and variables, Actions:
   - Secret `BACKUP_DB_URL`: the same Session pooler connection string as the VPS's backup env, signing in as `peanutgallery_backup.<project ref>`.
   - Secret `BACKUP_PAR_URL`: a second write-only pre-authenticated request for the bucket, made for this repository alone (`platform/ops/README.md`, Backups), so either one can be revoked without the other.
   - Variable `BACKUP_AGE_RECIPIENT`: the board's age public key, the `age1...` line. It is public.
   - Variable `BACKUP_SKIP_AUTH`: `1` only if the VPS's backup sets it (the backup login was refused the auth schema); otherwise leave it unset.
   - Variables `SUPABASE_CLI_VERSION` and `SUPABASE_CLI_SHA256`: the version `platform/ops/provision.sh` pins, and the SHA-256 of its `supabase_<version>_linux_amd64.deb` from that release's `supabase_<version>_checksums.txt`.
4. Run the workflow once from the Actions tab (Run workflow), then check that the bucket holds a new `peanutgallery-actions-<time>.tar.age`.

## What it costs

GitHub bills a private repository's Actions minutes to the owner's account, which the studio repository shares. One weekly run of a few minutes is a small part of the 2,000 free minutes a month; the quota check on the VPS reports the account's total.

## Rotate

- **The backup login's password:** set a new one through the Management API (`platform/ops/README.md`, Backups), then update `BACKUP_DB_URL` here and in the VPS's backup env.
- **The pre-authenticated request:** create a new one for this repository, update `BACKUP_PAR_URL`, then delete the old one in the Oracle console.
