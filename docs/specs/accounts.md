# Accounts: sign-up and sign-in

Status: agreed. Card: none. Owner: board.

A spec is for a new feature or a change to the kernel, money, migrations or the gate; this one changes the site's community function (`platform/site/netlify`), the sign-in settings reader (`platform/site/src/lib/sign-in.ts`) and a line of `legal.ts`, all kernel paths, and adds pages to the route list. The board asked for it on 19 October 2026: the magic-link-only sign-in ("Enter your email and the studio sends you a link that signs you in. There is no password.") read as untrustworthy, and a normal sign-up and sign-in, with providers, was wanted.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

A player could only sign in by asking for a one-time link by email. There was no password, no sign-up page, no "Forgot password?" and no Continue with Google, so the site looked unlike every other site a player has an account with, and players did not trust it.

## Scope

In: email and password sign-up with email confirmation, password sign-in, forgot and reset password, a password section on the desk, buttons for Google, Apple, GitHub and Discord that show only once each is switched on in Supabase Auth, the one-time sign-in link kept as the second way, and the same form wherever the site asks a visitor to sign in (a card's Tell me when this ships, a seed's save, the desk).
Out: switching a provider on (the board's step in the Supabase dashboard and each provider's console), Supabase Auth's email templates and settings (dashboard), two-factor sign-in, passkeys, deleting an account from the site, and anything about money: paying still never needs an account.

## Behaviour

**Pages.** `/sign-in`, `/sign-up`, `/forgot-password` and `/reset-password`, unlisted (not in the sitemap). Each opens on the plate with its title and lede; under it the form in a panel with the card's edge, and on sign-in and sign-up "What a profile keeps" beside it from 64rem (under it on a phone). The top bar's Sign in goes to `/sign-in`. A visitor already signed in who opens `/sign-in`, `/sign-up` or `/forgot-password` goes to `/me`.

**The form.** Continue with each provider that is on (Google, Apple, GitHub, Discord, in that order), a hairline "or", Email, Password with a Show button, and the main button. Sign in has "Forgot password?" by the password and "Email me a sign-in link" under the main button; sign up says "At least 8 characters."; each links to the other. Refusals are ink text beside a 2px rule, never a colour: a wrong email or password reads the same whichever was wrong; an unconfirmed email offers the confirmation link again; too many tries says to wait.

**Emails.** Sign-up, a reset and the sign-in link each answer "Check your email" with the address, Send it again and Use a different email. Sign-up and a reset answer the same for an address with or without an account, so the form never says who has one. Every link and provider lands on `/me`, which reads the session from the address and sends the player on: a reset link to `/reset-password` to choose a new password; anything else to the seed, card or page they were headed for, else the desk, which claims their guest contributions. A password sign-in goes the same places without leaving the page first.

**The function** (`community.mts`). New routes, all no-store: `GET auth/authorize?provider=&redirectTo=` (302 to Supabase Auth's provider sign-in, only for the four providers, only for one `auth/settings` names as on, and only back to this site; a provider that is off is refused with 403 `closed` before Supabase sees it, and 502 when the settings cannot be read), `POST auth/signup`, `auth/password`, `auth/recover`, `auth/resend`, `auth/new-password` (with the player's token, by PUT to Supabase), and `auth/signout`. `GET auth/settings` adds `providers`, the four providers' names that are on, and nothing else of the settings. A new password needs at least 8 characters and at most 72 bytes. Password sign-ins and sign-ups are limited to 10 an address each 10 minutes in an instance, beside the email limit that already held. An auth refusal carries a short code (`weak`, `wrong`, `unconfirmed`, `limit`, `closed`, `exists`, `same`, `signed-out`) the page turns into its own words.

## Acceptance criteria

- [ ] `/sign-in`, `/sign-up`, `/forgot-password` and `/reset-password` are in the route list and pass the design suite at every audited width.
- [ ] A password sign-in keeps the session and lands on the desk, or the page the player left (e2e `accounts.spec.ts`).
- [ ] Sign-up shows Check your email and posts the email, password and `/me` (e2e).
- [ ] A reset link lands on `/reset-password` and the new password is set with the reset session (e2e).
- [ ] A provider button shows only for a provider the settings name, and links to `auth/authorize` (e2e).
- [ ] The function refuses a short password, another origin, an unknown provider and a GET on a POST route, and maps Supabase's refusals to codes (`netlify/community.test.ts`).
- [ ] On production the live check finds `/sign-in` drawing the form, and a password sign-in for an address with no account refused 401 "wrong" by Supabase (`scripts/live-check.mjs`).
- [ ] On production, a new address signs up, confirms by the emailed link, signs out and signs in with its password.

## Verification

- `pnpm verify`
- `npx playwright test` in `platform/site`
- The live-check workflow's run for the merge commit: quote its first line.
- On production after the merge: sign up with a fresh address, open the confirmation email, sign in with the password, and quote the outcome.

## Evidence

Added when the status moves to built or done.

## Decisions

- 2026-10-19: Providers use Supabase's implicit flow through the community function's 302, so the session lands in the fragment as a magic link's does and the page still holds no Supabase client.
- 2026-10-19: Provider buttons draw the provider's mark in ink, like every other control, rather than its brand colours (docs/BRAND.md, Colour).
