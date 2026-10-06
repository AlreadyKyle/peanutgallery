# Launch polish: spacing, line height, layout

Status: built. Card: none. Owner: board.

## Problem

Some text on the public site reads very vertically dense. The board's example: on home's Shipped list a row's title wraps onto two lines with almost no leading, and its meta row (the suit tag "The games", "Live", "Board", "Watch how it was built") sits tight under it. The same pattern shows elsewhere: headings and card titles at 1.1 to 1.2 leading, 0.25rem between a choice's title and its summary, rows 0.75rem from their hairlines, and running text up to 704px wide (85 to 90 characters a line at 17px).

## Scope

In:
- Type tokens in `platform/site/src/tokens.css`: the heading leadings and a running-text measure.
- Spacing and line-height rules in `platform/site/src/styles.css`: rows, row titles and meta lines, `/contribute`'s choices, the card page's back link, the paragraph measure, and the home hero's play pill inset from 72rem.
- `platform/site/DESIGN.md`, so the style guide describes what the stylesheet does.

Out:
- Copy, legal text, money flows, checkout, the Payment Link and every kernel component's markup. No markup changes at all.
- The explainer pill's icon-only treatment beyond 64rem to 72rem: `specs/explainer-video.md` pins the labelled pill from 72rem.
- New features, new colours, new components; the card metaphor is unchanged.

## Behaviour

- Headings and titles have room between their lines: the page heading at 1.15, section headings at 1.25, and `h3`, `h4`, card titles, row titles and choice titles at 1.35. Body text stays at 1.6.
- A row stands 1rem from its hairlines. A row's title is a step (0.5rem) clear of the meta line under it, further lines sit 0.375rem apart, and a meta line that wraps keeps 0.25rem between its lines.
- A `/contribute` choice spaces its title, summary, bar and caption 0.5rem apart.
- Running text keeps to about 72 characters a line (`--measure-text`, 36em) inside blocks that still take the 44rem measure; small text, being set in em, keeps a shorter line.
- On a card's page the back link sits 1.5rem above the title instead of a band's section gap (up to 96px).
- On home's hero from 72rem the labelled play pill sits 1rem into its corner instead of 1.5rem, so it keeps a clear gap below the poster's lines.

## Acceptance criteria

- [x] `--leading-display` is 1.15, `--leading-heading` 1.25 and `--leading-title` 1.35; `h3`, `h4`, `.row-title` and `.choice-title` read `--leading-title`.
- [x] Rows pad `--space-2` block and `--space-1` inline; `.row-title + *` is `--space-1` below the title; `.row-meta`'s row gap is 0.25rem.
- [x] `.choice` gaps are `--space-1`.
- [x] Hero paragraphs, a section's own paragraphs, `.prose`, plain and muted paragraphs in `main` and the fixed rules take `max-width: var(--measure-text)`; at 1280px no such 17px paragraph is wider than 612px.
- [x] `.band > .back + .hero` has `--space-3` above it.
- [x] Every style rule test passes: colours only as tokens, every spacing of 0.5rem or more a token, every font-size a size token.
- [x] The whole site e2e suite passes, with layout balance, the explainer poster's pill check at fifteen widths and axe WCAG 2.2 AA at 375 and 1440px finding nothing.
- [x] Every public route was screenshotted at 375, 768 and 1280px before and after, and the after frames were looked at.

## Verification

- `pnpm --filter @backseat/site test`
- `E2E_PORT=4410 npx playwright test` in `platform/site` (every spec: the change is site-wide CSS)
- Full-page screenshots of every route in `e2e/routes.ts` at 375, 768 and 1280px before and after, from a copy of `e2e/route-shots.spec.ts` with those widths (not committed), looked at.
- `pnpm test:docs` and `pnpm secret-scan`
- `pnpm verify` at the repository root

## Evidence

Measured on the e2e build with the supporter studio fixture, before (main at 6c8b0a6) and after:

| Where | Before | After |
|---|---|---|
| Shipped row: title to meta line | 4px | 8px |
| Rows (Shipped, Planned next, the ledger, agent actions): hairline to text | 12px | 16px |
| Page heading leading (52.8px at 1280) | 1.10 | 1.15 |
| Section heading leading ("2. Contribute and choose the split", 32px) | 1.20 | 1.25 |
| Card title leading (20px, two lines on most fund cards) | 1.20 | 1.35 |
| Running text at 1280px (home status line, terms, privacy, refunds, team intro) | 704px, 76 to 91 characters a line | 612px, about 72 |
| /card/:id back link to title at 1280px | 96px | 24px |
| Home hero at 1280px: poster line to the play pill's top | about 4px | about 13px |
| /contribute choice: title to summary | 4px | 8px |

- Site unit tests: `Test Files  48 passed (48)`, `Tests  529 passed (529)` (`styles.test.ts` 81 passed).
- Site e2e, `E2E_PORT=4410 npx playwright test`: `260 passed (2.2m)`, `8 skipped` (the screenshot tests, skipped without `E2E_SCREENSHOTS` and `E2E_ROUTE_SHOTS`). This covers layout balance on every route at 320, 375, 768, 1024 and 1440px, the explainer pill at fifteen widths on `/` and `/how-it-works`, no horizontal scroll at seven widths and at 200% text, and axe at 375 and 1440px on every route and inside the guide's ink bands.
- `pnpm verify` exited 0: site `Tests  529 passed (529)`, board `103 passed`, supabase `325 passed`, dispatcher `872 passed`, seed-1 `83 passed`, `PASS: gate tests passed=686`, `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=738`, docs tests `fail 0`.
- Screenshots: 28 routes and states (84 frames each way) at 375, 768 and 1280px before and after, looked at; kept in the worktree's scratch folder, not committed.
- Left alone, and why: the Terms page names the operator "Peanut Gallery" where the studio is now Mob Machine; that is posted legal text (`src/lib/terms-versions.ts`, kernel), and a posted version is never edited, so it is the board's call for a new Terms version. The paused notice's bold weight in band 1 and the mono dates in rail rows are deliberate (`DESIGN.md`) and unchanged. Building now on home at 1280px draws two cards in a three-column grid; the one-item-per-cell rule (PLAN §10 decision 49) keeps the third cell empty.

## Decisions

- 2026-10-06: Running text gets its own measure (`--measure-text`, 36em) instead of a narrower `--measure`. Narrowing `--measure` would also narrow rows, the ledger's figures and the card page's column, which read well at 44rem; only paragraphs ran long.
- 2026-10-06: The home hero's play pill keeps its label from 72rem and moves a step into its corner, because `specs/explainer-video.md` pins the labelled pill there and the poster check passes either way.
