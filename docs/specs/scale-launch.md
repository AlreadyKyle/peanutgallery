# Scale for launch: spend totals, the usage tier cap, Actions minutes, Netlify builds, the launch credit limit

Status: agreed. Card: none. Owner: board.

The launch plan's Phase 4 items F2, F3, F5, F6 and F7, from the scale review of 23 September 2026 (`review-scale.json`). F1 (the cached public snapshot), F4 (the Oracle shape) and F8 (quota alerts) are other pull requests.

## Problem

- **F3.** On every unattended tick with a runnable card, the dispatcher downloads every studio and overhead ledger row and every credit purchase, 1,000 rows a page, to add them up (`db.ts` `studioSpend`, `creditPurchasedUsd`). There is one ledger row per model request, so the tick's reads grow with the ledger and eat Supabase's 5 GB of free egress. The per-card sum (`sumLedger`) selects rows with no paging, so a card with more rows than PostgREST's row cap is undercounted.
- **F5.** At the Anthropic usage tier's monthly cap the API answers HTTP 429 with "You have reached your API usage limits" and the error code `enforced_spend_limit_reached`. `credit.ts` matched neither, so the studio never paused: each tick claimed the next card, its session create failed, and the card paused. The default monthly cap ($500) equals the Start tier's, so the dispatcher's own cap usually stops first; the gap shows on a lower Evaluation tier, at the month boundary when the two months turn at different times, or when metering drifts. The workspace form of the Console limit ("You have reached your specified workspace API usage limits") was missed too.
- **F2.** The account's private repositories share 2,000 Actions minutes a month. This repository used 681 billed minutes from 14 to 23 September against 327 raw, and every change under `docs/` ran the seed-1 checks, the seed-1 build and bot, the site's end-to-end suite and the Deno tests, none of which read `docs/`.
- **F6.** The seed-1 Netlify ignore rule leaves out `tsconfig.base.json` and `pnpm-workspace.yaml`, which its build reads, so a change to either can skip a build that would have failed. A dependency pull request would build previews of both sites against the team's shared build minutes.
- **F7.** The studio-wide daily limit on immediate credit is $500 (`credit_studio_daily_cap_usd`). On a launch spike most of the day's money is held 14 days and the card bars stop moving.

## Scope

In:
- `studio_spend_totals` and `card_ledger_usd` in migration `20260923000100_spend_totals.sql`, an index on `ledger (billed_to, created_at)` carrying `usd`, and the dispatcher reading through them.
- `studio_state.anthropic_tier_cap_usd` in the same migration; the throttle's tier bound; recognising the tier cap and the workspace limit (`credit.ts`), the session outcome `tier_cap`, the pipeline's pause and alert, and the managed adapter's failing check on a refused session create.
- `.github/workflows/gate.yml` and `platform/gate/changed-paths.sh`: skipping jobs and steps a change cannot reach, with the gate failing closed; the pnpm cache and the cancelling of superseded pull request runs, verified.
- Both `netlify.toml` ignore rules.
- A proposed value for `credit_studio_daily_cap_usd`, and the Actions minutes floor F8 alerts on.
- Two lines of `docs/PLAN.md` (§6 Budget throttle and the Appendix A `studio_state` shape) so the constitution names the tier cap.

Out:
- Changing the cap itself: the board sets it at /board. No kernel money function changes.
- Folding the detect and gate jobs into fewer jobs, and skipping the push-to-main gate run for a dispatcher merge. Both save more minutes than this change (below) but change the gate's shape or the smoke's reading of the gate, so each needs the board's own spec.
- Showing or editing the tier cap on /board: the board-site pull request can add it.
- F1, F4, F8, and the `/assets/*` cache headers and lazy /board bundle that F1 and the board-site pull request carry.

## Behaviour

**Spend totals in SQL (F3).** A tick makes two reads for money: each card's studio spend (`public_card_spend`, as before) and `studio_spend_totals(p_month_start, p_tier_start)`, which returns the Console credit bought, every studio and overhead ledger row, and those rows since the New York month start and since the tier month start. `card_ledger_usd(p_card_id)` returns the sum of every ledger row of one card, whoever it was billed to, which is what the dispatcher writes as `actual_usd`. Both are strict, only read, and only the service role may call them. A missing or null total is an error, never a zero.

**The usage tier cap (F5).**
- An API error whose text holds `enforced_spend_limit_reached` or "reached your API usage limits" is the tier cap. It is checked before the credit patterns, since only the tier cap cannot be cleared by buying credit.
- A session that meets it ends as `tier_cap`. The pipeline pauses the studio (`paused_by` "dispatcher: usage tier cap reached (card …)"), pauses the card with failing check `usage_tier_cap` and its money kept, and alerts: the limit resets when the month turns or Anthropic raises the tier, buying credit does not clear it, and the tier's limit should be reported.
- A refused session create maps to failing check `usage_tier_cap` or `console_credit`, and its error event keeps the API's whole answer, the error code included. A `session.error` event is kept whole as well.
- `studio_state.anthropic_tier_cap_usd` is null by default, which adds no bound. Once the board reports the tier's monthly limit from the Console's Limits page, the throttle bounds each unattended session by the limit less the studio and overhead spend since the tier month start and less what running sessions may still spend. A card that does not fit sleeps as `tier_cap`, alerted once per tier month.
- The tier month starts at the earliest of the current month's starts in UTC, New York and Los Angeles, because Anthropic's rate-limits page does not say which time zone its month turns in. So it never starts after the month start in any of those zones, and in the hours on the 1st before every zone has turned it also counts the month just ending, which can only stop a card early.
- The value is a production write (below). It can only stop cards; the monthly cap, the daily cap and the Console credit bound still apply.

**Actions minutes (F2).**
- `changed-paths.sh` prints `seed= platform= lane= site= functions=`. `docs/` counts on the platform side only: the docs tests, the agent spec tests and the supabase tests read it, and the seed-1 checks do not.
- `site` is false only when every changed file is under `seed-1/`, `docs/`, `platform/dispatcher/`, `platform/ops/` or `platform/supabase/`. `functions` is false only when every changed file is under `seed-1/`, `docs/`, `platform/dispatcher/`, `platform/ops/`, `platform/site/` or `platform/agents/`. Any other path under `platform/`, a new folder included, sets `platform`, `site` and `functions`; any path outside `seed-1/`, `platform/` and `docs/` sets every flag.
- The build job runs for the seed or the site. In the platform job, the Deno setup and tests run only when `functions` is true, and the site build, Chromium install and end-to-end suite only when `site` is true.
- Detect fails when a flag is not exactly `true` or `false` or the lane is not `config` or `code`, before writing any output. The gate job fails on a flag that is not `true` or `false`, requires the platform job whenever `platform`, `site` or `functions` is true, and requires the build job whenever `seed` or `site` is true.
- Unchanged and verified: the kernel checks run in detect before any install; `seed-code` and `platform` cache the pnpm store through `actions/setup-node`; the build job has no cache; a newer push to a pull request cancels its older run, and a push to main is never cancelled.

**The minutes floor (F2, for F8).** The alert fires when fewer than **300** of the account's 2,000 included Actions minutes are left in the billing month. A full gate run now costs 8 billed minutes (detect 1, seed-code 1, platform 4, build 1, gate 1, from run 35807464310) and a seed code card about two runs of 4, so 300 minutes is about 37 seed code cards or 37 full runs, and about four days at this repository's pace from 14 to 23 September (681 minutes in 10 days), fewer with the account's other private repository drawing on the same minutes. That leaves time for the board's settled answer, making the repository public (ROADMAP standing facts), before the gate stops starting.

**Netlify (F6).** Each site builds only when its own folder or a workspace file its build reads changed: `pnpm-lock.yaml`, `package.json`, `pnpm-workspace.yaml` and `tsconfig.base.json`, for both sites now. A `card/*` or `dependabot/*` branch builds no deploy preview; main builds after the merge. The team's plan stays as it is: the review found every site on plan id `nf_team_dev` and the team created before Netlify's credit-based plans, which points to legacy Free, and the board confirms it on the Billing page and does not switch (checklist A9).

**The launch credit limit (F7).** Proposed: **$3,500** a New York day, set by the board in the Caps form at /board with the second factor. If the board does nothing, $500 stays.
- The review's launch-spike day is 1,000 payments. At the checkout's $5 preset a payment gives about $3.12 of agent credit (review-product PG-20, checked), so the day needs about $3,120 of room; $3,500 covers it with about 12% to spare. At $10 a payment gives about $6.40 (F7), so $3,500 covers about 540 payments of $10; covering 1,000 of them would take about $6,500.
- At $500 the room covers about 160 payments at the preset, or 78 of $10, and the rest is held 14 days.
- The $50 a day per payer, keyed on the card fingerprint, stays as it is: it is the fraud control that matters (F7).
- A higher limit changes what the bars show and when cards count as funded, not how fast money is spent. Unattended spend stays bounded by the daily cap, the monthly cap (default $500), the tier cap once reported, and the Console credit, which is bought only from Stripe payouts, so launch money is spent only after the payout that carries it (a new account's first payout comes 7 to 14 days after its first live payment).

## Acceptance criteria

- [x] A tick reads the credit bought and the studio spend totals through `studio_spend_totals` and never selects `ledger` or `credit_purchases` rows.
- [x] `sumLedger` reads `card_ledger_usd`, and a missing total is an error.
- [x] `studio_spend_totals` sums studio and overhead rows only, from each start, plus every credit purchase; `card_ledger_usd` sums every row of the card; both refuse anon and authenticated and are strict.
- [x] The migration runs twice, and `anthropic_tier_cap_usd` is null by default and refuses zero.
- [x] The tier cap's 429, by message or by error code alone, and a `session.error` carrying the code, end the session as `tier_cap`; the workspace Console limit is credit; an ordinary rate limit is neither.
- [x] A `tier_cap` session pauses the studio and the card (`usage_tier_cap`), keeps the card's money and alerts the board that buying credit does not clear it.
- [x] A refused session create pauses the card as `usage_tier_cap` or `console_credit` and keeps the API's error code in the event.
- [x] With a tier cap set, the throttle starts no card whose need exceeds the cap less the tier month's spend and running sessions, bounds the budget by it, and alerts once; with none set it adds no bound.
- [x] The tier month never starts after the month start in UTC, New York or Los Angeles.
- [x] `changed-paths.sh` gives the flags above for docs, dispatcher, ops, supabase, agents, site, gate, a new platform folder, `.github`, the lockfile and seed-1 changes.
- [x] The gate job fails when a selected job did not pass, when a flag is missing or malformed, and when detect failed; it passes a docs-only or dispatcher-only change without the build job.
- [x] Detect fails a missing or malformed flag and writes no output.
- [x] The workflow runs the Deno steps only on `functions`, the end-to-end steps only on `site`, the build job on `seed` or `site`, and caches the pnpm store in `seed-code` and `platform` only.
- [x] Each Netlify site rebuilds on its own folder and the four workspace files, skips a change to `docs/` or the dispatcher, and skips `card/*` and `dependabot/*` previews.
- [ ] `20260923000100_spend_totals.sql` is applied in production and `studio_spend_totals` matches a direct sum of the ledger there. (waits on: production step 1)
- [ ] The tier's monthly limit is recorded in `studio_state.anthropic_tier_cap_usd`. (waits on: Kyle reporting the tier at the credit step, checklist C23; production step 2)
- [ ] The Netlify team is confirmed on legacy Free. (waits on: Kyle, checklist A9)
- [ ] The studio daily credit limit is kept at $500 or set to the proposed value. (waits on: Kyle, checklist B19)
- [ ] A pull request that changes only `docs/` or only the dispatcher runs without the seed-code and build jobs, and its gate check is green. (waits on: this pull request's own CI and the next such pull request)

## Verification

- `pnpm verify`.
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/migration_test.ts` (part of `pnpm verify`).
- `bash platform/gate/test/run-tests.sh` (part of `pnpm verify`), and each new gate test failing against a mutated workflow or script.
- The gate check on this pull request, and the jobs it ran.
- After production step 1, as the service role: `select public.studio_spend_totals(now() - interval '100 years', date_trunc('month', now()))` against `select coalesce(sum(usd), 0) from public.ledger where billed_to in ('studio', 'overhead')`. (waits on: production step 1)

## Production steps (need the board's allow)

1. Apply `platform/supabase/migrations/20260923000100_spend_totals.sql` through the Management API query endpoint, before any dispatcher runs this code: the attended dispatcher calls `card_ledger_usd` whenever it writes a card's stage, and the unattended one calls `studio_spend_totals` on every tick. Then run the check under Verification. No function deploy is needed.
2. When Kyle reports the tier's monthly limit from the Console's Limits page at the credit step: `update public.studio_state set anthropic_tier_cap_usd = <that limit> where id = 1;`. Repeat whenever the tier changes. An Evaluation tier below Start has a lower limit, so the first report matters.
3. Kyle: the Netlify Billing page check (checklist A9), and the studio daily credit limit (checklist B19).
4. F8's alert reads the floor above: 300 minutes left.

## Evidence

`pnpm verify` on this branch, exit 0 (the lines that count):

```
platform/supabase test:       Tests  232 passed (232)
seed-1 test:       Tests  77 passed (77)
platform/site test:       Tests  225 passed (225)
platform/dispatcher test:       Tests  580 passed (580)
platform/gate test: PASS: gate tests passed=423
  studio_spend_totals and card_ledger_usd sum the ledger in SQL for the service role only, and the tier cap is optional and positive ... ok (12ms)
the launch migrations upgrade a live database in production order ... ok (516ms)
ok | 79 passed (64 steps) | 0 failed (2s)
GATE PASS folder=seed-1 lane=code
GATE PASS folder=platform lane=code
PASS: secret-scan files=402
```

An earlier `pnpm verify` on the same code failed three `pipeline.test.ts` cases on a 5-second timeout while other sessions loaded the machine (load average about 20); the file passed 59 of 59 when run alone straight after, and the rerun above passed.

The criteria and the tests that prove them:
- Spend totals: `db.test.ts` "reads the Console credit bought and the studio spend totals from one database function, never the ledger rows", "refuses spend totals the function did not return, rather than reading them as zero", "sums a card's ledger rows in the database, so a card with more rows than one answer holds is not undercounted"; `tick.test.ts` "reads the spend totals once a tick, from the New York month start and the tier month start"; the Deno step above, which also re-applies the migration (every file runs twice).
- Tier cap recognised: `credit.test.ts` "reads the usage tier's monthly cap as tier_cap, by its message or its error code", "reads the workspace form of the Console limit as credit", "leaves other API errors, an ordinary rate limit included, to fail the card as before"; `session-money.test.ts` "stops as tier_cap on an adapter error event about the usage tier's monthly cap, never as credit"; `managed.test.ts` "pauses the card as usage_tier_cap, keeping the API's error code in the event, when the create meets the usage tier's cap" (the error built by the SDK's own `APIError.generate`), "pauses the card as console_credit when the create is refused for credit", "ends as tier_cap when the session create meets the usage tier's cap, so the pipeline pauses the studio", "ends as tier_cap when a running session reports the cap in a session.error event, keeping its error code".
- Tier cap acted on: `pipeline.test.ts` "pauses the studio and the card, keeping its money, when the API says the usage tier's monthly cap is reached"; `throttle.test.ts` "usage tier cap" (four cases) and `tierMonthStart` (three cases, one across every zone); `tick.test.ts` "stays below the usage tier cap the board reported, counting the tier month, and alerts once"; `db.test.ts` "reads the usage tier cap, and a studio without one, or before the column exists, as null".
- Gate: the gate tests above, among them `changed: <file> gives <flags>` for eleven paths, fourteen `gate verdict:` cases run from the workflow's own script, four `detect:` cases run from detect's own script, and the workflow and Netlify assertions. Each new check was then run against a mutation and failed as it should:

```
== verdict wants build on PLATFORM instead of SITE
FAIL: gate tests failed=3 passed=402
== verdict accepts malformed flags
FAIL: gate tests failed=2 passed=403
== detect accepts malformed flags
FAIL: gate tests failed=2 passed=403
== agents no longer select the site
FAIL: gate tests failed=1 passed=404
```

- Minutes: the old and new `changed-paths.sh` over the 49 first-parent commits on main since 14 September 2026, priced with the job times of run 35807464310 (platform job 230 s, of which the end-to-end build, Chromium and suite 56 s and Deno 12 s; each other job one billed minute): 359 billed minutes before, 319 after, 11% fewer. 20 of the 37 commits that ran both folders before now skip the seed-1 jobs; 16 still change a workspace file and run everything, and one changes seed-1 and the site. A docs-only run falls from 8 billed minutes to 5, a dispatcher-only run from 7 to 5.

## Decisions

- 2026-09-23: the tier cap is a nullable `studio_state` column set by a production write when the board reports it, not an environment value, so changing it needs no dispatcher restart and the database holds it with the other caps. It only lowers what may start, so it does not go through `set_caps`.
- 2026-09-23: the tier month starts at the earliest of the UTC, New York and Los Angeles month starts, since Anthropic does not state the zone. Counting too much early on the 1st can only stop a card.
- 2026-09-23: jobs and steps are selected by allowlist: a flag is false only when every changed file is under a folder known not to reach that step, so an unknown path runs everything. The review's larger savings (fewer jobs, no push-to-main re-run for dispatcher merges) are left to their own board specs.
- 2026-09-23: `dependabot/*` builds no Netlify preview; the gate still runs on it and main builds after the merge.
- 2026-09-23: the proposed studio daily credit limit is $3,500, sized to the review's 1,000-payment day at the $5 preset; the board decides.
