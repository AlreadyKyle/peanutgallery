#!/bin/bash
# backup-mac.sh: the nightly backup of the money database on the board's Mac (docs/specs/mac-host.md),
# run by run-job.sh backup from the code clone. The server's backup.sh needs Docker, the Supabase CLI
# and an object store, and the Mac has none of them, so this does the same with Homebrew's libpq:
#
# 1. pg_dump and pg_dumpall from BACKUP_PG_BIN (default /opt/homebrew/opt/libpq/bin) through the
#    Session pooler as the read-only peanutgallery_backup login, and only that login: the same
#    refusals as backup.sh, so no database owner's connection string and no Stripe secret key, under
#    any name. The password reaches libpq in a service file inside the run's private folder, never on
#    a command line. pg_dump must be at least the server's major version; a newer one is fine.
# 2. The dump set, as close to backup.sh's as pg_dump allows: roles.sql (pg_dumpall --roles-only
#    --no-role-passwords, with Supabase's own roles commented out as the Supabase CLI does), schema.sql
#    and data.sql (the public schema), auth.sql (the auth schema's data, left out with
#    BACKUP_SKIP_AUTH=1), history_schema.sql and history_data.sql (supabase_migrations), and
#    identity.json, the live ledger identity at dump time for the restore drill to compare against.
#    If the login may not run pg_dumpall, the run fails and says so.
# 3. tar the folder and encrypt it with age to BACKUP_AGE_RECIPIENT, the board's public key; the
#    private key stays offline. The plaintext is deleted before the file leaves the run folder, and on
#    every exit.
# 4. Write peanutgallery-<UTC time>.tar.age into BACKUP_DIR, a folder the board chooses, meant to be
#    inside a Google Drive for desktop folder so the file leaves the Mac. It is written under a hidden
#    name and renamed, so a sync never picks up half a file. Backups older than BACKUP_KEEP_DAYS
#    (default 30) are deleted, always keeping the newest 7. This Mac can read and delete its own
#    backups there, which the server's write-only store did not allow.
# 5. Ping BACKUP_HEALTHCHECK_URL on success and its /fail on failure; run-job.sh posts to ntfy.
#
# There is no weekly restore check here: it needs a scratch Supabase Postgres, which the server ran
# in Docker. The restore drill is a step the board runs by hand (platform/ops/README.md, The Mac host).
#
# Secrets come from BACKUP_ENV_FILE (default ~/peanutgallery-host/env/backup-mac.env: the owner's,
# 0600, KEY=value lines), read line by line and never sourced. URLs with secrets reach curl through a
# config file.
set -euo pipefail

ENV_FILE=${BACKUP_ENV_FILE:-$HOME/peanutgallery-host/env/backup-mac.env}
STATE_DIR=${BACKUP_STATE_DIR:-$HOME/peanutgallery-host/state/backup}
PG_BIN=${BACKUP_PG_BIN:-/opt/homebrew/opt/libpq/bin}
REQUIRED_KEYS="BACKUP_DB_URL BACKUP_AGE_RECIPIENT BACKUP_DIR BACKUP_HEALTHCHECK_URL"
KEEP_NEWEST=7
DEFAULT_KEEP_DAYS=30
# Supabase's own roles, which a new project already has; their CREATE and ALTER lines are commented
# out of roles.sql, as the Supabase CLI's role dump does. pg_dumpall leaves the pg_ roles out itself.
RESERVED_ROLES="postgres|supabase_admin|supabase_auth_admin|supabase_storage_admin|supabase_read_only_user|supabase_realtime_admin|supabase_replication_admin|supabase_functions_admin|supabase_etl_admin|supabase_privileged_role|dashboard_user|pgbouncer|pgsodium_keyholder|pgsodium_keyiduser|pgsodium_keymaker|authenticator|authenticated|anon|service_role"
USAGE="usage: backup-mac.sh"
WORK=""
PARTIAL=""

say() { printf 'backup: %s\n' "$*"; }
die() {
  printf 'backup: stopped: %s\n' "$*" >&2
  exit 1
}

# env_value <key>: the value of KEY in the env file, or nothing.
env_value() {
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1
}

# file_mode <file>: the permission bits in octal, on macOS and on Linux.
file_mode() {
  if [ "$(uname -s)" = Darwin ]; then stat -f '%Lp' "$1"; else stat -c '%a' "$1"; fi
}

# check_env: prints one line per problem, naming keys only, and returns 1 when there is any. The same
# rules as backup.sh and platform/ops/jobs/lib.mjs (job backup-mac).
check_env() {
  local problems=0 key line dir days
  if [ ! -O "$ENV_FILE" ] || [ "$(file_mode "$ENV_FILE")" != 600 ]; then
    echo "$ENV_FILE must be yours with mode 0600"
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
  line=$(env_value BACKUP_DB_URL)
  if [ -n "$line" ] && ! [[ "$line" =~ ^postgres(ql)?://peanutgallery_backup\.[a-z0-9]+:[^@/]+@[a-z0-9.-]+\.pooler\.supabase\.com:5432/postgres(\?.*)?$ ]]; then
    echo "BACKUP_DB_URL must be the Session pooler (port 5432) as peanutgallery_backup.<project ref>"
    problems=1
  fi
  line=$(env_value BACKUP_AGE_RECIPIENT)
  if [ -n "$line" ] && ! [[ "$line" =~ ^age1[0-9a-z]{58}$ ]]; then
    echo "BACKUP_AGE_RECIPIENT must be one age public key (age1...)"
    problems=1
  fi
  dir=$(env_value BACKUP_DIR)
  if [ -n "$dir" ]; then
    case "$dir" in
      /*) if [ ! -d "$dir" ] || [ ! -w "$dir" ]; then
        echo "BACKUP_DIR is not a folder this user can write to"
        problems=1
      fi ;;
      *)
        echo "BACKUP_DIR must be an absolute path to a folder"
        problems=1
        ;;
    esac
  fi
  days=$(env_value BACKUP_KEEP_DAYS)
  if [ -n "$days" ] && ! [[ "$days" =~ ^[1-9][0-9]*$ ]]; then
    echo "BACKUP_KEEP_DAYS must be a whole number above zero"
    problems=1
  fi
  line=$(env_value BACKUP_HEALTHCHECK_URL)
  case "$line" in '' | https://*) ;; *)
    echo "BACKUP_HEALTHCHECK_URL must be an https URL"
    problems=1
    ;;
  esac
  return "$problems"
}

# curl_to <url> <curl option lines...>: curl with the URL in a config file, so no secret is on a
# command line.
curl_to() {
  local url=$1 config option
  shift
  config=$(mktemp "$WORK/curl.XXXXXX")
  {
    printf 'url = "%s"\n' "$url"
    for option in "$@"; do printf '%s\n' "$option"; done
  } > "$config"
  curl -fsS --retry 3 --max-time 120 -K "$config"
  rm -f "$config"
}

# write_service <file>: the backup login's connection as a libpq service named peanutgallery_backup,
# taken apart from BACKUP_DB_URL (whose shape check_env fixed). A percent-encoded password is decoded.
write_service() {
  local url rest userinfo hostpart user password hostport host port db
  url=$(env_value BACKUP_DB_URL)
  rest=${url#*://}
  userinfo=${rest%%@*}
  hostpart=${rest#*@}
  user=${userinfo%%:*}
  password=${userinfo#*:}
  password=$(printf '%b' "${password//%/\\x}")
  hostport=${hostpart%%/*}
  host=${hostport%%:*}
  port=${hostport##*:}
  db=${hostpart#*/}
  db=${db%%\?*}
  (
    umask 077
    printf '[peanutgallery_backup]\nhost=%s\nport=%s\ndbname=%s\nuser=%s\npassword=%s\nsslmode=require\nconnect_timeout=20\n' \
      "$host" "$port" "$db" "$user" "$password" > "$1"
  )
}

# major_of <version text>: the first number of the first dotted version in the text.
major_of() {
  printf '%s\n' "$1" | sed -nE 's/^[^0-9]*([0-9]+)(\.[0-9]+)+.*$/\1/p' | head -n 1
}

# check_versions: pg_dump must be at least the server's major version.
check_versions() {
  local server client
  server=$("$PG_BIN/psql" -X -At --no-password -c 'show server_version_num') || die "could not reach the database as the backup login"
  case "$server" in '' | *[!0-9]*) die "the server's version is unreadable" ;; esac
  client=$(major_of "$("$PG_BIN/pg_dump" --version)")
  [ -n "$client" ] || die "pg_dump's version is unreadable"
  if [ "$client" -lt $((server / 10000)) ]; then
    die "pg_dump $client is older than the server's Postgres $((server / 10000)); upgrade libpq (brew upgrade libpq)"
  fi
  say "pg_dump $client, server Postgres $((server / 10000))"
}

# dump_all <folder>: the dumps, all as the backup login.
dump_all() {
  local dir=$1 files="roles schema data auth history_schema history_data identity" file
  mkdir -m 0700 "$dir"
  "$PG_BIN/pg_dumpall" --no-password --roles-only --no-role-passwords --quote-all-identifiers --no-comments \
    | sed -E -e "s/^(CREATE|ALTER) ROLE \"($RESERVED_ROLES)\"/-- &/" -e 's/ (NOSUPERUSER|NOREPLICATION)//g' > "$dir/roles.sql" \
    || die "pg_dumpall --roles-only was refused to the backup login; see the error above (platform/ops/README.md, The Mac host)"
  "$PG_BIN/pg_dump" --no-password --schema-only --quote-all-identifiers --schema=public \
    | sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' > "$dir/schema.sql"
  "$PG_BIN/pg_dump" --no-password --data-only --quote-all-identifiers --schema=public --file="$dir/data.sql"
  if [ "$(env_value BACKUP_SKIP_AUTH)" = 1 ]; then
    files="roles schema data history_schema history_data identity"
    say "the auth schema is not dumped (BACKUP_SKIP_AUTH=1): a restore signs the board in afresh"
  else
    "$PG_BIN/pg_dump" --no-password --data-only --quote-all-identifiers --schema=auth --file="$dir/auth.sql"
  fi
  "$PG_BIN/pg_dump" --no-password --schema-only --quote-all-identifiers --schema=supabase_migrations \
    | sed -E 's/^CREATE SCHEMA "/CREATE SCHEMA IF NOT EXISTS "/' > "$dir/history_schema.sql"
  "$PG_BIN/pg_dump" --no-password --data-only --quote-all-identifiers --schema=supabase_migrations --file="$dir/history_data.sql"
  "$PG_BIN/psql" -X -At --no-password -c 'select public.ledger_identity()' > "$dir/identity.json"
  for file in $files; do
    if [ "$file" = identity ]; then
      [ -s "$dir/identity.json" ] || die "the ledger identity read came back empty"
    else
      [ -s "$dir/$file.sql" ] || die "the $file dump is empty"
    fi
  done
}

# utc_stamp <epoch seconds>: the backup name's time format, with BSD or GNU date.
utc_stamp() {
  date -u -r "$1" +%Y%m%dT%H%M%SZ 2> /dev/null || date -u -d "@$1" +%Y%m%dT%H%M%SZ
}

# prune <folder> <days>: deletes backups older than the days, by the time in their name, always keeping
# the newest KEEP_NEWEST. Only names this script writes are touched.
prune() {
  local dir=$1 days=$2 cutoff names total index=0 name stamp
  cutoff=$(utc_stamp $(($(date +%s) - days * 86400)))
  names=$(find "$dir" -maxdepth 1 -type f -name 'peanutgallery-*.tar.age' -exec basename {} ';' | grep -E '^peanutgallery-[0-9]{8}T[0-9]{6}Z\.tar\.age$' | sort || true)
  [ -n "$names" ] || return 0
  total=$(printf '%s\n' "$names" | wc -l | tr -d ' ')
  while IFS= read -r name; do
    index=$((index + 1))
    [ "$index" -le $((total - KEEP_NEWEST)) ] || break
    stamp=${name#peanutgallery-}
    stamp=${stamp%.tar.age}
    if [[ "$stamp" < "$cutoff" ]]; then
      rm -f "${dir:?}/$name"
      say "deleted $name, older than $days days"
    fi
  done <<< "$names"
}

# finish <status>: deletes the run folder, plaintext included, whatever happened, and pings the
# healthcheck's /fail when the run failed.
finish() {
  local status=$1
  if [ -n "$WORK" ]; then rm -rf "$WORK"; fi
  if [ -n "$PARTIAL" ]; then rm -f "$PARTIAL"; fi
  WORK=""
  if [ "$status" -ne 0 ] && [ -f "$ENV_FILE" ] && [ -n "$(env_value BACKUP_HEALTHCHECK_URL)" ]; then
    WORK=$(mktemp -d)
    curl_to "$(env_value BACKUP_HEALTHCHECK_URL)/fail" 'request = "POST"' 'silent' 'output = "/dev/null"' || true
    rm -rf "$WORK"
  fi
}

main() {
  local problems stamp name recipient dir days tool holds
  [ "$#" -eq 0 ] || die "$USAGE"
  [ -f "$ENV_FILE" ] || die "$ENV_FILE is missing (platform/ops/README.md, The Mac host)"
  if ! problems=$(check_env); then
    die "$ENV_FILE:
$problems"
  fi
  for tool in psql pg_dump pg_dumpall; do
    [ -x "$PG_BIN/$tool" ] || die "$PG_BIN/$tool is missing; install libpq with Homebrew (platform/ops/README.md, The Mac host)"
  done
  for tool in age curl tar; do
    command -v "$tool" > /dev/null 2>&1 || die "$tool is not on PATH (platform/ops/README.md, The Mac host)"
  done
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  WORK=$(mktemp -d "$STATE_DIR/run.XXXXXX")
  trap 'finish $?' EXIT

  write_service "$WORK/pg_service.conf"
  export PGSERVICEFILE="$WORK/pg_service.conf" PGSERVICE=peanutgallery_backup
  unset PGPASSWORD PGHOST PGPORT PGUSER PGDATABASE
  check_versions

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  name=peanutgallery-$stamp
  dump_all "$WORK/$name"
  rm -f "$WORK/pg_service.conf"
  # jsonb puts the top-level "holds" first, then "lines"; each line's own "holds" is followed by "right".
  holds=$(sed -nE 's/.*"holds": (true|false), "lines".*/\1/p' "$WORK/$name/identity.json" | head -n 1)
  say "dumped the database as the backup login; the live ledger identity holds: ${holds:-unread}"
  recipient=$(env_value BACKUP_AGE_RECIPIENT)
  tar -C "$WORK" -cf "$WORK/$name.tar" "$name"
  age -r "$recipient" -o "$WORK/$name.tar.age" "$WORK/$name.tar"
  rm -rf "${WORK:?}/$name" "$WORK/$name.tar"
  say "encrypted to the board's key; the plaintext is deleted"

  dir=$(env_value BACKUP_DIR)
  PARTIAL=$dir/.$name.tar.age.partial
  cp "$WORK/$name.tar.age" "$PARTIAL"
  chmod 600 "$PARTIAL"
  mv "$PARTIAL" "$dir/$name.tar.age"
  PARTIAL=""
  say "wrote $name.tar.age to the backup folder"
  days=$(env_value BACKUP_KEEP_DAYS)
  prune "$dir" "${days:-$DEFAULT_KEEP_DAYS}"
  curl_to "$(env_value BACKUP_HEALTHCHECK_URL)" 'request = "POST"' 'output = "/dev/null"'
  say "done: $name.tar.age"
}

# BACKUP_SOURCE_ONLY=1 loads the functions without running anything (the ops tests use it).
if [ "${BACKUP_SOURCE_ONLY:-}" != 1 ]; then
  main "$@"
fi
