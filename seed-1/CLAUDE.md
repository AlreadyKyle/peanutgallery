# seed-1: Dust

The first game. An idle game about dust: it accrues on its own, strikes add a little more, units raise the rate, and unlocks open new units and raise production.

## Pillars

Idle/incremental. One screen. Mobile-first: the screen fits a 375px portrait phone with no sideways scroll, and every control is at least a 44px touch target there (`docs/PLAN.md` §10 decision 56). Numbers go up. Every feature is visible within 60 seconds of play. A session of two minutes is satisfying. All-ages. Procedural or vector art only.

## Layout

- `sim/` is the pure simulation: `createSim(config, seed)`, `step(state, config, dtSeconds)`, `apply(state, config, action)`, the selectors `ratePerSecond`, `costOf`, `availableUnits`, the state hash, and `checkInvariants(log)`. It imports nothing from Phaser and never touches the network, the clock or `Math.random`; the only randomness is the mulberry32 state carried in `SimState`. `sim/save.ts` serializes and parses `SimState` for save and resume, with a version in the save wrapper rather than in `SimState`, so the hash `tests/timeline.test.ts` pins is untouched.
- `config/` and `content/` are the config lane: `spawn-table.json` (units, base costs, rates), `unlocks.json` (thresholds and effects) and `strings.json` (the strings the canvas draws and the tab title). They are data, read at runtime, copied into `dist/` verbatim by the build, and served with `Cache-Control: no-cache`.
- `render/` is the Phaser 3 scene. One screen, drawn with Graphics primitives and text only, no image assets. It fetches the config and content files at runtime.
  - `render/layout.ts` is the Phaser-free unlock-list layout: earned unlocks collapse to one line and the next three unearned show below, so the list fits the canvas at any count (`tests/layout.test.ts`).
  - The scene saves to localStorage under the key `dust.save` every 5 seconds, when the tab is hidden and on `pagehide`, and `render/main.ts` resumes from that save on load. The scene steps by wall-clock time, not Phaser's frame delta, so a background tab is credited when it returns; the save records when it was written (`savedAt`), and loading credits the time since. Both go through `awaySeconds` in `sim/save.ts`, clamped to between 0 and 8 hours.
  - `render/controls.ts` is the accessible DOM layer: the canvas is `aria-hidden`, and a controls region in the `<main>` landmark holds real buttons for Strike and each available unit (name, cost, owned; `aria-disabled` when unaffordable) driving the same `apply` actions through the scene, plus a polite live region. It is visually hidden until focus enters it, then shows as a panel over the bottom of the canvas. `render/a11y.ts` is its Phaser-free half (labels and the announcer: purchases and unlocks at once, the dust total at most every 10 seconds; `tests/a11y.test.ts`), with its text under `a11y` in `content/strings.json`. `e2e/a11y.spec.ts` plays with the keyboard only and runs axe.
  - Feedback, in `render/scene.ts`: a strike floats its yield ("+N") off the button, a purchase pulses the dust total, a new unlock shows a toast over the title row, and a load that credited at least a minute away shows "While you were away: +N dust in 2h 14m" (the gain `render/main.ts` computes from the save). Movement is skipped under `prefers-reduced-motion`. The unlock toast appears without a tween because an unlock can land inside the gate's frame draws, and tween timing is not frame-exact.
  - `render/share.ts` wires the "Share your run" button under the canvas: the phone's share sheet, else the clipboard, else a plain message, with text from `share` in `content/strings.json` stating total dust, unlocks and the game's address (`tests/share.test.ts`). Where the share sheet takes files, `render/share-image.ts` adds a 1200 by 630 PNG of the run drawn in code (dust, unlocks by name in at most two rows of pills, the address), made synchronously so the sheet opens inside the click; a share sheet that refuses for any reason but the player dismissing it falls back to the clipboard. The button and its status line are in `index.html`.
  - `render/next-card.ts` is the Phaser-free next card line under the studio line: it reads the site's public documents `/api/live` and `/api/cards` (read only; `netlify.toml` proxies both paths to https://mobmachine.games, so the fetch stays on this origin under `connect-src 'self'`), picks the first card in the waterfall's funding order whose folder is seed-1, and shows its title and funding bar as one link (at least 44px tall) to its card page, https://mobmachine.games/card/<id>. No open Dust card, a failed read or a malformed document leaves the line hidden; nothing is drawn over the canvas (`tests/next-card.test.ts`). Its elements are in `index.html`, its words in the module.
  - `render/whats-new.ts` is the Phaser-free "what's new" line above the next card line, for returning players: when a save exists under `dust.save` and an earlier visit was recorded under its own key `dust.lastVisit` (kept apart from the sim save, so `SimState` and its hash are untouched), it reads `/api/cards` and lists the seed-1 cards at stage `live` whose `live_at` is after that visit, newest first, as one link (at least 44px tall) to the newest card's page: "New in Dust since your last visit: <title>" or "N changes shipped since your last visit. Newest: <title>". The last visit moves to now once the read succeeds, or at once on a first visit. A first visit, nothing new, a failed read or a malformed document leaves it hidden (`tests/whats-new.test.ts`, `docs/specs/whats-new.md`). Its elements are in `index.html`, its words in the module.
  - `render/favicon.svg` is the hand-drawn tab icon, linked from `index.html` so Vite bundles it.
- `scripts/og-image.mjs` draws the link preview picture: a 1200 by 630 PNG of the favicon's dust pile, the name in block letters, a bar and pills, in the scene's palette, rasterised in code and encoded with `node:zlib` (no image asset, font or dependency). `scripts/postbuild.mjs` writes it to `dist/og-dust.png`, and the `og:image` and `twitter:image` tags in `index.html` name it at https://play.mobmachine.games/og-dust.png with its own alt text (`tests/og-image.test.ts`).
- Strings. The tab title the game sets once its data loads and every string the canvas draws come from `content/strings.json`, except unit and unlock names, which come from the `config/` files. Some text lives in code instead, because it shows before `strings.json` loads, when it fails to load, or outside the canvas:
  - `index.html`: the initial `<title>`, the meta description and the Open Graph tags, the "Loading the game data." status line, the visually hidden "Dust" heading, the controls region's initial "Game controls" label, and the studio line "Made by AI agents at Mob Machine · All ages" with its link to https://mobmachine.games and "See what players are funding next" linking to https://mobmachine.games/contribute, the hidden what's new line `render/whats-new.ts` fills, the hidden next card line `render/next-card.ts` fills, and the "Share your run" button, its space reserved and `render/share.ts` making it visible. The page carries the all-ages label and the studio link, so it is protected: only a kernel pull request changes it.
  - `render/main.ts`: "The game data did not load. Reload the page to try again." Changing it is a code-lane card.
- `bots/` holds the greedy bot and its command line. `loadConfigFromDir(dir)` lives here because it reads the filesystem.
- `tests/` are vitest suites. `tests/fixtures/config/` is a frozen copy of the config; the pinned unlock timeline runs against the fixture, not the live config, so a config-lane card cannot break the pinned test.

## Rules of the sim

Production per second is `1 + sum(rate x owned)` times every unlocked multiplier. A unit costs `round(baseCost x 1.25^owned)`. An unlock opens when lifetime dust reaches `atTotalDust`. Gatherer is available from the start because no unlock row gates it.

## Lanes

A config-lane card changes values inside the `.json` files of `config/` or `content/` and nothing else: costs, rates, thresholds, names, descriptions, unlock order. Those folders hold `.json` files only; the dispatcher and the gate refuse any other file there on a config-lane card. It runs the bot and the build, not the test suite. A card that needs a new function, a new field, a new file or any change under `sim/`, `render/` or the tests is a code-lane card and runs the full gate.

## Protected paths

No agent may change these, in any lane; the dispatcher rejects the card and the gate fails a card branch that touches one (`platform/gate/kernel-paths.txt` is the list): this `CLAUDE.md`, `bots/`, `scripts/`, `index.html`, `package.json`, `netlify.toml`, `vite.config.ts`, `tsconfig.json`, `sim/hash.ts`, `sim/rng.ts`, `sim/invariants.ts`, `tests/bot.test.ts`, `tests/invariants.test.ts`, `tests/timeline.test.ts`, `e2e/` and `playwright.config.ts`. They are the gate's harness for this game, its determinism, the frames the design review reads (the frame spec in e2e, docs/specs/design-review.md) and the page that carries the rating: only a kernel pull request changes them. The game's favicon in render is a kernel design file (`platform/gate/design-paths.txt`): no card changes it either. No agent may create or change a file with a name from `platform/gate/kernel-names.txt` either, at any depth: build, package, env and deploy configs such as a PostCSS config, a nested tsconfig, an env file or a Netlify headers file.

## Commands

From the repository root:

- `pnpm --filter @backseat/seed-1 typecheck`
- `pnpm --filter @backseat/seed-1 test`
- `pnpm --filter @backseat/seed-1 build` (typecheck, Vite build, then `scripts/postbuild.mjs` copies `config/` and `content/` into `dist/`, draws `dist/og-dust.png` and writes `dist/version.json`)
- `pnpm --filter @backseat/seed-1 bot -- --config-dir seed-1/config --hours 10 --seed 20260914 --json`

The bot resolves `--config-dir` against the directory pnpm was invoked from. It prints one JSON object with `--json` (otherwise a `PASS:`/`FAIL:` summary), exits 0 when every invariant holds, 1 when one fails or a config file does not parse, and 2 for a usage error or a config directory it cannot read. The invariants: dust never negative, every number in the state finite, at least one unlock in every completed simulated hour, and the same seed producing the same state hash twice. `--real-seconds N` bounds wall time: the first play stops after N/2 real seconds and the determinism replay repeats the same ticks in about the same time.

## Kernel

No agent with write access reads free text from the public. A session here receives only the card, the repository CLAUDE.md, this file and the role prompt.
