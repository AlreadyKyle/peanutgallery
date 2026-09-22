# Peanut Gallery: the constitution

This file says what the studio is and the rules it runs by. It holds no schedule: work is ordered, never dated, and no date or deadline appears here unless the board set it (18 September 2026). `docs/ROADMAP.md` is the launch checklist. `docs/BACKLOG.md` lists every mechanic that is planned and not built; the board files those entries as cards, and the site lists them on /roadmap. A spec under `docs/specs/` is the contract for one change. A mechanic that is not built gets one line here, in §4 Not built yet, pointing at its backlog entry, and is not described as if it exists.

Rewritten 22 September 2026 from the kick-off plan (version 3.4, at commit ed29674), which it replaces. The section numbers, the Kernel and The Board headings and the numbered decisions in §10 are kept, so a citation such as "PLAN.md §4 The Board" or "§10 default 20" in a spec, a migration or a code comment lands on the same subject; specs and migrations dated before 22 September 2026 quote the kick-off plan's wording. The working name Backseat survives in the package names (`@backseat/*`).

## 1. Decision

The studio goes live when every criterion in `docs/ROADMAP.md` holds and the board presses Go live at /board. There is no launch date. Everything outside that checklist is in `docs/BACKLOG.md` and reaches the studio as cards after Go live, built through the studio's own system (§10 decision 24).

## 2. Concept

A public game studio run by AI agents, directed by its audience and funded by the hour. Agents build free, browser-playable games. Supporters fund the cards they want built: a card is one small change with a funding bar, and when its bar is full the agents build it, automated checks test it, and it goes live. The studio spends only what has been funded, shows the cost of all agent work paid for with contributions on a public ledger, and lets each supporter set at checkout how much of their contribution runs agents and how much pays the studio. Work billed to the founder before the cutover is tracked privately (§4 The Board, §10 default 7). Star Citizen has raised $1B over 14 years without a release; here every dollar is visible as work.

A continuous stream of the studio at work, with a host, is part of the concept and is planned, not built: the launch is site-first (§10 default 15), and the stream is in §4 Not built yet.

Prior art. Multiverse Studios runs AI agents as a dev team on nine MIT-licensed games with a live view of the agents; it has no voting, no funding-throttled throughput, no seasons, and no show. Neuro-sama was the most-subscribed active channel on Twitch in January 2026. Twitch Plays Pokémon drew 1.16 million participants in 2014. Polsia runs whole companies on agents that work while the owner sleeps and re-engage the owner with a daily report. This plan combines the four and adds the funding meter.

Pitch line: "Watch AI agents build a game studio and free games. Fund the card you want built next." (22 September 2026: funding a card is the choice, §10 decision 21.)

## 3. Scope and the team

One seed: Dust, an idle/incremental game in `seed-1/`. In that genre a proposal is a number, a rule, or a new unit, which is the cheapest thing to change in minutes. The studio is named Peanut Gallery (§10 default 2).

Nine roles, each a role spec in `platform/agents/` (JSON plus a prompt): Studio Head (the roadmap, the numbers and the org chart; it proposes and does not decide), Game Director (the pillars), Builder A and Builder B (Game and QA cards in `seed-1/`), Platform Builder (studio cards in `platform/site/`), QA (bug reproductions and fixes), Host (the stream's narrator), Scout (tools and trends from outside the studio) and Community (the studio's own community). The Host, the Scout and the Community agent read outside text and have no write tools.

What runs at launch. Four roles run cards: Builder A, Builder B, QA and the Platform Builder, and the Platform Builder has no card until the studio code lane opens (§4 Work). The Studio Head and the Game Director have role specs and write access, and no job runs them yet: card drafting, note triage and the Monday report are backlog, so the directors' model (§10 decision 22) has no effect until one of those ships. The Host, the Scout and the Community agent are not running yet. The /team page shows which roles run from those facts.

The team, on screen. Every agent is an alien: a small, strange, friendly creature, one plain line in its role spec's `species_note`. The avatars are drawn in code as SVG from one style (§10 decision 27). The /team page shows each role's name, title, "AI agent", what it does, whether it can change the game or the site, its model, its hire date, live cards shipped and studio spend. Every card carries "AI agent" in plain text. Names equal titles until the roster is named through the name pipeline. Rituals map to real events only: no daily standups, no scripted conflict, no vacations, no equity, no backstories, no claimed experience.

## 4. Mechanics and kernel

### Cards

A card is one unit of work. It carries a title, a public summary (one line), the agents' brief (the intent), a deterministic acceptance test with `check:` lines, a lane, a folder, an executor role, an estimate in dollars, a funding target, a bucket, a source (board, community, agent), a shape, a stage, a horizon and a rank. The acceptance test's machine line is `check: config <file> <path> == <json>`; the dispatcher evaluates it false on `main` before the session and true after it, and the smoke test reads the same value from the served file.

Stages: proposed → designing → voted → funded → building → gated → live, or rejected with the failing check attached, or paused. `voted` is the stage name for a card open for funding; nobody votes at launch. A session stops when its cost reaches the card's ceiling, the lower of 150% of the estimate and the per-card maximum; the card then pauses for the board, which may resume it with a new estimate no lower than its actual (`resume_card`) or cancel it with a reason (`cancel_card`). A cancel works only on a card that is proposed, designing, open, funded or paused, never on one that is building, gated or live; money on a cancelled card funds later cards. Actual cost is written back to the card.

Horizons: now, next and later. Only a card on now can take money or run. Next and later are the backlog: planned, not built, not open for funding, and listed on /roadmap. The board moves cards between horizons and sets their rank (`set_card_horizon`, second factor, reason recorded). A card that holds money cannot leave now.

### Definition of ready

A card may move to now only with a title, a summary, an intent, an acceptance test with `check:` lines, a lane, a folder, an executor and a funding target. The executor must be an active role. `set_card_horizon` refuses a card that falls short (22 September 2026).

### Who files cards

At launch the board files every card, at /board or through reviewed scripts, and supporters choose among the open cards by funding them. The founding intent stands: the board steps back from routine Game cards once agents and the audience propose them, through card drafting and free voting (§4 Not built yet).

### Funding a card

A card open for funding has a target and a bar. A contribution toward it credits the bar with the agents' net amount (after Stripe's fee, the 10% reserve, the supporter's studio share and the incident carve-out), so a full bar means the pool holds the card's cost, and the card moves to funded. Money beyond a card's cost, and money given with no card, funds later cards. Contribute opens a chooser with "Pick for me" first. A card's funding target is not bounded by the per-card maximum, which limits only what agents may spend on one card (§10 decision 28).

### Work

What a card may change depends on what kind of work it is (22 September 2026).

- **Game work** ("Dust", folder `seed-1`): changes to the game.
- **Studio work** ("The studio", folder `platform`): changes to the public site's pages, copy and presentation that the Platform Builder can make in `platform/site/` outside the kernel paths. The studio code lane is closed at launch: the board's dashboard shares the site's origin, so no card-built code may ship beside it. The dispatcher refuses a platform code-lane card, and `set_card_horizon` and `file_card` refuse to put one on now. Studio work opens when the board has its own site (§4 Not built yet). The studio category is hidden on the site while it has no cards.
- **Board work**: how the studio runs, meaning the rules, the money, the card system, the dispatcher, the gate, the agents and their prompts. These are kernel changes, made only by the board through reviewed pull requests, never by a funded card. An agent may describe one as a proposal for the board.
- **Next game**: cards for the next seed. The category shows only once such cards exist.

Buckets (game, platform, qa, studio, budget, agents) stay an internal tag on each card; the public category comes from the folder.

### Lanes

Config-lane cards touch data, not code: tuning values, names, palettes, copy, unlock order, spawn tables (files under `seed-1/config/` and `seed-1/content/`). They run the scans, the headless bot and the build, and ship within minutes. Code-lane cards touch anything else outside the kernel paths and run the full gate. A card that needs a new function is code lane.

### Card shapes

At launch a card is either open for funding against a bar or a board directive. The schema also knows one-off and standing shapes; standing bars and the design stage for large cards are in §4 Not built yet.

### Incident reserve

5% of every contribution's Agents share goes to the incident reserve until it holds $500, with overflow returning to the pool; its balance is on the meter. A card marked S1 may draw on it in addition to the pool. Classifying severity by deterministic rules is in §4 Not built yet; until then the board sets a card's severity.

### Metrics

Each role spec names two or three scored metrics. First-pass gate rate: cards passing the gate on first run divided by cards attempted, trailing seven days. Cost per shipped card: ledger dollars divided by shipped cards, trailing seven days. Estimate accuracy: median of |actual − estimate| / estimate, trailing 20 cards. Bug reopen rate: QA cards reopened within seven days divided by QA cards shipped. Roles are data: a role spec holds purpose, prompt, tools, model, budget share, voice and its metrics. Publishing the metrics as scorecards is in §4 Not built yet.

### Rating

The studio and everything it produces is all-ages. Games meet an ESRB E / PEGI 3 bar: no sexual content, nudity or suggestive themes; no realistic blood or gore; no drugs, alcohol or tobacco; no profanity or slurs in any string. The gate runs a deterministic deny-list (profanity, slurs, sexual and drug vocabulary, coded and leetspeak variants, maintained in `platform/gate/denylist/`) over every string, asset filename and commit message; a hit fails the gate with the term shown. Any generated image passes the provider's safety filter and a human review before first use. The Game Director's pillars include the rating. Rating labels appear on the site and in the game. Any incident that reaches the public triggers a post-mortem on the ledger page and a kernel patch before the affected feature resumes; once the stream exists, the kill switch comes first.

### Art policy

In-game art is procedural or vector, generated by code, never by an image model. The agent avatars are drawn by code too, as SVG (§10 decision 27). The site says both on one line. Generated imagery may be used only for the studio itself (episode thumbnails, lore cards, the board's silhouettes), after a board review, once the image adapter exists; the site will say so on the same line when it does.

### Kernel

The files that enforce the kernel are listed in `platform/gate/kernel-paths.txt`; no agent may change them in any lane (§10 default 14).

Not editable by any card, vote, regime or org change, at any tier, and the site says so: the ledger; spend caps; the default 80/20 split and the 10% reserve (each supporter sets their own split at checkout; the default is not votable); the incident reserve rule; the gate; rollback; the content filter, the all-ages rating and the art policy; the broadcast delay and kill switch; and the read/write separation: no agent with write access to a build, a card or the org chart reads free text from the public. The Host, the Community agent and the Scout read outside text and have no write tools. The single exception is board notes: free text from the board's authenticated accounts, read by the Studio Head.

The broadcast delay and kill switch bind the stream and the host from the day they exist; nothing broadcasts today.

### The Board

The board is Kyle and whoever joins him. It acts through a private dashboard at `/board`, phone-friendly, never the command line, and unlisted on the public site.

Directives are forced, immediate changes: a card in stage funded with priority 0, still passing the gate, unable to breach the kernel. Directives are for a pillar being violated, a live problem, or a brand call; a Game-bucket directive is for a breach, not routine feature choice. Every directive carries a one-line public reason. Every board action is recorded with its reason.

Notes are advisory free text from a board member to the Studio Head. They are private and stored; nothing triages them yet.

Private to the board: notes, the founder's cash, hours and tokens (tracked, never published), card severity and priority, the incident list before its post-mortem, and spend caps. Public: directives and their reasons, the pool figures, the studio-billed and overhead ledger rows, each role's model on /team (§10 decision 26), and everything the system does on its own.

Controls at /board: pause and resume; the agent mode; Go live; file a directive, a card (with its horizon) or a note; horizon, rank, cancel and resume on each card; the spend caps, the monthly cap and the studio-wide daily limit on immediate credit (`set_caps`); and recording each Console credit purchase (`record_credit_purchase`). Access: a Supabase Auth magic link restricted to the board's and the moderator's emails; every state-changing board action needs the TOTP second factor, except the moderator's pause and the board heartbeat (§10 default 19). A moderator account holds pause rights only, and the kill switch once the stream exists.

### Not built yet

Each line is one mechanic from the kick-off plan or a later decision, with its entry in `docs/BACKLOG.md`. None of them exists, and nothing public describes them as existing.

- [Voter identity for free votes](BACKLOG.md#voter-identity-for-free-votes): one account one vote, with a minimum account age.
- [Free voting on open cards](BACKLOG.md#free-voting-on-open-cards): free votes beside funding, with tiers, quorums and micro-votes.
- [Studio Head drafts cards from the roadmap](BACKLOG.md#studio-head-drafts-cards-from-the-roadmap): agent card proposals.
- [Studio Head triages board notes](BACKLOG.md#studio-head-triages-board-notes): each note becomes a card, a scheduled item or a discard.
- [The Monday report](BACKLOG.md#the-monday-report): the Studio Head's regular public report.
- [Board on its own site](BACKLOG.md#board-on-its-own-site): opens studio work.
- [Refund and dispute fee rows on the ledger](BACKLOG.md#refund-and-dispute-fee-rows-on-the-ledger): Stripe's fees on reversals as their own rows.
- [Handling a dispute the studio wins](BACKLOG.md#handling-a-dispute-the-studio-wins): re-credit a won dispute.
- [Two rare accounting edge cases](BACKLOG.md#two-rare-accounting-edge-cases): the two items the sweep left open.
- [Board Decisions page](BACKLOG.md#board-decisions-page): every board action in public.
- [Split aggregate on the meter](BACKLOG.md#split-aggregate-on-the-meter): the split supporters choose, beside the default.
- [Board rollback button](BACKLOG.md#board-rollback-button): a manual restore of the last green deploy.
- [Incident list with post-mortems](BACKLOG.md#incident-list-with-post-mortems): incidents on /board, post-mortems in public.
- [Automated check minutes on the board's dashboard](BACKLOG.md#automated-check-minutes-on-the-boards-dashboard): the Actions quota before it runs out.
- [Alert the board at the tax review threshold](BACKLOG.md#alert-the-board-at-the-tax-review-threshold): the HST review line.
- [Scorecards for every agent](BACKLOG.md#scorecards-for-every-agent): the metrics above, published, with estimate confidence bands.
- [The efficiency curve](BACKLOG.md#the-efficiency-curve): cost per shipped card and first-pass gate rate over time.
- [In-game bug button and QA reproductions](BACKLOG.md#in-game-bug-button-and-qa-reproductions): the bug button, S1 classification, the Hall of Fame.
- [Nightly rebalance card](BACKLOG.md#nightly-rebalance-card): QA's balance proposal from telemetry.
- [Personal decisions for contributors](BACKLOG.md#personal-decisions-for-contributors): the paid tier of decisions.
- [Buckets, weekly allocation and the QA slider](BACKLOG.md#buckets-weekly-allocation-and-the-qa-slider): the community splits the pool.
- [Design stage for large cards](BACKLOG.md#design-stage-for-large-cards): a design card before a large goal.
- [Standing costs and sponsor a role](BACKLOG.md#standing-costs-and-sponsor-a-role): monthly bars.
- [Vetoes for the two directors](BACKLOG.md#vetoes-for-the-two-directors): one public veto each, overturnable.
- [Org chart changes and replacement votes](BACKLOG.md#org-chart-changes-and-replacement-votes): org cards, replacement, the alumni wall and model tiers per role.
- [Agents improve agents, tested before merge](BACKLOG.md#agents-improve-agents-tested-before-merge): A/B tests on the agents' own prompts and checks.
- [Studio Head blue-sky proposals](BACKLOG.md#studio-head-blue-sky-proposals): three proposals no metric asked for.
- [Scout agent for outside tools and trends](BACKLOG.md#scout-agent-for-outside-tools-and-trends): the Scout and its trial cards.
- [Community agent and the Lore page](BACKLOG.md#community-agent-and-the-lore-page): lore, trend and sentiment cards.
- [The name pipeline](BACKLOG.md#the-name-pipeline): viewer-supplied names, the collective name and display names.
- [Vote weight regimes](BACKLOG.md#vote-weight-regimes): democracy, funded, play, tenure and chaos.
- [Seasons](BACKLOG.md#seasons): freeze, finale, version 1.0, credits and the public review.
- [Next game chosen by a concept bracket](BACKLOG.md#next-game-chosen-by-a-concept-bracket): the next seed.
- [News section on the site](BACKLOG.md#news-section-on-the-site): announcements and milestones.
- [Image adapter for studio pictures](BACKLOG.md#image-adapter-for-studio-pictures): studio imagery only, behind a board review.
- [Discord bot](BACKLOG.md#discord-bot): ships and the ledger posted to Discord.
- [Twitch channel and stream scenes](BACKLOG.md#twitch-channel-and-stream-scenes): OBS, Dev Cam, Director's Room, Replay and Play Cam.
- [The host](BACKLOG.md#the-host): the narrator, its filter, text-to-speech, the delay and the kill switch.
- [Twitch Bits and subscriptions](BACKLOG.md#twitch-bits-and-subscriptions): the Twitch rail.
- [Weekly episodes and clips](BACKLOG.md#weekly-episodes-and-clips): auto-clips, episodes on YouTube, itch.io.
- [Membership tiers](BACKLOG.md#membership-tiers): Seed, Builder and Patron on Stripe.
- [Public mirror of the game with a license](BACKLOG.md#public-mirror-of-the-game-with-a-license): the read-only public `seed-1/` mirror.
- [Tracing for agent sessions](BACKLOG.md#tracing-for-agent-sessions): OpenTelemetry or Langfuse.
- [Second model provider](BACKLOG.md#second-model-provider): a second adapter for the Builder and Host roles.
- [Run the studio without an always-on server](BACKLOG.md#run-the-studio-without-an-always-on-server): a dispatcher driven by session webhooks.
- [Steam release path](BACKLOG.md#steam-release-path): only past 500 daily players.

## 5. Business model

### Rails

Stripe Payment Links: a one-off contribution link with a custom dropdown for the split, so the choice arrives in the webhook with no custom checkout. The webhook accepts eleven values, from 100/0 to 0/100 Agents/Studio in steps of 10, with 80/20 the default (`SPLIT_MAP` in `platform/supabase/functions/_shared/split.ts`). Stripe fees run about 2.9% plus 30 cents; disputes go through Stripe's flow and the reserve absorbs them. Membership tiers and Twitch Bits are in §4 Not built yet.

Contributions credit the meter immediately up to $50 of agent credit (the agents' share after the incident carve-out) per payer per New York day; the rest of that credit is held and credits after 14 days, released hourly, while the 10% reserve and the incident reserve are credited at once (`docs/specs/refunds-and-holds.md`). The payer is identified by a hash of the Stripe card fingerprint, falling back to a hash of the email, and the Privacy page says so (22 September 2026). A studio-wide daily limit on immediate credit is a second backstop: across all payers, credit above it is held the same way. It defaults to $500 and the board sets it at /board (22 September 2026).

### The split

Every contribution is divided. The chargeback reserve takes 10% off the top; it is mechanical and not adjustable. The remainder goes to Agents (the compute pool) and Studio by the supporter's chosen split, default 80/20. Of the Agents share, 5% goes to the incident reserve until it holds $500. Studio income is therefore a distribution set by supporters; Humble Bundle's experience is that most supporters leave defaults, so the default carries the economics and the choice carries the trust. A 50/50 headline is not used anywhere: Twitch's move to 70/30 was a response to years of resentment of the 50/50 split, and 50/50 says half the money builds nothing.

The studio share pays Stripe's fees on the studio's own purchases, currency conversion, HST and overhead: the startup probe's model usage and session time, which the ledger records publicly as overhead and which never touches the pool (22 September 2026).

### Refunds and disputes

A refund or a dispute reverses the contribution's split and any held credit (`docs/specs/refunds-and-holds.md`). A refund of money already spent takes the shortfall from money not credited to any card's bar first, and alerts the board (22 September 2026).

### Costs

Everything the studio runs on is free, and the only money it spends is what players put in (§10 decision 35). The standing cost is agent compute. The configured agent rate starts at $5 an hour (`AGENT_HOURLY_RATE_USD`) and the measured figure replaces it; for scale, the first three test runs and the three board directives cost $0.8242 across 65 ledger rows (`docs/specs/week1-runs.md`). Agents run only when funded, so spend is a ceiling the audience sets.

### Compute account and mode

Before the cutover the fleet runs attended: sessions run through Claude Code on the founder's subscription, sandboxed to the card's worktree, only while a board member is signed in at /board, and are billed to the founder, never to the pool. After the cutover card sessions run unattended as Claude Managed Agents sessions on the studio's own Anthropic organization, a separate pay-as-you-go organization with prepaid Console credit, auto-reload off and a $500 monthly limit raised by hand as the meter grows (§10 decision 25). Console credit is bought only with contributions Stripe has paid out, never with the founder's money (§10 decision 23), and the throttle never lets unattended sessions spend more than the credit bought and recorded. The founder's subscription is never used unattended.

### Possible later income

Ideas the board has not taken up, recorded so they are not lost: the card and gate pipeline as a service for Early Access studios; sponsors on credits-for-logo terms; a paid supporter pack on Steam once the Steam release path exists.

### Canada admin

Viewer payments to a for-profit are business income and consideration for a supply; GST/HST (13% Ontario) applies past the $30k small-supplier threshold. Copy says "contributions," never "donations." The board reviews HST registration when cumulative contributions reach $15k, and registers before tiers with named benefits ship, since those are sales (`docs/BOARD-SETUP.md`). The platform repository stays private; the games get a license only with the public seed-1 mirror, and nothing public says open source before then.

## 6. Architecture

### Build 1

Build 1 is what the studio runs on at Go live, and `docs/ROADMAP.md` is its checklist: the public site (landing, contribute, ledger, how it works, team, roadmap, the legal pages, and /board), the Stripe webhook and the money logic in Postgres, the dispatcher, the gate, the role specs and Dust. The site shows what is building, the cards open for funding (filtered by the game and the studio, and the next game once it has cards), what shipped and the ledger (`docs/specs/site-layout.md`). Contributions made before Go live are credited like any other; no badge or queue position is promised.

### The pipeline

A Node dispatcher runs on a one-minute tick and ticks only while it holds the dispatcher lease, so two dispatchers never run cards at once. It reads Supabase for the highest-priority runnable card: stage funded, horizon now, not vetoed, within the throttle. In attended mode it runs Claude Code in a git worktree outside the repository. In unattended mode it creates a Claude Managed Agents session with the repository mounted read-only at the card's base sha; the agent hands back its work as a patch file through the `submit_patch` tool, and the dispatcher applies it in its own worktree. Either way the dispatcher checks that the change stays inside the card's lane and off every kernel path, checks the card's `check:` lines, commits, pushes `card/<id>-<lane>` and opens a pull request. GitHub Actions runs the gate. On a green `gate` check at the pull request's exact head sha, the dispatcher re-reads the pause and the card, and squash-merges with that sha only while `main` still points at the card's base; if `main` moved, the card goes back to be gated again. Netlify deploys. The production smoke test runs no card code: it checks the served build sha, the served config checks, that each served `/config/*.json` matches the merge commit byte for byte, and that the gate is green at the merge sha (§10 decision 34). On a pass the card goes live; on a failure the previous deploy is restored from `last_green`, a revert commit lands on `main`, and the card is rejected with the failing check. A failed revert pauses the studio and alerts the board. `main` has no branch protection, which the private repository's plan does not offer; the exact-sha merge is the protection. No agent-written code runs on the VPS.

### Budget throttle

Every agent turn writes usage at list price to `ledger`. Available money is the pool balance minus the studio reserve (zero at launch) minus what other cards hold: a card waiting, open or paused holds its funded money not yet spent, and a building card holds what is left of its session budget. A card starts only if available covers its ceiling. Turn cap 60 per session. Concurrency is one session when available covers the smallest runnable ceiling, and two when the balance is at least twice the hourly rate. The daily cap is measured against the day's starting balance. In unattended mode a session's budget is also bounded by the Console credit left, the monthly cap and what remains of the daily cap, and a credit or spend-limit error pauses the studio with an alert instead of failing the card. Caps live in `studio_state` and are edited from /board; the environment values are the initial seeds. Zero balance: the agents idle.

### Runtime and layout

Game runtime: Phaser 3 with TypeScript and Vite. Static build to Netlify; `Phaser.HEADLESS` in Node for playtest bots. Each seed keeps a deterministic, seeded simulation core (`seed-1/sim/`) separate from rendering so bots run at 1000× realtime.

Execution: the executor and target folder are columns on the card. Game and QA cards run on Builder A or Builder B, QA reproductions on QA, studio cards on the Platform Builder. One repository with two top-level folders: `platform/` (the site including `/board`, the dispatcher, the gate package, Supabase, the role specs and ops) and `seed-1/` (the game, `config/`, `content/`, `sim/`, CLAUDE.md). `seed-1/` never imports from `platform/`, so a seed can be lifted into its own repository. The dispatcher runs under systemd on an Oracle Cloud Always Free instance after the cutover (§10 default 17), and on the founder's Mac before it.

Role models resolve from environment tokens (`MODEL_DIRECTOR`, `MODEL_BUILDER`, `MODEL_HOST`) when a session starts, so a model change takes effect without a re-seed (22 September 2026).

### Technical risks

Runaway spend: the per-card ceiling, the ledger, the daily cap, the monthly cap, the Console credit bound and the Console limit. Agents breaking the thing running them: the kernel paths no card can change, and the studio code lane closed until the board has its own site. Silent failure: healthchecks.io and ntfy alerts, and the pause on a failed revert. Oracle reclaiming an idle Always Free instance: the healthchecks.io alert and a restart (`docs/BOARD-SETUP.md`). Running out of free Actions minutes, which stops the gate (`docs/ROADMAP.md` standing facts). Agents shipping systems rather than fun: the idle genre and the bot's progression invariants in the gate.

## 7. Launch

### Order

Contributions are open now, with the studio paused until the first Stripe payout buys Console credit and the dispatcher is cut over; the site shows a notice while the studio is paused. The founding intent is that the board posts from the day the page is live and contributions before launch pre-load the pool. Whether that means a quiet share before Go live (recommended) or announcing first is the board's call (`docs/BOARD-SETUP.md`). Then: the first payout, Console credit bought from it, the cutover, a moderator, the launch clip of a real card going from open to shipped, and Go live at /board. Posts go out after the clip exists, in the order under Channels (`docs/specs/announcement.md`).

### Channels

Reddit first (Nothing, Forever went from four concurrent viewers to 15,097 within days of Reddit promotion): r/ClaudeAI, r/artificial, r/incremental_games; not r/gamedev, which is hostile to AI. Hacker News second (Claude Plays Pokémon reached the front page). X third. Press fourth: TechCrunch (Amanda Silberling covered Nothing, Forever), Tubefilter (Sam Gutelle covered Claude Plays Pokémon), Dexerto's Twitch desk, Game Developer, Ars Technica.

### Content after launch

Episodes, clips, a Discord bot and a news section are in §4 Not built yet. YouTube's 2025 inauthentic-content rule demonetizes mass-produced uploads; a human intro per episode keeps it compliant, and YouTube ad revenue is not assumed.

### Backlash

GDC's 2026 survey of 2,300+ developers found 52% believe generative AI is harming the industry (30% in 2025, 18% in 2024), highest in art (64%) and design/narrative (63%). Three choices answer most of it: no generated art inside the games (procedural and vector only, stated on the site), a public ledger with the split chosen by supporters, and a named human board. Response line: "The game art is procedural, the ledger is public, and a human board directs it. If a specific choice is wrong, say so, and it can become a card." The open-source clause of the kick-off plan's line ("Everything here is open source") may be added only once the public seed-1 mirror exists with a license (amended 22 September 2026, following §10 decision 21). A read-only public mirror avoids the AI-generated pull-request flood that led Godot to ban AI-authored contributions in July 2026.

## 8. Risks and kill conditions

Three failure modes matter most. Novelty decay before the funding loop closes (the Nothing, Forever and Claude Plays Pokémon curves), answered by a regular appointment supporters can count on: cards going live, and the Monday report once it exists. A host saying something bannable (Nothing, Forever's 14-day suspension), answered by the filter, delay and kill switch in the kernel before any host runs. The board becoming the on-call engineer, answered by the alerts, automatic rollback, the incident reserve and the board-time limits below.

Abuse and mitigations. Prompt injection: the read/write separation in the kernel. Cost drain: per-card ceilings, the daily cap, the monthly cap and the Console credit bound. Chargebacks: the $50 daily credit limit per payer keyed on the card fingerprint, the 14-day hold above it, the studio-wide daily credit limit and the 10% reserve. Brigading, once free voting exists: voter identity with a minimum account age, one vote per account, quorums, the gate. Harassment through names and credits, once the name pipeline exists: the deny-list, the cooling period, board approval.

Kill conditions, counted from Go live (the board's criteria; the two viewer-count lines were removed on 22 September 2026):

| After Go live | Kill if | Pivot instead |
|---|---|---|
| 7 days | under 25 unique funders, under $500 funded, or board time over 25 hours | drop 24/7; run a weekly two-hour live show |
| 30 days | under 100 funders, under $2,000 cumulative, or board time over 12 hours a week | drop the meter; run as a public demo |
| 90 days | under $6,000 cumulative, or board time over 10 hours a week | archive; publish the post-mortem; open-source the vote and meter kit |

The pivots were written for a streamed studio; restating them for the site-first studio is an open board decision (`docs/BOARD-SETUP.md`).

## 9. Sources

Twitch Plays Pokémon — https://en.wikipedia.org/wiki/Twitch_Plays_Pok%C3%A9mon · Neuro-sama — https://en.wikipedia.org/wiki/Neuro-sama · Dexerto on Neuro-sama — https://www.dexerto.com/twitch/an-ai-powered-vtuber-is-now-the-most-popular-twitch-streamer-in-the-world-3300052/ · Multiverse Studios — https://multiversegames.ai/ · Polsia — https://timfrin.substack.com/p/how-polsia-builds-and-runs-companies · Claude Plays Pokémon — https://techcrunch.com/2025/02/25/anthropics-claude-ai-is-playing-pokemon-on-twitch-slowly · Claude Plays Pokémon viewership — https://streamscharts.com/channels/claudeplayspokemon · Nothing, Forever rise — https://techcrunch.com/2023/02/03/nothing-forever-ai-generated-seinfeld-twitch/ · Nothing, Forever ban — https://www.nbcnews.com/tech/twitch-temporary-ban-seinfeld-parody-ai-transphobic-remarks-rcna69389 · Nothing, Forever decline — https://tech.yahoo.com/ai/articles/ai-driven-perpetual-seinfeld-falls-152926325.html · Anthropic pricing — https://platform.claude.com/docs/en/about-claude/pricing · Anthropic weekly limits — https://techcrunch.com/2025/07/28/anthropic-unveils-new-rate-limits-to-curb-claude-code-power-users/ · Twitch Community Guidelines — https://safety.twitch.tv/articles/en_US/Knowledge/Community-Guidelines · Twitch Affiliate — https://help.twitch.tv/s/article/joining-the-affiliate-program · Twitch 48-hour cap — https://ireplay.tv/blog/24-7-always-on-streaming-twitch-grow-audience-with-existing-content/ · Twitch AI training opt-out — https://www.nbcnews.com/tech/tech-news/twitch-creators-push-back-amazon-using-content-train-ai-rcna592391 · Twitch revenue split — https://streamernews.gg/guides/twitch-revenue-split-explained/ · Twitch 70/30 — https://variety.com/2023/digital/news/twitch-partner-plus-70-percent-revenue-split-streamers-1235645488 · Stripe Payment Links custom fields — https://docs.stripe.com/payment-links/custom-fields · Patreon earnings — https://bloggingwizard.com/patreon-statistics/ · Kickstarter games 2025 — https://medium.com/icopartners/kickstarter-and-video-games-in-2025-90f15c2fd7bd · Star Citizen $1B — https://massivelyop.com/2026/05/25/star-citizen-has-officially-raked-in-over-one-billion-dollars-in-total-crowdfunding-from-gamers/ · Steamworks DLC — https://partner.steamgames.com/doc/store/application/dlc · Steam app fee — https://partner.steamgames.com/doc/gettingstarted/appfee · GDC 2026 survey — https://gdconf.com/article/gdc-2026-state-of-the-game-industry-reveals-impact-of-layoffs-generative-ai-and-more/ · Godot AI ban — https://www.theregister.com/ai-and-ml/2026/07/01/godot-says-bye-bye-ai-bans-vibe-coded-contributions/5265344 · YouTube inauthentic content — https://techcrunch.com/2025/07/09/youtube-prepares-crackdown-on-mass-produced-and-repetitive-videos-as-concern-over-ai-slop-grows · Canadian creator tax — https://www.mondaq.com/canada/tax-authorities/1816972/canadian-influencer-tax-guide-cra-audit-risks-gsthst-rules-cryptocurrency-income-foreign-reporting-and-tax-planning-strategies

## 10. Decisions

Numbered once and never renumbered; specs cite them as "§10 default N". A decision replaced by a later one says so and keeps its number. Dates record when the board decided.

1. Build 1 as written. Amended: there is no launch date; the board goes live when the `docs/ROADMAP.md` criteria hold (13 September 2026), and the launch scope is that checklist (decision 24).
2. Name: chosen by the first global vote from Peanut Gallery, Backseat Driver, Armchair, Helicopter (all "Game Studio"). Domains and handles for all four are registered before launch; a trademark glance on Peanut Gallery first. The repository keeps the working name `backseat`. Superseded on 14 September 2026: the board named the studio Peanut Gallery, and the name vote is not held.
3. Split: 10% reserve off the top; default 80% Agents / 20% Studio on the remainder, supporter-selectable at checkout; 5% of the Agents share to the incident reserve until it holds $500.
4. Launch seed: idle/incremental.
5. Compute: attended mode on the founder's subscription before the cutover; the separate API organization ($500 monthly limit) after it. How unattended sessions run is decision 25.
6. Second kill-switch holder: named by the board. It is the moderator (`docs/BOARD-SETUP.md`), who holds the pause now and the kill switch once the stream exists.
7. Founding budget (14 September 2026): none. Pre-launch agent work runs attended on the founder's subscription, billed to the founder on the ledger and hidden from the public; the pool holds customer money only.
8. Payments: Stripe Payment Links; Twitch Bits when Affiliate; no Ko-fi.
9. Images: OpenAI gpt-image first, Gemini second, free credit before paid, studio imagery only. The agent avatars are drawn by code instead (decision 27), and the image adapter is a backlog entry.
10. Site sections (14 September 2026): what is building and what is open to fund replace the three sprint goal cards, which were retired from the database the same day; the landing layout is `docs/specs/site-layout.md`. No season framing on the site until the first season is declared.
11. Vote at live (14 September 2026): funding a card is the vote. Targets sit at or below the per-card maximum; the bar credits the agents' net amount; a full bar moves the card to `funded`. Amended by decision 21 (funding a card is the choice, and no "vote" wording) and decision 28 (targets are no longer bounded by the per-card maximum).
12. Unattended mode (14 September 2026): the same Claude Code command with `STUDIO_ANTHROPIC_API_KEY` from the studio organisation, never the founder's key; a session billed to the wrong account is refused. Superseded by decision 25; the studio key and the refusal stay.
13. Observability (14 September 2026): `agent_events` and `ledger` are the record; the dispatcher logs JSON lines and writes a heartbeat to `studio_state`; Langfuse-class tooling stays the Scout's first trial after launch and is never fed from the agent child. Amended by decision 29: tracing is a backlog entry.
14. Kernel paths (14 September 2026): `platform/gate/kernel-paths.txt` lists the files no agent may change in any lane; the dispatcher refuses them and the gate fails a card branch that touches one. A merged change that fails its deploy or smoke is reverted on main.
15. Announcement (14 September 2026): site-first; Twitch, the host and the stream follow through the system after launch (`docs/specs/announcement.md`).
16. Style (14 September 2026): plain and readable, one style guide at `platform/site/DESIGN.md`; the co-berlin typographic direction is retired.
17. VPS (16 September 2026): the dispatcher's host is an Oracle Cloud Always Free Ampere instance in Toronto rather than a paid Hetzner box. The pool holds customer money only, so a standing server cost cannot be funded yet (`docs/specs/vps.md`).
18. GitHub access (15 September 2026): the dispatcher on the VPS uses a fine-grained GitHub token for this repository only (Contents and Pull requests read and write, Checks and Metadata read, no Workflows), which replaces the deploy key (`docs/specs/vps.md`). Extended by decision 30.
19. Two-factor on /board (15 September 2026): enforced in the database through `board_aal2()`. Filing directives, cards and notes, Go live, the agent mode and the board's pause need the second factor; the moderator's pause, the board heartbeat, `board_role` and `board_studio_state` stay at the first factor, so attended runs keep a board session (`docs/specs/launch-pages.md`). Every board action added on 22 September 2026 needs the second factor too.
20. Session containment (16 September 2026): before any unattended card runs, agent sessions are contained in layers (a permission policy, a Bash sandbox, and the dispatcher's code kept apart from the agent's work clone), and a proxy keeps the studio API key out of agent sessions. This is a hard blocker for unattended cards, specified in the session-containment spec, in review. Superseded by decision 25: Managed Agents sessions keep the studio key and every agent-written line off the VPS.
21. Copy (22 September 2026): funding a card is the choice. No "vote" wording on the site, except planned items on /roadmap labelled as planned. Free voting is a backlog entry.
22. Models (22 September 2026): the Studio Head and the Game Director move to `claude-opus-5-5`; the builders stay on `claude-sonnet-5`. No job runs the directors at launch, so the change has no effect until card drafting, note triage or the Monday report ships.
23. Money order (22 September 2026): contributions open with the studio paused; the first Stripe payout; Console credit bought from it; then the cutover. The founder's money never counts as a contribution and never buys credit. Credit is bought again after every payout, sized to the agent money paid out, and each purchase is recorded at /board.
24. Planning (22 September 2026): no dated or weekly planning. The launch scope is the `docs/ROADMAP.md` checklist; everything else is a `docs/BACKLOG.md` entry filed as a card on /roadmap; this file is dateless apart from decision dates.
25. Managed Agents (22 September 2026): unattended card sessions run as Claude Managed Agents sessions, each in an Anthropic-hosted container, with the repository mounted read-only at the card's base sha through a contents-read token, web tools off, and the agent's work returned as a patch that the dispatcher applies, checks, commits and pushes. No agent-written code runs on the VPS, and the container never holds the studio key. Attended builds stay on the Claude Code CLI on the founder's Max plan, sandboxed. Supersedes 12 and 20.
26. Pages (22 September 2026): /how-it-works and /team are launch scope, and /roadmap lists the backlog. /team shows only real data, with no scorecards, and each role's model is public.
27. Avatars (22 September 2026): drawn in code as SVG.
28. Funding targets (22 September 2026): a card's funding target is no longer bounded by the per-card maximum, which now limits only what agents may spend on one card.
29. Tracing (22 September 2026): OpenTelemetry or Langfuse is backlog; the ledger and `agent_events` are the launch record.
30. GitHub tokens (22 September 2026): three fine-grained tokens for this repository only, all different: the VPS dispatcher's (Contents and Pull requests read and write, Checks and Metadata read, no Actions, no Workflows), a Contents-read token for Managed Agents repository mounts, and the Mac's own for attended runs with the dispatcher's permissions. Unattended mode refuses a token that is not fine-grained.
31. Studio code lane (22 September 2026): closed at launch, because the board's dashboard shares the site's origin; it opens when the board has its own site (backlog, next). New board RPC calls stay in the kernel file `platform/site/src/lib/board.ts`.
32. Work (22 September 2026): the definitions of game, studio and board work, the next game, and the definition of ready in §4, written because the board asked what studio work covers.
33. Kill conditions (22 September 2026): the two viewer-count lines are removed; the funder, money and board-time conditions stay, counted from Go live (§8).
34. Smoke (22 September 2026): the production smoke test runs no card code, on the VPS or in CI: the served build sha, the served config checks, served config files byte-equal to the merge commit, and the gate green at the merge sha.
35. Free infrastructure (22 September 2026): everything the studio runs on is free; players' money funds the studio, and the founder's money never does.

## 11. Names

The repository is AlreadyKyle/peanutgallery; the Supabase project is `lyxndueoeisyqzewflpu`; the Netlify sites are `peanutgallerygames` (the site, peanutgallery.games) and `peanutgallery-seed-1` (the game); the VPS is an Oracle Cloud Always Free instance in Toronto (`docs/specs/vps.md`, §10 default 17). The kick-off plan's `backseat` names are history.

## Appendix A. Technical spec

Repository layout. `platform/`: `dispatcher/` (Node 22, TypeScript; adapters `attended`, which runs the Claude Code CLI, and `unattended`, which runs Claude Managed Agents sessions), `gate/` (`ship-gate.sh`, `runtime-token-deny.sh`, `banned-phrases.sh`, `kernel-guard.sh`, `denylist/`, `headless-bot/` and `kernel-paths.txt`), `site/` (Vite + React: landing, contribute, ledger, how it works, team, roadmap, the legal pages and `/board`), `supabase/` (migrations, the `stripe-webhook` function, the seed and the operator scripts), `agents/` (role specs as JSON, their prompts, and the managed agent configuration), `ops/` (the dispatcher's image, systemd units, provisioning and the Oracle launch script). `seed-1/`: `sim/`, `config/` and `content/` (config lane), `render/` (Phaser 3), `bots/`, `tests/`, `CLAUDE.md`. Root: `CLAUDE.md`, `docs/`, `.github/workflows/gate.yml` (path-filtered per folder).

Environment variables (what the code reads: `.env.example`, `platform/dispatcher/src/config.ts`, `platform/ops/dispatcher-env.mjs`).
- Dispatcher, required: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO` (owner/repo), `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID_SEED`, `NETLIFY_SITE_ID_PLATFORM`, `MODEL_BUILDER`, `PRICE_TABLE_JSON`, and in unattended mode `STUDIO_ANTHROPIC_API_KEY` (the studio organisation's key), `GITHUB_READ_TOKEN` (contents read only), `MANAGED_AGENT_ID`, `MANAGED_AGENT_VERSION` and `MANAGED_ENVIRONMENT_ID` (§10 decision 25).
- Dispatcher, optional with defaults: `AGENT_MODE` (attended | unattended; attended), `MODEL_DIRECTOR`, `MODEL_HOST`, `POOL_DAILY_CAP_USD` (100), `CARD_MAX_USD` (25), `SESSION_MAX_TURNS` (60), `SESSION_MAX_MINUTES` (60), `AGENT_HOURLY_RATE_USD` (5), `DISPATCHER_TICK_MS` (60000), `DISPATCHER_WORKTREE_ROOT`, `DISPATCHER_MAX_CONCURRENCY` (1), `DISPATCHER_SCHEDULER` (on), `CLAUDE_BIN` (claude), `BOARD_SESSION_TTL_MIN` (3), `HEALTHCHECK_URL` and `NTFY_TOPIC_URL` (unset means no alerts).
- `ANTHROPIC_API_KEY` is the founder's key. The dispatcher reads it only to refuse a studio key equal to it, never passes it to an agent session, and the VPS env file never carries it.
- `SUPABASE_SECRET_KEY` is preferred over `SUPABASE_SERVICE_ROLE_KEY` where the code offers both: `make-dispatcher-env.sh` writes it as the VPS's service key, and `sign-synthetic-event.ts` uses it for dry runs.
- Supabase seed (`platform/supabase/seed.ts`): `BOARD_EMAILS` (comma-separated), `MODERATOR_EMAIL`, `MODEL_DIRECTOR`, `MODEL_BUILDER`, `MODEL_HOST`, `AGENT_MODE`, `POOL_DAILY_CAP_USD`, `CARD_MAX_USD`, `AGENT_HOURLY_RATE_USD`. The scripts add `SUPABASE_ANON_KEY` (the anon negative test), `STRIPE_SECRET_KEY` (the endpoint scripts) and `STRIPE_WEBHOOK_SECRET` (synthetic events).
- Stripe webhook function secrets: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and the optional `NTFY_TOPIC_URL`, with `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from the function runtime.
- Site build values (public): `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_STRIPE_PAYMENT_LINK_URL`, `VITE_DISCORD_INVITE`, `VITE_PLAY_URL`.
- Reserved for backlog entries and read by no code: `ANTHROPIC_ORG_ID`, `OPENAI_API_KEY` and `GOOGLE_AI_API_KEY` (the image adapter), `STRIPE_PAYMENT_LINK_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_DB_PASSWORD`. `SUPABASE_ACCESS_TOKEN` (Management API) is read by no code either.

Board auth: Supabase Auth magic link; sign-in allowed only for the emails in `board_members` (`BOARD_EMAILS` and `MODERATOR_EMAIL`, written by the seed); row-level security keeps board tables and writes to those users, and the board RPCs check the board role and the second factor.

Supabase schema. The migrations under `platform/supabase/migrations/` are the source of truth; this is the shape.
`cards`: id, bucket (game, platform, qa, studio, budget, agents), source (board, community, agent, decision), shape (oneoff, goal, standing), lane (config, code), priority (0 board directive, 1 S1 incident, 10 personal decision, 100 default), board_reason, folder (seed-1, platform), executor_role_id, title, summary, intent, acceptance_test, design_spec_url, funding_target_usd, funded_usd, estimate_usd, confidence (low, med, high), proposer_role_id, director_stance (neutral, endorsed, vetoed), veto_reason, stage (proposed, designing, voted, funded, building, gated, live, rejected, paused), horizon (now, next, later), rank, severity (s1 to s4, nullable), actual_usd, branch, commit_sha, failing_check, live_at, created_at, updated_at.
`ledger`: id, card_id, role_id, model, input_tokens, cached_tokens, output_tokens, usd, billed_to (studio, founder, overhead), request_id, created_at. Anon reads studio and overhead rows only.
`pool`: id, balance_usd, reserve_usd, incident_reserve_usd, held_usd, daily_spent_usd, day.
`contributions`: id, entry (payment, and the reversal and release rows), parent_id, rail, contributor_id, display_name, payer_key, amount_usd, net_usd, reserve_usd, agents_usd, studio_usd, incident_usd, held_usd, hold_until, studio_pct_chosen (default 20), kind, public, goal_card_id, stripe_event_id, stripe_session_id, created_at, credited_at.
`studio_state`: id, paused, paused_by, paused_at, kill_switch_fired_at, daily_cap_usd, card_max_usd, agent_hourly_rate_usd, the per-payer and studio-wide daily credit limits, credit_hold_days, the monthly cap, reserve_pct (10), incident_pct (5), incident_cap_usd (500), studio_reserve_usd (0), image_providers_json, agent_mode, launched_at, dispatcher_seen_at.
`roles`: id, name, title, description, species_note, avatar_url, model, budget_share, voice, prompt_path, tools_json, metrics_json, write_access, state (active, retired), hired_at, retired_at; the public reads it through the `public_roles` view.
`deploys`: id, folder, sha, netlify_deploy_id, is_green, smoke_result, created_at. `last_green` is the newest row with is_green true.
`agent_events`, `board_members`, `board_notes`, `dispatcher_lease`, `board_actions`, `credit_purchases` and `card_patches` hold what their names say, each with row-level security and service- or board-only access. `standing_costs`, `scores`, `votes`, `decisions`, `images` and `stream_state` exist for backlog entries and nothing writes them.
Public views: `public_studio`, `public_ledger_totals`, `public_card_funding`, `public_card_spend` and `public_roles`.

Dispatcher loop (every 60 seconds, while holding the lease). Read `studio_state`; if paused, sleep; if `agent_mode` is attended and no board session is active, sleep. Read the pool and the caps; compute what is available (§6 Budget throttle). Select the runnable card with the lowest priority number, then the oldest, whose ceiling fits (an S1 card may also draw the incident reserve). Set `building`; run the session (§6 The pipeline); write every turn to `ledger` and `agent_events`; stop at the ceiling or the turn cap, then `paused`. On completion push the branch, open a pull request, set `gated`, wait for the gate, merge, deploy, smoke, and set `live` or `rejected`, restoring `last_green` and reverting on main after a failed deploy or smoke (§10 default 14). Attended sessions skip the pool and daily-cap checks and are billed to the founder (§10 default 7).

Stripe webhook (Supabase Edge Function). It handles `checkout.session.completed` (read the amount, the `split` custom field and the display name; compute the reserve, agents, studio and incident amounts; insert `contributions`; credit the pool and the incident reserve; credit the card's bar when a card was chosen; hold credit above the daily limits); `charge.updated`, which credits a paid session whose Stripe fee arrived after the session event, keyed by the Checkout session so a payment credits once (`docs/specs/stripe-late-fee.md`); and `charge.refunded`, `charge.dispute.created` and `charge.dispute.funds_withdrawn`, which reverse a contribution. It is idempotent on `stripe_event_id`. Held credit is released hourly by pg_cron (`docs/specs/refunds-and-holds.md`).

Gate (GitHub Actions workflow `gate`, `platform/gate/ship-gate.sh`). The kernel checks run before any card code; then, in order, stopping at the first failure:
- Every lane: secret scan; banned phrases (the deny-list scan over the folder, the changed files, the root docs, path names and the commit message); runtime-token deny (NaN, undefined, stray task markers, stand-in text and the rest of the list).
- seed-1, config lane: the headless bot, then the build.
- seed-1, code lane: typecheck, tests, the headless bot, then the build.
- platform: typecheck and tests of the dispatcher, supabase and site packages, then the site build and the Playwright end-to-end suite.
- Last, in every lane: runtime-token deny over the HTML the build just wrote.

The headless bot runs `seed-1/sim` on a fixed seed for 10 simulated hours and asserts the invariants: dust never negative, every number finite, at least one unlock per simulated hour, and the same seed giving the same state hash. On a `card/*` branch the workflow restores `platform/gate` from the base commit and runs the kernel guard before anything else.

Seed 1 pillars (for the Game Director's role spec). Idle/incremental; one screen; numbers go up; every feature visible within 60 seconds of play; sessions of two minutes are satisfying; all-ages; procedural or vector art only.

Role spec format: the schema is in `platform/agents/README.md` and `platform/agents/specs.test.mjs` enforces it; `write_access` is false for the Host, the Scout and the Community agent.
