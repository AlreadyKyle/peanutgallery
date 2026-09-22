# Launch site: honest copy, How it works, the team, the roadmap and board controls

Status: built. Card: none. Owner: board.

## Problem

The site promised votes that do not exist, called the pool balance "Available" while the agents may be paused, and would list every backlog card as open for funding once cards carry a horizon. There was no page that explains the whole path of a contribution, none that shows the agents, and none for planned work. The board could not set caps, record Console credit, move, cancel or resume cards from /board, and the site had no enforced limit on where its script may connect.

## Scope

In: `platform/site/**`. Copy (no vote wording anywhere, In the pool, the paused notice, both hold triggers, the Privacy fingerprint line, the art policy, the footer sentence, deploy rows); `/how-it-works`, `/team` and `/roadmap`; horizon-aware fund lists and category chips; the new board RPC calls in the kernel `lib/board.ts` and their /board forms; the e2e fixture build, the enforced `connect-src`, `live-check.mjs`. Two small edits outside the folder's owner: the Content Security Policy line in `platform/site/netlify.toml` (GATE) and the vote lines in `README.md` (DOCS).

Out: the migrations, the RPCs and their refusals (DB); the dispatcher's lane closure and executor checks (DISPATCHER); BOARD-SETUP, PLAN, COPY.md and the backlog (DOCS). The board on its own origin, which reopens the platform code lane, is a backlog card.

## Behaviour

**Cards.** The site reads `horizon`, `rank` and `executor_role_id` on cards. Building now, Fund what's next, Queued, /contribute and Pick for me hold horizon `now` cards only; a `next` or `later` card is never open for funding. A live card is listed under Shipped whatever its horizon. The category chips are All and Dust; The studio and Next game show only while a card is in them, so they are hidden at launch.

**Copy.** The pitch is "Fund the card you want built next." and no public string, `index.html`, `/board` string or README line says vote; the stage id `voted` is not a word anyone reads. The pool figure is labelled In the pool, described as agent money from contributions not spent yet, including the money on card bars, never as money to spend now; below zero it shows $0.00 and states the shortfall. Money a card does not use pays for later cards. The hold copy (Held for 14 days, Terms, /how-it-works) names the per-person $50 and the studio's daily limit on immediate credit. Privacy says a one-way hash of the identifier Stripe gives the payment card is stored and used only for the $50 limit. The art-policy line is "Art in the games and the agent avatars is drawn by code." The footer is "AI agents build free games you can play in a browser." Deploy rows say only passed or failed checks. "In the gate", "founding contributions" and "Player decision" are gone.

**Paused.** While `public_studio.paused` is true, one notice says the agents are paused and funded cards keep their money and wait in the queue until the board resumes them: in the Right now panel (which also says nothing is building while paused), above the choices on /contribute and on /how-it-works. It never shows when the studio row did not load.

**/how-it-works.** Six steps, each a short text beside the real component that shows it: pick a card (CardBox), contribute and choose the split (the worked split of $10.00 after Stripe's fee), the bar fills (CardBox with a full bar), the agents build it (agent actions), checks then live (deploy rows), it shows under Shipped (a shipped row). Every visual is in example mode (no link, button, disclosure or Payment Link, whatever canFund says) under a label starting "Example", which says whether it is a real public record or made-up figures; made-up visuals use times relative to now. Then headed sections, not questions: where the money goes, holds and refunds, the rules that never change. The landing keeps three short lines and a link here.

**/team.** Every active role from `public_roles`, running roles first. A role runs when it builds cards in an open folder: Builder A, Builder B and QA at launch. The directors, the Host, the Scout and Community have no job that runs yet, and the Platform Builder waits for the platform code lane, so they are "Not running yet" and show no model and no hired date. A running role shows its model, hired date, live cards shipped and what it changes. Each role has a code-drawn SVG avatar from its species note, named by that note. No scorecards.

**/roadmap.** Cards on horizon `next` and `later`, grouped by horizon then category, in rank order, each labelled "Planned and not built yet", with no bar, status or fund link. This is the only page where a planned card's own title may name voting.

**/board.** After the second factor: a caps form (daily cap, per-card spend ceiling, hourly rate, monthly cap, studio daily limit on immediate credit, and a reason), a credit purchase form (amount, Stripe payout id, reason), one form per card in stages proposed, designing, voted, funded and paused (horizon, rank, target, reason; save, cancel after a confirm, and resume with a new estimate on a paused card), and the file card form with a horizon field and no client-side cap on the target. Executors are the roles that build cards; the directors and the Host are never offered.

**Security headers.** `netlify.toml` enforces `frame-ancestors 'none'; connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co`; the full policy stays report-only. This blocks script on the site from sending data to any other host. It does not stop a same-origin call to Supabase; the closed platform code lane does that until the board has its own site.

**Tests.** `vite preview` sends `netlify.toml`'s headers. The e2e run builds its own copy of the site (`dist-e2e`) with the production Supabase URL and a key production refuses, answers every request from fixtures, and holds the realtime socket with no server, so nothing reaches the database. The port comes from `E2E_PORT` (default 4173), and a busy port fails the run instead of testing another build.

**Contract this builds against** (DB workstream; names from the plan and audit F04, F29, F39, F41):
- `cards.horizon`, `cards.rank` and `cards.executor_role_id` readable by anon.
- `public_studio (launched_at, paused)`.
- `public_roles (id, name, title, description, species_note, model, write_access, state, hired_at)`.
- `set_card_horizon(p_card, p_horizon, p_rank, p_reason, p_target_usd)`, with `p_target_usd` sent only when moving to now.
- `cancel_card(p_card, p_reason)` and `resume_card(p_card, p_estimate_usd, p_reason)`.
- `set_caps(p_daily_cap_usd, p_card_max_usd, p_agent_hourly_rate_usd, p_monthly_cap_usd, p_credit_studio_daily_cap_usd, p_reason)`.
- `record_credit_purchase(p_amount_usd, p_stripe_payout_id, p_reason)`.
- `file_card(..., p_horizon)`.
- `board_studio_state` may return `agent_hourly_rate_usd`, `monthly_cap_usd` and `credit_studio_daily_cap_usd`; /board shows them when present.

## Acceptance criteria

- [x] A `next` or `later` card never appears in Building now, Fund what's next, Queued or /contribute, and never shows "Open for funding" or a fund link.
- [x] The studio and next game chips are hidden while they have no cards.
- [x] No non-test file under `platform/site/src`, nor `index.html`, says vote, votes, voting or voter.
- [x] The pool figure is labelled In the pool, its description has no "now", and a negative balance shows $0.00 with the shortfall stated.
- [x] The paused notice shows on the landing, /contribute and /how-it-works while paused, and not when the studio row did not load.
- [x] Every hold description names the $50 per person, the studio's daily limit and 14 days.
- [x] Privacy discloses the card identifier hash; the art-policy line and the footer sentence are exact.
- [x] Deploy rows never show the smoke bot's raw output, and the site does not read it.
- [x] /how-it-works has six steps with six visuals each labelled "Example...", no Payment Link, no `client_reference_id`, no link, button or disclosure in any visual, real records where they exist, and headed sections with no questions.
- [x] /team shows running roles by the derived rule, no model or hired date for a role that does not run, live cards shipped per running role, and an avatar named by each species note; the same note always draws the same avatar.
- [x] /roadmap lists next and later cards by horizon and category in rank order, labelled planned, with no bar, status or link.
- [x] /board sends set_caps, record_credit_purchase, set_card_horizon, cancel_card (after a confirm) and resume_card with the contract argument names, requires a reason, and files a card with `p_horizon`, with a target above the card maximum accepted.
- [x] No site query targets the `roles` table.
- [x] The routes /how-it-works, /team and /roadmap render one h1 that names the tab, are in the nav, and have no horizontal overflow at 375 and 1440 px.
- [x] Every route loads its data under the enforced policy with no report, and a connection to another host is refused.
- [ ] Production: every route passes live-check against https://peanutgallery.games with live data (waits on: B's migrations 000000 to 000400 applied, then this branch deployed).
- [ ] Production: the board RPCs from /board succeed against the real database (waits on: the board's TOTP).

## Verification

- `pnpm verify`
- `pnpm --filter @backseat/site e2e` (with `E2E_PORT` set to a free port)
- `node platform/site/scripts/live-check.mjs http://127.0.0.1:<port> --allow-no-data` against a local `vite preview` of a build with the public Payment Link and no database values
- `node platform/site/scripts/live-check.mjs` against production (waits on: B's migrations 000000 to 000400 applied, then this branch deployed)
- /board, signed in with the second factor: set a card's horizon and rank on a backlog card, then save the caps unchanged with a reason, and see both recorded (waits on: the board's TOTP)
- /board two-factor enrolment watched in Chromium and Safari with DevTools open and no Content Security Policy report, now with `connect-src` enforced (waits on: the board's TOTP)

## Evidence

Run on commit 64ccc7d, before this spec was added.

- `pnpm verify`, exit 0:
  ```
  platform/site test:  Test Files  21 passed (21)
  platform/site test:       Tests  223 passed (223)
  platform/dispatcher test:       Tests  374 passed (374)
  platform/supabase test:       Tests  146 passed (146)
  seed-1 test:       Tests  77 passed (77)
  platform/gate test: PASS: gate tests passed=213
  GATE PASS folder=seed-1 lane=code
  GATE PASS folder=platform lane=code
  PASS: secret-scan files=350
  ```
- `E2E_PORT=4191 pnpm --filter @backseat/site e2e`, exit 0: `25 passed (9.9s)`. Among them:
  ```
  ✓ e2e/csp.spec.ts:29:1 › the preview sends the enforced policy from netlify.toml: frame-ancestors, and connect-src to the site and Supabase only
  ✓ e2e/csp.spec.ts:36:1 › every route loads its data under the policy with no report
  ✓ e2e/csp.spec.ts:52:1 › a connection to any other host is refused by the enforced policy
  ✓ e2e/pages.spec.ts:25:5 › at 375 px › /how-it-works shows six labelled examples, no payment link and no overflow
  ✓ e2e/pages.spec.ts:58:5 › at 1440 px › /team lists the running agents and the ones not running yet, with code-drawn avatars
  ✓ e2e/pages.spec.ts:84:5 › at 1440 px › /roadmap lists next and later cards as planned, with no bars or fund links
  ✓ e2e/paused.spec.ts:14:5 › paused, at 375 px › the landing, /contribute and /how-it-works say the agents are paused
  ✓ e2e/landing.spec.ts:80:5 › at 1440 px › ledger page loads without horizontal overflow and shows no raw bot output
  ```
- `node scripts/live-check.mjs http://127.0.0.1:4192 --allow-no-data` against `vite preview` of a build with the public Payment Link, Discord and play values and no database values: `PASS live-check http://127.0.0.1:4192 passed=135 failed=0 skipped=6`, including:
  ```
  PASS 375px /how-it-works no horizontal overflow
  PASS 1440px /team one h1: ["The team"]
  PASS 1440px /roadmap no horizontal overflow
  PASS /how-it-works 6 labelled examples
  PASS /how-it-works carries no Payment Link and no client_reference_id
  PASS /roadmap has no fund link
  PASS / content-security-policy: frame-ancestors 'none'; connect-src 'self' https://lyxndueoeisyqzewflpu.supabase.co wss://lyxndueoeisyqzewflpu.supabase.co
  PASS 1440px no Content Security Policy reports
  ```
  The six SKIP lines are the live-data checks and the production-only www redirect.
- Criteria and the tests that prove them:
  - Horizons and chips: `src/lib/cards.test.ts` ("keeps next and later cards out of building, funding and the queue"; "visibleFilters") and `src/pages/Landing.test.tsx` ("never lists a next or later card as open for funding"; "hides the studio chip when no studio card is open"). `src/pages/Contribute.test.tsx`: "lists only cards on horizon now".
  - Vote sweep and launch copy: `src/lib/copy.test.ts` ("says vote nowhere in the site source or index.html", "names both hold triggers wherever a hold is described", "discloses the card fingerprint hash on the Privacy page", "labels the pool figure In the pool").
  - Shortfall and paused: `src/pages/Landing.test.tsx` ("shows In the pool at $0.00 and states the shortfall", "says the agents are paused in the Right now panel", "says nothing about a pause when the studio row did not load"), and `e2e/paused.spec.ts` at 375 and 1440 px.
  - Deploy rows: `src/pages/Ledger.test.tsx` ("never shows raw smoke output even when a deploy row carries it") and `src/lib/source.test.ts` (the deploy select).
  - /how-it-works: `src/pages/HowItWorks.test.tsx` (five tests, including "never renders a Payment Link, a fund button or a Play link, even with real open cards and the link set").
  - /team and avatars: `src/pages/Team.test.tsx`, `src/components/Avatar.test.tsx` and `src/lib/board.test.ts`.
  - /roadmap: `src/pages/Roadmap.test.tsx`.
  - /board: `src/pages/Board.test.tsx` ("Board caps and credit", "Board card controls", "files a roadmap card on horizon later with no target", "accepts a funding target above the per-card spend ceiling").
  - No `roles` query: `src/lib/source.test.ts` ("is never queried by the site, which reads public_roles instead").
  - Routes and nav: `src/App.test.tsx`.
- Screenshots of the new pages at 375 and 1440 px are saved under `platform/site/e2e-screenshots/`, which is gitignored and not committed.

## Production steps (need the board's allow)

1. Before this merges: confirm B's migrations 000000 to 000400 are applied on production, and that anon can read `cards (horizon, rank, executor_role_id)`, `public_roles` and `public_studio.paused`. The cards query names these columns, so without the grant the whole cards load fails.
2. Merge; Netlify deploys the site from `main`. Run `node platform/site/scripts/live-check.mjs` against production and quote it here.
3. After that live check passes: apply `20260922000500_roles_revoke` and run B's `anon-negative-test.ts` (F02).
4. Sign in at /board with the second factor and run the two /board Verification lines above.

## Decisions

- 22 September 2026: funding a card is the choice; the site says vote nowhere. Planned cards on /roadmap may name planned voting mechanics, because they come from the backlog, labelled planned.
- 22 September 2026: the pool figure is labelled In the pool (audit F40, ruled in the plan's amendments). Its description explains the term in the same place, as docs/COPY.md asks for an inside term.
- 22 September 2026: whether a role runs is derived, not labelled. A role runs when it builds cards (`CARD_ROLE_FOLDERS` in `lib/board.ts`) in a folder the dispatcher runs at launch (`OPEN_FOLDERS`, `seed-1` only). The Platform Builder is therefore not running yet while the platform code lane is closed, beside the directors, the Host, the Scout and Community. The public_roles contract has no column for this, so the site mirrors the rule the dispatcher and the RPCs enforce.
- 22 September 2026: `connect-src` is enforced, because the e2e run loads every route under the production headers with no report. The rest of the policy stays report-only under the conditions in `docs/specs/site-truth-pass.md`. This supersedes that spec's "only frame-ancestors is enforced" for `connect-src`.
- 22 September 2026: the art-policy line names the avatars as drawn by code. This supersedes the keep-reason for "such as agent avatars" in `docs/specs/site-truth-pass.md`.
- 22 September 2026: the legal pages' "Last updated" line is 22 September 2026, the date the Terms and Privacy text changed. If this merges on a later date, it moves to that date.
