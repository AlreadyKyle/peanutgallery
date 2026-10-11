# Ship notices to supporters

Status: agreed. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

A supporter who leaves `/thanks` hears nothing more from the studio. The loop is fund, watch, ship, share (`docs/research/comparables.md`, The share loop), and the ship is the step a supporter never sees unless they come back. The backlog entry "Ship notices to supporters" (Next, rank 7) asked for one email when a card they funded ships.

## Scope

In: one email per payment and shipped card, to the receipt address Stripe holds for that payment's Checkout Session, through the studio's existing Resend sender; a one-click unsubscribe; the Privacy page's line; a migration with the notice and unsubscribe records; the job that sends, on the ops repository's daily schedule; the site's `/api/unsubscribe`.
Out: any other email (receipts stay Stripe's); storing an address anywhere; notices for cards that went live before the migration; an account, a preference page or a resubscribe (a supporter who wants notices back writes to the contact address); the money, the split, the waterfall and every cap, which the notices only read.

## Behaviour

When a card goes live, each Stripe payment that still counts (`money.payment_counts`: not the board's test payment, not refunded or disputed in full) and reached that card (its money on the card, less a card release, above zero, the rule `public_card_supporters` uses) is due one notice. A payment that reached two shipped cards gets two notices; two payments on one card get one each.

The notices job runs once a day in the ops repository (`platform/ops/ops-repo/jobs.yml`, 09:07 UTC), sends at most 50 a run (Resend's free plan sends 100 a day), and for each due pair:

1. reads the payment's Checkout Session from Stripe with the restricted read key, GET only, for `customer_details.email`. The address stays in the job's memory for the one send; it is never written to the database, a log, ntfy or the output. A session Stripe does not answer is left unclaimed and tried the next day;
2. claims the pair (`ship_notice_claim`), which answers true once only;
3. sends through Resend's API from `Mob Machine <board@mobmachine.games>`, the sender Supabase Auth's sign-in email already uses (BOARD-SETUP.md step 13), replies to hello@clayhouse.studio, with an `Idempotency-Key` of the pair;
4. settles the pair as `sent` (with Resend's id), `no_address` or `failed`.

A pair is never claimed twice, so no notice goes twice. A send whose answer is lost or refused is settled `failed`, not retried, and the board is told through ntfy; a claim left at `sending` for over an hour is named the same way.

The email says: "A card you funded has shipped.", the card's title "is live.", "The agents spent $X.XX building it." (the card's studio spend, `money.card_studio_spend`, the figure the weekly report shows), a link to `https://mobmachine.games/card/<id>`, the game's play address (`VITE_PLAY_URL` in `platform/site/netlify.toml`, the site's Play link), and "Stop ship notices" with the unsubscribe link. It carries `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), so a mail client's own unsubscribe button works in one click.

The unsubscribe link is `https://mobmachine.games/api/unsubscribe?p=<payment id>&t=<token>`. The token is `sha256(secret || the payment id's 16 bytes)` in hex, from a 32-byte secret the migration makes in the database and no role can read. `POST` to the link (the mail client's one-click, or the page's button) calls `ship_notice_unsubscribe` with the publishable key; with a matching token it records the payment's contributor id (the one-way hash of the receipt email), and every payment made with that email is left out from then on. `GET` shows one button that posts back and changes nothing, so a mail scanner that opens links unsubscribes nobody.

No address is ever stored. `ship_notices` holds the payment id, the card id, the status and Resend's id; `notice_unsubscribes` holds the contributor id; `ship_notice_settings` holds the start time and the secret. All three have row level security on with no policy, anon and authenticated hold no grant on them, and only the settle, claim, due and unsubscribe functions touch them.

The Privacy page gains a Ship notices section saying the studio emails the address Stripe collected when a card the contribution reached ships, reads it from Stripe at send time without storing it, sends through Resend, and stops for every contribution with that address once the link is used.

## Acceptance criteria

- [ ] `ship_notices_due` lists each counting Stripe payment once per public card it reached that went live at or after `ship_notice_settings.starts_at`, with the card's title, folder, studio spend and the payment's unsubscribe token; it leaves out the board's test payment, a full refund, a card that is not live or not public, a card shipped before `starts_at`, a pair with a notice row, and an unsubscribed contributor (`ship_notices_test.ts`).
- [ ] `ship_notice_claim` answers true once per pair and false after; `ship_notice_settle` moves only a row at `sending` and refuses any status but sent, failed and no_address (`ship_notices_test.ts`).
- [ ] `ship_notice_unsubscribe` writes only with the payment's own token, and then leaves out every payment of that contributor (`ship_notices_test.ts`).
- [ ] anon and authenticated can read none of the three tables and call none of the functions but `ship_notice_unsubscribe`; service_role cannot read the settings row or the token function; no column is named for an email or an address; a second apply keeps the secret (`ship_notices_test.ts`, `migration_test.ts`).
- [ ] The job reads each session with GET and the read key, claims before it sends, sends one email per pair from the studio sender with the unsubscribe headers, settles each, sends nothing on a second run, sends nothing and settles no_address with no address, settles failed and alerts on a Resend error without retrying, leaves an unread session unclaimed, and prints, posts and stores no address (`platform/ops/test/notices.test.mjs`).
- [ ] The email names the card's title, that it is live, what the agents spent, its `/card/:id` page, the play address and the unsubscribe link, and escapes the title in HTML (`notices.test.mjs`).
- [ ] `/api/unsubscribe` answers GET with one button and no write, POST with the RPC call and a confirmation, a malformed link 400 before Supabase, a database refusal 400 and a database failure 502, all no-store HTML with no script or style (`platform/site/netlify/unsubscribe.test.ts`).
- [ ] The Privacy page has the Ship notices section (`platform/site/src/lib/legal.ts`).
- [ ] The notices env holds only its own keys, takes a Resend key (`re_...`) and refuses a Stripe secret key (`notices.test.mjs`); the ops repository template schedules `notices` with its own `NOTICES_ENV` secret (`ops.test.mjs`).

## Verification

- `pnpm verify`
- `E2E_PORT=4410 npx playwright test e2e/text-pages.spec.ts e2e/csp.spec.ts` in `platform/site` (the Privacy page and the site's policy)
- After merge, by the board on the Mac (none of these run from a cloud session):
  1. Move `privacyUpdated` in `legal.ts` to the merge day before the merge if it falls after 11 October 2026 (as `docs/specs/legal-copy.md` did).
  2. Apply `20261011400000_ship_notices.sql` to production, then read back `select count(*) from public.ship_notice_settings` (1), `select starts_at from public.ship_notice_settings` (the apply time) and `select count(*) from public.ship_notices` (0).
  3. Write the env: `platform/ops/make-jobs-env.sh notices` with `RESEND_SMTP_KEY` in `.env` (it becomes `RESEND_API_KEY`); the key must have sending access, which an SMTP key from Resend has. Then `node --env-file <file> platform/ops/jobs/main.mjs notices --dry-run`; quote its first line, `PASS: notices (dry run): due 0, ...` until a card ships.
  4. `gh secret set NOTICES_ENV --repo AlreadyKyle/mobmachine-ops < <file>`, commit the new `jobs.yml` to the ops repository, and move `STUDIO_REF` to the merge sha.
  5. The first line of the `live-check` run for the merge commit, which now checks `/api/unsubscribe`.
  6. After the first card ships: the `notices` job's first line in the ops repository, `select status, count(*) from public.ship_notices group by 1`, and one notice received at an address the board paid with, its unsubscribe used once and `select count(*) from public.notice_unsubscribes` read back.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-10-11: the address is read from Stripe at send time and never stored. The Privacy page already says the email address is not stored, and the backlog entry asked for the address Stripe already holds; the restricted read key the Controller uses can read a Checkout Session.
- 2026-10-11: at most once, not at least once. A claim comes before the send and a lost answer is settled failed, never retried, so a supporter can miss a notice but never gets two; Resend's `Idempotency-Key` covers a retried request inside its own window.
- 2026-10-11: the unsubscribe token is made and checked in the database, so neither the site nor the job holds a secret for it, and `/api/unsubscribe` uses the publishable key like `/api/thanks`. The function is the one anon write: it takes a uuid and 64 hex characters, never free text, and writes a contributor hash only on a match.
- 2026-10-11: GET on the link shows a button and does not unsubscribe, because mail scanners open links; the mail client's one-click (RFC 8058 POST) unsubscribes in one click.
- 2026-10-11: once a day at 09:07 UTC with at most 50 a run, inside Resend's free 100 a day shared with the board's sign-in email. A notice can arrive up to a day after the ship.
- 2026-10-11: only cards that go live after the migration is applied are noticed (`starts_at`), so applying it does not email every supporter of every card shipped before.
