# <Title>

Status: draft | agreed | built | done. Card: <id or none>. Owner: <board or role>.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

What is wrong or missing, in two or three sentences.

## Scope

In: what this change covers.
Out: what it deliberately leaves alone.

## Behaviour

What the change does, as the user or the system sees it. Plain sentences, no implementation detail that a test would not check.

## Acceptance criteria

- [ ] One statement per line that is true or false.

## Verification

The exact commands or checks that prove it. The change is done only when each has been run and its output quoted here or in the session report.

- `pnpm verify`

## Evidence

Added when the status moves to built or done: for each criterion, the test that proves it or the quoted live output.

## Decisions

- <date>: <decision>. <reason>.
