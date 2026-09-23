# Board setup: everything that needs Kyle

Every step that only the board can take, in the order that gets the studio to Go live. Each one
says why it is needed, exactly what to do, how you know it worked, and what to tell me afterwards.

Sources: `docs/ROADMAP.md` (the launch checklist), `docs/PLAN.md` §10 (the decisions),
`platform/ops/README.md` (the VPS runbook), `docs/specs/vps.md`, `docs/specs/money-safety.md`,
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

Nothing in A is done yet. Where something below is already done, it says so and points at **Done**.

---

## A. Blocks me from finishing

### 1. Refund email (10 minutes, free)

**Why.** The Terms, the Refunds page and the Contact page send people to hello@peanutgallery.games,
and refunds are asked for there. I checked on 22 September 2026: the domain's DNS is at GoDaddy
(`ns45/ns46.domaincontrol.com`) and it has no MX records, so mail to any @peanutgallery.games address
bounces today. A forwarder needs an account in your name, so this one is yours.

**Do this.**

1. Sign up at improvmx.com on the free plan with the domain peanutgallery.games, and forward
   `hello` to your own inbox.
2. ImprovMX shows two MX records and an SPF record (a TXT record). Add all three in GoDaddy → the
   domain → DNS.
3. Send a test message to hello@peanutgallery.games from another address and confirm it arrives.

Then I check the MX and SPF records with `dig` and record them here.

**Unblocks:** keeping contributions open safely, and the live check's mail test.

**Tell me:** "hello@ works, test mail arrived."

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

Then I point Supabase Auth's email at Resend (custom SMTP) with a sender on that subdomain, and send
you a sign-in link to check it arrives.

**Unblocks:** the moderator's sign-in, and a Pause that can't be rate-limited.

**Tell me:** "Resend is verified and the key is in .env."

### 3. Oracle account now, sign-in when I ask (15 minutes, Always Free)

**Why.** Live criterion 2 is the dispatcher running unattended on a server, and the nightly backup
and the Controller run beside it. `platform/ops/oracle-launch.sh` (spec
`docs/specs/oracle-launch.md`) builds the network, launches the instance inside today's Always Free
limit and keeps retrying every availability domain while Oracle says "Out of capacity", the free
Ampere tier's usual answer. It checks the firewall is TCP 22 only and proves ssh. The SSH key is made
(see **Done**), so all that is left is the account, which only you can create.

1. **Now:** cloud.oracle.com → **Start for free**. **Home region: Canada Southeast (Toronto),
   `ca-toronto-1`.** Montreal (`ca-montreal-1`) is the accepted alternative. The home region cannot
   be changed later. It asks for a card to check you are a real person; that check is not a charge.
   **Stay on the Free Tier.** Stop once you reach the console home page; create nothing there.
2. **Later, when I ask:** in the **Terminal tab inside Claude**, run:

   ```bash
   oci session authenticate --region ca-toronto-1 --profile-name peanutgallery
   ```

   A browser window opens; sign in with the Oracle account. The CLI is already installed. No API key
   is created. The sign-in lasts 24 hours, so wait for my prompt.

Then I launch the instance (inside Always Free) and create the backup bucket, with your allow, and
quote the `RUNNING` state, the address and both `ssh … ok` lines.

**Idle reclaim, your choice.** Oracle stops an Always Free instance after 7 days in which its CPU
(at the 95th percentile), network and memory all stay under 20%. If it does, the healthchecks.io ping
stops and you get an email. Start it again from the Oracle console (Compute → Instances →
`peanutgallery-dispatcher` → Start), or tell me and I rerun the launch script; everything starts on
boot. The only way to remove reclaim is upgrading the account to Pay As You Go, which stays $0 inside
the Always Free limits but puts your card on file. It is in **D** below.

**Tell me:** "Oracle account is made", and later "Oracle is signed in."

### 4. Backup key (5 minutes, free)

**Why.** The nightly backup is encrypted to a key only you hold, so neither the server nor the
backups repository can read a backup back (`docs/specs/money-safety.md`).

1. In the Terminal tab, run `brew install age`, then `cd ~ && age-keygen -o peanutgallery-backup.key`.
   Never run it in the repository folder.
2. It prints `Public key: age1…`. Paste me only that line; it is safe to share.
3. Move `~/peanutgallery-backup.key` to your password manager or a USB stick, then delete it from the
   Mac. You bring it back once, for the restore drill (step 20).

**Tell me:** the `Public key: age1…` line.

### 5. Stripe read-only key (10 minutes, free)

**Why.** The Controller reconciles the books with Stripe every day and computes the Console credit
to buy and the Minimum balance figure; the live check reads back the Payment Link's settings. Those
are its only Stripe reads. The key can't move money.

1. In Stripe, go to Developers → API keys → **Create restricted key**, and name it
   `peanutgallery-reconcile`.
2. Give it **Read** on: Balance, Balance transactions (Stripe may list it as "Balance transaction
   sources"), Payouts, Charges and Refunds (one line on some screens), Checkout Sessions, Payment
   Links, Events and Disputes. Nothing else, and no Write anywhere.
3. Put it in `.env` as `STRIPE_READ_KEY=…`.

Before either job first runs, I tell you exactly what each one reads. The VPS's env check refuses
`STRIPE_READ_KEY` unless it starts with `rk_live_`, and refuses any value starting `sk_live_` or
`sk_test_` under any name.

**Tell me:** "Stripe read key is in .env."

### 6. Three fine-grained GitHub tokens (15 minutes, free)

**Why.** How the server, the agent sessions and your Mac reach the repository with no more access
than they need (`docs/PLAN.md` §10 decision 30). Each is for the peanutgallery repository only, and
all three must be different. No API creates one, but GitHub takes the settings in a link, so each
link below fills in the name, the owner AlreadyKyle, a 366-day expiry and the repository permissions.
For each one:

- the one thing to choose by hand is Repository access → **Only select repositories** →
  `peanutgallery`;
- check the permissions list shows exactly what is written here (GitHub adds Metadata read on its
  own) and **no Workflows**;
- the token is shown once; copy it straight into the file named, never into chat.

1. **The dispatcher token** (the dispatcher on the server): Contents read and write, Pull requests
   read and write, Checks read, **Actions read** (to download the design frames the gate renders),
   Metadata read, and under **Account permissions, Plan read** (for the Actions-minutes guard). The
   link sets the repository permissions; if the list does not show Plan as read-only under Account
   permissions, set it there by hand. If you already made this token without Actions read or Plan
   read, edit it and add them; it keeps its value.

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-vps&description=Peanut+Gallery+VPS+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&checks=read&actions=read

   Add a line `VPS_GITHUB_TOKEN=` followed by it to `.env.vps`.
2. **The read token** (it mounts the repository into each Managed Agents session): Contents read
   only.

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-read&description=Peanut+Gallery+agent+sessions,+read+only&target_name=AlreadyKyle&expires_in=366&contents=read

   Add a line `GITHUB_READ_TOKEN=` followed by it to `.env.vps`. Before the cutover I prove it
   cannot write: a push with it must answer 403, and the unattended startup refuses to run otherwise.
3. **The Mac token** (attended runs on your Mac): the same permissions as the dispatcher token,
   Actions read and Plan read included.

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-mac&description=Peanut+Gallery+Mac+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&checks=read&actions=read

   In `.env` at the repository root, replace the value of `GITHUB_TOKEN` with it. Today that value
   is the gh command-line tool's own sign-in token (it starts `gho_`), which reaches every
   repository on your account and has no Workflows limit. You can keep the gh sign-in for your own
   use; it just must not be the value in `.env`. Unattended mode refuses a token that is not
   fine-grained, and attended mode warns about one.

**Unblocks:** unattended mode and the cutover.

**Tell me:** "tokens are set."

### 7. healthchecks.io (5 minutes, free)

**Why.** Once the dispatcher and the nightly jobs run on the server, this is how you hear that one
stopped.

1. Sign up at healthchecks.io with your own email, on the free plan.
2. Add a check named `peanutgallery dispatcher`, **period 1 minute**, **grace 5 minutes**, and one
   named `peanutgallery backup`, **period 1 day**. The ops runbook fixes these timings, so use them
   exactly.
3. Under notification methods, confirm your email gets both checks.
4. Copy each ping URL (`https://hc-ping.com/<uuid>`). In `.env.vps`, add a line `HEALTHCHECK_URL=`
   followed by the dispatcher's and a line `BACKUP_HEALTHCHECK_URL=` followed by the backup's.

**Unblocks:** alerts that can't fail silently.

**Tell me:** "healthchecks checks are created."

### 8. Discord webhooks (10 minutes, free)

**Why.** Ship posts and the weekly report go to Discord through webhooks, posted by code only.

1. In your server's settings, go to Integrations → Webhooks and create one for a read-only `#ships`
   channel and one for `#weekly`.
2. Put the URLs in `.env` as `DISCORD_WEBHOOK_SHIPS=…` and `DISCORD_WEBHOOK_WEEKLY=…`.
3. Turn on AutoMod (Settings → Safety Setup).

**Unblocks:** ship posts and the weekly report.

**Tell me:** "Discord webhooks are in .env."

### 9. Netlify plan check (2 minutes)

Open Netlify → Team settings → Billing and tell me whether it says **legacy Free** or
**credit-based Free**. Don't switch plans. The board's own site is a second free site on the same
team, so this also tells me how its builds count.

**Unblocks:** the scale and deploy settings.

**Tell me:** "legacy Free" or "credit-based Free".

### 10. ntfy (5 minutes, free)

**Why.** The topic exists and the Stripe webhook already posts to it (see **Done**), but your phone
is not subscribed yet, so an unattended failure would not reach you.

1. Install the free **ntfy** app (App Store or Play Store).
2. In the app: **+** → paste the topic name → Subscribe, leaving the server as ntfy.sh. If the
   topic name is not on your clipboard, `grep NTFY .env.vps | cut -d/ -f4 | tr -d '\n' | pbcopy` in
   the Terminal tab puts it there. Anyone who knows the topic can read and post your alerts, so it
   stays out of chat.
3. Tell me, and I post a test so you see it arrive. The cutover repeats that test from the server.

**Unblocks:** phone alerts.

**Tell me:** "subscribed to ntfy", then "the test alert arrived."

### 11. Business contact for the Terms

The Ontario internet-agreement disclosure needs a mailing address and a phone number published on
the Terms page. Send me the ones to publish; they will be public, so chat is fine. Or tell me to
leave the disclosure out, and I'll say what that risks.

**Unblocks:** the legal-copy pull request.

**Tell me:** the address and phone to publish, or "leave it out".

### 12. Pin Claude Code (when I ask, after the sandbox fix passes)

Run the one `sudo` command I give you, which writes the version pin to Claude Code's managed
settings, and enter your Mac password. Claude Code on the Mac is 2.1.280, and the attended sandbox
check passes on it (see **Done**); it is pinned only after `sandbox:check --positive` passes on the
pinned version.

**Unblocks:** attended builds on a known-good version.

**Tell me:** "Claude Code is pinned."

---

## B. Needed before the announcement (they don't block the build)

### 13. Stripe settings, in the Stripe Dashboard

No agent touches Stripe; these are yours.

- **Business description.** Check that Settings → Business details describes the model accurately.
  Email Stripe support describing it ("supporters fund specific development tasks on an AI-built
  free game; no rewards") and ask whether a restricted category applies. Keep their reply. If they
  say it needs approval, tell me before anything else; otherwise nothing waits for a written OK.
- **Minimum balance.** Settings → Payouts → Minimum balance. Turn it on. It holds a fixed amount,
  which you raise after each payout to the figure the board site's Needs you inbox shows (the
  reserve plus held money plus typical fees, computed by the Controller). The Controller alerts if
  Stripe's balance falls below it.
- **Minimum amount.** Payment Link → Edit → "Let customers choose what to pay", and set the minimum
  to $2. If Stripe won't change it on the existing link, tell me and I'll give you the settings for a
  replacement link. Leave Radar on its default: card-testing protection is already on, and custom
  rules would charge a fee on every payment.
- **Public details.** Settings → Public details: support email `hello@peanutgallery.games`, plus the
  terms and privacy URLs.
- **Display name field.** Payment Link: remove the "Public display name" custom field.
- **Your test payment.** Refund your own $1 test payment.
- **After-payment redirect.** Payment Link → After payment: redirect customers to
  `https://peanutgallery.games/thanks?session={CHECKOUT_SESSION_ID}`. Do this once I tell you /thanks
  is live.

**Tell me:** "Stripe settings done", and Stripe's reply on the category when it comes.

### 14. Retire the full Stripe secret key

Once I move the stripe-webhook function onto the restricted key, roll the secret key in Stripe
(Developers → API keys → Roll key). I then remove `STRIPE_SECRET_KEY` from `.env` and the function
secrets. After that, no key on your Mac, the server or Supabase can refund, charge or pay out, and
changing webhook endpoints becomes a Dashboard step of yours.

**Tell me:** "secret key rolled."

### 15. Review the new Terms, Privacy and Refunds pages

Once the legal-copy pull request is up, read them yourself, as you did on 20 September 2026 (see
**Done**).

**Tell me:** "legal pages are fine", or what to change.

### 16. Passkeys or hardware keys

Turn on passkeys or a hardware key on Stripe, GitHub, Supabase, Netlify, the studio's Anthropic
organisation, Google, GoDaddy, Oracle, ImprovMX, Resend and Discord, and remove SMS as a recovery
method on each. Where a service offers no passkey, turn on authenticator-app two-step instead, or
sign in to it only through Google or GitHub.

**Tell me:** "passkeys are on."

### 17. Name a moderator

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

### 18. Sign in once on the board's own site

The board has moved to its own site (`docs/specs/board-site.md`): a separate free Netlify site at
its own `netlify.app` address, which I give you once it is created. Bookmark it; nothing on the
public site links to it, and peanutgallery.games/board is now a plain not found page. Everyone is
signed out at the switch. Sign in there by magic link; your authenticator app carries over, so enter
its code as before. The first thing you see is the **Needs you** inbox, which is usually empty.

**Tell me:** "signed in on the board site."

### 19. Studio daily credit limit

Keep $500, or set the number the scale pull request proposes, in the Caps form on the board's site
(second factor). Besides the $50 a day of immediate agent credit per payer, all payers together get
at most this much immediate agent credit per New York day, and credit above it is held 14 days. The
same form now takes the usage tier cap (step 23).

**Tell me:** "keep $500", or the number you set.

---

## C. The launch sequence

Run it in this order, once A and B are done, the money-safety, legal-copy, money-logic and
supporter-loop pull requests are live, and the launch cards are open to fund.

### 20. Restore drill (once, about 10 minutes)

Bring the offline backup key (step 4). I decrypt one stored backup on your Mac with it, restore it
and quote the ledger identity on it. Then the key goes back offline and the decrypted copy is
deleted.

**Tell me:** "ready for the restore drill."

### 21. The first player arrives

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

### 22. First payout

In Stripe → Balances, confirm payouts are on and the bank account is verified. Then wait for the
first payout that includes a player's money. The new-account delay started with your test payment on
15 September 2026, so it may already have run. Plan for the first payout taking 7 to 14 days.

**Tell me:** "payouts are on", and later "the first payout arrived".

### 23. Buy Console credit, after this payout and after every payout from now on

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

### 24. Cutover (about fifteen minutes together, then a day's soak)

I prompt you at each point.

1. You: **Pause** on the board's site.
2. Me: stop the Mac dispatcher and confirm no dispatcher process is left.
3. Me: create or update the managed agent and environment with the studio key and quote their ids;
   write the server's env file with `platform/ops/make-dispatcher-env.sh` (it prints key names,
   never values), upload it root-only, and run `provision.sh` twice. The second run must print
   `provision: done: 0 change(s)`.
4. You: set the agent mode to **unattended** on the board's site (second factor).
5. Me: start the service and quote the journal's `startup probe passed` line. The probe is a small
   Managed Agents session, billed as overhead from the studio share.
6. You: confirm the board's site shows the dispatcher seen under 3 minutes ago, that
   healthchecks.io is green, and that my test alert from the server reached your phone.
7. You: **Resume**.
8. Me: restart test and reboot test, then stop the service and wait out the grace so healthchecks
   emails you, which proves the alert path. Start it again.
9. A 24-hour soak with no restart loop and no unexpected alert. I quote the results.

Then the first player-funded card builds with nobody at the keyboard, billed to the studio, which
closes live criterion 2.

**Tell me:** "ready for the cutover".

### 25. Go live

The first player-funded card ships, and its /card replay is the launch clip. You press **Go live**
on the board's site; it works once and cannot be undone. Then you edit my drafts in `docs/launch/`
so they sound like you, and post them in the order in `docs/specs/announcement.md`. The posting is
yours.

**Tell me:** "gone live".

---

## D. Open topics (no blockers)

- **Operations percentage.** The agent-system pull request shows the number and the costs it came
  from. Lower it if you want. Nothing waits on you.
- **Paid advice, your call.** Paid from the first payout's studio share, or through an exception you
  name to decision 35: one Canadian lawyer session on the new pages, one accountant session on the
  HST threshold and income tax on the pool, and Ontario business-name registration for "Peanut
  Gallery" ($60). I book nothing.
- **Kill-condition pivots.** "Keep the pivots", or the ones you want for a site-first studio (see
  **Open decisions**).
- **Oracle Pay As You Go,** only if Oracle reclaims the idle instance (step 3).
- **Delete `KEYS.md`** from the repository folder on your Mac (see **Standing items**).
- **HST registration review** when cumulative receipts reach $15k (see **Standing items**).
- **Record the trademark search** for "Peanut Gallery".
- **Later, only if limits bite:** make the repository public when Actions minutes run short; move the
  sites to Cloudflare Pages before Mid; Supabase Pro at about 400 MB; grow the Anthropic tier.
- **Dreaming research-preview access,** only when memory comes back on the roadmap.

---

## Your standing duties

These are the only standing actions left with the board, the ones the money rule and the kernel
force. Each shows in the board site's **Needs you** inbox when it is due; the inbox is usually empty.
If you do none of them, the studio pauses or stays as it is. Nothing else waits on you.

- **After each payout:** buy Console credit and raise Stripe's Minimum balance (step 23). The inbox
  lists it once a payout leaves agent money that is not credit yet.
- **Refunds** asked for at hello@peanutgallery.games: refund each one in Stripe within 14 days of the
  contribution. A standing line in the inbox; no script refunds.
- **Disputes:** answer each in Stripe before its due date. The Controller alerts, and the inbox lists
  each one with its date.
- **The emergency fund:** convert its credit when an S1 card needs it. The inbox lists S1 cards that
  may draw on it.
- **Kernel pull requests** (HR's text changes, the Claude Code pin, board work): merge them yourself.
  The inbox links every open pull request that is not from a `card/` branch: the dispatcher merges
  only those, so every other one waits for you.
- **New models:** add a price-table row to `.env` before any role uses a new model. The board site
  cannot read `.env`, so the inbox does not list this one; I tell you when a model change needs it.

## Standing items, outside the order

- **Claude Code on the Mac: 2.1.280 or newer.** Attended sessions need it, because 2.1.139 refuses
  `claude-opus-5-5`, the model every running role uses (`docs/PLAN.md` §10 decision 36).
  `claude --version` shows yours. Tell me before you update it: I run the attended sandbox check
  (`pnpm --filter @backseat/dispatcher sandbox:check --positive`) on a new version before any card
  runs on it.
- **HST review at $15k.** When cumulative contributions reach $15,000, review GST/HST
  registration. Registration is required past the $30,000 small-supplier threshold, and Stripe tiers
  with named benefits are sales, so register before tiers ship (`docs/PLAN.md` §5 Canada admin). An
  automatic alert is a backlog entry; until it exists I mention the total when it gets close.
- **Delete `KEYS.md`.** The OpenAI and Gemini keys you put in `KEYS.md` are in `.env` (see
  **Done**, item 1). Before you delete it I confirm both are set in `.env` by their length only,
  never printing them, and quote the result. Then delete `KEYS.md` from the main checkout yourself.
  It is untracked, so the deletion cannot be undone; `.gitignore` keeps it out of the repository
  either way.

## What only you can do

- The ImprovMX account and the GoDaddy MX and SPF records.
- The Resend account, its DNS records and its SMTP key.
- The Oracle account and `oci session authenticate`.
- The backup key, and keeping it offline.
- The Stripe read-only key, the Stripe settings, and rolling the secret key.
- The three fine-grained GitHub tokens.
- The healthchecks.io account.
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

---

## Open decisions

### Kill-condition pivots

The funder, money and board-time kill conditions stay, counted from Go live (`docs/PLAN.md` §8).
Their pivots ("drop 24/7; run a weekly two-hour live show", "drop the meter; run as a public demo",
"archive; publish the post-mortem; open-source the vote and meter kit") were written for a streamed
studio. **Tell me:** "keep the pivots", or the pivots you want for a site-first studio.

### Oracle Pay As You Go

Only if Oracle actually reclaims the instance (step 3). **Tell me:** "upgrade Oracle" if you would
rather put a card on file than restart it by hand.

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

- "hello@ works, test mail arrived."
- "Resend is verified and the key is in .env."
- "Oracle account is made." / "Oracle is signed in."
- the `Public key: age1…` line
- "Stripe read key is in .env."
- "tokens are set."
- "healthchecks checks are created."
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
- "upgrade Oracle" (only if reclaims happen)

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
`oracle-launch.sh` gives the public half to the instance; the private half never leaves the Mac.

### 5. ntfy topic: made and tested 22 September 2026

Generated an unguessable topic without printing it, saved the URL as `NTFY_TOPIC_URL` in `.env.vps`
at the repository root (gitignored, mode 0600), and posted a test to it: HTTP 200. Subscribing your
phone is still open (step 10).

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
