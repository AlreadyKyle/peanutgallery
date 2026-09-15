# Launch pages: Shipped, legal and contact, link previews, two-factor board

Status: agreed. Card: none. Owner: board.

## Problem

A visitor cannot see what the agents have shipped: cards in `live` are never loaded. The site has no Terms, Privacy, Refunds or Contact page, which Stripe expects of a business taking payments. Links shared on Reddit, Hacker News and X show no preview. PLAN.md §4 requires a TOTP second factor on /board for directives, launch and mode changes before launch. ROADMAP.md also requires that nothing on the site describes a feature that does not exist.

## Scope

In:
- A Shipped section on the landing page, read through the site's existing card select.
- `/terms`, `/privacy`, `/refunds` and `/contact`, linked from the footer.
- Description, Open Graph and Twitter meta with a 1200×630 typographic image, and the script that draws it.
- Supabase Auth TOTP enrolment and challenge on /board, and `aal2` required in the board RPCs that change state, except the moderator's pause.
- A copy audit of `copy.ts` and `Board.tsx`.
- The live check script, kept in the repository as a kernel path.
- BRAND.md updated.

Out: a stream, a kill switch, display names, personal decisions, a `public_shipped` view, commit links, and the 14-day hold and refund reversal themselves (phase 4, `refunds-and-holds.md`).

## Behaviour

**Shipped.**
- The site's card select adds `live` to its stages and `updated_at` to its columns.
- `groupCards` returns a `shipped` group: cards in `live`, newest `updated_at` first. A live card is never in Fund what's next and never offered on `/contribute`.
- A Shipped section after Queued lists each shipped card with its category, title, summary, cost (`actual_usd` as `$0.00`), contributors (from `public_card_funding`) and ship date (`updated_at`). A Dust card also links "Play the game" to `VITE_PLAY_URL` when it is set.
- With no shipped card the section is not rendered, like Building now and Queued.
- The Right now panel reads "Latest shipped: <title>" when a card has shipped.

**Legal and contact.** Plain-language text pages, drafted by Claude for board review (not legal advice). Each follows the text-page layout: one h1 and a lede, then sections with an h2. Every string lives in `copy.ts`. The pages say "contributions", never "donations", and do not print the word draft.
- **Operator.** "Peanut Gallery is operated by Kyle Smith, an individual in Ontario, Canada." Contact address hello@peanutgallery.games, as a mailto link.
- **Terms.**
  - Who operates the studio.
  - A contribution funds agent compute and the studio as the supporter splits it at checkout. It buys no goods, no ownership, no equity, no guaranteed outcome and no vote weight.
  - Funding a card is the vote. A full bar moves the card to the queue, and the gate may still reject the change.
  - The fixed rules cannot be changed by contributions: the ledger, spend caps, the default 80/20 split and 10% reserve, the emergency fund rule, the gate, rollback, the content filter and all-ages rating, the art policy, and the read/write separation.
  - Contributions above $50 of agent credit per person per day are held 14 days before they reach the meter, stated as the rule.
  - Refunds follow the Refunds page. The games are free. The laws of Ontario and Canada apply. Changes are posted on the page with a date. How to get in touch.
- **Privacy.**
  - Stripe processes payments, and the studio never sees card numbers.
  - The studio stores the amount, the split, the card funded, the time, a one-way hash of the email Stripe collects (not the email itself), and the optional display name, kept private until names are reviewed.
  - No ads, no analytics, no tracking cookies.
  - Board sign-in uses Supabase Auth, and only board members can sign in.
  - Hosting logs (Netlify, Supabase) may record IP addresses for security.
  - Deletion or a copy of your data: email hello@peanutgallery.games. The public pages never show names or emails.
- **Refunds.**
  - Ask within 14 days by email with the receipt. Refunds go back through Stripe to the original payment method.
  - A refund or dispute reverses that contribution's credit on the meter and on any card bar it funded. Work already shipped stays shipped.
  - Disputes go through Stripe, and the 10% reserve covers disputes first.
- **Contact.** The address, what to write about (refunds, data requests, anything else), and the Discord link when `VITE_DISCORD_INVITE` is set.
- The footer links to all four in muted small text.

**Link previews.** `index.html` carries:
- `description`: the pitch line, `pitchTitle` and `pitchBody` from `copy.ts` as one pair of sentences.
- `og:type` website, `og:site_name` Peanut Gallery, `og:title`, `og:description`, `og:url` https://peanutgallery.games/.
- `og:image` https://peanutgallery.games/og.png, with `og:image:width` 1200, `og:image:height` 630 and `og:image:alt`.
- `twitter:card` summary_large_image.

`platform/site/scripts/og-image.mjs` renders `public/og.png` at exactly 1200×630 with Playwright Chromium, using the site's own stylesheet tokens, the peanut mark, the wordmark and the pitch line. It is typographic, with no generated imagery, and the PNG is committed.

**Two-factor.**
- Migration `20260919000000_board_two_factor.sql`, safe to run twice, adds `public.board_aal2()`, true when `auth.jwt()->>'aal'` is `aal2`. It is granted like `is_board_member`.
- `file_directive`, `file_card` (the eleven-argument version), `file_note`, `set_launched` and `set_agent_mode` keep their signatures, bodies and grants, and refuse with "A second factor is required" unless `board_aal2()`.
- `set_paused` refuses a board member without `aal2` and accepts a moderator at `aal1`. `board_heartbeat`, `board_role` and `board_studio_state` stay at `aal1`, because attended dispatcher runs rely on the heartbeat.
- /board, after sign-in and the role check, runs a two-factor step for a board member:
  - With no verified TOTP factor, it shows enrolment: the QR code image from the enrol response, the secret as text, a 6-digit code field and Verify.
  - With a verified factor on an `aal1` session, it shows a challenge: a code field and Verify.
- Until the session is `aal2`, the studio status and the board session heartbeat keep running. Go live, the agent mode, the Next card, directive and note forms, and the board's pause are not rendered, and a line says a second factor is needed. The moderator's pause and resume work at `aal1`.

**Copy audit.** Every claim in `copy.ts` and `Board.tsx` is checked against what exists:
- The meter line says a contribution shows within a minute up to $50 of agent credit a day, and larger amounts after 14 days.
- The read/write fixed rule is stated as the rule: no agent that can change the game or the site reads text from the public.
- The art policy keeps the PLAN.md §4 line and states generated imagery as a rule, without claiming episode thumbnails or lore cards exist.
- The board's Next card form names the current heading, Fund what's next.

**Live check.** `platform/site/scripts/live-check.mjs [baseUrl]` checks every public route and /board at 375px and 1440px for status, one h1, no horizontal overflow and no console errors, including the four new pages. It also checks the landing h2 order read from the page, `og:image` as an absolute URL, and `/og.png` as a 200 `image/png` of 1200×630. The data checks run when the site has data. The first output line is PASS or FAIL, and it exits non-zero on failure. `platform/site/scripts` is added to `platform/gate/kernel-paths.txt` and the dispatcher's copy.

## Acceptance criteria

- [ ] `groupCards` puts live cards in `shipped`, newest `updated_at` first, and in no other group; `/contribute` offers no live card.
- [ ] The site's card select includes `live` and reads `updated_at`.
- [ ] The landing shows Shipped after Queued. Each row has category, title, summary, cost, contributors and ship date, plus Play the game for a Dust card when the play URL is set. There is no Shipped heading without a shipped card, and Right now names the latest shipped card.
- [ ] `/terms`, `/privacy`, `/refunds` and `/contact` each render one h1 at 375px with no horizontal scroll, and every page's footer links to all four.
- [ ] `index.html` carries the description and preview tags with an absolute `og:image`. The description matches the pitch in `copy.ts`, and `public/og.png` is a 1200×630 PNG.
- [ ] In the PGlite migration test, each of the five RPCs and a board `set_paused` refuse `aal1` and succeed at `aal2`. A moderator pauses at `aal1`, and the heartbeat, `board_role` and `board_studio_state` work at `aal1`.
- [ ] In `Board.test.tsx`, /board walks through enrolment and the challenge, and hides the `aal2` controls at `aal1` while the heartbeat runs. The moderator pauses at `aal1`.
- [ ] The copy no longer promises a one-minute meter for every amount, names episode thumbnails or lore cards, or points at a Next heading. The read/write rule reads as a rule.
- [ ] `live-check.mjs` prints PASS or FAIL first and exits non-zero on failure, and `platform/site/scripts` is on both kernel lists.
- [ ] `BRAND.md` documents the Shipped section, the text-page layout and the footer links.
- [ ] Live: `curl -s https://peanutgallery.games | grep og:image` shows an absolute URL that returns 200 with a 1200×630 PNG.
- [ ] Live: the migration is applied, and the board enrols TOTP on /board and files a test note. A note is refused without the second factor.

## Verification

- `pnpm verify` at the repository root exits 0.
- `pnpm --filter @backseat/site build && pnpm --filter @backseat/site e2e`, with and without the Netlify public values exported.
- `bash platform/gate/test/run-tests.sh`.
- `bash platform/gate/ship-gate.sh --folder platform --lane code` with the branch's commit message and changed files, the way CI runs it.
- `node platform/site/scripts/live-check.mjs http://127.0.0.1:4173` against `pnpm --filter @backseat/site preview`.
- After merge and deploy:
  - The migration is applied through the Management API.
  - The board enrols TOTP on the live /board and files a test note.
  - `node platform/site/scripts/live-check.mjs` passes against https://peanutgallery.games.

## Decisions

- 2026-09-14: legal pages are drafted by Claude for board review, not legal advice.
- 2026-09-15: no `public_shipped` view and no commit link (board). The repository is private, so a GitHub link would 404. Anon already reads `cards` at table level, so the site's card select adds `live` and `updated_at` instead.
- 2026-09-15: the legal and contact pages carry the operator line "Peanut Gallery is operated by Kyle Smith, an individual in Ontario, Canada." and the address hello@peanutgallery.games (board). The content is as listed under Behaviour.
- 2026-09-15: the 14-day hold above $50 of agent credit a day is stated on the Terms page as the rule, before phase 4 builds it (board).
- 2026-09-15: link previews use a typographic `og.png` drawn by a committed Playwright script from the site's stylesheet (board). No generated imagery.
- 2026-09-15: two-factor is enforced in the database through `board_aal2()` (board). The moderator's pause stays at `aal1`. The heartbeat, `board_role` and `board_studio_state` stay at `aal1`, so attended dispatcher runs keep a board session before the second factor.
- 2026-09-15: the copy audit fixes the meter line, the read/write rule, the art policy wording and the Next card form's heading reference (board).
- 2026-09-15: the live check script moves into `platform/site/scripts` and becomes a kernel path (board).
- 2026-09-15: BRAND.md documents the Shipped section, the text-page layout and the footer links (board).
