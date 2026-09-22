# Sweep, 22 September: obvious bugs and site fixes

Status: built. Card: none. Owner: board.

## Problem

A read-through of the site, the Supabase code, the ops scripts, the gate and seed-1 found bugs and copy or layout slips that break DESIGN.md and COPY.md. This spec covers only the ones with one obvious fix and no product call.

## Scope

In: the fixes listed under Behaviour.
Out, listed for the board in `docs/BOARD-SETUP.md`: gate hardening (config lane skips the strings check; a NUL byte hides a file from the scanners; `seed-1/sim/hash.ts` and `rng.ts` not kernel-protected; awk reads a root file named `a=b` as an assignment), all kernel changes. Seed-1 unlock counting, which is game code for a card. The deploy detail line, the footer line, card titles in production, and "In the gate", which need a call. The ledger-identity race and the null-session refund edge, which need a migration or a production read.

## Behaviour

- A shipped card's date and its place in Shipped and "Latest shipped" come from `live_at`, so a refund or a held release after shipping no longer moves it (falls back to `updated_at`).
- On /board, pausing or resuming refreshes the studio status straight away, so it never says "running" beside "Agents paused."
- Netlify rebuilds the site when `tsconfig.base.json` or `pnpm-workspace.yaml` changes.
- A failed load says "Not available right now." instead of "not available yet".
- Dates read "15 Sep 2026", never "Sept".
- Landing and ledger copy drop the inside terms "turn" and "the pool", and the sixth fixed rule is a sentence.
- The wordmark, footer links and the brief disclosure are 44px targets; filter chips have a 3:1 border; the choice label gap uses `--space-1`.
- Each page with a header names itself in the tab: "Ledger · Peanut Gallery".
- `deploy.sh` and `provision.sh` refuse a dangling symlink in the code clone.
- `pnpm seed -- --week1-test` works as documented; `--run` with no value is a usage error.
- The Stripe webhook labels a failed credit-then-reverse as `apply_contribution failed`, and a dry run with bad amounts answers a JSON 500. Takes effect on the next `stripe-webhook` deploy.

## Acceptance criteria

- [x] `shippedOrder` orders by `live_at` (test in `cards.test.ts`).
- [x] `check_code_clone` refuses a dangling link (test in `ops.test.mjs`).
- [x] `parseSeedArgs` skips `--` and refuses a bare `--run` (tests in `seed-args.test.ts`).
- [x] At 375px the wordmark and footer links measure 44px, with no horizontal scroll; /ledger's tab title is "Ledger · Peanut Gallery".

## Verification

- `pnpm verify`
- Local preview at 375px, measured in the browser.

## Evidence

- `pnpm verify`: exit 0. Site 163 tests, Supabase 146, dispatcher 374, seed-1 77, ops 41 with shellcheck running, secret scan PASS.
- Preview at 375px: `wordmark 44`, `footer [44,44,44,44]`, `overflow false`; /ledger title `Ledger · Peanut Gallery`; no console errors.

## Decisions

- 2026-09-22: the dangling-link check uses `find ! -exec test -e`, not `readlink -e`, because macOS `readlink` has no `-e` and the ops tests run on the Mac.
