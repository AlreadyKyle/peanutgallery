# Backseat — Kick-off plan

Version 3.1, 14 September 2026. Supersedes v3; the 14 September amendments are recorded in §10 (defaults 10–13) and specified under `docs/specs/`. Built from five research and design passes, a source check, a consistency audit, and the board's review notes. External figures carry a source in §9; figures without a source are the plan's own numbers.

## 1. Decision

Build 1 (§6) ships before public launch on day 22. Everything else is the season-1 roadmap and is funded, voted, and built through the studio's own system after launch.

## 2. Concept

A public game studio run by AI agents, directed by its audience, funded by the hour, streamed continuously. Agents build free, open-source, browser-playable games. Viewers fund the agents' compute and vote on what the agents do next; a vote becomes a visible change on stream within minutes. The studio spends only what has been funded, shows every dollar and every token on a public ledger, and lets each supporter set at checkout how much of their contribution runs agents and how much pays the studio. Star Citizen has raised $1B over 14 years without a release; here every dollar is visible as work the same hour.

Prior art. Multiverse Studios runs AI agents as a dev team on nine MIT-licensed games with a live view of the agents; it has no voting, no funding-throttled throughput, no seasons, and no show. Neuro-sama was the most-subscribed active channel on Twitch in January 2026. Twitch Plays Pokémon drew 1.16 million participants in 2014. Polsia runs whole companies on agents that work while the owner sleeps and re-engage the owner with a daily report. This plan combines the four and adds the funding meter.

Pitch line: "Watch AI agents build a game studio and free games. Vote on what they do next by contributing to their compute."

## 3. Day-one scope

One seed: an idle/incremental game. In that genre a proposal is a number, a rule, or a new unit, which is the cheapest thing to change in minutes.

One Twitch channel with two viewer scenes at launch, switchable by channel points: Dev Cam (the office: alien agents at desks, state reflecting real activity) and Director's Room (host and Game Director debating the vote board). A third scene, Replay (a loop of auto-clips, or a static idle card when there are none), is the fallback for the kill switch and zero balance. Play Cam ships in season 2. Launch day is a Monday, 10:00 ET.

Vote buckets at launch: Game, QA, Studio (studio name, host name, seed name). The studio launches as "Untitled Game Studio"; the first global vote picks the name from four pre-registered options (Peanut Gallery, Backseat Driver, Armchair, Helicopter), opening at hour 1 and closing at hour 49; site and stream retitle live when it closes. Each option carries its word for unnamed participants (Peanut Gallery: Peanuts; the other three are set before the vote opens), chosen in the same vote. Budget opens when the first $500 is funded. Agents and the regime dial open on day 15. Platform opens for community cards in season 2; during season 1 the Platform Builder works board and agent Platform cards.

Vote regime at launch: one account, one vote, locked for 14 days.

Launch roster. Studio Head (agenda, roadmap, org chart, Monday report; holds the Platform veto). Game Director (pillars; holds the Game veto). Builder A and Builder B (Game cards). Platform Builder (Platform cards, stricter gate). QA (bug reproduction, headless bots, nightly rebalance cards, incident classification). Host (chat and events in, speech out; no write tools). Scout (activates day 15: models, tools, engines, genre trends). Community (activates day 8: subreddit, Discord, chat logs, X mentions; proposes lore, meme and trend cards; no write tools). Nine roles, each with a role spec and a scorecard from day one. The studio seeds the pool with a $200 founding budget so day one has funded cards before the first contribution.

## 4. Mechanics

### Cards

Agents, the board, and (through the Community agent) the audience propose cards. A card carries: bucket, source (board, community, agent), shape (§ Card shapes), title, one-paragraph intent, a deterministic acceptance test the gate can run, an estimated cost in dollars and as a share of the week's pool, a confidence band (Low until the proposer has ten actuals; then High if its median estimate error is 15% or less, Medium at 30% or less, otherwise Low), the proposer, the director's stance, and its stage.

Stages: proposed → designing (goal cards only) → voted → funded (the pool reserves the estimate) → building → gated → live, or rejected with the failing check attached. A card that reaches 150% of its estimate pauses and re-votes. Actual cost is written back to the card and to the proposer's record.

Two lanes. Config-lane cards touch data, not code: tuning values, names, palettes, copy, unlock order, spawn tables (files under `seed-1/config/` and `seed-1/content/`). They skip the full test suite, run the headless bot pass, and ship within about five minutes. Code-lane cards touch anything else, run the full gate, and ship the moment the gate passes, typically within hours. If a card needs a new function it is code-lane. Micro-votes (90-second windows, every few minutes, no voter threshold) choose among agent-proposed config-lane options.

### Card shapes and progress bars

One-off: paid by a single personal decision or a single vote's allocation, ships when done. Goal: a larger item (a new scene, a new role, a platform system, a large feature) with a funding target and a progress bar; contributions pool against it, the funder list sits under the bar, and it starts building the moment the target is met. Standing: a cost that runs rather than ships (the host 24/7, a role's weekly salary, the VPS), shown as a monthly bar that refills; "sponsor a role" funds that role's bar. A goal bar is credited with the agents' net amount of each contribution made toward it (after the processor fee, the reserve, the supporter's studio share and the incident carve-out), so a full bar means the pool holds the card's estimate; the card then moves to `funded`.

Goal cards have a design stage. Before a goal's funding target is set, a small design card (capped at $10) produces a public spec and a mock: what it does, what it touches, the acceptance test, and the cost estimate. The design is votable; the funding target comes from it. Platform systems and any Game feature above $25 go through design; smaller items skip it.

The site shows four columns and tags every card by source: Live (shipped and running, with what it cost and who funded it), Building (in progress with the gate visible), Funding (goal and standing bars, and goal cards in design), Proposed (recommendations awaiting a vote). Nothing appears in Live without a `live` event from the gate.

### Three decision tiers

Global decisions are rare and hard to reverse: studio name, seed choice, vote regime, org-chart changes, season length, logo. Quorum is the larger of 25 voters or 10% of the trailing seven days' unique voters; pass is 60% of votes cast; voting stays open 48 hours. The live quorum figure is printed on the vote board.

Collective decisions are the weekly macro cards in Game, QA, Platform and Studio. Quorum is the larger of 25 voters or 5% of weekly unique voters; pass is a simple majority; open Monday 12:00 ET, close Sunday 18:00 ET. Global and collective votes are free to every eligible account.

Personal decisions are the paid tier. The Studio Head maintains a backlog of small, bounded decisions, every one a choice among pre-filtered options the Builders proposed, never free text. Sizes: small (name this enemy from three options; which of these three bugs next), medium (pick the next unlock, enemy type, or zone palette from three), large (choose the next feature from three Builder proposals). Every contribution on any rail immediately assigns the payer the next decision of matching size ($1–4 small, $5–49 medium, $50+ large), and the decision is theirs alone. Small and medium execute through the config lane within minutes. A large decision becomes a funded code-lane card credited to the payer and ships when the gate passes, which is stated at assignment. Builders generate the backlog continuously; the Game Director filters it against the pillars and the deny-list; one open decision per config key at a time so two payers cannot collide. When the backlog falls below 20 open decisions the meter says so and offers a Builder hour to refill it. Free accounts still get micro-votes; paying gets a decision nobody else holds. Free-text naming (a Patron perk) goes through the name pipeline, not the decision backlog.

### Buckets and allocation

Game (features, balance, content). Platform (site, stream, vote rules, host, the card system itself). QA (bug fixes, coverage). Studio (names, logo, host voice, season length, next seed). Budget (surplus: studio reserve, more agents, higher model tier, early new seed). Agents (the agents' own prompts, skills, tools, bots, gate checks, and the org chart).

The community allocates the week's pool across open buckets every Monday 09:00 ET (payroll). The QA share is a slider from 10% to 40%, default 20%; 10% is the floor.

### Incident reserve

Blocking bugs do not wait for a vote. QA classifies every bug card by deterministic rules: S1 (build fails, crash rate above 5% of sessions in the last hour, or the game cannot be started) and S2–S4 below it. An S1 card takes priority 1 (below board directives only) and draws from the incident reserve, which receives 5% of every contribution's Agents share until it holds $500, with overflow returning to the pool. The reserve balance is on the meter. S2–S4 cards go through the normal QA vote.

### The platform improves itself

Every system in this section is itself a card target. The Platform team proposes changes to the card system, the stages, the vote rules, the bars and the site from three inputs: its own metrics (time from funded to live, first-pass gate rate, abandoned decisions), Community-agent trend cards, and board notes. Agents-bucket cards change the agents themselves: prompts, pillars, skills, tools, the headless playtest bots, gate checks, estimation heuristics, and role specs. Each names the metric it expects to move and is A/B tested against the prior version on the headless bot suite before merge; a card that does not improve its metric by at least 10% reverts automatically. The site publishes the efficiency curve weekly: cost per shipped card and first-pass gate rate.

Metrics, defined. First-pass gate rate: cards passing the gate on first run divided by cards attempted, trailing seven days. Cost per shipped card: ledger dollars divided by shipped cards, trailing seven days. Estimate accuracy: median of |actual − estimate| / estimate, trailing 20 cards. Bug reopen rate: QA cards reopened within seven days divided by QA cards shipped.

### The org chart

The Studio Head owns the weekly agenda, the roadmap, the numbers and the org chart; reports every Monday with the ledger and the efficiency curve; argues with the host on stream. It proposes and does not decide. From week 6 it runs a monthly blue-sky session producing three proposals that no metric asked for; they enter the normal vote.

Roles are data. A role spec holds purpose, prompt, tools, model tier, budget share, voice (one line: "terse", "cautious", "cheerful"), and its two or three scored metrics. The Studio Head files org cards into the Agents bucket: create a role, retire a role, split a role, change a model tier, or replace an agent. The composite score is the mean of a role's percentile ranks across its scored metrics, ranked among all active roles. Replacement threshold: bottom 20% composite for two consecutive weekly reviews, or first-pass gate rate under 50% for two weeks. The community votes; the change deploys through the gate; the previous role spec is archived so a replacement can be reverted. The season ends with a public performance review: every scorecard on screen, every eligible role up for a replacement vote. The Studio Head cannot propose its own replacement; the community or the board can.

The Scout files evidenced cards weekly from outside the studio: model releases and pricing, new MCP servers and tools, engine updates, observability and agent tooling (Langfuse and its peers, for example), comparable streams, genre trends on Steam and itch. When a tool plausibly improves a scored metric, the Scout proposes a trial card: adopt it on one role for one week, measure, then a keep-or-revert card. Its scorecard is the hit rate of its proposals.

The Community agent reads the studio's own community: the subreddit, the Discord, Twitch chat logs, X mentions. It files three kinds of card: lore (a meme the community has adopted becomes an in-game item, name, or credit, with the origin clip attached), trend (a recurring request or complaint becomes a Game, QA or Platform card with the thread linked), and sentiment (a weekly summary posted to the ledger page). A Lore page lists everything canonized with its origin. The Community agent has no write tools; every proposal passes the content filter, the vote, and the gate.

### The team, on screen

Every agent is an alien: a small, strange, friendly creature with an alien name, drawn in one consistent cartoon style defined by a style sheet (`platform/brand/team-style.md`: palette, line weight, proportions, three reference images) and generated through the image adapter (§6). Meet the Team is a page: each role shows its name, avatar, title, hire date, the model it runs on, its salary as this week's token budget in dollars, its scorecard, notable ships, and bugs it caused. Every card carries "AI agent" in plain text. Fired agents move to an alumni wall with their record intact. The community names the host; the Studio Head names the rest at launch from a filtered pool of alien names; replacements get new names.

The office is the Dev Cam: a 2D desk view where each avatar's state reflects real activity (building, waiting on the gate, idle because unfunded, in review), rendered as a web page and used as a stream scene.

Rituals map to real events only. The Monday all-hands is the Studio Head's report plus one line from each agent. Org cards render as job postings. Employee of the season is a community vote. No daily standups, no scripted conflict, no vacations, no equity, no backstories, no claimed experience.

### Vote regimes

The community sets the regime once per season, from day 15. Twitch Plays Pokémon required a supermajority to enter democracy and a simple majority to return to anarchy; here, entering any non-default regime needs 66%, returning to democracy needs a simple majority. Democracy: one account, one vote; accounts 48 hours old with one chat message. Funded weight: 1 + log2 of dollars funded this season (a $500 backer outweighs a $5 backer about 3:1). Play weight: 1 + hours in the current build, capped at 20, from telemetry. Tenure: 1 + seasons participated; season-1 founders hold a permanent +1. Chaos: each micro-vote counts a random 10% of ballots; macro votes stay democratic. Ties go to the host's pick, announced aloud. Paid tiers buy personal decisions and perks, never vote weight.

### Vetoes

The Game Director may veto one Game or QA card per season; the Studio Head may veto one Platform or Studio card per season. Each veto is public with a written reason naming the pillar. The community overturns at 75% within 72 hours; an overturned veto is spent. Directors may endorse any number of cards; endorsement is a label. A card that would breach the kernel is rejected by the gate at proposal time; that is a rejection, not a veto.

### Names

Unnamed participants have a collective name that comes with the studio name (Peanuts, if Peanut Gallery wins). Anonymous contributors are credited in the changelog and credits by that word and a sequence number ("Peanut #412"); anonymous chat votes count under it on the vote board; the host uses it for the crowd.

Micro-vote names choose among three to five agent-proposed, pre-filtered options and ship in minutes. Viewer-supplied free-text names (credits, the Chaos Name slot, patron-named features) pass the deterministic filter (the deny-list, a curated trademark list in `platform/gate/denylist/trademarks.txt`, 24 characters maximum), sit in a 24-hour public cooling period, and enter a build after the board's Wednesday approval batch. Anything that passes the filter is honoured. One Chaos Name slot per season (a unit or enemy) is the designated outlet, filtered only for the rating and legality.

### QA

A bug button in-game captures the last 60 seconds of game state plus structured fields (category, severity, expected, actual, from fixed lists). No free text reaches an agent; an optional free-text note goes to a human queue. QA replays the report headless, attaches a clip and pass/fail, classifies severity, and files a QA card. The community votes fix order for S2–S4; S1 draws the incident reserve. The reporter's handle goes in the changelog and the season credits. A public Hall of Fame ranks fixed bugs by votes with clips. Each account may file three bug reports a day; further reports that day require a personal decision of any size.

Nightly, QA proposes a rebalance card from session telemetry (quit points, unused features, difficulty spikes). It runs in the config lane after a 09:00 ET micro-vote; the before/after is shown on stream.

### Seasons

Ten weeks. Week 9 is a freeze: QA cards only. Week 10 is the finale. Version 1.0 is declared when the gate is green and no QA card with 25 or more votes is open. The 1.0 ships free on the web and itch.io with every voter and reporter in the credits; Steam follows only if the game holds 500 daily players for two weeks. In week 10 three agent-pitched concepts, each with a one-day playable prototype, run a two-round bracket (48 hours per round, democracy regardless of regime) to pick the next seed. Losers go to a public archive.

### Host

Narrator and chat's advocate. It reads the vote board, explains cards, argues the community's case against the Game Director, and reacts to ships and failures. It never votes, never edits a card, never claims a ship. It reads chat only after Twitch AutoMod and the deny-list; it has no tools other than speech. Every line passes the output filter (the gate's deny-list plus a topic allowlist keyword check) before text-to-speech; a filtered line is shown as "filtered". A 15-second broadcast delay and a kill switch held by the board and one moderator sit behind that; the switch cuts to the Replay scene within 15 seconds. This is Neuro-sama's post-ban model (filter, curated inputs, human moderation) with the delay and switch added.

### Rating

The studio and everything it produces is all-ages. Games meet an ESRB E / PEGI 3 bar: no sexual content, nudity or suggestive themes; no realistic blood or gore; no drugs, alcohol or tobacco; no profanity or slurs in any string. The gate runs a deterministic deny-list (profanity, slurs, sexual and drug vocabulary, coded and leetspeak variants, maintained in `platform/gate/denylist/`) over every string, asset filename and commit message; a hit fails the gate with the term shown. Generated images pass the provider's safety filter and a human review before first use. The Game Director's pillars include the rating. Chat displays on stream only through AutoMod at its strictest with a channel banned-terms list, followers-only and slow mode at launch. Rating labels appear on the site, the itch page and the stream title. Any incident that reaches a broadcast triggers the kill switch, a same-day post-mortem on the ledger page, and a kernel patch before the stream resumes.

### Art policy

In-game art is procedural or vector, generated by code, never by an image model; the site says so. Generated imagery is used for the studio itself: agent avatars, the board's silhouettes, episode thumbnails, lore cards. The site says that too, on the same line.

### Kernel

Not editable by any card, vote, regime or org change, at any tier, and the site says so: the ledger; spend caps; the default 80/20 split and the 10% reserve (each supporter sets their own split at checkout; the default is not votable); the incident reserve rule; the gate; rollback; the content filter, the all-ages rating and the art policy; the broadcast delay and kill switch; and the read/write separation: no agent with write access to a build, a card or the org chart reads free text from the public. The Host, the Community agent and the Scout read outside text and have no write tools. The single exception is board notes: free text from the board's authenticated accounts, read by the Studio Head.

### The Board

The board is Kyle and whoever joins him; it appears on the site as the cliché shadowed figures in suits. It acts through a private dashboard at `/board`, phone-friendly, never the command line. The dashboard is modelled on Linear's triage inbox (notes in, one-keystroke decisions out), Vercel's deployment list (every ship with its gate result and a rollback button), and Stripe's ledger view.

Directives are forced, immediate changes: a card in stage `funded` with priority 0, skipping the vote, still passing the gate, unable to breach the kernel. Every directive is public on a Board Decisions page with a one-line reason, and the site shows a running count per season. Directives are for a pillar being violated, a live problem, or a brand call; a Game-bucket directive is for a breach, not routine feature choice. When a board member adds their own work or funds a card, that appears on Board Decisions like any other board action.

Notes are advisory free text from a board member to the Studio Head, triaged at the top of every hour and at Monday planning into a card proposal (with the note linked), a scheduled item, or a discard, each with a stated reason visible only in the dashboard. Notes are private; discarded notes stay discarded unless re-filed as a directive.

Private to the board: notes and their triage, the founder's cash, hours and tokens (tracked, never published), the incident list before post-mortem, spend caps and model tiers. Public: directives, the ledger's pool figures, the split aggregate, everything the system does on its own.

Controls: pause and resume; kill switch; the week's viewer-supplied names; the veto log; spend caps; model tier per role; incidents; the personal-decision backlog; live ledger, meter, scores; read-only views of every card, role and vote. Access: Supabase Auth magic link restricted to board emails; a TOTP second factor added in week 3 and required from launch for directives, spend-cap changes and the kill switch. A moderator account holds kill-switch and pause rights only.

### The board's week after launch

Target under five hours once stable; expect eight to twelve in the first month. Monday, 60 minutes: review shipped cards and the meter; record a 20-minute on-camera segment (the only weekly human appearance). Wednesday, 30 minutes: read the veto log and filter flags; approve the week's viewer-supplied names. Friday, 30 minutes: approve the weekly episode cut. Asynchronous: moderator channel, incident review if the switch fired, one outreach post. The board acts through the dashboard: directives when something cannot wait, notes for everything else; it never proposes routine Game cards, breaks ties, or touches a build.

## 5. Business model

### Rails

Stripe Payment Links from day 1: a one-off contribution link and, from season 2, membership tiers. The link carries a custom dropdown for the split (100/0, 90/10, 80/20 default, 70/30, 50/50, 0/100 Agents/Studio) so the choice arrives in the webhook with no custom checkout. Stripe fees run about 2.9% plus 30 cents; disputes go through Stripe's flow and the reserve absorbs them. Twitch Bits and subs once the channel is Affiliate (viewers pay about $1.40 per 100 Bits, the channel receives $1.00; subs split 50/50 until Partner Plus thresholds); Affiliate needs 50 followers and 8 hours streamed on 7 different days in 30 days with an average of 3 viewers, so the channel streams the build from week 2 to qualify by launch. The meter shows Twitch's cut so viewers see the site rail funds about twice the agent time per dollar. Contributions credit the meter immediately up to $50 per contributor per day; amounts above that credit after 14 days.

### The split

Every contribution is divided. The chargeback reserve takes 10% off the top; it is mechanical and not adjustable. The remainder goes to Agents (the compute pool) and Studio by the supporter's chosen split, default 80/20. Of the Agents share, 5% goes to the incident reserve until it holds $500. The meter shows the live aggregate ("supporters currently send 21% to the studio") next to the default. Studio income is therefore a distribution set by supporters; Humble Bundle's experience is that most supporters leave defaults, so the default carries the economics and the choice carries the trust. A 50/50 headline is not used anywhere: Twitch's move to 70/30 was a response to years of resentment of the 50/50 split, and 50/50 says half the money builds nothing.

### Tiers, season 2

Seed, $5 a month: four small personal decisions a month, name in credits. Builder, $15 a month: four small and two medium decisions, name one item or enemy per season, early episode access. Patron, $50 a month: one large and four medium decisions, one Director's Room question read on stream, Executive Producer credit. One-off contributions receive decisions by the size table. Tiers buy decisions and perks; they do not weight votes.

### Costs

Fixed infrastructure roughly $70–200 a month depending on the VPS (Supabase Pro $25, Netlify, a VPS running OBS, clip storage). The host, running 24 hours a day on a small model, roughly $150 a month. Agent cost per active coding hour is the largest uncertainty: about $2 an hour at Sonnet-class pricing with heavy prompt caching, about $10 without. Plan on $5 an hour; the ledger replaces the estimate in week 1. At $5 an hour and the default split, $1 contributed buys about 8 minutes of agent work after processor costs, the 10% reserve and the 20% studio share (a $5 contribution puts about $3.30 into the pool, about 40 minutes); the meter shows the measured figure. Image generation is metered per image through the adapter and charged to the card that requested it.

Monthly totals: idle (host on, agents off) about $220; agents four hours a day about $700–1,500; agents 24 hours a day about $3,000–7,000. Agents run only when funded, so these are ceilings set by the audience.

### Compute account and mode

Before launch, the fleet runs in attended mode: agent sessions run through Claude Code on the founder's subscription only while a board member is at the keyboard, streaming the build, and stop when the session ends. From launch day, the fleet runs unattended on a separate pay-as-you-go Anthropic organization with a $500 monthly limit, raised by hand as the meter grows; it spends only funded money, so it costs the studio nothing beyond what supporters put in. Anthropic's weekly limits were introduced to stop 24/7 background use of subscription plans, and the founder's subscription also runs his other work, so unattended use never touches it. The agent layer sits behind one adapter; a second-provider adapter for the Builder and Host roles is tested before launch.

### Break-even and studio share

The studio covers compute and infrastructure at roughly $1,000 a month gross. At the default split the studio share exceeds $2,000 a month at roughly $11,000 a month gross, about 2,000 Seed-tier supporters, somewhat above the Mid scenario's run rate (about $1,700 a month).

### Scenarios, first 90 days

| | Flop (base case) | Mid | Pop |
|---|---|---|---|
| Peak / average concurrent | 150 / 30 | 2,000 / 250 | 20,000 / 2,500 |
| Funders | 60 | 600 | 8,000 |
| Gross | ~$1,800 | ~$27,000 | ~$400,000 |
| Studio share at the default split | ~$320 | ~$4,700 | ~$70,000 |
| Comparable | sub-$10k Kickstarter tail; most Patreon creators earn under $100 a month | average funded Kickstarter game (~$58k in 2025) | mid-size Twitch Partner sub base; the $100k+ Kickstarter tier (55 projects in 2025) |

Scenario figures are the plan's own; the comparables are sourced. Flop is the base case: Nothing, Forever fell from 15,000 concurrent viewers to under 200 within weeks of its press cycle; Claude Plays Pokémon averaged 81–201 viewers per stream 15 months after mainstream coverage; Twitch Plays Pokémon's 2014 run reported no revenue. The Flop scenario sits below the day-7 kill line by design: a launch that flops pivots to a weekly show under §8.

### Second-order value

The pipeline (cards, votes, bug cards, telemetry-to-agent, deterministic gate) is a sellable service to Early Access studios at $2–5k a month, buyer being the producer or community lead; the pipeline stays closed while the games are MIT. Plausible sponsors: AI dev-tool vendors, hosting vendors on credits-for-logo terms, streaming-tool brands via marketplaces. Steamworks permits a free base game with paid DLC; a season-end Supporter Pack is an option ($100 app fee recoupable after $1,000; Steam keeps 30%).

### Canada admin

Viewer payments to a for-profit are business income and consideration for a supply; GST/HST (13% Ontario) applies past the $30k small-supplier threshold. Copy says "contributions," never "donations." Register HST early since tiers with named benefits are sales. License: MIT for games and site; the platform repo stays private.

## 6. Build

### Build 1 — must be live before launch

Days 1–3, the public site. Landing page at a neutral holding domain (redirected after the name vote): the pitch line, the launch date, the Stripe contribution link with the split dropdown, the meter and ledger, a Discord link, the art policy line, and the Now and Next sections (what is building; what is decided or open to fund). Amended 14 September 2026: the live cut is specified in `docs/specs/live-cut.md`; the week framing below is history, the site shows Now and Next, a supporter votes by funding a Next card, and the fleet runs unattended through the same Claude Code command with the studio organisation's key. Contributions before launch pre-load the pool and earn a founding badge and first position in the personal-decision queue. The board posts the day the page is live; the build streams on the Twitch channel from the same day. Bar: a real $1 Stripe contribution appears on the meter and the ledger within 60 seconds with its chosen split recorded; the page loads on a phone.

Week 1, the loop. Platform and seed repo skeletons, Supabase schema, dispatcher with throttle and scheduler stub, gate package with the deny-list, seed with Phaser skeleton and sim core, Netlify deploy with `last_green` rollback, minimal `/board` (sign-in, pause/resume, file a directive, file a note). Bar: a card inserted in stage `funded` with a $2 estimate, against a pool seeded with $50, becomes a deployed change within 15 minutes, with ledger rows and an updated `last_green`, three runs in a row.

Week 2, the show. OBS on the VPS, Dev Cam and Director's Room scenes, Replay fallback, host reads chat and speaks through the filter, chat micro-vote creates a config-lane card, second-provider adapter, the channel streaming the build. Bar: `!vote` changes on-stream text within 10 seconds; the stream survives the 48-hour reconnect unattended; one chat vote becomes a merged change visible on stream within 30 minutes.

Week 3, money and public. Meter to throttle; vote board, buckets, tier quorums and source tags; goal and standing bars with the four-column site and the design stage; personal-decision backlog and assignment on contribution; incident reserve and S1 classification; in-game bug filing; auto-clip; image adapter and the alien team style sheet; Meet the Team, Board Decisions and Lore pages; full board dashboard with TOTP; rollback drill; kill switch from a phone. Bar: a real $5 contribution unpauses a paused dispatcher within 60 seconds and assigns the contributor a medium decision that executes within 10 minutes of their choice; a deliberately broken build is restored on production within 5 minutes; a string containing a deny-listed term fails the gate; an S1 bug card starts building without a vote; the kill switch cuts to Replay within 15 seconds; nine avatars render on Meet the Team in one style.

Day 22: public launch. If week 3's bar is not met on day 21, the date moves and the scope does not grow. If week 1's bar is not met by day 7, the launch moves a week before anything else changes.

### Roadmap — season 1, through the system

Tagged by source so the community sees where each came from.

Board: agent-maintained wiki ("How it works", generated from role specs, kernel and this plan; Platform bucket, week 4). Blue-sky proposals (Studio Head, monthly from week 6). Play Cam scene (season 2). Membership tiers on Stripe (season 2, if Mid holds). Steam release path (conditional on 500 daily players).

Agent: Scout tool trials (from day 15; Langfuse-class observability is the first candidate). Efficiency-curve publication (week 4). Card-system improvements from platform metrics (ongoing). Vote-weight regimes (from day 15).

Community: lore canonization, trend cards, name votes (from day 8 as the Community agent activates).

### Architecture

A Node dispatcher runs on a one-minute tick: read Supabase for the highest-priority card in stage `funded` that is not vetoed; spawn an agent session in a git worktree of the target repo with the card as spec plus the repo's CLAUDE.md; stream tool events to `agent_events` (Dev Cam renders this); push the branch; GitHub Actions runs the gate for the folders the branch touched; on green the dispatcher merges via the GitHub API (branch protection on `main` requires the gate check); Netlify deploys; a production smoke test (page load plus a 60-second bot run) passes or the previous deploy is restored from `last_green`; the card moves to `live` and the event fires. The public repo is a read-only mirror of `seed-1/` on `main`, pushed after each ship; no external pull requests.

Agent runtime: one adapter interface with two implementations. Attended mode (pre-launch) runs sessions through Claude Code on the founder's subscription and refuses to start when no board member's session is active. Unattended mode (launch onward) runs the Claude Agent SDK on the separate API organization. A second-provider adapter covers the Builder and Host roles.

A scheduler inside the dispatcher (node-cron) runs the timed jobs: hourly board-note triage by the Studio Head; the nightly rebalance proposal at 03:00 ET; the Monday 09:00 ET allocation and report; the weekly Scout and Community runs; macro-vote open and close; the monthly blue-sky session. Each job is a short agent session for the named role, metered like any card.

Budget throttle: every agent turn writes usage at list price to `ledger`. A card starts only if pool balance minus the reserve covers its estimate. The reserve is the chargeback reserve (10% of receipts) plus whatever the Budget bucket has allocated to the studio reserve (zero at launch). Per-card ceiling: 150% of estimate, absolute maximum $25 at launch. Turn cap 60 per session. Concurrency: min(2, floor(balance ÷ `AGENT_HOURLY_RATE_USD`)), rate $5 at launch and replaced by the measured figure. Daily cap: min(balance, $100) at launch. Caps live in `studio_state` and are edited from the board; the environment values are the initial seeds. Zero balance: agents idle, host and stream keep running.

Image adapter: an ordered provider list in `studio_state.image_providers` (default: OpenAI gpt-image, then Google Gemini image), each with a credit or budget balance; the adapter uses the first provider with remaining free credit, then the first with paid budget, and charges the card that requested the image. Every generated image passes the provider's safety filter and lands in a board review queue before first use. Images are used only for studio imagery per the art policy.

Game runtime: Phaser 3 with TypeScript and Vite. Static build to Netlify; `Phaser.HEADLESS` in Node for playtest bots. Each seed keeps a deterministic, seeded simulation core (`seed-1/sim/`) separate from rendering so bots run at 1000× realtime.

Execution: Game and QA cards run on Builder A or Builder B (round-robin; QA reproductions on QA), Platform cards on the Platform Builder; the executor and target folder are columns on the card. One repository, `backseat`, with two top-level folders: `platform/` (site including `/board`, dispatcher, host, community and scout agents, image adapter, OBS config, gate package; the site is Vite + React, deployed as its own Netlify site) and `seed-1/` (game, `config/`, `content/`, `sim/`, CLAUDE.md, gate workflow). `seed-1/` never imports from `platform/`, so a seed can be lifted into its own repository with a public MIT mirror in season 2 when the second seed exists. The public mirror in season 1 is the `seed-1/` folder only. Platform cards run the stricter gate: Playwright end-to-end suite plus dispatcher unit tests plus a blue/green heartbeat (a new dispatcher or host version that fails to heartbeat within 60 seconds auto-reverts). Dispatcher and host run as Docker services under systemd on the VPS; in week 1 they may run on the founder's Mac.

Stream: each scene is a web page. OBS in Docker on the VPS with browser sources as scenes, switched via obs-websocket from `stream_state` (channel points can flip it). TTS self-hosted (Piper or Kokoro); OpenAI TTS as fallback. Twitch: tmi.js for chat, EventSub for Bits, subs and channel-point redemptions, Helix clips on ship, gate-fail and bug-repro events. Weekly episode: ffmpeg concat of clips plus host narration, uploaded through the YouTube Data API (quota applied for in week 1). Twitch caps one broadcast at 48 hours; the encoder reconnects as a new broadcast. A VPS watchdog restarts OBS and Chromium; the Replay scene plays at zero balance.

### Technical risks

Runaway spend (per-card ceiling, ledger gate, daily cap, Console limit). Platform agents breaking the thing running them (blue/green heartbeat, kernel not editable). Twitch enforcement or monetization gating (a live-responding host, an accountable owner, Stripe primary). Dead air overnight (watchdog, Replay scene, phone alerts). Agents shipping systems rather than fun (idle genre, bot progression-curve metrics in the gate; the launch bar is "loop visible," not "fun").

## 7. Launch

### First 72 hours

Hour 0–1: live as "Untitled Game Studio." Host introduces the seed, the meter (showing the $200 founding budget), and the board's recorded split statement. First micro-vote at ten minutes: which of three pre-filed config-lane bugs gets fixed first. The fix ships within about ten minutes. That clip is the launch asset; the Reddit posts, the Show HN and the X thread go out after it exists, in that order. At hour 1 the first global vote opens: the studio's name, four options, 48 hours. The first contribution of any size receives the first personal decision from the backlog, on stream.

Hours 1–6: micro-votes every few minutes; host and Game Director argue over the first Game cards. Direct messages to five journalists with the clip. Discord and subreddit open.

Hour 2 (Monday 12:00 ET): the first macro vote opens with three pre-proposed Game cards and the host-name card. Hours 6–24: the first nightly rebalance shown as a before/after. At the first $500 funded, the card leading the open macro vote is funded early as the hype-train card (the one exception to the Sunday close), starts building on stream with the gate visible, and the Budget bucket opens.

Hours 24–48: first auto-cut episode. First bug fix credited to a viewer by name. AMA on r/ClaudeAI or r/IndieDev.

Hours 48–72: the name vote closes at hour 49 and the site and stream retitle live. A board member on camera for 60 minutes: what broke, what it cost, ledger on screen including the aggregate split supporters chose. Ledger published.

### Channels

Reddit first (Nothing, Forever went from four concurrent viewers to 15,097 within days of Reddit promotion): r/ClaudeAI, r/artificial, r/Twitch, r/incremental_games; not r/gamedev, which is hostile to AI. Hacker News second (Claude Plays Pokémon reached the front page). X third. Press fourth: TechCrunch (Amanda Silberling covered Nothing, Forever), Tubefilter (Sam Gutelle covered Claude Plays Pokémon), Dexerto's Twitch desk, Game Developer, Ars Technica. Shorts and TikTok as a long tail. Twitch's directory is not a discovery channel.

### Content after launch

Agent-produced: daily ledger post (also to Discord), weekly episode, three to five bug shorts, changelog, vote-result threads, community sentiment summary, an itch news post per milestone. Board: one 20-minute on-camera segment, 30 minutes approving cuts, 30 minutes on replies. YouTube's 2025 inauthentic-content rule demonetizes mass-produced uploads; a human intro per episode keeps it compliant, and YouTube ad revenue is not assumed.

### Backlash

GDC's 2026 survey of 2,300+ developers found 52% believe generative AI is harming the industry (30% in 2025, 18% in 2024), highest in art (64%) and design/narrative (63%). Four choices answer most of it: MIT open source, no generated art inside the games (procedural and vector only, stated on the site alongside the studio-imagery exception), a public ledger with the split chosen by supporters, and a named human board with the veto that appears weekly. Response line: "Everything here is open source, the game art is procedural, the ledger is public, and a human board directs it. If a specific choice is wrong, file it as a card and the community votes." The public repo is a read-only mirror, which avoids the AI-generated pull-request flood that led Godot to ban AI-authored contributions in July 2026.

## 8. Risks and kill conditions

Three failure modes matter most. Novelty decay before the funding loop closes (the Nothing, Forever and Claude Plays Pokémon curves), answered by designing retention around the weekly appointment (vote close, ship-live, Monday report) with the 24/7 feed as a byproduct. The host saying something bannable overnight (Nothing, Forever's 14-day suspension), answered by the filter, delay and kill switch. The board becoming the on-call engineer, answered by the watchdog, the Replay scene, the incident reserve, and the hour budgets above.

Abuse and mitigations. Brigading: account age, one vote per account, quorums, the gate. Prompt injection: the read/write separation in the kernel. Cost drain: per-card ceilings, wall-clock caps on repro, the daily bug-report quota. Harassment through names and credits: deny-list, cooling period, Wednesday approval. Chargebacks: the $50 daily credit cap, the 14-day hold above it, the 10% reserve; Bits absorb fraud on the Twitch rail.

| Day | Kill if | Pivot instead |
|---|---|---|
| 7 | under 300 peak concurrent, under 25 unique funders, under $500 funded, or board time over 25 hours | drop 24/7; run a weekly two-hour live show |
| 30 | under 150 average concurrent, under 100 funders, under $2,000 cumulative, or board time over 12 hours a week | drop the meter; run as a public demo |
| 90 | under $6,000 cumulative, or board time over 10 hours a week | archive; publish the post-mortem; open-source the vote and meter kit |

## 9. Sources

Twitch Plays Pokémon — https://en.wikipedia.org/wiki/Twitch_Plays_Pok%C3%A9mon · Neuro-sama — https://en.wikipedia.org/wiki/Neuro-sama · Dexerto on Neuro-sama — https://www.dexerto.com/twitch/an-ai-powered-vtuber-is-now-the-most-popular-twitch-streamer-in-the-world-3300052/ · Multiverse Studios — https://multiversegames.ai/ · Polsia — https://timfrin.substack.com/p/how-polsia-builds-and-runs-companies · Claude Plays Pokémon — https://techcrunch.com/2025/02/25/anthropics-claude-ai-is-playing-pokemon-on-twitch-slowly · Claude Plays Pokémon viewership — https://streamscharts.com/channels/claudeplayspokemon · Nothing, Forever rise — https://techcrunch.com/2023/02/03/nothing-forever-ai-generated-seinfeld-twitch/ · Nothing, Forever ban — https://www.nbcnews.com/tech/twitch-temporary-ban-seinfeld-parody-ai-transphobic-remarks-rcna69389 · Nothing, Forever decline — https://tech.yahoo.com/ai/articles/ai-driven-perpetual-seinfeld-falls-152926325.html · Anthropic pricing — https://platform.claude.com/docs/en/about-claude/pricing · Anthropic weekly limits — https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/ · Twitch Community Guidelines — https://safety.twitch.tv/articles/en_US/Knowledge/Community-Guidelines · Twitch Affiliate — https://help.twitch.tv/s/article/joining-the-affiliate-program · Twitch 48-hour cap — https://ireplay.tv/blog/24-7-always-on-streaming-twitch-grow-audience-with-existing-content/ · Twitch AI training opt-out — https://www.nbcnews.com/tech/tech-news/twitch-creators-push-back-amazon-using-content-train-ai-rcna592391 · Twitch revenue split — https://streamernews.gg/guides/twitch-revenue-split-explained/ · Twitch 70/30 — https://variety.com/2023/digital/news/twitch-partner-plus-70-percent-revenue-split-streamers-1235645488 · Stripe Payment Links custom fields — https://docs.stripe.com/payment-links/custom-fields · Patreon earnings — https://bloggingwizard.com/patreon-statistics/ · Kickstarter games 2025 — https://medium.com/icopartners/kickstarter-and-video-games-in-2025-90f15c2fd7bd · Star Citizen $1B — https://massivelyop.com/2026/05/25/star-citizen-has-officially-raked-in-over-one-billion-dollars-in-total-crowdfunding-from-gamers/ · Steamworks DLC — https://partner.steamgames.com/doc/store/application/dlc · Steam app fee — https://partner.steamgames.com/doc/gettingstarted/appfee · GDC 2026 survey — https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/ · Godot AI ban — https://www.theregister.com/ai-and-ml/2026/07/01/godot-says-bye-bye-ai-bans-vibe-coded-contributions/5265344 · YouTube inauthentic content — https://techcrunch.com/2025/07/09/youtube-prepares-crackdown-on-mass-produced-and-repetitive-videos-as-concern-over-ai-slop-grows · Canadian creator tax — https://www.mondaq.com/canada/tax-authorities/1816972/canadian-influencer-tax-guide-cra-audit-risks-gsthst-rules-cryptocurrency-income-foreign-reporting-and-tax-planning-strategies

## 10. Defaults in force

1. Build 1 as written; launch day 22, a Monday.
2. Name: chosen by the first global vote from Peanut Gallery, Backseat Driver, Armchair, Helicopter (all "Game Studio"). Domains and handles for all four are registered before launch; a trademark glance on Peanut Gallery first. The repository keeps the working name `backseat`.
3. Split: 10% reserve off the top; default 80% Agents / 20% Studio on the remainder, supporter-selectable at checkout from day 1; 5% of the Agents share to the incident reserve until it holds $500.
4. Launch seed: idle/incremental.
5. Compute: attended mode on the founder's subscription before launch; the separate API organization ($500 monthly limit) from launch day.
6. Second kill-switch holder: named by the board before day 15.
7. Founding budget: $200 seeded at launch.
8. Payments: Stripe Payment Links; Twitch Bits when Affiliate; no Ko-fi.
9. Images: OpenAI gpt-image first, Gemini second, free credit before paid, studio imagery only.
10. Site sections (14 September 2026): Now and Next replace the three sprint goal cards, which were retired from the database the same day. No season framing on the site until the first season is declared.
11. Vote at live (14 September 2026): funding a Next card is the vote. Targets sit at or below the per-card maximum; the bar credits the agents' net amount; a full bar moves the card to `funded`.
12. Unattended mode (14 September 2026): the same Claude Code command with `STUDIO_ANTHROPIC_API_KEY` from the studio organisation, never the founder's key; a session billed to the wrong account is refused.
13. Observability (14 September 2026): `agent_events` and `ledger` are the record; the dispatcher logs JSON lines and writes a heartbeat to `studio_state`; Langfuse-class tooling stays the Scout's first trial after launch and is never fed from the agent child.

## 11. Kick-off

Board, before the first Claude Code session:

1. Stripe: create an account (or use an existing one), create a Payment Link for a custom-amount one-off contribution with a dropdown custom field named "split" and the six options in §5; enable webhooks and save the signing secret. Register a neutral holding domain. Create the Discord server with an invite link. Create the Twitch channel with two-factor and AutoMod level 4.
2. GitHub: one private repository, `backseat` (already created at ~/GitHub/backseat).
3. Supabase: a project named `backseat`; save the URL, anon key and service-role key.
4. Netlify: two sites, `backseat-seed-1` and `backseat-platform`; save both site IDs and one personal access token.
5. Hetzner: one dedicated-vCPU Ubuntu instance with your SSH key; save the IP.

Board, before week 2:

6. Twitch: banned-terms list, followers-only (10 minutes), slow mode (5 seconds), opt out of AI training in Settings, register a developer application and save the client ID and secret.
7. YouTube channel and a Google Cloud project with the YouTube Data API v3 enabled; apply for the upload quota increase.
8. Subreddit; Discord bot token.
9. Register a domain and the Twitch and YouTube handles for each of the four name options (about $100 total); check Peanut Gallery for an existing games trademark first.
10. OpenAI and Google AI Studio API keys for the image adapter; note the free credit on each.

Board, before launch:

11. Anthropic Console: create a new organization for the studio (not the Max account), one API key, monthly spend limit $500.
12. Name the second kill-switch holder and make them a Twitch moderator.
13. Calendar reminder to review HST registration at $15k cumulative receipts.
14. Record the 60-second split statement the host plays at hour 0.

## Appendix A — Week-1 technical spec

Repository layout. `platform/`: `/dispatcher` (Node 22, TypeScript; adapters `attended` and `unattended`), `/gate` (shared package: `ship-gate.sh`, `runtime-token-deny.sh`, `banned-phrases.sh` authored fresh in this repository, plus `denylist/` and `headless-bot/`), `/site` (Vite + React: landing, ledger, meter, bars, four columns, Meet the Team, Board Decisions, Lore, `/board`), `/host`, `/agents` (role specs as JSON), `/images` (provider adapter), `/brand/team-style.md`, `/ops` (Docker, systemd units, OBS scene config). `seed-1/`: `/sim`, `/config` and `/content` (config lane), `/render` (Phaser 3), `/bots`, `CLAUDE.md`. Root: `CLAUDE.md`, `docs/PLAN.md`, `.github/workflows/gate.yml` (path-filtered per folder).

Environment variables. `ANTHROPIC_API_KEY`, `ANTHROPIC_ORG_ID` (unattended mode only), `AGENT_MODE` (attended | unattended), `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`, `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID_SEED`, `NETLIFY_SITE_ID_PLATFORM`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PAYMENT_LINK_URL`, `BOARD_EMAILS` (comma-separated), `MODERATOR_EMAIL`, `OPENAI_API_KEY`, `GOOGLE_AI_API_KEY`, `POOL_DAILY_CAP_USD` (100), `CARD_MAX_USD` (25), `SESSION_MAX_TURNS` (60), `AGENT_HOURLY_RATE_USD` (5), `MODEL_BUILDER`, `MODEL_DIRECTOR`, `MODEL_HOST`, `PRICE_TABLE_JSON`. Board auth: Supabase Auth magic link; sign-in allowed only for `BOARD_EMAILS` and `MODERATOR_EMAIL`; row-level security restricts `board_notes` and `studio_state` writes to those users.

Supabase schema (week 1 subset).
`cards`: id, bucket (enum: game, platform, qa, studio, budget, agents), source (enum: board, community, agent, decision), shape (enum: oneoff, goal, standing), lane (enum: config, code), priority (integer; 0 board directive, 1 S1 incident, 10 personal decision, 100 default), board_reason, folder (enum: seed-1, platform), executor_role_id, title, intent, acceptance_test, design_spec_url, funding_target_usd, funded_usd, estimate_usd, confidence (enum: low, med, high), proposer_role_id, director_stance (enum: neutral, endorsed, vetoed), veto_reason, stage (enum: proposed, designing, voted, funded, building, gated, live, rejected, paused), severity (enum: s1, s2, s3, s4, nullable), actual_usd, branch, commit_sha, failing_check, created_at, updated_at.
`ledger`: id, card_id, role_id, model, input_tokens, cached_tokens, output_tokens, usd, created_at.
`pool`: id, balance_usd, reserve_usd, incident_reserve_usd, daily_spent_usd, day.
`contributions`: id, rail (enum: stripe, twitch, founder), contributor_id, display_name, amount_usd, net_usd, reserve_usd, agents_usd, studio_usd, incident_usd, studio_pct_chosen (default 20), kind (enum: cash, hours, tokens), public (boolean; false for founder rows), goal_card_id (nullable), decision_id (nullable), stripe_event_id, created_at, credited_at.
`standing_costs`: id, name, role_id (nullable), monthly_usd, funded_this_month_usd, month.
`agent_events`: id, card_id, role_id, type (enum: start, tool_call, tool_result, message, gate_pass, gate_fail, ship, revert, error), payload_json, created_at.
`roles`: id, name, title, species_note, avatar_url, model, budget_share, voice, prompt_path, tools_json, metrics_json, write_access (boolean), state (enum: active, retired), hired_at, retired_at.
`scores`: id, role_id, week, first_pass_rate, cost_per_ship, estimate_accuracy, reopen_rate, composite.
`votes`: id, card_id, voter_id (Twitch user id), weight, regime, created_at; unique on (card_id, voter_id).
`stream_state`: id, scene (enum: devcam, director, replay, idle), updated_at.
`board_notes`: id, author_email, text, state (enum: new, triaged), outcome (enum: card, scheduled, discarded), outcome_reason, card_id, created_at, triaged_at.
`studio_state`: id, paused (boolean), paused_by, paused_at, kill_switch_fired_at, daily_cap_usd, card_max_usd, agent_hourly_rate_usd, reserve_pct (10), incident_pct (5), incident_cap_usd (500), studio_reserve_usd (0), image_providers_json, agent_mode.
`images`: id, card_id, provider, prompt, url, cost_usd, safety_passed, board_approved, created_at.
`decisions` (week 3): id, size (enum: small, medium, large), title, options_json, config_key, cost_usd, state (enum: open, assigned, executed, expired), assigned_to, contribution_id, chosen_option, card_id, created_at, assigned_at, executed_at; unique open decision per config_key.
`deploys`: id, folder, sha, netlify_deploy_id, is_green, smoke_result, created_at. `last_green` is the newest row with is_green true.

Dispatcher loop (every 60 seconds). Read `studio_state`; if paused, sleep; if `agent_mode` is attended and no board session is active, sleep. Read `pool`; if daily_spent ≥ daily cap or balance − reserve < smallest funded estimate, sleep. Select the `funded` card not vetoed with estimate ≤ available (S1 cards may draw the incident reserve), lowest priority number first, then oldest. Set `building`; create worktree from `main`; run the agent session with the card, the repo CLAUDE.md, and the role's prompt; write every turn to `ledger` and `agent_events`; stop at the per-card ceiling or turn cap (then `paused`). On completion push branch, open a pull request, set `gated`. Poll the gate check; on pass merge via API, wait for Netlify deploy, run smoke; on smoke pass write `deploys` (green) and set `live`; on any fail set `rejected` with `failing_check`, restore `last_green` if the deploy went live.

Stripe webhook (Supabase Edge Function). On `checkout.session.completed`: read amount, the `split` custom field, and the customer's display name; compute reserve, agents, studio and incident amounts; insert `contributions`; increment `pool.balance_usd` and `pool.incident_reserve_usd`; if `decisions` exist, assign one of matching size; if a `goal_card_id` was passed, increment its `funded_usd`. Idempotent on `stripe_event_id`.

Gate (GitHub Actions, seed repo). Steps: install; typecheck; unit tests; deny-list scan over `seed-1/**` strings, filenames and the commit message; runtime-token deny (NaN, undefined, TODO, placeholder and the rest of the list); headless bot: run `seed-1/sim` for a fixed seed for 10 simulated hours and assert progression-curve invariants (resource never negative, at least one unlock per simulated hour, no NaN state); build. Config-lane cards run only deny-list, bot and build. Platform gate adds Playwright end-to-end and dispatcher unit tests.

Week-1 seed data. Insert the nine launch roles into `roles` from `/agents/*.json` (names are the role titles until the Studio Head names them at launch; Builder A is the executor for the acceptance test; avatars null until week 3); one `studio_state` row from the environment values; one `pool` row; the three sprint goal cards with funding_target_usd 100, 150 and 250.

Days 1–3 acceptance test, literal. A Stripe `checkout.session.completed` event for $1 with split "80/20" creates a `contributions` row with studio_pct_chosen 20, increments `pool.balance_usd` by the net Agents amount and `pool.incident_reserve_usd` by 5% of it, and the public site shows the new total within 60 seconds. The three sprint goal cards render bars from `funded_usd`.

Week-1 acceptance test, literal. Seed `pool` with balance 50. Insert a card: bucket game, source board, shape oneoff, lane config, stage funded, estimate 2, acceptance_test "spawn table row X changes to Y", proposer and executor the Builder A role. Within 15 minutes: stage live, one or more `ledger` rows with usd > 0, `deploys` has a new green row, and the live site serves the change. Repeat three times.

Seed 1 pillars (for the Game Director's role spec). Idle/incremental; one screen; numbers go up; every feature visible within 60 seconds of play; sessions of two minutes are satisfying; all-ages; procedural or vector art only.

Role spec format (`/agents/<role>.json`): name, title, species_note (one line describing the alien), model, budget_share, voice, prompt_path, tools (allowlist), metrics (two or three from the defined set), write_access (boolean; false for host, community and scout).

## Appendix B — First Claude Code session

Run from the repository root (`~/GitHub/backseat`). This document is the spec: §4 mechanics (cards, shapes, tiers, The Board, kernel), §6 Build 1 and architecture, Appendix A technical spec. This session builds days 1–3 first, then week 1.

Scope Parameters
- Effort: high. No fast mode.
- Goal 1 (days 1–3, first; deploy before starting goal 2): the days-1–3 acceptance test in Appendix A passes on the live platform Netlify site: a Stripe checkout.session.completed event for $1 with split "80/20" creates a contributions row with studio_pct_chosen 20, increments pool.balance_usd by the net Agents amount and pool.incident_reserve_usd by 5% of it, and the public page shows the new total within 60 seconds; the three sprint goal cards render as progress bars; the page has the pitch line, launch date, Stripe link, Discord link, art-policy line, and the meter and ledger (pool figures only; no founder rows), and loads on a phone.
- Goal 2 (week 1): the week-1 acceptance test in Appendix A passes three times in a row: with roles, studio_state and pool seeded (balance $50), a card inserted in stage funded (source board, shape oneoff, lane config, estimate $2, executor Builder A) becomes a deployed change on the live seed site within 15 minutes, with ledger rows and a new green deploys row.
- In scope: `platform/` (public site as Vite + React: landing, ledger, meter, goal bars; minimal /board with magic-link sign-in restricted to BOARD_EMAILS, pause/resume, file a directive, file a note; Stripe webhook as a Supabase Edge Function, idempotent on stripe_event_id; dispatcher with the attended/unattended adapter interface, budget throttle and scheduler stub; /gate package with ship-gate, runtime-token-deny and banned-phrases scripts plus the deny-list scan; /agents role specs for the nine launch roles with species_note; /ops Docker and systemd units) and `seed-1/` (Phaser 3 + TypeScript + Vite skeleton, deterministic sim core with seeded RNG, config and content folders as the config lane, headless bot with the progression invariants, CLAUDE.md). Root gate workflow path-filtered per folder. Supabase schema exactly as Appendix A, RLS on board_notes and studio_state.
- Out of scope this session: OBS, stream scenes, host, TTS, Twitch integration, personal decisions, vote board, four-column view, design stage, incident classification, image adapter and avatars, Meet the Team, Board Decisions and Lore pages, Community and Scout logic, second-provider adapter, TOTP, public mirror. Do not start them.
- Pre-decided: Node 22; Phaser 3; Vite + React; AGENT_MODE=attended for this session (sessions run through Claude Code on this machine and refuse to start when no board session is active); dispatcher runs on this Mac for week 1 (Docker/systemd written, not deployed); Sonnet-class model for Builder A; caps and rate in studio_state seeded from env; branch protection on main requiring the gate check; merge via GitHub API on green; smoke = page load + 60-second bot run; restore last_green on smoke fail. Site copy is plain and declarative; no slogans, no hype words, no uppercase label lines above headings. Nothing in the repository references the founder's other companies or projects.
- Kernel rule from day one: no agent with write access reads free text from outside the repo, the card, and board notes.
- Before building, list what you are unsure about and the assumptions you will make, then proceed without waiting.
- Ask only for credentials (Supabase URL/keys, GitHub token, Netlify token and site IDs, Stripe keys and webhook secret, the Payment Link URL, BOARD_EMAILS, the holding domain, the Discord invite) and for anything that would spend money. Decide everything else.
- Verifiable bar: goals 1 and 2, plus `pnpm verify` (typecheck, unit tests, gate dry-run) exits 0 at the repository root.
- Stop when the bar is met or after the third failed end-to-end run on either goal; end with what passed, what did not, the live URLs, and the exact commands run, not a summary.
