# Roadmap: the phases to the final state and beyond

The order of work, with no dates. A phase starts when the one before it exits, and a phase exits when every exit benchmark it names is met, measured as `benchmarks.md` says. Items within a phase are ordered by dependency. `docs/ROADMAP.md` stays the launch checklist and the record of spec statuses; `docs/BACKLOG.md` lists the entries named here.

## Phase 0. The loop works (done)

Fund a card, agents build it, checks test it, it goes live, the ledger shows it. Unattended on GitHub Actions, the board optional (`docs/PLAN.md` §10 decisions 61, 66 and 74).

Exit (met): a player-funded card built unattended; live check `PASS ... failed=0`.

## Phase 1. The final-state series

The four branches of `docs/specs/final-state.md`, merged in dependency order.

| Order | Item | Depends on | Exit benchmark |
|---|---|---|---|
| 1 | `final-state/strategy`: these documents, VISION, PLAN decision 75, ROADMAP, BACKLOG | Nothing | `pnpm test:docs` green; every PRD row has a state |
| 2 | `final-state/community-core`: migrations, RPCs, public views, Curator and Art Director roles, the suggestion pipeline, admin | The shared contract types | No write-capable role can select `community.suggestions` (migration test); rarity tests pass; every admin action logged |
| 3 | `final-state/dust-three`: Dust on Three.js with the art and feel pass and box art | Nothing (in parallel with 2) | Game quality score of 24 or more with no criterion below 2; performance budgets met in CI; axe clean |
| 4 | `final-state/site-studio`: live studio, feed, suits and rarity, goals, profiles, suggestions, seeds, broadcast, FAQ, motion | 2 for data; 3 for box art and seeds | Core Web Vitals at target on home, card and studio; 0 serious axe violations; feed freshness under 60 s |
| 5 | Production steps: migrations applied, flags on, transactional email for sign-in links | 2 and 4 merged | Live check `PASS`; a sign-in link arrives in under a minute |

Phase exit: every PRD row marked "In this series" is Built; no pull request changed the split, the reserve or a cap.

## Phase 2. Prove the new surface

Run launch beats 1 to 5 from `growth.md`, one at a time, each when its capability is live, and measure each for 7 days.

| Order | Item | Exit benchmark |
|---|---|---|
| 1 | Beat 1, the studio comes alive | Studio dwell at target; 25 new supporters in 7 days |
| 2 | Beat 2, Dust rebuilt | Player D1 at 20% (once counters exist); shares per 100 loads at 3 |
| 3 | Beat 3, collect the cards | 30% of supporters with three or more suits |
| 4 | Beat 4, you suggest, agents build | The first suggestion shipped; suggestions per profile at 0.3 |
| 5 | Beat 5, seeds | 2 opens per shared seed |
| 6 | Aggregate counters for the benchmarks (built: `docs/specs/operations.md`, `docs/specs/counter-senders.md`) | Every "Needs" row in `benchmarks.md` measured, or its remaining need named there |
| 7 | [The review team on events](../BACKLOG.md#the-review-team-on-events) | First full review report with every row filled or marked not measured |

Phase exit: stage 1 of the path to profitability (`business-strategy.md` §4) and repeat supporter rate at 10% or more. If instead a kill or pivot line in `business-strategy.md` §8 is crossed, the board decides.

## Phase 3. The stage

| Order | Item | Exit benchmark |
|---|---|---|
| 1 | Beat 6, live on Twitch from /broadcast | Broadcast reach at 3 streams; 5% of contributions from the QR source |
| 2 | [Twitch channel and stream scenes](../BACKLOG.md#twitch-channel-and-stream-scenes) | The stream runs unattended with its watchdog |
| 3 | [Weekly episodes and clips](../BACKLOG.md#weekly-episodes-and-clips) | One Short per clip-worthy event |
| 4 | [The host](../BACKLOG.md#the-host), behind the delay and kill switch | No filtered output reaches air in a red-team run |

Phase exit: stage 2 of the path to profitability; new supporters per beat at 25.

## Phase 4. The second game

| Order | Item | Exit benchmark |
|---|---|---|
| 1 | Beat 7: the first New game Pitch card | Pitch funded |
| 2 | Prototype and First playable stages (`studio-team.md`) | First playable scores 24 or more; box art passes the Art Director |
| 3 | [Sound for every game](../BACKLOG.md#sound-for-every-game) | Sound present in both games, with mute, never the only cue |
| 4 | [Seeds for every game](../BACKLOG.md#seeds-for-every-game) | Seeds open in both games |

Phase exit: two live games, each at the quality bar; repeat supporter rate at 25%.

## Phase 5. Scale

| Order | Item | Exit benchmark |
|---|---|---|
| 1 | [A card supply that keeps pace with funding](../BACKLOG.md#a-card-supply-that-keeps-pace-with-funding) | Card supply short under 5% of hours while funding grows |
| 2 | [Scorecards for every agent](../BACKLOG.md#scorecards-for-every-agent) | Every running role has a published scorecard |
| 3 | Load tests before each beat (`operating-system.md` §6) | Edge cache hit rate 95%; zero visitor database connections |
| 4 | A part-time moderator, when held items wait past target | Moderation wait under 24 hours |

Phase exit: stage 3 of the path to profitability; board time under 3 hours a week.

## Phase 6. More income and loyalty

Each item is a money change, so each needs its own kernel spec and the board's tax registration first where it is a sale.

| Order | Item | Exit benchmark |
|---|---|---|
| 1 | [Loyalty bonus for repeat supporters](../BACKLOG.md#loyalty-bonus-for-repeat-supporters) | Repeat supporter rate rises with no fall in the chosen studio share |
| 2 | [Membership tiers](../BACKLOG.md#membership-tiers) | Recurring income covers fixed costs |
| 3 | [Twitch Bits and subscriptions](../BACKLOG.md#twitch-bits-and-subscriptions) | Twitch income shown beside the site's cut |
| 4 | [Sponsors on the goals track](../BACKLOG.md#sponsors-on-the-goals-track) | A sponsored milestone delivered |

Phase exit: stage 4 of the path to profitability.

## What does not move the roadmap

A calendar, a competitor's launch, or a request in chat. Phases move on their exit benchmarks; a phase whose exit is not met keeps working on its items, and the review team names which item is behind.
