# Launch post drafts

The drafts for the announcement (`docs/specs/announcement.md`, Drafts; `docs/ROADMAP.md` criterion 5). The board edits them into its own voice and posts them; no agent posts them (`docs/BOARD-SETUP.md` step 24).

## Before anything is posted

1. The board has pressed Go live on the board's own site.
2. The clip exists: the first player-funded card's own page, `/card/<its id>`, with its replay (`docs/specs/announcement.md`, Clip). Posts go out only after it exists (PLAN.md §7 Order).
3. In every draft, "[clip link: added when the first player-funded card ships, docs/specs/announcement.md]" is replaced with that page's address. The gap is left on purpose: no card id is written here before that card ships.
4. Every link points at https://mobmachine.games, the studio's domain since PLAN.md §10 decision 59 (`scripts/rename.mjs`, `docs/specs/rename.md`).
5. Each subreddit's current rules and flair are read before its post goes up.

## Posting order

The order is PLAN.md §7 Channels: Reddit first, Hacker News second, X third.

| Order | Where | Draft |
|---|---|---|
| 1 | r/ClaudeAI | `reddit-claudeai.md` |
| 2 | r/artificial | `reddit-artificial.md` |
| 3 | r/incremental_games | `reddit-incremental-games.md` |
| 4 | Hacker News (Show HN) | `show-hn.md` |
| 5 | X | `x-thread.md` |

Nothing goes to r/gamedev (PLAN.md §7 Channels). Press comes fourth in PLAN.md §7 and has no draft here.

`backlash-line.md` is the prepared reply to a comment that objects to AI in games, on any of the posts.

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

Measured on the drafts as written, with the clip line in place and the current domain.

| Draft | Limit | Measured |
|---|---|---|
| `reddit-claudeai.md` | title 300, body 40,000 | title 101, body 2,329 |
| `reddit-artificial.md` | title 300, body 40,000 | title 109, body 1,937 |
| `reddit-incremental-games.md` | title 300, body 40,000 | title 102, body 1,684 |
| `show-hn.md` | title 80; the first comment held under 2,000 | title 77, comment 1,917 |
| `x-thread.md` | 280 a post, a link counted as 23 | 8 posts, the longest 248 counted in full |
| `backlash-line.md` | fits any of the above | 144 |
