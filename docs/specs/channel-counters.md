# Channel counters: landings from each channel's tagged links

Status: built. Card: none. Owner: studio.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

The studio's posts go out on many channels: the promo engine's (X, Bluesky, Threads, Mastodon, Discord, YouTube, TikTok, Instagram, LinkedIn) and the ones a person posts to (Reddit, Hacker News, itch.io, Product Hunt, creators). Every link carries `?from=<channel>`, but only the broadcast's QR tag (`from=broadcast`) is counted (`docs/specs/counter-senders.md`), so nothing says which channel brings visitors. `docs/strategy/benchmarks.md` reads the Discord to site row as not measured for the same reason.

## Scope

In: a fixed list of channel tags; a `from_<tag>` count on the site (`platform/site/src/lib/count.ts`) and in Dust (`seed-1/render/count.ts`, `render/main.ts`); the migration that lets `count_play_event` and `play_counts` take the new names; `PLAY_EVENTS` in `platform/site/netlify/functions/card.mts`; the Privacy page's counts section; the benchmark rows that read them.
Out: any record of a visit (a referrer, a path, a time) beyond the name's daily total; free-form tags; the board panel's play counts table; tagging the dispatcher's own ship posts.

## Behaviour

- The channel tags are `x`, `bsky`, `threads`, `mastodon`, `discord`, `yt`, `tiktok`, `ig`, `linkedin`, `reddit`, `hn`, `itch`, `ph` and `creator`. The list is the same in both count modules, and each tag's count is `from_<tag>`.
- A page of the site that opens with `from=<tag>` for a listed tag counts `from_<tag>` once and drops the tag from the address, keeping the rest of the query and the hash, as the QR tag does. `from=broadcast` still counts `broadcast_qr`.
- Dust opened with `from=<tag>` for a listed tag counts `from_<tag>` once per page load, through the same once-each sender as its other benchmark counts, and drops the tag with `history.replaceState`, keeping the rest of the query (a `?seed=` link still opens).
- A tag not on the list counts nothing and is left in the address as it is. Leaving it is the safer choice: the page changes no address it does not understand, and nothing is sent for a name the counter would refuse.
- The count is the event's name alone, posted to `/api/count` like every other count: no cookie, no identifier, no address, nothing stored in the browser.
- The migration widens `play_counts_event_check` and `count_play_event` with the fourteen names; `refresh_daily_metrics` already copies every play count into `daily_metrics` as `play.<name>`, so the landings reach the benchmark review unchanged. Every statement runs twice without error.

## Acceptance criteria

- [x] Each listed tag maps to `from_<tag>`; `from=broadcast` still maps to `broadcast_qr`; no tag, an unknown tag or a tag in other case maps to nothing (`platform/site/src/lib/count.test.tsx`, `seed-1/tests/count.test.ts`).
- [x] On the site, a tagged landing counts once and the tag is dropped, keeping the rest of the address; an unknown tag counts nothing and stays (`count.test.tsx`, `e2e/counts.spec.ts`).
- [x] In Dust, the tag is dropped and the rest of the query kept; `render/main.ts` sends the landing through the once-each sender (`seed-1/tests/count.test.ts`).
- [x] The site and Dust list the same tags, and every `from_<tag>` is in `PLAY_EVENTS` and in the migration's list (`seed-1/tests/count.test.ts`, `platform/site/netlify/card.test.ts`).
- [x] The migration applies a second time; anon counts each landing and repeats add up; unknown names are still dropped; `refresh_daily_metrics` writes `play.from_<tag>` (`platform/supabase/functions/_shared/channel_counters_test.ts`, `migration_test.ts`).
- [x] The Privacy page says a posted link carries where it was posted, that the day's total for that place goes up by one, and that the tag is then removed (`platform/site/src/lib/legal.ts`).

## Verification

- `npx vitest run src/lib/count.test.tsx netlify/card.test.ts` in `platform/site`
- `E2E_PORT=4431 npx playwright test e2e/counts.spec.ts` in `platform/site`
- `npx vitest run tests/count.test.ts` in `seed-1`
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/channel_counters_test.ts platform/supabase/functions/_shared/migration_test.ts`
- `pnpm test:docs`
- `pnpm verify:changed`
- After merge, the migration applied in production and both sites deployed: a visit to `https://mobmachine.games/?from=reddit` shows `play.from_reddit` above 0 in `board_daily_metrics` the next hour.

## Evidence

Quoted in the pull request.

## Decisions

- 2026-10-18: a fixed list rather than any `from_` name, so the counter still takes only names it knows and the database check stays a closed list.
- 2026-10-18: an unknown tag is left in the address and counts nothing, so the page never rewrites an address it does not understand.
- 2026-10-18: Dust counts landings too, because most posts link straight to the game.
