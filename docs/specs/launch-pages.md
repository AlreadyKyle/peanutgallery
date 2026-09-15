# Launch pages: Shipped, legal and contact, link previews, two-factor board

Status: draft. Card: none. Owner: board.

## Problem

A visitor cannot see what the agents have shipped: cards in `live` are never loaded. The site has no Terms, Privacy, Refunds or Contact page, which Stripe expects of a business taking payments. Links shared on Reddit, Hacker News and X show no preview. PLAN.md §4 requires a TOTP second factor on /board for directives, launch and mode changes before launch.

## Scope

In:
- A Shipped section and a Shipped filter state.
- `/terms`, `/privacy`, `/refunds` and `/contact` routes linked from the footer.
- OG and Twitter meta with a 1200×630 image.
- Supabase Auth TOTP enrolment and challenge on /board, and `aal2` required in the board RPCs that change state.

Out: a stream, a kill switch, display names, personal decisions.

## Behaviour

**Shipped.**
- A section after Queued lists cards in `live`, newest first. Each shows the category, title, summary, cost (`actual_usd`), contributors, and "See the change" linking to the merge commit on GitHub when `commit_sha` is set.
- It reads a new anon view `public_shipped` (id, title, summary, bucket, folder, actual_usd, commit_sha, updated_at for stage `live`), or extends the card select to `live`.
- The Right now panel names the latest shipped card.

**Legal and contact.** Plain-language pages drafted by Claude and marked for board review (not legal advice):
- **Terms:** contributions, not donations; no goods or ownership bought; the kernel rules; Ontario law.
- **Privacy:**
  - Stripe processes payments; the studio stores amount, split, a hashed contributor id and an optional display name.
  - No tracking cookies. Board sign-in uses Supabase Auth.
  - How to ask for data deletion.
- **Refunds:** refunds on request within 14 days, disputes through Stripe, and the 10% reserve absorbs them.
- **Contact:** a peanutgallery.games address the board sets up.

Every page uses the text-page layout from BRAND.md.

**Link previews.** `index.html` carries a title, a description (the pitch line), `og:image` (a typographic PNG in the brand tokens, no generated imagery), `og:url` and `twitter:card summary_large_image`.

**Two-factor.**
- /board offers TOTP enrolment after magic-link sign-in and challenges on each new session.
- `file_directive`, `file_card`, `set_launched`, `set_agent_mode` and `file_note` refuse unless `auth.jwt()->>'aal' = 'aal2'`.
- `set_paused` accepts `aal1` for the moderator and `aal2` for the board.

## Acceptance criteria

- [ ] A card moved to `live` appears under Shipped within one poll with its cost and a commit link; anon reads only the view's columns.
- [ ] The four pages render at 375px with no horizontal scroll, each linked from the footer, each with one h1.
- [ ] `curl -s https://peanutgallery.games | grep og:image` shows an absolute URL that returns 200 with a 1200×630 PNG.
- [ ] Every state-changing board RPC refuses an `aal1` session, in the PGlite migration test, and /board walks through enrol and challenge in `Board.test.tsx`.
- [ ] `BRAND.md` documents the Shipped section and the text pages.

## Verification

- `pnpm verify` and the site e2e with and without the public values.
- The live Playwright check script (routes, overflow, console errors) extended to the four new pages.
- The anon negative test extended to `public_shipped`.
- The board enrols TOTP on the live /board and files a test note; the note is refused without the second factor.

## Decisions

- 2026-09-14: legal pages are drafted by Claude for board review, not legal advice.
