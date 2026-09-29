# Kyle's setup: everything left, step by step

Everything only you can do, in order. Do one step, send me the **Tell me** line, and move on.
The full detail for each step is in `docs/BOARD-SETUP.md` (step numbers in brackets).

**Two rules**

- Never paste a key, token, password or URL into the chat. Put it in the file the step names:
  `.env` or `.env.vps`, both in `~/GitHub/peanutgallery`.
- If a screen doesn't match these words, tell me what you see instead of guessing.

**Already done, nothing to do:** the contact email, the host and read-only GitHub tokens, the
dispatcher's healthchecks.io check, the backup key, the backup login's database address, the
ntfy topic, the Terms review, Stripe's public details, the rename of the site itself, and
`brew install libpq age` (both are on the Mac).

**Checked on 29 September 2026, still open:** no `RESEND_SMTP_KEY`, `STRIPE_READ_KEY`,
`DISCORD_WEBHOOK_SHIPS`/`_WEEKLY`, `MODERATOR_EMAIL`, `SUPABASE_DB_PASSWORD`, `BACKUP_DIR` or
`BACKUP_HEALTHCHECK_URL`; no `peanutgallery-backups` folder in Drive; the backup key is still on the
Mac; Claude Code is not pinned; nobody has signed in on the board site; the Discord server is still
called Peanut Gallery with no icon; GitHub Actions is still refusing jobs; `KEYS.md` is still there.

---

## Part 1: The new domain (start here)

Do the domain first: the sign-in email (Part 3) and the Stripe links (Part 5) are then set up once, on
the new address, instead of twice. Supabase needs nothing: sign-in lives on the board's own site,
which has no custom domain.

1. **Register the domain.** [R5]
   1. Register it at GoDaddy, where peanutgallery.games is, so all DNS stays in one place. Turn on
      auto-renew and the registrar lock.
   2. Keep peanutgallery.games registered and on auto-renew. Old links, shared previews and search
      results keep reaching the studio through a permanent redirect.
   3. A domain costs money, so this is an exception to "everything free" (`docs/PLAN.md` §10
      decision 35). I record it as a decision in the domain's pull request.

   **Tell me:** "The domain is <name>." I start the domain's pull request straight away (step 4).

2. **Add it to the site on Netlify** (safe right away: the site answers on both addresses and nothing
   changes for visitors). [R6]
   1. app.netlify.com → site **peanutgallerygames** → **Domain management** → **Add a domain** →
      type the new domain → **Verify** → **Add domain**. It joins the list beside
      peanutgallery.games. If `www.<new domain>` doesn't appear on its own, add it the same way.
      Don't set it as primary yet.
   2. GoDaddy → the new domain → **DNS**. Delete GoDaddy's default "Parked" A record for `@` and the
      default `www` CNAME, then add:
      - **A**, name `@`, value `75.2.60.5`
      - **CNAME**, name `www`, value `peanutgallerygames.netlify.app`

      These are the same records peanutgallery.games uses today. If Netlify lists different values
      beside the new domain, use Netlify's.
   3. Back in Netlify, wait until the new domain stops saying "Pending DNS verification" (minutes,
      sometimes an hour). Then **HTTPS** → **Verify DNS configuration**, and wait for "Your site has
      HTTPS enabled".
   4. Check: https://<new domain> opens the site with a padlock.

   **Tell me:** "The domain has HTTPS on Netlify."

3. **The game's address.** Today the game lives at `peanutgallery-seed-1.netlify.app`. My
   recommendation is `play.<new domain>`, so the game carries the studio's name too; the netlify.app
   address keeps working for old links. To keep the netlify.app address instead, skip this step and
   tell me "keep the game's address".
   1. Netlify → site **peanutgallery-seed-1** → **Domain management** → **Add a domain** →
      `play.<new domain>` → **Verify** → **Add domain**.
   2. GoDaddy → the new domain → DNS → add a **CNAME**, name `play`, value
      `peanutgallery-seed-1.netlify.app`.
   3. Wait for HTTPS as in step 2.3. Check: https://play.<new domain> opens Dust.

   **Tell me:** "play.<domain> has HTTPS" (or "keep the game's address").

4. **Nothing for you: the domain's pull request.** I run the domain half of `docs/specs/rename.md`:
   every public page, link preview, launch draft and the social cuts of the explainer video move to
   the new address; the agents' commit address moves; peanutgallery.games and www redirect to the same path
   on the new domain; the game's link follows step 3; the cards in the database that name the old
   address are fixed, with a backup first; the live check learns the new address. It merges on the
   local gate once steps 2 and 3 have HTTPS. I tell you when it is live.

5. **Make the new domain primary,** once I say the pull request is live. Netlify → site
   **peanutgallerygames** → Domain management → beside the new domain: **Options** → **Set as
   primary domain**. Leave peanutgallery.games in the list; the redirect needs it there.

   **Tell me:** "The new domain is primary."

6. **Stripe's links.** Stripe still sends people to peanutgallery.games (the redirect would catch
   them, but set them straight).
   1. Settings → **Business** → **Public details**: change the **Business website**, **Terms of
      service** and **Privacy policy** URLs from peanutgallery.games to the new domain (same paths:
      `/terms`, `/privacy`). If a support URL is set, the same. Save.
   2. **Payment Links** → the link → **After payment** → **Don't show confirmation page** → redirect
      to `https://<new domain>/thanks?session={CHECKOUT_SESSION_ID}`, typed exactly like that,
      curly braces included. Save. [12]

   **Tell me:** "Stripe points at the new domain." I then check the redirect and the live site, and
   the next real payment should land on /thanks.

7. **Optional, free: tell Google.** In Google Search Console, add both domains as properties and use
   **Settings** → **Change of address** from peanutgallery.games to the new one. It moves search
   results over faster. Nothing depends on it.

---

## Part 2: Nightly backups (about 15 minutes)

Contributions are open, so the money database needs a backup every night. Right now it has none. [3]

8. **Make the backup folder.** Google Drive for desktop is already installed (three accounts are
   signed in). In the Drive of the Google account you want the backups in, make a folder in My Drive
   called `peanutgallery-backups`.
9. **Make the backup check.** At healthchecks.io, add a check named `peanutgallery backup`, period
   **1 day**, grace **12 hours**. Put its ping URL in `.env.vps` as a new line:
   `BACKUP_HEALTHCHECK_URL=<the URL>`
10. **Keep the Mac awake.** System Settings → Battery → Options → turn on **Prevent automatic
    sleeping on power adapter when the display is off**. Keep it plugged in with the lid open.
11. **No surprise restarts.** System Settings → General → Software Update → Automatic updates → turn
    off installing macOS updates. Install them yourself while the studio is paused.
12. **Put the backup key somewhere safe.** Copy `~/peanutgallery-backup.key` to a USB stick you keep
    apart and into your password manager. Then delete it from the Mac. Never send it to me.

**Tell me:** "backup folder and check are ready", and which Google account the folder is in.

Then I put the folder's path in `.env`, install the nightly backup, take the first one at once and
show you the file in Drive. From then on it runs every night, and healthchecks.io emails you if a
night is missed.

---

## Part 3: Accounts and keys (about 1 hour in total)

13. **Sign-in email (Resend).** [2]
    1. Sign up at resend.com on the free plan.
    2. **Domains** → **Add domain** → a subdomain of the **new** domain, e.g. `mail.<new domain>`
       (a subdomain keeps the main domain free for any other mail later).
    3. GoDaddy → the new domain → DNS: add the records Resend shows (DKIM, SPF and the MX for that
       subdomain). Wait until Resend says **Verified**.
    4. **API Keys** → **Create API key**, permission **Sending access**. Put it in `.env` as
       `RESEND_SMTP_KEY=<key>`.

    **Tell me:** "Resend is verified and the key is in .env." I then connect Supabase's sign-in
    email to it, with the sender name Mob Machine, and send you a sign-in link to prove it arrives.

14. **Stripe read-only key.** [4]
    1. Stripe → Developers → API keys → **Create restricted key**, named `peanutgallery-reconcile`.
    2. Give it **Read** on: Balance, Balance transactions, Payouts, Charges and Refunds, Checkout
       Sessions, Payment Links, Events, Disputes. Nothing else. No Write anywhere.
    3. Put it in `.env` as `STRIPE_READ_KEY=<key>` (it starts `rk_live_`).

    **Tell me:** "Stripe read key is in .env." (I then add the daily Stripe reconciliation job.)

15. **healthchecks.io emails.** healthchecks.io → Integrations: make sure your email gets both
    checks. [6]

    **Tell me:** "both checks email me."

16. **Discord webhooks.** [7]
    1. Discord → your server → Server Settings → Integrations → Webhooks. Make one for a read-only
       `#ships` channel and one for `#weekly`.
    2. Put them in `.env` as `DISCORD_WEBHOOK_SHIPS=<url>` and `DISCORD_WEBHOOK_WEEKLY=<url>`.
    3. Server Settings → Safety Setup → turn on AutoMod.

    **Tell me:** "Discord webhooks are in .env."

17. **Netlify plan.** Netlify → Team settings → Billing. Don't change anything; just read the plan
    name. Also confirm usage notifications go to your email. [8]

    **Tell me:** "legacy Free" or "credit-based Free".

18. **Phone alerts (ntfy).** [9]
    1. Install the free **ntfy** app on your phone.
    2. In Terminal: `cd ~/GitHub/peanutgallery && grep NTFY .env.vps | cut -d/ -f4 | tr -d '\n' | pbcopy`
       (this copies the topic name).
    3. In the app: **+** → paste → Subscribe (server stays ntfy.sh).

    **Tell me:** "subscribed to ntfy". I send a test; then tell me "the test alert arrived."

19. **Pin Claude Code.** The Mac is on 2.1.283, the checked version. In Terminal: [11]

    ```sh
    cd ~/GitHub/peanutgallery && sudo bash platform/ops/mac/pin-claude-code.sh
    ```

    Enter your Mac password. It should print `PASS: claude-code pinned 2.1.283`.

    **Tell me:** "Claude Code is pinned", with the PASS line.

20. **Database password.** [25]
    1. Supabase → the project → Project Settings → Database → Database password. If you don't have
       it, **Reset database password** (this breaks nothing).
    2. Put it in `.env` on the empty line `SUPABASE_DB_PASSWORD=`.

    **Tell me:** "the database password is in .env."

21. **GitHub host token renewal.** The host token expires on 23 October 2026. Before then: GitHub →
    Settings → Developer settings → Fine-grained tokens → `peanutgallery-vps` → **Regenerate token**.
    Replace the value of `VPS_GITHUB_TOKEN` in `.env.vps`. [5.1]

    **Tell me:** "the host token is regenerated."

22. **Delete `KEYS.md`.** Tell me first; I confirm both keys in it are in `.env` (by length only),
    then you delete `~/GitHub/peanutgallery/KEYS.md`. It can't be undone.

    **Tell me:** "delete KEYS.md?", then "KEYS.md is deleted."

---

## Part 4: The name, Mob Machine, everywhere else (about 20 minutes)

The icon file for these steps is `platform/site/public/icon-512.png` in the repository (also at
https://peanutgallery.games/icon-512.png).

23. **Stripe.** [R1]
    1. Settings → Business → Public details: public business name `Mob Machine`, statement
       descriptor `MOB MACHINE` (shortened: `MOBMACHINE`). Save.
    2. Settings → Business → Branding → Icon → upload `icon-512.png`. Save.
    3. Product catalog → the product the Payment Link sells → if its name or description has the old
       name, change it to Mob Machine.

    **Tell me:** "Stripe says Mob Machine."

24. **Discord** (still called Peanut Gallery). Server name → Server Settings → Server Profile. Name
    `Mob Machine`, icon `icon-512.png`, Save Changes. The invite link keeps working. [R2]

    **Tell me:** "Discord is renamed."

25. **Email signature.** In the mail app that sends as hello@clayhouse.studio, change the signature
    to say Mob Machine. [R3]

    **Tell me:** "The signature says Mob Machine."

26. **Twitch (optional, whenever).** The channel is still `peanut_gallery_games`. If you rename it,
    tell me the new handle so it goes in the repository.

---

## Part 5: Before you tell anyone (about 45 minutes)

27. **Stripe settings.** [12]
    1. Settings → Payouts → **Minimum balance**: turn it on.
    2. Settings → Payments → **Adaptive Pricing**: make sure it's off.
    3. Payment Link → Options → turn on **Require customers to accept your terms of service**.
    4. The after-payment redirect is step 6. If you haven't done Part 1 yet, set it to
       `https://peanutgallery.games/thanks?session={CHECKOUT_SESSION_ID}` for now.
    5. Payments → your $1.00 test payment of 15 September 2026 → **Refund**.
    6. Email Stripe support: "supporters fund specific development tasks on an AI-built free game; no
       rewards. Does a restricted category apply?" Keep their reply.

    **Tell me:** "Stripe settings done", and Stripe's reply when it comes.

28. **Retire the full Stripe key,** only when I say I've moved the webhook off it: Stripe →
    Developers → API keys → **Roll key** on the secret key. [13]

    **Tell me:** "secret key rolled."

29. **Passkeys.** Turn on passkeys or a hardware key, and remove SMS recovery, on: Stripe, GitHub,
    Supabase, Netlify, Anthropic (the studio organisation), Google, GoDaddy, Resend, Discord. Where
    there's no passkey, use an authenticator app. [15]

    **Tell me:** "passkeys are on."

30. **Sign in to your board site.** In Terminal: `grep BOARD_SITE_URL ~/GitHub/peanutgallery/.env`
    shows its address. Open it, bookmark it, sign in by email link and your authenticator code.
    Nothing that needs you signed in (Draft to the floor, role jobs, the visual review) can run until
    you do. [17]

    **Tell me:** "signed in on the board site."

31. **Open the platform lane,** right after step 30. [26]

    **Tell me:** "open the platform lane" (or "keep it closed").

32. **Daily credit limit.** Keep $500, or set another number in the Caps form on the board site.
    [18]

    **Tell me:** "keep $500", or the number you set.

33. **A moderator (optional).** Add `MODERATOR_EMAIL=<their address>` to `.env`, then give them a
    moderator role in Discord. [16]

    **Tell me:** "moderator email is in .env."

---

## Part 6: Launch, in this order

34. **GitHub Actions back.** Cards (the studio's own work) only merge on the Actions gate, so the
    first player-funded card can't ship until it's back. The last run was still refused. Pick one:
    [Standing items, GitHub Actions minutes]
    - **Wait** for the included minutes to reset at your next GitHub billing date. Free.
    - **Make the repository public:** GitHub → the repository → Settings → General → Danger Zone →
      Change visibility → Make public. Free, but everything in it, history included, becomes
      readable by anyone.
    - **Add an Actions budget:** GitHub → your picture → Settings → Billing and licensing → Budgets
      and alerts. A spend, so an exception to decision 35.

    **Tell me:** "Actions is back", and which one. I switch the gate back on.

35. **Restore drill** (10 minutes). Bring the USB stick with the backup key. I restore a backup and
    prove it's intact, then the key goes back offline. [19]

    **Tell me:** "ready for the restore drill."

36. **The first player.** Share the site quietly (my recommendation), or go live and announce first.
    Your own money never counts. [20]

    **Tell me:** "share quietly" or "announce first", then "shared".

37. **First payout.** Stripe → Balances: make sure payouts are on and the bank account is verified.
    Wait for a payout that includes a player's money (it can take 7 to 14 days). [21]

    **Tell me:** "payouts are on", then later "the first payout arrived".

38. **Buy Console credit** from that payout, never your own money. The board site's Needs you inbox
    shows the amount. [22]
    1. console.anthropic.com → switch to the **studio** organisation.
    2. Billing → buy the amount shown. Keep auto-reload **off**; set the monthly limit to the cap on
       the board site.
    3. Board site → Needs you → **Fill in the record form** → **Record purchase**.
    4. Tell me the tier on the Console's Limits page.
    5. Stripe → Settings → Payouts → raise Minimum balance to the figure the inbox shows.

    Repeat after every payout. **Tell me:** "credit bought and recorded", and the tier.

39. **Cutover** (about 20 minutes together, then a day). I prompt you at each point: [23]
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

40. **Go live.** Once the first player-funded card ships, press **Go live** on the board site (it
    works once and can't be undone). Edit my drafts in `docs/launch/` so they sound like you, add
    the clip's link, and post them in the order in `docs/launch/README.md`. [24]

    **Tell me:** "gone live".

---

## Your calls, nothing waits on them

- **Kill-condition pivots:** "keep the pivots", or the ones you want for a site-first studio.
- **Google Cloud billing account,** to move the dispatcher off your Mac.
- **From the 28 September QA pass** (write-ups in `~/peanutgallery-launch/qa-2026-09-28/`): the
  lookalike-letter deny-list patch (I'd skip it), the same kernel shadow rule for the dispatcher,
  sharper Dust text on phones, and a test on real Safari.
- **Paid advice:** an accountant session on HST and income tax, and Ontario business-name
  registration for Mob Machine.
