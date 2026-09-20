# Docs truth pass: a newcomer's README, a current plan and roadmap, and a drift guard

Status: done. Card: none. Owner: board.

## Problem

The docs had drifted from the code and from each other. The README was three lines. The root CLAUDE.md told every session to read all of PLAN.md and named a `host` folder that does not exist. PLAN.md listed six split options where the webhook accepts eleven, said branch protection guards `main` when the repository has none, described a $50 gross daily limit where the code limits agent credit, listed environment variables no code reads, and used an open-source response line while the repository is private. ROADMAP.md mixed done and built specs in one table and pinned a sha that goes stale on every merge. Several specs carried stale statuses or text. Nothing caught any of this.

## Scope

In:
- `README.md`: a newcomer's guide.
- `CLAUDE.md`: the title, a reading order and the folder list.
- `docs/PLAN.md` version 3.4: factual amendments marked in place, and §10 defaults 17–20.
- `docs/ROADMAP.md`: phase rows, live criterion 2, the Done table split in three, and the standing facts.
- Spec text: `launch-pages.md`, `live-cut.md`, `stripe-late-fee.md`, `next-cards.md`, `stale-tab.md`, `vps.md`, `working-method.md`, `launch-hardening.md`, `announcement.md`, `site-layout.md`, and a new `panel-gap.md` for PR 30.
- `seed-1/CLAUDE.md`, `.env.example`, `platform/ops/README.md` and `platform/agents/prompts/platform-builder.md`.
- `docs/docs.test.mjs` and the root `test:docs` script, appended to `verify`.

Out: any code change, any change of intent or strategy in PLAN.md, the specs of the other open pull requests, and production.

## Behaviour

- A newcomer can read the README and know what runs where, how a card ships, what to install, what `pnpm verify` runs and what the terms mean.
- Every fact added is checked against the code, git history or a spec, and names its source where it stands.
- `pnpm test:docs` fails when a spec has no valid Status line, when a ROADMAP row names a spec path at a status other than the spec's own or names a path that does not exist, when the seed-1 protected paths differ from the kernel list, or when README.md, CLAUDE.md or PLAN.md names one of the founder's other companies, or names Clayhouse outside the "Created by Clayhouse" credit.

## Acceptance criteria

- [x] `README.md` covers what the studio is, where each piece runs, the repository map, the card lifecycle as `pipeline.ts` runs it, prerequisites, commands, how work is done, the reading order and the glossary.
- [x] `CLAUDE.md` is titled Peanut Gallery, gives the reading order, lists `platform/` as site, dispatcher, gate, supabase, agents and ops, and keeps the kernel, footer-credit and spec-driven paragraphs.
- [x] `docs/PLAN.md` is version 3.4 with a dated amendment list, and every amendment is marked "(amended 16 September 2026)" or sits in §10.
- [x] `docs/ROADMAP.md` has no sha in its last-updated line, separate Done, Built and Agreed tables, and the containment prerequisite in live criterion 2 and phase 5.
- [x] Every spec status matches its ROADMAP row, and `panel-gap.md` exists with status done.
- [x] `pnpm test:docs` fails on a drift it guards and passes on this branch.
- [x] `pnpm test:agents` and `pnpm verify` exit 0.

## Verification

- `pnpm test:docs`, before the ROADMAP update (failing on the drift) and after (passing).
- `pnpm test:agents`.
- `pnpm verify` at the repository root, exit 0.
- `grep -rn -i "backseat" README.md CLAUDE.md` shows Backseat only as the working name and the package prefix.

## Production steps (need the board's allow)

None. This change touches only docs, one prompt, `.env.example` and a test script.

## Evidence

2026-09-16:
- **The drift guard, first run.** `docs/docs.test.mjs` was written before any doc change and run against `main` at 4f60c7c: 4 passed, 0 failed. The tree was consistent on the four checks (for example, `live-cut.md` said agreed and so did its ROADMAP row), so the first run caught nothing. The statuses were then corrected in the specs before the ROADMAP, and the guard failed on the drift that opened: `✖ every ROADMAP row that names a spec path shows the status the spec declares` with `AssertionError [ERR_ASSERTION]: ROADMAP shows specs/next-cards.md as "done", the spec says "built": | \`specs/next-cards.md\` | done |`.
- **The company-name check.** Its first form matched the plain name, and `pnpm verify` failed at the gate: `GATE FAIL step=banned-phrases detail=FAIL: banned-phrases hits=1 first=docs/docs.test.mjs:100 list=hashed term=sha256:5f71ec6a9bbf`. The check now compares sha256 digests. Mutations, reverted after each run: an address with the name appended to README.md failed the check, and the three-word spelling with a double space and a tab appended to CLAUDE.md failed with `CLAUDE.md:17 names one of the founder's other companies`. A backticked `render/main.ts` added to the seed-1 protected paths failed `the protected paths in seed-1/CLAUDE.md equal the seed-1 entries of the kernel list`.
- **`pnpm test:docs`, after:** `ℹ tests 4`, `ℹ pass 4`, `ℹ fail 0`.
- **`pnpm test:agents`:** `ℹ tests 64`, `ℹ pass 64`, `ℹ fail 0`, with the footer exception in `platform-builder.md`.
- **`pnpm verify`:** exit 0. Supabase 122 passed, site 123, seed-1 77, dispatcher 207, `PASS: gate tests passed=157`, agents 64, ops 20 passed and 1 skipped, Deno `58 passed (33 steps) | 0 failed`, `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=296`, docs 4.
- **`grep -rn -i "backseat" README.md CLAUDE.md`:** README.md line 5 ("Backseat is the working name. The package names (`@backseat/*`) and parts of `docs/PLAN.md` still use it.") and CLAUDE.md line 3 (the working name and the `@backseat/*` package names); every other hit is a `pnpm --filter @backseat/...` command.
- **Sources for the facts added.** The split: `SPLIT_MAP` in `split.ts`. The merge rule: `gateStatus`, `waitForGate` and `mergePullRequest` in `platform/dispatcher/src/github.ts`, and `gh api repos/AlreadyKyle/peanutgallery/branches/main/protection` returning HTTP 403 "Upgrade to GitHub Pro or make this repository public to enable this feature". The lifecycle: `pipeline.ts`, `tick.ts`, `worktree.ts` and `smoke.ts`. The environment: `config.ts`, `dispatcher-env.mjs`, `platform/supabase/lib/*.ts`, the scripts and the function's `index.ts`. The gate: the header of `ship-gate.sh` and `.github/workflows/gate.yml`. The webhook events: `webhook_events.ts`. The merges: `gh pr view` for PRs 21 (3a08226), 22 (49d6e33), 25 (89cdbe9) and 30 (4f60c7c). The containment decision (PLAN.md §10 default 20): the board's instruction of 16 September 2026 for this pass; its spec is not on `main` yet.


2026-09-20, status corrected from agreed to done. The drift guard merged as 267c7fe (PR 36) and its
Production steps section is "None". `pnpm test:docs` on this branch: `ℹ tests 4`, `ℹ pass 4`,
`ℹ fail 0`.

This pass also used the guard as intended: the statuses of ten specs were corrected in the spec files
first, and `docs/ROADMAP.md` was brought into line in the same pull request.

## Decisions

- 2026-09-16: specs in open pull requests are listed in ROADMAP.md by a link to the pull request, not a file path, so the guard compares only files on the branch and fails on a path that does not exist.
- 2026-09-16: the company-name check stays narrow: two spellings of the founder's other company, case-insensitive, and Clayhouse only on a line with the quoted "Created by Clayhouse" credit. The two spellings are stored as sha256 digests and matched against every window of their length, because the gate's banned-phrases scan reads `docs/` and refuses the plain name (`platform/gate/denylist/hashed.txt`).
- 2026-09-16: `next-cards.md` and `stripe-late-fee.md` move from done to built, because each has a Verification line with no quoted output. `live-cut.md` moves from agreed to built, because it merged as ea52bb2 with every test-provable criterion ticked.
