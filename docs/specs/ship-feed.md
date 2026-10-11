# Ship feed

Status: draft. Card: none. Owner: board.

A spec is for a new feature or a change to the kernel, money, migrations or the gate; this one adds a Netlify Function and changes the site's frame (kernel files, platform/gate/kernel-paths.txt).

## Problem

The only ways to hear about a ship are watching the site or paying (the ship notice goes to supporters). A UX audit named this the retention gap: someone curious cannot follow the studio without money or an email. itch.io devlogs and Steam's update RSS show the expected answer, a public feed.

## Scope

In: `/feed.xml`, an Atom feed of every shipped card, served by a Netlify Function from the two public documents the site already reads; a `<link rel="alternate">` in the site's head; a footer link; unit tests, an e2e test and a live-check line.
Out: RSS 2.0 or JSON Feed variants, per-game feeds, full card bodies, images, a feed of anything other than ships, and any new database function or migration.

## Behaviour

1. `GET /feed.xml` answers `200` with `Content-Type: application/atom+xml; charset=utf-8`: an Atom 1.0 feed with an entry for each card at stage `live`, newest ship first, at most 50.
2. Each entry carries the card's title, its ship time (`live_at`, or `updated_at` for a row from before `live_at` existed, as the pages read it) as `published` and `updated`, a link and id of `https://mobmachine.games/card/<id>`, and a plain-text summary: the card's own public summary, then "The agents spent $X on it." from the live document's `spent_usd` (studio-billed spend, the figure the card pages show). Nothing else is read; no supporter, contribution or email field is in either document's use here.
3. The feed's `updated` is the newest ship, or the live document's `built_at` when nothing has shipped, so an empty feed is valid Atom with no entries.
4. Every title and summary is XML-escaped (`& < > " '`), and characters XML 1.0 forbids are dropped.
5. The function reads `site_live()` and `site_cards()` with the publishable key, as `snapshot.mts` does. The CDN keeps the feed 120 seconds and serves it stale 60 more while it rebuilds; browsers keep it 60 seconds. With `site_cards` itself rebuilt by the database's own schedule, a ship appears in the feed within a few minutes.
6. A query string answers `400`, any method but `GET` answers `405`, and a database error, timeout or malformed document answers `502`; all three are `no-store`. Legacy Free's two code-based rate-limit rules are held by `snapshot.mts` and `card.mts`, so the feed relies on the CDN window: at most one build per window reaches the database.
7. Every page's head carries `<link rel="alternate" type="application/atom+xml" href="/feed.xml">`, and the footer carries a visible "Follow every ship (RSS)" link to `/feed.xml`. Neither changes the Content Security Policy.

## Acceptance criteria

- [ ] `netlify/feed.test.ts`: titles and summaries with XML characters are escaped and the document is well formed; the feed is Atom with id, title, self link, author, updated and one entry per shipped card, newest first, each with id, title, link, updated and summary; an empty feed is valid; at most 50 entries; the function's headers, publishable key, 400/405/404/502 answers and path.
- [ ] `src/index-html.test.ts` finds the alternate link in `index.html`.
- [ ] `e2e/feed.spec.ts`: at every width, on three routes, the head names `/feed.xml` once and the footer link is visible with that address, with no policy report; `e2e/csp.spec.ts` still passes.
- [ ] `scripts/live-check.mjs` checks `/feed.xml` answers 200 with `application/atom+xml` and an Atom root.

## Verification

- `pnpm --filter @backseat/site exec vitest run netlify/feed.test.ts src/index-html.test.ts`
- `E2E_PORT=4470 npx playwright test e2e/feed.spec.ts e2e/csp.spec.ts` in `platform/site`
- `pnpm verify`
- After merge and deploy: the `live-check` workflow's Live check step reads `PASS ... failed=0` and lists `/feed.xml 200 application/atom+xml`.
