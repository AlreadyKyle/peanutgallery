# Shared helpers for the gate scripts. Source this file after setting GATE_DIR; never run it.
# bash 3.2 compatible.

# The repository root: the git top level that holds the gate, else two folders above it.
gate_repo_root() {
  local root
  root=$(git -C "$GATE_DIR" rev-parse --show-toplevel 2>/dev/null) || root=$(cd "$GATE_DIR/../.." && pwd)
  printf '%s\n' "$root"
}

# Absolute form of a path given relative to the caller's working directory.
gate_abs_path() {
  case "$1" in
    /*) printf '%s\n' "$1" ;;
    *)
      if [ -d "$1" ]; then
        (cd "$1" && pwd)
      else
        printf '%s/%s\n' "$(cd "$(dirname "$1")" && pwd)" "$(basename "$1")"
      fi
      ;;
  esac
}

# A path relative to REPO_ROOT when it lies inside the repository, else unchanged.
gate_rel_path() {
  case "$1" in
    "$REPO_ROOT") printf '.\n' ;;
    "$REPO_ROOT"/*) printf '%s\n' "${1#"$REPO_ROOT"/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

# True when grep reads the file as text with at least one line.
gate_is_text() {
  grep -Iq . "$1" 2>/dev/null
}

# How a scanner reads a file: 0 text it scans; 1 nothing to read (empty, or blank lines only);
# 2 unreadable, which fails the scan instead of being skipped. Unreadable is a UTF-16 byte order
# mark at the start (a browser still decodes and shows the file) or a NUL byte anywhere: the line
# scanners read neither. Binary media and lock files are sorted out before this is asked.
gate_text_kind() {
  local head=""
  IFS= read -r -n 2 -d '' head < "$1" 2>/dev/null
  case "$head" in $'\xff\xfe'|$'\xfe\xff') return 2 ;; esac
  gate_is_text "$1" && return 0
  [ -s "$1" ] || return 1
  [ "$(LC_ALL=C tr -d '\000' < "$1" | wc -c)" -eq "$(wc -c < "$1")" ] && return 1
  return 2
}

# True for dependency lock files.
gate_is_lock_file() {
  case "$(basename "$1")" in
    pnpm-lock.yaml|package-lock.json|yarn.lock|deno.lock|*.lock) return 0 ;;
  esac
  return 1
}

# True for binary media and archives. SVG is text and is not in this list.
gate_is_binary_media() {
  case "$(basename "$1")" in
    *.png|*.jpg|*.jpeg|*.gif|*.webp|*.ico|*.woff|*.woff2|*.ttf|*.otf|*.mp3|*.ogg|*.wav|*.zip|*.gz) return 0 ;;
  esac
  return 1
}

# True for files the content scanners (banned phrases, runtime tokens) never read: lock files,
# source maps, minified bundles, SVGs and binary media. The secret scan reads all but lock files
# and binary media.
gate_is_generated() {
  if gate_is_lock_file "$1" || gate_is_binary_media "$1"; then return 0; fi
  case "$(basename "$1")" in
    *.map|*.min.js|*.min.css|*.svg) return 0 ;;
  esac
  return 1
}

# The folders the scans never walk: dependencies, git's own data, and build, test and scratch output,
# every one of them gitignored. dist-e2e and e2e-screenshots are what the site's and the board's e2e
# runs leave behind locally; a CI checkout never has them. A build folder the gate reads is named to
# the scan directly (runtime-token-deny-dist). gate_tracked_output fails a tracked file under any of
# the output names, so pruning by name hides nothing a commit can carry.
GATE_PRUNED_NAMES='node_modules .git dist dist-e2e e2e-screenshots .worktrees coverage test-results playwright-report'
GATE_OUTPUT_NAMES='dist dist-e2e e2e-screenshots coverage test-results playwright-report'

gate_prune_args() {
  local name first=1
  printf '(\n'
  for name in $GATE_PRUNED_NAMES .DS_Store; do
    [ "$first" -eq 1 ] || printf -- '-o\n'
    printf -- '-name\n%s\n' "$name"
    first=0
  done
  printf ')\n'
}

# Regular files under a folder, with the folders above pruned, and the Finder's .DS_Store files (git
# ignores them, and they hold NUL bytes); sorted bytewise.
gate_find_files() {
  local args=()
  while IFS= read -r a; do args+=("$a"); done < <(gate_prune_args)
  find "$1" "${args[@]}" -prune -o -type f -print | LC_ALL=C sort
}

# Every path (files and folders) under a folder, same pruning, sorted bytewise.
gate_find_paths() {
  local args=()
  while IFS= read -r a; do args+=("$a"); done < <(gate_prune_args)
  find "$1" "${args[@]}" -prune -o -print | LC_ALL=C sort
}

# Tracked files under a folder that sit inside a build, test or scratch output folder, one path
# relative to the repository per line. Prints nothing outside a git work tree.
gate_tracked_output() {
  local root=$1 dir=$2 names
  git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1 || return 0
  names=$(printf '%s\n' $GATE_OUTPUT_NAMES | sed 's/[.]/\\./g' | paste -s -d '|' -)
  git -C "$root" ls-files -z -- "$dir" 2>/dev/null | tr '\0' '\n' | grep -E "(^|/)($names)/" || true
}

# A random hex string for a per-run file name.
gate_nonce() {
  od -An -tx1 -N16 /dev/urandom | tr -d ' \n'
}

# The kernel lists, read once into GATE_KERNEL_PATHS and GATE_KERNEL_NAMES with comments and blank
# lines skipped: kernel-paths.txt and kernel-names.txt in $1, else beside the gate scripts.
gate_load_kernel_lists() {
  local dir=${1:-$GATE_DIR} line
  GATE_KERNEL_PATHS=()
  GATE_KERNEL_NAMES=()
  [ -f "$dir/kernel-paths.txt" ] && [ -f "$dir/kernel-names.txt" ] || return 1
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    GATE_KERNEL_PATHS+=("$line")
  done < "$dir/kernel-paths.txt"
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    GATE_KERNEL_NAMES+=("$line")
  done < "$dir/kernel-names.txt"
}

# The two matchers below ignore case only when the caller has run `shopt -s nocasematch`, as
# kernel-guard.sh and restore-kernel.sh do: a case-insensitive checkout (macOS) loads claude.md as
# CLAUDE.md and Platform/Gate as platform/gate. Both need gate_load_kernel_lists first.

# True when the path equals a kernel path or lies under one.
gate_under_kernel_path() {
  local kernel
  for kernel in ${GATE_KERNEL_PATHS[@]+"${GATE_KERNEL_PATHS[@]}"}; do
    case "$1" in "$kernel"|"$kernel"/*) return 0 ;; esac
  done
  return 1
}

# True when any segment of the path matches a kernel name, where * matches within the segment.
gate_has_kernel_name() {
  local rest=$1 segment name
  while :; do
    segment=${rest%%/*}
    for name in ${GATE_KERNEL_NAMES[@]+"${GATE_KERNEL_NAMES[@]}"}; do
      # Unquoted so its * is a glob.
      case "$segment" in $name) return 0 ;; esac
    done
    [ "$segment" != "$rest" ] || return 1
    rest=${rest#*/}
  done
}
