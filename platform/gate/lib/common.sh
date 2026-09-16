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

# Regular files under a folder, with dependency, build and scratch folders pruned; sorted bytewise.
gate_find_files() {
  find "$1" \( -name node_modules -o -name .git -o -name dist -o -name .worktrees -o -name coverage \
    -o -name test-results -o -name playwright-report \) -prune -o -type f -print | LC_ALL=C sort
}

# Every path (files and folders) under a folder, same pruning, sorted bytewise.
gate_find_paths() {
  find "$1" \( -name node_modules -o -name .git -o -name dist -o -name .worktrees -o -name coverage \
    -o -name test-results -o -name playwright-report \) -prune -o -print | LC_ALL=C sort
}
