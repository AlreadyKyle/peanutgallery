# NOW: the order of work

The daily build takes the first unblocked item. Kyle's notes go ahead of this list (`docs/build/README.md`, Kyle's review). At most six items; adding one means demoting one. The daily takes items off when they are done and puts the next ones on in MILESTONES order. The vision pass, or Kyle, re-ranks the list. Each item is a row in [QUEUE.md](QUEUE.md).

**The current milestone is M1, a clean floor, with M0 running alongside** ([MILESTONES.md](MILESTONES.md)). The reason for the order: the studio is healthy but idle, and nothing outranks opening the door. So the floor a stranger would stand on comes first, then the launch posts.

| # | Item | QUEUE | Area | Size | Done when |
|---|---|---|---|---|---|
| 1 | Production matches main: read `schema_migrations` against the repo, and apply the gaps with a dump first | Q-003 | reliability | S, Mac | Every migration on main is recorded and its objects exist, quoted in the report |
| 2 | Email arrives: sign-up confirmation, card follow and ship notice | Q-011 | product | S, Mac | Each one lands in a real inbox, and the secrets it needs are set |
| 3 | Janitor green: `source-map-js` raised to 1.2.2 or later (GHSA-68fv-2mgg-jv7q) | Q-001 | reliability | S | The janitor workflow passes on `next`'s head |
| 4 | No empty rooms: the goals track, featured seeds and the studio page show real content | Q-012 | community, design | S, Mac | A stranger's first look at home, /studio and the goals shows nothing empty, with stills at 375 and 1440 px |
| 5 | The door opens: the launch hold line made true, every post drafted with its channel tag, and a go or no-go for Kyle | Q-007, Q-014 | marketing | S | Kyle has the posts in order, with the day each is due, and says go |
| 6 | Players can download and delete their profile data | Q-013 | security | M, Mac | Both work for a signed-in test profile on a deploy preview, and the migration rides the train |

**Parked** until M1 is done: Dust depth (Q-028), the performance budgets in CI (Q-032, Q-033), and the replay eval baseline (Q-036).
