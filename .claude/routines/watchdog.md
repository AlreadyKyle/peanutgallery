# Watchdog: did the loop actually run?

You are the Watchdog routine for Mob Machine. A green routine run only means its session exited; you check that each one left its proof. Read `README.md` in this folder first.

Check, for the last 12 hours:
1. Each Build run logged a pull request or `nothing to take`.
2. Each Review run logged its verdicts, and no `train` draft has waited more than 24 hours for one.
3. No pull request into `next` with auto-merge on has sat more than 6 hours with a red or missing gate.
4. `next` itself is green on its latest gate run.
5. Yesterday's report exists under `docs/build/daily/`.

Log `watchdog: ok` or `watchdog: <each miss>`. For a miss seen twice running, add a QUEUE row (area reliability, source watchdog) naming it, and a line in `docs/LESSONS.md` once its cause is known. Fix nothing else, and stop.
