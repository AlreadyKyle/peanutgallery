# The optional board panel

Status: built. Card: none. Owner: board.

The board's site under `docs/PLAN.md` §10 decision 66 (10 October 2026, the board): the studio never waits on a board member, so the board's site becomes a minimal, optional admin and debug panel, like a hosting dashboard. It is a board pull request: `platform/board` is kernel. It supersedes the Needs you inbox of `docs/specs/board-site.md` and the deferred triage model of `docs/specs/simple-board.md`. The runtime it relies on is `docs/specs/unattended-roles.md`.

## Problem

The board's site is one long page built around Needs you, a heartbeat that attended runs depend on, and a control for every board function: horizons, ranks, targets, vetoes, the cooling window, directives, notes, role pauses, the caps form, Rank now and the draft buttons. With the studio running unattended, almost none of that is the board's job any more, and the page reads as if the studio waits on it.

## Scope

In: `platform/board` (its pages, `src/lib/board.ts`, `src/lib/needs.ts`, its unit and e2e tests), and the docs that describe the panel.
Out: any migration (every database function stays, the ones the panel stops calling included); the public site; the Content Security Policy, which is unchanged; sign-in by magic link to `board_members`, with sign-ups off; the moderator's pause rights.

## Behaviour

- **Sign-in.** A Supabase Auth magic link, as today. The TOTP second factor is asked once per sign-in: at the first factor (aal1) a board member sees only the code step, and nothing else renders. The moderator, whose rights are pause only, sees Pause at the first factor.
- **Status**, the first screen: running or paused, with the pause reason; when the dispatcher was last seen (`dispatcher_seen_at`); the caps, read-only, with a line that they change by SQL; the card supply line from `card_supply()`.
- **Activity**: the recent cards with their stage and failing check; the recent job runs with origin, status and reason; the Janitor's open findings; and, for one chosen card, the tail of its `public_agent_events`.
- **Actions**: Pause and Resume (`set_paused`, the kill switch); File a card (`file_card`, with its horizon); Reject a card (`cancel_card`, with a reason); Resume a paused card (`resume_card`, with a new estimate); Record a credit purchase (`record_credit_purchase`, optional, still stamping `launched_at` the first time); Run a job now (`enqueue_manual_job` with input `{}`, a debug control).
- **Gone from the site**: Needs you, the heartbeat, the agent mode, horizon, rank and target edits, vetoes, the cooling window, directives, notes, the role table and role pauses, the caps form, Rank now and the draft buttons. The panel calls none of `board_needs_you`, `board_heartbeat`, `set_agent_mode`, `set_card_horizon`, `set_card_veto`, `set_cooling_window`, `set_role_pause`, `set_caps`, `file_directive` or `file_note`; they stay in the database, uncalled.
- The standing duties reach the board by ntfy, email and GitHub, not through the panel (`BOARD-SETUP.md`, Your standing duties).

## Acceptance criteria

- [x] Signed in at the first factor, a board member sees only the code step, and no control that changes state renders or can be called from the page.
- [x] The moderator at the first factor sees Pause and nothing else that changes state.
- [x] After the code, the first screen is Status with the pause state and reason, the dispatcher last seen, the caps read-only and the supply line.
- [x] Activity shows the recent cards with stage and failing check, the recent job runs, the open findings and one card's public agent events.
- [x] The Actions are exactly Pause and Resume, File a card, Reject a card, Resume a paused card, Record a credit purchase and Run a job now.
- [x] No file under `platform/board/src` calls `board_heartbeat`, `board_needs_you`, `set_agent_mode`, `set_card_horizon`, `set_card_veto`, `set_cooling_window`, `set_role_pause`, `set_caps`, `file_directive` or `file_note`.
- [x] The board site's Content Security Policy is byte for byte what it was.
- [x] The pull request adds no migration.

## Verification

- `pnpm --filter @backseat/board test`
- `BOARD_E2E_PORT=<port> pnpm --filter @backseat/board e2e`
- `git grep -n -E "board_heartbeat|board_needs_you|set_agent_mode|set_card_horizon|set_card_veto|set_cooling_window|set_role_pause|set_caps|file_directive|file_note" platform/board/src` prints nothing.
- `git diff origin/main -- platform/board/netlify.toml platform/supabase/migrations` prints nothing.
- `pnpm verify`
- After merge: the board site deploys, and the board signs in once and sees Status (waits on: the board).

## Evidence

Run on 10 October 2026 on the pull request's branch (`board/minimal-panel`), main at f323274 merged in.

- `pnpm --filter @backseat/board test`: `Test Files  3 passed (3)`, `Tests  51 passed (51)`. `src/Board.test.tsx`: "the first factor (aal1)" renders only the Two-factor region, and after four 15 s polls the calls are `board_role` alone, with no state-changing RPC and no `board_studio_state`, `board_jobs` or `card_supply` (criterion 1); "the moderator" sees only Pause and resume and calls `board_role` and `set_paused` alone (2); "Status" (3); "Activity", including the `public_agent_events` read filtered by the card's id, newest first, limit 50 (4); "the panel at aal2" lists exactly the six actions, and after every part is used no retired RPC, `board_roles` or `card_is_public` was called and no Needs you, Roles, Cooling window, File a directive, File a note or Set the caps region exists (5, 6); "Actions" covers each RPC's arguments and a busy button kept focusable; "the sources" checks that no file under `src` names a retired RPC and no control is disabled only because it is busy. `src/lib/board.test.ts` covers the reads and calls one by one; `src/site-config.test.ts` is unchanged (7). Mutating `Board.tsx` to show the panel at aal1 fails the three aal1 tests.
- `BOARD_E2E_PORT=4460 pnpm --filter @backseat/board e2e`: `7 passed (3.4s)`. Under the enforced policy: the headers test (the CSP string, 7); sign-in at 375 px; the connect-src refusal; at aal1 only the Two-factor section, the QR code as a `data:` image, and no `/rest/v1/` request but `board_role` (1); at aal2 Status (paused, "Reason: A problem we are checking.", the dispatcher, the caps and the SQL line, the supply line), Activity (a recent card with its failing check, a run line, the findings link, the events request with `card_id=eq.`), Reject from the keyboard with the confirm accepted and focus kept, Resume a paused card, the File a card and Run a job now bodies (`p_stage` `proposed`, `p_input` `{}`), no overflow, no policy report and no retired RPC (3 to 6); the 16 px rhythm and the pause reason's focus ring at 375, 768 and 1440 px for the moderator and a board member at aal2 (2).
- The `git grep` of the retired RPC names over `platform/board/src` prints nothing (exit 1) (6).
- `git diff origin/main -- platform/board/netlify.toml platform/supabase/migrations` prints nothing (7, 8).
- `pnpm verify`: exit 0, with `GATE PASS folder=seed-1 lane=code` and `GATE PASS folder=platform lane=code` (the board's typecheck and its 51 tests among them).
- `board_studio_state` returns no pause reason, so Status reads it from `public_studio`, the view made for it (`docs/specs/money-logic.md`); no migration.
- Left: after merge, the board site deploys and the board signs in once and sees Status (waits on: the board).

## Decisions

- 2026-10-10: the board's site is an optional panel; its first screen is Status, not Needs you (PLAN.md §10 decision 66).
- 2026-10-10: caps change by SQL (`BOARD-SETUP.md`, Pause when the board site is down) rather than by a form, so the panel holds no money setting beyond Pause.
- 2026-10-10: no migration; the database functions the panel stops calling stay, so a later panel or a script can still call them.
