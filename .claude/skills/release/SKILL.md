---
name: release
description: The Mob Machine weekly release (/release, or the scheduled "mobmachine-release" task, Tuesday morning). If Monday's release candidate said GO and Kyle has not held it: backup, migrations, merge `next` into main on a green gate at the exact head, function deploys, live check, rollback on failure, then the tag, the release notes and the clean-up that the weekly video reads.
---

# The release

**Purpose:** the train reaches players safely, or it doesn't move and Kyle knows why. `docs/build/README.md` is the rhythm. This routine runs the production steps (`docs/PLAN.md` §10 decision 74, `docs/ROADMAP.md`, Standing facts: Production changes).

Work in the rhythm worktree, `/Users/kylesmith/GitHub/mobmachine/.claude/worktrees/rhythm`. Never switch branches in the main checkout.

## 0. Preflight and go or no-go

1. Do the daily's preflight steps 1 to 3, titled "Mob Machine release <date>" with the lock name `release`.
2. Read the release pull request ("Release <today>") and its rc verdict comment. Then read Kyle's words since the rc: his replies in the rc session, his comments on the release pull request (`AlreadyKyle` only), and `.local/feedback-inbox.md`.
   - **Stop and report** if the verdict is NO-GO, if `.local/hold-release` exists, or if he said hold. Delete `.local/hold-release` once it has held one release.
   - **`hold #N`** after the cut: revert that merge on `next`, push, and rerun the gate on the new head.
3. If `origin/main` moved since the rc tag (cards or hotfixes), merge it into `next`, push, and wait for the gate on the new head. Rerun the rc checks the merge touched (the end-to-end specs of the paths that changed). If they are red, the verdict becomes NO-GO and you stop and report.
4. If the dispatcher is mid-merge of a card (its newest run's log shows a merge in progress), wait for it to finish, up to 30 minutes.

## 1. Production steps, in this order

1. **Backup.** Take a dump of production before any migration or write (`docs/specs/money-safety.md`). `pg_dump` comes from libpq (`brew install libpq` if it is missing; install it, don't ask). Keep the file where `money-safety.md` says. If the dump fails, stop: no migration runs without one.
2. **Migrations.** Apply each new migration in filename order (the Supabase connector's `apply_migration`, or the Management API query endpoint, as ROADMAP's Standing facts say). After each one, read back `supabase_migrations.schema_migrations` and spot-check the objects it made. Migrations only add things, so `main`'s current code runs on the new schema while the merge is pending.
3. **Merge.** `gh api -X PUT repos/AlreadyKyle/peanutgallery/pulls/<n>/merge -f merge_method=merge -f sha=<head>`, only on a green gate run at that exact head. A merge commit keeps `next` an ancestor of `main`.
4. **Functions.** Deploy each Supabase function the train changed, from the main checkout's `platform/` at the merge commit: `npx supabase functions deploy <name> --project-ref lyxndueoeisyqzewflpu --use-api`.
5. **Deploys.** Netlify builds `main`. Wait for the site's production deploy, and the game's if seed-1 changed, to finish on the merge sha (the Netlify API with `NETLIFY_AUTH_TOKEN`, or the `live-check` workflow's run for the merge commit).

## 2. Check it live

- `node platform/site/scripts/live-check.mjs` against production. The first line must read `PASS ... failed=0`. The `live-check` workflow's run for the merge commit must agree.
- Load https://play.mobmachine.games and the site's home, a card and /contribute at 375 and 1440 px, and look at them.
- Confirm the dispatcher's next run starts clean (its `stop reason:` line is not a startup refusal), and that the Stripe webhook's recent deliveries succeed.

## 3. Rollback, only if live fails because of the train

1. **Site and game first.** Restore the previous production deploy in Netlify. This is instant, through the API restore of the last deploy before the merge, for each site that changed.
2. **Code.** Open a pull request into `main` that runs `git revert -m 1 <merge sha>`, and merge it on a green gate. Then revert the revert on `next`, so the train keeps its work for a fix.
3. **Migrations.** Never roll them back. They only add things, so the old code runs on them. Fix forward in a hotfix.
4. **Record it.** Write an incident row per `docs/strategy/operating-system.md` §3. Any S1 gets its post-mortem line naming the check that would have caught it, as a QUEUE row for the rc test pass.

## 4. Close out

1. Tag `release-<date>` at the merge commit, push it, and create a GitHub release with the notes: `gh release create release-<date> --notes-file docs/build/releases/<date>.md`.
2. Fast-forward `next`: `git push origin origin/main:next`. This is a fast-forward because `next` is an ancestor. If it is refused, merge `main` into `next` instead, and never force.
3. Comment on the release pull request with the merge sha and the live-check first line (CLAUDE.md, Long runs and merging).
4. Delete every merged `build/*` and release branch, then run `bash scripts/tidy-local.sh` in the main checkout and quote its last line. Close QUEUE rows that shipped with the release tag.
5. On `next`, append the result to `docs/build/releases/<date>.md`: shipped at the merge sha, the live-check line, and the production steps run. Tick `docs/ROADMAP.md` for any spec the train finished. Commit and push both to `next`, where they ride the next train. Docs-only commits by the routines go straight to `next`. Everything else goes through a pull request.
6. Send Kyle the release report with `SendUserFile` (status proactive), with these lines:
   - shipped (or held, or rolled back), and why;
   - the live-check line;
   - the production steps run;
   - what the weekly video will cover.

The weekly video task starts after this and reads `docs/build/releases/<date>.md`. Remove the lock, kill caffeinate, and end with one line.
