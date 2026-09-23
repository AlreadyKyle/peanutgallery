# Agent system core: approvals, dealing after the cooling window, board and role controls, and the job queue

Status: agreed. Card: none. Owner: board.

Series position: after money-surfaces, before agent-workflows (the order and each spec's status are in `docs/ROADMAP.md`, "The launch series"). It changes kernel files only and needs money-logic merged first: its money tests run against money-logic's waterfall, hold and refund functions.

## Problem

Nothing in Postgres stops an agent approving its own work: `runnable()` trusts every card an agent filed, no approval is recorded, and nothing limits which card fields the service role rewrites (R17). A card takes money the moment it is on horizon now at an open stage, so the board has no moment to act before money arrives (R18, A5), and its only switch is the global pause. Scheduled role work is eight node-cron stubs that only log, keep no state, and can run twice or silently skip (S1). The throttle models cards only, so a role job would spend the pool, the day's cap and the Console credit that funded cards need (R15, R22, A3). A card paused at its ceiling waits for the board, because no rule can resume it (L11). There is no single map of who does what.

## Scope

In:
- `card_approvals` (append-only) and `record_card_approval`, which enforce separation of duties in Postgres.
- A content hash over what a builder or funder relies on (bucket, lane, folder, executor, title, summary, intent, acceptance test, design spec URL and funding target; not the estimate), and a guard trigger so that on a card needing an approval a hashed field changes only through a board RPC, which records a board approval of the new content.
- Card columns `drafter_role_id`, `check_author_role_id`, `opens_at`, `board_vetoed`, `board_veto_reason`; `studio_state.cooling_window_minutes` (0 to 10,080, ships at 0); `roles.agent_class`, `paused`, `paused_reason`.
- Dealing: an approved agent card waits on horizon next and the tick deals it to now once the cooling window has passed.
- Visibility: outside the board, an agent-written card is readable only while its approval is current (R20); board members read every card.
- `money.card_takes_money` recreated with two more conditions (not board-vetoed, `card_is_public`), with its new cases in the SQL tests (there is no shared fixture and no site mirror).
- Board and role controls: the board's veto, the cooling window, role pause (the moderator may pause, only the board resumes).
- The job queue: `jobs` and `job_runs`, filled by `enqueue_job_run` (called from pg_cron by later PRs) and `enqueue_manual_job` (the board), drained by the dispatcher tick. node-cron and `scheduler.ts` are deleted.
- `record_usage` refuses a studio row with no card.
- Resume by rule (L11), once per card, topping the card's bar up from money not on a card yet through `money.top_up_card`.
- Trust classes in the role specs and the tool split (read-only tools for the two Directors, no write tools for the Studio Head); `public_roles` gains `agent_class`, `paused`, `paused_reason`.
- `docs/SYSTEM.md`, the single map; PLAN, ROADMAP, the agents README and the docs and specs tests.
- `file-backlog` skips drafted, dealt-pending and vetoed cards, and `--apply` deletes planned cards whose entries left `docs/BACKLOG.md`.
- The board site: the cooling window, role pauses, the job list with Run now, and a veto on every card row; Needs you gains two lists.

Out, and what each waits on:
- The operations spend path. The operations bucket is removed from the series (it would ship at 0%). What depended on it was unattended model role jobs; they do not run: a model-calling role job starts only attended and board-queued, which was already the behaviour at 0%. A later board pull request adds the bucket and the spend path together when a percentage exists.
- Role workflows, typed outputs, the draft path, public text safety and ranking: `agent-workflows.md`. This pull request seeds no job and schedules nothing.
- A findings table and a board-work list in Needs you: the first pull request that files a finding.
- Board actions in public: BACKLOG's "Board Decisions page".
- The public "approved, opens soon" label and /team statuses: supporter-pages.
- Canary cards and approval-rate trips (R18): with the replay eval set, after launch.

## Behaviour

**Approvals.** An approval row names the card, its kind (draft, visual, qa_verify or board), the approving role or board member, the making role, the maker's session id, the grader's session or evaluation id, the content hash and the verdict. The dispatcher writes it from the grader's own result through a service-role RPC no agent session can reach. Recording an approval changes nothing on the card. A card needs an approval when an agent wrote any of it (`source = 'agent'` or a drafter set); board-filed cards do not. A board edit through `set_card_horizon` records a board approval of the new content.

**Dealing.** An approved agent card sits at stage proposed on horizon next or later with `opens_at`, its approval time plus the cooling window. The first tick at or after `opens_at` deals it to now if it is still approved, vetoed by neither the board nor the Director, its executor role is not paused, and it meets the definition of ready. Until then no money reaches it, because every funding path requires horizon now.

**What the public sees.** Outside the board, an agent-written card is invisible until its approval is current, everywhere the public reads cards. An approved card waiting to be dealt is visible. Board members see every card at /board. A card whose approval is voided by raw SQL is hidden, not runnable and takes no money; if it holds money it is listed in Needs you.

**Vetoes.** The board vetoes or unvetoes a card with a reason at the second factor. A vetoed card is never dealt or run; one on now with no money moves to next. A card holding money cannot be vetoed; the board cancels it instead. Unvetoing an approved agent card sets `opens_at` to now plus the window. The Director's stance is a separate field the veto never touches.

**Role pause.** The board or the moderator pauses a role; only the board resumes it, at the second factor. A paused role starts nothing. Its running card session stops at the next watch and the card returns to funded, as after an infrastructure stop, and runs once the role is resumed. A card already dealt stays dealt and can take money.

**Jobs.** A job is a name, a role, whether it calls a model, and whether it runs while the studio is paused. A run is queued by the board (Run now, with typed input), by pg_cron through `enqueue_job_run`, or by an event; a run queued by a board-origin run is board origin. A key makes each enqueue happen once, and a job never holds two queued scheduled runs, so an outage does not pile up stale slots. Each tick starts the oldest queued run that can start, one job at a time beside the card sessions, and finishes a run that cannot start as skipped with its reason; a board-origin model run waiting for a signed-in board member is left queued. A running job stops at the next watch when its role or the studio pauses. At startup, runs still marked running are finished as failed.

**Who pays for role jobs.** No role job spends supporters' or studio money. A model-calling run starts only when its origin is board and a board member is signed in at /board (the heartbeat attended card sessions already use), in either studio mode. It runs through the attended adapter on the board's Max plan, and every model call is billed to the founder (Consumer Terms, R33: the founder's subscription is never used unattended). While no board member is signed in, it stays queued. A model-calling run of any other origin is skipped with `not_board_origin` until an operations budget exists. Code runs start in both modes. `record_usage` refuses a studio row with no card.

**Resume by rule.** A card paused at its ceiling for the first time resumes with no one acting when the money on its bar covers the room a new ceiling adds. The new estimate is its actual cost; the new ceiling is the lower of 1.5 times that and the card maximum. The money on its bar is its funded amount less its studio spend. If that is short, the rule tops the bar up from money not on a card yet, all or nothing, through `money.top_up_card` (money-logic's lock order, capped by `money.drainable_usd()`, oldest payment first, reason `ceiling_top_up`), never from another card, and writes a public event line with the amount. If there is not enough, the card waits and the rule tries each tick. A card at the card maximum, or paused at its ceiling a second time, waits for the board in Needs you. The funding target never changes, so the approval stands.

**Roles.** Each role spec names its trust class: writer (Builder A, Builder B, QA, Platform Builder, Tech Artist), planner (Studio Head, Game Designer, HR), reviewer (Game Director, Platform Director), read-only (Janitor, Head of Finance) or web-only (Biz Dev, Head of Product, Community, Host). A role has write access exactly when it is a writer or a planner with tools, and no role with write access reads public free text. `budget_share` is unchanged.

**The map.** `docs/SYSTEM.md` lists every role (job, trigger, tools, may and may-not, class, status), the Starts-later roles with their triggers, the card state machine with dealing, the separation-of-duties rules, the job queue and run origins, what pays for each kind of work, and the board's override points. Parts a later pull request builds are marked not built yet, naming its spec.

**Removing planned cards.** `file-backlog --apply` is the one path that deletes planned cards whose entries left `docs/BACKLOG.md`. It deletes them in one statement; the existing foreign keys refuse the whole statement if anything references one of them.

## Acceptance criteria

- [ ] `card_approvals` refuses UPDATE, DELETE and TRUNCATE and anon and authenticated read nothing from it; `record_card_approval` runs for service_role only, changes no card field (`director_stance` and `board_vetoed` included), and refuses, each with its own message: an approver role that is the card's proposer, drafter or executor; a card whose check-line author is its executor; a `qa_verify` approval by the executor or naming the build session; a grader ref that is empty, equal to the maker ref or already used; a hash other than the card's current content hash; an approver role that is paused, retired or outside the reviewer and planner classes (a writer only for `qa_verify`); a draft verdict other than approved.
- [ ] On a card that needs an approval, an update to any hashed field is refused unless it comes through a board RPC; the same change through `set_card_horizon` leaves the card approved with a board approval of the new content; `resume_card` and the resume rule change its estimate and leave it approved, runnable and public.
- [ ] An approved agent card on next is dealt to now on the first tick at or after `opens_at` (the next tick with the window at 0; not before 60 minutes after approval with it at 60); a card vetoed by the board or the Director, one whose approval is not current, one whose executor role is paused and one failing the definition of ready are not dealt, and the dispatcher's `runnable()` refuses each of the first three.
- [ ] On money-logic's merged functions, no money reaches a card that is undealt, board-vetoed or whose approval is not current: a payment naming it credits no bar, a released hold skips it and the waterfall's step 2 skips it; the new predicate cases pass in SQL; `record_usage` refuses a studio row with no card; and money-logic's own tests pass unchanged.
- [ ] Anon and a signed-in non-member read no agent-written card without a current approval through `cards`, realtime, `public_card_funding`, `public_card_spend`, `public_stopped_cards` or `public_agent_events`, and still read every board-filed card; a board member reads every card; `anon-negative-test.ts` probes every table, view and function this adds, with `card_is_public` listed as intentionally callable.
- [ ] `set_card_veto`, `set_cooling_window` (0 to 10,080 minutes only), resuming a role and `enqueue_manual_job` each need the board, the second factor and a reason, and the moderator can pause a role at the first factor but not resume one; a veto moves a card on now with no money to next, is refused for a card with money on its bar or on hold and never changes `director_stance`; unvetoing an approved agent card sets `opens_at` to now plus the window; a paused role's running card session ends at the next watch with the card back at funded, and the card runs after the role is resumed with no card action.
- [ ] `scheduler.ts`, node-cron and `OPERATIONS_BUCKET_USD` are gone; `enqueue_job_run` called twice with the same job and key creates one run, and a job never holds two queued scheduled runs; a run queued by a board-origin run is board origin; a model-calling run starts, in either studio mode, only when its origin is board and a board member is signed in at /board, and stays queued while none is; a code run starts in either mode; a run that cannot start is finished as skipped with `role_paused`, `studio_paused` or `not_board_origin`; a running job stops at the next watch when its role or the studio pauses; at startup, once the lease is held, every run still marked running is finished as failed with `dispatcher_restart`.
- [ ] Resume by rule, on a card with target and estimate $1.00 paused at its ceiling with $1.50 of studio spend and a $5 card maximum: with at least $1.25 not on a card yet it tops the bar up by $1.25, sets the estimate to $1.50, resumes under a $2.25 ceiling and `ledger_identity()` still holds; with less it waits and changes nothing; it never changes the funding target or the approval; a card at the card maximum and a card paused at its ceiling a second time are never resumed by it and are listed in Needs you.
- [ ] `file-backlog` leaves a card with a drafter, an `opens_at` or a board veto untouched; its dry run lists every planned card whose entry left `docs/BACKLOG.md`; `--apply` deletes them in one statement, only board-filed cards at proposed on next or later that never held money and were never drafted, and deletes none when any of them is referenced by another row.
- [ ] Every role spec carries `class`; `write_access` is true exactly for writer and planner roles with tools; the Game Director and the Platform Director hold only Read, Glob and Grep and the Studio Head holds no write tool; `public_roles` shows `agent_class`, `paused` and `paused_reason`; `docs/SYSTEM.md` exists and its role table equals the role specs (docs test).
- [ ] The board site shows and changes the cooling window, each role's pause and each card's veto, undealt and hidden agent cards included, and lists each job with its recent runs and Run now; Needs you lists the ceiling pauses the rule cannot resume and the cards holding money whose approval is not current (board e2e).

## Verification

- `pnpm verify`
- `pnpm test:functions` (the PGlite tests in `platform/supabase/functions/_shared/agent_system_test.ts`, which apply every migration, money-logic's included)
- `pnpm --filter @backseat/dispatcher test`
- `pnpm --filter @backseat/supabase test`
- `pnpm test:ops`
- `E2E_PORT=4393 pnpm --filter @backseat/board e2e`
- The gate green at the pull request's head sha (`gh pr checks <number>`).
- Production, after the production steps: the pre-migration dump's size quoted; `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts` PASS; `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts` PASS and `select public.ledger_identity()` holding, both quoted; `select cooling_window_minutes from public.studio_state` reads 0; `select count(*) from public.cards where not public.card_is_public(id)` reads 0; the `file-backlog` dry run's removal list and the apply's count quoted; `node platform/site/scripts/live-check.mjs` PASS.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-09-23, Trimmed (the board's order of 23 September 2026: simple, standard tools, delete rather than add bespoke machinery, build nothing that ships switched off): 33 criteria became 11. Cut, and why:
  - The operations spend path (the `operations` billing label, `operations_draws`, the ten-argument `record_usage`, `ledger.job_run_id`, `operations_budget`, role caps from `budget_share`, the throttle's role-job plan and budget keys, the Controller's operations figure, the operations lines in both ledger identities, the recreated `money.place_unspent`): the bucket would ship at 0% and is removed from the series. What depended on it, unattended model role jobs, does not run: model role jobs start only board-queued with a board member signed in, billed to the founder, which was already the behaviour at 0%. The Controller's stubbed operations term is deleted, `budget_share` is left as it is, and no `runs_unattended` column is added (no page reads it).
  - The dispatcher's own scheduler (cron-parser, the one-hour grace, DST and first-start tests): pg_cron calls `enqueue_job_run`, and a job holds at most one queued scheduled run. pg_cron runs in UTC, so a later schedule moves an hour against New York at a DST change; that is accepted.
  - The per-job switch (the role pause covers a job's work), the rank pin (the ranking runs only when the board queues it, so the board can re-rank), the 24-hour wait for a board session and its skip reason (a board-origin model run stays queued until a board member is signed in, through the heartbeat attended card sessions already use) and the Console-credit pause for jobs (no job spends Console credit).
  - `card_kind` and `mockup_card_id` on cards: nothing in the series writes or reads them once design-review's trim dropped mockup and design-system cards, so they would ship unused. BACKLOG's "Mockup and design-system cards" adds them.
  - The void-approval sweep and the findings table: a void card is already hidden, not runnable and takes no money, and Needs you lists one that holds money by query. Findings move to the first pull request that files one.
  - `claim_card` (`runnable()` checks the same flags and the existing stage-conditional claim stays), `public_board_actions` (BACKLOG's "Board Decisions page"), `role_contributions` (moves to its only reader, studio-reports, if it still needs one), `design_brief` (no reader), and `remove_backlog_cards` with its catalog scan (a plain delete, which the existing foreign keys refuse when a card is referenced).
  - The twenty-odd Starts-later, memory and "Design frames on /card" BACKLOG entries and the Biz Dev and Community rewrites: SYSTEM.md lists the Starts-later roles with their triggers instead of filing planned roadmap cards for roles that are not built. The frames entry fell with design-review's frame renderer.
  - Criteria that tested implementation rather than behaviour (the funded-card order, fingerprints, key names, detail-key lists).
- 2026-09-23, reconciled with the series (these override any line below that disagrees):
  - Migration: `20260924300000_agent_system_core.sql`, after money-logic's `20260924200000`. money-logic's allocation reason is a text column with a check constraint, so this migration alters that check to add `ceiling_top_up`; there is no separate migration.
  - `money.card_takes_money` gains `not c.board_vetoed and public.card_is_public(c.id)`; its new cases live in the SQL tests (money-logic keeps no shared fixture, and money-surfaces keeps no site mirror). A paused executor role does not stop a dealt card taking money.
  - `set_card_horizon` and `board_needs_you` are recreated from board-site's versions (money-logic does not redefine them). `public_card_funding` and `public_stopped_cards` are recreated from money-logic's versions, and `public_card_spend` and `public_agent_events` from the latest versions on main, each with only the additions here.
  - Model role jobs start in either studio mode, only of board origin and while a board member is signed in, billed to the founder. This replaces the trim's attended-mode-only rule, which would have stopped Rank now, Draft a game card and Draft to the floor at the cutover; agent-workflows, studio-reports and launch-card-floor rely on it.
  - The ledger gains no job run id; role sessions meter with their role and request id through `record_usage`'s nine arguments.
  - `money.top_up_card(p_card, p_usd)` is a new money-schema function: under `money.money_lock()`, capped by `money.drainable_usd()`, it moves unassigned money oldest payment first with reason `ceiling_top_up`, all or nothing.
  - `enqueue_manual_job(p_job, p_card, p_reason, p_input jsonb default '{}')` carries typed input for agent-workflows' and studio-reports' board-queued runs; it stays board-only and board-origin.
  - `file-backlog --apply` is the series' one path for deleting planned cards; its first run removes "Split aggregate on the meter" and "Handling a dispute the studio wins", whose entries money-surfaces removed.
  - The PLAN §10 decision takes the next free number at build.
- 2026-09-23: A card opens for funding when it is dealt to horizon now. Every funding path already requires now, so holding an approved agent card on next until the window has passed keeps money off it with no change to a funding function.
- 2026-09-23: The cooling window ships at 0, as the board set (A5), and only the board sets it, up to a week. At 0 an approved card is dealt on the next tick; dealing still runs, because it applies the veto, pause and ready checks and is the only path from next to now for an agent card.
- 2026-09-23: The content hash covers the funding target, which funders rely on, and leaves out the estimate, which the board's resume and the resume rule change; hashing the estimate would void the approval at every resume and strand the card's money.
- 2026-09-23: The guard on hashed fields lands here, so from this merge no path but the board's can change what an approval covers. The dispatcher's generic card update writes only stage, branch, commit sha, failing check and actual cost, none of them hashed.
- 2026-09-23: Board members read every card through their own policy, so they can see, veto or cancel an undealt or void agent card. `card_is_public` is executable by anon because a policy's functions run as the caller.
- 2026-09-23: The board's veto is its own field, apart from the Director's stance. A card holding money cannot be vetoed, only cancelled, the rule `set_card_horizon` already applies to leaving now.
- 2026-09-23: A role pause stops work, not the funding of cards already dealt; the moderator may pause a role, as it may pause the studio, and only the board resumes one.
- 2026-09-23: Only board-origin model runs run, and only attended (R33); the runs they queue inherit that origin. Code-only jobs run in both modes.
- 2026-09-23: Resume by rule uses the money on the card's bar, topped up only from money not on a card yet, all or nothing, once per card (L11); anything more is the board's.
- 2026-09-23: Write access follows the class (writer or planner, with tools) rather than any tool: a reviewer reads the repository and writes nothing.
