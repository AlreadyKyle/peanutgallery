---
name: sweep
description: The Mob Machine weekly sweep and retro (Sundays inside /daily, or /sweep on demand). Cleans up stale branches, pull requests, worktrees, QUEUE rows and memory; checks the docs against the repo; runs the week's retro and the rhythm's metrics; and makes at most one careful rhythm change. On the first Sunday of the month it adds the vision pass.
---

# The weekly sweep

A docs-and-hygiene lane. It keeps the repo and memory telling the truth, so the daily lanes don't trip over stale instructions. It fixes what it can. Anything that needs Kyle goes in the report as one line each. Its output is a "Sweep" section in that day's daily report, never a separate file.

## 1. Stale things (fix them)

- **Branches.** Delete remote branches that are fully merged into `origin/main`, or that have had no commit for 14 days and have no open pull request: `gh api -X DELETE repos/AlreadyKyle/peanutgallery/git/refs/heads/<b>`. Never delete `main`, `next`, `card/*` with an open card, or a branch another live session owns (`mcp__ccd_session_mgmt__list_sessions`). List what was deleted.
- **Pull requests** idle for 14 days. Adopt them into QUEUE as a row with the link, then close them with a one-line comment naming the row. A Dependabot pull request is left to the upkeep policy.
- **Worktrees and local branches** whose work is merged or already on GitHub: run `bash scripts/tidy-local.sh` in the main checkout and quote its last line. It keeps anything uncommitted or unmerged and names it; a kept item two Sundays running gets one line to Kyle.
- **QUEUE.md.**
  - Done rows are struck with their pull request, then moved to Done. Done rows older than 30 days are deleted, since git keeps them.
  - Duplicates collapse into one row.
  - A row idle for 30 days is re-argued in one line or moved to Parked.
- **NOW.md** holds at most 6 items, each still true and unblocked, or marked with what blocks it.
- **Docs truth.**
  - Each `docs/ROADMAP.md` spec status matches the spec file, and `pnpm test:docs` passes.
  - No `docs/BACKLOG.md` entry is already built (grep the code). A built one becomes a QUEUE row to retire the entry, since a renamed or removed entry changes a public card.
  - Every path CLAUDE.md, `docs/build/` and `.claude/skills/` name still exists: `git grep -oE '\`[^\`]+\.(md|sh|ts|mjs|json|yml)\`'`, then check each.
  - LESSONS lines a later fact contradicts are corrected.
- **Memory** (`~/.claude/projects/-Users-kylesmith-GitHub-mobmachine/memory/`). Read every file:
  - delete a memory whose fact the repo or a later memory now contradicts;
  - retire a project memory whose date has passed and whose action is done;
  - fix the `MEMORY.md` index to match the files.
  Make itemized edits, never a rewrite of a file's whole body.

## 2. Retro (learn from the week)

Read the week's `docs/build/daily/*.md`, the release notes and Kyle's words.

- **Repeated corrections.** A note Kyle had to give twice is named, with why the first fix missed. It becomes or updates a feedback memory (Why, How to apply), or a LESSONS line if it is a route or tool fact.
- **The rhythm's metrics** (`docs/build/README.md`, How we know the rhythm works), one line each with the week-on-week change. Count them from the reports and from `gh pr list --base next --state merged --search "merged:>=<last Sunday>"`.
- **Areas worked.** Count QUEUE areas touched this week. An area with nothing for two weeks running gets its top row onto NOW, demoting the lowest item.

## 3. One rhythm change, at most

If a failure happened twice this week (a lane that kept stalling, a check that keeps missing a class of bug, a step every run skips), make one small itemized edit to `docs/build/` or `.claude/skills/`. Make it in a pull request into `next` named "Rhythm change: <what>", and put a line in the report. Never loosen a guard: the gate, the kernel paths, the caps, the read/write separation, Kyle's hold, the backup before a migration, never push red. Never edit a scheduled task's own prompt; say it in the report instead.

## 4. The vision pass (first Sunday of the month only)

- **Scoreboard.** Every row of `docs/strategy/benchmarks.md` that can be measured today: the value, the target, the floor, and "not measured" where data is missing. The money comes from the public ledger, and the counts from `daily_metrics` with read-only SQL.
- **The kill table** (`docs/PLAN.md` §8): has the first launch post gone out? If it has, where does each line stand?
- **MILESTONES.md:** for the current milestone, each exit criterion is met, on track, or behind, with why. If the evidence says the order is wrong, propose a re-rank to Kyle in one line. The re-rank is his call.
- **VISION.md and the strategy docs:** name any claim the month disproved, as a QUEUE row to fix the doc.
