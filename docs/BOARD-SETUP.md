# Board setup: everything that needs Kyle

Every step that only the board can take, in the order that gets the studio to Go live. Each one
says why it is needed, exactly what to do, how you know it worked, and what to tell me afterwards.

Sources: `docs/ROADMAP.md` (the launch checklist), `docs/PLAN.md` §10 (the decisions),
`platform/ops/README.md` (the runbook, with The Mac host at its end), `docs/specs/mac-host.md`, `docs/specs/money-safety.md`,
`docs/specs/board-site.md`, `.env.example`.

**Where you act.** The board has its own site (`docs/specs/board-site.md`); "/board" and "the
board's site" below both mean it. It opens on the **Needs you** inbox.

**Two rules.**

1. **Never paste a key, token, email address or ping URL into the chat.** They go in `.env`, in
   `.env.vps`, or in an `export` in a terminal. I can read `.env` and run commands; I can never type
   a secret for you.
2. **If a screen does not match these words,** the provider changed its UI. Tell me what you see
   rather than guessing, because I cannot tell from the result that the wrong thing was picked.

**How to reply.** Each step ends with a line in quotes. Sending me that line is all I need.

**Everything here is free.** None of it asks you to spend your own money: the studio runs on what
players put in (`docs/PLAN.md` §10 decision 35).

---

## Your steps, in order

This list is the launch plan's checklist (approved 23 September 2026), in four sections. It replaces
the step numbers used from 22 September 2026; the **Done** entries at the bottom keep the numbers
they were done under.

- **A. Blocks me from finishing.** Do these first, in order.
- **B. Needed before the announcement.** They don't block the build.
- **C. The launch sequence.** Run in order once A and B are done.
- **D. Open topics.** Nothing waits on them.
- **Rename to Mob Machine.** Its own short list, just below. Nothing in A to D waits on it.

Where something below is already done, it says so and points at **Done**. On 23 September 2026 the
host moved from Oracle to your Mac (`docs/PLAN.md` §10 decision 38), so the Oracle account and its
sign-in are gone from this list, and the backup key is part of the Mac's step.

---

## Rename to Mob Machine

**Why.** You renamed the studio Mob Machine on 23 September 2026 (`docs/PLAN.md` §10 decision 43),
with a new mark in place of the peanut: a small machine with two eyes, drawn in code
(`docs/specs/machine-mark.md`). Once the rename pull request is merged and deployed, the site, the
link preview, the icons, the game's tab, the agents and the alerts all say Mob Machine, and the
Terms say it from version 3, which I post after the deploy. The steps below are the places only you
can change. There is no new domain yet: the site stays at peanutgallery.games, so R1 to R4 are for
now, R5 is registering one when you choose, and R6 follows it (`docs/specs/rename.md`).

The icon file for Stripe and Discord is `platform/site/public/icon-512.png` in the repository, also
at https://peanutgallery.games/icon-512.png once the rename is deployed: the white machine on black,
512 by 512, with room around it for a round crop.

### R1. Stripe (10 minutes, free), after the rename is deployed

1. Stripe Dashboard → Settings (the gear, top right) → **Business** → **Public details**.
   - **Public business name:** `Mob Machine`.
   - **Statement descriptor:** `MOB MACHINE`. If a **Shortened descriptor** is set, `MOBMACHINE`.
   - Save. Expected: the fields read back the new values; new card statements say MOB MACHINE.
2. Settings → **Business** → **Branding**: **Icon** → upload `icon-512.png` → Save. Expected: the
   preview of the checkout page shows the machine.
3. **Product catalog** → the product the Payment Link sells → **Edit product**. If its name or
   description still carries the old studio name, change it to Mob Machine and save. Expected:
   opening the Payment Link (the Contribute button on the site) shows the new words at checkout.
4. Leave the Payment Link's after-payment redirect as it is: it changes with the domain (R6).

**Tell me:** "Stripe says Mob Machine."

### R2. Discord (5 minutes, free)

1. In the Discord app, click the server's name at the top left → **Server Settings** → **Server
   Profile** (**Overview** in older versions).
2. **Name:** `Mob Machine`. **Icon:** Change or Upload Image → `icon-512.png` → Apply.
3. **Save Changes.** Expected: the server list shows the white machine, and the invite on the site
   (the Discord link in the menu) still opens the server under its new name: an invite survives a
   rename, so nothing in the repository changes.

**Tell me:** "Discord is renamed."

### R3. The hello@clayhouse.studio signature (2 minutes)

In the mail app that sends as hello@clayhouse.studio, open the signature settings (in Gmail: the
gear → **See all settings** → **General** → **Signature**) and change the old studio name to Mob
Machine. The address itself stays (`docs/PLAN.md` §10 decision 37). Expected: a test mail to yourself ends
with the new name.

**Tell me:** "The signature says Mob Machine."

### R4. The sign-in email's sender name (nothing to click now)

The board's sign-in email comes from Supabase through Resend (step 2). When I connect it, the sender
name is Mob Machine, not the old name the board-site spec was written with. The Site URL and the
redirect list stay the board's own site's address, which has nothing to do with the public domain,
so a new domain does not touch them. Expected: the next sign-in link you get says it is from Mob
Machine. Your authenticator app keeps the old label on the second factor you already enrolled; that
is only a label.

**Tell me:** nothing, unless the sign-in email still shows the old name.

### R5. Register the new domain (when you choose; not free)

A domain costs money, so it is your call and your timing: from a payout's studio share, or an
exception you name to decision 35. Nothing waits on it; the site works at peanutgallery.games.

1. Register the domain at the registrar you use for peanutgallery.games (GoDaddy).
2. Keep peanutgallery.games registered and on auto-renew: old links, shared previews, search results
   and the address on the agents' commits keep reaching the studio.

**Tell me:** "The domain is <name>." Then I open the domain's pull request: the script's domain
pass, the 301 from peanutgallery.games to the new domain, the game's link, the preview image and the
live check, with `pnpm verify` switched to checking the domain too.

### R6. The domain on Netlify and Stripe (15 minutes, free), once I say its pull request is ready

1. app.netlify.com → the site **peanutgallerygames** → **Domain management** → **Add a domain** →
   type the new domain → **Verify** → **Add domain**. Add `www.` the same way.
2. At the registrar, add the DNS records Netlify lists beside the new domain. Wait until Netlify
   stops showing "Pending DNS verification".
3. Beside the new domain: **Options** → **Set as primary domain**. Keep peanutgallery.games in the
   list as an alias; the 301 needs it there.
4. **HTTPS** → **Verify DNS configuration**, then wait for "Your site has HTTPS enabled".
   Expected: https://<new domain> opens the site with a padlock.
5. Stripe → Payment Links → the link → **After payment**: the redirect URL's
   https://peanutgallery.games becomes https://<new domain>, the rest unchanged.

**Tell me:** "The domain is live on Netlify." I then merge the domain's pull request and run the
live check against the new address.

### Handles

When the Twitch channel in the backlog is made, take it under Mob Machine and tell me the handle, so
it goes in the repository.

### What I do after the merge, each with your allow

Done on 23 September 2026, after the merge: Terms version 3 is posted and /terms shows
"Version 3, in force since"; the one card whose public text still carried the old name is fixed,
with a dump first; the Stripe webhook is redeployed with its new alert title; the live check passes.
`docs/specs/rename.md` has the evidence.

Still open: `managed:apply` for the agent's new description. It failed with "Your credit balance is
too low to access the Anthropic API": the studio's Anthropic organisation has no credit yet, which
is bought only from a payout (step 22). It runs after that, with its new version put in the Mac
host's env file once the host is installed (step 3), and before the dispatcher next runs unattended.
Nothing for you to do beyond steps 3 and 22.

---

## A. Blocks me from finishing

### 1. Contact email: DONE 23 September 2026

The public contact address is hello@clayhouse.studio, the board's own mailbox (`docs/PLAN.md` §10
decision 37). The site, the legal pages and Stripe's public details use it. Nothing to set up.

### 2. Board sign-in email (15 minutes, free)

**Why.** The board now signs in on its own site (`docs/specs/board-site.md`). Supabase's built-in
mail only reaches members of the Supabase project team, at most 2 an hour, so the moderator could
not get a sign-in link at all, and two failed requests during an incident would lock you out of
Pause for an hour. Resend's free plan sends it instead.

**Do this.**

1. Sign up at resend.com on the free plan with your own email.
2. Add a domain and give it the sending subdomain of peanutgallery.games that Resend suggests. Add
   the DNS records it shows (SPF and DKIM, and the MX it asks for on that subdomain) in GoDaddy →
   the domain → DNS, and wait until Resend shows the domain verified.
3. Create an SMTP key (an API key with sending access) and put it in `.env` at the repository root
   as `RESEND_SMTP_KEY=…`. Never paste it in chat.

Then I point Supabase Auth's email at Resend (custom SMTP) with a sender on that subdomain named Mob
Machine (**Rename to Mob Machine**, R4), and send
you a sign-in link to check it arrives.

**Unblocks:** the moderator's sign-in, and a Pause that can't be rate-limited.

**Tell me:** "Resend is verified and the key is in .env."

### 3. The Mac as the studio's host (30 minutes, free)

**Why.** Live criterion 2 is the dispatcher running unattended. Oracle is dropped and no card goes on
file for a cloud server, so until the studio has one the dispatcher and the daily jobs (the backup,
the Controller and the quota check) run on this Mac under launchd, from a folder of their own,
`~/peanutgallery-host` (`docs/PLAN.md` §10 decision 38, `docs/specs/mac-host.md`). A free Google
Cloud server is the planned later home, once you open a billing account (see **Open decisions**).

**Do this.**

1. **Power.** Keep the Mac plugged in and the lid open whenever the studio runs: the dispatcher holds
   the Mac awake on power, but closing the lid sleeps it anyway. In System Settings → Battery →
   Options, turn on **Prevent automatic sleeping on power adapter when the display is off**. The
   screen may still sleep.
2. **No surprise restarts.** System Settings → General → Software Update → Automatic updates: turn
   off installing macOS updates, and install them yourself while the studio is paused. With
   FileVault on, a restart or a power cut waits at the login screen and nothing runs until you log
   in; healthchecks.io emails you when that happens.
3. **Two tools.** In the Terminal tab: `brew install libpq age`. libpq brings the database dump
   tools the backup uses; age encrypts the backups.
4. **The backup folder.** Install Google Drive for desktop and sign in with your Google account.
   In My Drive, create a folder `peanutgallery-backups`. Drive copies each nightly backup off the
   Mac. Tell me when it exists; I find its full path and put it in `.env` as `BACKUP_DIR=`.
5. **The backup key.** Made on 23 September 2026 (see **Done**): its public half is in `.env` as
   `BACKUP_AGE_RECIPIENT`. The private file, `~/peanutgallery-backup.key`, is the only thing that
   can open a backup. Copy it to a USB stick you keep apart and into your password manager, then
   delete it from the Mac. It never goes in chat, in the repository or on the host. You bring it
   back once, for the restore drill (step 19).
6. **A second healthchecks.io check,** `peanutgallery backup`, **period 1 day**, **grace 12 hours**
   (the Mac makes a missed night up at its next wake). Add its ping URL to `.env.vps` as
   `BACKUP_HEALTHCHECK_URL=`.

Then I write the host's env files (they print key names only), run `platform/ops/mac/install.sh`
twice (the second run must print `install: done: 0 change(s)`), and quote the first backup and the
jobs' first runs. The dispatcher is installed but not started: starting it is the cutover (step 23).
The backup login's password and `STRIPE_READ_KEY` are production steps I ask your allow for
(`docs/specs/money-safety.md`); the backup and the Controller wait on them.

**Tell me:** "the Mac is ready."

### 4. Stripe read-only key (10 minutes, free)

**Why.** The Controller reconciles the books with Stripe every day and computes the Console credit
to buy and the Minimum balance figure; the live check reads back the Payment Link's settings. Those
are its only Stripe reads. The key can't move money.

1. In Stripe, go to Developers → API keys → **Create restricted key**, and name it
   `peanutgallery-reconcile`.
2. Give it **Read** on: Balance, Balance transactions (Stripe may list it as "Balance transaction
   sources"), Payouts, Charges and Refunds (one line on some screens), Checkout Sessions, Payment
   Links, Events and Disputes. Nothing else, and no Write anywhere.
3. Put it in `.env` as `STRIPE_READ_KEY=…`.

Until this key exists the Controller does not run, so /ledger says "Not yet reconciled with
Stripe." under Money in until the Controller's first reconcile passes, and a dispute fee Stripe
charges is not booked until its first run (`docs/specs/money-logic.md`,
`docs/specs/money-surfaces.md`).

Before either job first runs, I tell you exactly what each one reads. The host's env check refuses
`STRIPE_READ_KEY` unless it starts with `rk_live_`, and refuses any value starting `sk_live_` or
`sk_test_` under any name.

**Tell me:** "Stripe read key is in .env."

### 5. Three fine-grained GitHub tokens (15 minutes, free)

**Why.** How the dispatcher's host, the agent sessions and your Mac reach the repository with no more access
than they need (`docs/PLAN.md` §10 decision 30). Each is for the peanutgallery repository only, and
all three must be different. No API creates one, but GitHub takes the settings in a link, so each
link below fills in the name, the owner AlreadyKyle, a 366-day expiry and the repository permissions.
For each one:

- the one thing to choose by hand is Repository access → **Only select repositories** →
  `peanutgallery`;
- check the permissions list shows exactly what is written here (GitHub adds Metadata read on its
  own) and **no Workflows**;
- the token is shown once; copy it straight into the file named, never into chat.

1. **The host's token** (the unattended dispatcher, on your Mac for now and later on a server):
   Contents read and write, Pull requests read and write, Actions read-only, Metadata read, and under
   **Account permissions, Plan read** (for the Actions-minutes guard). No Workflows. GitHub offers
   these tokens no Checks permission and ignores `checks` in the link, so the dispatcher reads the
   gate's result through the Actions API (`docs/PLAN.md` §10 decision 30). If the list does not show
   Actions and Plan as read-only, add them by hand (+ Add permissions); an existing token keeps its
   value when you edit it. GitHub may also ignore the link's expiry; check the date it shows.

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-vps&description=Mob+Machine+VPS+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&actions=read

   Add a line `VPS_GITHUB_TOKEN=` followed by it to `.env.vps`. **Set on 23 September 2026** (see
   **Done**); if it lacks Plan read, edit it and add it.
2. **The read token** (it mounts the repository into each Managed Agents session): Contents read
   only.

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-read&description=Mob+Machine+agent+sessions,+read+only&target_name=AlreadyKyle&expires_in=366&contents=read

   Add a line `GITHUB_READ_TOKEN=` followed by it to `.env.vps`. **Set on 23 September 2026.**
   Before the cutover I prove it cannot write: a push with it must answer 403, and the unattended
   startup refuses to run otherwise.
3. **The Mac's token** (attended runs on your Mac): the same permissions as the host's token, Actions
   read and Plan read included. **Still to do.**

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-mac&description=Mob+Machine+Mac+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&actions=read

   In `.env` at the repository root, replace the value of `GITHUB_TOKEN` with it. Today that value
   is the gh command-line tool's own sign-in token (it starts `gho_`), which reaches every
   repository on your account and has no Workflows limit. You can keep the gh sign-in for your own
   use; it just must not be the value in `.env`. Unattended mode refuses a token that is not
   fine-grained, and attended mode warns about one.

**Unblocks:** unattended mode and the cutover.

**Tell me:** "the Mac token is set."

### 6. healthchecks.io (5 minutes, free)

**Why.** Once the dispatcher and the daily jobs run unattended, this is how you hear that one stopped.

The account and the `peanutgallery dispatcher` check (period 1 minute, grace 5 minutes) are made:
`HEALTHCHECK_URL` is in `.env.vps` (see **Done**). The `peanutgallery backup` check is part of step 3.
Under notification methods, confirm your email gets both checks.

**Unblocks:** alerts that can't fail silently.

**Tell me:** "both checks email me."

### 7. Discord webhooks (10 minutes, free)

**Why.** Ship posts and the weekly report go to Discord through webhooks, posted by code only. The
code is built (`docs/specs/studio-reports.md`) and inert until the addresses are set: with neither
key in `.env` the dispatcher makes no request to Discord. A webhook address lets anyone who holds it
post to the channel, so it goes in `.env` on the dispatcher's host only, never on Netlify, and nothing
prints it.

1. In your server's settings, go to Integrations → Webhooks and create one for a read-only `#ships`
   channel and one for `#weekly`.
2. Put the URLs in `.env` as `DISCORD_WEBHOOK_SHIPS=…` and `DISCORD_WEBHOOK_WEEKLY=…`. The dispatcher
   refuses to start with a value that is not a Discord webhook address, naming the key only.
3. Turn on AutoMod (Settings → Safety Setup).
4. Restart the attended dispatcher so it reads them. At the cutover, `make-dispatcher-env.sh` and
   `install.sh` carry them to the Mac host.

A card that went live more than 6 hours before the lane is switched on is never posted, and only the
newest weekly report is, so switching it on does not flood the channels. A report is posted only
during the week after its own: once the next New York week has ended it is recorded as stale and never
posted, so switching the lane on, or resuming after a long pause, never announces an old week. The
post names its week ("The week of 14 September at Mob Machine: …").

**Unblocks:** ship posts and the weekly report. The first ship post needs a running dispatcher.

**Tell me:** "Discord webhooks are in .env."

### 8. Netlify plan check (2 minutes)

Open Netlify → Team settings → Billing and tell me whether it says **legacy Free** or
**credit-based Free**. Don't switch plans. The board's own site is a second free site on the same
team, so this also tells me how its builds count.

**Unblocks:** the scale and deploy settings.

**Tell me:** "legacy Free" or "credit-based Free".

**The function budget** (`docs/specs/site-snapshot.md`). The public site now reads its figures from
one Netlify Function, which the CDN caches, so it builds its documents at most about 52,000 times a
month however many people read the site (the table in `docs/PLAN.md` Appendix A, "Public site
function budget"), of legacy Free's 125,000 invocations. Answers the CDN does not keep still cost one
invocation each: a failed read of the database (a 502 while Supabase is down or slow), a request
with a query string (400), another method (405) or an unknown path (404). During a long Supabase
outage every open tab's retry is such an invocation (at most one a minute per tab, backing off to one
every ten minutes), so the usage notifications below are the alert for that case. Stay on legacy
Free. While you are on that page:

- Confirm Netlify's **usage notifications** go to your address. They are the only alert that the
  sites are close to a limit.
- At 100% of any limit Netlify pauses **every** site on the team until the next cycle, the board's
  site and its Pause included. Money keeps moving (Stripe, the webhook and the dispatcher use no
  Netlify Function); **Pause when the board site is down** below is how you pause the agents then.
  Restoring the sites before the cycle ends needs a payment method and a paid plan: your call.
- Optional: a second free Netlify team for the board's site alone, so an overrun on the public site
  cannot take the board's Pause with it.

### 9. ntfy (5 minutes, free)

**Why.** The topic exists and the Stripe webhook already posts to it (see **Done**), but your phone
is not subscribed yet, so an unattended failure would not reach you.

1. Install the free **ntfy** app (App Store or Play Store).
2. In the app: **+** → paste the topic name → Subscribe, leaving the server as ntfy.sh. If the
   topic name is not on your clipboard, `grep NTFY .env.vps | cut -d/ -f4 | tr -d '\n' | pbcopy` in
   the Terminal tab puts it there. Anyone who knows the topic can read and post your alerts, so it
   stays out of chat.
3. Tell me, and I post a test so you see it arrive. The cutover repeats that test from the host.

**Unblocks:** phone alerts.

**Tell me:** "subscribed to ntfy", then "the test alert arrived."

### 10. Business contact for the Terms (no longer blocks)

The legal-copy pull request shipped the Terms with your name, Kyle Smith, an individual in
Ontario, and hello@clayhouse.studio, and no mailing address or phone, since none was given and none
is invented (`docs/specs/legal-copy.md`). Ontario's rules for an internet agreement over $50 expect
the supplier's address and phone as well. If a contribution over $50 counts as a consumer internet
agreement, a supporter not given every required disclosure may cancel within 7 days, or within 30
days when no copy of the agreement was delivered within 15 days. The full refund within 14 days
covers most of that; the lawyer question in **D** settles whether the Act applies at all.

Send me an address and phone to publish (they will be public, so chat is fine) and a later board
pull request adds them as a new Terms version.

**Unblocks:** nothing waits on it.

**Tell me:** the address and phone to publish, or "leave it out".

### 11. Pin Claude Code (2 minutes, free; nothing waits on it)

The agent-upkeep pull request (`docs/specs/agent-upkeep.md`) pins Claude Code at 2.1.283, the
version the Mac updated itself to, on which the attended sandbox check passed in both layouts on
26 September 2026. Attended sessions now run only on the pinned version: on any other, a card pauses
with `cli_version` and a role job fails, and the daily check lists it in Needs you. Until you run
this, Claude Code keeps updating itself, and each update pauses attended sessions until I run the
sandbox check on the new version and move the pin in a pull request you merge.

In Terminal on the Mac:

```sh
cd ~/GitHub/peanutgallery && sudo bash platform/ops/mac/pin-claude-code.sh
```

Enter your Mac password. It checks that `claude --version` is the pinned version, then turns Claude
Code's auto-updater off in `/Library/Application Support/ClaudeCode/managed-settings.json`, keeping
anything else in that file, and prints `PASS: claude-code pinned 2.1.283`. If it prints a FAIL line
saying another version is installed, send me the line: I check the new version and move the pin
first.

**Unblocks:** attended builds that stay on a checked version.

**Tell me:** "Claude Code is pinned", with the PASS line.

---

## B. Needed before the announcement (they don't block the build)

### 12. Stripe settings, in the Stripe Dashboard

No agent touches Stripe; these are yours.

- **Business description.** Check that Settings → Business details describes the model accurately.
  Email Stripe support describing it ("supporters fund specific development tasks on an AI-built
  free game; no rewards") and ask whether a restricted category applies. Keep their reply. If they
  say it needs approval, tell me before anything else; otherwise nothing waits for a written OK.
- **Minimum balance.** Settings → Payouts → Minimum balance. Turn it on. It holds a fixed amount,
  which you raise after each payout to the figure the board site's Needs you inbox shows (the
  reserve plus held money plus typical fees, computed by the Controller). The Controller alerts if
  Stripe's balance falls below it.
- **Minimum amount.** Stays $1, your call on 23 September 2026. Leave Radar on its default:
  card-testing protection is already on, and custom rules would charge a fee on every payment.
- **Public details: done 23 September 2026.** Support email hello@clayhouse.studio (`docs/PLAN.md`
  §10 decision 37), plus the terms and privacy URLs.
- **Display name field: done 23 September 2026.** The Payment Link's "Public display name" custom
  field is removed. The webhook no longer reads the field either (`docs/specs/legal-copy.md`).
- **Terms checkbox.** Payment Link → Options: turn on "Require customers to accept your terms of
  service"; it links the terms URL already in your public details. The site already states the agreement
  before every checkout; this adds express acceptance. If Stripe will not add it to the existing
  link, make a new link with the same settings and send me its address; a board pull request swaps
  it into `netlify.toml`.
- **Adaptive Pricing off.** Settings → Payments → Adaptive Pricing: confirm it is off. With it on, a
  payer could check out in their own currency, and the webhook refuses any currency but US dollars,
  so the payment would be charged and not credited. No agent may read Stripe to check this, so it
  is yours.
- **Your test payment.** Refund your own $1 test payment (Payments → the $1.00 payment of
  15 September 2026 → Refund), before the cutover. Until then it is booked apart
  (`docs/specs/money-logic.md`): it funds no card and sits in no "Not on a card yet" money, gets no
  supporter number, is in no money-in figure on the site, and is left out of the agent money a
  Console credit purchase may use. Until it is refunded, /ledger's Funding band says in one line
  "The pool includes $0.50 of the board's own test payment; it funds no card." ($0.50 is the part of
  your $1.00 that is agent credit in the pool; the rest is Stripe's fee and the reserve's, the
  studio's and the emergency fund's shares); the line goes after the refund
  (`docs/specs/money-surfaces.md`). The fee Stripe keeps on the refund ($0.2662) is booked to the
  studio share automatically; there is nothing to record by hand.
- **After-payment redirect.** Payment Link → After payment: redirect customers to
  `https://peanutgallery.games/thanks?session={CHECKOUT_SESSION_ID}`. Ready once I tell you /thanks
  is live (`docs/specs/supporter-pages.md`); until then Stripe shows its own receipt page, and
  /thanks works for anyone who opens it with a session id. After it is set, the next real payment
  lands on /thanks with its supporter number and the cards it reached; tell me and I quote it in the
  spec's Evidence.

**Tell me:** "Stripe settings done", and Stripe's reply on the category when it comes.

### 13. Retire the full Stripe secret key

Once I move the stripe-webhook function onto the restricted key, roll the secret key in Stripe
(Developers → API keys → Roll key). I then remove `STRIPE_SECRET_KEY` from `.env` and the function
secrets. After that, no key on your Mac, the host or Supabase can refund, charge or pay out, and
changing webhook endpoints becomes a Dashboard step of yours.

**Tell me:** "secret key rolled."

### 14. Review the new Terms, Privacy and Refunds pages

The legal-copy pull request posted Terms version 2: the refund policy, who may contribute, US
dollars, a card that is not built, winding down, no cryptocurrency and the change rule, plus a new
Privacy sentence (the studio stores no name). Read /terms, /refunds and /privacy yourself, as you
did on 20 September 2026 (see **Done**). A change is a new version, never an edit to a posted one.
Nothing waits on this.

**Tell me:** "legal pages are fine", or what to change.

### 15. Passkeys or hardware keys

Turn on passkeys or a hardware key on Stripe, GitHub, Supabase, Netlify, the studio's Anthropic
organisation, Google, GoDaddy, Resend and Discord, and remove SMS as a recovery
method on each. Where a service offers no passkey, turn on authenticator-app two-step instead, or
sign in to it only through Google or GitHub.

**Tell me:** "passkeys are on."

### 16. Name a moderator

**Why.** A second person who can pause the studio (and hold the kill switch once the stream exists).

1. Add a line `MODERATOR_EMAIL=` with their address to `.env` yourself, never in chat.
2. I re-run the seed (`pnpm --filter @backseat/supabase seed`, safe to run again). It writes their
   `board_members` row and then creates their Supabase Auth user, since sign-ups are off and a
   sign-in link never creates one. I quote its lines with the address redacted.
3. They sign in on the board's site by magic link, which also proves the sign-in email works for
   someone outside the Supabase team. They see the pause control only.
4. In Discord, give them a moderator role (Server Settings → Roles).

They then have pause-only access and Discord moderation.

**Tell me:** "moderator email is in .env."

### 17. Sign in once on the board's own site

The board has moved to its own site (`docs/specs/board-site.md`): a separate free Netlify site at
its own `netlify.app` address, which I give you once it is created. Bookmark it; nothing on the
public site links to it, and peanutgallery.games/board is now a plain not found page. Everyone is
signed out at the switch. Sign in there by magic link; your authenticator app carries over, so enter
its code as before. The first thing you see is the **Needs you** inbox, which is usually empty.

**Tell me:** "signed in on the board site."

### 18. Studio daily credit limit

Keep $500, or set the number the scale pull request proposes, in the Caps form on the board's site
(second factor). Besides the $50 a day of immediate agent credit per payer, all payers together get
at most this much immediate agent credit per New York day, and credit above it is held 14 days. The
same form now takes the usage tier cap (step 22).

**Tell me:** "keep $500", or the number you set.

---

## C. The launch sequence

Run it in this order, once A and B are done, the money-safety, legal-copy, money-logic and
supporter-loop pull requests are live, and the launch cards are open to fund.

### 19. Restore drill (once, about 10 minutes)

Bring the offline backup key (step 3). I decrypt one stored backup taken after the money-logic
migration is live on your Mac with it, restore it by the runbook (`platform/ops/README.md`, Restore a
Mac backup, `after-restore.sql` included) and quote the ledger identity and the pg_cron jobs on it.
Then the key goes back offline and the decrypted copy is deleted.

**Tell me:** "ready for the restore drill."

### 20. The first player arrives

**Your call.** Contributions are already open: the Contribute button is live, and Go live only stamps
the launch time. The money-first order (`docs/PLAN.md` §10 decision 23) needs a player's contribution
and a Stripe payout before the cutover, and your own money never counts. Nothing tells anyone the
site exists yet, so someone has to.

- **(a) Share it quietly before Go live. My recommendation**, as your original plan did. Share it
  through the Discord server the site already links, your own posts, or an invite to people you
  name. The site says the agents are paused until the studio resumes them. The formal announcement
  still waits for the clip and Go live.
- **(b) Go live and announce first**, with the studio still paused. The cost: the studio is announced
  when it cannot build anything until the payout clears, credit is bought and the cutover is done.

The studio stays paused either way.

**Tell me:** "share quietly" or "announce first", then "shared".

### 21. First payout

In Stripe → Balances, confirm payouts are on and the bank account is verified. Then wait for the
first payout that includes a player's money. The new-account delay started with your test payment on
15 September 2026, so it may already have run. Plan for the first payout taking 7 to 14 days.

**Tell me:** "payouts are on", and later "the first payout arrived".

### 22. Buy Console credit, after this payout and after every payout from now on

**Why.** Unattended cards bill the studio organisation's key, not your Max subscription. Console
credit is bought only from money Stripe has paid out (decision 23), never with your own.

**How much.** The Controller computes it every day with one formula, and the board site's **Needs
you** inbox shows it as soon as a payout leaves agent money that is not credit yet: the remaining
ceilings of funded cards, plus overhead spent since the last purchase, less the credit left, and
never more than the agent money Stripe has paid out and not yet converted, plus that overhead. The
reserve, the emergency fund and held money are never in it. Fees, currency conversion and HST on the
purchase come from the studio share.

**Do this,** from the inbox's credit item:

1. console.anthropic.com → sign in → switch to the **studio** organisation (the one
   `STUDIO_ANTHROPIC_API_KEY` belongs to, never your personal one). If you are unsure which it is,
   open Settings → API keys in each organisation and find the key whose prefix matches the one in
   `.env`; I can print you the first few characters safely if you ask.
2. **Billing** → buy prepaid credit for the amount the inbox shows. If it is below the Console's
   minimum purchase, wait for the next payout; never add your own money.
3. Keep **auto-reload off**, and set the Console's monthly spend limit to the monthly cap the
   board's site shows.
4. On the board's site, press **Fill in the record form** in the inbox (second factor). It fills in
   the amount, the Stripe payout id and a reason from the Controller's figure. Change the amount to
   the one on the Console receipt if it differs, then **Record purchase**. The dispatcher never lets
   unattended sessions spend more than the credit recorded.
5. Tell me the tier the Console's **Limits** page shows. Its monthly limit goes in the Caps form as
   the usage tier cap.
6. In the same visit, raise Stripe's **Minimum balance** (Settings → Payouts) to the figure the inbox
   shows.

Repeat after every payout. Console credit lags the pool, so a card can wait for credit while the
pool shows money; the dispatcher then pauses the studio and alerts "Console credit needed", and the
next payout's purchase clears it.

**Tell me:** "credit bought and recorded", and the tier.

### 23. Cutover and soak (about twenty minutes with me, then a day)

I prompt you at each point. Only one dispatcher ever runs: the dispatcher lease guarantees it, and
from here the attended dispatcher is not started while the host runs. The runbook is
`platform/ops/README.md`, The Mac host.

1. You: **Pause** on the board's site.
2. Me: stop the attended dispatcher and confirm no dispatcher process is left.
3. Me: create or update the managed agent and environment with the studio key and quote their ids;
   write the host's env file with `platform/ops/make-dispatcher-env.sh` (key names only) and run
   `platform/ops/mac/install.sh` twice. The second run must print `install: done: 0 change(s)`.
4. You: set the agent mode to **unattended** on the board's site (second factor).
5. Me: the toolchain check from the host's code clone, quoting `PASS: toolchain`.
6. Me: `platform/ops/mac/install.sh --start`, which starts the dispatcher under launchd and waits
   for its `startup probe passed` line; I quote it. The probe is a small Managed Agents session,
   billed as overhead from the studio share.
7. You: confirm the board's site shows the dispatcher seen under 3 minutes ago, and healthchecks.io is green.
8. Me: post a test alert to ntfy from the host. You: confirm it arrived on your phone.
9. You: **Resume**.
10. Me: a restart test (`launchctl kickstart -k`), a kill test (the dispatcher killed outright comes
    back on its own after 30 seconds), and then you log out and back in, or restart and log in: it
    comes back with no command. Then I stop it and we wait out the grace so healthchecks emails you,
    which proves the alert path. I start it again.
11. A 24-hour soak with the lid open, no restart loop and no unexpected alert. I quote the results.

Then the first player-funded card builds with nobody at the keyboard, billed to the studio, which
closes live criterion 2.

**Tell me:** "ready for the cutover".

### 24. Go live

The first player-funded card ships, and its /card replay is the launch clip. You press **Go live**
on the board's site; it works once and cannot be undone. Then you edit my drafts in `docs/launch/`
so they sound like you, and post them in the order in `docs/specs/announcement.md`. The posting is
yours.

**Tell me:** "gone live".

---

## D. Open topics (no blockers)

- **Cooling window, role pauses and vetoes (optional).** The agent-system pull request
  (`docs/specs/agent-system-core.md`) ships the cooling window at 0, so an approved agent card moves
  to now on the next dispatcher tick. If you want time to look first, set it on the board's site
  (Cooling window, second factor, up to 10,080 minutes). You can also pause a role or veto a card
  there. There is no operations percentage: no role job spends studio money, and model role jobs run
  only when you start them from the board's site while you are signed in there. Nothing waits on you.
- **Rank now and Draft a game card (optional, when you want them).** The agent-workflows pull
  request (`docs/specs/agent-workflows.md`) adds both to the Jobs list on the board's site, at the
  second factor. Each runs only while you are signed in there, on your Max plan, billed to you on the
  ledger, never from supporters' or studio money. The first real Draft a game card run is
  launch-card-floor's drafting session: be signed in at /board for it. A drafted card waits out the
  cooling window before it is dealt to now; you can veto it there as with any card.
- **The visual review (nothing to do now).** The design-review pull request
  (`docs/specs/design-review.md`) makes the files that set the look yours: the tokens, the Card, the
  glyphs, motion, the route list, the site's public and brand files and the game's favicon change
  only by a pull request you merge, so a new page or screen is yours too. When a card's change draws
  a page or the game differently, its gate draws before and after frames and a Director reviews them
  once its gate is green, only while you are signed in at /board, on your Max plan, billed to you on
  the ledger: be signed in when a visual card's gate turns green, or it waits at gated with its money
  on its bar. The first seed-1 card that changes `seed-1/render/` after launch is the first live
  review. The gate's `frames` job runs only on GitHub Actions, so it waits on Actions minutes (see
  **GitHub Actions minutes**); the local gate cannot run it.
- **The copy pass (nothing to do now).** The copy-pass pull request (`docs/specs/copy-pass.md`)
  changes the pitch to "Watch AI agents build a game studio and its free game, Dust.", names you on
  /how-it-works and at the foot of /team as the human board with your standing duties, and marks
  every `docs/BACKLOG.md` entry `board: yes` or `board: no`. Every entry today is board work (each
  lands in kernel paths), so each /roadmap band shows them open under "Board work on how the studio
  runs (not funded by cards)" and a line saying no card for players or the studio is there yet; once
  such a card is planned, board work folds into a closed disclosure beside it. To override any
  wording, or any entry's marker, edit that one line in a pull request; after a marker change, run
  `pnpm --filter @backseat/supabase file-backlog` as a dry run, then with `--apply`. The Terms' Ontario address and phone stay legal-copy's item.
  The /thanks button now reads "Follow the studio on Discord": it promises no ship posts, which
  start only once you set `DISCORD_WEBHOOK_SHIPS` (above).
- **Paid advice, your call.** Paid from the first payout's studio share, or through an exception you
  name to decision 35: one Canadian lawyer session on the new pages, one accountant session on the
  HST threshold and income tax on the pool, and Ontario business-name registration for "Mob
  Machine" ($60). I book nothing. The lawyer's questions on the legal pages
  (`docs/specs/legal-copy.md`): whether a contribution is a consumer internet agreement under the
  Consumer Protection Act, 2002; whether the Consumer Protection Act, 2023 is in force yet; whether
  a copy of the agreement must be delivered within 15 days, and how; and the wording of the age
  condition, the refund fallback when Stripe cannot refund, and the wind-down rule.
- **Kill-condition pivots.** "Keep the pivots", or the ones you want for a site-first studio (see
  **Open decisions**).
- **A Google Cloud billing account,** whenever you choose, to move the dispatcher off your Mac (see
  **Open decisions**).
- **Delete `KEYS.md`** from the repository folder on your Mac (see **Standing items**).
- **HST registration review** when cumulative receipts reach $15k (see **Standing items**).
- **Record the trademark search** for "Mob Machine".
- **Later, only if limits bite:** move the sites to Cloudflare Pages before Mid; Supabase Pro at
  about 400 MB; grow the Anthropic tier. Actions minutes have already run short: see **GitHub
  Actions minutes** under **Standing items**.
- **Dreaming research-preview access,** only when memory comes back on the roadmap.
- **The Janitor and dependency updates (nothing to do now).** The agent-upkeep pull request
  (`docs/specs/agent-upkeep.md`) adds a daily drift check, whose findings show in Needs you under
  Findings and reach ntfy once each, and Dependabot. Four things to know, none blocking:
  1. The weekly scan (`janitor.yml`, osv-scanner and an offline link check) runs on Actions
     minutes, so its first run waits for Actions (see **GitHub Actions minutes**). Until it has run,
     the daily check has no scan result to list.
  2. Dependabot opens its pull requests on GitHub's own runners, which may use Actions minutes too.
     A patch update merges by itself only on a green gate at its head, so while Actions is off every
     Dependabot pull request waits for you, like any other non-card pull request. Merging one
     yourself, or closing it, is your call; nothing waits on it.
  3. Only if the first Dependabot run cannot read pnpm 11's lockfile (I will quote its log): decide
     whether to install the free Renovate GitHub app. It grants repository permissions, so it is
     yours to decide, and a pull request adds its settings then. Doing nothing leaves dependency
     updates to your merges, and the weekly osv-scanner still reports vulnerabilities.
  4. Optional: GitHub → the repository → **Settings** → **General** → tick **Automatically delete
     head branches**, so merged card and Dependabot branches are removed.
- **The first replay eval run (optional, at the Mac, on your Max plan).** The replay
  eval set (`platform/agents/evals/`) checks a change to a role prompt, rubric, agent definition or
  schema against what the roles did before. It has no result or baseline yet: at k = 3 its run is 30 to 42
  Game Director and Game Designer sessions on Opus, so I did not run it on your plan without you. Until it runs, the gate refuses any pull request that changes those files; nothing in the
  launch series changes them. When you want it, at the Mac:

  ```sh
  cd ~/GitHub/peanutgallery && pnpm eval:replay -- --set draft --k 3
  ```

  Then I open a pull request with its result and `baseline.json` set from it, with the reason, for
  you to merge.

---

## Your standing duties

These are the only standing actions left with the board, the ones the money rule and the kernel
force. Each shows in the board site's **Needs you** inbox when it is due; the inbox is usually empty.
If you do none of them, the studio pauses or stays as it is. Nothing else waits on you.

- **After each payout:** buy Console credit and raise Stripe's Minimum balance (step 22). The inbox
  lists it once a payout leaves agent money that is not credit yet.
- **Refunds** asked for at hello@clayhouse.studio: refund each one in Stripe within 14 days of the
  contribution. A standing line in the inbox; no script refunds.
- **Disputes:** answer each in Stripe before its due date. The Controller alerts, and the inbox lists
  each one with its date.
- **The emergency fund:** convert its credit when an S1 card needs it. The inbox lists S1 cards that
  may draw on it.
- **A card the resume rule will not resume:** one paused at its ceiling at the card maximum, or a
  second time. Resume it with a new estimate or cancel it. The inbox lists each one.
- **A card holding money whose approval is not current:** its text was changed outside a board
  control, so it is hidden and takes no money. Cancel it at the second factor, which moves its unspent
  money on; the inbox lists each one until then. Money it already spent stays on its bar, and a card
  that has shipped is left to the sweep.
- **A card supply short of its floor** (`docs/specs/studio-reports.md`): fewer than 6 cards open for
  funding, none of $5 or more, or none under $2. Press **Draft to the floor** with a reason at the
  second factor and keep the board site open while the Game Designer drafts; each draft is checked,
  graded and cooled like any card. The inbox lists it while the supply is short. Nothing drafts on
  its own until an operations percentage exists. The floor's defaults change by a board pull request.
- **Kernel pull requests** (HR's text changes, the Claude Code pin, board work): merge them yourself.
  The inbox links every open pull request that is not from a `card/` branch: the dispatcher merges
  only those, so every other one waits for you.
- **New models:** add a price-table row to `.env` before any role uses a new model. The board site
  cannot read `.env`, so the inbox does not list this one; I tell you when a model change needs it.

## Standing items, outside the order

- **GitHub Actions minutes.** On 23 September 2026 the account's included Actions minutes ran out,
  and with its $0 spending limit every gate job is refused within seconds. You said "just do
  everything locally for now", so the gate workflow is disabled and I merge board pull requests on
  the local gate, the same checks run on your Mac (`scripts/local-gate.sh`, `docs/specs/local-gate.md`).
  Cards cannot merge until Actions is back; the studio is paused anyway. Three ways back, your call:
  1. **Wait** for the included minutes to reset at the start of the next billing cycle. Free.
  2. **Make the repository public:** GitHub → the repository → **Settings** → **General** →
     **Danger Zone** → **Change visibility** → **Make public**. Standard runners are free on public
     repositories. Everything in the repository, history included, becomes readable by anyone.
  3. **Add an Actions budget:** GitHub → your profile picture → **Settings** → **Billing and
     licensing** → **Budgets and alerts**. This is a spend, so it is an exception you name to
     `docs/PLAN.md` §10 decision 35.

  Once minutes are back, run `gh workflow enable gate` (or tell me to), and every pull request,
  cards included, merges on the Actions gate again.

  **Tell me:** "Actions is back" and which of the three.
- **Claude Code on the Mac: the pinned version.** Attended sessions need 2.1.280 or newer, because
  2.1.139 refuses `claude-opus-5-5`, the model every running role uses (`docs/PLAN.md` §10 decision
  36), and they run only on the version in `platform/ops/mac/claude-code-pin.json` (2.1.283 now).
  `claude --version` shows yours. Tell me before you update it: I run the attended sandbox check
  (`pnpm --filter @backseat/dispatcher sandbox:check --positive`) on a new version and move the pin
  in a pull request you merge, before any card runs on it.
- **HST review at $15k.** When cumulative contributions reach $15,000, review GST/HST
  registration. Registration is required past the $30,000 small-supplier threshold, and Stripe tiers
  with named benefits are sales, so register before tiers ship (`docs/PLAN.md` §5 Canada admin). An
  automatic alert is a backlog entry; until it exists I mention the total when it gets close.
- **Delete `KEYS.md`.** The OpenAI and Gemini keys you put in `KEYS.md` are in `.env` (see
  **Done**, item 1). Before you delete it I confirm both are set in `.env` by their length only,
  never printing them, and quote the result. Then delete `KEYS.md` from the main checkout yourself.
  It is untracked, so the deletion cannot be undone; `.gitignore` keeps it out of the repository
  either way.

## Pause when the board site is down

If Netlify has paused the sites (a usage limit, above) or the board's site is down for any other
reason, the Pause button is gone with it. Two ways to stop the agents without Netlify, either one
enough:

1. **Stop the dispatcher on the Mac.** In Terminal on the host Mac:

   ```sh
   launchctl bootout gui/$(id -u)/studio.peanutgallery.dispatcher
   ```

   It finishes and meters any running session, then stops; once healthchecks.io is set up (step 6)
   it emails you that the dispatcher is down. `platform/ops/mac/install.sh --start` starts it again.

2. **Pause the studio in the database.** Supabase dashboard → the project → **SQL Editor**, paste
   this one statement and **Run**. It does what the board site's Pause (`set_paused(true)`) does,
   with the board as the reason; the dispatcher sleeps at its next tick and the site says the board
   has paused the agents within about three minutes.

   ```sql
   update public.studio_state set paused = true, paused_by = 'sql-editor', paused_at = now(), pause_reason = 'board' where id = 1;
   ```

   Resume from the board's site once it is back.

## What only you can do

- The Resend account, its DNS records and its SMTP key.
- The Mac's power and update settings, `brew install libpq age`, Google Drive for desktop and the
  backup check.
- The backup key, and keeping it offline.
- The Stripe read-only key, the Stripe settings, and rolling the secret key.
- The Mac's fine-grained GitHub token.
- The Discord webhooks and AutoMod.
- Subscribing to the ntfy topic on your phone.
- The business contact for the Terms, and reviewing the legal pages.
- Passkeys on every account.
- Naming a moderator.
- The call on how the first player arrives, and the share if you choose it.
- Confirming Stripe payouts and the bank account.
- Buying Console credit after each payout and recording it on the board's site.
- Go live, and posting the announcement.
- Deleting the local `KEYS.md`.
- Reviewing HST registration at $15k.
- The Netlify plan, its usage notifications, and any paid plan after an overrun.
- Bringing GitHub Actions minutes back: waiting for the reset, a public repository, or a budget.
- Pinning Claude Code with `sudo`, and the first replay eval run on your plan.
- Installing Renovate, only if Dependabot cannot read the lockfile.

---

## Open decisions

### Kill-condition pivots

The funder, money and board-time kill conditions stay, counted from Go live (`docs/PLAN.md` §8).
Their pivots ("drop 24/7; run a weekly two-hour live show", "drop the meter; run as a public demo",
"archive; publish the post-mortem; open-source the vote and meter kit") were written for a streamed
studio. **Tell me:** "keep the pivots", or the pivots you want for a site-first studio.

### A Google Cloud billing account

The dispatcher moves from your Mac to a free Google Cloud Compute Engine e2-micro once you open a
billing account on your Google account (`docs/BACKLOG.md`, Move the dispatcher to Google Cloud).
It stays inside the free tier, with a $1 budget alert, but the account needs a card on file, which
is your call. **Tell me:** "the Google Cloud billing account is open", whenever you choose to.

### The card maximum (old item 10): resolved by the launch batch

A card's funding target no longer depends on the per-card maximum, which now limits only what agents
may spend on one card (`docs/PLAN.md` §10 decision 28). `docs/PLAN.md` §4 Kernel makes spend caps
a rule no card may edit; it fixes that caps exist, not their values, and §6 Budget throttle keeps
them in `studio_state`, edited from /board. So the numbers are yours: the caps form at /board sets
the daily cap, the card maximum, the hourly rate, the monthly cap and the studio-wide daily limit on
immediate credit, with your second factor. Removing the caps outright is a kernel change I would argue against, because
they are what stops a looping agent draining customer money. Nothing to reply unless you want
different numbers.

### The sweep's findings of 22 September: where each went

- The four gate holes (the config lane skipping the strings check, a NUL byte hiding a file from the
  scanners, `seed-1/sim/hash.ts` and `rng.ts` unprotected, a root file named like `a=b`): the gate
  pull request, branch `launch/gate`.
- The footer line, the raw test output on deploy rows and "In the gate": the site pull request,
  branch `launch/site`. The footer becomes the full sentence you were offered, "AI agents build free
  games you can play in a browser."
- Card titles in production: the live-cards pull request, branch `launch/cards`, applied after it
  merges with the titles quoted before and after.
- The seed-1 unlock count reading "13 of 12": a game card on now, filed by the live-cards pull
  request.
- The ledger-identity race and the null-session refund edge, which need a migration or a production
  read: the backlog entry "Two rare accounting edge cases".

---

## Reply crib sheet

Copy any of these back to me as you finish:

- "Resend is verified and the key is in .env."
- "the Mac is ready."
- "Stripe read key is in .env."
- "the Mac token is set."
- "both checks email me."
- "Discord webhooks are in .env."
- "legacy Free" / "credit-based Free"
- "subscribed to ntfy." / "the test alert arrived."
- the address and phone for the Terms, or "leave it out"
- "Claude Code is pinned."
- "Stripe settings done." / "secret key rolled."
- "legal pages are fine"
- "passkeys are on."
- "moderator email is in .env."
- "signed in on the board site."
- "keep $500" (or a number)
- "ready for the restore drill."
- "share quietly" / "announce first", then "shared"
- "payouts are on" / "the first payout arrived"
- "credit bought and recorded", and the tier
- "ready for the cutover"
- "gone live"
- "keep the pivots" (or the pivots you want)
- "the Google Cloud billing account is open" (whenever you choose)

---

## Done

Newest last. Each entry says what was checked, not just that it happened. The numbers are the item
numbers used before 22 September 2026; the steps above are numbered afresh from the launch plan.

### 1. Image provider and key: DONE 19 September 2026

Nothing left for you here, except deleting `KEYS.md` (see **Standing items**).

You put both keys in `KEYS.md`. I copied them into `.env` (`OPENAI_API_KEY` and
`GOOGLE_AI_API_KEY`), which is gitignored, and tested both against the live APIs before writing
them:

- **OpenAI**: `GET /v1/models` returned HTTP 200, 124 models visible, including `gpt-image-1`,
  `gpt-image-2` and `gpt-image-2.5`.
- **Gemini**: `GET /v1beta/models` returned HTTP 200, 58 models visible, including
  `gemini-2.5-flash-image`, `gemini-3-pro-image` and `gemini-3.1-flash-image`. The key's `AQ.`
  prefix is not the `AIza` form AI Studio usually hands out, but it authenticates on both the
  `key=` query parameter and the `x-goog-api-key` header, so it is fine.

**How they will be used (updated 22 September 2026).** The agent avatars are drawn in code as SVG
instead (`docs/PLAN.md` §10 decision 27), so the image adapter is a backlog entry ("Image adapter
for studio pictures"): OpenAI first with Gemini behind the same interface, only for studio
imagery, behind a board review queue. The keys stay in `.env` for it.

### 2. TOTP on /board: DONE 20 September 2026

Nothing left for you here.

- **Enrolment.** One verified TOTP factor in `auth.mfa_factors`, enrolled 2026-09-20 00:18:56 UTC,
  with no abandoned unverified factor left behind.
- **The second factor proved against a state-changing RPC.** You filed a directive rather than a
  note: card `8bd842eb-8cf7-4f24-a17d-031bd2f97e4b`, "second factor test", at 00:25:54 UTC. That is
  stronger evidence than the note the spec names: `file_directive` is the top-tier board RPC, and
  like `file_note` it refuses a session without `aal2`. It is recorded that way in the Evidence
  section of `docs/specs/launch-pages.md`.

### 3. Legal text review: DONE 20 September 2026

You said the text is fine and only needed to be Ontario/Canada. I checked all four pages in
`platform/site/src/lib/copy.ts` and it already was, in both places it matters:

- Terms, "Who runs the studio": "Peanut Gallery is operated by Kyle Smith, an individual in Ontario,
  Canada."
- Terms, "Law": "These terms are governed by the laws of Ontario and the laws of Canada that apply
  there."

No other jurisdiction appears anywhere in Terms, Privacy, Refunds or Contact: no US state, no EU,
no named regulator. Nothing to change, so nothing was changed.

### The "second factor test" directive: RESOLVED 20 September 2026

Deleted. It was card `8bd842eb-8cf7-4f24-a17d-031bd2f97e4b`, left `funded` at priority 0 by the
second-factor test, and it would have been first in the queue once the dispatcher ran and money
covered it.

- Checked first that nothing referenced it: 0 rows in `ledger`, `contributions`, `agent_events`,
  `votes`, `images` and `board_notes`.
- Deleted with the id, title, stage and `actual_usd = 0` all in the filter, so it could match nothing
  else. 1 row deleted, HTTP 200.
- After: the card is gone, 9 cards remain, queue depth 0, 6 live. `ledger` still 65 rows and the pool
  still $0.5019; the delete touched no money.

### 2a. SSH key for the VPS: DONE 22 September 2026

Nothing left for you here. `~/.ssh` had no key pair, so I made one with no passphrase, the default
this file already named: `ssh-keygen -t ed25519 -C peanutgallery-vps -f ~/.ssh/id_ed25519`.
`ssh-keygen -lf ~/.ssh/id_ed25519.pub` prints
`256 SHA256:1fLWiB1WvhlXXkzbw7/xkUXmRGPsp5NDtozEVZ3ofdk peanutgallery-vps (ED25519)`.
`oracle-launch.sh` gives the public half to the instance; the private half never leaves the Mac. (Oracle is dropped since 23 September 2026, so the key waits for a server.)

### 5. ntfy topic: made and tested 22 September 2026

Generated an unguessable topic without printing it, saved the URL as `NTFY_TOPIC_URL` in `.env.vps`
at the repository root (gitignored, mode 0600), and posted a test to it: HTTP 200. Subscribing your
phone is still open (step 9).

### 9. Viewer-count kill lines: DONE 22 September 2026

You said yes. Removed from `docs/PLAN.md` §8: "under 300 peak concurrent" and "under 150 average
concurrent", the 7-day and 30-day lines' stream numbers. The funder, money and board-time criteria
stay; the dateless rewrite of 22 September counts them from Go live.

### Webhook secret and redeploy: DONE 22 September 2026

You said yes. `NTFY_TOPIC_URL` is set as a Supabase function secret (the Management API answered
201, and the secret list now names it). `stripe-webhook` was redeployed from `main` at 558b934 with
the sweep's two error-label fixes ("Deployed Functions."). An unsigned POST answers 400 "Missing
stripe-signature header", so it still refuses anything Stripe did not sign.

### Claude Code 2.1.280 on the Mac: DONE 23 September 2026

The Mac's Claude Code went from 2.1.139 to 2.1.280, because 2.1.139 refuses `claude-opus-5-5`
("Claude Code 2.1.139 does not support this model; version 2.1.280 or newer is required").
`claude --version` prints `2.1.280 (Claude Code)`. The attended sandbox check first failed on 2.1.280,
because the seed tests could not read the repository's git data, and passes after the carry-over fix:
`PASS: attended sandbox`, seed-1 tests `77 passed (77)`, with the check's clone in the temp folder and
again with it under your home folder (`docs/specs/carry-over.md`).

### Contact address, the host's tokens, the dispatcher check and the backup key: DONE 23 September 2026

- **Contact address.** hello@clayhouse.studio on the site, the legal pages and Stripe's public
  details (`docs/PLAN.md` §10 decision 37, pull request #57).
- **Tokens.** `VPS_GITHUB_TOKEN` and `GITHUB_READ_TOKEN` are set in `.env.vps`, checked by length
  only (93 characters each, the fine-grained form), never printed. The Mac's `GITHUB_TOKEN` in `.env`
  is still the gh sign-in token (step 5.3).
- **healthchecks.io.** `HEALTHCHECK_URL` is set in `.env.vps`. `BACKUP_HEALTHCHECK_URL` is not yet
  (step 3).
- **Backup key.** `BACKUP_AGE_RECIPIENT` is set in `.env`; the private file is at
  `~/peanutgallery-backup.key` (mode 0600) until you move it offline (step 3).
- **Stripe.** Public details and the removed display-name field (step 12); the minimum stays $1.
