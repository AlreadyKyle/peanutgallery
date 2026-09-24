# Supporter pages: /thanks, /card/:id, supporter credits and /team statuses

Status: built. Card: none. Owner: board.

Built on the merge of site-snapshot (and money-logic, money-surfaces, agent-system-core before it). It is a board pull request: it changes kernel files (a migration, `legal.ts`, `Funding.tsx`, `Stopped.tsx`, `App.tsx`, `netlify.toml`, the new kernel files below, `docs/`). It writes no money rows; every money read is a view or a function over money-logic's tables.

This spec covers the launch plan's Phase 2 "Pages and credits" and "`/team`" lines, the card half of Phase 1's "Failures are public" (R14, L02, L04), and PG-02, PG-03, PG-04, PG-05, PG-11 (the thanks half), PG-15 and L17's card half.

## Problem

- After paying, a supporter lands on Stripe's generic receipt with no way back. Nothing tells them which card their money reached, whether it counts now or is held, or where to follow it (PG-04). The site has no `/thanks` route.
- No card has a page (PG-02, L17). A supporter cannot see their card move from funded to live, what it cost or who else funded it, or when the gate passed and what changed. (How the design review went is design-review's, later.)
- The public event stream can only say "used a tool" (PG-03). 94 of production's 241 events are tool results, which say nothing.
- A supporter gets only a contributor count, with no credit of their own (PG-05).
- A rejected or paused card has a row in /ledger's Stopped band (money-surfaces) but no page of its own that the row can link to.
- `/team` decides "running" from whether a role builds cards in an open folder. It ignores the roster's `status` and `trigger` columns, shows no pause, and shows no cost or ships.

## Scope

In:
- **SQL**, migration `20260924600000_supporter_pages.sql` (after site-snapshot's; bumped if main holds a later file):
  - `public.event_line_key(type, payload)`, an immutable allowlist from an event to a fixed line key;
  - `public_agent_events` recreated from agent-system-core's version (its `card_is_public` filter kept) with `line_key` appended after the existing columns;
  - `public_card_supporters` (card_id, supporter_number, founding), a view over money-logic's `supporters` and allocations, filtered by `money.payment_counts` and `card_is_public`;
  - `public_role_stats` (role_id, spent_usd, spent_7d_usd, shipped_cards);
  - `public.site_card(p_id uuid)`, security invoker, over public views only;
  - `public.thanks_for_session(p_session text)`, security definer: the only function here that reads private money rows;
  - site-snapshot's `site_live()` and `site_cards()` recreated from the merged versions, keeping every key and adding only: `line_key` on events (key none left out), `role_stats`, and each role's `status`, `trigger`, `paused` and `paused_reason`.
- **Netlify Function** `platform/site/netlify/functions/card.mts`: `GET /api/card/:id` and `POST /api/thanks`, with a Netlify rate limit.
- **Site, kernel:** `/thanks` (route in `App.tsx`, `thanks` in `KERNEL_SEGMENTS`, and `api` if site-snapshot has not added it; a forced `/thanks` rule in `netlify.toml`); new `pages/Thanks.tsx`, `lib/thanks.ts`, `lib/card-source.ts`, `components/Supporters.tsx`; `Funding.tsx` gains `CardFacts`; `Stopped.tsx` rows link to `/card/:id`; `legal.ts` gains the Privacy lines on supporter numbers and the /thanks and card money words; `kernel-paths.txt` and `KERNEL_PATHS`.
- **Site, card lane:** `/card/:id` in `routes.tsx` with `pages/CardPage.tsx`, `components/Timeline.tsx` and `components/Replay.tsx`; the Watch links on `Card.tsx`'s building and checks faces and on the shipped rows of home and `/roadmap`; `/roadmap`'s "Approved, opens soon" and "Held by the board" labels; `lib/roster.ts` `teamStatus` and `pages/Team.tsx`; `copy.ts`.
- **Checks:** unit tests, the Deno migration test, e2e fixtures and specs, `live-check.mjs`, `team-models.mjs`, `anon-negative-test.ts`.
- **Docs:** PLAN.md (§4 The Board's privacy line; Appendix A: the new views, functions and the measured `/api/card` and `/api/thanks` budget lines), DESIGN.md (`/card/:id`, `/thanks`, `/team` rows), COPY.md (event words, thanks states, credit forms), ROADMAP.md, BOARD-SETUP ("Stripe settings" → "After-payment redirect", ready once live), `docs/specs/announcement.md` (the clip is `/card/<first player-funded card>`; a screen recording is optional, PG-15), this spec.

Out:
- The operations bucket. It is removed from the series until a percentage exists, so nothing here reads or mentions it.
- The Payment Link's after-payment redirect: a board step (Board items). Card naming at checkout is already on main (`client_reference_id`).
- Design review verdicts and the mockup link on /card: design-review, which adds them to `site_card`.
- The one list of stopped cards, the reconciliation line and the pause reason: money-surfaces.
- Weekly report and Discord posts: studio-reports. /how-it-works' line on code and agents: copy-pass.
- Backlog: per-card link previews, design frames on /card, "Play this version" permalinks, a per-contribution replay, replay Pause and Step, free-text supporter names, hand-off lines ("Drafted by", "Approved by") and ranking moves, the before value of a config change, a Share button.

## Behaviour

**Event lines.** Each agent event gets a fixed line key from its type and payload, never from free text. Tool names are compared without regard to case, so Claude Code's names (Read, Edit, Bash) and Managed Agents' (read, edit, bash) give the same key. No path, command, message text or tool output is ever public.

| Event | Line key | Words |
|---|---|---|
| `start` | started | "started work" |
| `tool_call`: read, grep, glob, ls | read | "read a file" |
| `tool_call`: edit, write, multiedit, notebookedit | edited | "edited a file" |
| `tool_call`: bash | ran | "ran a command" |
| `tool_call`: submit_patch | submitted | "handed in its change" |
| `tool_call`: any other tool | used_tool | "used a tool" |
| `message` with `step` smoke_pass, requeue, infrastructure, patch_reused, dealt, held | smoke_passed, requeued, paused_infra, patch_reused, dealt, held | copy.ts |
| any other `message` | none | |
| `gate_pass`, `gate_fail`, `ship`, `revert`, `error` | gate_passed, gate_failed, shipped, reverted, stopped | copy.ts |
| `tool_result` | none | |
| any other type | other | |

Rows with key none never reach the public documents. On the page, consecutive lines on the same card by the same role with the same key show as one line with a count ("Builder A read 12 files"), by one helper used by home's feed and /card.

**Supporter numbers and credits.**
- The number is money-logic's `supporters.number`, and founding is `supporters.founding`, unchanged. money-logic never numbers the board's test payment, so the first player is Supporter 1. No second exclusion is added.
- A card lists each supporter with at least one payment that counts (`money.payment_counts`: not the board's test payment, not fully refunded or disputed net of reinstatements) and whose positive allocations reached the card. A refunded or lost-dispute payer drops from every card, even where the money was spent; a dispute the studio wins restores them.
- Number order, the first 24, then "and n more"; with none, "No supporters yet." No amount, time or free text per supporter.
- `public_card_funding.contributors` (money-logic) counts with the same helper, so the count and the list agree.
- The Privacy page says: supporter numbers are public on the cards your money reached; a number belongs to one receipt email (stored only as a hash), so two addresses give two numbers; nothing public shows a name or an email. It does not promise that amounts cannot be matched to numbers.

**`/card/:id`.** Black band: top bar, back link, the title as `h1`. White band:
- the card face (the Live stamp for a live card) and Play;
- the facts: Funded $x of $y; Contributors n; cost from contributions; minutes from start to live when both are recorded; "Merged as the studio's commit abc1234" (no link: the repository is private); gate passed, at a time;
- "What changed", for a config card: the commit, and each `check: config <file> <path> == <value>` line from the card's already-public `acceptance_test` as `<file> <path>: <value>` when the value is a number, boolean or string of 200 characters or fewer, else "changed";
- the supporters; the event lines (newest 200, oldest first, with "and n earlier steps").

A rejected or paused card shows its face and the same reason words and money trail as its /ledger Stopped row (money-surfaces' `public_stopped_cards` row and `legal.failingCheckWords`). An unknown or malformed id shows the not found content with "There is no card at this address." While the card is building or being checked, the page reloads its detail on the site's live poll and new lines appear at the end.

**The replay.** Play steps through the card's recorded milestones in order, at most five: opened (the deal), funded (the bar fills to its total), started (the flip), the latest gate result (the checklist mark), shipped (the slam and Live stamp). It uses the existing motion functions in `lib/motion.ts` at a fixed pace, finishes within 30 seconds, and one polite live region says each step. The button then reads Replay. Under reduced motion, or with no recorded milestone, there is no Play button and the page shows the end state.

**Links.** Building and checks faces carry "Watch how it's built"; shipped rows on home and `/roadmap` carry "Watch how it was built"; each Stopped row on /ledger links its card. All go to `/card/:id`.

**`/roadmap`.** An approved agent card waiting to be dealt (`opens_at` set, not yet on now) shows "Approved, opens soon". A board-vetoed card shows "Held by the board" with its `board_veto_reason`.

**`/thanks`.**
- Stripe's redirect lands on `/thanks?session=cs_…`. The page takes `session` only when it matches `^cs_(live|test)_[A-Za-z0-9]{10,250}$`, keeps it in sessionStorage, replaces the address with `/thanks`, and POSTs it to `/api/thanks`. No answer holds an amount, an email or a name.
- **Pending** (not yet recorded, or unknown, alike): "Recording your payment…" (`aria-busy`), asking again every 5 seconds for up to 3 minutes (the one measured payment took about 79 seconds to record), then: "Stripe has taken your payment and emailed your receipt. It can take a few minutes to reach the studio's books."
- **Recorded:** "Thank you. You are Supporter 12." (or "Founding supporter 12"); the cards the money reached, the named card first, at most five, each a row with its title linking `/card/:id` and one state line (open: "Open for funding" with its bar; funded: "Funded. It waits for the agents."; building: "Being built now."; being checked: "Being checked."; live: "Live."); the paused notice while the studio is paused; "Your contribution is held before it counts, until <New York date>." when held; "Part of your contribution waits as Not on a card yet and goes to the next card that opens." when some is unplaced; "This payment was refunded or disputed, so nothing from it is on a card." when reversed; "Your contribution is under version n of the Terms." linking /terms/n and /refunds/n when the payment has a stamped `terms_version`.
- **Not counted** (the board's test payment): "Thank you.", links to home and Contribute, no number.
- **Follow along:** "Watch this card" (`/card/:id`) and "Get told when it ships" (the Discord invite, "Discord is for ages 13 and over.").
- **No session:** a plain thank-you with links to home and Contribute.

**`/team`.** `lib/roster.ts` `teamStatus(role, snapshot)` is the one rule, used by /team and home's team strip:
- **Running:** roster status `running` and not paused; a card role whose folder is closed says "Starts when the board opens the studio code lane".
- **Paused:** roster status `running` while `public_studio` is paused (with `legal.pauseReasons` words, else the paused notice) or while the role's `paused` is true (with its `paused_reason`).
- **Starts when …:** status `starts`, with its trigger sentence. A role that runs only when the board starts it is recorded this way in the roster.
- **Planned:** status `planned`.

Sections: Running (holding paused rows while the studio is paused), Starts later, Planned. Running and paused rows show the model, "Spent from contributions $x, $y in the last 7 days" (ledger rows billed to the studio only, never the founder's) and "Worked on n shipped cards". Other rows show no model and no cost. Avatars sleep while the studio is paused.

**Requests and caching.**
- `GET /api/card/:id`: a non-uuid id answers 400 `no-store` before any Supabase call; `site_card` null answers 404; otherwise 200 with the header `/api/live` uses (`Netlify-CDN-Cache-Control: public, durable, s-maxage=60, stale-while-revalidate=60`, `Cache-Control: public, max-age=0, must-revalidate`).
- `POST /api/thanks`: a JSON body of at most 1 KB with a well-formed session, else 400; every answer `no-store` on both cache headers.
- Any other method answers 405. The function's rate limit is 60 requests a minute per IP and domain.

**Compatibility.** The migration reaches production before the merge. The new `site_live()` and `site_cards()` output only adds keys, so the deployed site keeps loading in between.

## Acceptance criteria

- [x] `event_line_key` gives every row of the Event lines table for payloads as each adapter writes them (Claude Code's `Read` and Managed Agents' `read` give the same key; an unlisted tool gives `used_tool`; an unlisted step and `tool_result` give none; an unlisted type gives `other`), `public_agent_events` gains `line_key` after its existing columns and exposes no payload text, and `site_live()`'s events never carry key none (migration test).
- [x] On a production-shaped migration fixture, `public_card_supporters` lists each counted payer on every card their positive allocations reached with `supporters.number` and `founding`; a full refund after part of the money was spent, and a lost full dispute, each remove the payer from every card; a `reinstated` entry restores them; the board's test payment has no number, is on no card and in no count, and the first other payer is Supporter 1; and for every card `public_card_funding.contributors` equals its row count in `public_card_supporters`.
- [x] `thanks_for_session` is security definer with a fixed search path and anon may execute it; it answers a malformed or unknown session with exactly `{"status":"pending"}`, the board's test payment with exactly `{"status":"not_counted"}`, and a recorded payment with only the keys status, supporter (number, founding), named_card_id, reached (at most five card ids, named first), waiting, credit (`credited`, `held` or `reversed`), held_until (a New York date) and terms_version, and no amount, email, name, contributor id or payer key (migration test on each case).
- [x] `site_card` is security invoker, returns null for an unknown id, and for a live, a building and a rejected fixture card returns its public columns, funding, cost, the first 24 supporters and their count, the newest 200 lines with key other than none and their total, the milestones, and for the rejected card its `public_stopped_cards` row; the new `site_live()` and `site_cards()` output has every key in site-snapshot's `snapshot-keys.json`; `public_role_stats` sums only ledger rows billed to the studio (a founder-billed fixture row is not counted) and counts only live cards; the migration applies twice without error (migration test).
- [x] `card.test.ts`: `GET /api/card/<not a uuid>` answers 400 `no-store` with no Supabase call; an unknown card answers 404; a known card answers 200 with the `/api/live` CDN header; `POST /api/thanks` with a malformed session or a body over 1 KB answers 400, and every `/api/thanks` answer is `no-store` on both cache headers; any other method answers 405; the function config sets the 60-a-minute rate limit per IP and domain.
- [x] `/thanks` (e2e from fixtures) removes the session from the address after reading it; on a pending answer polls every 5 seconds and shows the fallback sentence at 180 seconds (`page.clock`); renders the recorded (with and without founding), held, waiting, reversed, not-counted and no-session states, with the terms line linking /terms/n and /refunds/n only when `terms_version` is stamped; and no `$` amount appears in the supporter area.
- [x] `/card/:id` (e2e from fixtures) shows for a live card the title as `h1`, the facts with "Merged as the studio's commit <7 hex>" and no link, "What changed" with scalar values and "changed" for any other, the supporters in number order with "and n more" past 24 (or "No supporters yet."), and collapsed event lines ("Builder A read 12 files"); a rejected card shows the same reason words and money trail as its /ledger row; an unknown or malformed id shows "There is no card at this address."; a building card shows a new fixture line at the end after a live poll; Play plays the recorded milestones and finishes within 30 seconds, then reads Replay, and under reduced motion there is no Play button, `getAnimations()` stays empty and the end state shows; and the Watch links on the building and checks faces and on the shipped rows of home and `/roadmap`, and each Stopped row on /ledger, link `/card/:id`.
- [x] `/team` (unit tests of `teamStatus` and e2e) shows Running, Paused (studio pause with its reason words; role pause with its `paused_reason`), Starts when … with the trigger, and Planned from the roster columns as described, with model, cost and ships on running and paused rows only; home's team strip uses the same `teamStatus`; `team-models.mjs` still passes (every Running role on `claude-opus-5-5`, no model elsewhere); and `/roadmap` shows "Approved, opens soon" on a fixture card with `opens_at` set and not yet dealt and "Held by the board" with its reason on a vetoed card, and neither otherwise.
- [x] `thanks` (and `api`) are in `KERNEL_SEGMENTS`, `netlify.toml` serves the app at `/thanks` with `force`; `Thanks.tsx`, `thanks.ts`, `card-source.ts` and `Supporters.tsx` are in `kernel-paths.txt` and `KERNEL_PATHS` and the parity test and `site-kernel.test.ts` pass; the Privacy page carries the three supporter-number lines, with `privacyUpdated` moved to the merge date; and `anon-negative-test.ts` reads `public_card_supporters` and `public_role_stats`, calls `site_card` and `thanks_for_session` as anon checking their exact keys, and still refuses every private table and the money schema.
- [x] With fixtures for each, `design.spec.ts` (axe WCAG 2.2 AA, no sideways scroll, reduced motion) and `layout-balance.spec.ts` pass on `/card/:id` (live, building, rejected), `/thanks` (recorded, pending, not counted), `/team` and `/roadmap` with an opens-soon card, at 375, 768 and 1440 px.
- [ ] Production: the dump is taken and the migration applied before the merge; `anon-negative-test.ts` and `ledger-identity.ts` PASS; main's `live-check.mjs` PASSes against production before the merge; after the deploy `live-check.mjs` PASSes with `/card/<a live card id>` showing its title and commit, `/thanks` with no session, `/thanks?session=cs_test_invalid0000000000` showing "Recording your payment" with the query dropped, and `/team`'s sections; and a SELECT shows the board's test payer has no row in `public_card_supporters`.

## Verification

- `pnpm verify` at the repository root.
- `deno test --config platform/supabase/functions/deno.json --allow-read --allow-env platform/supabase/functions/_shared/migration_test.ts`
- `pnpm --filter @backseat/site test`
- `E2E_PORT=4391 pnpm --filter @backseat/site e2e`
- `E2E_ROUTE_SHOTS=<folder> E2E_PORT=4391 pnpm --filter @backseat/site exec playwright test e2e/route-shots.spec.ts` with the new routes added, and the shots at 375, 768 and 1440 looked at.
- After production step 2, from a checkout of main: `set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs`.
- On the deploy preview, after production step 3: `curl -s -D - -o /dev/null '<preview>/api/card/<a live card id>'` twice, quoting `Cache-Status`; `curl -s -X POST -H 'content-type: application/json' -d '{"session":"cs_test_notarealsession000"}' <preview>/api/thanks`, quoting the body and `Cache-Control`.
- Production: `pnpm --filter @backseat/supabase exec tsx scripts/anon-negative-test.ts`; `pnpm --filter @backseat/supabase exec tsx scripts/ledger-identity.ts`; `set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs`; the board-test SELECT through the Management API.

## Production steps (need the board's allow)

1. Dump: `/opt/homebrew/opt/libpq/bin/pg_dump "$BACKUP_DB_URL" --format=custom --file ~/peanutgallery-dumps/pre-supporter-pages-<UTC>.dump`, then `chmod 600`.
2. Apply `20260924600000_supporter_pages.sql` (Management API query endpoint, or `supabase db push` once the history repair has run). Re-apply if review changes the SQL.
3. From the branch: `anon-negative-test.ts` PASS, `ledger-identity.ts` PASS; from a checkout of main: `live-check.mjs` PASS against production.
4. The deploy-preview curls.
5. Merge on a green gate at the head sha. Netlify deploys.
6. `live-check.mjs` PASS, quoting the `/card`, `/thanks` and `/team` lines.
7. The board-test SELECT, quoted.
8. Tell the board `/thanks` is live (Board items).

Board items (listed, none blocks this pull request):
- Stripe Dashboard, Payment Link → After payment: redirect to `https://peanutgallery.games/thanks?session={CHECKOUT_SESSION_ID}` (BOARD-SETUP "Stripe settings", "After-payment redirect"). Until then `/thanks` works for anyone who opens it with a session id.
- The refund of the board's $1 test payment (money-logic's item).
- Once the redirect is set, the next real payment landing on `/thanks` with its supporter number is quoted in Evidence.

## Evidence

Added when the status moves to built or done: money-logic's and agent-system-core's merged table and column names; the board-test SELECT; the measured budget lines.

## Decisions

- 2026-09-23, Trimmed (board: "better to be simple and delete than add more convoluted bespoke"; good normal modern standards): 32 criteria became 11. Cut:
  - the content-hash `dv` and `site_card_version`, the 409 retry, `Netlify-Vary: query=v`, the day-long immutable header, and the live document's `tail` and per-card `dv`: `/api/card/:id` uses the same 60-second durable CDN header as `/api/live`, and a building card's page reloads its detail on the live poll;
  - the `event_runs` gaps-and-islands function: the detail carries the newest 200 lines and one tested helper collapses consecutive lines on the page;
  - `sha` and `pr` on `public_agent_events`: the commit is `cards.commit_sha` (already public) and the gate time is the `gate_pass` event's;
  - the dispatcher's `check_before` event, `card_check_values` and the "before" value: "What changed" shows the commit and the values the gate checked, from the already-public `acceptance_test` (before values are backlog);
  - `card_money_after` and the shipped-leftover line: a stopped card's money trail is its `public_stopped_cards` row, the same words as /ledger; the shipped-leftover line was not a Problem outcome;
  - `public_card_approvals` and the hand-off lines: a new public projection of a private table for an outcome the Problem does not name; the dealt and held steps still show as event lines;
  - the replay's real-timing compression with a 0.8-second floor: a fixed pace over at most five milestones;
  - `rememberFund` and the "card you chose" line on the fallback, the Share button with its clipboard fallback, and card faces on /thanks with the kernel import-rule change for `Card.tsx` they needed (reached cards are rows linking `/card/:id`);
  - the two-speed poll (3 s ×10 then 10 s ×15): one 5-second poll up to 3 minutes;
  - the operations bucket (removed until a percentage exists): `public_role_stats` counts rows billed to the studio only, and /team's `runs_unattended` note is gone; a role that runs only when the board starts it is `starts` in the roster;
  - the dedicated gate test for `Thanks.tsx`, the founding-equality and dv tests (the parity test, the existing kernel guard and the view definition cover them);
  - the attended reviewer session, the published review page and layout-balance's gate module (dropped): `design.spec.ts`, #64's `layout-balance.spec.ts` and route shots looked at;
  - the real-payment criterion, now a board item, because it waits on the board's redirect.
  Kept whole: every Problem outcome; `money.payment_counts` credit with refund unwinding across every card reached and reinstatement; the board-test exclusion and numbering from 1; count and list parity; the exact-key security-definer `thanks_for_session`; the event allowlist; kernel paths; the anon-negative test, ledger identity and the dump before the production write.
- 2026-09-23: `/thanks` is a kernel route, because it reads private money rows through `thanks_for_session`. `/card/:id` is a card-lane page that shows money only through kernel components, as home does.
- 2026-09-23: event lines come from a fixed allowlist of types, tool names and step codes, matched in both tool namings without regard to case. Paths and commands are left out even when they look safe: an agent chooses them.
- 2026-09-23: the session id leaves the address bar as soon as it is read; the share link is the card page, never `/thanks`. "Not yet recorded" and "unknown" are both pending, so the page reveals nothing without a real session id.
- 2026-09-23: credit follows money-logic's `money.payment_counts`, not allocation netting: a refunded or lost-dispute payer is not credited even where the money was spent, and a dispute the studio wins restores it. The founder's payments get no number and appear on no card (PLAN §10 decision 23), by money-logic's `board_test_payments`; nothing had been published, so nothing changes for anyone.
- 2026-09-23: founding is money-logic's `supporters.founding` (first counted payment before Go live, in Stripe's time); money-logic records the PLAN change.
- 2026-09-23: `/team`'s cost counts only rows billed to the studio. Founder-billed work stays private (PLAN §4 The Board, decision 7), so every role shows $0.00 from contributions until the cutover. That is true.
- 2026-09-23: the merge sha is labelled as the studio's own commit, with no link, until the public seed-1 mirror exists.
- 2026-09-23: money-surfaces' Stopped band is the one public list of rejected and paused cards; this pull request links its rows and draws no second Discard.
- 2026-09-23 (board defaults): card naming at checkout is the Payment Link's `client_reference_id`, already on main; the after-payment redirect is a listed board step. BOARD-SETUP steps are cited by title.
- 2026-09-23 (build defaults, recorded without asking the board, as ordered):
  - The recorded /thanks heading is "Thank you" with "You are Supporter 12." (or "You are Founding supporter 12.") under it, and the funded state line is "Funded and waiting for the agents.". The copy rules (`copy.test.ts`: no sentence under three words beside another) refuse "Thank you. You are Supporter 12." and "Funded. It waits for the agents." as single strings; the page still reads the spec's words in the same order.
  - /roadmap lists planned cards only and draws no shipped rows, so "Watch how it was built" sits on home's Shipped rows and /roadmap keeps no link (live-check's "/roadmap has no fund link" counts every link on it).
  - The event line words and `collapseLines` live in `lib/lines.ts`, a new kernel file (kernel-paths.txt, `KERNEL_PATHS`, `site-kernel.test.ts`), because the kernel `EventList.tsx` reads them and what an agent's steps may say in public is a privacy rule; the held step's words are `legal.eventLineHeld`, since `copy.ts` may carry no money word.
  - A card's page draws the face beside the facts only from 64rem and stacks them below: at 768px `layout-balance.spec.ts` measured a 281px hollow beside the face.
  - "What changed" shows a number, a boolean or a string of at most 200 characters; JSON null, like every other value, reads "changed", as Behaviour says.
  - /thanks stops asking after the answer whose next ask would pass 3 minutes, so the fallback shows between 175 and 180 seconds.
  - `privacyUpdated` stays "Last updated 23 September 2026.", the build date; if the merge lands on another day, the ship stage moves it to the merge date.
  - The e2e fixture `e2e/supporter-studio.ts` extends the launch-shaped studio with a live card (commit, config checks, 30 supporters, a run of agent steps), a building and a checks card, an opens-soon and a vetoed card, role stats and a /thanks answer per state; `route-shots.spec.ts` uses it for every route.
  - live-check checks the newest live card's commit line only when the card has a `commit_sha`, and adds `/api/card/not-a-card` (400 `no-store`) and a made-up `/api/thanks` session (exactly pending, `no-store`).
  - The nine backlog items under Out are one BACKLOG entry, "More on a card's own page", linked from PLAN §4 Not built yet.
  - The `/api/card/:id` budget row is per card id (one build per id per 60-second window), so the month's figure depends on how many card pages are read; it is measured after the deploy (production step 4) and Netlify's usage notifications stay the alert (decision 45).

