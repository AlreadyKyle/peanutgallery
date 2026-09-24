# The system map

Who does what at Mob Machine, what may change what, what pays for each kind of work, and where the board can step in. `docs/PLAN.md` is the constitution (§3 for the roster, §4 for cards and the board, §6 for the pipeline); this page is the map of how those rules run, and `docs/specs/agent-system-core.md` built most of it. Anything a later pull request builds is marked not built yet, with its spec.

## The roles

Sixteen roles, one role spec each in `platform/agents/` (a JSON file and a prompt). A role's class sets what it may do; `write_access` is true exactly for a writer or a planner with tools, and no role with write access reads free text from the public (the kernel's read/write separation). The status is the role's place in the launch roster: running at launch, starting on a named trigger, or planned. `docs.test.mjs` checks the name, class, status and trigger columns against the role specs.

| Role | Class | Status | Trigger | Job | Tools | May | May not |
|---|---|---|---|---|---|---|---|
| Studio Head | planner | running |  | ranks the backlog and drafts cards as structured output (not built yet: `specs/agent-workflows.md`) | Read, Glob, Grep | read the repository, the cards and board notes; propose | change the repository; approve its own drafts |
| Game Designer | planner | running |  | drafts each game card with its numbers, check lines and estimate (not built yet: `specs/agent-workflows.md`) | none | propose card drafts | approve a card; change the repository |
| Game Director | reviewer | running |  | grades game drafts against the pillars and the all-ages rating (not built yet: `specs/agent-workflows.md`) | Read, Glob, Grep | approve or refuse a draft it did not make; set its stance on a card | change the repository; grade a card it proposed, drafted or would build |
| Builder A | writer | running |  | builds funded game cards in `seed-1/` | Read, Edit, Write, Glob, Grep, Bash | change the card's allowed paths in a card session | touch a kernel path; approve a card; read public text |
| Builder B | writer | running |  | builds funded game cards in `seed-1/` | Read, Edit, Write, Glob, Grep, Bash | change the card's allowed paths in a card session | touch a kernel path; approve a card; read public text |
| QA | writer | running |  | reproduces and fixes bugs in Dust; verifies another role's build | Read, Edit, Write, Glob, Grep, Bash | change the card's allowed paths; record a qa_verify approval of a card it did not build | verify its own build; touch a kernel path |
| Platform Builder | writer | running |  | builds studio cards in `platform/site/` outside the kernel paths, once the board opens the code lane | Read, Edit, Write, Glob, Grep, Bash | change the card's allowed paths in a card session | touch a money, legal or board surface; approve a card |
| Platform Director | reviewer | running |  | grades site cards against `platform/site/DESIGN.md` and writes their check lines (not built yet: `specs/design-review.md`) | Read, Glob, Grep | grade a site card it did not build | change the repository; grade its own change |
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
                                           │
                                           ├─► paused at its ceiling ─► resumed by rule once, or by the board
                                           └─► rejected, with the failing check
vetoed by the board ─► never dealt or run; one on now with no money moves to next
```

- **Approval.** A card an agent wrote any of (source agent, or a drafter set) needs an approval: a row of `card_approvals` whose content hash is the card's current one. The hash covers the bucket, lane, folder, executor, title, summary, intent, acceptance test, design spec URL and funding target, not the estimate. The dispatcher records an approval from the grader's own result through `record_card_approval`, which no agent session can reach. A card the board files needs none. The draft path that creates agent cards is not built yet (`specs/agent-workflows.md`).
- **Dealing.** An approved agent card sits at proposed on next or later with `opens_at`, its approval time plus the cooling window. The first dispatcher tick at or after `opens_at` deals it to now (`deal_due_cards`) if it is still approved, vetoed by neither the board nor the Director, its executor is not paused, and it meets the definition of ready. Every funding path requires horizon now, so no money reaches it before then. The window ships at 0: an approved card is dealt on the next tick.
- **What the public sees.** An agent-written card is readable outside the board only while its approval is current, everywhere the public reads cards (`card_is_public`). A card whose approval is voided by raw SQL is hidden, not runnable and takes no money; if it holds money, Needs you lists it.
- **Resume by rule.** A card paused at its ceiling for the first time resumes with no one acting: its new estimate is its actual cost and its new ceiling the lower of 1.5 times that and the card maximum. If the money on its bar is short of the room the new ceiling adds, the rule tops the bar up from money not on a card yet, all or nothing (`money.top_up_card`), or waits. A card at the card maximum, or paused at its ceiling a second time, waits for the board in Needs you.

## Separation of duties

`record_card_approval` refuses, each with its own message:

- an approver that is the card's proposer, drafter or executor;
- a card whose check-line author is its executor;
- a qa_verify approval by the executor, or one that names a session that built the card;
- a grader ref that is empty, equal to the maker's ref, or already used;
- a hash other than the card's current one;
- an approver role that is paused, retired, or outside the reviewer and planner classes (a writer only for qa_verify);
- a draft verdict other than approved.

On a card that needs an approval, a hashed field changes only through a board control (`cards_agent_text_guard`), and a board edit through `set_card_horizon` records a board approval of the new content. Recording an approval changes nothing on the card.

## The job queue

A job is a name, a role, whether it calls a model, and whether it runs while the studio is paused (`jobs`). A run (`job_runs`) is queued by the board (Run now, with typed input), by pg_cron through `enqueue_job_run`, or by an event, and each has an origin: board, schedule, event or operator. A run queued by a board-origin run is board origin. A key makes each enqueue happen once, and a job holds at most one queued scheduled run. pg_cron runs in UTC.

Each dispatcher tick, after the card path, starts the oldest queued run that can start, one job at a time. A run that cannot start is finished as skipped with its reason: `role_paused`, `studio_paused` (unless the job runs while paused) or `not_board_origin` (a model-calling run the board did not queue). A board-origin model-calling run waits, queued, until a board member is signed in at /board. A running job stops at the next watch when its role or the studio pauses. At startup, runs still marked running are finished as failed with `dispatcher_restart`.

No job is registered yet: each later pull request adds its jobs with their handlers. Not built yet: `studio_ranking` and `draft_card` (`specs/agent-workflows.md`), the weekly report (`specs/studio-reports.md`) and the Janitor's drift checks (`specs/agent-upkeep.md`).

## Who pays for what

| Work | Paid from |
|---|---|
| A card session, unattended | the card's money, from the pool, within its ceiling and the caps |
| A card session, attended | the founder's plan, billed to the founder on the ledger |
| A role job that calls a model | the board's Max plan, attended only: board-origin, while a board member is signed in, billed to the founder, until an operations budget exists |
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
- Run a job now, with typed input.
- Set the caps and record Console credit purchases.
- Needs you lists what waits on the board: disputes, S1 cards, credit to buy, the ceiling pauses the rule will not resume, and cards whose approval is not current holding money a cancel would move.
