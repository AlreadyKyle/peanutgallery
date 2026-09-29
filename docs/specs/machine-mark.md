# The machine mark and the icons

Status: done. Card: none. Owner: board.

Replaces the peanut of `specs/site-mark.md`, as part of the rename to Mob Machine (`specs/rename.md`, PLAN.md §10 decision 43). This is a board pull request: the top bar, the mark component, `index.html`'s icons and the site's scripts are kernel.

## Problem

The studio is now Mob Machine, and the peanut does not survive the name. The peanut was also a traced PNG that the top bar, the Guide and the link preview had to turn white with an invert filter on the black top bar, and it was the one motif on the site that was neither a card, a coin nor one of the code-drawn cast.

## Scope

In: the mark (`platform/site/brand/mark.svg`); the top bar and the Guide's specimen drawing it inline in the text colour; the tab icons and the home-screen icons, drawn from it by a script; the link preview; the live check's asset list. Deleted: `public/peanut.png`, `brand/peanut-source.png`, the `--mark-filter` role and the invert rules.

Out: the game's tab icon, `seed-1/render/favicon.svg`, which is the game's own pile of dust and never was the peanut. The board's own site, which has no icons. A `favicon.svg` (the `.ico` and the PNG cover every browser, so none is added). Uploading the icon to Discord and Stripe, which are the board's steps (`BOARD-SETUP.md`, Rename to Mob Machine).

## Behaviour

The mark is a small machine drawn in code on a 32-unit grid: a rounded cabinet, a screen with two pixel eyes, a coin slot under the screen and two short feet. It is one even-odd path filled with `currentColor`, and every straight edge sits on an even unit, so each lands on a whole pixel when a unit is a whole number of pixels (the top bar at 1x and 2x, the 32px tab icon, the home-screen icons) and at 16px, where a unit is half a pixel. At other sizes it does not: at 24px a unit is 0.75px and every edge on 2, 6, 10, 14, 18 or 22 falls on a half pixel. Only the round corners are anti-aliased. Its box is its ink, `viewBox="4 2 24 30"`: x 4 to 28 and y 2 to 32 of the grid. `platform/site/brand/mark.svg` is the source; `src/components/Mark.tsx` (kernel, since the top bar draws it) carries the same path, and a unit test holds the two equal, path and box.

- **The top bar.** The home link shows the mark before the wordmark, inline, decorative (`aria-hidden`), 24 by 30px, one pixel a unit (two at 2x), which `styles.test.ts` holds against the box in `brand/mark.svg`; the link's name stays "Mob Machine", and below 32rem the mark stands for the wordmark. It takes the text colour: paper on the black top bar and the ink bands, ink on paper, CanvasText under forced colours. Nothing filters it.
- **The Guide.** Its mark specimen is the same component, with the note "The mark is a small machine drawn in the text colour: ink on paper, paper on signal and ink."
- **The icons.** `node platform/site/scripts/icons.mjs` draws them from `brand/mark.svg` with Chromium, a whole number of pixels to a unit: `favicon.ico` (16 and 32, PNG entries) and `favicon-32.png`, the mark in ink #111111 with a paper plate under its screen and slot and nothing around it, so it reads as a tile on a light or a dark tab strip; `apple-touch-icon.png` (180, 4px a unit) and `icon-512.png` (512, 11px a unit), the mark in paper on #111111, centred, with its corners inside the inscribed circle so a round crop keeps it whole. `index.html` links the same three files as before.
- **The link preview.** `scripts/og-image.mjs` draws the wordmark with the mark read from `brand/mark.svg`, in the text colour, as the top bar draws it.
- **The live check** fetches the four icon files and checks that the top bar's "Mob Machine" link goes home and draws the mark.

## Acceptance criteria

- [x] The top bar's link named "Mob Machine" goes to / and holds `svg.mark` with `aria-hidden="true"` and one path filled `currentColor` whose `d` is the one in `brand/mark.svg` (`App.test.tsx`).
- [x] The top bar's mark at 1x has partial pixels only at its round corners, and the 60px row still fits at 320, 360 and 390px (Evidence).
- [x] No invert filter and no `--mark-filter` is left in `tokens.css`, `styles.css`, `og-image.mjs` or `DESIGN.md` (`styles.test.ts`; `git grep mark-filter` finds only specs).
- [x] `public/peanut.png` and `brand/peanut-source.png` are deleted; `favicon.ico` holds 16 and 32, `favicon-32.png` is 32×32, `apple-touch-icon.png` 180×180 and `icon-512.png` 512×512.
- [x] `icons.mjs` and `og-image.mjs` run twice write the same bytes.
- [x] `og.png` shows "MOB MACHINE" with the mark; the top bar at 390px and 1440px shows the mark in paper on black; the favicons read at 16px on a light and a dark strip (looked at, Evidence).
- [x] The site's e2e suite passes.
- [x] After the deploy, the live check passes with `/favicon.ico`, `/favicon-32.png`, `/apple-touch-icon.png` and `/icon-512.png` at 200 and the top bar's mark line.

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
- The top bar at 1x, after review (23 September 2026). Built with the e2e fixture values and served on 4493 (before) and 4494 (after); the mark's 24×24 pixels (before) and 24×30 (after) counted at 1440px, a pixel "partial" when it is neither the bar's ink nor paper. Before, 1.5rem square: 94 of 326 lit pixels partial at 1x, the eyes, the cabinet's top edge, the slot and the feet ringed in grey. After, the ink box at one pixel a unit: 52 of 516 at 1x and 117 of 2016 at 2x, and a dump of the 1x pixels shows every partial one at a round corner. The Guide's specimen, at y 434.5 in that build, counts the same 52: Chromium snaps an SVG root's box to whole pixels (a probe of the mark at 24px moved by half a pixel down or right counted the same 94 as unmoved). The top bar's row is 60px at 320, 360, 390, 768, 1024 and 1440, the name starts at x 176 at 1440 as before, and `og.png` was drawn again (`icons.mjs` wrote the same bytes; both scripts run twice, `shasum -c` OK for the five files).
- With that change: `pnpm verify` exit 0 (site 429 tests, among them the new one-pixel-a-unit check, which fails on the old 1.5rem square box); `E2E_PORT=4490 pnpm --filter @backseat/site e2e` "148 passed (3.1m)", 5 skipped, among them "keeps the top bar to one 61px row at 360px, Play shown" and at 375 and 390px, which a 2rem square box would fail; `node scripts/rename.mjs --check` "tier 1 carries the old name nowhere".

After the deploy (close-out, 26 September 2026). The rename merged as 5f40ab5 (#79) and was live on the three sites that night (`specs/rename.md`). On `origin/main` at ed63326, with production's `version.json` serving that sha, `set -a; . ./.env; set +a; node platform/site/scripts/live-check.mjs` exits 0:

```
PASS live-check https://peanutgallery.games passed=279 failed=0 skipped=0
PASS home title is "Mob Machine"
PASS the top bar's "Mob Machine" link goes home and draws the mark (1 path)
PASS /favicon.ico 200
PASS /favicon-32.png 200
PASS /apple-touch-icon.png 200
PASS /icon-512.png 200
PASS /og.png 200 image/png 1200x630
PASS index og:title "Mob Machine"
PASS index og:site_name "Mob Machine"
```

Every Verification line is run and quoted. Status done.

## Decisions

- 2026-09-23: The mark is a small machine with eyes, a coin slot and feet. It names the machine, carries the coin motif, and reads as one of the cast: it has no reels, no lever and no jackpot window, so it is not a slot machine or any other gambling cue. The public note calls it "a small machine" and does not say "slot". It was picked from three drawn directions (a crowd with a gear, a machine face, a monogram), each rendered at 16, 24 and 28px on paper and ink at 1x and 2x.
- 2026-09-23: Inline SVG in `currentColor` in place of a PNG with an invert filter, so one drawing serves every ground and forced colours with no role token. It lives in its own kernel component so the Guide can draw it without importing the kernel's `App.tsx`.
- 2026-09-23: The icons are drawn by a script from the SVG, as `og-image.mjs` draws the preview, so the source and the files cannot drift apart by hand. The `.ico` holds PNG entries, which every current browser reads, so no ImageMagick step is needed.
- 2026-09-23, after review: the top bar draws the mark at one pixel a unit with its box cropped to its ink (24 by 30px), not 1.5rem square. At 24px square a unit is 0.75px and a desktop monitor at 1x drew it soft beside crisp type. A 2rem square box fixed that but wrapped the top bar's row at 360px (112px tall); the cropped box is 24px wide, as before, so the row fits and the name does not move. Redrawing on a 4-unit grid (so 24px would be whole) was tried at 7×8 and 8×8 cells and dropped: on eight cells the screen fills the face, the slot shrinks to a dot or a bar, and both trials read as a television or a bus.
- 2026-09-23: `icon-512.png` stays although no page links it: it is the file the board uploads as the Discord server icon and the Stripe icon.
