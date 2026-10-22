# Launch post drafts

The drafts for the announcement (`docs/specs/announcement.md`, Drafts; `docs/ROADMAP.md` criterion 5). Kyle, the studio's owner, edits the Reddit, Show HN, X and LinkedIn drafts into his own voice and posts them himself; no agent posts them (`BOARD-SETUP.md` step 24). The marketing engine posts the rest: Bluesky, Mastodon and Discord, written by its ops job from the studio's own card fields when a card opens or ships, so they have no draft here (`docs/specs/marketing-engine.md`).

## Go or no-go

This list replaces the hold of 18 October 2026, which kept every post back until lines 1 and 2 were true; `docs/specs/governance-copy.md` recorded both as met and lifted it. Kyle answers this list before the first post. Each state was read from the repository or the live site on 22 October 2026, with the source beside it; run the check again rather than trust an old state. Go means every line is met or Kyle waives it; line 11 holds only post 8.

| # | Condition | State on 22 October 2026 | Read from |
|---|---|---|---|
| 1 | The dispatcher runs with no stop (the first condition of the 18 October hold) | Met. Run 39724905732, on main b47424dd, logs `startup probe passed` and `dispatcher drained` and no `stop reason:` line; the studio shows `paused: false` and `offline: false` | `gh run view 39724905732 --log`; https://mobmachine.games/api/live `studio` |
| 2 | Email sign-ups are on (the hold's second condition) | On: sign-in answers `{"signIn":true,"providers":["google","github"]}`. Not yet proven: that a confirmation, a card-follow email and a ship notice reach a real inbox (QUEUE Q-011, todo) | https://mobmachine.games/api/community/auth/settings |
| 3 | Every link in every draft answers, with its channel's tag | Met: all 15 distinct links answer 200 | `curl -sI` on each link |
| 4 | A tagged landing is counted in production | Met: the daily of 22 October checked the channel and funnel counters' migrations against production (Q-003, done), and `play_counts` already holds tagged landings, for example `from_bsky` 29 and `from_mastodon` 26 in total | `docs/build/QUEUE.md`, Done |
| 5 | The site serves main | Met: home's `build-sha` is 6b60d843 (#259), and nothing under `platform/site` or `seed-1` changed between it and main b47424dd; the live-check workflow's run 39777222698 passed | page source; `git diff --stat 6b60d843 b47424dd -- platform/site seed-1` |
| 6 | Dust plays with no account | Met: https://play.mobmachine.games answers 200, served from #250 (`build-sha` 44f26987) | `curl -sI`; page source |
| 7 | A visitor can fund a card | Met: the Payment Link the site serves answers 200, and five cards have room in the funding order | `curl -sI`; `/api/live` `money.funding_order` |
| 8 | A first visitor finds no empty room | Not met: the goals track reads `"goals":[]` and seeds read `"items":[]` (QUEUE Q-012, todo) | `/api/community/goals`, `/api/community/seeds` |
| 9 | Kyle accepts that PLAN.md §8's kill table counts from post 1: under 25 distinct supporters or under $200 gross 30 days after it | Kyle's call. Today `/api/live` shows 1 payment and $5.00 received | `/api/live` `money` |
| 10 | Kyle has rewritten the Show HN comment in his own words | Open: `show-hn.md` holds the draft | `show-hn.md` |
| 11 | Post 8 only: Dust shows depth, its last new mechanic well past the first hour | Not met: the active player's last new mechanic comes at 16 m 09 s (golden-broom), and Dust depth (Q-028) is parked | `npx tsx tests/playtest.ts` in `seed-1` |
| 12 | r/playmygame's video post has its clip | Not checkable here: the 22-second gameplay clip is in the launch kit in the project's shared folder, which Kyle checks | `reddit-playmygame.md` |

## Posting order

The order is PLAN.md §7 Channels (§10 decision 77): one order, each post at least two days after the one before it. Every Reddit post carries `?from=reddit`, so posting on separate days is the only way to tell them apart in the daily totals. The tag is the `from` parameter the site and Dust read (`CHANNEL_SOURCES` in `platform/site/src/lib/count.ts` and `seed-1/render/count.ts`): a landing with `?from=<tag>` counts `from_<tag>`, one of `PLAY_EVENTS` in `platform/site/netlify/functions/card.mts`, and the tag is dropped from the address.

| Order | Where | Posted by | Tag | When | Draft |
|---|---|---|---|---|---|
| 1 | r/ClaudeAI | Kyle | `?from=reddit` | Once Kyle says go | `reddit-claudeai.md` |
| 2 | r/artificial | Kyle | `?from=reddit` | At least two days after post 1 | `reddit-artificial.md` |
| 3 | r/WebGames | Kyle | `?from=reddit` | At least two days after post 2 | `reddit-webgames.md` |
| 4 | r/playmygame | Kyle | `?from=reddit` | At least two days after post 3 | `reddit-playmygame.md` |
| 5 | Hacker News (Show HN), submitting the game with a comment Kyle writes himself | Kyle | `?from=hn` | At least two days after post 4 | `show-hn.md` |
| 6 | X, by hand: the marketing engine does not post to X | Kyle | `?from=x` | At least two days after post 5 | `x-thread.md` (or the single post, `x-post.md`) |
| 7 | LinkedIn, optional, outside §7's order | Kyle | `?from=linkedin` | At least two days after post 6 | `linkedin.md`, Kyle's personal post |
| 8 | r/incremental_games | Kyle | `?from=reddit` | Once go line 11 is met, at least two days after the post before it | `reddit-incremental-games.md` |
| Ongoing | Bluesky, Mastodon and Discord | The marketing engine | `?from=bsky`, `?from=mastodon`, `?from=discord` | When a card opens or ships; Bluesky and Mastodon post once their keys are set (QUEUE Q-016, `MANUAL-STEPS.md` steps 1 and 2) | None: the ops job writes them |

r/incremental_games goes last because its readers turn away short AI-made idle games, and it allows one post about your own game in 30 days. Nothing goes to r/gamedev (PLAN.md §7 Channels). Press comes after these in PLAN.md §7 and has no draft here.

## Before each post

1. Every link points at https://mobmachine.games or https://play.mobmachine.games (PLAN.md §10 decision 59) and carries its channel's tag from the table above. An untagged link reads as 0 for its channel (`docs/specs/channel-counters.md`).
2. Each subreddit's current rules and flair are read on the day of its post.
3. What the rules said in October 2026, from the scan in the project's shared folder:
   - r/incremental_games removes any post without an "AI disclosure:" line, allows a post about your own game once per 30 days and allows no referral links; its draft carries the line.
   - r/ClaudeAI allows a project post with full disclosure of who made it, and keeps a weekly "Show us what you've created" thread; if a top-level post is removed, the draft goes in that thread.
   - r/playmygame allows one post a calendar month.
   - r/indiegames and r/IndieGaming were reported to refuse posts about games made with generative AI. Neither gets a post.
4. Hacker News asks for no generated or AI-edited text and no landing pages or fundraisers in Show HN, so Kyle writes his comment himself from `show-hn.md`'s draft, and the submission is the game.

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
| `reddit-claudeai.md` | title 300, body 40,000 | title 101, body 2,539 |
| `reddit-artificial.md` | title 300, body 40,000 | title 109, body 2,021 |
| `reddit-webgames.md` | title 300, first comment 10,000 | title 95, comment 757 |
| `reddit-playmygame.md` | title 300, first comment 10,000 | title 81, comment 698 |
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
