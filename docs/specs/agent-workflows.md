# Agent workflows: the Studio Head's ranking, the Game Designer's drafts graded by the Game Director, and a filter on public agent text

Status: agreed. Card: none. Owner: board.

Built on the merge of agent-system-core (approvals, dealing after the cooling window, the card text guard, `jobs` and `job_runs`, `enqueue_manual_job` with typed input, board-session waiting) and home-and-design (#64, the Card component the AI-agent label goes on). Every file it changes is kernel, except the card component that shows the label.

## Problem

The running roles have role specs and no job: the Studio Head ranks nothing, no one drafts cards, and the board files every card. One agent definition (the writer) exists, so a planner or a reviewer would run with bash, write and edit (R22). Agent-written text would reach /roadmap unfiltered (R20). The Biz Dev and Community prompts still define proposals as free-text cards that pass a board review (C2), with Reddit and X as sources that are neither free nor allowed (C3), and a proposal's free text would reach roles with write access, which the kernel forbids.

## Scope

In:
- Two jobs, both board-queued at /board and run attended on the founder's plan: `studio_ranking` (Rank now, the Studio Head) and `draft_card` (Draft a game card, the Game Designer, graded by the Game Director).
- Typed outputs: JSON schemas in `platform/agents/schemas/` for a card draft, a ranking and a draft verdict, validated with ajv before anything is written.
- `card_drafts` (private) and its RPCs; `apply_card_ranking`; the draft path added to agent-system-core's card text guard.
- The draft checks, run by the dispatcher before the Game Director sees a draft, and the rubric `platform/agents/rubrics/draft-game.md`.
- One public-text filter: the gate's own `banned-phrases.sh`, run by the dispatcher over every agent-written string a stranger can read, before the write.
- The prompts of the Studio Head, Game Designer and Game Director for these jobs; the Biz Dev and Community prompts rewritten without board review, Reddit or X.
- The board site's Rank now and Draft a game card buttons and each run's typed output; the site's AI-agent label.
- Docs: PLAN, SYSTEM.md, BACKLOG, ROADMAP.

Out, and what each waits on:
- Scheduled and event-triggered role jobs, unattended role jobs, the Managed Agents outcome grader and per-class Managed Agents definitions: an operations percentage (the bucket is removed until one exists), BACKLOG.
- The Studio Head picking cards to draft, and drafting a planned card: a planned seed-1 game card to draft (none exists; all planned cards are studio or board entries). "Studio Head drafts cards from the roadmap" stays in BACKLOG.
- Studio card drafting (Platform Builder proposals, Platform Director check lines): the studio lane's first built card, BACKLOG.
- Biz Dev and Community proposals: their BACKLOG entries, when a job runs either role.
- Visual review and mockups: `design-review.md`. The Janitor, Dependabot and the replay eval set: `agent-upkeep.md`. The weekly report and Draft to the floor: studio-reports. Drafting the launch card supply: launch-card-floor, with this pull request's `draft_card` job.
- A moderation API in front of the deny-list (R20): not adopted.

## Behaviour

**Modes and money.** Rank now and Draft a game card queue board-origin runs. They run attended, on the founder's plan through `claude -p`, only while a board member is signed in at /board, and wait otherwise (agent-system-core). This holds in either studio mode, so role jobs never spend studio money. Both jobs run while the studio is paused, since they spend no studio money, so the launch floor can be drafted before launch. Every model call writes a ledger row billed to the founder with its role.

**Sessions.** Each role job is one attended session holding exactly its role spec's tools: the Game Designer has Bash (its folder's package scripts), Read, Glob and Grep in a scratch worktree at origin/main; the Studio Head and the Game Director have at most Read, Glob and Grep. No session holds Write, Edit, a web tool or an MCP tool, and none names a fallback model. A session's final message must be exactly one object valid against its schema, or the run fails and writes nothing.

**Drafting.** The Game Designer drafts a new seed-1 game card: title, summary, intent, acceptance test with `check:` lines, lane, executor and one estimate, which is also the funding target (`launch-cards.md`'s five-times rule). A run's typed input is empty, or carries studio-reports' floor context. The dispatcher then checks the draft and refuses it, naming the failed check, when it fails its schema or the definition of ready, holds a `check:` line that does not parse or already holds on main, touches a kernel path or a folder other than seed-1, carries a deny-listed term in any text field, estimates above `card_max_usd`, or names no active, unpaused writer executor for seed-1. A refused draft goes back to the Game Designer as a new round.

**Grading.** A draft that passes every check goes to the Game Director in a separate session with `draft-game.md`: the seven pillars as PLAN Appendix A states them, the all-ages rating, one small change, a summary its check lines back and a plausible estimate. The verdict is approved, revise or flagged, with a reason code from a closed list. Revise starts another Designer round. Flagged, or a third round without approval, withdraws the draft with its reason codes.

**Approval.** The dispatcher approves from the Game Director's verdict. Approval inserts one seed-1 card (source agent, horizon next, stage proposed, proposer and drafter the Game Designer) with its target equal to the estimate and `opens_at` after the cooling window, and records the approval with the grader's session as its ref, which is never the maker's. The card stays off now until agent-system-core's tick deals it. A withdrawn draft writes no card. Agent-written card text changes only through the draft and board paths.

**Ranking.** The Studio Head sees typed card fields only. A community-sourced card contributes only its id, stage, horizon, bucket and funded amount. It answers with an order. `apply_card_ranking` writes `rank` only, on cards on now at proposed, designing or voted with no money on their bar or on hold, at most ten changes a run. It runs only when the board presses Rank now, so the board can set a rank afterwards. Each run writes one public event with the moved card ids and their positions.

**Public text.** Every agent-written string a stranger can read is scanned by the gate's `banned-phrases.sh` with every list, trademarks included, before it is written. A hit, or a scan that cannot run, refuses the write. The site shows 'Written by the <role>, an AI agent' beside agent-written card text.

**Biz Dev and Community.** Their prompts define no proposal that passes a board review, name no Reddit or X source, put nothing on the ledger page, and say they are not running yet. No job runs either role.

## Acceptance criteria

- [ ] Each role job session starts with exactly its role spec's tools (the Game Designer: Bash for seed-1's package scripts, Read, Glob and Grep, in a scratch worktree at origin/main; the Studio Head and the Game Director: at most Read, Glob and Grep), never Write, Edit, a web tool, an MCP tool or `--fallback-model`; a final message that is not exactly one schema-valid object, or a failed model call, fails the run with nothing written.
- [ ] The dispatcher refuses, by name and before any grading, a draft that fails its schema or the definition of ready, has a `check:` line that does not parse or already holds on main, touches a kernel path or a folder other than seed-1, estimates above `card_max_usd`, or names no active, unpaused writer executor; and every agent-written public string, draft text fields included, is refused on a `banned-phrases.sh` hit or when the scan cannot run (a test for each refusal).
- [ ] The Game Director grades in a separate session from the Game Designer using `draft-game.md`, which holds PLAN Appendix A's seven pillars verbatim and the all-ages rating; approved approves, revise starts a new round, and flagged or a third round without approval withdraws the draft with its reason codes, which come from the verdict schema's closed list.
- [ ] A draft is invisible to anon. Approval inserts one seed-1 card, source agent, horizon next, stage proposed, target equal to the estimate, whose content hash equals the graded draft's, and records the approval with a grader ref different from the maker's session; the card stays off now until dealt, and a payment naming it before then credits no bar; a withdrawal writes no card; the card text guard accepts agent text only from the board and draft paths; every draft and ranking RPC is service_role only.
- [ ] `apply_card_ranking` changes `rank` only, refuses an unknown id and any card that is off now, not at proposed, designing or voted, or has money on its bar or on hold; applies at most ten changes; writes one public event with ids and positions only; and the ranking and drafting inputs never contain a community-sourced card's title, summary or intent or any other public free text.
- [ ] Rank now and Draft a game card at /board queue board-origin runs that start only while a board member is signed in, in either studio mode, and wait otherwise; both jobs run while the studio is paused; every model call writes one ledger row billed to the founder with its role, a replayed request id writes nothing, and each run's row at /board shows its typed output.
- [ ] The site shows 'Written by the <role>, an AI agent' beside agent-written card text and nowhere else.
- [ ] The Biz Dev and Community prompts contain no board review, no Reddit and no X, and say they are not running yet; the Community prompt puts nothing on the ledger page.

## Verification

- `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify`
- `pnpm test:functions` (`platform/supabase/functions/_shared/agent_workflows_test.ts`)
- `pnpm --filter @backseat/dispatcher test` and `pnpm --filter @backseat/supabase test`
- `pnpm test:agents` and `pnpm test:docs`
- `E2E_PORT=4393 pnpm --filter @backseat/board e2e` and `E2E_PORT=4391 pnpm --filter @backseat/site e2e`
- The gate green at the pull request's head sha.
- Production, after the production steps: the pre-migration dump's size quoted; `anon-negative-test.ts` and `ledger-identity.ts` PASS, with `select public.ledger_identity()` read back.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 21 criteria became 8. Cut, because each shipped switched off with the operations bucket removed (role jobs have no money outside the founder's attended plan until a percentage exists): the four trust-class Managed Agents definitions and their containment and `managed:apply --class`, the Managed Agents outcome grader and its `REASON:` mapping, the grader's ledger row and list-cost reconciliation, recovery of orphaned job sessions, the Messages API adapter, the Monday and event ranking triggers, the Wednesday studio proposal, `job:enqueue`, and `operations-pct.ts`. Cut, because nothing uses them at launch: the Studio Head's picks, drafting a planned card (no planned seed-1 game card exists), the studio workflow and its check-lines schema and `draft-studio.md` rubric, and the `proposals` table, `record_proposal`, its schema and link allowlist (no job runs Biz Dev or Community). Replaced with the standard tool: the SQL port of the deny-list (`denylist_terms`, `denylist_meta`, `text_is_clean`, `replace_denylist`, `sync-denylist.ts`, the parity corpus and the files' hash check) by running the gate's own `banned-phrases.sh`, so one implementation exists and no parity can drift; `job:dry-run` by handler tests on a fake adapter and launch-card-floor's first real session; `reason-codes.json` by an enum in the verdict schema. Dropped as implementation detail: the `writer.yaml` rename, grader ordering tests and the `docs.test.mjs` criterion (`pnpm test:docs` still runs). Kept whole: every Problem outcome, separation of maker and grader, the card text guard, dealing after the cooling window, target equal to estimate, the ranking's money limits, RLS, ledger rows with idempotency, the dump before production writes, and the anon and ledger-identity checks.
- 2026-09-23: Role jobs are board-origin and attended in either studio mode, billed to the founder, so no role job spends studio or supporter money. Scheduled and unattended role jobs come with an operations percentage.
- 2026-09-23: The migration is `20260924400000_agent_workflows.sql`, after agent-system-core's.
- 2026-09-23: A draft carries one number, the estimate, and the target equals it, as `file_card` and `set_card_horizon` already do, so a card can neither park waterfall money above its cost nor fill before it covers it.
- 2026-09-23: Drafts live in `card_drafts` and reach a card only on approval, so no unapproved agent text sits on a public row.
- 2026-09-23: Claude Code has no custom tools or outcome grader, so an attended output is the session's final message validated against the schema, the grade is a separate session, and a revision is a fresh Designer session given the previous draft and the refusal or verdict. At most three rounds.
- 2026-09-23: The ranking touches `rank` only, on open cards on now with no money, at most ten changes a run (R17). Rank orders funded cards and money-logic's step 2, so a card holding money keeps its place. There is no rank pin (agent-system-core's trim): the ranking runs only when the board queues it, and the board can re-rank after.
- 2026-09-23: A community-sourced card reaches the ranking and the Game Designer as typed fields only; both roles are planners, and no agent with write access reads public free text.
- 2026-09-23: The public-text filter is the gate's `banned-phrases.sh`, run by the dispatcher before each write of agent text. Every such write goes through the dispatcher's service role, and the card text guard already confines agent card text to the draft and board paths, so a second copy of the filter in SQL adds a parity problem and no path.
- 2026-09-23: No moderation API (R20's extra step). The deny-list and the Director's all-ages criterion cover the same ground without a new processor on the Privacy page.
- 2026-09-23: No fallback model anywhere (L09); a refusal or model error fails the run.
- 2026-09-23, reconciled with the series: `draft_card` takes `{}` or studio-reports' `{floor, open_cards}` through `enqueue_manual_job(..., p_input)`; `{card_id}` is gone. studio-reports' `set_report_note` and design-review's `file_finding_card` call the dispatcher's `assertPublicTextClean` before their RPC instead of SQL `text_is_clean`. `studio_ranking` is manual only, so studio-reports' optional `report_note` on `ranking.schema.json` rides a Rank now run or its own job. design-review's visual grade runs through the attended CLI (the Director reads the screenshot files with Read), not a Messages API adapter. launch-card-floor no longer measures an operations percentage. There is no rank pin, and ledger rows carry the role and request id but no job run id (agent-system-core adds no `ledger.job_run_id`); launch-card-floor matches a session's rows by role and time. Both jobs are seeded to run while the studio is paused.
