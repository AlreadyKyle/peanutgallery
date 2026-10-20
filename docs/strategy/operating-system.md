# The operating system

How Mob Machine runs day to day without waiting on the board: the review team that checks progress against the benchmarks and makes adjustments, the events that trigger work instead of a calendar, incident handling, admin and moderation, support, and the plan for scaling. The studio acts on its own inside the kernel's money caps (`docs/PLAN.md` §10 decisions 66 and 74); the board keeps the duties that need a human or legal identity (`BOARD-SETUP.md`).

## 1. Event-driven cadences

Nothing here runs because it is Monday. Each process starts on an event the studio can detect, with a backstop so a quiet studio is still checked. The one calendar is the Claude-session team's build rhythm (a daily build, a release candidate on Monday night and the release on Tuesday), which the board set for the team's own work (`docs/PLAN.md` §10 decision 79, `docs/build/README.md`); funded cards and every process below stay on their events.

| Event | What runs | Who |
|---|---|---|
| A card goes live | Ship post; feed item; return-after-ship window opens; re-score the game after every tenth live card on it | Outbound lane; Game Director |
| A card fails the gate twice, or a visual review twice | The card pauses; a finding opens | Dispatcher; Janitor |
| A rare or legendary card opens | Feed and studio announcement; Discord post | Site; outbound lane |
| A milestone is reached | Era change if the milestone names one; milestone post; review (below) | Site; Studio Head; review team |
| A benchmark crosses its floor | Review of that area | Review team |
| A launch beat runs | Its 7-day measurement window opens; review at the end | Review team |
| 50 cards have gone live since the last full review, or 30 days have passed with no review | Full review | Review team |
| Suggestions queue reaches a batch, or the oldest waits past target | Curator triage | Curator |
| A held item (suggestion, name, seed) waits past target | Alert to the moderator | Admin |
| A payout leaves agent money that is not credit yet | Alert to the board | Controller |
| An alert from the dispatcher, smoke or Controller | Incident process (§3) | On-call path |
| A dependency patch is available | Upkeep merge policy | Janitor |
| A weekly report is due | Weekly report (built) | Outbound lane |

## 2. The review team

A standing group of specialised agents that compares the studio's progress with `benchmarks.md` and proposes or makes the adjustments it can make inside its rules. It replaces meetings and dashboards nobody reads.

### Members and their areas

| Member | Areas in `benchmarks.md` | Reads | Can produce |
|---|---|---|---|
| Head of Finance | 1 Business | Ledger, Stripe rows | Report rows; proposals for money specs (never a money change itself) |
| Head of Product | 2 Product quality, 6 Conversion, 8 Visual design | The site as a stranger, a supporter and the board; counts | Report rows; Platform card drafts from Platform suggestion clusters; copy and design findings |
| Game Director | 3 Game quality, 4 Engagement (games) | Rubric scores, play counts, perf runs | Game card drafts through the Game Designer; re-scores |
| Art Director | 3 Game quality (art), 8 Visual design | Frames, box art | Visual findings; Tech Artist cards |
| Janitor | 3 Pipeline robustness, 7 Scalability | Gate results, drift, schema, cache headers | Findings; upkeep merges inside its policy |
| Community | 4 Engagement, 5 Virality | Feed, gallery, outbound posts | Content rows; featured seeds |
| HR | Role performance across all areas | Scorecards, review rounds | Role spec proposals as kernel pull requests |
| Studio Head | All, as the reader of the report | The report | Priorities: which drafts first; milestone proposals |

All members are read-only, web-only, reviewers or planners; none has write tools in a review session. Each reads only typed fields and counts, never public free text, except the Community agent, which has no write tools.

### The review's output

One report per review, stored in the repository's reports and posted as a summary to the board's panel:

1. **Scoreboard.** Every benchmark row: current value, target, floor, trend over the last two windows, "not measured" where data is missing.
2. **Findings.** Each row below its floor, with the likely cause from the data.
3. **Adjustments.** Each a typed action of one of these kinds:

| Kind | Example | Who carries it out | Needs |
|---|---|---|---|
| Card draft | "Dust's first 60 seconds miss beat 3: draft a card to show the first unit sooner" | Game Designer, graded by the Game Director | The normal draft gates |
| Priority change | Draft balance cards before content cards | Studio Head (rank by rule) | Nothing more |
| Content change | Drop a content row that produced nothing in two reviews | Community | Nothing more |
| Kernel pull request | A role spec change; a new benchmark counter | A Claude session | Green gate; kernel paths |
| Spec proposal | A money change (e.g. the loyalty bonus) | A Claude session writes the spec | Its own spec and kernel pull request; never inside a review |
| Target change | A benchmark target replaced by a measured baseline | Pull request to `benchmarks.md` | The reason and the data |
| Escalation | Any S1 condition; a kill or pivot line crossed | The board, by alert | A human decision |

### What the review team may never do

Change a money rule, the split, a reserve or a cap; read free text from the public with a write-capable role; change a role's permissions in the same session that proposes it; skip a gate; or decide a kill or pivot (it reports the line; the board decides).

### Time and cost limits

A review is a set of read-only sessions, each with a budget (proposed at $0.50 a member) and a wall-clock limit of 15 minutes. Every model call is work on a card (`docs/PLAN.md` §10 decision 66), so each review is its own Studio card, billed on the ledger like a draft. A member that hits its limit reports "not reviewed" for its areas rather than guessing.

## 3. Incidents

| Severity | Definition | First response | Target to recover |
|---|---|---|---|
| S1 | Money at risk (a wrong ledger row, a webhook failing, a cap breached); a game or the site cannot start; a content-filter escape is public; a security issue | Pause the studio (kill switch) or roll back automatically; alert the board by ntfy and email; the incident reserve may fund the fix card | 15 minutes to safe state |
| S2 | A feature broken for many (feed stale, sign-in links not arriving, a game crashing for some) | Alert; a QA or Platform card at the top of the line | 24 hours |
| S3 | A defect with a workaround | A card in the normal line | Next cards |

Process: detect (alerts, live check, Controller, Janitor), contain (pause, rollback, feature flag in `community.flags`), fix (a card or a kernel pull request on a green gate), record (an incident row, private until its post-mortem), publish (the post-mortem on the ledger page, per `docs/BACKLOG.md`, Incident list with post-mortems). Every S1 gets a post-mortem; every post-mortem names one change to a check that would have caught it.

**Feature flags as the first containment.** Every final-state surface (studio, feed, suggestions, seeds, goals, broadcast) sits behind a flag in `community.flags`, so a broken surface can be turned off from the board's site in one action while the rest runs.

## 4. Admin and moderation

### What is moderated, and how

| Item | Automatic | Held for a person when | Person's actions | Logged |
|---|---|---|---|---|
| Suggestion | Strip links, code and markup; content filter; rate limit 3 a day; Curator safety flags | The filter or the Curator flags it | Release, decline with a fixed reason, merge clusters | Moderation log |
| Display name | Content filter; length; the name pipeline's deny-lists | The filter is unsure | Approve, rename, suspend | Moderation log |
| Seed title | Content filter; 60 characters | The filter is unsure; reports | Unpublish, feature | Moderation log |
| Account | Rate limits per RPC | Repeated holds or abuse | Suspend, unsuspend | Moderation log |
| Card | Draft gates | | Suit change, rarity override with a logged reason, close | Moderation log |

Every admin action is in the append-only moderation log with who, what, when and the reason. A rarity override is visible on the card with its reason, because rarity is public and checkable.

### Who moderates

The board's moderator account, and the board. Once held items wait past the target in `benchmarks.md` for two reviews, the review team recommends a paid part-time moderator (stage 3 in `business-strategy.md`).

### Appeals

A player whose suggestion was declined or whose name was renamed can ask for a review at hello@clayhouse.studio. A person answers within the moderation target; the outcome is logged. Appeals never reach an agent.

## 5. Support and money operations

| Request | Path | Owner |
|---|---|---|
| Refund | Email; refunded in Stripe within 14 days of the contribution | The board (`BOARD-SETUP.md`) |
| Dispute | Answered in Stripe before its due date | The board |
| Claiming past contributions | Self-serve by the Stripe receipt email on the profile | Automatic |
| Sign-in link not arriving | FAQ; then email | Admin |
| Delete my data | Email until self-serve exists (`docs/BACKLOG.md`, Download and delete your profile data) | Admin |
| Console credit after a payout | Controller alert; the board buys credit | The board |

## 6. Scaling plan

Each step is triggered by load, not a date. The architecture is built so the first steps cost almost nothing: public reads are cached documents at the edge and no visitor opens a database connection (`docs/specs/final-state.md`, Scale).

| Load (concurrent visitors) | What holds | What changes | Cost step (`business-strategy.md` §3) |
|---|---|---|---|
| Up to 100 | Free tiers; cached snapshot, feed and gallery; polling | Nothing | None |
| 100 to 1,000 | Edge cache absorbs reads; writes are a few per second at most | Transactional email for sign-in links; watch function call counts | Email |
| 1,000 to 10,000 | Edge cache hit rate above 95%; keyset pagination; indexes | Paid hosting and database plans; longer `s-maxage` on the gallery; feed split into a hot document and pages | Database, hosting |
| 10,000 to 100,000 | Reads stay cached; writes are rate-limited per account | A queue in front of vote and event writes; a read replica for admin; the broadcast overlay served from a static snapshot; a moderator | Moderator; larger plans |
| Above 100,000 | | A dedicated real-time channel for the feed instead of polling; regional caches; a second model provider for capacity | Reviewed when reached |

Agent capacity scales separately, with money: concurrency, drafts and the monthly cap grow with the trailing month's funding behind a failure breaker (`docs/BACKLOG.md`, A card supply that keeps pace with funding).

### Load tests

Before each beat in `growth.md`, a load test replays the expected peak against a preview deploy: 10 times the last beat's peak reads per second for the feed, snapshot and gallery, and 10 times its writes. The beat waits until the test passes the scalability benchmarks.

## 7. Privacy and data

- No cookies for tracking, no third-party analytics, no identifier that follows a person; counts are daily aggregates (`docs/specs/play-counts.md`).
- Profiles hold an email (for sign-in), a display name, avatar parts and preferences. The Stripe receipt email used to claim contributions is matched server-side and never stored beside the profile in plain text.
- The Privacy page states each item above before profiles go live.
