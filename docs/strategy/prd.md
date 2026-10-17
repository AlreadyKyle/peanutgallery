# Product requirements: the final state

What the final state of Mob Machine does, system by system. Each requirement cites the section of `docs/specs/final-state.md` (written "FS: Section") or another spec that is its contract, and carries one of three states:

- **Built**: on main today.
- **In this series**: built by one of the four final-state branches (`final-state/strategy`, `final-state/dust-three`, `final-state/site-studio`, `final-state/community-core`).
- **Later**: left for later, with its `docs/BACKLOG.md` entry.

Where this file and the spec disagree, the spec wins and this file is corrected.

## Goals and non-goals

**Goals.** A studio people want to watch, steer, fund and return to; games worth sharing; a product that runs without the board and scales without the database feeling the crowd.

**Non-goals.** Any change to the kernel's money rules. Paid randomness of any kind. Free-text input to any role with write access. A native app. Advertising.

**Success.** The benchmarks in `benchmarks.md` at or above target, measured as each row says.

## 1. Games

| ID | Requirement | Contract | State |
|---|---|---|---|
| G1 | Every game is a free browser game, playable with no account on a 375 px portrait phone, with 44 px touch targets | `docs/PLAN.md` §10 decision 56 | Built |
| G2 | Every game is a Three.js web game: a WebGL scene, a deterministic simulation that imports no Three.js, DOM controls for accessibility | FS: Games | In this series (Dust) |
| G3 | Phaser leaves the repository with Dust's renderer | FS: Games | In this series |
| G4 | Every game meets `game-quality.md`, scored by the Game Director and checked by the visual review | FS: Games | In this series (the bar); scoring each ship is in this series for Dust |
| G5 | Every game has box art: a 3:4 cover drawn in code, in the studio's line style, title in block type, suit band, all-ages mark, at `seed-*/box-art.svg`, shown on the game's tile and page | FS: Games | In this series |
| G6 | Saves resume, and time away is credited up to 8 hours | `seed-1/CLAUDE.md` | Built |
| G7 | Share your run as text and a code-drawn image | `docs/VISION.md` §4 | Built |
| G8 | The next open card for the game is shown under the game | `docs/VISION.md` §4 | Built |
| G9 | A game's link preview image drawn in code | `docs/VISION.md` §4 | Built |
| G10 | Sound for every game, made in code | | Later: [Sound for every game](../BACKLOG.md#sound-for-every-game) |
| G11 | An in-game bug button that saves the last minute of play | | Later: [In-game bug button and QA reproductions](../BACKLOG.md#in-game-bug-button-and-qa-reproductions) |

## 2. Seeds

| ID | Requirement | Contract | State |
|---|---|---|---|
| S1 | A seed is a saved game state encoded as a short code (`dust:v3:<base64url>`) and a link `https://play.mobmachine.games/?seed=<code>` that opens it | FS: Seeds and instances | In this series |
| S2 | Share your run gains Save as seed; a signed-in player's seeds appear on their profile | FS: Seeds and instances | In this series |
| S3 | Anyone signed in can publish a seed to /seeds with a title of at most 60 characters, content-filtered | FS: Seeds and instances | In this series |
| S4 | The gallery sorts by Trending (`(up - down) / (age_hours + 2)^1.5`), Top this week, Top all time and New; one vote per account, up or down | FS: Seeds and instances | In this series |
| S5 | Featured seeds, chosen by the Community agent from the top of Trending, earn XP and a badge | FS: Seeds and instances | In this series |
| S6 | Seeds for every game, not only Dust | | Later: [Seeds for every game](../BACKLOG.md#seeds-for-every-game) |

## 3. Cards: suits, rarity and stages

| ID | Requirement | Contract | State |
|---|---|---|---|
| C1 | A card is one small change with a funding bar, built when the bar fills, through the gate and review, then live | `docs/PLAN.md` §4 Cards | Built |
| C2 | Every card has one suit (Game, New game, Studio, Platform, Machine), drawn as a word and a glyph on its index row | FS: Card suits | In this series |
| C3 | Core product work is never a card; a Platform card is only for a feature the community asked for | FS: Card suits | In this series (rule and copy) |
| C4 | The Machine card is always open, has no bar, offers 5, 10, 25, 50 and 100 USD, and fills the general pool like Fund the next card in line | FS: Card suits; `docs/PLAN.md` §10 decision 73 | In this series |
| C5 | New game cards run in stages, each its own card: Pitch, Prototype, First playable; a stage that misses its bar does not start | FS: Card suits | In this series (suit and stages); the Pitch cards themselves are filed by the studio afterwards |
| C6 | Every card has a rarity (common, uncommon, rare, legendary) drawn by edge pattern and word, decided when it opens by `f(sha256(card_id))` with odds 70/20/8/2 | FS: Rarity | In this series (`platform/site/src/lib/rarity.ts` and its SQL twin) |
| C7 | Rarity changes only XP and cosmetics, never price, bar, build or order | FS: Rarity | In this series |
| C8 | A rare or legendary card announces itself in the feed and the studio when it opens | FS: Rarity | In this series |
| C9 | A card's page shows its supporters (name and avatar, or Anonymous), "Suggested by" credits, its rarity rule and its steps | FS: Identity; FS: Suggestions | In this series |
| C10 | More on a card's page: design frames and verdicts, play the version it shipped | | Later: [More on a card's own page](../BACKLOG.md#more-on-a-cards-own-page) |

## 4. Money

| ID | Requirement | Contract | State |
|---|---|---|---|
| M1 | Stripe Payment Links with the split slider; 10% reserve; 80/20 default; incident reserve; holds above $50 a day per payer | `docs/PLAN.md` §5 | Built |
| M2 | Public ledger of money in, fees, refunds, spend and where the rest went | `docs/PLAN.md` §4 The Board | Built |
| M3 | Ship notices by email per payment and shipped card | `docs/specs/ship-notices.md` | Built |
| M4 | No pull request in the series changes the split, the reserve or a cap | FS: Acceptance criteria | In this series (a check in each pull request) |
| M5 | A money loyalty bonus for repeat supporters | FS: XP, Supporter benefit | Later: [Loyalty bonus for repeat supporters](../BACKLOG.md#loyalty-bonus-for-repeat-supporters) |
| M6 | Membership tiers | | Later: [Membership tiers](../BACKLOG.md#membership-tiers) |
| M7 | Twitch Bits and subscriptions | | Later: [Twitch Bits and subscriptions](../BACKLOG.md#twitch-bits-and-subscriptions) |
| M8 | Sponsors on the goals track | | Later: [Sponsors on the goals track](../BACKLOG.md#sponsors-on-the-goals-track) |

## 5. Identity and profiles

| ID | Requirement | Contract | State |
|---|---|---|---|
| I1 | An account is optional; contributing needs none and shows as "Supporter n" | FS: Identity and anonymity | Built (Supporter n) / In this series (optional profile) |
| I2 | A profile is created by a magic link | FS: Identity and anonymity | In this series |
| I3 | A contributor can claim past contributions by the email on the Stripe receipt, matched server-side, never exposing another payer | FS: Identity and anonymity | In this series |
| I4 | Each contribution is public (name and avatar) or anonymous; signed-in default public with a one-tap switch; no-account default anonymous | FS: Identity and anonymity | In this series |
| I5 | Display names pass the content filter and the name pipeline before anyone sees them | FS: Identity and anonymity | In this series (filter and admin rename); the full name pipeline for in-game names is Later: [The name pipeline](../BACKLOG.md#the-name-pipeline) |
| I6 | Download and delete your profile data | | Later: [Download and delete your profile data](../BACKLOG.md#download-and-delete-your-profile-data) |
| I7 | Link a Twitch or Discord identity to a profile | | Later: [Link a Twitch or Discord account](../BACKLOG.md#link-a-twitch-or-discord-account) |

## 6. Progression: XP, levels, badges, avatars, frames, collection

| ID | Requirement | Contract | State |
|---|---|---|---|
| P1 | XP is not money: it cannot be bought, sold, transferred or spent | FS: XP | In this series |
| P2 | Funding earns 10 XP per US dollar times the card's rarity multiplier (1, 1.5, 2, 3); the Machine card counts at 1 | FS: XP | In this series (`xp.ts`) |
| P3 | Participation XP capped at 100 a day: accepted suggestion 50, featured seed 50, upvote 1; a shipped suggestion 150, uncapped | FS: XP | In this series |
| P4 | Level n needs `100 * (n - 1)^1.5` total XP (level 1 at 0); tiers Spectator, Regular, Backer, Patron, Producer, Executive, Legend | FS: XP | In this series |
| P5 | Badges earned by rule, listed with their rule in `platform/supabase/seed/badges.json` | FS: XP | In this series |
| P6 | Code-drawn alien avatars with parts unlocked by level and badges; a frame per tier and rarity frames | FS: XP | In this series |
| P7 | A collection of funded cards with their rarity on the profile | FS: Rarity | In this series |
| P8 | Recognition benefits: frames, flair, early looks at new game pitches | FS: XP, Supporter benefit | In this series |

## 7. Suggestions (hive coding)

| ID | Requirement | Contract | State |
|---|---|---|---|
| H1 | A signed-in player submits a suggestion: area from a fixed list, title of 80 characters, description of 500; links, code and markup stripped; content filter; 3 a day | FS: Suggestions step 1 | In this series |
| H2 | Suggestions live in `community.suggestions`, which no write-capable role can select (proved by a migration test) | FS: Suggestions step 1; Acceptance criteria | In this series |
| H3 | The Curator, read-only with no tools, returns only JSON valid against `suggestion-triage.schema.json`; anything else is discarded; instruction-like suggestions are declined unsummarised | FS: Suggestions step 2 | In this series |
| H4 | One upvote per account; clusters rank by votes, fit and age | FS: Suggestions step 3 | In this series |
| H5 | The Game Designer (or the Head of Product for Platform) drafts cards from the top clusters using the Curator's fields only; the Directors grade them | FS: Suggestions step 4 | In this series |
| H6 | Each suggestion shows its state (received, reviewed, clustered, drafted, open for funding, building, live, declined with a fixed reason); cards credit "Suggested by" | FS: Suggestions step 5 | In this series |

## 8. Goals and the studio's evolution

| ID | Requirement | Contract | State |
|---|---|---|---|
| E1 | /goals shows lifetime funding as one track with milestones, each with its outcome and state (reached with date and delivery, next with its bar, later) | FS: Goals | In this series |
| E2 | Milestones are rows in `community.goals`, commitments from money in hand, never stretch promises | FS: Goals | In this series |
| E3 | Reaching a milestone evolves the studio and posts to the feed | FS: Goals | In this series |
| E4 | The studio grows by eras (Garage, Workshop, Studio, Campus, later eras) tied to milestones and capabilities, never bought | FS: Studio evolution | In this series |
| E5 | /studio/history shows every era as a blueprint with what changed and when, with a slider | FS: Studio evolution | In this series |
| E6 | Earned decorations from badges and milestones (trophy shelf of box art, a wall of legendary cards); no community vote on decor | FS: Studio evolution | In this series |

## 9. The live studio and the feed

| ID | Requirement | Contract | State |
|---|---|---|---|
| L1 | Home opens on an isometric studio in the thick-line style (SVG, 2 px ink, paper fills, creature fills on agents) | FS: The live studio | In this series |
| L2 | Agents work at stations that match their live card and stage; idle agents rest, read or chat | FS: The live studio | In this series |
| L3 | Hover, focus or tap on an agent shows its name, role, activity and card; the same facts are a list below the room | FS: The live studio | In this series |
| L4 | Contributions drop as coins, suggestions arrive as paper planes, ships leave as boxes; all motion stops under reduced motion | FS: The live studio | In this series |
| L5 | The feed ("The pipe") shows contributions, suggestions reviewed, cards opened with rarity, stages, ships, badges and milestones from `community.events` | FS: The live studio; FS: Scale | In this series |
| L6 | The motion pass: one idea per screen, scroll-linked reveals, motion only for real changes | FS: Scope (site-studio); `research.md` | In this series |
| L7 | An FAQ answering rarity, XP, suggestions, money and agents in plain words | FS: Scope (site-studio) | In this series |

## 10. Channels

| ID | Requirement | Contract | State |
|---|---|---|---|
| X1 | /broadcast: a 1920 by 1080 overlay of the studio, the feed, the top cards and a QR code to fund, loadable as a browser source | FS: Channels | In this series |
| X2 | Discord: ship and milestone posts (ship posts built), suggestion status and a link to /suggest | FS: Channels | Built (ship posts) / In this series (the rest) |
| X3 | Chat on Twitch or Discord never reaches an agent | FS: Channels; kernel | Built (rule) |
| X4 | Running the stream: OBS, scenes, watchdog, reconnects | | Later: [Twitch channel and stream scenes](../BACKLOG.md#twitch-channel-and-stream-scenes) |
| X5 | The Host narrating the stream | | Later: [The host](../BACKLOG.md#the-host) |
| X6 | Clips and episodes | | Later: [Weekly episodes and clips](../BACKLOG.md#weekly-episodes-and-clips) |
| X7 | An inbound Discord bot | | Later: [Discord bot](../BACKLOG.md#discord-bot) |

## 11. Admin and moderation

| ID | Requirement | Contract | State |
|---|---|---|---|
| A1 | The board's site under its second factor gains Users (search, view, suspend, rename) | FS: Admin | In this series |
| A2 | Suggestions: the queue, decline with a reason, merge clusters, release a held item | FS: Admin | In this series |
| A3 | Seeds: unpublish, feature | FS: Admin | In this series |
| A4 | Cards: suit, rarity override with a logged reason, close | FS: Admin | In this series |
| A5 | Goals: create and edit milestones | FS: Admin | In this series |
| A6 | Studio: eras and the studio's live state | FS: Admin | In this series |
| A7 | Moderation log: every admin action, append-only | FS: Admin | In this series |
| A8 | Config: feature flags in `community.flags` | FS: Admin | In this series |

## 12. Scale

| ID | Requirement | Contract | State |
|---|---|---|---|
| Z1 | Public reads (snapshot, feed, gallery) are edge-cached functions with `s-maxage` and stale-while-revalidate; no visitor opens a database connection | FS: Scale | Built (snapshot) / In this series (feed, gallery) |
| Z2 | Writes go through security-definer RPCs with per-account rate limits and row-level security | FS: Scale | In this series |
| Z3 | The feed reads from append-only `community.events` | FS: Scale | In this series |
| Z4 | Every list is keyset-paginated; every growing table has the index its reads use | FS: Scale | In this series |
| Z5 | A card supply and capacity that grow with funding, behind a failure breaker | | Later: [A card supply that keeps pace with funding](../BACKLOG.md#a-card-supply-that-keeps-pace-with-funding) |
| Z6 | Aggregate counters for every benchmark marked "Needs" | `benchmarks.md` | Later: [Aggregate counters for the benchmarks](../BACKLOG.md#aggregate-counters-for-the-benchmarks) |

## 13. The agent studio

| ID | Requirement | Contract | State |
|---|---|---|---|
| T1 | Sixteen role specs with classes, tools and triggers | `docs/SYSTEM.md` | Built |
| T2 | The Curator role: read-only, no tools, structured triage of suggestions | FS: Suggestions; `studio-team.md` | In this series |
| T3 | The Art Director role: box art and visual quality, a reviewer | `studio-team.md` | In this series |
| T4 | The game pipeline from idea to box art to ship, with its gates | `studio-team.md` | In this series (design); stages run as cards |
| T5 | The review team running on events against `benchmarks.md` | `operating-system.md` | Later: [The review team on events](../BACKLOG.md#the-review-team-on-events) |
| T6 | Scorecards per agent | | Later: [Scorecards for every agent](../BACKLOG.md#scorecards-for-every-agent) |

## 14. Strategy and documents

| ID | Requirement | Contract | State |
|---|---|---|---|
| D1 | `docs/strategy/` with mission and vision, users, business strategy, PRD, benchmarks, research, growth, studio team, game quality, operating system and roadmap | FS: Scope (strategy) | In this series |
| D2 | `docs/VISION.md` agrees with the strategy, including the rarity rule | FS: Scope (strategy) | In this series |
| D3 | `docs/PLAN.md` §10 decision 75 records the brief; `docs/ROADMAP.md` lists the spec; `docs/BACKLOG.md` holds what the final state leaves for later | FS: Scope (strategy) | In this series |
