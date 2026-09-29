# The studio rename

Status: built. Card: none. Owner: board.

Domain (29 September 2026): the board registered mobmachine.games (PLAN.md §10 decision 59); `{{DOMAIN}}` below is mobmachine.games and the game's address is play.mobmachine.games. It is live since #107; its evidence is below, and only the board's Stripe links are left.

What is left (23 September 2026, after the merge): `managed:apply` (step 8), which waits on Console credit in the studio's Anthropic organisation and on the Mac host's install; the board's steps (Stripe, Discord, the signature, the sign-in email's sender name); and the domain half, which waits on the board registering a domain. Every Verification line that does not name the domain has run and is quoted in Evidence.

The name: **Mob Machine**, the board's call on 23 September 2026 (PLAN.md §10 decision 43), with a new mark in place of the peanut (`specs/machine-mark.md`). The domain: not chosen yet. `{{DOMAIN}}` below stands for it and every line that names it is a pending board step; until the board registers one, the site stays at peanutgallery.games and only the name changes. The rename is not in `docs/BACKLOG.md`, because every backlog entry becomes a public /roadmap card.

## Problem

The studio can no longer be called Peanut Gallery or live at peanutgallery.games. The name and the domain are on the site, the legal pages, link previews, the game's page and tab title, the agents' instructions, Stripe and the board's sign-in, and a player who sees the old name after the change sees a studio that does not know its own name.

## Scope

In: every surface a player, a contributor, a Stripe customer, a search engine or an agent sees (tier 1), then internal prose and alert titles (tier 2). The board's steps in the services that hold the name.

Out: history, which is never rewritten: specs under `docs/specs/` other than this one, applied migrations, dated decisions in PLAN.md §10, and quoted evidence. Internal identifiers nobody outside sees (tier 3), each left for the reason given below.

## Behaviour

`scripts/rename.mjs` holds the file list in tiers and does the text rewrite; `scripts/rename.test.mjs`, part of `pnpm verify`, fails when a tracked file carries the old name or domain without a tier, so the list stays whole until the migration runs.

- `node scripts/rename.mjs` prints every file that carries the old name, the domain or an internal identifier, by tier. Read-only.
- `node scripts/rename.mjs --apply --tier 1 --name "Mob Machine" [--domain {{DOMAIN}}]` rewrites the tier's files: "Peanut Gallery" in any case (and `Peanut+Gallery` in URLs) becomes Mob Machine, and, only when `--domain` names a different domain, `peanutgallery.games` in any case becomes `{{DOMAIN}}`, emails and `www.` included. An unchanged domain is left exactly as written, so the tests' mixed-case addresses keep testing case-insensitive matching. It refuses to run while any file is unclassified, and skips the lines in `KEEP_LINES` (the dated decisions 2 and 42 in PLAN.md §10, and a Done entry in BOARD-SETUP that quotes the Terms of 20 September 2026).
- `node scripts/rename.mjs --check` exits 1 while a tier-1 file still carries the old name. It is part of `pnpm verify` (`test:rename`), so a public file that brings the old name back fails the floor.
- `node scripts/rename.mjs --check-domain` also exits 1 while a tier-1 file carries the old domain. It replaces `--check` in `test:rename` in the domain's pull request.

### The migration session, in order

The name ran on 23 September 2026 in one board pull request, tiers 1 and 2 together; the domain half (the steps marked "domain") runs in a later pull request once the board has registered one.

1. [x] Fill the placeholders in this spec: the name is filled; `{{DOMAIN}}` waits on the board. The mark is settled (below); the game's address waits on the domain.
2. [x] Branch. `node scripts/rename.mjs --apply --tier 1 --name "Mob Machine" --domain peanutgallery.games` (the domain unchanged on purpose). Domain: the same with `--domain {{DOMAIN}}`.
3. [x] Hand edits the script cannot make (the domain ones are left for the domain's pull request):
   - [x] PLAN.md: §10 decision 43 recording the rename and its date, decision 2 marked superseded by it, §3's line naming the studio, and §11 Names. The opening line is the script's. CLAUDE.md's opening paragraph reworded around the new name, keeping that the package names use the working name Backseat.
   - [x] Grammar and wording read in every rewritten file (`git grep -niE "peanut|gallery" -- platform seed-1 docs ':!docs/specs'`): nothing was built on "peanut" or "gallery" but the mark; "the peanut mark" in `DESIGN.md`, `styles.css`, `App.tsx`, `og-image.mjs` and the Guide's note became the new mark (`specs/machine-mark.md`); "Mob Machine" takes "a" where an article is needed. The Ontario business-name line in BOARD-SETUP was split across two lines, which the script cannot see, and was changed by hand.
   - [x] BOARD-SETUP's Done entry of 20 September 2026 quotes the Terms as they read then, so its "Peanut Gallery" is restored and kept (`KEEP_LINES`).
   - [x] Domain: `platform/site/netlify.toml`, a forced 301 from `https://peanutgallery.games/*` and `https://www.peanutgallery.games/*` to `https://{{DOMAIN}}/:splat`, beside the existing `.netlify.app` redirect.
   - [x] `platform/site/scripts/live-check.mjs`: the home title, og:title and og:site_name are "Mob Machine", the top bar's "Mob Machine" link goes home and draws the mark, the icons answer 200, and from Terms version 3 /terms names Mob Machine as the operator. Domain: a check that the old domain answers 301 to the new one.
   - [x] The Terms: version 3 appended to `platform/site/src/lib/terms-versions.ts` (the script never rewrites that file: each posted version is what applied to the money given under it). Its words are version 2's with "Peanut Gallery" changed to "Mob Machine" in its four places and nothing else, which `copy.test.ts` holds. The Refunds page is one document with the Terms and never named the studio, so it moves to version 3 with it unchanged; the Privacy page does not name the studio and is not versioned. Migration `20260925000000_terms_version_3.sql` posts it by the procedure in `specs/legal-copy.md`, applied after the site deploy (Production steps, below).
4. [x] The link preview: `node platform/site/scripts/og-image.mjs` (the name from `copy.ts`, the address from `index.html`, the mark from `brand/mark.svg`), and `public/og.png` committed. Domain: run it again.
5. [x] `pnpm verify`, the site e2e and the board e2e (Evidence). Pull request, merge on a green gate.
6. [ ] The board's steps below: the name ones after the deploy; the domain ones when the board has registered one. Open: none is ticked yet.
7. [x] Production data: the read-only name query below; fix any hit through /board or a data migration with a dump first (`specs/money-safety.md`). A card that links to peanutgallery.games or the game's netlify.app address is correct until the domain moves, so the name query does not look for either. Domain: the domain query below (open, waits on the domain).
8. [ ] The managed agent: `agent.yaml` and `environment.yaml` changed in tier 1 (the description and system text name the studio), so run `pnpm --filter @backseat/dispatcher managed:apply` with the board's allow and put the new `MANAGED_AGENT_VERSION` in the Mac host's `env/dispatcher.env`, then `platform/ops/mac/install.sh`. The startup check refuses an agent that differs from `agent.yaml`, so the unattended dispatcher does not start until this is done. The `name:` keys stay, because `managed:apply` finds the agent by name and a new name makes a new agent and a new id. Open: it ran and failed on "Your credit balance is too low to access the Anthropic API" (Evidence); it waits on Console credit, bought from a payout (`docs/BOARD-SETUP.md` step 22), and the Mac host is not installed yet, so there is no env file to update.
9. [x] Tier 2 ran in the same pull request (`--apply --tier 2`), since nothing in it waits on the domain. The ntfy titles change on the Mac after `install.sh`.
10. [x] Update the memory files and this spec's Evidence; this spec is built, and moves to done when every line of Verification has run.

### Open questions for the board, at migration time

- **The mark: settled.** The peanut did not survive the name. The new mark is a small machine drawn in code (`platform/site/brand/mark.svg`, `specs/machine-mark.md`); the favicons, `apple-touch-icon.png`, `icon-512.png` and `og.png` are drawn from it, and `peanut.png`, `brand/peanut-source.png` and the invert filter are deleted.
- **The game's address: play.mobmachine.games** (29 September 2026, the board took the recommendation). The game lives at `peanutgallery-seed-1.netlify.app`, a public URL in tier 3. Renaming the Netlify site changes the URL and breaks shared links; a subdomain such as `play.{{DOMAIN}}` avoids both. Either way `VITE_PLAY_URL` in `platform/site/netlify.toml` and the og:url in `seed-1/index.html` follow.

### Tier 1: public

The files are `TIERS[1]` in `scripts/rename.mjs`. By surface:

- The site: `index.html` (title, og tags, image alt), `src/lib/copy.ts` (the studio name), `src/lib/legal.ts`, `styles.css` and `DESIGN.md` headers, `netlify.toml`, `scripts/live-check.mjs`, and the unit and e2e tests that pin them.
- The board's own site, `platform/board`: `index.html` (the title), `src/Board.tsx` (the authenticator line), and the tests that pin them (`src/Board.test.tsx`, `e2e/board.spec.ts`, and `platform/supabase/test/board-users.test.ts` for the board's sign-in addresses).
- The game (protected, a board change): `seed-1/index.html` (title, meta, og tags, the studio line and link), `seed-1/content/strings.json` (`tabTitle`), `seed-1/CLAUDE.md`, directive D3 in `platform/supabase/lib/directives.ts`, its test, the launch-cards seed and the refresh-cards fixture.
- The agents: `platform/agents/managed/agent.yaml` and `environment.yaml` (description and system text), the agents' git author `agents@peanutgallery.games` in `platform/dispatcher/src/worktree.ts` and `platform/ops/Dockerfile.dispatcher`, which shows on every public commit. The new address need not receive mail.
- The constitution and the root docs: `CLAUDE.md`, `README.md`, `docs/PLAN.md`, `docs/ROADMAP.md`'s standing facts.

### The board's steps

Written out with the clicks in `docs/BOARD-SETUP.md`, "Rename to Mob Machine".

- [ ] Stripe: the public business name, the statement descriptor, the Payment Link's product name if it names the studio, and the icon on checkout and receipts (`icon-512.png`). The after-payment URL changes with the domain. Claude reads or changes nothing in Stripe without asking first.
- [ ] Discord: the server's name and icon (`icon-512.png`). The invite in `netlify.toml` keeps working.
- [ ] The hello@clayhouse.studio signature. The address itself does not change (PLAN.md §10 decision 37).
- [ ] The Twitch channel, which already exists under the old name (https://www.twitch.tv/peanut_gallery_games), is renamed when the board chooses, and its new handle goes in the repository (`docs/BOARD-SETUP.md`, Handles). This line first assumed the channel was still to be made; corrected 26 September 2026.
- [x] Domain: register `{{DOMAIN}}` and tell Claude (mobmachine.games, 29 September 2026). Keep peanutgallery.games registered and renewing, so old links, shared previews, search results and the agents' commit address keep working.
- [x] Domain: Netlify, site `peanutgallerygames`: add `{{DOMAIN}}` and `www.{{DOMAIN}}`, set `{{DOMAIN}}` as primary, wait for the certificate; keep peanutgallery.games as a domain alias so the 301 in `netlify.toml` serves it.
- [ ] Supabase Auth, project `lyxndueoeisyqzewflpu`: the sign-in email's sender name is Mob Machine. It is set with the Resend SMTP settings (`specs/board-site.md` production step 7, whose text predates the rename and names the old studio: use Mob Machine). The Site URL and the redirect list are the board's own site's address (`specs/board-site.md` production step 4), not the public domain, so the domain leaves them alone. A second factor enrolled before the rename keeps its old label in the authenticator app; that is cosmetic.

### Production data

Read-only, on production, after the deploy. Rows the site shows publicly that still say the old name, with the pattern of `OLD_NAME` in `scripts/rename.mjs` ("Peanut Gallery" or `Peanut+Gallery` in any case), which leaves the domain alone:

```sql
select id, title, summary from public.cards
where concat_ws(' ', title, summary, intent, acceptance_test) ~* 'peanut[ +]gallery';
```

Domain, in the domain's pull request: the same query with `~* 'peanutgallery\.games'`. Directive D3 links to the site and names the game's address (`platform/supabase/lib/directives.ts`), so its filed card is one of the hits; each is fixed the same way. The game's `peanutgallery-seed-1.netlify.app` address follows only if the game's address moves (the open questions).

### Tier 2: internal (ran with tier 1)

`TIERS[2]`: `docs/BOARD-SETUP.md` (including the prefilled token-form descriptions), `platform/ops/README.md`, the ntfy and healthcheck titles in the dispatcher (`src/alert.ts`), the jobs, the Mac scripts, the systemd units and `stripe-webhook`, the backups workflow, and fixture emails and strings in tests. Only the board sees these.

Also internal and not in the script: renaming the GitHub repository. GitHub redirects the old URL, but `GITHUB_REPO` in the Mac host's `env/dispatcher.env`, the work clone's origin and PLAN.md §6 change with it, and the dispatcher refuses a mismatch, so it happens with the dispatcher stopped, or not at all.

### Tier 3: left as they are

Counted by the script, never rewritten, each because renaming it costs more than anyone gains:

- `@backseat/*` package names and `project_id = "backseat"`: already history (PLAN.md §6), and every command in the docs uses them.
- The Mac host: launchd labels `studio.peanutgallery.*`, `~/peanutgallery-host`, `PEANUTGALLERY_HOST`; the server's `/etc/peanutgallery` and `peanutgallery-*` units. Renaming means reinstalling the LaunchAgents and moving the host folder.
- The database login `peanutgallery_backup`: a migration, a new password, and every backup env file and check that names it, on the path that guards the money.
- The managed agent and environment `name:` keys (see step 8), the healthchecks.io check names, the token names, and the Netlify site slugs `peanutgallerygames` and `peanutgallery-seed-1` (the game's slug is public; see the open questions).

## Acceptance criteria

- [x] `node scripts/rename.mjs` lists no unclassified file, and `scripts/rename.test.mjs` fails when one appears.
- [x] A trial of `--apply --tier 1` and `--apply --tier 2` with a placeholder name on a working copy leaves `pnpm verify` green.
- [x] `node scripts/rename.mjs --check` reports tier 1 free of the old name, and `pnpm verify` runs it.
- [x] Terms version 3 is version 2 with the name changed and nothing else (`copy.test.ts`), and its migration inserts only its row (`migration.test.ts`, `migration_test.ts`).
- [x] The live site at peanutgallery.games carries the new name in the title, the header, the link preview and, once version 3 is posted, the Terms (the live check).
- [x] The game's tab title and studio line carry the new name (built; live after the game's deploy).
- [x] The production data name query returns no rows.
- [ ] Every board step above is ticked.
- [ ] Domain: https://{{DOMAIN}} serves the site; https://peanutgallery.games/<any path> answers 301 to the same path on `{{DOMAIN}}`; the game's studio line links to `{{DOMAIN}}`; `--check-domain` is clean; the production data domain query returns no rows.

## Verification

- `node scripts/rename.mjs --check`
- `pnpm verify`
- `pnpm --filter @backseat/site e2e` and `pnpm --filter @backseat/board e2e`
- `node platform/site/scripts/live-check.mjs` against production, after the deploy and again after version 3 is posted
- The production data name query, output quoted; domain: the domain query, output quoted
- Domain: `curl -sI https://peanutgallery.games/how-it-works` shows a 301 to `https://{{DOMAIN}}/how-it-works`, and a link preview of `https://{{DOMAIN}}` (the Open Graph debugger of one platform) shows the new og.png and title

## Production steps (need the board's allow)

In order, after the merge, the studio paused:

1. Wait for the site deploy of the merge sha, and check that /terms still shows "Version 2, in force since" (version 3 is carried, not posted).
2. Take a dump, apply `20260925000000_terms_version_3.sql` through the Management API query endpoint (or `supabase db push` once the history repair has run), read back `select version, posted_at from public.terms_versions order by version`, and run the live check, which must show "Version 3, in force since" and "/terms names Mob Machine as the operator".
3. The production data name query; fix any hit with a dump first. A card that links to the current domain or the game's address is left as it is.
4. `managed:apply` and the Mac host's `MANAGED_AGENT_VERSION` (step 8 above), before the dispatcher next starts unattended.
5. `stripe-webhook` deployed from main, whose ntfy alert title now reads "Mob Machine payments". Cosmetic, so it can ride the next webhook deploy.

## Evidence

- Domain (29 September 2026), branch `board/domain-mobmachine`:
  - The board registered mobmachine.games at GoDaddy and imported the zone file; after two hand fixes (the Parked `@` A record deleted, `www` pointed at the site) GoDaddy's nameserver answered `mobmachine.games: 75.2.60.5`, `www.mobmachine.games: peanutgallerygames.netlify.app.`, `play.mobmachine.games: peanutgallery-seed-1.netlify.app.`.
  - Netlify through its API: `mobmachine.games` and `www.mobmachine.games` added as domain aliases of `peanutgallerygames` (read back `['www.peanutgallery.games', 'mobmachine.games', 'www.mobmachine.games']`), `play.mobmachine.games` the custom domain of `peanutgallery-seed-1`; the site's certificate renewed (`POST /ssl/renew`) and read back from the edge as `DNS:mobmachine.games, DNS:peanutgallery.games, DNS:www.mobmachine.games, DNS:www.peanutgallery.games`, the game's as `DNS:play.mobmachine.games`; `https://play.mobmachine.games/` 200.
  - `node scripts/rename.mjs --apply --tier 1 --name "Mob Machine" --domain mobmachine.games` rewrote 28 files; the lines that must name the old domain (the 301 sources, the live check's old-domain check, the decision) are in `KEEP_LINES`. `node scripts/rename.mjs --check-domain`: "tier 1 carries the old name or domain nowhere", and `test:rename` now runs it.
  - Site unit tests "526 passed (526)"; supabase 325, board 103, dispatcher 872; `E2E_PORT=4452 npx playwright test e2e/csp.spec.ts` 6 passed, `previews` 1 passed; board e2e 9 passed.
  - Merged as #107 (d421c7c) on "LOCAL GATE PASS pr=107 head=596d535a993eaa28685c2cae3823a8e2580b4df6 base=691e7642c07687a809f3aa4492a9a7fde6da850f"; `pnpm verify` exit 0 on the branch first. Site and game deployed at d421c7c (`d421c7c ready` on both).
  - After the deploy: `mobmachine.games` made the primary domain of `peanutgallerygames` through the API (read back `mobmachine.games ['www.mobmachine.games', 'peanutgallery.games', 'www.peanutgallery.games'] https://mobmachine.games`). `https://peanutgallery.games/how-it-works?x=1 -> 301 https://mobmachine.games/how-it-works?x=1`, `https://www.peanutgallery.games/ledger -> 301 https://mobmachine.games/ledger`, `https://peanutgallerygames.netlify.app/team -> 301 https://mobmachine.games/team`, `https://www.mobmachine.games/ -> 301 https://mobmachine.games/`.
  - The domain data query found one row, card 23b1883a-7844-407a-bd83-f42056d47602 (live, directive D3). Dump `~/peanutgallery-dumps/pre-domain-20260929T133740Z.dump` (836,423 bytes, mode 600, 80 TABLE DATA entries); the replacement was checked to give exactly the refresh-cards fixture's summary, intent and acceptance_test ("eq True" for each), then applied by id and `stage='live'`; the query again: `[]`. `anon-negative-test.ts` "PASS: anon access matches the RLS contract"; `ledger-identity.ts` "PASS: ledger identity holds over 1 contribution rows, 0 studio ledger rows, 1 allocations and 66 cards". CDN purged (202); /api/cards names only mobmachine.games and play.mobmachine.games.
  - "PASS live-check https://mobmachine.games passed=278 failed=0 skipped=2" (BOARD_SITE_URL unset), with "PASS peanutgallery.games answers 301 to https://mobmachine.games/how-it-works?x=1" and the same for www. The Mac's own resolver still held a negative answer for mobmachine.games from before the records existed (1.1.1.1 and 8.8.8.8 answered 75.2.60.5), so the run mapped the name to 75.2.60.5 for Node and Chromium.
  - Chromium at 375 and 1440: `/` and `/how-it-works` titled "Mob Machine" and "How it works · Mob Machine", no old domain in the page, Play links to https://play.mobmachine.games, no sideways scroll; the game titled "Dust · Mob Machine", its studio link https://mobmachine.games, og:url https://play.mobmachine.games/.
  - Left: the board's Stripe links (BOARD-SETUP checklist Part 1 step 5), and Google Search Console's change of address (optional).
- Production, after the merge (#79 squash-merged as 5f40ab52a53142fd87a69ba9de67de40752f2d7c at 2026-09-24T03:08:58Z, 23:08 on 23 September 2026 Toronto time):
  1. Checks before the merge, at the head d692c03 with origin/main at ecdfba6: `pnpm verify` ended "tier 1 carries the old name nowhere", exit 0; the site e2e "5 skipped / 148 passed (3.2m)", exit 0.
  2. The gate ran locally, since Actions could not start jobs (`specs/local-gate.md`): "LOCAL GATE PASS pr=79 head=d692c031b2b890c03c639ef378e88e541dbf3a79 base=ecdfba6ab6f9420dcaf8aa26fe662739f9c36b0b merge=4c09dcc7fae036cbfab1c7104d9c9fe881400a2d seed=true platform=true lane=code site=true functions=true", with "PASS: gate tests passed=508", functions "97 passed (106 steps) | 0 failed", site e2e "148 passed (3.2m)", board e2e "6 passed (3.4s)" and "GATE PASS folder=seed-1 lane=code phase=bot".
  3. The merge: origin/main read ecdfba6ab6f9420dcaf8aa26fe662739f9c36b0b, the PASS line's base, and the head read d692c031; `gh pr merge 79 --squash --match-head-commit d692c031…` with the PASS line in the body gave 5f40ab5 "Rename to Mob Machine, with a new mark (#79)".
  4. The deploys, all at 5f40ab5: public site `70df3957 5f40ab5 ready 2026-09-24T03:09:27Z`, board site `51051b5b 5f40ab5 ready 03:10:09Z`, game `4a5a0913 5f40ab5 ready 03:09:48Z`. The live public page carries `meta build-sha content="5f40ab52a53142fd87a69ba9de67de40752f2d7c"`.
  5. Production step 1: /terms before the migration read "Version 2, in force since 23 Sep 2026 at 17:34 Toronto time." The studio read back paused: `[{"paused":true,"pause_reason":"awaiting_credit","agent_mode":"attended"}]`.
  6. Production step 2: dump `~/peanutgallery-dumps/pre-terms-v3-20260924T030921Z.dump` (658421 bytes, mode 600; `pg_restore --list` shows 74 TABLE DATA entries, `cards`, `studio_state` and `terms_versions` among them). The only migration at or after `20260924300000` on main is `20260925000000_terms_version_3.sql`, whose one statement inserts version 3 into a table production already had (from `20260924100000`); applied as `begin; … commit;` through the Management API, which returned `[]`. Read-back: `[{"version":1,"posted_at":"2026-09-23 01:32:51+00"},{"version":2,"posted_at":"2026-09-23 21:34:48.452621+00"},{"version":3,"posted_at":"2026-09-24 03:10:07.021243+00"}]`. The live check then showed `PASS /terms shows "Version 3, in force since 23 Sep 2026 at 23:10 Toronto time."` and `PASS /terms names Mob Machine as the operator`.
  7. Production step 3, the name query: one row, card 23b1883a-7844-407a-bd83-f42056d47602 (live, from directive D3), whose summary, intent and acceptance_test named the old studio. Replacing the name was first checked to give exactly the text in `platform/supabase/test/fixtures/refresh-cards/cards.json` ("summary eq true intent eq true acc eq true"); then a fresh dump, `~/peanutgallery-dumps/pre-card-rename-20260924T031355Z.dump` (658456 bytes, mode 600), and an update with `replace()` limited to that id and `stage='live'`, which returned the new summary "The game tab reads Dust · Mob Machine …". The query again: `[]`. A scan of every public text column found only 5 `agent_events.payload_json` rows, which are history and which the `public_agent_events` view does not expose; they are left as they are.
  8. After both SQL changes: `anon-negative-test.ts` "PASS: anon access matches the RLS contract" (exit 0); `ledger-identity.ts` "PASS: ledger identity holds over 1 contribution rows, 0 studio ledger rows, 1 allocations and 57 cards" (exit 0).
  9. Production step 4 is open: `managed:apply` failed with "managed:apply failed: 400 … Your credit balance is too low to access the Anthropic API." The studio's Anthropic organisation has no credit, and the Mac host is not installed (no `~/peanutgallery-host`, no `studio.peanutgallery` LaunchAgents), so there is no env file for `MANAGED_AGENT_VERSION` yet.
  10. Production step 5: `stripe-webhook` deployed from `platform/` on main with `--use-api`: "Deployed Functions."; read-back `{"slug":"stripe-webhook","version":15,"status":"ACTIVE","updated_at":"2026-09-24T03:15:07Z"}`; an unsigned POST answers 400. No Stripe API was called.
  11. The live check: "PASS live-check https://peanutgallery.games passed=236 failed=0 skipped=0" (main at 5f40ab5, after version 3 was posted and the card was fixed; exit 0).
  12. The name in Chromium on 17 public routes (/, /how-it-works, /team, /roadmap, the Guide, /contribute, /ledger, /terms, /terms/1 to /terms/3, /privacy, /refunds, /refunds/2 and /refunds/3, /contact, a 404): every title ends "· Mob Machine" and every header shows the mark with "Mob Machine"; og:title and og:site_name are "Mob Machine". /terms/1 and /terms/2 keep the old name on purpose: posted versions are never rewritten. The live `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`, `icon-512.png` and `og.png` are byte-identical to main's; `og.png` and `icon-512.png` show the machine. The game: title "Dust · Mob Machine", og:site_name "Mob Machine", the studio line "Made by AI agents at Mob Machine · All ages", no old name, build-sha 5f40ab5. The board's site: title "Board · Mob Machine", no old name.
  13. Screenshots of home, /terms and /team at 375 and 1440 and the game at 375 were looked at: the header shows the white machine before MOB MACHINE at 1440 and the mark alone at 375, and /terms at 375 shows version 3 and "Mob Machine is operated by Kyle Smith". No fix was needed.
- The name (23 September 2026), branch `launch/rename-mob-machine`, built from main at fe42a58 and rebased on fb694f5 after #71 and #76 merged (#71 took decision 42, so the rename is decision 43):
  - `node scripts/rename.mjs` before the rewrite: 32 tier-1 files, 34 tier-2, 77 tier-3 and 60 history, none unclassified.
  - A first `--apply` with the unchanged domain lowercased the tests' mixed-case addresses (`Board@PeanutGallery.games` became `Board@peanutgallery.games` in eight test files), which exist to test case-insensitive matching. It was reverted with `git checkout -- .`, the script now leaves an unchanged domain as written, and the run was repeated: `--apply --tier 1 --name "Mob Machine" --domain peanutgallery.games` printed "tier 1: rewrote 23 files", and `--tier 2` "tier 2: rewrote 24 files".
  - `node scripts/rename.mjs --check`: "tier 1 carries the old name nowhere". `node --test scripts/rename.test.mjs`: 8 of 8 pass, among them the unchanged domain and the two checks.
  - Terms version 3 against version 2, once, with `node --experimental-strip-types`: "versions 1,2,3", "v3 equals v2 with the name changed: true", "Peanut Gallery in v3: false  Mob Machine count: 4". `copy.test.ts` holds the same.
  - `pnpm verify` at 3a845bb (the branch on fb694f5 before this evidence), exit 0: board 71, supabase 286, site 428, seed-1 77 and dispatcher 619 tests passed; "PASS: gate tests passed=508"; agents 117 and ops 124 pass; functions "97 passed (106 steps) | 0 failed"; "GATE PASS folder=seed-1 lane=code" and "GATE PASS folder=platform lane=code"; "PASS: secret-scan files=566"; docs 15 of 15; rename 8 of 8 and "tier 1 carries the old name nowhere". The machine's load average was 20 to 50 from other sessions: two plain runs before the rebase timed out five of the dispatcher's pipeline and worktree tests at 5 seconds, `pnpm --filter @backseat/dispatcher test` alone then passed 619 of 619, and the runs that exited 0 set `npm_config_workspace_concurrency=1`, one package at a time.
  - `E2E_PORT=4491 pnpm --filter @backseat/site e2e` at 3a845bb: "148 passed (3.3m)", 5 skipped (the screenshot specs, which run only when asked). On 187f403 one run failed one test on the 30-second limit under the same load ("every route › has no horizontal scroll at 375px", closed while waiting for fonts) and passed everything else; every run since passed it. `BOARD_E2E_PORT=4492 pnpm --filter @backseat/board e2e` at 3a845bb: "6 passed".
  - Screenshots of /, /team and /terms at 390 and 1440, built with `netlify.toml`'s public values and read against production, were looked at before and after the rebase: the titles read "Mob Machine", "The team · Mob Machine" and "Terms · Mob Machine"; the top bar shows the white machine before MOB MACHINE at 1440 and alone at 390; /terms shows "Version 2, in force since 23 Sep 2026 at 17:34 Toronto time." with version 2's words, as it must until version 3's row is posted. The Guide's specimen, the favicons magnified on light and dark strips, the two home-screen icons and `og.png` were looked at too; no fix came of it.
- Prep (23 September 2026): `node --test scripts/rename.test.mjs` passes 5 of 5; `node scripts/rename.mjs` lists 29 tier-1 files, 33 tier-2, 69 tier-3 and 39 history, none unclassified. Trial on a working copy, then reverted: `--apply --tier 1 --name "Trial Name" --domain trialname.example` rewrote 29 files, `--tier 2` rewrote 33, `--check` printed "tier 1 is clean", `pnpm verify` exited 0, and `pnpm --filter @backseat/site e2e` printed "27 passed".

## Decisions

- 23 September 2026: the name and domain change; the new ones are not chosen yet. The work is prepared as this spec and a script so the migration runs in one session once they are. It is kept off the public backlog until the name is announced.
- 23 September 2026: internal identifiers stay (tier 3). Nobody outside sees them, and renaming several of them touches the host, the backups or the managed agent's id.
- 23 September 2026: the board named the studio Mob Machine and asked for a new mark made by the studio; the domain waits until the board registers one. So only the name moves now: the rewrite leaves an unchanged domain exactly as written, `--check` looks for the name only and joins `pnpm verify`, and `--check-domain` is kept for the domain's pull request.
- 23 September 2026: tiers 1 and 2 in one pull request. Tier 2 is alert titles and internal prose, nothing in it waits on the domain, and one review is simpler than two.
- 23 September 2026: the Terms get version 3, version 2's words with the name changed, rather than an edit: posted words are what applied to the money given under them. Its migration is named for the day after money-logic's so it sorts after every migration already on main or in an open pull request.
- 23 September 2026, after review: the production data query looks for the name only, with `OLD_NAME`'s pattern. Its first form, `'peanut ?gallery|peanutgallery\.games'`, also matched the domain and the game's address (the optional space let `peanut ?gallery` match `peanutgallery`), so it could not return no rows before the domain moves and asked for correct links to be rewritten. The domain pattern moved to the domain's pull request.
- 23 September 2026: Supabase Auth's Site URL stays the board site's address. This spec's first draft moved it and the redirect list to the new domain; `specs/board-site.md`, written the same day, put sign-in on the board's own site with nothing on the public domain, and that stands. Only the sign-in email's sender name changes.
