# The launch card floor: the first open cards, drafted and graded before launch

Status: agreed. Card: none. Owner: board.

Amended by PLAN.md §10 decision 66 (`unattended-roles.md`): superseded. The card supply refills itself: a scheduled `draft_card` drafts the next seed-1 backlog card when `card_supply()` is short, unattended and billed to that card, so no attended session and no Draft to the floor are needed. The status stays agreed as a record; nothing in it will run.

Series position: last in the launch series, after copy-pass (the order is in `docs/ROADMAP.md`, "The launch series"). It uses studio-reports' `card_supply()` and Draft to the floor, agent-workflows' `draft_card` job, agent-system-core's approvals and dealing, and money-logic's `public_money.funding_order`. It is a board pull request of docs only: this spec's Evidence and its ROADMAP row (the spec and the row land first, with the series). The work itself is one attended production session.

It covers the launch plan's Phase 2 "Card supply" (PG-10), Phase 5's "The first public cards are chosen for first-pass success" (L16) and "the launch cards are open to fund", and the launch clip (PG-15).

## Problem

- On 23 September 2026 production had six open cards, all goal cards with targets of $0.50 to $1.50. The floor (at least 6 open, at least 1 big card at $5 or more, at least 1 small card under $2) is therefore short of its one big card.
- Nothing has drafted a card on production. The only drafting path is the board-started, attended `draft_card` job, and it has not run there.
- The first public cards decide whether the first builds pass (L16), and the first player-funded card to ship is the launch clip (PG-15). The launch cards have to be open to fund.

## Scope

In:
- One attended session before the first stranger is invited, started at /board with Draft to the floor while a board member is signed in: the Game Designer drafts, the dispatcher's checks run, the Game Director grades (at most three rounds), the dispatcher approves, and the tick deals each approved card after the cooling window (0 by default).
- `card_supply()` before and after, the ledger identity after, and the live check.

Out:
- Any card text written outside the Game Designer's session. The builder of this spec and the board write no card and set no target.
- Refilling after launch: the board presses Draft to the floor again, attended (studio-reports).
- Studio (site) cards, and changes to the six cards already open.
- An operations percentage and its measurement. The operations bucket is removed from the series until a percentage exists (BACKLOG). The session's ledger rows stay on the append-only ledger for whoever measures it later.

## Behaviour

- **The floor** is studio-reports' `studio_state` defaults, counted by `card_supply()` over the cards in `public_money.funding_order`.
- **The run.** Draft to the floor queues one board-origin `draft_card` run with `{floor, open_cards}`. It runs while the studio is paused (agent-workflows seeds `draft_card` to), so the floor is drafted before launch. The Game Designer can therefore see what is short and what is already open: its prompt names each shortfall with the target it asks for (a big card at least `card_big_min_usd`, a small one under `card_small_max_usd`), from the thresholds Draft to the floor sends with the shortfalls (studio-reports, review fixes of 26 September 2026). Every standing rule from agent-workflows applies: a seed-1 card only, a `check:` line false on main, an estimate within `card_max_usd`, one small change, the all-ages rating, and a target equal to the estimate by `launch-cards.md`'s five-times rule. Each run makes at most one card. After a withdrawn draft the board may start another run.
- **First-pass success (L16).** Each new card is a config change or a small code change in a lane where a seed-1 card has already gone live. A big card is a bigger change (an expected cost of $1.00 or more, so an estimate of $5 or more). Its target is never padded to reach $5.
- **The launch clip (PG-15).** One card open to fund makes a change that is visible in the game within a few seconds of play. It is named in Evidence.
- **An honest shortfall.** If no draft that passes grading reaches the floor, the session opens what passed, and Evidence records each remaining shortfall. /board keeps showing it (studio-reports' Needs you). No target is raised.

## Acceptance criteria

- [ ] ~~A dump is taken before the session. `card_supply()` is quoted before and after it, and `ledger-identity.ts` PASSes after it. After the session every shortfall is 0, or Evidence names each remaining shortfall and records that no approved draft reached it.~~ Superseded by `unattended-roles.md` (PR4).
- [ ] ~~Every card created during the session came from a board-origin `draft_card` run started by Draft to the floor, and each run's job run id is quoted. Each such card:~~ Superseded by `unattended-roles.md` (PR4).
  - is a seed-1 card drafted by the Game Designer;
  - has a draft approval row whose grader ref differs from its maker ref, and whose approver role is neither its proposer nor its executor;
  - has a target equal to its approved draft's `estimate_usd`, a whole multiple of $0.50;
  - has a `check:` line that the run's check results show false on main;
  - sits in a lane where a seed-1 card has already gone live.
  The Game Designer's and Game Director's ledger rows from the session are all billed to the founder.
- [ ] ~~Once dealt, each new card is in production's `/api/live` `funding_order`, and the live check PASSes. Evidence names one card in `funding_order` as the launch-clip candidate, with the visible change it makes.~~ Superseded by `unattended-roles.md` (PR4).

## Verification

Each SELECT goes through the Management API query endpoint and is read-only.

- `select public.card_supply()`, before and after.
- A SELECT of the cards created since the session started, joined to their approved `card_drafts` row and their `card_approvals` row of kind draft. It shows folder, lane, target, the draft's `estimate_usd`, `job_run_id`, the approver, maker and grader refs, the proposer, the drafter and the executor. A count of the cards created since the start must equal the count of drafts approved in the session's runs.
- `select distinct lane from public.cards where folder = 'seed-1' and stage = 'live'`.
- The session's `job_runs` rows (typed output with check results and the verdict), and the ledger rows written since the start, grouped by role and billing.
- `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts`, and `select public.ledger_identity()`.
- `curl -s https://peanutgallery.games/api/live`, showing each new card id in `funding_order`.
- `set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs`
- `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify` on the docs pull request.

## Production steps (need the board's allow)

1. Dump: `/opt/homebrew/opt/libpq/bin/pg_dump "$BACKUP_DB_URL" --format=custom --file ~/peanutgallery-dumps/pre-card-floor-<UTC>.dump`, then `chmod 600`, and quote its size.
2. Quote `card_supply()` and the start time.
3. Board: at /board, in Needs you, press Draft to the floor with a reason (second factor), and stay signed in while the run works. Start another run after a withdrawn draft if the board wants to.
4. After the last run and the next tick, run the SELECTs, `ledger-identity.ts` and `card_supply()` from Verification, and quote them.
5. Read `/api/live`, then run the live check.
6. Fill Evidence, run `pnpm verify`, then open the docs pull request and merge it on a green gate at its head sha. The ROADMAP row moves to done.

## Evidence

Added when the session has run:
- the dump's size, and the supply before and after;
- each card's title, lane, estimate, target, approval refs and job run;
- the launch-clip candidate and its visible change;
- the ledger identity, `/api/live` and the live check.

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 9 criteria (6 lines, one of them with 4 parts) became 3.
  - Cut, because the operations bucket is removed from the series until a percentage exists, and agent-workflows no longer builds `operations-pct.ts`: the operations measurement, the session's cost line in Evidence, the conditional operations-share board pull request (money-logic's zero constraint and legal-copy's `operations_pct` are gone too) and its ROADMAP record. The founder-billed ledger rows stay available for a later operations spec (BACKLOG).
  - Cut, because the drafts are seed-1 changes only, which the dispatcher already enforces, and site cards are out of scope: design-review's `adds: none` declaration.
  - Cut, because agent-workflows' `draft_card` runs attended and board-started in either studio mode: the "before the cutover" requirement. The session runs before the first stranger is invited instead.
  - Merged: "passed the draft graders" and "came from the Game Designer's session" became one criterion on the approval row and the job run.
  - Kept: every Problem outcome, the approval's separation of duties, a target equal to the estimate with no padding, the honest shortfall, the dump before production writes and the ledger identity.
- 2026-09-23 (the board's defaults for this series): the operations bucket is removed until a percentage exists, so every role job is board-started, attended and billed to the founder. It never spends studio or supporter money.
- 2026-09-23, reconciled with the series: Draft to the floor (studio-reports; in Needs you when supply is short) queues agent-workflows' `draft_card` with `{floor, open_cards}` through agent-system-core's `enqueue_manual_job`. Approval inserts a new seed-1 card on horizon next, and the tick deals it after the cooling window. "Open to fund" is money-logic's `public_money.funding_order`, which `card_supply()`, /contribute and every Fund button follow.
- 2026-09-23: drafting the launch floor is its own spec, rather than a production step inside studio-reports, so its selection rules and checks are a contract.
- 2026-09-23: the session is attended and board-started on the founder's plan, because unattended role jobs are not allowed on it (Consumer Terms, R33).
- 2026-09-23: targets come from estimates by `launch-cards.md`'s five-times rule, never from a wish for a round figure. A big card is a bigger change, not a padded target.
- 2026-09-23: the first cards are chosen for first-pass success (L16), and one open card makes a visible change for the launch clip (PG-15).
- 2026-09-23: if the floor cannot be met honestly, the shortfall is shown, not hidden.
