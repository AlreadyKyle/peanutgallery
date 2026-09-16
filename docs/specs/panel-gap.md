# Close the dead space under the pitch

Status: done. Card: none. Owner: board.

Written on 16 September 2026, after the change merged as 4f60c7c (PR 30), from its commit message, its diff and its pull request.

## Problem

The board reported a gap on the landing page. The Right now panel shares a two-column grid row with the pitch, so the row is as tall as the taller of the two. The panel's list of the last three agent actions made it about 350px taller than the pitch, and the difference showed as dead space under the Contribute button.

## Scope

In:
- The Right now panel drops its list of recent agent work.
- The landing page's Ledger section shows the agent work instead.
- `site-layout.md` and `BRAND.md` updated to match.
- `.claude/worktrees/` added to `.gitignore`, so the desktop app's agent worktrees cannot be committed by accident.

Out: the panel's other contents, the grid breakpoints, and the ledger page.

## Behaviour

- The Right now panel shows the Available figure, what is building (or "Nothing is building"), "Latest shipped: <title>" once a card has shipped, and a Full ledger link. It carries no list, so it stays about as tall as the pitch beside it.
- The Ledger section on the landing page lists the recent agent events, as the ledger page already does.

## Acceptance criteria

- [x] The Right now panel has no "recent work" heading and no event list.
- [x] The landing page's Ledger section shows the event list, or its empty line when there are no events.
- [x] The landing page's level-3 headings no longer include the panel's recent-work heading.
- [x] `site-layout.md` strikes the "last three agent actions" item and `BRAND.md` describes the panel without a list.

## Verification

- `pnpm verify` at the repository root exits 0.
- `pnpm --filter @backseat/site test` and `pnpm --filter @backseat/site e2e`.
- The built site in the browser at 1440px and at the stacked width.
- The `gate` check on the pull request.

## Evidence

- **Tests.** `platform/site/src/pages/Landing.test.tsx`: the Right now panel has no `copy.recentWork` text, the page still shows `copy.ledgerEmpty` outside the panel, and the level-3 heading list no longer starts with `copy.recentWork`.
- **Suites,** as reported in PR 30: `pnpm verify` exit 0; site tests 123 passed; site e2e 11 passed.
- **Browser,** as reported in PR 30: on the built site at 1440px the dead space under the pitch went from about 350px to 59px, checked at the stacked width too.
- **Gate.** Run 35053241678 on PR 30: `detect` success, `seed-config` skipped, `seed-code` success, `platform` success, `gate` success at 2026-09-16T03:51:53Z. Merged at 03:52:10Z as 4f60c7c.

## Decisions

- 2026-09-16: the agent work moves to the Ledger section below, where the same events already belong. The panel keeps the figures a first-time reader needs at a glance.
