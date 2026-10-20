# QUEUE: everything the team could do

The pool, with no order of its own. [NOW.md](NOW.md) is the order. A row is one item, and its done line says how we would know. `docs/BACKLOG.md` stays the public card backlog the studio's agents build from, and a row here that becomes a card names its entry. Rows come from Kyle (`source: Kyle <date>`, paraphrased, because this file is public), the scout (`scout <date>`), the sweep, a review or the audit of 20 October 2026. The daily adds rows, strikes done ones with their pull request, and keeps ids stable; the next free id is Q-048.

Columns:
- **M:** the milestone in [MILESTONES.md](MILESTONES.md).
- **Size:** S fits one daily lane, M takes two or three, L takes many, each step a green slice on `next`.
- **Needs:**
  - **Mac** is the routines' `.env` or a production step;
  - **Kyle** is a duty only he can do, such as posting as himself, buying credit, or a money or strategy call;
  - **any** is anything else.

## Open

| Id | Item, and done when | Area | M | Size | Needs | Source | Status |
|---|---|---|---|---|---|---|---|
| Q-001 | Janitor green: raise `source-map-js` to 1.2.2 or later with a pnpm override (GHSA-68fv-2mgg-jv7q, which comes in through postcss, css-tree and jsdom). Done: the janitor workflow passes | reliability | M1 | S | any | audit | todo |
| Q-002 | The backup copies off GitHub. Done: the nightly prints its `offsite:` line after #261 merges, which its own session owns | reliability | M1 | S | any | audit | watching |
| Q-003 | Production matches main: compare `schema_migrations` with `platform/supabase/migrations/`. Unverified: play counts, card follows, the channel, funnel and daily-dust counters, ledger figures, marketing posts and Terms version 4. Apply each gap after a dump, spot-checking the objects first | reliability | M1 | S | Mac | audit | todo |
| Q-004 | Restore drill: restore the newest backup into a scratch Postgres and read back row counts against production; record it in `docs/specs/money-safety.md` | reliability | M1 | M | Mac | audit | todo |
| Q-005 | The migration history repair in `docs/specs/money-safety.md`, so migrations run through `supabase db push` | reliability | M1 | S | Mac | ROADMAP | todo |
| Q-006 | Spec statuses: about 15 specs still read `agreed` though they are merged (public-ops-jobs, home-flow, home-game-tile, always-open, split-slider, play-counts, board-games-admin, card-follows, ship-notices, place, governance-copy, marketing-engine, ledger-figures, final-state). Run their live lines, move their statuses and ROADMAP's rows, and drop the superseded rows (vps, ops-separation, mac-host, jobs-only-install) | hygiene | M1 | M | any | audit | todo |
| Q-007 | ROADMAP's launch hold line points at "When they go out" in `docs/launch/README.md`, which #255 removed. Rewrite it to the real condition | marketing | M1 | S | any | audit | todo |
| Q-008 | `docs/strategy/prd.md` shows 58 rows "In this series" against 11 Built. Reconcile each row with the code | product | M1 | M | any | audit | todo |
| Q-009 | Stale BACKLOG entries: "Run the studio without an always-on server", "Move the dispatcher off the Mac", "Weekly restore check on Actions", "Actions minutes in the quota check" and "Studio Head triages board notes". Rewrite or retire each, knowing that a rename files a new public card | hygiene | M1 | S | any | audit | todo |
| Q-010 | Delete the stale remote branches: 46 have merged pull requests, and 7 `final-state/*` are ancestors of #194 | hygiene | M1 | S | Mac | audit | todo |
| Q-011 | Email arrives: a sign-up confirmation, a card-follow email and a ship notice each reach a real inbox. Set `STUDIO_REF` and `NOTICES_ENV` if they are missing, and check Resend's sender | product | M1 | S | Mac | audit | todo |
| Q-012 | No empty rooms: the goals track reads `goals: []` live. Give it its first real goals, choose featured seeds, and check that /studio, the feed and home show content to a first visitor | community | M1 | S | Mac | audit | todo |
| Q-013 | Download and delete your profile data (BACKLOG entry of that name). Accounts with passwords are live, so this is owed now | security | M1 | M | Mac | audit | todo |
| Q-014 | The launch go or no-go: every post in `docs/launch/` drafted in §7's order with its channel tag, its links checked live, and the day each is due (two days apart). Kyle posts Reddit, Show HN and X himself, and the marketing engine posts the rest | marketing | M2 | S | Kyle | audit | todo |
| Q-015 | The funnel in the daily report: landings per channel tag, /contribute loads, checkout opens and contributions, read from `daily_metrics` and the ledger | growth | M2 | S | Mac | audit | todo |
| Q-016 | Bluesky and Mastodon keys (`MANUAL-STEPS.md` steps 1 and 2), then `MARKETING_ENV` rebuilt with a dry run | marketing | M2 | S | Kyle | MANUAL-STEPS | optional |
| Q-017 | Show HN ready: the game loads with no account, the landing page explains itself in one screen, and Kyle has a draft comment to rewrite in his own words | marketing | M2 | S | any | PLAN §7 | todo |
| Q-018 | The press list in §7: a one-paragraph pitch for each outlet, sent by Kyle once the Reddit and HN numbers exist | marketing | M3 | S | Kyle | PLAN §7 | todo |
| Q-019 | The weekly video every Tuesday from the release notes, horizontal, from `platform/explainer` | marketing | M3 | S | any | Kyle 2026-10-20 | running |
| Q-020 | The studio's Anthropic key moves to its new Console organisation (the reminder fires on 27 October 2026), then the dispatcher's probe is confirmed | agents | M1 | S | Kyle, Mac | memory | todo |
| Q-021 | Discord ready for strangers: rules, the ship posts channel, a support path and a moderation path | community | M2 | S | Kyle | operating-system §4 | todo |
| Q-022 | Support: an FAQ line for sign-in trouble; hello@clayhouse.studio answered (Kyle is not the group's owner, per MANUAL-STEPS) | community | M2 | S | Kyle | MANUAL-STEPS | todo |
| Q-023 | A nearly full bar is the loudest thing on a card and on home (VISION §6, Meter.tsx). One open card has sat at $0.52 of $0.78 since 11 October | product | M3 | S | any | audit | todo |
| Q-024 | Suggested amounts that finish a card and avoid fee drag (VISION open question 2). A money call, so one line to Kyle first | money | M3 | S | Kyle | VISION | todo |
| Q-025 | Return after ship: the first player-funded card that ships sends its ship notice and follow emails, and they are read back | product | M2 | S | Mac | ROADMAP | todo |
| Q-026 | Dust's welcome-back credit counts up as it lands (VISION §6, `seed-1/render/scene.ts`), and is skipped under reduced motion | game | M3 | S | any | VISION | todo |
| Q-027 | Shipped-in-game marker: a one-time note in Dust naming the card behind a new unit or unlock (VISION §4 item 12) | game | M3 | M | any | VISION | todo |
| Q-028 | Dust depth: the next mechanics, so the incremental crowd stays past four minutes (the gate for r/incremental_games) | game | M3 | L | any | PLAN §7 | parked |
| Q-029 | Each card's link preview names its bar state in words (VISION §6, ShareCard) | growth | M3 | S | any | VISION | todo |
| Q-030 | A creative guide for Dust (BACKLOG entry) | design | M3 | M | any | BACKLOG | todo |
| Q-031 | Record Dust's game quality score with the Game Director's rubric (`docs/strategy/game-quality.md`) | game | M4 | S | any | audit | todo |
| Q-032 | Dust's performance budgets in CI: frame time on a fixed scene and bundle size, each with a failing threshold | performance | M4 | M | any | audit | parked |
| Q-033 | Core Web Vitals and the site's JS size measured in CI on home, a card and /studio, each with a threshold | performance | M4 | M | any | audit | parked |
| Q-034 | Measure the edge cache hit rate and the cost per 1,000 visitors (benchmarks marked not measured) | performance | M4 | M | Mac | benchmarks | todo |
| Q-035 | A site error count with no third-party analytics: a beacon of the error name alone, to `daily_metrics` | reliability | M4 | S | any | benchmarks | todo |
| Q-036 | Run the replay eval and set its first baseline (BACKLOG entry) | agents | M4 | S | Mac | BACKLOG | parked |
| Q-037 | The review team on events (BACKLOG entry) | agents | M5 | L | any | BACKLOG | todo |
| Q-038 | A card supply that keeps pace with funding (BACKLOG entry); moot until money arrives | agents | M8 | L | any | BACKLOG | todo |
| Q-039 | Scorecards for every agent (BACKLOG entry) | agents | M8 | M | any | BACKLOG | todo |
| Q-040 | Confirm or replace the benchmark targets with measured baselines once M2 has two weeks of data (VISION open question 1) | strategy | M3 | S | Kyle | VISION | todo |
| Q-041 | Confirm the kill and pivot lines before the first post (VISION open question 4) | strategy | M2 | S | Kyle | VISION | todo |
| Q-042 | Fold the monthly security audit (BACKLOG entry) into the release candidate's security checks, and retire the entry if they cover it | security | M4 | S | any | BACKLOG | todo |
| Q-043 | M0: the daily, the release candidate, the release, the sweep and the scout each run once, end to end | hygiene | M0 | S | Mac | Kyle 2026-10-20 | doing |
| Q-044 | The dispatcher token's "Plan: read" permission, so the quota check can read the Actions minutes (MANUAL-STEPS step 4) | reliability | M1 | S | Kyle | MANUAL-STEPS | optional |
| Q-045 | A US-dollar bank account in Stripe saves 2% conversion on each payout (§10 decision 77) | money | M2 | S | Kyle | PLAN | optional |
| Q-046 | The goals and milestones that tie eras to real outcomes, kept true as M2 and M3 land (`docs/specs/final-state.md`, Goals) | community | M3 | S | any | final-state | todo |
| Q-047 | Visual baselines: Playwright screenshots of every route at 375 and 1440 px in CI, with masks for live data, so the release candidate compares against the last release | design | M4 | M | any | research | todo |

## Parked

Rows no milestone needs yet, or ones that cost money the studio does not spend.

- Leaked-password protection needs Supabase Pro, which is a spend. Revisit when the studio share covers it.

## Done

Struck rows, each with its pull request. They are deleted 30 days after they are done, and git keeps them.
