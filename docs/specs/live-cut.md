# The live cut

Status: agreed. Card: none. Owner: board.

## Problem

Build 1 framed the work before launch as three funded weeks with goal cards on the site. The board retired that framing on 14 September 2026: everything now is getting live with the basics, the site shows only what is building now and what is next, and a supporter votes by funding a card.

## Scope

In: the money loop (a real $1 on the meter within 60 seconds with its split recorded); fund-a-card voting (`next-cards.md`); the agent loop unattended (`unattended-mode.md`); Now and Next on the site; a How it works section; info icons on the meter, ledger figures and card status words; a lede under each page title; a Play link to the game; a board Go-live switch that stamps `studio_state.launched_at`; board controls to file Next cards and set the agent mode; a dispatcher heartbeat shown on /board; the working method (`working-method.md`).

Out (PLAN.md §6 weeks 2 and 3, not started): OBS, stream scenes, host, TTS, Twitch, personal-decision UI, the vote board with quorums and regimes, Meet the Team, Board Decisions and Lore pages, TOTP, the image adapter, the public mirror, a VPS, Langfuse-class tooling (the Scout's first trial after launch), public display of contributor names (needs the name pipeline in PLAN.md §4).

## Behaviour

The landing page reads, in order: pitch, launch line, Contribute, How it works, Funding, Ledger, Now, Next, Fixed rules. Now lists cards in `building` or `gated` with their spend so far. Next lists cards in `proposed`, `designing`, `voted` or `funded`, decided ones first, each with its bar, its funder count and a Fund this link. Before the board presses Go live the launch line says the studio is not live yet and that contributions made now count as founding contributions; after, it says the date. Every figure with a term a first-time reader would not know carries an info icon. The ledger page opens with one sentence saying what it is.

## Acceptance criteria

- [x] A Stripe `checkout.session.completed` for $1 at 80/20 creates a `contributions` row with `studio_pct_chosen` 20, increments `pool.balance_usd` by the agents' net amount and `pool.incident_reserve_usd` by 5% of the agents' share, and the public site shows the new figures within 60 seconds.
- [x] A card in stage `funded` with a $2 estimate becomes a deployed change on the live seed site within 15 minutes, with ledger rows and a new green `deploys` row, three runs in a row.
- [x] ~~The landing page renders the sections in the order above at 375 px with no horizontal scroll, with and without a database configured.~~ Superseded: `site-layout.md` sets the landing order (2026-09-14).
- [x] ~~Every info icon opens by tap, hover and keyboard, and closes on Escape and on a tap outside.~~ Superseded: `site-design.md` replaced info icons with visible descriptions (2026-09-14).
- [x] Each Next card's Fund this link is the Payment Link with `client_reference_id` set to the card id.
- [x] `set_launched()` sets `launched_at` once and the site swaps the launch line within one poll.
- [ ] In unattended mode a card funded to its target builds with no board session active.

## Verification

- `pnpm verify` at the repository root exits 0.
- `pnpm --filter @backseat/site build && pnpm --filter @backseat/site e2e` passes at 375 px.
- The signed synthetic dry run: `pnpm --filter @backseat/supabase exec tsx scripts/sign-synthetic-event.ts --split 8020 --amount-cents 100` returns 200 with `dry_run: true` and `studio_pct: 20`.
- The board's real $1 and the three week-1 runs, with the SQL checks in the plan of 14 September 2026, quoted in the session report.
- ~~The ledger identity holds: sum of `agents_usd - incident_usd` over contributions minus the sum of `ledger.usd` equals `pool.balance_usd`.~~ Superseded: `refunds-and-holds.md` states the identity as I1–I3, exact through founder rows, S1 draws, holds and reversals, checked by `scripts/ledger-identity.ts` (2026-09-15).

## Decisions

- 2026-09-14: the week framing is retired; the site shows Now and Next only. The audience does not need the studio's internal build stages as funded cards.
- 2026-09-14: the 10% reserve and the incident reserve stay separate. They are different money: one is held back and never spent, the other is spendable compute for urgent fixes.
- 2026-09-14: funding a Next card is the vote at live. It reuses the webhook's goal-card support and makes the pitch line true on day one.
- 2026-09-14: the fleet runs unattended through the same Claude Code command with the studio organisation's key. No SDK rewrite is needed for the basics.
- 2026-09-14: observability stays first-party (`agent_events`, `ledger`), plus JSON-line dispatcher logs and a heartbeat. No third-party key reaches an agent session.
- 2026-09-14: pitch line: "Watch AI agents build a game studio and free games. Vote on what they do next by contributing to their compute."

## Evidence

2026-09-14:
- Criterion 1: the real $1 at 80/20 is credited (see `stripe-late-fee.md` Evidence), and the site shows the pool figures.
- Criterion 5: the live check found 4 "Fund this card" links and 4 contribute choices, each the Payment Link with `client_reference_id=<uuid>`.
- Criterion 6: PGlite "the board files Next cards, stamps the launch…" and `Landing.test.tsx` (live-since line).
- Criterion 2: the three week-1 runs shipped on 15 and 16 September; run 3 went from insert to live in 2 minutes (`week1-runs.md` Evidence).
- Open: criterion 7 (unattended on the VPS, `vps.md`).
