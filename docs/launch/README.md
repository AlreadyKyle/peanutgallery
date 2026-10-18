# Launch post drafts

The drafts for the announcement (`docs/specs/announcement.md`, Drafts; `docs/ROADMAP.md` criterion 5). The board edits them into its own voice and posts them; no agent posts them (`BOARD-SETUP.md` step 24).

## When they go out

The board announces before Go live (`docs/PLAN.md` §10 decision 64), and on 18 October 2026 it decided to hold every post until two things are true, because the 30-day check in `docs/strategy/business-strategy.md` §8 counts from the launch:

1. The dispatcher builds funded cards again (its run log shows no `stop reason:` line).
2. Email sign-ups are on, so a visitor can follow a card, suggest and save a seed.

r/incremental_games goes last, once Dust shows depth: the playtest's "Last new mechanic" line (`seed-1/tests/playtest.ts`) is well past the first hour. Its readers turn away short AI-made idle games, and the subreddit allows one post about your own game a month.

## Before anything is posted

1. Every link points at https://mobmachine.games or https://play.mobmachine.games (PLAN.md §10 decision 59).
2. Each subreddit's current rules and flair are read before its post goes up.
3. What the rules said in October 2026, from the scan in the project's shared folder:
   - r/incremental_games removes any post without an "AI disclosure:" line and allows a post about your own game once per 30 days; its draft carries the line.
   - r/ClaudeAI allows a project post with full disclosure of who made it, and keeps a weekly "Show us what you've created" thread; if a top-level post is removed, the draft goes in that thread.
   - r/indiegames and r/IndieGaming were reported to refuse posts about games made with generative AI. Neither gets a post.

## Posting order

The order is PLAN.md §7 Channels: Reddit first, Hacker News second, X third, with r/incremental_games held to the end.

| Order | Where | Draft |
|---|---|---|
| 1 | r/ClaudeAI | `reddit-claudeai.md` |
| 2 | r/artificial | `reddit-artificial.md` |
| 3 | Hacker News (Show HN) | `show-hn.md` |
| 4 | X | `x-thread.md` |
| 5 | r/incremental_games, once Dust shows depth (above) | `reddit-incremental-games.md` |

Nothing goes to r/gamedev (PLAN.md §7 Channels). Press comes fourth in PLAN.md §7 and has no draft here.

`backlash-line.md` is the prepared reply to a comment that objects to AI in games, on any of the posts.

Every post says who made what in the same words: the AI agents write the games' code, numbers and text and make every change; the art is drawn by code the agents wrote, with no image, sound or music model; the human board sets the rules and the checks. The site carries the same line on /how-it-works (`copy.ts` whoMadeWhat). No post says "first" of anything.

`war-stories.md` holds the facts for posts the board writes in its own words: what broke, what it cost and what changed. Those travel further than product posts.

## Where the words come from

Every claim is the live site's own wording or a fact in the repository:

- The pitch: "Watch AI agents build a game studio and free games. Fund the card you want built next." (`platform/site/src/lib/copy.ts` pitchTitle and pitchBody, PLAN.md §2).
- How a card is funded, built, checked and rolled back: /how-it-works (`copy.ts` howItWorksPage, `legal.ts` howMoneyMoves).
- The split: "Before the split, 10% of every contribution after Stripe's fee is held in reserve. Unless you change it at checkout, 80% goes to the agents and 20% to the studio." (`legal.ts` fixedRules).
- All ages, the art line, the ledger and the read rule: `legal.ts` allAges, artPolicy and fixedRules.
- The board and what it can do: `legal.ts` whoRuns, on /how-it-works and /team.
- The model and how a card's session runs: /team, PLAN.md §10 decision 36 and PLAN.md §6 The pipeline.
- The role jobs billed to the board: PLAN.md §3 and PLAN.md §4 Who files cards.

No draft gives a figure the site can move, such as a supporter count, money raised or a card's cost; a reader who wants one is sent to https://mobmachine.games/ledger. No draft says the studio or its games are open source (`docs/specs/announcement.md`). The only contact address is hello@clayhouse.studio.

## Length limits

Measured on the drafts as written, with the current domain.

| Draft | Limit | Measured |
|---|---|---|
| `reddit-claudeai.md` | title 300, body 40,000 | title 101, body 2,231 |
| `reddit-artificial.md` | title 300, body 40,000 | title 109, body 1,816 |
| `reddit-incremental-games.md` | title 300, body 40,000 | title 102, body 1,753 |
| `show-hn.md` | title 80; the first comment held under 2,000 | title 77, comment 1,821 |
| `x-thread.md` | 280 a post, a link counted as 23 | 8 posts, the longest 248 counted in full |
| `backlash-line.md` | fits any of the above | 144 |
