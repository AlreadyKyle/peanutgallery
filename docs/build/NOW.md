# NOW: the order of work

The daily build takes the first unblocked item. Kyle's notes go ahead of this list (`docs/build/README.md`, Kyle's review). At most six items; adding one means demoting one. The daily takes items off when they are done and puts the next ones on in MILESTONES order. The vision pass, or Kyle, re-ranks the list. Each item is a row in [QUEUE.md](QUEUE.md).

**The current milestone is M1, a clean floor, with M0 running alongside** ([MILESTONES.md](MILESTONES.md)). The reason for the order: the studio is healthy but idle, and nothing outranks opening the door. So the floor a stranger would stand on comes first, then the launch posts.

| # | Item | QUEUE | Area | Size | Done when |
|---|---|---|---|---|---|
| 1 | Email arrives: sign-up confirmation, card follow and ship notice. The sending side is checked (daily 2026-10-22); it waits on a real sign-up | Q-011 | product | S, Mac, Kyle | Each one lands in a real inbox |
| 2 | No empty rooms: the goals track, featured seeds and the studio page show real content. The rooms are truthful (#267); the first goals wait on Kyle | Q-012 | community, design | S, Kyle | A stranger's first look at home, /studio and the goals shows nothing empty, with stills at 375 and 1440 px |
| 3 | The door opens: the posts are drafted in order with their tags and a go or no-go list (#266); waiting on Kyle's go | Q-014 | marketing | S, Kyle | Kyle has the posts in order, with the day each is due, and says go |
| 4 | Players can download and delete their profile data | Q-013 | security | M, Mac | Both work for a signed-in test profile on a deploy preview, and the migration rides the train |
| 5 | Restore drill: the newest backup restored into a scratch Postgres, its row counts read back against production | Q-004 | reliability | M, Mac | The counts match, recorded in `docs/specs/money-safety.md` |
| 6 | Docs truth: specs that still read `agreed` though merged get their live lines run and statuses moved, with ROADMAP's rows to match | Q-006 | hygiene | M | Every spec status and ROADMAP row says what is true |

**Parked** until M1 is done: Dust depth (Q-028), the performance budgets in CI (Q-032, Q-033), and the replay eval baseline (Q-036).
