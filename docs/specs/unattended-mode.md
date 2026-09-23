# Unattended mode

Status: built. Card: none. Owner: board.

## Problem

Agents run only while a board member is signed in at /board. PLAN.md §5 says the fleet runs unattended from launch on a separate pay-as-you-go Anthropic organisation. The unattended adapter is a stub and the dispatcher refuses to start in that mode.

## Scope

In: ~~an unattended adapter that runs the same Claude Code command with the studio organisation's key~~ (superseded: unattended cards run as Claude Managed Agents sessions, `launch-managed.md`); a per-session check that the session is billed to the right account; a startup probe metered to the ledger; a dispatcher heartbeat; JSON-line logs; board controls for the agent mode.
Out: the Claude Agent SDK, a second-provider adapter, the VPS.

## Behaviour

~~`AGENT_MODE=unattended` starts the dispatcher with `STUDIO_ANTHROPIC_API_KEY` mapped to `ANTHROPIC_API_KEY` inside each agent session and nowhere else. The child environment stays the attended allowlist otherwise.~~ Superseded by `launch-managed.md`: in unattended mode the dispatcher starts no agent process. `STUDIO_ANTHROPIC_API_KEY` stays in the dispatcher, which calls the Managed Agents API with it, and each card runs in a container Anthropic hosts that never holds the key. The dispatcher refuses to boot when `studio_state.agent_mode` differs from its own mode, ~~runs the one-turn probe once at startup and meters it~~ (superseded: checks containment and runs one managed probe session billed as `overhead`, `launch-managed.md`), and refuses any session whose init line reports a key source other than `ANTHROPIC_API_KEY`. In attended mode a session that reports `ANTHROPIC_API_KEY` is refused for the same reason. Every tick writes `studio_state.dispatcher_seen_at`; /board shows how long ago. One dispatcher runs per database: startup pauses every card left in `building` or `gated`.

## Acceptance criteria

- [x] `STUDIO_ANTHROPIC_API_KEY` is required in unattended mode, ignored in attended mode, and refused when equal to `ANTHROPIC_API_KEY`.
- [x] ~~The unattended child environment equals the attended allowlist plus `ANTHROPIC_API_KEY` set to the studio key;~~ (superseded: unattended mode has no child process, `launch-managed.md`) the dispatcher's own `ANTHROPIC_API_KEY` never reaches a child in either mode.
- [x] A session whose `start` event carries the wrong `apiKeySource` for the mode ends `refused` before any tool runs.
- [x] The startup probe writes a ledger row with a null card id. Under `launch-managed.md` it is one managed session billed as `overhead`, with a null role id too.
- [x] `tick` starts a funded card in unattended mode with no board session.
- [x] Dispatcher log lines parse as JSON with `ts`, `level`, `scope` and `msg`.

## Verification

- `pnpm --filter @backseat/dispatcher test` (unattended, config, stream, session, tick, factory, log, probe-core and startup tests; `startup.test.ts` covers the mode check before the probe and the probe's ledger row).
- `AGENT_MODE=unattended pnpm --filter @backseat/dispatcher probe` with the key set: the first line starts `PASS:` and carries `apiKeySource=ANTHROPIC_API_KEY`, and the probe writes ~~one ledger row~~ its session's ledger rows (superseded: a managed session writes one row per model request plus a runtime row and a settle row, billed as `overhead`, `launch-managed.md`) with a null card id and a null role id. A `FAIL:` first line exits non-zero. In attended mode the probe writes no ledger row.
- `AGENT_MODE=unattended pnpm --filter @backseat/dispatcher start` with the key set: the dispatcher logs JSON lines with scope `probe`, ~~a `probe metered` line naming the ledger row~~ (superseded: `containment verified` and `session metered` lines, `launch-managed.md`) and a `startup probe passed` line with `apiKeySource` `ANTHROPIC_API_KEY`; /board shows the heartbeat, and one Next card funded to its target reaches `live` without a board session.

## Decisions

- ~~2026-09-14: the same CLI, not the SDK. The command line, tool allowlist and stream parser are already tested; only the credential and the board-session rule differ.~~ Superseded: `launch-managed.md` (22 September 2026). Unattended cards run as Claude Managed Agents sessions, so no agent-written code runs where the dispatcher's secrets are.
- 2026-09-14: the studio key lives under its own name in the dispatcher environment so the founder's key is never used unattended by accident.
- 2026-09-14: the probe runs once per dispatcher start, not per card. Its verdict does not vary by card and each run costs money.
- 2026-09-16: probes and card sessions are reconciled from the result line (superseded for unattended sessions: each is settled to the list cost the session reports, `launch-managed.md`). The assistant lines under-report output tokens, so each turn is still metered as it arrives and the session is settled to its `modelUsage` priced with `PRICE_TABLE_JSON`, or to an estimate when no result line arrives (`docs/specs/metering-reconciliation.md`).

## Evidence

2026-09-14: `config.test.ts` (studio key), `unattended.test.ts` (child environment), `session.test.ts` (wrong `apiKeySource` refused), `startup.test.ts` (probe ledger row, billed to studio), `tick.test.ts` (starts with no board session), `log.test.ts` (JSON lines). Pending live: the unattended probe and a funded card building with no board session, on the VPS (`docs/specs/vps.md`).
