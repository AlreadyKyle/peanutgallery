# Agent upkeep: drift checks, Dependabot with a safe patch merge, the Claude Code pin and the replay eval set

Status: built. Card: none. Owner: board.

Series position: after design-review, before copy-pass (the order and each spec's status are in `docs/ROADMAP.md`, "The launch series"). It changes kernel files only. No job here calls a model; the eval runner calls one only when a person runs it at the Mac, on the founder's plan.

## Problem

Drift goes unseen. Nothing compares production's schema with the migrations, the models with the price table, the installed CLI with a pin, or the docs with the code. With no Producer role, no one watches for stalled cards, overruns or falling throughput. Dependencies are never updated, and the plan's auto-merge needs a policy that cannot let a poisoned patch rewrite the payment link (R23). The attended CLI updates itself, which has already broken the sandbox once (R33). Prompt, rubric and model changes have no regression check (R34, A6).

## Scope

In:
- The Janitor as code:
  - a weekly Actions workflow, `janitor.yml`, that runs two standard scanners: osv-scanner over the lockfile and lychee, offline, over the docs;
  - a daily dispatcher job, `janitor`, that checks schema drift, the model ids, the CLI against the pin, the weekly scan's result and three producer signals.
- A `findings` table with `record_finding` and `close_finding`, and a Findings list in Needs you. Trimmed agent-system-core left these to the first pull request that files a finding.
- Dependency updates: `.github/dependabot.yml`, pnpm's release-age and trust settings, and the dispatcher's `upkeep_merge` job, which merges a Dependabot patch only when every R23 condition holds.
- The Claude Code pin: the pin file, the board's one `sudo` script, and the attended adapter refusing a CLI that differs from the pin.
- The replay eval set: frozen cases, an attended runner, and a gate rule for changes to prompts, rubrics, agent definitions and schemas. The first result and the baseline from it are the board's first attended run (Decisions).
- The Janitor's role spec moves to running, as code only.
- Docs: SYSTEM.md, PLAN, BOARD-SETUP's pin step, the Needs you copy for non-card pull requests, and ROADMAP.

Out, and what each waits on:
- The Janitor's model-written docs pass, and the Security Auditor as a monthly Janitor mode: BACKLOG. Both are model role jobs, which wait for an operations percentage.
- Unused-code (knip) and workflow (zizmor) scanning, flaky-run detection, and deleting stale card branches: not built (Decisions). The repository's "Automatically delete head branches" setting is an optional board item.
- Renovate: only if the first Dependabot run cannot read pnpm 11's lockfile and the board installs the app. Its config comes with that choice.
- Producer signals as inputs to the Studio Head's ranking: not built. The ranking is board-queued, and the board reads the signals in Needs you.
- The builder replay set: BACKLOG, after launch (A6). HR: waits on scorecards and this eval set.
- The first replay run, and `baseline.json` from it: an optional board item (`docs/BOARD-SETUP.md`), run attended at the Mac on the founder's plan. Until it runs, the gate refuses a change to a guarded path.

## Behaviour

**Weekly scan.** Each Monday, and on demand, `janitor.yml` runs on main with `contents: read`, no secrets and every action pinned by sha. It has two jobs:
- osv-scanner, from its official action, over `pnpm-lock.yaml`, failing on a known vulnerability. It uploads no SARIF, because code scanning is a paid feature on a private repository.
- lychee, from its official action, in offline mode over `docs/**/*.md` and `README.md`, failing on a link to a file that does not exist. Offline mode checks the docs against the code and has no transient network failures.

**Daily check.** pg_cron queues the `janitor` code job once a day through `enqueue_job_run`. The job runs while the studio is paused, because it only reads and records findings. It checks:
- **Schema.** It compares production's `schema_fingerprint()` with the same function run on PGlite after every migration in the dispatcher's own checkout, object by object. Each missing, extra or different object is one finding.
- **Models.** Each `MODEL_*` value must have a row in `PRICE_TABLE_JSON`. It must be listed by /v1/models when the studio key is set (a free read). It must equal the model ids in the newest eval result.
- **CLI.** On an attended host, `claude --version` must equal the pin.
- **Weekly scan.** Each failed job in the newest completed `janitor.yml` run on main is a finding that links the run.
- **Producer signals**, from `producer_signals()`:
  - a funded card left unclaimed for 24 hours while the studio runs;
  - a card paused at its ceiling in the last seven days, with its executor (an overrun);
  - fewer shipped cards in the last seven days than half the seven days before, while funded cards waited.

A finding is keyed by its check and subject. When a finding is new or reopened, it shows in Needs you and sends one ntfy message. A finding seen again sends nothing. A passing check closes its finding, which leaves Needs you. Findings reach the board only: no agent reads them, and no finding changes code or files a card.

**Dependency updates.** Dependabot opens npm updates weekly, once a release is seven days old, with patches grouped and at most one open pull request. It opens GitHub Actions updates monthly. pnpm refuses to resolve a version younger than seven days and a downgrade in trust.

Each hour pg_cron queues `upkeep_merge`. It skips while the studio is paused or main is red. It merges a pull request from `dependabot[bot]` only when all of these hold:
- GitHub verified the head commit.
- The diff touches only `package.json` version strings and `pnpm-lock.yaml`.
- Each change is a semver patch of an existing dependency, and no package is added to the lockfile.
- Every version the lockfile adds or changes is at least seven days old on the npm registry.
- No changed package is on the never list: the dispatcher's runtime dependencies, esbuild, vite and pnpm.
- The pull request's base is main's head. If it is not, the job comments `@dependabot rebase` once and waits.
- The gate is green at the pull request's exact head sha.

It then merges at that sha under the dispatcher's merge lock. The deploy, smoke and rollback run as they do for a card. The gate's payment-host scan (#56) is what stops a patch that rewrites the payment link. Every other pull request waits for the board, and Needs you says so: GitHub Actions updates, minor and major updates, and anything that fails a condition. If Dependabot cannot parse pnpm 11's lockfile (dependabot-core #14794), its jobs fail harmlessly, and the weekly osv-scanner still reports vulnerabilities.

**The pin.** `platform/ops/mac/claude-code-pin.json` records a version and the `sandbox:check --positive` PASS line that version passed. The board runs `sudo bash platform/ops/mac/pin-claude-code.sh` once. The script refuses unless it runs as root and the installed version equals the pin. It then sets `DISABLE_AUTOUPDATER` in Claude Code's managed settings, keeping every other key. Before every session, the attended adapter compares `claude --version` with the pin and pauses the card with `cli_version` on a mismatch. A version change is a board pull request that updates the pin file with a fresh PASS line on the new version, and it is never auto-merged.

**The replay eval set.** The cases are frozen inputs with expected outcomes:
- The draft set has two kinds of case:
  - frozen drafts given to the Game Director: good drafts are expected to be approved, and drafts that break a pillar or the all-ages rating are expected to be flagged;
  - Game Designer runs from empty input, expected to pass the dispatcher's checks and be approved within three rounds.

There is no visual set: design-review keeps no rubric example images, so a visual set waits for frozen frame pairs from real reviews (BACKLOG).

`pnpm eval:replay -- --set draft --k 3` runs attended only. It deletes the studio and Anthropic API keys from its own environment, so it can only use the founder's Max login. It refuses when CI, GITHUB_ACTIONS or unattended mode is set, and it writes nothing to the database. It runs each case k times. It then writes `platform/agents/evals/results/<UTC stamp>.json` with the commit, the CLI version, the model ids and pass^k per set. It exits non-zero when a set falls below `baseline.json`.

The check is on at merge: the gate fails a pull request that changes a role prompt, rubric, agent definition or schema under `platform/agents/` unless it adds a result file with every set at or above its baseline. The first run, and the baseline set from it, is the board's, at the Mac; until it exists, such a change fails, so the check fails closed. A baseline moves only in a board pull request that gives the reason. The model ids live in `.env`, so the daily check compares them with the newest result.

## Acceptance criteria

- [ ] `schema_fingerprint()` is executable by service_role only. It returns one entry per object in the app's schemas: tables with their columns, types, RLS flag and grants to anon and authenticated; views; functions with their arguments and source; triggers; and policies, with runs of whitespace collapsed. On PGlite after every migration, two runs agree. A changed column type, function body, policy, RLS flag or anon grant changes that object's entry and no other (migration test).
- [ ] The daily `janitor` job records one finding for each case below. Each finding shows in Needs you and sends one ntfy message:
  - an object whose fingerprint differs between production and PGlite, or exists in only one of them;
  - a `MODEL_*` value missing from `PRICE_TABLE_JSON`, missing from /v1/models when the studio key is set, or different from the newest eval result's model ids;
  - an installed CLI that differs from the pin;
  - each failed job in the newest completed `janitor.yml` run on main;
  - each producer signal, on its fixture.

  `janitor.yml` has `contents: read`, references no secret and pins every action by sha. A second run records nothing new and sends nothing. A passing check closes its finding. The job runs while the studio is paused and writes only findings and its job run. `findings` and both finding RPCs are closed to anon, and only board members can read findings. The Janitor's role spec is running, with class read_only and no tools, and /team shows it running. (Dispatcher, migration and board tests, with a fixture for each check.)
- [ ] Dependency updates:
  - `dependabot.yml` sets npm updates weekly, with `cooldown.default-days: 7`, one patch group and `open-pull-requests-limit: 1`, and GitHub Actions updates monthly.
  - `pnpm-workspace.yaml` sets `minimumReleaseAge: 10080` and `trustPolicy: no-downgrade`, and `pnpm install --frozen-lockfile` passes.
  - `upkeep_merge` merges a fixture `dependabot[bot]` pull request that meets every condition, at its head sha under the merge lock, then deploys, smokes and rolls back on a failed smoke as a card merge does.
  - It refuses each fixture that breaks exactly one condition, naming that condition, and does nothing while the studio is paused or main is red.
  - Needs you's line for non-card pull requests says that patch updates passing the policy merge by themselves and that every other non-card pull request waits for the board.
- [ ] `pin-claude-code.sh` refuses to run as a non-root user and refuses an installed version other than the pin. Run as root against a test directory, it sets `env.DISABLE_AUTOUPDATER` to `"1"` and keeps every other key. The attended adapter pauses a card with `cli_version` when `claude --version` differs from the pin. The pin file's sandbox-check line contains PASS and the pin's version.
- [ ] `eval:replay`:
  - deletes STUDIO_ANTHROPIC_API_KEY and ANTHROPIC_API_KEY from its environment;
  - refuses when CI, GITHUB_ACTIONS or unattended mode is set;
  - writes no database row;
  - writes a result with pass^k per set, the model ids and the CLI version;
  - exits non-zero below the baseline.

  The gate fails a fixture change to a prompt, rubric, agent definition or schema under `platform/agents/` that has no new result, or whose new result is below the baseline. It passes the same change when a new result is at or above the baseline, and fails it while no baseline exists.

## Verification

- `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify`
- `pnpm --filter @backseat/dispatcher test`, `pnpm --filter @backseat/supabase test`, `pnpm test:functions`, `pnpm test:ops` and `pnpm test:agents`
- `BOARD_E2E_PORT=4393 pnpm --filter @backseat/board e2e`, which covers the Findings list and the non-card line, and `E2E_PORT=4391 pnpm --filter @backseat/site e2e`, since /team now shows the Janitor running.
- `bash platform/gate/test/run-tests.sh`, which audits `janitor.yml`, `dependabot.yml` and `pnpm-workspace.yaml`.
- `pnpm --filter @backseat/supabase exec tsx scripts/schema-fingerprint.ts --pglite` locally, with the object count quoted.
- `CI=1 pnpm eval:replay -- --set draft --k 3` and `AGENT_MODE=unattended pnpm eval:replay -- --set draft --k 3`, each refused before any session.
- `sandbox:check --positive` on the installed Claude Code, in both layouts, before the pin records its version.
- (optional board item) `pnpm eval:replay -- --set draft --k 3`, run attended on the founder's plan, with its pass^k quoted. This run writes the first result.
- The gate green at the pull request's head sha (the local gate while Actions is off, PLAN §10 decision 44).
- Production, after the production steps:
  - the size of the pre-migration dump, quoted;
  - `anon-negative-test.ts` and `ledger-identity.ts` PASS, with `select public.ledger_identity()` read back;
  - the conclusion of the first `janitor.yml` run on main, quoted;
  - the first `janitor` run's findings, quoted, with zero schema findings.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 13 criteria became 5.
  - Cut, because no Problem outcome needs them: knip and zizmor; flaky gate-run detection; the dispatcher deleting stale `card/*` branches (GitHub's "Automatically delete head branches" setting is an optional board item).
  - Replaced with standard tools: the bespoke scanner runner was `platform/gate/janitor/run.mjs`, `tools.json`, sha256-checked binaries, a hash-pinned zizmor requirements file, the `janitor.json` artifact, its download, its ancestor check and its per-run idempotency key. Now osv-scanner's and lychee's official actions run, pinned by sha, and the dispatcher reads the run's job conclusions. lychee's external-link checks with retries became offline mode, which is the Problem's docs-with-code comparison.
  - Moved to the host: the expected schema fingerprint is no longer computed in Actions and carried by artifact. The host computes it from kernel migrations.
  - Cut, because they ship switched off: the inert `renovate.json` and the `renovate[bot]` merge path; the eval check that passed with a note until a first result existed (the first result is now part of this pull request).
  - Cut as content-hash freezing: the eval `inputs_hash`. A changed input now needs a new result file in the same pull request, like a changeset.
  - Cut, because nothing needs them: producer findings as typed inputs to the Studio Head's ranking, and their no-text test (the board reads the signals in Needs you); non-kernel findings filing planned cards through design-review's `file_finding_card` (only knip produced them); the eval runner's board-session check (a person runs the command at the Mac); `startup.ts`'s model check (folded into the daily job).
  - Cut as unconfirmed: the managed settings `requiredMinimumVersion` and `requiredMaximumVersion` (R33 left them unconfirmed on 2.1.280). The adapter's version check enforces the pin, and `DISABLE_AUTOUPDATER` stops the drift.
  - Cut as implementation detail: the separate normalizer and Needs you copy criteria (folded in), and the throttle reason on a stalled-card finding.
  - Cut, because agent-workflows' trim removed `job:dry-run`: both `job:dry-run` verification lines. Handler tests and the first real runs replace them.
  - Kept whole: every Problem outcome; R23's full merge policy at the exact head sha on a green gate, with the gate's payment-host scan and the card's deploy, smoke and rollback; RLS and service-role-only functions; the dump before the production write; `anon-negative-test` and the ledger identity.
- 2026-09-23, reconciled with the series (these override any line that disagrees):
  - The migration is `20260924900000_agent_upkeep.sql`, after design-review's. Bump it, keeping the series' order, if main holds a later file. (Built as `20260925300000_agent_upkeep.sql`: see the build decisions below.)
  - This pull request creates `findings`, `record_finding`, `close_finding` and Needs you's Findings list, which trimmed agent-system-core left to the first pull request that files a finding. design-review's trimmed spec files no findings, so this pull request creates them.
  - Both jobs are scheduled by pg_cron through agent-system-core's `enqueue_job_run`, and the board can queue either with Run now.
  - Nothing here extends agent-workflows' ranking inputs or calls design-review's `file_finding_card`.
  - The draft set follows trimmed agent-workflows: a Designer run from empty input, and the Director on frozen drafts, with no planned-card drafting. There is no visual set: design-review's trim keeps the attended visual grade but no rubric example images to replay, so the eval covers the draft set; a visual set is a BACKLOG entry, built from frozen frame pairs of real reviews.
  - After this merge, copy-pass and launch-card-floor must each add an eval result if they change a prompt, rubric, agent definition or schema under `platform/agents/`.
  - The PLAN §10 decision takes the next free number at build.
- 2026-09-23: The operations bucket is removed from the series, and nothing in this pull request depends on it. The model-written docs pass and any scheduled role job wait for an operations percentage.
- 2026-09-23: Third-party scanners run in Actions on main, never on the dispatcher's host. PGlite runs on the host because it runs only kernel migrations (`platform/supabase` is in `kernel-paths.txt`), in process and with no network. The host already runs kernel code, and this removes the artifact round trip.
- 2026-09-23: No migration-history check. Production's migrations go through the Management API query endpoint, which writes no history: on 23 September 2026, production's history held one version (20260915012546) while every later migration was applied. The schema fingerprint catches an unapplied or drifted migration instead.
- 2026-09-23: Every finding goes to the board, in Needs you and as one ntfy message. A finding never changes code or files a card.
- 2026-09-23: The producer thresholds are policy constants in kernel SQL: 24 hours unclaimed, a pause at the ceiling within seven days, and fewer than half the previous week's ships. The no-Producer decision (23 September 2026) handed this role to code.
- 2026-09-23: The merge policy is R23's list. The dispatcher is the only automated merger (the Build 1 decision on dispatcher-enforced merges), and GitHub's auto-merge needs branch protection, which the private repository's plan lacks. So auto-merge on green checks means `upkeep_merge` at the exact head sha on a green gate.
- 2026-09-23: Dependabot stays, as the plan says, although its documentation lists pnpm 7 to 10 and dependabot-core #14794 reports pnpm 11's lockfile unparseable. If it cannot read the lockfile, installing Renovate is the board's call, because the app grants repository permissions.
- 2026-09-23: The pin is `DISABLE_AUTOUPDATER` in managed settings plus the adapter's version check (R33). A version bump is a board pull request with a fresh sandbox-check PASS line, and is never auto-merged (C3).
- 2026-09-23: The eval check is on from merge, because the first attended run is part of this pull request (on the founder's Max plan, with no spend). A change to an input needs a new result in the same pull request, checked by diff, not by a hash of the inputs.
- 2026-09-23: The Janitor is running, as code only. Its model-written docs pass is a BACKLOG entry.
- 2026-09-26, build decisions (under the board's order of that day to finish the launch series without asking; each a default, recorded here):
  - The migration is `20260925300000_agent_upkeep.sql`, the stamp the series gave this pull request after `20260925000000_terms_version_3.sql` and design-review's `20260925200000`. It is in `migration_test.ts`'s ordered list.
  - The first replay run is not part of this pull request. It is 30 to 42 Opus sessions on the founder's plan, and the board's order was not to spend them without him, so the runner is tested on fixtures and its refusals are run for real, and the first run is an optional board item. The result rule is still on from merge and fails closed: a change to a guarded path fails while `baseline.json` does not exist. Nothing later in the series changes a guarded path.
  - The pin records 2.1.283, not 2.1.280. The Mac's Claude Code updated itself to 2.1.283 on 26 September 2026, before this merged; `sandbox:check --positive` passed on 2.1.283 in both layouts, so the pin records that version and its PASS line, and attended sessions keep running after the merge. Until the board runs the pin script, another self-update pauses attended sessions with `cli_version`, as designed.
  - `upkeep_merge` reads the gate once at the head sha (`gateStatus`), not through `waitForGate`, which polls a missing run until it times out: while Actions is off it refuses at once with `gate`, and every Dependabot pull request waits for the board.
  - The CLI check runs on every host, not only an attended one: the dispatcher's role jobs always run through the attended adapter and the host's `claude`, even in unattended mode.
  - A weekly scan run that failed before any job ran (no Actions minutes, a refused workflow) is one finding, `scan:run`, so a scan that never ran is not read as clean.
  - `schema_fingerprint()` leaves out event trigger functions. Run read-only on production's catalogs with the function's own `search_path` on 26 September 2026, its body differed from PGlite's only in the objects of design-review's and this pull request's migrations, which production did not have yet, and in `public.rls_auto_enable()`, which Supabase's `ensure_rls` event trigger adds and no migration makes. The per-object migration test runs that function on PGlite and expects no change.
  - The board site reads the open findings straight from `findings` through its RLS policy, not through `board_needs_you`, so that function is not redefined; a failed read of the findings shows its error and never hides a duty.
  - The Janitor's prompt is unchanged. It is a guarded path, so a change would need a replay result, and it describes the model-written docs pass, which stays a backlog entry (`docs/BACKLOG.md`, "The Janitor's docs pass"). Its role spec's description now says what its code checks do. /team shows the Janitor running with its role spec's model, as every running role's box does, though its jobs call none.
  - The workflow audits are in `platform/gate/test/run-tests.sh`, where the other workflow audits are (there is no `workflows.test.mjs`). `evals.test.mjs` runs in the root `test:agents` script; `gate.yml` and `scripts/local-gate.sh` pass the base they compare with as `EVAL_BASE`, and a plain local run compares with `origin/main`.
  - `package.json` and `pnpm-lock.yaml` are kernel paths, so PLAN §10 decision 53 amends §4 Kernel and the board's merge duty for the one case `upkeep_merge` merges. Decision 52 records the Janitor as code and the eval rule.
  - BACKLOG gains "The Janitor's docs pass", "Monthly security audit" (the Security Auditor as a Janitor mode), "Visual replay set" and "Builder replay set".
  - The draft set holds eight frozen drafts, four expected approved, two off a pillar and two against the all-ages rating, and one Game Designer case from `{}`.
  - The board items, none blocking: running the pin script; the first replay run; the first `janitor.yml` run, which waits for Actions minutes; Dependabot's pull requests, which cannot merge by themselves until Actions is back and the gate can go green; Renovate, only if Dependabot cannot read pnpm 11's lockfile; and "Automatically delete head branches", optional.
