# The board's games and agents admin

Status: agreed. Card: none. Owner: studio.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

The board's Games and agents section (`20261017210000_board_roster.sql`, `platform/board/src/Roster.tsx`) only reads. The database has no record of a game beyond its card folder, so the board cannot say a game is paused or in development, stop it taking new cards, choose the featured game or edit its public blurb, and the panel said so in a line. The Agents tab lists every role but not its place on the roster (running, starts later, planned), its public profile, its spend against the studio's caps or the history of its pauses, though the database holds all of them.

## Scope

In: a migration that adds `public.games` (one row per game folder, seeded with Dust) and its public view `public_games`; four board writes (status, taking new cards, featured, blurb), each at the second factor and logged with its reason in the moderation log; `board_games()` and `board_agent_roster()` recreated with the new fields; `enqueue_supply_draft()` recreated so the card supply queues no draft while Dust takes no new cards; the board's Games and Agents tabs; Deno tests on PGlite, the board's unit tests and its e2e.
Out: the public site (it can read `public_games` in a later change; nothing on it changes here); a games row for a new game folder (a new folder is a `card_folder` value, added by its own migration, and the board's first write creates its row); editing a role's profile, model, tools or budget share, which come from its file in `platform/agents` and change by pull request; any per-role spend cap (none exists; `budget_share` stays a planning figure, `docs/specs/agent-system-core.md`); any change to a money rule, cap, split, reserve or the ledger, which this change only reads.

## Behaviour

`public.games` holds, per folder (every `card_folder` but `platform`): name, status (`live`, `paused` or `in_development`), `accepting_cards`, `featured` (a unique partial index keeps it to one game), blurb (one line, at most 280 characters), play address, box art path, and the two `play_counts` events that count the game's loads and shares. Row level security is on with no policy; anon and authenticated hold nothing on the table, the service role reads it, and only the board's functions write it. The seed row is Dust: live, featured, taking new cards, the home page's line as its blurb, `https://play.mobmachine.games`, `/games/dust-box-art.svg`, `dust_load` and `dust_share`. `public_games` shows folder, name, status, accepting_cards, featured, blurb, play address and box art to anyone.

The board's writes, each for a board member at aal2 only (a moderator, an outsider, an aal1 session and anon are refused, the service role cannot execute them) and each writing one append-only `community.admin_log` row (actor, action, target `game:<folder>`, reason of 1 to 500 characters, from and to) before it changes the row:

- `board_set_game_status(folder, status, reason)`: action `set_game_status`.
- `board_set_game_accepting(folder, accepting, reason)`: `open_game_cards` or `close_game_cards`.
- `board_set_game_featured(folder, featured, reason)`: `feature_game` or `unfeature_game`; featuring one game unfeatures the other in the same transaction, and the log and the answer name it.
- `board_set_game_blurb(folder, blurb, reason)`: `set_game_blurb`; more than 280 characters is refused, the text is cleaned as community text is (`community.clean_text`: no links, markup or line breaks) and must pass the content filter (`community.text_allowed`); an empty blurb clears it.

A folder that is not a game (`platform`, an unknown name) is refused. A game folder with no row gets one on its first write.

`board_games()` adds to each game its row (a folder with no row reads as itself, in development, taking new cards, not featured), its loads and shares today, in 7 days, in 30 days and in all (UTC days, from `play_counts`), and its five newest moderation-log entries. `board_agent_roster()` adds each role's description, species note, avatar, status and trigger, budget share, `caps` (its studio- and overhead-billed spend this New York day and month, the studio's for the same periods, and `studio_state`'s daily and monthly caps), its runs over 7 days by outcome with the last run's time, and its five newest pauses and resumes from `board_actions`. Neither returns a run's input or output.

`enqueue_supply_draft()` answers `{queued: false, reason: 'game_paused'}` and queues nothing while seed-1 (the folder every supply draft opens its card in) does not accept new cards; otherwise it is unchanged. `supply_draft_check()` and `public_supply()` are unchanged, so the site's drafting line reads idle, and the dispatcher's supply watch, which alerts only for the reasons it knows, stays quiet: stopping a game is the board's own act. A draft the board queues by hand (Run a job now) still runs, and cards already open carry on.

The board's Games tab shows each game's tile: box art, name and a Featured badge, status and whether it takes new cards, the play link, the blurb, deploy health and the newest deploy, loads, shares, open and shipped cards, a Manage section (Status select and Set status, Stop new cards or Take new cards, Feature or Unfeature, the blurb field with its count to 280 and Save blurb or Clear blurb) and Recent changes. One reason field serves every game; with it empty, or while a write runs, every button is marked aria-disabled and calls nothing. After a write the tab reads `board_games` again and says what happened.

The Agents tab groups roles as Running, Starts later, Planned, then any with no roster status, then Retired, under a line counting them and the roles turned off. Each role shows its description, roster status with its trigger, on or off with the reason and since when, species note, model and class, tools, write access, spend, spend against the caps ("$1.50 of the studio's $3.00 today, 2% of the daily cap of $100.00; ..."), budget share marked as a planning figure, jobs, runs over the last day and 7 days, recent runs, and the pause history. Turn on and Turn off are unchanged (`set_role_pause`, a reason of at most 200 characters).

## Acceptance criteria

- [ ] `20261017220000_board_games_admin.sql` creates `public.games` with RLS on, no grant to anon or authenticated, the folder, status, blurb, address, art and event checks, at most one featured row, and the Dust seed row; it applies twice without error and keeps the board's changes.
- [ ] `public_games` is readable by anon with exactly folder, name, status, accepting_cards, featured, blurb, play_url and box_art; the migration test's anon grants and view list name it.
- [ ] Each of the four writes refuses aal1, a moderator, an outsider and anon (permission denied), the service role cannot execute it, a refused call writes no log row, and each accepted call writes one `community.admin_log` row with the reason before its change.
- [ ] Featuring a game unfeatures any other; a blurb over 280 characters or failing the content filter is refused; a blurb is cleaned of links, markup and line breaks; an empty blurb clears it.
- [ ] `board_games` returns each game's row, loads and shares by period and five newest log entries; a folder with no row lists as in development.
- [ ] `board_agent_roster` returns each role's profile, status, trigger, budget share, caps (studio- and overhead-billed rows only), 7-day runs and pause history, and no run input or output.
- [ ] `enqueue_supply_draft` queues nothing and answers `game_paused` while seed-1 takes no new cards, and queues again once it does.
- [ ] The Games tab reads nothing until chosen, shows every field above, and sends each write with its contract body only with a reason; the Agents tab groups the roles and shows every field above.
- [ ] No money rule, cap, split, reserve or ledger row changes; the ledger and `board_actions` are only read.

## Verification

- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/board_games_admin_test.ts platform/supabase/functions/_shared/board_roster_test.ts platform/supabase/functions/_shared/migration_test.ts platform/supabase/functions/_shared/supply_refill_test.ts platform/supabase/functions/_shared/supply_every_minute_test.ts`
- `pnpm --filter @backseat/board typecheck` and `pnpm --filter @backseat/board test`
- `BOARD_E2E_PORT=<port> npx playwright test e2e/board.spec.ts` in `platform/board`
- `pnpm verify:changed`
- After merge: `20261017220000_board_games_admin.sql` applied to production, the board's site deployed, then the Games tab shows Dust with its loads and a test change (a reason, Set status to live) appears in Recent changes and the Community moderation log.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-10-17: the game writes log to `community.admin_log`, the board's append-only moderation log, not `board_actions`, whose action list is a check constraint on a money-adjacent append-only table; the Community tab's Moderation log then shows them beside every other admin action.
- 2026-10-17: taking no new cards is enforced in `enqueue_supply_draft`, not `supply_draft_check`: the open drafting-budget pull request recreates `supply_draft_check`, and the queue is the one place a supply draft starts.
- 2026-10-17: a role's profile stays read-only on the board: the seed writes it from the role file, which is the source of truth, so an edit in the database would be overwritten.
