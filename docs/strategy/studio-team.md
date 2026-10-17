# The studio team

The AI agent team the final state needs: who does what, with which tools, who hands work to whom, where it is reviewed, and how a game goes from an idea to box art to ship. `docs/SYSTEM.md` is the map of the roles that exist as role files in `platform/agents/` and is checked against them; this file designs the team, including two new roles the `final-state/community-core` branch adds as role files: the **Scout** and the **Art Director**. Neither is added to `docs/SYSTEM.md`'s table here, because that table must equal the role files; the branch that adds the files adds the rows.

## Principles

1. **Classes bind roles.** A role's class (writer, planner, reviewer, read_only, web_only) sets what it may do (`docs/SYSTEM.md`, The five classes). No role with write access reads free text from the public.
2. **Nobody grades their own work.** The role that drafts, builds or proposes something never approves it.
3. **Every hand-off is a typed object.** A role passes the next one a card, a schema-valid JSON object or a pull request, never a conversation.
4. **Progress is driven by dependencies, money and quality.** Work starts when what it depends on is done, the money for it is in hand and the previous gate passed. There are no artificial daily quotas, standups or timers. The one fixed count that remains, the Game Designer's draft limit (`docs/PLAN.md` §10 decision 69), is a guard against drafts failing in a loop and is planned to become a failure breaker (`docs/BACKLOG.md`, A card supply that keeps pace with funding).
5. **Bounded autonomy.** Each card names its allowed paths, lane and budget; each role spec names its tools; sessions stop at the card's ceiling and on a failed check (the hive coding safeguards in `research.md`).

## The org chart

```
                                    The board (humans: kill switch, legal, money duties)
                                                     │
                                               Studio Head (planner)
               ┌─────────────────────┬───────────────┼─────────────────────┬─────────────────────┐
         Game side              Visual side      Platform side         Community side        Business side
               │                     │               │                     │                     │
   Game Designer (planner)   Art Director (reviewer)  Head of Product   Scout (web_only)      Head of Finance (read_only)
   Game Director (reviewer)  Tech Artist (writer)     (web_only)        Community (web_only)  Biz Dev (web_only)
   Builder A, Builder B      Sound Designer           Platform Director Host (web_only)       HR (planner)
   (writers)                 (proposed, writer)       (reviewer)
   QA (writer)                                        Platform Builder
                                                      (writer)
                                     Janitor (read_only): drift and upkeep, across all sides
```

## The roles

### Existing roles (role files in `platform/agents/`)

| Role | Class | Job in the final state | Hands to | Receives from |
|---|---|---|---|---|
| Studio Head | planner | Picks which planned work to draft and which milestones to propose; reads the review team's reports | Game Designer, Head of Product | Review reports, backlog, ledger |
| Game Designer | planner | Drafts game and New game cards from the backlog and from the Scout's clusters, never from players' text | Game Director (draft), Builders (funded card) | Scout clusters, backlog, Studio Head |
| Game Director | reviewer | Grades game drafts against the pillars; scores each game with `game-quality.md`; reviews game frames | Draft verdict; visual verdict | Game Designer, the gate |
| Builder A, Builder B | writer | Build funded game cards in the card's allowed paths | The gate | Funded cards |
| QA | writer | Reproduces and fixes bugs; verifies another role's build | The gate, qa_verify approval | Bug cards, builds |
| Platform Builder | writer | Builds community-requested Platform cards in `platform/site/` outside kernel paths | The gate | Funded Platform cards |
| Platform Director | reviewer | Reviews site frames against `platform/site/DESIGN.md` | Visual verdict | The gate |
| Tech Artist | writer | Builds the game's look as code: shaders, outline passes, palettes, and each game's box art | The gate, Art Director | Visual cards, box art cards |
| Head of Product | web_only | Reviews the studio as a stranger, a supporter and the board meet it; drafts Platform cards from Platform suggestion clusters as typed fields | Review report; Platform drafts | Scout clusters, the site |
| Head of Finance | read_only | Explains the ledger; owns the business benchmarks in each review | Review report | Ledger |
| Janitor | read_only | Drift checks as code; dependency upkeep; owns pipeline robustness benchmarks | Findings | Repository, schema |
| HR | planner | Keeps each role spec true to the role's measured work; proposes role changes as kernel pull requests | Proposals | Scorecards, review reports |
| Biz Dev | web_only | Watches models, tools and prices outside the studio; proposes trials | Proposals | Outside sources |
| Community | web_only | Reads the studio's own channels; chooses featured seeds from the top of Trending; proposes content copy as typed fields | Featured seed choice, content fields | Discord, the gallery |
| Host | web_only | Narrates the stream behind the delay and kill switch; not running until the stream exists | Speech through the output filter | Filtered chat |

### New roles

#### Scout

- **Class:** web_only, with no tools at all. It reads text from the public and can change nothing.
- **Job:** reads queued suggestions in batches and returns only JSON valid against `platform/agents/schemas/suggestion-triage.schema.json`: area, kind (bug, feature, content, balance), a duplicate cluster id, a fit score against the pillars, safety flags, and a summary in its own words of at most 140 characters. Anything outside the schema is discarded. A suggestion flagged as an instruction to the agents is declined and never summarised (`docs/specs/final-state.md`, Suggestions).
- **Trigger:** runs when the queue holds a batch, or when the oldest queued suggestion has waited past the moderation target in `benchmarks.md`.
- **Hands to:** the suggestion's state (reviewed, clustered or declined); the Game Designer and Head of Product read its typed fields.
- **Measured by:** the share of its clusters that reach a draft; the share of its declines that the board reverses on appeal; zero schema violations accepted.
- **Name note:** Biz Dev was called the Scout until 23 September 2026 (`docs/PLAN.md` §3). The name now belongs to this role only.

#### Art Director

- **Class:** reviewer, with Read, Glob and Grep. It changes nothing in the repository.
- **Job:** owns visual quality across games: reviews box art against the box art standard in `game-quality.md`; joins the Game Director in the visual review of game frames for the art direction criteria (line weight, palette, silhouette, readability); keeps the studio's visual language consistent between games.
- **Trigger:** a card that changes a game's frames or its box art passes the gate.
- **Hands to:** a visual verdict (pass or revise with criteria), valid against `platform/agents/schemas/visual-verdict.schema.json`.
- **Never:** reviews work it directed in detail as a co-author, or approves its own proposal.
- **Measured by:** visual review first-pass rate; the art direction scores in `game-quality.md` across shipped games.

#### Proposed later: Sound Designer

A writer that builds each game's sound in code (synthesised effects and music, no samples from outside), filed as a Studio card ("Hire a sound designer") once a game passes its First playable stage. Its work is reviewed by the Game Director for feel and by the Art Director for consistency of tone. Backlog: [Sound for every game](../BACKLOG.md#sound-for-every-game).

## Hand-offs and review gates

```
 Suggestion ─► Scout ─► cluster ─► Game Designer drafts ─► Game Director grades ─► card opens (rarity set)
                                                                                         │
                                                                              crowd funds the bar
                                                                                         │
                                       Builder builds in allowed paths ◄─────────────────┘
                                                     │
                                         Gate: kernel paths, deny-list, types, tests, e2e
                                                     │
                     Visual review (frames changed): Game Director + Art Director (games),
                                                     Platform Director (site)
                                                     │
                                       Merge on green gate at the exact head ─► deploy ─► smoke
                                                     │                                    │
                                                    live ◄────────────── pass ────────────┤
                                                                       fail ─► rollback ──┘
```

| Gate | Who or what | Passes when | On failure |
|---|---|---|---|
| Draft grade | Game Director (or Platform Director for site drafts) | The draft meets every line of the rubric | Revise or withdraw |
| Definition of ready | Dispatcher, as code | The card's shape, check lines, paths, estimate and builder are valid | Refused |
| Automated checks | The gate | Every check passes at the exact head | The card returns to building, within its ceiling |
| Visual review | Directors and the Art Director | Frames meet `game-quality.md` or `platform/site/DESIGN.md` | Revise, at most twice, then pause |
| QA verify | QA, on another role's build | Behaviour matches the acceptance test | Back to the builder |
| Smoke | Deploy pipeline | The live site and game load and pass their probes | Automatic rollback |
| Kernel changes | A kernel pull request on a green gate | `docs/PLAN.md` §4 Work | Not merged |

## The game pipeline: from idea to box art to ship

A new game is made in stages. Each stage is its own New game card with its own bar, and a stage that misses its bar does not start (`docs/specs/final-state.md`, Card suits). Within a stage, work is ordered by dependency only.

| Stage | Input | Work | Output | Gate to the next stage | Funded by |
|---|---|---|---|---|---|
| 0. Idea | A suggestion cluster, a Studio Head proposal or a Biz Dev trend | Game Designer writes a one-page pitch as typed fields: genre, core loop, the first 60 seconds, the session arc, the pillars it serves | A Pitch card draft | Game Director grades it against `game-quality.md`'s design criteria | Not funded: drafting is billed to the card |
| 1. Pitch | The approved Pitch card | Game Designer turns the pitch into a design brief; Art Director writes the art direction (palette from the tokens, silhouette rules, camera); Tech Artist draws a first box art sketch | Design brief, art direction, sketch box art on the card | Directors approve the brief; the crowd funds the Prototype card | Pitch card |
| 2. Prototype | Brief | Builders make the simulation (deterministic, no Three.js import) and a grey-box Three.js scene with DOM controls; QA writes the first timeline test | Playable grey box at its own seed folder, not yet public on the home page | Game Director plays it headless and scores the core loop; the crowd funds First playable | Prototype card |
| 3. First playable | Prototype | Tech Artist applies the art direction and outline pass; Builders add juice and the first 60 seconds; QA covers accessibility and performance budgets | The game at the bar in `game-quality.md` with final box art | Visual review by the Game Director and Art Director; rubric score at or above the ship bar; performance budgets met | First playable card |
| 4. Ship | First playable | Deploy to its own play address; tile and page on the site; box art on the trophy shelf; launch beat in `growth.md` | A live game | Smoke and live check | Already funded |
| 5. Live | The live game | Game cards, suggestions, balance and content changes, one card at a time | Shipped changes | Each card's own gates | Game cards |

**Box art in the pipeline.** Sketch at Pitch (so the crowd can picture what it funds), final at First playable, reviewed by the Art Director against the box art standard, and drawn in code like everything else.

**What stops a stage.** A missed bar (the stage does not start), a failed gate (the card returns to building within its ceiling), a rubric score below the bar (the stage does not ship; a revise card is drafted), or a kill switch. Nothing else.

## Capacity

The team's capacity is set by money and the caps, not by headcount:

- Builders run in parallel up to the dispatcher's concurrency, inside the daily, monthly, per-card and usage-tier caps.
- A Studio card ("Hire a sound designer", "A third builder") adds a role or capacity. It changes a role file, so it lands as a kernel pull request funded by its card.
- Goals milestones can name capacity outcomes (a parallel builder once monthly funding covers it), never content promised for later (`research.md`, Star Citizen).

## How roles are judged and changed

Each role is judged by its outcome metrics (first-pass rates, visual review rounds, cost per shipped card, clusters that reach drafts), published as scorecards once built (`docs/BACKLOG.md`, Scorecards for every agent). HR proposes changes to a role from those metrics as kernel pull requests; the review team (`operating-system.md`) is where those proposals are triggered. A role is never changed by a vote.
