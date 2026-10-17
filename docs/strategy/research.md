# Research: what the references teach

Each reference the board named: the mechanic, why it works, whether it fits Mob Machine, and what the studio applies. `docs/research/comparables.md` already covers Kickstarter's all-or-nothing rule, Double Fine Adventure, Star Citizen's funding record, Twitch Plays Pokémon's run and Humble Bundle's slider, with sources; this file builds on it and does not repeat those figures. Sources were opened on 17 October 2026. The last section records two design decisions the research supports.

## Twitch Plays Pokémon: collective decisions as a spectator sport

**Mechanic.** Chat commands drove one copy of a game. When chaos stalled progress, the crowd could switch to Democracy mode (a vote over a short window chooses each input) and back to Anarchy (every input runs).

**Why it works.**
- Free, instant participation: typing one word made a viewer a player.
- Progress was visible every second, so watching felt like taking part.
- The rules themselves became the story. A study of the run found that the crowd finished in 16 days, against about 26 hours for one player, and that users who deviated from the norm, trolls included, helped the group advance; when the crowd split into "anarchists" and "democrats", members tended to stop voting rather than switch sides ([BMC On Society, 2019](https://blogs.biomedcentral.com/on-society/2019/06/25/what-twitch-plays-pokemon-tells-us-about-crowd-behavior/); [arXiv 1408.4925](https://arxiv.org/pdf/1408.4925)).
- The crowd invented lore (the Helix Fossil) from accidents.

**Fit.** Partial. Mob Machine cannot let chat drive a writing agent (the kernel), and building a game is slower than pressing a button. The spectacle of a crowd steering one visible thing fits exactly.

**What we apply.**
- Free participation that matters: suggestions and upvotes for anyone with a profile, with tracked states and credits.
- Visible progress every second: the live studio and the feed ("The pipe") show contributions, suggestions, cards opening, stages and ships as they happen.
- Rules as story: the published rarity rule, the suggestion pipeline and the goals track are explained on the site and become talking points.
- Lore from accidents: featured seeds and "Suggested by" credits give the crowd authorship. Free-text lore inside games stays behind the name pipeline (`docs/BACKLOG.md`, The name pipeline).
- Not applied: open-ended voting on what ships. Funding remains the choice, and upvotes rank suggestions, not cards.

## Game Dev Story: a studio you watch grow

**Mechanic.** Kairosoft's management game has the player run a small studio: hire and train staff, pick a genre and type for each game, watch the staff work in a cutaway office while development points (Fun, Creativity, Graphics, Sound) fill, then read review scores. Hits feed money into office upgrades, which add seats and unlock new training, hiring and advertising options. A game scoring 32 or more enters the Hall of Fame and can get a sequel; yearly events (a trade show, a game awards night with a Game of the Year bar at 36) punctuate the years ([Kairosoft wiki](https://kairosoft.wiki.gg/wiki/Game_Dev_Story)).

**Why it works.**
- **Visible growth.** The office is a picture of your progress. Upgrades are moments.
- **Characters at desks.** Staff walk, work and react; small animations make numbers feel like effort.
- **Legible scoring.** Four named qualities and a review score turn quality into something a player can read.
- **Combinations as discovery.** Genre and type pairs reward experiments and give players something to talk about.
- **Milestones with ceremony.** Hall of Fame entries, awards and sequels mark achievements.
- **Constraints create stories.** Payroll, deadlines and limited seats force choices.

**Fit.** Strong. Mob Machine is a real Game Dev Story: the staff are agents, the money is the crowd's and the reviews are the Directors'.

**What we apply.**
- The live isometric studio: agents at stations that match their real work (whiteboard for drafting, desks for building, test bench for checks, gate for review, shipping dock for ships), from live data (`docs/specs/final-state.md`, The live studio).
- Eras as office upgrades: Garage, Workshop, Studio, Campus, each tied to a milestone and adding stations for roles that exist (`docs/specs/final-state.md`, Studio evolution).
- A trophy shelf of shipped games' box art, the Hall of Fame equivalent.
- Legible quality: the Game Director's rubric (`game-quality.md`) scores each game on named qualities and publishes the result with the game.
- New game stages (Pitch, Prototype, First playable) are the "pick a genre and type" moment, with the crowd funding the pitch it wants.
- Not applied: invented constraints. Game Dev Story's deadlines and payroll are artificial; ours are real (money, dependencies, quality), and the studio adds no others.

## Star Citizen's open-ended funding: public goals and stretch goals

**Mechanic.** After its 2012 Kickstarter, Star Citizen kept funding open on its own site with a live total and stretch goals by dollar threshold, each marked when reached (`docs/research/comparables.md`). By $47 million the studio asked pledgers whether stretch goals should continue; 54% voted yes, and Chris Roberts said he was wary of promising features at each milestone unless they were "truly additive", moving rewards toward player perks ([PCGamesN](https://pcgamesn.com/star-citizen/star-citizen-stretch-goals-see-funding-top-47-million-community-votes-them-continue)).

**Why it works.** A visible total and a next goal give every backer a reason to bring the next one. Each goal is a story beat. Perks recognise early and large backers.

**What went wrong.** Goals that promised more game widened the scope of a game not yet made; the release slipped by years; selling items before they existed drew a regulator's ruling and pay-to-win criticism (`docs/research/comparables.md`).

**Fit.** The meter and milestone list fit. Promising future content does not.

**What we apply.**
- /goals: the studio's lifetime funding as one track with milestones, each naming a concrete outcome and its state: reached (with the date and what was delivered), next or later.
- Milestones are commitments the studio delivers from money in hand, such as a new era, a new role on the Studio suit or a new game's Pitch stage. They are never content promised for later.
- Recognition perks without money value: frames, badges, early looks at new game pitches.
- Not applied: selling items, ships or land; anything bought before it exists.

## Collectible card games: categories, rarity, collection, anticipation

**Mechanics.**
- **Categories.** Magic: The Gathering sorts cards into five colours, each with a philosophy and mechanical identity; players learn the categories and build identities around them.
- **Rarity.** Magic has common, uncommon, rare and mythic rare, marked by the expansion symbol's colour; since 2008 a booster's rare is replaced by a mythic about 1 time in 8 ([MTG Wiki](https://mtg.wiki/page/Rarity)). Hearthstone has common, rare, epic and legendary; player-collected data puts per-card odds near 71.6%, 22.9%, 4.4% and 1.1%, every pack holds at least one rare, and published pity timers guarantee an epic within 10 packs and a legendary within 40 ([Hearthstone wiki](https://hearthstone.wiki.gg/wiki/Card_pack_statistics)).
- **Collection and progression.** A collection grows, sets complete, and the rarest pieces are shown off.
- **Anticipation.** Opening a pack is a moment: the reveal, the sound, the special treatment of a rare card.

**Why it works.** Categories give structure and identity. Rarity creates highs among the ordinary and makes some moments worth sharing. A collection is a visible record of time spent. Anticipation is the strongest emotion in the genre.

**What goes wrong.** In most games the anticipation is bought: packs are paid randomness, and the pity timers exist because chance feels unfair. That is gambling-adjacent and unsuitable for an all-ages product that handles money.

**Fit.** Strong for categories, collection and the reveal; none for paid randomness.

**What we apply.**
- Suits as categories: Game, New game, Studio, Platform and Machine, each a word and a glyph on the card's index row, saying what the money pays for.
- Rarity with the reveal and none of the purchase: common 70%, uncommon 20%, rare 8%, legendary 2%, decided by `rarity = f(sha256(card_id))` when the card opens. Anyone can check it, nobody pays for it, contributing rolls nothing, and it never changes price, bar, build or order. A rare or legendary card announces itself in the feed and the studio.
- Rarity is drawn by edge pattern and a word, never colour alone, so it reads for colour-blind players.
- Collection by participation: funding a card adds it to the supporter's collection with its rarity and a rarity XP multiplier. Badges reward breadth (five suits, first legendary).
- Not applied: packs, pity timers, duplicates, trading, or any purchase whose outcome is unknown.

## Kickstarter: goals, urgency and the update

**Mechanic.** All-or-nothing goals, a deadline, reward tiers and creator updates (`docs/research/comparables.md`). Across video game campaigns, the average raised since 2009 is about $68,200, the overall success rate about 32%, and campaigns with goals under $1 million tend to overperform while none of 15 targeting $2.5 million or more succeeded ([GameDev Reports](https://gamedevreports.substack.com/p/kickstarter-in-2025-and-before)). An agency that runs campaigns cites about 10% of page visitors becoming backers as average ([LaunchBoom](https://www.launchboom.com/blog/resources/what-is-a-good-conversion-rate-kickstarter/)); that figure comes from campaigns with paid traffic aimed at people already interested, so it is a ceiling for us, not a target.

**Why it works.** A modest, visible goal near done is the strongest prompt; backers become promoters to get it over the line. Updates keep backers engaged after paying.

**Fit.** Strong, and already built in the card bar.

**What we apply.** Small cards (most below $5) so bars finish often; a bar near full is the most visible state; ship notices and the feed are the updates; New game stages each have their own bar and a stage that misses it does not start. Not applied: deadlines or countdowns near money.

## Twitch and YouTube: spectatorship, feeds and live events

**Mechanics.** Twitch is live, chat-led and event-driven; channels grow through raids, clips and appearances rather than the directory, which rarely surfaces small channels. YouTube, especially Shorts, is where clips are discovered by people who were not watching live. Both reward a regular schedule of moments and a visual identity that reads in a thumbnail.

**Why it works.** Live viewing creates shared moments ("I was there when the legendary card opened"); clips carry those moments to people who were not.

**Fit.** Strong for the stage and discovery; weak as a place to hold a community's records, which belong on the site.

**What we apply.** /broadcast as a 1920 by 1080 overlay any streaming tool loads; event beats (rare card, ship, milestone, era change) designed to be clipped; Shorts cut from those beats; a feed on the site that reads like a stream's event list. See `growth.md` for the channel plan. Chat in either never reaches an agent.

## A benchmark for web presentation

**Reference.** Apple.com, named here only as a benchmark for web presentation.

**Mechanics.** Product pages lead with one large idea per screen; motion is tied to scrolling and reveals one thing at a time; typography is large and confident; every animation explains the product rather than decorating it; pages stay fast and respect reduced motion.

**Why it works.** The reader is never asked to parse two things at once. Motion directs attention to what matters, and restraint makes the motion that remains feel expensive.

**Fit.** The discipline fits; the polish level is the bar. The look stays the studio's own: thick ink lines on paper (`platform/site/DESIGN.md`).

**What we apply.** The motion pass on the site: one idea per screen on home and /how-it-works, scroll-linked reveals of the studio and the card flow, motion only to show a real change or a press, all motion stopped under reduced motion. Measured by the design benchmarks in `benchmarks.md` (Visual design and performance).

## Hive coding: community suggests, agents prepare, people decide

**Mechanic.** In hive coding a community suggests features, AI agents prepare the changes, and developers decide what ships. The process: collect feedback with its source, group duplicates and surface popular ideas, turn each into a small story with acceptance criteria, let agents prepare changes on separate branches in a bounded queue, then test and review before release ([Wavect glossary](https://wavect.io/glossary/hivecoding)). Its safeguards: public feedback is input, with no power over agent permissions or release rules; popularity is one input among several; define which files and tools agents can use and cap cost and run time before unattended work; stop on failure; hold unattended code to the same standard; measure outcomes, not activity; start small.

**Fit.** Exact. Mob Machine already ran the second half (agents prepare, the gate and Directors decide); the final state adds the first half safely.

**What we apply.** The suggestion pipeline in `docs/specs/final-state.md`, mapped to each safeguard:

| Safeguard | How Mob Machine meets it |
|---|---|
| Feedback is input, not authority | Suggestions are stored where no write-capable role can select them; the Scout, a role with no tools, returns only typed fields; drafts use the Scout's fields, never the player's text |
| Popularity is one input | Clusters rank by votes, fit against the pillars and age; the Game Director grades every draft |
| Bounded files and tools | Each card names its allowed paths and lane; kernel paths are refused by the gate; each role spec lists its tools |
| Cost and time limits | Card ceilings (150% of estimate, capped), per-card, daily and monthly caps, session budgets |
| Stop on failure | A failed gate stops the card; a breaker on failed drafts is planned (`docs/BACKLOG.md`, A card supply that keeps pace with funding) |
| Same standard for unattended work | The same gate, visual review and smoke test for every card; rollback on a failed deploy |
| Unattended coding is not unattended deployment | No change ships on an agent's own judgement: it ships only through the gate, the Directors' review and the smoke test, and kernel paths change only through a kernel pull request |
| Measure outcomes | Benchmarks count shipped and visible changes, first-pass gate rate and cost per shipped card, not sessions run |

## Decisions the research supports

### Twitch is the stage, Discord the clubhouse, the site the source of truth

| Need | Twitch | Discord | The site |
|---|---|---|---|
| Live spectacle for strangers | Built for it: live video, raids, clips | Weak: voice and stage channels reach members only | The live studio, but only for people already there |
| Discovery | Clips and raids; the directory is weak for small channels | Almost none outside invites | Search, shares and link previews |
| Lasting community with history | Weak: chat scrolls away | Strong: channels, threads, roles | Strong for records, weak for chat |
| Safety under the kernel | Chat is free text: AutoMod, delay and kill switch, never read by a writer | Free text: never read by a writer | Typed, filtered input only |
| Ownership of records | Twitch's | Discord's | Ours |

So: the studio is streamed on Twitch from /broadcast, which is simply the site's own studio view; Discord holds the community, with ship, milestone and suggestion status posts linking back; every record (contributions, suggestions, seeds, collections) lives on the site, so neither platform's policy change can take it away. The alternative of Discord as the main channel was rejected because Discord does not bring strangers; Twitch alone was rejected because its chat is not a place to keep a community's history or structured input.

### Studio eras tied to milestones, with earned decor, and no community vote on decor

- **Eras tied to milestones** keep the picture honest: the room grows when the studio really gained a role, a game or a funding milestone, as in Game Dev Story, where office upgrades follow success. A room that grew because people voted for it would show growth that did not happen.
- **Earned decor** (a trophy shelf of shipped games' box art, a wall of legendary cards) gives the crowd visible marks of what it achieved without asking anyone to vote or pay.
- **No votes on decor.** A decor vote is low-stakes free participation, but it splits attention from the suggestion pipeline, invites brigading, and needs free voting infrastructure the final state replaced with upvotes on suggestions. Suggestions already let the crowd ask for decor as a Platform suggestion.
