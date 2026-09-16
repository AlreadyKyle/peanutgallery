# Site truth pass: copy that is true, figures that fail honestly, security headers

Status: agreed. Card: none. Owner: board.

## Problem

ROADMAP.md's definition of live says nothing on the site describes a feature that does not exist, and the audit of 16 September 2026 found copy that does. The site says every dollar and every token is on the public ledger, but founder-billed work is hidden by design. It also says nothing on the ledger is edited by hand, that the reserve is 10% of every contribution when it is 10% after Stripe's fee, that the players direct the studio, and that a public vote picks the next game. Separately, one failing query blanks the meter, the cards and the ledger, a failed refresh leaves stale money figures on screen with no sign, and the site sends no security headers.

## Scope

In:
- Every public string in `platform/site/src/lib/copy.ts` checked against what exists, and each false one replaced.
- The snapshot load split into core (pool, cards) and enrichment (everything else), with the failed enrichments named in `Snapshot.missing`.
- A `stale` flag on the ready state, and the notices and "Not available right now." lines that use it and `missing`.
- Security headers in `platform/site/netlify.toml`, with the full Content Security Policy report-only.
- `live-check.mjs` checks the headers against any non-local address.
- Dead code left by PR 30: `copy.recentWork`, the `.panel-heading` rule, LedgerSummary's unused `events` prop and its stale comment.
- BRAND.md, and the Next game note in `site-layout.md`.

Out:
- Any database change. The site reads no new column; `live_at` is a later change.
- The pitch line (PLAN.md §2), the art policy's mention of agent avatars (PLAN.md §4 policy wording), the "founding contributions" wording (PLAN.md §6) and the Next game chip (a board decision in `site-layout.md`).
- Enforcing the full Content Security Policy. Only `frame-ancestors` is enforced until production shows the report-only policy raises nothing.
- `/board`, which keeps its own literals and is not public.

## Behaviour

**Copy.** Each string below is replaced. Facts are exact: the reserve is 10% of the contribution after Stripe's fee, taken before the split (`reserve_pct` over `net_usd` in `credit_contribution`); a dispute takes cover from it first; the emergency fund is 5% of the agents' share up to $500 (`incident_pct`, `incident_cap_usd`) and nothing sets severity `s1`, the only thing that spends it; `public_ledger_totals` sums only studio-billed ledger rows.

| Key | Before | After |
| --- | --- | --- |
| `split` | You choose the split at checkout: 80% agents, 20% studio by default, and 10% of every contribution is held in reserve. These are contributions, not donations. | You choose the split at checkout: 80% agents, 20% studio by default. Before the split, 10% of every contribution after Stripe's fee is held in reserve. These are contributions, not donations. |
| `fixedRules[0]` | Every dollar and every token spent is shown on the public ledger. | Every agent turn paid for with contributions is priced on the public ledger. |
| `fixedRules[2]` | The default split is 80% agents, 20% studio, and 10% of every contribution is held in reserve. You set your own split at checkout. | Before the split, 10% of every contribution after Stripe's fee is held in reserve. The default split is 80% agents, 20% studio, and you set your own at checkout. |
| `fixedRules[3]` | A small emergency fund pays for urgent bug fixes. | 5% of the agents' share is set aside in an emergency fund, up to $500. |
| `footer` | Free games, playable in a browser. Built by AI agents, directed by the players. | Free games, playable in a browser. Built by AI agents and funded by supporters. |
| `steps[3]` | Every turn the agents spend is priced on the ledger. The change passes the gate, goes live and is listed under Shipped with how many people funded it. | Every agent turn paid for with contributions is priced on the public ledger. The change passes the gate, goes live and is listed under Shipped with how many people funded it. |
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
- LedgerSummary shows "Not available right now." in place of agent spend and the tokens line when `totals` is missing, and in place of the action list when `events` is missing.
- DeployList shows it in place of "No deploys yet." when `deploys` is missing.
- The landing's launch line is left out when `studio` is missing, so it never says the studio is not live because a read failed.
- A funding caption and a shipped row leave out the contributor count when `funding` is missing. A shipped card that was never open to fund still names its source.
- A missing `spend` shows no cost, the same as a card with no studio-billed spend. A missing `roles` shows the short role id, and a missing `cardTitles` leaves the card title off an action.

**Stale figures.** The ready state is `{ state: 'ready'; snapshot; stale: boolean }`. A failed load after a ready state keeps the snapshot and sets `stale`; the next successful load clears it. While stale, the Right now panel (under its heading) and the Ledger and Contribute page headers (under the lede) show `<p class="muted small" role="status">` "Could not refresh. These figures may be out of date."

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
- `netlify.toml` had no other `[[headers]]` rule and no `_headers` file exists. The redirects do not conflict: `for = "/*"` matches the request path, so an SPA route such as `/ledger`, rewritten to `/index.html`, gets the headers. The live check reads them on `/ledger` for that reason.

**Live check.** Against any base URL that is not localhost, 127.0.0.1 or [::1], `live-check.mjs` checks the five enforced headers on `/` and `/ledger` by exact value, and that the report-only policy is sent. Against a local preview, which sends no headers, it prints a SKIP line.

## Acceptance criteria

- [x] `grep -n -i -E "every dollar|every token|edited by hand|Never spent|directed by the players|picked by a public vote" platform/site/src/lib/copy.ts` returns nothing.
- [x] Every string in the table reads as its After column, and `recentWork` and `.panel-heading` are gone.
- [x] A failure on pool or cards rejects the load; a failure or malformed figure on any enrichment resolves with that name in `missing` and its empty value.
- [x] A failed refresh after a ready state sets `stale`, and the next successful load clears it.
- [x] Right now, the Ledger header and the Contribute header show the stale line while stale.
- [x] LedgerSummary and DeployList show "Not available right now." for missing totals, events and deploys; the landing shows no launch line with `studio` missing; captions leave out the contributor count with `funding` missing.
- [x] `netlify.toml` sends the five headers and the report-only policy on `/*`, and `connect-src` names the `VITE_SUPABASE_URL` host over https and wss.
- [x] With the report-only policy enforced on a local preview built with the public values, loading every route raises no violation.
- [x] `live-check.mjs` checks the headers against a non-local address and skips them locally.
- [ ] Live: after deploy, `node platform/site/scripts/live-check.mjs` passes against https://peanutgallery.games, header lines included.

## Verification

- `pnpm --filter @backseat/site typecheck`
- `pnpm --filter @backseat/site test`
- `pnpm --filter @backseat/site build && pnpm --filter @backseat/site e2e`, with and without the Netlify public values exported.
- `node platform/site/scripts/live-check.mjs http://127.0.0.1:4173` against `vite preview`, with the public values; and with `--allow-no-data` on a build without them.
- The same live check through a local proxy on the LAN address that adds `netlify.toml`'s headers, and one that does not, to run the header branch.
- A Playwright load of every route on the preview with the report-only policy sent as an enforced `Content-Security-Policy`, listening for `securitypolicyviolation`.
- `pnpm verify`
- After merge: the live check against https://peanutgallery.games, and `curl -sI https://peanutgallery.games/ledger` shows the headers.

## Evidence

2026-09-16, branch `site-truth-pass`, not merged. The live check against production is pending the deploy.

- **Copy.** The grep in the first criterion printed nothing (exit 1). `Landing.test.tsx` renders `split`, every fixed rule, every step, and the Next game note from `copy.ts`; `e2e/landing.spec.ts` checks the new footer line in the built site. `App.test.tsx` renders `ledgerLede` on /ledger.
- **Partial failure.** `source.test.ts`:
  - "rejects with the database error message when the pool fails", "rejects when the cards fail", "rejects when a pool figure is malformed".
  - "keeps the pool and the cards and names {funding, spend, studio, totals, events, deploys, roles} as missing when {table} fails", seven cases, each checking the empty value.
  - "names an enrichment as missing when one of its figures is malformed", "names the card titles as missing when the title query fails", "lists several missing parts in a fixed order".
  - "reads the contract tables and views with the contract shapes" now also expects `missing` to be `[]`.
- **Stale.** `studio.test.tsx` "marks the kept snapshot stale after a failed refresh and clears it on the next successful load". `Landing.test.tsx` "keeps the figures and says they may be out of date when a refresh fails, until one succeeds". `Ledger.test.tsx` "says the figures may be out of date under the heading when a refresh fails". `Contribute.test.tsx` "says the figures may be out of date when a refresh fails".
- **Unavailable parts.** `Ledger.test.tsx` "says a part is unavailable instead of showing zero or an empty line when it did not load" and "shows the totals and the deploys when only the agent actions did not load". `Landing.test.tsx` "says nothing about launch when the studio row did not load". `Cards.test.tsx` "leaves the contributor count out of the caption when the funding figures did not load" and "leaves the contributor count out of a shipped row when the funding figures did not load".
- **Dead code.** `Landing.test.tsx` asserts the Right now panel holds no list, in place of the `recentWork` assertion.
- **Headers.** `src/netlify-headers.test.ts`: "sends the fixed headers on every path", "enforces only frame-ancestors", "reports the full policy without enforcing it", "lets the site reach its Supabase project over https and wss".
- **Report-only policy, enforced locally.** On `vite preview` of a build with the public values, every route, then the landing again:
  ```
  / h1=["Watch AI agents build a game studio and free games."] errors so far=0
  ... /contribute, /ledger, /terms, /privacy, /refunds, /contact, /board, /no-such-page, each errors so far=0
  available figure: $0.50
  funding bars with a width style: 3
  origins: ["http://127.0.0.1:4173","https://lyxndueoeisyqzewflpu.supabase.co","wss://lyxndueoeisyqzewflpu.supabase.co"]
  violations=0
  ```
  The /board QR code was not exercised: it needs a board sign-in.
- **Suites.**
  - `pnpm --filter @backseat/site typecheck` exit 0.
  - `pnpm --filter @backseat/site test`: `Test Files 15 passed (15)`, `Tests 149 passed (149)`, up from 14 files and 123 tests.
  - e2e with the public values: `11 passed (2.1s)`. Without them: `11 passed (2.2s)`.
  - `pnpm verify` exit 0: supabase 122, site 149, seed-1 77, dispatcher 207, gate `passed=157`, agents 64, ops 20 pass of 21 (1 skipped), Deno `58 passed (33 steps)`, `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=296`.
- **Live check.**
  - Build with the public values, `http://127.0.0.1:4173`: `PASS live-check http://127.0.0.1:4173 passed=94 failed=0 skipped=3`, including `SKIP security headers: a local preview does not send them`.
  - Build without them, `--allow-no-data`: `PASS live-check http://127.0.0.1:4173 passed=81 failed=0 skipped=8`. The same build with no flag: `FAIL live-check http://127.0.0.1:4173 passed=81 failed=3 skipped=5`, exit 1.
  - Through a proxy on `http://192.168.0.115:4175` adding the `netlify.toml` headers: `PASS live-check http://192.168.0.115:4175 passed=106 failed=0 skipped=2`, with `PASS / x-frame-options: DENY` through `PASS /ledger content-security-policy-report-only is sent`, twelve header lines, and no console errors with the report-only policy sent.
  - Through a proxy on port 4176 adding none: `FAIL live-check http://192.168.0.115:4176 passed=94 failed=12 skipped=2`, the twelve header lines.

## Decisions

- 2026-09-16: founder-billed agent work stays tracked and unpublished (board, settled). The copy says the ledger prices the agent turns paid for with contributions, rather than every dollar and token.
- 2026-09-16: the Next game chip stays, a `site-layout.md` board decision, and its note says only that no card funds a next game yet. No voting system exists. This supersedes the note in `site-layout.md`.
- 2026-09-16: "founding contributions" and the art policy's agent avatars stay (PLAN.md §6 and §4).
- 2026-09-16: the pool and the cards are the core of a load. Without them the landing has nothing true to show, so their failure still rejects; every other part degrades to "Not available right now." or is left out.
- 2026-09-16: a failed refresh keeps the figures and says so, instead of blanking them. A visitor sees the last known amounts, marked as possibly out of date.
- 2026-09-16: only `frame-ancestors` is enforced. The full policy runs report-only until production shows it raises nothing, because a wrong enforced policy would blank the site.
- 2026-09-16: `live-check.mjs` hardcodes the expected header values instead of reading `netlify.toml`, so a production run checks what is served against what was agreed.
