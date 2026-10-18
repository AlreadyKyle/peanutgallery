# Daily Dust

Status: agreed. Card: none. Owner: studio.

## Problem

Dust has no shared moment. Every run starts from its own seed and grows for hours, so two players never play the same thing and a run image says only "I played a lot". A run everyone plays on the same day, short enough to finish and with a result made to share, gives players something to compare and a link that brings a friend to the same run (`docs/strategy/growth.md`, Virality without referral payouts).

## Scope

In: the day's seed and the run's length (`seed-1/sim/daily.ts`, and `hashText` exported from `seed-1/sim/hash.ts` without changing `hashState`); the run's record, result and share text (`seed-1/render/daily.ts`); the result card drawn in code (`seed-1/render/daily-card.ts`, reusing `seed-1/render/share-image.ts`); the page (`seed-1/render/daily-ui.ts`, `seed-1/render/main.ts`, `seed-1/render/style.css`); the run's options on the running game (`seed-1/render/game.ts`); the share sheet code shared with Share your run (`shareOrCopy` in `seed-1/render/share.ts`); the words under `daily` in `seed-1/content/strings.json`; three aggregate counters (`seed-1/render/count.ts`, `platform/site/netlify/functions/card.mts`, the migration `20261018020000_daily_dust_counters.sql`); one sentence on the Privacy page (`platform/site/src/lib/legal.ts`); unit tests, a seed-1 e2e spec and a migration test.

Out: a board or ranking of scores (it needs server-checked replays: [A fair Daily Dust board](../BACKLOG.md#a-fair-daily-dust-board)); any streak, login reward, reward for coming back or penalty for missing a day (`docs/strategy/growth.md`, Retention); any change to the main save, `SimState`, the state hash or the pinned timeline; the shop panel's and the fork choice's phone layout; a link on the site's game tile.

## Behaviour

- **The day's run.** Every UTC day has one run. Its sim seed is the first 32 bits of the sim's own hash (`hashText`, the two FNV-1a passes `hashState` uses) of `dust-daily:YYYY-MM-DD`, so every player on every device gets the same seed for the same date, with nothing read from a server. The run starts from `createSim(config, seed)`: no units, no dust, the live config.
- **The link.** https://play.mobmachine.games/?daily=YYYY-MM-DD opens that day's run. A past date from `2026-01-01` on opens that day; a future date, a date that does not exist or anything else opens today's run, corrects the address to today's date and says "That day's run is not open, so here is today's." An empty `?daily=` opens today's.
- **The entry point.** The player's own game shows "Today's run" in the share row under the stage, after Save to gallery: a link to `?daily=<today>`, its date read when it is followed. It touches neither the shop nor the fork panel.
- **Apart from the main save.** A daily page never reads the main save for play and never writes it: its Game has no store. The run keeps its own record (its date, its state, the score at each half minute and the dust devils caught) under `dust.daily`, every 5 seconds, when the tab is hidden and on `pagehide`; one day at a time, so opening another day starts that day fresh. A record whose seed is not the day's, or which has played past the run's length, is ignored. Share your run and Save as seed are hidden on a daily page; "Back to my game" links to the player's own game, which loads as it always does.
- **Length.** A run lasts 240 sim seconds, four minutes of play. Its clock starts at the player's first action on the page (a strike: nothing is affordable at zero), so loading is not play; it steps by wall-clock time at most one second a tick, so a hidden tab or time away earns nothing (no time-away credit); and it stops at exactly 240 seconds. After the end no tick steps and no action changes the state. Reopening a finished day shows its result at once.
- **During the run.** A line above the share row reads "Daily Dust, 17 October 2026: the same run for everyone. It starts with your first strike." and then "Daily Dust, 17 October 2026: 1:20 of 4:00 played", with a bar filling as the run is played. It counts time played up, never down.
- **The score** is every bit of dust the run made: lifetime dust plus the dust of any season pressed away (`dailyScore`), from production, strikes, orders and dust devils.
- **The result.** At the end, after a short beat, a dialog opens over the island: the day, the card drawn in code, and the text exactly as it will be shared, with Share, Copy text, Play again, Close and Back to my game. A button under the stage reopens it ("See my result"), and the live region says "Daily Dust is over: <score>."
- **The card** is 1200 by 630, on paper with the motes and the suit band of the run card: "Daily Dust" in the suit magenta, the date, the score in large ink type with "dust in 4 minutes", the run as eight inked bars (one per half minute, the tallest in magenta), the highlights in pills and the day's address.
- **The glyph row.** One block glyph per half minute (`▁▂▃▄▅▆▇█`, never emoji), set by the dust that half minute made on a fixed scale (100, 300, 1,000, 3,000, 10,000, 30,000 and 100,000 dust reach the second glyph to the eighth), so two players' rows compare. A run that only buys units draws `▁▁▁▁▂▂▂▃`, a casual one `▁▂▃▄▄▄▄▄`, a busy one climbs to `█`.
- **The highlights**, one or two: the unlocks reached ("7 of 25 unlocks"), then the dust devils caught or, with none caught, the orders filled.
- **The text** is five short lines, all ages, with no countdown, chance cue or money:

  ```
  Daily Dust · 17 October 2026
  385,393 dust in 4 minutes
  ▃▅▆▆▇▇██
  7 of 25 unlocks · 2 dust devils caught
  https://play.mobmachine.games/?daily=2026-10-17
  ```

  Share uses the phone's share sheet with the card as a PNG where the sheet takes files, else the clipboard, else a plain message, through the same code as Share your run; Copy text goes to the clipboard alone. Play again clears the day's record and starts the same run over.
- **Counts.** `dust_daily_start` when a fresh run takes its first action, `dust_daily_finish` when a run reaches its end, `dust_daily_share` on each Share or Copy text press: each the event's name alone to `/api/count`, fire-and-forget, so the game plays the same when the server refuses a name (`docs/specs/play-counts.md`). `count_play_event` and the site's `PLAY_EVENTS` take the three names; `refresh_daily_metrics` already carries every play count as `play.<event>`. The Privacy page says these are counted, the same way as the others.

## Acceptance criteria

- [x] The day's seed is the first 32 bits of `hashText("dust-daily:<date>")`, pinned for one date, and differs on each of 366 days (`seed-1/tests/daily.test.ts`).
- [x] The same date and the same play land on the same state.
- [x] A past date opens; a future date, an impossible date, a date before 2026-01-01 and nonsense open today, flagged as refused.
- [x] A daily Game waits for the first action, steps at most a second a tick, lands on each half-minute mark, ends at exactly 240 seconds, fires its end once and refuses play after.
- [x] Playing a daily run to its end and saving it writes only `dust.daily`; the main save in the same store is byte-identical (unit test, and `seed-1/e2e/daily.spec.ts` in the browser).
- [x] The record round-trips, is that day's only, and refuses another seed, a run past its length or a malformed field.
- [x] Four minutes fits the pacing: the scripted active player meets an order, a dust devil, the weather and a fork inside it, and the casual player opens at least three unlocks and fills an order.
- [x] The glyph row is on a fixed scale and the documented rows hold for the scripted players.
- [x] The share text is five lines in the format above and carries no placeholder, countdown, chance cue, money word or emoji.
- [x] The card draws inside 1200 by 630 with eight bars, the highlights and the address.
- [x] "Today's run" opens today's run, which starts at the first strike, keeps its record under `dust.daily`, counts `dust_daily_start` once, and leads back to the player's own game (`seed-1/e2e/daily.spec.ts`).
- [x] A run that reaches its end opens the result; Share copies the five lines where there is no share sheet; `dust_daily_finish` and `dust_daily_share` are counted.
- [x] A future day opens today's run and says so.
- [x] `count_play_event` takes the three names and every earlier one, still drops any other, the table refuses another name written directly, anon reads nothing, and `refresh_daily_metrics` carries them as `play.dust_daily_*`; the migration applies twice (`platform/supabase/functions/_shared/daily_dust_counters_test.ts`).
- [x] `/api/count` takes the same nineteen names the migration lists (`platform/site/netlify/card.test.ts`).

## Verification

- `pnpm --filter @backseat/seed-1 test`
- `E2E_PORT=4441 npx playwright test e2e/daily.spec.ts e2e/seed.spec.ts e2e/a11y.spec.ts` in `seed-1`
- `pnpm test:functions`
- `pnpm test:docs`
- `pnpm verify:changed`
- `pnpm verify`
- After merge, from the Mac that holds `.env`: apply `20261018020000_daily_dust_counters.sql` to production, then `select public.count_play_event('dust_daily_start')` as anon answers true, and a Daily Dust run on https://play.mobmachine.games/?daily=<today> shows its result.

## Evidence

Quoted in the pull request's Verification section.

## Decisions

- 2026-10-17: the run lasts four minutes of sim time. The playtest's active player fills a first order at 30 s, meets a dust devil at 51 s and the weather at 60 s, chooses a fork at 2 m 35 s and opens the foundry at 3 m 17 s; four minutes holds every layer but the gems (6 m 20 s), leaves time to play out the fork and makes the foundry a race. The casual player opens the forge at 3 m 56 s and fills three or four orders. Three minutes cut off the foundry; five added nothing new for either.
- 2026-10-17: the score is the dust the run made, lifetime dust plus any season pressed away. Every skill in the run feeds it (buying in a good order, striking, catching devils, filling orders, the fork chosen), it is the number the HUD already shows, and pressing can never lower it.
- 2026-10-17: the glyph row is the dust each half minute made, on a fixed scale of half decades, not scaled to the run, so two players' rows compare at a glance and a busy run visibly climbs.
- 2026-10-17: the clock starts at the first strike and steps at most a second a tick. Loading, reading the line and leaving the tab are not play, and a daily run has no time-away credit.
- 2026-10-17: Play again is allowed and replaces the day's result. With no board there is nothing to protect, and a second try on a short run is kind; the board, when built, will take a first finished run only.
- 2026-10-17: a past day stays playable from 2026-01-01 on, with the live config: the same seed, but a config card that shipped since can change how that day plays. A board would need the config's version beside the score.
- 2026-10-17: `hashText` is exported from `sim/hash.ts` so the day's seed uses the sim's own hash; `hashState` is unchanged, so the pinned hashes hold.
- 2026-10-17: the entry is a link in the share row, after Save to gallery, so it changes neither the shop panel nor the fork choice. The site's game tile gets no link in this change.
