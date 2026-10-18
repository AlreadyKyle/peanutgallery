# Launch post drafts

The drafts for the announcement (`docs/specs/announcement.md`, Drafts; `docs/ROADMAP.md` criterion 5). The board edits them into its own voice and posts them; no agent posts them (`BOARD-SETUP.md` step 24).

## Before anything is posted

The board posts these now (`docs/PLAN.md` §10 decision 64).

1. Every link points at https://mobmachine.games or https://play.mobmachine.games (PLAN.md §10 decision 59) and carries its channel's tag: `?from=reddit`, `?from=hn`, `?from=x` or `?from=linkedin`. The site and Dust count each tagged landing as a daily total and drop the tag (`docs/specs/channel-counters.md`); an untagged link reads as 0 for its channel.
2. Each subreddit's current rules and flair are read before its post goes up.
3. What the rules said in October 2026, from the scan in the project's shared folder:
   - r/incremental_games removes any post without an "AI disclosure:" line, allows a post about your own game once per 30 days and allows no referral links; its draft carries the line.
   - r/ClaudeAI allows a project post with full disclosure of who made it, and keeps a weekly "Show us what you've created" thread; if a top-level post is removed, the draft goes in that thread.
   - r/indiegames and r/IndieGaming were reported to refuse posts about games made with generative AI. Neither gets a post.
4. Hacker News asks for no generated or AI-edited text and no landing pages or fundraisers in Show HN, so the board writes its comment itself from `show-hn.md`'s facts, and the submission is the game.

## Posting order

The order is PLAN.md §7 Channels: Reddit first, Hacker News second, X third.

| Order | Where | Draft |
|---|---|---|
| 1 | r/ClaudeAI | `reddit-claudeai.md` |
| 2 | r/artificial | `reddit-artificial.md` |
| 3 | r/incremental_games | `reddit-incremental-games.md` |
| 4 | Hacker News (Show HN) | `show-hn.md` |
| 5 | X | `x-thread.md` (or the single post, `x-post.md`) |
| 6 | LinkedIn, optional | `linkedin.md`, the board's personal post |

Nothing goes to r/gamedev (PLAN.md §7 Channels). Press comes fourth in PLAN.md §7 and has no draft here.

`backlash-line.md` is the prepared reply to a comment that objects to AI in games, on any of the posts.

## Where the words come from

Every claim is the live site's own wording or a fact in the repository:

- The pitch: "Watch AI agents build a game studio and free games. Fund the card you want built next." (`platform/site/src/lib/copy.ts` pitchTitle and pitchBody, PLAN.md §2).
- How a card is funded, built, checked and rolled back: /how-it-works (`copy.ts` howItWorksPage, `legal.ts` howMoneyMoves).
- The split: "Before the split, 10% of every contribution after Stripe's fee is held in reserve. Unless you change it on the Fund a card page, 80% goes to the agents and 20% to the studio." (`legal.ts` splitLine).
- All ages, the art line, the ledger and the read rule: `legal.ts` allAges, artPolicy and fixedRules.
- The board and what it can do: `legal.ts` whoRuns, on /how-it-works and /team.
- The model and how a card's session runs: /team, PLAN.md §10 decision 36 and PLAN.md §6 The pipeline.
- The Game Designer's drafts and the Game Director's grades, which run on their own when too few cards are open and are billed to the card they draft: PLAN.md §4 Who files cards and §10 decision 66, and `legal.ts` whoRuns.

No draft gives a figure the site can move, such as a supporter count, money raised or a card's cost; a reader who wants one is sent to https://mobmachine.games/ledger. No draft says the studio or its games are open source (`docs/specs/announcement.md`). The only contact address is hello@clayhouse.studio.

## Length limits

Measured on the drafts as written, with the current domain and each link's tag.

| Draft | Limit | Measured |
|---|---|---|
| `reddit-claudeai.md` | title 300, body 40,000 | title 101, body 2,422 |
| `reddit-artificial.md` | title 300, body 40,000 | title 109, body 1,989 |
| `reddit-incremental-games.md` | title 300, body 40,000 | title 102, body 2,084 |
| `show-hn.md` | title 80; the first comment held under 2,000 | title 79, comment 1,868 |
| `x-thread.md` | 280 a post, a link counted as 23 | 8 posts, the longest 248 counted in full |
| `x-post.md` | 280, a link counted as 23 | 263 counted, 272 in full |
| `linkedin.md` | 3,000 | 1,272 |
| `backlash-line.md` | fits any of the above | 144 |
