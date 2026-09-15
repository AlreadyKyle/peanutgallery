# Card summaries

Status: done. Card: none. Owner: board.

## Problem

Each Next card on the public site shows its full intent, which is the brief written for the builder agents: file names, function names and instructions such as "Run the bot; stop and report". Supporters deciding what to fund need one plain sentence about what changes in the game, not the agent's spec.

## Scope

In: a `summary` column on `cards`; `file_card` requires it; the site shows the summary on Now and Next cards and keeps the agent brief public behind a collapsed "What the agents are told" disclosure; the board form gains a Public summary field; the four live Next cards get summaries.
Out: editing a card after filing, summaries for cards other agents or the community file, translation.

## Behaviour

A card carries `summary`, at most 200 characters, written for supporters: what changes in the game and why, in plain words, with no file names, code or agent instructions. The Now and Next lists show the summary under the title. The agent brief (`intent`) is not shown by default; a closed disclosure labelled "What the agents are told" reveals it. A card with no summary shows no summary line and still offers the disclosure when it has an intent. The board's Next card form requires a summary and shows the 200-character limit.

## Acceptance criteria

- [x] `cards.summary` exists, is readable by anon, and rejects text longer than 200 characters.
- [x] `file_card` takes `p_summary` and refuses a blank or over-long summary; the old ten-argument signature no longer exists.
- [x] On the public site a Next or Now card shows its summary and does not show the intent until the disclosure is opened.
- [x] The disclosure is a native `details` element, keyboard operable, closed by default, and shows the intent verbatim when opened.
- [x] The board form sends `p_summary` and refuses a blank summary before calling the database.
- [x] The four live Next cards have these summaries:
  - A fourteenth unlock: Quiet rooms at 300M dust: "Add one more unlock after the last one, so players always have a next goal on screen."
  - Rename the Gatherer to Sweeper: "Rename the first unit from Gatherer to Sweeper, with a new one-line description."
  - Cheaper Cart: baseCost 120: "Lower the Cart's cost so new players can buy one soon after it appears."
  - Save the game and resume on reload: "Save progress in the browser, so a reload picks up where you left off."

## Verification

- `pnpm verify` at the repository root exits 0.
- `pnpm --filter @backseat/site build && pnpm --filter @backseat/site e2e` passes at 375 px.
- After the migration is applied: `select title, summary from public.cards` shows the four summaries, and `scripts/anon-negative-test.ts` prints `PASS:`.
- On https://peanutgallery.games no Next card shows a file name or "Run the bot" until its disclosure is opened.

## Decisions

- 2026-09-14: keep the agent brief public but collapsed. Every card stays fully visible, which the ledger promise relies on, while the default view reads for supporters.
- 2026-09-14: a separate column rather than rewriting `intent`. The intent is the agents' spec and changing it for readability would change what the agents build.

## Evidence

2026-09-14:
- `platform/supabase/test/migration.test.ts` (card-summary describe) and the PGlite migration test cover the column, the 200-character limit and the `file_card` signature.
- `platform/site/src/components/Cards.test.tsx` covers the summary and the closed disclosure; `platform/site/src/pages/Board.test.tsx` covers `p_summary` and the blank refusal.
- Live: `select left(title,30), left(summary,40) from cards where shape='goal'` returned four rows, each with its summary (Quiet rooms, Gatherer rename, Cheaper Cart, Save the game).
