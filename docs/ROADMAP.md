# Roadmap to live

The launch checklist: what stands between today and Go live, in order, each item pointing at its spec or at the board's step in `BOARD-SETUP.md`. `docs/PLAN.md` is the constitution. Everything after Go live is a card: `docs/BACKLOG.md` lists the planned work, the board files it with `platform/supabase/scripts/file-backlog.ts`, and the site lists it on /roadmap. This file is updated in the same pull request that changes a spec's status. It holds no dates except those that record what happened.

## Contributions open, and Go live

These are two different states.

- **Contributions open** is true now. The Contribute button is live, and the studio is paused until the first Stripe payout buys Console credit and the dispatcher is cut over to run unattended on the board's Mac. While the studio is paused the site says so. Before Go live the board may share the site quietly; how the first player arrives is the board's call (`BOARD-SETUP.md` step 20, a quiet share recommended). A player's contribution from that share is what closes criterion 1.
- **Go live** is the board pressing Go live on the board's own site, once every criterion below holds with its evidence quoted in the specs. It stamps the launch time and cannot be undone. The announcement follows it (`docs/specs/announcement.md`).

## What "live" means

1. **The loop works.**
   - The three test runs and the board's directives D1 to D3 (the unlock list, save and resume, the game shell) shipped through the dispatcher (`docs/specs/week1-runs.md`).
   - A real contribution from a player, never the founder's, is credited on the meter through `checkout.session.completed` or `charge.updated`.
2. **The dispatcher runs unattended.**
   - It runs on the board's Mac under launchd until the studio has a server (PLAN.md §10 decision 38, `specs/mac-host.md`), restarts on its own, holds the dispatcher lease, and alerts the board through healthchecks.io and ntfy, with a test alert received on the board's phone.
   - Card sessions run as Claude Managed Agents sessions: no agent-written code runs on the dispatcher's host, the repository is mounted read-only, and the dispatcher applies and checks the returned patch itself (PLAN.md §10 decision 25).
   - Every dispatcher secret and id is present, and provisioning and startup check it: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (or `SUPABASE_SECRET_KEY`), `GITHUB_TOKEN` (the host's own fine-grained token, never the attended checkout's), `GITHUB_READ_TOKEN` (contents read only; a write attempt with it answers 403), `GITHUB_REPO`, `NETLIFY_AUTH_TOKEN`, `NETLIFY_SITE_ID_SEED`, `NETLIFY_SITE_ID_PLATFORM`, `STUDIO_ANTHROPIC_API_KEY` (the studio organisation's key, never the founder's), `MANAGED_AGENT_ID`, `MANAGED_AGENT_VERSION`, `MANAGED_ENVIRONMENT_ID`, `MODEL_BUILDER`, `MODEL_DIRECTOR`, `PRICE_TABLE_JSON`, `HEALTHCHECK_URL` and `NTFY_TOPIC_URL`.
   - Console credit bought from a Stripe payout is recorded at /board, and the unattended startup probe passes on it.
   - A card funded by a player builds with no one at the keyboard, billed to the studio.
3. **The money is safe.** Refunds and disputes reverse cleanly. Credit above $50 a day per payer (keyed on the card fingerprint), or above the studio-wide daily limit, is held for 14 days. A refund of money already spent takes the shortfall from unearmarked money first and alerts the board.
4. **The site is ready for strangers.**
   - Shipped work is visible; the Terms, Privacy, Refunds and Contact pages exist; hello@clayhouse.studio receives mail.
   - The Terms and Refunds pages are numbered versions that show when each took effect, and state the refund policy, who may contribute (age), the currency, what happens to money on a card not built or if the studio stops, and that the studio has no token; the agreement is stated before every path to checkout (`specs/legal-copy.md`).
   - /how-it-works, /team and /roadmap are live.
   - Link previews render, and the board's own site requires a second factor.
   - The board and the moderator have each signed in on the board's own site by magic link, through the studio's own sign-in email (`specs/board-site.md`).
   - Nothing on the site describes a feature that does not exist, and no public string says "vote" except planned items, on /roadmap and in home's Planned next.
   - The site shows a notice while the studio is paused.
5. **The board has pressed Go live.** The launch clip and the post drafts exist.

Everything else is in `docs/BACKLOG.md`, and none of it is part of live: for example [the stream](BACKLOG.md#twitch-channel-and-stream-scenes), [the host](BACKLOG.md#the-host), [free voting](BACKLOG.md#free-voting-on-open-cards), [personal decisions](BACKLOG.md#personal-decisions-for-contributors), [display names through the name pipeline](BACKLOG.md#the-name-pipeline), [the image adapter](BACKLOG.md#image-adapter-for-studio-pictures), [the public seed-1 mirror](BACKLOG.md#public-mirror-of-the-game-with-a-license) and [a board rollback button](BACKLOG.md#board-rollback-button).

## The order from here

1. **Built and merged.** The launch batch and the launch series (below) are merged, and each one's production steps ran as it merged; the live site serves main. What is left of the series is launch-card-floor (`specs/launch-card-floor.md`): one attended session in which the board presses **Draft to the floor** in Needs you on its own site and stays signed in while the Game Designer drafts and the Game Director grades, with the attended dispatcher running on the Mac. It waits on the board's first sign-in on its own site (`BOARD-SETUP.md` step 17).
2. **Board section A** in `BOARD-SETUP.md` (steps 1 to 11, and 25): the board's sign-in email through Resend, the Mac made ready as the host with the backup key and folder, the Stripe read-only key, healthchecks.io's emails, the Discord webhooks, the Netlify plan check, the ntfy subscription, the Claude Code pin, and the database password for the migration history repair. Done or closed: the contact address (1), the host's and the read tokens (5.1, 5.2; the host token expires on 23 October 2026 and is regenerated before then), and the business contact for the Terms (10, closed: the disclosures use hello@clayhouse.studio, PLAN.md §10 decision 55). The Mac's own token (5.3) is optional.
3. **Board section B** (steps 12 to 18, and 26), before the announcement: the Stripe settings (the after-payment redirect to /thanks is ready now), retiring the full Stripe key, passkeys, a moderator, the first sign-in on the board's own site, the studio daily credit limit, and then opening the platform code lane. The legal pages are read and approved (14, done).
4. **Board section C** (steps 19 to 24), in order: the restore drill, the first player, the first payout, Console credit bought from it and recorded on the board's site, the cutover and soak (closes criterion 2 once a player's card builds unattended), and Go live. The post drafts are in `docs/launch/` (`specs/announcement.md`).

## The launch batch (22 September 2026)

Seven pull requests built in parallel from the plan of 22 September 2026. A spec that lives in another open pull request is named by its branch until it merges.

| Work | Spec | Status | Waits on |
|---|---|---|---|
| Docs: dateless constitution, backlog, board steps, prompts (#50) | `specs/launch-docs.md` | built (the backlog seed runs after this merges) | `file-backlog.ts` against production |
| DB: horizons, board RPCs, money fixes, lease, backlog parser, public roles (#46) | `specs/launch-db.md` | built (migrations up to `20260922000400` applied, anon negative test PASS) | the roles revoke and webhook deploy after the site deploy |
| Live cards: plain titles and the launch slate (#45) | `specs/launch-cards.md` | built (`refresh-cards.ts` applied: 8 updated, 3 inserted) | nothing |
| Gate: kernel checks first, kernel list, deny-list holes (#48) | `specs/launch-gate.md` | built | a card branch run through the gate |
| Dispatcher: throttle, merge safety, metering (#49) | `specs/launch-dispatcher.md` | built | the cutover |
| Managed Agents: unattended sessions, smoke without card code (#51) | `specs/launch-managed.md` | built | Console credit and the cutover |
| Site: honest copy, /how-it-works, /team, /roadmap, board controls (#47) | `specs/launch-site.md` | built | the live check on production |

**Fixed before the cutover (done, `specs/carry-over.md`).** The Managed Agents adapter now stops and settles a session whose event stream is lost: it sends `user.interrupt`, polls until the session is no longer running, settles and archives it, and resets the reconnect count after a connect that delivered events. It also reads the card's spend again after settling the card's earlier sessions, before it sets the new session's budget (found in the finish review of 23 September 2026; `platform/dispatcher/src/adapters/managed.ts`, tests in `managed.test.ts`).

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
| `specs/local-gate.md` | done |
| `specs/gate-local-output.md` | done |
| `specs/sweep-22-sep.md` | done |
| `specs/sweep-27-sep.md` | done |
| `specs/mobile-first-games.md` | built (Dust's layout live on the game's site after the deploy) |
| `specs/opus-55.md` | done |
| `specs/carry-over.md` | done |
| `specs/launch-hardening.md` | done |
| `specs/stale-tab.md` | done |
| `specs/oracle-launch.md` | done |
| `specs/design-system.md` | done |
| `specs/home-and-design.md` | done |
| `specs/machine-mark.md` | done |

### Built, live check pending

Merged, with every criterion a test can prove ticked. The remaining line of each is named where its spec names one.

| Spec | Status | What is left |
|---|---|---|
| `specs/week1-runs.md` | built | criterion 6, a player's contribution credited (criterion 1 above) |
| `specs/live-cut.md` | built | criterion 7, an unattended build, at the cutover |
| `specs/unattended-mode.md` | built | the unattended probe and a funded card with no board session, at the cutover |
| `specs/vps.md` | built | superseded by `specs/mac-host.md` for now (PLAN.md §10 decision 38); a server's cutover waits on the Google Cloud move in the backlog |
| `specs/ops-separation.md` | built | the production steps, which need a server; the Mac host has its own (`specs/mac-host.md`) |
| `specs/stripe-late-fee.md` | built | `charge.updated` crediting a fresh payment, on the next real contribution |
| `specs/next-cards.md` | built | a real contribution moving a card's bar; the guarded select is struck through as superseded (the Week cards count 0) |
| `specs/gate-hardening.md` | built | a `card/*` pull request showing the detect guard before any install, which waits on Actions minutes and the first card; the platform job's four new steps are recorded green (run 35129960581) |
| `specs/merge-safety.md` | built | the first two live lines, which need a card merged through the dispatcher; the smoke bot's line is struck through, superseded by `specs/launch-managed.md` (smoke runs no card code) |
| `specs/site-truth-pass.md` | built | /board two-factor enrolment watched in Chromium and Safari with DevTools open and no CSP report |
| `specs/money-safety.md` | built | the migration history repair, which needs `SUPABASE_DB_PASSWORD` from the board (`BOARD-SETUP.md` step 25); the jobs' first runs on the Mac host (`specs/mac-host.md`); the backups repository, which waits on a new store; and the restore drill. The three migrations and the backup login are read back |
| `specs/mac-host.md` | built | the board's steps 3 and 8 in `BOARD-SETUP.md`: the Mac made ready, the age key and backup folder, `install.sh`, the cutover and soak on the Mac, the first backup and the restore drill |
| `specs/jobs-only-install.md` | built | `install.sh --jobs-only` run twice on the Mac and the first nightly backup, after the board's step 3 in `BOARD-SETUP.md` and its allow |
| `specs/scale-launch.md` | built | the usage tier cap at the credit step, the Netlify plan (board step 8) and the studio daily credit limit (board step 18); the spend totals (0 = 0, every ledger row billed to the founder) and #66's docs-only gate run are recorded |
| `specs/rename.md` | built | the name is live on all three sites (PLAN.md §10 decision 43), Terms version 3 is posted and the production data name query is clean; left: `managed:apply`, which waits on Console credit in the studio's Anthropic organisation and on the Mac host's install, the board's Stripe, Discord, signature and sign-in sender steps (`BOARD-SETUP.md`, Rename to Mob Machine), and Stripe's links to the new domain, mobmachine.games (PLAN.md §10 decision 59), live, with the old domain redirecting to it |
| `specs/board-site.md` | built | Resend SMTP (board step 2), the board's first sign-in on its own site (board step 17; production shows none since the switch), then `platform_lane_open` (board step 26), and a moderator's first sign-in once one is named (board step 16). The migration, the site and its headers, Supabase Auth, the ended sessions and the live check are recorded |
| `specs/explainer-video.md` | built | pressing play on home and /how-it-works on the live site at 375px and 1440px, with the network requests read (the files fetched only after the press, from the site's origin) |

### The launch series

The rest of the launch plan, agreed and built in this order: each pull request starts from main after the one before it has merged on a green gate and its production steps have run. The specs were trimmed to plain, standard tools; the operations bucket is not built, so every model role job is board-started, runs while a board member is signed in and is billed to the founder. Board-only steps are listed in each spec and block none of them.

| Order | Spec | Status | What it delivers |
|---|---|---|---|
| 1 | `specs/legal-copy.md` | done | numbered Terms versions, the refund policy, age, currency and wind-down terms, the agreement line before every checkout |
| 2 | `specs/money-logic.md` | done | one waterfall with allocations, refunds unwound from every card reached, the fee Stripe keeps, supporter numbers, the terms stamp, the pause reason |
| 3 | `specs/money-surfaces.md` | done | the next card in line on /contribute; money in, reconciliation, Not on a card yet and stopped cards on /ledger; the pause reason |
| 4 | `specs/agent-system-core.md` | done | approvals in Postgres, dealing after the cooling window, vetoes and role pauses, the job queue, resume by rule, `docs/SYSTEM.md` |
| 5 | `specs/agent-workflows.md` | done | the Studio Head's ranking and the Game Designer's drafts graded by the Game Director, both board-started; the public-text filter |
| 6 | `specs/site-snapshot.md` | done | the public site reads two CDN-cached documents from its own origin; stale tabs reload on navigation |
| 7 | `specs/supporter-pages.md` | done | /thanks, /card/:id with the replay, supporter credits, /team statuses |
| 8 | `specs/grid-boxes.md` | done | one item in each cell of every grid, no stretched last row; /team members in identical boxes |
| 9 | `specs/studio-reports.md` | done | the weekly report, Discord ship and weekly posts, the card supply floor |
| 10 | `specs/design-review.md` | built | board-only design files, card-proof design checks, the gate's frames and the Directors' visual review |
| 11 | `specs/agent-upkeep.md` | built | drift checks, Dependabot with a safe patch merge, the Claude Code pin, the replay eval set |
| 12 | `specs/copy-pass.md` | built | every public string after the supporter loop; the board-work marker on /roadmap |
| 13 | `specs/launch-card-floor.md` | agreed | the first open cards, drafted and graded in one attended production session |

### Agreed

| Spec | Status | What is left |
|---|---|---|
| `specs/announcement.md` | agreed | the drafts are in `docs/launch/`; left: the clip, Go live, the link previews and the final check, after board section C |

## Standing facts for any session

- **Production.**
  - The studio is Mob Machine (PLAN.md §10 decision 43); the domain is mobmachine.games; peanutgallery.games stays registered and answers 301 to the same path (PLAN.md §10 decision 59, `specs/rename.md`).
  - Site https://mobmachine.games (Netlify `peanutgallerygames`, base `platform/site`); game https://play.mobmachine.games (Netlify `peanutgallery-seed-1`, base `seed-1`).
  - The board's own site: a third free Netlify site, base `platform/board`, at its own `netlify.app` address with no custom domain, created as a production step of `specs/board-site.md`. Nothing on the public site links to it, and mobmachine.games/board is a plain not found page.
  - Supabase project `lyxndueoeisyqzewflpu`.
  - Stripe webhook `we_1UFd0XICmyTP81VUCeACUWhc`.
  - The dispatcher runs attended on the founder's Mac until the cutover, and after it unattended on the board's Mac under launchd, from `~/peanutgallery-host`, until the studio has a server (PLAN.md §10 decision 38).
- **Money.** The pool holds customer money only. Work before the cutover runs attended on the founder's Max subscription, billed to the founder. There is no founding budget. Console credit is bought only from Stripe payouts, never with the founder's money. Everything the studio runs on is free.
- **Models.** Every role that runs is on `claude-opus-5-5` (`MODEL_BUILDER` and `MODEL_DIRECTOR`); the Host keeps `claude-haiku-4-5` while it does not run (PLAN.md §10 decision 36).
- **Claude Code on the Mac.** Attended sessions need 2.1.280 or newer, because 2.1.139 refuses `claude-opus-5-5`. They run only on the version in `platform/ops/mac/claude-code-pin.json`, 2.1.283, on which the attended `sandbox:check --positive` passes in both layouts (`specs/agent-upkeep.md`); the adapter pauses a card with `cli_version` on any other. Until the board runs the pin script, the CLI still updates itself, and an update pauses attended sessions until the pin moves in a board pull request.
- **Production changes.** Take a dump before every production migration or manual write (`specs/money-safety.md`). Migrations are applied through the Supabase Management API query endpoint until the one-time `supabase migration repair` in `specs/money-safety.md` has run, and through `supabase db push` after it; the repair needs `SUPABASE_DB_PASSWORD`, which the board puts in `.env` (`BOARD-SETUP.md` step 25). Functions deploy from `platform/` with `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api`. Both need the board's allow in auto mode. A spec that needs production steps lists them under "Production steps (need the board's allow)", and a Verification line that can run only after Console credit, the cutover or the board's second factor names what it waits on and stays unticked, with the spec at built.
- **What waits on the board.** `BOARD-SETUP.md` is the step-by-step for every item that needs the board, with what is done and what is outstanding.
- **Merging.** `main` has no branch protection; the repository is private on a plan without it. Every change reaches `main` through a pull request, except the revert commit the dispatcher writes after a merged card fails its deploy or smoke. The dispatcher merges a card only after a run of the gate workflow has succeeded on the pull request's exact head sha, and its squash merge passes that sha, so a head that moved is refused; it merges a Dependabot patch update the same way, only when every condition of the merge policy holds (PLAN.md §10 decision 53). While Actions cannot start jobs (below), board pull requests merge on the local gate instead (PLAN.md §10 decision 44, `specs/local-gate.md`): `bash scripts/local-gate.sh <pr> [port-base]` from main's checkout, never a pull request's own copy, then `gh pr merge <pr> --squash --match-head-commit <head>` only when the PASS line names that head and its `base=` is still `origin/main`, with the PASS line quoted in the merge body. One gate at a time on the Mac, about 10 minutes a run (`specs/gate-speed.md`). Cards wait for Actions: the script refuses a card branch, and the dispatcher fails closed without a gate workflow run.
- **Actions minutes.** The repository is private on GitHub Free, which includes 2,000 Linux Actions minutes a month, counted across the whole account. Measured on 22 September 2026 from the Actions jobs API, each job rounded up to a whole minute: 104 gate runs since 14 September used 512 billed minutes, a median of 5 minutes a run and at most 7. On 23 September 2026 the included minutes ran out; with a $0 spending limit every job is refused within seconds with a billing annotation, so the gate workflow is disabled (`gh workflow disable gate`) and board pull requests merge on the local gate (Merging, above). To switch back, once the included minutes reset at the start of the next billing cycle, or the board makes the repository public (standard runners are free on public repositories), or the board adds an Actions budget (a spend, against PLAN.md §10 decision 35): `gh workflow enable gate`, and every pull request, cards included, merges on the Actions gate again (`BOARD-SETUP.md`, GitHub Actions minutes). A board view of the minutes is a backlog entry.
- **Planning.** Work is ordered, not dated. No date, deadline, week number or day number goes into a plan, a doc or a prompt unless the board set it (18 September 2026).
