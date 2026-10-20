# Governance copy: the owner, not a board; the money line as built; Privacy after passwords

Status: agreed. Card: none. Owner: studio.

## Problem

Public copy still describes a "board" that the studio retired (PLAN.md §10 decisions 66 and 74): the operator is one person, the studio's owner, Kyle Smith. Two money lines say agents spend only on funded cards, but drafting and grading are billed to the card drafted and paid from contributions, and money on no card pays for drafting new cards (PLAN.md §4 Who files cards, §10 decision 73). Privacy says sign-in is by emailed link only, though passwords exist since #247, and says nothing public shows a name, though a profile's name and avatar can be public. /team carries stale role words (the Curator runs; the Head of Finance's trigger is from before decision 65). PLAN.md and the site's roster comment describe the studio code lane as closed, but `studio_state.platform_lane_open` is true in production.

## Scope

In: every human-readable string listed under Behaviour; Terms version 4 (one wording change); a migration that re-seeds six roles' rows; the launch drafts in `docs/launch/`; the lane text in PLAN.md §3 and §4 Work and in `platform/site/src/lib/roster.ts`; `docs/SYSTEM.md`'s role table; the skip link's words moved into `copy.ts`; comments and test names in `platform/site/src` that used "board" for the owner.

Out: every internal identifier (table and column names such as `cards.board_work`, `board_vetoed`, `board_test_usd`, `board_test_payments`; the `board` value of `cards.source` and `pause_reason`; the failing-check codes `cancelled_by_board`, `paused_by_board`, `board_session`; the `/board` path, `platform/board`, `BOARD-SETUP.md`, `board-site.md`, `board-address.mjs`); the agents' prompts under `platform/agents/prompts/`; PLAN.md beyond the lane text; history specs; posted Terms versions 1 to 3, which are never edited. Every kernel guard is unchanged in substance: the gate, the caps, the split, the reserves, the kill switch, the read/write separation, the content filter and the all-ages rating.

## Behaviour

Every string changed, old → new.

`platform/site/src/lib/legal.ts` (kernel):

| Key | Old | New |
|---|---|---|
| agentShareLine | The agents' share pays only for the AI model time that builds funded cards, and the ledger lists every cost. | The agents' share pays for the AI model time that drafts, grades and builds cards; each cost is billed to its card and listed on the ledger. |
| fixedRules[1] | Agents spend contributions only on funded cards, within set caps. | Agents spend contributions only on cards, within set caps. |
| howMoneyMoves, Where the money goes | Agent credit pays only for model usage on funded cards, within daily and per-card caps. | Agent credit pays only for model usage on cards, within daily and per-card caps. |
| contributorsOne / contributorsMany | 1 contributor / {n} contributors | 1 supporter / {n} supporters |
| contributorsLabel | Contributors | Supporters |
| boardTestLine | The pool includes {usd} of the board's own test payment; it funds no card. | The pool includes {usd} of the studio's own test payment; it funds no card. (the same as #253) |
| describeCorrections | Changes the board recorded by hand to correct the books. | Changes the studio recorded by hand to correct the books. (the same as #253) |
| pausedMoneyStays | Its money stays on it until it resumes or the board cancels it. | Its money stays on it until it resumes or is cancelled. (the same as #253) |
| failingCheckWords.cancelled_by_board | The board cancelled it. | The studio cancelled it. |
| failingCheckWords.paused_by_board | The board paused the studio while it was being built. | The studio was paused while it was being built. |
| failingCheckWords.board_session | The board session it was running in ended. | The session it was running in ended. |
| failingCheckWords.horizon | The board moved it to a later part of the roadmap. | It was moved to a later part of the roadmap. |
| failingCheckWords.vetoed | The board set it aside. | The studio set it aside. |
| heldByBoard | Held by the board | Held by the studio |
| whoRuns.paragraphs[0] | Mob Machine is run by AI agents and a board: the people who own the studio and can step in, today Kyle Smith. | Mob Machine is run by AI agents and its owner, Kyle Smith, who can pause the agents, cancel a card and change the spending caps. |
| whoRuns.paragraphs[1] | The board can pause the agents, cancel a card and change the spending caps. | The owner may also file cards. |
| whoRuns.paragraphs[2] | When too few cards are open, the Game Designer, an AI agent, drafts one and the Game Director grades it before it opens. The board may file cards too. | When too few cards are open, the Game Designer, an AI agent, drafts one and the Game Director grades it before it opens. |
| whoRuns.boardLabel → ownerLabel | The board can step in | The owner can step in |
| pausedFallback | It stopped on a check the board is looking into. | It stopped on a check the studio is looking into. |
| privacyUpdated | Last updated 19 October 2026. | Last updated 20 October 2026. |
| privacy, Sign-in | Board members, and players who keep a profile, sign in with a link sent to their email address. Sign-in uses Supabase Auth, which keeps that address so you can sign in again. | Players who keep a profile sign in with their email and a password, or with a link sent to that email. Sign-in uses Supabase Auth, which keeps that address so you can sign in again. Where the sign-in page offers Google, Apple, GitHub or Discord, you can sign in with one of them instead, and it gives Supabase Auth your email address. |
| privacy, What is public | The public pages show totals, such as the money available and each card's number of contributors. They never show names or email addresses. | The public pages show totals, such as the money available and each card's number of supporters. They never show an email address. |
| privacy, Supporter numbers | Nothing public shows a name or an email address. | A profile's name and avatar are public when you choose. Without a profile, nothing public shows a name or an email address. |

`platform/site/src/lib/copy.ts`:

| Key | Old | New |
|---|---|---|
| skipToContent (new; was `SKIP_TO_CONTENT` in App.tsx) | Skip to content | Skip to content |
| statusPicked | Picked by the board | Picked by the studio |
| whoMadeWhat.body[2] | The human board sets the rules and the checks and decides what can be built. | The studio's owner sets the rules and the checks and decides what can be built. |
| sources.board | Filed by the board | Filed by the studio |
| team.rolePaused | The board has paused this agent. | The studio has paused this agent. |
| team.faces.picked | Picked by the board: a signal ribbon inside the top edge, and the same money as open. | Picked by the studio: a signal ribbon inside the top edge, and the same money as open. |

Terms version 4 (`platform/site/src/lib/terms-versions.ts`, posted by `20261020210100_terms_version_4.sql`): version 3's words with one change in If a card is not built, "If a card is rejected, or the board cancels it, …" → "If a card is rejected, or the studio cancels it, …". Versions 1 to 3 stay bundled and served at /terms/n and /refunds/n. The Refunds words are unchanged. Privacy is not versioned (`docs/specs/legal-copy.md`); its date moves.

Roles (`platform/agents/*.json` and `20261020210000_governance_role_copy.sql`):

| Role | Field | Old | New |
|---|---|---|---|
| HR | description | … and proposes changes to a role for the board to approve. | … and proposes changes to a role. |
| Head of Product | description | Looks at the studio the way a newcomer, a supporter and the board see it, … | Looks at the studio the way a newcomer and a supporter see it, … |
| Host | description | Narrates the studio's work on a live stream and speaks up for chat. | Narrates the studio's work on a live stream. |
| Curator | status, trigger | starts, "Starts when the board turns on suggestion triage." | running, no trigger |
| Studio Head | trigger | Starts when its backlog entries are built: drafting cards from the roadmap and triaging board notes. | Starts when its backlog entry is built: drafting cards from the roadmap. |
| Head of Finance | trigger | Starts once the first Stripe payout has bought the agents' model credit. | Starts when the review team joins the benchmark review, a backlog entry. |

The Head of Finance's trigger is the backlog entry that brings it in: no job runs it (`platform/dispatcher/src/job-handlers/index.ts` registers none), and `docs/BACKLOG.md` "The review team on events" names finance among the reviewers to join the benchmark review.

Launch drafts (`docs/launch/`): "a human board, which is me" and "the human board of Mob Machine" become "me, its owner", "the studio's owner, which is me" or "the owner of Mob Machine"; "The board can pause …" becomes "As its owner, I can pause …"; the board's personal post, comment and voice become the owner's. The README drops the hold until two conditions held (both are met) and keeps the rule that r/incremental_games goes last; its "Where the words come from" quotes whoRuns, whoMadeWhat and the spending rule as they read after this change, and its length table is measured again.

## Acceptance criteria

- [ ] No public string in `legal.ts`, `copy.ts` or the newest Terms version uses "board" for the owner; the remaining hits of `grep -rni board platform/site/src docs/launch` are internal identifiers, kanban or ideas-list words, a section title (PLAN.md §4 The Board), a file name, or posted Terms versions 2 and 3.
- [ ] The money lines say agents spend on cards, not only funded cards, and no page repeats the old line (unit and e2e tests).
- [ ] Privacy names passwords and the one-time link, the provider buttons only where offered, and a profile's public name and avatar; it never says "display name" (copy.test.ts).
- [ ] Terms version 4 differs from version 3 only in "or the studio cancels it"; its migration inserts only its row and runs twice (migration tests); /terms shows version 3 until that row is posted.
- [ ] The role migration changes exactly the six rows to their role files' words, leaves other roles alone and changes nothing on a second run (`governance_role_copy_test.ts`).
- [ ] `docs/SYSTEM.md`'s role table equals the role files (`pnpm test:docs`).

## Verification

- `pnpm verify`
- `pnpm test:docs`
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/governance_role_copy_test.ts platform/supabase/functions/_shared/migration_test.ts platform/supabase/functions/_shared/money_logic_test.ts`
- `E2E_PORT=4470 npx playwright test e2e/pages.spec.ts e2e/card.spec.ts e2e/landing.spec.ts e2e/money.spec.ts e2e/design.spec.ts` in `platform/site`
- `grep -rni "board" platform/site/src docs/launch`, each remaining hit explained in the pull request.

Production, after the merge and the site deploy of the merge sha: apply `20261020210000_governance_role_copy.sql`, then post Terms version 4 by the procedure in `docs/specs/legal-copy.md` (a dump, `20261020210100_terms_version_4.sql`, the CDN purge, the live check showing "Version 4, in force since").

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-10-20: The owner approved every item. Privacy says "A profile's name and avatar" where the request said "display name": the legal-copy rule that no public string says "display name" stands, and the site's own label is "Your name on the site". The provider sentence is added because #247's buttons send the provider's email address to Supabase Auth whenever a provider is on.
- 2026-10-20: The migrations are stamped after #253's and #254's (20261020210000 and 20261020210100), so production applies them in file order.
