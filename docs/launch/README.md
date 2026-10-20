# Launch post drafts

The drafts for the announcement (`docs/specs/announcement.md`, Drafts; `docs/ROADMAP.md` criterion 5). The studio's owner edits them into his own voice and posts them; no agent posts them (`BOARD-SETUP.md` step 24).

## r/incremental_games goes last

r/incremental_games goes last, once Dust shows depth: the playtest's "Last new mechanic" line (`seed-1/tests/playtest.ts`) is well past the first hour. Its readers turn away short AI-made idle games, and the subreddit allows one post about your own game a month.

## Before anything is posted

1. Every link points at https://mobmachine.games or https://play.mobmachine.games (PLAN.md §10 decision 59) and carries its channel's tag: `?from=reddit`, `?from=hn`, `?from=x` or `?from=linkedin`. The site and Dust count each tagged landing as a daily total and drop the tag (`docs/specs/channel-counters.md`); an untagged link reads as 0 for its channel.
2. Each subreddit's current rules and flair are read before its post goes up.
3. What the rules said in October 2026, from the scan in the project's shared folder:
   - r/incremental_games removes any post without an "AI disclosure:" line, allows a post about your own game once per 30 days and allows no referral links; its draft carries the line.
   - r/ClaudeAI allows a project post with full disclosure of who made it, and keeps a weekly "Show us what you've created" thread; if a top-level post is removed, the draft goes in that thread.
   - r/indiegames and r/IndieGaming were reported to refuse posts about games made with generative AI. Neither gets a post.
4. Hacker News asks for no generated or AI-edited text and no landing pages or fundraisers in Show HN, so the owner writes his comment himself from `show-hn.md`'s facts, and the submission is the game.

## Posting order

The order is PLAN.md §7 Channels (§10 decision 77). Leave at least two days between posts: every Reddit post carries `?from=reddit`, so posting on separate days is the only way to tell them apart.

| Order | Where | Draft |
|---|---|---|
| 1 | r/ClaudeAI | `reddit-claudeai.md` |
| 2 | r/artificial | `reddit-artificial.md` |
| 3 | r/WebGames | `reddit-webgames.md` |
| 4 | r/playmygame | `reddit-playmygame.md` |
| 5 | Hacker News (Show HN), submitting the game with a comment the owner writes himself | `show-hn.md` |
| 6 | X, by hand until the marketing engine has its keys | `x-thread.md` (or the single post, `x-post.md`) |
| 7 | LinkedIn, optional | `linkedin.md`, the owner's personal post |
| 8 | r/incremental_games, once Dust shows depth (above) | `reddit-incremental-games.md` |

Nothing goes to r/gamedev (PLAN.md §7 Channels). Press comes after these in PLAN.md §7 and has no draft here.

`backlash-line.md` is the prepared reply to a comment that objects to AI in games, on any of the posts.

Every post says who made what in the same words: the AI agents write the games' code, numbers and text and make every change; the art is drawn by code the agents wrote, with no image, sound or music model; the studio's owner sets the rules and the checks. The site carries the same line on /how-it-works (`copy.ts` whoMadeWhat). No post says "first" of anything.

`war-stories.md` holds the facts for posts the owner writes in his own words: what broke, what it cost and what changed. Those travel further than product posts.

## Where the words come from

Every claim is the live site's own wording or a fact in the repository:

- The pitch: "Watch AI agents build a game studio and free games. Fund the card you want built next." (`platform/site/src/lib/copy.ts` pitchTitle and pitchBody, PLAN.md §2).
- How a card is funded, built, checked and rolled back: /how-it-works (`copy.ts` howItWorksPage, `legal.ts` howMoneyMoves).
- The split: "Before the split, 10% of every contribution after Stripe's fee is held in reserve. Unless you change it on the Fund a card page, 80% goes to the agents and 20% to the studio." (`legal.ts` splitLine).
- All ages, the art line, the ledger, the spending rule ("Agents spend contributions only on cards, within set caps.") and the read rule: `legal.ts` allAges, artPolicy and fixedRules.
- The owner and what he can do: "Mob Machine is run by AI agents and its owner, Kyle Smith, who can pause the agents, cancel a card and change the spending caps." (`legal.ts` whoRuns, on /how-it-works and /team).
- Who made what: "The studio's owner sets the rules and the checks and decides what can be built." and the two lines before it (`copy.ts` whoMadeWhat, on /how-it-works).
- The model and how a card's session runs: /team, PLAN.md §10 decision 36 and PLAN.md §6 The pipeline.
- The Game Designer's drafts and the Game Director's grades, which run on their own when too few cards are open and are billed to the card they draft: PLAN.md §4 Who files cards and §10 decision 66, and `legal.ts` whoRuns.

No draft gives a figure the site can move, such as a supporter count, money raised or a card's cost; a reader who wants one is sent to https://mobmachine.games/ledger. No draft says the studio or its games are open source (`docs/specs/announcement.md`). The only contact address is hello@clayhouse.studio.

## Length limits

Measured on the drafts as written, with the current domain and each link's tag.

| Draft | Limit | Measured |
|---|---|---|
| `reddit-claudeai.md` | title 300, body 40,000 | title 101, body 2,500 |
| `reddit-artificial.md` | title 300, body 40,000 | title 109, body 1,982 |
| `reddit-incremental-games.md` | title 300, body 40,000 | title 102, body 2,097 |
| `show-hn.md` | title 80; the first comment held under 2,000 | title 79, comment 1,862 |
| `x-thread.md` | 280 a post, a link counted as 23 | 8 posts, the longest 248 counted in full |
| `x-post.md` | 280, a link counted as 23 | 263 counted, 272 in full |
| `linkedin.md` | 3,000 | 1,277 |
| `backlash-line.md` | fits any of the above | 163 |

## Media

A before and after pair of Dust comes from `seed-1/scripts/capture.ts`. It builds a checkout, serves it, and draws the same states (the sim with seed 1 at 0, 600, 3,600 and 21,600 seconds unless `--states` says otherwise) from the same camera, with the page clock fixed and paused as the frames spec draws them, so two runs differ only where the game changed. Each state at each width gives the page (`dust-<seconds>s-<width>.png`) and the island alone (`dust-<seconds>s-<width>-canvas.png`), and `capture.json` names the commit.

1. Check out the before, main, in its own worktree: `git worktree add ../dust-before origin/main`, then `pnpm install --frozen-lockfile` in `../dust-before`.
2. Draw it: `pnpm --filter @backseat/seed-1 capture -- --root ../dust-before/seed-1 --out shots/before --widths 1280,390`. Where main already has the script, running the same command inside `../dust-before` without `--root` does the same.
3. Draw the after from the new commit's checkout, with the same flags: `pnpm --filter @backseat/seed-1 capture -- --out shots/after --widths 1280,390`.
4. Pair the files with the same name, then `git worktree remove ../dust-before`.

Each version is drawn from its own sim, so a change to pacing shows as a different state at the same second. Set `E2E_PORT` (or `--port`) when another preview holds the default port 4180.
