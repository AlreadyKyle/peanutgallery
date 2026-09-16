# Merge safety: the committed range, the git state, errors after merge, liveness

Status: agreed. Card: none. Owner: board.

## Problem

The dispatcher trusts the worktree more than a session allows, and it drops a merged change when anything unexpected happens after the merge.
1. The pipeline checks only uncommitted changes (`git status`) and pushes `HEAD`. A session runs code, for example vitest over test files it wrote, and that code can `git commit -a` a kernel file, commit a symlink or submodule, or write `core.fsmonitor` into `.git/config`. The next dispatcher git call would run that command with the dispatcher's environment, secrets included.
2. On the "pull request already exists" path the gate and the merge guard use the head GitHub reports, which can lag a force-push. A merge request that times out is treated as refused, though GitHub may have merged.
3. Any error after the merge that is not a card outcome rejects the card as `dispatcher_error` with no restore and no revert, so the change stays on main and live. A Netlify API error, a site read, a smoke fetch that throws and a failed `deploys` insert all do this. A stop during the deploy wait pauses a merged card, and restart pauses every `gated` card, merged or not.
4. The smoke test's headless bot runs from the dispatcher's own checkout, not the merge commit.
5. The tick writes the heartbeat and pings the healthcheck before it reads anything, so a dispatcher whose ticks all fail still looks alive. GitHub, Netlify and smoke requests have no timeout, and nothing notices a card that never leaves the pipeline.
6. `boardSessionActive` counts any `board_members` heartbeat, so a moderator on /board enables attended runs billed to the founder.

## Scope

In:
- The git switches, environment and timeout for every dispatcher git call.
- The worktree's base sha, the committed-range check and the push by sha.
- The git state snapshot around the session and the smoke bot, and the halt.
- Waiting for the pull request head, and resolving a lost merge request.
- Verification after merge (`verifyMerged`), rollback on any error before the smoke verdict, `MergedPending`, and database failures in rollback and after a passing smoke.
- `recovery.ts` for orphaned cards.
- The smoke bot in a detached worktree at the merge sha.
- Request timeouts, the tick's liveness order and the stuck-card watchdog.
- `boardSessionActive` counting board members only, and `claimCard` clearing `commit_sha`.

Out:
- The gate's own card-branch checks (`gate-hardening.md`), which stay the second line for everything here.
- A separate OS user for sessions (`vps.md`, known risk). The snapshot detects git configuration writes; it does not stop code from reading the dispatcher's environment.
- A git state snapshot around the startup probe, which runs a one-turn read-only session. Its git calls still take the switches and environment.
- Migrations, `ROADMAP.md`, `PLAN.md` and any live system.

## Behaviour

**Git calls.** Every git command the dispatcher runs (`worktree.ts`, the push, the probe's worktree):
- starts with `-c core.fsmonitor=false -c core.hooksPath=/dev/null`;
- runs with `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_NO_REPLACE_OBJECTS=1`, so only the repository's own configuration applies and a replacement object cannot change the tree git reports;
- is killed with SIGKILL after five minutes.

**The base.** `createWorktree` prunes stale worktree entries and fetches `+refs/heads/main:refs/remotes/origin/main`. It reads that ref's commit as `baseSha` and adds the card worktree at the sha, so git writes no upstream configuration for the branch. The worktree carries `baseSha`.

**Git state.** `snapshotGitState(repoRoot, worktree)` is a sha256, read with node fs only, over:
- the common git folder's `config`, `info/attributes`, `info/exclude`, `info/grafts` and the `hooks` listing;
- the worktree's `config.worktree`, `commondir` and `gitdir`, found through its `.git` file;
- the worktree's `.git` file itself.

A missing file is recorded as missing. The pipeline takes the snapshot before the session and compares it after the session ends, whatever the outcome, before any git runs. On a difference:
- The card is rejected `git_tamper`, and the alert names the folders to check.
- The process-level halt is set. From then on each tick returns sleep `halted` and claims nothing, writes the heartbeat, and does not ping the healthcheck, so healthchecks.io emails the board too.
- The worktree folder is removed with fs only. The worktree entry and the branch are left for after the restart.
- The halt lives in memory and clears only when the dispatcher restarts. It never writes `studio_state.paused`, which stays the board's.

**The committed range.** Before the commit, HEAD must still be `baseSha`, else `history`. The uncommitted lane check is unchanged. After the dispatcher's commit, `verifyCardCommit` requires:
- `HEAD` is the commit;
- the commit has exactly one parent, `baseSha`;
- `rev-list --count baseSha..sha` is 1;
- `diff-tree -r -z --raw --no-renames baseSha sha`, with `core.quotePath=false`, lists no path outside the lane and no kernel path;
- no entry is mode 120000 or 160000 on either side.

A failure rejects the card `history`, `lane_violation` or `file_mode`, and nothing is pushed. `pushBranch` pushes `<sha>:refs/heads/<branch>`.

**The pull request.**
- The commit the gate and the merge guard use is the pushed sha.
- When the opened or existing pull request reports another head, `waitForPullHead` reads `GET /pulls/{n}` every 2 seconds for up to 60. If the head never matches, the card is rejected `pr_head`, or paused `dispatcher_stopped` when the dispatcher is stopping.
- When the merge request throws, `GET /pulls/{n}` is read, up to three times. `merged: true` continues with `merge_commit_sha`. Otherwise the card is rejected `merge`, and the reason says whether the pull request was unmerged or unreadable.
- A failed `commit_sha` write after the merge is retried, then alerted, and verification goes on.

**After the merge.** `verifyMerged(card, roleId, mergeSha, checks, deps)` waits for the deploy and runs the smoke test.
- A failed deploy writes a red `deploys` row, writes the revert commit without a restore, and rejects `deploy`, as before.
- A failed smoke writes a red row, restores the last green deploy, writes the revert commit, and rejects `smoke`, as before.
- Any other error before the smoke verdict, such as a Netlify or site read, a smoke fetch that throws or times out, or the smoke worktree's git, restores the last green deploy, writes the revert commit, and rejects `post_merge` with the error.
- After a passing smoke the green `deploys` row, the `ship` event and the move to `live` are each tried once and retried three times, with waits of one, two and four seconds. If one still fails, the change is not rolled back. The card stays `gated` with its `commit_sha`, and the board is alerted.
- A stop during the deploy wait no longer pauses a merged card. It stays `gated` with its `commit_sha`, and the board is alerted.
- In rollback, a failed `lastGreen` read or `revert` event write is logged and named in the alert. It never skips the restore, the revert commit or the alert. A failed stage write after a card stop is named in the alert too.

**The smoke bot.** For a seed card, the pipeline fetches main and adds a detached worktree at `<worktreeRoot>/smoke-<id8>` on the merge sha. The bot runs there with `cwd` and `--repo-root` set to it. That checkout runs agent-written code, so its git state is compared around the smoke test like a session's. A difference rolls the merge back, halts the dispatcher and rejects `git_tamper`. The worktree is removed whatever happens. pnpm installs the checkout's dependencies on the bot's first filtered run, as it does in a card worktree (`week1-runs.md`). The bot runner is injectable (`PipelineDeps.botExec`).

**Recovery at startup** (`recovery.ts`). Every orphan's worktree is removed. Then, by stage:
- A `building` card is paused `dispatcher_restart`, with an event and an alert.
- A `gated` card without `commit_sha` is paused the same way.
- A `gated` card with `commit_sha` is alerted, then `verifyMerged` runs for it in the background. It is counted in the running cards, for concurrency, the watchdog and shutdown, until the verification ends.

**Liveness.**
- The tick writes the heartbeat and pings the healthcheck only after its evaluation completes without throwing.
- GitHub and Netlify requests and every smoke page request abort after 30 seconds, joined with a caller's signal when there is one.
- Each tick compares every running card's start with `SESSION_MAX_MINUTES` plus the gate timeout (20 minutes), the deploy timeout (10) and 10 minutes more. It alerts once per card past that limit and leaves the card running.

**The board session.** `boardSessionActive` counts `board_members` rows with `role = 'board'` (the `board_role` enum is `board` or `moderator`). `claimCard` sets `commit_sha` to null with the stage. The site does not read `commit_sha`.

## Acceptance criteria

- [x] Every git call carries `-c core.fsmonitor=false -c core.hooksPath=/dev/null`, the three git environment variables and a five-minute SIGKILL timeout, and a planted `core.fsmonitor` does not run under the dispatcher's git.
- [x] `createWorktree` returns the fetched main sha, the worktree is at it, and no `branch.*` configuration is written.
- [x] `verifyCardCommit` passes one lane commit on the base, and fails two commits as `history`, a kernel file renamed into the lane as `lane_violation`, and a symlink or gitlink as `file_mode`.
- [x] `snapshotGitState` changes when `core.fsmonitor` is planted, when `info/exclude` changes and when the worktree's `.git` file changes, and returns to its value when the file is restored.
- [x] A session that plants git configuration rejects the card `git_tamper`, sets the halt, alerts, pushes nothing and runs no later git.
- [x] A halted tick sleeps `halted`, claims nothing, writes the heartbeat and does not ping.
- [x] An agent commit in the worktree is rejected `history`, and a committed symlink `file_mode`; neither pushes a branch.
- [x] An existing pull request whose head stays stale is polled, then rejected `pr_head` before any gate read or merge.
- [x] A merge request that throws continues when the pull request merged, and rejects `merge` when it did not.
- [x] A site read returning 500, a smoke fetch that throws and a deploy list returning 502, after merge, each restore the last green deploy, write the revert commit and reject `post_merge`.
- [x] A `deploys` insert that keeps failing after a passing smoke is tried four times, leaves the card `gated` with its merge sha, writes no revert and alerts.
- [x] A database failure reading the last green deploy or writing the `revert` event still writes the revert commit and alerts.
- [x] A stop during the deploy wait leaves the card `gated` with its merge sha and alerts.
- [x] The seed smoke bot runs in `smoke-<id8>` at the merge sha, with `--repo-root` set to it, and the worktree is gone afterwards.
- [x] Recovery pauses a `building` card and an unmerged `gated` card with an alert each, verifies a merged `gated` card in the background while it counts as running, and rolls back a merged orphan whose smoke fails.
- [x] A tick whose `studio_state` read throws writes no heartbeat and sends no ping.
- [x] The watchdog alerts once for a card past its limit.
- [x] A GitHub, Netlify or smoke request that never answers aborts at its timeout.
- [x] `boardSessionActive` queries `role=eq.board`, and `claimCard` sends `commit_sha: null`.

## Verification

- `pnpm --filter @backseat/dispatcher test`
- `pnpm --filter @backseat/dispatcher typecheck`
- `pnpm verify`
- Live, after merge: the next card on the VPS runs through push, gate, merge and smoke with no `git_tamper`, `history` or `file_mode` rejection. That shows Claude Code and pnpm write no git configuration during a real session.
- Live, after merge: a seed card's smoke log shows the bot's `cwd` under `.worktrees/smoke-`, and the folder is gone after the card ends.

## Evidence

2026-09-16, branch `merge-safety` on `metering-reconciliation`.

Test first. With the tests written and the source unchanged, `pnpm --filter @backseat/dispatcher test` gave `Tests  39 failed | 239 passed (278)`, with `Cannot find module '../src/recovery.js'`. The failures, by kind:
- missing functions: `TypeError: waitForPullHead is not a function`, `setGitRunner is not a function`, `verifyCardCommit is not a function`, `snapshotGitState is not a function`;
- the old running set: `TypeError: deps.running.add is not a function` (6);
- unchanged pipeline outcomes: `expected { …(21) } to match object { stage: 'rejected', …}` (8), `{ stage: 'live', …}` (2) and `{ stage: 'gated', …}` (1);
- timeouts: 5 `Test timed out in 5000ms`, the requests with no timeout and the db tests with no injectable fetch;
- the smoke bot: `expected [ '--real-seconds', '60' ] to deeply equal [ '--repo-root', '/repo' ]`.

Two worktree tests also failed on their own fixture, an empty `seed-1/content` folder that git does not track. The fixture was fixed before the source changed.

After the change, on `metering-reconciliation` at 53ec03b: `Test Files  25 passed (25)`, `Tests  281 passed (281)` (247 before), three runs in a row.

The base then gained 72ef598. It was merged as 466fc4a with no conflicts, and the post-smoke retries and the merge-state reads use its `retry` helper:
- `pnpm --filter @backseat/dispatcher test`: `Test Files  25 passed (25)`, `Tests  298 passed (298)`.
- `pnpm --filter @backseat/dispatcher typecheck`: exit 0.
- `pnpm verify`: exit 0, with these counts:
  - supabase `Tests  122 passed (122)`
  - site `Tests  123 passed (123)`
  - seed-1 `Tests  77 passed (77)`
  - dispatcher `Tests  298 passed (298)`
  - gate `PASS: gate tests passed=211`
  - agents `tests 64, pass 64`
  - ops `tests 23, pass 22, skipped 1`
  - deno `ok | 58 passed (33 steps) | 0 failed`
  - `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=306`

`pnpm verify` ran again with this spec and the `launch-hardening.md` strike-throughs in place: exit 0, with the same counts and `PASS: secret-scan files=307` from the root scan.

Criteria and the tests that prove them:
- Git calls, the base, the range and the snapshot: `worktree.test.ts`, "the committed range and the git state" and "git hooks".
- Tamper, history, file mode, the pull request head, the lost merge, post-merge rollback, database failures, the deploy-wait stop and the smoke worktree: `pipeline.test.ts`.
- The lost merge and the head wait at the API level: `github.test.ts`.
- Recovery: `recovery.test.ts`.
- Halt, liveness order and the watchdog: `tick.test.ts`.
- Timeouts: `github.test.ts`, `netlify.test.ts` and `smoke.test.ts`.
- The board role and the claim: `db.test.ts`.

Pending: both live lines.

## Decisions

- 2026-09-16: a git state change halts claiming in memory and never writes `studio_state.paused`. `launch-hardening.md` keeps pausing the board's alone, and a halt needs someone to look at the repository before anything runs, which a restart makes explicit.
- 2026-09-16: a halted tick does not ping the healthcheck, so the board hears through healthchecks.io even with ntfy unset. The heartbeat is still written, so /board shows the process alive.
- 2026-09-16: after a tamper no git runs against the repository in that process. The card worktree folder is removed with fs, and the worktree entry and branch are pruned by the next process.
- 2026-09-16: the snapshot watches git's configuration files and the worktree link, not the index, refs or logs. A session's own commit is caught as `history`, and a false halt from git's routine writes would stop the studio for nothing.
- 2026-09-16: an error before the smoke verdict is treated as a failed verification and rolled back, even when the cause is the dispatcher's own API call. An unverified change is not left live. A change verified by a passing smoke is never rolled back for a database failure; it stays `gated` and recovery verifies it again.
- 2026-09-16: a merge request that throws is resolved from the pull request. When the pull request cannot be read either, the card is rejected `merge` with a reason that says to check, rather than guessing either way.
- 2026-09-16: the smoke worktree's git state is compared like a session's, since the bot runs merged agent code on the dispatcher's machine. A change there also rolls the merge back.
- 2026-09-16: `GIT_NO_REPLACE_OBJECTS=1` joins the git environment. Without it, a replacement object written by a session could make `diff-tree` report a different tree from the one pushed.
- 2026-09-16: the Dockerfile's global git identity is no longer read by dispatcher git calls. The dispatcher's only commit sets its author and committer in the environment.
