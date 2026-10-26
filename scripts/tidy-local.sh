#!/usr/bin/env bash
# Keep a local checkout down to what only it holds (docs/build/README.md, The loops that keep it true).
# Removes worktrees and local branches whose work is already on GitHub and merged, and turns on
# fetch pruning. It never touches uncommitted work, the current branch, main, next, or any
# gitignored file such as .env. Run from the repository root: bash scripts/tidy-local.sh [--dry-run]
set -euo pipefail

dry=0
case "${1:-}" in
  --dry-run) dry=1 ;;
  '') ;;
  *) echo "usage: tidy-local.sh [--dry-run]" >&2; exit 2 ;;
esac

run() { if [ "$dry" = 1 ]; then echo "would: $*"; else "$@"; fi; }

git fetch --quiet --prune origin
[ "$dry" = 1 ] || git config fetch.prune true
bases=(origin/main origin/next)
current=$(git symbolic-ref --quiet --short HEAD || echo '')

# A commit is landed when it is in main or next, or when every change on top of next already
# landed there by a squash merge (git cherry marks each with "-").
landed() {
  local ref=$1 base
  for base in "${bases[@]}"; do
    git merge-base --is-ancestor "$ref" "$base" 2>/dev/null && return 0
  done
  [ -z "$(git cherry origin/next "$ref" 2>/dev/null | grep '^+' || true)" ]
}

removed_wt=0
while read -r path; do
  [ "$path" = "$(git rev-parse --show-toplevel)" ] && continue
  if [ ! -d "$path" ]; then continue; fi
  if [ -n "$(git -C "$path" status --porcelain --untracked-files=normal 2>/dev/null)" ]; then
    echo "keep worktree $path: it has uncommitted work"; continue
  fi
  head=$(git -C "$path" rev-parse HEAD)
  if landed "$head"; then
    run git worktree remove --force "$path" && removed_wt=$((removed_wt + 1))
  else
    echo "keep worktree $path: its commits are not merged"
  fi
done < <(git worktree list --porcelain | sed -n 's/^worktree //p')
run git worktree prune

removed_br=0
while read -r branch upstream_state; do
  case "$branch" in main|next|"$current") continue ;; esac
  if git worktree list --porcelain | grep -qx "branch refs/heads/$branch"; then continue; fi
  if [ "$upstream_state" = "[gone]" ] || landed "refs/heads/$branch"; then
    run git branch -D "$branch" && removed_br=$((removed_br + 1))
  elif [ -z "$(git for-each-ref --format='%(upstream)' "refs/heads/$branch")" ]; then
    echo "keep branch $branch: it is only on this machine and not merged"
  fi
done < <(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads)

echo "tidy-local: worktrees removed=$removed_wt branches removed=$removed_br dry_run=$dry"
