# robots.txt and sitemap.xml

Status: built. Card: none. Owner: board. Amended 2026-10-19: the sitemap is served by a function and lists the card pages (marketing review m5).

## Problem

`https://mobmachine.games/robots.txt` and `/sitemap.xml` answered 200 with the page's HTML: neither file
existed, so the site's catch-all rewrite served `index.html` at both. Crawlers got no sitemap, and
Search Console (BOARD-SETUP step 6) has none to submit.

## Scope

In: a static `platform/site/public/robots.txt`; `/sitemap.xml` served by `platform/site/netlify/functions/sitemap.mts` (`netlify/lib/sitemap.ts`), which replaced the static `public/sitemap.xml`; unit tests that keep its fixed pages in step with the kernel route list (`platform/site/e2e/routes.ts`) and the page-meta table (`docs/specs/page-previews.md`).
Out: real 404 statuses for unknown paths (the not-found page still answers 200; only `/board` sends
404), a lastmod for the fixed pages, planned and held-back cards, and Search Console itself, which is the board's step 6.

## Behaviour

`/robots.txt` allows every crawler everywhere and names the sitemap. `/sitemap.xml` lists the public
pages: home, Contribute, Ledger, How it works, Team, Reports, Terms, Privacy, Refunds, Contact, Goals,
Studio history, Ideas, Seeds and Questions, on `https://mobmachine.games`, the paths the page-meta edge
function names. After them it lists each card's page (`/card/<id>`): every live card, newest ship
first, with its ship time as `lastmod`, then every card on horizon now (open for funding, funded,
building or in the gate) that the board has not held back, newest first, with when it was drafted as
`lastmod`. The function reads `site_live()` and `site_cards()` with the publishable key, as the feed
does; the CDN keeps the answer an hour and serves it stale ten minutes more. A query string answers 400
and any method but GET 405, before any read. When the database does not answer, the fixed pages still
go out with a 200, never cached. Neither robots.txt nor the sitemap names the unlisted design guide,
which keeps its `noindex` header.

## Acceptance criteria

- [x] `public/robots.txt` allows all crawling, has no Disallow line and names the sitemap.
- [x] ~~`public/sitemap.xml` lists exactly the kernel route list's pages less the versioned legal pages,
      the not-found page and the design guide, so a new page fails the test until it is listed.~~ Replaced by the served sitemap below.
- [x] The served sitemap's fixed pages are exactly the kernel route list's pages less the versioned legal pages, the not-found page, the design guide, a player's pages and the overlay, in order, and `public/sitemap.xml` is gone (`src/crawl-files.test.ts`, `netlify/sitemap.test.ts`).
- [x] It lists every live card by ship time with that `lastmod`, then every card on horizon now by when it was drafted, and leaves out planned, held-back, paused and rejected cards (`netlify/sitemap.test.ts`).
- [x] It reads `site_live` and `site_cards` with the publishable key, is cached an hour on the CDN, refuses a query string and a POST before any read, and still lists the fixed pages, never cached, when the database fails (`netlify/sitemap.test.ts`).
- [ ] Production's `/sitemap.xml` is XML from the function and lists every live card shipped over 70 minutes earlier with its `lastmod` (the `live-check` workflow, `live-check.mjs`).
- [x] Neither file names the design guide's path.
- [x] Production serves both files as text and XML, not the page's HTML.

## Verification

- `npx vitest run src/crawl-files.test.ts netlify/sitemap.test.ts` in `platform/site`
- `pnpm verify`
- After the deploy: `curl -sI https://mobmachine.games/robots.txt` and `/sitemap.xml` show
  `content-type: text/plain` and an XML type.

## Evidence

- `src/crawl-files.test.ts`: 3 passed (criteria 1 to 3).
- `pnpm verify` exit 0 (site 529, dispatcher 872); Actions gate run 37026284476 success on head 950ecb2.
- Live at build 9811871: `/robots.txt` `content-type: text/plain; charset=UTF-8`, `/sitemap.xml`
  `content-type: application/xml`; `PASS live-check https://mobmachine.games passed=281 failed=0 skipped=0`.

## Decisions

- 2026-10-02: the sitemap is static and checked against `e2e/routes.ts` rather than generated at build
  time. Eleven fixed pages do not need a build step, and the test fails the moment the list drifts.
- 2026-10-19: the sitemap is served by a function (`sitemap.mts`, shaped like `feed.mts`) so it can list the card pages with a `lastmod`, which the static file could not (marketing review m5). The fixed pages come from the page-meta table, so the sitemap and the link previews name the same pages. A database failure still answers the fixed pages, uncached, rather than a 502, so a crawler never loses the pages it had.
