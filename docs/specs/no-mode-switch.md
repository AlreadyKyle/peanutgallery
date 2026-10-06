# No agent mode switch

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

The studio runs: the dispatcher is on GitHub Actions on the studio's Console credit, and `studio_state` reads unpaused and unattended (set by the board on 6 October 2026). The board's site still showed an Agent mode line and an attended/unattended switch the board does not want.

## Scope

In: the board site's Agent mode line and switch. Also `.mcp.json`, the project's Supabase MCP server.
Out: the database column, the `set_agent_mode` RPC and the dispatcher's mode check, all unchanged; the Pause button (the kill switch, a kernel rule).

## Behaviour

The board's Studio status shows whether the agents run and when the dispatcher was last seen, with no mode line or switch.

## Acceptance criteria

- [x] The board's site renders no Agent mode text or control (`Board.test.tsx`).

## Verification

- `npx vitest run` in `platform/board`

## Evidence

2026-10-06: board vitest 105 passed.

## Decisions

- 2026-10-06: the studio just runs; no mode switch on the board's site (the board).
