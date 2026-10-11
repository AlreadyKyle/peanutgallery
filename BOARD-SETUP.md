# Board setup: the human and legal duties

The studio acts on its own (`docs/PLAN.md` §10 decision 74) and never waits on the board (§10
decision 66). Claude sessions and the studio merge gated pull requests, apply migrations, make Stripe
calls, add price-table rows and spend inside the kernel's money caps, each recorded on the ledger. What
is left on this page needs a human or legal identity, and nothing else. The duties reach the board by
ntfy, email and GitHub (the Controller's and the Janitor's alerts, Stripe's own emails), not through the
board's site, which is an optional admin and debug panel. If the board does none of them, the studio
pauses or stays as it is.

**Never paste a key, token, password, email address or URL into a chat.** Put it in `.env` or
`.env.vps` at the repository root; a session checks a value by prefix and length, never by printing it.

## The duties

- **After each payout: Console credit and Stripe's Minimum balance.** The Controller alerts once a
  payout leaves agent money that is not credit yet, with the amount (the remaining ceilings of funded
  cards plus overhead since the last purchase, less the credit left, never more than the agent money
  paid out and not yet converted). At console.anthropic.com, in the **studio** organisation (the one
  `STUDIO_ANTHROPIC_API_KEY` belongs to, never a personal one), buy prepaid credit for that amount with
  auto-reload off, and never with your own money (§10 decision 23). In the same visit raise Stripe's
  **Minimum balance** (Settings → Payouts) to the Controller's figure. Recording the purchase on the
  board's site is optional (§10 decisions 65 and 66).
- **The emergency fund:** convert its credit when an S1 card needs it.
- **Refunds** asked for at hello@clayhouse.studio: refund each one in Stripe within 14 days of the
  contribution. The request arrives by email; no script refunds.
- **Disputes:** answer each in Stripe before its due date. The Controller alerts, and Stripe emails
  each one with its date.
- **Legal standing:** the operator named on the legal pages, its terms, and its tax registration. Review
  GST/HST registration when cumulative contributions reach $15,000; registration is required past the
  $30,000 small-supplier threshold, and Stripe tiers with named benefits are sales, so register before
  tiers ship (`docs/PLAN.md` §5 Canada admin).
- **Accounts only a person holds:** regenerating the GitHub tokens before they expire (Reference,
  below), passkeys on every account, and the offline backup key.

## Pause when the board site is down

If Netlify has paused the sites or the board's site is down for any other reason, the Pause button is
gone with it. Two ways to stop the agents without Netlify, either one enough:

1. **Switch the dispatcher's host off.** In Terminal (`platform/ops/README.md`, The GitHub Actions
   host):

   ```sh
   gh variable set DISPATCHER_HOST --repo AlreadyKyle/peanutgallery --body off
   gh run list --repo AlreadyKyle/peanutgallery --workflow dispatcher.yml --status in_progress
   gh run cancel <run id> --repo AlreadyKyle/peanutgallery
   ```

   No run starts while it is off; healthchecks.io emails that the dispatcher is down. Set it `on` and
   start a run to bring it back.

2. **Pause the studio in the database.** Supabase dashboard → the project → **SQL Editor**, paste this
   one statement and **Run**. It does what the board site's Pause (`set_paused(true)`) does, with the
   board as the reason; the dispatcher sleeps at its next tick and the site says the board has paused
   the agents within about three minutes.

   ```sql
   update public.studio_state set paused = true, paused_by = 'sql-editor', paused_at = now(), pause_reason = 'board' where id = 1;
   ```

   Resume from the board's site once it is back.

**Change the caps by SQL.** The board site shows the caps read-only (`docs/specs/optional-board.md`).
Take a dump first (`docs/specs/money-safety.md`); the per-card maximum must not exceed the daily cap;
and unlike `set_caps`, a raw update records no board action, so the reason goes in the next pull
request:

```sql
update public.studio_state set daily_cap_usd = …, monthly_cap_usd = …, card_max_usd = … where id = 1;
```

## Reference: the GitHub tokens

Each is a fine-grained token for the peanutgallery repository only, and no two are the same
(`docs/PLAN.md` §10 decision 30). None has the Workflows permission.

1. **The host's token** (`VPS_GITHUB_TOKEN` in `.env.vps`, the dispatcher's Actions secret): Contents
   read and write, Pull requests read and write, Actions read-only, Metadata read, and under Account
   permissions, Plan read (the Actions-minutes guard). GitHub offers these tokens no Checks permission,
   so the dispatcher reads the gate's result through the Actions API. Regenerate it before it expires
   (GitHub → Settings → Developer settings → Fine-grained tokens → the token → **Regenerate token**,
   which keeps its permissions) and replace the value.
2. **The read token** (`GITHUB_READ_TOKEN` in `.env.vps`, mounted into each Managed Agents session):
   Contents read only. The unattended startup refuses to run if it can write.
3. **The Mac's token** (`GITHUB_TOKEN` in `.env`, optional): the host's permissions. The dispatcher
   refuses a token that is not fine-grained; the hand-run tools take any.

## History

This page used to be a numbered list of setup steps for the board, and older docs and code comments
still cite them ("BOARD-SETUP step 23"). Every one is done, closed or retired by §10 decisions 66 and 74.
The full list is in git: `git show 3753a62:BOARD-SETUP.md`.
