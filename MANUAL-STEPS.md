# Manual steps for Kyle: accounts, keys and access

Do these in order. After each one, tell Claude "done" and Claude checks it.

Never paste a key or secret into chat. Keys go into the website's settings, or into the `.env` file in this repo.

## 1. Bluesky key (optional)

1. Go to https://bsky.app and sign in to the studio's account (create one first if needed).
2. Go to https://bsky.app/settings/app-passwords
3. Click **Add App Password**, name it `mobmachine-marketing`, leave direct-message access **off**, and click **Next**.
4. Open `.env` in this repo and add two lines:
   ```
   BLUESKY_HANDLE=yourhandle.bsky.social
   BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
   ```
5. Save the file.

## 2. Mastodon key (optional)

1. Sign in to the studio's Mastodon account.
2. Go to Preferences → Development (the address is `https://<your-instance>/settings/applications`).
3. Click **New application** and name it `Mob Machine marketing`.
4. Under Scopes, untick everything, then tick only `write:statuses`.
5. Click **Submit**, open the app, and copy **Your access token**.
6. Open `.env` in this repo and add two lines:
   ```
   MASTODON_INSTANCE_URL=https://mastodon.social
   MASTODON_ACCESS_TOKEN=<the token>
   ```
7. Save the file.

After steps 1 and 2, tell Claude. Claude rebuilds `MARKETING_ENV` with the new keys and shows you a dry run first. Discord already posts.

## 3. Switch to the Clayhouse Anthropic key (on 2026-10-27)

A reminder fires that day.

1. Go to https://console.anthropic.com and switch to the Clayhouse organization.
2. Open **Billing** and check the monthly credit has arrived.
3. Open **API Keys**, click **Create Key**, and name it `mobmachine-studio`.
4. Open `.env` and replace the old Anthropic key's value with the new key.
5. Tell Claude. Claude puts it into the dispatcher and confirms the agents run on it.
6. Only after Claude confirms, delete the old key in the old organization.

## 4. Optional, whenever

- **GitHub token permission:** go to https://github.com/settings/personal-access-tokens, open the dispatcher's token, and under **Account permissions** set **Plan** to **Read only**. Save. (Today one check couldn't read your Actions minutes without it.)
- **USD bank account in Stripe:** Settings → Payouts → External accounts → Add. Saves the 2% conversion fee on each payout.
- **Leaked-password protection** needs Supabase Pro (skipped for now).

---

## Done

- **Google sign-in (2026-10-20):** Claude set up the Google Auth Platform on the Google Cloud project `peanut-gallery-509513`, with branding, privacy and terms links and authorized domains. It created the "Mob Machine web" client, loaded it into Supabase from the downloaded file (the file is deleted) and published the app, so it's in production. Check: `/api/community/auth/settings` returns `{"signIn":true,"providers":["google"]}`. The support email is kyle@clayhouse.studio, because the existing hello@ group doesn't list you as owner. Make yourself Owner in Admin → Groups → Hello if you want hello@ instead.
- **GitHub sign-in (2026-10-20):** Claude created the "Mob Machine" OAuth app (client `Ov23liDgCjWBd6iOvkcf`) and loaded it into Supabase. Check: `/api/community/auth/settings` returns `{"signIn":true,"providers":["google","github"]}`, /sign-in shows "Continue with Google" and "Continue with GitHub", and `/auth/v1/authorize?provider=github` answers 302 to github.com. Housekeeping: delete the older, unused client secret (ending `1528dd20`) on the GitHub app page.
- **Old promo poster (checked 2026-10-20):** already off. `promo.yml` in AlreadyKyle/mobmachine-ops is `disabled_manually`, and that repo has no `PROMO_ENV` secret, so nothing can double-post.
- **Marketing engine, Discord channel (2026-10-20):** Claude built `MARKETING_ENV` (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NTFY_TOPIC_URL, DISCORD_WEBHOOK_SHIPS) and set it on the `ops` environment. Dry run: `PASS: marketing (dry run): discord would post 0, failed 0, skipped 0, waiting 0; bsky not set; mastodon not set`. Run 39483172611 on Actions: `marketing exited 0 (PASS)`.
- **Backups off GitHub (2026-10-20):** Claude, signed in with gcloud as the project's owner, set up the Google Cloud project `mob-machine` (number 1072097120782): the bucket `gs://mobmachine-backups` (us-central1, uniform access, public access prevented, a 90-day retention policy that is not locked, objects deleted at 365 days); the service account `backup-writer@mob-machine.iam.gserviceaccount.com` with only `roles/storage.objectCreator` on the bucket (it can create objects but cannot read, overwrite or delete them); the Workload Identity pool `github` with the OIDC provider `peanutgallery`, which admits only this repository (id 1369060201, owner id 193827447), the environment `ops` and `refs/heads/main`, and `workloadIdentityUser` on the service account for that repository; and a 7 CAD/month budget alert. No keys exist. The nightly backup's `offsite` job copies each backup there (`platform/ops/ops-repo/README.md`, Backups off GitHub). Optional: lock the retention policy (`gcloud storage buckets update gs://mobmachine-backups --lock-retention-period`), which cannot be undone.
- **Discord and Apple sign-in:** skipped (you chose not to set them up).

- **Anthropic credit (2026-10-20):** you confirmed the current key's organization has about $10 of credit. It stays in use until step 3.
- **Stripe minimum balance (2026-10-20):** the Stripe API reads 2.00 CAD. The "Not yet reconciled" note on /ledger goes away once the first contribution arrives.
- **New GitHub fine-grained token (added 2026-10-23):** it is the host token, `VPS_GITHUB_TOKEN` in `.env.vps` (gitignored, never committed); the old value had stopped authenticating. It goes into the Actions secrets `DISPATCHER_ENV` (environment `dispatcher`) and `QUOTA_ENV` (environment `ops`). It has no **Plan: Read** yet (the step above), so the quota check's Actions-minutes read still gets a 403 until that is added; editing the token keeps its value. It expires around **2027-01-21**: regenerate it before then (BOARD-SETUP.md, Reference: the GitHub tokens) and replace the value in `.env.vps` and both secrets.
