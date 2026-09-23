# Board setup: everything that needs Kyle

Every step that only the board can take, in the order that gets the studio to Go live. Each one
says why it is needed, exactly what to do, how you know it worked, and what to tell me afterwards.

Sources: `docs/ROADMAP.md` (the launch checklist), `docs/PLAN.md` §10 (the decisions),
`platform/ops/README.md` (the runbook, with The Mac host at its end), `docs/specs/mac-host.md`, `.env.example`.

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

This list replaces the item numbers used before 22 September 2026. The **Done** entries at the
bottom keep their old numbers.

### 1. Contact email: DONE 23 September 2026

The public contact address is hello@clayhouse.studio, the board's own mailbox (`docs/PLAN.md` §10
decision 37). The site, the legal pages and Stripe's public details use it. Nothing to set up.

### 2. Alerts and GitHub access (15 minutes, free)

**Why.** Once the dispatcher runs unattended (on your Mac for now, `docs/PLAN.md` §10 decision 38),
these are how you hear that something failed, and how it and the agent sessions reach the repository
with no more access than they need.

**a. healthchecks.io.**

1. Sign up at healthchecks.io with your own email, on the free plan.
2. Add a check named `peanutgallery dispatcher`, **period 1 minute**, **grace 5 minutes**. The ops
   runbook fixes these timings, so use them exactly.
3. Under notification methods, confirm your email gets this check.
4. Copy the ping URL (`https://hc-ping.com/<uuid>`). Open `.env.vps` in the peanutgallery folder
   and add a line `HEALTHCHECK_URL=` followed by it. Save.

**b. ntfy on your phone.** The topic exists and the Stripe webhook already posts to it (see
**Done**), but your phone is not subscribed yet, so an unattended failure would not reach you.

1. Install the free **ntfy** app (App Store or Play Store).
2. In the app: **+** → paste the topic name → Subscribe, leaving the server as ntfy.sh. If the
   topic name is no longer on your clipboard, `grep NTFY .env.vps | cut -d/ -f4 | tr -d '\n' | pbcopy`
   in the Terminal tab puts it back. Anyone who knows the topic can read and post your alerts, so it
   stays out of chat.
3. Tell me, and I post a test so you see it arrive. The cutover repeats that test from the host.

**c. Three fine-grained GitHub tokens.** Each is for the peanutgallery repository only, and all
three must be different. No API creates one, but GitHub takes the settings in a link, so each link
below fills in the name, the owner AlreadyKyle, a 366-day expiry and the permissions. For each one:

- the one thing to choose by hand is Repository access → **Only select repositories** →
  `peanutgallery`;
- check the permissions list shows exactly what is written here (GitHub adds Metadata read on its
  own) and **no Workflows**;
- the token is shown once; copy it straight into the file named, never into chat.

1. **The host's token** (the unattended dispatcher, on your Mac for now and later on a server):
   Contents read and write, Pull requests read and write, Actions read-only. No Workflows. GitHub
   offers these tokens no Checks permission and ignores `checks` in the link, so add Actions by hand
   (+ Add permissions, Actions, Read-only): the dispatcher reads the gate's result through the
   Actions API (PLAN §10 decision 30). GitHub may also ignore the link's expiry; check the date it
   shows.

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-vps&description=Peanut+Gallery+VPS+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&actions=read

   Add a line `VPS_GITHUB_TOKEN=` followed by it to `.env.vps`.
2. **The read-only token for agent sessions** (it mounts the repository into each Managed Agents
   session): Contents read only.

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-read&description=Peanut+Gallery+agent+sessions,+read+only&target_name=AlreadyKyle&expires_in=366&contents=read

   Add a line `GITHUB_READ_TOKEN=` followed by it to `.env.vps`. Before the cutover I prove it
   cannot write: a push with it must answer 403, and the unattended startup refuses to run otherwise.
3. **The Mac's token** (attended runs on your Mac): the same permissions as the host's token.

   https://github.com/settings/personal-access-tokens/new?name=peanutgallery-mac&description=Peanut+Gallery+Mac+dispatcher&target_name=AlreadyKyle&expires_in=366&contents=write&pull_requests=write&actions=read

   In `.env` at the repository root, replace the value of `GITHUB_TOKEN` with it. Today that value
   is the gh command-line tool's own sign-in token (it starts `gho_`), which reaches every
   repository on your account and has no Workflows limit. You can keep the gh sign-in for your own
   use; it just must not be the value in `.env`. Unattended mode refuses a token that is not
   fine-grained, and attended mode warns about one.

**Tell me:** "healthchecks check is created", "subscribed to ntfy" and "tokens are set".

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
5. **The backup key.** In the Terminal tab:

   ```bash
   age-keygen -o ~/Desktop/peanutgallery-backup-key.txt
   ```

   It prints `Public key: age1...`. Add a line `BACKUP_AGE_RECIPIENT=` followed by that public key to
   `.env` (it is public; it only locks). The file itself is the only thing that can open a backup:
   copy it to a USB stick you keep apart and into your password manager, then delete it from the
   Desktop. It never goes in chat, in the repository or on the host.
6. **A second healthchecks.io check,** `peanutgallery backup`, **period 1 day**, **grace 12 hours**
   (the Mac makes a missed night up at its next wake). Add its ping URL to `.env.vps` as
   `BACKUP_HEALTHCHECK_URL=`.

Then I write the host's env files (they print key names only), run `platform/ops/mac/install.sh`
twice (the second run must print `install: done: 0 change(s)`), and quote the first backup and the
jobs' first runs. The dispatcher is installed but not started: starting it is the cutover (step 8).
The backup login's password and `STRIPE_READ_KEY` are production steps I ask your allow for
(`docs/specs/money-safety.md`); the backup and the Controller wait on them.

**Tell me:** "the Mac is ready."

### 4. Your call: how does the first player arrive?

**Why.** Contributions are already open: the Contribute button is live, and Go live only stamps
the launch time. The money-first order (`docs/PLAN.md` §10 decision 23) needs a player's
contribution and a Stripe payout before the cutover, and your own money never counts. Nothing tells
anyone the site exists yet, so someone has to.

- **(a) Share it quietly before Go live. My recommendation**, because it is the kick-off plan's own
  approach: the board posts from the day the page is live, and contributions before launch pre-load
  the pool. Share it through the Discord server the site already links, your own posts, or an
  invite to people you name. The site says the agents are paused until the studio resumes them. The
  formal announcement (the Reddit posts, the Show HN and the X thread) still waits for the clip and
  Go live.
- **(b) Go live and announce first**, with the studio still paused. The cost: the studio is
  announced when it cannot build anything until the payout clears, credit is bought and the cutover
  is done, and the rule that posts wait for the clip has to change, because the clip needs a card to
  ship after the cutover.

**Tell me:** "share quietly" or "announce first".

### 5. Contributions open, with the studio paused

**Why.** Player money can arrive from now on, but no agent spends it until the credit is bought
and the cutover is done.

1. The studio stays paused at /board. The site's paused notice follows Pause and Resume on its own,
   so no copy change is needed at the cutover.
2. **Confirm the studio-wide daily limit on immediate credit.** Besides the $50 a day of immediate
   agent credit per payer, all payers together get at most $500 of immediate agent credit per New
   York day, and credit above that is held 14 days, like any large contribution. $500 is the
   default. You can change it in the Caps form at /board ("Studio daily limit on immediate
   credit") with your second factor.
3. If you chose (a) in step 4, share the site now.

**Tell me:** "keep $500" (or the number you want), then "shared" if you chose (a).

### 6. The first payout

**Why.** Console credit is bought only from money Stripe has paid out (`docs/PLAN.md` §10
decision 23).

1. In the Stripe Dashboard, confirm payouts are turned on and the bank account is verified.
2. Wait for the first payout that includes a player's contribution.

**Tell me:** "payouts are on", and later "the first payout arrived".

### 7. Console credit, after this payout and after every payout from now on

**Why.** Unattended cards bill the studio organisation's key, not your Max subscription.
`STUDIO_ANTHROPIC_API_KEY` is already set in `.env`; the organisation it belongs to needs credit.

**How much.** I work it out and quote it before you buy:

1. In the Stripe Dashboard, open the payout and note when the latest charge it includes was made.
   That time is the cutoff.
2. I run
   `select coalesce(sum(agents_usd - held_usd), 0) from contributions where created_at <= '<cutoff>'`:
   the agent share, incident reserve included, of everything paid out so far, with refunds and
   disputes netted out and money still held left out until it is released.
3. The purchase is that figure minus the credit already bought (the purchases recorded at /board).
4. Fees, currency conversion and HST on the purchase, and overhead (the startup probe's model use
   and session time), come from the studio share, never from the agent money.
5. If the amount is below the Console's minimum purchase, wait for the next payout. Never add your
   own money.

**Do this.**

1. console.anthropic.com → sign in → switch to the **studio** organisation (the one that key
   belongs to, never your personal one). If you are unsure which it is, open Settings → API keys in
   each organisation and find the key whose prefix matches the one in `.env`; I can print you the
   first few characters safely if you ask.
2. **Billing** → buy prepaid credit for the amount I quoted.
3. Keep **auto-reload off** and the **monthly spend limit at $500**.
4. At /board, under **Record a credit purchase**, enter the amount, the Stripe payout id and a
   one-line reason, then **Record purchase** (second factor). The dispatcher never lets unattended
   sessions spend more than the credit recorded.
5. As the meter grows, raise the Console's monthly limit and the monthly cap at /board together.

Console credit lags the pool, so a card can wait for credit while the pool shows money. When that
happens the dispatcher pauses the studio and alerts "Console credit needed", and the next payout's
purchase clears it.

**Tell me:** "credit bought and recorded".

### 8. Cutover and soak (about twenty minutes with me, then a day)

I prompt you at each point. Only one dispatcher ever runs: the dispatcher lease guarantees it, and
from here the attended dispatcher is not started while the host runs. The runbook is
`platform/ops/README.md`, The Mac host.

1. You: **Pause** at /board.
2. Me: stop the attended dispatcher and confirm no dispatcher process is left.
3. Me: create or update the managed agent and environment with the studio key and quote their ids;
   write the host's env file with `platform/ops/make-dispatcher-env.sh` (key names only) and run
   `platform/ops/mac/install.sh` twice. The second run must print `install: done: 0 change(s)`.
4. You: set the agent mode to **unattended** at /board (second factor).
5. Me: the toolchain check from the host's code clone, quoting `PASS: toolchain`.
6. Me: `platform/ops/mac/install.sh --start`, which starts the dispatcher under launchd and waits
   for its `startup probe passed` line; I quote it. The probe is a small Managed Agents session,
   billed as overhead from the studio share.
7. You: confirm /board shows the dispatcher seen under 3 minutes ago, and healthchecks.io is green.
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

### 9. Name a moderator

**Why.** A second person who can pause the studio (and hold the kill switch once the stream
exists).

1. Add a line `MODERATOR_EMAIL=` with their address to `.env` yourself, never in chat.
2. Me: re-run the seed (`pnpm --filter @backseat/supabase seed`, safe to run again) and quote its
   `board_members` line with the address redacted.
3. The moderator signs in at /board by magic link and sees the pause control. Sign-in is refused
   until that row exists.

**Tell me:** "moderator email is in .env".

### 10. The launch clip

Record the screen as a real card goes from open to shipped, with the change visible in Dust. I
draft the posts in `docs/launch/`; you edit them so they sound like you. The posting is yours.

**Tell me:** "clip recorded".

### 11. Go live

At /board, press **Go live**. It works once and cannot be undone. Then post, in the order in
`docs/specs/announcement.md`.

---

## Standing items, outside the order

- **Console credit after every payout** (step 7), recorded at /board each time.
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

- The healthchecks.io account.
- Subscribing to the ntfy topic on your phone.
- The three fine-grained GitHub tokens.
- The Mac's power and update settings, `brew install libpq age`, Google Drive for desktop, the
  backup key and the backup check.
- The call on how the first player arrives, and the share if you choose it.
- Confirming Stripe payouts and the bank account, and the studio-wide daily credit limit.
- Buying Console credit after each payout and recording it at /board.
- Naming a moderator.
- The launch clip.
- Go live.
- Deleting the local `KEYS.md`.
- Reviewing HST registration at $15k.

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

- "healthchecks check is created."
- "subscribed to ntfy."
- "tokens are set."
- "the Mac is ready."
- "share quietly" / "announce first"
- "keep $500" (or a number) and "shared"
- "payouts are on" / "the first payout arrived"
- "credit bought and recorded"
- "ready for the cutover"
- "moderator email is in .env"
- "clip recorded"
- "keep the pivots" (or the pivots you want)
- "the Google Cloud billing account is open" (whenever you choose)

---

## Done

Newest last. Each entry says what was checked, not just that it happened. The numbers are the item
numbers used before 22 September 2026.

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
phone is still open (step 2b).

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
