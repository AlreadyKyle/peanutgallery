# Build on funding

Status: built. Card: none. Owner: board.

## Problem

A funded card could not build until a Console credit purchase was recorded at /board: the dispatcher bounded every start by recorded credit, and with none recorded it slept on `console_credit` and alerted. The studio key already holds Console credit and the dispatcher already runs unattended on GitHub Actions, so the record was the only thing between a player's contribution and a build.

## Scope

In: removing the payout-timing line from /contribute and /thanks and restoring home's "the agents build it" (`specs/announce-now.md`); the dispatcher's start check and its credit-shortfall alert; the Controller's console_credit mismatch; PLAN.md §10 decision 65, ROADMAP, BOARD-SETUP.
Out: the daily, monthly, per-card and usage-tier caps, which stand; the real API refusal on an empty Console balance, which still pauses the studio (`credit.ts`); the /board purchase form, which stays.

## Behaviour

- In unattended mode a funded card starts with no Console credit recorded; its budget is bounded by the card ceiling, the pool and the caps.
- No "Console credit needed" alert is sent from the recorded total.
- The Controller reports no console_credit mismatch.

## Acceptance criteria

- [x] `planStart` returns ok with no credit recorded, and `bounds.creditUsd` is Infinity (`test/throttle.test.ts`).
- [x] `tick` starts a funded card unattended with no credit recorded and sends no alert (`test/tick.test.ts`).
- [x] The Controller's reconcile no longer lists console_credit (`platform/ops/test/jobs.test.mjs`).
- [ ] Live: a player-funded card claimed by the dispatcher on Actions.

## Verification

- `pnpm verify`
- the next dispatcher run on Actions after the merge starts from main with this change
- the ops repository's `STUDIO_REF` set to the merge commit

## Evidence

In the pull request.

## Decisions

- 2026-10-07: funded cards build as soon as they are funded (PLAN.md §10 decision 65).
