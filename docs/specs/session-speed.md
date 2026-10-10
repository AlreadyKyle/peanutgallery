# Session speed and cloud sessions

Status: agreed. Card: none. Owner: board.

## Problem

A one-line fix took 30 to 60 minutes of fixed cost, and a session that shipped ten pull requests took seven hours. Measured on 10 October 2026: `pnpm verify` took 383 s on an idle Mac, running ten independent checks one after another; its gate dry-run also ran the gated packages' tests a second time. Implementer agents spent half or more of their time in verify, e2e and foreground polling of Actions. Every change, however small, also carried a spec file and up to three reviewers. The board wants code sessions to move to Claude Code cloud sessions, which have no `.env`, no files outside the repository, and a GitHub proxy that refuses the GraphQL `gh pr` commands.

## Scope

In: the root verify scripts, a changed-packages check, the CLAUDE.md working rules (when a spec is needed, reviewer count, background waits, the merge command, the post-merge record), and a SessionStart hook that sets up a cloud session.
Out: the gate itself (`platform/gate/`, `.github/workflows/gate.yml`), the kernel, the dispatcher, and production operations, which stay in local sessions because they read secrets.

## Behaviour

`pnpm verify` runs its independent checks at once, and each check once. `pnpm verify:changed` checks only the packages a branch touches, for use while iterating. In a cloud session, the repository installs its own packages, Deno and Playwright's Chromium at start. On the Mac, the hook does nothing. Bug fixes need no spec file. Merges use the REST form of the merge call, and the post-merge record is a comment on the merged pull request.

## Acceptance criteria

- [x] `pnpm verify` exits 0, runs its checks at once and no package's tests twice; its time is quoted against the 383 s baseline.
- [x] `pnpm verify:changed` on a branch that touches only the dispatcher runs the dispatcher's tests and no other package's.
- [x] `bash scripts/cloud-setup.sh` exits 0 at once when `CLAUDE_CODE_REMOTE` is not `true`.
- [x] CLAUDE.md states when a spec is needed, the reviewer counts, the background-wait rule, the REST merge command, the post-merge comment, and that secret-reading work stays local.
- [ ] A cloud session on main installs dependencies through the hook and passes `pnpm verify`.

## Verification

- `pnpm verify`, timed
- `pnpm verify:changed` on a dispatcher-only branch
- `env -u CLAUDE_CODE_REMOTE bash scripts/cloud-setup.sh; echo $?`
- `pnpm test:docs` and `pnpm secret-scan`
- This pull request merged with the REST merge command, and its live-check line posted as a comment
- A cloud session on main: the hook's install, then `pnpm verify`

## Evidence

- Before, on the idle Mac, stage by stage: typecheck 6 s, test 98 s, agents 0 s, ops 37 s, functions 59 s, gate dry-run 169 s, secret scan 10 s, docs 2 s, rename 2 s: 383 s. Dropping only the second test run, still in sequence, took 403 s, because `pnpm -r test` already ran the packages in parallel. Running the checks at once: `VERIFY PASS 173s` (gate-platform 173 s is the longest).
- `pnpm verify:changed HEAD` with one dispatcher file changed: `pnpm -r --filter "...[HEAD]"` selected `platform/dispatcher` only, `Test Files  53 passed (53)`, `verify:changed PASS`, 76 s. With nothing changed: `No projects matched the filters`, exit 0.

- `env -u CLAUDE_CODE_REMOTE bash scripts/cloud-setup.sh`: exit 0 in 0.003 s. `pnpm test:docs`: `pass 22`, `fail 0`. `pnpm secret-scan`: `PASS: secret-scan files=776`.

## Decisions

- 2026-10-10: the board moves code sessions to the cloud and drops the spec requirement for bug fixes. Fixed per-change cost, not the machine, was what made simple fixes take all day.
