# Gate end-to-end job

Status: agreed. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

After `gate-speed.md` the site suite took 5.6 minutes on Actions, but it still ran at the end of the platform job, after typecheck and tests, the gate tests and the Deno tests (about 6.5 minutes on the run that measured it). The two halves do not depend on each other, so the platform job, the gate's longest, was their sum.

## Scope

In: a new `end-to-end` job in gate.yml holding the site build for the suite, the Chromium install and the site and board suites; the gate job's rule for it; the workflow audit in platform/gate/test/run-tests.sh; scripts/local-gate.sh's step names; PLAN.md's gate section.
Out: which tests run, the detect flags, the build and frames jobs, the gate's name and the dispatcher's read of it, sharding the suite across runners.

## Behaviour

When detect selects the site, the `end-to-end` job runs beside the platform job on its own runner: it installs as the platform job does (frozen lockfile, the pnpm cache), restores the base commit's gate on a card branch, builds the site for the suite, installs Chromium and runs the site and then the board suite. The platform job keeps everything else and no longer runs a Playwright step. The gate job needs `end-to-end`, requires it to pass whenever detect selects the site, and fails if it ran when detect did not select it, as it does for frames. The job is named `end-to-end`, not `e2e`: the workflow audit finds a job by a name of lowercase letters and hyphens.

## Acceptance criteria

- [ ] gate.yml has an `end-to-end` job that needs detect alone, runs only when `site` is true, caches the pnpm store, restores the base commit's gate on a card branch before any card code, and runs the site build, Chromium, the site suite and the board suite in that order.
- [ ] The platform job runs no Playwright step and gates only the two Deno steps on detect's flags.
- [ ] The gate job needs `end-to-end` and fails when the site is selected and the job did not pass, and when it ran without the site selected; the gate tests carry each case.
- [ ] scripts/local-gate.sh runs the same steps under `end-to-end:` names.
- [ ] On Actions, a site change's gate run finishes sooner than run 37140619071 (13.9 minutes), and its platform and end-to-end jobs overlap.

## Verification

- `pnpm --filter @backseat/gate test`, with one mutation: the gate job's `want end-to-end` line removed must fail the gate tests
- `bash -n scripts/local-gate.sh`
- `pnpm verify`
- The Actions gate run on the pull request: each job's start and end, against run 37140619071

## Evidence

## Decisions

- 2026-10-03: one end-to-end job, not the suite sharded across two. With the job split out, the end-to-end job (about 7 minutes) and the platform job (about 6 to 7) are level, so a shard would add billed minutes without shortening the run.
