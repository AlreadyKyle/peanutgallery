# Alert noise

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

The board's ntfy topic carried alerts that said the wrong thing or said it every day. The quota check posted "the billing usage could not be read" daily and hid the cause: GitHub answered http 403 because the dispatcher's token lacks Plan read. The Controller's `console_credit` mismatch of 7 October 2026 was the check decision 65 removed, run by the ops repository from a ref before #131; `STUDIO_REF` carries the fix and every reconcile run since 8 October 2026 is `ok, 0 mismatches`. The stuck-card and hard-stop alerts of 8 October 2026 (card 802b9b7a waiting at `gated` for a board member) are fixed by removing the wait itself (`docs/specs/unattended-roles.md`), not here.

## Scope

In: the quota check's alert text and repeat rule; the stale lines in `merge-safety.md`, `money-safety.md` and `controller.mjs`.
Out: the visual review's wait and the board-session gates (`unattended-roles.md`); the token's permission, a board step.

## Behaviour

- The quota alert carries GitHub's error and a fix chosen by its status: 403, add Plan: Read to the token; 401, regenerate an expired or revoked token; 404, check `GITHUB_BILLING_USER`.
- The same failure alerts once, again when it changes, and again after seven days. Every run still writes its `controller_runs` row; the alerted one carries `figures.alerted` and `figures.alert_signature`. If the earlier rows cannot be read, it alerts.

## Acceptance criteria

- [x] A 403, 401 and 404 from the billing usage API each give their own fix, and the alert carries the error.
- [x] The same quota failure alerts once and not on the next day's run; a changed failure alerts again; the same failure alerts again after seven days.

## Verification

- `pnpm verify`
- After the board adds Plan: Read to the dispatcher's token: run the ops repository's jobs workflow for `quota`; its `controller_runs` row shows `actions_minutes` ok.

## Evidence

- `platform/ops/test/jobs.test.mjs`: "alerts at 350 MB…" (the fix by status) and "alerts a failure once, again when it changes, and again only after seven days".
- Before the fix (read 10 October 2026): every quota row from 7 to 10 October 2026 carries `"error": "github billing usage: http 403"`.

## Decisions

- 10 October 2026: the board-review wait changes in the first draft of this branch were dropped; `unattended-roles.md` removes the wait.
