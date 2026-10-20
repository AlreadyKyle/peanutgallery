# Milestones

Where the daily build is heading, in order, with no dates. A milestone is done when every exit line holds with its evidence quoted in a daily report or a release note. `docs/strategy/roadmap.md` holds the long phases. M5 and later point at its phases rather than copying them. The vision pass, on the first Sunday of the month, checks progress here. Changing the order is Kyle's call.

## Where we are (the audit of 20 October 2026)

Everything planned for the final-state series is merged (#194 and its follow-ups). Production is healthy: the live check reads `passed=279 failed=0`, the gate is green, and the dispatcher's startup probe passes. But **the studio is idle**: one payment in total, no card built since 10 October, drafting held with reason `no_sales`, and no launch post sent. Until strangers arrive, every growth and money benchmark reads zero, and the kill clock in `docs/PLAN.md` §8 has not started. So the first milestones make the floor true, then open the door. Polish waits.

## M0. The rhythm runs

The daily build, the release candidate and the release each work once, end to end.

- `next` exists, and a daily lane has merged into it on a green gate.
- A daily report has reached Kyle, and his reply was taken in by the next run.
- A Monday release candidate gave a verdict with every check quoted.
- A Tuesday release shipped, or was held for a named reason, with the live check's first line quoted.
- A sweep and a scout have each run once.

## M1. A clean floor

Everything a stranger could touch is true and green before the posts go out.

- **Reliability.**
  - The nightly backup prints its `offsite:` line (#261).
  - The janitor workflow is green.
  - The daily jobs are green for 7 days running.
  - A restore drill has read a backup back.
- **Production truth.** `supabase_migrations.schema_migrations` matches `platform/supabase/migrations/`, and every gap has been applied or explained.
- **Email.** A sign-up confirmation, a card-follow email and a ship notice each arrive at a real inbox.
- **No empty rooms.** The goals track, featured seeds and the studio page show real content to a first visitor.
- **Legal.** A signed-in player can download and delete their profile data.
- **Docs truth.**
  - Every `docs/ROADMAP.md` row and spec status says what is true.
  - `docs/strategy/prd.md`'s states match the code.
  - The launch hold line points at a section that exists.
  - The stale branches are gone.

## M2. Strangers arrive

The launch posts go out in `docs/PLAN.md` §7's order and the funnel is measured.

- The posts go out in order, at least two days apart: Reddit (r/ClaudeAI, r/artificial, r/WebGames, r/playmygame), then a Show HN with Kyle's own comment, then X. Kyle posts these himself (§10 decision 77). The marketing engine posts the rest. The daily drafts each post, checks its links and their channel tags, and says on which day it is due.
- Landings from each channel are read from `daily_metrics` (`docs/specs/channel-counters.md`).
- A real contribution from a player is credited on the meter. This closes ROADMAP's live criterion 1 and the live lines of the seven specs waiting on it.
- A card funded by a player builds unattended and ships, with its ship post and ship notice.
- Exit: every "What live means" criterion in `docs/ROADMAP.md` holds.

## M3. Clear the kill line

The 30 days after the first post decide whether the studio continues. The kill table in `docs/PLAN.md` §8 says the studio needs at least 25 distinct supporters and $200 gross in that window.

- **Conversion:**
  - the bridge from play to fund (Dust's next-card line, bars that are nearly full, cards small enough to finish);
  - suggested amounts with no fee drag;
  - checkout completion read from the funnel counters.
- **Return:** ship notices, follow emails, Since your last visit and the weekly report all reach the players who funded.
- **Reach:**
  - the weekly video every Tuesday;
  - posts on each channel;
  - r/incremental_games once Dust has depth;
  - the press list in §7.
- **Dust depth:** enough new mechanics that the incremental crowd stays past four minutes (`docs/specs/counter-senders.md`).
- Exit: the kill line is cleared. If instead it is crossed, the vision pass puts the pivot call to Kyle.

## M4. Measured quality

This runs beside M3, filling the lanes M3's waiting leaves free. It is the exit of Phase 1 in `docs/strategy/roadmap.md`.

- Dust has a recorded game quality score of 24 or more, with no criterion below 2 (`docs/strategy/game-quality.md`).
- **Performance budgets in CI:** Dust's frame time and bundle size, the site's JS size, and Core Web Vitals on home, a card and the studio page, each with a failing threshold.
- 0 serious axe violations on every route (in place; keep it).
- Every PRD row marked "In this series" is Built, or re-scoped with a reason.

## M5 to M9. The phases

| Milestone | Phase in `docs/strategy/roadmap.md` | Exit |
|---|---|---|
| M5. Prove the new surface | Phase 2 | Stage 1 of the path to profitability, and a repeat supporter rate of 10% |
| M6. The stage | Phase 3 | Live on Twitch from /broadcast, unattended, behind the delay and the kill switch |
| M7. The second game | Phase 4 | Two live games, each at the quality bar |
| M8. Scale | Phase 5 | A card supply that keeps pace, scorecards for every agent, and board time under 3 hours a week |
| M9. More income | Phase 6 | Each income line under its own kernel spec |

## Every milestone, every area

Each milestone moves more than code. While a milestone is current, its QUEUE rows cover these areas, and the sweep flags any area starved for two weeks:

- **strategy:** the vision pass, the kill table, and the order of milestones.
- **game:** fun first, under the game quality bar.
- **product and design:** the site as a stranger meets it, to `platform/site/DESIGN.md`.
- **growth and marketing:** the posts, the video, channel tags, link previews and the press list.
- **community:** Discord, moderation and support paths.
- **money:** the ledger, fees, coverage and cost per shipped card.
- **agents:** roles, prompts, evals, models and their prices.
- **reliability, performance and security:** the floor everything else stands on.
- **hygiene:** docs truth, memory, and this rhythm.
