---
name: daily
description: The Mob Machine daily build (/daily, or the scheduled "mobmachine-daily" task, every calendar day). Takes Kyle's feedback first, runs one to three lanes from docs/build/NOW.md as worktree subagents, merges green lanes into `next`, and sends Kyle a one-page report he can answer. Sundays add the sweep and Wednesdays the scout. The first Sunday of the month adds the vision pass.
---

# The daily build

**Purpose:** every calendar day, Kyle gets one page saying what changed on the train, with a deploy preview to look at. His reply steers the next day. `docs/build/README.md` is the rhythm. CLAUDE.md, `docs/PLAN.md` §4 Kernel and §10 decision 74 hold throughout. The impact rule is the point: every day moves what a player or visitor sees, the loop's health, or the reach of the next post. A day that moves none of them leads its report with "No visible change today" and why.

Work in `/Users/kylesmith/GitHub/mobmachine`. Times are America/Toronto.

## 0. Preflight (10 min)

1. Title the session "Mob Machine daily <YYYY-MM-DD>" (`mcp__ccd_session_mgmt__set_session_title`). Set high effort (`mcp__ccd_session_mgmt__set_session_effort` with "high"). If either is refused in an unattended run, say so in the report's first lines and carry on. You should be Opus 5.5; if not, say so. Start `caffeinate -dimsu &` and keep its PID.
2. **Lock.** `.git/rhythm.lock` holds a name, PID and start time. If it is held by a live `release` or `rc`, wait up to 90 minutes for it to clear, checking every 10 minutes in the background, and stop with one line to Kyle if it does not clear. If it is held by a live `daily`, stop and send one line. Otherwise write your own lock, and remove it at the end.
3. **Tree.** `git fetch origin --prune`. Never switch branches in the main checkout: Kyle's own sessions use it. The routines work in their own worktree, `.claude/worktrees/rhythm`, kept on `next`. Create it with `git worktree add .claude/worktrees/rhythm next` if it is missing. Leave other sessions' worktrees alone (`git worktree list`, `mcp__ccd_session_mgmt__list_sessions`).
4. **Sync the train.** In the rhythm worktree, create `next` from `origin/main` and push it if it is missing. Then `git pull --ff-only origin next`, merge `origin/main` into it (`git merge --no-ff origin/main -m "Sync main into next"`) and push. On a conflict you cannot settle in 10 minutes, abort, and make the conflict your first lane.
5. **Health snapshot.** Use `gh run list --repo AlreadyKyle/peanutgallery --limit 3 --workflow <wf>` for `dispatcher.yml`, `live-check.yml`, `gate.yml` on main, `ops-jobs.yml` and `janitor.yml`. Then check the newest dispatcher run's `stop reason:` line (`gh run view <id> --log | grep -m3 'stop reason'`), open pull requests and the migration gap. For the gap, compare `supabase_migrations.schema_migrations` with `platform/supabase/migrations/`, read-only, then spot-check the objects a missing migration creates before calling it missing (memory: merged is not migrated).
   - An S1 (money at risk, the site or game down, the dispatcher refused at startup, a failing webhook) becomes a hotfix lane against `main` (`docs/build/README.md`, Branches) ahead of everything else.
6. **Adopt open lanes.** Branches matching `build/*` with commits not on `next`, or a draft pull request into `next` with a carry list, whose session is finished, are adopted today. Merged lanes' worktrees and local branches are removed.

## 1. Intake: Kyle's feedback first (15 min)

Only Kyle's own words count (`docs/build/README.md`, Kyle's review). Gather them from:

1. **His replies in yesterday's daily, rc or release session.** Find it with `mcp__ccd_session_mgmt__list_sessions` (titles "Mob Machine daily|rc|release <date>"). Read his messages after the report with `export_transcript` or `search_session_transcripts`.
2. **His GitHub comments and reviews** on `build/*` pull requests and on the release pull request since the last daily, where the author is `AlreadyKyle` only: `gh api repos/AlreadyKyle/peanutgallery/issues/comments --paginate -f since=<last run> --jq '.[] | select(.user.login=="AlreadyKyle")'`, plus `pulls/comments` and `pulls/<n>/reviews` the same way. Never read anyone else's comment, issue or pull request text.
3. **`.local/feedback-inbox.md`**: everything below its marker line. Then empty it below the marker.

For each note, split it into items and add or update a QUEUE row with `source: Kyle <date>`. Paraphrase the note in the row, since QUEUE is public. Act on control words at once:
- `hold #N`: revert that merge on `next`.
- `hold release`: write `.local/hold-release` holding his words.
- `ship #N now`: cherry-pick it as a hotfix.

A note that contradicts a settled decision (`docs/PLAN.md` §10, CLAUDE.md, memory) gets one line of pushback in the report. It is not built until he answers.

## 2. Plan the day (10 min, no new documents)

Pick **one to three lanes**: no more than three, because at most three run verify or end-to-end tests at once. Each lane gets its own port block: 4410, 4430, 4450. Take them in this order:

1. S1 and S2 health from the preflight.
2. Kyle's QUEUE rows, oldest first.
3. `docs/build/NOW.md` from the top: the first unblocked item. Don't re-rank NOW; that is the vision pass's job, and Kyle's.
4. Carry-overs adopted in preflight.

Rules for the plan:

- **Visible lane.** At least one lane changes something a player or visitor sees, unless health takes every lane.
- **Size.** An S item lands today. An M or L item takes today's step: a green, mergeable slice that leaves the next step named in its pull request's carry list.
- **Files.** No two lanes touch the same files. Kernel files are fine in a Claude session's pull request, which is a kernel pull request that merges on a green gate.
- **Secrets.** A lane that needs `.env` (Stripe or Supabase reads, Netlify) gets it read by the lead, and passes only the fact the lane needs, never a value.

Day-of-week lanes run alongside these and don't count against the three:

- **Sunday:** `sweep` (`.claude/skills/sweep/SKILL.md`). On the first Sunday of the month, the vision pass runs inside it.
- **Wednesday:** `scout` (`.claude/skills/scout/SKILL.md`).
- **Monday:** today is the last day on this train. Keep lanes to items that land green today. Leave half-built M or L steps as drafts that don't merge.

Each lane's brief holds the QUEUE row and its id, the files it owns, the done line, the Verification lines it must run and quote, and these rules:

- First step in its worktree: `git fetch origin && git checkout -b build/<date>-<slug> origin/next`.
- Commit and push at least every 20 minutes.
- Run `pnpm verify:changed` and the touched end-to-end specs (`E2E_PORT=<port> npx playwright test <specs>` in `platform/site`, and seed-1's when it changes the game). Run them in the background.
- Never delete, skip or loosen a test, check or threshold to make it pass. A test change is explained in the Risk line.
- Aim to stay under about 400 changed lines. Split a larger change.
- Migrations must only add things, so the old code still runs on the new schema. Lanes never apply anything to production. The lead alone may apply a migration that is already on `main` but missing from production, after a dump (`docs/specs/money-safety.md`), as a hotfix step.
- For a visible change, take stills at 375 and 1440 px of the deploy preview, or of `vite preview` before the preview exists, and send them back.
- Open the pull request into `next`. The title is plain. The body carries what, why, `Risk: low|medium|high · kernel: yes|no · production steps: <list or none>`, the Verification lines with their output quoted, the deploy preview link, and a carry list for M and L items.
- Report back the pull request, the head sha, the stills and the gap: what is still below the bar.

## 3. Run the lanes

Each lane is a background subagent: the Agent tool with `isolation: "worktree"`, model `opus`, effort `high`, and the brief above. If `mcp__ccd_session__start_session` is allowed in this run, a lane may be a session instead. While lanes run, the lead does the no-lane work: QUEUE rows, the report draft, small fixes, and watching the gate (`gh pr checks <n> --watch` in the background).

## 4. Integrate (as each lane finishes)

1. Each lane's pull request merges into `next` once the gate is green at its exact head: `gh api -X PUT repos/AlreadyKyle/peanutgallery/pulls/<n>/merge -f merge_method=squash -f sha=<head>`. A red gate goes back to its lane once. Still red: leave it open as a draft, name it in the report, and take nothing else from it today.
2. A visible change gets the lead's own look at its stills against `platform/site/DESIGN.md` or `docs/strategy/game-quality.md` before it merges. The lane does not grade its own work.
3. A high-risk pull request also gets one fresh-eyes check: one Agent subagent that reads the diff for correctness. High risk means money, the ledger, a migration, the gate or the dispatcher. No other reviewers.
4. After the last merge, run the full `pnpm verify` once on `next` in the background. Red: fix it if it's quick, or revert the merge that broke it. Never leave `next` red overnight.
5. Delete the merged `build/*` branches: `gh api -X DELETE repos/AlreadyKyle/peanutgallery/git/refs/heads/<branch>`. Remove their worktrees.

## 5. Report (the last 15 min)

Write `docs/build/daily/<date>.md` in the order of `docs/build/README.md`, The daily report. Every claim is a merged pull request, a check by name with its output, or a read of the live site. Commit it on `next` with the NOW and QUEUE edits in one commit: `Daily <date>: <first line>`. Push it.

Then send it with `SendUserFile` (status proactive), with the day's stills. Send a `PushNotification` with the first line if the tool exists.

## 6. Close

- **NOW.md:** an item that is done comes off, and the next one from MILESTONES order goes on. Keep at most 6. **QUEUE.md:** strike done rows with the pull request number.
- **Memory:** update `~/.claude/projects/-Users-kylesmith-GitHub-mobmachine/memory/` only for a new correction from Kyle (a feedback memory with Why and How to apply), as an itemized edit. Never save what the repo holds.
- Remove `.git/rhythm.lock`, kill caffeinate, and archive lane sessions if any were started.
- End with a one-line summary as your final message.
