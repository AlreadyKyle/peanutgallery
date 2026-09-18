# Landing copy and design rules

Status: agreed. Card: none. Owner: board.

## Problem

The landing page's first block uses five text styles, its headline leaves "and free games." alone on a second line, and "Full ledger" touches the "Fixed rules" heading. Several lines read as slogans ("Funding a card is your vote.") or use terms a stranger does not know ("At the default split about $3.10 of every $5 reaches the bar."). There are no written rules that would have stopped either.

## Scope

In: `platform/site/BRAND.md` renamed to `DESIGN.md` with two new rules; `docs/COPY.md`; a copy test; the hero, the fund intro, the flagged strings, the Ledger and Fixed rules spacing; the landing "How it works" reduced to a summary that links to the full page.
Out: the How it works and Meet the Team pages (`how-it-works-and-team.md`), the roadmap page (`backlog-core.md`).

## Behaviour

- The design guide is `platform/site/DESIGN.md`. It adds: a block uses at most three text styles (heading, body, one small muted line), and headings balance their lines.
- `docs/COPY.md` holds the copy rules. `copy.test.ts` fails on the patterns it marks as tested.
- The hero shows a headline, one sentence, the Contribute button and one small muted line. The headline never leaves fewer than three words on its last line at 375, 1024 and 1440 pixels wide.
- Under "Fund what's next" the intro reads: "Fund a card to grow the studio and its games. When a card's bar fills, the agents build it." The "$3.10 of every $5" sentence is gone and "default split" does not appear on the landing page.
- The space between the Ledger section and "Fixed rules" equals the space between any two sections, at every width.
- The landing "How it works" is three short lines and a link to `/how-it-works`.

## Acceptance criteria

- [x] `platform/site/BRAND.md` no longer exists; `DESIGN.md` does, and no file in the repository refers to `BRAND.md`.
- [x] `DESIGN.md` states the three-style rule and the balanced-heading rule.
- [x] `docs/COPY.md` exists and `copy.test.ts` enforces every rule it marks tested.
- [x] The hero renders exactly three text styles plus the button.
- [x] The last line of the hero headline has three or more words at 375, 1024 and 1440.
- [x] `copy.fundIntro` matches the sentence above; "default split" and "$3.10" appear nowhere in `copy.ts` landing strings.
- [x] The computed gap between the bottom of the Ledger section and the top of the "Fixed rules" heading equals `--space-5` at 375 and 1440.
- [ ] `index.html` meta, `public/og.png`, the e2e specs and `live-check.mjs` match the new copy.

## Verification

- `pnpm verify`
- `pnpm --filter @backseat/site e2e`
- `git grep -n "BRAND.md"` returns nothing.
- Browser preview at 375, 1024 and 1440: screenshot of the hero and of the Ledger to Fixed rules gap, with the gap read from computed styles.

## Evidence

2026-09-18, on branch `v1-live-copy-design`, not yet merged.

- `pnpm verify`: exit 0. `pnpm --filter @backseat/site e2e`: 11 passed.
- `copy.test.ts` (7 tests) and the new `styles.test.ts` heading test pass.
- Browser preview, computed values: at 1440 the headline is two lines ("Watch AI agents build a / game studio and free games."); at 1024 two lines with a 402px last line; at 375 three lines with a 223px last line. The Ledger to "Fixed rules" gap is 64px (`--space-5`) at all three widths. No horizontal overflow.
- Hero styles: h1 30px, lede 20px, button, and 14px muted lines.
- `git grep BRAND.md` finds only history in older specs' text, which record what was true when they were written.
- Open: the `og.png` and `index.html` criterion needs no change because the pitch line did not change. The landing "How it works" summary and link wait for `/how-it-works`.

## Decisions

- 2026-09-18: one guide, renamed rather than a second file. Two guides drift.
- 2026-09-18: our own `docs/COPY.md` rather than an installed humanizer skill. The agents and the test suite can read a file in the repository; they cannot use a skill on the founder's machine. The rules draw on the public "signs of AI writing" lists.
- 2026-09-18: the "$3.10 of every $5" figure is removed, not reworded. It cannot be understood without the fee, the reserve and the split, which belong on How it works.
