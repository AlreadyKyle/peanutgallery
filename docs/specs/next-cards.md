# Next cards: fund a card to vote for it

Status: done. Card: none. Owner: board.

## Problem

At live there is no vote board, yet the pitch says supporters vote on what the agents do next. The webhook already accepts a goal card id from the Payment Link, but `apply_contribution` credits the gross amount to the card, never moves a full card to `funded`, and locks the pool before the card (a deadlock risk against `record_usage`). The three sprint goal cards and one stray $0 card sit in the live database and render on the site.

## Scope

In: the `apply_contribution` fix; a board RPC `file_card`; a public funding view; retirement of the four old cards; the seed no longer inserting sprint goals; the first four Next cards; Now and Next on the site; a board form to file cards.
Out: quorums, vote weights, regimes, micro-votes, personal decisions, contributor names on the site.

## Behaviour

A Next card carries a funding target at or below the per-card maximum. A supporter opens the Payment Link with `client_reference_id` set to the card id; the webhook passes it to `apply_contribution`, which credits the card's bar with the agents' net amount of that contribution (after the processor fee, the 10% reserve, the supporter's studio share and the incident carve-out). When the bar reaches the target the card moves to `funded`, its estimate equals its target, and the dispatcher builds it under the normal caps. Contributions with no card fund the pool. Superseded in part: `card-columns-and-open-funding.md` credits the bar only while the card is proposed, designing or voted, and money naming any other card funds the pool (2026-09-16). The board files Next cards from /board at stage `proposed` (Open) or `voted` (Decided).

## Acceptance criteria

- [x] `apply_contribution` selects the goal card `for update` before it locks the pool.
- [x] `funded_usd` rises by `agents_usd - incident_usd`, not by the gross amount.
- [x] A card in `proposed` or `voted` with `funded_usd >= funding_target_usd > 0` moves to `funded` with `estimate_usd = funding_target_usd` when the estimate was 0; ~~a card in any other stage keeps its stage.~~ Superseded: `card-columns-and-open-funding.md` credits only a proposed, designing or voted card, so a card past voting is not credited at all, and a designing card is credited and keeps its stage (2026-09-16).
- [x] `file_card` refuses: a non-board caller, a blank title, a stage other than `proposed` or `voted`, a target of 0 or above `card_max_usd`, the config lane outside `seed-1`, a config-lane card without a `check:` line, an inactive executor.
- [x] `public_card_funding` exposes only `card_id`, `contributors` and `credited_usd`; `contributors` counts distinct contributors, so one supporter who pays twice counts once.
- [x] The filing script runs the dispatcher's pre-check against the repository's seed-1 files and never inserts a card the dispatcher would reject (`acceptance_grammar`, `acceptance_already_true`).
- [x] The four retired cards are gone from the live database and the seed no longer inserts sprint goal cards.
- [x] The site lists Next cards decided first, shows a bar when the target is above 0, and shows Fund this only for goal cards that are not full.

## Verification

- `pnpm test:functions` (Deno, PGlite over every migration in order).
- `pnpm --filter @backseat/supabase test`.
- `pnpm --filter @backseat/site test`.
- Guarded select returns exactly 4 rows before the delete; the delete returns the same 4 ids.
- `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts` prints `PASS:` after the migration is applied.
- A real contribution toward a card moves its bar by the net amount and the pool by the same amount.

## Decisions

- 2026-09-14: credit the net amount, not the gross. `funded` must mean the pool holds the card's estimate, because that is what the dispatcher checks before it starts a card.
- 2026-09-14: delete the four old cards rather than mark them rejected. Rejected is a gate outcome and nothing references these rows.
- 2026-09-14: the board may file a card at `voted` before launch. There are no voters yet; the `board` source tag keeps it public, and targets at or below $25 stay under the design-stage threshold in PLAN.md §4.
- 2026-09-14: contributor display names stay private until the name pipeline (deny-list, cooling period, board approval) exists. The site shows a count.

## Evidence

2026-09-14:
- `platform/supabase/test/migration.test.ts` (live-cut describe) and the PGlite migration test cover the lock order, the net credit, the funded flip, the `file_card` refusals and `public_card_funding`.
- `platform/supabase/test/next-cards.test.ts` covers the filing pre-check.
- Live: `select count(*) from cards where title ilike 'Week %'` returned 0.
- Criterion 8 holds under the names from `site-layout.md`: cards picked by the board list first under Fund what's next, a bar shows when the target is above 0, and Fund this card shows only for goal cards that are not full (`Cards.test.tsx`).
