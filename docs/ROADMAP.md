# Roadmap to live

The launch checklist: what stands between today and Go live, in order, each item pointing at its spec or at the board's step in `docs/BOARD-SETUP.md`. `docs/PLAN.md` is the constitution. Everything after Go live is a card: `docs/BACKLOG.md` lists the planned work, the board files it with `platform/supabase/scripts/file-backlog.ts`, and the site lists it on /roadmap. This file is updated in the same pull request that changes a spec's status. It holds no dates except those that record what happened.

## Contributions open, and Go live

These are two different states.

- **Contributions open** is true now. The Contribute button is live, and the studio is paused until the first Stripe payout buys Console credit and the dispatcher is cut over to the VPS. While the studio is paused the site says so. Before Go live the board may share the site quietly; how the first player arrives is the board's call (`docs/BOARD-SETUP.md` step 4, a quiet share recommended). A player's contribution from that share is what closes criterion 1.
- **Go live** is the board pressing Go live at /board, once every criterion below holds with its evidence quoted in the specs. It stamps the launch time and cannot be undone. The announcement follows it (`docs/specs/announcement.md`).

## What "live" means

1. **The loop works.**
   - The three test runs and the board's directives D1 to D3 (the unlock list, save and resume, the game shell) shipped through the dispatcher (`docs/specs/week1-runs.md`).
   - A real contribution from a player, never the founder's, is credited on the meter through `checkout.session.completed` or `charge.updated`.
2. **The dispatcher runs unattended.**
   - It runs on the Oracle instance, restarts on its own, holds the dispatcher lease, and alerts the board through healthchecks.io and ntfy, with a test alert received on the board's phone.
   - Card sessions run as Claude Managed Agents sessions: no agent-written code runs on the VPS, the repository is mounted read-only, and the dispatcher applies and checks the returned patch itself (PLAN.md §10 decision 25).
   - Every dispatcher secret and id is present, and provisioning and startup check it: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`), `GITHUB_TOKEN` (the VPS's own fine-grained token, never the Mac's), `GITHUB_READ_TOKEN` (contents read only; a write attempt with it answers 403), `GITHUB_REPO`, `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID_SEED`, `NETLIFY_SITE_ID_PLATFORM`, `STUDIO_ANTHROPIC_API_KEY` (the studio organisation's key, never the founder's), `MANAGED_AGENT_ID`, `MANAGED_AGENT_VERSION`, `MANAGED_ENVIRONMENT_ID`, `MODEL_BUILDER`, `MODEL_DIRECTOR`, `PRICE_TABLE_JSON`, `HEALTHCHECK_URL` and `NTFY_TOPIC_URL`.
   - Console credit bought from a Stripe payout is recorded at /board, and the unattended startup probe passes on it.
   - A card funded by a player builds with no one at the keyboard, billed to the studio.
3. **The money is safe.** Refunds and disputes reverse cleanly. Credit above $50 a day per payer (keyed on the card fingerprint), or above the studio-wide daily limit, is held for 14 days. A refund of money already spent takes the shortfall from unearmarked money first and alerts the board.
4. **The site is ready for strangers.**
   - Shipped work is visible; the Terms, Privacy, Refunds and Contact pages exist; hello@peanutgallery.games receives mail.
   - /how-it-works, /team and /roadmap are live.
   - Link previews render, and /board requires a second factor.
   - Nothing on the site describes a feature that does not exist, and no public string says "vote" except planned items on /roadmap.
   - The site shows a notice while the studio is paused.
5. **The board has pressed Go live.** The launch clip and the post drafts exist.

Everything else is in `docs/BACKLOG.md`, and none of it is part of live: for example [the stream](BACKLOG.md#twitch-channel-and-stream-scenes), [the host](BACKLOG.md#the-host), [free voting](BACKLOG.md#free-voting-on-open-cards), [personal decisions](BACKLOG.md#personal-decisions-for-contributors), [display names through the name pipeline](BACKLOG.md#the-name-pipeline), [the image adapter](BACKLOG.md#image-adapter-for-studio-pictures), [the public seed-1 mirror](BACKLOG.md#public-mirror-of-the-game-with-a-license) and [a board rollback button](BACKLOG.md#board-rollback-button).

## The order from here

1. **The launch batch** (below) is merged, and its production steps are run as each merged. Before the cutover, fix the Managed Agents stream-loss item below.
2. **Board steps 1 to 3** in `docs/BOARD-SETUP.md`: the hello@ mailbox; healthchecks.io, the ntfy subscription and the GitHub tokens; the Oracle sign-in, after which the instance is launched by script.
3. **Board steps 4 and 5**: the call on how the first player arrives, and contributions open with the studio paused.
4. **Board steps 6 and 7**: the first Stripe payout, then Console credit bought from it and recorded at /board.
5. **Board step 8, the cutover and soak.** Closes criterion 2 once a player's card builds unattended.
6. **Board steps 9 to 11**: a moderator, the launch clip, Go live.

## The launch batch (22 September 2026)

Seven pull requests built in parallel from the plan of 22 September 2026. A spec that lives in another open pull request is named by its branch until it merges.

| Work | Spec | Status | Waits on |
|---|---|---|---|
| Docs: dateless constitution, backlog, board steps, prompts (#50) | `specs/launch-docs.md` | built (the backlog seed runs after this merges) | `file-backlog.ts` against production |
| DB: horizons, board RPCs, money fixes, lease, backlog parser, public roles (#46) | `specs/launch-db.md` | built (migrations up to `20260922000400` applied, anon negative test PASS) | the roles revoke and webhook deploy after the site deploy |
| Live cards: plain titles and the launch slate (#45) | `specs/launch-cards.md` | built (`refresh-cards.ts` applied: 8 updated, 3 inserted) | nothing |
| Gate: kernel checks first, kernel list, deny-list holes (#48) | `specs/launch-gate.md` | built | a card branch run through the gate |
| Dispatcher: throttle, merge safety, metering (#49) | `specs/launch-dispatcher.md` | built | the cutover |
| Managed Agents: unattended sessions, smoke without card code (#51) | `specs/launch-managed.md` | built | Console credit and the cutover; the fix below before it |
| Site: honest copy, /how-it-works, /team, /roadmap, board controls (#47) | `specs/launch-site.md` | built | the live check on production |

**Fix before the cutover.** The Managed Agents adapter must stop and settle a session whose event stream is lost: send `user.interrupt`, poll until the session is no longer running, settle and archive it, and reset the reconnect count after a connect that delivered events (found in the finish review of 23 September 2026; `platform/dispatcher/src/adapters/managed.ts` around the `stream_lost` stop). Nothing reaches this code until the dispatcher runs unattended.

Production steps for the batch, each with the board's allow, the studio paused and no Mac dispatcher running: after the DB merge, the migrations up to `20260922000400_public_roles`, the `stripe-webhook` deploy and the anon negative test; after the live-cards merge, `refresh-cards.ts` as a dry run and then applied; after the site deploy is verified, `20260922000500_roles_revoke` and the anon negative test again; at the end, `file-backlog.ts` as a dry run and then applied, the model and price edits to `.env`, the role re-seed, the ledger identity, the live check, an attended probe and the Stripe Payment Link's field label. A close-out pull request then records the results in the specs.

## Specs by status

### Done

Every Verification line has been run and its output quoted.

| Spec | Status |
|---|---|
| `specs/working-method.md` | done |
| `specs/card-summary.md` | done |
| `specs/site-mark.md` | done |
| `specs/site-design.md` | done |
| `specs/site-layout.md` | done |
| `specs/panel-gap.md` | done |
| `specs/refunds-and-holds.md` | done |
| `specs/docs-truth.md` | done |
| `specs/webhook-hardening.md` | done |
| `specs/card-columns-and-open-funding.md` | done |
| `specs/metering-reconciliation.md` | done |
| `specs/landing-copy-and-design.md` | done |
| `specs/launch-pages.md` | done |

### Built, live check pending

Merged, with every criterion a test can prove ticked. The remaining line of each is named where its spec names one.

| Spec | Status | What is left |
|---|---|---|
| `specs/launch-hardening.md` | built | none named in the spec; moving it to done is a close-out check |
| `specs/week1-runs.md` | built | criterion 6, a player's contribution credited (criterion 1 above) |
| `specs/live-cut.md` | built | criterion 7, an unattended build, at the cutover |
| `specs/unattended-mode.md` | built | the unattended probe and a funded card with no board session, at the cutover |
| `specs/vps.md` | built | the cutover and soak (board step 8) |
| `specs/ops-separation.md` | built | the production steps, which need the VPS |
| `specs/oracle-launch.md` | built | the live run and a rerun, after the board signs in with `oci session authenticate` |
| `specs/stripe-late-fee.md` | built | `charge.updated` crediting a fresh payment, on the next real contribution |
| `specs/next-cards.md` | built | a real contribution moving a card's bar |
| `specs/stale-tab.md` | built | a tab held open across a site deploy reloads into the new build |
| `specs/gate-hardening.md` | built | two CI observations: the platform job's four new steps green, and a `card/*` pull request showing the detect guard before any install |
| `specs/merge-safety.md` | built | the three live lines, which need a card merged through the dispatcher |
| `specs/site-truth-pass.md` | built | /board two-factor enrolment watched in Chromium and Safari with DevTools open and no CSP report |
| `specs/sweep-22-sep.md` | built | none named in the spec; moving it to done is a close-out check |

### Draft

| Spec | Status | What is left |
|---|---|---|
| `specs/announcement.md` | draft | the clip, the drafts and Go live, the last steps before the announcement |

## Standing facts for any session

- **Production.**
  - Site https://peanutgallery.games (Netlify `peanutgallerygames`, base `platform/site`); game https://peanutgallery-seed-1.netlify.app (Netlify `peanutgallery-seed-1`, base `seed-1`).
  - Supabase project `lyxndueoeisyqzewflpu`.
  - Stripe webhook `we_1UFd0XICmyTP81VUCeACUWhc`.
  - The dispatcher runs attended on the founder's Mac until the cutover.
- **Money.** The pool holds customer money only. Work before the cutover runs attended on the founder's Max subscription, billed to the founder. There is no founding budget. Console credit is bought only from Stripe payouts, never with the founder's money. Everything the studio runs on is free.
- **Models.** The builders run on `claude-sonnet-5`; the directors are set to `claude-opus-5-5`, and no job runs them yet.
- **Production changes.** Migrations are applied through the Supabase Management API query endpoint. Functions deploy from `platform/` with `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api`. Both need the board's allow in auto mode. A spec that needs production steps lists them under "Production steps (need the board's allow)", and a Verification line that can run only after Console credit, the cutover or the board's second factor names what it waits on and stays unticked, with the spec at built.
- **What waits on the board.** `docs/BOARD-SETUP.md` is the step-by-step for every item that needs the board, with what is done and what is outstanding.
- **Merging.** `main` has no branch protection; the repository is private on a plan without it. Every change reaches `main` through a pull request, except the revert commit the dispatcher writes after a merged card fails its deploy or smoke. The dispatcher merges a card only after the `gate` check has succeeded on the pull request's exact head sha, and its squash merge passes that sha, so a head that moved is refused. Board changes merge the same way, with the gate green at the head sha.
- **Actions minutes.** The repository is private on GitHub Free, which includes 2,000 Linux Actions minutes a month. Measured on 22 September 2026 from the Actions jobs API, each job rounded up to a whole minute: 104 gate runs since 14 September used 512 billed minutes, a median of 5 minutes a run and at most 7. A code-lane card costs about two gate runs (its pull request and the push to main), so the free minutes cover roughly 140 to 200 cards a month. When they run out the gate stops starting and nothing merges; that is the point to make the repository public or move the checks, not to buy minutes. A board view of the minutes is a backlog entry.
- **Planning.** Work is ordered, not dated. No date, deadline, week number or day number goes into a plan, a doc or a prompt unless the board set it (18 September 2026).
