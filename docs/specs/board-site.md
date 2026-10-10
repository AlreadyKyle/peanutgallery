# The board on its own site

Status: built. Card: none. Owner: board.

Amended by PLAN.md §10 decision 66 (`unattended-roles.md`): the board's site is an optional panel (`optional-board.md`). Needs you is superseded: the panel's first screen is Status, the standing duties reach the board by ntfy, email and GitHub, and `board_needs_you()` stays in the database, uncalled.

The launch plan's Phase 3 "Board on its own site", the first pull request of Wave 2, from the reviews of 23 September 2026: R12 (board sign-in email and sign-ups), R16 (the money, ledger and legal surfaces as kernel, and the payment-host scan) and PG-23 (the "Needs you" inbox). This is a board pull request: it changes kernel files, listed under Scope.

## Problem

- The board signs in at peanutgallery.games/board, the same origin that serves the public site, and its Supabase session is kept in that origin's storage. Once cards may change the public site's code, any card-built script there could read the board's session. That is why the studio code lane is closed (PLAN.md §10 decision 31).
- In `platform/site/src`, only `board.ts` and `env.ts` are kernel. The Contribute page (which holds the Payment Link), the ledger, the legal pages, the strings that state money and the code that reads and formats it are not, so a Platform Builder card could change what the site says about money or where it sends it (R16).
- Board sign-in email goes through Supabase's built-in mail, which reaches only the project team at 2 an hour; sign-ups are open and the magic link can create a user (R12).
- The board's standing duties (credit after a payout, disputes, refunds, the emergency fund, kernel merges) live in docs and alerts, not on the board's first screen (PG-23). The usage tier cap has no board control.

## Scope

In:
- **Kernel moves (R16).** `platform/gate/kernel-paths.txt` and `KERNEL_PATHS` in `platform/dispatcher/src/worktree.ts` gain `platform/board`, `platform/site/index.html` and, in `platform/site/src`:
  - the entry and the frame: `main.tsx` (the data source, the session clearing, the mount) and `App.tsx` (the top bar, the footer with the legal links and the credit, the not found page, and the routes of the Contribute, Ledger and legal pages);
  - the pages: `pages/Contribute.tsx`, `pages/Ledger.tsx`, `pages/Legal.tsx`;
  - every component that draws a figure, a card's money, a ledger row or the snapshot guard: `components/Stat.tsx`, `components/Funding.tsx` (the funding bar and caption, and new: `CardMoney`, a card box's bar, caption, spend and Fund this card link with its id; the shipped caption; the split example's figures), `components/Guarded.tsx` (new, moved out of `Cards.tsx`), `components/LedgerSummary.tsx`, `components/Meter.tsx`, `components/PoolStat.tsx`, `components/EventList.tsx`, `components/DeployList.tsx`, `components/StaleNotice.tsx`, `components/PausedNotice.tsx`, `components/TextPage.tsx` (the legal pages' renderer);
  - the libraries: `lib/studio.tsx` (the one load of the snapshot every figure comes through), `lib/source.ts`, `lib/supabase.ts`, `lib/format.ts`, `lib/legal.ts` (new: the legal pages, the fixed rules and every statement of money, meaning each money rule, the label and description of each money and ledger figure, the ledger's row words and the funding caption, moved out of `copy.ts`, which no longer spreads or repeats it) and `lib/payment.ts` (new: `fundLink`, `canFund`, `isFullyFunded`, `fundOrder`, the card categories, `fundableCards` for /contribute, and the split rule's arithmetic, moved out of `cards.ts` and `HowItWorks.tsx`).
  `lib/board.ts` leaves the site. The card lane's pages and top bar links move to `src/routes.tsx` (not kernel), which `App.tsx` mounts after dropping any path a kernel page or /board holds. A kernel file under `platform/site/src` imports only kernel files, the site's packages and five named card-lane modules (`copy.ts`, `PageHeader.tsx`, `styles.css`, `freshness.ts`, `routes.tsx`), which `platform/dispatcher/test/site-kernel.test.ts` checks.
- **The board's own site.** A new kernel Vite and React app, `platform/board` (`@backseat/board`), with `Board.tsx` and `lib/board.ts` moved from the site, its own copies of the few helpers it needs (format, env, the Supabase client, styles), its own `netlify.toml`, `index.html`, `robots.txt`, unit tests and end-to-end suite. It imports nothing from the site. The public site loses `/board`: a 404 in production, the not found page in the app.
- **Auth.** The board's client persists and refreshes its session; the public site's does neither and never reads tokens from the address, and clears any session stored before the move. The magic link passes `shouldCreateUser: false` and returns to the board site. The seed creates each board member's Supabase Auth user through the admin API (the moderator's from `MODERATOR_EMAIL`), printing counts only.
- **Needs you (PG-23)** and the tier cap: migration `20260924000000_board_site.sql` adds `board_needs_you()`, the usage tier cap to `set_caps` and `board_studio_state`, and the Caps form shows and edits it. The Controller records the newest paid payout for the inbox.
- **Payment-host scan.** `platform/gate/payment-host-scan.mjs` and `payment-hosts.txt`, run by `ship-gate.sh` over the built public site and the built game. The public site's `form-action 'self'` moves into the enforced policy, and its `netlify.toml` serves the app at the kernel pages with `force`.
- **The platform code lane, gated.** `studio_state.platform_lane_open` (default false) in the same migration; `file_card`, `set_card_horizon` and `resume_card` refuse a platform code card on now unless it is true; the dispatcher's `runnable` reads it; the gate's lane check accepts `platform/site` on a code branch; /team reads it from `public_studio`.
- **The gate** builds, tests and runs the end-to-end suite of the board site with the platform folder (`ship-gate.sh`, `changed-paths.sh`, `.github/workflows/gate.yml`).
- **Docs:** `BOARD-SETUP.md` rewritten as the plan's checklist A to D; `docs/PLAN.md` §3, §4 Work, §4 The Board, §4 Not built yet, §6 and §11, decision 39 superseding 31 (numbered 39 after decisions 37 and 38 landed first); the backlog entry "Board on its own site" removed as built; `docs/ROADMAP.md`; the Platform Builder's and the Platform Director's prompts; `README.md`; `platform/site/DESIGN.md`; `docs/COPY.md`.

Kernel files this pull request changes: `.github/workflows/gate.yml`, `docs/` (PLAN, ROADMAP, BACKLOG, BOARD-SETUP, `docs.test.mjs`, this spec), `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `platform/agents/prompts/platform-builder.md` and `platform-director.md`, `platform/dispatcher` (`db.ts`, `select.ts`, `tick.ts`, `worktree.ts` and tests, `test/site-kernel.test.ts` new), `platform/gate` (`kernel-paths.txt`, `changed-paths.sh`, `ship-gate.sh`, `runtime-token-deny.sh`, `payment-host-scan.mjs`, `payment-hosts.txt`, tests), `platform/ops/jobs/controller.mjs` and its test, `platform/supabase` (the migration, `seed.ts`, `lib/board-users.ts`, `scripts/anon-negative-test.ts`, tests), `platform/site/netlify.toml`, `platform/site/index.html`, `platform/site/scripts/live-check.mjs` and `board-address.mjs` (new), every new `platform/board` file, and the site files that become kernel above.

Out:
- The legal text itself, the Terms versions and the privacy line about Resend: the legal-copy pull request, next in Wave 2.
- F1's cached snapshot, which rewrites `source.ts`: the supporter-loop pull request.
- The "Since you last looked" half of PG-23, the ntfy payout message and a daily digest: a later board card.
- A Needs you item for a new model without a price-table row: the board site cannot read `.env`, so the inbox omits it and BOARD-SETUP names it as a standing duty.
- The design of the board site beyond the site's existing tokens and form rules.
- The Platform Director's grading of studio cards: `card_approvals` and the review sessions are the agent-system pull request. Opening the lane here lets the Platform Builder's cards run; until the agent-system pull request, a studio card is filed and graded by the board as every card is today.
- The site's description of the board and its duties (PG-18): the copy pass.

## Behaviour

**The board's site.** A separate free Netlify site, base `platform/board`, at its own `*.netlify.app` address with no custom domain and no DNS record. Every path serves the app. Headers on every path: an enforced Content Security Policy `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https://lyxndueoeisyqzewflpu.supabase.co; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'` (the one `data:` image is the authenticator QR code Supabase Auth returns), `X-Robots-Tag: noindex, nofollow`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, and the site's Permissions-Policy. `index.html` carries `<meta name="robots" content="noindex, nofollow">` and no inline script; `robots.txt` disallows everything. Card and dependabot branches build no deploy of it.

**Sign-in.** Magic link to an address with a `board_members` row and an auth user, then the TOTP second factor as before. The link returns to the board site's root and never creates a user. The seed writes the `board_members` rows, then creates the missing auth users (confirmed, no password) and prints `board users: N already in Supabase Auth, M created`.

**Needs you.** For a board member, the first section, at the first factor. It lists, most urgent first, only what is due:
- each dispute the Controller's latest reconcile run lists to answer, with its amount, Stripe's due date and a link to it in Stripe;
- each S1 card in a spending stage (funded, building, gated, paused), with what the emergency fund holds;
- the Console credit to buy, when the latest run's figure is above zero and no purchase was recorded after that run: the steps, a **Fill in the record form** button (second factor) that fills the amount, the newest paid payout's id and a reason, and the Minimum balance to set in Stripe, in USD and in Stripe's settlement currency.

With nothing due it says "Nothing needs you." Under the list: the latest run's time, whether the books matched Stripe, the credit figure and the Minimum balance; or, before any run, "No Controller run yet", with a link to Stripe's disputes. Two standing lines follow: refund requests arrive at hello@peanutgallery.games and are refunded in Stripe within 14 days; every pull request not from a card branch waits for the board's merge, linking GitHub's open pull requests filtered `-head:card/`. The dispatcher merges only the `card/*` branches it opens, so every other pull request (board work, HR's text changes, the Claude Code pin, a dependency update) is the board's, and the list needs no label anyone must remember. The inbox reloads once a minute.

**The tier cap.** The status line shows the usage tier cap or "No usage tier cap" and whether the studio code lane is open. The Caps form has "Anthropic usage tier monthly cap (USD)", blank for none; saving sends it with every other cap. `set_caps` changes the tier cap only when `p_set_anthropic_tier_cap` is true (null then removes it), refuses a value at or below zero or above $1,000,000, and records it in the board action's before and after.

**The public site.** No /board: Netlify answers `/board` and `/board/*` with the not found page and status 404, and the site names no netlify.app address but the game's, which every page's top bar links to (`VITE_PLAY_URL`). Its Supabase client keeps no session and removes a stored `sb-<project>-auth-token` on load. The enforced policy is `frame-ancestors 'none'; connect-src 'self' https://… wss://…; form-action 'self'`. `App.tsx` routes `/contribute`, `/ledger`, `/terms`, `/privacy`, `/refunds` and `/contact` to the kernel pages and mounts the pages in `routes.tsx` only on a plain first path segment (lowercase letters, digits, hyphens) that is none of those nor `board`; a top bar link from `routes.tsx` must be a plain path on the site. Netlify serves the app at those six paths and at /board with `force`, so a file a card adds to `public/` cannot stand in for them.

**The payment-host scan.** After the site's build (run with the public values its `netlify.toml` sets, as Netlify runs it), the gate reads every file of `platform/site/dist` and fails when any address on a payment domain in `payment-hosts.txt` (Stripe, PayPal, Venmo, Cash App, Square, Ko-fi, Patreon and others), or a subdomain of one, is anything but exactly the configured Payment Link. The text is read as a browser reads an address: JavaScript escapes, HTML character references and percent-encoded bytes are decoded until nothing changes, and NFKC with the ideographic full stops folds fullwidth letters and dots, so `buy%2Estripe%2Ecom`, `buy&#46;stripe&#46;com` and `buy。stripe。com` fail like `buy.stripe.com`. An address the page assembles at run time from pieces is beyond any scan; see Decisions. The game's build may carry no payment address at all. A site `netlify.toml` without a Payment Link fails the scan closed.

**The studio code lane.** Closed until the board sets `studio_state.platform_lane_open`. While closed, nothing changes from today. Once open, the dispatcher runs a funded platform code card like any other, `file_card`, `set_card_horizon` and `resume_card` accept it on now, and /team shows the Platform Builder as running. The gate's lane check accepts a code-lane card branch whose files all lie under `platform/site/` (kernel files there still fail the kernel guard) or all under `seed-1/`, never both, and never another folder.

## Acceptance criteria

- [x] `kernel-paths.txt` and `KERNEL_PATHS` list the board site and the site's entry, frame and routes, snapshot loader, and money, ledger and legal files, equal to each other; the kernel guard fails each, and passes the site's pages, `routes.tsx`, copy, card layout, page header and styles.
- [x] Every kernel file under `platform/site/src` imports only kernel files, the site's packages and the five named card-lane modules; `copy.ts` states no money rule, shares no key with `legal.ts` and does not spread it; `index.html` loads only `main.tsx`.
- [x] A `routes.tsx` that claims `/ledger`, `/Contribute`, `terms`, `/refunds/`, `/board`, `/:slug`, `/ledger?` or `*`, or links the top bar to another host, changes nothing: the kernel pages, the not found page and a plain top bar answer. `netlify.toml` serves the app at the six kernel pages and at /board with `force`.
- [x] A card box's bar, caption, spend and Fund this card link come from the kernel `CardMoney`; /contribute's choices are `fundableCards`, the same cards as Fund what's next that can take money.
- [x] The board app builds and typechecks on its own, imports nothing from the public site, and its unit tests cover the moved board controls, the inbox and its data, the tier cap, the executor list from `public_roles`, and the sign-in call with `shouldCreateUser: false`.
- [x] The board site's `netlify.toml` enforces the whole policy above, sends `X-Robots-Tag` and frame and referrer rules, builds only its folder, and skips card and dependabot branches; `index.html` has the robots meta and no inline script; `vite preview` sends the same headers.
- [x] Under the enforced policy in Chromium, the sign-in form renders at 375 px with no overflow and no report; a signed-in board session sees Needs you first and sets up an authenticator app with the QR `data:` image and no report; a connection to any host but the Supabase project is refused.
- [x] The public site has no /board route (not found page in the app, 404 rules in `netlify.toml`), no sign-in form, and names no netlify.app address but the game's, built with `netlify.toml`'s play URL as production is; its client keeps no session and clears a stored one.
- [x] `form-action 'self'` is enforced on the public site, and a form posting to another host is refused in Chromium with a report.
- [x] The payment-host scan passes the built site with the configured link, and fails another payment address in the site's build, a second Stripe link, any payment address in the game's build, escaped and upper-case forms, percent-encoded dots and letters (once and twice), HTML character references, JavaScript escapes, ideographic and fullwidth full stops and fullwidth letters, and a site with no configured link; it passes look-alike hosts, email addresses and decoded text that names no payment host.
- [x] `board_needs_you()` returns the latest reconcile run's figures (never a quota run), the last credit purchase, the emergency fund and the S1 cards in a spending stage, to board members at aal1 only; moderators, outsiders and anon are refused.
- [x] `set_caps` sets, keeps and clears the tier cap as described, refuses the bounds and a value without the flag, records it, and exists in one eight-argument version; `board_studio_state` returns the tier cap and the lane flag.
- [x] With `platform_lane_open` false, `file_card`, `set_card_horizon` and `resume_card` refuse a platform code card on now as before; with it true they accept it, other rules still apply, and anon reads the flag on `public_studio` and cannot write it.
- [x] The dispatcher runs a platform code card only when `studio_state.platform_lane_open` is true, and reads the flag as false before the column exists.
- [x] The gate's lane check accepts a code branch under `platform/site/` only or `seed-1/` only, and refuses both at once, the board site, other platform folders and root files; a board site change selects the site steps.
- [x] The seed creates the moderator's auth user from `MODERATOR_EMAIL`, leaves existing users alone, and prints no address.
- [x] The Controller's figures name the newest paid payout, or none.
- [x] `BOARD-SETUP.md` carries the plan's checklist A to D, with Actions read and Plan read on the dispatcher and Mac tokens, and the docs tests pass (no schedule, the backlog and PLAN in step).
- [x] Production: the migration applied, the anon negative test and the ledger identity PASS (Evidence, Production).
- [x] Production: the board's Netlify site live at its address, with the headers above read back (Evidence, Production).
- [x] Production: Supabase Auth's site URL and redirect list on the board site only, sign-ups off, the board users' sessions ended (Evidence, Production).
- [ ] Production: sign-in email through Resend (waits on: the board's `RESEND_SMTP_KEY`, BOARD-SETUP step 2).
- [ ] ~~The board signs in on the new site and sees Needs you (waits on: the board, BOARD-SETUP step 17; production shows no sign-in since the switch, Evidence).~~ Superseded by `optional-board.md`: the board signs in and sees Status.
- [ ] The moderator's first sign-in, as a Go-live test (waits on: the board naming a moderator, BOARD-SETUP step 16, and Resend).
- [x] The live check on production shows /board as a 404 naming no netlify.app address but the game's, no route naming the board site's address, and the enforced `form-action` (Evidence, Production).
- [ ] `platform_lane_open` set once the migration, the board site, the Auth settings and ended sessions and the live check hold, and an hour has passed since the sessions ended: production steps 2 to 6 and 11 (waits on: the board's switch, by SQL, production step 12 and BOARD-SETUP step 26). The board's own sign-in (step 8) no longer holds it up: the board's site is optional (`optional-board.md`, PLAN.md §10 decision 66). Resend and the moderator's first sign-in do not hold it up: neither changes what a card's code could reach.

## Verification

- `pnpm verify`
- `pnpm --filter @backseat/site e2e`
- `pnpm --filter @backseat/board e2e`
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/migration_test.ts`
- Production, after the production steps: `anon-negative-test.ts` and `ledger-identity.ts` PASS; `curl -sI` on the board site shows the headers; `node platform/site/scripts/live-check.mjs` with `BOARD_SITE_URL` from `.env` in its environment PASS (waits on: the board's allow).
- The board's and the moderator's sign-ins on the board site (waits on: the board).

## Production steps (need the board's allow)

The studio stays paused throughout. Merging removes /board from the public site as soon as Netlify deploys it, so steps 2 to 5 follow the merge without a gap; until the board site is up, a Pause the board asks for is made through the Management API.

1. **Before the merge:** read back `select paused, agent_mode, dispatcher_seen_at from public.studio_state` (paused, and no dispatcher seen in the last minutes), and take a dump (ROADMAP standing facts).
2. **Apply `20260924000000_board_site.sql`** through the Management API query endpoint, or `supabase db push` once the history repair has run. Then `anon-negative-test.ts` (it now probes `board_needs_you` and reads `platform_lane_open` on `public_studio`) and `ledger-identity.ts`, both PASS, and `select platform_lane_open from public.studio_state` reads false.
3. **Create the board's Netlify site** on the same team from AlreadyKyle/peanutgallery, branch main, base directory `platform/board` (the build command, publish folder and values come from its `netlify.toml`), with a name that has a random suffix so the address is not guessable from the studio's name. Turn deploy previews and branch deploys off. Record the address in `.env` as `BOARD_SITE_URL=` and give it to the board; it goes nowhere in the repository, which may one day be public. Read back `curl -sI https://<address>/` and quote the Content-Security-Policy, X-Robots-Tag, X-Frame-Options and Referrer-Policy lines.
4. **Supabase Auth** through the Management API (`PATCH /v1/projects/lyxndueoeisyqzewflpu/config/auth`): `site_url` the board site's address; `uri_allow_list` that address with `/**` and nothing on peanutgallery.games; `disable_signup` true. Read back those three fields and quote them.
5. **End the board users' sessions at the switch** through the Management API query endpoint: `delete from auth.sessions where user_id in (select u.id from auth.users u join public.board_members m on lower(u.email) = m.email)`; their refresh tokens go with their sessions. Read back that no unrevoked refresh token is left for those users. An access token already issued lasts until it expires (an hour by default), which is why step 12 waits.
6. **Re-run the seed** (`pnpm --filter @backseat/supabase seed`) and quote its `board users` line; it creates any missing board user, the moderator's once `MODERATOR_EMAIL` is set.
7. **Resend SMTP**, once the board has done BOARD-SETUP step 2: in the same Auth config, `smtp_host` `smtp.resend.com`, `smtp_port` `465`, `smtp_user` `resend`, `smtp_pass` the value of `RESEND_SMTP_KEY` (read from `.env`, never printed), `smtp_admin_email` an address on the sending subdomain Resend verified (for example `board@` that subdomain), `smtp_sender_name` `Peanut Gallery`, and `rate_limit_email_sent` raised from 2 to 30 an hour. Read back every field but the password, and send one sign-in link to the board to prove delivery (waits on: `RESEND_SMTP_KEY`).
8. **The board signs in** on the new site (BOARD-SETUP step 17): quote `board_members.last_seen_at` moving and the inbox rendering.
9. **The moderator's first sign-in** as a Go-live test (BOARD-SETUP step 16, after step 7): quote their `last_seen_at` or the pause they test and undo.
10. **Roadmap.** Delete the planned card "Board on its own site" (horizon next, stage proposed, no money) with its id, title, stage and horizon in the filter, after checking no ledger row, contribution or board action names it; if a board action does, leave it and say so.
11. **The live check** on production, with the board site's address from `.env` in its environment and never printed (`set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs`), quoting the /board 404 line, the /board netlify.app line, the two "no route names the board site's address" lines and the enforced policy line.
12. **Open the platform code lane** once steps 2 to 6, 8 and 11 hold and at least an hour has passed since step 5, the same preconditions as the acceptance line: `update public.studio_state set platform_lane_open = true where id = 1`, read back through `public_studio`, and check /team shows the Platform Builder under Running. Steps 7 and 9 (Resend, the moderator) may come later.

## Evidence

`pnpm verify` on this branch exits 0 (after the review fixes). Its totals:

```
platform/site test:       Tests  209 passed (209)
platform/board test:       Tests  67 passed (67)
platform/supabase test:       Tests  267 passed (267)
seed-1 test:       Tests  77 passed (77)
platform/dispatcher test:       Tests  617 passed (617)
platform/gate test: PASS: gate tests passed=499
ℹ tests 117        (test:agents)
ℹ tests 90         (test:ops, with jobs.test.mjs)
ok | 82 passed (83 steps) | 0 failed     (test:functions)
PASS: payment-host-scan files=7 allowed=0        (the game's build)
GATE PASS folder=seed-1 lane=code
PASS: payment-host-scan files=4 allowed=1        (the site's build, with the Payment Link from netlify.toml)
GATE PASS folder=platform lane=code
PASS: secret-scan files=485
ℹ tests 15         (test:docs)
ℹ fail 0
```

`pnpm --filter @backseat/site e2e`: `28 passed (10.7s)`, among them:

```
✓ e2e/csp.spec.ts › every route loads its data under the policy with no report
✓ e2e/csp.spec.ts › a connection to any other host is refused by the enforced policy
✓ e2e/csp.spec.ts › a form that posts to another host is refused by the enforced policy
✓ e2e/csp.spec.ts › /board is the not found page, with no sign-in form and no netlify.app address but the game's
```

`pnpm --filter @backseat/board e2e`: `4 passed (2.3s)`, after which `git status --short` lists no `platform/board/dist-e2e/`:

```
✓ the preview sends the enforced policy, the robots header and the frame rules from netlify.toml
✓ the sign-in form renders at 375 px with no horizontal overflow and no policy report
✓ a signed-in board member sees Needs you first, and sets up an authenticator app, under the enforced policy
✓ a connection to any host but the Supabase project is refused
```

The /board check against the gate-built site (built with `netlify.toml`'s values, served by `vite preview`, every request to another host aborted), where the old check failed:

```
h1 ["Not found"]
old check (any netlify.app) would fail: true
play host from netlify.toml: peanutgallery-seed-1.netlify.app
new check stray hosts: []
```

The payment-host scan before and after on `https://buy%2Estripe%2Ecom/test_evil https://buy&#46;stripe&#46;com/x https://buy。stripe。com/x`: the old scanner printed `PASS: payment-host-scan files=1 allowed=0`; the new one prints `FAIL: payment-host-scan ... address=https://buy.stripe.com/test_evil` and names all three as `https://buy.stripe.com/...`.

`migration_test.ts` on PGlite, `ok | 3 passed (70 steps) | 0 failed`, with:

```
board-site: the platform code lane opens only with studio_state.platform_lane_open, which anon reads and cannot write ... ok
board-site: set_caps sets and clears the usage tier cap only when asked, within its bounds, and records it ... ok
board-site: board_needs_you gives the board, at aal1, the Controller's latest figures, the last purchase and the S1 cards ... ok
function privileges: anon none, authenticated the nineteen board RPCs, service_role the rest, one file_card ... ok
```

Where each criterion is tested:
- Kernel lists: `platform/dispatcher/test/worktree.test.ts` (the lists equal, the new files kernel, the site's pages, routes and copy not) and the kernel-guard lines in `platform/gate/test/run-tests.sh`. The kernel's imports, `copy.ts` and `index.html`: `platform/dispatcher/test/site-kernel.test.ts`, which a card cannot change.
- The board app: `platform/board/src/Board.test.tsx` (moved controls, Needs you, the tier cap, executors, sign-in), `lib/needs.test.ts`, `lib/board.test.ts`, `site-config.test.ts` (headers, `index.html`, no import from outside the folder); `e2e/board.spec.ts`.
- The public site: `src/App.test.tsx` (no /board, with the production play URL), `src/App.routes.test.tsx` (a hostile `routes.tsx` changes nothing), `src/board-address.test.ts` (the /board address check live-check runs), `src/lib/cards.test.ts` (`fundableCards`), `src/lib/copy.test.ts` (the copy rules over `copy.ts` and `legal.ts`, no shared key), `src/lib/supabase.test.ts` (no session, stored sessions cleared), `src/netlify-headers.test.ts` (the enforced policy, the /board 404 rules, the forced kernel paths, the same paths as `App.tsx`), `src/lib/roster.test.ts` and `src/pages/Team.test.tsx` (the lane flag), `src/lib/source.test.ts`; `e2e/csp.spec.ts`.
- The scan: the `pay:` and `ship:` lines in `platform/gate/test/run-tests.sh`.
- The database: `migration_test.ts` steps above; the static `board-site migration` tests in `platform/supabase/test/migration.test.ts`, which also prove each changed function differs from its predecessor only where this spec says.
- The dispatcher: `select.test.ts`, `tick.test.ts`, `db.test.ts`. The gate's lane: the `lane:` lines in `run-tests.sh`. The seed: `platform/supabase/test/board-users.test.ts`. The Controller: `platform/ops/test/jobs.test.mjs`.

### Production (read back at the close-out, 26 September 2026, read only)

The board site's address is `<BOARD_SITE_URL>` here: it lives only in `.env` and is never printed.

- **The migration (step 2).** `select platform_lane_open from public.studio_state` returns `[{"platform_lane_open":false}]`, so the column exists and the lane is closed. On `origin/main` at ed63326, `anon-negative-test.ts` prints `PASS: anon access matches the RLS contract` (128 outcome lines, all `ok`) and `ledger-identity.ts` prints `PASS: ledger identity holds over 1 contribution rows, 0 studio ledger rows, 1 allocations and 66 cards`.
- **The board's Netlify site (step 3).** `curl -sI "$BOARD_SITE_URL/"`, the address replaced before printing:

  ```
  HTTP/2 200
  content-security-policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src https://lyxndueoeisyqzewflpu.supabase.co; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
  referrer-policy: no-referrer
  strict-transport-security: max-age=31536000; includeSubDomains; preload
  x-content-type-options: nosniff
  x-frame-options: DENY
  x-robots-tag: noindex, nofollow
  ```
- **Supabase Auth (step 4).** `GET /v1/projects/lyxndueoeisyqzewflpu/config/auth`, five keys, the address redacted: `{'site_url': '<BOARD_SITE_URL>', 'uri_allow_list': '<BOARD_SITE_URL>/**', 'disable_signup': True, 'mfa_totp_enroll_enabled': True, 'mfa_totp_verify_enabled': True}`. Nothing on peanutgallery.games is on the list.
- **The sessions ended (step 5).** For the board's users, `auth.sessions` holds 0 rows and `auth.refresh_tokens` 0 rows, revoked or not.
- **The board's own sign-in (step 8): not yet.** `select role, last_seen_at from public.board_members` returns `[{"role":"board","last_seen_at":"2026-09-20 00:25:09.773289+00"}]`, and the board user's `auth.users.last_sign_in_at` is `2026-09-15 04:24:10+00`. Both are from before #56 merged (23 September 2026), when /board was still on the public site: the board site's sign-in calls `board_heartbeat`, which would have moved `last_seen_at`, and no session exists. So the board has not yet signed in on its own site; that is `BOARD-SETUP.md` step 17, and the sign-in criterion and production step 12 wait on it.
- **The live check (step 11).** On `origin/main` at ed63326, with `BOARD_SITE_URL` from `.env` in its environment and never printed (a scrub of the output finds the address 0 times): `PASS live-check https://peanutgallery.games passed=279 failed=0 skipped=0`, exit 0, with

  ```
  PASS 375px no route names the board site's address
  PASS 1440px no route names the board site's address
  PASS /board status 404
  PASS /board is the not found page: ["Not found"]
  PASS /board has no sign-in form
  PASS /board names no netlify.app address but the game's (peanutgallery-seed-1.netlify.app)
  PASS /board does not name the board site's address
  PASS /team content-security-policy: frame-ancestors 'none'; connect-src 'self'; form-action 'self'
  ```
- **Still open:** Resend (step 7, `BOARD-SETUP.md` step 2), the board's sign-in (step 8, BOARD-SETUP step 17), a moderator and their sign-in (step 9, BOARD-SETUP step 16; `board_members` has no moderator row), and opening the platform code lane (step 12, BOARD-SETUP step 26), which waits on the board's sign-in and then is the board's switch.

## Decisions

- 2026-09-23: The board site gets its own copies of the few helpers it needs (format, env, the Supabase client, the form styles) rather than a shared module. A module shared with the public site would either be kernel, freezing part of the site for no reason, or card-changeable, putting card code on the board's origin. The copies are small, and a test fails if the board app imports from outside its folder.
- 2026-09-23: Kernel covers the files that read, load, format, state or show money, send money or hold the legal text, and everything they are mounted by: the Contribute, Ledger and legal pages; every component that draws a money or ledger figure, a card's money and its Fund this card link, or the snapshot guard; `format.ts`, `legal.ts`, `payment.ts`, `source.ts` and `studio.tsx` (every figure the site shows is read and loaded there) and `supabase.ts` (the client that must keep no session); and `index.html`, `main.tsx` and `App.tsx`, which load the site and route the kernel pages. The card's own layout (`Cards.tsx`, which places the kernel `CardMoney`), the landing, /how-it-works, /team, /roadmap, `routes.tsx`, `copy.ts`, `PageHeader.tsx` and the styles stay in the platform code lane, so a card can still add a page, change the words and change the design.
- 2026-09-23: What a kernel path cannot stop, said plainly. The kernel files and the card lane's files run in one bundle on one origin, so card code could still change what a kernel page shows at run time: a stylesheet can hide or overlay a figure, and a script can rewrite the page or replace a global the kernel code calls. Kernel paths stop the ordinary edit (a card rewording the fixed rules, pointing /ledger at its own component, changing which card id a fund button carries); the payment-host scan stops a second payment address in the build; the enforced `connect-src` and `form-action` stop data leaving for another host. A deliberate run-time change in card code is left to the Platform Director's review and the board's; the Platform Director's prompt now names each form and fails a card that does it. A full separation (the money pages on their own origin, as the board now is) is not built.
- 2026-09-23: The kernel's own imports are checked from the dispatcher's tests, not the site's: the dispatcher folder is kernel, so no card can weaken the check, and since no card can change a kernel file either, it guards the board's own pull requests. `copy.ts`, `PageHeader.tsx`, `styles.css`, `freshness.ts` and `routes.tsx` are the only card-lane modules a kernel file may load, each for a stated reason, and the same test fails when `copy.ts` states a money rule.
- 2026-09-23: The inbox's pull-request line filters on the branch, not a label. Nothing in the studio applies labels, and a label someone must remember is a duty that fails silently. The dispatcher merges only `card/*` branches, so `-head:card/` lists exactly what waits for the board; GitHub's search API returned PRs 45 to 51 for `head:launch/` and none of 52 to 56 for `-head:launch2` on 23 September 2026, which is the prefix match the link relies on.
- 2026-09-23: The platform code lane opens by a `studio_state` flag the board's production step sets, not by this merge, so the lane cannot open before the board site is live and the old sessions are gone. The gate's lane check opens now: without the flag the dispatcher starts no platform card and the database keeps none on now, so no platform card branch exists.
- 2026-09-23: The tier cap goes through `set_caps` after all, with its own flag because null already means "leave this cap". The scale spec kept it out, since it can only stop cards; the launch plan gives the board the control in the Caps form, and the flag keeps every other caller's meaning.
- 2026-09-23: The payment-host scan runs over the public site and the game, not the board site, whose Needs you links go to Stripe's dashboard and which no card can change. It decodes what a browser decodes before matching, and fails closed: a double percent-encoding a browser would decode only once still fails. No directive of the Content Security Policy limits a link or a change of location, so neither `form-action` nor `connect-src` covers an address assembled at run time; that is left to review (above).
- 2026-09-23: /board on the public site answers 404 through Netlify rules; a local preview has no redirect rules, so the live check skips the status there and still checks the page. The page's check allows the game's netlify.app host, which the top bar links to on every page, and no other; the board site's own address is checked only when `BOARD_SITE_URL` is in the environment, since it never goes in the repository.
