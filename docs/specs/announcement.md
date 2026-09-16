# Public announcement

Status: draft. Card: none. Owner: board.

## Problem

PLAN.md §7 plans a launch around a Twitch stream, a host and an on-stream clip. The board chose a site-first announcement on 14 September 2026 with the stream later. The launch sequence, assets and final checks need to match that.

## Scope

In:
- The final pre-announcement check.
- A launch clip.
- Post drafts.
- Pressing Go live.
- The posting order.
- The PLAN.md §7 amendment.

Out: Twitch, the host, micro-votes, the name vote (the studio is already named).

## Behaviour

**Pre-announcement check.** Everything in the definition of live in `docs/ROADMAP.md` is done, and the final gate passes:
- `pnpm verify` and the site e2e.
- The live Playwright check.
- The anon negative test.
- The ledger identity.
- The /board heartbeat under 3 minutes.
- Link previews render in the X and LinkedIn preview tools.

**Clip.** A screen recording of a funded card going from Fund what's next to Building now to Shipped, with the change visible in Dust. The board records it, or Claude records it in the Browser pane with the board's okay.

**Drafts** in `docs/launch/` (board posts them):
- Reddit posts for r/ClaudeAI, r/incremental_games and r/artificial (not r/gamedev)
- a Show HN
- an X thread
- the backlash response line from PLAN.md §7, without its open-source clause while the repository is private and the public seed-1 mirror with a license does not exist

**Launch day.**
1. The board presses Go live on /board.
2. The site shows "Live since …".
3. Posts go out after the clip exists, in the PLAN.md §7 order.

## Acceptance criteria

- [ ] Every item in the ROADMAP definition of live is done with its evidence.
- [ ] `docs/launch/` holds the drafts, each under the platform's length limit and free of hype words.
- [ ] `select launched_at from public_studio` returns the launch time, and the site shows the live-since line.
- [ ] PLAN.md §7 describes the site-first launch.
- [ ] No post, draft or page says the studio or its games are open source until the public seed-1 mirror exists with a license.

## Verification

- The final check outputs quoted.
- Screenshots of the live landing at 1440px and 375px after Go live.

## Decisions

- 2026-09-14: site-first, Twitch later (board).
