# Growth and marketing

How people find Mob Machine, start using it, come back and bring others, with each step tied to a product feature and a measurable outcome in `benchmarks.md`. The studio has no paid acquisition budget (`docs/PLAN.md` §10 decision 35) and no referral payouts (supporters may be minors, and a payout is a money flow the kernel does not have). Growth comes from the product being worth watching and from moments worth sharing.

## The growth loop

```
 something happens in the studio (a rare card opens, a card ships, an era changes)
        │
        ▼
 it becomes a shareable artifact (feed item, clip, seed, box art, card preview)
        │
        ▼
 a stranger sees it (Twitch, Shorts, Reddit, Discord, a friend's link)
        │
        ▼
 they land on the site's live studio or a seed, and play or watch
        │
        ▼
 they suggest, upvote, save a seed or fund a card ──► which makes the next thing happen
```

Every arrow is a feature. The loop is weakest where an arrow has no feature; the roadmap closes those first.

## Acquisition

| Channel | What brings people | Product feature it depends on | Outcome measured |
|---|---|---|---|
| Hacker News, Reddit (r/ClaudeAI, r/artificial, r/incremental_games, r/WebGames) | Launch beats with a concrete claim and proof ("AI agents rebuilt our game in Three.js; here is every card and what it cost") | The ledger, card pages with steps, `docs/launch/` drafts | New supporters per launch beat; visitor to player |
| Twitch | The studio live, rare card moments, ships | /broadcast overlay | Broadcast reach; contributions from the QR source |
| YouTube Shorts and TikTok | 15 to 45 second clips of a moment: a legendary card opening, a ship, an era change, a before and after of a game change | Event beats in the feed that are visually distinct; box art | Seed and card link opens from Shorts (needs the source tags) |
| Discord | Ship, milestone and suggestion posts | Built ship posts; suggestion status | Discord to site clicks |
| Seeds and run images | A friend's shared run that opens at the same moment | Seeds (`?seed=`), Share your run image | Seed opens per shared seed |
| Card links | A friend's funded card with its preview | Card share and preview images | Card shares per contribution |
| itch.io | Each game listed as a free web game with its box art | Box art; a game page per game | Plays from the itch.io referrer (aggregate) |
| Press | Stories about an AI studio funded in public, with numbers | The ledger, /goals, /studio/history | Spikes in new supporters per beat |

Order: Reddit and Hacker News first (they move early audiences for AI projects; `docs/PLAN.md` §7 Channels), then X and press, with Shorts as a steady long tail. Twitch is the stage, not a discovery engine: its directory rarely surfaces small channels, so the stream is promoted by the other channels and grows through clips and raids.

## Activation: the first visit

The target is the "10 seconds, 60 seconds, 2 minutes" bar in `docs/VISION.md` §2, sharpened for the final state:

| Moment | What the visitor should see and do | Feature | Benchmark |
|---|---|---|---|
| First 5 seconds | A living room of characters at work and one plain sentence of what this is | Live studio on home, the pitch | Studio dwell |
| First 30 seconds | One agent hovered or tapped: "Builder A is building 'Carts leave dust trails'" | Agent detail on hover, focus or tap | Studio dwell |
| First 60 seconds | Played a game, or opened a card near full | Play free, card flow, next-card line in the game | Visitor to player; player to card |
| First 2 minutes | Funded, suggested, saved a seed, or signed up to be told when something ships | Fund, /suggest, Save as seed, Tell me when this ships on a card (`docs/specs/card-follows.md`), magic-link profile | Visitor to participant; visitor to supporter |

Rules: no account is needed to play or fund; a profile is offered only at the moment it adds something (saving a seed to a profile, claiming a contribution, suggesting, following a card); no pop-ups, no email capture walls.

## Retention

| Reason to come back | Feature | Benchmark |
|---|---|---|
| Something I funded shipped | Ship notice email, "Since your last visit", the feed | Return after ship |
| Something I followed shipped | One email per followed card when it goes live (`docs/specs/card-follows.md`), the followed list on /me | Follows per profile; return after ship |
| My suggestion moved | Suggestion state page; XP when accepted or shipped | Returning profiles; suggestion to live |
| My collection grew; a rare card might open | Collection, rarity announcements, badges | Collections; returning profiles |
| The studio changed | Eras, earned decor, /studio/history | Studio dwell |
| My run kept going | Time-away credit in the game, seeds | Player D1 and D7 |
| A new game is being pitched | New game stages; early looks for supporters | Repeat supporter rate |

Not used: streaks, daily login rewards, timers that punish absence, or anything that makes a supporter feel they owe a visit. Progress moves on real events, so returning always shows real news.

## Virality without referral payouts

People share what makes them look good, what surprised them, or what they made. The studio gives each of those a ready artifact, drawn in code with the studio's look, stating only public facts:

| Shareable | Why someone shares it | Artifact |
|---|---|---|
| A seed | "Look at my run" or "try this from where I am" | A link that opens the run, and the run image |
| A legendary card I funded | Rarity is status, and it is checkable | Card link with a rarity frame in its preview |
| A suggestion that shipped | "I asked for this and it is in the game" | Card link with "Suggested by" |
| A milestone reached | Being part of something that grew | /goals and the era blueprint image |
| A new game's box art | It looks like a real game | Box art as the link preview |
| A broadcast moment | It happened live | A clip |

The share surfaces follow the rules in `docs/research/comparables.md` (no countdown, no chance cue near money, no ranking of supporters by amount).

## Content as a process

There is no content calendar with dates. Each kind of studio event produces a fixed set of content, made the same way every time. The Community agent proposes the copy as typed fields; posts go out through the outbound lane that already sends ship posts.

| Event (trigger) | Feed | Discord | Clip or Short | Site |
|---|---|---|---|---|
| A card ships | Yes | Ship post (built) | When the change is visible in a game: before and after | Card page, game page |
| A rare or legendary card opens | Yes, with the rarity frame | Post | Legendary: yes | Card page |
| A milestone is reached | Yes | Milestone post (built) | Yes | /goals updated |
| An era begins | Yes | Post with the new blueprint | Yes: the room changing | /studio/history |
| A suggestion ships | Yes, with "Suggested by" | Suggestion status post | When visible | Suggestion page |
| A new game reaches a stage (Pitch, Prototype, First playable) | Yes | Post | Prototype and First playable: yes | Game page with box art |
| A seed is featured | Yes | Post | Optional | /seeds |
| An incident and its post-mortem | Post-mortem on the ledger | Link | No | Ledger |
| A weekly report | No | Weekly post (built) | No | Report page |

Each row is measured by the benchmark for its channel. The review team (`operating-system.md`) drops a row that produces no measurable outcome over two reviews.

## Channel plan

| Channel | Role | Posting rule | What never happens there |
|---|---|---|---|
| The site | Source of truth: every record, every action | Always on | Nothing important exists only elsewhere |
| Twitch | The stage | The studio streamed from /broadcast, when the board chooses to go live, and around the clock once the stream entry is built | Chat never reaches an agent; no host speaks until the delay and kill switch exist |
| Discord | The clubhouse | Event posts from the table above; members chat among themselves | Members' text never reaches an agent |
| YouTube Shorts | Discovery | One Short per clip-worthy event above | No mass-produced uploads; each Short is a real moment |
| Reddit, Hacker News, X | Launch beats | One post per beat, written by a person on the board | No astroturfing, no vote requests |
| Email | Ship notices to payers, and one email to a signed-in player when a card they follow ships | One per payment and shipped card, and one per follow, each with a one-click unsubscribe (built; `docs/specs/ship-notices.md`, `docs/specs/card-follows.md`) | No marketing email without opt-in |

## Launch beats tied to product capabilities

A beat is announced when the capability it shows is live, not on a date. Each beat has one claim, one proof link and one measurable goal.

| Beat | Capability that triggers it | Claim | Proof link | Goal (`benchmarks.md`) |
|---|---|---|---|---|
| 1. The studio comes alive | Live studio and feed on home | "Watch the AI agents of a game studio at work, live" | Home | Studio dwell at target; 25 new supporters in 7 days |
| 2. Dust, rebuilt | Dust on Three.js at the quality bar, with box art | "Our agents rebuilt our first game in 3D" | The game, its box art, the cards that built it | Player D1 at target; shares per 100 loads |
| 3. Collect the cards | Suits, rarity, collection, XP | "Every card has a rarity anyone can check. Nobody pays for a roll." | A rare card's page and the rarity FAQ | Collections; participant to supporter |
| 4. You suggest, agents build | /suggest, Curator, suggestion states | "Suggest a feature; watch it move from idea to live" | The first shipped suggestion | Suggestions per profile; suggestion to live |
| 5. Seeds | Seeds gallery | "Share a run anyone can open and continue" | /seeds | Seed opens per shared seed |
| 6. Live on Twitch | /broadcast running on a channel | "The studio is now on Twitch" | The channel | Broadcast reach |
| 7. A new game is pitched | First New game Pitch card | "Fund the pitch for our second game" | The Pitch card | Repeat supporter rate |
| 8. A new era | First era change on a milestone | "The studio moved out of the garage" | /studio/history | Spike in visitors to supporters |

Beats 1 to 5 follow the final-state series as each branch merges; 6 to 8 follow when the studio reaches them. Two beats are never announced within the same 7 days, so each can be measured on its own.
