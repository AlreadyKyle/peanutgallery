# Operations: counters, the benchmark review, the Three.js lock and announcements

Status: built. Card: none. Owner: studio.

The operating pieces of the final state (`docs/specs/final-state.md`): the aggregate counters `docs/strategy/benchmarks.md` needs, the review that reads them (`docs/strategy/operating-system.md` §1 and §2), the rule that every game is a Three.js game with box art, and Discord announcements of the studio's notable moments.

## Problem

Several benchmark rows read "not measured" because no counter exists, and nothing compares the studio with its targets: the review team was a design with no job. The final state says every game is a Three.js web game with box art, but nothing enforced it. Discord carried ship and weekly posts only, not the moments the feed already records.

## Scope

In: new aggregate counters on `/api/count`; `public.daily_metrics` and its hourly refresh; the `benchmark_review` job (the Studio Head, schema-validated, findings on /board); the gate's game-stack check and the game roles' prompts; the announcements lane on `DISCORD_WEBHOOK_URL`.
Out: the site and game code that sends the new counters (`docs/BACKLOG.md`, Aggregate counters for the benchmarks); the other review team members' own sessions and the report in the repository (`docs/BACKLOG.md`, The review team on events); a public metrics document (benchmarks.md asks for none); the board panel's view of the reviews beyond the findings it already lists.

## Behaviour

### Counters and daily metrics

- `/api/count` and `count_play_event` take sixteen names: the four play counts and `dust_return_1d`, `dust_return_7d`, `dust_session_2m`, `dust_session_4m`, `dust_seed_save`, `dust_seed_open`, `home_load`, `home_dwell_mid`, `home_dwell_long`, `broadcast_load`, `broadcast_qr`, `discord_click`. Each is one daily total; no cookie, identifier, address or text.
- `public.daily_metrics` holds (UTC day, metric, number). `refresh_daily_metrics(day)` recomputes a day from the contributions, the ledger, the cards, the deploys, the community tables and the play counts: payments, gross, studio and agent shares, the Machine's share, refunds, distinct payer keys (as a count), new and second-time payers, the 30-day median, agent spend, cards opened, live and rejected, deploys and smoke failures, new profiles, suggestions, seeds, votes, feed events and every play count. pg_cron runs `refresh_recent_metrics()` (today and yesterday) at minute 23. Only the service role and the board at the second factor (`board_daily_metrics`) read it.

### The benchmark review

- `enqueue_benchmark_review()` runs at minute 41 and queues `benchmark_review` only while the `benchmark_review` flag is on, at most one at a time, on: the first review; 50 cards live since the last; a milestone or era reached since the last; 30 days with no review; or a watch, when the counts were refreshed after a review at least 6 hours old.
- The scoreboard is code (`platform/dispatcher/src/benchmarks.ts`): each measurable row of benchmarks.md over the trailing 30 days and the 30 before, with its target, floor and status (meets target, between, below floor, not measured). A missing counter or zero denominator is "not measured" and never estimated. Labels name proxies (for example "Suggestions / new profiles").
- A model is called only when a row is below its floor, and on a watch only when a row is newly below it. The session is the Studio Head's, unattended, billed as studio overhead with its role, at most $0.50 and inside the money caps; it reads the scoreboard and counts of the studio's state, never a player's text, no repository and no files. Its answer must match `platform/agents/schemas/benchmark-review.schema.json`; findings for other rows are dropped and every text passes the gate's banned-phrases scan or is withheld.
- Each row below its floor becomes a `benchmark` finding (`benchmark:<metric>`) on /board's findings, with the cause and one adjustment of a closed kind (card proposal, priority change, content change, core work, spec proposal, target change, escalation) when the session gave them; rows that recover close. Each review is a `benchmark_reviews` row. The review spends nothing, opens no card and changes no rule.

### Three.js only, with box art

- The gate's scans phase runs `platform/gate/game-stack.mjs` on the game folder: it fails a folder whose package.json lacks `three` in dependencies, lists another renderer or engine (Phaser, PixiJS, Babylon.js, PlayCanvas, Kaboom, KAPLAY, Excalibur, melonJS, Cocos, A-Frame, p5, CreateJS, OGL, regl, twgl and others), whose source imports one or loads one from a script tag, or that has no `box-art.svg` with a 3:4 viewBox, no script, no event handler and nothing loaded from outside the file.
- The prompts of the Game Designer, Game Director, both Builders, QA, the Tech Artist and the Art Director carry a Game stack section saying so.

### Announcements

- With `DISCORD_WEBHOOK_URL` set, each dispatcher tick posts notable feed events: a card funded, a card shipped (left to the ships lane while `DISCORD_WEBHOOK_SHIPS` is set), a rare or legendary card, a milestone and an era. Text comes from fixed templates over structured fields only; no supporter is named.
- Each event is claimed once in `outbound_posts` (`announce`, event id) before posting. At most 2 posts a tick and 12 an hour; events older than 6 hours are never posted; while paused or after the kill switch, found events are recorded skipped. Unset, the lane makes no query and no request.

## Acceptance criteria

- [x] Both migrations apply twice; anon and authenticated read no daily metrics; the board reads them at the second factor only (`operations_test.ts`).
- [x] The metrics hold counts and sums only, recomputed rather than added (`operations_test.ts`).
- [x] `enqueue_benchmark_review` waits for its flag, queues on the first review and a milestone, and never twice (`operations_test.ts`).
- [x] A healthy scoreboard calls no model; a row below its floor calls one Studio Head session and lands as a benchmark finding; a watch with only open rows calls none; an answer outside the schema writes no answer; refused texts are withheld (`benchmark-review.test.ts`).
- [x] A Phaser, PixiJS, Babylon.js or CDN-loaded engine, a game without three and a game without valid box art each fail the gate (`platform/gate/test/run-tests.sh`).
- [x] Every game role's prompt carries the Game stack rule (`specs.test.mjs`).
- [x] Announcements are inert without the address, post each event once, respect the limits, never name a supporter and skip while paused (`announce.test.ts`, `operations_test.ts`).
- [x] `after-restore.sql` schedules `daily-metrics` and `benchmark-review` (`pnpm test:ops`).

## Verification

- `pnpm verify:changed`
- `pnpm test:ops`
- `pnpm test:docs`
- `pnpm test:functions`
- `pnpm --filter @backseat/gate test`
- `bash platform/gate/ship-gate.sh --dry-run --folder platform --lane code`

Production, from the Mac that holds `.env`:

1. Apply `20261017200000_benchmark_counters.sql`, then `20261017200100_benchmark_review.sql`, after the community migrations.
2. Merge `final-state/dust-three` before or with this branch: the game-stack check fails the Phaser Dust that main still holds.
3. Set `DISCORD_WEBHOOK_URL` in the dispatcher host's `.env` (and the VPS env) to turn announcements on.
4. Turn on `benchmark_review` from the board's Flags tab when the counts have a few days in them.

## Evidence

Quoted in the series pull request's report.

## Decisions

- 2026-10-17: the review is one Studio Head session over a code-built scoreboard, called only on a floor crossing, rather than seven member sessions; the other members follow as their inputs exist. It is billed as overhead, like the Curator, so it never opens a card.
- 2026-10-17: no public metrics document; benchmarks.md asks for none, and the ledger page is already the public record of money.
