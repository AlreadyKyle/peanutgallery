# Merge safety: the committed range, the git state, errors after merge, liveness

Status: built. Card: none. Owner: board.

## Problem

The dispatcher trusts the worktree more than a session allows, and it drops a merged change when anything unexpected happens after the merge.
1. The pipeline checks only uncommitted changes (`git status`) and pushes `HEAD`. A session runs code, for example vitest over test files it wrote, and that code can `git commit -a` a kernel file, commit a symlink or submodule, or write `core.fsmonitor` into `.git/config`. The next dispatcher git call would run that command with the dispatcher's environment, secrets included.
2. On the "pull request already exists" path the gate and the merge guard use the head GitHub reports, which can lag a force-push. A merge request that times out is treated as refused, though GitHub may have merged.
3. Any error after the merge that is not a card outcome rejects the card as `dispatcher_error` with no restore and no revert, so the change stays on main and live. A Netlify API error, a site read, a smoke fetch that throws and a failed `deploys` insert all do this. A stop during the deploy wait pauses a merged card, and restart pauses every `gated` card, merged or not.
4. The smoke test's headless bot runs from the dispatcher's own checkout, not the merge commit.
5. The tick writes the heartbeat and pings the healthcheck before it reads anything, so a dispatcher whose ticks all fail still looks alive. GitHub, Netlify and smoke requests have no timeout, and nothing notices a card that never leaves the pipeline.
6. `boardSessionActive` counts any `board_members` heartbeat, so a moderator on /board enables attended runs billed to the founder.

The review of the first build (1f9f69c, 3c357b4) found more:

7. The halt stopped claiming but not git, a restart forgot it, and the card worktree was still removed with git.
8. Processes a session started in the background outlived it and could write configuration after the check.
9. The snapshot missed the common `config.worktree`. The commit-graph file and GitHub's own view of the pushed range were never checked.
10. A lost merge request that GitHub merged late was rejected.
11. One failed deploy read, site read or smoke request rolled back a good change.
12. Recovery re-ran smoke after main had moved, and re-smoked a card whose smoke had passed. It missed an old deploy and ignored a merge whose sha was never written.
13. Two cards could merge, verify and revert at the same time.
14. Git inherited the dispatcher's `GIT_*` variables and its secrets, and the stuck limit left out several bounded waits.

## Scope

In:
- The git switches, environment and timeout for every dispatcher git call, and the halt inside git itself.
- The worktree's base sha, the committed-range check, GitHub's compare and trees check, and the push by sha.
- The git state snapshot and the configuration allowlist around the session, before the commit, before the push and around the smoke bot, and at startup.
- The session's process group.
- Waiting for the pull request head, and a lost merge request.
- Verification after merge (`verifyMerged`), its retries, rollback on any error before the smoke verdict, and database failures in rollback and after a passing smoke.
- One lock from merge through verification.
- `recovery.ts` for orphaned cards.
- The smoke bot in a detached worktree at the merge sha.
- Request timeouts, the tick's liveness order and the stuck-card watchdog.
- `boardSessionActive` counting board members only, and `claimCard` clearing `commit_sha`.

Out:
- The gate's own card-branch checks (`gate-hardening.md`), which stay the second line for everything here.
- Containment of a session running as the dispatcher's user. That is the session-containment work: the permission policy and the Bash sandbox. A separate OS user is covered by `vps.md` as a known risk. This change makes the dispatcher's own git use fail closed. It does not stop code from reading the dispatcher's environment or from escaping the process group with `setsid`.
- A git state snapshot around the startup probe, which runs a one-turn read-only session. Its git calls still take the switches, the environment and the halt.
- A timeout on the Supabase client. It comes from `metering-reconciliation` (an 8-second fetch timeout on `createClient`), merged here as bcc6c77, and is not duplicated.
- Migrations, `ROADMAP.md`, `PLAN.md` and any live system.

## Behaviour

**Git calls.** Every git command the dispatcher runs goes through `worktree.ts`: the worktree operations, the push and the probe's worktree.
- It starts with `-c core.fsmonitor=false -c core.commitGraph=false -c core.attributesFile=/dev/null -c core.hooksPath=/dev/null`.
- It names the repository's folders in its environment, so git never works them out itself and never follows a `commondir` file:
  - A call in a folder holding a `.git` folder gets `GIT_DIR` and `GIT_COMMON_DIR` set to that folder, and `GIT_WORK_TREE` set to the call's folder.
  - A call in a worktree gets `GIT_DIR` set to the `worktrees/<name>` folder its `.git` file names, and `GIT_COMMON_DIR` set to two levels above that. A `.git` file that points anywhere but into a `worktrees` folder, or a `.git` that is neither a file nor a folder, throws.
  - A call in a folder with no `.git` (git init or clone, and the bare repositories in tests) gets `GIT_CEILING_DIRECTORIES` set to the folder's parent, so git does not search above it.
- Its environment is an allowlist: `PATH`, `HOME`, `USER`, `LOGNAME`, `LANG`, `TZ`, `TMPDIR`, `SSL_CERT_FILE`, `SSL_CERT_DIR` and `LC_*`.
- On top of that it gets `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_NO_REPLACE_OBJECTS=1`. It also gets what the caller passes: the github.com auth header, and a commit's author and committer.
- No inherited `GIT_*` variable, and no secret loaded from `.env`, reaches git.
- It is killed with SIGKILL after five minutes.
- When the dispatcher is halted it throws `HaltedError` before starting git. There is no exception, not even a read.
- Creating and removing worktrees runs under one repository lock, since they share refs and the worktree list.

**The base.** `createWorktree` prunes stale worktree entries and fetches `+refs/heads/main:refs/remotes/origin/main`. It reads that ref's commit as `baseSha` and adds the card worktree at the sha, so git writes no upstream configuration for the branch. The worktree carries `baseSha`.

**Git state.** `snapshotGitState(repoRoot, worktree)` is a sha256, read with node fs only, over:
- the common git folder's `config`, `config.worktree`, `commondir`, `objects/info/alternates`, `objects/info/http-alternates`, `info/attributes`, `info/exclude`, `info/grafts` and the `hooks` listing;
- the worktree's `config.worktree`, `commondir` and `gitdir`, found through its `.git` file;
- the worktree's `.git` file itself.

A missing file is recorded as missing.

**The configuration allowlist** (`gitconfig.ts`).
- The common `config`, the common `config.worktree` and the worktree's `config.worktree` are parsed with node fs. The parser reads sections, quoted and dotted subsections, a variable on a section line, continuations and comments.
- A line it cannot read is refused.
- Allowed keys:
  - `core.repositoryformatversion`, `filemode`, `bare`, `logallrefupdates`, `ignorecase`, `precomposeunicode`, `symlinks`;
  - `remote.origin.url` and `fetch`;
  - any per-branch key `branch.<name>.<key>`: git's own (`remote`, `pushRemote`, `merge`, `mergeOptions`, `rebase`, `description`) and those gh, GitHub Desktop and IDEs write (`gh-merge-base`, `vscode-merge-base`);
  - `extensions.objectformat` and `refstorage`;
  - `lfs.repositoryformatversion`, which git-lfs writes as data (its filters live in global configuration, which the dispatcher's git never reads).
- Every other key is refused. That covers every key that runs a program or redirects traffic: `include.*`, `includeIf.*`, `extensions.worktreeConfig`, `gpg.*`, `commit.gpgSign`, `tag.gpgSign`, `filter.*`, `diff.*.textconv`, `credential.*`, `http.*`, `https.*`, `url.*`, `protocol.*`, `core.sshCommand`, `core.askPass`, `core.fsmonitor`, `core.hooksPath`, `core.gitProxy`, `core.pager`, `core.editor`, `remote.*.uploadpack`, `receivepack` and `proxy`, a remote other than origin, `remote.pushDefault`, the two-part `branch.*` settings such as `branch.autoSetupMerge`, and anything unknown.
- No per-branch key runs a program or redirects traffic. Git reads them for pull, merge and a push with no remote named, and the dispatcher runs none of those: `pushBranch` pushes to `origin` by name, and `fetchMain` fetches from `origin` by name. A `remote` or `pushRemote` naming another remote points at a `remote.<name>.*` definition, which is refused, and `remote.origin.url` is checked at startup.
- The other allowed keys are what git writes for init, clone, fetch, worktree add, a push and branch -D. `gitconfig.test.ts` shows this for the local git (2.48.1) by running those steps and finding nothing refused. The list for Debian bookworm's 2.39 is the same set by git's documented behaviour; the first live line below confirms it.

**The repository layout** (`gitLayoutViolations`, part of every allowlist check). These files send git's configuration, attributes or objects somewhere else, or are programs git would run. Git writes none of them for the dispatcher's use, so their presence is refused, read with node fs:
- `.git/commondir` in the main repository;
- `info/attributes`, since the attributes file can name a filter or diff driver for every path;
- `info/grafts`, which rewrites history as git reads it;
- `objects/info/alternates` and `objects/info/http-alternates`;
- any file in `hooks` other than git's own `*.sample` files;
- a `config.worktree` in any `worktrees/<name>` folder;
- a `worktrees/<name>/commondir` whose content is not `../..`.

**Checks around the session.** The pipeline takes the snapshot before the session. It checks the layout, the allowlist and then the snapshot at three points, and each check runs before any git call that acts on the result:
- after the session ends, whatever the outcome;
- right before the commit;
- right before the push.

On a refused file, a refused key, a changed snapshot or an unreadable state:
- The card is rejected `git_tamper`. The alert names the refused keys and the files to check.
- The process-level halt is set. From then on git throws. Each tick returns sleep `halted`, claims nothing and writes the heartbeat. It does not ping the healthcheck, so healthchecks.io emails the board too.
- Every worktree, the card's and the smoke checkout, is removed with fs only. The worktree entry and the branch are left for after the restart.
- The halt lives in memory and never writes `studio_state.paused`, which stays the board's. The startup check below takes the place of a persisted halt.

**Startup.** Before any other startup step and before any git, `checkRepositoryGit` checks the repository's layout and its configuration against the allowlist. It also requires `remote.origin.url` to be `https://github.com/<GITHUB_REPO>`, with or without `.git`. A failure is a fatal `StartupError`, so the process exits 78 and systemd does not restart it. A restart after a tamper therefore refuses to start until someone has cleaned the configuration.

**The session's process group.**
- The Claude Code child is spawned `detached`, so it leads its own process group.
- The interrupt sequence (SIGINT, then SIGTERM, then SIGKILL) signals the group.
- When the child closes, the group gets SIGKILL once more, so a background process the session started dies before the dispatcher reads the worktree or runs git.
- A process that calls `setsid` leaves the group and is not reached. The session sandbox and containment close that.
- The checks before the commit and the push catch configuration written in the gap.

**The committed range.** Before the commit, HEAD must still be `baseSha`, else `history`. The uncommitted lane check is unchanged. After the dispatcher's commit, `verifyCardCommit` requires:
- `HEAD` is the commit;
- the commit has exactly one parent, `baseSha`;
- `rev-list --count baseSha..sha` is 1;
- `diff-tree -r -z --raw --no-renames baseSha sha`, with `core.quotePath=false`, lists no path outside the lane and no kernel path;
- no entry is mode 120000 or 160000 on either side.

A failure rejects the card `history`, `lane_violation` or `file_mode`, and nothing is pushed. On success it returns the sorted changed paths. `pushBranch` pushes `<sha>:refs/heads/<branch>`.

**GitHub's view of the range.** After the gate passes and under the merge lock, before the merge request, the pipeline reads `GET /compare/{baseSha}...{sha}` and `GET /git/trees/{sha}?recursive=1` for both the base and the commit. It requires:
- merge base `baseSha`, one commit ahead, none behind, and that commit the pushed sha;
- fewer than 300 files, GitHub's list limit;
- the changed paths, with a rename's previous name counted, exactly the paths `verifyCardCommit` returned;
- no path outside the lane and no kernel path;
- no path of mode 120000 or 160000 in either tree. A truncated tree is refused.

A mismatch rejects the card `history`, and nothing merges. Each request that throws is tried up to three times.

**The pull request.**
- The commit the gate and the merge guard use is the pushed sha.
- When the opened or existing pull request reports another head, `waitForPullHead` reads `GET /pulls/{n}` every 2 seconds for up to 60. If the head never matches, the card is rejected `pr_head`, or paused `dispatcher_stopped` when the dispatcher is stopping.
- When the merge request throws, `GET /pulls/{n}` is read every 2 seconds for up to 60 seconds, and a failed read waits for the next one. `merged: true` continues with `merge_commit_sha`.
- If it still does not show merged, the card is not rejected:
  - an `error` event `{step: 'merge_unknown', pr, sha, reason}` is written;
  - `failing_check` is set to `merge_unknown`, and the card stays `gated`;
  - the board is alerted, and nothing is closed. Recovery resolves it.
- A failed `commit_sha` write after the merge is retried, then alerted, and verification goes on.

**The merge lock.** A process-wide lock is held from the remote range check through the merge and verification, or rollback. Recovery's verification takes the same lock. Two cards never merge, verify or revert at the same time, so a smoke test always sees the build of its own merge.

**After the merge.** `verifyMerged(card, roleId, mergeSha, checks, deps)` waits for the deploy and runs the smoke test.
- **Deploy reads.** A failed read, whether a non-200 or a network error, is logged, and the wait goes on to its deadline. If no read has seen a deploy by the deadline and the last read failed, the error is thrown.
- **Paging.** `findDeploy` pages through up to four pages of 50 deploys, so an older deploy is still found.
- **Retries.** The site read, the Netlify restore and the revert commit are each tried up to three times when they throw, with waits of one and two seconds. Each smoke page request is tried up to three times when it throws or answers 5xx; a 5xx on the last try is the answer. All of them use the `retry` helper.
- **A failed deploy** writes a red `deploys` row, writes the revert commit without a restore, and rejects `deploy`.
- **A failed smoke** writes a red row, restores the last green deploy, writes the revert commit, and rejects `smoke`.
- **Any other error before the smoke verdict** restores the last green deploy, writes the revert commit, and rejects `post_merge` with the error. That covers a deploy list that never answers, a site read or smoke request that keeps failing, and the smoke worktree's git.
- **A passing smoke** first writes a `message` event `{step: 'smoke_pass', sha, deploy_id, url, smoke}`. Then come the green `deploys` row (skipped when the newest green row is already this sha), the `ship` event and the move to `live`. Each write is tried once and retried three times, with waits of one, two and four seconds. If one still fails, the change is not rolled back: the card stays `gated` with its `commit_sha`, and the board is alerted.
- **A stop during the deploy wait** leaves the card `gated` with its `commit_sha`, and the board is alerted. If the `commit_sha` write had failed, a restart could not find the card, so it is rolled back and rejected `post_merge` instead.
- **Database failures in rollback.** A failed `lastGreen` read or `revert` event write is logged and named in the alert. It never skips the restore, the revert commit or the alert. A failed stage write after a card stop is named in the alert too.

**The smoke bot.**
- For a seed card, the pipeline fetches main and adds a detached worktree at `<worktreeRoot>/smoke-<id8>` on the merge sha. The bot runs there, with `cwd` and `--repo-root` set to it.
- That checkout runs agent-written code, so the snapshot and the allowlist are checked around the smoke test. A problem halts the dispatcher, removes the checkout with fs, rolls the merge back and rejects `git_tamper`.
- Otherwise the worktree is removed whatever happens.
- pnpm installs the checkout's dependencies on the bot's first filtered run, as it does in a card worktree (`week1-runs.md`). The install must fit inside the bot's exec timeout (`SMOKE_BOT_SECONDS` plus 120 seconds); a live line below checks it.
- The bot runner is injectable (`PipelineDeps.botExec`).

**Recovery at startup** (`recovery.ts`). Every orphan's worktree is removed. Then:
- A `building` card is paused `dispatcher_restart`, with an event and an alert.
- A `gated` card with `commit_sha` is alerted, then verified in the background by `resumeMerged`. It counts as running, for concurrency, the watchdog and shutdown, until the verification ends. Under the merge lock, `resumeMerged` does the following:
  - If a `smoke_pass` event for this sha exists, it only records the ship: no smoke test and no rollback.
  - Otherwise it reads main's head (`GET /git/ref/heads/main`). If main is not at the merge sha, nothing runs. The card stays `gated`, and the board is alerted.
  - If main is still at the merge sha, `verifyMerged` runs with its rollback.
  - If a read fails, the card stays `gated`, and the board is alerted.
- A `gated` card without `commit_sha` has its newest pull request for its branch read. For a gated card, that is the pull request of its latest claim.
  - Merged: `commit_sha` is written, and the card is verified as above.
  - Not merged, with `failing_check` `merge_unknown`: the card is rejected `merge`, nothing is closed, and the board is alerted.
  - Not merged otherwise: the card is paused `dispatcher_restart` and alerted.
  - Unreadable: the card stays `gated`, and the board is alerted.

**Liveness.**
- The tick writes the heartbeat and pings the healthcheck only after its evaluation completes without throwing.
- GitHub and Netlify requests and every smoke page request abort after 30 seconds, joined with a caller's signal when there is one.
- The stuck limit (`stuckAfterMs`) adds up:
  - `SESSION_MAX_MINUTES`;
  - three network git calls at their five-minute timeout;
  - the pull request head wait (1 minute), the gate (20) and the lost-merge poll (1);
  - two verify windows of the deploy timeout (10) plus the smoke window (15: the smoke gate's 12 and 3), one for the card and one for a card ahead of it on the merge lock;
  - 2 minutes of retries and 10 more.
  
  That is 159 minutes at the default 60-minute session.
- Each tick alerts once per card past the limit and leaves the card running. The `stuck:<id>` key is forgotten when the card leaves the running set, so a later claim can alert again.

**The board session.** `boardSessionActive` counts `board_members` rows with `role = 'board'` (the `board_role` enum is `board` or `moderator`). `claimCard` sets `commit_sha` to null with the stage. The site does not read `commit_sha` or event payloads.

## Acceptance criteria

- [x] ~~Every git call carries `-c core.fsmonitor=false -c core.commitGraph=false -c core.hooksPath=/dev/null`, the three git environment variables, no inherited `GIT_DIR` and no `.env` secret, and a five-minute SIGKILL timeout, and a planted `core.fsmonitor` does not run under the dispatcher's git.~~ Superseded by the commondir fix below: the dispatcher now sets `GIT_DIR` itself (2026-09-16).
- [x] Every git call carries `-c core.fsmonitor=false -c core.commitGraph=false -c core.attributesFile=/dev/null -c core.hooksPath=/dev/null`, the three git environment variables, and its own `GIT_DIR`, `GIT_COMMON_DIR` and `GIT_WORK_TREE` (for a repository call, `.git`; for a worktree call, `.git/worktrees/<name>` with `.git` as the common folder), never an inherited `GIT_DIR` and no `.env` secret, and a five-minute SIGKILL timeout. A planted `core.fsmonitor` does not run under the dispatcher's git.
- [x] With `.git/commondir` pointing at a copy of the repository whose config and `info/attributes` name a clean filter, plain git runs the filter on `git add`; the dispatcher's `git add` does not, and `rev-parse --git-common-dir` reports the real `.git`.
- [x] Startup refuses, fatally and naming the file, each of: a main `.git/commondir`, `info/attributes`, `objects/info/alternates`, `objects/info/http-alternates`, a hook that is not a sample, a worktree `config.worktree`, and a worktree `commondir` other than `../..`; it passes again once the file is gone.
- [x] A session that plants any of those files, the `commondir` one as a copy of the repository with a smudge filter, is rejected `git_tamper` with the dispatcher halted, nothing pushed, the filter never run and zero git calls after the session.
- [x] Once halted, `git` throws `HaltedError` and the git runner is never called.
- [x] `createWorktree` returns the fetched main sha, the worktree is at it, and no `branch.*` configuration is written.
- [x] `verifyCardCommit` passes one lane commit on the base and returns its paths, and fails two commits as `history`, a kernel file renamed into the lane as `lane_violation`, and a symlink or gitlink as `file_mode`.
- [x] `snapshotGitState` changes when `core.fsmonitor` is planted, when `info/exclude` changes, when the common `config.worktree`, a `commondir`, `objects/info/alternates` or `http-alternates` appears, and when the worktree's `.git` file changes, and returns to its value when the file is removed or restored.
- [x] The allowlist finds nothing refused after init, clone, fetch, worktree add, a push and branch -D. It refuses a planted include, any key in the common `config.worktree`, every listed program-running or traffic-redirecting key, and an unreadable line.
- [x] The allowlist lets `branch.<name>.gh-merge-base`, `vscode-merge-base`, an unknown `branch.<name>.anything` and `branch.<name>.pushRemote` through. A card still pushes to origin when its branch's `pushRemote` names another remote, and that remote's `url` and `pushurl` are refused.
- [x] Startup exits fatally for a planted include, an origin other than the repository and an unreadable line, and passes a clean clone.
- [x] A session that plants `gpg.program` and `commit.gpgSign` rejects the card `git_tamper`, names the keys, halts, pushes nothing, removes the worktree with fs and makes zero git calls after the session.
- [x] A smoke bot that plants an include halts, makes zero git calls after the bot, removes the checkout, restores the last green deploy, writes the revert commit and rejects `git_tamper`.
- [x] A halted tick sleeps `halted`, claims nothing, writes the heartbeat and does not ping.
- [x] A background process the session left running is killed when the session ends.
- [x] An agent commit in the worktree is rejected `history`, and a committed symlink `file_mode`; neither pushes a branch.
- [x] A GitHub compare listing a file the local check did not see rejects `history` before any merge request.
- [x] An existing pull request whose head stays stale is polled, then rejected `pr_head` before any gate read or merge.
- [x] A merge request that throws continues when the pull request shows merged within the poll, including after a failed read.
- [x] ~~A merge request that throws rejects `merge` when the pull request did not merge.~~ Superseded by the review fixes (709748d): the card stays `gated` with `merge_unknown` (2026-09-16).
- [x] A merge request that throws, with a pull request that never shows merged, leaves the card `gated` with `failing_check` `merge_unknown`, writes the `merge_unknown` event with the pull request and sha, alerts and runs no deploy or revert.
- [x] A site read that keeps returning 500, a smoke fetch that keeps throwing and a deploy list that returns 502 up to the deadline, after merge, each restore the last green deploy, write the revert commit and reject `post_merge`.
- [x] A single 502 from the deploy list and a single failed site read are ridden out, and the card ships; a restore and a revert whose first request throws are tried again and succeed.
- [x] A smoke page request is tried again after a 502 and after a network error, and a 503 on all three tries fails the smoke.
- [x] `findDeploy` pages until it finds the sha or a page is short; the deploy wait logs failed reads and throws the last error when nothing was seen by the deadline.
- [x] A `deploys` insert that keeps failing after a passing smoke is tried four times after a `smoke_pass` event, leaves the card `gated` with its merge sha, writes no revert and alerts.
- [x] A database failure reading the last green deploy or writing the `revert` event still writes the revert commit and alerts.
- [x] A stop during the deploy wait leaves the card `gated` with its merge sha and alerts; with its `commit_sha` write failed, it restores, reverts and rejects `post_merge`.
- [x] Two cards in the same folder never interleave merge and verification. The test fails with the lock removed.
- [x] The seed smoke bot runs in `smoke-<id8>` at the merge sha, with `--repo-root` set to it, and the worktree is gone afterwards.
- [x] ~~Recovery pauses a `building` card and an unmerged `gated` card with an alert each, verifies a merged `gated` card in the background while it counts as running, and rolls back a merged orphan whose smoke fails.~~ Superseded by the review fixes (709748d): a `gated` card without `commit_sha` is looked up first (2026-09-16).
- [x] Recovery pauses a `building` card, and pauses a `gated` card whose pull request did not merge, with an alert each. It verifies a merged `gated` card in the background while it counts as running, and rolls back a merged orphan whose smoke fails.
- [x] Recovery writes the merge sha and verifies a `gated` card whose pull request merged, rejects a `merge_unknown` card whose pull request did not, and leaves a card `gated` with an alert when its pull request cannot be read.
- [x] `resumeMerged` runs no smoke or rollback when main has moved, and only records the ship when a `smoke_pass` event for the sha exists.
- [x] `findCardMerge` takes the newest pull request for the branch and returns its merge sha only when it merged.
- [x] A tick whose `studio_state` read throws writes no heartbeat and sends no ping.
- [x] The watchdog alerts once for a card past its limit, alerts again after the card finished and was claimed again, and the limit at a 60-minute session is 159 minutes (139 before the smoke window grew).
- [x] A GitHub, Netlify or smoke request that never answers aborts at its timeout.
- [x] `boardSessionActive` queries `role=eq.board`, `claimCard` sends `commit_sha: null`, and `findEvent` queries the newest event by `payload_json->>step`.

## Verification

- `pnpm --filter @backseat/dispatcher test`
- `pnpm --filter @backseat/dispatcher typecheck`
- `pnpm verify`
- Live, before the first card: `checkRepositoryGit` passes on the VPS clone (git 2.39), so the allowlist matches what that git wrote.
- Live, after merge: the next card on the VPS runs through push, gate, compare, merge and smoke with no `git_tamper`, `history` or `file_mode` rejection. That shows Claude Code and pnpm write no git configuration during a real session.
- ~~Live, after merge: a seed card's smoke log shows the bot's `cwd` under `.worktrees/smoke-`. The bot's first run, including pnpm's install in the fresh checkout, finishes inside its exec timeout, and the folder is gone after the card ends.~~ Superseded by `launch-managed.md`: production smoke runs no card code (PLAN.md §10 decision 34), so no smoke bot runs after a merge; it checks the served build, the served config and the gate at the merge sha.

## Evidence

2026-09-16, branch `merge-safety` on `metering-reconciliation`.

**First build (1f9f69c, 3c357b4).** Test first. With the tests written and the source unchanged, `pnpm --filter @backseat/dispatcher test` gave `Tests  39 failed | 239 passed (278)`, with `Cannot find module '../src/recovery.js'`. The failures, by kind:
- missing functions: `TypeError: waitForPullHead is not a function`, `setGitRunner is not a function`, `verifyCardCommit is not a function`, `snapshotGitState is not a function`;
- the old running set: `TypeError: deps.running.add is not a function` (6);
- unchanged pipeline outcomes: `expected { …(21) } to match object { stage: 'rejected', …}` (8), `{ stage: 'live', …}` (2) and `{ stage: 'gated', …}` (1);
- timeouts: 5 `Test timed out in 5000ms`, the requests with no timeout and the db tests with no injectable fetch;
- the smoke bot: `expected [ '--real-seconds', '60' ] to deeply equal [ '--repo-root', '/repo' ]`.

Two worktree tests also failed on their own fixture, an empty `seed-1/content` folder that git does not track. The fixture was fixed before the source changed.

After the change, on `metering-reconciliation` at 53ec03b: `Test Files  25 passed (25)`, `Tests  281 passed (281)` (247 before), three runs in a row. The base then gained 72ef598. It was merged as 466fc4a with no conflicts, and gave:
- dispatcher `Tests  298 passed (298)`;
- typecheck exit 0;
- `pnpm verify` exit 0.

**Review fixes (709748d).** Test first. With the tests written and the source unchanged, the suite gave `Test Files  10 failed | 16 passed (26)` and `Tests  76 failed | 248 passed (324)`, and `gitconfig.test.ts` could not load `../src/gitconfig.js`.

After the change:
- `pnpm --filter @backseat/dispatcher test`: `Test Files  26 passed (26)`, `Tests  331 passed (331)`, three runs in a row.
- `pnpm --filter @backseat/dispatcher typecheck`: exit 0.
- Mutation checks, each reverted afterwards:
  - With the merge lock replaced by a direct call, the two-card test failed with `expected [ 'rejected', 'live' ] to deeply equal [ 'live', 'live' ]`. Its first version passed without the lock, so the deploy now builds until both cards have merged.
  - With the halt check in `gitRaw` switched off, "runs no git at all once the dispatcher is halted" failed.
  - With the group kill after the session removed, "kills a background process the session left behind" failed.
- `pnpm verify`: exit 0, with these counts:
  - supabase `Tests  122 passed (122)`
  - site `Tests  123 passed (123)`
  - seed-1 `Tests  77 passed (77)`
  - dispatcher `Tests  331 passed (331)`
  - gate `PASS: gate tests passed=211`
  - agents `tests 64, pass 64`
  - ops `tests 23, pass 22, skipped 1`
  - deno `ok | 58 passed (33 steps) | 0 failed`
  - `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=311`

Criteria and the tests that prove them:
- Git calls, the halt in git, the environment, the base, the range and the snapshot: `worktree.test.ts`, "the committed range and the git state" and "git hooks".
- The allowlist, what git writes, and startup: `gitconfig.test.ts`.
- The process group: `attended.test.ts`, "the session process group".
- Tamper after the session and after the smoke bot, history, file mode, the remote range, the pull request head, the lost merge, post-merge rollback and retries, database failures, the deploy-wait stop, the lock and the smoke worktree: `pipeline.test.ts`.
- The lost merge poll, compare, trees, the branch pull request and main's head at the API level: `github.test.ts`.
- Paging and the tolerant deploy wait: `netlify.test.ts`.
- Smoke retries: `smoke.test.ts`.
- Recovery, `resumeMerged` and `findCardMerge`: `recovery.test.ts`.
- Halt, liveness order, the watchdog, its reset and the stuck limit: `tick.test.ts`.
- Timeouts: `github.test.ts`, `netlify.test.ts` and `smoke.test.ts`.
- The board role, the claim and `findEvent`: `db.test.ts`.

**The base's second round and per-branch keys (bcc6c77 and the commit after it).**
- `origin/metering-reconciliation` at aa06e43 was merged as bcc6c77.
- Three files conflicted: `db.ts`, `startup.ts` and `db.test.ts`. The resolution keeps the base's `createSupabaseDb(url, key, { fetchFn, timeoutMs })` with its 8-second timeout, both import sets, and both sets of db tests, this branch's adapted to the options object. A recovery test fixture gained the ledger's new `request_id`.
- No pipeline write is a ledger write, so no retry moved to metering's request-id path.
- After the merge, `pnpm --filter @backseat/dispatcher test` gave `Tests  347 passed (347)`, and typecheck exit 0.
- Per-branch keys, test first: "allows the keys git writes", "allows the per-branch keys gh, GitHub Desktop and IDEs write" and "pushes a card to origin even when the branch names another push remote" failed (`expected [ 'branch.main.gh-merge-base', …(3) ] to deeply equal []`). After the change, `gitconfig.test.ts` gave `Tests  9 passed (9)`, and the suite `Tests  349 passed (349)`.

**The commondir redirect (the commit after bd4a875).** The security review of ops-separation found the gap: `commonGitDir` took `.git` as the common folder and never read `commondir`, so the snapshot and the allowlist read the clean original while git followed a planted copy.
- Test first, with the tests written and the source unchanged: `Test Files  3 failed | 23 passed (26)`, `Tests  27 failed | 337 passed (364)`.
- After the change, `pnpm --filter @backseat/dispatcher test` gave `Test Files  26 passed (26)`, `Tests  364 passed (364)`, twice. Typecheck exit 0.
- Mutation check, reverted afterwards: with the explicit git folders left out of git's environment, "ignores a commondir that points git at a planted copy" failed, because plain git reported the planted copy as its common folder.
- Tests:
  - `worktree.test.ts`: the redirect with a clean filter, the snapshot additions, and the environment of every call.
  - `gitconfig.test.ts`: startup refuses each file.
  - `pipeline.test.ts`: each file planted during a session.

Pending: the three live lines.


2026-09-20, status corrected from agreed to built. The code merged as 3ab50e8 (PR 37, landed on main
as PR 38). The three live lines remain: they need a real card to merge through the dispatcher, which
waits on the VPS cutover.

2026-09-26: the third live line (the smoke bot's worktree) is struck through, superseded by
`launch-managed.md`: production smoke runs no card code, so there is no smoke bot to watch. The first
two live lines remain and wait on the first card merged through the dispatcher, at the cutover on the
Mac host (`mac-host.md`).

## Residual risks

- A `.sample` hook is allowed because git never runs a file with that suffix; a tool that installs real hooks in the repository (husky, pre-commit, lefthook) refuses startup. The same goes for a worktree someone added with per-worktree configuration.
- The session runs as the dispatcher's user. Code it runs can read the dispatcher's environment through `/proc`, and a process that calls `setsid` survives the group kill and can write configuration after the last check before the push. The permission policy and the Bash sandbox are what contain it. The checks here make the dispatcher's own git fail closed; they do not contain the session.
- The allowlist is fail-closed. A tool that writes an unlisted key outside `branch.<name>.*` into the repository configuration, on the VPS or on a board member's machine running attended, stops the dispatcher at the next check or startup. Per-branch keys from gh, GitHub Desktop and IDEs are allowed.
- The 2.39 key set rests on git's documented behaviour, not a run on that version; the first live line checks it.
- The newest pull request for a branch is taken as the card's latest claim. That holds because a card reaches `gated` only after its push and pull request. A pull request someone opens by hand for a card branch would break it.
- A green `deploys` row can be written twice when the ship writes fail after it and a later recovery sees a different newest green row.
- A 5xx page on all three smoke tries fails the smoke and rolls back, as before. Only a transient 5xx is ridden out.
- A lost merge request that GitHub merges after the 60-second poll leaves the card `gated`, reserving its estimate and holding the attended slot, until a restart resolves it.
- Supabase requests time out after 8 seconds (merged from `metering-reconciliation`). The pipeline's post-merge writes retry deploys rows, events and card updates with `retry`. None of them is a ledger write, so none carries a request id, and a write that succeeded but timed out on the way back can repeat: a second `smoke_pass` or `ship` event, or a second green `deploys` row.
- The first smoke run in a fresh checkout pays for pnpm's install inside the bot's exec timeout; a slow install fails the smoke and rolls a good change back.

## Decisions

- 2026-09-16: a git state change halts in memory and never writes `studio_state.paused`. `launch-hardening.md` keeps pausing the board's alone. ~~A halt needs someone to look at the repository before anything runs, which a restart makes explicit.~~ Superseded by the review fixes (709748d): a restart alone clears the halt, and the startup allowlist is what refuses a repository still carrying planted configuration (2026-09-16).
- 2026-09-16: a halted tick does not ping the healthcheck, so the board hears through healthchecks.io even with ntfy unset. The heartbeat is still written, so /board shows the process alive.
- 2026-09-16: after a tamper no git runs in that process, enforced in `gitRaw`. Every worktree folder is removed with fs, and the worktree entry and branch are pruned by the next process.
- 2026-09-16: the snapshot watches git's configuration files and the worktree link, not the index, refs or logs. A session's own commit is caught as `history`, and a false halt from git's routine writes would stop the studio for nothing. The allowlist names what is refused; the snapshot catches a change the allowlist would allow, such as a new origin url.
- 2026-09-16: the allowlist lists what git writes and refuses everything else, rather than listing what is dangerous. A missed dangerous key is the failure that matters. The origin url is checked at startup against `GITHUB_REPO`; between startup and a card, the snapshot catches a change to it.
- 2026-09-16: an error before the smoke verdict is treated as a failed verification and rolled back, but only after each request has had its retries and the deploy wait its deadline. An unverified change is not left live, and a blip does not revert a good one. A change verified by a passing smoke is never rolled back for a database failure; it stays `gated`.
- 2026-09-16: ~~a merge request that throws is resolved from the pull request, and a pull request that cannot be read rejects the card `merge`.~~ Superseded by the review fixes (709748d): a lost merge is polled for 60 seconds and, still unknown, left `gated` as `merge_unknown` for recovery, which rejects it only once the pull request reads as not merged. No pull request is closed automatically (2026-09-16).
- 2026-09-16: the smoke worktree's git state is checked like a session's, since the bot runs merged agent code on the dispatcher's machine. A problem there also rolls the merge back.
- 2026-09-16: `GIT_NO_REPLACE_OBJECTS=1` and `core.commitGraph=false` join every git call, so neither a replacement object nor a commit-graph file a session wrote can change what git reports about history or trees. GitHub's compare and trees are checked too, since they describe what actually merges.
- 2026-09-16: git's environment is an allowlist rather than a strip list. It excludes the dispatcher's secrets as well as every inherited `GIT_*` variable. The Dockerfile's global git identity is no longer read; the dispatcher's only commit sets its author and committer in the environment.
- 2026-09-16: the merge lock covers the remote range check, the merge, verification and rollback, but not the gate wait, so a slow gate does not hold up another card's verification.
- 2026-09-16: recovery reads main's head before re-verifying and leaves the card to the board once main has moved. A smoke test against a newer build, or a revert that cannot land, would do harm or nothing.
- 2026-09-16: the `smoke_pass` event uses the existing `message` type, since `agent_event_type` has no free value and migrations are out of scope. The site reads event types only, never payloads.
- 2026-09-16: git's folders are named in its environment rather than checked after the fact, so a `commondir` file cannot redirect a dispatcher git call even between two checks. The layout check refuses the files that redirect or run anything anyway, at startup and at every check, so a planted file is reported and halts rather than lying inert. `info/grafts` is refused with them, though the review did not name it: git writes none, and it changes history as git reads it.
- 2026-09-16: every `branch.<name>.<key>` is allowed, `pushRemote` naming another remote included. The dispatcher names `origin` on every fetch and push, so git never reads a per-branch remote for its own calls, and the remote such a key names is still refused. A founder's checkout carries per-branch keys from gh and IDEs, and refusing them would stop attended runs for nothing.
- 2026-09-16: the `merge_unknown` marker is `failing_check` on the gated card as well as an event. `failing_check` belongs to the current claim, since gating clears it; an event from an earlier claim of the same card would mislead recovery.
