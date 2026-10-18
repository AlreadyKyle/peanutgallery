# Users

Who Mob Machine is for, why they come, what they are trying to get done, and what the studio solves for them. Each audience names the product features that serve it (`prd.md`) and the benchmark that tells us whether it is served (`benchmarks.md`). Audience sizes are not measured; where a number appears it is an assumption with its source.

## The funnel the audiences move through

```
Visitor ──► Player ──► Participant ──► Supporter ──► Regular supporter
(watches)   (plays)    (suggests,      (funds a      (funds again,
                        upvotes,        card)         collects, levels)
                        shares a seed)
```

A person can enter at any step and skip steps: a viewer on Twitch can fund from the stream's QR code without playing. Each step is a separate benchmark in `benchmarks.md` (Conversion).

## Audiences

### 1. The AI-curious spectator

- **Who.** People who follow AI news and want to see what agents can really do. They arrive from Hacker News, Reddit (r/ClaudeAI, r/artificial), X and press stories about AI.
- **Motivation.** Curiosity and judgement: "Is this real? How well does it work? Where does it break?"
- **Jobs to be done.** See an AI team do real work end to end. Check the claims (the ledger, the agents' steps, the failures). Have something to say about it to others.
- **Problems today.** Most AI demos are cherry-picked videos. Agents' work is invisible, and cost is never shown.
- **What we give them.** The live studio, where each agent's station and card come from live data; each card's steps, checks, reviews and failures; the ledger with real model costs per card; the history of eras.
- **Measure.** Visitor to Player and time on the studio (`benchmarks.md`, Engagement and Conversion).

### 2. The browser and idle game player

- **Who.** People who play short games on a phone or a work browser: idle and incremental fans (r/incremental_games), casual mobile players, itch.io browsers.
- **Motivation.** A satisfying loop in a short session, numbers going up, something new on return.
- **Jobs to be done.** Fill two to ten minutes with something pleasant. Come back to progress. Show off a good run.
- **Problems today.** Browser games often look cheap, ask for installs or accounts, or are cluttered with ads and pay-to-win offers.
- **What we give them.** Free Three.js games that load fast and play well on a phone (`game-quality.md`), no account, no ads, no paid advantages, saved runs as seeds they can share, and changes they can see ship.
- **Measure.** D1 and D7 return, session length, seeds saved (`benchmarks.md`, Engagement).

### 3. The supporter

- **Who.** People who back creative projects: Kickstarter and Patreon backers, Humble Bundle buyers, viewers who tip streamers.
- **Motivation.** Make something happen and see that it did. Belong to a project early. Be credited.
- **Jobs to be done.** Pick a change worth paying for. Know where the money goes. Get told when it ships. Be recognised.
- **Problems today.** Crowdfunding asks for trust in a distant outcome; most backed projects ship late or change. Patronage gives no say over what is made.
- **What we give them.** Small cards with visible bars, the split slider, a public ledger, ship notices, the card's supporters list with their name or Anonymous, the card in their collection with its rarity, XP, levels, frames and badges. The Machine card for people who want to back the studio as a whole.
- **Measure.** Participant to Supporter conversion, repeat supporter rate, median contribution (`benchmarks.md`, Business and Conversion).

### 4. The collector

- **Who.** Players of collectible card games (digital and physical), achievement hunters, people who like completing sets.
- **Motivation.** The anticipation of what a new card will be, the pleasure of a growing collection, visible status.
- **Jobs to be done.** Collect rare things. Complete sets (five suits, each rarity). Show a collection.
- **Problems today.** Collecting in games is usually tied to paid randomness, which is costly and, for many, uncomfortable.
- **What we give them.** Every card has a suit and a rarity drawn on its face; a rare or legendary card announces itself when it opens; funding it adds it to the collection with its rarity; badges for set completion; rarity frames. Nobody pays for a roll: the rarity is known, checkable and the same for everyone.
- **Measure.** Share of supporters with cards of three or more suits; return visits after a rare card opens (`benchmarks.md`, Engagement).

### 5. The would-be game maker

- **Who.** Hobby developers, students, people who imagine games and do not build them; fans of studio-management games.
- **Motivation.** Influence a real game; see how games are made; get an idea built.
- **Jobs to be done.** Suggest a feature and see what happens to it. Learn how a change goes from idea to live.
- **Problems today.** Feature requests to studios vanish. Making a game alone is out of reach for most.
- **What we give them.** /suggest with a visible state for each suggestion (received, reviewed, clustered, drafted, open for funding, building, live or declined with a reason), "Suggested by" credits on the card, XP for accepted and shipped suggestions, and the New game suit's staged pitches.
- **Measure.** Suggestions per week, share accepted, share shipped, time from suggestion to live (`benchmarks.md`, Engagement).

### 6. The streamer and creator

- **Who.** Twitch streamers and YouTube creators looking for content, especially in Software and Game Development, Just Chatting and co-working categories.
- **Motivation.** A reliable source of moments their audience reacts to.
- **Jobs to be done.** Put something live and changing on screen. Let chat take part. Make clips.
- **Problems today.** Showing AI or game development live is slow and dull to watch.
- **What we give them.** /broadcast, a 1920 by 1080 overlay of the studio, the feed, the top cards and a QR code to fund, loadable in OBS as a browser source; seeds they can open and play on stream; rare card moments and ships as clip-worthy beats.
- **Measure.** Broadcast overlay loads by distinct referrers, contributions arriving through the QR code's link (`benchmarks.md`, Virality).

### 7. The community regular

- **Who.** People who join the Discord, read the feed and like being part of a group with in-jokes and history.
- **Motivation.** Belonging and status within a group.
- **Jobs to be done.** Talk about the studio with others. Watch the studio grow. Be recognised as early or loyal.
- **What we give them.** Discord as the clubhouse (ship posts, milestone posts, suggestion status), levels and tier names, the studio's eras and its history page, featured seeds.
- **Measure.** Discord members who also hold a profile; returning profiles per week (`benchmarks.md`, Engagement).

## Who the studio is not for, and how it protects them

- **Children paying without permission.** A person must be an adult where they live or have a guardian's permission to contribute; a guardian's refund request is honoured in full with no time limit (`docs/PLAN.md` §5 Terms). Nothing near money uses a countdown, chance cue or ranking of supporters by amount.
- **People who want to direct agents with free text.** The kernel forbids it. Suggestions are structured and read by the Curator, a role with no tools; this is explained on /suggest.
- **Speculators.** XP, cards and collections cannot be sold or transferred, so there is nothing to trade.
- **People hostile to AI in games.** The studio does not hide what it is. The art policy (procedural or vector art only inside games) and the public ledger answer the common objections; the rest is a difference of view.

## Problems solved, by audience

| Audience | The problem | What solves it |
|---|---|---|
| Spectator | AI demos are opaque and staged | Live studio from live data, public steps and failures, ledger costs |
| Player | Browser games look cheap and pester | Three.js games at a written quality bar, no ads, no paid advantage |
| Supporter | Crowdfunding sells distant promises | Small cards built when funded, ship notices, the ledger |
| Collector | Collecting means paying for chance | Deterministic, published rarity; collection by participation |
| Game maker | Suggestions vanish | Tracked suggestion states and "Suggested by" credits |
| Streamer | Development is dull on stream | Broadcast overlay, seeds, rare card and ship moments |
| Regular | Communities form around nothing visible | Eras, history, levels, featured seeds, Discord clubhouse |
