---
name: rc
description: The Mob Machine release candidate (/rc, or the scheduled "mobmachine-rc" task, Monday night). Cuts the train from `next`, opens or refreshes the release pull request into main, runs the full test pass (gate, verify, every end-to-end suite, the live check and load test against the deploy preview, visual stills, accessibility, security), and gives a GO, GO-without or NO-GO verdict Kyle can hold.
---

# The release candidate

**Purpose:** nothing reaches `main` on Tuesday that the heaviest checks we have did not pass on Monday night. `docs/build/README.md` is the rhythm. This run changes nothing in production and merges nothing into `main`.

Work in the rhythm worktree, `/Users/kylesmith/GitHub/mobmachine/.claude/worktrees/rhythm`, on `next`. Never switch branches in the main checkout.

## 0. Preflight

Do the daily's preflight steps 1 to 4 (`.claude/skills/daily/SKILL.md`), titled "Mob Machine rc <date>" with the lock name `rc`. If today's daily still holds the lock, wait for it, up to 2 hours.

## 1. Cut

1. Apply Kyle's holds first: the daily's intake, step 1, since the last daily. Each `hold #N` is reverted on `next`. If `.local/hold-release` exists, write the verdict NO-GO (held by Kyle) and skip to step 4.
2. Merge `origin/main` into `next` once more, then push. Tag the head `rc-<Tuesday's date>`, push the tag, and record the sha.
3. List the train: `git log --first-parent --format='%h %s' origin/main..next`. Take each pull request's Risk line and production steps from its body. Collect the new migration files: `git diff --name-only origin/main...next -- platform/supabase/migrations/`.
4. Write `docs/build/releases/<Tuesday's date>.md`, in order:
   - **What ships:** in players' words, grouped by what a player sees, the studio, the game, and under the hood. Each line cites its pull request.
   - **Production steps:** in the order they will run.
   - **Rollback:** see the release skill.
   - **The test pass:** left empty until step 3.

   Commit it on `next` and push. This is the head the tests run on, so nothing else is committed until the verdict.
5. Open the release pull request `next` into `main` titled "Release <Tuesday's date>", or refresh it if one is open. Its body is the release notes. Wait for its deploy previews: `https://deploy-preview-<n>--peanutgallerygames.netlify.app` for the site, and `--peanutgallery-seed-1` for the game when seed-1 changed.

## 2. The test pass (run in the background, in parallel where they don't share a port)

Quote each check's first line or its summary line. A check that cannot run here says so, with the reason, and is never left out quietly.

| Check | How | Passes when |
|---|---|---|
| Gate | The gate workflow on the release pull request at the rc head: `gh pr checks <n> --watch` | Every job detect selected is green |
| Verify | `pnpm verify` at the rc head | Exits 0 |
| Site end-to-end, all specs | `E2E_PORT=4470 npx playwright test` in `platform/site` | 0 failed |
| Game end-to-end | `pnpm --filter @backseat/seed-1 e2e` | 0 failed |
| Explainer | `pnpm --filter @backseat/explainer typecheck` and `test` | Both pass |
| Live check on the preview | `node platform/site/scripts/live-check.mjs <site preview url>` | `PASS ... failed=0`. A failure that only means the preview shares production data is named as such |
| Load test on the preview | `gh workflow run load-test.yml -f base_url=<site preview url>`, then the run's Load test step | `PASS` |
| Visual | `route-shots.spec.ts` and `design.spec.ts` stills, plus your own look at home, a card, /contribute, /ledger, /team and Dust at 375 and 1440 px on the preview, against `platform/site/DESIGN.md` and `docs/strategy/game-quality.md` | Nothing clipped, overlapping, empty, off-token or off-brand |
| Accessibility and layout | `a11y.spec.ts`, `layout-shift.spec.ts` | 0 serious axe violations; layout shift inside its budget |
| Security | `pnpm secret-scan`; `pnpm audit --prod --audit-level high`; `csp.spec.ts`; headers of the preview (`curl -sI`) | Clean; no high or critical issue without a named reason |
| Migrations | Read each new migration. It only adds things, or carries a written reason; the objects it alters exist in production (read-only SQL); the objects it creates don't. The repo's migration tests pass inside `pnpm verify` | Every migration is safe to apply before the code merges |
| Money paths | If the train touches money, the ledger or the webhook: `money.spec.ts` and the functions tests (`pnpm test:functions`), and a read of the change against `docs/PLAN.md` §5 | Pass, and no change to the split, the reserve or a cap without its kernel spec |
| Copy | Every public string the train changes, against `docs/COPY.md` and `docs/BRAND.md`: no dashes, no inside terms, nothing the site claims that isn't built | Clean |

## 3. Verdict

- **GO:** every check passed.
- **GO without #N:** a failure belongs to one pull request and the rest stand without it. Revert that merge on `next`, push, and rerun the gate and the checks that failed on the new head. The pull request returns to QUEUE with its failure.
- **NO-GO:** a failure you can't isolate, a red gate on the final head, or Kyle's hold. The train waits for next Tuesday. Monday's last lane-fix can go out as a hotfix if it is S1.

Fill in the test pass in the release notes with the quoted lines and the verdict. Post it as a comment on the release pull request: the verdict, the final head sha, and each check's line. Don't commit the verdict, because a commit moves the head the gate passed on. The release run commits the notes' final form after the merge.

## 4. Tell Kyle

Send the release notes with `SendUserFile` (status proactive), headed with the verdict, the time the train ships (Tuesday from about 07:00) and how to hold it: reply "hold" or "hold #N" in this session, or as a comment on the release pull request. Remove the lock and kill caffeinate. End with a one-line summary.
