# The moderator pauses only, and every pause is logged

Status: built. Card: none. Owner: studio.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

PLAN.md §4 The Board gives the moderator pause rights only, but `set_paused` let the moderator lift any studio pause at the first factor: an incident, the dispatcher's `awaiting_credit` and `spend_limit` pauses, and the board's own. A resume left no record, since it clears `paused_by` and `paused_at`. On the board's panel one stray tap on Resume lifted the kill switch with no question (the full pass's findings T8 and T10; the board's call is §10 decision 77).

## Scope

In: migration `20261019010000_moderator_pause_only.sql` (the resume rule in `set_paused`, the table `studio_pause_log` and the trigger that writes it); the board's panel (`platform/board/src/Status.tsx`, `Board.tsx`): no Resume for the moderator, a confirm before the board's Resume; the anon negative test's private tables; the line in `docs/specs/launch-pages.md` that said the moderator resumes.
Out: role pauses (`set_role_pause` already lets only the board resume a role); `dispatcher_resume_studio`, which still lifts the dispatcher's own money pauses once a credit probe passes (§10 decision 66); a panel view of the log (the board reads it through the API or SQL); the public site, which shows no pause (§10 decision 62); `studio_state.kill_switch_fired_at`, unchanged.

## Behaviour

**Who pauses and who resumes.**
- `set_paused(true, reason)` is unchanged: the board at the second factor, the moderator at the first, with the reason `awaiting_credit`, `spend_limit`, `incident` or `board` (the default).
- `set_paused(false)` is the board's alone, at the second factor, the check the board's other actions use. The moderator is refused with "Only the board resumes the studio" at either factor; a board member at the first factor with "A second factor is required"; anyone else with "Board or moderator membership is required". The signature and grants are unchanged, so the deployed board site's `set_paused({p_paused})` still resolves.

**The pause log.** `public.studio_pause_log` holds one row for each change of `studio_state.paused`, whoever makes it: `set_paused`, the dispatcher's own pause and `dispatcher_resume_studio` with the service role's key, or a statement in the SQL editor (`BOARD-SETUP.md`). A pause taken over (a new holder or a new reason while the studio is paused) is a row too, because it changes whose pause stands. A pause pressed again by its holder with the same reason, and the dispatcher's heartbeat, write no row. Each row has:
- `action`: `paused` or `resumed`;
- `actor`, who: the signed-in email, else the pause's own `paused_by` (the dispatcher writes "dispatcher: ...", the SQL editor statement "sql-editor"), else the caller's role (`service_role`) or the database user;
- `actor_role`, which role: `board` or `moderator` from `board_role()`, `dispatcher` for the service role's key, `database` for SQL run as the database's own user (the SQL editor, a migration, pg_cron);
- `pause_reason`: the reason set, or for a resume the reason of the pause it lifted;
- `created_at`.

An after trigger on `studio_state` (`studio_pause_logged`, security definer) writes the row, so no caller needs a grant on the log. The log starts when the migration runs: a pause already in force then has no row of its own, and its resume names its reason. The log is append-only: the `refuse_money_change` triggers refuse every update, delete and truncate, the database owner's included, and no role holds more than select on it. The board and the moderator read it at either factor (row level security through `is_board_member()`); anon is refused, a signed-in outsider reads no row, and the backup role reads it like every table.

**The board's panel.**
- The moderator sees Pause the agents with the reason and Pause agents, no Resume, and the line "Only the board can resume them, at the second factor."; its section is named Pause.
- The board's Resume asks first: "Resume the agents? This lifts the pause whatever its reason, an incident or a spend limit included, and funded cards can start again at the next dispatcher tick." Dismissed, nothing is sent. Pause never asks.
- The section's line no longer says the public site shows the pause, which it has not since §10 decision 62.

## Acceptance criteria

- [x] The moderator pauses at the first factor with a reason, and `set_paused(false)` refuses the moderator at aal1 and aal2, by position and by name, leaving the studio paused (`platform/supabase/functions/_shared/moderator_pause_only_test.ts`, `migration_test.ts`).
- [x] The board resumes only at aal2; an outsider, a signed-out caller and anon can neither pause nor resume (`moderator_pause_only_test.ts`).
- [x] The moderator cannot lift the dispatcher's `awaiting_credit` or `spend_limit` pause, and `dispatcher_resume_studio` still can (`moderator_pause_only_test.ts`).
- [x] Every pause and resume writes one row naming who, which role, the action and the reason: the moderator's and the board's through `set_paused`, the dispatcher's through the service role, and the SQL editor's statement and a SQL resume as the database; a takeover writes one row, a repeated press and the heartbeat none (`moderator_pause_only_test.ts`).
- [x] The log refuses update, delete and truncate for the owner, and insert, update and delete for anon, authenticated and the service role; the board (at either factor) and the moderator read every row, an outsider none, and anon is refused (`moderator_pause_only_test.ts`, `money_safety_test.ts`).
- [x] The migration applies a second time, `set_paused` keeps one signature, and the log is in the table list, its trigger function in the privileges list (`moderator_pause_only_test.ts`, `migration_test.ts`).
- [x] The moderator's panel has Pause and no Resume and calls only `board_role` and `set_paused` (`platform/board/src/Board.test.tsx`, `e2e/board.spec.ts`).
- [x] The board's Resume asks the confirm, sends nothing when it is dismissed, and sends `{p_paused: false}` when it is accepted (`Board.test.tsx`, `e2e/board.spec.ts`).
- [x] `anon-negative-test.ts` probes `studio_pause_log` as a private table.

## Verification

- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/moderator_pause_only_test.ts platform/supabase/functions/_shared/migration_test.ts platform/supabase/functions/_shared/money_safety_test.ts platform/supabase/functions/_shared/money_logic_test.ts platform/supabase/functions/_shared/auto_resume_test.ts platform/supabase/functions/_shared/site_snapshot_test.ts`
- `pnpm --filter @backseat/supabase test`
- `pnpm --filter @backseat/board typecheck` and `pnpm --filter @backseat/board test`
- `BOARD_E2E_PORT=4462 npx playwright test` in `platform/board`
- `pnpm test:docs` and `pnpm secret-scan`
- `pnpm verify`
- After merge, the migration applied in production: `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts` passes with `studio_pause_log` refused, and the next pause from the board's site shows its row in `select action, actor_role, pause_reason from public.studio_pause_log order by id desc limit 1`.

## Evidence

Quoted in the branch's report.

## Decisions

- 2026-10-19: the moderator holds pause rights only; resuming the studio is the board's, at the second factor, as resuming a role already is (§10 decision 77).
- 2026-10-19: a trigger on `studio_state` writes the log rather than `set_paused`, so the dispatcher's own writes and a statement in the SQL editor are recorded too, and no writer can skip it.
- 2026-10-19: a takeover is logged as a pause, because it changes whose pause stands and so who can lift it: the dispatcher's credit probe lifts only a pause it set itself.
- 2026-10-19: the log reuses `refuse_money_change`, the guard `card_approvals` and `terms_versions` already share, rather than a second copy of it.
- 2026-10-19: both the board and the moderator read the log at the first factor: reading it changes nothing, and the moderator should see who lifted a pause it set.
- 2026-10-19: Resume asks first and Pause never does: a pause is always safe to press, a resume lifts the kill switch.
