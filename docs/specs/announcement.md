# Public announcement

Status: agreed. Card: none. Owner: board.

## Problem

PLAN.md §7 plans a launch around a Twitch stream, a host and an on-stream clip. The board chose a site-first announcement on 14 September 2026 with the stream later. The launch sequence, assets and final checks need to match that.

## Scope

In:
- The final pre-announcement check.
- A launch clip.
- Post drafts.
- ~~Pressing Go live.~~ Superseded by PLAN.md §10 decision 62: no button; the first credit purchase stamps the launch time.
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

**Clip.** The first player-funded card's own page, `/card/<its id>`, with its replay: the deal, the bar filling, the flip to Building now, the checks and the Live stamp, then what changed and its supporters (`docs/specs/supporter-pages.md`). A screen recording of it, with the change visible in Dust, is optional; the board records it, or Claude records it in the Browser pane with the board's okay.

**Drafts** in `docs/launch/` (board posts them):
- Reddit posts for r/ClaudeAI, r/incremental_games and r/artificial (not r/gamedev)
- a Show HN
- an X thread
- the backlash response line from PLAN.md §7, without its open-source clause while the repository is private and the public seed-1 mirror with a license does not exist

**Launch day.**
1. ~~The board presses Go live on /board.~~ Superseded by PLAN.md §10 decision 62: the launch time is already stamped by the first credit purchase.
2. The site shows "Live since …".
3. Posts go out after the clip exists, in the PLAN.md §7 order.

## Acceptance criteria

- [ ] Every item in the ROADMAP definition of live is done with its evidence.
- [x] `docs/launch/` holds the drafts, each under the platform's length limit and free of hype words (Evidence).
- [ ] `select launched_at from public_studio` returns the launch time, and the site shows the live-since line.
- [x] PLAN.md §7 describes the site-first launch (Evidence).
- [x] No post, draft or page says the studio or its games are open source until the public seed-1 mirror exists with a license (Evidence; checked again before the posts go out).

## Verification

- The final check outputs quoted.
- Screenshots of the live landing at 1440px and 375px after Go live.

## Evidence

Recorded 26 September 2026, when the drafts were written, after the copy pass (#89) merged.

- **The drafts.** `docs/launch/` holds `README.md` (what happens before posting, the order, where each claim comes from, the measured lengths), `reddit-claudeai.md`, `reddit-artificial.md`, `reddit-incremental-games.md`, `show-hn.md`, `x-thread.md` and `backlash-line.md`. Measured again at the close-out, as the README's table has them: r/ClaudeAI title 101 and body 2,329 characters, r/artificial 109 and 1,937, r/incremental_games 102 and 1,684 (Reddit allows 300 and 40,000); Show HN title 77 of 80, first comment 1,917, held under 2,000; the X thread 8 posts, the longest 248 counted in full (280 allowed); the backlash line 144. Each of the five post files holds the clip placeholder exactly once, and every link is on https://peanutgallery.games. A scan of all seven for hype words (revolutionary, groundbreaking, game-changing, unprecedented, incredible, amazing, world's first, cutting-edge, seamless, unleash, magic, stunning, awesome, breakthrough and the like) finds none. The posting order is PLAN.md §7 Channels: r/ClaudeAI, r/artificial, r/incremental_games, then Show HN, then X; nothing for r/gamedev and no press draft. Each file is in `scripts/rename.mjs` tier 1, so the domain pull request rewrites its links.
- **PLAN.md §7 is site-first.** Its Order paragraph describes the launch with no stream: contributions open now with the studio paused, a quiet share or an announcement as the board chooses, the first payout, Console credit, the cutover, a moderator, "the launch clip of a real card going from open to shipped", Go live at /board, then the posts in the order under Channels. Nothing in §7 plans a Twitch launch, a host or an on-stream clip; §7 Content after launch puts episodes and clips in §4 Not built yet, and PLAN.md §2 and §10 decision 15 say the launch is site-first with the stream later.
- **No open-source claim.** `git grep -n -i -E "open[ -]?source" -- platform/site/src platform/site/index.html platform/site/public seed-1 docs` on the close-out branch finds nothing under the site or the game. Every hit under `docs/` is a rule against the claim or a record of one: PLAN.md §5 Canada admin ("nothing public says open source before then"), §7 Backlash (the clause allowed only once the mirror exists), §8's 90-day pivot, the backlog's mirror entry, this spec's own lines, `docs/launch/README.md` and `backlash-line.md` saying no draft makes the claim, the kill-condition pivot in `BOARD-SETUP.md`, and copy-pass's quote of another studio's site. The backlash line is PLAN.md §7's, word for word, without the open-source clause.

Still open: the clip (the first player-funded card's page, after the cutover), ~~Go live and `launched_at`~~ (stamped by the first credit purchase, PLAN.md §10 decision 62), link previews checked in the X and LinkedIn tools, the final pre-announcement check and the screenshots after Go live. They wait on `BOARD-SETUP.md` section C (steps 19 to 24).

## Decisions

- 2026-09-14: site-first, Twitch later (board).
- 2026-09-26: status agreed. The drafts exist and the PLAN.md §7 amendment is in place; what is left is the launch itself, so the spec is the contract for it rather than a draft.
