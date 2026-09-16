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

A second review found four more:
- a retried write whose first attempt committed was recorded, and taken from the pool, twice;
- a hung Supabase call had no timeout;
- a compaction request was invisible to the estimate;
- a short count of one token class sent the whole output to the estimate.

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
- Idempotent ledger writes: `ledger.request_id` and a `record_usage` that writes an id once (`20260921000200_ledger_request_id.sql`).
- A timeout on every Supabase request the dispatcher makes.

Out:
- Any other change to `record_usage` or another migration. The settle rows are ordinary non-negative rows.
- The command line's own `total_cost_usd`, which is priced from a table that is not ours. It is logged for comparison and never recorded.
- `--max-budget-usd`, which stays as the command line's own ceiling.
- Any live run of a session or the probe.

## Behaviour

**Cache writes.** `TurnUsage` carries `cache_creation_1h_input_tokens`, the part of `cache_creation_input_tokens` written to the one-hour cache. The parser reads the split from `usage.cache_creation.ephemeral_5m_input_tokens` and `ephemeral_1h_input_tokens`. Cache writes the split does not explain count as one-hour, including all of them when there is no split. `priceUsage` charges the one-hour part at `cache_write_1h` and the rest at `cache_write_5m`.

**The stream.** Claude Code writes one assistant line per content block, each with the message id and a null `stop_reason`.
- A turn ends at the first line that is not an assistant line for its id: a user line with tool results, a system or rate-limit line, the result line, another id, or the end of the stream. A line with a `stop_reason` ends it at once. The turn is metered before the next request's turn, not one turn late.
- Each `turn_usage` event carries `contentChars`, the characters of the turn's text, thinking and tool input, and `thinking`, true when the turn had a thinking block.
- A later line for any turn already emitted (A, B, A included) adds no turn and no usage. It arrives as a `turn_content` event with its characters. `message.usage` is a running total per id, so the event carries only the increase in output over the highest seen for the id, and marks a thinking block only the first time the id shows one; the estimate charges the thinking floor once per id.
- A `system` line with subtype `compact_boundary` is a `compaction` event carrying `compact_metadata.pre_tokens` (0 when missing), named for the last turn's model or the init line's model before any turn. The field names are the ones Claude Code 2.1.139 writes.
- The `end` event carries `usage` (the session total), `modelUsage` (one entry per model with input, output, cache-read and cache-write tokens and the command line's `cost_usd`, read from camelCase or snake_case fields) and `permissionDenials` (empty when the line has none).

**The session meter** (`metering.ts`). Where the stream cannot be trusted, the meter records more, never less.
- Each turn is priced with the table as a row rounded to four decimals, as `record_usage` rounds it. The row counts as recorded only once its write succeeds. A row whose write failed stays pending and is the first row settle returns.
- Every row carries a request id made when it is priced: `<card id>/<run uuid>/turn/<n>` or `.../settle/<n>` in a session, `probe/<run uuid>/...` in the probe. Every attempt to write a row, including the settle's second try of a pending turn row, uses its id, and `record_usage` writes an id once.
- A model missing from the table is priced at the highest of each rate across the table and named.
- At the end, models are grouped:
  - a model both the turns and `modelUsage` name is its own group;
  - `modelUsage` keys the turns never named, beside turn models `modelUsage` lacks, form one group settled on their total (a renamed key), priced at the highest rates of the named models the table has, with the difference row under the turn model that recorded the most;
  - keys alone are side models, each its own group;
  - turn models alone are settled on the estimate.
- A group with `modelUsage` settles each token class at the larger of `modelUsage` and the turns. A cache write the turns did not record counts as one-hour; with a single `modelUsage` entry the result line's own split is used. The difference from what the group recorded is one row.
- If `modelUsage` reports less output than the turns did, the group is a parse anomaly: its output takes the estimate, and the settlement's basis is `estimate`. A short count of any other class is covered by the larger count and is not an anomaly, so a result line one request short on input does not charge sixty thinking floors.
- Any token class `modelUsage` reports as 0 where the turns reported tokens is named in `zeroedFields` and alerted, since the field may have been renamed. Output does not move to the estimate for it unless output itself is short.
- A compaction before any turn is charged to the first turn's model when a turn arrives. If none does, it goes under the init line's model when the table prices it, otherwise the model the session was started on (`spec.model`), so it creates neither a model nobody reported nor an empty name.
- **The estimate** is used when there is no result line, when `modelUsage` is empty, for an anomaly and for a turn model `modelUsage` leaves out. Each turn's output is the largest of:
  - its reported tokens;
  - one token per three characters it wrote;
  - 1,024 tokens (`THINKING_FLOOR_TOKENS`) when it had a thinking block, because Claude Code leaves thinking text out of the stream.

  Late characters and late output add to it. Each compaction is charged as a request of `pre_tokens` input and 1,024 output tokens, since no `modelUsage` entry counts it on this path. With no result line at all, one more request is charged for the one in flight: the last turn's input again, the context it read or wrote to cache read once more, and 1,024 output tokens (`IN_FLIGHT_OUTPUT_TOKENS`).
- A negative difference is not written, since `record_usage` refuses it; it is reported as `overcountUsd`. After the per-class maximum it arises only from rounding.
- The ceiling check while the session runs uses the same estimate, request in flight included.

**The session.**
- A role model with no price returns `unknown_model` before the command line starts.
- At `start` the tool list and the account are checked, and a refused session is interrupted before the event is written; the event payload names the refusal.
- Rows are billed to the adapter's mode only once the init line confirms the account. A session on the wrong account, or an unattended session with no init line, records its rows as `billed_to = 'founder'`, so the pool never pays for spend the studio key did not make. The no-init case is alerted.
- Every ledger write is tried three times with the same request id, waiting 500 ms and then 1 s, and each failed attempt is logged with the id and the usd. A turn the ledger refuses three times stays pending and the session stops with `error`, since a ledger that refuses writes cannot hold the caps.
- Every Supabase request gives up after 8 seconds (`SUPABASE_TIMEOUT_MS`), or sooner when its caller's signal aborts, even if the connection never answers. The timeout covers every call the dispatcher makes, not only ledger writes. Only ledger writes are retried; agent events, card updates, deploys and the heartbeat are not. A slow write that commits after 8 seconds now shows up as a failure: for a ledger row the retry finds its id and records nothing twice, and for any other write the caller sees an error although the row landed.
- A turn on an unknown model is recorded at the fallback rates, then the session stops with `unknown_model`.
- After the command line exits or throws, settle runs once. Its rows are logged (id, model, tokens, usd) before any is written, then go through the same `record_usage` path, so `cards.actual_usd` includes them. A row that still fails is named with its id and usd in the `error` event and the alert, for the board to post by hand; settle never runs again.
- Every session with a result line logs one `metering estimate check` line with the same fields: `card`, `basis`, `turns`, `estimate_usd` (the no-result estimate), `settled_usd` and `cli_total_cost_usd`. The floors are tuned from these lines.
- These get one `error` event `{step: 'metering', basis, rows, unwritten_rows, billed_to, fallback_models, mismatch, anomaly, zeroed_fields, overcount_usd, cli_total_cost_usd}` and one ntfy alert:
  - a settlement on the estimate;
  - mismatched model names;
  - a turn model priced at fallback rates;
  - an overcount;
  - unwritten rows;
  - a token class reported as 0 against the turns;
  - spend recorded as the founder's because the init line reported the wrong account (the alert names the `apiKeySource` it reported), or because an unattended session had no init line.
- A side model priced at fallback rates gets the event and an alert once per model per process, not per session.
- A session that runs past `SESSION_MAX_MINUTES` (default 60) stops with `wall_clock`, which pauses the card.

**Interrupting and shutdown.** The adapter sends SIGINT, then SIGTERM after 15 seconds if the child is still running, then SIGKILL five seconds later. A result line written after SIGINT is parsed and settled. A stopping dispatcher waits up to 50 seconds for running cards, inside `docker stop`'s 60.

**The probe.**
- `runProbe` meters with the same meter; nothing is written while it runs, so every turn row is pending and settle returns it.
- `meterProbe` tries every row three times with its id, and a refused row does not stop the others. When any row is refused after every row was tried, the process stops with exit 78 naming each refused row's id, model and usd, so it does not restart and pay for another probe. A probe on the wrong account, or with no init line, is recorded as the founder's.
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
- [x] `record_usage` with the same request id twice writes one row and takes the pool once, with the same result; two ids write two rows; a null id writes a row every time; the old eight-argument named call still works; the migration runs twice after the earlier ones; its body is the founder-billing body plus the request id.
- [x] A session whose write commits but whose reply is lost retries with the same id and records the turn once; a turn refused three times is written at settle under its original id; every meter row carries an id.
- [x] A Supabase request that never answers rejects after the timeout, and the caller's signal aborts it sooner; `record_usage` receives `p_request_id`.
- [x] Settle rows are logged before the first is written, and each session with a result line logs one estimate check with the same fields.
- [x] A `compact_boundary` line with `pre_tokens` 100,000 adds 100,000 input and 1,024 output to the no-result estimate, and nothing against a result line.
- [x] Sixty thinking turns with a result line one request short on input and right on output settle on `result` with no row.
- [x] A late line carries only the increase in its id's output into the estimate (the same total again adds nothing), a thinking block counts once per id, and a line for the first of three turns (A, B, A) counts no new turn.
- [x] `record_usage` refuses a request id already written with another card, model, rounded amount or payer, and changes nothing; the same values return the existing row.
- [x] A token class reported as 0 against the turns is named and alerted, and a zeroed input alone settles on `result`.
- [x] A compaction before any turn is charged to the first turn's model, or with no turn to the session's model, never to an unpriced init name or an empty one.
- [x] The migration and its rollback hold exactly their intended statements once comments and the function body are taken out; the rollback restores the founder-billing function exactly, runs twice in PGlite, and the migration applies again after it.
- [x] The alert for spend recorded as the founder's names the `apiKeySource` the init line reported.
- [x] A probe row the ledger refuses does not stop the others, and the probe stops with exit 78 naming it.

## Verification

- `pnpm --filter @backseat/dispatcher test`
- `pnpm --filter @backseat/dispatcher typecheck`
- `pnpm test:ops`
- The recorded probe metered by the code on `gate-hardening` and by this branch, next to the command line's `total_cost_usd`.
- `pnpm verify`
- Live, after merge: the next startup probe on the VPS writes a turn row and a settle row whose sum equals its `modelUsage` at `PRICE_TABLE_JSON`, and `probe.ts` prints the metered total next to the command line's.
- Live, after merge: an interrupted card session (the board pauses it) writes a settle row on basis `result`, which shows whether Claude Code writes its result line on SIGINT.

## Production steps

The dispatcher built from this branch passes `p_request_id`, which the live `record_usage` does not take until the migration is applied. Apply the migration first; a dispatcher built before this branch keeps working after it.

1. Order. Pull request 32 adds `20260921000000_open_goal_funding.sql` and `20260921000100_public_card_columns.sql`. They touch neither `ledger` nor `record_usage`, but this migration is stamped after them: merge and apply them first. If this one reaches the live project first, pushing theirs later needs `supabase db push --include-all`, since their stamps are older.
2. Pause agents from /board and wait until no card is `building` or `gated`.
3. Before applying, check that the live function is the one this migration replaces. As the service role, run `select pg_get_functiondef('public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing)'::regprocedure);`. The text between `AS $function$` and the closing `$function$` must equal the text between `as $$` and `$$;` in the `record_usage` block of `20260918000000_founder_billing.sql`. If it differs, stop: the live function has changed since, and this migration would overwrite that change.
4. Apply `platform/supabase/migrations/20260921000200_ledger_request_id.sql` to the live project, the way the earlier migrations were applied. It is safe to run twice, and it ends with `notify pgrst, 'reload schema'` so PostgREST picks up the new signature at once.
5. Check the function, as the service role:
   - `select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'record_usage';` returns 1.
   - `select pg_get_functiondef('public.record_usage(uuid, uuid, text, integer, integer, integer, numeric, public.ledger_billing, text)'::regprocedure);` shows `p_request_id text DEFAULT NULL::text` and the request id check before the insert.
   - `select indexdef from pg_indexes where indexname = 'ledger_request_id_key';` shows the partial unique index.
6. Check that the API sees it: `curl -s "$SUPABASE_URL/rest/v1/" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" | jq '.paths["/rpc/record_usage"]' | grep p_request_id` prints a line. If it prints nothing, the schema cache has not reloaded: run `notify pgrst, 'reload schema';` and check again before deploying.
7. `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts` prints `PASS:`.
8. Deploy the dispatcher from this branch, then resume from /board.

Rollback: `platform/supabase/rollbacks/20260921000200_ledger_request_id_rollback.sql`. It lives outside `migrations/`, so no push applies it. Run it by hand, only with the dispatcher stopped and redeployed from a build before this branch, since a later build calls the nine-argument function. It drops that function, restores the founder-billing `record_usage` with its revoke and grant, drops the index and the column, and reloads the PostgREST schema. It can run twice. Then run `ledger-identity.ts` again. Dropping the column loses only the ids; every row and amount stays.

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

Second review fixes, 2026-09-16 (on 72ef598). Test first:
- Supabase: the seven text tests failed before the migration existed, and the PGlite run failed at "every migration applies in order".
- Dispatcher: before the source changed, the new and updated tests failed, including:
  - the stream tests for compaction, A, B, A and late output;
  - the metering tests for request ids, compaction and the sixty-turn case, which settled on the estimate;
  - the db tests, where the hung fetch ran to the 5 s test timeout;
  - the startup test for unwritten probe rows.

After the fixes:
- `pnpm --filter @backseat/dispatcher test`: `Test Files  24 passed (24)`, `Tests  276 passed (276)` (264 before).
- `pnpm --filter @backseat/dispatcher typecheck`: exit 0.
- `pnpm --filter @backseat/supabase test`: `Test Files  11 passed (11)`, `Tests  129 passed (129)` (122 before).
- `pnpm test:functions`: `ok | 58 passed (34 steps) | 0 failed` (33 steps before).
- `pnpm verify`: exit 0: supabase 129, seed-1 77, site 123, dispatcher 276, gate `passed=211`, agents 64, ops 22 of 23 (1 skipped), deno `58 passed (34 steps) | 0 failed`, both `GATE PASS` lines, `PASS: secret-scan files=303`.

The review's tests:
- The request id: `migration.test.ts` "ledger-request-id migration" (the body is rebuilt from the founder-billing body and compared) and the PGlite step "record_usage writes a request id once, and without one as before".
- The dispatcher's ids: `session.test.ts`, the lost reply and the refused turn; `metering.test.ts`, the pending row; `startup.test.ts`, the probe ids.
- The timeout and `p_request_id`: `db.test.ts`.
- Compaction, late output and A, B, A: `stream.test.ts` and `metering.test.ts`.
- The sixty-turn case: `metering.test.ts`.
- The logged rows and the estimate check: `session.test.ts`.
- The named key source: `session.test.ts`.
- The unwritten probe rows: `startup.test.ts`.

Focused review fixes, 2026-09-16 (on 949bf31). Test first:
- Supabase: 6 text tests failed before the change: the body identity, the check order, both allowlists and the two rollback checks. In the PGlite run, the request-id step (the mismatch refusals), the rollback step and the two steps pinned to the ledger totals after it failed.
- Dispatcher: 14 tests failed, including:
  - the running-total and thinking-once stream tests;
  - the zeroed-field and early-compaction meter tests;
  - the zeroed-input session test.

After the fixes:
- `pnpm test:functions`: `ok | 58 passed (35 steps) | 0 failed` (34 steps before).
- `pnpm --filter @backseat/supabase test`: `Test Files  11 passed (11)`, `Tests  132 passed (132)` (129 before).
- `pnpm --filter @backseat/dispatcher test`: `Test Files  24 passed (24)`, `Tests  280 passed (280)` (276 before); typecheck exit 0.
- `pnpm verify`: exit 0: supabase 132, seed-1 77, site 123, dispatcher 280, gate `passed=211`, agents 64, ops 22 of 23 (1 skipped), deno `58 passed (35 steps) | 0 failed`, both `GATE PASS` lines, `PASS: secret-scan files=304`.

The allowlist check applies to this branch's migration and rollback only; the pull request 32 migrations are not in this branch, so their files are left to that branch's tests.

Pending: the production steps above, and both live lines.

## Decisions

- 2026-09-16: the ledger settles against the result line's `modelUsage` priced with `PRICE_TABLE_JSON`, not against `total_cost_usd`. The command line prices from its own table, and the ledger's list price is ours.
- 2026-09-16: turn rows are still written as turns arrive, so the ceiling acts during the session; the settle rows only add. `record_usage` refuses a negative row, so an overcount is reported and left.
- 2026-09-16: a cache write with no split, or beyond the split, counts as one-hour, and a model with no price uses the highest rates in the table. Where the stream is unclear the ledger records more, never less.
- 2026-09-16: the estimate is one output token per three characters of text, thinking and tool input. Prose and code run nearer four, so it leans high. It is used only when the result line is missing, empty or reports less than the turns.
- 2026-09-16 (review): a thinking turn's estimated output is at least 1,024 tokens, the smallest thinking budget the Messages API accepts, because Claude Code writes thinking blocks with their text left out; the recorded probe's thinking turn would otherwise estimate 12 tokens against a real 49. A session with no result line is also charged one more request for the one in flight: the last turn's input, its cached context read again, and 1,024 output tokens. Both lean high on purpose; the estimate is the rare path and stands in for a bill we cannot see.
- 2026-09-16 (review): the ceiling uses the same estimate while the session runs, request in flight included. A thinking-heavy session reaches its ceiling sooner; the ceiling exists to stop spend before it happens, and the settle corrects the ledger afterwards.
- 2026-09-16 (review): a turn row counts as recorded only after its write succeeds, and a failed one is written at settle. A ledger that refuses a write three times stops the session with `error`: `record_usage` is what moves the pool balance, the day's spend and the card's `actual_usd`, so a session must not keep spending while its writes fail.
- 2026-09-16 (review): every token class settles at the larger of `modelUsage` and the turns. Output `modelUsage` reports below the turns sends the group's output to the estimate and alerts; the turns' counts come from the same session, so a result below them points to a parse problem rather than a saving.
- 2026-09-16 (second review): only output falls back to the estimate. A short input or cache count is already covered by taking the larger count, and sending the whole output to the estimate for it charged a thinking floor for every turn of a long session.
- 2026-09-16 (second review): a ledger write is idempotent by a request id made on the dispatcher's side when the row is priced, and `record_usage` checks it after the lock it already takes (the card's, or the pool's when there is no card). A retry cannot tell a lost reply from a failed write, so without the id the safe retry and the double debit were the same call. The id is a trailing argument with a null default, so every existing caller keeps working.
- 2026-09-16 (second review): every Supabase request times out at 8 seconds. Three tries of a hung write take about 25 seconds, so a single settle row fits the 50-second shutdown wait; the rows are logged before the first write so nothing is lost if it does not.
- 2026-09-16 (second review): a compaction is charged in the estimate as one request of its `pre_tokens` input and 1,024 output tokens. The result line's `modelUsage` already counts it, so it is not added when there is one.
- 2026-09-16 (focused review): a request id already written with a different card, model, rounded amount or payer is refused with an exception, not taken as a retry. The dispatcher never reuses an id for other values, so a mismatch is a fault to surface; the dispatcher treats the refusal as an unwritten row and alerts it.
- 2026-09-16 (focused review): the parser, not the meter, turns `message.usage` into increases, because only the parser sees message ids. The thinking floor is charged once per id for the same reason.
- 2026-09-16 (focused review): a zeroed token class is alerted but changes no amount. The larger count already charges it, and only short output needs the estimate.
- 2026-09-16 (focused review): the rollback is a file beside the migrations rather than a note, tested in PGlite, so the steps that undo the change have run before they are needed.
- 2026-09-16 (second review): a probe row the ledger refuses stops the process with exit 78 after every row is tried. The probe's spend is made either way, and a restart would only pay for another.
- 2026-09-16 (review): model names are matched between the turns and `modelUsage`. Unmatched names on both sides are reconciled on their total under the turn model, never written twice; unmatched `modelUsage` keys alone are side models and are written under their own names; an unmatched turn model is estimated. A side model at fallback rates alerts once per process, since the small fast model Claude Code calls would otherwise alert on every session.
- 2026-09-16 (review): settle runs once. A settle row that fails three tries is named with its amount for the board to post by hand, rather than retried by a second settle that could write the rest twice.
- 2026-09-16 (review): an unattended session's rows bill the pool only after the init line confirms the studio key; with no init line they are the founder's and alerted. The dispatcher's shutdown wait is 50 seconds, so the interrupt, the settle and the pause fit inside `docker stop`'s 60.
- 2026-09-16: rows go to `record_usage` already rounded to four decimals. The database rounds half away from zero and JavaScript rounds a float, so letting both round could make the meter's count differ from the ledger by a cent's hundredth per row.
- 2026-09-16: a session on the wrong account for its mode is recorded as the founder's spend. The pool holds customer money and pays only for sessions on the studio key.
- 2026-09-16: `config.ts` also refuses an unpriced `MODEL_BUILDER`. Before, only the ops scripts and the unattended probe checked it, so an attended dispatcher started and failed at the first card.
