# seed-1: Dust

The first game. An idle game about dust: it accrues on its own, strikes add a little more, units raise the rate, and unlocks open new units and raise production.

## Pillars

Idle/incremental. One screen. Numbers go up. Every feature is visible within 60 seconds of play. A session of two minutes is satisfying. All-ages. Procedural or vector art only.

## Layout

- `sim/` is the pure simulation: `createSim(config, seed)`, `step(state, config, dtSeconds)`, `apply(state, config, action)`, the selectors `ratePerSecond`, `costOf`, `availableUnits`, the state hash, and `checkInvariants(log)`. It imports nothing from Phaser and never touches the network, the clock or `Math.random`; the only randomness is the mulberry32 state carried in `SimState`.
- `config/` and `content/` are the config lane: `spawn-table.json` (units, base costs, rates), `unlocks.json` (thresholds and effects) and `strings.json` (every string the screen shows). They are data, read at runtime, copied into `dist/` verbatim by the build, and served with `Cache-Control: no-cache`.
- `render/` is the Phaser 3 scene. One screen, drawn with Graphics primitives and text only, no image assets. It fetches the config and content files at runtime. Two bootstrap strings live in code rather than in `strings.json` because they show before or when `strings.json` fails to load: "Loading the game data." in `index.html` and "The game data did not load. Reload the page to try again." in `render/main.ts`; changing either is a code-lane card.
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
