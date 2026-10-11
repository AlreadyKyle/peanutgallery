# Always cards to fund, and no roadmap page

Status: agreed. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

Production's home showed one "Fund the next card in line" panel and no card to choose: no card was open, and the Game Designer had used its 4 drafts for the day. The point of the site is a choice of what to fund. The public site also mixed in the repository's own plan: `docs/BACKLOG.md` entries appeared in home's Next up lane and on `/roadmap` as planned cards that take no money, which made the product harder to read than "the agents open cards, you fund the one you want".

## Scope

In: home's Next up lane; `/roadmap` and every link to it; the Game Designer's daily draft limit.
Out: the money rules, the waterfall and the horizon rule (only horizon now cards take money); `docs/BACKLOG.md` itself, which stays the repository's plan and a source the dispatcher may still draft from; the board's site; the card floor of 6 open cards.

## Behaviour

The agents keep cards open for funding with no one acting: when fewer than 6 are open, the dispatcher queues the Game Designer's `draft_card`, the Game Director grades the draft, and an approved card opens (`docs/PLAN.md` §10 decision 66). The board can file cards but never has to.

Home's Next up lane holds only the agents' approved cards waiting to open (an approval sets `opens_at`), soonest first, and never a backlog card, board work or a held card. With none it says approved drafts wait there a few minutes before they open, beside the Game Designer's drafting status. It links nowhere.

There is no `/roadmap` page. `/roadmap` answers 301 to home, the top bar and the sitemap drop it, and every link that named it goes to home's cards to fund ("See the cards to fund"): a planned card's own page and the empty weekly reports page. `/team`'s Planned section links nothing. The ledger and the weekly reports are the studio's history.

The Game Designer may start up to 12 `draft_card` runs a New York day instead of 4 (`studio_state.draft_runs_per_day`), so a day in which the Game Director withdraws some drafts still refills the floor. Each run is billed to the card it drafts, and every spend cap stands.

## Acceptance criteria

- [ ] Home's Next up lane draws only approved cards waiting to open, never a backlog card, board work or a held card.
- [ ] No page links `/roadmap`; the top bar has How it works, Team and Ledger; the sitemap has no `/roadmap`.
- [ ] `/roadmap` answers 301 to `/` (netlify.toml, unit-tested) and the live check lands on home.
- [ ] A planned card's page and the empty reports page link "See the cards to fund" to `/`.
- [ ] `studio_state.draft_runs_per_day` is 12 in production after the migration.

## Verification

- `pnpm verify`
- `E2E_PORT=<port> npx playwright test e2e/landing.spec.ts e2e/home-flow.spec.ts e2e/pages.spec.ts e2e/card.spec.ts e2e/team-status.spec.ts e2e/agent-card.spec.ts e2e/design.spec.ts e2e/csp.spec.ts e2e/snapshot.spec.ts e2e/money.spec.ts e2e/layout-balance.spec.ts` in `platform/site`
- After merge and the migration: `select draft_runs_per_day from public.studio_state` reads 12, home shows cards to fund within a day, and the first line of the `live-check` run for the merge commit.

## Evidence

- 11 October 2026: the migration was not applied when #157 merged; production read `draft_runs_per_day` 4 with the supply short for `daily_limit` (4 of 4 runs used). Applied on the board's go through the Supabase connector as `20261011021217 always_open`; read back: `draft_runs_per_day` 12, `public_supply()` `{"short": true, "reason": null, "run_limit": 12, "runs_today": 4, "next_check_at": "2026-10-11T02:20:00+00:00"}`. Home showing cards to fund within a day and the live-check line are still to record.

## Decisions

- 11 October 2026: the board drops `/roadmap` and keeps the ledger and the weekly reports as the studio's history (`docs/PLAN.md` §10 decision 69).
- 11 October 2026: the draft limit rises to 12 a day so the floor refills on a day of withdrawn drafts; the card floor stays at 6.
