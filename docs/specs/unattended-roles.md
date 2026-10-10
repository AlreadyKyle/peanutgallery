# Unattended roles: the studio never waits on the board

Status: agreed. Card: none. Owner: board.

The runtime of `docs/PLAN.md` §10 decision 66 (10 October 2026, the board). Four board pull requests in order, each from main after the one before has merged on a green gate: PR2 the visual review, PR3 auto-resume and the studio's auto-unpause, PR4 the self-refilling card supply and the end of `studio_ranking`, PR5 attended mode and the board heartbeat out of the dispatcher. PR1 was the docs (`docs/optional-board` branch); the board's panel is `docs/specs/optional-board.md`. Every part is kernel, so each is a board pull request.

## Problem

The dispatcher still waits on a signed-in board member in four places: a visual card waits at gated until someone signs in for the attended review, the card supply is refilled only when the board presses Draft to the floor, a paused card waits for the board whatever the reason, and a studio pause for credit stays until the board resumes. Every model role job runs attended on the founder's plan through a board heartbeat. The founder wants the board to be optional, like a hosting dashboard.

## Scope

In: the dispatcher's visual review, the job queue's start rule, `draft_card`'s target and trigger, the resume rule, the studio's credit unpause, the retirement of `studio_ranking`, attended mode and the board heartbeat in the dispatcher, the replay eval's place in the gate, and the migrations, Managed Agents definitions, prompts and tests each needs.
Out: the board's site (`optional-board.md`); the money rules (the 80/20 split, the 10% reserve, decisions 7 and 23's money order, the waterfall); the kill switch, caps, card ceiling, gate, rollback, ledger, content filter and read/write separation, which stand; platform backlog cards, which stay manual; the database functions the panel stops calling, which stay.

## Behaviour

Common to every part: no dispatcher path reads a board session. Each model call is an unattended Claude Managed Agents session on the studio organisation's key and Console credit, with Read, Glob and Grep only and no Bash, Write, Edit, web or MCP tool and no fallback model, and is billed to the card it works on as studio-billed `ledger` rows with that card's id (`record_usage` already accepts them). A session starts only when the throttle's available money covers its budget, within the daily and monthly caps. There is no overhead budget for role work.

### PR2: the visual review, unattended and billed to the card

- After a card's gate passes with changed frames, the dispatcher starts the Director's review at once as one Managed Agents session: the Game Director for seed-1, the Platform Director for platform/site. The frames and `platform/agents/rubrics/visual.md` reach the session read-only; it answers one object valid against `visual-verdict.schema.json`, as today.
- The card waits at gated only while the review runs. No board member needs to be signed in.
- Its ledger rows are studio-billed with the card's id and the Director's role. The end rule (`record_review_round`, the cap of two rounds, the all-ages reject, the visual approval) is unchanged.

### PR3: paused cards resume by rule, and the credit pause lifts itself

- Besides the existing first-ceiling rule, a card paused for any reason but those below resumes with no one acting: at most 3 times a day and 8 times in all per card, at most 2 of them for a session's own limits (budget, wall clock or turn cap), with exponential backoff between tries. Each resume writes a public `auto_resume` event and moves the card from paused to funded.
- It never resumes while the studio is paused, past the card's ceiling, or for a card paused for `horizon`, `vetoed`, `read_token` or `unknown_model`, or paused at its ceiling a second time; those wait for the board.
- A studio pause the dispatcher set with reason `awaiting_credit` or `spend_limit` lifts itself when a one-token credit probe on the studio key succeeds, with backoff between probes; the probe's row is studio overhead, as the startup probe's is. A pause with reason `incident` or `board` stays until the board resumes.

### PR4: the card supply refills itself, and ranking is a rule

- While `card_supply()` is short of the floor, the dispatcher (or a pg_cron schedule) queues one `draft_card` run with origin `schedule`, never two at once.
- Its target is the card the dispatcher opens first, so every row of the draft names a card: the next seed-1 backlog card (a board goal card at stage proposed on next or later with `board_work` false and no drafter, next before later, then by rank, then by age), or with none a new seed-1 card at stage proposed on next, private until approved, with the Game Designer as drafter.
- The Game Designer fills that card's intent, acceptance test (`check:` lines), executor, lane and one estimate, which is also its funding target; the dispatcher's checks and the Game Director's grading in a separate session run as today, at most three rounds. Approved writes the fields through the draft path, sets the drafter and records a draft approval on that card; `deal_due_cards` deals it to now after the cooling window and the waterfall funds it. Flagged, or a third round without approval, leaves a backlog card as it was and rejects a new card with `failing_check` `draft_withdrawn`, its spend kept on the ledger.
- Both sessions bill their rows to that card's id.
- `file-backlog` leaves a card that has a drafter alone, so a later run never overwrites a drafted card's fields.
- Ranking is the backlog's rank, then age. The `studio_ranking` job is retired: no schedule, no board button; its handler is removed and its `jobs` row disabled.

### PR5: attended mode and the heartbeat leave the dispatcher

- The dispatcher has one mode, unattended. `boardSessionActive`, the `no_board_session` throttle reason, the `not_board_origin` and `board_session_lapsed` skips and `BOARD_SESSION_TTL_MIN` go; a model-calling run of any origin starts like a code run.
- The attended adapter stays only for the hand-run replay eval (`pnpm eval:replay`), on the founder's login with no database row. Its result is advisory: `platform/agents/evals.test.mjs` reports a missing or lower result and no longer fails the gate (amends decision 52).
- `board_heartbeat` stays in the database, uncalled.

## Acceptance criteria

PR2
- [x] A visual card whose gate passed with changed frames gets a Director verdict with no board session in the database.
- [x] The review's ledger rows are billed to the studio with that card's id and the Director's role, and none is billed to the founder.
- [x] The review session holds only Read, Glob and Grep.

PR3
- [ ] A card paused for `wall_clock` returns to funded with an `auto_resume` event and no board action.
- [ ] A card is auto-resumed at most 3 times a day, 8 times in all and twice for session limits, with backoff between tries.
- [ ] A card paused for `horizon`, `vetoed`, `read_token`, `unknown_model` or a second ceiling is never auto-resumed.
- [ ] No card is auto-resumed while the studio is paused or past its ceiling.
- [ ] A studio paused for `awaiting_credit` or `spend_limit` is unpaused after a successful one-token probe; one paused for `incident` or `board` is not.

PR4
- [ ] With the supply short, a `draft_card` run with origin `schedule` is queued with no board action, and never two at once.
- [ ] The run drafts the next seed-1 backlog card by horizon, rank and age, skipping board work and drafted cards, and with none opens a new private seed-1 card; a withdrawn draft rejects a new card and leaves a backlog card as it was.
- [ ] An approved draft fills that card's fields, records a draft approval on it, and `deal_due_cards` deals it.
- [ ] Both sessions' ledger rows are studio-billed with that card's id.
- [ ] No pg_cron job, board control or handler starts `studio_ranking`.
- [ ] `file-backlog` does not change a card that has a drafter.

PR5
- [ ] No file under `platform/dispatcher/src` names `boardSessionActive`.
- [ ] The dispatcher refuses no model-calling run for want of a board session.
- [ ] A change under `platform/agents/{prompts,rubrics,schemas,managed}/` with no new replay result passes the gate, with the missing result reported.

## Verification

- `pnpm verify`
- The e2e specs the change touches, before the gate, on their own `E2E_PORT`.
- Live, PR2: a visual card gets a Director verdict with no board member signed in; its ledger rows quoted.
- Live, PR3: card 802b9b7a returns from paused to funded with an `auto_resume` event; the event row quoted.
- Live, PR4: a scheduled `draft_card` drafts a seed-1 card that is dealt and funded with no board action; the job run, the approval and the allocation quoted.
- PR5: `git grep boardSessionActive platform/dispatcher/src` prints nothing.
- After each merge: `node platform/site/scripts/live-check.mjs`, its first line `PASS ... failed=0`.

## Evidence

Added as each pull request merges.

- PR2 (tests): `platform/dispatcher/test/visual-review.test.ts` "starts at once with no board member signed in" and "mounts each changed frame at FRAMES_MOUNT, names those paths in the prompt, bills the card and writes no row itself"; `platform/dispatcher/test/managed-role.test.ts` "creates the session with exactly the reader tools…", "writes the review's ledger rows to the card it reviews, studio-billed with the Director's role…", "readerProblems passes the reader override and names anything more" and "interrupts a session that calls a tool it does not hold…". The live check of a Director verdict on a real card, its ledger rows quoted, waits on the merge.
- PR2 (live, 10 October 2026, before the merge): `probe --role` against the studio organisation printed `PASS: role model=claude-opus-5-5 tools=glob,grep,read answer=red billed_to=overhead` with `tool_calls=read /mnt/session/uploads/probe/probe-red.png turns=2` (session `sesn_01VFpfs25e1EZGGhMLKE9USf`, list cost $0.02): the override holds, an absolute mount path under `/mnt/session/uploads` is where the file lands, and the reader reads a PNG.

## Decisions

- 2026-10-10: every model call is work on a card and is billed to that card, so role work needs no overhead budget and the money rules are unchanged (PLAN.md §10 decision 66).
- 2026-10-10: the refill skips backlog cards marked board work, because the dispatcher refuses a draft that touches a kernel path; drafting one would spend money on a certain refusal. With no eligible backlog card the dispatcher opens a new seed-1 card first, so the draft has a card to bill and the supply never waits on the backlog (today both seed-1 backlog entries are board work).
- 2026-10-10: the replay eval is advisory, because it can run only on the founder's login and the studio must not wait on it.
