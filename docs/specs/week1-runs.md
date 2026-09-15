# Prove the loop: three week-1 runs and the first board directives

Status: agreed. Card: none. Owner: board.

## Problem

The dispatcher has never shipped a card in production. PLAN.md Appendix A's week-1 bar (a funded $2 config card becomes a deployed change within 15 minutes, three runs in a row) is unmet. The game also has three problems that would embarrass a public launch: no save, no studio shell, and an unlock list that overflows the canvas at 14 unlocks, which the Decided card "Quiet rooms" would trigger.

## Scope

In:
- The three week-1 runs, attended on the founder's Max subscription and billed to the founder.
- Three board directives built by the agents through the pipeline: D1 unlock list, D2 save and resume, D3 game shell.
- Proving the `charge.updated` path on the next real payment.

Out: the unattended mode and the VPS (`vps.md`), new site sections (`launch-pages.md`).

## Behaviour

**Setup.** The board signs in at /board and keeps the tab open. The dispatcher runs on the Mac in attended mode.

**Week-1 runs.** For N in 1, 2, 3: `pnpm --filter @backseat/supabase seed --week1-test --run N` inserts the card, and the running dispatcher takes it to `live`. Run 1 changes the gatherer cost from 10 to 11, run 2 the forge from 40000 to 41000, run 3 the mill from 2500 to 2600.

**Directives.** Then the board files three code-lane directives, executor Builder A or B, folder seed-1, estimates at most $12. They are defined in `platform/supabase/lib/directives.ts` and filed with `pnpm --filter @backseat/supabase file-directives --apply`, which runs the dispatcher's pre-check first and inserts D1, D2 and D3 in that order at priority 0, stage funded, source board:
- **D1, the unlock list fits any count.**
  - Earned unlocks collapse to one line ("13 unlocks earned"); the next three unearned show below.
  - The layout arithmetic moves into a Phaser-free `render/layout.ts`, because the tests run in Node and cannot import Phaser. `tests/layout.test.ts` lays out 30 unlocks and asserts nothing draws below the canvas height.
  - It ships before the Quiet rooms card builds.
- **D2, save and resume.**
  - `sim/save.ts` serializes and parses `SimState`, with finite-number validation and a version field. The version lives in the save wrapper, not in `SimState`, whose hash `tests/timeline.test.ts` pins.
  - The renderer saves to localStorage every 5 seconds and on page hide, and resumes on load.
  - `tests/save.test.ts` covers a round trip, corrupt input and a version mismatch.
  - The open Next card "Save the game and resume on reload" is retired when D2 is filed, and the directive's reason says "live problem: progress lost on reload".
- **D3, game shell.**
  - Tab title "Dust · Peanut Gallery", from a new `strings.tabTitle`; `strings.title` stays "Dust" for the canvas heading.
  - An SVG favicon drawn by hand at `seed-1/render/favicon.svg`, linked from `index.html` so Vite bundles it. No import from `platform/`.
  - A small "Made by AI agents at Peanut Gallery · All ages" link to https://peanutgallery.games.
  - A meta description and OG tags.

Every directive's acceptance test names the commands the gate runs. The dispatcher's pre-check must not reject it.

## Acceptance criteria

- [ ] Three consecutive week-1 runs each reach `live` within 15 minutes of the card insert (run 1, inserted before the board session existed, within 15 minutes of its claim), with ledger rows all `billed_to = 'founder'`, a new green `deploys` row, and the changed value served in `https://peanutgallery-seed-1.netlify.app/config/spawn-table.json`.
- [ ] `pool.balance_usd` is unchanged by the three runs and the directives.
- [ ] D1, D2 and D3 each reach `live` through the pipeline (PR merged by the dispatcher on a green gate).
- [ ] A reload of the live game keeps progress; the unlock list stays on screen at 30 unlocks in the D1 test.
- [ ] The live game's tab title, favicon, studio link and all-ages label render at 375px with no horizontal scroll.
- [ ] A real contribution after these runs is credited through `checkout.session.completed` or `charge.updated`, and its webhook delivery is 200.

## Verification

- For each run, quoted:
  - `select stage, actual_usd from cards where id = '<id>'`
  - `select billed_to, count(*), sum(usd) from ledger where card_id = '<id>' group by 1`
  - `select sha, is_green from deploys order by created_at desc limit 1`
  - `curl -s https://peanutgallery-seed-1.netlify.app/config/spawn-table.json`
- Pool before and after: `select balance_usd from pool`.
- Browser pane on the live game: reload keeps dust; a screenshot at 375px.
- The dispatcher JSON log lines for each card from `claimed` to `is live`.

## Decisions

- 2026-09-14: runs are attended and billed to the founder; the pool is not seeded (`launch-hardening.md`).
- 2026-09-14: D1–D3 go through the pipeline as directives, so the first public Shipped items are real agent work.
- 2026-09-15: the favicon is `seed-1/render/favicon.svg` linked from `index.html`, not a file in `seed-1/public/`: `publicDir` is off in the protected `seed-1/vite.config.ts`, so that folder is never served (board, with the plan of 15 September 2026).
- 2026-09-15: the directives are filed by `scripts/file-directives.ts` from reviewed text rather than typed into the /board form. The script runs the dispatcher's pre-check and deletes the Next card D2 replaces only while it holds no money.
- 2026-09-15: run 1's card was inserted at 02:10 UTC, before any board session existed, so its 15 minutes run from its claim. Runs 2 and 3 are measured from insert.
- 2026-09-15: no dispatcher change is needed for the code-lane directives: pnpm 11 installs a card worktree's dependencies on its first `pnpm --filter` run (a fresh worktree ran `seed-1` test, 69 passed, and typecheck, exit 0).
