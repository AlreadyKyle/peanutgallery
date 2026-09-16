# Working method: spec-driven, for us and for the agents

Status: done. Card: none. Owner: board.

## Problem

The agent prompts told a builder what it may edit and when to stop, but not how to work: no restatement of the acceptance test, no plan, no verification step named as such, no report. The session prompt omitted the estimate and the design spec. Our own changes had no written contract beyond a plan file.

## Scope

In: `docs/specs/` with a template; a spec-driven section in the root `CLAUDE.md`; a Working method block in the four write-role prompts; estimate, ceiling, design spec and a definition of done in the session prompt.
Out: installing the BMAD framework or any multi-persona planning suite. The card already is the story (intent, acceptance test, estimate, executor) and the gate plus the pre and post `check:` evaluation already is QA; the studio's roles are data in `platform/agents/`.

## Behaviour

For us: no feature work without a spec under `docs/specs/`; a change is done only when every line of its Verification section has been run and its output quoted; `docs/PLAN.md` is the constitution and `pnpm verify` is the floor.

For the agents: a session receives the card with its estimate and ceiling, the design spec when one exists, and a definition of done. The role prompt tells it to Understand (restate the acceptance test, quote each `check:` line), Plan (one short message: files to touch, commands to run), Implement (the smallest change), Verify (run the named commands; red means fix or stop and report), and Report (pass or fail against the acceptance test verbatim, files changed).

## Acceptance criteria

- [x] `docs/specs/TEMPLATE.md` exists and every spec in the folder follows it.
- [x] The root `CLAUDE.md` carries the spec-driven section.
- [x] `sessionPrompt` includes `Estimate:`, `Ceiling:`, `Definition of done` and, only when set, `Design spec:`.
- [x] `builder-a.md`, `builder-b.md`, `qa.md` and `platform-builder.md` each carry a `## Working method` section with the five steps.

## Verification

- `pnpm --filter @backseat/dispatcher test` (session prompt assertions).
- `pnpm test:agents` (prompt assertions; 64 tests pass).

## Decisions

- 2026-09-14: the block lives in each prompt file rather than a shared file. The adapter appends exactly one file per role and the spec test asserts per file.

## Evidence

2026-09-14 (checked on main at b2c6360):
- `docs/specs/TEMPLATE.md` exists; every spec carries Status, Scope, Acceptance criteria, Verification and Decisions.
- The root `CLAUDE.md` has the "Spec-driven development" section.
- `platform/dispatcher/test/session.test.ts` asserts `Estimate:`, `Ceiling:`, `Definition of done` and `Design spec:` only when set.
- `node --test platform/agents/specs.test.mjs`: 64 pass, 0 fail, including the working-method checks for the four building roles.
