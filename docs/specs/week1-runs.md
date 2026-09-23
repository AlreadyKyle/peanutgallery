# Prove the loop: three week-1 runs and the first board directives

Status: built. Card: none. Owner: board.

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

- [x] Three consecutive week-1 runs each reach `live` within 15 minutes of the card insert (runs 1 and 2, each inserted while no board session existed, within 15 minutes of their claim), with ledger rows all `billed_to = 'founder'`, a new green `deploys` row, and the changed value served in `https://peanutgallery-seed-1.netlify.app/config/spawn-table.json`.
- [x] `pool.balance_usd` is unchanged by the three runs and the directives.
- [x] D1, D2 and D3 each reach `live` through the pipeline (PR merged by the dispatcher on a green gate).
- [x] A reload of the live game keeps progress; the unlock list stays on screen at 30 unlocks in the D1 test.
- [x] The live game's tab title, favicon, studio link and all-ages label render at 375px with no horizontal scroll.
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

## Evidence

**Run 1** (card cd6fb0a7, gatherer baseCost 10 to 11, 15 September 2026). The card was inserted at 02:10:31 UTC. The board session began at 04:24:11.

- Dispatcher log, claim to live:
  - `04:24:48.848Z card cd6fb0a7 claimed` (lane config, estimate 2)
  - `04:25:03.239Z session ... ended` (outcome completed, 4 turns)
  - `04:25:06.342Z pull request #18 open` (sha 75d28051)
  - `04:25:54.941Z card cd6fb0a7 merged` (sha 6394a99b)
  - `04:26:18.371Z card cd6fb0a7 is live`
- Claim to live took 1 min 30 s.
- `select stage, actual_usd from cards where id = 'cd6fb0a7-…'` returned `live, 0.0585`.
- `select billed_to, count(*), sum(usd) from ledger where card_id = 'cd6fb0a7-…' group by 1` returned `founder, 4, 0.0585`.
- `select sha, is_green, smoke_result from deploys order by created_at desc limit 1` returned `6394a99b5d6d1c96e955136d97a785aa9a1e55b3, true, pass: build 6394a99b served; 1 config check(s) hold; bot: 36000 simulated seconds, 13 unlocks, budget 60 s`.
- `curl -s https://peanutgallery-seed-1.netlify.app/config/spawn-table.json` returned `{ "id": "gatherer", "name": "Gatherer", "baseCost": 11, "rate": 0.2 }`, and `version.json` serves `6394a99b…`.
- `select balance_usd from pool` returned `0.5019` before and after.

**Run 2** (card 6372e266, forge 40000 to 41000, 16 September 2026). Inserted 15 September at 04:27 UTC, after the board session of run 1 had ended, so it waited for the next one: claimed 16 September 01:55:06 when the board signed in, live 01:56:39, 1 min 33 s from claim. Like run 1 it is measured from its claim, not its insert. Stage `live`, `actual_usd` 0.0582, every ledger row `founder`.

**Run 3** (card b38e2d62, mill 2500 to 2600). Inserted 01:57:39, live 01:59:39: **2 minutes from insert**, the bar as written. Stage `live`, `actual_usd` 0.0330, every ledger row `founder`.

- The served config carries all three changes: `curl -s https://peanutgallery-seed-1.netlify.app/config/spawn-table.json` returns gatherer `baseCost` 11, mill 2600 and forge 41000.
- `select balance_usd from pool` returned `0.5019` before run 1 and after run 3.

**Directives.** Filed 02:03:20 by `file-directives --apply`, which passed the refusals and the pre-check for all three and deleted the Next card D2 replaces (a308062f). Each was built by an agent and merged by the dispatcher on a green gate:

| | Card | Turns | Claim to live | Cost | Merge |
|---|---|---|---|---|---|
| D1 | 20aeaa63 | 22 | 02:11:16 to 02:15:34 | $0.2868 of $8 | 0375631 (PR 26) |
| D2 | 7074706e | 18 | 02:16:20 to 02:20:37 | $0.2725 of $12 | ce35e53 (PR 27) |
| D3 | 23b1883a | 13 | 02:21:23 to 02:24:12 | $0.1152 of $6 | fc55225 (PR 28) |

- D1 shipped `seed-1/render/layout.ts` and `tests/layout.test.ts`, which lays out 30 unlocks at every earned count from 0 to 30 and asserts no line's bottom passes the 880px canvas, at most one earned line and at most three unearned, and the live 13-unlock config with it. `content/strings.json` carries `labels.unlocksEarned`.
- D2 shipped `seed-1/sim/save.ts` with the version in the save wrapper (so `tests/timeline.test.ts`'s pinned hash is untouched) and `tests/save.test.ts`; the scene saves to `dust.save` every 5 s, on `visibilitychange` and on `pagehide`.
- D3 shipped the tab title from `strings.tabTitle`, a hand-drawn SVG favicon bundled by Vite, the meta description and Open Graph tags, and the studio credit line.

**Live game checks** (browser pane at 375 px, 16 September 02:27 UTC):
- Reload keeps progress: the save held 19.9952 dust, and after a reload the game resumed at 26.4819 rather than 0, version 1.
- The unlock list reads "0 of 13 unlocked" with the next three unearned below it.
- Tab title `Dust · Peanut Gallery`; icon `/assets/favicon-DWl2BRhI.svg`; description and `og:title` present; the line "Made by AI agents at Peanut Gallery · All ages" links to https://peanutgallery.games/.
- `document.documentElement.scrollWidth - clientWidth` is 0 at 375 px: no horizontal scroll.

**Ledger.** Across the three runs and the three directives: `select billed_to, count(*), sum(usd) from ledger group by 1` returns `founder, 65, 0.8242`. There are no studio rows, and `pool.balance_usd` is still 0.5019.

**Still open:** criterion 6, a real contribution credited through `checkout.session.completed` or `charge.updated`, which the board makes after the VPS cutover (`vps.md`).

## Decisions

- 2026-09-14: runs are attended and billed to the founder; the pool is not seeded (`launch-hardening.md`).
- 2026-09-14: D1–D3 go through the pipeline as directives, so the first public Shipped items are real agent work.
- 2026-09-15: the favicon is `seed-1/render/favicon.svg` linked from `index.html`, not a file in `seed-1/public/`: `publicDir` is off in the protected `seed-1/vite.config.ts`, so that folder is never served (board, with the plan of 15 September 2026).
- 2026-09-15: the directives are filed by `scripts/file-directives.ts` from reviewed text rather than typed into the /board form. The script runs the dispatcher's pre-check and deletes the Next card D2 replaces only while it holds no money.
- 2026-09-15: run 1's card was inserted at 02:10 UTC, before any board session existed, so its 15 minutes run from its claim. Runs 2 and 3 are measured from insert.
- 2026-09-22: correction to the entry above. Run 2's card was inserted on 15 September at 04:27 UTC and claimed on 16 September at 01:55 UTC, when the board next signed in, so run 2 is measured from its claim like run 1. Only run 3 is measured from insert (2 minutes).
- 2026-09-15: no dispatcher change is needed for the code-lane directives: pnpm 11 installs a card worktree's dependencies on its first `pnpm --filter` run (a fresh worktree ran `seed-1` test, 69 passed, and typecheck, exit 0).
