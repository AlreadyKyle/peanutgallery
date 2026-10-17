# Strategy

The strategy behind Mob Machine's final state. The board's brief of 17 October 2026 asked for the studio's final, production-quality, commercially viable and scalable state, and for its strategy to be written down before it is built. `docs/specs/final-state.md` is the contract every pull request in the final-state series builds against; these files are the reasoning, the targets and the operating rules around it. `docs/PLAN.md` stays the constitution and wins any conflict, and `docs/PLAN.md` §10 decision 75 records the brief.

Nothing here changes the kernel (`docs/PLAN.md` §4 Kernel): the ledger, the spend caps, the default 80/20 split and the 10% reserve, the incident reserve, the gate, rollback, the content filter and the all-ages rating, the art policy, the broadcast delay and kill switch, and the read/write separation. XP is not money.

## The files

| File | What it answers |
|---|---|
| [mission-and-vision.md](mission-and-vision.md) | Why the studio exists, what it becomes, what it promises and the principles it will not trade |
| [users.md](users.md) | Who it is for, what each audience wants, and the problems it solves for them |
| [business-strategy.md](business-strategy.md) | How it makes money, the unit economics with every assumption stated, the path to profitability, revenue lines now and later, and when to kill or pivot |
| [prd.md](prd.md) | The product requirements of the final state, system by system, each tied to its spec section and marked Built, In this series or Later |
| [benchmarks.md](benchmarks.md) | The measurable targets for each area, how each is measured from data the studio has, and the comparable behind each number |
| [research.md](research.md) | What the reference projects do, why it works, whether it fits, and what the studio takes from each |
| [growth.md](growth.md) | Acquisition, activation, retention and sharing without referral payouts; the channel plan; content as a process; launch beats tied to product capabilities |
| [studio-team.md](studio-team.md) | The agent org chart, the new roles, hand-offs and review gates, and the game pipeline from idea to box art to ship |
| [game-quality.md](game-quality.md) | The quality bar for a Three.js game: the Game Director's rubric and the visual review's checklist |
| [operating-system.md](operating-system.md) | How the studio runs: the review team, event-driven cadences, incidents, admin and moderation, and the scaling plan |
| [roadmap.md](roadmap.md) | The phases in order, with no dates, each item with the benchmark that ends it |

## How to use these files

- **Building a feature.** Read its section in `prd.md`, then the spec section it cites. The PRD says what; the spec is the contract.
- **Judging progress.** Read `benchmarks.md`. Every target names how it is measured. A target that cannot be measured yet says what has to exist first.
- **Changing direction.** A change to a target, a phase or a principle is a pull request to these files with its reason. A change that touches money or the kernel needs its own spec and a kernel pull request (`docs/PLAN.md` §4 Work).
- **Assumptions.** Every number that is not measured is marked as an assumption with its source. The review team (`operating-system.md`) replaces an assumption with a measured figure as soon as the data exists and records the change in the file.

## How these files relate to the rest

- `docs/VISION.md` keeps the product goals and the order of bets in short form and points here for the detail.
- `docs/BACKLOG.md` lists what the final state leaves for later. Each "Later" line in `prd.md` names its backlog entry.
- `docs/research/comparables.md` holds the earlier research on Kickstarter, Star Citizen, Twitch Plays Pokémon and Humble Bundle. `research.md` builds on it and does not repeat its figures.
- `docs/SYSTEM.md` is the map of the roles that exist in `platform/agents/`. `studio-team.md` designs the team the final state needs, including roles that are not yet role files.
