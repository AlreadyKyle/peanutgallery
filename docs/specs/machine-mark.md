# The machine mark and the icons

Status: built. Card: none. Owner: board.

Replaces the peanut of `specs/site-mark.md`, as part of the rename to Mob Machine (`specs/rename.md`, PLAN.md §10 decision 43). This is a board pull request: the top bar, the mark component, `index.html`'s icons and the site's scripts are kernel.

## Problem

The studio is now Mob Machine, and the peanut does not survive the name. The peanut was also a traced PNG that the top bar, the Guide and the link preview had to turn white with an invert filter on the black top bar, and it was the one motif on the site that was neither a card, a coin nor one of the code-drawn cast.

## Scope

In: the mark (`platform/site/brand/mark.svg`); the top bar and the Guide's specimen drawing it inline in the text colour; the tab icons and the home-screen icons, drawn from it by a script; the link preview; the live check's asset list. Deleted: `public/peanut.png`, `brand/peanut-source.png`, the `--mark-filter` role and the invert rules.

Out: the game's tab icon, `seed-1/render/favicon.svg`, which is the game's own pile of dust and never was the peanut. The board's own site, which has no icons. A `favicon.svg` (the `.ico` and the PNG cover every browser, so none is added). Uploading the icon to Discord and Stripe, which are the board's steps (`docs/BOARD-SETUP.md`, Rename to Mob Machine).

## Behaviour

The mark is a small machine drawn in code on a 32-unit grid: a rounded cabinet, a screen with two pixel eyes, a coin slot under the screen and two short feet. It is one even-odd path filled with `currentColor`, and every edge sits on an even unit, so at 16px each edge lands on a whole pixel. `platform/site/brand/mark.svg` is the source; `src/components/Mark.tsx` (kernel, since the top bar draws it) carries the same path, and a unit test holds the two equal.

- **The top bar.** The home link shows the mark before the wordmark, inline, decorative (`aria-hidden`), 1.5rem square; the link's name stays "Mob Machine", and below 32rem the mark stands for the wordmark. It takes the text colour: paper on the black top bar and the ink bands, ink on paper, CanvasText under forced colours. Nothing filters it.
- **The Guide.** Its mark specimen is the same component, with the note "The mark is a small machine drawn in the text colour: ink on paper, paper on signal and ink."
- **The icons.** `node platform/site/scripts/icons.mjs` draws them from `brand/mark.svg` with Chromium, a whole number of pixels to a unit: `favicon.ico` (16 and 32, PNG entries) and `favicon-32.png`, the mark in ink #111111 with a paper plate under its screen and slot and nothing around it, so it reads as a tile on a light or a dark tab strip; `apple-touch-icon.png` (180, 4px a unit) and `icon-512.png` (512, 11px a unit), the mark in paper on #111111, centred, with its corners inside the inscribed circle so a round crop keeps it whole. `index.html` links the same three files as before.
- **The link preview.** `scripts/og-image.mjs` draws the wordmark with the mark read from `brand/mark.svg`, in the text colour, as the top bar draws it.
- **The live check** fetches the four icon files and checks that the top bar's "Mob Machine" link goes home and draws the mark.

## Acceptance criteria

- [x] The top bar's link named "Mob Machine" goes to / and holds `svg.mark` with `aria-hidden="true"` and one path filled `currentColor` whose `d` is the one in `brand/mark.svg` (`App.test.tsx`).
- [x] No invert filter and no `--mark-filter` is left in `tokens.css`, `styles.css`, `og-image.mjs` or `DESIGN.md` (`styles.test.ts`; `git grep mark-filter` finds only specs).
- [x] `public/peanut.png` and `brand/peanut-source.png` are deleted; `favicon.ico` holds 16 and 32, `favicon-32.png` is 32×32, `apple-touch-icon.png` 180×180 and `icon-512.png` 512×512.
- [x] `icons.mjs` and `og-image.mjs` run twice write the same bytes.
- [x] `og.png` shows "MOB MACHINE" with the mark; the top bar at 390px and 1440px shows the mark in paper on black; the favicons read at 16px on a light and a dark strip (looked at, Evidence).
- [x] The site's e2e suite passes.
- [ ] After the deploy, the live check passes with `/favicon.ico`, `/favicon-32.png`, `/apple-touch-icon.png` and `/icon-512.png` at 200 and the top bar's mark line.

## Verification

- `pnpm verify`
- `pnpm --filter @backseat/site e2e`
- `node platform/site/scripts/icons.mjs && node platform/site/scripts/og-image.mjs`, twice, with the same `shasum` of the five files after each run
- `magick identify platform/site/public/favicon.ico platform/site/public/favicon-32.png platform/site/public/apple-touch-icon.png platform/site/public/icon-512.png`
- After the deploy: `node platform/site/scripts/live-check.mjs`

## Evidence

23 September 2026, branch `launch/rename-mob-machine`:

- `App.test.tsx` checks the top bar's "Mob Machine" link: `svg.mark`, `aria-hidden="true"`, one path filled `currentColor`, its `d` found in `brand/mark.svg`. `styles.test.ts` no longer expects `--mark-filter`; `git grep mark-filter` finds it only under `docs/specs/`. Both in `pnpm verify`, exit 0 (`specs/rename.md`, Evidence).
- `magick identify` on the files: `favicon.ico[0] PNG 16x16`, `favicon.ico[1] PNG 32x32`, `favicon-32.png PNG 32x32`, `apple-touch-icon.png PNG 180x180`, `icon-512.png PNG 512x512`, `og.png PNG 1200x630`.
- `icons.mjs` then `og-image.mjs`, run a second time: `shasum -c` of the five files printed OK for each.
- Looked at: `og.png` (MOB MACHINE with the white machine on black, the pitch, peanutgallery.games); the favicon at 16px magnified on #dee1e6 and #202124 strips and at 32px on #202124 (a tile on both); `apple-touch-icon.png` and `icon-512.png` (the white machine centred on black); the top bar at 390 and 1440 and the Guide's specimen on its ink band.
- `E2E_PORT=4491 pnpm --filter @backseat/site e2e` at 3a845bb: "148 passed (3.3m)"; the 5 skipped are the screenshot specs, which run only when asked. Passed among the 148: "at 375 px › the top bar carries the mark, Play, Contribute and the page links" and the same at 1440 px, and axe WCAG 2.2 AA "finds no violation on the guide and every page" at 375px and 1440px.

## Decisions

- 2026-09-23: The mark is a small machine with eyes, a coin slot and feet. It names the machine, carries the coin motif, and reads as one of the cast: it has no reels, no lever and no jackpot window, so it is not a slot machine or any other gambling cue. The public note calls it "a small machine" and does not say "slot". It was picked from three drawn directions (a crowd with a gear, a machine face, a monogram), each rendered at 16, 24 and 28px on paper and ink at 1x and 2x.
- 2026-09-23: Inline SVG in `currentColor` in place of a PNG with an invert filter, so one drawing serves every ground and forced colours with no role token. It lives in its own kernel component so the Guide can draw it without importing the kernel's `App.tsx`.
- 2026-09-23: The icons are drawn by a script from the SVG, as `og-image.mjs` draws the preview, so the source and the files cannot drift apart by hand. The `.ico` holds PNG entries, which every current browser reads, so no ImageMagick step is needed.
- 2026-09-23: `icon-512.png` stays although no page links it: it is the file the board uploads as the Discord server icon and the Stripe icon.
