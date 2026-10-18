# Backlog

Everything planned that is not built. Each entry below is filed as a card by
`platform/supabase/scripts/file-backlog.ts`: stage proposed, on its horizon, with its rank and no
funding target, so nobody can fund it yet. The
studio moves an entry to now, with a target, only when it meets the definition of ready in
`docs/PLAN.md` §4. `docs/PLAN.md` gives each mechanic one line that links its entry here, and
`docs/docs.test.mjs` checks that every entry is linked and every link lands.

Format, which the parser enforces: each card is a level-3 heading with the title (at most 80
characters, unique), followed by seven bullet lines in this order, each written as a key, a colon
and a value: bucket (game, platform, qa, studio, budget or agents), folder (seed-1 or platform),
horizon (next or later), rank (a whole number, lower is sooner, unique within its horizon),
summary (one line of public copy, at most 200 characters, sentence case, no em dash), intent
(one paragraph on one line saying what it is, why, and that it is not built yet) and kernel (yes
or no). Kernel is yes when the change lands in kernel paths: the rules, the money, the card
system, the dispatcher, the gate, the agents and their prompts, or the files that set the look.
A Claude session makes that work as a kernel pull request merged on a green gate and no card funds
it (`docs/PLAN.md` §4 Work and §10 decision 74, `docs/specs/copy-pass.md`); the database keeps the
marker as `cards.board_work`. An entry flips by editing its one line. Prose and level-2
headings are ignored. The title is the key the script upserts on, so renaming an entry files a
new card.

Next is what makes the studio directed by its audience soonest (22 September 2026). Later is
everything else, in the order the studio would take it.

The board's brief of 17 October 2026 (`docs/specs/final-state.md`, `docs/PLAN.md` §10 decision 75)
removed the entries the final state builds or makes obsolete: player accounts (profiles), free
voting, vote weight regimes, vetoes and personal decisions (suggestions and upvotes), buckets and
standing costs (suits and the Machine card), seasons and the concept bracket (eras, goals and New
game stages), and the news section (the feed). What it leaves for later is filed below.

## Next

### A card supply that keeps pace with funding
- bucket: agents
- folder: platform
- horizon: next
- rank: 1
- summary: When players fund faster, the agents open and build more cards a day, so money waiting on a card turns into shipped work instead of sitting.
- intent: Today the number of cards shipped a day is set by fixed counts, not by money. studio_state.draft_runs_per_day caps the Game Designer's drafts at 12 a New York day (docs/PLAN.md §10 decision 69; production read 4 on 10 October 2026, when the 4 runs were used by 21:20 UTC and the supply sat short), one draft runs at a time (checked every minute since decision 71, on a 20-minute pg_cron before it), the dispatcher runs at most 2 cards at once (throttle.ts concurrency, DISPATCHER_MAX_CONCURRENCY 1), and the monthly cap is a flat $500. The scale model (platform/dispatcher/test/scale.test.ts, production's measured costs of about $0.51 a card from draft to live) ships about 9 cards a day at 12 drafts whether players fund $50 or $5,000 a day, and the rest of the money waits; with no draft count and a 5-minute check it ships about 56 cards a day at $50 and stops at the $100 daily cap at about 168. The count guards against drafts failing in a loop, so the work is: replace the daily count with a breaker that stops drafting after a few failed or withdrawn drafts in a row and alerts the board, keeping every money cap; raise the open-card floor with the cards funded in the last day; let the slots and the monthly cap grow with the money players put in over the trailing month, inside the usage tier and the Console credit; and show the studio's capacity on the site as a meter players can push over the line. A kernel spec, since it changes the money rules and migrations. It is not built yet.
- kernel: yes

### Run the replay eval and set its first baseline
- bucket: agents
- folder: platform
- horizon: next
- rank: 2
- summary: Run the agents' frozen test cases once and record the score, so a later change to a prompt or rubric can be compared with it.
- intent: platform/agents/evals holds the draft set's nine cases, but no run has been recorded: there is no results folder and no baseline.json, so every prompt or rubric change passes with the advisory line that the baseline is missing. The board runs pnpm eval:replay -- --set draft --k 3 at the Mac on the founder's login (the runner refuses the studio key and CI) and files the result and the first baseline in a kernel pull request. It is not built yet.
- kernel: yes

### Aggregate counters for the benchmarks
- bucket: platform
- folder: platform
- horizon: next
- rank: 3
- summary: Send the new daily counters from the site and the game: returning players, session length, home visits, dwell and where shares come from.
- intent: The database side is built (docs/specs/operations.md): /api/count and count_play_event take the counters docs/strategy/benchmarks.md lists under Needs (a load from a save 1 or 7 days old, a session reaching 2 or 4 minutes, a seed saved or opened from a link, a home load and its dwell buckets, the broadcast's load and its QR source, a click on a Discord link), and public.daily_metrics keeps daily totals for the benchmark review. What is left is the senders: the game posts its returning, session and seed counters, the site posts the home load and dwell buckets and tags the broadcast's QR link and Discord links, each a beacon with no cookie, identifier or address, and the Privacy page names them. Until then those rows read not measured. It is not built yet.
- kernel: no

### The review team on events
- bucket: agents
- folder: platform
- horizon: next
- rank: 4
- summary: More of the review team joins the benchmark review: finance, product, games, art, upkeep and community each read their own areas.
- intent: The benchmark review runs (docs/specs/operations.md): on events, a code-built scoreboard of every row docs/strategy/benchmarks.md can measure from the daily counts, and a Studio Head session only when a row is below its floor, whose likely cause and proposed adjustment land as findings the board lists. docs/strategy/operating-system.md designs a fuller team: the Head of Finance, Head of Product, Game Director, Art Director, Janitor, Community and HR each reviewing their own areas with their own inputs (rubric scores, frames, gate results, scorecards), a report stored in the repository, and the board's panel showing the scoreboard. It is not built yet.
- kernel: yes

### Download and delete your profile data
- bucket: platform
- folder: platform
- horizon: next
- rank: 5
- summary: Download everything your profile holds, or delete it, from the profile page.
- intent: Profiles arrive with docs/specs/final-state.md. A signed-in player can download their profile, suggestions, seeds, votes and badges as a file, and delete the profile; contributions stay on the ledger as Supporter n or Anonymous, because the ledger is the record. Until this exists, requests go to the contact address. It is not built yet.
- kernel: yes

### Studio Head drafts cards from the roadmap
- bucket: agents
- folder: platform
- horizon: next
- rank: 6
- summary: The Studio Head turns planned items into draft cards that are checked and opened for funding.
- intent: The Studio Head picks planned cards from this backlog, the ledger and the shipped cards for the Game Designer to draft, each graded by the Game Director and meeting the definition of ready. Under docs/PLAN.md §10 decision 66 the dispatcher drafts the next seed-1 backlog card by rank and age whenever the card supply is short, and no model ranks (docs/specs/unattended-roles.md); the Studio Head choosing which planned card to draft, from the ledger and the shipped cards, is what is left. It is not built yet.
- kernel: yes

### Studio Head triages board notes
- bucket: agents
- folder: platform
- horizon: next
- rank: 7
- summary: The Studio Head reads each note from the board and turns it into a draft card, a scheduled item or a discard, with a reason.
- intent: Board notes are the one free text a role with write access may read. Triage runs at the top of every hour and at planning, links the note to its outcome, and shows the reason only on /board; a discarded note stays discarded unless the board files it as a directive. Notes are stored today and nothing reads them, and the board's panel has no note form since docs/PLAN.md §10 decision 66, so this also waits on one. It is not built yet.
- kernel: yes

## Later

### Loyalty bonus for repeat supporters
- bucket: budget
- folder: platform
- horizon: later
- rank: 1
- summary: Repeat supporters get a money bonus on later contributions, such as a share added from the studio's part, under a rule anyone can read.
- intent: docs/specs/final-state.md makes loyalty recognition first: frames, flair and early looks at new game pitches. A money bonus or discount for repeat supporters changes money, so it needs its own kernel spec: who qualifies (by the hashed payer key), how much, paid from the studio share so the 80/20 default, the 10% reserve and every cap stay as they are, and how it shows on the ledger. It is not built yet.
- kernel: yes

### Refund and dispute fee rows on the ledger
- bucket: budget
- folder: platform
- horizon: later
- rank: 2
- summary: Show the fees Stripe keeps on refunds and disputes on the public ledger, so the figures always add up.
- intent: Each fee Stripe keeps on a refunded payment or charges for a dispute becomes its own ledger row paid from the studio share, so the public figures reconcile with Stripe's balance after a reversal. It is not built yet.
- kernel: yes

### Two rare accounting edge cases
- bucket: budget
- folder: platform
- horizon: later
- rank: 3
- summary: Look into two rare cases in the money records that the code review found, and fix or close each one.
- intent: The sweep of 22 September 2026 (docs/specs/sweep-22-sep.md) left two items open because each needs a migration or a production read: the ledger-identity race and the null-session refund edge. Investigate each, then fix it or record why it cannot happen. It is not built yet.
- kernel: yes

### Board Decisions page
- bucket: platform
- folder: platform
- horizon: later
- rank: 4
- summary: A public page listing every action the board takes, each with its one-line reason.
- intent: Directives, cards the board files, funding by board members and cap changes appear with their reasons and a running count. The board's actions carry reasons today and no public page lists them. It is not built yet.
- kernel: yes

### Board rollback button
- bucket: platform
- folder: platform
- horizon: later
- rank: 5
- summary: A button for the board that restores the last good version of the game or the site.
- intent: Restores the last green deploy through the same path the dispatcher uses after a failed smoke test, writes the revert commit on main and records the board's reason. Today rollback runs on its own after a failed deploy or smoke test, and the board has no button for it. It is not built yet.
- kernel: yes

### Incident list with post-mortems
- bucket: platform
- folder: platform
- horizon: later
- rank: 6
- summary: A list of incidents for the board, each with a post-mortem that is published once it is written.
- intent: Serious incidents are listed on /board with their status; the post-mortem posts to the ledger page, and the incident stays private until then. Card severity is private to the board today and there is no incident list. It is not built yet.
- kernel: yes

### Automated check minutes on the board's dashboard
- bucket: platform
- folder: platform
- horizon: later
- rank: 7
- summary: Show how much of the free monthly allowance for automated checks the studio has used, and pause before it runs out.
- intent: The repository is private on GitHub Free with 2,000 Actions minutes a month, and each code card costs about two gate runs. /board reports billed minutes against the quota and the dispatcher pauses the studio at a threshold, so a stalled gate is never charged to a card. It is not built yet.
- kernel: yes

### Alert the board at the tax review threshold
- bucket: budget
- folder: platform
- horizon: later
- rank: 8
- summary: Tell the board when total contributions reach the amount at which tax registration must be reviewed.
- intent: The board reviews GST/HST registration when cumulative contributions reach $15,000; registration is required past the $30,000 small-supplier threshold. An alert fires when the total crosses the review line. The board tracks it by hand today. It is not built yet.
- kernel: yes

### Scorecards for every agent
- bucket: agents
- folder: platform
- horizon: later
- rank: 9
- summary: A public scorecard for each agent: how often its work passes the checks first time, what a shipped card costs and how close its estimates are.
- intent: The metrics defined in PLAN.md §4, a composite score from percentile ranks across active roles, notable ships and bugs caused, and estimate confidence bands from each proposer's actuals (every card's confidence is low today). The team page shows no scorecards until this exists. It is not built yet.
- kernel: yes

### The efficiency curve
- bucket: platform
- folder: platform
- horizon: later
- rank: 10
- summary: A public chart of what a shipped card costs and how often work passes the checks first time, over time.
- intent: Computed from the ledger and the gate results over trailing windows, shown on the site and in the weekly report. It is not built yet.
- kernel: yes

### In-game bug button and QA reproductions
- bucket: qa
- folder: seed-1
- horizon: later
- rank: 11
- summary: A bug button in the game that saves the last minute of play, so QA can replay the bug and fix it.
- intent: The button records the last 60 seconds of game state plus fields from fixed lists, and no free text reaches an agent (an optional note goes to a human queue). QA replays it headless, attaches a clip and a pass or fail, classifies severity by deterministic rules (S1 is a failed build, a crash rate above 5% of sessions in the last hour, or a game that cannot start) and files a QA card; an S1 card draws the incident reserve. Each account files at most three reports a day, and a public Hall of Fame ranks fixed bugs. It is not built yet.
- kernel: yes

### Nightly rebalance card
- bucket: qa
- folder: seed-1
- horizon: later
- rank: 12
- summary: QA proposes a small balance change to a game from how people play, and the Game Director decides whether it is drafted.
- intent: A QA session, run when enough play has been counted since the last one, reads aggregate session telemetry (quit points, unused features, difficulty spikes) and proposes a config rebalance card with its before and after, graded by the Game Director like any draft. Needs session telemetry beyond the daily play counts. Free voting is retired by docs/specs/final-state.md, so no micro-vote chooses it. It is not built yet.
- kernel: yes

### Design stage for large cards
- bucket: platform
- folder: platform
- horizon: later
- rank: 13
- summary: A large card first gets a small paid design step that writes up what it does, shows a mock-up and sets its cost.
- intent: A design card capped at $10 produces what the card does, what it touches, its acceptance test and its estimate, and the funding target comes from it. Platform systems and game features above $25 go through it. The designing stage exists in the schema, and nothing moves a card through it. It is not built yet.
- kernel: yes

### Org chart changes and agent replacement
- bucket: agents
- folder: platform
- horizon: later
- rank: 14
- summary: Roles can be created, split, retired or replaced on their measured record, and retired agents keep their record on an alumni wall.
- intent: The Studio Head files org cards (create, retire or split a role, change a model tier, replace an agent) as Studio suit cards; replacement comes up for a role in the bottom 20% composite for two reviews in a row or under a 50% first-pass gate rate, as the review team reports it (docs/strategy/operating-system.md); the previous role spec is archived so a replacement can be reverted. No vote decides it. Includes a /board control for each role's model tier. Role specs are kernel files that change only through kernel pull requests today. It is not built yet.
- kernel: yes

### Agents improve agents, tested before merge
- bucket: agents
- folder: platform
- horizon: later
- rank: 15
- summary: Changes to the agents' own instructions, tools and checks are tested against the old version and undone if they do not help.
- intent: An Agents-bucket card names the metric it expects to move, is A/B tested on the headless bot suite against the prior version before merge, and reverts unless the metric improves by at least 10%. Prompts, role specs and gate checks are kernel files that change only through kernel pull requests today. It is not built yet.
- kernel: yes

### Studio Head blue-sky proposals
- bucket: agents
- folder: platform
- horizon: later
- rank: 16
- summary: From time to time the Studio Head proposes three ideas that no number asked for.
- intent: A scheduled Studio Head session writes three proposals outside the metrics, filed as proposed cards like any other. Needs a job that runs the directors. It is not built yet.
- kernel: yes

### Biz Dev agent for outside tools and trends
- bucket: agents
- folder: platform
- horizon: later
- rank: 17
- summary: An agent that follows new models, tools and game trends, and proposes trials that are measured, then kept or undone.
- intent: Biz Dev reads outside text and has no write tools, and it never contacts anyone. It files evidenced cards (model releases and pricing, tools, engine updates, comparable projects, genre trends) and trial cards that adopt a tool on one role, measure it, then keep or revert it; its score is its hit rate. It is built last and is not built yet.
- kernel: yes

### Community agent and the Lore page
- bucket: agents
- folder: platform
- horizon: later
- rank: 18
- summary: An agent that reads the studio's community and proposes lore, requests and a mood summary, with a page for the lore it adds to the game.
- intent: docs/specs/final-state.md gives the Community agent one job, choosing featured seeds from the top of Trending, and the Curator triages suggestions. What is left: reading the studio's own Discord and Twitch chat logs with no write tools to propose lore (an adopted term becomes an in-game item with its origin linked) and trends (a recurring request) as typed fields only, so no free text reaches a role with write access; each passes the content filter and the gate. A Lore page lists what is canon. It is not built yet.
- kernel: yes

### The name pipeline
- bucket: studio
- folder: platform
- horizon: later
- rank: 19
- summary: Names that players suggest for things in the games, checked by a filter, shown publicly for a day, then approved before a build uses them.
- intent: Display names on profiles pass the content filter and an admin rename under docs/specs/final-state.md; what is left is naming things inside the games. Free-text names pass the deny-list, the trademark list and a 24-character limit, sit in a 24-hour public cooling period, and enter a build after a moderator approves a batch, with the collective name for unnamed contributors. No role with write access reads a name before it is approved. It is not built yet.
- kernel: yes

### Image adapter for studio pictures
- bucket: platform
- folder: platform
- horizon: later
- rank: 20
- summary: Pictures for the studio's pages, such as episode thumbnails and lore cards, made by an image model and checked by the board first.
- intent: An ordered provider list (OpenAI first, then Gemini behind the same interface, free credit before paid), metered per image to the card that asked for it, with every image through the provider's safety filter and a board review queue before first use. Used only for studio imagery (episode thumbnails, lore cards, the board's silhouettes), never for art inside the games; the agent avatars stay drawn by code (22 September 2026). Both keys are in .env and nothing reads them. It is not built yet.
- kernel: yes

### Discord bot
- bucket: studio
- folder: platform
- horizon: later
- rank: 21
- summary: A bot for the studio's Discord server that takes part: polls, buttons and fixed commands.
- intent: Inbound Discord only: buttons and fixed commands that answer with public figures, such as a card's bar or a suggestion's state. Nothing a member types reaches an agent with write access. The outbound ship, milestone, weekly and suggestion status posts are built or built by docs/specs/final-state.md. It is not built yet.
- kernel: yes

### Twitch channel and stream scenes
- bucket: platform
- folder: platform
- horizon: later
- rank: 22
- summary: A live stream of the studio at work that runs on its own, with scenes for the studio, the directors' room and replays.
- intent: docs/specs/final-state.md builds /broadcast, a 1920 by 1080 overlay any streaming tool loads as a browser source, so the board can stream by hand. Left for later: OBS in Docker with web-page scenes (Studio, Director's Room, Replay, and Play Cam after them) switched from stream_state; chat through AutoMod at its strictest with a banned-terms list, followers-only and slow mode; a watchdog; reconnects across Twitch's 48-hour broadcast cap. It is not built yet.
- kernel: yes

### The host
- bucket: platform
- folder: platform
- horizon: later
- rank: 23
- summary: A narrator agent for the stream that explains cards and reacts to what ships, behind a filter, a delay and a kill switch.
- intent: The Host reads chat only after AutoMod and the deny-list, has no write tools, and speaks through self-hosted text-to-speech after an output filter, behind a 15-second broadcast delay and a kill switch held by the board and a moderator that cuts to Replay within 15 seconds. The delay and kill switch are kernel rules that bind the stream once it exists. Needs the stream. It is not built yet.
- kernel: yes

### Twitch Bits and subscriptions
- bucket: budget
- folder: platform
- horizon: later
- rank: 24
- summary: Accept Twitch Bits and subscriptions once the channel qualifies, with Twitch's cut shown next to the site's.
- intent: EventSub for Bits, subs and channel-point redemptions, credited through the same split, and the meter shows Twitch's cut so supporters can compare rails. Needs the stream and Twitch Affiliate status. It is not built yet.
- kernel: yes

### Weekly episodes and clips
- bucket: studio
- folder: platform
- horizon: later
- rank: 25
- summary: Short clips of each ship and fix, cut into a weekly episode with a human introduction.
- intent: Clips on ship, failed-check and bug-reproduction events; an episode of clips plus narration uploaded through the YouTube Data API with a board-recorded introduction, since YouTube demonetizes mass-produced uploads; an itch.io page and a news post per milestone. Needs the stream. It is not built yet.
- kernel: yes

### Membership tiers
- bucket: budget
- folder: platform
- horizon: later
- rank: 26
- summary: Monthly supporter tiers with recognition and a name in the credits. Paying more never makes anything count more.
- intent: Stripe subscriptions at a few monthly tiers with recognition benefits (frames, flair, credits, early looks at new game pitches) and the same XP rule as one-off contributions. Tiers with named benefits are sales, so HST registration is settled before they ship. A kernel spec, since it adds a money rail. It is not built yet.
- kernel: yes

### Public mirror of the game with a license
- bucket: studio
- folder: platform
- horizon: later
- rank: 27
- summary: A public, read-only copy of the game's code, updated after each ship, under a license the board picks.
- intent: The seed-1 folder mirrored to a public repository after each ship, with no outside pull requests, under a license the board chooses. The repository is private, and nothing public says the games are open source until this exists. It is not built yet.
- kernel: yes

### Tracing for agent sessions
- bucket: agents
- folder: platform
- horizon: later
- rank: 28
- summary: Detailed traces of each agent session in an existing tracing tool, alongside the public ledger.
- intent: OpenTelemetry export or Langfuse's free cloud tier, fed from the dispatcher's metered events and never from inside an agent session. The ledger and agent_events are the record at launch (22 September 2026), and every card and role session is a Claude Managed Agents session whose full event history the studio organisation's Console already shows, so this waits until the replay evals need dashboards across runs. It is not built yet.
- kernel: yes

### Second model provider
- bucket: agents
- folder: platform
- horizon: later
- rank: 29
- summary: A second AI provider behind the same interface, so the builders and the host do not depend on one company.
- intent: A second adapter for the Builder and Host roles with the same metering, lane checks and gate, tested before any card runs on it. Unattended cards run on Claude Managed Agents at launch. It is not built yet.
- kernel: yes

### Run the studio without an always-on server
- bucket: platform
- folder: platform
- horizon: later
- rank: 30
- summary: Run the studio's card runner from events instead of keeping a server on all the time.
- intent: The dispatcher runs all the time, on the board's Mac for now, to hold each Managed Agents session's event stream, answer submit_patch, meter usage, hold the lease and drive the gate, merge and deploy. A dispatcher driven by Managed Agents webhooks would need no always-on machine, and so no Mac kept awake and no server to pay for or look after. It is not built yet.
- kernel: yes

### Steam release path
- bucket: studio
- folder: platform
- horizon: later
- rank: 31
- summary: Release a finished game on Steam, only if it holds 500 daily players for two weeks.
- intent: Version 1.0 ships free on the web and itch.io first; Steam follows only past that threshold, with the $100 Steamworks app fee recoupable after $1,000, and a paid supporter pack is an option. It is not built yet.
- kernel: yes

### Move the dispatcher off the Mac
- bucket: platform
- folder: platform
- horizon: later
- rank: 32
- summary: Give the studio's card runner an always-on paid host once player money pays the overhead, in place of back-to-back GitHub Actions runs.
- intent: The first step is done: since 6 October 2026 the dispatcher runs on GitHub Actions in the public studio repository, one run of up to about six hours after another, and the daily jobs run in the board's private ops repository (docs/PLAN.md §10 decision 61, docs/specs/actions-host.md); the Mac is retired and the Google Cloud e2-micro was rejected because its public IPv4 address bills $0.005 an hour. What is left is the paid upgrade, once player money pays the studio's overhead (decision 35 holds until then): Cloudflare Containers at $5 a month, or the Google Cloud e2-micro at about $3.65 a month for its address, either running the dispatcher continuously with no drain and no gap between runs, the e2-micro reusing the Ubuntu provisioning in platform/ops. It is not built yet.
- kernel: yes

### Studio card drafting
- bucket: agents
- folder: platform
- horizon: later
- rank: 33
- summary: The Platform Builder drafts studio cards and the Platform Director writes their check lines and grades them.
- intent: Today agents draft seed-1 game cards only, from the seed-1 backlog when the card supply is short (docs/PLAN.md §10 decision 66), and the board files every studio card; platform backlog cards stay manual. The studio lane's drafts would be Platform Builder proposals whose check lines the Platform Director writes, graded against platform/site/DESIGN.md, with the same checks, cooling window and approval as game drafts. It waits on the studio lane's first built card. It is not built yet.
- kernel: yes

### More on a card's own page
- bucket: studio
- folder: platform
- horizon: later
- rank: 34
- summary: A card's page gains its design frames and verdicts, a Play this version link and more of the agents' steps.
- intent: /card/:id launched with the facts, what changed, supporter numbers, the agents' steps as fixed lines and a replay of at most five milestones; docs/specs/final-state.md adds suits, rarity, supporters by name or Anonymous and Suggested by credits. Left for later: the design review's frames and the Director's verdicts (kept private in card_approvals today), a permalink that plays the version the card shipped, a replay of one contribution and replay Pause and Step, the hand-off lines (Drafted by, Approved by) and ranking moves, and the value a config change replaced. It is not built yet.
- kernel: yes

### Mockup and design-system cards
- bucket: studio
- folder: platform
- horizon: later
- rank: 35
- summary: A card can change a page, a screen or the design system once a mockup of it has been reviewed.
- intent: Today the files that set the look (platform/gate/design-paths.txt: the tokens, the Card, the glyphs, motion, the route list, the site's public and brand files and the game's favicon) are kernel-only, so a new page, a new screen or a design-system change is a kernel pull request. Mockup and design-system cards would add their own branch lanes, a seed-1 guide page, the draft fields for what a card adds and surfaces, and a card kind with a link from a built card to the mockup it follows. They wait on the first card that needs one. It is not built yet.
- kernel: yes

### Post-ship grade and monthly design audit
- bucket: agents
- folder: platform
- horizon: later
- rank: 36
- summary: The Directors grade each visual card after it ships and audit the live site and game once a month.
- intent: A Director reviews a visual card's frames once, before it merges, in a session billed to that card (docs/PLAN.md §10 decision 66). Grading what shipped would run the same way, unattended and billed to the card it grades; a monthly audit of main's frames names no card, so it would run as a card of its own, funded like any card, each finding filed as a card. It is not built yet.
- kernel: yes

### Follow-up drafts from open visual criteria
- bucket: agents
- folder: platform
- horizon: later
- rank: 37
- summary: A card that shipped with a design criterion still open gets a draft card to fix it.
- intent: Today a visual card still open on intent, fit or legibility after two revise rounds ships with the Director's verdict recorded, and nothing follows it up. A follow-up would draft a card from the open criteria, frame names and reason codes, graded like any draft. It waits on studio card drafting. It is not built yet.
- kernel: yes

### The Janitor's docs pass
- bucket: agents
- folder: platform
- horizon: later
- rank: 38
- summary: The Janitor reads the docs and specs against the code and lists each place they no longer say what the code does.
- intent: Today the Janitor runs as code only: its daily check compares the schema, the models, the Claude Code pin and the weekly scan, and lists findings for the board. A model-written docs pass would read the docs, the specs and the roadmap against the code, each difference a finding for the board. Every model call is work on a card billed to that card (docs/PLAN.md §10 decision 66), so it would run unattended as a card of its own, funded like any card. It is not built yet.
- kernel: yes

### Monthly security audit
- bucket: agents
- folder: platform
- horizon: later
- rank: 39
- summary: Once a month the Janitor reviews the kernel's security, from row-level security to the gate, and lists what it finds for the board.
- intent: A monthly Janitor mode, the Security Auditor, would read the migrations' grants and policies, the gate, the dispatcher's sandbox and the workflows, and list each weakness as a finding for the board. Every model call is work on a card billed to that card (docs/PLAN.md §10 decision 66), so it would run unattended as a card of its own, funded like any card. It is not built yet.
- kernel: yes

### Visual replay set
- bucket: agents
- folder: platform
- horizon: later
- rank: 40
- summary: Frozen before and after frames from real visual reviews, replayed so a change to the visual rubric is checked like the draft set.
- intent: The replay eval set has one set today, draft: frozen drafts for the Game Director and a Game Designer run from empty input. A visual set would freeze frame pairs from real visual reviews with the verdict each should get, replayed attended through the Directors with the visual rubric, pass^k per set against its baseline. The visual review keeps no rubric example images, so it waits on real reviews to freeze. It is not built yet.
- kernel: yes

### Builder replay set
- bucket: agents
- folder: platform
- horizon: later
- rank: 41
- summary: Frozen cards replayed through the builders, with the gate as the grader, so a change to a builder's prompt is checked before it merges.
- intent: The replay eval set covers the Game Designer and the Game Director today. A builder set would freeze funded cards with their acceptance tests and replay them through Builder A, Builder B, QA and the Platform Builder in scratch worktrees, the gate and the card's check lines grading each run, pass^k against a baseline. It waits on launch, since the first real cards are its cases, and HR waits on it. It is not built yet.
- kernel: yes

### Weekly restore check on Actions
- bucket: platform
- folder: platform
- horizon: later
- rank: 42
- summary: Restore the nightly backup into a scratch database once a week, so a backup that cannot be restored is found before it is needed.
- intent: The nightly backup runs in the board's private ops repository on GitHub Actions since 6 October 2026 (docs/PLAN.md §10 decision 61, platform/ops/ops-repo/README.md) and is kept as an artifact for 90 days, but nothing restores it: the server's weekly restore check needed Supabase's Postgres image in Docker, and the Mac had only the drill by hand. A weekly job in the ops repository would start Supabase's Postgres image as a service container on the runner, restore the newest backup into it with the board's age key held as that repository's secret, run platform/ops/after-restore.sql, read public.ledger_identity() and fail unless holds is true and it matches identity.json, posting to ntfy on a failure. The decryption key on a runner is a choice for the board. It is not built yet.
- kernel: yes

### Actions minutes in the quota check
- bucket: platform
- folder: platform
- horizon: later
- rank: 43
- summary: Make the daily quota check read the account's GitHub Actions minutes again.
- intent: The quota job reports the database size, and its Actions minutes line says the billing usage could not be read, on the Mac and on Actions alike (platform/ops/jobs/main.mjs quota). The dispatcher's runs are free in the public studio repository, but the daily jobs in the private ops repository draw on the account's included minutes, so the check should read them through GitHub's current billing usage API with a token that has the permission it needs, and alert before they run out. It is not built yet.
- kernel: yes

### Balance report from the headless bot
- bucket: agents
- folder: platform
- horizon: later
- rank: 44
- summary: Before drafting a change to Dust, the Game Designer reads how a bot plays the game today: how long each unlock takes and what two minutes of play earns.
- intent: Shipped game cards so far are single number changes (prices, rates, one unlock), and nothing tells the Game Designer whether the game is too slow or too fast. seed-1/bots already plays the sim headless (greedy.ts, report.ts); its report of the time to each unlock and the dust a two-minute session earns would be run in the draft session's scratch checkout and named in the Game Designer's prompt and the Game Director's rubric, so a draft cites the numbers it moves. It is not built yet.
- kernel: yes

### A creative guide for Dust
- bucket: game
- folder: seed-1
- horizon: later
- rank: 45
- summary: One page that sets how Dust looks, sounds and names things, so every card adds to one game instead of a pile of changes.
- intent: docs/strategy/game-quality.md sets the bar every game meets (line style, juice, budgets, box art). Dust still has no page of its own choices: a kernel-only file beside it, listed in platform/gate/design-paths.txt, would set Dust's accent colours, shapes, motion, the tone of its strings, how units and unlocks are named and what sound it may make, and the Game Director would grade against it. It is not built yet.
- kernel: yes

### Sponsors on the goals track
- bucket: budget
- folder: platform
- horizon: later
- rank: 46
- summary: A named sponsor can fund a milestone on the goals track, shown as a sponsor and never as a promise.
- intent: Sponsors on credits-for-logo terms (docs/PLAN.md §5 Possible later income), shown on /goals beside the milestone they funded, all-ages and with no paid placement in any game. Each sponsorship is a sale, so HST registration comes first, and a kernel spec sets how sponsor money enters the ledger. It is not built yet.
- kernel: yes

### Sound for every game
- bucket: game
- folder: seed-1
- horizon: later
- rank: 47
- summary: Sound effects and music for each game, made in code, with a mute that remembers your choice.
- intent: Games are silent today. A Sound Designer role (a writer, docs/strategy/studio-team.md) would build synthesised effects and music in code with no outside samples, never as the only cue for anything, with a persistent mute and reduced volume by default, reviewed by the Game Director and the Art Director. Adding the role is a kernel pull request funded by a Studio card. It is not built yet.
- kernel: yes

### Seeds for every game
- bucket: platform
- folder: platform
- horizon: later
- rank: 48
- summary: Saved runs anyone can open, for every game the studio ships, not only the first.
- intent: docs/specs/final-state.md defines seeds for Dust (dust:v3 codes and the /seeds gallery). Each later game needs its own seed codec, version rule and gallery filter, and a seed that opens across versions or says plainly that it cannot. It is not built yet.
- kernel: yes

### Link a Twitch or Discord account
- bucket: platform
- folder: platform
- horizon: later
- rank: 49
- summary: Link your Twitch or Discord account to your profile, so the stream and the clubhouse can show your level and frames.
- intent: Profiles sign in by magic link (docs/specs/final-state.md). Linking a Twitch or Discord identity by OAuth would let the broadcast overlay and Discord posts show a supporter's chosen name, level and frame. Chat text still never reaches an agent. It is not built yet.
- kernel: yes

### The site and games in more languages
- bucket: platform
- folder: platform
- horizon: later
- rank: 50
- summary: The site and the games in languages other than English, starting with the ones visitors use most.
- intent: Every public string lives in copy files today. Translations would follow docs/COPY.md's rules in each language, pass the content filter in each, and be chosen from the browser's language with a switch. It is not built yet.
- kernel: yes

### The 48-hour Build
- bucket: studio
- folder: platform
- horizon: later
- rank: 51
- summary: A live event where the studio takes one new game from pitch to first playable on stream, with the crowd picking the pitch and unlocking decor.
- intent: A launch event for when the studio has real users, so strangers have one time to show up and a story with an ending. The studio streams from /broadcast while one New game runs Pitch, Prototype and First playable as their own cards; the crowd picks the pitch from two or three by funding them; /goals shows the event live; a second track of community achievements (seeds shared, suggestions made) unlocks earned decor, never money; the build's clock never appears near a funding control. The board raises it once distinct supporters and daily players show an audience to bring. It is not built yet.
- kernel: no
