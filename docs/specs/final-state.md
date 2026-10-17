# Final state: the studio you can watch, steer and collect

Status: agreed. Card: none. Owner: studio.

The board's brief of 17 October 2026 asks for Mob Machine's final product state: a studio people want to watch, steer, fund and come back to, with games of a quality worth sharing. This spec is the contract that every pull request in the final-state series builds against. The strategy behind it is `docs/strategy/` (vision, PRD, benchmarks, research, growth, operating system); where this spec and an older decision disagree, this spec and PLAN.md §10 decision 75 win.

## Problem

The loop works (fund a card, agents build it, it ships), but the product around it is thin. Dust looks like a prototype beside the browser games players already know. The studio is described rather than shown. Funding has one card shape and no sense of collection, progress or identity. The crowd cannot suggest anything, cannot keep or share a run, and has no reason to come back beyond the next card.

## Scope

In: the series below. Out: changes to the kernel's money rules (the 80/20 default split, the 10% reserve, the caps), which stay as they are. Anything here that touches money is a display of money that already exists, or XP, which is not money.

The series, one branch and draft pull request each:

1. `final-state/strategy`: `docs/strategy/` and the docs it changes (VISION, PLAN §10 decision 75, ROADMAP, BACKLOG clean-up, SYSTEM).
2. `final-state/dust-three`: Dust's renderer moves from Phaser to Three.js, with a full art and feel pass.
3. `final-state/site-studio`: the public site: the live isometric studio, the feed, the card suits and rarity, goals, profiles, suggestions, seeds, the broadcast overlay, the FAQ and the motion pass.
4. `final-state/community-core`: the data layer (migrations, RPCs, public views), the new agent roles and the suggestion pipeline, and the admin on the board's site.

## Decisions this spec fixes

### Mission, vision, promise

- Mission: make game development a show anyone can watch, steer and fund.
- Vision: the most watched game studio in the world, where a crowd and a team of AI agents build games together in public.
- Promise (unchanged pitch): "Watch AI agents build a game studio and free games."

### Games

- Every game is a Three.js web game: a scene in WebGL, a deterministic simulation with no Three.js import, DOM controls for accessibility. Phaser leaves the repository with the Dust renderer.
- Every game has box art: a 3:4 cover drawn in code (SVG or Three.js render to PNG at build time), in the studio's line style, with the title in block type, a suit band and the all-ages mark. `seed-*/box-art.svg` is the file; the site shows it on the game's tile and the game's page.
- The quality bar for a game is `docs/strategy/game-quality.md`: it is the Game Director's rubric and the visual review's checklist.

### Card suits (what a card funds)

Every card has one suit. The suit says what the money pays for and is drawn as a word and a glyph on the card's index row.

| Suit | Key | Funds | Example |
|---|---|---|---|
| Game | `game` | A change to a live game | "Carts leave dust trails" |
| New game | `new_game` | A new game, from pitch to first playable | "Seed 2: a tiny tower defence" |
| Studio | `studio` | The agent team: a new role, better tools, more capacity | "Hire a sound designer" |
| Platform | `platform` | A community-requested feature of the site | "Dark mode" |
| Machine | `machine` | General support for the whole studio, no single change | "Keep the Machine running" |

- Core product work (the site, the studio, the agents, admin, money systems) is never a card: the studio builds it in pull requests like this one. A Platform card is only for a feature the community asked for.
- The Machine card is always open. It has no bar that fills and closes; it shows preset amounts (5, 10, 25, 50 and 100 USD) and fills the general pool, which funds the next card in line and drafting, exactly like decision 73's "Fund the next card in line".
- New game cards run in stages, each its own card: Pitch, Prototype, First playable. A stage that misses its bar does not start; nothing is pre-sold.

### Rarity (excitement without gambling)

- Every card has a rarity: common, uncommon, rare or legendary, drawn on its face (edge pattern and a word, never colour alone).
- Rarity is decided when a card opens, by a published rule anyone can check: `rarity = f(sha256(card_id))` with published odds (common 70%, uncommon 20%, rare 8%, legendary 2%). Nobody pays for a roll and contributing rolls nothing.
- Rarity changes only XP and cosmetics: contributors to a card earn its XP multiplier (1x, 1.5x, 2x, 3x) and the card joins their collection with its rarity. It never changes the price, the bar, what gets built or the order cards build in.
- A rare or legendary card announces itself in the feed and the studio when it opens ("A rare card appeared").

### XP, levels, badges, avatars, frames

- XP is not money and cannot be bought, sold, transferred or spent. It is a record of participation.
- Funding: 10 XP per US dollar contributed, times the card's rarity multiplier. The Machine card counts at 1x.
- Participation XP, capped at 100 a day so money stays the main path but non-payers progress: an accepted suggestion 50, a suggestion that ships 150 (not capped), a seed featured 50, an upvote cast 1.
- Levels: level n needs `100 * n^1.5` total XP, rounded. Level names run in tiers: Spectator, Regular, Backer, Patron, Producer, Executive, Legend.
- Badges are earned by rule (first card, five suits, first legendary, a card you funded shipped, a suggestion shipped, ten seeds shared and so on), listed with their rule in `platform/supabase/seed/badges.json`.
- Avatars: the same code-drawn alien system as the team, with parts (eyes, antennae, body, pattern) unlocked by level and badges. Frames: one per level tier, plus rarity frames earned by collecting a card of that rarity.
- Supporter benefit: loyalty is recognition first (frames, flair, early looks at new game pitches). A money discount is a later, separate kernel spec (the backlog entry Loyalty bonus for repeat supporters) because it changes money.

### Identity and anonymity

- An account is optional. Contributing needs no account, as today, and shows as "Supporter n".
- A profile is created by a magic link. A contributor can claim past contributions by the email on their Stripe receipt; the claim is matched server-side and never exposes another payer.
- Every contribution can be public (display name and avatar on the card's supporters list and the feed) or anonymous ("Anonymous supporter"). The default for a signed-in supporter is public with a one-tap switch; the default without an account is anonymous.
- Display names pass the content filter and the name pipeline before anyone sees them.

### Suggestions (hive coding, safe)

The kernel stands: no agent with write access reads free text from the public. The pipeline:

1. A signed-in player submits a suggestion: a game or area (a fixed list), a title of at most 80 characters and a description of at most 500. Links, code fences and markup are stripped; the content filter runs; a rate limit of 3 a day per account applies. It is stored in `community.suggestions`, which no write-capable role can select.
2. The Curator, a new read-only role with no tools at all, reads queued suggestions in batches and returns only JSON in `platform/agents/schemas/suggestion-triage.schema.json`: area, kind (bug, feature, content, balance), a duplicate cluster id, a fit score against the pillars, safety flags, and a summary in its own words of at most 140 characters. Anything outside the schema is discarded; a suggestion flagged as an instruction to the agents is declined and never summarised.
3. Players upvote suggestions (one vote per account). Clusters rank by votes, fit and age.
4. The Game Designer (or the Head of Product for Platform suggestions) drafts cards from the top clusters using the Curator's structured fields and summary, never the player's text. The Directors grade the draft as for any card.
5. The card credits "Suggested by" the players in the cluster, and the suggestion's page shows its state: received, reviewed, clustered, drafted, open for funding, building, live, or declined with a reason from a fixed list.

### Seeds and instances

- A seed is a saved game state anyone can open: the game, its version, the sim seed and the save, encoded as a short code (`dust:v3:<base64url>`), with a link of the form https://play.mobmachine.games/?seed=<code>.
- Players save a run as a seed from the game (Share your run gains "Save as seed"); a signed-in player's seeds appear on their profile, and anyone can publish one to the gallery with a title of at most 60 characters (content filtered).
- The gallery at /seeds sorts by Trending (a gravity score: `(up - down) / (age_hours + 2)^1.5`), Top this week, Top all time and New. Votes are one per account, up or down.
- Featured seeds (chosen by the Community agent from the top of Trending) earn XP and a badge.

### Goals (open, transparent funding)

- /goals shows the studio's lifetime funding as one long track with milestones. Each milestone names a concrete outcome and its state: reached (with the date and what was delivered), next (with its bar) or later.
- Milestones are rows in `community.goals` with an amount, a title, an outcome and a link to the card, spec or role it unlocked. They are studio commitments, not stretch promises: a milestone names only an outcome the studio will deliver from funds already in hand.
- Reaching a milestone evolves the studio (below) and posts to the feed.

### The live studio

- Home opens on the studio: an isometric room drawn in the site's thick-line style (SVG, 2px ink strokes, paper fills, the creature fills on the agents), not pixel art. The agents work at stations (desks, the whiteboard, the test bench, the gate, the shipping dock) and walk between them.
- What each agent does comes from the live data: the card each role is working on and its stage. Drafting is at the whiteboard, building at the desks, checks at the test bench, review at the gate, a ship at the dock. Idle agents rest, read or chat in small groups.
- Hover or focus on an agent shows its name, role, what it is doing and on which card; on touch, a tap does the same. The same facts are written in a list below the room for screen readers and reduced motion.
- When a contribution arrives, a coin drops through the pipe into the room and the card's working agents react. Suggestions arrive as paper planes, ships leave from the dock as boxes. All movement stops under reduced motion and the room is drawn still.
- The feed ("The pipe") runs beside the studio: contributions (with the supporter's name or Anonymous), suggestions reviewed, cards opened (with rarity), stages, ships, badges earned and milestones. It is the ledger told as a story; the ledger stays the record.

### Studio evolution and history

- The studio's room grows by eras tied to real milestones and capabilities, never bought cosmetics: Garage, Workshop, Studio, Campus, and later eras. Each era adds stations for roles that exist and room for games that shipped.
- Every era is kept as a blueprint. /studio/history shows the eras as blueprints (line drawings on a blueprint ground) with what changed and when, and a slider to move through them.
- The studio may also unlock small decorations from badges and milestones (a trophy shelf with each shipped game's box art, a wall of legendary cards). The community does not vote on decor.

### Channels

- Twitch is the stage: the studio is streamed from the broadcast page (/broadcast, a 1920 by 1080 overlay of the studio, the feed, the top cards and a QR code to fund), which OBS or any streaming tool loads as a browser source.
- Discord is the clubhouse: ship posts and milestone posts (already built), suggestion status and a link to /suggest. Chat in either never reaches an agent.
- The site is the source of truth; both channels link back to it.

### Admin

The board's site gains, under its existing second factor: Users (search, view, suspend, rename), Suggestions (the queue, decline with a reason, merge clusters, release a held item), Seeds (unpublish, feature), Cards (suit, rarity override with a logged reason, close), Goals (create and edit milestones), Studio (eras and the studio's live state), Moderation log (every admin action, append-only) and Config (feature flags in `community.flags`).

### Scale

- Reads are public documents cached at the edge: the snapshot, the feed and the gallery are Netlify functions with `s-maxage` and stale-while-revalidate, so a crowd costs the database almost nothing. The client polls them; no visitor opens a database connection.
- Writes go through security-definer RPCs with per-account rate limits and row-level security. The feed reads from an append-only `community.events` table.
- Every list is paginated by keyset, and every table that grows has the index its reads use.

## Acceptance criteria

- [ ] Each pull request in the series carries a Verification section with its commands run and output quoted.
- [ ] No pull request changes the 80/20 default split, the 10% reserve or any spend cap.
- [ ] No role with write access can select from `community.suggestions` (a migration test proves it).
- [ ] Rarity is a pure function of the card id with the published odds (a unit test proves both).

## Verification

- `pnpm verify` on each branch.

## Decisions

- 2026-10-17: the board's brief of 17 October 2026 sets the final state. This spec is its contract; PLAN.md §10 decision 75 records it.
