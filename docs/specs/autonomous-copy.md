# Public copy for the self-refilling supply

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

Under `docs/PLAN.md` §10 decision 66 the Game Designer drafts a card whenever too few are open (`docs/specs/unattended-roles.md`, PR4), and the Studio Head's ranking is retired. The public site still said agents draft and rank "when the board asks" and that the board approves what gets built.

## Scope

In: the Who runs it copy on /how-it-works and /team (`platform/site/src/lib/legal.ts`), the agents line (`copy.ts`), the Game Designer's and the Studio Head's role descriptions (`platform/agents/*.json`, shown on /team) and their golden snapshot, and the roster comment.
Out: the Terms (unchanged; no new version), the board's standing duties (unchanged).

## Behaviour

- Who runs it: the board is the people who own the studio and can step in; the board files cards on the roadmap, and when too few cards are open the Game Designer drafts one and the Game Director grades it, with no one asking.
- The agents line and the two role descriptions say the same.

## Acceptance criteria

- [x] No public copy says the agents draft or rank "when the board asks".
- [x] /how-it-works and /team show the new Who runs it lines (`HowItWorks.test.tsx`, `Team.test.tsx`, `e2e/pages.spec.ts`).

## Verification

- `pnpm verify`
- `E2E_PORT=4490 npx playwright test e2e/pages.spec.ts` in `platform/site`
- After the merge: `pnpm --filter @backseat/supabase seed` from a checkout equal to the merge (after a dump), so the roles' descriptions in the database match; `node platform/site/scripts/live-check.mjs`.

## Evidence

- `platform/site` vitest 514 passed; `e2e/pages.spec.ts` 19 passed; `platform/agents/specs.test.mjs` 127 passed; `pnpm test:docs` 22 passed.

## Decisions

- 2026-10-10: copy only; merges after `unattended-roles.md` PR4 so the site never describes behaviour that is not live.
