# mobmachine-ops (archived)

Merged into AlreadyKyle/mobmachine with its history on 3 November 2026, and the repository archived. Nothing here runs: GitHub reads workflows only from the root `.github`, so `promo.yml` and `itch.yml` below are kept for the record. The marketing engine (`docs/specs/marketing-engine.md`) replaced the promo engine. To bring the itch.io push back, move `itch.yml` to the root `.github/workflows/` and give it the secrets in a GitHub environment, through a board pull request.

What it was: private. It ran Mob Machine's promotion engine (`promo/`, `promo.yml`) and the daily itch.io push (`itch.yml`) on GitHub Actions; secrets for those live only here.

The daily jobs (backup, Controller, quota check, ship notices) moved to the public studio repository on 19 October 2026 (`.github/workflows/ops-jobs.yml` in AlreadyKyle/mobmachine, PLAN.md §10 decision 78) after this account's free private minutes ran out. Runbook: `platform/ops/ops-repo/README.md` there.
