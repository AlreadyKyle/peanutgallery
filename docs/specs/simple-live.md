# No founding label, no launch line

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

The board wants the studio to read as simply running. The site still split supporters into "Founding supporter n" and "Supporter n" by a launch stamp, the board's site said "Not live yet" or "Live since", and four /team lines said a role starts "after launch" or "at the cutover".

## Scope

In: the supporter label on the card pages, the reports and /thanks; the board site's launch line; the trigger lines of Biz Dev, Head of Finance, Head of Product and Tech Artist (role files and prompts); PLAN.md §10 decision 63, ROADMAP.md and BOARD-SETUP.md.

Out: the database. The `supporters.founding` column, `studio_state.launched_at`, its trigger and `set_launched` stay as they are and nothing public draws them. Posted Terms versions are not edited. The pause, the kill switch and every money rule are unchanged.

## Behaviour

- Every supporter shows as "Supporter n", whatever `founding` holds. /thanks says "You are Supporter n."
- The board's Studio status has no launch line.
- /team's later roles read: "Starts last, once every other role is built.", "Starts once the first Stripe payout has bought the agents' model credit.", "Starts with a first review, then runs monthly and after any big change.", "Starts at the first visual card." Production picks these up from the idempotent seed.

## Acceptance criteria

- [x] `supporterName` returns "Supporter n" for a founding supporter (`Supporters.test.tsx`), and /thanks shows no "Founding" (`e2e/thanks.spec.ts`).
- [x] `legal.foundingSupporter` and `legal.thanks.youAreFounding` are gone.
- [x] The board's site shows no "live yet" or "Live since" line, stamped or not (`Board.test.tsx`).
- [x] No role file says "launch" or "cutover" in its trigger.
- [ ] Production: the seed run, the site and board deployed, and the live check passes.

## Verification

- `pnpm verify`
- `E2E_PORT=4450 npx playwright test e2e/thanks.spec.ts e2e/card.spec.ts e2e/reports.spec.ts e2e/team-status.spec.ts` in `platform/site`
- `pnpm --filter @backseat/supabase seed`, then `node platform/site/scripts/live-check.mjs https://mobmachine.games`

## Evidence

## Decisions

- 2026-10-06: drop the founding label and every launch line (the board). The studio runs or the site is down; no launch moment to explain.
