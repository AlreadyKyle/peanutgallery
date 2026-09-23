# Backlog

Everything planned that is not built. Each entry below is filed as a board card by
`platform/supabase/scripts/file-backlog.ts`: stage proposed, on its horizon, with its rank and no
funding target, so the public /roadmap page lists it as planned and nobody can fund it yet. The
board moves an entry to now, with a target, only when it meets the definition of ready in
`docs/PLAN.md` §4. `docs/PLAN.md` gives each mechanic one line that links its entry here, and
`docs/docs.test.mjs` checks that every entry is linked and every link lands.

Format, which the parser enforces: each card is a level-3 heading with the title (at most 80
characters, unique), followed by six bullet lines in this order, each written as a key, a colon
and a value: bucket (game, platform, qa, studio, budget or agents), folder (seed-1 or platform),
horizon (next or later), rank (a whole number, lower is sooner, unique within its horizon),
summary (one line of public copy, at most 200 characters, sentence case, no em dash) and intent
(one paragraph on one line saying what it is, why, and that it is not built yet). Prose and
level-2 headings are ignored. The title is the key the script upserts on, so renaming an entry
files a new card.

Next is what makes the studio directed by its audience soonest (22 September 2026). Later is
everything else, in the order the board would take it.

## Next

### Voter identity for free votes
- bucket: platform
- folder: platform
- horizon: next
- rank: 1
- summary: A player sign-in, so that a free vote counts once per person. Free voting waits on it.
- intent: A supporter account on the site, separate from the board's sign-in, with one vote per account and a minimum account age before an account can vote, so votes cannot be multiplied; linking a Twitch identity can come later. Free voting cannot move to now until this exists. It is not built yet.

### Free voting on open cards
- bucket: platform
- folder: platform
- horizon: next
- rank: 2
- summary: Players vote for free on which open card is built next, alongside funding it.
- intent: Free votes from identified accounts counted beside the money on each open card, with the kick-off plan's tiers and quorums: global decisions pass at 60% with a quorum of the larger of 25 voters or 10% of the trailing seven days' unique voters and stay open 48 hours; collective decisions pass by simple majority with a quorum of the larger of 25 voters or 5% of weekly unique voters; micro-votes of 90 seconds pick among agent-proposed config options. At launch funding a card is the only choice a supporter makes. Needs voter identity. It is not built yet.

### Studio Head drafts cards from the roadmap
- bucket: agents
- folder: platform
- horizon: next
- rank: 3
- summary: The Studio Head turns planned items into draft cards for the board to check and open for funding.
- intent: A scheduled Studio Head session reads this backlog, the ledger and the shipped cards, and files draft cards that meet the definition of ready for the board to edit and move to now. At launch the board files every card, and no job runs the directors. It is not built yet.

### Studio Head triages board notes
- bucket: agents
- folder: platform
- horizon: next
- rank: 4
- summary: The Studio Head reads each note from the board and turns it into a draft card, a scheduled item or a discard, with a reason.
- intent: Board notes are the one free text a role with write access may read. Triage runs at the top of every hour and at planning, links the note to its outcome, and shows the reason only on /board; a discarded note stays discarded unless the board files it as a directive. Notes are stored today and nothing reads them. It is not built yet.

### The Monday report
- bucket: agents
- folder: platform
- horizon: next
- rank: 5
- summary: A weekly public report from the Studio Head on what shipped, what it cost and what comes next.
- intent: A scheduled Studio Head session writes the report from the ledger, the shipped cards and the efficiency figures, adds one line from each running agent, and posts it on the site. It is the studio's regular appointment for supporters. It is not built yet.

### Board on its own site
- bucket: platform
- folder: platform
- horizon: next
- rank: 6
- summary: Move the board's dashboard to a separate site, so code built by the agents never runs next to the board's sign-in.
- intent: Board work through a reviewed pull request, not a fundable card: a kernel folder platform/board deployed as its own free Netlify site with its own Supabase client and an enforced CSP; Supabase Auth's site URL and redirect list moved to it; the public site's client stops persisting sessions and clears any stored one; a global sign-out of board and moderator users at the switch. Until it ships the studio code lane stays closed, so no card changes the public site's code. It is not built yet.

## Later

### Refund and dispute fee rows on the ledger
- bucket: budget
- folder: platform
- horizon: later
- rank: 1
- summary: Show the fees Stripe keeps on refunds and disputes on the public ledger, so the figures always add up.
- intent: Each fee Stripe keeps on a refunded payment or charges for a dispute becomes its own ledger row paid from the studio share, so the public figures reconcile with Stripe's balance after a reversal. It is not built yet.

### Handling a dispute the studio wins
- bucket: budget
- folder: platform
- horizon: later
- rank: 2
- summary: When a payment dispute is decided in the studio's favour, the money comes back to the agents and the ledger shows it.
- intent: A won dispute re-credits the contribution the dispute reversed, without crediting a card's bar twice, and records any dispute fee Stripe returns. Today a dispute reverses the contribution and nothing handles a win. It is not built yet.

### Two rare accounting edge cases
- bucket: budget
- folder: platform
- horizon: later
- rank: 3
- summary: Look into two rare cases in the money records that the code review found, and fix or close each one.
- intent: The sweep of 22 September 2026 (docs/specs/sweep-22-sep.md) left two items open because each needs a migration or a production read: the ledger-identity race and the null-session refund edge. Investigate each, then fix it or record why it cannot happen. It is not built yet.

### Board Decisions page
- bucket: platform
- folder: platform
- horizon: later
- rank: 4
- summary: A public page listing every action the board takes, each with its one-line reason.
- intent: Directives, cards the board files, funding by board members and cap changes appear with their reasons and a running count. The board's actions carry reasons today and no public page lists them. It is not built yet.

### Split aggregate on the meter
- bucket: platform
- folder: platform
- horizon: later
- rank: 5
- summary: Show the share supporters actually choose to send to the studio, next to the default 80/20 split.
- intent: The meter shows the live average studio share across contributions beside the default, computed from each contribution's chosen split, so the choice supporters make is public. It is not built yet.

### Board rollback button
- bucket: platform
- folder: platform
- horizon: later
- rank: 6
- summary: A button for the board that restores the last good version of the game or the site.
- intent: Restores the last green deploy through the same path the dispatcher uses after a failed smoke test, writes the revert commit on main and records the board's reason. Today rollback runs on its own after a failed deploy or smoke test, and the board has no button for it. It is not built yet.

### Incident list with post-mortems
- bucket: platform
- folder: platform
- horizon: later
- rank: 7
- summary: A list of incidents for the board, each with a post-mortem that is published once it is written.
- intent: Serious incidents are listed on /board with their status; the post-mortem posts to the ledger page, and the incident stays private until then. Card severity is private to the board today and there is no incident list. It is not built yet.

### Automated check minutes on the board's dashboard
- bucket: platform
- folder: platform
- horizon: later
- rank: 8
- summary: Show how much of the free monthly allowance for automated checks the studio has used, and pause before it runs out.
- intent: The repository is private on GitHub Free with 2,000 Actions minutes a month, and each code card costs about two gate runs. /board reports billed minutes against the quota and the dispatcher pauses the studio at a threshold, so a stalled gate is never charged to a card. It is not built yet.

### Alert the board at the tax review threshold
- bucket: budget
- folder: platform
- horizon: later
- rank: 9
- summary: Tell the board when total contributions reach the amount at which tax registration must be reviewed.
- intent: The board reviews GST/HST registration when cumulative contributions reach $15,000; registration is required past the $30,000 small-supplier threshold. An alert fires when the total crosses the review line. The board tracks it by hand today. It is not built yet.

### Scorecards for every agent
- bucket: agents
- folder: platform
- horizon: later
- rank: 10
- summary: A public scorecard for each agent: how often its work passes the checks first time, what a shipped card costs and how close its estimates are.
- intent: The metrics defined in PLAN.md §4, a composite score from percentile ranks across active roles, notable ships and bugs caused, and estimate confidence bands from each proposer's actuals (every card's confidence is low today). The team page shows no scorecards until this exists. It is not built yet.

### The efficiency curve
- bucket: platform
- folder: platform
- horizon: later
- rank: 11
- summary: A public chart of what a shipped card costs and how often work passes the checks first time, over time.
- intent: Computed from the ledger and the gate results over trailing windows, shown on the site and in the Monday report. It is not built yet.

### In-game bug button and QA reproductions
- bucket: qa
- folder: seed-1
- horizon: later
- rank: 12
- summary: A bug button in the game that saves the last minute of play, so QA can replay the bug and fix it.
- intent: The button records the last 60 seconds of game state plus fields from fixed lists, and no free text reaches an agent (an optional note goes to a human queue). QA replays it headless, attaches a clip and a pass or fail, classifies severity by deterministic rules (S1 is a failed build, a crash rate above 5% of sessions in the last hour, or a game that cannot start) and files a QA card; an S1 card draws the incident reserve. Each account files at most three reports a day, and a public Hall of Fame ranks fixed bugs. It is not built yet.

### Nightly rebalance card
- bucket: qa
- folder: seed-1
- horizon: later
- rank: 13
- summary: QA proposes a small balance change to the game each night from how people play, and players choose whether it ships.
- intent: A scheduled QA session reads session telemetry (quit points, unused features, difficulty spikes) and proposes a config rebalance card with its before and after, chosen by a micro-vote. Needs session telemetry and free voting. It is not built yet.

### Personal decisions for contributors
- bucket: platform
- folder: platform
- horizon: later
- rank: 14
- summary: Each contribution gives its payer a small choice of their own, such as naming an enemy from three options.
- intent: The Studio Head keeps a backlog of bounded decisions, each a choice among options the Builders proposed and the Game Director filtered, never free text; a contribution assigns the next decision of matching size ($1 to $4 small, $5 to $49 medium, $50 and up large). Small and medium ship through the config lane; a large one becomes a funded card. One open decision per config key. It is not built yet.

### Buckets, weekly allocation and the QA slider
- bucket: platform
- folder: platform
- horizon: later
- rank: 15
- summary: Players split the money between game, bug fixing, site and studio work, with at least 10% always going to bug fixes.
- intent: The community allocates the pool across open buckets each week; the QA share is a slider from 10% to 40%, default 20%. Buckets are an internal tag on cards today, and the pool is not divided. It is not built yet.

### Design stage for large cards
- bucket: platform
- folder: platform
- horizon: later
- rank: 16
- summary: A large card first gets a small paid design step that writes up what it does, shows a mock-up and sets its cost.
- intent: A design card capped at $10 produces what the card does, what it touches, its acceptance test and its estimate, and the funding target comes from it. Platform systems and game features above $25 go through it. The designing stage exists in the schema, and nothing moves a card through it. It is not built yet.

### Standing costs and sponsor a role
- bucket: budget
- folder: platform
- horizon: later
- rank: 17
- summary: Monthly bars for costs that keep running rather than ship, such as an agent's running cost, which supporters can sponsor.
- intent: Standing cards shown as monthly bars that refill (the host, a role's monthly running cost, the server); sponsoring a role funds that role's bar. The standing_costs table exists and nothing uses it. It is not built yet.

### Vetoes for the two directors
- bucket: agents
- folder: platform
- horizon: later
- rank: 18
- summary: The Game Director and the Studio Head can each veto a card in public, with a written reason that players can overturn.
- intent: Each director holds one veto per season (the Game Director over Game or QA cards, the Studio Head over Platform or Studio cards), public with a reason naming the pillar; 75% within 72 hours overturns it and spends the veto. Endorsements are labels. Needs free voting and a job that runs the directors. It is not built yet.

### Org chart changes and replacement votes
- bucket: agents
- folder: platform
- horizon: later
- rank: 19
- summary: Roles can be created, split, retired or replaced by a vote, and retired agents keep their record on an alumni wall.
- intent: The Studio Head files org cards (create, retire or split a role, change a model tier, replace an agent); replacement comes up for a role in the bottom 20% composite for two reviews in a row or under a 50% first-pass gate rate; the previous role spec is archived so a replacement can be reverted. Includes a /board control for each role's model tier. Role specs are kernel files the board changes today. It is not built yet.

### Agents improve agents, tested before merge
- bucket: agents
- folder: platform
- horizon: later
- rank: 20
- summary: Changes to the agents' own instructions, tools and checks are tested against the old version and undone if they do not help.
- intent: An Agents-bucket card names the metric it expects to move, is A/B tested on the headless bot suite against the prior version before merge, and reverts unless the metric improves by at least 10%. Prompts, role specs and gate checks are kernel files the board changes today. It is not built yet.

### Studio Head blue-sky proposals
- bucket: agents
- folder: platform
- horizon: later
- rank: 21
- summary: From time to time the Studio Head proposes three ideas that no number asked for.
- intent: A scheduled Studio Head session writes three proposals outside the metrics, filed as proposed cards for the board like any other. Needs a job that runs the directors. It is not built yet.

### Biz Dev agent for outside tools and trends
- bucket: agents
- folder: platform
- horizon: later
- rank: 22
- summary: An agent that follows new models, tools and game trends, and proposes trials that are measured, then kept or undone.
- intent: Biz Dev reads outside text and has no write tools, and it never contacts anyone. It files evidenced cards (model releases and pricing, tools, engine updates, comparable projects, genre trends) and trial cards that adopt a tool on one role, measure it, then keep or revert it; its score is its hit rate. It is built last and is not built yet.

### Community agent and the Lore page
- bucket: agents
- folder: platform
- horizon: later
- rank: 23
- summary: An agent that reads the studio's community and proposes lore, requests and a mood summary, with a page for the lore it adds to the game.
- intent: The Community agent reads the subreddit, the Discord, Twitch chat logs and X mentions and has no write tools. It files lore cards (an adopted meme becomes an in-game item with its origin linked), trend cards (a recurring request with its thread) and a sentiment summary; every proposal passes the content filter, the board and the gate. A Lore page lists what is canon. It is not built yet.

### The name pipeline
- bucket: studio
- folder: platform
- horizon: later
- rank: 24
- summary: Names that players suggest for credits and things in the game, checked by a filter, shown publicly for a day, then approved by the board.
- intent: Free-text names pass the deny-list, the trademark list and a 24-character limit, sit in a 24-hour public cooling period, and enter a build after the board approves a batch; one Chaos Name slot per season is filtered only for the rating and legality. Includes the collective name for unnamed contributors and the public display of contributor names, which the site stores privately today. It is not built yet.

### Vote weight regimes
- bucket: platform
- folder: platform
- horizon: later
- rank: 25
- summary: Players choose how votes are weighted: one account one vote, or weighted by funding, play time or tenure, or a chaos mode.
- intent: Set once per season; entering a non-default regime needs 66% and returning to democracy a simple majority. Funded weight is 1 plus log2 of dollars funded that season; play weight is 1 plus hours in the current build, capped at 20; tenure is 1 plus seasons taken part in; chaos counts a random 10% of micro-vote ballots. Paid tiers never buy vote weight. Needs free voting and seasons. It is not built yet.

### Seasons
- bucket: studio
- folder: platform
- horizon: later
- rank: 26
- summary: The studio works in seasons, each ending with a bug-fix freeze, a finale, credits and a public review of every agent.
- intent: A season has a length the board sets, a freeze for QA cards only before its finale, a version 1.0 when the gate is green and no well-supported QA card is open, credits for every supporter and bug reporter, and an employee of the season. The site shows no season framing until the first season is declared. It is not built yet.

### Next game chosen by a concept bracket
- bucket: studio
- folder: platform
- horizon: later
- rank: 27
- summary: Agents pitch three ideas for the next game with small playable prototypes, and players pick one over two rounds.
- intent: At a season's end three agent-pitched concepts, each with a playable prototype, run a two-round bracket (48 hours a round, one account one vote) to pick the next seed; the others go to a public archive. The Next game category on the site shows once such cards exist. It is not built yet.

### News section on the site
- bucket: studio
- folder: platform
- horizon: later
- rank: 28
- summary: A news page for studio announcements and milestones.
- intent: Decided on 18 September 2026 as a later card, alongside seasons. It is not built yet.

### Image adapter for studio pictures
- bucket: platform
- folder: platform
- horizon: later
- rank: 29
- summary: Pictures for the studio's pages, such as episode thumbnails and lore cards, made by an image model and checked by the board first.
- intent: An ordered provider list (OpenAI first, then Gemini behind the same interface, free credit before paid), metered per image to the card that asked for it, with every image through the provider's safety filter and a board review queue before first use. Used only for studio imagery (episode thumbnails, lore cards, the board's silhouettes), never for art inside the games; the agent avatars stay drawn by code (22 September 2026). Both keys are in .env and nothing reads them. It is not built yet.

### Discord bot
- bucket: studio
- folder: platform
- horizon: later
- rank: 30
- summary: A bot that posts what shipped and a daily ledger summary to the studio's Discord server.
- intent: Posts from the ledger and the pipeline's events only, and reads nothing back into any agent with write access. The site links the Discord server today. It is not built yet.

### Twitch channel and stream scenes
- bucket: platform
- folder: platform
- horizon: later
- rank: 31
- summary: A live stream of the studio at work, with scenes for the agents' office, the directors' room and replays.
- intent: OBS in Docker with web-page scenes (Dev Cam, Director's Room, Replay, and Play Cam after them) switched from stream_state and channel points; chat through AutoMod at its strictest with a banned-terms list, followers-only and slow mode; a watchdog; reconnects across Twitch's 48-hour broadcast cap. The board chose a site-first launch on 14 September 2026. It is not built yet.

### The host
- bucket: platform
- folder: platform
- horizon: later
- rank: 32
- summary: A narrator agent for the stream that explains cards and reacts to what ships, behind a filter, a delay and a kill switch.
- intent: The Host reads chat only after AutoMod and the deny-list, has no write tools, and speaks through self-hosted text-to-speech after an output filter, behind a 15-second broadcast delay and a kill switch held by the board and a moderator that cuts to Replay within 15 seconds. The delay and kill switch are kernel rules that bind the stream once it exists. Needs the stream. It is not built yet.

### Twitch Bits and subscriptions
- bucket: budget
- folder: platform
- horizon: later
- rank: 33
- summary: Accept Twitch Bits and subscriptions once the channel qualifies, with Twitch's cut shown next to the site's.
- intent: EventSub for Bits, subs and channel-point redemptions, credited through the same split, and the meter shows Twitch's cut so supporters can compare rails. Needs the stream and Twitch Affiliate status. It is not built yet.

### Weekly episodes and clips
- bucket: studio
- folder: platform
- horizon: later
- rank: 34
- summary: Short clips of each ship and fix, cut into a weekly episode with a human introduction.
- intent: Clips on ship, failed-check and bug-reproduction events; an episode of clips plus narration uploaded through the YouTube Data API with a board-recorded introduction, since YouTube demonetizes mass-produced uploads; an itch.io page and a news post per milestone. Needs the stream. It is not built yet.

### Membership tiers
- bucket: budget
- folder: platform
- horizon: later
- rank: 35
- summary: Monthly supporter tiers that come with personal decisions and a name in the credits. Paying more does not make a vote count more.
- intent: Stripe subscriptions at three tiers (Seed $5, Builder $15 and Patron $50 a month) with personal decisions and credits by tier. Tiers with named benefits are sales, so HST registration is settled before they ship. Needs personal decisions. It is not built yet.

### Public mirror of the game with a license
- bucket: studio
- folder: platform
- horizon: later
- rank: 36
- summary: A public, read-only copy of the game's code, updated after each ship, under a license the board picks.
- intent: The seed-1 folder mirrored to a public repository after each ship, with no outside pull requests, under a license the board chooses. The repository is private, and nothing public says the games are open source until this exists. It is not built yet.

### Tracing for agent sessions
- bucket: agents
- folder: platform
- horizon: later
- rank: 37
- summary: Detailed traces of each agent session in an existing tracing tool, alongside the public ledger.
- intent: OpenTelemetry export or Langfuse's free cloud tier, fed from the dispatcher's metered events and never from inside an agent session. The ledger and agent_events are the record at launch (22 September 2026). It is not built yet.

### Second model provider
- bucket: agents
- folder: platform
- horizon: later
- rank: 38
- summary: A second AI provider behind the same interface, so the builders and the host do not depend on one company.
- intent: A second adapter for the Builder and Host roles with the same metering, lane checks and gate, tested before any card runs on it. Unattended cards run on Claude Managed Agents at launch. It is not built yet.

### Run the studio without an always-on server
- bucket: platform
- folder: platform
- horizon: later
- rank: 39
- summary: Run the studio's card runner from events instead of keeping a server on all the time.
- intent: The dispatcher runs all the time, on the board's Mac for now, to hold each Managed Agents session's event stream, answer submit_patch, meter usage, hold the lease and drive the gate, merge and deploy. A dispatcher driven by Managed Agents webhooks would need no always-on machine, and so no Mac kept awake and no server to pay for or look after. It is not built yet.

### Steam release path
- bucket: studio
- folder: platform
- horizon: later
- rank: 40
- summary: Release a finished game on Steam, only if it holds 500 daily players for two weeks.
- intent: Version 1.0 ships free on the web and itch.io first; Steam follows only past that threshold, with the $100 Steamworks app fee recoupable after $1,000, and a paid supporter pack at a season's end is an option. It is not built yet.

### Move the dispatcher to Google Cloud
- bucket: platform
- folder: platform
- horizon: later
- rank: 41
- summary: Move the studio's card runner from the board's laptop to a free cloud server, so it keeps working when the laptop sleeps.
- intent: Move the dispatcher and the daily jobs (the backup, the Controller and the quota check) from the board's Mac to a free Google Cloud Compute Engine e2-micro under the board's existing Google account, with the Ubuntu provisioning already in platform/ops (provision.sh, deploy.sh, the systemd units). The e2-micro has 1 GB of memory, so the dispatcher container's 3 GB limit must drop and be load-tested with a card running; it is free only in three US regions; a $1 budget alert goes on the billing account; the backups need a new store, since Oracle is dropped. It waits on the board opening a Google Cloud billing account. It is not built yet.

### Split slider on the site, in place of the checkout dropdown
- bucket: platform
- folder: platform
- horizon: later
- rank: 42
- summary: Choose where your contribution goes with sliders on the site, the way Humble Bundle does, instead of a dropdown at checkout.
- intent: Humble Bundle style sliders on the contribute page set the supporter's Agents/Studio split (default 80/20, which stays the default and is not votable, PLAN.md §4 Kernel), with the 10% chargeback reserve and the incident share shown as fixed and not movable; the site creates the Stripe Checkout Session with the chosen split in its metadata through a Supabase function, replacing the Payment Link's custom dropdown (SPLIT_MAP in platform/supabase/functions/_shared/split.ts); the webhook must still accept only valid splits and keep crediting old Payment Link sessions. Continuous values or 1% steps are a choice to make when it is specced. This is one payment's Agents/Studio split, not the pool's weekly bucket allocation. Requested by the board on 23 September 2026. It is not built yet.
