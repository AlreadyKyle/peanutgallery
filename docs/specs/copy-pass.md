# The copy pass: every public string after the supporter loop

Status: built. Card: none. Owner: board.

Series position: after agent-upkeep, before launch-card-floor (the order and each spec's status are in `docs/ROADMAP.md`, "The launch series"). The launch plan's Phase 2 copy pass on every public string, run last so it covers every string the supporter loop added. It covers L15, PG-16, PG-18, PG-20, PG-21 and L17's /how-it-works half. It is a board pull request: it changes kernel files (`lib/legal.ts`, `lib/payment.ts`, `index.html`, `docs/`, `platform/supabase`).

## Problem

- The pitch promises "free games" when one game, Dust, exists (PG-16). The phrase is in `copy.ts` (`pitchTitle`, the footer), `index.html`'s description, `og:description` and `og:image:alt`, `og.png` (rendered from `pitchTitle`) and PLAN.md §2's pitch line.
- PLAN.md §2 says Star Citizen raised $1B "without a release", which is contestable: a playable alpha has run since 2015 (L15). Its Multiverse line states a game count that Multiverse's own site does not match.
- The site names "the board" without saying who it is, what it can do or what it must do (PG-18), and does not say what code does and what the agents do (L17).
- `/how-it-works`'s money example starts from "$10.00 after Stripe's fee" (PG-20): it skips the fee, does not match the $5 checkout default, and predates the waterfall.
- `/roadmap` lists board-upkeep items beside player-facing work, each as if it could be funded (PG-21), and nothing records which entries are board work.
- "Site cards open once the board has its own site." is out of date: the board has its own site, and the lane opens when the board sets it.
- The supporter-loop pages and bands on main at build (/thanks, /card/:id, /reports, /team, /roadmap's opens-soon and held labels, /ledger's Money in and Stopped bands) have not had the pass.

## Scope

In:
- Every public string: `platform/site/src/lib/copy.ts` and `lib/legal.ts`, the page components' literals, `index.html`'s meta and Open Graph tags, `og.png`, `seed-1/content/strings.json`, and any Discord post template on main at build. Each is checked for length, plain language, truth against production and `docs/COPY.md`'s voice rules.
- `docs/PLAN.md` §2 (the pitch line, Star Citizen, Multiverse) and its §9 sources, one new §10 decision at the next free number, and any launch draft or `docs/specs/announcement.md` line that quotes Star Citizen or Multiverse.
- The board-work marker: a `board: yes|no` bullet on every `docs/BACKLOG.md` entry, required by the parser; `file-backlog.ts` writes it to a new `cards.board_work` column (migration `20260925400000_board_work.sql`: the series' `20260925000000` was taken by `terms_version_3`), granted to anon and returned by `site_cards()`.
- `/roadmap`'s grouping (`pages/Roadmap.tsx`, words in `copy.ts`), inside its existing Next and Later bands.
- Tests: `copy.test.ts`, the pages' tests, the BACKLOG parser tests, `docs.test.mjs`, the migration test, and the e2e specs that pin the old pitch (`landing.spec.ts`, `previews.spec.ts`).

Out:
- The legal text's substance (legal-copy). This pass may shorten wording only where the meaning is unchanged, and never on a posted Terms version without a new version. The Ontario disclosure stays as legal-copy set it: the operator's name and hello@clayhouse.studio, no invented address.
- The operations bucket. It is removed from the series until a percentage exists, so the example has no operations step. The later operations-share pull request adds its own sentence.
- Any public list of board actions with reasons: agent-system-core no longer builds `public_board_actions` (BACKLOG's "Board Decisions page"), so no string claims one.
- New features a string would describe. The pass describes only what exists.
- Done earlier, not redone: "In the pool" for the pool balance (`legal.poolBalance`, #56); the USD note once on /contribute and /ledger (`legal.usdNote`, #64); "vote" only in planned titles and the voice rules (`copy.test.ts`, #63).
- The final QA and user pass over the whole site: the plan's "Final step before live".

## Behaviour

1. **One game (PG-16).** `pitchTitle` becomes "Watch AI agents build a game studio and its free game, Dust." `pitchBody` stays "Fund the card you want built next." (§10 decision 21). `index.html`'s description, `og:description` and `og:image:alt` carry the same text, `og.png` is re-rendered from it, and the footer becomes "AI agents build Dust, a free game you can play in a browser." PLAN §2's pitch line matches, and a new §10 decision records the change. "Watch" stays, because `/card/:id` and its replay exist. No "minutes" claim is made until the home status line shows a measured median.
2. **Star Citizen and Multiverse (L15).** PLAN §2's line becomes "Star Citizen has raised over $1B in 14 years without a 1.0 release; here every dollar is visible as work.", with its source. The Multiverse line states no game count and keeps only what its site shows at build (MIT-licensed games, a live view of the agents); the retrieval is quoted in Evidence. On 23 September 2026 its headline said "Nine games" and it listed 11.
3. **Who runs it (PG-18, L17).** `/how-it-works` has a "Who runs it" block, echoed at the foot of `/team`: "Mob Machine is run by AI agents and a human board: Kyle Smith."; what the board can do (pause the agents; cancel, veto or move a card; change the caps); what it files, as PLAN §4 Who files cards says (the cards: every roadmap entry and every card it opens for funding, with the Game Designer drafting a game card when the board asks); and its standing duties as PLAN §4 The Board lists them at build. Beside it, a short list: code (the dispatcher schedules cards and keeps to the budgets; the gate runs the tests and checks; a card merges only on a green gate; a failed smoke check rolls it back) and the agents (they design, build and review cards).
4. **The $5 example (PG-20).** `/how-it-works`'s example starts from "$5.00 paid", labelled as an example, and shows Stripe's fee (labelled "about"), the 10% reserve, the studio's share, the emergency fund and the agent money, each computed by `payment.ts`'s split arithmetic. The fee is a named constant from Stripe Canada's published pricing for a USD card payment, conversion included, with its source; no Stripe API is called. Then it follows money-logic's waterfall: the named card, then the next cards in line, then "Not on a card yet". Money words live in `legal.ts`. If money-logic already rewrote the example, the pass checks it and changes nothing.
5. **The roadmap (PG-21).** Inside each of its Next and Later bands, `/roadmap` groups planned cards by folder and board-work marker, never by bucket (PLAN §4 Work): **For players** (folder seed-1, not board work), **The studio** (folder platform, not board work) and **Board work on how the studio runs (not funded by cards)** (board work) in a collapsed `<details>`. An empty group is not drawn, each group says "planned" once, and "not funded by cards" is said only of board work. supporter-pages' "Approved, opens soon" and "Held by the board" labels stay on the cards they apply to. An entry is board work when its change lands in kernel paths: rules, money, the card system, the dispatcher, the gate, the agents and their prompts. The builder marks every entry by that rule; the board can flip any entry by editing one line.
6. **The lane line.** While `platform_lane_open` is false, the Platform Builder's /team line, `copy.team.laneClosed`, reads "Starts when the board opens the studio code lane." (done earlier by supporter-pages, 90be039; the spec's `siteClosed` string no longer exists).
7. **The new pages.** Every string listed in the Problem's last item gets the same pass; money strings stay in `legal.ts`, and no chance words sit beside money.

## Acceptance criteria

- [x] No public string, `index.html` tag, `og.png` or PLAN.md line says "free games" outside history notes and COPY.md's bad-example list; `pitchTitle`, the three `index.html` tags, the footer and PLAN §2's pitch line read as Behaviour 1 with `pitchBody` unchanged and a new §10 decision recording it; PLAN §2's Star Citizen line reads as Behaviour 2 with its source, and its Multiverse line states no game count (tests, `git grep`, the Multiverse retrieval quoted in Evidence).
- [x] The rendered `/how-it-works` names the board as Kyle Smith and says what it can do, what it files and its standing duties, and lists what code does and what the agents do; the foot of `/team` repeats the board block; neither says board actions are published with reasons (tests on the rendered text).
- [x] `/how-it-works`'s example starts at $5.00, every figure in it equals `payment.ts`'s arithmetic for $5.00 at the default split, the fee is labelled "about" from a constant whose comment names Stripe Canada's pricing page, and it ends in the waterfall's order (the card, the next cards in line, "Not on a card yet") with no operations step (test).
- [x] Every BACKLOG entry has a `board:` bullet and the parser refuses an entry without one; `file-backlog` sets `cards.board_work`; anon can select the column and `site_cards()` returns it, with site-snapshot's migration test (card keys equal the anon-selectable columns) passing; `/roadmap` renders For players, The studio and a collapsed board-work disclosure by folder and marker, draws no empty group, says "planned" once per group and "not funded by cards" only in the board-work group (migration, parser and `Roadmap.test.tsx` tests).
- [x] `copy.team.laneClosed` reads as Behaviour 6 while the lane is closed, and every public string, the new pages' included, passes `copy.test.ts` (test).
- [ ] Production: the dump is taken before the migration, the migration is applied, `anon-negative-test.ts` and `ledger-identity.ts` PASS, `file-backlog` is applied after a dry run that shows only in-place updates, and the live check PASSes after the deploy (waits on: production steps 1 to 6).

## Verification

- `rm -rf platform/site/dist-e2e platform/board/dist-e2e && pnpm verify`
- `E2E_PORT=4490 pnpm --filter @backseat/site e2e` (the existing suite: axe at 375 and 1440 px, no sideways scroll from 320 to 1440 px and at 375 px with 200% text, and `layout-balance.spec.ts`, all run after the text changes)
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/migration_test.ts`
- `git grep -n -i "free games" -- platform/site seed-1/content docs/PLAN.md` (no match outside history notes)
- Production:
  - `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts`
  - `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts`
  - `pnpm --filter @backseat/supabase file-backlog` as a dry run, then with `--apply`
  - `set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs`

## Production steps (need the board's allow)

1. Dump: `/opt/homebrew/opt/libpq/bin/pg_dump "$BACKUP_DB_URL" --format=custom --file ~/peanutgallery-dumps/pre-board-work-<UTC>.dump`, then `chmod 600`.
2. Apply `20260925400000_board_work.sql` (additive: one column with a default, its grant, `site_cards()` re-created) through the Management API query endpoint, or `supabase db push` once the history repair has run. Re-apply if a reviewer changes the SQL.
3. From the branch: `anon-negative-test.ts` and `ledger-identity.ts` PASS, and main's live check PASSes against production (the client ignores the added key).
4. Merge on a green gate at the head sha. Netlify deploys the site.
5. `file-backlog` as a dry run (every entry an in-place update setting its marker), then applied.
6. The live check, quoted.

## Board items (never blocking)

- Override any wording or any entry's board marker by editing one line; nothing waits on it.
- The address and phone for the Terms' Ontario disclosure stay legal-copy's board item.

## Evidence

Added when the status moves to built: each Behaviour item marked done here, done earlier (with its commit) or not needed; the board marker of every BACKLOG entry and the resulting /roadmap grouping of production's planned cards; a before-and-after table of every changed string on the landing page and /how-it-works; the Multiverse and Star Citizen retrievals; the fee constant evaluated at $1.00 beside the one recorded fee ($0.2662 on $1.00), with any gap explained.

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 16 criteria became 6. Cut as already done on main: the "Available" label check (#56) and the USD note check (#64). Cut, because the operations bucket is removed from the series: the operations sentence read from `money.operations_pct` and shown only when N > 0 (operations-share adds its own sentence when a percentage exists). Cut, because agent-system-core no longer builds `public_board_actions`: the conditional "listed with their reason" claim and the `publicBoardReasons` flag set by grepping migrations. Replaced with the existing standard suite: the separate axe and sideways-scroll criterion and the layout-balance criterion (the site e2e already runs `@axe-core/playwright`, the overflow checks and home's `layout-balance.spec.ts`; the layout-balance gate module and design-review's gate render are gone), and the attended reviewer session with its published frames. Moved to Evidence: the item table, the before-and-after table, the per-card grouping list and the $0.2662 fee check. Dropped as implementation detail: the voice-rule sub-list (enforced by `copy.test.ts`), the live-check upkeep-group assertion (the existing /roadmap no-bar, no-fund-link check stands; the disclosure is unit-tested), and the version-changes-with-`board_work` test (site-snapshot no longer has a card version). Kept whole: every Problem outcome, the kernel paths, the anon grant, the dump before the production write, `anon-negative-test` and `ledger-identity`.
- 2026-09-23, reconciled with the series: the migration is `20260925000000_board_work.sql` (built as `20260925400000_board_work.sql`, below). It re-creates `site_cards()` (site-snapshot's plain function, as supporter-pages last re-created it; there is no `site_cards_body()`), keeping every key and adding `board_work`, and extends the cards column grant from the latest list on main. Every BACKLOG entry in the file at build gets its `board:` bullet, and the parser then requires it, so no later pull request adds an entry without one. The PLAN §10 decision takes the next free number at build.
- 2026-09-23: the copy pass runs last, after the supporter loop. Home-and-design's share of the pass stands and is recorded item by item, not redone.
- 2026-09-23: only the pitch's first sentence changes, from "free games" to one named game (PG-16). "Fund the card you want built next." is the board's line under §10 decision 21 and stays. "A game studio" stays, because no decision dropped it. "Watch" stays, because the card page and its replay exist; "in minutes" waits for a measured median.
- 2026-09-23: PLAN §2 states no Multiverse game count, because its own site's headline and list disagree.
- 2026-09-23: the Stripe fee in the example is labelled "about" and taken from Stripe Canada's published pricing with currency conversion, because the account is Canadian and charges USD. No Stripe account data is read; Stripe access is the board's only.
- 2026-09-23: the roadmap groups by folder and an explicit board-work marker, never by bucket (PLAN §4 Work). Board work is never a funded card, and saying so is the truthful form of PG-21. The marker lives in BACKLOG.md so the board changes an entry by editing one line.
- 2026-09-23: the board line says what the board files (the roadmap and board work), because it files the roadmap through `file-backlog`. (Superseded at build, below: PLAN §4 Who files cards has the board file every card.)
- 2026-09-26, at build (the board's order of that day: finish the series without asking; each call recorded here):
  - The migration is `20260925400000_board_work.sql`: the series' `20260925000000` is main's `terms_version_3`. It adds `cards.board_work` (boolean, default false), re-grants agent-system-core's anon and authenticated column list with `board_work` appended, and re-creates `site_cards()` from supporter-pages' text with `board_work` after `board_veto_reason`. The dispatcher reads nothing new, so `dispatcher_cards` is untouched.
  - Behaviour 3 follows PLAN §4 Who files cards, not the agreed line: the board files every card at /board or through reviewed scripts, and the Game Designer drafts a game card when the board asks, so "not game or site cards" would be false. The line reads "The board files the cards: every entry on the roadmap and every card it opens for funding." It says "Mob Machine", not "Peanut Gallery" (decision 43). The duties are PLAN §4 The Board's six, in plain words, in `legal.whoRuns` (they name money); the code and agents list is in `copy.ts` (no money word, so the dispatcher's site-kernel test holds).
  - The board-work group's heading is "Board work on how the studio runs (not funded by cards)", in place of "Studio upkeep, run by the board": most entries it holds are new mechanics (free voting, seasons, the stream), not upkeep, and PLAN §4 Work names this kind "Board work: how the studio runs". The groups sit inside the existing Next and Later bands; a row says its state only when it is "Approved, opens soon" or "Held by the board", since the group's line says planned once.
  - Every one of the 54 entries is marked `board: yes`: by the kernel-path rule each lands in the rules, the money, the card system, the dispatcher, the gate, the agents or the files that set the look (a new page is a board pull request, §10 decision 51). Even the two seed-1 entries need kernel work: the bug button needs accounts, severity rules and the incident reserve; the nightly rebalance needs a scheduled QA session, telemetry and free votes. So /roadmap shows, in production, only the closed board-work disclosure in each band until a game or studio card is planned; the Game Designer's approved drafts will appear under For players. The board flips any entry with one line.
  - The fee constant is `STRIPE_EXAMPLE_FEE = { pct: 2.9, conversionPct: 2, fixedUsd: 0.2121 }`: Stripe Canada's domestic card rate and its conversion fee, with CA$0.30 turned into US dollars at the Bank of Canada's daily average for 25 September 2026 (both quoted in Evidence). The 0.8% for a card issued outside Canada is said beside the figure. The fee row is labelled "Stripe's fee (about)" with the plain figure, since "about $0.46" as the figure squeezed the row at 320px and overflowed at 200% text.
  - The truth pass fixed three strings beyond the agreed list: /how-it-works' and /ledger's Not on a card yet lines said money with no card waits there, but the waterfall gives it to the next cards in line first (step 2); home's "grow the studio and its games" became "grow Dust and the studio" (PG-16's one game); and /thanks' "Get told when it ships" became "Follow the studio on Discord", since no ship post is made until the board sets `DISCORD_WEBHOOK_SHIPS`.
  - PLAN §5's Stripe line ("about 2.9% plus 30 cents", the US price) now quotes Stripe Canada's pricing, and §9 lists it and Wikipedia's Star Citizen page.
