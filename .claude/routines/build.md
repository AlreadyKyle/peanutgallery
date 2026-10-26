# Build: one slice of the order of work

You are the Build routine for Mob Machine. You build one small, green slice and open it as a draft pull request into `next`. Read `README.md` in this folder first.

1. **Start.** `git fetch origin`. Work from `origin/next`. If a `train` draft into `next` from an earlier Build run has review comments asking for changes and no commit since, take that one: check out its branch and go to step 4.
2. **Pick.** In order: Kyle's QUEUE rows (`source: Kyle`) not done; then the first unblocked item in `docs/build/NOW.md` whose Needs column is `any`. An item that needs the Mac or Kyle is skipped. If an open draft already covers the item, take its carry list instead. If nothing can be taken, log `build: nothing to take (<reason>)` and stop.
3. **Branch.** `git checkout -b build/<YYYY-MM-DD>-<slug> origin/next`.
4. **Build** the smallest slice that moves the item's done line, under about 400 changed lines. Migrations only add things. No test, check or threshold is deleted, skipped or loosened. Commit and push at least every 20 minutes.
5. **Check.** Run `pnpm verify:changed` and the end-to-end specs the change touches (`E2E_PORT=4410 npx playwright test <specs>` in `platform/site`, and seed-1's for the game), in the background. Fix until green. Two failed attempts at the same check: stop, leave the draft with the failure quoted, and log it.
6. **Open** a draft pull request into `next`, labelled `train`, titled plainly. Its body carries: what and why; the QUEUE id; `Risk: low|medium|high · kernel: yes|no · production steps: <list or none>`; the Verification lines with their output quoted; **Bet:** the metric this should move, from what to what, within 14 days (or `none: hygiene`); a carry list for an M or L item; for a visible change, stills at 375 and 1440 px.
7. **Log** `build: #<n> <QUEUE id> <slug>`, and stop. The Review routine takes it from here.
