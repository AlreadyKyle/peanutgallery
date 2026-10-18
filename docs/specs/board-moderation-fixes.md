# Board moderation fixes

Status: built. Card: none. Owner: studio.

A kernel change to the board's Community admin and Games and agents panel (`platform/board`, every file of which is kernel, `docs/PLAN.md` §4 The Board) and a migration to the community data layer (`docs/specs/community-core.md`), from a QA pass over the board.

## Problem

The community admin fired destructive actions (suspend, delete a milestone, decline, merge, set the era, draft from a cluster, flip a flag) with no confirm, saved twice on a double press, hid its action buttons far to the right of a table that would not wrap, asked for raw cluster and card ids, and showed a gateway's HTML error page as the error. A role's Turn off with no reason did nothing and said nothing. In the database, suspending a player left their seeds and suggestions listed, and a suggestion whose cluster had been merged twice landed on a merged cluster, because a merge could take an already-merged cluster and a lookup followed only one hop.

## Scope

In: the Community admin's confirms, busy guard, table layout, merge and link pickers, reason hint, amount parsing and status verbs; the board's error sentences and error style; the role switch's missing-reason message; `community_seeds`, `community_suggestions`, `cluster_suggestion` and `board_merge_clusters`, and a repair of existing merge chains.
Out: every money function (`lifetime_cents`, the goals, claims and the ledger); the public feed's lines; the public site; any new table, column, index or job.

## Behaviour

- Suspend, Decline, Draft from cluster, Link card, Merge into, Delete (a milestone), Set as current (an era) and every flag's Turn on or off ask first with `window.confirm`, as Reject card does, and each confirm names what it changes: the player's handle, the suggestion's title and decline reason, the cluster keys, the card's title, the milestone's title and amount, the era's name, the flag and what turning it on or off does (profiles_open off: no new player can sign in). Cancelling sends nothing. Restore, Release, Rename, Save face, Feature and Unpublish do not ask.
- While one community action runs, every action button reads as disabled (`aria-disabled`, so focus stays) and a second press, even in the same tick, does nothing. Two presses of Save milestone save one milestone.
- The community tables wrap their cells, left and top aligned, and stack each row's actions one under another, so every action is in view at 390 px and at 1440 px. Under 40rem each row becomes a block with each cell named by its column.
- Merge into picks from the other clusters among the loaded suggestions (by key) and Link card from the newest 50 cards (by title and stage); neither takes a typed id.
- With no reason typed, the tab says a reason is needed and its buttons stay off; so does the Games tab's game admin (`docs/specs/board-games-admin.md`). A role's Turn on or off with no reason says a reason is needed.
- An error that is an HTML page, an empty answer, a lost connection or Postgres's bad-uuid error is shown as one plain sentence; the database's own refusals are shown as they are. An error is a boxed line in the board's ink with a heavy left rule, announced as an alert.
- The milestone amount takes `500`, `$500`, `1,000` and `$1,250.50`, and says when a typed amount is not one. Republishing a seed says "Republish: done.", not "Unpublish: done.".
- `community_seeds` and `community_suggestions` list nothing written by a player whose profile is suspended; restoring the player lists it again, and nothing is deleted.
- `community.cluster_root` follows a cluster's merges to the cluster that was never merged (at most 64 hops; none for a loop or a missing cluster). `cluster_suggestion` joins a suggestion to that root. `board_merge_clusters` checks the board first, refuses a cluster that was already merged on either side, and repoints every cluster merged into the one it merges. The migration repoints existing chains to their roots and moves suggestions off merged clusters.

## Acceptance criteria

- [x] Each listed destructive community action asks a confirm naming its object, and sends nothing when cancelled.
- [x] Two presses of Save milestone make one `board_save_goal` call; the buttons read as disabled while it runs.
- [x] The community tables wrap and stack their actions.
- [x] Merge into and Link card offer loaded clusters and cards and send their ids; no field takes a typed id.
- [x] A missing reason is announced on the Community tabs and on a role's Turn on or off.
- [x] A gateway HTML error reads as a plain sentence, styled as an error.
- [x] `centsFrom` takes `$500` and `1,000`; Republish says Republish.
- [x] A suspended player's seeds and suggestions leave the public lists and return on restore.
- [x] A suggestion keyed to a cluster two merges down joins the root; a merge refuses a merged cluster on either side; the migration repairs existing chains and runs twice.
- [x] No money function changes.

## Verification

- `pnpm --filter @backseat/board test`
- `pnpm --filter @backseat/board typecheck`
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/board_moderation_test.ts platform/supabase/functions/_shared/migration_test.ts platform/supabase/functions/_shared/community_core_test.ts`
- `E2E_PORT=4480 npx playwright test` in `platform/board` (`BOARD_E2E_PORT`), the board's suite.
- `pnpm verify`
- After the migration is applied in the Supabase SQL editor: suspend a test player in the board and see their seed leave the public gallery.

## Evidence

- Confirms, busy guard, pickers, reason hints, error sentence, amounts and verbs: `platform/board/src/Board.test.tsx` (community admin, games and agents) and `platform/board/src/lib/community.test.ts`.
- Suspended authors, merge chains, the repair and the grants: `platform/supabase/functions/_shared/board_moderation_test.ts`.
- Layout: the board's e2e suite at 375 px (no page overflow, the Decline flow) and the confirm accepted in the Community test.

## Decisions

- 2026-10-17: the busy state disables buttons with `aria-disabled`, not `disabled`, as the rest of the panel does, so focus stays on the pressed button (`Board.test.tsx`, the sources).
- 2026-10-17: the suspended-author filter is inline `not exists` on `community.profiles`, so restoring a player needs no other change and the planner sees the join.
