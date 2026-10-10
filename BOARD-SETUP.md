# Board setup: what you need to do

Work down this page, top to bottom. For each step, do the numbered lines, then send me its **Reply**
line. Nothing else on this page is waiting on you. Finished steps are under **Done**, at the end.

**Two rules.**

1. **Never paste a key, token, password, email address or URL into the chat.** Put it in the file the
   step names: `.env` or `.env.vps`, both in `~/GitHub/peanutgallery`. I can read them; I can never
   type a secret for you. Both are hidden files, so Finder does not list them. To open one, run
   `open -e ~/GitHub/peanutgallery/.env` (or `.env.vps`) in Terminal, which opens it in TextEdit, or
   press Cmd+Shift+. in Finder to show hidden files.
2. **If a screen doesn't match these words,** the provider changed its UI. Tell me what you see
   instead of guessing.

Step numbers never change, so a number you wrote down stays valid. "More detail: Reference 8" means
section 8 under **Reference**, further down; you only need it if a step is unclear.

Checked against your Mac, Stripe, the Admin console, GitHub and production on 1 October 2026. I do
everything that can be done from the Mac; what is left needs you at a Google or board-site screen, a
second factor, a decision, or money. The path to shipping:

**Post the announcement now (`docs/PLAN.md` §10 decision 64). Funded cards build on their own (decision 65), and the studio never waits on you (decision 66).** The board site is optional, an admin and debug panel like a hosting dashboard: your standing duties reach you by ntfy, email and GitHub, not through it. Recording the credit purchase stamps the launch time; there is no Go live button (`docs/PLAN.md` §10 decision 62).

## What's left, in order

While the first payout is on its way (days):
- [ ] **35** Restore drill (10 minutes, with me)

Now:
- [ ] **40** Post the announcement (`docs/launch/`, the order in its README)
- [ ] **Token:** add Account → Plan: Read to the dispatcher's fine-grained token and extend it past 23 October 2026 (GitHub → Settings → Developer settings → Fine-grained tokens → the host's token → **Edit** to add the permission, then **Regenerate token** with a later expiry; regenerating gives a new value, so replace `VPS_GITHUB_TOKEN` in `.env.vps` and I rebuild the dispatcher's Actions secret from it). More detail: Reference 5.

Funded cards build on their own (`docs/PLAN.md` §10 decision 65): the dispatcher runs unattended on
GitHub Actions and spends the studio key's Console balance. Keep that balance topped up in the studio
organisation; recording a purchase at /board is optional.

Closed by `docs/PLAN.md` §10 decision 66: **41** (the card supply refills itself,
`docs/specs/unattended-roles.md`) and **39** (the dispatcher runs unattended on GitHub Actions since 6
October 2026).

Later or optional: **21** regenerate the host's GitHub token before 23 October 2026, **6** Search
Console, **26** the Twitch handle, and Dependabot's #114 under **Later**.

Finished (see **Done**): 12, 14, 17, 19, 20, 22, 25 (hello@ delivers to the board), 27, 29, 30, 31, 32, 33 and 36 (the board's own), 34, and the payouts check in 37.

---

## 1. Now

Optional: empty the Trash. `KEYS.md` is in it; every secret in it is also in `.env` or `.env.vps`.

---

## 2. While the first payout is on its way (days)

### Step 35: The restore drill (10 minutes, with me)

More detail: Reference 19.

1. Get the USB stick with the backup key.
2. Tell me you are ready. I restore a backup and prove it is intact.
3. Put the key away again when I say. I delete the decrypted copy.

**Reply:** "ready for the restore drill."

### Step 37: The first payout (days, nothing for you to do)

More detail: Reference 21. Payouts are on and the bank account works: the Controller's dry run on 1
October 2026 read one paid payout, 0.94 CAD arriving on 22 September 2026 (your test payment). Wait for a
payout that includes a player's money; it can take 7 to 14 days after their payment. The Controller's
daily run then reports it by ntfy, with the credit to buy.

**Reply:** "the first payout arrived", when you see it.

---

## 3. When the payout arrives

### Step 38: Buy Console credit from that payout, then after every payout

More detail: Reference 22. Never your own money. The Controller's ntfy alert names the amount.

1. console.anthropic.com → switch to the **studio** organisation, not your personal one.
2. **Billing** → buy prepaid credit for the amount the alert names. Below the Console's minimum? Wait
   for the next payout.
3. Auto-reload **off**. Set the Console's monthly limit to the cap the board site shows.
4. Optional (`docs/PLAN.md` §10 decisions 65 and 66): board site → **Record a credit purchase**, with
   the Console receipt's amount (second factor). The first recorded purchase stamps the launch time.
5. Stripe → Settings → Payouts → **Minimum balance**: raise it to the figure the alert names.
6. Read the tier off the Console's **Limits** page.

**Reply:** "credit bought and recorded", and the tier.

### Step 39: The cutover: CLOSED, unattended since 6 October 2026

The dispatcher runs unattended on GitHub Actions since 6 October 2026 (`docs/PLAN.md` §10 decisions 61
and 66), so there is nothing left to do here. Kept as history. More detail: Reference 23. The steps were:

1. **Pause** on the board site, when I say.
2. Set the agent mode to **unattended** on the board site (second factor), when I say.
3. Confirm the board site shows the dispatcher seen in the last 3 minutes, healthchecks.io is green and
   the test alert reached your phone.
4. **Resume.**

Then a 24-hour soak on GitHub Actions; your Mac can sleep.

**Reply:** "ready for the cutover."

### Step 40: Post the announcement (now)

`docs/PLAN.md` §10 decision 64: post now; there is no clip to wait for and no Go live button.

1. Read each draft in `docs/launch/` and change any words you want in your own voice.
2. Check each subreddit's current self-promotion and flair rules.
3. Post them in the order in `docs/launch/README.md`: r/ClaudeAI, r/artificial, r/incremental_games, Show HN, then the X thread.
4. Keep `docs/launch/backlash-line.md` handy for comments about AI in games.

**Reply:** "posted."

---

## 4. The card supply

### Step 41: Draft to the floor: CLOSED 10 October 2026

Closed by `docs/PLAN.md` §10 decision 66: the card supply refills itself. While it is short, a scheduled
`draft_card` drafts the next seed-1 backlog card that is not board work or, with none, a new seed-1
card, unattended and billed to that card (`docs/specs/unattended-roles.md`); there is no button and
nothing for you to do.
The old steps are kept as history. More detail: `docs/specs/launch-card-floor.md`. Your call on 1 October 2026: this is not a blocker. The
six open cards can be funded as they are. The session adds one big card ($5 or more), because the floor
wants one; the spec says to run it before the first stranger is invited, so until you do, the six are all
there is. It needs your authenticator code, which I cannot enter: the board-site session I opened asked
for it under **Two-factor sign-in**.

1. Tell me you are ready. I take a fresh database dump and quote the card supply.
2. Start the dispatcher in Terminal and leave the window open:

   ```sh
   cd ~/GitHub/peanutgallery && pnpm --filter @backseat/dispatcher start
   ```

   It should print `dispatcher started` with `"mode":"attended"`.
3. Board site → **Two-factor sign-in** → the 6-digit code from your authenticator app → **Verify**.
4. **Needs you** → **Draft to the floor**. Reason: `Launch floor: one big card of $5 or more`. Press it.
5. Keep the tab signed in and the Mac awake until the run finishes, then tell me.

Afterwards I check the supply before and after, each new card's approvals and estimate, the ledger
identity, `/api/live` and the live check, fill in the spec's Evidence, and merge the docs pull request.

**Reply:** "ready for the floor session", then "pressed."

---

## 5. Later, and optional

- **Step 21: regenerate the host's GitHub token before it expires on 23 October 2026** (the **Token**
  item at the top adds Account → Plan: Read at the same time). GitHub →
  Settings → Developer settings → Fine-grained tokens → the token → **Regenerate token** (it keeps its
  permissions), then replace `VPS_GITHUB_TOKEN` in `.env.vps` (`open -e ~/GitHub/peanutgallery/.env.vps`). An expired token stops the unattended
  dispatcher. More detail: Reference 5. **Reply:** "the host token is regenerated."
- **Step 6: tell Google Search Console about the new domain.** Add both domains, then Settings →
  **Change of address** from peanutgallery.games. Then **Sitemaps** → submit `sitemap.xml`
  (`https://mobmachine.games/sitemap.xml`, live from 2 October 2026).
- **Step 26: rename the Twitch channel to Mob Machine**, and tell me the new handle.
- **Dependabot's #114**, `actions/setup-node` 4 to 7, a major bump to the gate workflow, waits for your
  merge.

### Your calls, nothing waits on them

- **How the board site's second factor works.** You said on 1 October 2026 that you will change it
  later: it asks for an authenticator code in a panel on every new session before any button works, and
  an agent cannot press a board button for you. A verified second factor on state-changing board
  actions is a live criterion (`docs/ROADMAP.md`, criterion 4: the board's own site requires a second
  factor) and the board's database functions enforce it, so the change is a board-site change with its
  own spec, not a setting.
- **Kill-condition pivots:** "keep the pivots", or the ones you want for a site-first studio.
- **From the 28 September QA pass** (write-ups in `~/peanutgallery-launch/qa-2026-09-28/`): the
  lookalike-letter deny-list patch (I'd skip it), the same kernel shadow rule for the dispatcher,
  sharper Dust text on phones, and a test on real Safari.
- **Paid advice:** an accountant session on HST and income tax, and Ontario business-name
  registration for Mob Machine.

---

## Reference: the detail behind each step

Sources: `docs/ROADMAP.md` (the launch checklist), `docs/PLAN.md` §10 (the decisions),
`platform/ops/README.md` (the runbook, with The Mac host at its end), `docs/specs/mac-host.md`,
`docs/specs/money-safety.md`, `docs/specs/board-site.md`, `.env.example`. The board has its own site
(`docs/specs/board-site.md`); "/board" and "the board's site" both mean it. It opens on **Status**
(`docs/specs/optional-board.md`).

The numbered sections below are the steps as the ROADMAP and the specs cite them ("BOARD-SETUP step 22"),
in four sections; the checklist above points at them. The **Done** entries at the bottom keep the
numbers they were done under.

- **A. Blocks me from finishing.**
- **B. Needed before the announcement.** They don't block the build.
- **C. The launch sequence.**

The order to do them in is the checklist's, above, not these sections'.
- **D. Open topics.** Nothing waits on them.
- **Rename to Mob Machine.** Its own short list, just below. Nothing in A to D waits on it.

Step numbers never change, because the ROADMAP and the specs cite them. A step added later takes the
next free number and sits in the section it belongs to: step 25 is in A and step 26 in B. A step that
is finished or no longer needed stays under its number and says so.

Where something below is already done, it says so and points at **Done**. On 23 September 2026 the
host moved from Oracle to your Mac (`docs/PLAN.md` §10 decision 38), so the Oracle account and its
sign-in are gone from this list, and the backup key is part of the Mac's step.

---

### Rename to Mob Machine

**Why.** You renamed the studio Mob Machine on 23 September 2026 (`docs/PLAN.md` §10 decision 43),
with a new mark in place of the peanut: a small machine with two eyes, drawn in code
(`docs/specs/machine-mark.md`). The rename pull request (#79) is merged and live: the site, the
link preview, the icons, the game's tab, the agents and the alerts say Mob Machine, and the Terms
say it from version 3. The steps below are the places only you can change. On 29 September 2026 the
Discord server still had its old name and no icon; Stripe and the signature are unconfirmed.
The domain moved to mobmachine.games on 29 September 2026 (R5 and R6, `docs/PLAN.md` §10 decision
59, `docs/specs/rename.md`); R6.5, Stripe's links, is done too.

The icon file for Stripe and Discord is `platform/site/public/icon-512.png` in the repository, also
at https://mobmachine.games/icon-512.png: the white machine on black,
512 by 512, with room around it for a round crop.

#### R1. Stripe (10 minutes, free), after the rename is deployed

1. Stripe Dashboard → Settings (the gear, top right) → **Business** → **Public details**.
   - **Public business name:** `Mob Machine`.
   - **Statement descriptor:** `MOB MACHINE`. If a **Shortened descriptor** is set, `MOBMACHINE`.
   - Save. Expected: the fields read back the new values; new card statements say MOB MACHINE.
2. Settings → **Business** → **Branding**: **Icon** → upload `icon-512.png` → Save. Expected: the
   preview of the checkout page shows the machine.
3. **Product catalog** → the product the Payment Link sells → **Edit product**. If its name or
   description still carries the old studio name, change it to Mob Machine and save. Expected:
   opening the Payment Link (the Contribute button on the site) shows the new words at checkout.
4. The Payment Link's after-payment redirect is R6.5.

**Tell me:** "Stripe says Mob Machine."

#### R2. Discord (5 minutes, free)

1. In the Discord app, click the server's name at the top left → **Server Settings** → **Server
   Profile** (**Overview** in older versions).
2. **Name:** `Mob Machine`. **Icon:** Change or Upload Image → `icon-512.png` → Apply.
3. **Save Changes.** Expected: the server list shows the white machine, and the invite on the site
   (the Discord link in the menu) still opens the server under its new name: an invite survives a
   rename, so nothing in the repository changes.

**Tell me:** "Discord is renamed."

#### R3. The hello@clayhouse.studio signature (2 minutes)

In the mail app that sends as hello@clayhouse.studio, open the signature settings (in Gmail: the
gear → **See all settings** → **General** → **Signature**) and change the old studio name to Mob
Machine. The address itself stays (`docs/PLAN.md` §10 decision 37). Expected: a test mail to yourself ends
with the new name.

**Tell me:** "The signature says Mob Machine."

#### R4. The sign-in email's sender name (nothing to click now)

The board's sign-in email comes from Supabase through Resend (step 2). When I connect it, the sender
name is Mob Machine, not the old name the board-site spec was written with. The Site URL and the
redirect list stay the board's own site's address, which has nothing to do with the public domain,
so a new domain does not touch them. Expected: the next sign-in link you get says it is from Mob
Machine. Your authenticator app keeps the old label on the second factor you already enrolled; that
is only a label.

**Tell me:** nothing, unless the sign-in email still shows the old name.

#### R5. Register the new domain: DONE 29 September 2026, mobmachine.games

Kept below as it was written. The board paid for the domain itself, an exception to decision 35
(`docs/PLAN.md` §10 decision 59).

A domain costs money, so it is an exception you name to decision 35 (or it waits for a payout's
studio share); the domain's pull request records it as a decision.

1. Register the domain at GoDaddy, the registrar of peanutgallery.games, with auto-renew and the
   registrar lock on.
2. Keep peanutgallery.games registered and on auto-renew: old links, shared previews, search results
   and the address on the agents' commits keep reaching the studio.

**Tell me:** "The domain is <name>." Then I open the domain's pull request: the script's domain
pass, the 301 from peanutgallery.games to the new domain, the game's link, the preview image, the
explainer's social cuts, the production cards that name the old address (a dump first) and the live
check, with `pnpm verify` switched to checking the domain too. It merges once R6.1 to R6.3 show
HTTPS.

#### R6. The domain on Netlify and Stripe: DONE 29 September 2026

R6.1 to R6.4 are done: GoDaddy's records, the certificates, play.mobmachine.games for the game, and
mobmachine.games as the primary domain (set by me through Netlify's API after the merge). R6.5,
Stripe's links, is the checklist's Part 1 step 5, with `<new domain>` read as mobmachine.games.

R6.1 to R6.3 are safe as soon as the domain is registered: the site answers on both addresses and
nothing changes for visitors. R6.4 and R6.5 wait until I say the pull request is live.

1. **The site.** app.netlify.com → the site **peanutgallerygames** → **Domain management** → **Add a
   domain** → type the new domain → **Verify** → **Add domain**; add `www.<new domain>` the same way
   if it does not appear on its own. Do not make it primary yet. At GoDaddy → the new domain →
   **DNS**, delete the default "Parked" `@` A record and the default `www` CNAME, then add an **A**
   record `@` → `75.2.60.5` and a **CNAME** `www` → `peanutgallerygames.netlify.app` (the records
   peanutgallery.games uses; if Netlify lists others, use Netlify's). Wait until Netlify stops
   showing "Pending DNS verification", then **HTTPS** → **Verify DNS configuration** and wait for
   "Your site has HTTPS enabled". Expected: https://<new domain> opens the site with a padlock.
2. **The game, my recommendation** (`docs/specs/rename.md`, the game's address): Netlify → the site
   **peanutgallery-seed-1** → Domain management → **Add a domain** → `play.<new domain>`; at GoDaddy
   a **CNAME** `play` → `peanutgallery-seed-1.netlify.app`; wait for HTTPS as above. Expected:
   https://play.<new domain> opens Dust. Or tell me "keep the game's address", and the game stays at
   its netlify.app address.
3. **Tell me** "The domain has HTTPS on Netlify", and "play.<domain> has HTTPS" or "keep the game's
   address".
4. Once I say the pull request is live: on **peanutgallerygames**, beside the new domain,
   **Options** → **Set as primary domain**. Keep peanutgallery.games in the list as an alias; the
   301 needs it there.
5. Stripe → Settings → **Business** → **Public details**: the business website, terms of service and
   privacy policy URLs (and a support URL, if set) move from peanutgallery.games to the new domain,
   same paths. **Payment Links** → the link → **After payment** → redirect to
   `https://<new domain>/thanks?session={CHECKOUT_SESSION_ID}` (step 12's redirect, on the new
   address).

**Tell me:** "The new domain is primary" and "Stripe points at the new domain." I then run the live
check against the new address and check the 301 and the redirect.

Optional and free: Google Search Console → add both domains → **Settings** → **Change of address**
from peanutgallery.games to the new one.

#### Handles

The Twitch channel already exists, https://www.twitch.tv/peanut_gallery_games, taken under the old
name before the rename; the stream that would use it is a backlog entry. Renaming it to Mob Machine
is yours, whenever you choose. Tell me the new handle, so it goes in the repository.

#### What I do after the merge, each with your allow

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

### A. Blocks me from finishing

#### 1. Contact email: DONE 23 September 2026

The public contact address is hello@clayhouse.studio, the board's own mailbox (`docs/PLAN.md` §10
decision 37). The site, the legal pages and Stripe's public details use it. Nothing to set up.

#### 2. Board sign-in email (15 minutes, free)

**Why.** The board now signs in on its own site (`docs/specs/board-site.md`). Supabase's built-in
mail only reaches members of the Supabase project team, at most 2 an hour, so the moderator could
not get a sign-in link at all, and two failed requests during an incident would lock you out of
Pause for an hour. Resend's free plan sends it instead.

**Do this.**

1. Sign up at resend.com on the free plan with your own email.
2. Add a domain: a sending subdomain of mobmachine.games, such as `mail.mobmachine.games`.
   Add the DNS records it shows (SPF and DKIM, and the MX it asks for on that subdomain) in GoDaddy
   → the domain → DNS, and wait until Resend shows the domain verified.
3. Create an SMTP key (an API key with sending access) and put it in `.env` at the repository root
   as `RESEND_SMTP_KEY=…`. Never paste it in chat.

Then I point Supabase Auth's email at Resend (custom SMTP) with a sender on that subdomain named Mob
Machine (**Rename to Mob Machine**, R4), and send
you a sign-in link to check it arrives.

**Unblocks:** the moderator's sign-in, and a Pause that can't be rate-limited.

**Tell me:** "Resend is verified and the key is in .env."

#### 3. The Mac as the studio's host (30 minutes, free)

**Why.** Live criterion 2 is the dispatcher running unattended. Oracle is dropped and no card goes on
file for a cloud server, so until the studio has one the dispatcher and the daily jobs (the backup,
the Controller and the quota check) run on this Mac under launchd, from a folder of their own,
`~/peanutgallery-host` (`docs/PLAN.md` §10 decision 38, `docs/specs/mac-host.md`). Where it goes after the Mac is
undecided and needs no card (see **Open decisions**).

**Do this.**

1. **Power.** Keep the Mac plugged in and the lid open whenever the studio runs: the dispatcher holds
   the Mac awake on power, but closing the lid sleeps it anyway. In System Settings → Battery →
   Options, turn on **Prevent automatic sleeping on power adapter when the display is off**. The
   screen may still sleep.
2. **No surprise restarts.** System Settings → General → Software Update → Automatic updates: turn
   off installing macOS updates, and install them yourself while the studio is paused. With
   FileVault on, a restart or a power cut waits at the login screen and nothing runs until you log
   in; healthchecks.io emails you when that happens.
3. **Two tools: done.** `brew install libpq age` has run: libpq brings the database dump tools the
   backup uses, age encrypts the backups, and both were on the Mac on 29 September 2026.
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

Then, with your allow, I set the backup login's password (a production step,
`docs/specs/money-safety.md`), write `backup-mac.env` (key names only) and run
`platform/ops/mac/install.sh --jobs-only` twice (`docs/specs/jobs-only-install.md`). It installs the
nightly backup under launchd from a read-only copy of main, cloned with the read-only GitHub token
(step 5.2), without the host's env file, which needs the managed agent's ids and so waits on Console
credit (step 22). Then I run the first backup at once and quote the file it writes to the Drive
folder; that backup is the one the restore drill (step 19) uses, and from then on one runs every
night, with healthchecks.io emailing you if a night is missed. The Controller joins it once
`STRIPE_READ_KEY` is in (step 4), and the quota check once its env file is written; the same command
adds each. The dispatcher itself is installed at the cutover (step 23), which first moves this copy
of main aside so the dispatcher runs from main as it is then.

**Tell me:** "the Mac is ready."

#### 4. Stripe read-only key (10 minutes, free)

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

#### 5. Three fine-grained GitHub tokens (15 minutes, free)

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
   **Done**); if it lacks Plan read, edit it and add it. **It expires on 23 October 2026.** Before
   then, regenerate it on GitHub (Settings → Developer settings → Fine-grained tokens → the token →
   **Regenerate token**, which keeps its permissions) and replace the value in `.env.vps`. An expired
   token stops the unattended dispatcher from reaching the repository. **Tell me:** "the host token is
   regenerated."
2. **The read token** (it mounts the repository into each Managed Agents session): Contents read
   only.

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-read&description=Mob+Machine+agent+sessions,+read+only&target_name=AlreadyKyle&expires_in=366&contents=read

   Add a line `GITHUB_READ_TOKEN=` followed by it to `.env.vps`. **Set on 23 September 2026.**
   Before the cutover I prove it cannot write: a push with it must answer 403, and the unattended
   startup refuses to run otherwise.
3. **The Mac's token** (the hand-run tools on your Mac, such as the replay eval's scratch checkouts):
   the same permissions as the host's token, Actions read and Plan read included. **Not needed:** the
   hand-run tools accept the gh sign-in token, and the dispatcher, which runs unattended only on GitHub
   Actions, uses the host's own token (5.1), not this one. Optional hardening, whenever you choose:

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-mac&description=Mob+Machine+Mac+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&actions=read

   In `.env` at the repository root, replace the value of `GITHUB_TOKEN` with it. Today that value
   is the gh command-line tool's own sign-in token (it starts `gho_`), which reaches every
   repository on your account and has no Workflows limit. You can keep the gh sign-in for your own
   use; it just must not be the value in `.env`. The dispatcher refuses a token that is not
   fine-grained; the hand-run tools take any.

**Unblocks:** unattended mode and the cutover (5.1 and 5.2, both set). 5.3 unblocks nothing.

**Tell me,** only if you make it: "the Mac token is set."

#### 6. healthchecks.io (5 minutes, free)

**Why.** Once the dispatcher and the daily jobs run unattended, this is how you hear that one stopped.

The account and the `peanutgallery dispatcher` check (period 1 minute, grace 5 minutes) are made:
`HEALTHCHECK_URL` is in `.env.vps` (see **Done**). The `peanutgallery backup` check is part of step 3.
Under notification methods, confirm your email gets both checks.

**Unblocks:** alerts that can't fail silently.

**Tell me:** "both checks email me."

#### 7. Discord webhooks (10 minutes, free)

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
4. Tell me: I write the dispatcher's env file again with `make-dispatcher-env.sh`, which carries them,
   and set the `DISPATCHER_ENV` secret from it (`platform/ops/README.md`, The GitHub Actions host);
   the next run reads them.

A card that went live more than 6 hours before the lane is switched on is never posted, and only the
newest weekly report is, so switching it on does not flood the channels. A report is posted only
during the week after its own: once the next New York week has ended it is recorded as stale and never
posted, so switching the lane on, or resuming after a long pause, never announces an old week. The
post names its week ("The week of 14 September at Mob Machine: …").

**Unblocks:** ship posts and the weekly report. The first ship post needs a running dispatcher.

**Tell me:** "Discord webhooks are in .env."

#### 8. Netlify plan check (2 minutes)

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
every ten minutes), so a long outage is the case that can use the budget up. Stay on legacy
Free. About that page:

- Netlify has no usage-notification setting to turn on. Its docs say Legacy Starter and Pro teams get
  an email to the team's billing email at 50, 75, 90 and 100% of a limit, and do not say a Free team
  does, so do not count on a warning. **Usage & billing** → **Account usage insights** shows the
  numbers.
- At 100% of any limit Netlify pauses **every** site on the team until the next cycle, the board's
  site and its Pause included. Money keeps moving (Stripe, the webhook and the dispatcher use no
  Netlify Function); **Pause when the board site is down** below is how you pause the agents then.
  Restoring the sites before the cycle ends needs a payment method and a paid plan: your call.
- Optional: a second free Netlify team for the board's site alone, so an overrun on the public site
  cannot take the board's Pause with it.

#### 9. ntfy (5 minutes, free)

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

#### 10. Business contact for the Terms: CLOSED 23 September 2026

You decided on 23 September 2026 that the disclosures use hello@clayhouse.studio: the Terms name the
operator, Kyle Smith, an individual in Ontario, and that address, and publish no mailing address or
phone (`docs/PLAN.md` §10 decision 55). Nothing to do.

#### 11. Pin Claude Code (2 minutes, free; nothing waits on it)

The agent-upkeep pull request (`docs/specs/agent-upkeep.md`) pins Claude Code at 2.1.283, the
version the Mac updated itself to, on which the attended sandbox check passed in both layouts on
26 September 2026. The dispatcher runs no Claude Code since attended mode left it (`docs/PLAN.md`
§10 decision 66): only the hand-run tools at the Mac do, the replay eval and the sandbox check, and
they run only on the pinned version, while the daily check alerts by ntfy on any other. Until you run
this, Claude Code keeps updating itself, and each update stops the replay eval until I run the
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

**Unblocks:** a replay eval that stays on a checked version.

**Tell me:** "Claude Code is pinned", with the PASS line.

#### 25. The database password, for the migration history repair (5 minutes, free)

**Why.** Supabase keeps a list of the migrations it has applied, and the `supabase db push` command
reads it. Production's list has one stray entry and none of the repository's migrations, because
every migration so far went through the Management API's query endpoint, so `db push` would try to
apply every file again (`docs/specs/money-safety.md`, production step 4). A one-time repair marks them
applied; it needs the database owner's password, which is not on the Mac: `SUPABASE_DB_PASSWORD` in
`.env` is empty. Nothing waits on it: migrations keep going through the query endpoint until then.

1. Supabase dashboard → the project → **Project Settings** → **Database** → **Database password**. If
   you do not have the password, **Reset database password** and copy the new one. Nothing in the
   studio signs in with the owner's password (the backups use their own login), so a reset breaks
   nothing.
2. Put it in `.env` at the repository root, on the empty line `SUPABASE_DB_PASSWORD=`. Never in chat,
   never in `.env.vps` or the host's env files, which refuse it.

Then, with your allow, I link the project, mark every migration in the repository applied and the stray
entry reverted, and quote `supabase migration list`; from then on migrations go through
`supabase db push`, and the ROADMAP's standing fact changes with it.

**Tell me:** "the database password is in .env."

---

### B. Needed before the announcement (they don't block the build)

#### 12. Stripe settings, in the Stripe Dashboard

No agent touches Stripe; these are yours.

- **Business description (the email to Stripe support is not being sent: decided 1 October 2026).**
  Check that Settings → Business details describes the model accurately. The email would have
  described it ("supporters fund specific development tasks on an AI-built
  free game; no rewards") and ask whether a restricted category applies. Keep their reply. If they
  say it needs approval, tell me before anything else; otherwise nothing waits for a written OK.
- **Minimum balance.** Settings → Payouts → Minimum balance. Turn it on. It holds a fixed amount,
  which you raise after each payout to the figure the Controller's alert names (the
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
- **Adaptive Pricing: leave it alone (decided 1 October 2026).** The earlier note here said a local
  currency checkout would be charged and not credited. Stripe's docs say otherwise: the Checkout
  Session and the payment keep the price's currency and amount (US dollars), and the payer's local
  currency appears only in `presentment_details`, which is what the webhook's USD check (`session.ts`)
  never reads. The payer, not the studio, pays the 2 to 4% conversion fee. Stripe also says Adaptive
  Pricing is always on for Payment Links, so the account setting does not govern the Contribute link,
  and that it needs the price's currency to be one of the account's settlement currencies; this account
  settles only in CAD. Seen on 1 October 2026: the live link, opened with a French test location,
  shows `$5.00` and no local price, and the one completed payment is `usd`, 100 cents, with no
  `presentment_details`. Stripe's warnings on turning it off are about lost conversion, which is
  moot here. Nothing to do.
- **Your test payment: not refunding (decided 1 October 2026).** It stays, and the line on /ledger
  below stays with it. The refund would have been Payments → the $1.00 payment of
  15 September 2026 → Refund. While it is unrefunded it is booked apart
  (`docs/specs/money-logic.md`): it funds no card and sits in no "Not on a card yet" money, gets no
  supporter number, is in no money-in figure on the site, and is left out of the agent money a
  Console credit purchase may use. Until it is refunded, /ledger's Funding band says in one line
  "The pool includes $0.50 of the board's own test payment; it funds no card." ($0.50 is the part of
  your $1.00 that is agent credit in the pool; the rest is Stripe's fee and the reserve's, the
  studio's and the emergency fund's shares); the line goes after the refund
  (`docs/specs/money-surfaces.md`). The fee Stripe keeps on the refund ($0.2662) is booked to the
  studio share automatically; there is nothing to record by hand.
- **After-payment redirect: ready now.** /thanks is live (`docs/specs/supporter-pages.md`, done).
  Payment Link → After payment: redirect customers to
  `https://mobmachine.games/thanks?session={CHECKOUT_SESSION_ID}` (the checklist's Part 1 step 5).
  Until it is set Stripe shows its
  own receipt page. After it is set, the next real payment lands on /thanks with its supporter number
  and the cards it reached; tell me and I quote it.

**Tell me:** "Stripe settings done", and Stripe's reply on the category when it comes.

#### 13. Retire the full Stripe secret key

Once I move the stripe-webhook function onto the restricted key, roll the secret key in Stripe
(Developers → API keys → Roll key). I then remove `STRIPE_SECRET_KEY` from `.env` and the function
secrets. After that, no key on your Mac, the host or Supabase can refund, charge or pay out, and
changing webhook endpoints becomes a Dashboard step of yours.

**Tell me:** "secret key rolled."

#### 14. Review the new Terms, Privacy and Refunds pages: DONE 23 September 2026

You read /terms, /refunds and /privacy and approved them on 23 September 2026 (`docs/PLAN.md` §10
decision 55). The Terms are at version 3 since the rename. A change is a new version, never an edit to
a posted one: tell me what to change and a board pull request posts it.

#### 15. Passkeys or hardware keys

Turn on passkeys or a hardware key on Stripe, GitHub, Supabase, Netlify, the studio's Anthropic
organisation, Google, GoDaddy, Resend and Discord, and remove SMS as a recovery
method on each. Where a service offers no passkey, turn on authenticator-app two-step instead, or
sign in to it only through Google or GitHub.

**Tell me:** "passkeys are on."

#### 16. Name a moderator

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

#### 17. Sign in once on the board's own site

The board has moved to its own site (`docs/specs/board-site.md`): a separate free Netlify site at
its own `netlify.app` address. It is live, and its address is in `.env` as `BOARD_SITE_URL`
(`grep BOARD_SITE_URL .env` in the Terminal tab shows it). Bookmark it; nothing on the public site
links to it, and mobmachine.games/board is now a plain not found page. Everyone was signed out at
the switch. Sign in there by magic link; your authenticator app carries over, so enter its code as
before. After the code, the first thing you see is **Status**, then Activity and Actions
(`docs/specs/optional-board.md`).

**Optional now.** Under `docs/PLAN.md` §10 decision 66 the studio never waits on a board sign-in: the
role jobs and the visual review run unattended (`docs/specs/unattended-roles.md`). Signing in is still
how you use the panel; opening the platform code lane (step 26) does not wait on it.

**Tell me:** "signed in on the board site."

#### 18. Studio daily credit limit

Keep $500, or set the number the scale pull request proposes, by SQL (see **Change the caps by SQL**,
under **Pause when the board site is down**); the board's site shows the caps read-only. Besides the $50 a day of immediate agent credit per payer, all payers together get
at most this much immediate agent credit per New York day, and credit above it is held 14 days. The
usage tier cap (step 22) is set the same way.

**Tell me:** "keep $500", or the number you set.

#### 26. Open the platform code lane

**Why.** The Platform Builder builds studio cards in `platform/site` only while
`studio_state.platform_lane_open` is true, and it is false. It was kept closed until the board had its
own site, so no card's code could share an origin with the board's controls
(`docs/specs/board-site.md`, production step 12). Everything it waits on holds: the board site
and its headers, Supabase Auth on it with sign-ups off, the old sessions ended, and the live check.
Your sign-in there (step 17) is optional and does not hold it up; opening it is your decision. /team draws the Platform Builder outside
Running until the lane opens.

**Do this.** Tell me your decision. I take a dump, set the flag with
your allow, read it back, and check /team shows the Platform Builder under Running.

**Tell me:** "open the platform lane", or "keep it closed".

---

### C. The launch sequence

Run it in this order, once A and B are done, the money-safety, legal-copy, money-logic and
supporter-loop pull requests are live, and the launch cards are open to fund.

#### 19. Restore drill (once, about 10 minutes)

Bring the offline backup key (step 3). I decrypt the first backup from step 3 (or a newer nightly
one) with it, restore it by the runbook (`platform/ops/README.md`, Restore a
Mac backup, `after-restore.sql` included) and quote the ledger identity and the pg_cron jobs on it.
Then the key goes back offline and the decrypted copy is deleted.

**Tell me:** "ready for the restore drill."

#### 20. The first player arrives

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

#### 21. First payout

In Stripe → Balances, confirm payouts are on and the bank account is verified. Then wait for the
first payout that includes a player's money. The new-account delay started with your test payment on
15 September 2026, so it may already have run. Plan for the first payout taking 7 to 14 days.

**Tell me:** "payouts are on", and later "the first payout arrived".

#### 22. Buy Console credit, after this payout and after every payout from now on

**Why.** Unattended cards bill the studio organisation's key, not your Max subscription. Console
credit is bought only from money Stripe has paid out (decision 23), never with your own.

**How much.** The Controller computes it every day with one formula, and alerts by ntfy as soon as a
payout leaves agent money that is not credit yet: the remaining
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
4. Optional (`docs/PLAN.md` §10 decisions 65 and 66): record the purchase on the board's site
   (second factor), with the amount on the Console receipt and the Stripe payout id. The studio key's
   real Console balance is the limit on unattended spend, not the recorded total.
5. Tell me the tier the Console's **Limits** page shows. Its monthly limit is the usage tier cap; set it
   by SQL (see **Change the caps by SQL**).
6. In the same visit, raise Stripe's **Minimum balance** (Settings → Payouts) to the figure the inbox
   shows.

Repeat after every payout. Console credit lags the pool, so a card can wait for credit while the
pool shows money; the dispatcher then pauses the studio and alerts "Console credit needed", and the
next payout's purchase clears it.

**Tell me:** "credit bought and recorded", and the tier.

#### 23. Cutover and soak: done, unattended on GitHub Actions since 6 October 2026

Kept as history (`docs/PLAN.md` §10 decisions 61 and 66).

I prompt you at each point. Only one dispatcher ever runs: the dispatcher lease guarantees it, and
from here the attended dispatcher is not started while the host runs. The host is GitHub Actions in
this repository (`docs/PLAN.md` §10 decision 61); the runbook is `platform/ops/README.md`, The GitHub
Actions host, whose Set it up steps (the environment `dispatcher`, its secret and the age variable)
run first, with your allow.

1. You: **Pause** on the board's site.
2. Me: stop the attended dispatcher and confirm no dispatcher process is left.
3. Me: create or update the managed agent and environment with the studio key and quote their ids;
   write the host's env file with `platform/ops/make-dispatcher-env.sh` (key names only) and set it
   as the environment secret `DISPATCHER_ENV`.
4. You: set the agent mode to **unattended** on the board's site (second factor).
5. Me: the toolchain check, quoting `PASS: toolchain`.
6. Me: switch the host on (`DISPATCHER_HOST=on`) and start the first run with `gh workflow run`,
   quoting its `code root is read-only`, `containment verified` and `startup probe passed` lines. The
   probe is a small Managed Agents session, billed as overhead from the studio share.
7. You: confirm the board's site shows the dispatcher seen under 3 minutes ago, and healthchecks.io is green.
8. Me: post a test alert to ntfy. You: confirm it arrived on your phone.
9. You: **Resume**.
10. Me: a restart test (the run cancelled and a new one started, which may wait up to 5 minutes for
    the old run's lease to run out, so a healthchecks.io email during this test is expected). Then I
    switch the host off and we wait out the grace so healthchecks emails you, which proves the alert
    path. I switch it on and start it again.
11. A 24-hour soak: each run drains and starts the next, with no failed run and no unexpected alert.
    I quote the run list.

Then the first player-funded card builds with nobody at the keyboard, billed to the studio, which
closes live criterion 2.

**Tell me:** "ready for the cutover".

#### 24. Go live

The first player-funded card ships, and its /card replay is the launch clip. ~~You press **Go live**
on the board's site.~~ Superseded by `docs/PLAN.md` §10 decision 62: no button; recording the first
credit purchase (step 22) stamped the launch time. Then you edit my drafts in `docs/launch/`
so they sound like you, put the clip's link in each, and post them in the order in
`docs/launch/README.md`. The posting is yours.

**Tell me:** "gone live".

---

### D. Open topics (no blockers)

- **Cooling window, role pauses and vetoes (optional).** The agent-system pull request
  (`docs/specs/agent-system-core.md`) ships the cooling window at 0, so an approved agent card moves
  to now on the next dispatcher tick. Under `docs/PLAN.md` §10 decision 66 the board's site no longer
  sets the window, pauses a role or vetoes a card (`docs/specs/optional-board.md`); their functions
  stay, and the window (up to 10,080 minutes) changes by SQL. Model role jobs run unattended, each billed to the
  card it works on. Nothing waits on you.
- **Rank now and Draft a game card: retired by `docs/PLAN.md` §10 decision 66.** Ranking is the
  backlog's rank, then age, and drafting runs on its own when the card supply is short, unattended and
  billed to the card it drafts (`docs/specs/unattended-roles.md`). Nothing runs on your Max plan any
  more, and nothing waits for you to sign in.
- **The visual review (nothing to do now).** The design-review pull request
  (`docs/specs/design-review.md`) makes the files that set the look yours: the tokens, the Card, the
  glyphs, motion, the route list, the site's public and brand files and the game's favicon change
  only by a pull request you merge, so a new page or screen is yours too. When a card's change draws
  a page or the game differently, its gate draws before and after frames and a Director reviews them
  once its gate is green. Under `docs/PLAN.md` §10 decision 66 the review runs at once, unattended and
  billed to the card (`docs/specs/unattended-roles.md`), and the card waits at gated only while it
  runs. The first seed-1 card that changes `seed-1/render/` after launch is the first live
  review. The gate's `frames` job runs only on GitHub Actions, so it waits on Actions minutes (see
  **GitHub Actions minutes**); the local gate cannot run it.
- **The copy pass (nothing to do now).** The copy-pass pull request (`docs/specs/copy-pass.md`)
  changed the pitch to name Dust; §10 decision 58 has since replaced it with "Watch AI agents build a game studio and free games.", names you on
  /how-it-works and at the foot of /team as the human board with your standing duties, and marks
  every `docs/BACKLOG.md` entry `board: yes` or `board: no`. Every entry today is board work (each
  lands in kernel paths), so each /roadmap band shows them open under "Board work on how the studio
  runs (not funded by cards)" and a line saying no card for players or the studio is there yet; once
  such a card is planned, board work folds into a closed disclosure beside it. To override any
  wording, or any entry's marker, edit that one line in a pull request; after a marker change, run
  `pnpm --filter @backseat/supabase file-backlog` as a dry run, then with `--apply`.
  The /thanks button now reads "Follow the studio on Discord": it promises no ship posts, which
  start only once you set `DISCORD_WEBHOOK_SHIPS` (above).
- **Paid advice, your call.** Paid from the first payout's studio share, or through an exception you
  name to decision 35: one accountant session on the HST threshold and income tax on the pool, and
  Ontario business-name registration for "Mob Machine" ($60). I book nothing.
- **Kill-condition pivots.** "Keep the pivots", or the ones you want for a site-first studio (see
  **Open decisions**).
- **Where the dispatcher lives after the Mac,** whenever you choose (see **Open decisions**).
- **Delete `KEYS.md`** from the repository folder on your Mac (see **Standing items**).
- **HST registration review** when cumulative receipts reach $15k (see **Standing items**).
- **Record the trademark search** for "Mob Machine".
- **Later, only if limits bite:** move the sites to Cloudflare Pages before Mid; Supabase Pro at
  about 400 MB; grow the Anthropic tier. Actions minutes have already run short: see **GitHub
  Actions minutes** under **Standing items**.
- **Dreaming research-preview access,** only when memory comes back on the roadmap.
- **The Janitor and dependency updates (nothing to do now).** The agent-upkeep pull request
  (`docs/specs/agent-upkeep.md`) adds a daily drift check, whose findings reach ntfy once each (and show on the board's panel
  under Activity, Findings), and Dependabot. Four things to know, none blocking:
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

### Your standing duties

These are the only standing actions left with the board, the ones the money rule and the kernel
force. They reach you by ntfy, email and GitHub (the Controller's and the Janitor's alerts, Stripe's
own emails, the open pull requests), not through the board site, which is optional (`docs/PLAN.md` §10
decision 66). If you do none of them, the studio pauses or stays as it is. Nothing else waits on you.

- **After each payout:** buy Console credit and raise Stripe's Minimum balance (step 22). The
  Controller alerts once a payout leaves agent money that is not credit yet.
- **Refunds** asked for at hello@clayhouse.studio: refund each one in Stripe within 14 days of the
  contribution. The request arrives by email; no script refunds.
- **Disputes:** answer each in Stripe before its due date. The Controller alerts, and Stripe emails
  each one with its date.
- **The emergency fund:** convert its credit when an S1 card needs it. You set a card's severity, so
  you know when one does.
- **A card the resume rule will not resume:** one paused at its ceiling at the card maximum or a
  second time, or for its horizon, a veto, the read token or an unknown model. Resume it with a new
  estimate or reject it. The Janitor's daily check alerts by ntfy for a card paused at its ceiling, and
  the panel's Activity lists paused cards.
- **A card holding money whose approval is not current:** its text was changed outside a board
  control, so it is hidden and takes no money. Cancel it at the second factor, which moves its unspent
  money on; it is hidden and takes no money until then. Money it already spent stays on its bar, and a card
  that has shipped is left to the sweep.
- ~~**A card supply short of its floor.**~~ No longer a duty (`docs/PLAN.md` §10 decision 66): the
  supply refills itself (`docs/specs/unattended-roles.md`). The floor's
  defaults change by a board pull request.
- **Kernel pull requests** (HR's text changes, the Claude Code pin, board work): merge them yourself.
  GitHub notifies you of every open pull request that is not from a `card/` branch: the dispatcher
  merges only those, so every other one waits for you.
- **New models:** add a price-table row to `.env` before any role uses a new model. The Janitor's
  daily check alerts when a model has no row; I tell you when a model change needs it.

### Standing items, outside the order

- **GitHub Actions minutes. Done:** the repository has been public since 6 October 2026 (way 2 below),
  so standard runners are free and the gate workflow runs on Actions again; the local gate is the
  fallback only. Nothing to reply. The history: on 23 September 2026 the account's included Actions minutes ran out,
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
- **Claude Code on the Mac: the pinned version.** Only the hand-run tools run it now (the replay
  eval and the sandbox check; the dispatcher has no attended mode, `docs/PLAN.md` §10 decision 66).
  Their attended sessions need 2.1.280 or newer, because 2.1.139 refuses `claude-opus-5-5`, the model
  every running role uses (`docs/PLAN.md` §10 decision 36), and they run only on the version in
  `platform/ops/mac/claude-code-pin.json` (2.1.283 now). `claude --version` shows yours. Tell me
  before you update it: I run the attended sandbox check (`pnpm --filter @backseat/dispatcher
  sandbox:check --positive`) on a new version and move the pin in a pull request you merge, before
  the replay eval runs on it.
- **HST review at $15k.** When cumulative contributions reach $15,000, review GST/HST
  registration. Registration is required past the $30,000 small-supplier threshold, and Stripe tiers
  with named benefits are sales, so register before tiers ship (`docs/PLAN.md` §5 Canada admin). An
  automatic alert is a backlog entry; until it exists I mention the total when it gets close.
- **Delete `KEYS.md`.** The OpenAI and Gemini keys you put in `KEYS.md` are in `.env` (see
  **Done**, item 1). Before you delete it I confirm both are set in `.env` by their length only,
  never printing them, and quote the result. Then delete `KEYS.md` from the main checkout yourself.
  It is untracked, so the deletion cannot be undone; `.gitignore` keeps it out of the repository
  either way.

### Pause when the board site is down

If Netlify has paused the sites (a usage limit, above) or the board's site is down for any other
reason, the Pause button is gone with it. Two ways to stop the agents without Netlify, either one
enough:

1. **Switch the dispatcher's host off.** In Terminal (`platform/ops/README.md`, The GitHub Actions
   host):

   ```sh
   gh variable set DISPATCHER_HOST --repo AlreadyKyle/peanutgallery --body off
   gh run list --repo AlreadyKyle/peanutgallery --workflow dispatcher.yml --status in_progress
   gh run cancel <run id> --repo AlreadyKyle/peanutgallery
   ```

   No run starts while it is off; healthchecks.io emails you that the dispatcher is down. Set it `on`
   and start a run to bring it back.

2. **Pause the studio in the database.** Supabase dashboard → the project → **SQL Editor**, paste
   this one statement and **Run**. It does what the board site's Pause (`set_paused(true)`) does,
   with the board as the reason; the dispatcher sleeps at its next tick and the site says the board
   has paused the agents within about three minutes.

   ```sql
   update public.studio_state set paused = true, paused_by = 'sql-editor', paused_at = now(), pause_reason = 'board' where id = 1;
   ```

   Resume from the board's site once it is back.

**Change the caps by SQL.** The board site shows the caps read-only
(`docs/specs/optional-board.md`), so change them in the same SQL Editor. Take a dump first
(`docs/specs/money-safety.md`); the per-card maximum must not exceed the daily cap; and unlike
`set_caps`, a raw update records no board action, so tell me the reason and I add it to the next
pull request:

```sql
update public.studio_state set daily_cap_usd = …, monthly_cap_usd = …, card_max_usd = … where id = 1;
```

### What only you can do

- The Resend account, its DNS records and its SMTP key.
- The Mac's power and update settings, `brew install libpq age`, Google Drive for desktop and the
  backup check.
- The backup key, and keeping it offline.
- The Stripe read-only key, the Stripe settings, and rolling the secret key.
- Regenerating the host's GitHub token before it expires on 23 October 2026, and the Mac's optional
  token.
- The database password in `.env`, for the migration history repair.
- The Discord webhooks and AutoMod.
- Subscribing to the ntfy topic on your phone.
- Saying when to open the platform code lane (signing in on the board's own site is optional).
- Passkeys on every account.
- Naming a moderator.
- The call on how the first player arrives, and the share if you choose it.
- Confirming Stripe payouts and the bank account.
- Buying Console credit after each payout; recording it on the board's site is optional.
- Go live, and posting the announcement.
- Deleting the local `KEYS.md`.
- Reviewing HST registration at $15k.
- Any paid Netlify plan after an overrun.
- Bringing GitHub Actions minutes back: waiting for the reset, a public repository, or a budget.
- Pinning Claude Code with `sudo`, and the first replay eval run on your plan.
- Installing Renovate, only if Dependabot cannot read the lockfile.

---

### Open decisions

#### Kill-condition pivots

The funder, money and board-time kill conditions stay, counted from Go live (`docs/PLAN.md` §8).
Their pivots ("drop 24/7; run a weekly two-hour live show", "drop the meter; run as a public demo",
"archive; publish the post-mortem; open-source the vote and meter kit") were written for a streamed
studio. **Tell me:** "keep the pivots", or the pivots you want for a site-first studio.

#### Where the dispatcher lives after the Mac: DECIDED 29 September 2026 — it stays

**Changed 5 October 2026:** you are putting your card on Google Cloud billing, so the card premise
below no longer holds and Google Cloud's free e2-micro is open again (`docs/PLAN.md` §10 decision 60).
The Mac stays the host until the backlog entry is built. The rest of this section is the 29 September
record.

You can put no card on file, and every cloud free tier worth using verifies one: Oracle, Google
Cloud, AWS and Azure are all out for that reason, not a technical one. The "free VPS, no credit
card" sites are affiliate fronts, and nothing holding the studio's money goes on one. Paying for
Google Drive does not help; that is storage, and Cloud Billing takes neither a Drive subscription
nor PayPal in Canada. MCP servers are not hosting either: an MCP server offers tools to a program,
and has to run somewhere itself.

Moving off the Mac without a server would mean Supabase Cron as the clock and GitHub Actions as the
muscle, because an Edge Function gets 150 seconds of wall clock and 2 seconds of CPU while a card's
pipeline runs up to two hours and needs git, a filesystem and a live session stream. That is a
multi-week rewrite of the code that merges to main and moves money, and on 29 September 2026 the
board said no.

**So the Mac is the host.** While the studio runs, keep it plugged in, lid open and logged in. The
site, contributions, the ledger and the webhook are on Netlify, Stripe and Supabase and keep working
whatever the Mac is doing; what stops is card building and that night's backup, and healthchecks.io
emails you. Pause on the board site before you need the Mac off, so nothing is caught mid-build.
The backlog keeps the entry (`docs/BACKLOG.md`, Move the dispatcher off the Mac) if this ever
changes.

#### The card maximum (old item 10): resolved by the launch batch

A card's funding target no longer depends on the per-card maximum, which now limits only what agents
may spend on one card (`docs/PLAN.md` §10 decision 28). `docs/PLAN.md` §4 Kernel makes spend caps
a rule no card may edit; it fixes that caps exist, not their values, and §6 Budget throttle keeps
them in `studio_state`, edited from /board. So the numbers are yours: you set
the daily cap, the card maximum, the hourly rate, the monthly cap and the studio-wide daily limit on
immediate credit by SQL (see **Change the caps by SQL**); the board's site shows them read-only. Removing the caps outright is a kernel change I would argue against, because
they are what stops a looping agent draining customer money. Nothing to reply unless you want
different numbers.

#### The sweep's findings of 22 September: where each went

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

### Reply crib sheet

Copy any of these back to me as you finish:

- "Stripe points at the new domain."
- "Resend is verified and the key is in .env."
- "the Mac is ready."
- "Stripe read key is in .env."
- "the host token is regenerated." (before 23 October 2026) / "the Mac token is set." (optional)
- "both checks email me."
- "Discord webhooks are in .env."
- "legacy Free" / "credit-based Free"
- "subscribed to ntfy." / "the test alert arrived."
- "the database password is in .env."
- "Claude Code is pinned."
- "Stripe settings done." / "secret key rolled."
- "passkeys are on."
- "moderator email is in .env."
- "signed in on the board site." / "open the platform lane"
- "keep $500" (or a number)
- "ready for the restore drill."
- "share quietly" / "announce first", then "shared"
- "payouts are on" / "the first payout arrived"
- "credit bought and recorded", and the tier
- "ready for the cutover"
- "gone live"
- "keep the pivots" (or the pivots you want)

---

### Done

Newest last. Each entry says what was checked, not just that it happened. The numbers are the item
numbers used before 22 September 2026; the steps above are numbered afresh from the launch plan.

#### 1. Image provider and key: DONE 19 September 2026

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

#### 2. TOTP on /board: DONE 20 September 2026

Nothing left for you here.

- **Enrolment.** One verified TOTP factor in `auth.mfa_factors`, enrolled 2026-09-20 00:18:56 UTC,
  with no abandoned unverified factor left behind.
- **The second factor proved against a state-changing RPC.** You filed a directive rather than a
  note: card `8bd842eb-8cf7-4f24-a17d-031bd2f97e4b`, "second factor test", at 00:25:54 UTC. That is
  stronger evidence than the note the spec names: `file_directive` is the top-tier board RPC, and
  like `file_note` it refuses a session without `aal2`. It is recorded that way in the Evidence
  section of `docs/specs/launch-pages.md`.

#### 3. Legal text review: DONE 20 September 2026

You said the text is fine and only needed to be Ontario/Canada. I checked all four pages in
`platform/site/src/lib/copy.ts` and it already was, in both places it matters:

- Terms, "Who runs the studio": "Peanut Gallery is operated by Kyle Smith, an individual in Ontario,
  Canada."
- Terms, "Law": "These terms are governed by the laws of Ontario and the laws of Canada that apply
  there."

No other jurisdiction appears anywhere in Terms, Privacy, Refunds or Contact: no US state, no EU,
no named regulator. Nothing to change, so nothing was changed.

#### The "second factor test" directive: RESOLVED 20 September 2026

Deleted. It was card `8bd842eb-8cf7-4f24-a17d-031bd2f97e4b`, left `funded` at priority 0 by the
second-factor test, and it would have been first in the queue once the dispatcher ran and money
covered it.

- Checked first that nothing referenced it: 0 rows in `ledger`, `contributions`, `agent_events`,
  `votes`, `images` and `board_notes`.
- Deleted with the id, title, stage and `actual_usd = 0` all in the filter, so it could match nothing
  else. 1 row deleted, HTTP 200.
- After: the card is gone, 9 cards remain, queue depth 0, 6 live. `ledger` still 65 rows and the pool
  still $0.5019; the delete touched no money.

#### 2a. SSH key for the VPS: DONE 22 September 2026

Nothing left for you here. `~/.ssh` had no key pair, so I made one with no passphrase, the default
this file already named: `ssh-keygen -t ed25519 -C peanutgallery-vps -f ~/.ssh/id_ed25519`.
`ssh-keygen -lf ~/.ssh/id_ed25519.pub` prints
`256 SHA256:1fLWiB1WvhlXXkzbw7/xkUXmRGPsp5NDtozEVZ3ofdk peanutgallery-vps (ED25519)`.
`oracle-launch.sh` gives the public half to the instance; the private half never leaves the Mac. (Oracle is dropped since 23 September 2026, so the key waits for a server.)

#### 5. ntfy topic: made and tested 22 September 2026

Generated an unguessable topic without printing it, saved the URL as `NTFY_TOPIC_URL` in `.env.vps`
at the repository root (gitignored, mode 0600), and posted a test to it: HTTP 200. Subscribing your
phone is still open (step 9).

#### 9. Viewer-count kill lines: DONE 22 September 2026

You said yes. Removed from `docs/PLAN.md` §8: "under 300 peak concurrent" and "under 150 average
concurrent", the 7-day and 30-day lines' stream numbers. The funder, money and board-time criteria
stay; the dateless rewrite of 22 September counts them from Go live.

#### Webhook secret and redeploy: DONE 22 September 2026

You said yes. `NTFY_TOPIC_URL` is set as a Supabase function secret (the Management API answered
201, and the secret list now names it). `stripe-webhook` was redeployed from `main` at 558b934 with
the sweep's two error-label fixes ("Deployed Functions."). An unsigned POST answers 400 "Missing
stripe-signature header", so it still refuses anything Stripe did not sign.

#### Claude Code 2.1.280 on the Mac: DONE 23 September 2026

The Mac's Claude Code went from 2.1.139 to 2.1.280, because 2.1.139 refuses `claude-opus-5-5`
("Claude Code 2.1.139 does not support this model; version 2.1.280 or newer is required").
`claude --version` prints `2.1.280 (Claude Code)`. The attended sandbox check first failed on 2.1.280,
because the seed tests could not read the repository's git data, and passes after the carry-over fix:
`PASS: attended sandbox`, seed-1 tests `77 passed (77)`, with the check's clone in the temp folder and
again with it under your home folder (`docs/specs/carry-over.md`).

#### Contact address, the host's tokens, the dispatcher check and the backup key: DONE 23 September 2026

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

#### Stripe on mobmachine.games, the backup, the Mac, Resend: 29 September 2026

Steps 5, 8, 9, 10, 11 and 23, and step 27's terms checkbox. Checked, not just done:

- **Stripe, in the Dashboard (you).** Business details and Public details read back public business
  name Mob Machine, website `https://mobmachine.games`, privacy and terms URLs set; statement
  descriptor `MOB MACHINE`; the icon uploaded under Branding.
- **Stripe, through the Stripe connector (me, with your allow).** The live Payment Link
  `plink_1UFNNd…` reads back `consent_collection.terms_of_service: required` and
  `after_completion.redirect.url: https://mobmachine.games/thanks?session={CHECKOUT_SESSION_ID}`.
  Its product is named `Contribution` ("Funds agent compute for the game studio"): no old name.
- **The Mac.** `pmset -g custom`: sleep `0` on AC power. `AutomaticallyInstallMacOSUpdates` `0`.
- **The backup.** Folder `peanutgallery-backups` in the board's Google Drive, in `.env` as
  `BACKUP_DIR`; `BACKUP_HEALTHCHECK_URL` in `.env.vps`. `make-jobs-env.sh backup-mac` wrote
  `backup-mac.env` with 4 keys; `install.sh --jobs-only` made 8 changes (clone of main at `4b789c8`,
  read-only; `studio.peanutgallery.backup` loaded), and its second run 0. `run-job.sh backup --now`
  wrote `peanutgallery-20260929T213305Z.tar.age` (684,392 bytes) to the Drive folder. The backup
  login's password was already set.
- **Resend (step 13).** Domain `mobmachine.games` added at the root (not `mail.`): its DKIM and the
  `send`/`rsend` records resolve in public DNS. A sending-only key restricted to that domain,
  `peanutgallery-supabase-smtp`, is in `.env` as `RESEND_SMTP_KEY`. Supabase Auth reads back
  `smtp.resend.com:465`, user `resend`, sender `board@mobmachine.games` named Mob Machine, 30 emails
  an hour, password set. **Open:** Resend still showed the domain `pending`; once it verifies, I send
  one sign-in link to prove delivery. (Verified on 30 September 2026, below; the link is still to send.)

#### Discord, healthchecks.io, the Stripe key and the live check: 30 September 2026

Steps 15, 16 and 24, the Resend verification, and most of step 14. Checked, not just done:

- **healthchecks.io (step 15, you).** One email integration, to the board's address, assigned to 3 of
  3 checks, status "Ready to deliver", "goes down" and "goes up" both ticked, last notification
  delivered.
- **Discord (step 16, me, through the desktop app with your allow).** `#ships` and `#weekly` made.
  `@everyone` is denied Send Messages, Send Messages in Threads and both thread-creation permissions
  on `#ships`, and the change is saved. One webhook in each, copied through the clipboard into `.env`
  as `DISCORD_WEBHOOK_SHIPS` and `DISCORD_WEBHOOK_WEEKLY`, never printed. Read back with a `GET` on
  each: HTTP 200, two different channels, neither `#general`; the key lines are 121 characters each.
  Three AutoMod rules are on, each blocking the message: Block Mention Spam (20 mentions), Block
  Suspected Spam Content, and Block Commonly Flagged Words with Severe Profanity, Insults & Slurs and
  Sexual Content. The two test webhooks you pasted into the chat were deleted from `#general`; their
  addresses now answer 404. The attended dispatcher reads the new keys when it is next restarted.
- **The server's name (step 24).** Already `Mob Machine` with its icon when checked.
- **Resend.** The domain `mobmachine.games` reads `verified`, sending enabled, receiving disabled.
- **The Stripe read key (step 14).** In `.env` as `STRIPE_READ_KEY`, starts `rk_live_`, 107
  characters, a different value from `STRIPE_SECRET_KEY`. One `GET /v1/balance` with it answered 200.
  A read with `limit=1` of each endpoint the Controller uses: Checkout Sessions, Charges, Payouts,
  Balance transactions and Refunds 200; **Disputes, Events and Payment Links 403** (step 14 above).
  The Controller is not installed until they are fixed. No Stripe write was made.
- **The live check.** `node platform/site/scripts/live-check.mjs https://mobmachine.games`:
  `PASS live-check https://mobmachine.games passed=281 failed=0 skipped=0`. It also showed the pool
  at $0.50 (your test payment) and `/ledger` saying "Not yet reconciled with Stripe.", both expected
  until step 27's refund and the Controller.
- **`KEYS.md`.** Every secret in it is also in `.env`; the one value that is not is the public
  Stripe publishable key, which no code uses. Safe to delete (step 22).


#### Claude Code pin, the Stripe key's permissions and KEYS.md: 1 October 2026

Step 19, your part of step 14, and the check behind step 22. Checked, not just done:

- **The pin (step 19, you).** `sudo bash platform/ops/mac/pin-claude-code.sh` printed
  `PASS: claude-code pinned 2.1.283`. Read back after: `/Library/Application
  Support/ClaudeCode/managed-settings.json` exists and holds `DISABLE_AUTOUPDATER` set to `1`;
  `claude --version` prints `2.1.283 (Claude Code)`, the version in `claude-code-pin.json`.
- **The Stripe key (step 14, you).** You said the key has Read on Disputes, Events and Payment Links.
  Not yet read back: no Stripe call was made, and the Controller is not installed. The re-read and the
  install wait on your yes (step 14 above).
- **`KEYS.md` (step 22).** Every token of 16 characters or more in it was compared with `.env` and
  `.env.vps` by exact match, nothing printed: 22 are there. The 12 that are not are labels, the
  Supabase connection string's `[YOUR-PASSWORD]` placeholder, the project id, two URLs, the public
  Stripe publishable key and the public half of a signing key with its id (it has no private `d` field).
- **Netlify plan (step 17, you).** The Usage & billing page reads **Free** with a **Legacy** badge:
  bandwidth 89 MB of 100 GB, build minutes 0 of 300, concurrent builds 0 of 1, 12 of 500 projects. That
  is the legacy Free the function budget in Reference 8 assumes. The guide's second part, "confirm
  usage notifications", was wrong: there is no such setting in Netlify. The step is removed.
- **The database password (step 20, you).** You saved it in `KEYS.md` because `.env` is hidden in
  Finder, which the guide did not say. I copied it onto the `SUPABASE_DB_PASSWORD=` line of `.env`
  without printing it: 20 characters, and `.env.vps` still has none (it must not). The migration
  history repair is the new yes in step 20.
- **Supabase project name (you).** Renamed from peanutgallery to mobmachine. Nothing in the docs names
  the project by its display name (searched), so nothing changes; the project is addressed by its id.
- **The backup key off the Mac (step 12, you).** `~/peanutgallery-backup.key` no longer exists
  (`ls`: No such file or directory). `BACKUP_AGE_RECIPIENT`, the public half, is still in `.env`, so the
  nightly backup keeps encrypting; only the offline copies can open one. The restore drill (step 35)
  needs the USB stick.

#### Controller, migration history, KEYS.md and Gmail: 1 October 2026

Steps 14 and 20 done by me, step 22 moved to the Trash, step 25 not reachable. Checked, not just done:

- **The Stripe key (step 14).** After you said it has the three permissions, and with your "drive to
  completion", I made one read-only `GET` with `limit=1` on each endpoint with `STRIPE_READ_KEY`:
  balance, checkout sessions, charges, disputes, payouts, balance transactions, events, payment links
  and refunds all answered 200. No Stripe write was made.
- **The Controller (step 14).** `make-jobs-env.sh backup-mac controller quota` wrote `controller.env`
  (4 keys) and `quota.env` (5 keys), mode 0600, names only. `install.sh --jobs-only` made 4 changes
  (`studio.peanutgallery.controller` and `studio.peanutgallery.quota` written and loaded) and its second
  run 0; `launchctl list` shows backup, controller and quota. The dry run read: 14 of 15 checks pass,
  the ledger identity matches, 1 paid session and 1 paid payout match Stripe; the one mismatch is
  **minimum_balance** (Stripe balance 0 CAD, figure 0.48 CAD), which step 27's first line clears.
  Nothing was written or alerted (dry run).
- **A fresh backup first.** `run-job.sh backup --now` wrote `peanutgallery-20261002T001156Z.tar.age`
  (`backup: done`) before the migration history was touched.
- **The migration history (step 20).** `supabase@2.117.0 link` to the project, then `migration repair`:
  the stray `20260915012546` reverted and all 35 repository versions marked applied. `migration list
  --linked` afterwards: 35 rows, 35 with local equal to remote, none local-only, none remote-only.
  From now on migrations can go through `supabase db push`.
- **`KEYS.md` (step 22).** Moved to `~/.Trash` (not deleted); it is no longer in the repository folder.
- **Gmail (step 25).** The mailbox signed in on this Mac's Chrome lists only itself under Send mail as
  and has no signature. hello@clayhouse.studio is not signed in there.
- **Stripe settings (step 27).** Chrome refused my request to open Stripe's settings page, so I made no
  Stripe settings change and tried no other route; they stay yours.

#### Stripe settings: 1 October 2026

Step 27, closed. What you did, what I checked, and what you decided:

- **Minimum balance (you).** Turned on at 1.00 CAD, above the Controller's 0.48 CAD figure, so it
  covers the reserve and fees with room to spare. I cannot read this setting with the read key, so it
  rests on your word; the Controller's next dry run after a payout shows whether the balance is held. Correction
  to my earlier note: the dry run's one mismatch (Stripe balance 0 CAD against a 0.48 CAD figure) is
  not cleared by turning the setting on. The whole $1 was paid out, so there is nothing to hold; it
  clears once a payout leaves the held amount. Until then the daily Controller run (07:07) reports it.
- **Adaptive Pricing (researched, no change).** See Reference 12: leave it alone. Evidence: Stripe's
  docs (always on for Payment Links; the session and payment stay in the price's currency; needs the
  price currency to be a settlement currency), the account's balance in CAD only, the live Contribute
  link shown at `$5.00` with a French test location, and the one completed session in `usd` with no
  `presentment_details`. Read-only: one `GET /v1/balance`, one `GET` of completed sessions, one page
  load. No Stripe write.
- **The test payment refund and the email to Stripe support (you).** Not doing either.

#### Passkeys and the board sign-in: 1 October 2026

Steps 29 and 30.

- **Passkeys (step 29, you).** You said they are on, for the nine accounts. I cannot see inside those
  accounts, so this rests on your word.
- **The board sign-in (step 30, you).** You said it worked. Checked: `board_members.last_seen_at` for
  the board member reads 2026-10-02 00:43:15 UTC, two minutes before the read, the first since 20
  September. The sign-in email through Resend therefore arrived.
- **The hello@ group (step 25), created by you, not yet working.** You created `Hello` at the contact
  address. Read back in the Admin console on 1 October 2026: 0 members, access type Public (all
  organisation members can post; external members not allowed), and the settings matrix has External
  unticked in **Who can post**. No hello@ mail can be delivered or accepted until step 25's first two
  lines are done. I tried to tick External; the browser tool refused to change group access, so I
  stopped. The earlier `support@` group no longer appears in the Groups list; I did not touch it. My
  own attempts to create the group and the alias had failed in that browser tab, and nothing was created
  by me.

#### The platform lane, the credit limit, GitHub Actions and the floor session's start: 1 October 2026

Steps 31, 32 and 34 done by me, the payouts check in step 37, and the start of step 41. Checked, not just
done:

- **The platform lane (step 31).** After a database dump at 01:08 UTC, `update public.studio_state set
  platform_lane_open = true where id = 1` through the Management API query endpoint answered
  `[{"platform_lane_open":true}]`. Read back: `public_studio` true; `/api/live` shows
  `studio.platform_lane_open` true; the board site's Studio panel reads "Studio code lane: open."
  The studio is still paused, so nothing builds. Undo: the same update with `false`.
- **The daily credit limit (step 32).** `studio_state.credit_studio_daily_cap_usd` is 500, the default;
  the board site's Studio panel reads "Studio daily limit on immediate credit $500.00". Kept.
- **GitHub Actions (step 34).** I dispatched the read-only `janitor` workflow (run 36949823035). Its
  `links` job ran 5 steps and passed; its `osv` job ran 6 steps and failed on a real finding (the
  `fflate` advisory under **Later**). The 28 September run, refused for billing, had no steps. So the
  minutes are back; `gh workflow enable gate` made the gate `active`, and every pull request now merges on
  the Actions gate.
- **The live check.** `PASS live-check https://mobmachine.games passed=281 failed=0 skipped=0`.
- **Payouts (step 37).** The Controller's dry run read a paid payout, 0.94 CAD, arriving on 22 September
  2026, so payouts are on and the bank account works.
- **The floor session (step 41), started and stopped.** A dump at 01:08 UTC
  (`~/peanutgallery-dumps/pre-card-floor-20261002T010826Z.dump`, 950,661 bytes, mode 0600). Before it,
  `card_supply()` read open 6, big 0, small 6, short_big 1. The attended dispatcher refused to start with
  exit 78 because `.git/config` carried `extensions.worktreeConfig`; no worktree config existed (one
  worktree, no `config.worktree`), so I removed the key. It then started (`dispatcher lease held`,
  `claude code is on its pin` 2.1.283, `dispatcher started` mode attended), ran one scheduled
  `upkeep_merge` job that succeeded, and slept because the studio is paused. I stopped it with SIGINT:
  `dispatcher stopped`, `unfinished: 0`, and no process left. Draft to the floor was not pressed: my
  browser session on the board site was at the first factor and showed the **Two-factor sign-in** panel,
  which needs your authenticator code.

#### The fflate advisory, robots.txt and the sitemap: 2 October 2026

Nothing of yours; recorded so the list above stays honest.

- **The `fflate` advisory.** `fflate` 0.8.2 (GHSA-px8p-9vwx-vf98, High) is bumped to 0.8.3 in
  `platform/dispatcher/package.json` and the lockfile. The dispatcher's tests: 872 passed.
- **robots.txt and sitemap.xml** (`docs/specs/robots-sitemap.md`). Both paths answered with the page's
  HTML; the site now serves real files, ready for step 6's sitemap submission.
