# Gate repair

Status: built. Card: none. Owner: studio.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

A card whose change fails the gate is gated once more (`gate_retry`, for a check that flakes) and then rejected: the builder never hears what failed, so a typo in a test or a scan hit ends a funded card that a one-line fix would have shipped. Of the first 15 cards the studio built, 4 were rejected, all at the gate or the visual review. The builders' prompts also told them to run the bot, typecheck and tests, but not the scans and the build the gate runs, so a session could end sure of a pass the gate would refuse. Agent systems that ship code well close this loop: the agent runs the same checks the reviewer will run, and a failing check goes back to the agent with what failed before anyone gives up on the work.

## Scope

In: the dispatcher's card pipeline (`platform/dispatcher/src/pipeline.ts`, `gate-repair.ts`, the failed-step read in `github.ts`), the builder, QA and platform builder prompts (`platform/agents/prompts/`), and `docs/SYSTEM.md`.
Out: the gate itself (`platform/gate/`, `.github/workflows/gate.yml`), the flake retry, the visual review's rounds, money and the ceiling. No job log is read.

## Behaviour

The builder prompts end each session with the whole gate in its local form, `bash platform/gate/ship-gate.sh --folder <folder> --lane <lane> --dry-run` (the platform builder runs its scans phase), and the session ends only on `GATE PASS`.

When the gate fails a card's own change on a green base past the flake retry, the card gets one repair round instead of a rejection, once per card. It starts only as a visual revision would: not while the board has agents paused (the card pauses), not while the executor role is paused or the claim's session budget is spent (the card goes back to funded and keeps its stored patch). The dispatcher records a `gate_repair` event with the failed jobs and steps, then the builder revises in a new session inside the card's ceiling, given only the failed jobs and steps by their gate workflow names (at most 8, each name checked against the characters the workflow uses) and, for each, the local command that runs the same check. The repair and the change become one commit on the base, pushed to the same branch and pull request, and gated again; a failure after that rejects the card with failing check `gate`. A gate that fails a visual revision gets the same one round, if the card has not used it.

The step names come from the gate workflow, a kernel path, so the repair session reads nothing the public wrote (PLAN.md §4, read/write rule).

## Acceptance criteria

- [x] A gate that fails the card's change twice, with no repair yet, starts one repair session whose prompt opens with the repair line; a third failure rejects the card with failing check `gate`.
- [x] A repair whose commit passes the gate carries the card on to live, and its prompt names each failed step with its local command and never the final `gate` job.
- [x] A card that already had its repair round is rejected with no session; a repair does not start while the executor role is paused, and the card goes back to funded with its stored patch.
- [x] The failed-step read takes the newest failed gate run on the sha, only from the gate workflow, and reads no jobs when there is none.
- [x] A name outside the workflow's characters is dropped from the prompt, and no more than 8 steps are named.
- [x] The builder, QA and platform builder prompts name the local gate command and end only on `GATE PASS`.

## Verification

- `pnpm --filter @backseat/dispatcher typecheck` and `pnpm --filter @backseat/dispatcher test`
- `node --test platform/agents/specs.test.mjs`
- `pnpm verify`

## Evidence

- `platform/dispatcher/test/pipeline.test.ts`: "rejects on a gate that fails again after its one repair round, without merging", "gates a stored patch once more after its own change fails on a green base, then repairs it once and rejects it", "a gate repair that passes carries the card on, with the failed steps and their local commands in the prompt", "repairs a card once only, and starts no repair while its executor role is paused".
- `platform/dispatcher/test/github.test.ts`: "failedGateSteps".
- `platform/dispatcher/test/gate-repair.test.ts`: "repairAddendum".

## Decisions

- 2026-10-18: the repair comes after the flake retry, not before it. The retry costs no session, and a check that flakes passes on it; a session is spent only on a failure that held twice.
- 2026-10-18: one repair round per card, recorded before its session. A restart never repairs twice, and a card that cannot be repaired in one round costs at most one session more than before.
- 2026-10-18: no job log is read. The step names say where the change failed, and the local command lets the builder see the output itself; a log could carry text the change wrote, which the prompt should not be built from.
