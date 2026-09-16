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

A review of the first version found paths that still recorded too little or twice:
- a turn row whose write failed still counted as recorded;
- the no-result estimate could not see thinking output or the request in flight;
- on real streams a turn was metered one turn late;
- a renamed or missing `modelUsage` field read as zero;
- a `modelUsage` key that differs from the turns' model was recorded a second time;
- a failed settle row was lost.

## Scope

In:
- The five-minute and one-hour split of cache writes, in parsing and pricing.
- The result line's `usage`, `modelUsage` and `permission_denials` in the stream parser.
- A session meter that records each turn and settles the session against the result line, or an estimate when there is none. The session and the startup probe both use it.
- The fallback price for an unknown model.
- The refusal order at `start`, and founder billing for a session on the wrong account.
- A wall clock, `SESSION_MAX_MINUTES`, documented in `.env.example`.
- SIGINT before SIGTERM when a session is interrupted.
- A price check for every writing role's model at startup, and for `MODEL_DIRECTOR` and `MODEL_HOST` in `config.ts`, the env file generator and `provision.sh`.

Out:
- `record_usage` and every migration. The settle rows are ordinary non-negative rows.
- The command line's own `total_cost_usd`, which is priced from a table that is not ours. It is logged for comparison and never recorded.
- `--max-budget-usd`, which stays as the command line's own ceiling.
- Any live run of a session or the probe.

## Behaviour

**Cache writes.** `TurnUsage` carries `cache_creation_1h_input_tokens`, the part of `cache_creation_input_tokens` written to the one-hour cache. The parser reads the split from `usage.cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. Cache writes the split does not explain count as one-hour, including all of them when there is no split. `priceUsage` charges the one-hour part at `cache_write_1h` and the rest at `cache_write_5m`.

**The stream.** Claude Code writes one assistant line per content block, each with the message id and a null `stop_reason`.
- A turn ends at the first line that is not an assistant line for its id: a user line with tool results, a system or rate-limit line, the result line, another id, or the end of the stream. A line with a `stop_reason` ends it at once. The turn is metered before the next request's turn, not one turn late.
- Each `turn_usage` event carries `contentChars`, the characters of the turn's text, thinking and tool input, and `thinking`, true when the turn had a thinking block.
- A later line for the turn just emitted adds no turn and no usage. Its characters arrive as a `turn_content` event, so the estimate still counts them.
- The `end` event carries `usage` (the session total), `modelUsage` (one entry per model with input, output, cache-read and cache-write tokens and the command line's `cost_usd`, read from camelCase or snake_case fields) and `permissionDenials` (empty when the line has none).

**The session meter** (`metering.ts`). Where the stream cannot be trusted, the meter records more, never less.
- Each turn is priced with the table as a row rounded to four decimals, as `record_usage` rounds it. The row counts as recorded only once its write succeeds. A row whose write failed stays pending and is the first row settle returns.
- A model missing from the table is priced at the highest of each rate across the table and named.
- At the end, models are grouped:
  - a model both the turns and `modelUsage` name is its own group;
  - `modelUsage` keys the turns never named, beside turn models `modelUsage` lacks, form one group settled on their total (a renamed key), priced at the highest rates of the named models the table has, with the difference row under the turn model that recorded the most;
  - keys alone are side models, each its own group;
  - turn models alone are settled on the estimate.
- A group with `modelUsage` settles each token class at the larger of `modelUsage` and the turns. A cache write the turns did not record counts as one-hour; with a single `modelUsage` entry the result line's own split is used. The difference from what the group recorded is one row.
- If `modelUsage` reports fewer tokens of any class than the turns did, the group is a parse anomaly: its output takes the estimate as well, and the settlement's basis is `estimate`.
- **The estimate** is used when there is no result line, when `modelUsage` is empty, for an anomaly and for a turn model `modelUsage` leaves out. Each turn's output is the largest of:
  - its reported tokens;
  - one token per three characters it wrote;
  - 1,024 tokens (`THINKING_FLOOR_TOKENS`) when it had a thinking block, because Claude Code leaves thinking text out of the stream.

  Late characters add to it. With no result line at all, one more request is charged for the one in flight: the last turn's input again, the context it read or wrote to cache read once more, and 1,024 output tokens (`IN_FLIGHT_OUTPUT_TOKENS`).
- A negative difference is not written, since `record_usage` refuses it; it is reported as `overcountUsd`. After the per-class maximum it arises only from rounding.
- The ceiling check while the session runs uses the same estimate, request in flight included.

**The session.**
- A role model with no price returns `unknown_model` before the command line starts.
- At `start` the tool list and the account are checked, and a refused session is interrupted before the event is written; the event payload names the refusal.
- Rows are billed to the adapter's mode only once the init line confirms the account. A session on the wrong account, or an unattended session with no init line, records its rows as `billed_to = 'founder'`, so the pool never pays for spend the studio key did not make. The no-init case is alerted.
- Every ledger write is tried three times, waiting 500 ms and then 1 s. A turn the ledger refuses three times stays pending and the session stops with `error`, since a ledger that refuses writes cannot hold the caps.
- A turn on an unknown model is recorded at the fallback rates, then the session stops with `unknown_model`.
- After the command line exits or throws, settle runs once. Its rows go through the same `record_usage` path, so `cards.actual_usd` includes them. A row that still fails is named with its usd in the `error` event and the alert, for the board to post by hand; settle never runs again.
- These get one `error` event `{step: 'metering', basis, rows, unwritten_rows, billed_to, fallback_models, mismatch, anomaly, overcount_usd, cli_total_cost_usd}` and one ntfy alert:
  - a settlement on the estimate;
  - mismatched model names;
  - a turn model priced at fallback rates;
  - an overcount;
  - unwritten rows;
  - an unattended session with no init line.
- A side model priced at fallback rates gets the event and an alert once per model per process, not per session.
- A session that runs past `SESSION_MAX_MINUTES` (default 60) stops with `wall_clock`, which pauses the card.

**Interrupting and shutdown.** The adapter sends SIGINT, then SIGTERM after 15 seconds if the child is still running, then SIGKILL five seconds later. A result line written after SIGINT is parsed and settled. A stopping dispatcher waits up to 50 seconds for running cards, inside `docker stop`'s 60.

**The probe.**
- `runProbe` meters with the same meter; nothing is written while it runs, so every turn row is pending and settle returns it.
- `meterProbe` writes every row with the same three tries. A probe on the wrong account, or with no init line, is recorded as the founder's.
- A model the probe's turns ran on that has no price stops the process with exit 78 after its rows are written, and `probe.ts` says the probe was metered at fallback rates. A side model at fallback rates is logged and does not stop it.

**Startup and configuration.**
- `checkRoleModels` runs in both modes after the mode check and before the probe. Every active role with write access must have a priced model, its own or `MODEL_BUILDER`, or the process exits 78 naming each role.
- `config.ts` refuses a `MODEL_BUILDER`, `MODEL_DIRECTOR` or `MODEL_HOST` without a price row.
- The env file generator copies `MODEL_DIRECTOR`, `MODEL_HOST` and `SESSION_MAX_MINUTES` when set and refuses an unpriced director or host model; `provision.sh` refuses the same.
- `.env.example` documents `SESSION_MAX_MINUTES`, and that `PRICE_TABLE_JSON` must list every model a session can report, including the small fast model Claude Code calls on its own.

## Acceptance criteria

- [x] On the recorded probe the parser emits one `turn_usage` with 2 output tokens, 8449 cache-write tokens, all one-hour, and a thinking block, and an `end` event with `usage.output_tokens` 49 and one `modelUsage` entry for `claude-sonnet-5` (2 in, 49 out, 0 cache read, 8449 cache write, `cost_usd` 0.05404125).
- [x] Two assistant lines with one id and a null `stop_reason`, then a user line: the `turn_usage` is emitted on the user line, before the next assistant line. System, rate-limit and result lines end a turn too; a late line for an emitted turn passes its characters on as `turn_content`.
- [x] `modelUsage` in snake_case parses.
- [x] 1000 input, 1500 five-minute and 500 one-hour cache writes, 4000 cache reads and 500 output tokens at the builder-class test rates price at $0.020325; `fallbackPrice` is the highest of each rate.
- [x] At the live `claude-sonnet-5` rates the probe meters a $0.0338 turn row and a $0.0005 settle row of 47 output tokens: $0.0343, equal to the result line's `modelUsage` priced with our table, and at least the turn rows. For any recording, the total equals the priced `modelUsage`.
- [x] Without the result line the probe's estimate is at least what the result line shows was spent: at least 47 unreported output tokens and at least $0.0343 (it is $0.056).
- [x] A turn row that was never committed is returned by settle, and the total still equals the priced `modelUsage`. In a session, a turn the ledger refuses three times is written once at settle and the session stops `error`; one refusal is retried and the session completes.
- [x] A `modelUsage` that reports fewer tokens than the turns settles on the estimate with `anomaly`, and the session alerts.
- [x] A renamed `modelUsage` key is reconciled once under the turn model, in the meter and in a session, and alerts; a turn model missing from `modelUsage` is estimated and named as a mismatch.
- [x] A side model missing from the table is priced at fallback rates; across two sessions it is alerted once. In the probe it does not stop startup; a turn model does.
- [x] A settle row the ledger refuses three times is named with its usd in the `error` event and the alert.
- [x] An unpriced model in `modelUsage` is priced at fallback rates and named; a rounding overcount is `overcountUsd` with no row.
- [x] In a session, settle rows bring the card's `actual_usd` to the priced `modelUsage`, and the ceiling check stops a session on the estimate before the recorded rows reach it.
- [x] An unknown model mid-session writes its row at fallback rates, then the session stops `unknown_model`, and an unpriced role model never starts a session.
- [x] A session killed with no result line writes the estimate row, one `error` event with `step: metering`, and one alert.
- [x] A session past its wall clock stops `wall_clock`, and the pipeline pauses the card for it.
- [x] The refusal is decided before the `start` event is written; a wrong-account session, and an unattended session with no init line, are billed to the founder.
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

After merging `origin/gate-hardening` (03182ec, no conflicts), `pnpm verify` exit 0 again: dispatcher `Tests  247 passed (247)`, gate `PASS: gate tests passed=211`, ops `tests 23, pass 22, skipped 1`, the other counts unchanged.

Review fixes, 2026-09-16 (on 53ec03b). Test first:
- The new parser tests failed 9 times before the parser changed, for example the user line returned no `turn_usage`.
- The new metering, session and startup tests, run against the reviewed source files of 53ec03b, failed 23 of 64. A renamed key was recorded twice: `+ "builder-class-20260801", 0.081` where one `builder-class` row of 0.0746 was expected. A single refused write ended the session `error` where a retry completes it. An unattended session with no init line billed the studio.

After the fixes:
- `pnpm --filter @backseat/dispatcher test`: `Test Files  23 passed (23)`, `Tests  264 passed (264)` (247 after the merge).
- `pnpm --filter @backseat/dispatcher typecheck`: exit 0.
- `pnpm test:ops`: `tests 23, pass 22, fail 0, skipped 1`.
- `pnpm verify`: exit 0: supabase 122, seed-1 77, site 123, dispatcher 264, gate `passed=211`, agents 64, ops 22 of 23 (1 skipped), deno `58 passed (33 steps) | 0 failed`, both `GATE PASS` lines, `PASS: secret-scan files=302`.

The review's tests:
- The record failure, the unwritten settle row, the renamed key, the side model alerted once and the unattended session with no init line: `session.test.ts`.
- The estimate against the real result, the uncommitted turn row, the anomaly, the mismatch in both directions and the late characters: `metering.test.ts`.
- The turn boundaries and snake_case: `stream.test.ts`.
- The probe's side model and write retries: `startup.test.ts`.

The comparison script's output for the recorded probe is unchanged: old $0.0211, new $0.0343 on basis `result`, command line $0.05404125.

Pending: both live lines.

## Decisions

- 2026-09-16: the ledger settles against the result line's `modelUsage` priced with `PRICE_TABLE_JSON`, not against `total_cost_usd`. The command line prices from its own table, and the ledger's list price is ours.
- 2026-09-16: turn rows are still written as turns arrive, so the ceiling acts during the session; the settle rows only add. `record_usage` refuses a negative row, so an overcount is reported and left.
- 2026-09-16: a cache write with no split, or beyond the split, counts as one-hour, and a model with no price uses the highest rates in the table. Where the stream is unclear the ledger records more, never less.
- 2026-09-16: the estimate is one output token per three characters of text, thinking and tool input. Prose and code run nearer four, so it leans high. It is used only when the result line is missing, empty or reports less than the turns.
- 2026-09-16 (review): a thinking turn's estimated output is at least 1,024 tokens, the smallest thinking budget the Messages API accepts, because Claude Code writes thinking blocks with their text left out; the recorded probe's thinking turn would otherwise estimate 12 tokens against a real 49. A session with no result line is also charged one more request for the one in flight: the last turn's input, its cached context read again, and 1,024 output tokens. Both lean high on purpose; the estimate is the rare path and stands in for a bill we cannot see.
- 2026-09-16 (review): the ceiling uses the same estimate while the session runs, request in flight included. A thinking-heavy session reaches its ceiling sooner; the ceiling exists to stop spend before it happens, and the settle corrects the ledger afterwards.
- 2026-09-16 (review): a turn row counts as recorded only after its write succeeds, and a failed one is written at settle. A ledger that refuses a write three times stops the session with `error`: `record_usage` is what moves the pool balance, the day's spend and the card's `actual_usd`, so a session must not keep spending while its writes fail.
- 2026-09-16 (review): every token class settles at the larger of `modelUsage` and the turns, and a class `modelUsage` reports below the turns sends the group to the estimate and alerts. The turns' counts come from the same session, so a result below them points to a parse problem rather than a saving.
- 2026-09-16 (review): model names are matched between the turns and `modelUsage`. Unmatched names on both sides are reconciled on their total under the turn model, never written twice; unmatched `modelUsage` keys alone are side models and are written under their own names; an unmatched turn model is estimated. A side model at fallback rates alerts once per process, since the small fast model Claude Code calls would otherwise alert on every session.
- 2026-09-16 (review): settle runs once. A settle row that fails three tries is named with its amount for the board to post by hand, rather than retried by a second settle that could write the rest twice.
- 2026-09-16 (review): an unattended session's rows bill the pool only after the init line confirms the studio key; with no init line they are the founder's and alerted. The dispatcher's shutdown wait is 50 seconds, so the interrupt, the settle and the pause fit inside `docker stop`'s 60.
- 2026-09-16: rows go to `record_usage` already rounded to four decimals. The database rounds half away from zero and JavaScript rounds a float, so letting both round could make the meter's count differ from the ledger by a cent's hundredth per row.
- 2026-09-16: a session on the wrong account for its mode is recorded as the founder's spend. The pool holds customer money and pays only for sessions on the studio key.
- 2026-09-16: `config.ts` also refuses an unpriced `MODEL_BUILDER`. Before, only the ops scripts and the unattended probe checked it, so an attended dispatcher started and failed at the first card.
