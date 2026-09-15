# Peanut mark and favicon

Status: agreed. Card: none. Owner: board.

## Problem

The site has no favicon and no mark; browser tabs and bookmarks show a blank page icon, and the top bar is type only.

## Scope

In: the peanut mark in the top bar, the favicon set, the source image.
Out: the seed game, social share images, the wordmark type.

## Behaviour

The top bar's wordmark link shows the black peanut mark before "Peanut Gallery". The mark is decorative, so the link's accessible name stays the studio name. Browsers show the peanut as the tab icon, and iOS uses it on the home screen. The source image lives in `platform/site/brand/peanut-source.png`; the files in `platform/site/public/` are generated from it with ImageMagick (trim, luminance to alpha, resize).

## Acceptance criteria

- [ ] `/favicon.ico`, `/favicon-32.png`, `/apple-touch-icon.png` and `/peanut.png` are served from the site root.
- [ ] `index.html` links the icon, the 32px PNG icon and the apple touch icon.
- [ ] The wordmark link contains `img.mark` with an empty alt and keeps the accessible name "Peanut Gallery".
- [ ] At 375px the top bar has no horizontal scroll.

## Verification

- `pnpm verify`
- After deploy: `curl -sI https://peanutgallery.games/favicon.ico` and `/peanut.png` answer 200 with an image content type.

## Decisions

- 2026-09-15: PNG and ICO generated from the supplied PNG rather than a traced SVG; no tracer is installed and a hand-drawn SVG would not be the supplied mark.
