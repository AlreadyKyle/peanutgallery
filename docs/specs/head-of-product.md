# Head of Product: a monthly review of the site from its frames

Status: draft. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

Nothing in the studio looks at the site as a whole. The Directors review only the frames a card changed, and only before it merges. On 11 October 2026 the board ran a design pass by hand and found the hero's button sending people to play rather than fund (fixed by decision 72), an explainer video a full phone screen tall, a single open card with dead space beside it, and lanes of very different heights. The Head of Product role exists to find this kind of problem (`platform/agents/prompts/head-of-product.md`), but it is `starts` with no tools and no job. The board asked to wake it.

## Scope

In:
- One role job, `product_review`, that grades every page of main's site frames against the site's design rules and returns typed findings.
- The role spec change: the class from web_only to reviewer, the tools Read, Glob and Grep, and the status running once the job ships.
- A schema for the findings, `platform/agents/schemas/product-review.schema.json`.
- A rubric, `platform/agents/rubrics/product.md`.
- Where findings go.

Out:
- Reading the live web or any outside text. This review reads only frames the gate renders from main, so the role reads no public text.
- Comparisons with other products, which need the web (a later step, with a web_only session that writes nothing).
- The money-path trace in code and data.
- Running more often than monthly, or after big changes.
- Filing platform cards automatically. Platform backlog cards stay manual (decision 66).

## Behaviour

- **Frames.** Once a New York month, the dispatcher renders main's frames for every public route at 375, 768 and 1440 px, with the kernel screenshot spec `route-shots.spec.ts`, as the gate's frames job does.
- **The session.** It starts one Managed Agents session for the Head of Product. The session holds Read, Glob and Grep, no Bash, Write, Edit, web or MCP tool, and no fallback model. Its folder holds those frames, `platform/site/DESIGN.md`, `docs/COPY.md` and the rubric.
- **The answer.** The session answers one `product-review` object: up to eight findings. Each finding has a page, a width, a frame file name, a criterion (first_action, dead_space, unbalanced, legibility, copy_mismatch, all_ages) from a closed list, a severity (high, medium or low) and a short title that passes the deny-list. A finding carries no free-text instruction to a writing role.
- **Billing.** The review is billed as one card of its own, "Monthly site review", opened by the dispatcher and funded like any card (the money rule of "Post-ship grade and monthly design audit"). It runs only when that card's bar has filled, so no overhead budget is needed.
- **Where findings go.** Findings appear on the card's page as fixed lines and on the board's panel. The board files any it wants as kernel work. A high-severity all_ages finding alerts the board by ntfy.
- **The role on /team.** The role moves from Starts to Running only in the pull request that ships the job, so /team never shows it running before it does.

## Acceptance criteria

- [ ] `platform/agents/head-of-product.json` has class reviewer and tools Read, Glob and Grep, and `specs.test.mjs` holds the new values.
- [ ] `product-review.schema.json` is draft 2020-12, allows no other keys, has at most eight findings and closed lists for criterion and severity.
- [ ] A `product_review` run with no funded review card does not start, and one with a funded card starts one session billed to that card.
- [ ] The session's folder holds frames from main only, and the session has no web, MCP, Write, Edit or Bash tool.
- [ ] A frozen frame set with a known dead-space frame gives a finding with criterion dead_space in the replay eval (a new `product` set).
- [ ] /team shows the Head of Product as Running only after the job's pull request merges.

## Verification

- `pnpm verify`
- `node --test platform/agents/specs.test.mjs`
- `pnpm --filter @backseat/dispatcher test` (the new job handler's tests)
- `pnpm eval:replay -- --set product --k 3` at the Mac, with its pass^k recorded

## Evidence

## Decisions

- 11 October 2026: the board asked to wake the Head of Product first among the sleeping roles, to automate the design pass it ran by hand that day. Its first job reads the gate's frames of main, not the live web, so it reads no public text and fits the read/write rule without a web_only session.
