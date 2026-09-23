#!/usr/bin/env bash
# backup.sh: the nightly backup of the money database (docs/specs/money-safety.md). Run as root on the
# VPS by peanutgallery-backup.service; provision.sh and deploy.sh install it from the commit at
# /usr/local/lib/peanutgallery/backup.sh.
#
# 1. `supabase db dump` through the Session pooler as the read-only peanutgallery_backup login, and
#    only that login: the roles, the schema, the data (--use-copy), the auth schema's data and the
#    migration history, the set Supabase documents for a project with no platform backups. The
#    database owner's password never comes to this host. BACKUP_SKIP_AUTH=1, set only when the
#    login was refused the auth schema, leaves the auth dump out; a restore then signs the board in
#    afresh (platform/ops/README.md, Restore the database).
# 2. Once a week (RESTORE_CHECK_WEEKDAY, 1 Monday to 7 Sunday, default 7, in UTC), or with
#    --restore-check, before encrypting: restore that plaintext into a scratch Postgres container
#    with no network (the Supabase Postgres image the dump itself pulled) and run the SQL ledger
#    identity on it. A copy that does not restore, or whose identity does not hold, fails the run.
# 3. tar the dumps and encrypt them with age to BACKUP_AGE_RECIPIENT, the board's public key; the
#    private key stays offline, so this host cannot read its own backups. The plaintext is deleted
#    before anything leaves the host, and on every exit.
# 4. Upload to Object Storage through BACKUP_PAR_URL, a write-only pre-authenticated request (Oracle's
#    shape; Oracle is dropped, so a server's store waits on the Google Cloud move, docs/specs/mac-host.md),
#    for BACKUP_BUCKET: this host can add objects and can neither read, list nor delete them. A write
#    to a name that exists replaces it, so the bucket keeps object versions (the runbook's step 1):
#    a replaced backup stays as a previous version.
# 5. Ping BACKUP_HEALTHCHECK_URL on success and its /fail on failure; the unit's OnFailure posts to
#    ntfy. The dump's query also counts as activity, which keeps a free Supabase project from pausing.
#
# Secrets come from /etc/peanutgallery/backup.env (root 0600, KEY=value lines), read line by line and
# never sourced. URLs with secrets reach curl through a config file, never its command line.
set -euo pipefail

ENV_FILE=${BACKUP_ENV_FILE:-/etc/peanutgallery/backup.env}
STATE_DIR=${BACKUP_STATE_DIR:-/var/lib/peanutgallery-backup}
SCRATCH_NAME=peanutgallery-restore-check
RESTORE_IMAGE_REPO=public.ecr.aws/supabase/postgres
REQUIRED_KEYS="BACKUP_DB_URL BACKUP_AGE_RECIPIENT BACKUP_PAR_URL BACKUP_BUCKET BACKUP_HEALTHCHECK_URL"
USAGE="usage: backup.sh [--restore-check]"
WORK=""

say() { printf 'backup: %s\n' "$*"; }
die() {
  printf 'backup: stopped: %s\n' "$*" >&2
  exit 1
}

# env_value <key>: the value of KEY in the env file, or nothing.
env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

# check_env: prints one line per problem, naming keys only, and returns 1 when there is any. The same
# rules as platform/ops/jobs/lib.mjs, which provision.sh also runs on this file.
check_env() {
  local problems=0 key line
  if [ "$(stat -c '%U:%G %a' "$ENV_FILE")" != "root:root 600" ]; then
    echo "$ENV_FILE must be owned by root:root with mode 0600"
    problems=1
  fi
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    key=${line%%=*}
    case "${line#*=}" in sk_live_* | sk_test_*)
      echo "$key holds a Stripe secret key; no job may hold one, under any name"
      problems=1
      ;;
    esac
  done < "$ENV_FILE"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in '' | '#'*) continue ;; esac
    key=${line%%=*}
    case "${line#*=}" in postgres://postgres[.:@]* | postgresql://postgres[.:@]*)
      echo "$key signs in as the database owner; no job may hold the owner's password, under any name"
      problems=1
      ;;
    esac
  done < "$ENV_FILE"
  for key in $REQUIRED_KEYS; do
    if [ -z "$(env_value "$key")" ]; then
      echo "$key is missing or empty"
      problems=1
    fi
  done
  case "$(env_value BACKUP_SKIP_AUTH)" in '' | 1) ;; *)
    echo "BACKUP_SKIP_AUTH must be 1 or absent"
    problems=1
    ;;
  esac
  case "$(env_value BACKUP_DB_URL)" in '' | postgresql://peanutgallery_backup.* | postgres://peanutgallery_backup.*) ;; *)
    echo "BACKUP_DB_URL must sign in as peanutgallery_backup.<project ref>"
    problems=1
    ;;
  esac
  case "$(env_value BACKUP_AGE_RECIPIENT)" in '' | age1*) ;; *)
    echo "BACKUP_AGE_RECIPIENT must be an age public key (age1...)"
    problems=1
    ;;
  esac
  case "$(env_value BACKUP_PAR_URL)" in '' | "https://objectstorage."*"/b/$(env_value BACKUP_BUCKET)/o/") ;; *)
    echo "BACKUP_PAR_URL must be a pre-authenticated request for BACKUP_BUCKET, ending in /o/"
    problems=1
    ;;
  esac
  return "$problems"
}

# restore_due <weekday override flag>: whether this run restores the plaintext and checks it.
restore_due() {
  local wanted
  [ "$1" = 1 ] && return 0
  wanted=$(env_value RESTORE_CHECK_WEEKDAY)
  [ "$(date -u +%u)" = "${wanted:-7}" ]
}

# curl_to <url> <curl option lines...>: curl with the URL in a config file, so no secret is on a
# command line.
curl_to() {
  local url=$1 config
  shift
  config=$(mktemp "$WORK/curl.XXXXXX")
  {
    printf 'url = "%s"\n' "$url"
    for option in "$@"; do printf '%s\n' "$option"; done
  } > "$config"
  curl -fsS --retry 3 --max-time 900 -K "$config"
  rm -f "$config"
}

# dump_all <folder>: the six dumps, or five with BACKUP_SKIP_AUTH=1, all as the backup login.
dump_all() {
  local dir=$1 db files="roles schema data auth history_schema history_data"
  db=$(env_value BACKUP_DB_URL)
  install -d -m 0700 "$dir"
  supabase db dump --db-url "$db" -f "$dir/roles.sql" --role-only
  supabase db dump --db-url "$db" -f "$dir/schema.sql"
  supabase db dump --db-url "$db" -f "$dir/data.sql" --use-copy --data-only -x storage.buckets_vectors -x storage.vector_indexes
  if [ "$(env_value BACKUP_SKIP_AUTH)" = 1 ]; then
    files="roles schema data history_schema history_data"
    say "the auth schema is not dumped (BACKUP_SKIP_AUTH=1): a restore signs the board in afresh"
  else
    supabase db dump --db-url "$db" -f "$dir/auth.sql" --schema auth --use-copy --data-only
  fi
  supabase db dump --db-url "$db" -f "$dir/history_schema.sql" --schema supabase_migrations
  supabase db dump --db-url "$db" -f "$dir/history_data.sql" --use-copy --data-only --schema supabase_migrations
  for file in $files; do
    [ -s "$dir/$file.sql" ] || die "the $file dump is empty"
  done
}

# restore_image: the Supabase Postgres image the dumps pulled, newest tag first.
restore_image() {
  docker image ls --format '{{.Repository}}:{{.Tag}}' "$RESTORE_IMAGE_REPO" | grep -v ':<none>$' | sort -V | tail -n 1
}

# restore_check <folder>: restores the plaintext into a scratch container with no network and prints
# the ledger identity. Returns 1 when the restore or the identity fails.
restore_check() {
  local dir=$1 image password result holds identity tries=0
  image=$(restore_image)
  [ -n "$image" ] || die "no $RESTORE_IMAGE_REPO image on this host to restore into"
  password=$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')
  docker rm -f "$SCRATCH_NAME" > /dev/null 2>&1 || true
  POSTGRES_PASSWORD=$password docker run -d --name "$SCRATCH_NAME" --network none -e POSTGRES_PASSWORD \
    --volume "$dir:/restore:ro" "$image" > /dev/null
  until docker exec "$SCRATCH_NAME" pg_isready -h localhost -U postgres > /dev/null 2>&1; do
    tries=$((tries + 1))
    [ "$tries" -lt 90 ] || die "the scratch Postgres did not start"
    sleep 2
  done
  if ! PGPASSWORD=$password docker exec -e PGPASSWORD "$SCRATCH_NAME" psql -h localhost -U supabase_admin -d postgres -q \
    --single-transaction -v ON_ERROR_STOP=1 -f /restore/roles.sql -f /restore/schema.sql \
    -c 'SET session_replication_role = replica' -f /restore/data.sql > /dev/null; then
    echo "the dump did not restore into $image"
    return 1
  fi
  # The top-level "holds" alone decides: each line of the identity carries its own "holds" too, so a
  # match anywhere in the JSON would pass a copy where I1 holds and I2 does not.
  result=$(PGPASSWORD=$password docker exec -e PGPASSWORD "$SCRATCH_NAME" psql -h localhost -U supabase_admin -d postgres -At -F '|' \
    -c "select i->>'holds', i::text from (select public.ledger_identity() as i) s")
  docker rm -f "$SCRATCH_NAME" > /dev/null 2>&1 || true
  holds=${result%%|*}
  identity=${result#*|}
  if [ "$holds" = true ]; then
    echo "PASS: restore check: the restored copy's ledger identity holds: $identity"
  else
    echo "FAIL: restore check: the restored copy's ledger identity does not hold: $identity"
    return 1
  fi
}

# finish <status>: deletes the plaintext and the scratch container whatever happened, and pings the
# healthcheck's /fail when the run failed.
finish() {
  local status=$1
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
  docker rm -f "$SCRATCH_NAME" > /dev/null 2>&1 || true
  if [ "$status" -ne 0 ] && [ -f "$ENV_FILE" ] && [ -n "$(env_value BACKUP_HEALTHCHECK_URL)" ]; then
    WORK=$(mktemp -d)
    curl_to "$(env_value BACKUP_HEALTHCHECK_URL)/fail" 'request = "POST"' 'silent' 'output = "/dev/null"' || true
    rm -rf "$WORK"
  fi
}

main() {
  local force=0 problems stamp name recipient
  case "${1:-}" in
    --restore-check) force=1 ;;
    '') ;;
    *) die "$USAGE" ;;
  esac
  [ "$#" -le 1 ] || die "$USAGE"
  [ "$(id -u)" -eq 0 ] || die "run as root"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing (platform/ops/README.md, Backups)"
  if ! problems=$(check_env); then
    die "$ENV_FILE:
$problems"
  fi
  for tool in supabase age curl docker tar; do
    command -v "$tool" > /dev/null 2>&1 || die "$tool is not installed; run provision.sh"
  done
  install -d -m 0700 "$STATE_DIR"
  WORK=$(mktemp -d "$STATE_DIR/run.XXXXXX")
  trap 'finish $?' EXIT

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  name=peanutgallery-$stamp
  dump_all "$WORK/$name"
  say "dumped the database as the backup login"
  if restore_due "$force"; then
    restore_check "$WORK/$name" || die "the restore check failed; nothing was uploaded"
  fi
  recipient=$(env_value BACKUP_AGE_RECIPIENT)
  tar -C "$WORK" -cf "$WORK/$name.tar" "$name"
  age -r "$recipient" -o "$WORK/$name.tar.age" "$WORK/$name.tar"
  rm -rf "${WORK:?}/$name" "$WORK/$name.tar"
  say "encrypted to the board's key; the plaintext is deleted"
  curl_to "$(env_value BACKUP_PAR_URL)$name.tar.age" "upload-file = \"$WORK/$name.tar.age\"" 'output = "/dev/null"'
  say "uploaded $name.tar.age to $(env_value BACKUP_BUCKET)"
  curl_to "$(env_value BACKUP_HEALTHCHECK_URL)" 'request = "POST"' 'output = "/dev/null"'
  say "done: $name.tar.age"
}

# BACKUP_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
if [ "${BACKUP_SOURCE_ONLY:-}" != 1 ]; then
  main "$@"
fi
