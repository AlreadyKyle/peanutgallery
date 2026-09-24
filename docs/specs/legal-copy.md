# Legal copy: numbered terms versions, the refund policy and the wind-down rule

Status: done. Card: none. Owner: board.

Built on main after home-and-design (#64). The layout-balance pull request is dropped: home ships `platform/site/e2e/layout-balance.spec.ts`, which this change only extends. The cross-PR contracts it relies on are in Decisions under "Reconciled with the series".

The launch plan's Phase 1 "Legal pages", from the reviews of 23 September 2026: R04 (a refund policy, age terms, the currency and the Ontario internet-agreement disclosures), R06, L01 and PG-25 (what happens to unspent money), L07 (the no-token line) and L12 (a change to the terms applies only to money given after it is posted). This is a board pull request: it changes kernel files, listed under Scope.

## Problem

- The Terms and Refunds pages say how to ask for a refund, but not what a refund gives back, who may contribute, which currency applies, or what happens to money on a card that is not built or if the studio stops (R04, R06, L01, PG-25). Ontario's rules for an internet agreement over $50 expect the supplier's name and contact details, a description of what is supplied, the price and currency, the refund policy and any other conditions to be disclosed before the agreement (Consumer Protection Act, 2002; O. Reg. 17/05 s. 32).
- Nothing says which terms apply before a payer reaches Stripe. A Payment Link is offered on /contribute and on every fundable card ("Fund this card", `Funding.tsx`), and neither names the Terms, the Refunds page or who may contribute.
- The Terms say only that a new version "is posted on this page with its date". Nothing records which version was in force when a contribution was made, so the promise that a change applies only to later money (L12) cannot be enforced in SQL, and a reader cannot see which words applied to an earlier contribution.
- Nothing public says the studio has no token, coin or NFT (L07), on a site that draws a coin beside every money figure.
- Privacy says a display name given at checkout is stored. The Payment Link has had no name field since 23 September 2026 and production stores no name (read 23 September 2026: 0 of 1 contribution rows), so the sentence describes something that does not exist, and the webhook would still store a name if the field came back.

## Scope

In:
- **Terms versions (kernel).** Migration `20260924100000_terms_versions.sql`: the table `terms_versions (version integer primary key, posted_at timestamptz not null default now())` with row level security, no privilege for anon or authenticated and select only for service_role; the existing append-only guard `refuse_money_change` attached to it; `terms_version_at(timestamptz) returns integer`, executable by service_role only; the view `public_terms_versions (version, posted_at)`, select only for anon, authenticated and service_role; the row for version 1. Migration `20260924100100_terms_version_2.sql`: the row for version 2, applied only after the site carrying its words is live.
- **The words (kernel).** `platform/site/src/lib/terms-versions.ts` (new) holds every version's Terms and Refunds words. Version 1 is main's `legal.terms` and `legal.refunds`, moved unchanged; version 2 is the Appendix. `legal.ts` loses `terms`, `refunds` and `legalUpdated`, and gains `privacyUpdated`, the version strings and the two agreement lines.
- **The read (kernel).** `platform/site/src/lib/terms.ts` (new) reads `public_terms_versions` once per visit with a 5-second timeout, only on the Terms and Refunds pages, and works out which version to show. The snapshot (`source.ts`, `studio.tsx`) does not change.
- **Pages (kernel).** /terms and /refunds show the version in force and list earlier ones; /terms/:version and /refunds/:version show one posted version. `TextPage.tsx` gains a `{terms}` link token, a status line under the lede and a title for a version page; the not found page moves to `components/NotFound.tsx`; `App.tsx` routes the two version paths; `netlify.toml` serves `/terms/*` and `/refunds/*` with `force` like the other kernel paths. `format.ts` gains `formatPostedAt`.
- **Every path to checkout (kernel).** `Contribute.tsx`: the agreement line directly under the first choice (`legal.pickForMe`, "Fund the next card in line" on main). `Funding.tsx`: a short agreement line under every live Fund this card link.
- **Loading and spacing (from the review).** Every loading line on the site carries `aria-busy="true"` and one `styles.css` rule keeps the signal plate from growing while one is on the page; `scripts/layout-audit.mjs` gains a rhythm check; `vite.config.ts` writes `version.json` only into the build's own folder.
- **Privacy.** The display-name sentence is replaced; the page keeps its own date.
- **The webhook.** `parseSession` stops reading the `displayname` custom field; `sanitizeDisplayName`, `DISPLAY_NAME_MAX` and their tests go.
- **Kernel lists, rename, tests, live check.** `terms.ts`, `terms-versions.ts`, `terms.test.ts` and `NotFound.tsx` join `kernel-paths.txt` and `KERNEL_PATHS`; `scripts/rename.mjs` treats `terms-versions.ts` as history; `anon-negative-test.ts` and `live-check.mjs` cover the new relations and pages (the anon test's write probes through the view insert version 0 and update no row, so even a wrong grant posts nothing); /terms/1 and /refunds/1 join the routes of `design.spec.ts` and `layout-balance.spec.ts`.
- **Docs.** `docs/PLAN.md` (§5 a subsection "Terms, refunds and winding down", §10 the next free decision number at build, Appendix A), `docs/ROADMAP.md` (criterion 4 and a specs row), `docs/BOARD-SETUP.md` (steps 10, 12, 14 and D), `docs/COPY.md` (a posted version is never edited), `platform/site/DESIGN.md` (the version line and the card's agreement line), this spec.

Out, and what each waits on:
- Stamping each contribution with its version: money-logic adds `contributions.terms_version`, set in `apply_contribution` to `terms_version_at` of the Checkout Session's `created` time, never a value the client sends. Until then no rule differs between versions 1 and 2, so the promise in the Terms holds without the stamp.
- `cancel_card` sending a cancelled card's unspent money to later cards: money-logic (PG-01).
- The operations bucket: not built. It ships at 0%, so nothing here carries a percentage for it. The operations-share pull request, opened only when a percentage exists, adds the percentage and a new Terms version by the procedure below.
- The operator's mailing address and phone: the board (BOARD-SETUP step 10). A later board pull request adds them as a new version.
- /thanks naming the version a contribution carries and linking /terms/n: supporter-pages.
- Stripe Dashboard settings (the terms checkbox at checkout, Adaptive Pricing off) and a lawyer's review: the board (BOARD-SETUP step 12 and D). Nothing waits on them.
- site-snapshot moves this read behind `/api/cards`, keeping the fallback below.
- A script that computes each contribution's share at a shutdown: not built; the rule does not depend on it.

## Behaviour

**Versions.** The Terms and the Refunds page are one document with a whole-number version. `terms_versions` holds one row per posted version: its number and the time it was posted. A version is posted by inserting its row, through its own migration, applied only after the site that carries its words is live. Rows are append-only: an update, delete or truncate is refused. Only the table's owner (the Management API's role) can insert; service_role reads, and anon and authenticated read only `public_terms_versions`. `terms_version_at(t)` returns the newest version posted at or before t, or null.

**Words.** `terms-versions.ts` holds each version's number and its Terms and Refunds words. A posted version's words are never edited: it is a kernel file, and a rename leaves it alone. The `{email}` token renders the current contact address in every version.

**The pages.** /terms shows the version in force: the newest version that is both posted and in the site's bundle. Under the lede: "Version 2, in force since <time>." (the time from `posted_at`). After the sections, "Earlier versions" lists each earlier posted version, newest first, as "Version 1, in force from <time> until <time>", linking /terms/1. /refunds does the same, linking /refunds/n. /terms/n and /refunds/n show version n, titled "Terms, version n" or "Refunds, version n", with "Version n, in force from <time> until <time>. It applies to contributions whose checkout started in that time." and a link to the version in force; the version in force shows its since line instead. On /terms/n and /refunds/n the Terms and Refunds links in the words go to /terms/n and /refunds/n, the words that applied with version n; /terms and /refunds, and the agreement lines, link the pages in force. A version that is not posted, not in the bundle, or not a whole number from 1 to 9999 is the not found page. A successful read is kept for the rest of the visit, so moving between /terms, /refunds and a version page reads once; a failed one is tried again on the next page. While the read runs the page is drawn whole with the words it expects (the newest bundled version; on /terms/n, version n) and says "Loading the terms." under the lede where the version line goes, so only that line changes when the read answers. When the read fails, does not answer within 5 seconds, returns no row, or lists a version newer than the bundle's newest, the page shows the newest bundled words (on /terms/n, version n when bundled) with the notice that it cannot confirm which version is in force and the contact address.

**Times.** Every posted time shows as a date and clock time in Toronto time, the same for every reader: "22 Sep 2026 at 21:32 Toronto time". One version's end is the next one's start.

**Before checkout.** On /contribute, directly under the first choice and above the cards: `contributeAgreement`. Under every live Fund this card link, on any page: `fundAgreement`. Both link the Terms and the Refunds page and state the age condition.

**Privacy.** "If you give a display name at checkout, it is stored and kept private until names are reviewed." becomes "The studio's database does not store your name. Stripe keeps the name on your card with its record of the payment." Privacy shows `privacyUpdated` and is not part of a terms version.

**The webhook.** A Checkout Session with a `displayname` custom field is credited exactly as before, with `display_name` null.

## Posting a new version (the procedure for any later pull request)

1. Append the version's entry to `TERMS_VERSIONS`; never edit a posted entry.
2. Add a migration that inserts only its row: `insert into public.terms_versions (version) values (n) on conflict (version) do nothing`.
3. Merge, and wait for the site deploy of the merge sha.
4. Take a dump, apply that migration through the Management API query endpoint, read back its `posted_at`, and run the live check, which must show "Version n, in force since".

## Acceptance criteria

- [x] `terms_versions` has row level security; anon and authenticated hold no privilege on it or on `terms_version_at`; service_role can only select the table and execute `terms_version_at`; `public_terms_versions` lets anon and authenticated read only `version` and `posted_at`, and an insert or update through it is refused with 42501 (migration test and anon negative test).
- [x] The first migration leaves version 1 posted at 2026-09-23 01:32:51 UTC, the second inserts version 2 at the time it is applied, each runs twice without changing a row, an update, delete or truncate of `terms_versions` is refused naming the table, and `terms_version_at(t)` returns the newest version posted at or before t and null for null or a time before version 1.
- [x] Version 1's words equal `legal.terms` and `legal.refunds` at 7540073 (one-off comparison quoted in Evidence), version 2's are the Appendix's, and `copy.test.ts` finds in the newest version the operator's name, the age condition, "charged in US dollars", the full refund within 14 days and the Stripe fallback, the per-contribution wind-down ("its share of what is left on each card bar it reached", "120 days", "The studio's share is not refunded", "could not be returned"), the no-cryptocurrency line and "applies only to contributions made after it is posted"; the copy rules run on the newest version and every string outside `TERMS_VERSIONS`, not on older versions.
- [x] Posted words are protected: `terms.ts`, `terms-versions.ts`, `terms.test.ts` and `NotFound.tsx` are listed in `kernel-paths.txt` and `KERNEL_PATHS`, which stay equal, the kernel guard fails an agent change to each, and `scripts/rename.mjs` classes `terms-versions.ts` as history and never rewrites it.
- [x] /terms and /refunds show the newest posted and bundled version with its since line and each earlier posted version with its range and link; /terms/n and /refunds/n show posted version n with its range and a link to the version in force; a version not posted, not bundled or malformed is the not found page; posted times read the same with the process time zone set to UTC and to Pacific/Auckland; and `design.spec.ts` (no horizontal scroll, axe WCAG 2.2 AA) and `layout-balance.spec.ts` pass with /terms/1 and /refunds/1 in their routes.
- [x] When the versions read fails, times out, returns no row or lists a version newer than the bundle's newest, the Terms and Refunds pages show the bundled words with the cannot-confirm notice and the contact address.
- [x] Every Payment Link rendered on /, /roadmap and /contribute has links to /terms and /refunds and the age condition in the same card, or on /contribute the agreement line directly under the first choice.
- [x] No page says "display name", Privacy carries the new sentence and `privacyUpdated`, and the webhook credits a session carrying a `displayname` field with `display_name` null.
- [x] Production, in order with the board's allow: a dump that `pg_restore --list` reads, the first migration, the privilege read-back (both false), the anon negative test and ledger identity PASS, stripe-webhook deployed from main; after the site deploy of the merge sha, a second dump, the second migration, and the live check PASS showing "Version 2, in force since", /terms/1, /refunds/1, /terms/3 not found and the agreement lines on / and /contribute.

## Verification

- `pnpm verify` at the repository root, with `platform/site/dist-e2e` and `platform/board/dist-e2e` deleted first.
- `E2E_PORT=4391 pnpm --filter @backseat/site e2e`
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/migration_test.ts platform/supabase/functions/_shared/session_test.ts platform/supabase/functions/_shared/split_test.ts`
- `pnpm --filter @backseat/site exec vitest run src/lib/terms.test.ts src/lib/format.test.ts src/lib/copy.test.ts src/pages/Legal.test.tsx src/pages/Contribute.test.tsx src/components/Card.test.tsx src/App.test.tsx src/netlify-headers.test.ts src/version-file.test.ts`
- `TZ=UTC pnpm --filter @backseat/site exec vitest run src/lib/format.test.ts src/pages/Legal.test.tsx` and the same with `TZ=Pacific/Auckland`.
- `node --test scripts/rename.test.mjs`
- Once, quoted in Evidence: version 1's entry equals `legal.terms` and `legal.refunds` from `git show 7540073:platform/site/src/lib/legal.ts` (a one-off tsx comparison).
- Production: `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts` and `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts` PASS; `select version, posted_at from public.terms_versions order by version` and `select has_table_privilege('service_role', 'public.terms_versions', 'insert'), has_function_privilege('anon', 'public.terms_version_at(timestamptz)', 'execute')` (both false) read back; `set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs` PASS.

## Production steps (need the board's allow)

The studio stays paused throughout.

1. **Before the merge,** if the merge falls on a later day than 23 September 2026, change `privacyUpdated` in `legal.ts` to that day in a commit on the branch. Then, gate green at the head sha: read back `select paused, launched_at from public.studio_state` (paused true); `set -a; . ./.env; set +a; pg_dump "$BACKUP_DB_URL" -Fc -f ~/peanutgallery-dumps/pre-legal-copy-$(date -u +%Y%m%dT%H%M%SZ).dump`; `pg_restore --list` on it succeeds.
2. **Apply `20260924100000_terms_versions.sql`** at the head sha through the Management API query endpoint. Read back the row and the two privileges.
3. **Run the anon negative test and the ledger identity;** both PASS. Quote the new lines.
4. **Merge** with the head sha; delete the branch.
5. **Deploy stripe-webhook** from `platform/`: `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api`; read back its version and update time.
6. **Wait for the site deploy** of the merge sha, then run the live check: /terms shows "Version 1, in force since 22 Sep 2026 at 21:32 Toronto time." and /terms/2 is the not found page.
7. **Post version 2:** take a second dump as in step 1, apply `20260924100100_terms_version_2.sql` through the query endpoint, read back its `posted_at`.
8. **Run the live check again:** /terms shows Version 2 since its posted time and lists version 1 with its range; /terms/1 and /refunds/1 render; /terms/3 is the not found page; every Payment Link on / and /contribute carries the agreement line. Quote the lines in Evidence.

## Board items (listed, never blocking)

- BOARD-SETUP step 10: send a mailing address and phone for the Ontario disclosure; a later board pull request adds them as a new version.
- BOARD-SETUP step 12 (Stripe Dashboard): turn on "Require customers to accept your terms of service" on the Payment Link, and confirm Adaptive Pricing is off (a local-currency checkout would be charged and not credited, because the webhook refuses non-USD sessions).
- BOARD-SETUP step 14: read the posted Terms, Refunds and Privacy pages.
- BOARD-SETUP D: a paid lawyer's review of the pages (whether a contribution is a consumer internet agreement, whether the Consumer Protection Act, 2023 is in force, delivering a copy within 15 days, and the age, refund-fallback and wind-down wording).

## Evidence

Built on `launch/legal-copy` from main at e629119, merged as #68 (e14019b). The production lines of Verification and the production steps ran at the ship stage, quoted under "Production" at the end of this section; the studio stayed paused throughout.

`pnpm verify` at the repository root, with both `dist-e2e` folders deleted first, exits 0 (rerun after the review's fixes):

```
platform/board test:       Tests  67 passed (67)
platform/supabase test:       Tests  273 passed (273)
platform/site test:       Tests  383 passed (383)
seed-1 test:       Tests  77 passed (77)
platform/dispatcher test:       Tests  619 passed (619)
platform/gate test: PASS: gate tests passed=508
ℹ tests 117   ℹ pass 117   ℹ fail 0        (test:agents)
ok | 82 passed (84 steps) | 0 failed (5s)  (test:functions)
GATE PASS folder=seed-1 lane=code
GATE PASS folder=platform lane=code
PASS: secret-scan files=547
ℹ tests 15    ℹ pass 15    ℹ fail 0        (test:docs)
ℹ tests 6     ℹ pass 6     ℹ fail 0        (test:rename)
verify exit 0
```

The site e2e, on port 4463 (4391 in the line above sits outside the 4400 to 4499 range parallel agents share): `E2E_PORT=4463 pnpm --filter @backseat/site e2e`

```
  5 skipped
  112 passed (2.9m)
exit 0
```

It includes /terms with version 2 in force and version 1 listed, /terms/1 and /refunds/1 with their range and link, /terms/3 not found, /terms/1 and /refunds/1 in `design.spec.ts` (no horizontal scroll at every width, axe WCAG 2.2 AA at 375 and 1440) and `layout-balance.spec.ts`, and every Payment Link on /, /roadmap and /contribute carrying the agreement.

`deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/migration_test.ts platform/supabase/functions/_shared/session_test.ts platform/supabase/functions/_shared/split_test.ts`

```
  anon holds select on three public tables, the eight views and the public columns of cards, and nothing else ... ok (241ms)
  function privileges: anon none, authenticated the nineteen board RPCs, service_role the rest, one file_card ... ok (9ms)
  terms_versions posts version 1 at #47's merge and version 2 when applied, append-only, readable only through public_terms_versions ... ok (179ms)
parseSession maps the split dropdown and stores no name, even when a displayname field is sent ... ok (0ms)
ok | 27 passed (71 steps) | 0 failed (16s)
```

The handler test "handler credits a session that carries a displayname field exactly as before, with no name" runs in `test:functions` above.

`pnpm --filter @backseat/site exec vitest run src/lib/terms.test.ts src/lib/format.test.ts src/lib/copy.test.ts src/pages/Legal.test.tsx src/pages/Contribute.test.tsx src/components/Card.test.tsx src/App.test.tsx src/netlify-headers.test.ts src/version-file.test.ts`

```
 Test Files  9 passed (9)
      Tests  134 passed (134)
```

`TZ=UTC` and `TZ=Pacific/Auckland pnpm --filter @backseat/site exec vitest run src/lib/format.test.ts src/pages/Legal.test.tsx`

```
TZ=UTC
 Test Files  2 passed (2)
      Tests  26 passed (26)
TZ=Pacific/Auckland
 Test Files  2 passed (2)
      Tests  26 passed (26)
```

`node --test scripts/rename.test.mjs`

```
✔ history is never a tier
✔ never rewrites the posted Terms versions, whichever tier is applied
ℹ pass 6
ℹ fail 0
```

Version 1 against 7540073, once: `git show 7540073:platform/site/src/lib/legal.ts` saved beside a tsx script that compares `TERMS_VERSIONS[0].terms` and `.refunds` with `legal.terms` and `legal.refunds` by deep equality:

```
version 1 terms equal to 7540073 legal.terms: true
version 1 refunds equal to 7540073 legal.refunds: true
exit 0
```

The live check against a local `vite preview` of a build with `netlify.toml`'s production values, before any production step (`node platform/site/scripts/live-check.mjs http://127.0.0.1:4438`): every route passes, /terms/1 and /refunds/1 included, and

```
PASS home: 6 Payment Links, each with the agreement
PASS /contribute: the agreement line under the first choice covers every Payment Link
PASS 6 card choices carry card ids
FAIL the Terms version in force: the site has no live data
FAIL 375px no console errors: Failed to load resource: the server responded with a status of 404 () | ...
```

The two failures are `public_terms_versions`, which production does not have until production step 2 (`PGRST205 Could not find the table 'public.public_terms_versions' in the schema cache`, 404); step 2 runs before the merge, so the deployed site never makes that request against a database without the view.

Screenshots of /, /contribute, /terms, /terms/1, /refunds, /refunds/1 and /privacy at 375 and 1440, with production data and the versions answered as after both migrations, were looked at; one fix came of it (the cannot-confirm notice's link became its own column at 375px, now one span).

The review's fixes, each with a test that fails before it (run against the old code, then the new):

```
Legal.test.tsx, old pages:  × say they are loading under the lede ... newest bundled words already drawn
                            × link {refunds} and {terms} to the same version's pages
                            × say they are loading under the lede ... that version's words already drawn
text-pages.spec.ts, old:    Expected: "/refunds/1"  Received: "/refunds"
                            /terms: the title moved  Received: 410.53125 (375px), 468.921875 (768px), 499.3125 (1440px)
layout-balance.spec.ts, old styles and loading lines:
  "/contribute rhythm: h2.choices-heading \"Or pick a card\" sits 16px under p.muted.small ..., which sits 40px under the block before it" (375, 768, 1440)
  "/team: the title moved 451px", "/roadmap: the title moved 451px", "/contribute: the title moved 92px", "/ledger: the title moved 61px" (1440)
version-file.test.ts, old join:  × writes into an absolute outDir as given, not under the root
```

All pass after the fixes, in the verify and e2e runs above. Screenshots of /terms, /terms/1, /refunds/1, /team, /roadmap, /contribute and /ledger at 375 and 1440, loading (every data request held) and loaded, were looked at: the Terms pages differ only in the line under the lede, every title stays under the top bar while loading, and the agreement line on /contribute sits under the first choice with the section gap before "Or pick a card".

### Production, 23 September 2026

Before the merge, `main` (04368fb) merged into the branch, `pnpm verify` exit 0 (site 382 tests, supabase 273, dispatcher 619, gate 508), `E2E_PORT=4437 pnpm --filter @backseat/site e2e` 112 passed, 5 skipped, and the gate green at the head sha 07acbd0 (build, detect, gate, platform, seed-code all pass). The merge fell on 23 September 2026, so `privacyUpdated` stayed.

1. `select paused, launched_at from public.studio_state` read `[{"paused":true,"launched_at":null}]`. `pg_dump` wrote `~/peanutgallery-dumps/pre-legal-copy-20260923T213117Z.dump` (593363 bytes, mode 600); `pg_restore --list` exit 0, 956 lines.
2. `20260924100000_terms_versions.sql` at 07acbd0, wrapped in `begin; … commit;`, one request to the Management API query endpoint: `HTTP 201 []`. Read back:

```
select version, posted_at from public.terms_versions order by version
[{"version":1,"posted_at":"2026-09-23 01:32:51+00"}]
select has_table_privilege('service_role', 'public.terms_versions', 'insert'), has_function_privilege('anon', 'public.terms_version_at(timestamptz)', 'execute'), …
[{"sr_insert":false,"anon_exec":false,"anon_tbl_select":false,"anon_view_select":true,"anon_view_insert":false,"rls":true,"triggers":"{terms_versions_append_only,terms_versions_no_truncate}","at_now":1,"at_before":null}]
```

3. `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts` and `… scripts/ledger-identity.ts`, both exit 0:

```
ok   terms_versions                 expected refused  actual refused  42501 permission denied for table terms_versions
ok   public_terms_versions          expected readable actual readable 1 row(s) returned
ok   public_terms_versions(insert)  expected refused  actual refused  42501 permission denied for view public_terms_versions
ok   public_terms_versions(update)  expected refused  actual refused  42501 permission denied for view public_terms_versions
ok   rpc terms_version_at           expected refused  actual refused  42501 permission denied for function terms_version_at
PASS: anon access matches the RLS contract
PASS: ledger identity holds over 1 contribution rows and 0 studio ledger rows
```

4. `gh pr merge 68 --squash --match-head-commit 07acbd0… --delete-branch`: merged 2026-09-23T21:32:17Z as e14019b.
5. `npx supabase functions deploy stripe-webhook --project-ref lyxndueoeisyqzewflpu --use-api` from `platform/` on e14019b: "Deployed Functions."; read back `{"slug":"stripe-webhook","version":13,"status":"ACTIVE","updated_at":"2026-09-23T21:32:31.148Z","verify_jwt":false}`.
6. The public site published e14019b (`/version.json`: `{"sha":"e14019b2b035c7136632114498e815b4f133af1b","builtAt":"2026-09-23T21:32:37.406Z"}`); the board site's build was cancelled for no content change, as expected. `node platform/site/scripts/live-check.mjs`:

```
PASS live-check https://peanutgallery.games passed=221 failed=0 skipped=0
PASS /terms shows "Version 1, in force since 22 Sep 2026 at 21:32 Toronto time."
PASS /terms/2 is the not found page: ["Not found"]
```

7. A second dump, `~/peanutgallery-dumps/pre-legal-copy-v2-20260923T213428Z.dump` (597281 bytes, mode 600; `pg_restore --list` exit 0, 967 lines, the `terms_versions` table, view, triggers and row security listed), studio still paused. `20260924100100_terms_version_2.sql` at e14019b in one request: `HTTP 201 []`. Read back `[{"version":1,"posted_at":"2026-09-23 01:32:51+00"},{"version":2,"posted_at":"2026-09-23 21:34:48.452621+00"}]`.
8. The live check again, then the anon negative test and the ledger identity again (both PASS, the same lines as step 3):

```
PASS live-check https://peanutgallery.games passed=222 failed=0 skipped=0
PASS home: 6 Payment Links, each with the agreement
PASS /contribute: the agreement line under the first choice covers every Payment Link
PASS /terms shows "Version 2, in force since 23 Sep 2026 at 17:34 Toronto time."
PASS /terms lists the earlier versions ["/terms/1"]
PASS /refunds/1 shows ["Refunds, version 1"]
PASS /terms/3 is the not found page: ["Not found"]
PASS 375px /terms/1 one h1: ["Terms, version 1"]
PASS 375px /refunds/1 one h1: ["Refunds, version 1"]
```

Screenshots of the live /, /contribute, /terms, /terms/1, /refunds, /refunds/1 and /privacy at 375 and 1440 were looked at: version 2's words with its since line and version 1 listed with its range, the version pages with their range and link to the version in force, the agreement line under every Fund this card and under the first choice on /contribute, and Privacy's new sentence with "Last updated 23 September 2026."

After the docs-only follow-up #70 merged as 0fe4b59 (both Netlify builds cancelled for no content change), the live check on main at 0fe4b59 read the same: `PASS live-check https://peanutgallery.games passed=222 failed=0 skipped=0`, with `PASS /terms shows "Version 2, in force since 23 Sep 2026 at 17:34 Toronto time."`. The anon negative test's `public_terms_versions ... 1 row(s) returned` with two rows posted is expected: `readableProbe` reads with `.limit(1)`. Every Verification line above has run with its output quoted, so the status stays done.

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 23 criteria became 9. Cut: the sha256 of every version held in the bundle, the migration and production with a three-way agreement test and a migration that raises on a mismatch (a posted version is protected by the kernel guard and the rename's history list instead); drafts, `post_terms_version` with its six refusals and the `refuse_terms_change` trigger with its session flag (a version is posted by inserting its row in its own migration after the site is live, and the existing append-only guard `refuse_money_change` keeps rows unchanged); `operations_pct` on each version and on each entry (the operations bucket ships at 0%, so it is removed; money-logic's zero constraint on it and its waterfall read of it go with it, and operations-share adds the percentage when one exists); `created_at`; the per-version "changed" line; the separate "database is ahead of the bundle" page state (folded into the one cannot-confirm notice); the criteria for where the status line renders, for routes.tsx not claiming /terms/:x (already true through `KERNEL_SEGMENTS`), for netlify `force` parity (the existing headers test), for sample cards carrying no line and for kernel imports (existing tests); the dependency on the layout-balance gate module (dropped; home's `layout-balance.spec.ts` runs instead) and the seven-width list (the widths `design.spec.ts` already runs); the separate docs criterion and the PLAN §4 and §8 edits (money-logic and §5 own them); the version-3 contingency (legal.ts's `terms` and `refunds` read identical at 7540073, main and launch/home on 23 September 2026). Kept whole: every Problem outcome, the RLS and privileges, append-only rows, the anon negative test, the ledger identity, the dumps before each production write, and the stamp function money-logic uses.
- 2026-09-23, reconciled with the series (these override any line that disagrees):
  - `terms_versions` is `(version integer primary key, posted_at timestamptz not null default now())`; every row is posted. `public.terms_version_at(timestamptz)` returns an integer, executable by service_role only. money-logic stamps `contributions.terms_version integer references public.terms_versions(version)` with this function and defines no second one.
  - The table is append-only through the existing `refuse_money_change`, attached here as `terms_versions_append_only` and `terms_versions_no_truncate`; a later migration that re-runs the append-only loop must not drop them.
  - There is no `operations_pct`, `content_sha256`, `post_terms_version` or `refuse_terms_change`. Waterfall step 2 has no operations share until operations-share adds one.
  - `public_terms_versions` exposes `version` and `posted_at`; site-snapshot's `terms` rows carry those two fields.
  - The migrations are `20260924100000_terms_versions.sql` and `20260924100100_terms_version_2.sql`, before `20260924200000` (money-logic).
  - The PLAN §10 decision takes the next free number at build.
- 2026-09-23, at build (defaults taken without the board, per its order to finish the series unasked):
  - The anon negative test's write probes through `public_terms_versions` insert version 0 and update a row that does not exist, not version 9999: with a correct grant both answer 42501, and with a wrong one the table's check refuses version 0 (a 23514, which the test reports as a failure), so the probe can never post a version into an append-only table.
  - `terms_version_at` runs with the caller's rights (not security definer): only the service role may execute it, and it can read the table; money-logic's `apply_contribution` is security definer and calls it as the owner.
  - The version line sits inside the page header, after the lede (`PageHeader`'s children), as the notices on /contribute do. `TextPage` also takes a `title`, for "Terms, version n".
  - A successful versions read is kept for the visit (one read per page load); a failed read is not kept, so the next page tries again. The pages also stop waiting after 5 seconds whatever the loader does, besides the request's own abort signal.
  - "Earlier versions" lists newest first, as a bulleted list (`ul.rules`) of 44px links (`a.target`), existing classes only.
  - The agreement line under Fund this card is `p.muted.small`; one rule in `styles.css` (`.card-bottom > .button + p`) gives it the small top gap, and no new class or token is added.
  - The cannot-confirm notice uses the existing `p.notice`, with its text in one `span`, because `.notice` is a flex row beside the pause bars and a bare link would become its own column.
  - `/terms/n` with a read that answers no row, or fails, shows version n unconfirmed; with a read that answers but does not list n, it is the not found page; with a read that lists a version newer than the bundle, version n unconfirmed.
  - `privacyUpdated` reads "Last updated 23 September 2026.", the day the Privacy sentence changed; production step 1 moves it to the merge day if that is later.
  - The live check reads `public_terms_versions` over REST with the publishable key from `netlify.toml`, as the site does, to know which version /terms must show.
  - `legal.ts` no longer carries the studio name, but stays in the rename's tier 1 list (harmless, and the next string may bring it back).
- 2026-09-23, from the review of the built branch (defaults taken without the board):
  - A version page's `{terms}` and `{refunds}` links go to that version's pages (`TextPage`'s `version`, passed to `LinkedText`), in every state of the page, so a reader checking version 1 is not sent to version 2's refund rules. The pages in force and the agreement lines keep /terms and /refunds.
  - While the versions read runs, /terms and /refunds draw the newest bundled words and /terms/n version n's, with "Loading the terms." under the lede in place of the version line. A short loading page let the signal plate fill the window with the title at its foot, then jump 411 to 499px when the words arrived. In the minutes between a deploy and its version's post, the loading state shows the newer words for as long as the read takes, marked as loading; the answered page shows the version in force.
  - The same jump happened on every page whose loading state is short (/team and /roadmap by 300 to 450px, /contribute and /ledger by up to 92px, on main before this change). One rule in `styles.css` fixes the class: while anything in `main` carries `aria-busy="true"`, the last band takes the spare height instead of the signal plate. Every loading line now carries `aria-busy="true"` (Meter, Guarded, LedgerSummary, the ledger's deploys, /team, /roadmap and the guide's team). `layout-balance.spec.ts` holds every data request on every route and fails when a title moves by more than its header's own content changes.
  - The agreement line on /contribute sits `--space-1` under the first choice and carries the choice's `--space-4` before "Or pick a card" (it had 40px above and 16px below, and read as the caption of the card list). `scripts/layout-audit.mjs` gains a rhythm check for the class: a heading sits at least as far below the block before it as that block sits below its own predecessor. It finds only this line on every route before the fix, and nothing after.
  - A screenshot build with an absolute `--outDir` had written `version.json` under `platform/site/private/tmp/…`, because `vite.config.ts` joined the root with the output folder, and it was committed. It is removed, the plugin resolves the folder (`src/version-file.test.ts`), and `platform/site/.gitignore` ignores `version.json`.
- 2026-09-23 (the board's default): the Ontario disclosure is published with the operator's name, Kyle Smith, an individual in Ontario, and hello@clayhouse.studio only. No mailing address or phone was supplied, and none is invented. BOARD-SETUP step 10 asks for them and says what their absence risks: if a contribution over $50 is a consumer internet agreement, a supporter not given every required disclosure may cancel within 7 days, or within 30 days when no copy of the agreement was delivered within 15 days. The lawyer question in BOARD-SETUP D settles whether the Act applies.
- 2026-09-23: Versions are whole numbers, never dates: the time a version takes effect is known only when it is posted, and the page shows that time from `posted_at`.
- 2026-09-23: A version is posted after the site carrying it is live, so no page shows words that are not in force and no contribution is stamped with words the site did not show. The minutes between the deploy and the post show the older version, which is the one in force.
- 2026-09-23: Version 1 is the text live since #47 (merged 2026-09-23 01:32:51 UTC, 21:32 on 22 September in Toronto). The only contribution in production (the board's own test payment, 2026-09-15 01:29 UTC) predates every Terms page, so no earlier text is recorded as a version.
- 2026-09-23: The Terms and the Refunds page are one version, because the refund policy is part of the agreement. Privacy is a notice with its own date. The contact address is rendered from `legal.contactEmail` in every version, so an old version never shows a dead address.
- 2026-09-23: The refund policy keeps the approved plan's rule: the full amount paid, on request within 14 days, even when the money was spent (PLAN §5). R04's longer window is not adopted; a later version can offer it. Stripe keeps its fee on a refund, and the studio share pays it through the adjustment row the Controller asks for. Where Stripe cannot refund a payment, the studio returns the money another way agreed by email, and at a shutdown any money it cannot return is listed on the final ledger (PG-25).
- 2026-09-23: Age: an adult where the contributor lives, or a parent's or guardian's permission. A guardian's request to refund a contribution made without permission is honoured in full with no time limit, because a minor's contract is voidable.
- 2026-09-23: Currency: contributions are charged in US dollars, which the webhook already requires. The Terms say Stripe or the card issuer converts other currencies. No tax is added: the studio is not registered for HST.
- 2026-09-23: The wind-down rule is the one the board approved with the launch plan, worded per contribution: each contribution gets back its own credit still on hold, its share of what is left on each card bar it reached and its share of the agents' unspent money on no card's bar, each in proportion to what it put there; the reserve and the emergency fund follow after 120 days the same way; the studio's share is not refunded. Pooling every bar was rejected, because a supporter whose card shipped would take a share of other cards' bars.
- 2026-09-23: The no-token line names cryptocurrency, crypto coin, token and NFT, and says the coin drawn on the site is a symbol for money in US dollars (#63).
- 2026-09-23: The webhook stops reading the display-name field, so the Privacy sentence holds by code even if a name field comes back. The name pipeline in the backlog brings names back through its own review.
- 2026-09-23: The copy rules run over the newest version and every other string; an older version was checked when it was written, and a later rule never forces an edit to posted words.
- 2026-09-23: The agreement is stated before every path to checkout, drawn in `Funding.tsx` and `Contribute.tsx` (kernel) so no card can remove it. Stripe's terms checkbox adds express acceptance once the board turns it on; nothing waits on it.
- 2026-09-23: The Terms and Refunds pages read the versions themselves instead of through the snapshot, so they stay readable when the pool or the cards fail, and no other page pays for the read.
- 2026-09-23: Considered and not adopted: capping each payment at $50 to stay under the Ontario threshold (a product and money change for the board).

## Appendix: the words

Each quoted line below is one paragraph string, verbatim, with straight apostrophes. `{email}`, `{refunds}` and `{terms}` are link tokens.

### Version 1

The entry holds `version: 1` and main's `legal.terms` and `legal.refunds` objects unchanged.

### Version 2

**Terms.** Title and lede as version 1. Sections, in order:

Who runs the studio
> Peanut Gallery is operated by Kyle Smith, an individual in Ontario, Canada. Write to {email} about anything in these terms.

What a contribution pays for: version 1's two paragraphs, unchanged.

Who can contribute
> To contribute you must be an adult where you live, or have the permission of a parent or guardian. Anyone can play the games and read this site.
> If someone contributed without the permission they needed, a parent or guardian can email {email} and the contribution is refunded in full, as the {refunds} describes.

Price and currency
> You choose the amount at checkout. Amounts on this site and at checkout are in US dollars (USD), and contributions are charged in US dollars.
> Stripe's fee comes out of the amount you pay, and the studio adds no tax or other charge. If your card uses another currency, Stripe or your card issuer converts the amount and may charge a fee for it.

Funding a card
> You fund a card to have it built. When a card's bar is full, the card moves to the queue and the agents build it in turn.
> No card has a delivery date, because the agents work only while the studio is not paused.
> Every change must pass the gate, the studio's automated checks, before it goes live. The gate may reject a change even when its card is fully funded.

If a card is not built
> If a card is rejected, or the board cancels it, the money on it that the agents did not spend pays for later cards. You can still ask for a refund within 14 days of your contribution, as the {refunds} describes.

If the studio stops
> If the studio stops, contributions close first, and any card being built is finished or cancelled.
> Then each contribution gets back its own agent money that has not been spent: its credit still on hold, its share of what is left on each card bar it reached, and its share of the agents' unspent money that is on no card's bar. Each share is in proportion to what the contribution put there.
> The 10% reserve and the emergency fund are kept for 120 days after the last contribution, the usual time in which a card payment can be disputed. What is left of them is then refunded in proportion to what each contribution put into them. The studio's share is not refunded.
> These refunds go back through Stripe where Stripe allows it, and another way agreed by email where it does not. A final ledger is then published on this site, listing any money that could not be returned.

Rules contributions cannot change, Large contributions, Refunds, The games: version 1's paragraphs, unchanged.

No cryptocurrency
> Peanut Gallery has no cryptocurrency, crypto coin, token or NFT. The coin drawn on this site is a symbol for money in US dollars. Anything that claims to be a Peanut Gallery token is not from the studio.

Law: version 1's paragraph, unchanged.

Changes to these terms
> When these terms change, the new version is posted on this page with its number and the time it took effect. Earlier versions stay listed below.
> A change applies only to contributions made after it is posted. A contribution keeps the version in force when its checkout started.

Version 1's closing Contact section is folded into the first section.

**Refunds.** Title and lede as version 1. Sections, in order:

Asking for a refund
> Email {email} within 14 days of your contribution, with your Stripe receipt. You get back the full amount you paid.

How refunds are paid
> Refunds go back through Stripe to the card or account you paid with. Stripe keeps its fee on a refunded payment, and the studio's share pays that fee.
> If Stripe cannot refund a payment, for example because the card has been closed, the studio returns the money another way agreed with you by email.

After 14 days
> After 14 days a contribution is refunded only in two cases, both in the {terms}: a parent or guardian asks for a refund of a contribution made without their permission, or the studio stops. Nothing here limits a right to cancel that the law gives you.

A card that is not built
> If a card is rejected or cancelled, the money on it that the agents did not spend pays for later cards. You can still ask for a refund within 14 days of your contribution.

What a refund changes, Disputes: version 1's paragraphs, unchanged.

### Strings in legal.ts

> termsVersionLine: Version {n}, in force since {time}.
> termsPastLine: Version {n}, in force from {from} until {until}. It applies to contributions whose checkout started in that time.
> termsCurrentLink: Read the version in force now
> termsEarlier: Earlier versions
> termsEarlierItem: Version {n}, in force from {from} until {until}
> termsVersionTitle: {title}, version {n}
> termsLoading: Loading the terms.
> termsUnconfirmed: This page cannot confirm which version is in force right now. Email {email} to ask which version applies to your contribution.
> contributeAgreement: Contributing means you accept the {terms} in force when your checkout starts, including the {refunds}. To contribute you must be an adult where you live, or have the permission of a parent or guardian.
> fundAgreement: By funding you accept the {terms} and the {refunds}, and confirm you are an adult or have a guardian's permission.
> privacyUpdated: Last updated <the date this pull request merges>.
> Privacy, What the studio stores, third paragraph: The studio's database does not store your name. Stripe keeps the name on your card with its record of the payment.

`formatPostedAt` (format.ts) writes a time as "<day> <three-letter month> <year> at <HH:MM> Toronto time".
