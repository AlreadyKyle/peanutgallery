# NOW: the order of work

The daily build takes the first unblocked item. Kyle's notes go ahead of this list (`docs/build/README.md`, Kyle's review). At most six items; adding one means demoting one. The daily takes items off when they are done and puts the next ones on in MILESTONES order. The vision pass, or Kyle, re-ranks the list. Each item is a row in [QUEUE.md](QUEUE.md).

**The current milestone is M3's conversion and reach work, with M1's two owed items alongside** ([MILESTONES.md](MILESTONES.md)). Kyle re-ranked the order on 26 October 2026: the floor is true enough, the studio has almost no audience (in the 7 days to 26 October, 185 home loads, 7 /contribute loads and no contribution), and no stranger has yet seen the pitch happen: a card funded, built and shipped. So the order makes that moment happen, makes it visible and gives people a reason to stay. Each item states the bet it makes in its pull request, scored in [EXPERIMENTS.md](EXPERIMENTS.md).

| # | Item | QUEUE | Area | Size | Done when |
|---|---|---|---|---|---|
| 1 | Finish this card: home and Dust lead with the open card nearest done, saying what is left and that one contribution finishes it, and the bar is the loudest thing on the card | Q-023 | product | S | A deploy preview shows the nearest card on home and in Dust, with stills at 375 and 1440 px |
| 2 | Ship Replays: each shipped card gets a 20 to 30 second before-and-after clip with its timeline (funded, built, gated, live, cost), shown on the card page and handed to the marketing engine and the weekly report | Q-051 | growth, marketing | M | A replay plays on a shipped card's page on a deploy preview, made by the capture tool with no hand step |
| 3 | Follow it live: after checkout, the thanks page tracks the funded card through drafted, building, the gate and live, and links its ship notice | Q-052, Q-025 | product | M | A test checkout's thanks page shows the card's stage from live data on a deploy preview |
| 4 | Dust depth: the next mechanics past the 16-minute mark, scored against the game quality bar, and Daily Dust's share on home | Q-028 | game | L | `npx tsx tests/playtest.ts` shows a new mechanic after 30 minutes, and the quality score is recorded |
| 5 | This week, in public: a page of the week's players, cards funded, cards shipped and contributions from public records, which also fills the weekly report's numbers | Q-053 | growth | S | The page renders from production's public views on a deploy preview |
| 6 | The first goals: the era thresholds become `community.goals` rows through an add-only migration on the train, and /studio/history shows each era's unlock line | Q-012, Q-049 | community, design | S | /goals shows its milestones on a deploy preview |

**On the Mac, alongside:** players can download and delete their profile data (Q-013, owed since accounts are live) and the restore drill (Q-004). **Moved to the Sunday sweep:** docs truth (Q-006, Q-050). **Watched by the daily report, not lanes:** email delivery (Q-011). **Kyle's own, and nothing waits on it:** the launch posts in `docs/launch/README.md`'s order (Q-014), best started once item 2 is live.

**Parked:** the performance budgets in CI (Q-032, Q-033) and the replay eval baseline (Q-036).
