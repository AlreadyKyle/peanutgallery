# Launch cards: a pass on the production cards

Status: built. Card: none. Owner: board.

## Problem

Production holds nine cards (read through the public anon endpoint on 22 September 2026). The three shipped test runs are titled in config terms ("Spawn table: gatherer baseCost 10 to 11") and have no summary, and one shipped directive uses the inside term "game shell". The three open cards ask $2 to $3 for changes whose measured cost is under $0.06, one of them is titled in config terms, and none has the horizon and rank the backlog migration adds. A game bug no card covers can show the unlock count as "13 of 12". At launch the platform code lane is closed (audit F11), so every new card is a seed-1 card.

## Scope

In: `platform/supabase/seed/launch-cards.json`, the cards as the board wants them at launch; `platform/supabase/scripts/refresh-cards.ts`, which plans and writes them; its test and fixtures under `platform/supabase/test/`.

Out: applying the file to production (a production step below); the site's display of horizon and rank (SITE); backlog cards and `docs/BACKLOG.md` (DOCS, DB); a `board_actions` row per change, because that table's columns are not in the contract.

## Behaviour

**Live cards.** All six are listed by id with the title they carry now. Five get a plain title, and the three test runs get their first summary. "The unlock list fits any number of unlocks" was already plain and stays as it is. Only the title and summary change. Stage, money, commits, `live_at`, the agents' brief and the board's reason for building each card stay as they are.

**Open cards.** All three still make sense. Their checks are false on main, and the bot passes every invariant with each change, so none is retired. Each is rewritten in plain words, keeps its stage, and moves to horizon `now` with a rank, a $0.50 target, an estimate equal to the target, and the board's reason.

**Launch slate.** Three new seed-1 game cards in the code lane, at stage `proposed` with a $1.50 target. With the three open cards, six cards sit on `now`:

| Rank | Card | Lane | Executor | Target |
|---|---|---|---|---|
| 1 | Stop the unlock count from showing more unlocks than exist | code | Builder A | $1.50 |
| 2 | Add Quiet rooms, a fourteenth unlock after Polished rails | config | Builder A | $0.50 |
| 3 | Lower the Cart's starting price from 150 to 120 dust | config | Builder A | $0.50 |
| 4 | Show how long until the next unlock | code | Builder B | $1.50 |
| 5 | Show how much dust each strike adds | code | Builder B | $1.50 |
| 6 | Rename the Gatherer to Sweeper | config | Builder B | $0.50 |

**The unlock count bug.** `render/scene.ts` fills "{unlocked} of {total} unlocked" with `state.unlocked.length`, which counts every unlock event in the player's save. `parseSavedState` keeps an event whose id the config no longer has. After an unlock is removed, a player who had earned them all reads "13 of 12 unlocked"; after an unlock id is renamed, they read "14 of 13". The "{count} unlocks earned" line is right, because `layoutUnlockList` counts only config rows. The card counts only rows that exist and renames the placeholder to `{earned}`. That string is the card's `check:` line, because the definition of ready needs one and a pure code fix changes no config value.

**Targets.** Each target is five times the highest measured cost for its lane, rounded up to the next 50 cents. The costs are in the Evidence of `docs/specs/week1-runs.md`. Config: run 1 cost $0.0585, the most of the three test runs ($0.0330 to $0.0585), which gives $0.50. Code: D1 cost $0.2868, the most of D1 to D3 ($0.1152 to $0.2868), which gives $1.50. A card's spend ceiling is 1.5 times its estimate, so $0.75 and $2.25. Money beyond a card's cost funds later cards.

**The script.** `refresh-cards.ts` takes exactly one of `--dry-run` or `--apply`. It reads every card the file names, by id for existing cards and by title for new ones. It checks the whole plan, then prints each write with every field before and after and the board's reason. `--dry-run` stops there. `--apply` writes updates first, then inserts. A second run finds nothing to change.

It refuses the whole plan, writing nothing, when:
- a card is missing, or its title is neither the one the file expects nor the new one;
- a live card is no longer live, or an open card is no longer open;
- a card for `now` fails the definition of ready: title, summary, intent, a `check:` line that parses, a lane, a folder, an active executor, and a target above zero;
- a card is in the config lane outside seed-1, or in the platform code lane;
- the dispatcher's pre-check would reject a card, because its checks already hold on main;
- a card with money on its bar would get a new target;
- a card to retire is not in one of `cancel_card`'s stages (proposed, designing, voted, funded, paused), or holds money.

Each update applies only while the card is still at the stage the plan read. A card that moved stops the run, and a rerun plans again from there.

The script uses the service role because `board_role()` is null for it, so it cannot call `set_card_horizon`, `cancel_card` or `file_card`. It applies their refusals itself. It writes `board_reason` on open, new and retired cards. On a live card it prints the reason for the rewrite but does not write it, because that column holds the reason the card was built.

## Acceptance criteria

- [x] The file lists the six live and three open production cards by id and current title (test: `rewrites all six live cards and all three open cards by the ids and titles production holds`).
- [x] Every title is at most 80 characters and every summary at most 200. Titles and summaries are in sentence case, with no em dash, no vote wording, no inside terms, no file names and no dates (test: `keeps every title and summary inside the copy rules`).
- [x] The launch slate has three to six new seed-1 game cards, one of them the unlock count fix (test: `files a launch slate of three to six new game cards in seed-1, one of them the unlock count fix`).
- [x] Every card on `now` meets the definition of ready, with Builder A or B as its active executor and ranks 1 to 6 (test: `puts every open and new card on horizon now ready to fund, with ranks 1 to n`).
- [x] Targets follow the lane rule: $0.50 config, $1.50 code (test: `sets each target from its lane's measured cost`).
- [x] Every `check:` line is false on the seed-1 files at the launch commit, passes the dispatcher's pre-check, and holds after the change its brief describes (test: `has every check: line false on the frozen seed-1 files and true after the change the card describes`).
- [x] A dry run writes nothing and prints each field before and after with the board's reason (tests: `plans five live rewrites…`, `prints every change…`).
- [x] Apply writes the plan, leaves every live card's history unchanged, and a second run changes nothing (test: `writes the plan, leaves the history of live cards alone, and changes nothing on a second run`).
- [x] Each refusal listed under Behaviour writes nothing (tests under `refusals` and `retiring a card`).
- [x] Updates are by id and stage, inserts return the new id, and a database without `cards.horizon` names the migration (tests under `supabaseStore`, and `stops when a card moved stage between the plan and the write`).
- [x] The bot passes every invariant on the live config with each open card's change, alone and together (Evidence).
- [x] The unlock count bug reproduces against seed-1 at the launch commit (Evidence).
- [ ] The dry run against production is quoted, with no refusals (waits on: DB's migrations `20260922000000` to `20260922000400` applied after DB merges, and this change merged).
- [ ] The apply against production is quoted, and a second dry run prints `0 update(s), 0 insert(s), 12 unchanged` (waits on: the dry run above and the board's allow).
- [ ] An anon read after the apply shows the new titles and six cards on `now` with ranks 1 to 6 (waits on: the apply).

## Verification

- `pnpm verify`
- `pnpm --filter @backseat/supabase exec vitest run test/refresh-cards.test.ts`
- The greedy bot on the live config and on copies with each open card's change: `pnpm --filter @backseat/seed-1 bot -- --config-dir <dir> --hours 10 --seed 20260914 --json`.
- A throwaway script under `seed-1/` that saves after every unlock is earned, restores the save under a config with one unlock removed or renamed, and prints the count the scene draws and the earned line. It was deleted after the run.
- Production steps 2 to 5 below, quoted (waits on: DB merged and its migrations applied, this change merged, the board's allow).

## Production steps (need the board's allow)

1. After DB's migrations `20260922000000` to `20260922000400` are applied and this change is on main: pause the studio, and make sure no dispatcher is running on the Mac or the VPS (audit F72).
2. From main, run `pnpm --filter @backseat/supabase exec tsx scripts/refresh-cards.ts --dry-run`. Quote the output. It must end with `dry run: 8 update(s), 3 insert(s), 1 unchanged; nothing written, pass --apply to write` and show no `refused` line.
3. Run `pnpm --filter @backseat/supabase exec tsx scripts/refresh-cards.ts --apply` and quote it. It ends with `done: 8 updated, 3 inserted, 1 unchanged`.
4. Run `--dry-run` again and quote it. It ends with `0 update(s), 0 insert(s), 12 unchanged`.
5. Read the cards through the anon endpoint (`id,title,summary,stage,horizon,rank,funding_target_usd`) and quote the titles before and after.
6. Resume the studio.

## Evidence

- `pnpm verify`: exit 0. Supabase 188 tests in 12 files (146 before, plus 42 in `refresh-cards.test.ts`), dispatcher 374, site 163, seed-1 77, gate tests 213, Deno 71, secret scan PASS, docs 4.
- `pnpm --filter @backseat/supabase exec vitest run test/refresh-cards.test.ts`: `Tests  42 passed (42)`.
- A mutation check: changing the strike card's check to `"{amount}"` fails `has every check: line false … and true after the change the card describes` with `expected false to be true`.
- The bot, ten simulated hours, seed 20260914, one line per config copy (`quiet` adds Quiet rooms, `cart` sets the Cart to 120, `rename` renames the Gatherer, `all` has all three), summarised from its `--json` output:
  - `## live: ok all invariants hold last unlocks [{'id': 'deeper-veins', 'atSeconds': 30848}, {'id': 'polished-rails', 'atSeconds': 34512}] final total dust 210706643`
  - `## quiet: ok all invariants hold last unlocks [{'id': 'deeper-veins', 'atSeconds': 30848}, {'id': 'polished-rails', 'atSeconds': 34512}] final total dust 210706643`
  - `## cart: ok all invariants hold last unlocks [{'id': 'deeper-veins', 'atSeconds': 30655}, {'id': 'polished-rails', 'atSeconds': 34318}] final total dust 214074503`
  - `## rename: ok all invariants hold last unlocks [{'id': 'deeper-veins', 'atSeconds': 30848}, {'id': 'polished-rails', 'atSeconds': 34512}] final total dust 210706643`
  - `## quiet+cart: ok all invariants hold last unlocks [{'id': 'deeper-veins', 'atSeconds': 30655}, {'id': 'polished-rails', 'atSeconds': 34318}] final total dust 214074503`
  - `## all: ok all invariants hold last unlocks [{'id': 'deeper-veins', 'atSeconds': 30655}, {'id': 'polished-rails', 'atSeconds': 34318}] final total dust 214074503`
- The unlock count, as the scene fills it, against seed-1 at the launch commit:
  - `live config, all earned: 13 of 13 unlocked | 13 unlocks earned`
  - `one unlock removed:      13 of 12 unlocked | 12 unlocks earned`
  - `one unlock id renamed:   14 of 13 unlocked | 13 unlocks earned`
- The plan against the production fixture: `{ updates: 8, inserts: 3, unchanged: 1 }`, with no refusals.

## Decisions

- 22 September 2026: no open card is retired. Each is small and all-ages, its checks are false on main, and the bot passes with its change. Retiring stays in the script for later use (`retire`, with `cancel_card`'s stages and no money on the card).
- 22 September 2026: targets are five times the lane's highest measured cost, rounded up to 50 cents. The costs come from attended runs billed to the founder. The first unattended runs measure the managed sessions, and the board can re-set targets from those.
- 22 September 2026: the launch slate is three code-lane game cards, and the three open config cards give the config lane its share. Each code card changes `content/strings.json` and `render/scene.ts`, so two of them built at the same time can conflict when the second one merges.
- 22 September 2026: a live card's `board_reason` is history, so the reason for its rewrite is printed and quoted here rather than written over it.
