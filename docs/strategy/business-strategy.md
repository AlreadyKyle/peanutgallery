# Business strategy

How Mob Machine makes money, what a contribution is worth to it, what it costs to run, how it becomes profitable, and when it should stop or change course. Every figure is either measured (with where it was measured) or an assumption (marked **A** with its basis). No money rule changes here: the 80/20 default split, the 10% reserve, the incident reserve and every spend cap stay as `docs/PLAN.md` §5 sets them.

## 1. The model in one paragraph

Supporters pay for changes they want to see, and everyone gets them free. Each contribution is split: Stripe's fee comes off first, then the 10% chargeback reserve, then the supporter's chosen split between the agents (model time that builds funded cards) and the studio (everything else), default 80/20. The agents' share is spent only on funded work and is never studio income. The studio's share pays the studio's own costs, and what is left is profit. So the business grows with the number of supporters, how often they return and how much they give, while its costs stay mostly variable and paid in advance.

## 2. Unit economics of one contribution

### Inputs

| Input | Value | Source |
|---|---|---|
| Stripe fee on a contribution | 2.9% + about US$0.24 | Stripe Canada's published 2.9% + CA$0.30 (`docs/PLAN.md` §5 Rails), fitted to the production test payment: $1.00 paid, $0.7338 net (`docs/specs/money-logic.md`). **A:** cards issued outside Canada add 0.8% and a converted payment 2% more; not included below. |
| Chargeback reserve | 10% of net | Kernel |
| Default split | 80% agents, 20% studio, of what is left | Kernel; supporters may move it |
| Incident reserve | 5% of the agents' share until it holds $500 | `docs/PLAN.md` §5 The split |
| Agent cost per shipped card | about $0.51 from draft to live | Production's measured costs in the scale model (`platform/dispatcher/test/scale.test.ts`, quoted in `docs/BACKLOG.md`, A card supply that keeps pace with funding) |
| Card funding target | five times the change's expected cost, rounded up to 50 cents: about $0.50 for a config card and $1.50 for a code card | `platform/agents/rubrics/draft-game.md`, `docs/specs/launch-cards.md` |

### What one contribution becomes, at the default split

| Paid | Stripe fee | Net | Reserve (10%) | Agents (72% of net) | Studio (18% of net) | Studio share of what was paid |
|---|---|---|---|---|---|---|
| $1 | $0.27 | $0.73 | $0.07 | $0.53 | $0.13 | 13% |
| $5 | $0.39 | $4.62 | $0.46 | $3.32 | $0.83 | 17% |
| $10 | $0.53 | $9.47 | $0.95 | $6.82 | $1.70 | 17% |
| $25 | $0.97 | $24.04 | $2.40 | $17.31 | $4.33 | 17% |
| $50 | $1.69 | $48.31 | $4.83 | $34.78 | $8.70 | 17% |

Lessons:

- **Below $3 the fixed fee eats the studio.** At $1, 27% goes to Stripe. The preset amounts on the Machine card (5, 10, 25, 50, 100 USD) start at $5 for this reason, and suggested amounts on cards should round small top-ups up to a card's remainder or $5, whichever is larger. This is a display choice, not a money rule.
- **One $10 contribution buys a lot of work.** $6.82 for the agents is about 13 shipped cards at the measured $0.51, or about 4 code cards at their $1.50 targets. Money, not compute price, is rarely the limit; the card supply and the caps are (`docs/BACKLOG.md`, A card supply that keeps pace with funding).
- **The split is trusted because it moves.** Humble Bundle's history shows taking a slider away costs more than never offering it (`docs/research/comparables.md`). The default stays 80/20.

## 3. What the studio costs to run

### Today

Everything runs on free tiers (`docs/PLAN.md` §10 decision 35): Netlify, Supabase, GitHub Actions in a public repository, Discord. The board pays for the domains. The studio's share pays Stripe's fees on refunds and disputes and on the studio's own purchases. Fixed monthly cost: about $0.

### What the final state adds, and when each cost starts

Each step is triggered by load or capability, not by a date. Prices are the vendors' published list prices as the authors understood them and are **assumptions** to check at the time of purchase.

| Step | Trigger | Monthly cost (**A**) | Why |
|---|---|---|---|
| Transactional email | Profiles go live: sign-in links and ship notices pass the free sending allowance of the auth provider's built-in mail | about $20 | Sign-in links must arrive within a minute; the default sender is rate-limited and not meant for production |
| Database on a paid plan | Database size passes the free tier, or point-in-time backups are needed for the community tables | about $25 | Growth tables (events, votes, seeds) and backups |
| Site hosting on a paid plan | Edge-cached reads or function calls pass the free allowance | about $20 | The feed, snapshot and gallery are cached functions (`docs/specs/final-state.md`, Scale) |
| A streaming machine | The board decides to stream around the clock rather than when present | $20 to $40 | OBS loading /broadcast as a browser source |
| A part-time human moderator | Held suggestions, names or seeds wait longer than the target in `benchmarks.md` | $500 to $2,000 | The one cost that grows with the community rather than with money |

The founder's time is not costed here; it is tracked privately (`docs/PLAN.md` §4 The Board).

## 4. Path to profitability

Profit is the studio's share minus the studio's own costs. Coverage is the studio's share divided by those costs (`docs/VISION.md` §1). Each stage below is reached by gross contributions in a month at the default split and a $10 average contribution (**A**: the average is not yet measured; the review team replaces it with the ledger's figure).

| Stage | What it pays for | Monthly costs (**A**) | Gross contributions needed a month | Supporters a month at one $10 contribution each |
|---|---|---|---|---|
| 0. Self-funding | Fees on refunds and disputes | about $0 | any | any |
| 1. Production stack | Email, database and hosting on paid plans | about $65 | about $380 | about 40 |
| 2. Always-on stage | Stage 1 plus a streaming machine | about $100 | about $590 | about 60 |
| 3. Human moderation | Stage 2 plus a part-time moderator at $1,500 | about $1,600 | about $9,400 | about 940 |
| 4. A founder's wage | Stage 3 plus $5,000 a month for the operator | about $6,600 | about $38,800 | about 3,900 |

How it is computed: the studio keeps 18% of net at the default split, and net is about 94.7% of a $10 contribution, so about 17% of gross is studio income. Gross needed = costs / 0.17.

For scale: the kick-off plan's Mid scenario was about $27,000 over its first three months, and its Pop scenario about $400,000 (`docs/research/comparables.md` and the kick-off plan). Stage 3 sits between them; stage 4 needs Pop-like traffic or a second revenue line.

### Levers, in order of use

1. **Conversion from visitor to supporter.** The cheapest growth: the live studio, the feed and rare cards turn watching into funding (`growth.md`).
2. **Repeat funding.** Collections, levels, badges and ship notices give a supporter reasons to fund again.
3. **Contribution size.** Presets and card remainders that avoid fee-heavy micro-payments.
4. **More people watching.** The stream, seeds and box art bring new visitors without paid acquisition.
5. **New revenue lines** (below), each only once the earlier levers are measured.
6. **The default split.** Last, and only through its own kernel spec. A change that reads as greedy costs more trust than it earns.

## 5. Revenue lines

| Line | State | Notes |
|---|---|---|
| Studio share of card contributions | Now | The only income today |
| Studio share of the Machine card | In this series | General support at preset amounts; fills the pool exactly like Fund the next card in line (`docs/PLAN.md` §10 decision 73) |
| Loyalty bonus for repeat supporters | Later | A recognition-first loyalty system ships in this series; a money bonus or discount is a later kernel spec because it changes money (`docs/BACKLOG.md`, Loyalty bonus for repeat supporters) |
| Membership tiers | Later | Monthly support with recognition benefits; needs HST registration first, since named benefits are sales (`docs/BACKLOG.md`, Membership tiers) |
| Twitch Bits and subscriptions | Later | Once the channel is an Affiliate; the meter shows Twitch's cut beside the site's (`docs/BACKLOG.md`, Twitch Bits and subscriptions) |
| Sponsors on the goals track | Later | A named sponsor funds a milestone on credits-for-logo terms, shown as a sponsor and never as a promise (`docs/BACKLOG.md`, Sponsors on the goals track) |
| The pipeline for other studios | Idea | The card, gate and review pipeline as a service (`docs/PLAN.md` §5 Possible later income) |
| Steam supporter pack | Idea | Only after the Steam release path's threshold (`docs/BACKLOG.md`, Steam release path) |
| Box art prints | Idea | Each game's code-drawn box art as a print; a sale, so after HST registration |

YouTube advertising is not assumed: YouTube demonetises mass-produced uploads, and the clips are a discovery channel, not income.

## 6. Competitive position

| Alternative for the audience's money or time | Why someone would choose Mob Machine instead |
|---|---|
| Kickstarter or Patreon for a game | Smaller, faster, checkable outcomes; nothing pre-sold; the books are open |
| Watching a game developer stream | The work never stops for sleep, and the audience steers it |
| Free browser and mobile games | No ads, no paid advantage, and the game changes because players asked |
| Collectible card games | Collecting without paying for chance |
| Other AI agent demos | Real money, real shipped work, real failures shown |

The moat is the combination and its record: a public ledger of every card, a studio history of eras and shipped games, a community's collections and suggestions. None of it can be copied by cloning the code.

## 7. Risks

| Risk | Signal | Answer |
|---|---|---|
| Novelty decays before the loop retains people | Visitors fall after each launch beat and do not return | Retention features (feed, collection, eras, ship notices); launch beats tied to new capabilities so there is always news (`growth.md`) |
| Fee drag | Median contribution under $5 | Presets from $5; card remainders rounded up |
| Cards that change nothing a player can see | Visible change per dollar falls | The Game Director's rubric and `game-quality.md` |
| Rarity read as gambling | Complaints, press | Published rule and odds on the card, nobody pays for a roll, XP not money; the FAQ says so |
| Moderation load outgrows the board | Held items wait past target | Curator triage, filters, rate limits; then a paid moderator (stage 3) |
| Agent cost rises | Cost per shipped card rises over trailing windows | Card ceilings, the replay eval, model choice per role |
| Platform dependence (Stripe, Anthropic, Netlify, Supabase, Twitch) | Outage or policy change | The site is the source of truth; channels link back; a second model provider stays in the backlog |
| Legal and tax | Contributions pass the review threshold | The board's tax review at $15,000 and registration before any sale (`BOARD-SETUP.md`) |

## 8. Kill and pivot conditions

Windows are measured from events, not dates: "after Phase 2 starts" means after the last pull request of the final-state series is live and the first launch beat in `growth.md` has run. Every figure below is a proposal for the board to confirm.

| Window | Kill or pivot if | Pivot to |
|---|---|---|
| 30 days after Phase 2 starts | under 25 distinct supporters, under $500 gross, or the board spends more than 10 hours a week on operations | A weekly live show: the stream runs only during a set block, cards close on the show, and the site stays as the record |
| 90 days after Phase 2 starts | under 100 distinct supporters, under $2,000 cumulative, or D7 return of players under 2% | A public demo: contributions close, the games and the history stay up, the pipeline is offered as a service or a write-up |
| 180 days after Phase 2 starts | under $6,000 cumulative and no revenue line beyond contributions in sight | Archive: close contributions, refund unspent agent money by the Terms' wind-down rule (`docs/PLAN.md` §5 Terms), publish the post-mortem and the kit |

Continue and invest when the opposite holds: stage 1 of the path above reached within 90 days of Phase 2 and repeat supporters above the target in `benchmarks.md`.
