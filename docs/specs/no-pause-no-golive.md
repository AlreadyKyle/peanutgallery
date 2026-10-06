# No paused notice, no Go live button

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

The public site told every visitor the agents were paused, on home's status line and in a notice on /contribute, /how-it-works and /thanks, and /team marked every running role Paused. The board does not want that on the public site. The board's site also carried a Go live button whose only effect is stamping `studio_state.launched_at`, which decides who is a founding supporter; the board wants that stamp to follow a real event instead of a press.

## Scope

In: removing the paused notice and the paused sentence from every public page (home, /contribute, /how-it-works, /thanks, /team and the design guide), with their strings, tests, e2e specs and the live check; removing the Go live button from the board's site; a migration that stamps `launched_at` on the first credit purchase; PLAN.md §10 decision 62, ROADMAP.md, BOARD-SETUP.md and the specs that list Go live as a pending step.

Out: the pause itself (`studio_state.paused` and `pause_reason`, the board's and the moderator's Pause, the dispatcher honouring it, the kill switch), a role's own pause on /team, a card's own paused stage on /ledger and the card pages, the `set_launched` RPC (kept in the database, no longer called), `money.assign_supporter` (unchanged), and posted Terms versions (not edited).

## Behaviour

- No public page says the agents are paused, whatever `pause_reason` holds. Home's status line says only how many cards are open and building. /team shows every running role as running while the studio is paused; a role the board paused itself still shows Paused with its reason.
- The board's Studio status has no Go live button. Before the stamp it reads "Not live yet. The studio goes live on its own when the first agent credit purchase is recorded."; after it, "Live since …".
- When the first row is inserted into `public.credit_purchases` (by `record_credit_purchase` on the board's site, or the service role) while `launched_at` is null, a trigger sets `launched_at` to now(). A later purchase, or a stamp already set, never moves it. If a purchase was recorded before the migration and `launched_at` is still null, the migration backfills it to the first purchase's `created_at`.
- A supporter whose payment came before the stamp is founding, as before; so founding supporters are those who funded the studio before it bought its first agent credit.
- The public site reads `launchedAt` from `/api/live` but draws it nowhere, so nothing public changes when the stamp lands; /thanks keeps reading `founding` from `thanks_for_session`.

## Acceptance criteria

- [x] `PausedNotice.tsx` and `pausedSentence` are gone; no page imports them; `legal.pausedNotice`, `legal.pauseReasons` and `copy.team.runningPausedIntro` are gone.
- [x] Home's status line, /contribute, /how-it-works, /thanks and /team show no paused notice or sentence for every pause reason (unit tests and `e2e/paused.spec.ts`, `e2e/team-status.spec.ts`, `e2e/thanks.spec.ts`).
- [x] `live-check.mjs` fails a status line or a /contribute that says the agents are paused.
- [x] The board's site renders no Go live button and never calls `set_launched` (`Board.test.tsx`).
- [x] The first credit purchase stamps `launched_at`, a later one does not move it, a set stamp is kept, the backfill and a second apply work, and founding follows the stamp (`money_logic_test.ts`, the launch stamp).
- [x] `stamp_launched_at()` is a security invoker trigger function with no execute grant to anon or authenticated (`migration_test.ts` privileges, `money_logic_test.ts`), and anon-negative-test still lists `credit_purchases` as private.
- [ ] Production: `20261006000000_launch_stamp.sql` applied, the anon negative test passes, the site deployed, and the live check passes.

## Verification

- `pnpm --filter ./platform/site test`, `pnpm --filter ./platform/board test`
- `E2E_PORT=4450 npx playwright test e2e/paused.spec.ts e2e/team-status.spec.ts e2e/thanks.spec.ts e2e/pages.spec.ts e2e/layout-balance.spec.ts e2e/design.spec.ts` in `platform/site`
- `E2E_PORT=4460 npx playwright test` in `platform/board`
- `deno test ... money_logic_test.ts migration_test.ts`, `npx vitest run test/migration.test.ts` in `platform/supabase`
- `pnpm test:docs`, `pnpm secret-scan`, `pnpm verify`
- After merge: apply the migration to production, run the anon negative test, deploy the site, then `node platform/site/scripts/live-check.mjs https://mobmachine.games`.

## Evidence

Run on branch `launch/no-pause-no-golive`.

- Site unit tests (`pnpm test` in `platform/site`): "Test Files  47 passed (47)", "Tests  514 passed (514)".
- Site e2e, `E2E_PORT=4450 npx playwright test e2e/paused.spec.ts e2e/team-status.spec.ts e2e/thanks.spec.ts e2e/pages.spec.ts e2e/layout-balance.spec.ts e2e/design.spec.ts`: "2 skipped", "144 passed (1.9m)".
- Board unit tests: "Test Files  4 passed (4)", "Tests  105 passed (105)". Board e2e, `E2E_PORT=4460 npx playwright test`: "9 passed (4.0s)".
- Deno, `money_logic_test.ts` and `migration_test.ts`: "the launch stamp ... ok (1s)", "ok | 16 passed (96 steps) | 0 failed (17s)".
- `npx vitest run test/migration.test.ts` in `platform/supabase`: "Test Files  1 passed (1)", "Tests  187 passed (187)".
- `pnpm test:docs`: "ℹ tests 22", "ℹ pass 22", "ℹ fail 0". `pnpm secret-scan`: "PASS: secret-scan files=742".
- `pnpm verify`: exit 0; "GATE PASS folder=platform lane=code", "PASS: secret-scan files=742", dispatcher "Tests  878 passed (878)", supabase "Tests  329 passed (329)", functions "ok | 131 passed (243 steps) | 0 failed (45s)".
- Terms check: no posted Terms or Refunds version promises a paused notice; both say only "No card has a delivery date, because the agents work only while the studio is not paused." (`terms-versions.ts`), left unedited.

## Decisions

- 2026-10-06: the board decided no paused notice on the public site and no Go live button; the launch time is stamped by the first credit purchase (PLAN.md §10 decision 62).
- 2026-10-06: a role's own pause stays on /team, and a card's paused stage stays on /ledger and the card pages: they are about one role or one card, not the studio's pause. The Janitor's fact line "Runs every day, also while the studio is paused." stays; it describes the role, not the studio's state.
- 2026-10-06: the trigger stamps with now(), as the board asked; the backfill uses the first purchase's `created_at`, the moment the trigger would have stamped.
