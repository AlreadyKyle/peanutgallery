# The system map

Who does what at Mob Machine, what may change what, what pays for each kind of work, and where the board can step in. `docs/PLAN.md` is the constitution (§3 for the roster, §4 for cards and the board, §6 for the pipeline); this page is the map of how those rules run, and `docs/specs/agent-system-core.md` built most of it. Anything a later pull request builds is marked not built yet, with its spec.

## The roles

Sixteen roles, one role spec each in `platform/agents/` (a JSON file and a prompt). A role's class sets what it may do; `write_access` is true exactly for a writer or a planner with tools, and no role with write access reads free text from the public (the kernel's read/write separation). The status is the role's place in the launch roster: running at launch, starting on a named trigger, or planned. `docs.test.mjs` checks the name, class, status and trigger columns against the role specs.

| Role | Class | Status | Trigger | Job | Tools | May | May not |
|---|---|---|---|---|---|---|---|
| Studio Head | planner | running |  | ranks the open cards on now when the board presses Rank now (`studio_ranking`); drafting from the roadmap is backlog | Read, Glob, Grep | read the repository and typed card fields; order cards that hold no money | change the repository; rank a card holding money; read a community card's text |
| Game Designer | planner | running |  | drafts a new seed-1 game card when the board presses Draft a game card (`draft_card`) | Read, Glob, Grep, Bash (seed-1's package scripts, in a scratch checkout of main; no Bash when the dispatcher runs unattended, since no agent-written code runs on its host) | propose card drafts as one typed object | approve a card; change the repository; read a community card's text |
| Game Director | reviewer | running |  | grades each game draft against the pillars and the all-ages rating, in a session of its own (`draft_card`); reviews a seed-1 card's changed frames after its gate passes (the visual review) | Read, Glob, Grep | approve, send back or flag a draft it did not make; pass or send back a card's frames; set its stance on a card | change the repository; grade a card it proposed, drafted or would build |
| Builder A | writer | running |  | builds funded game cards in `seed-1/` | Read, Edit, Write, Glob, Grep, Bash | change the card's allowed paths in a card session | touch a kernel path; approve a card; read public text |
| Builder B | writer | running |  | builds funded game cards in `seed-1/` | Read, Edit, Write, Glob, Grep, Bash | change the card's allowed paths in a card session | touch a kernel path; approve a card; read public text |
| QA | writer | running |  | reproduces and fixes bugs in Dust; verifies another role's build | Read, Edit, Write, Glob, Grep, Bash | change the card's allowed paths; record a qa_verify approval of a card it did not build | verify its own build; touch a kernel path |
| Platform Builder | writer | running |  | builds studio cards in `platform/site/` outside the kernel paths, once the board opens the code lane | Read, Edit, Write, Glob, Grep, Bash | change the card's allowed paths in a card session | touch a money, legal or board surface; approve a card |
| Platform Director | reviewer | running |  | reviews a platform/site card's changed frames after its gate passes, against `platform/site/DESIGN.md` (the visual review); grading site card drafts and writing their check lines wait on studio card drafting, a backlog entry | Read, Glob, Grep | pass or send back the frames of a site card it did not build | change the repository; grade its own change |
| Head of Finance | read_only | starts | Starts at the cutover, once the first Stripe payout has bought Console credit. | explains the ledger and each credit purchase | none | read the books | move money; change anything |
| Janitor | read_only | starts | Starts once its code checks are built and run clean; the docs pass comes after them. | finds drift between the docs, the code and the cards (not built yet: `specs/agent-upkeep.md`) | none | read the repository; file findings | change anything |
| Tech Artist | writer | starts | Starts at the first visual card after launch. | keeps the game's look as code | none | build visual cards once the board grants tools | read public text |
| HR | planner | starts | Starts once role scorecards and the replay eval set exist. | keeps each role spec true to the role's measured work | none | propose role changes for the board to merge | change a role spec itself |
| Head of Product | web_only | starts | Starts with a first review after launch, then runs monthly and after any big change. | reviews the studio as a stranger, a supporter and the board meet it | none | read outside text; propose | change anything |
| Biz Dev | web_only | starts | Starts last, once every other role in the launch roster is built. | watches tools, models and prices outside the studio | none | read outside text; propose trials | change anything |
| Community | web_only | starts | Starts once a named moderator is in place for the community channels. | reads the studio's community channels and turns requests into proposals | none | read public text; propose | change anything; approve a card |
| Host | web_only | planned | No trigger is set yet; the Host waits on the stream, a backlog entry. | narrates the stream | none | read chat | change anything |

### The roles that start later

Seven roles start on a named trigger and one is planned; each role spec carries its trigger, and no job runs any of them yet:

- Head of Finance starts at the cutover, once the first Stripe payout has bought Console credit.
- Janitor starts once its code checks are built and run clean (`specs/agent-upkeep.md`).
- Tech Artist starts at the first visual card after launch.
- HR starts once role scorecards and the replay eval set exist.
- Head of Product starts with a first review after launch.
- Biz Dev starts last, once every other role in the launch roster is built.
- Community starts once a named moderator is in place for the community channels.
- The Host is planned; it waits on the stream, a backlog entry.

### The five classes

| Class | May | May not |
|---|---|---|
| writer | change the paths its card names, inside a card session the dispatcher starts; record a qa_verify approval of another role's build | touch a kernel path; approve a card it builds; read public free text |
| planner | draft cards and rank the backlog as structured output the dispatcher checks | change the repository; approve its own draft |
| reviewer | approve or refuse a draft; set a stance on a card | change the repository; approve a card it proposed, drafted or would build |
| read_only | read the repository and the books | change anything |
| web_only | read outside text | hold write access; change anything |

## A card's life

```
filed by the board ─────────────────────────────► proposed on now, next or later
drafted by an agent ─► approved ─► waits on next until opens_at ─► dealt to now
                                        (the cooling window)
proposed on now ─► funded (bar full) ─► building ─► gated ─► live
                                           │          │
                                           │          └─► visual review (frames changed): pass ─► live;
                                           │              revise ─► building again, at most twice
                                           ├─► paused at its ceiling ─► resumed by rule once, or by the board
                                           └─► rejected, with the failing check
vetoed by the board ─► never dealt or run; one on now with no money moves to next
```

- **Approval.** A card an agent wrote any of (source agent, or a drafter set) needs an approval: a row of `card_approvals` whose content hash is the card's current one. The hash covers the bucket, lane, folder, executor, title, summary, intent, acceptance test, design spec URL and funding target, not the estimate. The dispatcher records an approval from the grader's own result through `record_card_approval`, which no agent session can reach. A card the board files needs none. The draft path creates agent cards: `approve_card_draft` inserts the card from the graded draft and records the draft approval with the Game Director's session as the grader ref.
- **Dealing.** An approved agent card sits at proposed on next or later with `opens_at`, its approval time plus the cooling window. The first dispatcher tick at or after `opens_at` deals it to now (`deal_due_cards`) if it is still approved, vetoed by neither the board nor the Director, its executor is not paused, and it meets the definition of ready. Postgres also applies the window as it stands from the newest draft approval, whatever `opens_at` says, and deals nothing while the studio is paused. Every funding path requires horizon now, so no money reaches it before then. The window ships at 0: an approved card is dealt on the next tick.
- **What the public sees.** An agent-written card is readable outside the board only while its approval is current, everywhere the public reads cards (`card_is_public`). A card whose approval is voided by raw SQL is hidden, not runnable and takes no money; if it holds money, Needs you lists it.
- **Resume by rule.** A card paused at its ceiling for the first time resumes with no one acting: its new estimate is its actual cost and its new ceiling the lower of 1.5 times that and the card maximum. If the money on its bar is short of the room the new ceiling adds, the rule tops the bar up from money not on a card yet, all or nothing (`money.top_up_card`), or waits, and writes a public event line with the amount. The rule does nothing while the studio is paused and moves no money onto a card no session would start. A card at the card maximum, paused at its ceiling a second time, vetoed by the board or the Director, or in the closed platform code lane waits for the board in Needs you.

## Separation of duties

`record_card_approval` refuses, each with its own message:

- an approver that is the card's proposer, drafter or executor;
- a card whose check-line author is its executor;
- a qa_verify approval by the executor, or one that names a session that built the card;
- a grader ref that is empty, equal to the maker's ref, or already used;
- a hash other than the card's current one;
- an approver role that is paused, retired, or outside the reviewer and planner classes (a writer only for qa_verify);
- a draft verdict other than approved.

On a card that needs an approval, a hashed field changes only through a board control or the draft path (`cards_agent_text_guard`), and a board edit through `set_card_horizon` records a board approval of the new content. Recording an approval changes nothing on the card.

## The two role jobs

Both are board-queued at /board and run attended through `claude -p` on the founder's plan while a board member is signed in, in either studio mode and while the studio is paused, each model call on the ledger billed to the founder with its role (`docs/specs/agent-workflows.md`). Each session holds exactly its role spec's tools, never Write, Edit, a web tool, an MCP tool or a fallback model, and in an unattended process no Bash, so no agent-written code runs on the dispatcher's host; its Read, Glob and Grep are denied the code clone's `.env`, the host's env folder, the dumps and every `.env` file under the home folder. It works in a scratch checkout of main, and answers with one object valid against its schema in `platform/agents/schemas/`, or the run fails and writes nothing.

- **Rank now (`studio_ranking`).** The Studio Head sees the cards on now as typed fields and answers with an order. The rankable cards come from `rankable_cards`, the same test `apply_card_ranking` refuses on (`card_rank_problem`): on now at proposed, designing or voted, in step 2's line (`money.card_takes_money`, so never a vetoed or hidden card), with no money on their bar or on hold. `apply_card_ranking` writes rank only: the named cards trade the ranks they already hold, in the order given, so every other card, a card holding money included, keeps its place in step 2's line; at most ten changes a run, the longest start of the order that fits; and one event, type `message` with step `ranked`, which the public event list reads as "Studio Head ranked the cards open for funding". Its payload, which `public_agent_events` leaves out, names the moved card ids and their ranks for the board's run output.
- **Draft a game card (`draft_card`).** Up to three rounds. A fresh Game Designer session drafts one new seed-1 card, kept private in `card_drafts`; the dispatcher's checks refuse it, by name, for its schema, the definition of ready, a `check:` line that does not parse or already holds on main, a kernel path or a folder other than seed-1, a deny-list hit, an estimate above the per-card maximum or no active, unpaused writer to build it, and a refused draft goes back as the next round. A draft that passes goes to a separate Game Director session with `platform/agents/rubrics/draft-game.md`: approved inserts the card on next, target equal to the estimate, dealt after the cooling window; revise starts the next round; flagged, or a third round without approval, withdraws the draft and writes no card.
- **Typed fields only.** A card a supporter or the community proposed reaches both roles as its id, stage, horizon, bucket and funded amount: both are planners with write access, and no role with write access reads public free text.
- **The public-text filter.** Every agent-written string a stranger can read is scanned by the gate's own `platform/gate/banned-phrases.sh`, every list and trademarks included, and then by its `secret-scan.sh`, before it is written; a hit, or a scan that cannot run, refuses the write. The site shows "Written by the <role>, an AI agent" beside agent-written card text.

## The visual review

Built by `docs/specs/design-review.md`. The files that set the look are board-only (`platform/gate/design-paths.txt`: the tokens, the Card, the glyphs, motion, the route list, the site's public and brand files, the game's favicon): the dispatcher refuses a card that changes one before any gate run, and the gate's kernel guard fails a card branch that does, so a new page or screen is a board pull request. The site's design suite (`platform/site/e2e`) and seed-1's frame spec (`seed-1/e2e`) are kernel, so no card can weaken what checks it.

- **Frames.** A change to a render path (`changed-paths.sh` `render=true`) runs the gate's `frames` job, which screenshots every route in `platform/site/e2e/routes.ts` at 375, 768 and 1440 and the game's canvas at four fixed states and its page at 375, on the change and on the base, and uploads the frames that differ as before and after pairs with `changed.txt` (`design-frames`, kept one day). No card code runs in Node there: the specs and everything they import are kernel, and the game's states are made from the base's sim before the change is drawn.
- **The review.** After a card's gate passes, the dispatcher reads the passing run's `design-frames`. With changed frames, the card waits at gated until a board member is signed in at /board, then one attended session runs, through `claude -p` on the founder's plan and billed to the founder with the Director's role, never to the card: the Game Director for a seed-1 card, the Platform Director for a platform/site card. It holds the Director's role spec tools (Read, Glob and Grep; no Bash, Write, Edit, web or MCP tool, no fallback model), works in the frames folder, reads `platform/agents/rubrics/visual.md`, and answers with one object valid against `platform/agents/schemas/visual-verdict.schema.json`: for intent, fit, legibility and all_ages, pass or revise, the changed frame it rests on and a reason code from a closed list. Anything else is an infrastructure stop, with nothing recorded.
- **The end rule.** All pass records a `visual` approval (the Director approves, the builder's session is the maker, the review session the grader, refused when they are the same) and merges on the green gate. A revise, while fewer than two rounds are used, moves the card back to building: `record_review_round` counts the round in `cards.review_rounds`, and the builder revises in a new session, in the card's own mode and inside its ceiling, given only the failing criteria, frame names and reason codes; the revision and the change become one commit on the base, gated and reviewed again. After two rounds an all-ages revise rejects the card (`visual_review:all_ages`), which moves its unspent money as a gate rejection does; any other open criterion merges with its final verdict on the approval row. The count lives in Postgres, so a restart never resets it.

## The job queue

A job is a name, a role, whether it calls a model, and whether it runs while the studio is paused (`jobs`). A run (`job_runs`) is queued by the board (Run now, with typed input), by pg_cron through `enqueue_job_run`, or by an event, and each has an origin: board, schedule, event or operator. A run queued by a board-origin run is board origin. A key makes each enqueue happen once, and a job holds at most one queued scheduled run. pg_cron runs in UTC.

Each dispatcher tick, after the card path, starts the oldest queued run that can start, one job at a time. A run that cannot start is finished as skipped with its reason: `role_paused`, `studio_paused` (unless the job runs while paused) or `not_board_origin` (a model-calling run the board did not queue). A board-origin model-calling run waits, queued, until a board member is signed in at /board; only the board, at the second factor, or a board-origin run queues a board-origin run. A running job stops at the next watch when its role pauses, when the studio pauses and the job does not run while it is paused, or, for a model-calling job, when no board member is signed in any more (`board_session_lapsed`). At startup, runs still marked running are finished as failed with `dispatcher_restart`.

Two jobs are registered: `studio_ranking` and `draft_card`, manual only, each with its handler (above). Each later pull request adds its jobs with their handlers. Not built yet: the Janitor's drift checks (`specs/agent-upkeep.md`). The weekly report is no job: pg_cron publishes it in SQL (below).

## The weekly report and the outbound lane

Built by `docs/specs/studio-reports.md`; no model writes or reads any of it.

- **The weekly report.** pg_cron job `weekly-report` calls `publish_weekly_report()` at minute 7 of every hour (UTC). With no argument it takes the last ended New York week (Monday 00:00 to the next Monday 00:00, America/New_York), so the boundary is caught in both offsets. A week in which no card went live gets no row; any other gets one `studio_reports` row, once, whose facts SQL writes from public records: each shipped card's title, folder, live time, cost billed to the studio and supporters by number (the first 24 of `public_card_supporters` and a count), the number shipped, the cards in `money.funding_order()` and the first three, the new `supporters` rows and the week's studio-billed spend. `site_reports()` is its one public read, `/api/reports` on the site, `/reports` its page.
- **The outbound lane.** Each dispatcher tick that holds the lease and is not halted runs `runOutbound` (`platform/dispatcher/src/outbound.ts`) after the heartbeat, inside its own try and catch. With neither `DISCORD_WEBHOOK_SHIPS` nor `DISCORD_WEBHOOK_WEEKLY` set it makes no query and no request. Otherwise it posts, to the ships lane, each public card live within the last 6 hours with no `outbound_posts` row, and to the weekly lane the newest report with none, while its week is still the last New York week to have ended (`lastEndedWeek`, the same arithmetic as `money.last_ended_week`); a report found after the next week has ended is recorded `skipped` with `skip_reason` `stale` and never posted, so an old week is never announced. The weekly post names its week and says the open count was taken when the report was published. For each post it inserts the `(kind, ref)` row as `sending` first, so the primary key refuses a second claim, then `posted` with Discord's message id or `failed` with the status. A row is never posted again, whatever its state: a timeout, an error or a crash loses that post rather than doubling it. At most five posts a tick, each with a 10-second timeout. While the studio is paused or the kill switch has fired nothing is posted, and each ship found then is recorded `skipped`, never posted after resuming.
- **Every post** is plain text of at most 2,000 characters from a fixed template, with the username "Mob Machine", no mention allowed (`allowed_mentions.parse` empty), Discord markdown and `@` escaped in every title, and `?wait=true`. A webhook address is a bearer secret: it lives only in the dispatcher host's `.env`, and no log line or error carries it, only the lane and the HTTP status.
- **The card supply floor.** `card_supply()` counts the cards in `money.funding_order()` against `studio_state`'s floor (6 open, 1 of $5 or more, 1 under $2). /board shows the line; a shortfall is a Needs you item whose Draft to the floor queues `draft_card` with `{floor, open_cards}` through `enqueue_manual_job`, at the second factor, run attended like any role job. `floor` carries the shortfalls and the thresholds they ask for (`big_min_usd`, `small_max_usd`), and the Game Designer's prompt names each shortfall with its target: a big card at least $5 within `card_max_usd`, a bigger change by the five-times rule and never a padded target; a small card under $2.

## Who pays for what

| Work | Paid from |
|---|---|
| A card session, unattended | the card's money, from the pool, within its ceiling and the caps |
| A card session, attended | the founder's plan, billed to the founder on the ledger |
| A role job that calls a model | the board's Max plan, attended only: board-origin, while a board member is signed in, billed to the founder, until an operations budget exists |
| A Director's visual review of a card's frames | the board's Max plan, attended only, while a board member is signed in, billed to the founder with the Director's role, never to the card |
| A role job that runs code only | nothing: it makes no model call |
| The unattended startup probe | overhead, from the studio share |

No role job spends supporters' or studio money, and `record_usage` refuses a studio-billed ledger row that names no card.

## Where the board steps in

- Pause and resume the studio; the moderator may pause.
- Pause a role (the board or the moderator) and resume it (the board, at the second factor).
- Veto or unveto a card, with a reason; a card holding money is cancelled instead.
- Set the cooling window, from 0 to 10,080 minutes.
- Edit a card and move it between horizons (`set_card_horizon`), which records a board approval of an agent card's new content.
- Cancel a card, or resume a paused one with a new estimate.
- Run a job now, with typed input; Rank now and Draft a game card queue the two role jobs, and Draft to the floor queues `draft_card` with the supply's shortfalls.
- Set the caps and record Console credit purchases.
- Needs you lists what waits on the board: disputes, S1 cards, credit to buy, the ceiling pauses the rule will not resume, cards whose approval is not current holding money a cancel would move, and a card supply short of its floor.
