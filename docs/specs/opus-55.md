# Every running role on Claude Opus 5.5

Status: done. Card: none. Owner: board.

## Problem

On 23 September 2026 the board moved every role that runs to `claude-opus-5-5`, set `.env` to match and updated the Mac's Claude Code from 2.1.139 to 2.1.280, because 2.1.139 refuses that model. The docs still said the builders run on `claude-sonnet-5` (PLAN.md §10 decision 22, the ROADMAP's "Models" fact), named no Claude Code minimum, and `.env.example` had no price row for the model.

## Scope

In: PLAN.md decision 36, superseding decision 22; the ROADMAP "Models" fact and a Claude Code fact; the 2.1.280 minimum as a standing item and a Done entry in `docs/BOARD-SETUP.md`; the `claude-opus-5-5` price row, the model values and the CLI minimum as comments in `.env.example`; one sentence in `platform/agents/README.md`; a decision line in `docs/specs/launch-managed.md`.
Out: the attended sandbox fix that 2.1.280 needed, and the `/team` live check, both in `docs/specs/carry-over.md`. Pinning the CLI version is the board's step once that fix has merged. Recorded test data that names `claude-sonnet-5` (stream fixtures, the probe recording, metering tests) records what ran and stays.

## Behaviour

The docs say what production runs: every role that runs is on `claude-opus-5-5` through `MODEL_BUILDER` and `MODEL_DIRECTOR`, the Host keeps `claude-haiku-4-5` while it does not run, and attended sessions need Claude Code 2.1.280 or newer. `.env.example` keeps its values blank, as it does for every model id, and names the values and the price row in comments.

## Acceptance criteria

- [x] PLAN.md §10 decision 36 records the models, the price row and the 2.1.280 minimum, and decision 22 says it is superseded by 36.
- [x] The ROADMAP's "Models" fact matches decision 36, and a standing fact names the 2.1.280 minimum.
- [x] `docs/BOARD-SETUP.md` names the 2.1.280 minimum as a standing item and records the update as done.
- [x] `.env.example` names the model values and the `claude-opus-5-5` price row (4 input, 20 output, 0.20 cache read, 5 and 8 for five-minute and one-hour cache writes, USD per million tokens) in comments, with every value left blank.
- [x] Claude Code 2.1.280 is installed on the Mac, and the attended sandbox check passes on it.

## Verification

- `pnpm verify`
- `~/.local/bin/claude --version`
- The attended sandbox check on 2.1.280, run and quoted in `docs/specs/carry-over.md`.

## Evidence

- `pnpm verify`, exit 0, quoted in `docs/specs/carry-over.md`, which lands in the same pull request: `docs.test.mjs` passes 15 of 15 with decision 36 cited from PLAN.md §3, the ROADMAP and `.env.example`.
- `~/.local/bin/claude --version` on 23 September 2026: `2.1.280 (Claude Code)`.
- 2.1.139 refusing the model, recorded by the session that updated the CLI on 23 September 2026: `API Error: 400 Claude Code 2.1.139 does not support this model; version 2.1.280 or newer is required.`
- The price row matches Anthropic's list price for `claude-opus-5-5`: 4 USD input and 20 USD output per million tokens, cache reads 0.20 USD; the cache writes are the standard 1.25 and 2 times input.
- The sandbox check on 2.1.280: `PASS: attended sandbox`, in `docs/specs/carry-over.md`.
- Close-out, 26 September 2026. `pnpm verify` on `origin/main` at ed63326 exits 0 with `docs.test.mjs` passing 22 of 22 (`docs/specs/launch-hardening.md`, Evidence). The Mac's Claude Code has since updated itself past the minimum: `~/.local/bin/claude --version` prints `2.1.283 (Claude Code)`, the version `platform/ops/mac/claude-code-pin.json` pins with its own `PASS: attended sandbox` in both layouts (`docs/specs/agent-upkeep.md`). The production live check that day reads `PASS /team 7 running roles, each on claude-opus-5-5: claude-opus-5-5, claude-opus-5-5, claude-opus-5-5, claude-opus-5-5, claude-opus-5-5, claude-opus-5-5, claude-opus-5-5` in `PASS live-check https://peanutgallery.games passed=279 failed=0 skipped=0`. Every Verification line is run and quoted. Status done.

## Decisions

- 23 September 2026: `.env.example` names model ids and prices in comments only and keeps every value blank, as the file does for all model ids; `.env` holds the values.
- 23 September 2026: the Host keeps `claude-haiku-4-5` while nothing runs it, as the board set.
