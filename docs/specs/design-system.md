# Design system v1: tokens, the card, the coin, bands and the guide

Status: built. Card: none. Owner: board.

The design-system pull request of the approved v1 design direction (the board's review of 23 September 2026). The direction is the contract: a quiet, precise table where real cards are funded with arcade coins and built by a cast of code-drawn aliens, on a white page whose full-bleed bands rotate black and white. This is a board pull request: it changes kernel files, listed under Scope. Its mockup is the unlisted design guide; the home-and-design pull request that follows applies the bands to every page and rebuilds home.

## Problem

The site draws everything with the system font, grey boxes and a black bar, so a card, a panel and a choice all look alike and nothing says "this is the thing you fund". There is no token for money, no card states beyond a text badge, no glyphs, no rule for motion, and the direction's tested rules (contrast on two grounds, bands, the coin, reduced motion) have no code or tests yet. The 'next' category names a game that no card funds.

## Scope

In:
- **Tokens** move to `platform/site/src/tokens.css` (light only), with every §2 token: `--work`, `--coin`, `--coin-down`, `--paper-hover`, `--muted-on-ink`, `--line-on-ink` new; `--field` `#7d7d7d` and `--line` `#d6d6d6`; `--accent`, `--track`, `--radius-box` retired; `--band-pad`, `--rail`, `--radius-card`, `--radius-tile`; the motion tokens; and role tokens that an ink band resets. `styles.css` imports it first.
- **The font:** Atkinson Hyperlegible Next, `public/fonts/atkinson-hyperlegible-next-400-700.woff2` (18,208 bytes) with `public/fonts/OFL.txt`, the variable source in `brand/fonts/`, `scripts/fonts.sh` (the subset, with the layout features pinned), `scripts/font-metrics.py` (the fallback metrics, computed with fontTools), `@font-face` with `font-display: swap`, and one preload in `index.html`. The type scale is unchanged; card titles move to 20px, 700.
- **Bands:** `.band`, the positional colouring (`main > .band:nth-child(odd|even)`, the top bar on the first band, the footer the opposite of the last), the on-ink role resets, the order trap for Contribute, the avatar's paper disc, the peanut's invert, and the forced-colours band rule.
- **Components:** `Glyph.tsx` (suits, the eight state glyphs, check, arrows), `Card.tsx` (`CardFace`: the index row, title, summary, bottom block, eight faces, three modes), the coin mark and the funding bar and spec rows (in `Funding.tsx`, kernel), `LiveUpdates.tsx` (the live-updates row and the one polite announcer), `lib/changes.ts` (snapshot diffs and the height rule), `lib/motion.ts` (the fund tick, flip, deal and slam, with reduced motion as end states), `lib/contrast.ts`, the Avatar's asleep pose, and filter chips with the suit glyph and the pressed check.
- **Wiring, without restructuring layouts:** the new card replaces the card box on home (Building now and Fund what's next) and on `/how-it-works`; the roadmap's groups and home's shipped rows carry the suit glyph; `/team` rows become `li.agent` with the asleep pose; `'next'` leaves `CardCategory`, `CATEGORY_FILTERS` and `copy.categories`.
- **The design guide** at the unlisted `/design-kit-7q4m` (`src/pages/Guide.tsx`, `routes.tsx`), not indexed.
- **Docs:** `platform/site/DESIGN.md` rewritten as the source of truth; `docs/COPY.md` gains the voice rules; this spec and its ROADMAP row.
- **Kernel files changed** (a board pull request): `platform/site/src/components/Funding.tsx` (the bar, spec rows, coin mark, card modes), `lib/legal.ts` (the spec-row labels and the not-built money line), `lib/payment.ts` (the two categories), `index.html` (the preload), `package.json` and `pnpm-lock.yaml` (`@axe-core/playwright`, a free dev dependency), and `scripts/` (`fonts.sh`, `font-metrics.py`, `og-image.mjs` reading `tokens.css`, `live-check.mjs` reading `li.agent`).

Out, and what each waits on:
- The top bar and Menu, bands on every public page, home in the board's order, the status line on home, the live-updates row wired to the real snapshot, the `/contribute` block, rail rows, the replay links, the audited fixes and the copy pass, and `og.png` re-rendered with the font: the home-and-design pull request.
- The `/card/:id` replay route, and with it "Watch how it's built" on building cards and "Watch how it was built" on shipped rows: the supporter-loop work.
- Naming the next card in line and the operations share in `/contribute`'s sentence: money-logic confirming that step 3 of the waterfall uses `cards.rank`, or adding a public read.
- The gate's design frames at 375, 768 and 1440 with reduced motion: the agent-system work that adds the gate's frame renderer.
- Holding live figure changes behind "Show *n* updates" on the real pages: `changes.ts` and `LiveUpdates.tsx` are built and tested, and the snapshot split between what is on screen and what has arrived lands with home.
- Paused and rejected faces on public pages: an anon read that lists them with a public reason (backlog).
- Dark mode, card backs, the hero spread, the traced SVG peanut and the other §6 backlog cards.
- `/board` is out of scope.

## Behaviour

- Every page sets in Atkinson Hyperlegible Next from the site's own origin, with Arial scaled to the same room while it loads. Nothing is italic; only the wordmark is uppercase.
- A card is a white face with a 2px ink edge and 1rem corners. Its corner index names the suit (Dust with a cartridge, or The studio with a browser window) and the state (a word and a glyph). Building and Being checked use the pale work face. Money shows as a coin-filled bar ending in an ink rule, then "Funded $x of $y" and "Contributors n" rows, then Fund this card. A funded card says "Waiting for the agents" in the button slot. A building card names the agent building it, when the roles loaded, and what it has spent.
- `/team` draws each agent as a plain row; while the agents are paused, every avatar's eyes are closed.
- The guide at `/design-kit-7q4m` shows every part on ink and on paper, measures each token pair on the page, and plays the deal, the fund tick, the flip and the slam on sample cards. Everything made up for it is labelled Sample. Nothing links to it and it asks not to be indexed.
- Under reduced motion nothing animates: each moment shows its end state at once.

## Acceptance criteria

- [x] `tokens.css` holds every colour, only in `:root`, and the direction's contrast set holds on paper, work, coin and ink.
- [x] The font file is at most 18,208 bytes, keeps `tnum` in its GSUB, loads same-origin with swap and a preload, and has computed fallback metrics.
- [x] Band colour comes only from the positional rules; the focus ring on ink is 3px paper at 2px; the change marker and the pressed border are `currentColor`; Contribute stays ink on coin in an ink band.
- [x] Every transition lives inside `prefers-reduced-motion: no-preference`, takes its duration from a token, moves only transform and opacity, and never runs forever.
- [x] Each of the two folders has a suit with a label and no shared glyph; each of the eight faces renders its word and a unique glyph.
- [x] The Avatar draws closed eyes when asleep; `/team` passes asleep only while the studio row loaded and says paused.
- [x] `changes.ts` finds nothing on first load, plays nothing in a hidden tab, plays at most three per poll, holds arrivals, departures and reorders, and holds a text change that would change its box's height.
- [x] Copy: coins are never a currency, no chance words beside money, money out uses U+2212, and every character is inside the font subset.
- [x] The guide: unlisted, not indexed, three bands, every card in band 2, all eight faces labelled Sample, the bar at 5, 50 and 100%, no Payment Link, and Play buttons for the four moments.
- [x] No horizontal scroll at 320, 360, 375, 390, 768, 1024 and 1440px on every route and at 375px with 200% text; axe WCAG 2.2 AA finds nothing at 375 and 1440 on every route and inside each ink band of the guide; `getAnimations()` stays empty under reduced motion and on first load and a route change with motion allowed.
- [x] Budgets: fonts at most 18,208 bytes, new JavaScript at most 12KB gzipped, CSS growth at most 6KB gzipped.

## Verification

- `pnpm verify` at the repository root, with `platform/site/dist-e2e` and `platform/board/dist-e2e` deleted first.
- `E2E_PORT=4391 pnpm --filter @backseat/site e2e`
- The budgets: a production build of the site before and after, each asset gzipped at level 9, and the font file's size.
- Screenshots of the guide and home at 375 and 1440px (`E2E_SCREENSHOTS=<folder>`), looked at.

## Evidence

- `pnpm verify` exited 0 on the branch: site `Test Files  29 passed (29)`, `Tests  277 passed (277)`; board `Tests  67 passed (67)`; supabase `Tests  267 passed (267)`; dispatcher `Tests  619 passed (619)`; seed-1 `Tests  77 passed (77)`; `PASS: gate tests passed=499`; `GATE PASS folder=seed-1 lane=code`; `GATE PASS folder=platform lane=code`; `PASS: secret-scan files=516`; docs and rename tests `fail 0`.
- `E2E_PORT=4391 pnpm --filter @backseat/site e2e`: `61 passed (1.8m)` with `E2E_SCREENSHOTS` set (59 passed and the 2 screenshot tests skipped without it). The design suite (`e2e/design.spec.ts`) covers the guide at seven widths, the bands and their order, no card on ink, the change marker on both grounds, Contribute on ink, the pressed Pause on ink, the updates row keeping place and focus, the focus ring on ink, same-origin fonts, the forced-colours band rule, reduced motion across the four demos, first load and a route change, the flip in place, every route at seven widths and at 200% text, and axe at 375 and 1440 and inside each ink band.
- Contrast, measured on the guide from the built stylesheet: paper on ink 18.88, `--muted-on-ink` on ink 7.49 and on `--ink-hover` 5.01, paper on `--ink-hover` 12.63, `--field` on ink 4.59, as the direction measured.
- Budgets, against `main` at 279b3a1 built the same way: CSS 3,184 to 5,131 bytes gzipped (+1,947, within 6KB); JavaScript 152,502 to 161,024 bytes gzipped (+8,522, within 12KB); the font 18,208 bytes. `scripts/fonts.sh` rebuilds the file with the same tables and sizes decompressed; with this machine's brotli the woff2 comes out at 18,104 bytes, and the committed file is the measured 18,208-byte one.
- Screenshots of the guide and home at 375 and 1440px were taken and looked at; they are not committed.

## Decisions

- 2026-09-23: The board moved this pull request ahead of legal-copy, money-logic, agent-system and supporter-loop, so the pages those change are built on the design system.
- 2026-09-23: The coin mark lives in `Funding.tsx` (kernel), beside the funding bar, because it marks money and appears on kernel surfaces (Contribute in the top bar, the pool figure). Glyphs stay in the card lane.
- 2026-09-23: The paused notice's pause glyph is drawn in CSS (two bars in `currentColor`), because `PausedNotice.tsx` is kernel and may not import the card-lane `Glyph.tsx`.
- 2026-09-23: The guide's cards run in a sample mode: their buttons are drawn and `aria-disabled`, and never carry the Payment Link, so a sample card can never take a payment.
- 2026-09-23: The guide's route is `/design-kit-7q4m`, a plain path the kernel frame accepts, with no top bar link and a `noindex, nofollow` meta tag while open.
- 2026-09-23: Spec rows and event rows keep a constant 0.5rem inset so the change marker (an inset 3px line) never covers text and still takes no layout.
- 2026-09-23: The wordmark may wrap inside the top bar, so 200% text never scrolls sideways before the new top bar lands.
