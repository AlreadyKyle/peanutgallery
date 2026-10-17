# Benchmarks

The measurable targets for the final state, one table per area. Each row says how the metric is measured from data the studio holds, the target, the floor below which the review team acts (`operating-system.md`), the assumption behind the number and the comparable it comes from.

## Rules for every benchmark

- **Measured from our own data.** The sources are the ledger, `cards` and their events, `agent_events`, gate and visual review results, the daily play and share counts (`docs/specs/play-counts.md`), the community tables (`community.events`, profiles, suggestions, seeds, votes), `outbound_posts` and Stripe's webhook rows. No third-party analytics, no cookies, no identifier that follows a person across visits. Where a metric needs data that does not exist yet, the row says so under "Needs".
- **Windows are trailing, not dated.** "30d" means the trailing 30 days at the time of reading.
- **Targets are proposals.** The board may confirm or replace them. The review team replaces an assumption with a measured baseline once 30 days of data exist and records the change here.
- **Floors trigger action, not blame.** Crossing a floor opens a review (`operating-system.md`, The review team).

Abbreviations: D1, D7 and D30 are the share of a group active again 1, 7 and 30 days after their first activity.

## 1. Business viability, profitability and monetization

| Metric | How measured | Target | Floor | Assumption | Comparable or source |
|---|---|---|---|---|---|
| Gross contributions (30d) | Ledger, contributions in | Stage 1 of the path to profitability ($380) within 90 days of Phase 2; stage 2 ($590) next | Kill and pivot table, `business-strategy.md` §8 | $10 average contribution | Kick-off plan scenarios: Flop about $1,800, Mid about $27,000 over the first three months |
| Coverage | Studio share in / studio costs (30d) | Above 1 every month with contributions | 1.0 | Costs per `business-strategy.md` §3 | `docs/VISION.md` §1 |
| Distinct supporters (30d) | Distinct hashed payer keys on the ledger | 100 within 90 days of Phase 2 | 25 in the first 30 days | | Kick-off plan's 30-day kill line of 100 funders |
| Median contribution | Ledger | $8 or more | $5 | Fee drag below $5 (`business-strategy.md` §2) | Fee table in `business-strategy.md` |
| Repeat supporter rate | Share of payer keys with a second payment within 60 days of the first | 25% | 10% | Repeat funding is the business | Patreon-style recurring support; our measured figure replaces it |
| Return after ship | Payments from a supporter within 7 days of a card they funded going live, as a share of such supporters | 15% | 5% | Ship notices drive it | `docs/VISION.md` §1 |
| Chosen studio share | Mean of the split chosen (30d) | 15% to 25% | Below 12% or above 30%: read as a trust signal | Most leave the default | Humble Bundle (`docs/research/comparables.md`) |
| Machine card share | Machine card money / all money (30d) | 10% to 30% | Above 50% means cards are not compelling | | None; our own |
| Refund and dispute rate | Refunded and disputed amount / gross (30d) | Below 1% | 2% | | Card-not-present norms; Stripe flags dispute rates near 1% |
| Agent margin | Agent spend / agent share in, per card | 0.2 to 0.6 | Above 1.0 on any card | Card targets are five times expected cost | `platform/agents/rubrics/draft-game.md` |

## 2. Product quality and completeness

| Metric | How measured | Target | Floor | Assumption | Comparable or source |
|---|---|---|---|---|---|
| Final-state requirements built | `prd.md` rows marked Built / rows marked Built or In this series | 100% when Phase 1 exits | | | `docs/specs/final-state.md` acceptance criteria |
| Live check | `live-check` workflow's first line on main | `PASS ... failed=0` on every deploy | Any failure | | `platform/site/scripts/live-check.mjs` |
| Site error rate | Function 5xx responses / requests (Netlify function logs, 7d) | Below 0.1% | 1% | | Common SRE practice for a 99.9% availability target |
| Feed freshness | Age of the newest `community.events` row seen by the public feed document after a contribution | Under 60 seconds at p95 | 5 minutes | Edge cache `s-maxage` plus stale-while-revalidate | `docs/specs/final-state.md`, Scale |
| Public truth | Strings on the site that describe a feature that does not exist | 0 | 0 | | `docs/ROADMAP.md` live criterion 4 |
| Suggestion state honesty | Suggestions whose public state disagrees with their card | 0 | 0 | | `docs/specs/final-state.md`, Suggestions |

## 3. Game quality and pipeline robustness

| Metric | How measured | Target | Floor | Assumption | Comparable or source |
|---|---|---|---|---|---|
| Game quality score | Game Director's rubric (`game-quality.md`), recorded with each game's version | 24 of 30 or more for a shipped game; no criterion below 2 | 20, or any criterion at 0 | | `game-quality.md` |
| Frame rate | Headless and device runs of the game's perf scene: p95 frame time | 16.7 ms (60 fps) on the reference mid-range phone; 8.3 ms on desktop | 33 ms p95 | Reference device in `game-quality.md` | Mobile web game norms; Three.js guidance of about 100 draw calls on mobile ([Utsubo](https://www.utsubo.com/blog/threejs-best-practices-100-tips)) |
| Game bundle | Built `dist/` gzip size of the initial load | 450 KB or less, Three.js included | 600 KB | | `game-quality.md` budgets |
| First-pass gate rate | Cards passing the gate on the first run / cards gated (30d) | 70% | 50% | | `docs/PLAN.md` §4 Metrics |
| Visual review first-pass rate | Cards passing the visual review in round one / reviewed | 70% | 50% | | `docs/specs/design-review.md` |
| Cost per shipped card | Agent spend on live cards / live cards (30d) | Falls or holds; about $0.51 today | Rises 50% over two windows | | Scale model (`docs/BACKLOG.md`, A card supply that keeps pace with funding) |
| Funded to live time | Median hours from a bar filling to live (30d) | Under 2 hours | 24 hours | | `docs/VISION.md` §1 |
| Rollbacks | Deploys rolled back / deploys (30d) | Below 5% | 10% | | |
| Regressions | S1 or S2 incidents caused by a shipped card (30d) | 0 S1; at most 1 S2 | Any S1 | | Severity rules in `operating-system.md` |
| Visible change per dollar | Shipped game cards a player can see / shipped game cards (30d) | 70% | 50% | Recorded by the Game Director's rubric | `docs/VISION.md` §1 |

## 4. Fun, engagement and retention

| Metric | How measured | Target | Floor | Assumption | Comparable or source |
|---|---|---|---|---|---|
| Player D1 | Share of daily game loads that come from a save at least 20 hours old and under 48 hours old, as an aggregate count | 20% | 10% | Approximates D1 without an identifier. Counted as `dust_return_1d`, decided in the browser from the save's own time (`docs/specs/counter-senders.md`) | GameAnalytics 2025: top quartile D1 about 26 to 28%, bottom quartile 10 to 11.5% ([GameDev Reports](https://gamedevreports.substack.com/p/gameanalytics-mobile-gaming-benchmarks)) |
| Player D7 | As above, saves 6 to 8 days old | 6% | 3% | As above, counted as `dust_return_7d` | Same source: median D7 about 3.4 to 3.9%, top quartile 7 to 8% |
| Session length | Median visible play time per load, from the share of loads reaching 2 and 4 minutes (aggregate buckets) | 4 minutes or more | 2 minutes | Counted as `dust_session_2m` and `dust_session_4m`, once each per page load (`docs/specs/counter-senders.md`) | Same source: median 5 to 6 minutes, top quartile 8 to 9 |
| Returning profiles | Profiles active in two different weeks of the last four / profiles active in the last four weeks | 35% | 15% | | Our own |
| Suggestions | Suggestions submitted (30d) / active profiles | 0.3 | 0.05 | | Our own |
| Suggestion to live | Share of suggestions (90d) that reach live | 5% | 1% | | Our own; hive coding's "accepted improvements" |
| Seeds | Seeds saved (30d) and published (30d) | 1 save per 20 loads; 10% of saves published | 1 per 100 | | Our own |
| Collections | Supporters holding cards of 3 or more suits | 30% | 10% | | TCG category breadth |
| Studio dwell | Median seconds on home before navigation (aggregate buckets) | 45 seconds | 15 seconds | Counted as `home_dwell_mid` (15 seconds visible) and `home_dwell_long` (45) per view of home over `home_load`; the median meets a bucket when half the views reach it (`docs/specs/counter-senders.md`) | Our own |

## 5. Virality, sharing, community and acquisition

| Metric | How measured | Target | Floor | Assumption | Comparable or source |
|---|---|---|---|---|---|
| Shares per 100 game loads | Share your run plus Save as seed / game loads (30d) | 3 | 1 | | `docs/specs/play-counts.md` |
| Card shares per contribution | Card shares / contributions (30d) | 0.5 | 0.1 | | Our own |
| Seed opens from links | Loads with `?seed=` / seeds shared (30d) | 2 opens per shared seed | 0.5 | Each shared seed reaches someone | Our own |
| Broadcast reach | Distinct referrers loading /broadcast (30d), and contributions with the broadcast's QR source | 3 streams; 5% of contributions | 1 stream | The QR link carries `?from=broadcast`; `broadcast_load` counts loads of /broadcast and `broadcast_qr` landings from the QR. Distinct referrers and contributions from the QR need a record of a visit, which no counter keeps, so this row is read as loads and landings | Our own |
| Discord to site | Clicks on Discord post links (aggregate redirect counter) per post | 5% of members | 1% | `discord_click` counts presses on the site's Discord links (site to Discord). Needs: a source tag on the links in Discord posts and a counter for the landings, for clicks the other way | Our own |
| New supporters per launch beat | Distinct new payer keys in the 7 days after a beat | 25 | 5 | | Kick-off plan's 7-day kill line |
| Organic only | Paid acquisition spend | $0 | | The studio has no ad budget | `docs/PLAN.md` §10 decision 35 |

## 6. Conversion: visitor to player to participant to supporter

| Step | How measured | Target | Floor | Assumption | Comparable or source |
|---|---|---|---|---|---|
| Visitor to player | Clicks to a game / site home loads (aggregate, 30d) | 25% | 10% | Home loads are `home_load`, one per view of home | Our own |
| Player to card | Clicks from a game's next-card line to a card / game loads | 3% | 1% | Built in play counts | `docs/specs/play-counts.md` |
| Visitor to participant | New profiles / site home loads (30d) | 2% | 0.5% | Home loads are `home_load` | Our own |
| Participant to supporter | Profiles with a claimed or linked contribution / profiles (cumulative) | 20% | 5% | | Our own |
| Visitor to supporter | Distinct new payer keys / site home loads (30d) | 1% | 0.3% | Our visitors are colder than a Kickstarter page's | Kickstarter pages average about 10% visitor to backer with targeted traffic ([LaunchBoom](https://www.launchboom.com/blog/resources/what-is-a-good-conversion-rate-kickstarter/)); free-to-play payer rates are commonly 1 to 3% (assumption) |
| Checkout completion | Completed sessions / checkout links opened (Stripe, 30d) | 60% | 40% | | Our own |

## 7. Scalability and operational efficiency

| Metric | How measured | Target | Floor | Assumption | Comparable or source |
|---|---|---|---|---|---|
| Database connections from visitors | Connections opened per public page view | 0 | 0 | Public reads are cached documents | `docs/specs/final-state.md`, Scale |
| Edge cache hit rate | Cache hits / requests for the snapshot, feed and gallery | 95% | 80% | | Netlify cache headers |
| Cost per 1,000 visitors | Hosting and database cost / visitors (30d) | Under $0.10 | $1 | Free tiers first | Our own |
| Queries by index | Growing tables whose public reads use an index (EXPLAIN in tests) | 100% | 100% | | `docs/specs/final-state.md`, Scale |
| Board time | Hours the board spends on operations per week (self-reported) | Under 3 | 10 | | Kick-off plan's board-time kill lines |
| Moderation wait | Median hours a held suggestion, name or seed waits (30d) | Under 24 | 72 | | Our own |
| Card supply | Hours `card_supply()` reports short (30d) | Under 5% of hours | 20% | | `docs/specs/always-open.md` |
| Incident time to recover | Minutes from an S1 alert to recovery (rollback or pause) | Under 15 | 60 | | Rollback runs on its own after a failed smoke test |

## 8. Visual design, usability, accessibility and performance

| Metric | How measured | Target | Floor | Assumption | Comparable or source |
|---|---|---|---|---|---|
| Largest Contentful Paint | Lighthouse mobile run in CI on home, a card page and the studio | 2.5 s or less | 4 s | Lab runs on a throttled mid-range profile | Core Web Vitals "good" thresholds: LCP 2.5 s, INP 200 ms, CLS 0.1 |
| Interaction to Next Paint | Lighthouse timespan or Playwright trace on fund and play buttons | 200 ms or less | 500 ms | | Core Web Vitals |
| Cumulative Layout Shift | Lighthouse | 0.1 or less | 0.25 | | Core Web Vitals |
| Site JavaScript | Gzip size of the initial bundle per route | 200 KB or less | 300 KB | | Our own |
| Accessibility | axe violations on every public route (Playwright) | 0 serious or critical | 0 | | WCAG 2.2 AA |
| Keyboard and screen reader | Every public action reachable by keyboard; the studio's facts written as a list below it | 100% | 100% | | `docs/specs/final-state.md`, The live studio |
| Reduced motion | Pages with motion that stop it under `prefers-reduced-motion` | 100% | 100% | | `platform/site/DESIGN.md` |
| Colour independence | Information carried by colour alone (rarity, suit, state) | 0 instances | 0 | | `docs/specs/final-state.md`, Rarity |
| Touch targets | Controls under 44 px at 375 px width | 0 | 0 | | `docs/PLAN.md` §10 decision 56 |
| Design review | Visual review verdicts against `platform/site/DESIGN.md` and `game-quality.md` passing in round one | 70% | 50% | | `docs/specs/design-review.md` |
| Stranger test | Head of Product review: a first-time visitor can say what the studio is and how to fund within 60 seconds | Pass on every review | Fail | | `docs/VISION.md` §2 |

## What has to be built to measure everything above

The rows that said "Needs" shared one change: privacy-preserving aggregate counters, the same kind as the play counts (daily totals, no cookie, identifier or address). It is built: the counters and their daily totals (`docs/specs/operations.md`) and their senders in the game and the site (`docs/specs/counter-senders.md`):

1. A returning count (a load from a save a day or a week old) and the session buckets (2 and 4 minutes) in the game's daily counts, and its seed saves and seed-link opens.
2. A home-load count and the dwell buckets (15 and 45 seconds) on the site.
3. A source tag on the broadcast's QR link with a count of its landings, a count of the broadcast's loads, and a count of presses on the site's Discord links.

One need is left: clicks from links in Discord posts back to the site (Discord to site). Until a row's counter exists, or before it has counted anything, it is read as "not measured" in every review, and nobody estimates it.
