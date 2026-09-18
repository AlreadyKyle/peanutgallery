# seed-1: Dust

The first game. An idle game about dust: it accrues on its own, strikes add a little more, units raise the rate, and unlocks open new units and raise production.

## Pillars

Idle/incremental. One screen. Numbers go up. Every feature is visible within 60 seconds of play. A session of two minutes is satisfying. All-ages. Procedural or vector art only.

## Layout

- `sim/` is the pure simulation: `createSim(config, seed)`, `step(state, config, dtSeconds)`, `apply(state, config, action)`, the selectors `ratePerSecond`, `costOf`, `availableUnits`, the state hash, and `checkInvariants(log)`. It imports nothing from Phaser and never touches the network, the clock or `Math.random`; the only randomness is the mulberry32 state carried in `SimState`. `sim/save.ts` serializes and parses `SimState` for save and resume, with a version in the save wrapper rather than in `SimState`, so the hash `tests/timeline.test.ts` pins is untouched.
- `config/` and `content/` are the config lane: `spawn-table.json` (units, base costs, rates), `unlocks.json` (thresholds and effects) and `strings.json` (the strings the canvas draws and the tab title). They are data, read at runtime, copied into `dist/` verbatim by the build, and served with `Cache-Control: no-cache`.
- `render/` is the Phaser 3 scene. One screen, drawn with Graphics primitives and text only, no image assets. It fetches the config and content files at runtime.
  - `render/layout.ts` is the Phaser-free unlock-list layout: earned unlocks collapse to one line and the next three unearned show below, so the list fits the canvas at any count (`tests/layout.test.ts`).
  - The scene saves to localStorage under the key `dust.save` every 5 seconds, when the tab is hidden and on `pagehide`, and `render/main.ts` resumes from that save on load.
  - `render/favicon.svg` is the hand-drawn tab icon, linked from `index.html` so Vite bundles it.
- Strings. The tab title the game sets once its data loads and every string the canvas draws come from `content/strings.json`, except unit and unlock names, which come from the `config/` files. Some text lives in code instead, because it shows before `strings.json` loads, when it fails to load, or outside the canvas; changing any of it is a code-lane card:
  - `index.html`: the initial `<title>`, the meta description and the Open Graph tags, the "Loading the game data." status line, and the studio line "Made by AI agents at Peanut Gallery · All ages" with its link to https://peanutgallery.games.
  - `render/main.ts`: "The game data did not load. Reload the page to try again."
- `bots/` holds the greedy bot and its command line. `loadConfigFromDir(dir)` lives here because it reads the filesystem.
- `tests/` are vitest suites. `tests/fixtures/config/` is a frozen copy of the config; the pinned unlock timeline runs against the fixture, not the live config, so a config-lane card cannot break the pinned test.

## Rules of the sim

Production per second is `1 + sum(rate x owned)` times every unlocked multiplier. A unit costs `round(baseCost x 1.25^owned)`. An unlock opens when lifetime dust reaches `atTotalDust`. Gatherer is available from the start because no unlock row gates it.

## Lanes

A config-lane card changes values inside `config/` or `content/` and nothing else: costs, rates, thresholds, names, descriptions, unlock order. It runs the bot and the build, not the test suite. A card that needs a new function, a new field, a new file or any change under `sim/`, `render/` or the tests is a code-lane card and runs the full gate.

## Protected paths

No agent may change these, in any lane; the dispatcher rejects the card and the gate fails a card branch that touches one (`platform/gate/kernel-paths.txt` is the list): this `CLAUDE.md`, `bots/`, `scripts/`, `package.json`, `netlify.toml`, `vite.config.ts`, `tsconfig.json`, `sim/invariants.ts`, `tests/bot.test.ts` and `tests/invariants.test.ts`. They are the gate's harness for this game: the board changes them.

## Commands

From the repository root:

- `pnpm --filter @backseat/seed-1 typecheck`
- `pnpm --filter @backseat/seed-1 test`
- `pnpm --filter @backseat/seed-1 build` (typecheck, Vite build, then `scripts/postbuild.mjs` copies `config/` and `content/` into `dist/` and writes `dist/version.json`)
- `pnpm --filter @backseat/seed-1 bot -- --config-dir seed-1/config --hours 10 --seed 20260914 --json`

The bot resolves `--config-dir` against the directory pnpm was invoked from. It prints one JSON object with `--json` (otherwise a `PASS:`/`FAIL:` summary), exits 0 when every invariant holds, 1 when one fails or a config file does not parse, and 2 for a usage error or a config directory it cannot read. The invariants: dust never negative, every number in the state finite, at least one unlock in every completed simulated hour, and the same seed producing the same state hash twice. `--real-seconds N` bounds wall time: the first play stops after N/2 real seconds and the determinism replay repeats the same ticks in about the same time.

## Kernel

No agent with write access reads free text from the public. A session here receives only the card, the repository CLAUDE.md, this file and the role prompt.
