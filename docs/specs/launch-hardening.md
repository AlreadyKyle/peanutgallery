# Launch hardening: founder billing, the daily cap, restarts, the kernel, rollback, alerts

Status: built. Card: none. Owner: board.

## Problem

The dispatcher has never run against production, and six things stop it from running unattended in public:
1. An attended session on the founder's subscription is metered against the pool, so the studio's own build work would spend supporters' money. The week-1 seed papers over this with a $50 founder credit that the studio key would later spend.
2. `daily_spent_usd` resets only when usage is recorded. A tick refuses to start a card at the cap, so after one capped day nothing runs again.
3. A clean shutdown pauses the studio, so every restart or reboot waits for a board member to press Resume.
4. The platform code lane covers all of `platform/`, including the gate, the dispatcher and the migrations. The gate runs from the pull request branch.
5. When a merged change fails its deploy or smoke test, the old Netlify deploy is restored but main keeps the bad commit, and the next merge ships it again.
6. Nobody is told when the dispatcher dies, a card is rejected or the cap is hit.

## Scope

In:
- `ledger.billed_to` and a billing-aware `record_usage`.
- A throttle that ignores the pool in attended mode.
- A daily-cap check that reads today's spend.
- Restarts without a pause.
- Kernel paths refused in every lane, and a gate check for them.
- A revert commit on main after a failed deploy or smoke.
- A healthcheck ping and ntfy alerts.
- The week-1 seed without a founder credit.

Out: the VPS (`vps.md`), refunds and holds (`refunds-and-holds.md`), a board rollback button, TOTP.

## Behaviour

**Billing.** Every ledger row says who paid.
- In attended mode the dispatcher records `billed_to = 'founder'`. The row is priced and counts toward the card's `actual_usd`, but it does not touch `pool.balance_usd`, `daily_spent_usd` or the incident reserve.
- In unattended mode it records `billed_to = 'studio'` and the pool pays as before.
- Anon sees studio rows only, both in `ledger` and in `public_ledger_totals`. The founder's tokens are tracked and never published (PLAN.md §4 The Board).
- In attended mode a tick ignores the balance, the daily cap and the hourly-rate concurrency. It still needs a board session and runs one card at a time. The per-card ceiling and turn cap apply in both modes.

**Daily cap.** A tick treats `daily_spent_usd` as zero when `pool.day` is not today in New York.

**Restarts.** Stopping the dispatcher leaves `studio_state.paused` as it was. Startup already pauses any card left in `building` or `gated`.

**Kernel paths.** No agent may change these files in any lane:
- the gate
- the dispatcher
- the Supabase folder
- the role specs
- the workflows
- the constitution
- the seed's invariants, bots, test harness entries and build scripts
- the site's build and end-to-end configuration

The list lives in `platform/gate/kernel-paths.txt`, and the dispatcher's copy is tested equal to it. The platform code lane is `platform/site` only. On a `card/*` branch the gate restores `platform/gate` from the base commit before it runs and fails when the branch changes a kernel path.

**Rollback.**
- When a merged card's deploy fails, the dispatcher writes a commit on main whose tree is the merge commit's parent, with the merge commit as its parent. The ref update is fast-forward only, so a moved main refuses it.
- When the smoke test fails, the previous green deploy is restored first, then the same revert commit is written.
- The `revert` event names the revert commit or the reason it could not be written.

**Alerts.**
- With `HEALTHCHECK_URL` set, every tick pings it; healthchecks.io emails the board when pings stop.
- With `NTFY_TOPIC_URL` set, the dispatcher posts a line when a card is rejected, when a card pauses for any reason other than the dispatcher stopping, when a revert happens or fails, and once per New York day when the daily cap stops a tick.
- Both variables are optional; unset means no calls. An alert failure is logged and never stops a card.

## Acceptance criteria

- [x] `record_usage(..., p_billed_to => 'founder')` inserts a ledger row with `billed_to` founder, adds to the card's `actual_usd`, and leaves `pool.balance_usd`, `daily_spent_usd` and `incident_reserve_usd` unchanged.
- [x] `record_usage` without `p_billed_to` behaves exactly as before, billed to studio.
- [x] As anon, a founder ledger row is not returned by `ledger` and is not counted in `public_ledger_totals`.
- [x] The session and the startup probe pass `billed_to` from the adapter's mode: attended is founder, unattended is studio.
- [x] In attended mode a tick starts a funded card with a zero balance and a daily spend above the cap; in unattended mode both still stop it.
- [x] A tick whose pool row is from yesterday with `daily_spent_usd` at the cap starts a card.
- [x] Stopping the dispatcher does not write `studio_state.paused`.
- [x] `lanePaths('platform', 'code')` is `['platform/site']`, and a change to any kernel path is a lane violation in every lane.
- [x] The dispatcher's kernel path list equals `platform/gate/kernel-paths.txt`.
- [x] `platform/gate/kernel-guard.sh` exits non-zero when the changed-files list contains a kernel path and zero otherwise; the gate runs it on `card/*` branches after restoring `platform/gate` from the base commit.
- [x] A smoke failure after merge restores the previous green deploy, writes a revert commit whose tree is the merge parent's tree, and records its sha on the `revert` event.
- [x] A deploy failure after merge writes the revert commit without a restore.
- [x] A refused ref update (main moved) is recorded on the `revert` event and alerted, and the card is still rejected.
- [x] With the alert variables unset no request is made; with them set, a tick pings the healthcheck, and a rejected card, a non-stopping pause and a revert each post one ntfy message.
- [x] The daily-cap alert posts once per New York day.
- [x] `seed.ts --week1-test` inserts the card without calling `founder_credit`.

## Verification

- `pnpm verify` at the repository root exits 0.
- `pnpm --filter @backseat/dispatcher test` runs the throttle, tick, pipeline, github, worktree, alert, config, session and startup tests.
- `deno test` over `platform/supabase/functions/_shared/migration_test.ts`, through the root verify, shows the founder billing, RLS and totals steps passing.
- `bash platform/gate/kernel-guard.sh` against a list containing `platform/gate/ship-gate.sh` exits 1, and against a list containing only `seed-1/config/spawn-table.json` exits 0 (quoted output).
- After the migration is applied to the live project, `scripts/anon-negative-test.ts` prints `PASS`. As the service role, `select billed_to, count(*) from ledger group by 1` runs.
- In the three week-1 runs of the launch plan, every ledger row is `billed_to = 'founder'`, and `pool.balance_usd` is unchanged from before the runs.

## Decisions

- 2026-09-14: pre-launch agent work runs on the founder's Max subscription, and the pool holds customer money only (board). This supersedes PLAN.md §3 and §10 default 7, the $200 founding budget. The week-1 seed no longer credits the pool.
- 2026-09-14: founder-billed rows stay in `ledger` rather than a separate table, so a card's `actual_usd` and the dispatcher's ceiling keep one source. RLS hides them from the public, per PLAN.md §4.
- 2026-09-14: `p_billed_to` defaults to studio so the old call shape keeps its old meaning. The dispatcher always passes it.
- 2026-09-14: the revert is a new commit, never a force-push. It skips the gate because its tree is the last tree that passed the gate and deployed, and the push to main still runs the gate workflow for the record.
- 2026-09-14: the kernel list is a text file in the gate so the shell guard and the dispatcher read one source.
- 2026-09-14: healthchecks.io for liveness and ntfy for events. Both are plain HTTPS calls with no SDK, and no alert URL reaches an agent session.

## Evidence

2026-09-14:
- Founder billing: PGlite step "record_usage billed to the founder charges the card and leaves the pool alone"; `migration.test.ts` founder-billing describe. Live migration applied, and anon sees studio rows only (`anon-negative-test.ts`: `PASS: anon access matches the RLS contract`). A rolled-back live call billed to the founder left the pool at 0.5019 and moved the card's `actual_usd` by 0.25.
- Throttle and daily cap: `throttle.test.ts`, `tick.test.ts`.
- Restarts: the `Db` interface has no pause write, and `main.ts` logs `dispatcher stopped` without touching `studio_state`.
- Kernel paths: `worktree.test.ts` (list equals the gate file; kernel files refused in every lane) and `platform/gate/test/run-tests.sh` (guard and workflow order). Live: throwaway PR 16 on `card/kerneltest-code` failed its gate with `FAIL: kernel-guard path=platform/gate/ship-gate.sh`.
- Rollback: `pipeline.test.ts` (smoke and deploy failures revert main; a refused ref update is alerted); `github.test.ts` (`revertMerge`).
- Alerts: `alert.test.ts`, `tick.test.ts` (daily cap once a day).
- Seed: `seed.ts --week1-test` ran live without `founder_credit` (pool stayed 0.5019).
- ~~Pending: the three week-1 runs with every ledger row billed to the founder.~~ Done: `week1-runs.md` Evidence quotes `founder, 65, 0.8242` over the three runs and D1–D3, no studio rows, and `pool.balance_usd` at 0.5019 before and after (16 September 2026).

2026-09-16: the kernel-guard Verification line had no quoted output until now. Run on main at 4f60c7c, with a changed-files list holding only `platform/gate/ship-gate.sh`: `FAIL: kernel-guard path=platform/gate/ship-gate.sh`, exit 1. With a list holding only `seed-1/config/spawn-table.json`: `PASS: kernel-guard files=1`, exit 0.
