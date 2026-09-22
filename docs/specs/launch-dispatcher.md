# Launch dispatcher: throttle, money and pipeline safety

Status: built. Card: none. Owner: board.

## Problem

The dispatcher's money rules would not survive launch. It spends against the pool balance alone, so after the cutover it runs ahead of the Console credit the studio has bought, and a session that runs the credit dry is rejected with the players' money spent. It reserves estimates of building and gated cards, never earmarks the bars of other cards, clamps nothing to the daily cap once a session has started, and at a balance under two hours of the hourly rate it starts nothing at all, even for a fully funded card.

The pipeline trusts its own view of the card. It merges without reading the studio or the card again after the gate wait, merges onto a main that moved since the gate ran, overwrites a stage the board set meanwhile, and treats a deploy that timed out as never published. A revert that fails leaves the studio running.

Metering bills Claude Code's `<synthetic>` API-error turns at fallback rates and stops the session as an unknown model, scans the probe's whole stream for tool names, and has no place for an adapter's own request id. Two dispatchers can tick at once, role models are fixed when the roles are seeded, card worktrees live inside the clone, and a gh sign-in token that reaches every repository is accepted.

## Scope

In: `platform/dispatcher/src/**` outside `adapters/**` (throttle, tick, select, budgets, session, metering, pipeline, github, netlify, recovery, config, startup, main, role-model, credit, the attended path of probe-core), their tests, two optional fields on the adapter event contract, one line of the stream parser, and three comments in `.env.example`.

Out:
- The Managed Agents adapter, the unattended startup probe and its `overhead` billing, the stored patch that a re-queued unattended card re-applies, and orphan sessions in recovery (the MANAGED workstream).
- `gateStatus` and `lanePaths` (GATE).
- Every schema change: `cards.horizon`, `credit_purchases`, `studio_state.monthly_cap_usd`, the `overhead` billing value and the lease functions come from the DB workstream (`20260922000000` to `20260922000300`).
- The two-consecutive-errors circuit breaker one reviewer suggested beside F04; a credit error is classified directly instead.

## Behaviour

**Runnable cards.** A card runs a session only when it is funded, on horizon now, from a board, agent or decision source, not vetoed, has an executor, and is not in the platform code lane, which stays closed at launch (F11).

**Holds (unattended only, F24, F26).** `spent_c` is a card's studio-billed ledger sum (`public_card_spend`), never `actual_usd`. For a candidate card X, every other card holds money:

| Card stage | Holds |
|---|---|
| proposed, designing, voted, funded, paused | max(funded − spent, 0) |
| building | max(session budget − session spent, 0), from the running session's meter |
| gated, live, rejected | 0 |

available_X = balance − studio reserve − Σ holds, plus the incident reserve for an S1 card. X starts when what it still needs, max(estimate − spent, 0), fits available_X and each of the three bounds below. Its session budget is the smallest of available_X, the three bounds and the card's remaining ceiling. The ceiling bounds the budget, never the selection. A building card this process is not running holds its whole remaining ceiling.

**Bounds (unattended only).** Each is the cap less its spend less what running sessions may still spend.
- Daily (F25): `daily_cap_usd` − today's spend. It is measured against the day-start balance, so spending does not shrink it. A card the balance stops sleeps as `insufficient_balance` and never raises the daily cap alert.
- Monthly: `monthly_cap_usd` − this New York month's studio and overhead spend. A studio with no monthly cap starts nothing.
- Console credit (F04): the credit bought (`credit_purchases`) − every studio and overhead ledger row. The board is alerted once per purchase total when the pool's agent money is above the credit left, and when the credit stops a card.

**Concurrency.** Attended: one session. Unattended: one session whenever a card's money fits, two once the balance covers two hours at the hourly rate, capped by `DISPATCHER_MAX_CONCURRENCY`. A pool under $5 still runs a runnable card.

**Attended mode (F26).** None of the money rules apply: the session's budget is its whole remaining ceiling, with an empty pool, no credit and no monthly cap.

**The session.** It stops at the lower of the ceiling (outcome `ceiling`) and the throttle's budget (outcome `budget`, the card pauses). A budget of nothing starts no session, and the card goes back to funded. Claude Code's `<synthetic>` API-error turns are never metered, priced or named as an unknown model (F12, F22). An API error, error event or error result that says the credit balance is too low, or that the Console usage limit is reached, is outcome `credit_exhausted`: the studio pauses, the board is alerted "Console credit needed", and the card pauses with its money (F04). The agent's own reply text is never read for this. A turn at a premium `speed` or `service_tier` is priced at the table's highest rates, the session runs on, and the board is alerted, since the table holds standard rates only. A `turn_usage` event that carries a `requestId` is written under that id, so a Managed Agents event id makes the row idempotent (F08). The role's model is resolved when the session starts, from the env token its spec in `platform/agents` names; `roles.model` is used only when that token is unset.

**The pipeline.**
- Every stage write names the stage the card must still be in. A write that finds the card elsewhere stops the pipeline, writes nothing more, closes the card's open pull request, and alerts.
- Inside the merge lock, before the merge, the studio and the card are read again (F27). A paused studio pauses the card, unmerged. A card moved off horizon now, or vetoed, pauses. A card no longer gated is left as the board set it and its pull request is closed.
- The merge goes ahead only while main's head is the card's base sha. Otherwise the card goes back to funded to be built on the new main. For an unattended card, the MANAGED workstream replaces this with re-applying the stored patch.
- A deploy that did not finish in time may still publish, so the previous green deploy is restored before the revert. A failed or skipped deploy is not restored.
- A revert that fails pauses the studio and says so in the alert.

**The lease.** A dispatcher ticks only while it holds `claim_dispatcher_lease`, renewed every tick for five ticks (at least five minutes, at most an hour). It takes the lease before startup's checks and recovery, waiting while another dispatcher holds it, and releases it on shutdown. A dispatcher without the lease claims nothing, writes no heartbeat, sends no ping, and alerts once. Recovery's stage writes are conditional too.

**Startup and configuration.**
- Unattended mode refuses a `GITHUB_TOKEN` that is not fine-grained (`github_pat_`); attended mode warns (F60).
- Card worktrees must be outside the repository clone in every mode; unset, they go beside it as `<clone>-worktrees`.
- Startup checks the price of the model each writing role resolves to and logs a `roles.model` that differs, so the board re-seeds the roles for /team.
- The attended probe keeps its founder billing (F12).
- The probe's forbidden-name check reads the init line's tool list only, so a reply that names a tool it lacks passes, and an API error in the probe is transient (F22).

## Acceptance criteria

- [x] The platform code lane and cards off horizon now never run.
- [x] A card whose only money is its own full bar starts with that bar as its budget, and another card's bar, including a partly filled proposed bar, is never spent on it.
- [x] An overspent paused card never raises what is available, founder-billed turns free no bar money, and a gated card holds nothing.
- [x] A building card holds what its session may still spend, which shrinks as it spends.
- [x] An S1 card may start on the incident reserve, which is part of its budget.
- [x] A $50 pool with $10 of Console credit gives a budget of at most $10; studio and overhead rows and running sessions count against the credit; the board is alerted once per purchase.
- [x] Month-to-date spend at the monthly cap starts nothing, and a studio with no monthly cap starts nothing.
- [x] $99 spent of a $100 daily cap gives a budget of at most $1; running sessions count against the cap; spending today does not shrink the cap; an empty pool is insufficient_balance, not the daily cap.
- [x] An unattended pool under $5 runs a runnable card; two slots need twice the hourly rate.
- [x] An attended card starts with an empty pool, no credit and no monthly cap, on its whole remaining ceiling.
- [x] A session stops at the throttle's budget as outcome budget, and the card pauses; a budget of nothing sends the card back to funded without a refusal.
- [x] A `<synthetic>` turn is not metered and does not stop the session; in the probe it is transient and not named as a missing model.
- [x] A credit-exhausted API error pauses the studio and the card, keeps the card's money, alerts, and nothing more is claimed.
- [x] A turn is written under the request id its adapter names.
- [x] A premium tier is priced at the table's highest rates and alerted.
- [x] A pause, a horizon move or a veto during the gate wait pauses the card unmerged; a card the board moved is left as set and its pull request closed.
- [x] A stage the board set during the session is never overwritten.
- [x] A card whose main moved during the gate goes back to funded, unmerged.
- [x] A deploy that did not finish in time is restored before the revert; a failed deploy is not.
- [x] A failed revert pauses the studio.
- [x] Only the lease holder ticks; a second dispatcher claims nothing and does not ping until the lease lapses.
- [x] Role models resolve from env tokens at session time, and startup logs a stale `roles.model`.
- [x] Unattended mode refuses a non-fine-grained `GITHUB_TOKEN`; attended mode warns.
- [x] Card worktrees are outside the clone by default and a root inside it is refused.
- [x] The attended probe is billed to the founder, never to overhead.
- [x] The probe reads forbidden tool names from the init line only.
- [ ] An unattended card's first session on the VPS starts with a budget no larger than the Console credit left (waits on: Console credit and the cutover).
- [ ] The Mac dispatcher logs `dispatcher lease held` and ticks, and a second dispatcher started beside it logs that another dispatcher holds the lease (waits on: `20260922000200_dispatcher_lease` applied in production).

## Verification

- `pnpm verify`
- `pnpm --filter @backseat/dispatcher test`
- `pnpm --filter @backseat/dispatcher typecheck`
- (waits on: `20260922000200_dispatcher_lease` applied in production) Start the attended dispatcher on the Mac after the `.env` edits below and quote its `dispatcher lease held` line. Start a second one with the same `.env` and quote its `another dispatcher holds the lease` line. Stop both and confirm the lease is released: `select holder from dispatcher_lease` is null.
- (waits on: Console credit and the cutover) On the VPS, quote the tick log line `card <id> claimed` with its `budget`, and show that it is at most the credit bought less the studio and overhead ledger total.

## Evidence

`pnpm verify` at the worktree root exits 0. Its dispatcher lines:

```
platform/dispatcher test:  Test Files  30 passed (30)
platform/dispatcher test:       Tests  453 passed (453)
```

and its closing checks:

```
GATE PASS folder=platform lane=code
PASS: secret-scan files=332
ℹ pass 4
ℹ fail 0
```

`npx vitest run --reporter=verbose` in `platform/dispatcher`, exit 0. Each criterion above is proved by these tests, quoted as the reporter printed them:

```
✓ test/select.test.ts > runnable > runs only horizon now cards
✓ test/select.test.ts > runnable > keeps the platform code lane closed and every other lane open
✓ test/tick.test.ts > tick > runs no platform code card and no card off horizon now
✓ test/throttle.test.ts > planStart > starts a card whose own full bar is its only money, with a budget of that bar (A of a $20 pool of two $10 bars)
✓ test/throttle.test.ts > planStart > starts a lone fully funded card whose bar is the whole pool
✓ test/throttle.test.ts > planStart > keeps a partly filled card bar from another card
✓ test/tick.test.ts > tick > starts a card on its own bar and keeps another card bar from it
✓ test/throttle.test.ts > planStart > does not let an overspent paused card raise what is available
✓ test/throttle.test.ts > holdUsd > reads spend from the studio-billed sum, so founder-billed turns in actual_usd free no bar money
✓ test/throttle.test.ts > planStart > holds nothing for a gated card, so its finished session frees the pool
✓ test/throttle.test.ts > planStart > counts a building card as what its session may still spend, which shrinks as it spends
✓ test/tick.test.ts > tick > holds what a building session may still spend, and nothing for a gated card, in unattended mode
✓ test/throttle.test.ts > planStart > lets an S1 card start on the incident reserve, and puts the reserve in its budget
✓ test/throttle.test.ts > planStart > Console credit > bounds the budget by the credit left: a $50 pool with $10 of credit gives at most $10
✓ test/throttle.test.ts > planStart > Console credit > counts studio and overhead spend and the running sessions against the credit
✓ test/tick.test.ts > tick > bounds an unattended budget by the Console credit left: a $50 pool with $10 of credit gives at most $10
✓ test/tick.test.ts > tick > sleeps on the Console credit, counting studio and overhead rows, and alerts once per purchase
✓ test/throttle.test.ts > planStart > monthly cap > starts nothing once the month-to-date spend reaches the cap
✓ test/throttle.test.ts > planStart > monthly cap > starts nothing when studio_state has no monthly cap
✓ test/tick.test.ts > tick > starts nothing once the month-to-date studio spend reaches the monthly cap, and alerts once
✓ test/throttle.test.ts > planStart > daily cap > bounds the budget by the cap left: $99 spent of $100 gives at most $1
✓ test/throttle.test.ts > planStart > daily cap > counts what running sessions may still spend against the cap
✓ test/throttle.test.ts > planStart > daily cap > measures the cap against the day-start balance, so spending today does not shrink it
✓ test/throttle.test.ts > planStart > daily cap > reports an empty pool as insufficient_balance, never as the daily cap
✓ test/throttle.test.ts > concurrency > gives one slot in unattended mode below twice the hourly rate, so a pool under $5 still runs a card
✓ test/throttle.test.ts > concurrency > gives two slots once the balance covers two hours
✓ test/tick.test.ts > tick > starts a runnable card in unattended mode with a pool under the hourly rate
✓ test/tick.test.ts > tick > starts a card in attended mode with an empty pool, over the cap, with no credit and above the balance, on its full ceiling
✓ test/session-money.test.ts > the session budget > gives an attended session its whole remaining ceiling
✓ test/session-money.test.ts > the session budget > passes the throttle budget to the adapter and stops at it, below the ceiling, as outcome budget
✓ test/session-money.test.ts > the session budget > maps the command line stopping at a budget below the ceiling to outcome budget
✓ test/session-money.test.ts > the session budget > starts no session when the throttle left nothing, so the card is not refused
✓ test/pipeline.test.ts > runCardPipeline > gives the session the budget the tick set, and sends the card back to funded when that budget is gone
✓ test/session-money.test.ts > API errors > meters nothing for a <synthetic> turn and does not stop the session as an unknown model
✓ test/probe-core.test.ts > an API error in the probe > is transient, and its <synthetic> turn is never metered or named as a missing model
✓ test/session-money.test.ts > API errors > stops as credit_exhausted when a <synthetic> turn says the credit balance is too low, and writes nothing for it
✓ test/session-money.test.ts > API errors > stops as credit_exhausted on an adapter error event about the Console limit
✓ test/session-money.test.ts > API errors > does not treat the agent writing about credit in its own reply as an API error
✓ test/pipeline.test.ts > runCardPipeline > pauses the studio and the card, keeping its money, when the API says the Console credit ran out, and nothing more is claimed
✓ test/session-money.test.ts > request ids and premium tiers > writes a turn under the request id its adapter named
✓ test/session-money.test.ts > request ids and premium tiers > prices a turn at a premium tier at the table highest rates, runs on, and alerts
✓ test/pipeline.test.ts > runCardPipeline > pauses the card, unmerged, when the board pauses the studio during the gate wait
✓ test/pipeline.test.ts > runCardPipeline > pauses a card moved off horizon now during the gate wait without merging it
✓ test/pipeline.test.ts > runCardPipeline > pauses a card vetoed during the gate wait without merging it
✓ test/pipeline.test.ts > runCardPipeline > leaves a card the board moved during the gate wait as the board set it, unmerged, and closes its pull request
✓ test/pipeline.test.ts > runCardPipeline > never overwrites a stage the board set during the session
✓ test/recovery.test.ts > recoverOrphans > leaves a card the board moved while recovery read it as the board set it
✓ test/pipeline.test.ts > runCardPipeline > sends a card back to funded, unmerged, when main moved while it was in the gate
✓ test/pipeline.test.ts > runCardPipeline > restores the previous green deploy when the deploy does not finish in time, since it may still publish
✓ test/netlify.test.ts > waitForDeploy > marks only a wait that ran out of time as timed out, since only that deploy may still publish
✓ test/pipeline.test.ts > runCardPipeline > alerts that the rollback is incomplete when main has moved past the merge
✓ test/tick.test.ts > tick > ticks only while it holds the lease: a second dispatcher claims nothing and does not ping until the lease lapses
✓ test/db.test.ts > createSupabaseDb queries > claims and releases the dispatcher lease through its functions
✓ test/role-model.test.ts > resolveRoleModel > takes the model from the env value of the role's token, over a stale roles.model
✓ test/role-model.test.ts > checkRoleModels > checks the price of the model each writing role resolves to, and logs a roles.model that /team shows wrongly
✓ test/session-money.test.ts > role models > runs on the model the role resolves to when the session starts, not a stale roles.model
✓ test/config.test.ts > the GitHub token > refuses a gh sign-in or classic token in unattended mode
✓ test/role-model.test.ts > startupChecks in attended mode > warns about a GITHUB_TOKEN that is not fine-grained, and runs no probe
✓ test/config.test.ts > the code, repository and worktree roots > puts card worktrees beside the clone by default, outside it
✓ test/config.test.ts > the code, repository and worktree roots > refuses a worktree root inside the clone, in every mode
✓ test/role-model.test.ts > the attended probe > is billed to the founder, never to the public overhead, so the founder's usage stays private
✓ test/probe-core.test.ts > judge > fails when the init line lists a forbidden tool
✓ test/probe-core.test.ts > judge > reads tool names from the init line only, so a reply that names a tool it lacks passes
```

The failed-revert test asserts the alert ends "The studio is paused until the board unpauses it." and that `studio_state.paused` is true.

## Production steps (need the board's allow)

1. Apply the DB workstream's migrations `20260922000000` to `20260922000300` before any dispatcher built from this change runs. Without `claim_dispatcher_lease` it stops at startup with that error. In unattended mode it also needs `credit_purchases` and `studio_state.monthly_cap_usd`, or no card starts.
2. On the Mac, stop any running dispatcher first.
3. Edit the Mac `.env`. `DISPATCHER_WORKTREE_ROOT` points inside the repository, which the dispatcher now refuses. Remove it, so worktrees go to `<clone>-worktrees`, or point it outside the clone.
4. Replace the Mac `.env`'s `GITHUB_TOKEN`. It is a gh sign-in token (`gho_`), which attended mode only warns about. The fine-grained token is the board's step in `docs/BOARD-SETUP.md`.
5. After any `MODEL_*` change in `.env`, restart the dispatcher, then re-seed the roles so /team shows the model the dispatcher resolves.

## Decisions

- 22 September 2026: the throttle uses one hold formula (F24): other cards' unspent bars and running sessions' remaining budgets are held, and gated cards hold nothing. Selection is on what a card still needs; the ceiling bounds the budget, not the selection.
- 22 September 2026: the money rules, the credit bound, the monthly cap and the daily-cap bound apply in unattended mode only (F26). Attended sessions are billed to the founder and keep their whole remaining ceiling.
- 22 September 2026: a missing `studio_state.monthly_cap_usd` counts as a cap of nothing, so unattended mode starts no card until the board sets one. The cap is a kernel spend cap, so it fails closed.
- 22 September 2026: a credit or Console-limit API error is recognised by its text: the Anthropic credit-balance message, the Console usage-limit message, or `billing_error`. It is read from `<synthetic>` turns, error events and error results, never from the agent's own replies. The session pauses the studio and the card. Other API errors fail the card as before.
- 22 September 2026: a fast or priority turn is priced at the price table's highest rates, and so is the rest of its model's session, and the board is alerted. The table holds standard rates only, so the alert says the true price may be higher. The CLI is never asked for a premium tier.
- 22 September 2026: when main moves during the gate, an attended card goes back to funded and runs a new session on the founder's plan. For an unattended card, re-applying the stored patch without a new session is the MANAGED workstream's.
- 22 September 2026: card worktrees are refused inside the clone in every mode, not only attended, since the VPS already keeps them outside.
