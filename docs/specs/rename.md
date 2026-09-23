# The studio rename

Status: draft. Card: none. Owner: board.

Placeholders, filled in first by the session that runs the migration: `{{NAME}}` is the new display name, `{{DOMAIN}}` the new domain. Until the board chooses them this spec is prepared work only, and nothing here is public: the rename is not in `docs/BACKLOG.md` because every backlog entry becomes a public /roadmap card.

## Problem

The studio can no longer be called Peanut Gallery or live at peanutgallery.games. The name and the domain are on the site, the legal pages, link previews, the game's page and tab title, the agents' instructions, Stripe and the board's sign-in, and a player who sees the old name after the change sees a studio that does not know its own name.

## Scope

In: every surface a player, a contributor, a Stripe customer, a search engine or an agent sees (tier 1), then internal prose and alert titles (tier 2). The board's steps in the services that hold the name.

Out: history, which is never rewritten: specs under `docs/specs/` other than this one, applied migrations, dated decisions in PLAN.md §10, and quoted evidence. Internal identifiers nobody outside sees (tier 3), each left for the reason given below.

## Behaviour

`scripts/rename.mjs` holds the file list in tiers and does the text rewrite; `scripts/rename.test.mjs`, part of `pnpm verify`, fails when a tracked file carries the old name or domain without a tier, so the list stays whole until the migration runs.

- `node scripts/rename.mjs` prints every file that carries the old name, the domain or an internal identifier, by tier. Read-only.
- `node scripts/rename.mjs --apply --tier 1 --name "{{NAME}}" --domain {{DOMAIN}}` rewrites the tier's files: "Peanut Gallery" in any case (and `Peanut+Gallery` in URLs) becomes `{{NAME}}`, `peanutgallery.games` in any case becomes `{{DOMAIN}}`, emails and `www.` included. It refuses to run while any file is unclassified, and skips the lines in `KEEP_LINES`.
- `node scripts/rename.mjs --check` exits 1 while a tier-1 file still carries the old name or domain.

### The migration session, in order

1. Fill the placeholders in this spec. Settle the two open questions below with the board.
2. Branch. `node scripts/rename.mjs --apply --tier 1 --name "{{NAME}}" --domain {{DOMAIN}}`.
3. Hand edits the script cannot make:
   - PLAN.md: a new §10 decision recording the rename and its date; the opening line; §6's facts. CLAUDE.md line 3 ("The working name is Backseat…") reworded around the new name.
   - The script replaces text only. Read each rewritten sentence in `copy.ts`, the legal pages, `seed-1/index.html` and the directives for grammar ("a {{NAME}}" / "an {{NAME}}") and for jokes or wording built on "peanut" or "gallery" (`git grep -niE "peanut|gallery" -- platform/site/src seed-1`).
   - `platform/site/netlify.toml`: a forced 301 from `https://peanutgallery.games/*` and `https://www.peanutgallery.games/*` to `https://{{DOMAIN}}/:splat`, beside the existing `.netlify.app` redirect.
   - `platform/site/scripts/live-check.mjs`: a check that the old domain answers 301 to the new one.
4. The link preview: `node platform/site/scripts/og-image.mjs` (it reads the name from `copy.ts` and the address from `index.html`) and commit `public/og.png`.
5. `pnpm verify`, the site e2e, pull request, merge on a green gate.
6. The board's steps below, the same day as the deploy.
7. Production data: the read-only query below; fix any hit through /board or a data migration with a dump first (`specs/money-safety.md`).
8. The managed agent: `agent.yaml` and `environment.yaml` changed in tier 1, so run `pnpm --filter @backseat/dispatcher managed:apply` with the board's allow and put the new `MANAGED_AGENT_VERSION` in the Mac host's `env/dispatcher.env`, then `platform/ops/mac/install.sh`. The startup check refuses an agent that differs from `agent.yaml`, so the dispatcher does not start until this is done. The `name:` keys stay, because `managed:apply` finds the agent by name and a new name makes a new agent and a new id.
9. Tier 2 in its own pull request: `--apply --tier 2`, then `pnpm verify`. The ntfy titles change on the Mac after `install.sh`.
10. Update the memory files and this spec's Evidence; move this spec to built, then done.

### Open questions for the board, at migration time

- **The mark.** The logo is a peanut (`platform/site/public/peanut.png`, the favicons, `apple-touch-icon.png`, `icon-512.png`, `platform/site/brand/peanut-source.png`, `specs/site-mark.md`). If it does not survive the name, new art follows the art policy, and `og-image.mjs` redraws the preview from it.
- **The game's address.** The game lives at `peanutgallery-seed-1.netlify.app`, a public URL in tier 3. Renaming the Netlify site changes the URL and breaks shared links; a subdomain such as `play.{{DOMAIN}}` avoids both. Either way `VITE_PLAY_URL` in `platform/site/netlify.toml` and the og:url in `seed-1/index.html` follow.

### Tier 1: public

The files are `TIERS[1]` in `scripts/rename.mjs`. By surface:

- The site: `index.html` (title, og tags, image alt), `src/lib/copy.ts` (the studio name, and the Terms' "operated by" and "not a charity" lines), `src/pages/Board.tsx` (the authenticator line), `styles.css` and `DESIGN.md` headers, `netlify.toml`, `scripts/live-check.mjs`, and the unit and e2e tests that pin them.
- The game (protected, a board change): `seed-1/index.html` (title, meta, og tags, the studio line and link), `seed-1/content/strings.json` (`tabTitle`), `seed-1/CLAUDE.md`, directive D3 in `platform/supabase/lib/directives.ts`, its test, the launch-cards seed and the refresh-cards fixture.
- The agents: `platform/agents/managed/agent.yaml` and `environment.yaml` (description and system text), the agents' git author `agents@peanutgallery.games` in `platform/dispatcher/src/worktree.ts` and `platform/ops/Dockerfile.dispatcher`, which shows on every public commit. The new address need not receive mail.
- The constitution and the root docs: `CLAUDE.md`, `README.md`, `docs/PLAN.md`, `docs/ROADMAP.md`'s standing facts.

### The board's steps

- [ ] Register `{{DOMAIN}}`. Keep peanutgallery.games registered and renewing, so old links, shared previews and search results reach the new site.
- [ ] Netlify, site `peanutgallerygames`: add `{{DOMAIN}}` and `www.{{DOMAIN}}`, set `{{DOMAIN}}` as primary, wait for the certificate; keep peanutgallery.games as a domain alias so the 301 in `netlify.toml` serves it.
- [ ] Supabase Auth, project `lyxndueoeisyqzewflpu`: Site URL `https://{{DOMAIN}}`, the redirect allow-list gains `https://{{DOMAIN}}/**` (keep the old entries until the old domain only redirects), the email templates' sender name. A second factor enrolled before the rename keeps its old label in the authenticator app; that is cosmetic.
- [ ] Stripe: public business name, statement descriptor, the Payment Link's product name and its after-payment URL, the branding on receipts. Claude reads or changes nothing in Stripe without asking first.
- [ ] Discord: the server's name and icon.
- [ ] The hello@clayhouse.studio signature. The address itself does not change (PLAN.md §10 decision 37).
- [ ] Handles planned in the backlog (the Twitch channel) are taken under the new name when they are made.

### Production data

Read-only, on production, after the deploy. Rows the site shows publicly that still say the old name:

```sql
select id, title, summary from public.cards
where concat_ws(' ', title, summary, intent, acceptance_test) ~* 'peanut ?gallery|peanutgallery\.games';
```

### Tier 2: internal, soon after

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
- [ ] `node scripts/rename.mjs --check` reports tier 1 clean.
- [ ] https://{{DOMAIN}} serves the site with the new name in the title, the header, the legal pages and the link preview.
- [ ] https://peanutgallery.games/<any path> answers 301 to the same path on `{{DOMAIN}}`.
- [ ] The game's tab title and studio line carry the new name and link to `{{DOMAIN}}`.
- [ ] The production data query returns no rows.
- [ ] Every board step above is ticked.

## Verification

- `node scripts/rename.mjs --check`
- `pnpm verify`
- `pnpm --filter @backseat/site e2e`
- `node platform/site/scripts/live-check.mjs` against production
- `curl -sI https://peanutgallery.games/how-it-works` shows a 301 to `https://{{DOMAIN}}/how-it-works`
- A link preview of `https://{{DOMAIN}}` (the Open Graph debugger of one platform) shows the new og.png and title
- The production data query, output quoted

## Evidence

- Prep (23 September 2026): `node --test scripts/rename.test.mjs` passes 5 of 5; `node scripts/rename.mjs` lists 29 tier-1 files, 33 tier-2, 69 tier-3 and 39 history, none unclassified. Trial on a working copy, then reverted: `--apply --tier 1 --name "Trial Name" --domain trialname.example` rewrote 29 files, `--tier 2` rewrote 33, `--check` printed "tier 1 is clean", `pnpm verify` exited 0, and `pnpm --filter @backseat/site e2e` printed "27 passed".

## Decisions

- 23 September 2026: the name and domain change; the new ones are not chosen yet. The work is prepared as this spec and a script so the migration runs in one session once they are. It is kept off the public backlog until the name is announced.
- 23 September 2026: internal identifiers stay (tier 3). Nobody outside sees them, and renaming several of them touches the host, the backups or the managed agent's id.
