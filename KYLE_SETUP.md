# Kyle's setup: everything left, step by step

Everything only you can do, in order. Do one step, send me the **Tell me** line, and move on.
The full detail for each step is in `docs/BOARD-SETUP.md` (step numbers in brackets).

**Two rules**

- Never paste a key, token, password or URL into the chat. Put it in the file the step names:
  `.env` or `.env.vps`, both in `~/GitHub/peanutgallery`.
- If a screen doesn't match these words, tell me what you see instead of guessing.

**Already done, nothing to do:** the contact email, the host and read-only GitHub tokens, the
dispatcher's healthchecks.io check, the backup key, the backup login's database address, the
ntfy topic, the Terms review, Stripe's public details, and the rename of the site itself.

---

## Part 1: Nightly backups (do this first, about 15 minutes)

Contributions are open, so the money database needs a backup every night. Right now it has none.

1. **Make the backup folder.** Install Google Drive for desktop (google.com/drive/download) and sign
   in. In My Drive, make a folder called `peanutgallery-backups`.
2. **Make the backup check.** At healthchecks.io, add a check named `peanutgallery backup`, period
   **1 day**, grace **12 hours**. Copy its ping URL into `.env.vps` as a new line:
   `BACKUP_HEALTHCHECK_URL=<the URL>`
3. **Keep the Mac awake.** System Settings → Battery → Options → turn on **Prevent automatic sleeping
   on power adapter when the display is off**. Keep it plugged in with the lid open.
4. **No surprise restarts.** System Settings → General → Software Update → Automatic updates → turn
   off installing macOS updates. Install them yourself when the studio is paused.
5. **Put the backup key somewhere safe.** Copy `~/peanutgallery-backup.key` to a USB stick you keep
   apart and into your password manager. Then delete it from the Mac. Never send it to me.

**Tell me:** "backup folder and check are ready."

Then I put the folder's path in `.env`, run `install.sh --jobs-only`, take the first backup right
away and show you the file in Drive. From then on it runs every night by itself, and healthchecks.io
emails you if a night is missed. [3]

---

## Part 2: Accounts and keys (about 1 hour in total)

6. **Sign-in email (Resend).** [2]
   1. Sign up at resend.com on the free plan.
   2. Add a domain: the sending subdomain of peanutgallery.games that Resend suggests.
   3. In GoDaddy → peanutgallery.games → DNS, add the records Resend shows. Wait until Resend says
      verified.
   4. Create an SMTP key and put it in `.env` as `RESEND_SMTP_KEY=<key>`.

   **Tell me:** "Resend is verified and the key is in .env."

7. **Stripe read-only key.** [4]
   1. Stripe → Developers → API keys → **Create restricted key**, named `peanutgallery-reconcile`.
   2. Give it **Read** on: Balance, Balance transactions, Payouts, Charges and Refunds, Checkout
      Sessions, Payment Links, Events, Disputes. Nothing else. No Write anywhere.
   3. Put it in `.env` as `STRIPE_READ_KEY=<key>` (it starts `rk_live_`).

   **Tell me:** "Stripe read key is in .env." (I then add the daily Stripe reconciliation job.)

8. **healthchecks.io emails.** In healthchecks.io → Integrations, make sure your email gets both
   checks. [6]

   **Tell me:** "both checks email me."

9. **Discord webhooks.** [7]
   1. Discord → your server → Server Settings → Integrations → Webhooks. Make one for a read-only
      `#ships` channel and one for `#weekly`.
   2. Put them in `.env` as `DISCORD_WEBHOOK_SHIPS=<url>` and `DISCORD_WEBHOOK_WEEKLY=<url>`.
   3. Server Settings → Safety Setup → turn on AutoMod.

   **Tell me:** "Discord webhooks are in .env."

10. **Netlify plan.** Netlify → Team settings → Billing. Don't change anything; just read the plan
    name. Also confirm usage notifications go to your email. [8]

    **Tell me:** "legacy Free" or "credit-based Free".

11. **Phone alerts (ntfy).** [9]
    1. Install the free **ntfy** app on your phone.
    2. In Terminal: `cd ~/GitHub/peanutgallery && grep NTFY .env.vps | cut -d/ -f4 | tr -d '\n' | pbcopy`
       (this copies the topic name).
    3. In the app: **+** → paste → Subscribe (server stays ntfy.sh).

    **Tell me:** "subscribed to ntfy". I send a test; then tell me "the test alert arrived."

12. **Pin Claude Code.** In Terminal: [11]

    ```sh
    cd ~/GitHub/peanutgallery && sudo bash platform/ops/mac/pin-claude-code.sh
    ```

    Enter your Mac password. It should print `PASS: claude-code pinned`.

    **Tell me:** "Claude Code is pinned", with the PASS line.

13. **Database password.** [25]
    1. Supabase → the project → Project Settings → Database → Database password. If you don't have
       it, **Reset database password** (this breaks nothing).
    2. Put it in `.env` on the empty line `SUPABASE_DB_PASSWORD=`.

    **Tell me:** "the database password is in .env."

14. **GitHub host token renewal.** The host token expires on 23 October 2026. Before then: GitHub →
    Settings → Developer settings → Fine-grained tokens → `peanutgallery-vps` → **Regenerate token**.
    Replace the value of `VPS_GITHUB_TOKEN` in `.env.vps`. [5.1]

    **Tell me:** "the host token is regenerated."

---

## Part 3: The name, Mob Machine (about 20 minutes; skip any you've already done)

The icon file for these steps is `platform/site/public/icon-512.png` in the repository.

15. **Stripe.** [R1]
    1. Settings → Business → Public details: public business name `Mob Machine`, statement
       descriptor `MOB MACHINE` (shortened: `MOBMACHINE`). Save.
    2. Settings → Business → Branding → Icon → upload `icon-512.png`. Save.
    3. Product catalog → the product the Payment Link sells → if its name or description has the old
       name, change it to Mob Machine.

    **Tell me:** "Stripe says Mob Machine."

16. **Discord.** Server name → Server Settings → Server Profile. Name `Mob Machine`, icon
    `icon-512.png`, Save Changes. [R2]

    **Tell me:** "Discord is renamed."

17. **Email signature.** In the mail app that sends as hello@clayhouse.studio, change the signature
    to say Mob Machine. [R3]

    **Tell me:** "The signature says Mob Machine."

---

## Part 4: The new domain (when you choose; a domain costs money)

Nothing waits on this. The site works at peanutgallery.games until you do it.

18. **Register the domain.** [R5]
    1. Register it at GoDaddy (where peanutgallery.games is).
    2. Keep peanutgallery.games registered and on auto-renew, so old links keep working.

    **Tell me:** "The domain is <name>." I then make the pull request that switches the site to it
    and redirects peanutgallery.games there.

19. **Point it at the site,** once I say that pull request is ready. [R6]
    1. app.netlify.com → site **peanutgallerygames** → Domain management → **Add a domain** → type
       the new domain → Verify → Add domain. Do the same for `www.` plus the domain.
    2. At GoDaddy, add the DNS records Netlify lists. Wait until Netlify stops saying "Pending DNS
       verification".
    3. Beside the new domain: Options → **Set as primary domain**. Leave peanutgallery.games in the
       list.
    4. HTTPS → **Verify DNS configuration**. Wait for "Your site has HTTPS enabled". Open
       https://<new domain> and check for the padlock.
    5. Stripe → Payment Links → the link → After payment: change `https://peanutgallery.games` in the
       redirect to `https://<new domain>`, leaving the rest as it is.

    **Tell me:** "The domain is live on Netlify." I merge the pull request and check the live site.

---

## Part 5: Before you tell anyone (about 45 minutes)

20. **Stripe settings.** [12]
    1. Settings → Payouts → **Minimum balance**: turn it on.
    2. Settings → Payments → **Adaptive Pricing**: make sure it's off.
    3. Payment Link → Options → turn on **Require customers to accept your terms of service**.
    4. Payment Link → After payment → redirect to
       `https://peanutgallery.games/thanks?session={CHECKOUT_SESSION_ID}` (use the new domain
       instead if Part 4 is done).
    5. Payments → your $1.00 test payment of 15 September 2026 → **Refund**.
    6. Email Stripe support: "supporters fund specific development tasks on an AI-built free game; no
       rewards. Does a restricted category apply?" Keep their reply.

    **Tell me:** "Stripe settings done", and Stripe's reply when it comes.

21. **Retire the full Stripe key,** only when I say I've moved the webhook off it: Stripe →
    Developers → API keys → **Roll key** on the secret key. [13]

    **Tell me:** "secret key rolled."

22. **Passkeys.** Turn on passkeys or a hardware key, and remove SMS recovery, on: Stripe, GitHub,
    Supabase, Netlify, Anthropic (the studio organisation), Google, GoDaddy, Resend, Discord. Where
    there's no passkey, use an authenticator app. [15]

    **Tell me:** "passkeys are on."

23. **Sign in to your board site.** In Terminal: `grep BOARD_SITE_URL ~/GitHub/peanutgallery/.env`
    shows its address. Open it, bookmark it, sign in by email link and your authenticator code. [17]

    **Tell me:** "signed in on the board site."

24. **Open the platform lane,** right after step 23. [26]

    **Tell me:** "open the platform lane" (or "keep it closed").

25. **Daily credit limit.** Keep $500, or set another number in the Caps form on the board site.
    [18]

    **Tell me:** "keep $500", or the number you set.

26. **A moderator (optional).** Add `MODERATOR_EMAIL=<their address>` to `.env`, then give them a
    moderator role in Discord. [16]

    **Tell me:** "moderator email is in .env."

---

## Part 6: Launch, in this order

27. **Restore drill** (10 minutes). Bring the USB stick with the backup key. I restore a backup and
    prove it's intact, then the key goes back offline. [19]

    **Tell me:** "ready for the restore drill."

28. **The first player.** Share the site quietly (my recommendation), or go live and announce first.
    Your own money never counts. [20]

    **Tell me:** "share quietly" or "announce first", then "shared".

29. **First payout.** Stripe → Balances: make sure payouts are on and the bank account is verified.
    Wait for a payout that includes a player's money (it can take 7 to 14 days). [21]

    **Tell me:** "payouts are on", then later "the first payout arrived".

30. **Buy Console credit** from that payout, never your own money. The board site's Needs you inbox
    shows the amount. [22]
    1. console.anthropic.com → switch to the **studio** organisation.
    2. Billing → buy the amount shown. Keep auto-reload **off**; set the monthly limit to the cap on
       the board site.
    3. Board site → Needs you → **Fill in the record form** → **Record purchase**.
    4. Tell me the tier on the Console's Limits page.
    5. Stripe → Settings → Payouts → raise Minimum balance to the figure the inbox shows.

    Repeat after every payout. **Tell me:** "credit bought and recorded", and the tier.

31. **Cutover** (about 20 minutes together, then a day). I prompt you at each point: [23]
    1. You: **Pause** on the board site.
    2. Me: stop the attended dispatcher, set up the managed agent, move the backup-only copy of the
       code aside and install the dispatcher on your Mac.
    3. You: set the agent mode to **unattended** on the board site.
    4. Me: start it and check it.
    5. You: check the board site says the dispatcher was seen in the last 3 minutes, and that
       healthchecks.io is green. Confirm the test alert reached your phone.
    6. You: **Resume**.
    7. Me: restart and kill tests. You: log out and back in. Then a 24-hour soak with the lid open.

    **Tell me:** "ready for the cutover".

32. **Go live.** Once the first player-funded card ships, press **Go live** on the board site (it
    works once and can't be undone). Edit my drafts in `docs/launch/` so they sound like you, add
    the clip's link, and post them in the order in `docs/launch/README.md`. [24]

    **Tell me:** "gone live".
