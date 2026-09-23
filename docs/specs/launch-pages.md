# Launch pages: Shipped, legal and contact, link previews, two-factor board

Status: done. Card: none. Owner: board.

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
- A Shipped section after Queued lists each shipped card with its category, title, summary, cost (studio-billed spend from `public_card_spend` as `$0.00`, left out when there is none), contributors (from `public_card_funding`) and ship date ~~(`updated_at`)~~. Superseded: `card-columns-and-open-funding.md` adds `cards.live_at`, stamped when a card moves to live, and the site reads the ship date from it once that migration is live (2026-09-16). A Dust card also links "Play the game" to `VITE_PLAY_URL` when it is set.
- With no shipped card the section is not rendered, like Building now and Queued.
- The Right now panel reads "Latest shipped: <title>" when a card has shipped.

**Legal and contact.** Plain-language text pages, drafted by Claude for board review (not legal advice). Each follows the text-page layout: one h1 and a lede, then sections with an h2. Every string lives in `copy.ts`. The pages say "contributions", never "donations", and do not print the word draft.
- **Operator.** "Peanut Gallery is operated by Kyle Smith, an individual in Ontario, Canada." Contact address hello@clayhouse.studio (PLAN §10 decision 37), as a mailto link.
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
  - Deletion or a copy of your data: email hello@clayhouse.studio. The public pages never show names or emails.
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

**Live check.** `platform/site/scripts/live-check.mjs [baseUrl]` checks every public route and /board at 375px and 1440px for status, one h1, no horizontal overflow and no console errors, including the four new pages. It also checks the landing h2 order read from the page, `og:image` as an absolute URL, and `/og.png` as a 200 `image/png` of 1200×630. The data checks fail when the site has no data, unless `--allow-no-data` turns them into skips. The first output line is PASS or FAIL, and it exits non-zero on failure. `platform/site/scripts` is added to `platform/gate/kernel-paths.txt` and the dispatcher's copy.

## Acceptance criteria

- [x] `groupCards` puts live cards in `shipped`, newest `updated_at` first, and in no other group; `/contribute` offers no live card.
- [x] The site's card select includes `live` and reads `updated_at`.
- [x] The landing shows Shipped after Queued. Each row has category, title, summary, cost, contributors and ship date, plus Play the game for a Dust card when the play URL is set. There is no Shipped heading without a shipped card, and Right now names the latest shipped card.
- [x] `/terms`, `/privacy`, `/refunds` and `/contact` each render one h1 at 375px with no horizontal scroll, and every page's footer links to all four.
- [x] `index.html` carries the description and preview tags with an absolute `og:image`. The description matches the pitch in `copy.ts`, and `public/og.png` is a 1200×630 PNG.
- [x] In the PGlite migration test, each of the five RPCs and a board `set_paused` refuse `aal1` and succeed at `aal2`. A moderator pauses at `aal1`, and the heartbeat, `board_role` and `board_studio_state` work at `aal1`.
- [x] In `Board.test.tsx`, /board walks through enrolment and the challenge, and hides the `aal2` controls at `aal1` while the heartbeat runs. The moderator pauses at `aal1`.
- [x] The copy no longer promises a one-minute meter for every amount, names episode thumbnails or lore cards, or points at a Next heading. The read/write rule reads as a rule.
- [x] `live-check.mjs` prints PASS or FAIL first and exits non-zero on failure, and `platform/site/scripts` is on both kernel lists.
- [x] `BRAND.md` documents the Shipped section, the text-page layout and the footer links.
- [x] Live: `curl -s https://peanutgallery.games | grep og:image` shows an absolute URL that returns 200 with a 1200×630 PNG.
- [x] Live: the migration is applied, and the board enrols TOTP on /board and files a test note. A note is refused without the second factor.

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

## Evidence

2026-09-15, branch `launch-pages`, since merged as 3a08226 (PR 21). The live steps are pending: apply the migration, enrol TOTP on the live /board and file a test note, and run the live check against production.

- **Shipped.**
  - `cards.test.ts`: "sends building and gated cards to now, funded cards to queued, live cards to shipped and the rest to fund", and `shippedOrder`.
  - `source.test.ts`: the select ends `created_at,updated_at`, and `CARD_STAGES` ends `live`.
  - `Cards.test.tsx` `ShippedList`: the row contents, "Board" for an unfunded card, Play the game only on Dust with a play URL, and nothing without a shipped card.
  - `Landing.test.tsx`: h2 order Right now, Building now, Fund what's next, Queued, Shipped, How it works, Funding, Ledger, Fixed rules. Right now reads "Latest shipped: The unlock list", and the filter still counts All 3 with two live cards present.
  - `Contribute.test.tsx`: a live goal with room on its bar is not offered.
- **Text pages.**
  - `App.test.tsx` "Terms, Privacy, Refunds and Contact": one h1, the lede, every section, no unreplaced token, no "draft", the mailto link, the operator line, the Refunds page link, and Discord only with the invite.
  - "links Terms, Privacy, Refunds and Contact in the footer of every page".
  - `e2e/text-pages.spec.ts`: one h1 and no overflow at 375px for each page, and the footer links open the pages.
- **Link previews.** `src/index-html.test.ts`: the description equals the `copy.ts` pitch, the tags, and `public/og.png` IHDR 1200×630. `e2e/previews.spec.ts`: `/og.png` served 200 `image/png` at 1200×630. `node platform/site/scripts/og-image.mjs` printed `wrote platform/site/public/og.png 1200x630 45954 bytes`, and a second run from the package wrote the same size.
- **Two-factor.**
  - `migration_test.ts` step "a board session without the second factor is refused every state-changing RPC and keeps the aal1 ones": the five RPCs and a board `set_paused`, at `aal1` and with no aal claim, then each succeeds at `aal2`.
  - Step "a moderator can pause, heartbeat and read studio_state at aal1 but not file or launch".
  - Step "an outsider is refused by every board RPC, even at aal2".
  - Privileges: authenticated holds the eleven board RPCs.
  - `migration.test.ts` "board-two-factor migration": each redefined function minus the refusal equals its previous definition character for character, the grants are repeated, and the file is repeatable.
  - `Board.test.tsx` "Board two-factor sign-in": enrolment (the abandoned factor removed, the QR image, the secret, a wrong code refused, then the controls), the challenge, skipped at `aal2`, and the heartbeat and status at `aal1` with no state-changing RPC called. "Board signed in as the moderator": pauses and resumes at `aal1` with no MFA call.
- **Copy audit.** The grep of `copy.ts` and `Board.tsx` before the change found:
  - `copy.ts:14` "agent avatars, episode thumbnails and lore cards".
  - `copy.ts:56` "It shows on the meter within a minute."
  - The fixed rule "Agents that write code never read messages from the public. Only notes from the board reach them."
  - `Board.tsx:470` "shows on the site under Next".
  - `Board.tsx` "Notes are private advisory text to the Studio Head.", although note triage only logs that it is due (`platform/dispatcher/src/scheduler.ts`).

  After the change, `git grep -n -i -E "founding|decision|stream|episode|lore|badge|thumbnail|avatar|minute|Studio Head"` over the two files returns only:
  - `copy.ts:14`, the art policy rule.
  - `copy.ts:51` "Contributions made now count as founding contributions." It is recorded by time before `launched_at`, and no badge is promised.
  - `copy.ts:56` and `:162`, the $50 rule.
  - `copy.ts:96` `decision: 'Player decision'`, a source label shown only for a card with that source.
  - `Board.tsx:937`, the note line.
- **Kernel paths.** `worktree.test.ts` "keeps the kernel list equal to the gate file", and `platform/site/scripts/live-check.mjs` refused in the platform code lane.
- **Live check.** Run against `pnpm --filter @backseat/site preview` on http://127.0.0.1:4173:
  - A build without the public values, no flag: `FAIL live-check http://127.0.0.1:4173 passed=81 failed=3 skipped=4`, the three data checks, exit 1.
  - The same build with `--allow-no-data`: `PASS live-check http://127.0.0.1:4173 passed=81 failed=0 skipped=7`.
  - A build with the Netlify public values: `PASS live-check http://127.0.0.1:4173 passed=94 failed=0 skipped=2`, landing h2 `["Right now","Fund what's next","Queued","Shipped","How it works","Funding","Ledger","Fixed rules"]` and "Latest shipped: Spawn table: gatherer baseCost 10 to 11".
- **Suites.**
  - `pnpm verify` exit 0: supabase 92, site 117, dispatcher 193, seed-1 69, gate 157, Deno 45 passed (28 steps), `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`.
  - Site e2e 11 passed, both without and with the public values.


2026-09-20, the two live lines closed.

- **`og:image`.** The live page carries `<meta property="og:image" content="https://peanutgallery.games/og.png" />`,
  an absolute URL. Fetching it returns HTTP 200, 45,954 bytes, and the file is a PNG of 1200x630.
- **Two-factor on production.** The migration is applied. `auth.mfa_factors` holds one verified TOTP
  factor, enrolled 2026-09-20 00:18:56 UTC, with no unverified factor left over from an abandoned
  attempt.
- **The second factor proved against a state-changing RPC.** The board filed a directive rather than
  a note: card `8bd842eb-8cf7-4f24-a17d-031bd2f97e4b`, "second factor test", at 00:25:54 UTC.
  `file_directive` and `file_note` both refuse a session without `aal2` through `board_aal2()`, and
  `file_directive` is the higher-privilege of the two, so this proves the same path. The refusal at
  `aal1` is covered by `migration_test.ts`, which exercises all five state-changing RPCs at `aal1`,
  with no aal claim, and at `aal2`.
- That directive left a real `funded` card at priority 0. It was deleted the same day, after checking
  that no `ledger`, `contributions`, `agent_events`, `votes`, `images` or `board_notes` row referenced
  it; the ledger identity and the pool balance were unchanged by the delete.
- **The live check.** `PASS live-check https://peanutgallery.games passed=111 failed=0 skipped=0`.
  The count is data-dependent by design — Building now, Queued and Shipped assert only when cards are
  in those states — so it moves with the card mix; the 18 September run quoted 112 with a different
  mix.

## Decisions

- 2026-09-14: legal pages are drafted by Claude for board review, not legal advice.
- 2026-09-15: no `public_shipped` view and no commit link (board). The repository is private, so a GitHub link would 404. ~~Anon already reads `cards` at table level, so the site's card select adds `live` and `updated_at` instead.~~ Superseded: `card-columns-and-open-funding.md` replaces the table-level read with column grants. The site's card select, with `live` in its stages and `updated_at` in its columns, names only granted columns (2026-09-16).
- 2026-09-15: the legal and contact pages carry the operator line "Peanut Gallery is operated by Kyle Smith, an individual in Ontario, Canada." and the address hello@peanutgallery.games (board). The content is as listed under Behaviour.
- 2026-09-23: the contact address is hello@clayhouse.studio, superseding hello@peanutgallery.games (board, PLAN §10 decision 37).
- 2026-09-15: the 14-day hold above $50 of agent credit a day is stated on the Terms page as the rule, before phase 4 builds it (board).
- 2026-09-15: link previews use a typographic `og.png` drawn by a committed Playwright script from the site's stylesheet (board). No generated imagery.
- 2026-09-15: two-factor is enforced in the database through `board_aal2()` (board). The moderator's pause stays at `aal1`. The heartbeat, `board_role` and `board_studio_state` stay at `aal1`, so attended dispatcher runs keep a board session before the second factor.
- 2026-09-15: the copy audit fixes the meter line, the read/write rule, the art policy wording and the Next card form's heading reference (board).
- 2026-09-15: the live check script moves into `platform/site/scripts` and becomes a kernel path (board).
- 2026-09-15: BRAND.md documents the Shipped section, the text-page layout and the footer links (board).
- 2026-09-15: Shipped renders as rows, not boxes, and is not rendered until a card ships. A shipped card is a record whose one action, Play the game, is the same for every Dust card; Building now and Queued already render nothing when empty.
- 2026-09-15: a shipped card with no goal and no funding shows its source ("Board") in place of "0 contributors". A board directive was never open to fund, so a zero count would misread.
- ~~2026-09-15: the ship date is `updated_at`, as agreed. It also moves if a live card is updated later, for example a contribution to a live goal. Accepted for launch.~~ Superseded: `card-columns-and-open-funding.md` adds `cards.live_at` and stops crediting a card past voting (2026-09-16).
- 2026-09-15: enrolment starts from a "Set up an authenticator app" button, not on page load, and first removes unverified TOTP factors from an abandoned attempt. Enrolling on load would create a factor on every visit.
- 2026-09-15: the two-factor step shows for board members only. The moderator's only control, pause, stays at `aal1`.
- 2026-09-15: Privacy says the public pages show totals and contributor counts, not "amounts and splits". The site shows no split aggregate or per-contribution amount, and ROADMAP.md forbids describing what does not exist.
- 2026-09-15: Privacy names Stripe's reference for the payment, which the studio stores (`stripe_event_id`, `stripe_session_id`). It also says payment records the law requires are kept, so a deletion request is not promised beyond the law.
- 2026-09-15: the Refunds page states the reversal of a contribution's credit as the rule, like the daily hold. Phase 4 builds both, and it must ship before launch.
- 2026-09-15: How it works step 4 now points at Shipped, and the /board note form says note triage is not built. The audit found both claims.
- 2026-09-15: text-page sections sit `--space-4` apart, closer than landing sections, because each holds a sentence or two.
- 2026-09-15: the live check fails when the site has no data unless `--allow-no-data` is passed, so a production run can never pass on an outage.
- 2026-09-15: a card's public cost is its studio-billed spend from the view `public_card_spend`, never `cards.actual_usd`. `actual_usd` counts founder-billed turns, and PLAN.md §4 keeps the founder's tokens private. A card built only on the founder's time shows no cost. Building now uses the same figure. ~~Anon can still select `cards.actual_usd` through the API; closing that needs column grants on `cards` and is left to a follow-up for the board (found in review, 15 September 2026).~~ Superseded: `card-columns-and-open-funding.md` grants anon and authenticated the public columns of `cards` only, without `actual_usd`, `severity` or `priority` (2026-09-16).
