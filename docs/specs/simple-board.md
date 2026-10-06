# Board: plain, simple triage and sign-in

Status: built. Card: none. Owner: board.

The board's order of 6 October 2026: the board concept and its sign-in feel weird; make it obvious to a visitor what the board is, and obvious to the board how to do its job, in as few clicks as possible and with plain labels. This is a board pull request: every file of `platform/board` is kernel, and so is `platform/site/src/lib/legal.ts`.

## Problem

A visitor meets "the board" as a bare "Board" tag on cards and one line naming a person, with nothing saying what a board is. The board's own site opens on a heading "Board" and an "Email" box, then signs in to one long page whose card controls sit below the caps, the cooling window and the credit form, list a title with codes ("horizon next · rank 1 · seed-1 config") and no summary, and mix verbs ("Cancel card" rejects; Needs you says "cancel it").

## Audit

Where the board concept, its sign-in and its actions appear, what confuses, and the familiar pattern each maps to.

**The public site (`platform/site`).**

- Card tag `copy.sources.board` "Board" (`Cards.tsx` via `sourceLabel`, on /, /roadmap and a card's page, "Board · $0.42 spent so far"). Confusing: reads as a category or a place, not who filed it. Pattern: GitHub's "opened by", Canny's "posted by the team". Fix: "Filed by the board", "Suggested by the community", "Drafted by an agent".
- Who runs it (`legal.whoRuns`, /how-it-works and the foot of /team): "a human board: Kyle Smith." Confusing: never says what a board does. Pattern: a Kickstarter creator or GitHub maintainers line. Fix: "a board: the people who run the studio and approve what gets built, today Kyle Smith." The duties list under it stays.
- "Picked by the board" (status), "Held by the board" (/roadmap veto), "Board work on how the studio runs (not funded by cards)" (/roadmap group), the paused notices in `legal.ts`. Plain already; unchanged.
- Sign-in: none. /board answers not found and no page links the board's site, by decision (PLAN.md §4 The Board, §10 decision 39, tested by `e2e/csp.spec.ts`). See Decisions: the requested public "Board sign-in" link conflicts with decision 39 and is a backlog entry, not built here.

**The board's site (`platform/board`).**

- Signed-out screen: h1 "Board", "Private controls for the board", an "Email" field, "Send sign-in link", then "A sign-in link was sent to …". Confusing: does not say who it is for, that a code follows, or that the link must be opened in the same browser. Pattern: Linear/GitHub sign-in ("Sign in to …", "Continue with email", "check your email"). Fix: h1 "Mob Machine board", a one-line lede saying what the board is, a "Board sign-in" section with one line on the two steps, "Board email", "Email me a sign-in link", "Check … for your sign-in link, and open it in this browser."
- Second factor: one 40-word list of every gated control. Fix: one line, "Enter the 6-digit code … Until then this page is read-only: you can see what needs you, but not act on it."
- Not a member: "This account is not on the board." Fix: says what to do (sign out, use the board email).
- Page shape: fourteen blocks in one scroll, card review eleventh. Pattern: Linear's Inbox then Triage; Jira's board. Fix: a row of jump links ("On this page": Needs you, Cards, Pause, Studio, Roles, Jobs, File a card, Caps, Record credit; at the first factor only the parts shown), and the order Needs you, Cards, Pause, Studio, Roles, Jobs, File a card / directive / note, Caps, Cooling window, Record credit.
- Needs you: already the inbox; its empty state "Nothing needs you." said nothing about what would show there. Fix: a one-line lede ("Your inbox: what the board has to act on now. Each item says what to do.") and an empty state naming what lands there.
- Cards: each row a title, a code line and a form. Confusing: no summary to review, no line saying what to do with this card, and "Save horizon and rank" / "Cancel card". Pattern: a triage queue (Linear Triage, Canny's status change): each item shows what it is and the actions beside it. Fix: the row shows the card's summary, then one bold line saying where it stands and what the board can do ("New from the agents: it opens for funding when its cooling window ends, unless you veto it.", "On the roadmap. Move it to now, with a funding target, to open it for funding.", "Paused at its spending limit. Resume it …"), then the code line in muted text; over the list one count line ("2 need a decision · 1 new from the agents · 2 open for funding"); the empty state says how to get a card.
- Verbs, one each, used everywhere: Move card (horizon and rank; moving to now opens it for funding), Veto card / Lift veto (hold it back), Reject card (cancel_card: stops for good with the reason), Resume card. Needs you says "reject it under Cards". Section headings: "Pause the agents" (with one line on what pausing does), "Studio status", "Spending caps".

**Asked for and not possible without a schema change.** Editing a card's title or summary (no board RPC edits the hashed fields) and setting a priority (no board control for it) need a kernel migration; the edit is a backlog entry. "Approve to the floor" maps to Move card to now with a target; "reject with a reason" to Reject card.

## Scope

In: words, order, the jump links and the triage line on the board's site; the summary column in the board's card read (`BOARD_CARD_COLUMNS`); the public card tag and the first Who runs it line; two backlog entries.
Out: the sign-in mechanism (magic link to `board_members`, `shouldCreateUser: false`, TOTP at aal2), every RPC, the schema, money, the Content Security Policy, the public site's absence of any board link.

## Behaviour

As in the audit's fixes. No control gains or loses an RPC; every state change still needs the second factor and a reason.

## Acceptance criteria

- [x] Signed out, the board's site shows "Mob Machine board", the lede, a "Board sign-in" section with "Board email" and "Email me a sign-in link"; the link call is unchanged (`shouldCreateUser: false`).
- [x] Signed in, an "On this page" row links each shown part, every link has its target, and at the first factor it links only Needs you, Studio, Roles and Jobs and says the page is read-only.
- [x] At the second factor Cards follows Needs you, before the pause and the studio.
- [x] Each card row shows its summary, one triage line and the verbs Move card, Veto card or Lift veto, Reject card and Resume card; a count line sits over the list; an empty list says how to get a card.
- [x] Needs you says "reject it under Cards" and its empty state says what would show.
- [x] The public card tag reads "Filed by the board" and Who runs it says what the board is.
- [x] The two deferred changes are backlog entries linked from PLAN.md §4 Not built yet.

## Verification

- `pnpm --filter @backseat/board test`, `BOARD_E2E_PORT=4420 pnpm --filter @backseat/board e2e`
- `pnpm --filter @backseat/site test`, `E2E_PORT=4421 npx playwright test e2e/pages.spec.ts e2e/landing.spec.ts e2e/card.spec.ts e2e/csp.spec.ts e2e/layout-balance.spec.ts e2e/team-status.spec.ts` in `platform/site`
- `pnpm test:docs`, `pnpm secret-scan`, `pnpm verify`
- After merge: the board site and the public site deploy; the board signs in and sees the new first screen (waits on: the board).

## Evidence

- Board unit tests: `Tests  112 passed (112)`, including `lib/board.test.ts` "cardTriage, triageHint and triageCounts" and `Board.test.tsx` "Board triage (docs/specs/simple-board.md)" and "says what the board is, and that the sign-in is for board members".
- Board e2e on 4420: `9 passed (3.5s)`, the second-factor test now also reading the undealt card's triage line and following the Cards jump link; the 16 px rhythm test passes at 375, 768 and 1440 px for the moderator and the board.
- Site unit tests: `Tests  529 passed (529)`. Site e2e on 4421, the six specs above: `114 passed (1.2m)`, `csp.spec.ts` still finding no /board and no board address.
- `pnpm test:docs`: `ℹ pass 22`, `ℹ fail 0`.
- `pnpm secret-scan` and `pnpm verify`: quoted in the pull request.

## Decisions

- 2026-10-06: no "Board sign-in" link on the public site in this change. PLAN.md §4 The Board says the public site does not link the board's site, decision 39 gives it its own netlify.app address with no DNS change, and `e2e/csp.spec.ts` fails a public page naming any netlify.app address but the game's. A link is a board decision amending 39; the backlog entry "Board sign-in link on the public site" sets out what it takes. Until then the board's site itself carries the obvious sign-in, and the board keeps its bookmark (BOARD-SETUP step 17).
- 2026-10-06: Reject replaces Cancel as the board's verb for `cancel_card`, since the card ends rejected and the public reads it as Not built. The RPC keeps its name.
