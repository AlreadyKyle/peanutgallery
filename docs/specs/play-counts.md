# Play and share counts without tracking

Status: agreed. Card: none. Owner: studio.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

Nothing counts plays, shares or the step from a play to a card, so the studio cannot see what turns players into supporters (`docs/VISION.md`, Growth). The backlog entry "Play and share counts without tracking" (Later, rank 54) asked for aggregate daily counters with nothing that identifies a player.

## Scope

In: four daily counters (Dust loads, Share your run presses, card share presses on the site, clicks from Dust's next card line to a card); a migration with the counts table, the public counter function and the panel's read; the site's `/api/count`; the game's proxy of that path; the board's panel section; the Privacy page's section.
Out: any per-visitor record, cookie, local storage key, identifier, fingerprint, IP address or user agent; unique visitors, sessions, play length or one person's path from a play to a payment, which need an identifier and are left out by design; any public figure from the counts; a third-party analytics service; deduplication or bot filtering beyond the existing rate limit.

## Behaviour

Four events, and only these: `dust_load` (the Dust page opens), `dust_share` (Share your run is pressed), `card_share` (Share this card is pressed on a card's page or /thanks), `dust_next_card` (the next card line under Dust is clicked through to its card).

Each press or load sends one fire-and-forget POST of `{"event": "<name>"}` to `/api/count` on the page's own origin: `navigator.sendBeacon`, else `fetch` with `keepalive` and no credentials. Nothing waits on it, a failure is dropped, and the page behaves the same whether it succeeds or not. The game's `netlify.toml` proxies `/api/count` to `https://mobmachine.games/api/count`, as it proxies `/api/live` and `/api/cards`, so the game's `connect-src 'self'` holds.

The site's `/api/count` (`platform/site/netlify/functions/card.mts`) takes a JSON body of at most 1 KB naming one of the four events, whatever its content type (a beacon sends `text/plain`). Anything else answers 400 with no database call; any method but POST answers 405. A known event calls `count_play_event(p_event)` with the publishable key and nothing else: no cookie, header or address is read or passed on. It answers 204 with `no-store`, or 502 when the database does not answer true. It shares the function's rate limit (300 a minute per IP and domain, enforced by Netlify, which stores nothing for the studio).

`count_play_event` adds one to the row for (today in UTC, event) in `play_counts`, which holds only a day, an event and a count, and answers true; any other name answers false and writes nothing. anon may execute it; no role but service_role may read the table, and none may write it directly.

`board_play_counts(p_days)` answers a board member at the second factor with the last `p_days` UTC days (1 to 90, default 14), today first, each with all four counts and 0 where nothing was counted. The board's panel shows it as "Play and share counts" after Activity: a table of the last 14 days and the period's total, read once when the panel opens.

The Privacy page says what is counted and that a count sets no cookie and stores no identifier and no IP address.

Known limits: the counts are totals of presses and loads, not people; one person reloading counts twice. The game's proxied requests reach the site's rate limit from Netlify's side, so a very busy minute may drop counts; that undercounts and never blocks the game.

## Acceptance criteria

- [ ] The migration creates `play_counts (day, event, count)` with row level security, an event check of the four names, no other column, and no grant to anon or authenticated.
- [ ] `count_play_event` adds one to today's row for each known event and answers false, writing nothing, for any other name or null; anon can execute it.
- [ ] `board_play_counts` answers a board member at aal2 with one entry a day, newest first, every event present; it refuses aal1, a moderator, an outsider and anon.
- [ ] The migration applies twice without error, and the function-privilege lists in the migration test name both functions.
- [ ] `/api/count` passes a known event alone to `count_play_event` with the publishable key and answers 204 no-store; it answers an unknown event, a malformed or oversized body 400 and another method 405, with no database call.
- [ ] The site's ShareCard counts `card_share` on each press, and the game counts `dust_load`, `dust_share` and `dust_next_card`, each to `/api/count` on the page's own origin with the event name alone.
- [ ] The game's `netlify.toml` proxies `/api/count` to the site and its CSP keeps `connect-src 'self'`.
- [ ] The board's panel shows Play and share counts after Activity, with each day and the total, reading `board_play_counts` once for 14 days.
- [ ] The Privacy page has a Play and share counts section and no longer says the site has no analytics.
- [ ] The client modules (`platform/site/src/lib/count.ts`, `seed-1/render/count.ts`) are kernel paths.

## Verification

- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/play_counts_test.ts platform/supabase/functions/_shared/migration_test.ts`
- `pnpm --filter @backseat/site exec vitest run netlify/card.test.ts src/components/ShareCard.test.tsx`
- `pnpm --filter @backseat/seed-1 test`
- `pnpm --filter @backseat/board test`
- `E2E_PORT=4420 npx playwright test e2e/card.spec.ts e2e/thanks.spec.ts e2e/text-pages.spec.ts` in `platform/site`, and the board's e2e
- `pnpm verify:changed`
- After merge: `20261011500000_play_counts.sql` applied to production, both sites deployed, then a POST of `{"event":"dust_load"}` to `https://play.mobmachine.games/api/count` answers 204 and the panel shows today's count.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-10-11: one Netlify path on the existing card function, not a new function. Legacy Free allows two code-based rate-limit rules and both are taken (`snapshot.mts`, `card.mts`); `/api/count` shares `card.mts`'s rule.
- 2026-10-11: the event list lives in the database check, the function's `PLAY_EVENTS` and the two client modules; `netlify/card.test.ts` reads the migration so the lists cannot drift.
- 2026-10-11: count loads and presses, not people. Counting people needs an identifier, which this feature exists to avoid.
