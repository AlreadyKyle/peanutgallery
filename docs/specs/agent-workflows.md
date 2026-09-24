# Agent workflows: the Studio Head's ranking, the Game Designer's drafts graded by the Game Director, and a filter on public agent text

Status: built. Card: none. Owner: board.

Built on the merge of agent-system-core (approvals, dealing after the cooling window, the card text guard, `jobs` and `job_runs`, `enqueue_manual_job` with typed input, board-session waiting) and home-and-design (#64, the Card component the AI-agent label goes on). Most files it changes are kernel. The ones that are not are the public site's: the card face and /roadmap's rows that show the AI-agent label, home's live-updates row, the copy and styles they use, `platform/site/DESIGN.md`, and their unit and e2e tests.

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

**Sessions.** Each role job is one attended session holding exactly its role spec's tools: the Game Designer has Bash (its folder's package scripts), Read, Glob and Grep in a scratch worktree at origin/main; the Studio Head and the Game Director have at most Read, Glob and Grep. In an unattended process a session holds no Bash, so no agent-written code runs on the dispatcher's host (PLAN §6, decision 25), and its Read, Glob and Grep are denied the code clone's `.env` and dispatcher code, the host's env folder, the dumps and every `.env` file under the home folder. No session holds Write, Edit, a web tool or an MCP tool, and none names a fallback model. A session's final message must be exactly one object valid against its schema, or the run fails and writes nothing.

**Drafting.** The Game Designer drafts a new seed-1 game card: title, summary, intent, acceptance test with `check:` lines, lane, executor and one estimate, which is also the funding target (`launch-cards.md`'s five-times rule). A run's typed input is empty, or carries studio-reports' floor context. The dispatcher then checks the draft and refuses it, naming the failed check, when it fails its schema or the definition of ready, holds a `check:` line that does not parse or already holds on main, touches a kernel path or a folder other than seed-1, carries a deny-listed term in any text field, estimates above `card_max_usd`, or names no active, unpaused writer executor for seed-1. A refused draft goes back to the Game Designer as a new round.

**Grading.** A draft that passes every check goes to the Game Director in a separate session with `draft-game.md`: the seven pillars as PLAN Appendix A states them, the all-ages rating, one small change, a summary its check lines back and a plausible estimate. The verdict is approved, revise or flagged, with a reason code from a closed list. Revise starts another Designer round. Flagged, or a third round without approval, withdraws the draft with its reason codes.

**Approval.** The dispatcher approves from the Game Director's verdict. Approval inserts one seed-1 card (source agent, horizon next, stage proposed, proposer and drafter the Game Designer) with its target equal to the estimate and `opens_at` after the cooling window, and records the approval with the grader's session as its ref, which is never the maker's. The card stays off now until agent-system-core's tick deals it. A withdrawn draft writes no card. Agent-written card text changes only through the draft and board paths.

**Ranking.** The Studio Head sees typed card fields only. A community-sourced card contributes only its id, stage, horizon, bucket and funded amount. It answers with an order of the rankable cards, which the dispatcher reads from the same test the ranking refuses on. `apply_card_ranking` writes `rank` only, on cards on now at proposed, designing or voted that step 2 funds (`money.card_takes_money`, so never a vetoed or hidden card) with no money on their bar or on hold, at most ten changes a run. The named cards trade the ranks they already hold, so every other card, a card holding money included, keeps its place in the waterfall's line. It runs only when the board presses Rank now, so the board can set a rank afterwards. Each run writes one event, type `message` with step `ranked`, which the public event list reads as "Studio Head ranked the cards open for funding"; the moved card ids and their positions are in its payload, which the public view leaves out, and on the board's run output, where each moved card is named by its title.

**Public text.** Every agent-written string a stranger can read is scanned by the gate's `banned-phrases.sh` with every list, trademarks included, and then by its `secret-scan.sh`, before it is written. A hit, or a scan that cannot run, refuses the write. The site shows 'Written by the <role>, an AI agent' beside agent-written card text.

**Biz Dev and Community.** Their prompts define no proposal that passes a board review, name no Reddit or X source, put nothing on the ledger page, and say they are not running yet. No job runs either role.

## Acceptance criteria

- [x] Each role job session starts with exactly its role spec's tools (the Game Designer: Bash for seed-1's package scripts, Read, Glob and Grep, in a scratch worktree at origin/main; the Studio Head and the Game Director: at most Read, Glob and Grep), never Write, Edit, a web tool, an MCP tool or `--fallback-model`, and in an unattended process never Bash, its Read, Glob and Grep denied the code clone's `.env`, the host's env folder and every `.env` file under the home folder; a final message that is not exactly one schema-valid object, or a failed model call, fails the run with nothing written.
- [x] The dispatcher refuses, by name and before any grading, a draft that fails its schema or the definition of ready, has a `check:` line that does not parse or already holds on main, touches a kernel path or a folder other than seed-1, estimates above `card_max_usd`, or names no active, unpaused writer executor; and every agent-written public string, draft text fields included, is refused on a `banned-phrases.sh` or `secret-scan.sh` hit or when either scan cannot run (a test for each refusal).
- [x] The Game Director grades in a separate session from the Game Designer using `draft-game.md`, which holds PLAN Appendix A's seven pillars verbatim and the all-ages rating; approved approves, revise starts a new round, and flagged or a third round without approval withdraws the draft with its reason codes, which come from the verdict schema's closed list.
- [x] A draft is invisible to anon. Approval inserts one seed-1 card, source agent, horizon next, stage proposed, target equal to the estimate, whose content hash equals the graded draft's, and records the approval with a grader ref different from the maker's session; the card stays off now until dealt, and a payment naming it before then credits no bar; a withdrawal writes no card; the card text guard accepts agent text only from the board and draft paths; every draft and ranking RPC is service_role only.
- [x] `apply_card_ranking` changes `rank` only, refuses an unknown id and any card that is off now, not at proposed, designing or voted, outside step 2's line (a vetoed card on now included), or has money on its bar or on hold; applies at most ten changes; writes one event whose public line says the Studio Head ranked the cards open for funding, with the ids and positions in its private payload only; and the ranking and drafting inputs never contain a community-sourced card's title, summary or intent or any other public free text.
- [x] Rank now and Draft a game card at /board queue board-origin runs that start only while a board member is signed in, in either studio mode, and wait otherwise; both jobs run while the studio is paused; every model call writes one ledger row billed to the founder with its role, a replayed request id writes nothing, and each run's row at /board shows its typed output.
- [x] The site shows 'Written by the <role>, an AI agent' beside agent-written card text and nowhere else, and a card with no byline keeps 16px from its summary to its bottom block at 375, 768 and 1440; /team does not say the Studio Head, the Game Designer or the Game Director has no job.
- [x] The Biz Dev and Community prompts contain no board review, no Reddit and no X, and say they are not running yet; the Community prompt puts nothing on the ledger page.

## Verification

- `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify`
- `pnpm test:functions` (`platform/supabase/functions/_shared/agent_workflows_test.ts`)
- `pnpm --filter @backseat/dispatcher test` and `pnpm --filter @backseat/supabase test`
- `pnpm test:agents` and `pnpm test:docs`
- `BOARD_E2E_PORT=4393 pnpm --filter @backseat/board e2e` and `E2E_PORT=4391 pnpm --filter @backseat/site e2e` (the board's e2e reads `BOARD_E2E_PORT`)
- The gate green at the pull request's head sha.
- Production, after the production steps: the pre-migration dump's size quoted; `anon-negative-test.ts` and `ledger-identity.ts` PASS, with `select public.ledger_identity()` read back; the two jobs read back from `public.jobs`; the Game Designer's role row read back with its four tools and write access after the re-seed; `node platform/site/scripts/live-check.mjs` PASS.

## Production steps

The ship stage runs these; none is run by the build.

1. With the studio paused and no card building, read back `select paused, agent_mode, dispatcher_seen_at from public.studio_state`.
2. Dump before the migration: `pg_dump "$BACKUP_DB_URL" --format=custom` to `~/peanutgallery-dumps/pre-agent-workflows-<UTC stamp>.dump`, `chmod 600`, quote the size and `pg_restore --list`.
3. Apply `20260924400000_agent_workflows.sql` through the Management API query endpoint, one request, in one transaction; read back `card_drafts`, the eight functions and the two jobs.
4. `anon-negative-test.ts` and `ledger-identity.ts` PASS, with `select public.ledger_identity()` read back.
5. After the merge, re-seed the roles (`pnpm --filter @backseat/supabase seed`) so the prompts, the Game Designer's tools and its write access are current, and read them back; run `file-backlog` (dry run, then `--apply`) for the rewritten Community entry.
6. If the Mac dispatcher is installed, redeploy it on the merge commit (`platform/ops/mac/deploy.sh`) and confirm the job registry lists both handlers; it is not installed yet (the board's step 3), and installing it runs main.
7. After both Netlify sites publish the merge, `node platform/site/scripts/live-check.mjs` PASS; update the private SYSTEM.md page.

Board items (listed; none blocks this pull request): be signed in at /board for launch-card-floor's drafting session, the first real Draft a game card run, on your Max plan (`docs/BOARD-SETUP.md`); installing the Mac dispatcher (step 6) is the board's step 3.

## Evidence

Built on `launch/agent-workflows` from `launch/agent-system-core` at 25dd35f (stacked on agent-system-core, which had not merged), then merged with agent-system-core's review fixes, which carry main through the gap audit (#76). The production lines of Verification and the production steps are the ship stage's and are not run here; the gate result at the pull request's head sha is quoted in the pull request.

After the review fixes, `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify` exits 0 (`EXIT 0`), run with `npm_config_workspace_concurrency=1` so the packages' tests run one at a time while other agents load the machine. Its package lines:

```
platform/gate test: PASS: gate tests passed=508
platform/board test:       Tests  93 passed (93)
platform/site test:       Tests  431 passed (431)
platform/supabase test:       Tests  304 passed (304)
seed-1 test:       Tests  77 passed (77)
platform/dispatcher test:       Tests  679 passed (679)
ok | 115 passed (157 steps) | 0 failed
GATE PASS folder=seed-1 lane=code
GATE PASS folder=platform lane=code
PASS: secret-scan files=584
```

`pnpm test:functions`, `platform/supabase/functions/_shared/agent_workflows_test.ts` (criteria 4 and 5's SQL half, and the jobs' seed for 6):

```
a draft is private and every draft and ranking function is the service role's ...
  anon and authenticated read no draft, a board member included; the service role reads it ... ok
  anon and authenticated may call none of the new functions ... ok
record_card_draft hashes the card approval would insert and refuses a draft that is not one card ...
  the hash is the would-be card's content hash, the target being the estimate ... ok
  each malformed draft is refused with its own message ... ok
approval inserts one seed-1 card from the graded draft, which takes no money until it is dealt ...
  the card: source agent, horizon next, stage proposed, target equal to the estimate, the Designer as proposer, drafter and check author ... ok
  the approval names the grader's session, not the maker's, and the draft is approved with its card ... ok
  off now until dealt: a payment naming it credits no bar; the tick deals it and then it takes money ... ok
  opens_at is the approval time plus the cooling window ... ok
  approval is refused, writing no card, when the grader ref is the maker's, the approver made it, or the card is not ready ... ok
a withdrawal writes no card and ends the draft ... ok
the card text guard accepts agent text from the board and draft paths only ... ok
apply_card_ranking writes rank only, on open cards on now with no money, at most ten a run ...
  each refusal names the card, and a refused ranking writes nothing; rankable_cards lists the cards it accepts ... ok
  the reverse of twelve applies the longest start of the order that fits in ten changes, and leaves no two cards on now one rank ... ok
  an order the cards already stand in is not a change ... ok
a ranking trades only the places the named cards hold, so a card holding money keeps its place in line ...
  ranked cards: the unchanged order moves nothing, and a card holding money stays first ... ok
  sparse ranks: the named cards keep the ranks they hold, and the card holding money between them keeps its own ... ok
  unranked cards: they go after every rank on now, only where they already are, and the next payment still reaches the card holding money ... ok
  an unranked card holding money: no card behind it passes it, and a card ahead of it can still move ... ok
  a rank another card in line shares is not traded, a funded card with room included ... ok
the two jobs are seeded manual, model-calling and running while the studio is paused, linked to their roles ... ok
ok | 8 passed (17 steps) | 0 failed
```

The ranking steps read `money.funding_order()` after each ranking. With `apply_card_ranking` put back to position n gets rank n (the new helpers kept), 6 of those steps fail; the reverse of twelve, for one, funded Open 0 first.

`pnpm --filter @backseat/dispatcher test`, the new files (criteria 1, 2, 3, 5 and 6):

```
 ✓ test/draft-checks.test.ts > checkDraft > passes a draft that meets every check, scanning every text field once
 ✓ test/draft-checks.test.ts > checkDraft > refuses a draft that is not ready: no text, no check: line
 ✓ test/draft-checks.test.ts > checkDraft > refuses a check: line that does not parse
 ✓ test/draft-checks.test.ts > checkDraft > refuses a check that names a kernel path, a folder other than seed-1, or a file outside the lane
 ✓ test/draft-checks.test.ts > checkDraft > refuses a check line that already holds on main
 ✓ test/draft-checks.test.ts > checkDraft > refuses a deny-list hit in any text field, and a scan that cannot run
 ✓ test/draft-checks.test.ts > checkDraft > refuses an estimate above card_max_usd
 ✓ test/draft-checks.test.ts > checkDraft > refuses an executor that is not an active, unpaused writer for seed-1
 ✓ test/typed-output.test.ts > TypedOutput > loads the three schemas from platform/agents/schemas and shows each as the prompt names it
 ✓ test/typed-output.test.ts > TypedOutput > accepts one valid object, with white space or one fenced block around it
 ✓ test/typed-output.test.ts > TypedOutput > refuses no message, prose, two objects, an array and a bare value
 ✓ test/typed-output.test.ts > TypedOutput > refuses an object the schema does not allow, naming the schema
 ✓ test/role-session.test.ts > the role session spec > holds exactly the role spec tools, with Bash as seed-1 package scripts, and no argument names Write, Edit, a web tool, an MCP tool or a fallback model
 ✓ test/role-session.test.ts > the role session spec > refuses a role that holds Write, Edit, a web tool or an MCP tool, before any session starts
 ✓ test/role-session.test.ts > runRoleSession > answers with the typed object, the session id as its ref, and one founder ledger row per turn with the role
 ✓ test/role-session.test.ts > runRoleSession > fails, marked as invalid output, when the final message is not exactly one schema-valid object
 ✓ test/role-session.test.ts > runRoleSession > fails a failed model call, not as invalid output, and still meters what it spent
 ✓ test/role-session.test.ts > runRoleSession > stops a session whose init line shows a write tool or an API key
 ✓ test/role-session.test.ts > runRoleSession > stops when the board session lapses, and runs only attended
 ✓ test/job-handlers.test.ts > studio_ranking > shows typed fields only, a community card as id, stage, horizon, bucket and funded, and applies the order
 ✓ test/job-handlers.test.ts > studio_ranking > never offers a card whose only money is a payment on hold, and the ranking of the others applies
 ✓ test/job-handlers.test.ts > studio_ranking > fails, writing no rank, when the answer names a card that holds money or is off now, or the session fails
 ✓ test/job-handlers.test.ts > draft_card > (the nine draft_card tests, unchanged)
 ✓ test/job-handlers.test.ts > the two jobs on the queue > registers both handlers
 ✓ test/job-handlers.test.ts > the two jobs on the queue > runs a board-origin Rank now in attended mode while the studio is paused and a board member is signed in, and waits otherwise
 ✓ test/job-handlers.test.ts > the two jobs on the queue > runs a board-origin Rank now in unattended mode while the studio is paused and a board member is signed in, and waits otherwise
 ✓ test/db.test.ts > createSupabaseDb queries > reads the rankable cards from rankable_cards, the test apply_card_ranking refuses on, and refuses an answer that is not a list
 ✓ test/public-text.test.ts > scanPublicText > (the four tests, unchanged)
```

With the handler's old `funded_usd === 0` test put back, the three studio_ranking tests fail: the held card is offered as rankable.

`pnpm --filter @backseat/supabase test` (the static migration checks and the anon probes' list, criterion 4): `Tests  304 passed (304)`. `pnpm test:agents` (criteria 3 and 8): `ℹ tests 124`, `ℹ pass 124`, `ℹ fail 0`. `pnpm test:docs`: `ℹ tests 18`, `ℹ pass 18`, `ℹ fail 0`.

`BOARD_E2E_PORT=4463 pnpm --filter @backseat/board e2e` (criterion 6, Rank now and Draft a game card queue `{}` and each run shows its typed output):

```
  ✓  5 e2e/board.spec.ts:334:1 › at the second factor the board sees and vetoes an undealt agent card, pauses a role from the keyboard, and reads the jobs and the cooling window, under the enforced policy
  7 passed (4.6s)
```

`E2E_PORT=4461 pnpm --filter @backseat/site e2e` (criterion 7, `e2e/agent-card.spec.ts` at 375, 768 and 1440 px, and the layout audit with an agent card): `157 passed (3.2m)`, `5 skipped`, among them:

```
  ✓ e2e/agent-card.spec.ts › at 375px › the drafted card on the fund grid says the Game Designer wrote it, and no other card says so
  ✓ e2e/agent-card.spec.ts › at 375px › /roadmap shows the line on the waiting agent card only
  ✓ e2e/agent-card.spec.ts › at 1440px › the drafted card on the fund grid says the Game Designer wrote it, and no other card says so
  ✓ e2e/agent-card.spec.ts › at 1440px › /roadmap shows the line on the waiting agent card only
  ✓ e2e/agent-card.spec.ts › at 768px the byline ends above the bottom block, and the bars in its row line up
  ✓ e2e/agent-card.spec.ts › at 1440px the byline ends above the bottom block, and the bars in its row line up
  ✓ e2e/layout-balance.spec.ts › layout balance, home with an open card an agent drafted › leaves no dead space at 768px
  ✓ e2e/layout-balance.spec.ts › layout balance, home with an open card an agent drafted › leaves no dead space at 1024px
  ✓ e2e/layout-balance.spec.ts › layout balance, home with an open card an agent drafted › leaves no dead space at 1440px
```

With the card subgrid put back to four tracks, all five byline and layout tests at 768, 1024 and 1440 fail: the byline was drawn through the funding bar. (The third review's fix keeps four tracks with the byline inside the summary's block; see below.)

After the third review's fixes (Decisions, 2026-09-23 third review fixes), `pnpm verify` exits 0 (`EXIT=0`, run with `npm_config_workspace_concurrency=1`):

```
platform/site test:       Tests  433 passed (433)
platform/board test:       Tests  93 passed (93)
platform/supabase test:       Tests  304 passed (304)
seed-1 test:       Tests  77 passed (77)
platform/dispatcher test:       Tests  683 passed (683)
platform/gate test: PASS: gate tests passed=508
GATE PASS folder=seed-1 lane=code
GATE PASS folder=platform lane=code
PASS: secret-scan files=584
```

The new dispatcher tests (`vitest run` on the four changed files, `Tests  56 passed (56)`):

```
 ✓ test/role-session.test.ts > the role session spec > in an unattended process holds no Bash, so the seed scripts never run on the host and nothing is installed
 ✓ test/job-handlers.test.ts > draft_card > gives the Game Designer no Bash in an unattended process, so no seed-1 code runs on the host, and still approves
 ✓ test/attended.test.ts > the attended sandbox > denies the Read, Glob and Grep tools the code clone, the host env folder, the dumps and every .env file under the home folder
 ✓ test/public-text.test.ts > scanPublicText > refuses a credential shape in any string, never repeating the value, and a secret scan that cannot run
```

`E2E_PORT=4421 pnpm --filter @backseat/site e2e`: `164 passed (3.5m)`, `3 skipped`, among them:

```
e2e/agent-card.spec.ts › at 375px a card with no byline keeps 16px from its summary to its bottom block, and the byline keeps at least that
e2e/agent-card.spec.ts › at 768px a card with no byline keeps 16px from its summary to its bottom block, and the byline keeps at least that
e2e/agent-card.spec.ts › at 1440px a card with no byline keeps 16px from its summary to its bottom block, and the byline keeps at least that
e2e/agent-card.spec.ts › with no card an agent wrote, as on the live studio today › at 768px every card keeps 16px from its summary to its bottom block
e2e/agent-card.spec.ts › with no card an agent wrote, as on the live studio today › at 1440px every card keeps 16px from its summary to its bottom block
e2e/layout-balance.spec.ts › layout balance, home with an open card an agent drafted › leaves no dead space at 768px / 1024px / 1440px
e2e/pages.spec.ts › at 375 px / at 1440 px › /team lists the running agents and the ones that build no cards, with code-drawn avatars
```

With the fifth, empty track put back (`span 5`, the bottom block on row 5), the four 768 and 1440 gap tests fail with `summary to bottom block 40px`; 375 passes, since phones lay the card out as a column. `BOARD_E2E_PORT=4422 pnpm --filter @backseat/board e2e`: `7 passed (4.2s)`. Screenshots of home, the agent-card row and /team at 375 and 1440 were looked at: no gap above any bar, the byline under its summary with the row's bars in line, and /team's Not building cards section reads true of every role in it.

The gate at the review fixes' head sha did not start: GitHub refused the jobs, saying the account's recent payments failed or its spending limit needs raising. That is the board's (GitHub Billing & plans); the local `pnpm verify` and gate dry runs above pass, and the gate reruns once billing is fixed.

After merging main at ff512b9 (agent-system-core as merged, the rename and the local gate; resolved against agent-system-core's last merged tip, beeb790, as the base, with agent workflows as PLAN decision 46) and the minor findings (Decisions, 2026-09-24), `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify` exits 0 (`EXIT 0`, run with `npm_config_workspace_concurrency=2`):

```
platform/board test:       Tests  94 passed (94)
platform/site test:       Tests  436 passed (436)
platform/supabase test:       Tests  304 passed (304)
seed-1 test:       Tests  77 passed (77)
platform/dispatcher test:       Tests  687 passed (687)
platform/gate test: PASS: gate tests passed=508
ok | 115 passed (161 steps) | 0 failed
GATE PASS folder=seed-1 lane=code
GATE PASS folder=platform lane=code
PASS: secret-scan files=592
tier 1 carries the old name nowhere
```

`pnpm test:agents`: `ℹ tests 125`, `ℹ pass 125`, `ℹ fail 0` (the earlier "124" was misquoted; the suite ran 125). `pnpm test:docs`: `ℹ tests 18`, `ℹ pass 18`. `pnpm test:functions`, `agent_workflows_test.ts`: `ok | 8 passed (18 steps) | 0 failed`, the new steps among them:

```
  approval is refused, writing no card, unless the grader's own verdict is approved ... ok
  each refusal names the card, and a refused ranking writes nothing; rankable_cards lists the cards it accepts ... ok
```

The second now puts a board-vetoed card back on now: `rankable_cards` leaves it out and `apply_card_ranking` refuses it with "Card … takes no money". The new dispatcher tests: `role-session.test.ts` "runs on the model its role resolves to when the session starts, as card sessions do, not a stale roles.model"; `role-model.test.ts` "refuses a role a role job runs whose resolved model has no price, the Game Director without write access included"; `job-handlers.test.ts` "sends back a draft whose text is blank or whose estimate rounds to nothing as the schema check, before record_card_draft could refuse it"; `typed-output.test.ts` refuses a blank title, summary and acceptance test and an estimate of 0.00004. The board's `Board.test.tsx` names moved cards by title with a link to `#card-<id>`, else "card 33333333", and reads "Sent back to revise: unclear text"; the site's `EventList.test.tsx` reads a `ranked` step as "ranked the cards open for funding"; `Roadmap.test.tsx` checks the lede's two paths; `Landing.test.tsx` checks that home draws no live-updates row without a snapshot.

`BOARD_E2E_PORT=4420 pnpm --filter @backseat/board e2e`: `7 passed (5.4s)`, the ranking's output reading "Bigger pockets for the gatherers: from no rank to rank 1" (a link to its row) and "card 11111111: from rank 4 to rank 2". The full-page screenshots at 375 and 1440 were looked at: the Jobs section's run output sits as numbered lines under each run, in the section's rhythm. `E2E_PORT=4421 pnpm --filter @backseat/site e2e`: `162 passed (3.3m)`, `5 skipped`, the agent-card, 16px gap and /team tests among them.

### Production, before the merge (24 September 2026, UTC)

1. `select paused, pause_reason, agent_mode, dispatcher_seen_at, cooling_window_minutes from public.studio_state` → `[{"paused":true,"pause_reason":"awaiting_credit","agent_mode":"attended","dispatcher_seen_at":"2026-09-16 04:19:38.678+00","cooling_window_minutes":0}]`; 0 cards building of 57; `to_regclass('public.card_drafts')` → null and `jobs` held 0 rows, so nothing of this migration was there.
2. The dump: `pg_dump "$BACKUP_DB_URL" -Fc` → `~/peanutgallery-dumps/pre-agent-workflows-20260924T042751Z.dump`, mode `-rw-------`, 728,474 bytes; `pg_restore --list` reads 77 TABLE DATA entries, `cards`, `card_approvals`, `contributions`, `contribution_allocations`, `jobs`, `job_runs`, `ledger` and `roles` among them.
3. `20260924400000_agent_workflows.sql` at 345a006 (sha256 2920663b…05f9), wrapped in `begin; … commit;`, one request to the Management API query endpoint: `HTTP 201 []`.
4. Read-backs: `card_drafts` exists with row security on and 0 rows; the nine functions (`apply_card_ranking`, `approve_card_draft`, `card_from_draft`, `card_rank_problem`, `card_ranking_places`, `cards_agent_text_guard`, `rankable_cards`, `record_card_draft`, `withdraw_card_draft`) exist; `approve_card_draft`'s arguments read `p_draft uuid, p_approver_role uuid, p_grader_ref text, p_verdict jsonb` (no default); anon may not select `card_drafts` or execute `apply_card_ranking`, authenticated may not execute `approve_card_draft`, the service role may; the jobs read `[{"name":"draft_card","role":"Game Designer","calls_model":true,"runs_when_paused":true},{"name":"studio_ranking","role":"Studio Head","calls_model":true,"runs_when_paused":true}]`; `rankable_cards()` lists 6 of the 12 cards on now; `public.ledger_identity() ->> 'holds'` → `"true"`. `anon-negative-test.ts` → `PASS: anon access matches the RLS contract` (`card_drafts` and all eight new functions refused with 42501); `ledger-identity.ts` → `PASS: ledger identity holds over 1 contribution rows, 0 studio ledger rows, 1 allocations and 57 cards`.

The gate, the merge and the steps after it are recorded by the next pull request that touches the specs.

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
- 2026-09-23, build (no board question; the code decides where the spec was silent):
  - The Game Designer's role spec holds Read, Glob, Grep and Bash, as Behaviour gives its session, so it has write access as a planner with tools; its description and the Studio Head's and Game Director's now say what they run. The Game Director, a reviewer, runs a job with no write access; `role-files.test.ts` names it as the one such role.
  - Role sessions run through an attended adapter (`claude -p` on the founder's plan) even in a process whose card sessions are unattended, so "either studio mode" never bills the studio key. Each session's budget is the per-card maximum, with the card sessions' turn cap and wall clock; it stops when the board session lapses or the role pauses.
  - A run's sessions share one detached scratch checkout of origin/main under the worktree root (`job-<id8>`), removed after the run. `check:` lines are read at the run's base sha through git, and only after the path check, so neither an edit in the checkout nor a path outside seed-1's lane is ever read.
  - A Designer answer that is not one valid draft is the schema check's refusal and goes back as the next round, as Drafting says; three such rounds fail the run with nothing written. An answer from the Studio Head or the Game Director that is not one valid object fails the run with nothing written, as does any failed model call. The answer may sit inside one fenced code block; what is inside must still be exactly one object.
  - Every Designer round is kept in `card_drafts`: a draft refused by a check is withdrawn with `check_<name>`, one sent back or flagged with the Director's codes, and one whose grading session failed with `grade_failed`. `card_from_draft` is the one place draft fields become a card row, so the hash recorded and the card approval inserts cannot differ. `approve_card_draft` also takes the verdict, which goes on the approval row.
  - `apply_card_ranking(p_run, p_order)` takes no reasons: the reason codes stay in the run's output and the public event names ids and ranks only. The named cards trade the ranks they hold (superseded position n gets rank n; see the review fixes below). A run with no rankable card starts no session and writes its event with no moves.
  - The executors a draft may name are the seed-1 card roles the site and the board already offer (Builder A, Builder B and QA), active, unpaused and of the writer class.
  - The AI-agent line is on the card face and on /roadmap's rows, which carry the summary of an approved agent card waiting on next. Home's title-only rows and the shipped rows carry none; supporter-pages' /card/:id is where a card's full text lands.
  - The Community backlog entry no longer names Reddit, X or a board review.
- 2026-09-23, review fixes (no board question):
  - The ranking's "a card holding money keeps its place" is now enforced, not assumed. Position n getting rank n tied or passed every card the ranking may not touch (a card with money, a card left out, a change past the cap), and step 2 breaks rank ties by age, so new money could fund a card the Studio Head had not put first ahead of a card half funded. `card_ranking_places` has the named cards trade the ranks they already hold, in the order given; an unranked card's place is after every rank on now, and unranked cards that already stand in the order given keep no number. Every card the order does not name keeps its rank and its place in step 2's line.
  - Where trading could still move another card, the named card keeps its rank and counts as not applied: another card in line (on now at proposed, designing, voted or funded, the stages step 2 funds) shares its rank, or it is unranked behind an older unranked card the order leaves out. A shared rank is the board's to break; the ranking never creates one.
  - The ten-change cap applies the longest start of the order whose changes fit in ten, the named cards in it trading their own ranks, so no stale rank ever ties a new one. `unapplied` counts the named cards whose place was not set. The board shows them as "n more kept their ranks."
  - Which cards are rankable is one SQL test, `card_rank_problem` (off now, not open for funding, money on the bar or a payment on hold naming the card). `apply_card_ranking` refuses on it and `rankable_cards` lists by it, and the dispatcher offers the Studio Head only what `rankable_cards` returns. A card with an empty bar and a payment on hold (the daily credit cap used up) was offered before and failed every Rank now until the hold released.
  - The card subgrid from main's gap audit (#76) gains a fifth track for the byline: index, title, summary, byline, bottom block. With four, the byline fell into the bottom block's row and was drawn through the funding bar at 768 and 1440. (Superseded by the third review's fixes: the fifth track is gone.)
- 2026-09-23, third review fixes (no board question; the salvage run after the usage limit):
  - Role sessions hold no Bash in an unattended process, rather than the dispatcher refusing role jobs outside attended mode. PLAN §6 and decision 25 say no agent-written code runs on the dispatcher's host, and the Game Designer's seed-1 scripts (and the `pnpm install` before them) are agent-written code; but agent-system-core's decision that model role jobs start in either studio mode stands, since Draft to the floor (launch-card-floor) and studio-reports run on the Mac host after the cutover, which is unattended. So `roleSessionSpec` leaves Bash out whenever the card sessions' mode is unattended, nothing is installed, and an init line that still shows Bash stops the session. In an attended process, where card sessions already run sandboxed on the founder's Mac, the Designer keeps Bash as before. The Designer drafts from Read, Glob and Grep alone on the host; its prompt says so.
  - The attended adapter's Read, Glob and Grep deny rules name the code clone the dispatcher runs from as well as the work clone (on the Mac host they differ, and the code clone's `.env` holds the service-role key, the studio key and the GitHub tokens), and `HOME_DENY` adds every `.env`, `.env.*` and `*.env` file under the home folder (the board's own checkout, the host's `dispatcher.env` and job env files), `~/peanutgallery-host/env/**` and `~/peanutgallery-dumps/**`. A `.env.example` in a worktree is denied too, which no lane needs. The rules have the shapes the adapter already used; `sandbox:check` is the board's to rerun on its Mac.
  - The public-text filter runs the gate's `secret-scan.sh` over the same file after `banned-phrases.sh`, so a credential a role session read can never reach a public row; the refusal names the shape and never the value.
  - The card keeps main's four subgrid tracks. A card an agent wrote holds its summary and byline in one block (`.card-text`) on the summary's track; a card no agent wrote renders exactly as on main. The fifth, empty track added one 24px grid gap above every funding bar from 768px up, on every card, bylines or not (no card on production has one). The agent-card e2e now checks 16px from the summary to the bottom block on every card without a byline at 375, 768 and 1440, with an agent card on the page and without one.
  - /team's second section is "Not building cards", and its intro says some of its roles rank, draft or grade cards when the board asks and the others have no job yet. "These roles have no job that runs yet" was false of the Studio Head, the Game Designer and the Game Director once their jobs were registered. supporter-pages' `teamStatus` replaces the section later. The board's comment on the card roles says the same.
- 2026-09-24, the reviews' minor findings (the board: fix them before merging; no board question):
  - `approve_card_draft` takes the grader's verdict as a required argument and approves only when its own `result` is approved; it copies that result into the approval's `verdict` rather than supplying one, so `record_card_approval`'s check applies to what the Game Director said. A revise or flagged verdict passed to it writes no card (a PGlite step).
  - `card_rank_problem` adds "takes no money" (`money.card_takes_money`) after the horizon and stage tests, so a ranking names only cards step 2 funds. A card the board vetoed and then put back on now was rankable, and trading its rank could move a card the ranking chose ahead of a half-funded card it left out.
  - Role sessions run on the model their role resolves to (`resolveRoleModel`, the env's MODEL_* token first), as card sessions do, and startup prices the models of the three role-job roles, the Game Director included, as well as every writer.
  - The draft schema refuses a title, summary, intent, acceptance test or executor with no visible character (`pattern: \S`) and an estimate below $0.0001, which `record_card_draft` would refuse, so such a draft goes back to the Designer as the schema check's round instead of failing the run.
  - The board's run output names each moved card by its title, linked to its row under Cards when listed and by its short id when not, one line a card; an approved draft's card by its title; and the verdict, the reason codes and the check names in words ("Sent back to revise: unclear text").
  - The ranking's public line is "Studio Head ranked the cards open for funding" (`legal.eventSteps.ranked`, read from the event's step), not "wrote a note". The moves stay private: PLAN, SYSTEM.md, the Studio Head prompt and this spec now say so instead of "one public event of the moved cards".
  - /roadmap's lede says a planned card opens for funding when the board moves it or, for an approved agent card, by itself after the board's waiting time; it said only the board moves cards.
  - Home hides the live-updates row while no snapshot has loaded (the read failed), so "Up to date" never sits under "Not available right now." (a finding about main, fixed here since it is two lines).
  - The AI-agent label stays with a card's summary: the card face and /roadmap's rows carry it, and rows that show only a title (home's Planned next, Queued, Shipped) carry none, as the build decision says; supporter-pages' /card/:id shows a card's full text with it.
  - Already fixed by earlier rounds and left: the held card offered as rankable, position n getting rank n, /team's section, the Board.tsx comment and PLAN §3's /team sentence (now "which roles build cards").
