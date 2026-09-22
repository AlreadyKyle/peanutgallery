# Launch docs: a dateless constitution, the backlog, the board's steps

Status: built. Card: none. Owner: board.

## Problem

`docs/PLAN.md` was a kick-off plan full of schedules the board never set (numbered week and day
bars, a numbered launch day, season and hour timings, scenario and kill-day tables), and it described votes, regimes,
the stream and a dozen agent jobs as if they existed. Nothing listed what is planned but not built,
so the studio had no source for the backlog cards /roadmap shows. `docs/ROADMAP.md` mixed phases
with the launch checklist and gated the announcement on a contribution only the announcement could
bring in. `docs/BOARD-SETUP.md` deadlocked on the first player, named one GitHub token where three
are needed, and printed the founder's email. The prompts still carried re-votes, start days and week
numbers, and the Platform Builder claimed to change the card system.

## Scope

In: `docs/PLAN.md`, `docs/BACKLOG.md` (new), `docs/ROADMAP.md`, `docs/BOARD-SETUP.md`,
`docs/docs.test.mjs`, `CLAUDE.md`, `README.md`, the nine prompts under `platform/agents/prompts/`,
the `docs/PLAN.md` line fixture in `platform/gate/test/run-tests.sh`, one "Docs tests" step in the
platform job of `.github/workflows/gate.yml`, run 2 in `docs/specs/week1-runs.md`, and one line of
`docs/specs/site-truth-pass.md` that named the footer credit's studio without quoting the credit.

Out: the agent JSON files, `platform/agents/README.md` and `platform/agents/specs.test.mjs` (the DB
workstream owns them), the example in `docs/COPY.md` (the site workstream), every schema, script,
dispatcher, gate and site change (their own pull requests), and production.

## Behaviour

**PLAN.md is a dateless constitution.** It says what the studio is and the rules it runs by, and
what exists once the launch batch merges: cards with horizons and the definition of ready; the board
filing every card at launch while supporters choose by funding; the work definitions (game, studio,
board, next game), with the studio code lane closed until the board has its own site; the money
rules as built (the $50 per payer per New York day, the 14-day hold, the studio-wide daily limit,
the payer key, overhead from the studio share, Console credit bought only from payouts);
unattended sessions on Claude Managed Agents; the smoke test that runs no card code. It keeps the
section numbers, the Kernel and The Board headings and §10's numbered decisions, so every existing
citation still lands; decisions 1 to 20 keep their numbers with schedule text removed and
superseded ones marked, and the 22 September 2026 decisions are 21 to 35, including that the
directors' move to Opus 5.5 has no effect until a job runs them. The kernel paragraph is verbatim,
the Seed 1 pillars line is verbatim, rule durations and decision dates stay, and the funder, money
and board-time kill conditions stay, counted from Go live. Every mechanic that is not built is one
line under §4 Not built yet, linking its backlog entry.

**BACKLOG.md** holds 46 entries in the format `platform/supabase/lib/backlog.ts` parses: 6 on next
(voter identity, free voting, card drafting, note triage, the Monday report, the board on its own
site) and 40 on later, 2 in `seed-1` and 44 in `platform`.

**ROADMAP.md** is the launch checklist only. It separates contributions open (now, studio paused)
from Go live; names every dispatcher secret and id in criterion 2; puts /how-it-works, /team and
/roadmap in criterion 4; orders the remaining steps; lists the batch's pull requests by branch with
their production steps; and records the Actions minutes as a standing fact.

**BOARD-SETUP.md** is the board's steps in order: hello@; healthchecks.io, the ntfy subscription and
three GitHub tokens (the server's, a read-only one for agent sessions, and the Mac's to replace the
gh sign-in token); the Oracle sign-in with the idle-reclaim risk as the board's choice; the call on
how the first player arrives, recommending a quiet share before Go live; contributions open with
the studio paused and the studio-wide daily credit limit confirmed; the first payout; Console credit
after every payout, sized from the payouts, recorded at /board; the cutover and soak with a test
alert on the phone; a moderator, with the `board_members` row made by the seed; the clip; Go live.
Standing items: HST review at $15k and deleting `KEYS.md`, both the board's. No literal email
address of the founder's appears.

**Prompts.** No week or day numbers, no "re-vote" (a stopped card pauses for the board), no vote
wording outside the kernel line mirrored from PLAN, and every unbuilt mechanic marked not running
yet. The Platform Builder builds studio cards (pages, copy, presentation) and describes board work
as a proposal, never makes it. The smoke sentence matches the smoke that runs no card code, and the
builders may run only the `git` commands a session's closing instructions name for handing back
work.

**Docs tests** (`docs/docs.test.mjs`, now also a step in CI's platform job) check all of that.

## Acceptance criteria

- [x] PLAN.md, ROADMAP.md, BACKLOG.md, BOARD-SETUP.md, CLAUDE.md, README.md and every prompt carry no week, day, hour, sprint or season number and no "launch day" (test: "carry no schedule").
- [x] PLAN.md keeps the kernel paragraph verbatim under "### Kernel", and §4 keeps "The Board" (test: "keeps the kernel paragraph verbatim").
- [x] PLAN.md's Kernel section, CLAUDE.md's kernel line and every prompt's kernel line name all thirteen kernel items, and the site's fixed rules name all but the broadcast delay and kill switch (tests: "name every kernel item", "the site's fixed rules").
- [x] Every "§N", "§10 default N", "§10 decision N", "§N <Heading>" and appendix citation in every tracked text file lands on a part of PLAN.md that exists; the decisions run 1 to 35 with no gap; no live doc cites PLAN.md by line number (tests: "citation … lands", "numbers its decisions").
- [x] BACKLOG.md parses in the contract format with unique titles, ranks 1 upward per horizon and every intent saying it is not built yet (test: "parses in the backlog format"), and the launch/db parser reads the same 46 entries (run against a copy of that parser, quoted under Evidence).
- [x] Every line under PLAN.md §4 Not built yet links a BACKLOG.md entry by its title, every entry is listed there, and every `BACKLOG.md#` link in the docs lands (tests: "every mechanic … links a backlog entry", "every link into docs/BACKLOG.md").
- [x] The company guard reads every Markdown file under `docs/` and the prompts, and passes (test: "name none of the founder's other companies").
- [x] The prompts mark the unbuilt mechanics not running yet, say nothing of re-votes, winning votes or start days, and the Platform Builder names board work instead of changing the card system (test: "mark mechanics that are not built").
- [x] The Seed 1 pillars line is unchanged and the Game Director prompt still carries it (`specs.test.mjs`, 64 of 64).
- [x] The gate fixture injects its marker on a line that exists, the middle of PLAN.md (gate tests, 213 passed).
- [x] ROADMAP rows naming a spec path show the spec's own status (test: "every ROADMAP row").
- [ ] CI's platform job runs a green "Docs tests" step on this pull request.
- [ ] With launch/db on main, the parser test runs instead of skipping and passes (waits on: the launch/db merge).
- [ ] `file-backlog` prints next 6 and later 40, seed-1 2 and platform 44 as a dry run, and then files them (waits on: the launch/db merge, its migrations, and the board's allow).

## Verification

- `pnpm verify`
- `node --test docs/docs.test.mjs`
- `node --test platform/agents/specs.test.mjs`
- `pnpm --filter @backseat/gate test`
- The launch/db parser over `docs/BACKLOG.md`: a copy of `platform/supabase/lib/backlog.ts` from the `launch/db` worktree, placed at that path, then `node --test --test-name-pattern=parser docs/docs.test.mjs`, then removed.
- After push: the pull request's gate run shows the platform job's "Docs tests" step green.
- (waits on: the launch/db merge) the same docs test on the rebased branch runs the parser test rather than skipping it.
- (waits on: the launch/db merge and the board's allow) `pnpm --filter @backseat/supabase file-backlog` as a dry run, the counts quoted and matched to this spec, then `-- --apply` with the inserted count quoted.

## Evidence

- `node --test docs/docs.test.mjs`: 15 tests, 14 pass, 1 skipped ("platform/supabase/lib/backlog.ts is not on this branch"), 0 fail.
- The launch/db parser, copied into place for the run and removed after: `✔ docs/BACKLOG.md parses with the backlog script's parser to the same entries`, `ℹ pass 1`, `ℹ fail 0`. Its counts on this file: `{"horizon":{"next":6,"later":40},"folder":{"seed-1":2,"platform":44}}`, `entries 46`.
- Negative check, with the parser in place and one bucket changed to `marketing`: both backlog tests fail, the local one with `docs/BACKLOG.md:24 "Voter identity for free votes": bucket "marketing"`; the file was restored and `cmp` reports it identical.
- Negative check of the citation test, with a line citing a twelfth section, a ninety-ninth decision and a third appendix appended to README.md and then reverted: three problems, one for each, ending `is not a section of docs/PLAN.md`, `does not exist` and `is not in docs/PLAN.md`, `ℹ fail 1`.
- `node --test platform/agents/specs.test.mjs`: `ℹ tests 64`, `ℹ pass 64`, `ℹ fail 0`.
- `pnpm --filter @backseat/gate test`: `PASS: gate tests passed=213`.
- `bash platform/gate/banned-phrases.sh --repo-root . docs README.md CLAUDE.md platform/agents`: `PASS: banned-phrases files=57 paths=61 message=no`. `bash platform/gate/runtime-token-deny.sh --repo-root . --folder platform`: `PASS: runtime-token-deny files=47`.
- Actions minutes for the ROADMAP standing fact, read-only from the jobs API on 22 September 2026, each job rounded up to a whole minute: `runs 104 by workflow {'gate': 104} billed minutes 512 median 5 max 7 first 2026-09-14T13:19:29Z last 2026-09-22T22:26:12Z`.
- `pnpm verify` and the CI step are quoted in the pull request.

## Production steps (need the board's allow)

1. After every other launch pull request has merged and the backlog migration is on production:
   `pnpm --filter @backseat/supabase file-backlog` (dry run), with the counts quoted and matched to
   next 6, later 40, seed-1 2, platform 44; then `pnpm --filter @backseat/supabase file-backlog -- --apply`,
   with the inserted and updated counts quoted.
2. Before the board deletes `KEYS.md`: confirm `OPENAI_API_KEY` and `GOOGLE_AI_API_KEY` are non-empty
   in `.env` by length only, and quote it. No agent deletes the file.

## Crosswalk: the kick-off plan to this one

Every mechanic in PLAN.md at ed29674, and every "later card" decision in the board's records, and
where it went: built (kept in PLAN), a BACKLOG.md entry, or superseded by a numbered decision.

- **§1 (Decision)** (a numbered launch day): superseded by decisions 1 and 24; the ROADMAP checklist replaces it.
- **§2 (Concept)**: kept. "Streamed continuously": Twitch channel and stream scenes. "Vote on what they do next": decision 21; Free voting on open cards.
- **§3 (Day-one scope)**: one idle seed, built. Twitch scenes, Replay and Play Cam: Twitch channel and stream scenes. Launch at a Monday hour: decision 24. Vote buckets: Buckets, weekly allocation and the QA slider; Free voting on open cards. The name vote and "Untitled Game Studio": decision 2. The collective name: The name pipeline. Budget opening at $500: Buckets. Agents and the regime dial: Vote weight regimes. Platform open to community cards later: decision 31 and Board on its own site. The launch roster: built (role specs), with the running roles in §3. Scorecards from the start: Scorecards for every agent.
- **§4 (Cards)**: built (horizon, rank and the definition of ready added). Confidence bands: Scorecards for every agent. "Pauses and re-votes": pauses for the board (`resume_card`, `cancel_card`). Micro-votes: Free voting on open cards. Lanes: built.
- **§4 (Card shapes)**: goal bars and the four columns, built. Standing bars and sponsor a role: Standing costs and sponsor a role. Design stage: Design stage for large cards.
- **§4 (Three decision tiers)**: global and collective, Free voting on open cards (and Voter identity for free votes first). Personal decisions: Personal decisions for contributors.
- **§4 (Buckets and allocation)**: Buckets, weekly allocation and the QA slider; buckets stay an internal tag.
- **§4 (Incident reserve)**: the 5% up to $500 and the S1 draw, built. Deterministic S1 classification: In-game bug button and QA reproductions.
- **§4 (The platform improves itself)**: the Platform team changing the card system, decision 32 (board work). Agents-bucket A/B: Agents improve agents, tested before merge. The efficiency curve: its entry. Metric definitions: kept (§4 Metrics).
- **§4 (The org chart)**: roles are data, built. Weekly agenda and Monday report: The Monday report. Blue-sky sessions: Studio Head blue-sky proposals. Org cards, replacement, the season review, model tier per role: Org chart changes and replacement votes; Seasons. The Scout and its trials: Scout agent for outside tools and trends. The Community agent and the Lore page: Community agent and the Lore page.
- **§4 (The team, on screen)**: aliens and "AI agent", kept. Avatars from the image adapter: decision 27 (code-drawn SVG). Meet the Team: built at launch (/team, decision 26). Salary, scorecard, notable ships, bugs caused: Scorecards for every agent. Alumni wall: Org chart changes and replacement votes. Names from a filtered pool: The name pipeline. Dev Cam office: Twitch channel and stream scenes. Monday all-hands: The Monday report. Employee of the season: Seasons.
- **§4 (Vote regimes)**: Vote weight regimes. Vetoes: Vetoes for the two directors. Names: The name pipeline.
- **§4 (QA)**: bug button, replays, Hall of Fame, the report quota: In-game bug button and QA reproductions. Nightly rebalance: Nightly rebalance card.
- **§4 (Seasons)**: Seasons; Steam release path; Next game chosen by a concept bracket; itch.io in Weekly episodes and clips.
- **§4 (Host)**: The host. Rating: kept; its stream sentences are in The host and the Twitch entry. Art policy: kept; avatars by decision 27; studio imagery in Image adapter for studio pictures. Kernel: kept verbatim.
- **§4 (The Board)**: the dashboard, directives, notes stored, TOTP, spend caps, built. Shadowed figures: Image adapter for studio pictures. Board Decisions page: its entry. Note triage: Studio Head triages board notes. Kill switch: The host. The week's names: The name pipeline. Veto log: Vetoes for the two directors. Model tier per role: Org chart changes and replacement votes. Incidents: Incident list with post-mortems. The personal-decision backlog: Personal decisions for contributors. The second kill-switch holder: BOARD-SETUP step 9.
- **§4 (The board's week after launch)**: its hour schedule, decision 24. The board-time limits: kept in §8. Episode approval: Weekly episodes and clips.
- **§5 (Rails)**: Payment Links and the split, built; the payer key and studio-wide limit, the launch/db pull request. Tiers: Membership tiers. Twitch Bits and subs, Affiliate by streaming: Twitch Bits and subscriptions.
- **§5 (The split)**: kept. The live aggregate on the meter: Split aggregate on the meter.
- **§5 (Costs)**: fixed infrastructure figures, decisions 17 and 35. The host's running cost: The host. The agent rate: kept. Per-image metering: Image adapter for studio pictures. Monthly totals: decision 24 (scenario figures).
- **§5 (Compute account and mode)**: decision 25. The second-provider adapter: Second model provider.
- **§5 (Break-even and the scenario table)**: decision 24 (scenario figures). Second-order value: kept as §5 Possible later income. Canada admin: kept, with the HST review in BOARD-SETUP and Alert the board at the tax review threshold.
- **§6 (Build 1)** (its day and week bars and a numbered launch day): decision 24 and the ROADMAP checklist. Built from it: the site, meter, ledger, Stripe, the dispatcher, the gate, rollback, /board with TOTP, the four columns, the incident reserve. Not built: each item maps above (OBS and scenes, the host, micro-votes, the second provider, the vote board, tiers, standing bars, the design stage, personal decisions, S1 classification, bug filing, auto-clips, the image adapter, Board Decisions, Lore, the phone kill switch).
- **§6 (Roadmap through the system)**: the agent-maintained "How it works" wiki, superseded by /how-it-works (decision 26). Blue-sky, Play Cam, tiers, Steam, Scout trials, the efficiency curve, vote regimes, lore and name votes: their entries. Card-system improvements from platform metrics: decision 32.
- **§6 (Architecture)**: the dispatcher loop, the budget throttle, the game runtime and the layout, kept and updated. The public read-only mirror: Public mirror of the game with a license. The scheduler's timed jobs: their entries (the scheduler stub runs no handler). The image adapter: its entry. The blue/green heartbeat for agent-changed dispatcher versions: decisions 31 and 32 (the dispatcher is board work, and the platform code lane is closed). The stream architecture: Twitch channel and stream scenes, The host, Weekly episodes and clips, Twitch Bits and subscriptions. Technical risks: kept, updated.
- **§7 (First 72 hours)**: decisions 15 and 24; each mechanic in it maps above. Channels: kept. Content after launch: Weekly episodes and clips, Discord bot, News section on the site. Backlash: kept, with the response line amended by decision 21.
- **§8 (Risks and kill conditions)**: kept; the kill table counted from Go live (decision 33), the pivots an open board decision.
- **§9 (Sources)**: kept verbatim. §10 (Defaults in force): kept as decisions 1 to 20.
- **§11 (Kick-off)**: the names, kept as §11 Names. Board setup items: done, or BOARD-SETUP steps (the Console organisation in step 7, the second kill-switch holder in step 9, HST as a standing item). Domains for four names: decision 2. Twitch settings and the YouTube quota: Twitch channel and stream scenes, Weekly episodes and clips. The subreddit and a Discord bot token: Community agent and the Lore page, Discord bot. The host's recorded split statement: decision 15 (site-first launch).
- **The appendices**: the technical spec, kept and updated as Appendix A; the first session's prompt, history at ed29674, superseded by the ROADMAP.
- **Board decisions, 18 September 2026**: seasons and a news section as later cards: Seasons; News section on the site. The stream out of launch scope with the delay and kill switch kept in the kernel: Twitch channel and stream scenes, The host, the kernel. The board-run backlog and /roadmap with no agent planning yet: built by launch/db and launch/site; agent planning is Studio Head drafts cards from the roadmap. Page imagery from an image adapter with board-approved avatars: Image adapter for studio pictures, with avatars replaced by decision 27.
- **Board decisions, 22 September 2026**: free voting after live: Free voting on open cards. Tracing as backlog: Tracing for agent sessions.
- **ROADMAP "After live", 20 September 2026**: Twitch and the Dev Cam, the host, the kill switch, the scheduler jobs, personal decisions, display names, Board Decisions, the image adapter, the seed-1 mirror and the rollback button: each its entry. Meet the Team: built at launch.
- **The audit of 22 September 2026**: voter identity, the board on its own site, Actions minutes, the HST alert, a dispatcher without an always-on server, refund and dispute fee rows, won disputes, the split aggregate and the sweep's two edge cases: each its entry. The studio-wide daily credit limit is built at launch by launch/db, with the board's confirmation in BOARD-SETUP step 5.

## Decisions

- 2026-09-22: PLAN.md keeps its section numbers, its Kernel and The Board headings and §10's numbering, so citations in migrations and in other workstreams' files resolve without an edit; the docs test checks every citation in the repository.
- 2026-09-22: the kill conditions stay, counted from Go live, as the audit amendments ruled; their stream-era pivots are listed as an open board decision rather than rewritten.
- 2026-09-22: the backlog is 6 next and 40 later. Voter identity is its own entry, ranked before free voting, and the board on its own site is on next as board work.
- 2026-09-22: the parser test runs the launch/db parser through the supabase package's tsx and skips on a branch without it; a local parser of the same format always runs, so the file is checked before launch/db merges.
- 2026-09-22: the kernel line in the prompts keeps "No card, vote, regime or org change edits them", mirroring PLAN.md's verbatim kernel paragraph; the vote bans are on "re-vote", "wins the vote" and start days instead.
- 2026-09-22: the crosswalk above names the kick-off plan's sections in brackets, "§4 (Cards)", because a section number followed by a capitalised name is read as a citation of today's plan, which the docs test checks against today's headings.
- 2026-09-22: `platform/agents/README.md` and `specs.test.mjs` are left to launch/db, which owns the role JSON; their "PLAN.md §3" and "§4" citations resolve as they stand.
