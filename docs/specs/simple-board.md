# Board: plain, simple triage and sign-in

Status: built. Card: none. Owner: board.

The board's order of 6 October 2026: the board concept and its sign-in feel weird. Cut the same day to critical fixes and minutes-long wording changes; the bigger, simpler model is one backlog entry, [A simpler board site: triage queue and sign-in](../BACKLOG.md#a-simpler-board-site-triage-queue-and-sign-in). This is a board pull request: `platform/board` and `platform/site/src/lib/legal.ts` are kernel.

## Audit

Nothing is broken: sign-in (magic link to `board_members`, `shouldCreateUser: false`, TOTP at aal2), every control and the public site's lack of any board link work as PLAN.md §4 The Board says. What confuses:

- **Public site.** The card tag reads a bare "Board" ("Board · $0.42 spent so far"), which reads as a category, not who filed it; Who runs it names "a human board: Kyle Smith" without saying what a board does. Pattern: GitHub's "opened by", a maintainers line.
- **Board site, signed out.** h1 "Board", an "Email" box and "Send sign-in link" do not say who it is for, that a code follows, or to open the link in the same browser. Pattern: Linear or GitHub sign-in.
- **Board site, signed in.** The second-factor step is a 40-word list of every gated control; "This account is not on the board." gives no next step; "Nothing needs you." and "No cards to manage." say nothing about what would show or what to do; a card row shows no summary, so the board reviews titles alone; "Cancel card" rejects the card while Needs you says "cancel it"; headings "Agents", "Studio" and "Caps" are terse.
- **Bigger, deferred.** One long page with card review eleventh; no triage grouping or per-card next step; no way to edit a card's words (no board RPC edits the hashed fields); no public sign-in link, which PLAN.md §4 The Board, §10 decision 39 and `e2e/csp.spec.ts` rule out until the board amends 39. Pattern: Linear Inbox then Triage, Canny admin status changes. All in the one backlog entry.

## Scope

In: the wording above; the card summary in the board's card read (`BOARD_CARD_COLUMNS`) and row.
Out: sign-in mechanism, RPCs, schema, money, page order, the Content Security Policy, any public board link.

## Acceptance criteria

- [x] Signed out: "Mob Machine board", a one-line lede on what the board is, a "Board sign-in" section with "Board email" and "Email me a sign-in link", and a status telling the member to open the link in this browser.
- [x] Signed in: the second-factor line says the page is read-only until the code is in; a non-member is told to sign in with the board email.
- [x] Each card row shows its summary; the verbs are Move card, Veto card or Lift veto, Reject card and Resume card, and Needs you says "reject it under Cards".
- [x] Empty Needs you and empty Cards say what would show and how to get a card.
- [x] The public card tag reads "Filed by the board" (and "Suggested by the community", "Drafted by an agent"); Who runs it says the board is the people who run the studio and approve what gets built.
- [x] The deferred model is one backlog entry on next, linked from PLAN.md §4 Not built yet.

## Verification

- `pnpm --filter @backseat/board test`; `BOARD_E2E_PORT=4420 pnpm --filter @backseat/board e2e`
- `pnpm --filter @backseat/site test`; in `platform/site`, `E2E_PORT=4421 npx playwright test e2e/pages.spec.ts e2e/landing.spec.ts e2e/card.spec.ts e2e/csp.spec.ts e2e/layout-balance.spec.ts e2e/team-status.spec.ts`
- `pnpm test:docs`, `pnpm secret-scan`, `pnpm verify`
- After merge: both sites deploy and the board signs in once (waits on: the board).

## Evidence

Quoted in the pull request body.

## Decisions

- 2026-10-06: no public "Board sign-in" link here: it conflicts with PLAN.md §10 decision 39 and §4 The Board. The board's site carries the plain sign-in, and the board keeps its bookmark (BOARD-SETUP step 17).
- 2026-10-06: Reject replaces Cancel as the board's word for `cancel_card`, since the card ends rejected and the public reads it as Not built. The RPC keeps its name.
