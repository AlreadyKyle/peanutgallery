# The studio rename

Status: built. Card: none. Owner: board.

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
   - [ ] Domain: `platform/site/netlify.toml`, a forced 301 from `https://peanutgallery.games/*` and `https://www.peanutgallery.games/*` to `https://{{DOMAIN}}/:splat`, beside the existing `.netlify.app` redirect.
   - [x] `platform/site/scripts/live-check.mjs`: the home title, og:title and og:site_name are "Mob Machine", the top bar's "Mob Machine" link goes home and draws the mark, the icons answer 200, and from Terms version 3 /terms names Mob Machine as the operator. Domain: a check that the old domain answers 301 to the new one.
   - [x] The Terms: version 3 appended to `platform/site/src/lib/terms-versions.ts` (the script never rewrites that file: each posted version is what applied to the money given under it). Its words are version 2's with "Peanut Gallery" changed to "Mob Machine" in its four places and nothing else, which `copy.test.ts` holds. The Refunds page is one document with the Terms and never named the studio, so it moves to version 3 with it unchanged; the Privacy page does not name the studio and is not versioned. Migration `20260925000000_terms_version_3.sql` posts it by the procedure in `specs/legal-copy.md`, applied after the site deploy (Production steps, below).
4. [x] The link preview: `node platform/site/scripts/og-image.mjs` (the name from `copy.ts`, the address from `index.html`, the mark from `brand/mark.svg`), and `public/og.png` committed. Domain: run it again.
5. [x] `pnpm verify`, the site e2e and the board e2e (Evidence). Pull request, merge on a green gate.
6. [ ] The board's steps below: the name ones after the deploy; the domain ones when the board has registered one.
7. [ ] Production data: the read-only query below; fix any hit through /board or a data migration with a dump first (`specs/money-safety.md`).
8. [ ] The managed agent: `agent.yaml` and `environment.yaml` changed in tier 1 (the description and system text name the studio), so run `pnpm --filter @backseat/dispatcher managed:apply` with the board's allow and put the new `MANAGED_AGENT_VERSION` in the Mac host's `env/dispatcher.env`, then `platform/ops/mac/install.sh`. The startup check refuses an agent that differs from `agent.yaml`, so the unattended dispatcher does not start until this is done. The `name:` keys stay, because `managed:apply` finds the agent by name and a new name makes a new agent and a new id.
9. [x] Tier 2 ran in the same pull request (`--apply --tier 2`), since nothing in it waits on the domain. The ntfy titles change on the Mac after `install.sh`.
10. [ ] Update the memory files and this spec's Evidence; this spec is built, and moves to done when every line of Verification has run.

### Open questions for the board, at migration time

- **The mark: settled.** The peanut did not survive the name. The new mark is a small machine drawn in code (`platform/site/brand/mark.svg`, `specs/machine-mark.md`); the favicons, `apple-touch-icon.png`, `icon-512.png` and `og.png` are drawn from it, and `peanut.png`, `brand/peanut-source.png` and the invert filter are deleted.
- **The game's address: waits on the domain.** The game lives at `peanutgallery-seed-1.netlify.app`, a public URL in tier 3. Renaming the Netlify site changes the URL and breaks shared links; a subdomain such as `play.{{DOMAIN}}` avoids both. Either way `VITE_PLAY_URL` in `platform/site/netlify.toml` and the og:url in `seed-1/index.html` follow.

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
- [ ] Handles planned in the backlog (the Twitch channel) are taken under the new name when they are made.
- [ ] Domain: register `{{DOMAIN}}` and tell Claude. Keep peanutgallery.games registered and renewing, so old links, shared previews, search results and the agents' commit address keep working.
- [ ] Domain: Netlify, site `peanutgallerygames`: add `{{DOMAIN}}` and `www.{{DOMAIN}}`, set `{{DOMAIN}}` as primary, wait for the certificate; keep peanutgallery.games as a domain alias so the 301 in `netlify.toml` serves it.
- [ ] Supabase Auth, project `lyxndueoeisyqzewflpu`: the sign-in email's sender name is Mob Machine. It is set with the Resend SMTP settings (`specs/board-site.md` production step 7, whose text predates the rename and names the old studio: use Mob Machine). The Site URL and the redirect list are the board's own site's address (`specs/board-site.md` production step 4), not the public domain, so the domain leaves them alone. A second factor enrolled before the rename keeps its old label in the authenticator app; that is cosmetic.

### Production data

Read-only, on production, after the deploy. Rows the site shows publicly that still say the old name:

```sql
select id, title, summary from public.cards
where concat_ws(' ', title, summary, intent, acceptance_test) ~* 'peanut ?gallery|peanutgallery\.games';
```

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
- [ ] The live site at peanutgallery.games carries the new name in the title, the header, the link preview and, once version 3 is posted, the Terms (the live check).
- [ ] The game's tab title and studio line carry the new name (built; live after the game's deploy).
- [ ] The production data query returns no rows.
- [ ] Every board step above is ticked.
- [ ] Domain: https://{{DOMAIN}} serves the site; https://peanutgallery.games/<any path> answers 301 to the same path on `{{DOMAIN}}`; the game's studio line links to `{{DOMAIN}}`; `--check-domain` is clean.

## Verification

- `node scripts/rename.mjs --check`
- `pnpm verify`
- `pnpm --filter @backseat/site e2e` and `pnpm --filter @backseat/board e2e`
- `node platform/site/scripts/live-check.mjs` against production, after the deploy and again after version 3 is posted
- The production data query, output quoted
- Domain: `curl -sI https://peanutgallery.games/how-it-works` shows a 301 to `https://{{DOMAIN}}/how-it-works`, and a link preview of `https://{{DOMAIN}}` (the Open Graph debugger of one platform) shows the new og.png and title

## Production steps (need the board's allow)

In order, after the merge, the studio paused:

1. Wait for the site deploy of the merge sha, and check that /terms still shows "Version 2, in force since" (version 3 is carried, not posted).
2. Take a dump, apply `20260925000000_terms_version_3.sql` through the Management API query endpoint (or `supabase db push` once the history repair has run), read back `select version, posted_at from public.terms_versions order by version`, and run the live check, which must show "Version 3, in force since" and "/terms names Mob Machine as the operator".
3. The production data query below; fix any hit with a dump first.
4. `managed:apply` and the Mac host's `MANAGED_AGENT_VERSION` (step 8 above), before the dispatcher next starts unattended.
5. `stripe-webhook` deployed from main, whose ntfy alert title now reads "Mob Machine payments". Cosmetic, so it can ride the next webhook deploy.

## Evidence

- The name (23 September 2026), branch `launch/rename-mob-machine` from main at fe42a58:
  - `node scripts/rename.mjs` before the rewrite: 32 tier-1 files, 34 tier-2, 77 tier-3 and 60 history, none unclassified.
  - A first `--apply` with the unchanged domain lowercased the tests' mixed-case addresses (`Board@PeanutGallery.games` became `Board@peanutgallery.games` in eight test files), which exist to test case-insensitive matching. It was reverted with `git checkout -- .`, the script now leaves an unchanged domain as written, and the run was repeated: `--apply --tier 1 --name "Mob Machine" --domain peanutgallery.games` printed "tier 1: rewrote 23 files", and `--tier 2` "tier 2: rewrote 24 files".
  - `node scripts/rename.mjs --check`: "tier 1 carries the old name nowhere". `node --test scripts/rename.test.mjs`: 8 of 8 pass, among them the unchanged domain and the two checks.
  - Terms version 3 against version 2, once, with `node --experimental-strip-types`: "versions 1,2,3", "v3 equals v2 with the name changed: true", "Peanut Gallery in v3: false  Mob Machine count: 4". `copy.test.ts` holds the same.
  - `pnpm verify` exit 0: board 71, supabase 286, site 383, seed-1 77 and dispatcher 619 tests passed; "PASS: gate tests passed=508"; agents 117 and ops 124 pass; functions "97 passed (106 steps) | 0 failed"; "GATE PASS folder=seed-1 lane=code" and "GATE PASS folder=platform lane=code"; secret-scan PASS; docs 15 of 15; rename 8 of 8 and "tier 1 carries the old name nowhere". The machine's load average was about 50 from other sessions, and two plain runs timed out five of the dispatcher's pipeline and worktree tests at 5 seconds; `pnpm --filter @backseat/dispatcher test` alone passed 619 of 619, and the run that exited 0 set `npm_config_workspace_concurrency=1`, one package at a time.
  - `E2E_PORT=4491 pnpm --filter @backseat/site e2e`: "112 passed (3.1m)", 5 skipped. `BOARD_E2E_PORT=4492 pnpm --filter @backseat/board e2e`: "6 passed".
  - Screenshots of /, /team and /terms at 390 and 1440, built with `netlify.toml`'s public values and read against production, were looked at: the titles read "Mob Machine", "The team · Mob Machine" and "Terms · Mob Machine"; the top bar shows the white machine before MOB MACHINE at 1440 and alone at 390; /terms shows "Version 2, in force since 23 Sep 2026 at 17:34 Toronto time." with version 2's words, as it must until version 3's row is posted. The Guide's specimen, the favicons magnified on light and dark strips, the two home-screen icons and `og.png` were looked at too; no fix came of it.
- Prep (23 September 2026): `node --test scripts/rename.test.mjs` passes 5 of 5; `node scripts/rename.mjs` lists 29 tier-1 files, 33 tier-2, 69 tier-3 and 39 history, none unclassified. Trial on a working copy, then reverted: `--apply --tier 1 --name "Trial Name" --domain trialname.example` rewrote 29 files, `--tier 2` rewrote 33, `--check` printed "tier 1 is clean", `pnpm verify` exited 0, and `pnpm --filter @backseat/site e2e` printed "27 passed".

## Decisions

- 23 September 2026: the name and domain change; the new ones are not chosen yet. The work is prepared as this spec and a script so the migration runs in one session once they are. It is kept off the public backlog until the name is announced.
- 23 September 2026: internal identifiers stay (tier 3). Nobody outside sees them, and renaming several of them touches the host, the backups or the managed agent's id.
- 23 September 2026: the board named the studio Mob Machine and asked for a new mark made by the studio; the domain waits until the board registers one. So only the name moves now: the rewrite leaves an unchanged domain exactly as written, `--check` looks for the name only and joins `pnpm verify`, and `--check-domain` is kept for the domain's pull request.
- 23 September 2026: tiers 1 and 2 in one pull request. Tier 2 is alert titles and internal prose, nothing in it waits on the domain, and one review is simpler than two.
- 23 September 2026: the Terms get version 3, version 2's words with the name changed, rather than an edit: posted words are what applied to the money given under them. Its migration is named for the day after money-logic's so it sorts after every migration already on main or in an open pull request.
- 23 September 2026: Supabase Auth's Site URL stays the board site's address. This spec's first draft moved it and the redirect list to the new domain; `specs/board-site.md`, written the same day, put sign-in on the board's own site with nothing on the public domain, and that stands. Only the sign-in email's sender name changes.
