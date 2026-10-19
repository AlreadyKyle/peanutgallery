# Page link previews

Status: built. Card: none (kernel work). Owner: board.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

Every route but `/card/*` previews as home. `index.html` is served at every path with home's title, description and `og:url`, and each page names itself only once its script runs (`PageHeader.tsx`), which a link preview reader never does. So a shared `/ledger`, the page every launch draft links, shows home's words and points at home. No page carries a canonical link, so a tagged address (`?from=reddit`) can be indexed as a page of its own.

## Scope

In: an edge function, `netlify/edge-functions/page-meta.ts`, on the fixed pages the sitemap lists (home, Contribute, Ledger, How it works, Team, Reports, Terms, Privacy, Refunds, Contact, Goals, Studio history, Ideas, Seeds, Questions), reading a fixed table in `netlify/lib/page-meta.ts`; a canonical link on those pages and on a card's page (`card-meta.ts`); a live-check line.
Out: a preview image per page (every page keeps `og.png`); the versioned legal pages (`/terms/n`, `/refunds/n`), a player's page, `/me`, `/thanks`, `/broadcast` and the design guide, which are not indexed or not shared; a canonical link in `index.html` itself; any change to what a page draws.

## Behaviour

- A request for a page in the table gets `index.html` with that page's title (`<page title> · Mob Machine`, as `PageHeader` sets it; home stays `Mob Machine`), its lede as `description` and `og:description`, `https://mobmachine.games<path>` as `og:url`, and one `<link rel="canonical">` to that address. Every other tag is left as it is. Values are HTML-escaped.
- The table is fixed: the function reads nothing at run time. Each entry is the page's own title and lede from `copy.ts`, `legal.ts`, `faq.ts` and the newest Terms version in `terms-versions.ts`; home's is `index.html`'s pitch.
- A query string does not change the tags: `/team?from=reddit` names `/team`.
- A path not in the table, an answer that is not a 200 HTML page, or an error in the function sends the page out as it was (`onError: bypass`).
- A card's page (`card-meta.ts`) also gets a canonical link to `/card/<id>`.
- `index.html` names no canonical address, since it is served at every path; a canonical there would name home as the address of every other route.

## Acceptance criteria

- [x] The table holds each page's title and lede as the page draws them, and its paths are exactly the kernel route list's indexed pages (`netlify/page-meta.test.ts`).
- [x] The edge function's paths are the table's keys, and it bypasses on error (`netlify/page-meta.test.ts`).
- [x] A page's tags name the page, its description and its address, HTML-escaped, with one canonical link, and leave the other tags alone; home's only change is its canonical link (`netlify/page-meta.test.ts`).
- [x] A path not in the table, a non-200 answer and a non-HTML answer pass through unchanged; a query string does not change the tags (`netlify/page-meta.test.ts`).
- [x] A card's page carries one canonical link to its own address, and `index.html` none (`netlify/page-meta.test.ts`).
- [ ] Production's `/ledger` and `/team`, as served, carry their own title, `og:url` and canonical link (the `live-check` workflow, `live-check.mjs`).

## Verification

- `npx vitest run netlify/ src/index-html.test.ts` in `platform/site`
- `deno check --no-config netlify/edge-functions/page-meta.ts netlify/edge-functions/card-meta.ts` in `platform/site`
- The handler, called directly, for `/ledger`, `/how-it-works`, `/team` and `/contribute`: the title, description, `og:url` and canonical it writes.
- `pnpm verify`
- After the deploy: the `live-check` workflow's first line `PASS ... failed=0`, with the `/ledger as served names itself` and `/team as served names itself` lines.

## Evidence

Quoted in the branch's report.

## Decisions

- 2026-10-19: the description is the page's own lede rather than new preview copy, so the preview says what the page says, and the table test fails the moment either moves.
- 2026-10-19: no canonical link in `index.html`. The review asked for one there for home, but the same file is served at every path the edge functions do not touch (a player's page, `/terms/2`, a missing page), which would all have named home as their address. Home gets its canonical link from this edge function instead, like every other page in the table.
- 2026-10-19: a fixed table and literal paths, as `card-meta.ts` keeps its studio name, rather than importing the site's copy modules into the edge bundle; the test reads those modules and keeps the two in step.
