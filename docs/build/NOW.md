# NOW: the order of work

The daily build takes the first unblocked item. Kyle's notes go ahead of this list (`docs/build/README.md`, Kyle's review). At most six items; adding one means demoting one. The daily takes items off when they are done and puts the next ones on in MILESTONES order. The vision pass, or Kyle, re-ranks the list. Each item is a row in [QUEUE.md](QUEUE.md).

**The current milestone is M1, a clean floor, with M0 running alongside** ([MILESTONES.md](MILESTONES.md)). The reason for the order: the studio is healthy but idle, and nothing outranks opening the door. So the floor a stranger would stand on comes first, then the launch posts.

| # | Item | QUEUE | Area | Size | Done when |
|---|---|---|---|---|---|
| 1 | The first goals: the era thresholds the site already shows become `community.goals` rows through an add-only migration on the train, and /studio/history shows each era's unlock line | Q-012, Q-049 | community, design | S | /goals shows its milestones on a deploy preview, with stills at 375 and 1440 px |
| 2 | Players can download and delete their profile data | Q-013 | security | M, Mac | Both work for a signed-in test profile on a deploy preview, and the migration rides the train |
| 3 | Restore drill: the newest backup restored into a scratch Postgres, its row counts read back against production | Q-004 | reliability | M, Mac | The counts match, recorded in `docs/specs/money-safety.md` |
| 4 | Docs truth: specs that still read `agreed` though merged get their live lines run and statuses moved, with ROADMAP's rows to match | Q-006, Q-050 | hygiene | M | Every spec status and ROADMAP row says what is true, and PLAN §7 matches the marketing engine |
| 5 | The funnel in the daily report: landings per channel tag, /contribute loads, checkout opens and contributions | Q-015 | growth | S, Mac | The daily report's Health section quotes them each day |

**Watched by the daily, not lanes:** email delivery (Q-011, from Resend's log). **Kyle's own, and nothing waits on it:** posting the launch posts in `docs/launch/README.md`'s order (Q-014, §10 decision 77).

**Parked** until M1 is done: Dust depth (Q-028), the performance budgets in CI (Q-032, Q-033), and the replay eval baseline (Q-036).
