# Site truth pass: copy that is true, figures that fail honestly, security headers

Status: built. Card: none. Owner: board.

## Problem

ROADMAP.md's definition of live says nothing on the site describes a feature that does not exist, and the audit of 16 September 2026 found copy that does. The site says every dollar and every token is on the public ledger, but founder-billed work is hidden by design. It also says nothing on the ledger is edited by hand, that the reserve is 10% of every contribution when it is 10% after Stripe's fee, that the players direct the studio, and that a public vote picks the next game. Separately, one failing query blanks the meter, the cards and the ledger, a failed or hung refresh leaves stale money figures on screen with no sign, and the site sends no security headers.

## Scope

In:
- Every public string in `platform/site/src/lib/copy.ts` checked against what exists, and each false one replaced.
- The snapshot load split into core (pool, cards) and enrichment (everything else), with the failed enrichments named in `Snapshot.missing`.
- A `stale` flag on the ready state, a timeout on every query so a hung request counts as a failure, and the notices and "Not available right now." lines that use them.
- Security headers in `platform/site/netlify.toml`, with the full Content Security Policy report-only.
- `live-check.mjs` checks the headers against any non-local address, and fails on any Content Security Policy report a page raises.
- Dead code left by PR 30: `copy.recentWork`, the `.panel-heading` rule, LedgerSummary's unused `events` prop and its stale comment.
- BRAND.md, and the Next game note in `site-layout.md`.

Out:
- Any database change. The site reads no new column; `live_at` is a later change.
- The pitch line (PLAN.md §2), the art policy's mention of agent avatars (PLAN.md §4 policy wording), the "founding contributions" wording (PLAN.md §6) and the Next game chip (a board decision in `site-layout.md`).
- Enforcing the full Content Security Policy, and a reporting endpoint. Only `frame-ancestors` is enforced; the conditions for enforcing the rest are under Security headers.
- `/board`, which keeps its own literals and is not public.

## Behaviour

**Copy.** Each string below is replaced. The footer makes no funding claim: most agent work so far was founder-billed and the pool holds about $0.50. The spending rule names contributions and funded cards, because attended founder-billed runs skip the pool check. Facts are exact: the reserve is 10% of the contribution after Stripe's fee, taken before the split (`reserve_pct` over `net_usd` in `credit_contribution`); a dispute takes cover from it first; the emergency fund is 5% of the agents' share up to $500 (`incident_pct`, `incident_cap_usd`) and nothing sets severity `s1`, the only thing that spends it; `public_ledger_totals` sums only studio-billed ledger rows.

| Key | Before | After |
| --- | --- | --- |
| `split` | You choose the split at checkout: 80% agents, 20% studio by default, and 10% of every contribution is held in reserve. These are contributions, not donations. | You choose the split at checkout: 80% agents, 20% studio by default. Before the split, 10% of every contribution after Stripe's fee is held in reserve. These are contributions, not donations. |
| `fixedRules[0]` | Every dollar and every token spent is shown on the public ledger. | The cost of every agent turn paid for with contributions is added to the public ledger. |
| `fixedRules[1]` | Agents spend only what has been funded, within set caps. | Agents spend contributions only on funded cards, within set caps. |
| `fixedRules[2]` | The default split is 80% agents, 20% studio, and 10% of every contribution is held in reserve. You set your own split at checkout. | Before the split, 10% of every contribution after Stripe's fee is held in reserve. The default split is 80% agents, 20% studio, and you set your own at checkout. |
| `fixedRules[3]` | A small emergency fund pays for urgent bug fixes. | 5% of the agents' share is set aside in an emergency fund, up to $500. |
| `footer` | Free games, playable in a browser. Built by AI agents, directed by the players. | Free games, playable in a browser, built by AI agents. |
| `steps[3]` | Every turn the agents spend is priced on the ledger. The change passes the gate, goes live and is listed under Shipped with how many people funded it. | The cost of every agent turn paid for with contributions is added to the public ledger. The change passes the gate, goes live and is listed under Shipped with how many people funded it. |
| `categoryNotes.next` | The next game is picked by a public vote once Dust is finished. Funding for it opens when that vote does. | No card funds a next game yet. |
| `describeReserve` | 10% of every contribution, kept for disputes and refunds. Never spent. | 10% of every contribution after Stripe's fee. It covers disputes first. Agents never spend it. |
| `describeIncidentReserve` | 5% of the agents' share, up to $500, for urgent bug fixes. | 5% of the agents' share, up to $500, kept for urgent bug fixes. Nothing spends it yet. |
| `describeAgentSpend` | Model usage, priced at list rates. | Model usage paid for with contributions, priced at list rates. |
| `ledgerLede` | Every contribution in, every agent turn spent and every deploy, as it happens. Nothing here is edited by hand. | The money in the pool, what agent work paid for by contributions has cost, and the latest agent actions and deploys. |
| `recentWork` | Recent agent work | removed, unused since PR 30 |
| `staleFigures` | new | Could not refresh. These figures may be out of date. |
| `partUnavailable` | new | Not available right now. |

The sweep also read every other public string for a stream, Twitch, voting beyond funding a card, personal decisions, Meet the Team, avatars as a shipped feature and "every dollar". Kept, with the reason:
- `pitchTitle` "Watch AI agents build a game studio and free games." and `pitchBody` "Vote on what they do next by contributing to their compute.": the PLAN.md §2 pitch. The site shows agent actions and deploys as they land, and funding a card is the vote, so neither names a stream. Out of scope here; the board may still want "Watch" reviewed.
- `artPolicy` "such as agent avatars": PLAN.md §4 policy wording, a rule, not a feature.
- `notLiveYet` "founding contributions": PLAN.md §6.
- `sources.decision` "Player decision": a label shown only on a card whose source is `decision`, so it describes data that exists.
- `fundIntro`, `steps[0]`, `contributeLede` and the Terms "Funding a card is how you vote for it": the vote they name is funding a card, which exists.
- Terms "the 10% reserve", Refunds "The 10% reserve covers disputes first.": the reserve's name, and true.
- `fixedRules[5]` "The content filter": `platform/gate/banned-phrases.sh` runs in the gate.
- The ledger's agent action list reads `public_agent_events`, which carries no cost, so `ledgerEmpty` "No agent work recorded yet." stays.

**Partial failure.** The pool and the cards are the core: when either query fails, or a pool or card figure is malformed, the load rejects as before. Every other query (`funding`, `spend`, `studio`, `totals`, `events`, `deploys`, `roles`, then `cardTitles`) runs through `optional`, in parallel with the core. A query error or a malformed figure names the part in `Snapshot.missing`, in `ENRICHMENTS` order, and the snapshot carries its empty value.

Every query, the card-title lookup included, carries `.abortSignal(AbortSignal.timeout(QUERY_TIMEOUT_MS))`, 10 seconds, with its own timer. supabase-js 2.116 reports an aborted request as an error result, so a timed-out core query rejects the load, which marks figures on screen stale, and a timed-out enrichment lands in `missing`. Without it a hung request kept a load pending forever and the figures never went stale. supabase-js also retries a failed GET up to three times (1, 2 and 4 seconds apart), so a refused request surfaces after about 7 seconds.
- LedgerSummary shows "Not available right now." in place of agent spend and the tokens line when `totals` is missing, and in place of the action list when `events` is missing.
- DeployList shows it in place of "No deploys yet." when `deploys` is missing.
- The landing's launch line is left out when `studio` is missing, so it never says the studio is not live because a read failed.
- A funding caption and a shipped row leave out the contributor count when `funding` is missing. A shipped card that was never open to fund still names its source.
- A missing `spend` shows no cost, the same as a card with no studio-billed spend. A missing `roles` shows the short role id, and a missing `cardTitles` leaves the card title off an action.

**Stale figures.** The ready state is `{ state: 'ready'; snapshot; stale: boolean }`. A failed load after a ready state keeps the snapshot and sets `stale`; the next successful load clears it. Each page has one live region, `<p class="muted small status" role="status">`, always rendered and empty until the figures go stale, when "Could not refresh. These figures may be out of date." is filled in. Screen readers announce text that changes inside a live region but often miss a region that mounts with its text already in it. `.status:empty` has no margin, so the empty region takes no space. It sits under the Right now heading on the landing, and under the lede on the Ledger and Contribute pages.
- The Funding meter, on the landing and the ledger, repeats the line above its figures while stale, so a phone reader who scrolls past Right now sees it beside the money. It is a plain muted line, not a second live region, so a screen reader hears it once.

**Security headers.** `netlify.toml` sends on `/*`, which covers the SPA rewrite:
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`.
- `Content-Security-Policy: frame-ancestors 'none'`, enforced.
- `Content-Security-Policy-Report-Only`, each source for a reason:
  - `default-src 'self'`.
  - `script-src 'self'`: the built `index.html` loads one same-origin module script and has no inline script. The Supabase realtime worker is off by default and not enabled.
  - `style-src 'self'`: one same-origin stylesheet and no inline `<style>`. The funding bar's width is set by React through the CSSOM, which `style-src` does not govern.
  - `img-src 'self' data:`: the mark, the favicons and the preview image are same-origin; the /board QR code from Supabase MFA enrolment is a `data:` URL.
  - `font-src 'self'`: the site uses the system font stacks and loads no web font.
  - `connect-src 'self' https://lyxndueoeisyqzewflpu.supabase.co wss://lyxndueoeisyqzewflpu.supabase.co`: `/version.json` (freshness) is same-origin; the REST, auth and realtime traffic goes to the `VITE_SUPABASE_URL` host over https and wss.
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`: no plugins, no `<base>`, and the /board forms submit through JavaScript. The Payment Link, Play, Discord and Clayhouse are links, which `connect-src` and `form-action` do not govern.
- The report-only policy blocks nothing and has no reporting endpoint, so the live check is how a report is seen (below). The full policy is enforced only after both:
  - clean live checks against https://peanutgallery.games, with no Content Security Policy report on any route; and
  - a manual /board two-factor enrolment by a board member with DevTools open, in Chromium and in Safari, with no report in either console. That path, with the `data:` QR code and the auth calls, is the one the live check cannot reach. Each run is recorded in this spec's Evidence with the date, the browser and its version, and the console result.
- `netlify.toml` had no other `[[headers]]` rule and no `_headers` file exists. The redirects do not conflict: `for = "/*"` matches the request path, so an SPA route such as `/ledger`, rewritten to `/index.html`, gets the headers. The live check reads them on `/ledger` for that reason.

**Live check.** Against any base URL that is not localhost, 127.0.0.1 or [::1], `live-check.mjs` checks the five enforced headers and the report-only policy's full value on `/` and `/ledger`, by exact value. Against a local preview, which sends no headers, it prints a SKIP line. On every run, local or not, each page registers a `securitypolicyviolation` listener before any script runs (`addInitScript`, reporting through `exposeFunction`), and any report, enforced or report-only, fails the run: once per width across every route, and once for the landing and contribute interactions. Chromium does not report a report-only violation as a console error, so the console check alone would miss one. `netlify-headers.test.ts` keeps the script's expected values equal to `netlify.toml`.

## Acceptance criteria

- [x] `grep -n -i -E "every dollar|every token|edited by hand|Never spent|directed by the players|picked by a public vote" platform/site/src/lib/copy.ts` returns nothing.
- [x] Every string in the table reads as its After column, and `recentWork` and `.panel-heading` are gone.
- [x] A failure on pool or cards rejects the load; a failure or malformed figure on any enrichment resolves with that name in `missing` and its empty value.
- [x] A failed refresh after a ready state sets `stale`, and the next successful load clears it.
- [x] Every query carries a timeout signal; a query that never answers rejects the load when it is core and lands in `missing` when it is an enrichment.
- [x] Right now, the Ledger header and the Contribute header hold an empty `role="status"` container before the figures go stale, and the same element carries the stale line while stale. The Funding meter shows the line too, and each page has one live region.
- [x] LedgerSummary and DeployList show "Not available right now." for missing totals, events and deploys; the landing shows no launch line with `studio` missing; captions leave out the contributor count with `funding` missing.
- [x] `netlify.toml` sends the five headers and the report-only policy on `/*`, and `connect-src` names the `VITE_SUPABASE_URL` host over https and wss.
- [x] With the report-only policy enforced on a local preview built with the public values, loading every route raises no violation.
- [x] `live-check.mjs` checks the headers, the report-only value included, against a non-local address and skips them locally.
- [x] `live-check.mjs` fails on any Content Security Policy report, whatever the console printed.
- [x] Live: after deploy, `node platform/site/scripts/live-check.mjs` passes against https://peanutgallery.games, header and policy report lines included.
- [ ] Before enforcing the full policy: clean live checks against production, and the /board two-factor enrolment in Chromium and Safari with DevTools open and no report, each recorded under Evidence.

## Verification

- `pnpm --filter @backseat/site typecheck`
- `pnpm --filter @backseat/site test`
- `pnpm --filter @backseat/site build && pnpm --filter @backseat/site e2e`, with and without the Netlify public values exported.
- `node platform/site/scripts/live-check.mjs http://127.0.0.1:4173` against `vite preview`, with the public values; and with `--allow-no-data` on a build without them.
- The same live check through a local proxy on the LAN address that adds `netlify.toml`'s headers, one that adds none, and one whose report-only policy leaves out the Supabase hosts, to run the header and report branches.
- A Playwright load of every route on the preview with the report-only policy sent as an enforced `Content-Security-Policy`, listening for `securitypolicyviolation`.
- A Playwright run on the preview that cuts the Supabase REST requests off after the first load and waits for a poll, to see the stale line fill the live region and appear on the meter.
- `pnpm verify`
- After merge: the live check against https://peanutgallery.games, and `curl -sI https://peanutgallery.games/ledger` shows the headers.

## Evidence

2026-09-16, branch `site-truth-pass`, not merged: 7775826, then a review commit. The live check against production and the /board enrolment runs are pending the deploy.

- **Copy.** `grep -n -i -E "every dollar|every token|edited by hand|Never spent|directed by the players|picked by a public vote|funded by supporters|priced on the public ledger" platform/site/src/lib/copy.ts` printed nothing (exit 1). `Landing.test.tsx` renders `split`, every fixed rule, every step, and the Next game note from `copy.ts`; `e2e/landing.spec.ts` checks the footer "Free games, playable in a browser, built by AI agents." in the built site. `App.test.tsx` renders `ledgerLede` on /ledger.
- **Partial failure.** `source.test.ts`:
  - "rejects with the database error message when the pool fails", "rejects when the cards fail", "rejects when a pool figure is malformed".
  - "keeps the pool and the cards and names {funding, spend, studio, totals, events, deploys, roles} as missing when {table} fails", seven cases, each checking the empty value.
  - "names an enrichment as missing when one of its figures is malformed", "names the card titles as missing when the title query fails", "lists several missing parts in a fixed order".
  - "reads the contract tables and views with the contract shapes" also expects `missing` to be `[]` and a timeout signal on every query, the title lookup included.
- **Timeouts.** `source.test.ts`: "aborts a request that never answers through supabase-js itself, and rejects the load" (a real `createClient` over a fetch that never responds, 20 ms timeout), "rejects when a core query never answers, once its timeout aborts it", "names an enrichment as missing when its query never answers, once its timeout aborts it", "times each query out after ten seconds by default". With the `.abortSignal` calls removed, the three never-answering tests timed out and the contract test failed (`Tests 4 failed | 18 passed (22)`); restored, `Tests 22 passed (22)`.
- **Stale.** `studio.test.tsx` "marks the kept snapshot stale after a failed refresh and clears it on the next successful load". `Landing.test.tsx` "keeps the figures and says they may be out of date when a refresh fails, until one succeeds": the Right now status element exists and is empty before and after the load, the same element holds the line while stale and is empty again after a good load, the Funding region shows the line beside $7.10, and the page has one `role="status"`. `Ledger.test.tsx` "says the figures may be out of date under the heading when a refresh fails" (the status sits in the header, is empty first, one live region, the meter shows the line). `Contribute.test.tsx` "says the figures may be out of date when a refresh fails".
- **Stale in a browser.** On the preview with the public values, the Supabase REST requests cut off after the first load:
  ```
  before {"text":"","height":0,"margin":"0px"}
  after {"text":"Could not refresh. These figures may be out of date.","height":22.390625}
  meter line: 1 status regions: 1
  available still shown: $0.50
  ```
  With a 17-second wait the line had not appeared yet, which matches the poll plus supabase-js's retries; with 32 seconds it had. A screenshot showed the line under the Right now heading and nothing between the heading and Available before.
- **Unavailable parts.** `Ledger.test.tsx` "says a part is unavailable instead of showing zero or an empty line when it did not load" and "shows the totals and the deploys when only the agent actions did not load". `Landing.test.tsx` "says nothing about launch when the studio row did not load". `Cards.test.tsx` "leaves the contributor count out of the caption when the funding figures did not load" and "leaves the contributor count out of a shipped row when the funding figures did not load".
- **Dead code.** `Landing.test.tsx` asserts the Right now panel holds no list, in place of the `recentWork` assertion.
- **Headers.** `src/netlify-headers.test.ts`: "sends the fixed headers on every path", "enforces only frame-ancestors", "reports the full policy without enforcing it", "matches the values live-check.mjs expects from production", "lets the site reach its Supabase project over https and wss".
- **Report-only policy, enforced locally** (first commit). On `vite preview` of a build with the public values, every route, then the landing again:
  ```
  / h1=["Watch AI agents build a game studio and free games."] errors so far=0
  ... /contribute, /ledger, /terms, /privacy, /refunds, /contact, /board, /no-such-page, each errors so far=0
  available figure: $0.50
  funding bars with a width style: 3
  origins: ["http://127.0.0.1:4173","https://lyxndueoeisyqzewflpu.supabase.co","wss://lyxndueoeisyqzewflpu.supabase.co"]
  violations=0
  ```
  The /board QR code was not exercised: it needs a board sign-in, which is why enforcing waits on the manual enrolment.
- **Suites.**
  - `pnpm --filter @backseat/site typecheck` exit 0.
  - `pnpm --filter @backseat/site test`: `Test Files 15 passed (15)`, `Tests 154 passed (154)`, up from 14 files and 123 tests before this change (149 at 7775826).
  - e2e with the public values: `11 passed (2.2s)`. Without them: `11 passed (2.2s)`.
  - `pnpm verify` exit 0: supabase 122, site 154, seed-1 77, dispatcher 207, gate `passed=157`, agents 64, ops 20 pass of 21 (1 skipped), Deno `58 passed (33 steps)`, `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=299`.
- **Live check.**
  - Build with the public values, `http://127.0.0.1:4173`: `PASS live-check http://127.0.0.1:4173 passed=97 failed=0 skipped=3`, with `PASS 375px no Content Security Policy reports`, `PASS 1440px no Content Security Policy reports`, `PASS landing and contribute interactions no Content Security Policy reports` and `SKIP security headers: a local preview does not send them`.
  - Build without them, `--allow-no-data`: `PASS live-check http://127.0.0.1:4173 passed=84 failed=0 skipped=8`. At 7775826 the same build with no flag gave `FAIL live-check http://127.0.0.1:4173 passed=81 failed=3 skipped=5`, exit 1.
  - Through a proxy on `http://192.168.0.115:4175` adding the `netlify.toml` headers: `PASS live-check http://192.168.0.115:4175 passed=109 failed=0 skipped=2`, including the three report lines and `PASS / content-security-policy-report-only: default-src 'self'; ... form-action 'self'` and the same on `/ledger`.
  - Through a proxy on port 4177 whose report-only policy leaves out the Supabase hosts: `FAIL live-check http://192.168.0.115:4177 passed=104 failed=5 skipped=2`, exit 1. The failures are the three report checks (for example `FAIL 375px no Content Security Policy reports: report connect-src blocked wss://lyxndueoeisyqzewflpu.supabase.co/realtime/v1/websocket?...`) and the report-only value on `/` and `/ledger`. The same run printed `PASS 375px no console errors` and `PASS 1440px no console errors`: the console check alone does not see report-only violations.
  - At 7775826, through a proxy on port 4176 adding no headers: `FAIL live-check http://192.168.0.115:4176 passed=94 failed=12 skipped=2`, the header lines.


2026-09-20, status corrected from agreed to built, and the first live line closed.

- **The live check passes against production,** header and policy report lines included:
  `PASS live-check https://peanutgallery.games passed=111 failed=0 skipped=0`. Among them, on both
  `/` and `/ledger`: `x-content-type-options: nosniff`,
  `referrer-policy: strict-origin-when-cross-origin`,
  `permissions-policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()`,
  `content-security-policy: frame-ancestors 'none'`, the full
  `content-security-policy-report-only` line, and `www redirects 301`.
- **Still open, and the only thing between this spec and done:** the report-only policy has not been
  watched in a browser before being enforced. It needs /board two-factor enrolment carried out in
  Chromium and in Safari with DevTools open and no CSP report raised, each recorded here. The board
  enrolled on 20 September but nobody was watching the console, so it does not count.

## Decisions

- 2026-09-16: founder-billed agent work stays tracked and unpublished (board, settled). The copy says the public ledger adds the cost of every agent turn paid for with contributions, rather than every dollar and token.
- 2026-09-16: the Next game chip stays, a `site-layout.md` board decision, and its note says only that no card funds a next game yet. No voting system exists. This supersedes the note in `site-layout.md`.
- 2026-09-16: "founding contributions" and the art policy's agent avatars stay (PLAN.md §6 and §4).
- 2026-09-16: the pool and the cards are the core of a load. Without them the landing has nothing true to show, so their failure still rejects; every other part degrades to "Not available right now." or is left out.
- 2026-09-16: a failed refresh keeps the figures and says so, instead of blanking them. A visitor sees the last known amounts, marked as possibly out of date.
- 2026-09-16: only `frame-ancestors` is enforced. The full policy runs report-only until production shows it raises nothing, because a wrong enforced policy would blank the site.
- 2026-09-16 (review): no reporting endpoint. The live check listens for `securitypolicyviolation` instead, and enforcing waits on clean production checks plus a manual /board enrolment in Chromium and Safari.
- 2026-09-16 (review): the footer says only what is true of every game, with no funding claim.
- 2026-09-16 (review): one live region per page. The meter's copy of the stale line is visual only, so a screen reader does not hear it twice.
- 2026-09-16 (review): every query times out after 10 seconds, so a hung request marks figures stale like a failed one.
- 2026-09-16 (review): enrichment values are not carried forward from the last snapshot, and a missing `spend` still reads as no cost; the review left both as they are.
- 2026-09-16: `live-check.mjs` hardcodes the expected header values instead of reading `netlify.toml`, so a production run checks what is served against what was agreed.
