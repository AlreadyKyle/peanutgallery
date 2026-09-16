# Metering reconciliation: the ledger records what a session spent

Status: agreed. Card: none. Owner: board.

## Problem

The ledger records less than an agent session costs.
1. Claude Code writes each assistant line before the turn's output is counted. In the recorded probe (`test/fixtures/probe.jsonl`) both assistant lines carry `output_tokens: 2`, while the result line carries 49. The stream parser meters the assistant lines only and ignores the result line's `usage` and `modelUsage`.
2. `priceUsage` prices every cache write at `cache_write_5m`, though the probe's 8449 cache-write tokens all went to the one-hour cache, and `PRICE_TABLE_JSON` carries `cache_write_1h`.
3. At the live price table the probe costs $0.0343 but was metered at $0.0211.

Four smaller gaps sit next to it:
- A turn on a model missing from the price table writes no ledger row, though it was already paid for.
- The session writes its `start` event before it checks the tool list and the account.
- Only `MODEL_BUILDER` is checked against the price table, and only by the ops scripts and the unattended probe.
- A session has no wall clock.

## Scope

In:
- The five-minute and one-hour split of cache writes, in parsing and pricing.
- The result line's `usage`, `modelUsage` and `permission_denials` in the stream parser.
- A session meter that records each turn and settles the session against the result line, or an estimate when there is none. The session and the startup probe both use it.
- The fallback price for an unknown model.
- The refusal order at `start`, and founder billing for a session on the wrong account.
- A wall clock, `SESSION_MAX_MINUTES`.
- SIGINT before SIGTERM when a session is interrupted.
- A price check for every writing role's model at startup, and for `MODEL_DIRECTOR` and `MODEL_HOST` in `config.ts`, the env file generator and `provision.sh`.

Out:
- `record_usage` and every migration. The settle rows are ordinary non-negative rows.
- The command line's own `total_cost_usd`, which is priced from a table that is not ours. It is logged for comparison and never recorded.
- `--max-budget-usd`, which stays as the command line's own ceiling.
- `.env.example`, which does not list `SESSION_MAX_MINUTES` yet.
- Any live run of a session or the probe.

## Behaviour

**Cache writes.** `TurnUsage` carries `cache_creation_1h_input_tokens`, the part of `cache_creation_input_tokens` written to the one-hour cache. The parser reads the split from `usage.cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. Cache writes the split does not explain count as one-hour, including all of them when there is no split. `priceUsage` charges the one-hour part at `cache_write_1h` and the rest at `cache_write_5m`.

**The result line.** The `end` event carries three new fields:
- `usage`, the result line's session total;
- `modelUsage`, one entry per model with input, output, cache-read and cache-write tokens and the command line's `cost_usd`;
- `permissionDenials`, empty when the line has none.

Each `turn_usage` event carries `contentChars`: the characters of the turn's text, thinking and tool input.

**The session meter** (`metering.ts`).
- Each turn is priced with the table and written as a row with its usd rounded to four decimals, as `record_usage` rounds it.
- A model missing from the table is priced at the highest of each rate across the table and named.
- When the session ends, with a result line that has `modelUsage`, each model's reported tokens are priced with our table. The difference from what its turns recorded is written as one more row. A cache write the turns did not record counts as one-hour; with a single model the result line's own split is used.
- A negative difference is not written, since `record_usage` refuses it. It is reported as `overcountUsd`.
- Without a result line, the output is estimated at one token per three characters. Tokens beyond what the turns reported are written at the output rate, basis `estimate`.
- The ceiling check while the session runs uses the recorded spend plus that estimate.

**The session.**
- A role model with no price returns `unknown_model` before the command line starts.
- At `start` the tool list and the account are checked, and a refused session is interrupted before the event is written; the event payload names the refusal.
- A session on the wrong account for its mode records its rows as `billed_to = 'founder'`, so the pool never pays for spend that was not the studio key's.
- A turn on an unknown model is recorded at the fallback rates, then the session stops with `unknown_model`.
- After the command line exits or throws, the settle rows are written through the same `record_usage` path, so `cards.actual_usd` includes them. A session settled on an estimate, one priced at fallback rates, or one with an overcount gets an `error` event `{step: 'metering', basis, rows, fallback_models, overcount_usd, cli_total_cost_usd}` and one ntfy alert.
- A session that runs past `SESSION_MAX_MINUTES` (default 60) stops with `wall_clock`, which pauses the card.

**Interrupting.** The adapter sends SIGINT, then SIGTERM after 15 seconds if the child is still running, then SIGKILL five seconds later. A result line written after SIGINT is parsed and settled.

**The probe.** `runProbe` meters with the same meter. `meterProbe` writes every row, the turn rows and the settle rows. If a model had no price, it then stops the process with exit 78. A probe on the wrong account is recorded as the founder's.

**Startup and configuration.**
- `checkRoleModels` runs in both modes after the mode check and before the probe. Every active role with write access must have a priced model, its own or `MODEL_BUILDER`, or the process exits 78 naming each role.
- `config.ts` refuses a `MODEL_BUILDER`, `MODEL_DIRECTOR` or `MODEL_HOST` without a price row.
- The env file generator copies `MODEL_DIRECTOR`, `MODEL_HOST` and `SESSION_MAX_MINUTES` when set and refuses an unpriced director or host model; `provision.sh` refuses the same.

## Acceptance criteria

- [x] On the recorded probe the parser emits one `turn_usage` with 2 output tokens and 8449 cache-write tokens, all one-hour, and an `end` event with `usage.output_tokens` 49 and one `modelUsage` entry for `claude-sonnet-5` (2 in, 49 out, 0 cache read, 8449 cache write, `cost_usd` 0.05404125).
- [x] 1000 input, 1500 five-minute and 500 one-hour cache writes, 4000 cache reads and 500 output tokens at the builder-class test rates price at $0.020325; `fallbackPrice` is the highest of each rate.
- [x] At the live `claude-sonnet-5` rates the probe meters a $0.0338 turn row and a $0.0005 settle row of 47 output tokens: $0.0343, equal to the result line's `modelUsage` priced with our table, and at least the turn rows. For any recording, the total equals the priced `modelUsage`.
- [x] Without the result line the probe settles on an estimate of the output from its content; an unpriced model in `modelUsage` is priced at fallback rates and named; a negative difference is `overcountUsd` with no row.
- [x] In a session, settle rows bring the card's `actual_usd` to the priced `modelUsage`.
- [x] An unknown model mid-session writes its row at fallback rates, then the session stops `unknown_model`, and an unpriced role model never starts a session.
- [x] A session killed with no result line writes the estimate row, one `error` event with `step: metering`, and one alert.
- [x] A session past its wall clock stops `wall_clock`, and the pipeline pauses the card for it.
- [x] The refusal is decided before the `start` event is written, and a wrong-account session is billed to the founder.
- [x] The adapter sends SIGINT, then SIGTERM after the grace period, then SIGKILL; a result line after SIGINT is parsed.
- [x] `checkRoleModels` exits 78 for a writing role with an unpriced model, in either mode, before any probe.
- [x] `config.ts`, the env file generator and `provision.sh`'s node check refuse an unpriced director or host model.

## Verification

- `pnpm --filter @backseat/dispatcher test`
- `pnpm --filter @backseat/dispatcher typecheck`
- `pnpm test:ops`
- The recorded probe metered by the code on `gate-hardening` and by this branch, next to the command line's `total_cost_usd`.
- `pnpm verify`
- Live, after merge: the next startup probe on the VPS writes a turn row and a settle row whose sum equals its `modelUsage` at `PRICE_TABLE_JSON`, and `probe.ts` prints the metered total next to the command line's.
- Live, after merge: an interrupted card session (the board pauses it) writes a settle row on basis `result`, which shows whether Claude Code writes its result line on SIGINT.

## Evidence

2026-09-16, branch `metering-reconciliation` (on `gate-hardening`):

Test first. Before the source changed, the new and updated tests failed for the expected reasons:
- stream and pricing: 13 failed, including `expected 0.0192 to be 0.020325` and `fallbackPrice is not a function`. `metering.test.ts` could not import `../src/metering.js`.
- session: 9 failed.
- startup, probe-core and config: 15 failed.
- attended: 3 failed, each with `expected [ 'SIGTERM' ] to deeply equal [ 'SIGINT' ]`.
- ops: 4 failed, including the existing key-list test once `config.ts` read the new variables.
- pipeline: with `wall_clock` taken out of the pausing outcomes, the new test failed with `"failing_check": "session"`, `"stage": "rejected"`.

After the change:
- `pnpm --filter @backseat/dispatcher test`: `Test Files  23 passed (23)`, `Tests  245 passed (245)` (211 before).
- `pnpm --filter @backseat/dispatcher typecheck`: exit 0.
- `pnpm test:ops`: `tests 23, pass 22, fail 0, skipped 1` (shellcheck is not installed locally).

Criteria and the tests that prove them:
- Probe parsing: `stream.test.ts`, "usage in the recorded probe".
- Pricing: `pricing.test.ts`, the one-hour case and `fallbackPrice`.
- Probe totals, the estimate, the fallback model and the overcount: `metering.test.ts`. `probe-core.test.ts` "probeMetering" covers the probe's own path.
- Session reconciliation, the unknown model, the unpriced role, the estimate alert, the wall clock, the refusal order and founder billing: `session.test.ts`. The wall-clock pause: `pipeline.test.ts`.
- The interrupt: `attended.test.ts`, "interrupting a session".
- `checkRoleModels` and probe metering: `startup.test.ts`.
- Configuration: `config.test.ts`. The env file generator and the node check extracted from `provision.sh`: `ops.test.mjs`.

The exact probe numbers are pinned to session `c8f7d2e6-bad7-4361-b2f5-4ece9bc3c0d1`. The invariants run on any recording `probe.ts` saves.

The recorded probe at the live `claude-sonnet-5` rates (input 2, output 10, cache read 0.2, five-minute write 2.5, one-hour write 4), the gate-hardening code against this branch:

```
session_id c8f7d2e6-bad7-4361-b2f5-4ece9bc3c0d1
old metered:  0.0211 USD  ({"model":"claude-sonnet-5","input_tokens":8451,"cached_tokens":0,"output_tokens":2,"usd":0.021147})
new metered:  0.0343 USD  basis=result
  row {"model":"claude-sonnet-5","input_tokens":8451,"cached_tokens":0,"output_tokens":2,"usd":0.0338}
  row {"model":"claude-sonnet-5","input_tokens":0,"cached_tokens":0,"output_tokens":47,"usd":0.0005}
CLI total_cost_usd: 0.05404125 USD (its own table; not recorded)
```

`pnpm verify`: exit 0. The counts:
- supabase `Tests  122 passed (122)`
- seed-1 `Tests  77 passed (77)`
- site `Tests  123 passed (123)`
- dispatcher `Tests  245 passed (245)`
- gate `PASS: gate tests passed=184`
- agents `tests 64, pass 64`
- ops `tests 23, pass 22, skipped 1`
- deno `ok | 58 passed (33 steps) | 0 failed`
- `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=299`

Pending: both live lines.

## Decisions

- 2026-09-16: the ledger settles against the result line's `modelUsage` priced with `PRICE_TABLE_JSON`, not against `total_cost_usd`. The command line prices from its own table, and the ledger's list price is ours.
- 2026-09-16: turn rows are still written as turns arrive, so the ceiling acts during the session; the settle rows only add. `record_usage` refuses a negative row, so an overcount is reported and left.
- 2026-09-16: a cache write with no split, or beyond the split, counts as one-hour, and a model with no price uses the highest rates in the table. Where the stream is unclear the ledger records more, never less.
- 2026-09-16: the estimate is one output token per three characters of text, thinking and tool input. Prose and code run nearer four, so it leans high, and it is used only when no result line arrives.
- 2026-09-16: rows go to `record_usage` already rounded to four decimals. The database rounds half away from zero and JavaScript rounds a float, so letting both round could make the meter's count differ from the ledger by a cent's hundredth per row.
- 2026-09-16: a session on the wrong account for its mode is recorded as the founder's spend. The pool holds customer money and pays only for sessions on the studio key.
- 2026-09-16: `config.ts` also refuses an unpriced `MODEL_BUILDER`. Before, only the ops scripts and the unattended probe checked it, so an attended dispatcher started and failed at the first card.
