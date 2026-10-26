# Experiments

Every pull request that changes what a player or visitor sees states a bet in its body: the metric it should move, from what to what, within 14 days. The Build routine copies the bet here when the pull request merges, and the Report routine scores it at 7 and 14 days against [SCOREBOARD.md](SCOREBOARD.md). The vision pass reads the results and re-weights the order of work by what actually moved, so the team learns which kind of change grows the studio. A result is one of `held`, `missed` or `too little traffic to tell`; with this little traffic the last is honest and common, and it is not counted as a win.

| Merged | Pull request | QUEUE | Bet | Day 7 | Day 14 | Result |
|---|---|---|---|---|---|---|
