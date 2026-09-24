# The local gate

Status: built. Card: none. Owner: board.

## Problem

GitHub Actions cannot start jobs. The account's included Actions minutes are used up for the month, account-wide, and its spending limit is $0, so every gate job is refused within seconds with a billing annotation and never runs a step. Under the kernel nothing reaches `main` without the gate, so nothing could merge.

## Scope

In: the gate run on the board's Mac for board pull requests (`scripts/local-gate.sh`), the rule for merging on it (PLAN.md §10 decision 44), the standing facts in `docs/ROADMAP.md`, and the board's item in `docs/BOARD-SETUP.md` for bringing Actions back.

Out: cards. The dispatcher merges a card only after a run of the gate workflow passed on the card's exact head, read through the Actions API (`gateStatus` in `platform/dispatcher/src/github.ts`), and this change does not touch it. The gate itself (`.github/workflows/gate.yml`, `platform/gate/`) is unchanged.

## Behaviour

The board decided on 23 September 2026: "just do everything locally for now". The gate workflow is disabled (`gh workflow disable gate`), so pushes stop showing red runs that never ran.

`bash scripts/local-gate.sh <pr> [port-base]`, run from main's checkout and never from a pull request's own copy (a pull request could change the script to pass itself), does what Actions does on a `pull_request` event:

- It tests the pull request's head merged into its base branch's current tip, in a fresh worktree, as Actions checks out `refs/pull/N/merge`.
- detect: the changed files, the folder and lane flags from `platform/gate/changed-paths.sh`, and the scans phase for each selected folder.
- seed-code, platform and build exactly as `gate.yml` selects them, on Node 22 like the runners (it refuses to run on any other major version). The build job runs in its own fresh worktree of the merge, installed with `--ignore-scripts`.
- The gate job's rule: every selected job passed. The first failing step stops it.
- On a pass it posts a `local-gate` commit status (success) on the head and prints `LOCAL GATE PASS pr=<n> head=<sha> base=<sha> merge=<sha> <flags> log=<path>`; on a failure, `LOCAL GATE FAIL pr=<n> head=<sha> base=<sha>: <step> log=<path>` and a failure status. Logs and work folders live under `${LOCAL_GATE_DIR:-$HOME/.local-gate}`. The site e2e uses the port base (default 4380) and the board e2e the next port.
- It refuses a `card/` branch.

The merge rule for board pull requests: merge only with a PASS line for the exact head whose `base=` equals `origin/main` at merge time, by `gh pr merge <n> --squash --match-head-commit <head>`, with the PASS line quoted in the merge body. If main moved, run the gate again. One gate runs at a time on the Mac, so ships are serial. The whole run takes 15 to 40 minutes.

What it does not give:

- A clean GitHub runner. It runs on the board's Mac, with the Mac's tools on the path and other work running beside it.
- Cards. A card branch is refused, and the dispatcher still waits for a passing run of the gate workflow, which cannot start, so no card merges until Actions is back. It fails closed. The studio is paused anyway (awaiting Console credit).

How to go back: the included minutes reset each month; or the board adds an Actions budget (a spend, against the rule that everything the studio runs on is free, PLAN.md §10 decision 35); or the board makes the repository public, which GitHub does not bill for standard runners. Then `gh workflow enable gate`, and board pull requests merge on the Actions gate again (`docs/BOARD-SETUP.md`, GitHub Actions minutes).

## Acceptance criteria

- [x] `scripts/local-gate.sh` needs no path outside the repository: it finds the repository from its own location, and keeps logs and work folders under `${LOCAL_GATE_DIR:-$HOME/.local-gate}`.
- [x] Its header says it is run from main's checkout, never from a pull request's own copy.
- [x] It refuses a `card/` branch and a Node other than 22.
- [x] PLAN.md §10 decision 44 records the board's decision and the merge rule; ROADMAP's standing facts "Merging" and "Actions minutes" say how merging works now and how to switch back; BOARD-SETUP has the board's item "GitHub Actions minutes".
- [ ] This pull request merged on its own local gate PASS line for its exact head, quoted in the merge body.

## Verification

- `pnpm verify`
- `local-gate.sh <this pr> 4378`, run from the tested copy this script was made from (kept outside the repository), since main does not carry `scripts/local-gate.sh` until this merges: a PASS line for this pull request's exact head, with `base=` equal to `origin/main` at merge time, quoted in the merge body and then here.

## Evidence

- `bash -n scripts/local-gate.sh` and `shellcheck -S warning scripts/local-gate.sh` exit 0. Against the copy it was made from, the only changes are the header, the repository found from the script's own location, the log folder under `${LOCAL_GATE_DIR:-$HOME/.local-gate}`, the commit status posted to `repos/{owner}/{repo}` (the repository `gh` reads from the checkout), and the Node 22 check.
- `pnpm verify` at 3652de5 (the branch before this evidence), exit 0: seed-1 77, dispatcher 619, supabase 286, site 426 and board 71 tests passed; "PASS: gate tests passed=508"; agents 117 and ops 124 pass; "GATE PASS folder=seed-1 lane=code" and "GATE PASS folder=platform lane=code"; "PASS: secret-scan files=568"; docs 15 of 15; rename 8 of 8 and "tier 1 carries the old name nowhere".
- The PASS line for this pull request's head is quoted in its squash merge's body; the next pull request that touches the specs quotes it here and moves this spec to done.

## Decisions

- 23 September 2026: the board: "just do everything locally for now". Board pull requests merge on the local gate; cards wait for Actions. The dispatcher's check stays as it is, so the change cannot let a card through.
- 23 September 2026: the script is a copy of the one that already passed #79 (`LOCAL GATE PASS pr=79 head=d692c031b2b890c03c639ef378e88e541dbf3a79 base=ecdfba6ab6f9420dcaf8aa26fe662739f9c36b0b`), made path-free and otherwise unchanged, rather than a rewrite: it is the tested one.
- 23 September 2026: it posts a commit status named `local-gate`, not `gate`, so no reader mistakes it for the Actions gate. The dispatcher reads only the gate workflow's runs through the Actions API, which only Actions creates, so no commit status of any name can let a card merge.
- 23 September 2026: the spec lands at built. A PASS line names the head it tested, so the spec cannot quote its own pull request's line; the merge body carries it, and the next specs pull request records it here.
