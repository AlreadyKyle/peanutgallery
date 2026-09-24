# Money surfaces: money in, reconciled with Stripe, the next card in line, stopped cards and why the studio is paused

Status: done. Card: none. Owner: board.

Built on the merge of money-logic (and home-and-design, #64). It reads what money-logic publishes and writes no SQL. It is a board pull request: it changes kernel files (`legal.ts`, `payment.ts`, `Funding.tsx`, `Ledger.tsx`, the two new kernel components, `docs/`).

## Problem

After `money-logic.md`, the database knows the order money fills cards in, what came in, what is not on a card, whether the Controller's last reconcile passed, where a stopped card's money went, and why the studio is paused. The site shows none of it:
- /contribute's Pick for me does not say which card it funds next.
- Its choices use the site's own order and predicate, not the waterfall's. A funded card that a refund left below its target takes money but is not offered, and a vetoed or closed-lane card would be.
- /ledger shows neither money in nor the studio's income, never says whether the books match Stripe, and has no Not on a card yet or shortfall figure.
- A rejected or paused card disappears, because the site reads only the stages from proposed to live (R14, L02).
- The paused notice gives one line whatever the cause.

## Scope

In:
- `platform/site/src/lib/source.ts`: two new enrichments, `money` (`public_money`, one row) and `stopped` (`public_stopped_cards`, newest 12); `pause_reason` arrives through the existing `select('*')` on `public_studio`.
- `payment.ts`: `fundableCards(snapshot)` and `nextInLine(snapshot)`, both from `money.funding_order`.
- `Funding.tsx`, `Contribute.tsx`, `Ledger.tsx`, `PausedNotice.tsx` (exports `pausedSentence`, which home's status line in `Landing.tsx` also uses), and two new kernel components, `MoneyIn.tsx` and `Stopped.tsx`.
- `legal.ts`: every new string, the plain words for stop reasons, and `fixedRules[0]`.
- `kernel-paths.txt` and `KERNEL_PATHS`.
- Tests: unit tests, e2e fixtures (`fixtures.ts`, `live-studio.ts`), a new `e2e/money.spec.ts`, `paused.spec.ts`, and `live-check.mjs`.
- Docs: `DESIGN.md`, `ROADMAP.md`, PLAN §4 (The Board's public list; Not built yet), `BACKLOG.md`.

Out:
- Any money logic or SQL (money-logic).
- The operations bucket. It is removed from the series until a percentage exists, so nothing here mentions or reads it.
- /thanks, /card/:id and supporter lists (supporter-pages, which links each Stopped row to /card/:id). Carrying `money` and `stopped` in the cached snapshot (site-snapshot).
- Card faces for stopped cards: the Stopped band is rows, and cards stay in band 2 (DESIGN.md, Bands).
- The copy pass over every public string (copy-pass).

## Behaviour

**/contribute.**
- Pick for me stays first and names the first card in `money.funding_order`: "Next in line: <title>". With no card in the order, it says the money waits in Not on a card yet and funds the next card that opens.
- The card choices are exactly the `funding_order` cards, in that order, in one list (no category groups, which could reorder them), each linking the Payment Link with its card's `client_reference_id`. Under them, one line: "Anything beyond a card's target funds the next cards in line."
- A card's live Fund this button (on /contribute, /roadmap or anywhere `Funding.tsx` renders) shows only when the card is in `funding_order`. Home's Fund what's next and its status line count and draw as open for funding only the open cards in `funding_order`, so a card that takes no money (a vetoed card) is neither called open nor drawn without its button among cards that have one; with `public_money` unread they keep every open card, none with a button.
- When `public_money` did not load, /contribute offers Pick for me with no card named ("Your contribution funds whatever the agents build next."), "Not available right now." in place of the card choices, and no Fund this buttons anywhere. Pick for me money is safe without the order: it waits in Not on a card yet and the waterfall places it.

**/ledger, the funding band.**
- Not on a card yet, from `not_on_card_usd`, a figure in the same list as the pool, the reserve, the emergency fund and held money, described as money given with no card or beyond a card's target, waiting for the next card to open.
- When `short_usd` is above 0, a line says waiting cards are short by that amount until new money arrives.
- While `board_test_usd` is above 0: "The pool includes $X of the board's own test payment; it funds no card." `board_test_usd` is the payment's agent credit, the part of it in the pool ($0.5019 of the $1.00 in production), not the payment.

**/ledger, a Money in band.**
- Eight figures, each with a one-line description: received (with the number of payments), Stripe fees, refunded, disputed (net of disputes won), the 10% reserve, the studio's income, the emergency fund and agent credit. Held money and corrections show only when not zero. They add up: received − fees − refunded − disputed + corrections = reserve + studio + emergency fund + held + agent credit (money-logic's identity; the board's test payment is in none of them, by money-logic's SQL).
- With `payments` 0, the band says "No contributions yet." in place of the figures.
- The studio figure's description adds "At checkout they chose N% on average, weighted by amount, and the default is 20%." from `studio_pct_avg`, left out when it is null.
- Under the figures, exactly one line: "Reconciled with Stripe on <date>" when the latest reconcile run passed, else "Not yet reconciled with Stripe".

**/ledger, a Stopped band.** Drawn only when it has rows; two lists of rows, each drawn only with rows:
- **Paused**: title, state tag, the reason in plain words, what it spent, and that its money stays on it until it resumes or the board cancels it.
- **Didn't ship** (rejected or cancelled): title, reason in plain words, what it spent, "funded by $X from N supporters" (from `credited_usd` and `public_card_funding.contributors`; the count left out when the funding read failed, the phrase left out when nothing reached the card), and where its unspent money went: each card by title and Not on a card yet, with amounts.
- Each row carries the date it stopped in the rail, like the ledger's other rows, and the band opens with one line: "Cards that stopped before they shipped, why, and where their money is."
- A reason is plain words from `legal.failingCheckWords`; a code with no entry shows its stage's fallback sentence. The raw code never shows. Stopped cards appear on no other page (`snapshot.cards`' stage filter is unchanged).

**The paused notice and home's status line** say the same sentence, `pausedSentence(snapshot)`: the reason for `awaiting_credit` (waiting for a Stripe payout to buy the agents' model credit), `spend_limit` (the monthly limit on model usage), `incident` (a problem the board is checking) or `board`; the general line when the reason is missing or has no sentence; nothing when not paused or the studio row did not load. It names the category only, never who paused or when.

**Anything that did not load** says "Not available right now." instead of a zero or an empty band. A single figure whose read failed says it as a muted line under its label (`Stat` with no value), never in the figure's place.

**The fixed rule** becomes "The public ledger shows the money that comes in, where it goes and the cost of all agent work paid for with contributions."

**Design.** Tokens only, bands by position, the coin only beside money figures, WCAG 2.2 AA, reduced motion respected and no dead space: the existing `design.spec.ts` (axe) and home's `layout-balance.spec.ts` enforce it.

## Acceptance criteria

- [x] /contribute, with `public_money` loaded (e2e): Pick for me is first and says "Next in line: <title of the first `funding_order` card>", or the waits line when the order is empty; the card choices are exactly the `funding_order` cards in order (fixture: a funded card below its target first in line is first; a vetoed card absent from the order is absent), each linking the Payment Link with its `client_reference_id`; the waterfall line shows under them; a card's live Fund this button renders only when the card is in `funding_order`.
- [x] With `public_money` failing (e2e): /contribute shows Pick for me naming no card and no card choices or Fund this buttons, and each /ledger part fed by a failed read (`money` or `stopped`) says "Not available right now." instead of a figure.
- [x] The Money in band shows the eight figures from `public_money`, each with a description, and held money and corrections only when not zero; a unit test renders a fixture with every figure non-zero and asserts the shown figures satisfy received − fees − refunded − disputed + corrections = reserve + studio + emergency fund + held + agent credit.
- [x] /ledger (e2e fixture variants): Not on a card yet always shows from `not_on_card_usd`; the shortfall line shows if and only if `short_usd` > 0; the board test line if and only if `board_test_usd` > 0; "No contributions yet." replaces the Money in figures if and only if `payments` is 0; the average-split sentence shows if and only if `studio_pct_avg` is not null.
- [x] Exactly one reconciliation line shows: "Reconciled with Stripe on <date>" when `last_run_ok` is true, "Not yet reconciled with Stripe" when it is null (no run) or false (e2e, all three).
- [x] A rejected card (e2e fixture with moves to two cards and to Not on a card yet) shows under Didn't ship with its reason in plain words, what it spent, "funded by $X from N supporters", and each destination with its amount.
- [x] A paused card shows under Paused with its state tag, its reason in plain words, what it spent and that its money stays on it; with no stopped rows the Stopped band is not drawn, each list is drawn only with rows, and a `failing_check` with no entry in `legal.failingCheckWords` shows its stage's fallback, never the code (unit test).
- [x] Home's status line and the paused notice on /contribute show the identical `pausedSentence` for each of `awaiting_credit`, `spend_limit`, `incident` and `board`, the general line when `pause_reason` is null, and nothing when not paused or the studio row did not load (unit tests and `paused.spec.ts`).
- [x] `MoneyIn.tsx` and `Stopped.tsx` are in `platform/gate/kernel-paths.txt` and `KERNEL_PATHS` and the parity test passes; `legal.fixedRules[0]` is the new sentence and `docs.test.mjs` still finds the ledger in it; `BACKLOG.md` and PLAN §4 Not built yet no longer list "Split aggregate on the meter" or "Handling a dispute the studio wins"; PLAN §4 The Board's public list names money in, the reconciliation status, Not on a card yet and the shortfall, and stopped cards with their money trail.
- [x] With `live-studio.ts` carrying `public_money` and `public_stopped_cards` rows (a paused and a rejected card), `design.spec.ts` (axe WCAG 2.2 AA, no sideways scroll, reduced motion) and `layout-balance.spec.ts` pass on /contribute and /ledger at 375, 768 and 1440.
- [x] `live-check.mjs` checks that Pick for me is first with its next-in-line or waits line, /ledger shows exactly one reconciliation line, /ledger's received figure (or "No contributions yet.") matches `public_money.received_usd` (or `payments` 0) read with the anon key, and / and /contribute show the payout sentence while `pause_reason` is `awaiting_credit`; it passes against the local preview and, after the deploy, against https://peanutgallery.games. (Both halves done: production step 1 printed PASS with all four checks PASS, not SKIP, against production data, and after the deploy of 187f403 the live check against https://peanutgallery.games printed PASS with failed=0, Evidence, Ship and Production.)

## Verification

- `pnpm verify` at the repository root.
- `pnpm --filter @backseat/site test`
- `E2E_PORT=<free port> pnpm --filter @backseat/site e2e`
- `E2E_ROUTE_SHOTS=<folder> E2E_PORT=<free port> pnpm --filter @backseat/site e2e`, and the /contribute and /ledger shots at 375, 768 and 1440 looked at.
- `pnpm --filter @backseat/site build && pnpm --filter @backseat/site preview`, then `node platform/site/scripts/live-check.mjs http://localhost:<port> --allow-no-data`.
- Production, after the deploy: `pnpm --filter @backseat/site exec node scripts/live-check.mjs` prints PASS.

## Production steps

1. Before the merge, once money-logic has merged and its production steps have applied its migration (`public_money` and `public_stopped_cards` answer the anon key): build this branch with `netlify.toml`'s production values, `vite preview` it on a free port, run `node platform/site/scripts/live-check.mjs http://localhost:<port> --allow-no-data`, and quote a PASS in which the next-in-line (or waits), reconciliation, received (or "No contributions yet.") and payout-sentence checks print PASS, not SKIP. Tick the local half of the last criterion. Do not merge until it passes.
2. Netlify builds the site from main on merge. Confirm the served build sha equals the merge sha.
3. Run `pnpm --filter @backseat/site exec node scripts/live-check.mjs` against https://peanutgallery.games and quote the PASS.
4. Record the Evidence and set this spec to done.

Board items (listed, none blocks this pull request):
- /ledger says "Not yet reconciled with Stripe" until `STRIPE_READ_KEY` exists (BOARD-SETUP step 4) and the Controller's first reconcile passes.
- While the board's $1 test payment is unrefunded, /ledger names it in one line; the line goes after the refund (BOARD-SETUP step 12).

## Evidence

Built on `launch/money-surfaces` from `launch/money-logic` at 33274fd (stacked on money-logic, which had not merged). No SQL. The production lines of Verification and the production steps are the ship stage's and are not run here; the last criterion's production half waits on the deploy, after money-logic's migration puts `public_money` and `public_stopped_cards` in production (today both answer `PGRST205 Could not find the table ... in the schema cache` to the anon key).

`pnpm verify` at the repository root, with both `dist-e2e` folders deleted first, exits 0:

```
platform/board test:       Tests  71 passed (71)
platform/supabase test:       Tests  286 passed (286)
platform/site test:       Tests  415 passed (415)
seed-1 test:       Tests  77 passed (77)
platform/dispatcher test:       Tests  619 passed (619)
platform/gate test: PASS: gate tests passed=508
PASS: payment-host-scan files=7 allowed=0
PASS: banned-phrases files=499 paths=575 message=yes
docs.test.mjs: pass 15, fail 0
rename.test.mjs: pass 6, fail 0
exit 0
```

`pnpm --filter @backseat/site test`: `Tests  415 passed (415)`, among them `MoneyIn.test.tsx` (every figure non-zero, the shown figures read back from the page satisfy received - fees - refunded - disputed + corrections = reserve + studio + emergency fund + held + agent credit, 101.50 = 101.50; held and corrections left out at zero; "No contributions yet."; exactly one reconciliation line for a pass, no run and a failed run), `Stopped.test.tsx` (the Paused and Didn't ship rows; an unknown code shows its stage's fallback, never the code; nothing drawn with no rows), `PausedNotice.test.tsx` (each reason, the general line for a null or unknown reason, nothing when not paused or the studio row did not load), `cards.test.ts` (`fundableCards`, `nextInLine`, `inFundingOrder`: a funded card below its target first, a vetoed card absent, nothing when `public_money` did not load), `Contribute.test.tsx`, `Landing.test.tsx` (the status line for each reason), `Ledger.test.tsx`, `Cards.test.tsx` (a live Fund this card only for a card in the order) and `source.test.ts` (the two reads, their columns, order and limit, and each named missing when it fails or carries a malformed figure).

The kernel lists: `platform/dispatcher/test/worktree.test.ts` (the `KERNEL_PATHS` = `kernel-paths.txt` parity) and `site-kernel.test.ts` (`MoneyIn.tsx`, `Stopped.tsx` and `PausedNotice.tsx` are kernel and import only kernel files): `Tests  36 passed (36)`; `bash platform/gate/test/run-tests.sh`: `PASS: gate tests passed=508`.

`E2E_PORT=4457 pnpm --filter @backseat/site e2e` (the full suite; at this run `layout-balance.spec.ts` audited the launch-shaped fixture, carrying `public_money` and a paused and a rejected card, at 320 to 1440, but `design.spec.ts` ran axe on `DEFAULT_STUDIO` only, at 375 and 1440, with no stopped cards, shortfall or test payment line; the review fixes below add that):

```
Running 129 tests using 4 workers
  5 skipped
  124 passed (2.2m)
```

It includes the new `e2e/money.spec.ts` (/contribute follows the funding order; the empty order; `public_money` and `public_stopped_cards` failing on /contribute, home and /ledger; Money in's eight figures, the three reconciliation variants, "No contributions yet.", held money and corrections with no average split; Not on a card yet, the shortfall and the board's test payment; the Paused and Didn't ship rows with the money trail) and `paused.spec.ts` (the general line at 375 and 1440, each of the four reasons on / and /contribute, and a stale reason while not paused). The run before the fixes found two layout findings, both fixed: the status line's pause glyph beside a long reason at 320px (the pair is now marked as a marker, not two columns) and a card missing from the funding order in the seven-card fixture.

`E2E_ROUTE_SHOTS=<folder> E2E_PORT=4457 pnpm --filter @backseat/site e2e`: /contribute and /ledger at 375, 768 and 1440 were looked at (the Funding band with Not on a card yet and the test payment line, Money in on ink, Stopped cards with a paused and a rejected row, /contribute's next-in-line line and ordered choices). One fix came of it: the waterfall line sat flush under the last choice, and the list now has `--space-3` under it; the second pass at 1440 showed the gap.

The live check against a local `vite preview` of a build with `netlify.toml`'s production values (`node platform/site/scripts/live-check.mjs http://localhost:4458 --allow-no-data`). It FAILED, and every new money check SKIPPED, so this run does not meet the last criterion:

```
FAIL live-check http://localhost:4458 passed=211 failed=2 skipped=11
FAIL 375px no console errors: Failed to load resource: the server responded with a status of 404 () | ...
FAIL 1440px no console errors: Failed to load resource: the server responded with a status of 404 () | ...
PASS status line: 6 cards are open for funding. The agents are paused. Funded cards keep their money and wait in the queue until the board resumes them.
PASS Fund the next card in line first -> https://buy.stripe.com/dRm28s4ie0zp6BU0qEafS01
SKIP Fund the next card in line names the next card in line (public_money): the site has no live data
SKIP /ledger reconciliation line and money in: the site has no live data
```

The two failures are the reads of `public_money` and `public_stopped_cards`, which production does not have until money-logic's migration is applied (404, `PGRST205`); every route passed its status, h1, bands, overflow and no-dead-space checks at both widths. The money checks run against production after the deploy (production step 2).


### Review fixes

Five review findings and one the fixes' own live check found, each with a test that failed before its fix (Decisions, "review"): the test payment line said "test payment of $0.50" for a $1.00 payment; `design.spec.ts` never drew the money bands; five Managed Agents stop codes had no words; the live check's money checks had never printed PASS; an unread Not on a card yet put a sentence in the figure's slot (a 438px row at 320px, the label 46px wide); and an open card left out of the funding order misaligned home's card rows.

Before the fixes, the new layout variants failed: `/ledger balance: side-by-side blocks in div.stat "Not on a card yetMoney given with no car" differ by 369px (26 / 395)` at 320px, and `/ card: funding bars misaligned by 135px in a row of ul.card-grid.fund-grid` at 768 and 1440 (113px at 1024). Without the five new words, `Stopped.test.tsx` failed with `card_spend: expected 'It stopped on a check the board is lo…' not to be 'It stopped on a check the board is lo…'`.

`pnpm verify` at the repository root, with both `dist-e2e` folders deleted first, exits 0:

```
platform/board test:       Tests  71 passed (71)
platform/supabase test:       Tests  286 passed (286)
platform/site test:       Tests  420 passed (420)
seed-1 test:       Tests  77 passed (77)
platform/dispatcher test:       Tests  619 passed (619)
platform/gate test: PASS: gate tests passed=508
PASS: payment-host-scan files=7 allowed=0
PASS: banned-phrases files=499 paths=577 message=yes
docs.test.mjs: pass 15, fail 0
rename.test.mjs: pass 6, fail 0
exit 0
```

`E2E_PORT=4461 pnpm --filter @backseat/site e2e`: `145 tests`, `5 skipped`, `140 passed (2.6m)`. It includes `design.spec.ts`'s new money-band block: axe WCAG 2.2 AA, no sideways scroll and no animation under reduced motion on /contribute and /ledger at 375, 768 and 1440, on the launch-shaped studio (the test payment line, Money in, a paused row with its tag and a Didn't ship row), with a $0.45 shortfall and with both money reads failing. Each variant first checks that the parts it audits are drawn (9 passed). `layout-balance.spec.ts` adds the money reads failing (/ledger, /contribute, / at 320 to 1440) and an open card left out of the funding order (/ and /contribute at 768 to 1440).

`E2E_ROUTE_SHOTS=<folder> E2E_PORT=4461 pnpm --filter @backseat/site e2e`: /contribute and /ledger at 375, 768 and 1440 were looked at, as were /ledger's Funding band with both money reads failing (320 to 1440) and home with a card left out of the order (375 to 1440). At 320px the unread Not on a card yet row is now 141px: the label and description are full width, with "Not available right now." as a muted line under them. The Funding band reads "The pool includes $0.50 of the board's own test payment; it funds no card." Home with five of six cards in the order shows five cards with each row's bars level, and the status line says 5.

The live check's new money checks, against a local build served with the launch-shaped fixture on the same origin (the scratch harness in Decisions; `node scripts/live-check.mjs http://127.0.0.1:4466`, three data states):

```
PASS live-check http://127.0.0.1:4466 passed=221 failed=0 skipped=5   (paused for awaiting_credit, 2 payments, never reconciled)
PASS home status line says the payout sentence while paused for awaiting_credit
PASS Fund the next card in line says "Next in line: Stop the unlock count from showing more unlocks than exist", the first of 6 card choices
PASS /contribute says the payout sentence while paused for awaiting_credit: "The agents are paused while the studio waits for Stripe to pay out contributions, ..."
PASS /ledger shows exactly one reconciliation line: ["Not yet reconciled with Stripe."]
PASS /ledger received $3.00 matches public_money.received_usd $3.00 (2 payments)

PASS live-check http://127.0.0.1:4466 passed=216 failed=0 skipped=9   (not paused, no payments, empty order, reconciled)
PASS status line: No card is open for funding right now.
PASS Fund the next card in line says the money waits: "No card is open for funding right now. Your contribution waits in Not on a card yet and funds the next card that opens." with 0 card choices
PASS /ledger shows exactly one reconciliation line: ["Reconciled with Stripe on 23 Sep 2026."]
PASS /ledger says No contributions yet. with public_money.payments 0

PASS live-check http://127.0.0.1:4466 passed=219 failed=0 skipped=7   (paused by the board, one card in the order, reconciled)
PASS status line: 1 card is open for funding. The board has paused the agents. ...
PASS Fund the next card in line says "Next in line: Add Quiet rooms, a fourteenth unlock after Polished rails", the first of 1 card choices
PASS /ledger shows exactly one reconciliation line: ["Reconciled with Stripe on 23 Sep 2026."]
PASS /ledger received $3.00 matches public_money.received_usd $3.00 (2 payments)
```

The third state first FAILED on `1440px / no dead space: card: funding bars misaligned by 135px`: the five open cards outside the order kept their places without a button. That is how home's fund group came to follow the funding order. The SKIP lines are the board site's address (BOARD_SITE_URL unset), /board's redirect and og:image (local server) and the www redirect (production only). This is not the criterion's local preview, which reads production; production step 1 runs that.



### Ship

Money-logic merged as 2f451e4 (#69) with its production steps run (its migration is applied, so `public_money` and `public_stopped_cards` answer the anon key), and its docs follow-up as e56ebcf (#72). The branch was stacked on money-logic's pre-squash 33274fd, so, as money-logic did with legal-copy, it first merged money-logic's final head 8febb2f (6b1e8ee) and then origin/main at e56ebcf (76885f5). Main's tree equals 8febb2f except `docs/ROADMAP.md` and `docs/specs/money-logic.md`, so each conflict kept main's lines plus this branch's own change: `DESIGN.md` (the /contribute paragraph keeps legal-copy's `--space-1` caption sentence), `Cards.tsx` and `Landing.tsx` (#65's `MoreLink` beside `openForFunding` and `pausedSentence`), `layout-balance.spec.ts` (both imports), `styles.css` (one comment for `.choice-primary`), `BOARD-SETUP.md` and `PLAN.md` (this branch's steps 4 and 12 and decision 42), `ROADMAP.md` (money-logic done, this row built) and `money-logic.md` (main's). The PR's base was already main (set before #69 merged). After the merges the diff against main is this pull request's 48 files and nothing else.

`pnpm verify` at the repository root at 7fd06dc exits 0. The two runs before it each failed one timing test under a load average of 45 to 48 from agents running in parallel, both passing alone and neither touched here: `Guide.test.tsx` ("Test timed out in 5000ms"; alone, 8 passed in 2.51s) and the dispatcher's `github.test.ts` "reports the merge as unknown…" (alone, 26 passed). The passing run:

```
platform/board test:       Tests  71 passed (71)
platform/supabase test:       Tests  286 passed (286)
platform/site test:       Tests  423 passed (423)
seed-1 test:       Tests  77 passed (77)
platform/dispatcher test:       Tests  619 passed (619)
platform/gate test: PASS: gate tests passed=508
test:agents ℹ pass 117 ℹ fail 0; test:ops ℹ pass 124 ℹ fail 0
test:functions ok | 97 passed (106 steps) | 0 failed
PASS: secret-scan files=558
PASS: payment-host-scan files=7 allowed=0
docs.test.mjs: pass 15, fail 0
rename.test.mjs: pass 6, fail 0
verify exit 0
```

`E2E_ROUTE_SHOTS=<folder> E2E_PORT=4447 pnpm --filter @backseat/site e2e`: `2 skipped`, `150 passed (3.2m)`. /ledger at 1440 and /contribute at 375 were looked at after the merge: the Funding band with Not on a card yet and the test payment line, Money in on ink with one reconciliation line, Stopped cards with a Paused and a Didn't ship row; /contribute's agreement line sits close under Fund the next card in line (legal-copy's caption spacing kept), with no gap or misalignment.

Production step 1: a build of 7fd06dc with `netlify.toml`'s production values, served by `vite preview` on port 4452, then `node platform/site/scripts/live-check.mjs http://localhost:4452 --allow-no-data` against production data, exit 0:

```
PASS live-check http://localhost:4452 passed=224 failed=0 skipped=3
PASS status line: 6 cards are open for funding. The agents are paused while the studio waits for Stripe to pay out contributions, which buy the agents' model credit. Cards funded now keep their money and wait in the queue.
PASS home status line says the payout sentence while paused for awaiting_credit
PASS Fund the next card in line says "Next in line: Stop the unlock count from showing more unlocks than exist", the first of 6 card choices
PASS /contribute says the payout sentence while paused for awaiting_credit: "The agents are paused while the studio waits for Stripe to pay out contributions, which buy the agents' model credit. Cards funded now keep their money and wait in the queue."
PASS /ledger shows exactly one reconciliation line: ["Not yet reconciled with Stripe."]
PASS /ledger says No contributions yet. with public_money.payments 0
SKIP /board status 200: a local server has no redirect rules
SKIP og:image points at https://peanutgallery.games, not http://localhost:4452; http://localhost:4452/og.png was checked instead
SKIP www redirect: production only
```

The four money checks print PASS, not SKIP, so the criterion's local half is met. No SQL changes here, so there is no dump, no migration and no identity or anon re-run for this pull request.

The gate passed at 648ed62 (run 35932811094: detect, build, platform, gate; seed-code skipped), but main had moved to fe42a58 (#75, /team) meanwhile, which touches `Landing.tsx`, `paused.spec.ts` and `styles.css`, so the branch merged main again (3710177) rather than merge an untested combination. Two conflicts: `Landing.tsx`'s team strip takes #75's `asleep={false}` (the board: running agents are drawn awake while the studio is paused), and `paused.spec.ts` keeps this branch's reasons and full sentences with #75's awake assertion. Then `pnpm verify` exit 0 (board 71, supabase 286, site 423, seed-1 77, dispatcher 619, gate passed=508, agents 117, ops 124, functions 97 passed, secret-scan files=558, docs 15, rename 6), and `E2E_ROUTE_SHOTS=<folder> E2E_PORT=4447 pnpm --filter @backseat/site e2e`: `2 skipped`, `150 passed (3.4m)`; home at 1440 (the payout sentence in the status line, the team awake) and /contribute at 1440 were looked at.

### Production

Merged with `gh pr merge 71 --squash --match-head-commit 6740ebc…` at 2026-09-23T23:51:30Z as 187f403 (gate run 35934782190 at 6740ebc: detect, build, platform, gate passed; seed-code skipped). gh's local branch switch failed because main is checked out in another worktree, so the remote branch was deleted by hand, after #73 (agent-system-core, stacked on this branch) was set to base main so it stays open.

Production step 2: the public site published 187f403 (Netlify deploy 6ab46604c68c330008074672, 2026-09-23T23:51:50Z); `https://peanutgallery.games/version.json` reads `{"sha":"187f40358ce8578c9eacbf1174d735e032b872c6","builtAt":"2026-09-23T23:51:49.844Z"}`. The board site's build of 187f403 was cancelled for no content change, which is right (no board file changed).

Production step 3, from the main checkout at 187f403, `node platform/site/scripts/live-check.mjs`, exit 0:

```
PASS live-check https://peanutgallery.games passed=227 failed=0 skipped=0
PASS home status line says the payout sentence while paused for awaiting_credit
PASS Fund the next card in line says "Next in line: Stop the unlock count from showing more unlocks than exist", the first of 6 card choices
PASS /contribute says the payout sentence while paused for awaiting_credit: "The agents are paused while the studio waits for Stripe to pay out contributions, which buy the agents' model credit. Cards funded now keep their money and wait in the queue."
PASS /ledger shows exactly one reconciliation line: ["Not yet reconciled with Stripe."]
PASS /ledger says No contributions yet. with public_money.payments 0
```

`public_money` in production at that moment: payments 0, received 0.0000, not_on_card 0.0000, short 0.0000, board_test 0.5019, reconciled_at and last_run_ok null, six cards in `funding_order`; `public_stopped_cards` has no rows, so /ledger draws no Stopped band. The live /ledger, /contribute and / at 375 and 1440 were looked at: Funding with Not on a card yet $0.00 and "The pool includes $0.50 of the board's own test payment; it funds no card.", Money in with "No contributions yet." and "Not yet reconciled with Stripe.", /contribute naming the next card, and the payout sentence on both.

### Fix forward: home's order

Looking at the live pages found one thing the checks missed: home's Fund what's next drew its own order (`fundOrder`: picked by the board first, then in design, then proposed, then the most funded, then the oldest) while /contribute drew the waterfall's. Production has the voted card (Add Quiet rooms, rank 2) and five proposed cards ranked 1 and 3 to 6, so home led with Add Quiet rooms while /contribute said "Next in line: Stop the unlock count…". The fix: `fundingPlace(snapshot)` (`payment.ts`, kernel) gives each open card its place in `funding_order`, `groupCards` sorts home's fund group by it (with the order unread, every open card in the roadmap's order: rank, unranked last, then the oldest), and `fundOrder` and its stage ranks are deleted. `live-check.mjs` now checks that home's Fund what's next shows /contribute's card choices in the same order. Against production at 187f403 it fails, as it should:

```
FAIL home's Fund what's next shows /contribute's 6 card choices in the same order: home ["Add Quiet rooms, a fourteenth unlock after Polished rails","Rename the Gatherer to Sweeper","Lower the Cart's starting price from 150 to 120 dust","Stop the unlock count from showing more unlocks than exist","Show how long until the next unlock","Show how much dust each strike adds"]
```

The new order then tripped the layout audit on a local preview with production data: `1440px / no dead space: balance: side-by-side blocks in ul.card-grid.fund-grid "Stop the unlock count from showing more " differ by 761px (1649 / 969 / 888)`. The cards were level (572px each); the audit was counting the text inside each card's closed "What the agents are told", which is laid out below the card but not drawn, and the longest brief now sat in the first row. This branch first fixed `layout-audit.mjs` itself; while its gate ran, #76 (fb694f5, the gap audit) landed the same fix on main with its own test ("counts only the summary of a closed disclosure as drawn"), so the merge of main takes #76's audit and test and this pull request drops its own.

After the fix, a build with `netlify.toml`'s production values on `vite preview` port 4452, `node platform/site/scripts/live-check.mjs http://localhost:4452 --allow-no-data`, exit 0:

```
PASS live-check http://localhost:4452 passed=225 failed=0 skipped=3
PASS Fund the next card in line says "Next in line: Stop the unlock count from showing more unlocks than exist", the first of 6 card choices
PASS home's Fund what's next shows /contribute's 6 card choices in the same order
PASS /ledger shows exactly one reconciliation line: ["Not yet reconciled with Stripe."]
PASS /ledger says No contributions yet. with public_money.payments 0
```

After merging main at fb694f5 (#76), `pnpm verify` exit 0 (board 71, supabase 286, site 426, seed-1 77, dispatcher 619, gate passed=508, agents 117, ops 124, functions 97 passed, secret-scan files=561, payment-host-scan files=7, docs 15, rename 6). `cards.test.ts` checks home's fund group equals `fundableCards` in order (a card picked by the board that the order puts second is second) and the roadmap's order with the order unread; `changes.test.ts` holds a reorder of the funding order. `E2E_PORT=4447 pnpm --filter @backseat/site e2e` exit 0: `5 skipped`, `148 passed (5.4m)`. Before that merge, one run's 768px title-timing test timed out at a load average near 40 (`page.evaluate: Test timeout of 120000ms exceeded`) and passed on the rerun (`layout-balance.spec.ts` 40 passed). The local preview check above was re-run on the merged tree with the same PASS line (`passed=225 failed=0 skipped=3`). Home at 768 (the launch-shaped fixture) and 1440 (production data) were looked at: the waterfall's order in balanced rows. The fix-forward's own live check after its deploy goes in the ship report, and the next pull request in the series records it here, as this one recorded money-logic's.

After the fix-forward (#78, https://github.com/AlreadyKyle/peanutgallery/pull/78) merged with `gh pr merge 78 --squash --match-head-commit a535659…` at 2026-09-24T01:15:20Z as f0ad415 (gate run 35941151543 at a535659), the public site published f0ad415 (Netlify deploy 6ab479aa8743f800089183c4, 2026-09-24T01:15:45Z; `version.json` sha `f0ad415da775…`), and the board site's build was cancelled for no content change, which is right. From the main checkout at f0ad415, `node platform/site/scripts/live-check.mjs`, exit 0:

```
PASS live-check https://peanutgallery.games passed=228 failed=0 skipped=0
PASS home's Fund what's next shows /contribute's 6 card choices in the same order
```

The live /, /contribute and /ledger at 375 and 1440 were looked at after that deploy: home leads with Stop the unlock count, as /contribute does, in balanced rows. Recorded in agent-system-core's branch (#73), which merged main after #78.

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 31 criteria became 11. Cut: the `takesMoney` mirror of `money.card_takes_money` and its shared fixture (when `public_money` fails, the site offers only Pick for me, which the waterfall places safely, so no second copy of the rule is needed); the operations clause on /contribute and the operations line on /ledger (the bucket ships at 0% and is removed until a percentage exists; nothing here depended on it but those two lines); the read of `public_card_funding.on_card_usd` (it equals the bar); the cross-package test that scans dispatcher sources for `failing_check` codes (replaced by a per-stage fallback, so no code ever shows raw); the read-count test, the band-colour and band-2 checks (home's style and design tests own the bands rule); the shipped-card funder-count e2e (money-logic owns and tests `public_card_funding`); the attended reviewer session and published review page (replaced by the existing axe suite, home's `layout-balance.spec.ts` and route screenshots looked at); the dependency on layout-balance's gate module (that pull request is dropped). Kept whole: every Problem outcome, the figures adding up, the reconciliation line, the money trail of a stopped card, kernel paths, and the production live check.
- 2026-09-23: the /contribute choices are the database's funding order, not a second copy of the rule.
- 2026-09-23: stopped cards are rows on /ledger, the one public list of rejected and paused cards with their reason and money trail (R14, L02); supporter-pages links each row to /card/:id and draws no second Discard.
- 2026-09-23: paused cards are listed apart from cards that didn't ship. Under R11 an infrastructure failure pauses and re-queues a card, so "didn't ship" would be untrue.
- 2026-09-23: the paused reason names the category only, never who paused or when (`board-site.md`).
- 2026-09-23: the board's test payment is named in one line while it is above zero, so the pool's figures add up without implying it funds a card.
- 2026-09-23: two new reads. Reconciliation, the funding order and the money-in figures ride in `public_money`; the pause reason rides in `public_studio`. site-snapshot carries both in its cached snapshot.
- 2026-09-23: the ledger-truth plan is folded in: its SQL is money-logic's `public_money` and `public_studio.pause_reason` (backfilled `awaiting_credit`); its pages, strings, fixed rule and backlog removals are here. No `public_money_in`, `public_reconciliation` or `credit_bought` is built. The two planned roadmap cards whose BACKLOG entries this pull request deletes are removed by the series' backlog-to-cards path (agent-system-core), not by a hand-written delete here.
- 2026-09-23 (board defaults): card naming is the Payment Link's `client_reference_id`, already on main; the /thanks redirect is a board step (BOARD-SETUP step 12); Discord is not touched.
- 2026-09-23 (build): the `awaiting_credit` sentence drops "Before launch" and "the first": the dispatcher also writes `awaiting_credit` whenever the Console credit runs out after launch (`pipeline.ts`), so the sentence has to be true then too. The other three reasons, which the agreed spec named but did not word, are in the Appendix.
- 2026-09-23 (build): /contribute's choices are one list in the funding order. The category groups it had (Dust, The studio) would reorder the choices whenever the two categories interleave; with the platform lane closed only Dust has cards anyway. `.choice-group` styles are gone.
- 2026-09-23 (build): Not on a card yet is a row in the Funding band's own list of figures (`Meter` takes extra rows and lines), so the band keeps one list and one hairline rhythm; with `public_money` unread the row says "Not available right now." as a muted line under its label (see the review decision below).
- 2026-09-23 (build): `snapshot.money`, `snapshot.stopped` and `snapshot.pauseReason` are optional on the `Snapshot` type, like `platformLaneOpen`: the loader always sets them, and a sample or test snapshot without them reads as not loaded (no card takes money, no stopped rows, the general paused line). A malformed figure or a missing `public_money` row names `money` missing.
- 2026-09-23 (build, corrected in review): `failingCheckWords` covers every code written on a stopped card today: `pipeline.ts` (CardStop, InfraStop, `PAUSING_OUTCOMES`, the gate's infrastructure checks), `worktree.ts`'s commit checks, `credit.ts`'s `REFUSAL_CHECK`, `recovery.ts`, the Managed Agents adapter's `SessionPaused` codes and `cancelled_by_board`. The build first missed five adapter codes (`card_spend`, `read_token`, `repo_skills`, `system_prompt`, `ledger`), which showed the generic fallback; they now have words. `Stopped.test.tsx` lists every such code by hand and fails when one has no words (the trimmed spec cut a test that scans the dispatcher's sources, so the list is kept by hand), a second test checks each entry is a sentence and no entry is a code, and the stage fallback covers any code added later.
- 2026-09-23 (build): the paused state tag on a Stopped row draws the pause glyph inline in `Stopped.tsx` with the word from `copy.statusPaused`: a kernel file may not import `Glyph.tsx` (`site-kernel.test.ts`), and the unit test checks the tag matches `STATE_TAGS.paused`. A Didn't ship row carries no state tag; its list heading says it.
- 2026-09-23 (build): home's status line marks itself `data-balance="ignore"` while it carries the pause glyph. The glyph is a 16px marker beside a sentence, and the reason sentences are long enough that the layout audit read the pair as two unbalanced columns at 320px.
- 2026-09-23 (build): the tests live where the code's tests already were: `payment.ts`'s in `cards.test.ts` (there is no `payment.test.ts`), with a shared `books()` row in `src/lib/books.test-fixture.ts`. `live-studio.ts` is paused for `awaiting_credit`, carries two contributions, the board's $1 test payment and the open cards in its funding order, and one paused and one rejected card; the layout-balance "home with n open cards" variants put every open card in the order, and the empty-studio variant adds "No contributions yet." and /contribute.
- 2026-09-23 (build): the route screenshots use the launch-shaped fixture, not production: production has no `public_money` or `public_stopped_cards` until money-logic's migration is applied, so production data would show only "Not available right now." in the new parts. A local preview built with `netlify.toml`'s production values was live-checked as well (Evidence).
- 2026-09-23 (review): the test payment line says "The pool includes {usd} of the board's own test payment; it funds no card." `board_test_usd` is the payment's agent credit ($0.5019 of the $1.00 in production), so "test payment of $0.50" would have understated the payment; the pool is where that credit sits. `live-studio.ts`, `money.spec.ts` and the unit fixtures carry 0.5019, so the e2e run and the screenshots show the line production will show, and BOARD-SETUP step 12 quotes it.
- 2026-09-23 (review): a figure whose read failed is `Stat` with no value: the row stacks "Not available right now." under its label as a muted body line, the same treatment as a band whose read failed. A sentence in the figure's slot (lead size, no wrap) squeezed the label to 46px at 320px (a 438px row). `layout-balance.spec.ts` audits /ledger, /contribute and / with both money reads failing at 320, 375, 768 and 1440.
- 2026-09-23 (review): home's fund group follows the funding order. The stand-in live check (Evidence) found that an open card the order leaves out (a vetoed card) stayed in Fund what's next without a button, misaligning its row's bars by 113 to 135px at 768 to 1440, while the status line counted it as open for funding. `groupCards` takes `openForFunding(snapshot)` (`payment.ts`, kernel), so home counts and draws only the cards that take money, as /contribute offers them; with the order unread nothing changes (every open card, no buttons). `layout-balance.spec.ts` audits that state.
- 2026-09-23 (review): the live check's new money checks were exercised before production has `public_money` by serving a local build and the launch-shaped fixture on one origin (a scratch harness, not committed: the site's reads stay same-origin under the enforced policy, and a copy of `live-check.mjs` read a `netlify.toml` pointing at it). The criterion's local half stays open until production step 1 runs it against production data.
- 2026-09-23 (ship): the branch merged money-logic's final head 8febb2f before origin/main, so the conflicts were only where this branch changed money-logic's and legal-copy's own lines, not the whole squashed history; every conflict kept main's final lines plus this branch's change (Evidence, Ship).
- 2026-09-23 (ship): no pg_dump or migration step: this pull request writes no SQL, so its production steps are the local preview check before the merge, the Netlify deploy, the production live check and a docs close-out after it.
- 2026-09-23 (ship): the two timing tests that failed under a load average of 45 to 48 (`Guide.test.tsx`, the dispatcher's `github.test.ts` merge-unknown test) were re-run, not changed: each passes alone and in the third full `pnpm verify`, and neither is in this pull request's files.
- 2026-09-23 (ship): with #75 on main, home's team strip is drawn awake while paused (the board's call there), so only the status line carries the pause on home; `pausedSentence` no longer drives the strip.
- 2026-09-23 (ship): home's Fund what's next draws the waterfall's order, the same cards in the same order as /contribute's choices. home-and-design's order (the board's pick first, then the most funded) predates the waterfall; with both drawn, home and /contribute named different cards first. Money goes by rank, so the site shows rank order everywhere. With the order unread, home draws the roadmap's order (rank, unranked last, then the oldest). A voted card still shows its Picked by the board face.
- 2026-09-23 (ship): the layout audit leaves out what a closed `details` holds (#76's change, which landed on main while this fix was in its gate; this pull request's own copy was dropped for it). That text is laid out below its card but never drawn, so counting it measured cards the reader sees level as up to 761px apart.

## Appendix: strings

In `legal.ts`, with money-logic's column names:

> moneyInLede: What supporters have paid, and where it went.
> moneyInEmpty: No contributions yet.
> moneyFromMany: from {n} contributions; moneyFromOne: from 1 contribution
> describeReceived: What supporters paid at checkout, before any fee.
> describeStudio: What supporters chose to send to the studio, less any correction charged to it.
> studioPctAvg: At checkout they chose {pct}% on average, weighted by amount, and the default is {default}%. ({default} is `DEFAULT_STUDIO_PCT`, 20.)
> reconciledOn: Reconciled with Stripe on {date}.
> notReconciled: Not yet reconciled with Stripe.
> waterfallLine: Anything beyond a card's target funds the next cards in line.
> boardTestLine: The pool includes {usd} of the board's own test payment; it funds no card.
> pauseReasons.awaiting_credit: The agents are paused while the studio waits for Stripe to pay out contributions, which buy the agents' model credit. Cards funded now keep their money and wait in the queue.
> pauseReasons.spend_limit: The agents are paused because the studio reached its monthly limit on model usage. Funded cards keep their money and wait in the queue until the board resumes them.
> pauseReasons.incident: The agents are paused while the board checks a problem. Funded cards keep their money and wait in the queue until the board resumes them.
> pauseReasons.board: The board has paused the agents. Funded cards keep their money and wait in the queue until the board resumes them.
> The rest (the Money in labels and descriptions, the Stopped headings, `failingCheckWords` for every code the dispatcher writes today and `cancelled_by_board`, `pausedFallback`, `rejectedFallback`) are in `platform/site/src/lib/legal.ts`.
> fixedRules[0]: The public ledger shows the money that comes in, where it goes and the cost of all agent work paid for with contributions.
