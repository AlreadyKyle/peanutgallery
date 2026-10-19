# Honest status: drafting only while a draft runs, and "The agents are offline."

Status: agreed. Card: none (kernel work). Owner: board.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

`public.public_supply()` (`20261011200000_supply_every_minute.sql`) says `drafting: true` while any `draft_card` run is queued or running, however old. Production's dispatcher last checked in on 15 October 2026 and a draft run queued after that never started, so home's Next up lane and the studio room kept saying "The Game Designer is drafting a new card" while nothing ran (the full pass's marketing finding M1). Nothing on the site can say the agents are not working: decision 62 took every paused sentence off the public pages, and the site has no other word for a studio that is not running. So a supporter funds a card and reads "Waiting for the agents" with no agent coming.

## Scope

In:
- A migration, `20261019000000_honest_status.sql`, that redefines `public_supply()` with the same signature, security, search path and grants: `drafting` only while a `draft_card` run is `running` and `studio_state.dispatcher_seen_at` is less than 15 minutes old, and a new key, `offline`.
- The site's reading of the supply (`lib/source.ts`, which drops the old `stalled` guess), its types and the e2e fixtures. The edge-cached `/api/live` (`netlify/functions/snapshot.mts`) passes `site_live()` through unchanged, so it needs no change.
- "The agents are offline." wherever the site says what the studio is doing: home's status line, Next up's line, Building's empty tile (no start time), a funded card's waiting line, a building card's who line and its page's build clock, /thanks' state line, /broadcast's line with no card open, and each agent's line in the studio room, where every agent putters about awake (the board, 19 October 2026: the agents never sleep).
- `scripts/live-check.mjs`'s status line pattern, and `anon-negative-test.ts`'s key list.

Out:
- The pause. `studio_state.paused`, its reasons and every pause path are unchanged, and a pause still shows nothing on any public page (decision 62). A paused studio whose dispatcher checks in is not offline.
- A banner, a notice or any new box: the sentence takes the place of the line it replaces, in that line's style.
- /team's roster (Running, Starts later, Planned), which says what each role is, not what it is doing now; the card stage words (Building, Funded, waiting to build), which name a card's stage.
- The board's console, which already shows when the dispatcher was last seen.
- How the dispatcher checks in, and the thresholds of the dispatcher's own alerts.

## Behaviour

- `public_supply()` returns seven keys: `drafting`, `offline`, `short`, `reason`, `runs_today`, `run_limit` and `next_check_at`, with no card text or free text. `drafting` is true only while a `draft_card` run is `running` and the dispatcher checked in less than 15 minutes ago; a queued run is not drafting. `offline` is true while `dispatcher_seen_at` is null or more than 24 hours old. The other five keys are as before. `site_live()` carries it as `studio.supply`.
- The site reads `offline` as false when the document does not carry it, and never reads `drafting` as true while `offline` is.
- While the agents are offline (decision 77, which amends decision 62 for this one state):
  - Home's status line keeps its first sentence (the open cards, or that none is open) and says "The agents are offline." in place of the building count or the drafting sentence: "2 cards are open for funding. The agents are offline."
  - Next up's line is "The agents are offline." beside the pencil glyph, not drawn as drafting.
  - Building's empty tile says "Nothing is being built right now." and promises no start time.
  - A funded card's line under its bar is "The agents are offline." in place of "Waiting for the agents", on home, /contribute and its own page.
  - A building card names its builder without "is building this"; its own page shows "The agents are offline." where the build clock was, with no link to play while the agents work.
  - /thanks says "The agents are offline." as the state of a funded, building or checks card the payment reached.
  - /broadcast with no card open says "The agents are offline." in place of "The agents are drafting the next cards."
  - In the studio room every agent putters about the room like an idle agent, eyes open with no sleep mark (the board, 19 October 2026, replacing the first version, where they slept and held still), and its role card and accessible name say "The agents are offline."
- Online, every line is as it was, and the Game Designer is drafting only while a draft actually runs.

## Acceptance criteria

- [ ] `public_supply()` keeps its signature, stable and security definer with search_path public, executable by anon, authenticated and service_role and not by public (`honest_status_test.ts`).
- [ ] As anon, `site_live()->'studio'->'supply'` has exactly the seven keys (`honest_status_test.ts`, `site_snapshot_test.ts`).
- [ ] `drafting` is false with no draft run or a queued one, true for a running one with the dispatcher seen 1 or 14 minutes ago, and false at 16 minutes or with no check-in (`honest_status_test.ts`, `site_snapshot_test.ts`).
- [ ] `offline` is true with no check-in or one over 24 hours old, false at 23 hours 59 minutes, and false while paused with a fresh check-in; production's case (seen four days ago, a draft queued three days ago) reads offline and not drafting (`honest_status_test.ts`).
- [ ] The migration applies twice, and the migration list includes it (`honest_status_test.ts`, `migration_test.ts`).
- [ ] The site reads `offline`, false when absent, and never drafting while offline (`Flow.test.tsx`).
- [ ] Home's status line, Next up, Building's tile and a funded card say the offline lines; a pause alone changes nothing (`Landing.test.tsx`, `Flow.test.tsx`, `Card.test.tsx`, `e2e/home-flow.spec.ts`).
- [ ] A building card's face and page drop "is building this", the clock and the play link while offline; a funded card's page says offline (`Card.test.tsx`, `e2e/card.spec.ts`).
- [ ] /thanks says offline for a building card the payment reached (`e2e/thanks.spec.ts`).
- [ ] Every agent in the room putters about awake, never crowded, and its role card says offline (`studio-walk.test.ts`, `e2e/studio-room.spec.ts`).
- [ ] Home's every station is filled with no horizontal scroll at 320, 390, 768 and 1280px while offline (`e2e/home-flow.spec.ts`).
- [ ] The live check accepts "N cards are open for funding. The agents are offline." and still refuses a paused sentence (`live-check.mjs`).
- [ ] After the migration and the deploy, production's home shows the offline line while the dispatcher stays down (the `live-check` workflow).

## Verification

- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/honest_status_test.ts platform/supabase/functions/_shared/site_snapshot_test.ts platform/supabase/functions/_shared/supply_every_minute_test.ts platform/supabase/functions/_shared/migration_test.ts`
- `pnpm --filter @backseat/site exec tsc --noEmit` and `pnpm --filter @backseat/site test`
- `E2E_PORT=<port> npx playwright test e2e/home-flow.spec.ts e2e/landing.spec.ts e2e/studio-room.spec.ts e2e/card.spec.ts e2e/snapshot.spec.ts e2e/paused.spec.ts e2e/thanks.spec.ts` in `platform/site`
- Screenshots of home, a funded card's page and the studio room at 375, 768 and 1440px, offline and online while drafting.
- `pnpm test:docs` and `pnpm secret-scan`
- `pnpm verify`
- Rollout, in this order: apply the migration, then deploy the site. The migration first is safe for the site as it is (it ignores `offline`, and its old guess sees `drafting` false); the site first would read the old `drafting` for a queued run until the migration lands. Then, as the service role: `select public.site_live()->'studio'->'supply'` shows seven keys with `"offline": true` while the dispatcher is down; `anon-negative-test.ts` passes; and the `live-check` run for the merge commit reads `PASS ... failed=0`.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-10-19: 15 minutes for drafting and 24 hours for offline, as the board's approved calls set them (decision 77). The dispatcher writes `dispatcher_seen_at` on every tick, so 15 minutes covers a slow tick without counting a run whose dispatcher has gone; 24 hours keeps a restart, a deploy or a night's outage from showing the line.
- 2026-10-19: `offline` is a flag, not the check-in time, so the public document carries no new figure about the dispatcher and the threshold stays the database's.
- 2026-10-19: the site's `stalled` guess (a queued draft with no run made today) is dropped: the database now says drafting only while a draft runs, and offline covers the case the guess was for.
- 2026-10-19: the status line keeps its open-cards sentence while offline, since contributions stay open and the count is true; only the sentence about what the agents are doing changes.
- 2026-10-19: Building's empty tile drops its start time but keeps "Nothing is being built right now." rather than repeating the offline sentence a third time on home; Next up, directly before it, already says it.
- 2026-10-19: a building card's face names its builder without "is building this" rather than "The agents are offline · $x spent so far", which would break its one-line caption; the card's own page says offline where the clock was.
