# Money safety: backups, the Controller, append-only money tables, infrastructure stops, the Oracle shape

Status: built. Card: none. Owner: board.

Oracle is dropped (PLAN.md §10 decision 38, 23 September 2026). Until the studio has a server the jobs run on the board's Mac under launchd, and the nightly backup there is `platform/ops/mac/backup-mac.sh`, written to a folder the board chooses rather than an Oracle bucket (`mac-host.md`). The server's `backup.sh`, units and timers are kept for the planned Google Cloud server, whose backup store is still to be chosen.

## Problem

The money database has no backup, and Supabase Free takes none. Nothing reconciles the books with Stripe, so a webhook the studio missed, a fee Stripe kept or a dispute Stripe closed as won goes unseen, and the Console credit purchase has no formula. Money rows can still be updated or deleted by anyone holding the service key. A paid card is rejected when the gate never starts, is cancelled, or fails on a main that was already red, and after the merge when Netlify does not answer. `oracle-launch.sh` asks for twice Oracle's Always Free Ampere allowance. Nothing warns the board before the database or the Actions minutes run out.

## Scope

In:
- Three migrations: `20260923000000_contribution_entries.sql` (the `reinstated` and `adjustment` labels, alone), `20260923000010_backup_role.sql` (the read-only `peanutgallery_backup` login, `ledger_identity()`, `controller_runs`, `controller_figures()`, `ops_database_size()`), `20260923000020_append_only.sql` (the triggers, `record_dispute_reinstated`, `record_adjustment`, `redact_contribution_name`, `reverse_contribution` counting reinstated rows).
- The nightly backup (`platform/ops/backup/backup.sh`) with its weekly restore check, the Controller and the quota check (`platform/ops/jobs/`), their units and timers, their env files (`make-jobs-env.sh`, `jobs-env.mjs`, `jobs/check-env.mjs`), and their wiring in `provision.sh`, `deploy.sh` and the ops tests.
- The weekly fallback backup's workflow template for a separate private repository (`platform/ops/backups-repo/`).
- The dispatcher: infrastructure stops (`pipeline.ts`, `smoke.ts`, `tick.ts`, `github.ts`, `main.ts`).
- `oracle-launch.sh`: the Always Free shape and a start that retries capacity; `vps.md` and `oracle-launch.md` corrected.
- The runbook: backups and the Controller, the restore, recovery from a phone, and the one-time migration history repair (`platform/ops/README.md`).

Out: every production step (below, for the orchestrator with the board's allow); the credit purchase's expiry tracking and the billed-cost field (the Console credit work); `contribution_allocations` and `card_approvals` (their pull requests add them to the append-only triggers); the public "Reconciled with Stripe" line and a board view of `controller_runs`; Supabase egress and Netlify usage, which reach the board as the providers' emails; docs/ROADMAP.md and docs/BOARD-SETUP.md.

## Behaviour

**Append-only money tables.** `ledger`, `contributions`, `credit_purchases`, `board_actions` and `controller_runs` refuse DELETE and TRUNCATE, and refuse every UPDATE that changes a column, with the plan's two exceptions, which move no money: `contributions.decision_id` set once from null (`apply_contribution` linking an open decision), and `contributions.display_name` nulled inside `redact_contribution_name` only. `board_actions.card_id`'s foreign key becomes `on delete restrict`, so a card a board action names cannot be deleted and no action ever loses its card. An update that changes nothing passes. Corrections are new rows:
- `record_dispute_reinstated(p_dispute_id, p_stripe_session_id, p_amount_usd)`, service role only, writes one `reinstated` row that is the negative of what the payment's disputes still hold, keyed `<dispute id>:reinstated`. The reserve, the incident fund and the pool balance take their shares back, and nothing is held again. The row names the payment's card, and the card's bar gets back what the pool balance does, as on a release, so a bar stays the sum over its payments' rows and a refund after the win takes off only what the card holds. It refuses when Stripe's amount is below what is booked as disputed, and a second call changes nothing.
- `record_adjustment(p_parent_id, p_net_usd, p_studio_usd, p_agents_usd, p_reserve_usd, p_reason)`, the board at aal2 with a reason, books a correction against one payment; net must equal reserve plus agents plus studio. The reserve and the balance move with it, so the ledger identity still holds. A fee Stripe kept, charged to the studio share, is net −fee, studio −fee.
- `redact_contribution_name(p_contribution_id, p_reason)`, the board at aal2, nulls one display name and records the action without the name.
- `reverse_contribution` counts reinstated rows as given back, so a refund after a won dispute reverses the whole payment, while a dispute event replayed after the win reverses nothing.

**The backup.** Every night at 06:17 UTC, `peanutgallery-backup.timer` runs `backup.sh` as root: `supabase db dump` of the roles, the schema, the data (`--use-copy`), the auth schema's data and the migration history, through the Session pooler as `peanutgallery_backup`, a login with no password until the board's production step sets one, read access to every table, no write privilege and `default_transaction_read_only`. Every dump runs as that login: the database owner's password never goes to the VPS or the backups repository, and every job refuses an owner's connection string under any name. If the login is refused the auth schema, `BACKUP_SKIP_AUTH=1` leaves the auth dump out, and a restore signs the board in afresh. On its weekday it first restores the plaintext into a scratch container of Supabase's Postgres image with no network and reads the top-level `holds` of `public.ledger_identity()` on it; a copy that does not restore or whose identity does not hold stops the run before anything is uploaded. The dumps are tarred, encrypted with age to `BACKUP_AGE_RECIPIENT`, the board's public key, and uploaded through `BACKUP_PAR_URL`, a write-only pre-authenticated request for `BACKUP_BUCKET`, a versioned bucket, so a write to an existing name keeps the old backup as a previous version. The plaintext is deleted before the upload and on every exit. Success pings `BACKUP_HEALTHCHECK_URL`; failure pings its `/fail`, and the unit's `OnFailure=` posts to ntfy. A template workflow runs the same dumps weekly in a separate private repository with its own write-only request and no GitHub token.

**The Controller.** Every day at 07:07 UTC, `peanutgallery-controller.timer` runs `jobs/main.mjs controller` in the dispatcher image, from the read-only code clone, as nobody, with a read-only root, no capability and only `controller.env`: the Supabase service key and `STRIPE_READ_KEY`, which must start `rk_live_`; every job refuses a value starting `sk_live_` or `sk_test_` under any name, and so does `provision.sh` for the dispatcher's env file. It reads Stripe with GET requests only (the list is in the runbook) and checks: the ledger identity; one payment row per paid Checkout Session with the same amount and a net of the amount less Stripe's fee; no payment row Stripe does not show; refunds and disputes booked; what Stripe holds for each payment against the net the books carry, so each fee Stripe kept is named with the adjustment that fixes it; each paid payout summing to its transactions; webhook events Stripe could not deliver in the last 30 days; Console credit bought covering studio and overhead spend; Stripe's balance covering the Minimum balance figure. It puts back each dispute Stripe closed as won. It computes:
- **the next Console credit purchase:** the remaining ceilings of funded cards (150% of the estimate, capped by the per-card maximum, less studio spend, for cards funded or building), plus the operations bucket up to the role caps (0 until the operations pull request), plus overhead since the last purchase, less the credit left; never more than the agent money Stripe has paid out (agents less the incident share less any hold, for payments in paid payouts), plus all overhead, less all credit bought; never below zero, rounded down to the cent;
- **the Minimum balance:** the 10% reserve plus held money plus the Stripe fees on the last 30 days' charges, in USD and in the settlement currency at the latest charge's rate.

It writes one `controller_runs` row and, on any mismatch or a dispute that needs an answer, posts one message to ntfy naming each failing check, its fix, the credit to buy and the Minimum balance; it pings `CONTROLLER_HEALTHCHECK_URL` (or its `/fail`) when that is set. It holds no key that can replay a webhook event, so a missed one is named with its fix: resend it from the Stripe Dashboard. `--dry-run` reads everything and writes, reinstates and alerts nothing.

**The quota check.** Every day at 07:37 UTC, `jobs/main.mjs quota`, with only `quota.env`, reads the database's size (`ops_database_size()`, alert at 350 MB) and this month's Actions minutes from GitHub's billing usage API with the dispatcher's token and its Plan read (alert under 400 of 2,000 left), writes a `controller_runs` row and posts to ntfy on an alert. Supabase egress and Netlify bandwidth and build minutes come from the providers' emails to the board. The nightly backup's queries keep the free project from pausing.

**Paid cards and infrastructure.** Before the merge, a gate that never starts, is still running at the deadline, or concludes `cancelled`, `startup_failure` or `stale`, a failure main's own gate already had at the card's base, a pull request that never shows the pushed sha, a GitHub, git or Netlify error, and any other error before the merge request that no check classified (a database blip, a failed fetch of main, a fault in the dispatcher, recorded as `dispatcher_error`) are infrastructure stops. The card is never rejected for one. With a stored patch it goes back to funded and the next claim re-gates it from the patch with no session and no Actions re-run; one that stopped before any session ran goes back to funded to be claimed again; at the third such stop in a row, or with no stored patch after a session (attended mode), it pauses with its money, and the board's resume re-gates it. The tick claims no card while main's own gate has failed (and alerts once per red sha) or cannot be read. After the merge, a deploy Netlify never finished, a verification that got no verdict (the site or the deploy list not answering, the gate at the merge sha missing, pending or not started) still rolls the change back, since the kernel keeps an unverified change off main, and the card pauses rather than being rejected. A card whose own change fails the gate on a green base, fails its deploy build or fails the smoke check is rejected and rolled back as before.

**Oracle.** `oracle-launch.sh` asks for 2 OCPUs and 12 GB, the Always Free Ampere allowance, and a start of a stopped instance retries "Out of host capacity" as the launch does. A stopped instance can be started from a phone in the Oracle console; the dispatcher and the timers come back on boot, and the timers make up missed runs.

## Acceptance criteria

- [x] The three migrations apply in order on PGlite, each twice, after every earlier file, and upgrade a live database in production order with the deployed calls working.
- [x] The two entry labels are added in a file of their own, before any use.
- [x] `apply_contribution` still links an open decision with the triggers on.
- [x] Every forbidden UPDATE, DELETE and TRUNCATE on the five money tables is refused, for the service role too; a no-op update and `decision_id` set once pass; a second `decision_id` change is refused.
- [x] A card a board action names cannot be deleted (the foreign key is `on delete restrict`), and a direct null of the action's card id is refused; a card no action names can still be deleted.
- [x] `redact_contribution_name` refuses a moderator, an outsider, aal1 and anon, nulls one name at aal2, and records the action without the name; a direct null is still refused.
- [x] `record_dispute_reinstated` writes the exact negative of the dispute, once, restores the pool, keeps the identity, refuses an amount below what is booked and anon and authenticated; a later refund reverses the whole payment and a replayed dispute event reverses nothing. For a goal card, through a held payment's release, a dispute, the win and a refund, the card's bar and `public_card_funding` agree at every step, the win puts the bar back where it was, and the refund leaves it at zero, not below.
- [x] `record_adjustment` refuses a moderator, aal1, no reason, parts that do not add up, nothing moved, over $10,000 and a parent that is not a payment; it books the row and the board action and keeps the identity.
- [x] `ledger_identity()` returns the three lines in one statement and names a drift; only the service role and the backup login run it.
- [x] `peanutgallery_backup` logs in with no password yet, bypasses row level security, reads every public table and `auth.users`, writes none, runs no security definer function but `ledger_identity`, and a second run of the file keeps a password the board set.
- [x] `controller_figures()` and `ops_database_size()` return the figures to the service role only; `controller_runs` takes inserts from the service role only and refuses another job name.
- [x] Before the merge, a missing, pending, cancelled or failed-to-start gate, a red main at the base and a pull request that never shows the pushed sha re-queue a card with a stored patch, unmerged, with no session, no ledger row and no Actions re-run; a GitHub outage and a database error after the gate pass do the same, and the third stop in a row pauses it; a failed fetch of main or an unreadable role before any session puts the card back in funded, and the third such stop pauses it; a card with no stored patch after a session pauses (a stale pull request head in attended mode included); a gate pass clears the count; none of these rejects the card.
- [x] A card whose own change fails the gate on a green base is rejected; one whose gate fails at the merge sha is rolled back and rejected; one whose gate there was cancelled is rolled back and paused.
- [x] After the merge, an outage or an unfinished deploy rolls the change back and pauses the card instead of rejecting it.
- [x] The tick claims nothing while main's gate has failed (alerting once per sha) or cannot be read, and claims again when main is green, cancelled or pending.
- [x] Every job env rule holds: a Stripe secret key under any name is refused, and so is the database owner's connection string, pooled or direct, under any name; `STRIPE_READ_KEY` must be `rk_live_`; the backup login is held to the Session pooler; `BACKUP_SKIP_AUTH` is `1` or absent; the age key and the request's bucket are checked; `check-env.mjs` refuses another job's key, quotes, duplicates and malformed lines; `provision.sh` refuses a Stripe secret key under any name, and `SUPABASE_DB_PASSWORD`, in the dispatcher's env file.
- [x] The Stripe reader sends GET requests only, with the restricted key and the webhook's pinned API version, and pages to the end or reports a list read short.
- [x] The reconciliation passes the matching account and computes the purchase ($3.39, capped by paid-out agent money) and the Minimum balance ($2.17, 2.98 CAD) of the fixture; it names a missed payment, a phantom payment, a wrong net, a missed refund, a missed dispute, a dispute to answer, a won dispute to put back, a fee Stripe kept, a payout that does not sum, an undelivered event, spend beyond the credit, a low balance, a drifting identity and a list read short.
- [x] The Controller's run writes one row, alerts only on a mismatch, reinstates a won dispute, pings `/fail` on a mismatch; a dry run writes nothing; a Stripe secret key stops it before any request.
- [x] The quota check counts this month's Actions minutes, alerts at 350 MB and under 400 minutes left, and names the Plan read permission when the billing API refuses.
- [x] `backup.sh` dumps the six files as the backup login and no other (five, without auth, with `BACKUP_SKIP_AUTH=1`), encrypts to the board's key, uploads through the request with no secret on a command line, pings the check, leaves nothing on the host, restores and checks the identity before encrypting on its weekday, stops before uploading when the top-level `holds` is not `true` (lines that hold on their own included) or the query printed nothing, and pings `/fail` on any failure; it refuses a Stripe secret key, the owner's login under any name, another login and another bucket.
- [x] The runbook makes the backup bucket versioned, says a write-only request can replace a name and that versioning keeps the old copy, and restores from a name's oldest version; the restore check and the runbook read only the top-level `holds`.
- [x] `make-jobs-env.sh` writes each job's keys only, at 0600, printing no value, refuses a job whose keys are missing while writing the others; each file it writes passes `check-env.mjs`.
- [x] `provision.sh` and `deploy.sh` install every unit and the backup script from the commit, verify every unit but the alert template, and `provision.sh` enables a timer only when its env file passes the check in the image; `provision.sh` installs the backup script before it verifies the units, so a fresh host gets through to enabling the dispatcher; each job unit is a oneshot with its env file as a condition and the job alert on failure; the Controller and quota containers mount only the read-only code clone.
- [x] `deploy.sh --ref` refuses, before moving anything, a commit without every unit it installs or the backup script, so a roll back never goes behind the jobs or stops halfway.
- [x] `anon-negative-test.ts` probes `controller_runs` as a private table and each new function (`ledger_identity`, `controller_figures`, `ops_database_size`, `record_dispute_reinstated`, `record_adjustment`, `redact_contribution_name`) for 42501; a static test keeps it covering every table and function the files add.
- [x] `oracle-launch.sh` asks for at most 2 OCPUs and 12 GB and retries a start on capacity; the runbook, `vps.md` and `oracle-launch.md` name the same shape; the runbook starts a stopped instance from a phone.
- [x] The backups repository template needs no token, uses only its own secrets (the backup login and its request, never the owner's), dumps as the backup login only, checks the CLI it installs and is not a workflow of this repository.
- [ ] Production: the three migrations applied, `ledger_identity()` holds, the anon negative test passes (waits on: the board's allow).
- [ ] The backup login's grants read back as the tests show, and its password set; `BACKUP_SKIP_AUTH=1` only if the auth read comes back false (waits on: the board's allow).
- [ ] The migration history repaired and `migration list` in step (waits on: the board's allow and the database password).
- [ ] ~~The instance launched at 2 OCPUs and 12 GB (waits on: the board's Oracle sign-in).~~ Superseded by `mac-host.md`: Oracle is dropped.
- [ ] ~~The bucket reads back `"versioning": "Enabled"` (waits on: the board's Oracle sign-in).~~ Superseded by `mac-host.md`: the Mac's backups go to a folder the board chooses.
- [ ] The first nightly backup PASS and an object stored (on the Mac host: `mac-host.md`; waits on the age key, the backup folder and the backup healthcheck).
- [ ] The Controller's first dry run, then its first run, PASS against production Stripe (waits on: `STRIPE_READ_KEY`, and the board told what it reads).
- [ ] The quota check's first run PASS (waits on: the dispatcher token's Plan read).
- [ ] The backups repository's first run uploads an object (waits on: the board's allow to create the repository and its secrets).
- [ ] The restore drill with the offline key (waits on: the board, checklist C).

## Verification

- `pnpm verify`
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/money_safety_test.ts`
- `pnpm --filter @backseat/dispatcher test`
- `pnpm test:ops` (the ops tests import `jobs.test.mjs`)
- `shellcheck platform/ops/*.sh platform/ops/backup/backup.sh`
- Production, after the production steps: `select public.ledger_identity()` holds; `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts` PASS; `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts` PASS (waits on: the board's allow).
- On the VPS: `/usr/local/lib/peanutgallery/backup.sh --restore-check` prints `PASS: restore check`; the Controller's `--dry-run` and the quota check print `PASS:` (waits on: the instance and the keys above).
- The restore drill quotes `true` for `select public.ledger_identity()->>'holds'` on a decrypted backup (waits on: the board with the offline key).

## Production steps (need the board's allow)

Pause the studio from /board first and make sure no dispatcher is running on the Mac.

1. **Apply the migrations** through the Management API query endpoint, one request per file, in order: `20260923000000_contribution_entries.sql`, `20260923000010_backup_role.sql`, `20260923000020_append_only.sql`. Then `select public.ledger_identity()` (quote it), `anon-negative-test.ts` (which now probes `controller_runs` and the six new functions) and `ledger-identity.ts` (quote PASS). Quote any notice `20260923000010` raised: a refused BYPASSRLS, `pg_read_all_data` or auth grant. `20260923000020` changes `board_actions.card_id` to `on delete restrict`; the change validates against the existing rows, all of which name cards that exist.
2. **Read back the backup login:** `select rolcanlogin, rolbypassrls, rolconfig from pg_roles where rolname = 'peanutgallery_backup'` and `select has_table_privilege('peanutgallery_backup', 'auth.users', 'select')`. Quote both.
3. **Set its password** once through the Management API (`alter role peanutgallery_backup with password '<new random>'`, generated locally and never printed), and put the Session pooler string in `.env` as `BACKUP_DB_URL=` (`platform/ops/README.md`, Backups and the Controller, step 4). If step 2 shows no auth access, put `BACKUP_SKIP_AUTH=1` in `.env` and in the backups repository's variables; the owner's password is never put in any backup setting.
4. **Repair the migration history** once (`platform/ops/README.md`, Migration history): `npx supabase@2.117.0 link --project-ref lyxndueoeisyqzewflpu`, then `npx supabase@2.117.0 migration repair --status applied` with every applied version, `20260914000000` to `20260923000020`, then `npx supabase@2.117.0 migration list --linked`, quoted. It needs the database password, which the board puts in the Mac's `.env` as `SUPABASE_DB_PASSWORD=` and nowhere else. From then on migrations go through `supabase db push`, which is a change to the ROADMAP's standing fact on production changes for the docs to record.
5. ~~**After the board's Oracle sign-in:** `platform/ops/oracle-launch.sh` (2 OCPUs, 12 GB), then the bucket, versioned, and the two write-only requests (runbook steps 1 and 2), with the expiry the board chooses; quote the bucket's `versioning` read-back.~~ Superseded by `mac-host.md`: Oracle is dropped.
6. **After the board sends the age public key and creates `STRIPE_READ_KEY` and the backup healthcheck:** tell the board exactly what the Controller reads (the runbook's list), then, on the Mac host (`mac-host.md`), `JOBS_ENV_DIR=~/peanutgallery-host/env platform/ops/make-jobs-env.sh backup-mac controller quota`, `platform/ops/mac/install.sh`, and the first runs with `run-job.sh <job> --now`, quoted in `mac-host.md`.
7. **The backups repository** (waits on a new store: its template uploads through an Oracle pre-authenticated request, and Oracle is dropped): create it private, add its secrets and variables, copy the template, run it once and quote the object it uploaded.
8. The Mac's attended dispatcher takes the infrastructure-stop change at its next start; the VPS takes it at its first `provision.sh` or, after the cutover, at the next `deploy.sh`.

## Evidence

`pnpm verify` on this branch, after the review fixes, exits 0. Its totals:

```
platform/supabase test:       Tests  240 passed (240)
seed-1 test:       Tests  77 passed (77)
platform/site test:       Tests  225 passed (225)
platform/dispatcher test:       Tests  574 passed (574)
platform/gate test: PASS: gate tests passed=348
ℹ tests 67        (test:agents)
ℹ tests 89        (test:ops, with jobs.test.mjs)
ℹ pass 89
ℹ fail 0
ok | 81 passed (76 steps) | 0 failed     (test:functions)
GATE PASS folder=seed-1 lane=code
GATE PASS folder=platform lane=code
PASS: secret-scan files=425
ℹ tests 15        (test:docs)
ℹ fail 0
```

`money_safety_test.ts`:

```
the money tables are append-only, and corrections are new rows ...
  every migration applies twice in order, and the guard is on every money table ... ok
  apply_contribution still links an open decision, with the triggers on ... ok
  every forbidden update, delete and truncate on a money table is refused, whoever asks ... ok
  a card a board action names cannot be deleted, so the action never loses its card ... ok
  redact_contribution_name nulls one name with the second factor and records the action without it ... ok
  a won dispute is reinstated exactly and once, and a later refund can still reverse the whole payment ... ok
  a won dispute puts a goal payment back on its card, so a later refund leaves the bar at zero, not below ... ok
  record_adjustment books a correction with the second factor and the ledger identity still holds ... ok
  ledger_identity reads the three lines in one statement and names the drift ... ok
  peanutgallery_backup has no password yet, reads every table, writes none and runs only ledger_identity ... ok
  controller_figures and ops_database_size give the jobs their figures, for the service role only ... ok
the money-safety migrations upgrade a live database in production order ...
  the schema before holds a payment and a dispute ... ok
  each file applies on its own, twice, and the deployed calls keep working with the triggers on ... ok
ok | 2 passed (13 steps) | 0 failed
```

The dispatcher's tests for infrastructure stops are in `platform/dispatcher/test/pipeline.test.ts` ("a paid card and an infrastructure failure", with the stale pull request head, the failed fetch of main and the database error after the gate pass; the pr_head and unreadable-role cases in "runCardPipeline"; and the post-merge outage cases), `tick.test.ts` (main's gate), `smoke.test.ts` (a cancelled gate at the merge sha is no verdict). The jobs' tests are in `platform/ops/test/jobs.test.mjs` and `ops.test.mjs` ("the jobs on the VPS", with provision's install order, "make-jobs-env.sh", "backup.sh", "check_ref", "the Oracle instance", "the backups repository template"). `platform/supabase/test/migration.test.ts` keeps `anon-negative-test.ts` covering the new table and functions. The Stripe account in `platform/ops/test/fixtures/stripe-account.json` is made up in the shapes of Stripe's API objects; no test calls Stripe. A response recorded from the live account would replace it once `STRIPE_READ_KEY` exists and the board allows the read.

## Decisions

- 2026-09-23 (production): The first `20260923000010` stopped on production with "permission denied to alter role. Only roles with the SUPERUSER attribute may alter roles with the SUPERUSER attribute": the project owner is not a superuser, so its `alter role` may not name SUPERUSER or REPLICATION. Nothing was applied, since the file ran as one statement batch. The `alter role` now leaves those two out, and a check stops the file if the login has either. The fixed file was run on production inside `begin; … rollback;` first and returned `rolcanlogin true, rolsuper false, rolreplication false, rolbypassrls true, rolconfig [default_transaction_read_only=on], read_all true, auth_users true, holds "true"`, with the role absent again afterwards. PGlite runs as a superuser and could not show this; a static test now pins the rule.
- 2026-09-23: The entry labels take stamp `20260923000000` and the backup login `20260923000010`. The task named the login's file `000000` but also required the labels first, in a file of their own; the labels must commit before any file uses them.
- 2026-09-23: After the merge, an outage still rolls the change back and the card pauses. The kernel's rollback keeps an unverified change off main; pausing, not re-queueing, keeps a change that broke the site from being merged again in a loop. The board's resume re-gates it from the stored patch.
- 2026-09-23: A card with no stored patch pauses on an infrastructure stop after a session rather than going back to funded, so no new session starts for it. One that stopped before any session ran goes back to funded (up to the same three stops in a row): claiming it again starts the session it never had.
- 2026-09-23 (review): Before the merge request, any error no check classified (a database blip, a failed fetch of main, a fault in the dispatcher) is an infrastructure stop recorded as `dispatcher_error`, never a rejection: nothing showed the card's change failing. From the merge request on, `merge` and `verifyMerged` decide as before. A pull request that never shows the pushed sha is GitHub lagging and is an infrastructure stop too.
- 2026-09-23: The Controller records and alerts a missed webhook event rather than replaying it: replaying needs the webhook's signing secret or a Stripe key that can write, and neither belongs on the VPS.
- 2026-09-23 (review, supersedes "reinstated money returns to the pool without a card"): A reinstated row names the payment's card and puts back on its bar what the pool balance gets back, as a release does. This keeps the 16 September rule that a bar and the refund arithmetic stay a plain sum over the payment's rows (`card-columns-and-open-funding.md`); without it, a refund after a won dispute took the card's money off its bar a second time and drove it below zero.
- 2026-09-23 (review): `board_actions.card_id` is `on delete restrict`, not `on delete set null`, so the append-only guard keeps the plan's two exceptions and no action loses the card it names. A card a board action names is retired by a stage change (`cancel_card`), never deleted.
- 2026-09-23 (review): The database owner's password never goes to the VPS or the backups repository, where it could drop the append-only triggers: every dump runs as `peanutgallery_backup`, and every job refuses an owner's connection string under any name. If that login is refused the auth schema, `BACKUP_SKIP_AUTH=1` leaves auth out; auth holds only the board's accounts, and board membership is `board_members`, by email, in the public data, so a restore signs the board in afresh. This reads the plan's `SUPABASE_DB_PASSWORD` line as the Mac only.
- 2026-09-23: The backup uploads through a write-only pre-authenticated request with curl: nothing to install, and the VPS can neither read, list nor delete a backup. The request's expiry is the board's choice; an expired one fails the backup check.
- 2026-09-23 (review): The backup bucket is versioned. A write-only request can still write to a name that exists, and backup names are predictable, so without versioning a stolen request could replace every past backup; with it, the old copy stays as a previous version that only the board's sign-in can delete. Versioning rather than a retention rule: it keeps every replaced copy with no duration for the board to choose.
- 2026-09-23 (review): `deploy.sh --ref` refuses a commit that lacks any unit it installs or the backup script, before it moves anything, rather than skipping those files: skipping would leave the jobs' timers running code the rolled-back clone no longer has. A change older than the jobs is taken out with a revert on main.
- 2026-09-23 (review): The restore check reads `ledger_identity()->>'holds'` alone, since each line of the identity carries its own `holds`.
- 2026-09-23: The Minimum balance's typical fees are the Stripe fees on the last 30 days' charges, a measured figure rather than an estimate.
- 2026-09-23: The Controller and the quota check are dependency-free Node run in the dispatcher image from the read-only code clone, each with its own env file; their tests are imported by `ops.test.mjs`, so the root `test:ops` script is unchanged.
