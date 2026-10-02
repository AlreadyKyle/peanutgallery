# robots.txt and sitemap.xml

Status: done. Card: none. Owner: board.

## Problem

`https://mobmachine.games/robots.txt` and `/sitemap.xml` answered 200 with the page's HTML: neither file
existed, so the site's catch-all rewrite served `index.html` at both. Crawlers got no sitemap, and
Search Console (BOARD-SETUP step 6) has none to submit.

## Scope

In: a static `platform/site/public/robots.txt` and `platform/site/public/sitemap.xml`, and a unit test
that keeps the sitemap in step with the kernel route list (`platform/site/e2e/routes.ts`).
Out: real 404 statuses for unknown paths (the not-found page still answers 200; only `/board` sends
404), per-card pages in the sitemap, and Search Console itself, which is the board's step 6.

## Behaviour

`/robots.txt` allows every crawler everywhere and names the sitemap. `/sitemap.xml` lists the public
pages: home, Contribute, Ledger, How it works, Team, Roadmap, Reports, Terms, Privacy, Refunds and
Contact, on `https://mobmachine.games`. Neither file names the unlisted design guide, which keeps its
`noindex` header.

## Acceptance criteria

- [x] `public/robots.txt` allows all crawling, has no Disallow line and names the sitemap.
- [x] `public/sitemap.xml` lists exactly the kernel route list's pages less the versioned legal pages,
      the not-found page and the design guide, so a new page fails the test until it is listed.
- [x] Neither file names the design guide's path.
- [x] Production serves both files as text and XML, not the page's HTML.

## Verification

- `npx vitest run src/crawl-files.test.ts` in `platform/site`
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
