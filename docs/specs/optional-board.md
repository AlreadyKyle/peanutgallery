# The optional board panel

Status: agreed. Card: none. Owner: board.

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

- [ ] Signed in at the first factor, a board member sees only the code step, and no control that changes state renders or can be called from the page.
- [ ] The moderator at the first factor sees Pause and nothing else that changes state.
- [ ] After the code, the first screen is Status with the pause state and reason, the dispatcher last seen, the caps read-only and the supply line.
- [ ] Activity shows the recent cards with stage and failing check, the recent job runs, the open findings and one card's public agent events.
- [ ] The Actions are exactly Pause and Resume, File a card, Reject a card, Resume a paused card, Record a credit purchase and Run a job now.
- [ ] No file under `platform/board/src` calls `board_heartbeat`, `board_needs_you`, `set_agent_mode`, `set_card_horizon`, `set_card_veto`, `set_cooling_window`, `set_role_pause`, `set_caps`, `file_directive` or `file_note`.
- [ ] The board site's Content Security Policy is byte for byte what it was.
- [ ] The pull request adds no migration.

## Verification

- `pnpm --filter @backseat/board test`
- `BOARD_E2E_PORT=<port> pnpm --filter @backseat/board e2e`
- `git grep -n -E "board_heartbeat|board_needs_you|set_agent_mode|set_card_horizon|set_card_veto|set_cooling_window|set_role_pause|set_caps|file_directive|file_note" platform/board/src` prints nothing.
- `git diff origin/main -- platform/board/netlify.toml platform/supabase/migrations` prints nothing.
- `pnpm verify`
- After merge: the board site deploys, and the board signs in once and sees Status (waits on: the board).

## Evidence

Added when the status moves to built.

## Decisions

- 2026-10-10: the board's site is an optional panel; its first screen is Status, not Needs you (PLAN.md §10 decision 66).
- 2026-10-10: caps change by SQL (`BOARD-SETUP.md`, Pause when the board site is down) rather than by a form, so the panel holds no money setting beyond Pause.
- 2026-10-10: no migration; the database functions the panel stops calling stay, so a later panel or a script can still call them.
