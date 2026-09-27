# Free games on home, no updates row, a looping video preview

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

The board's call for the video (decision 57) was free games and no Dust, but home's heading, footer, button and chips still named Dust. Under the video sat a length line and a "Read the video as text" disclosure the board does not want. Home's "Pause updates" and "Up to date" / "Show n updates" row read as clutter with no use to a visitor. The video's poster was a still image.

## Scope

In: the pitch everywhere it appears (home, `index.html` previews, `og.png`, PLAN §2, the launch drafts); home's footer, Play button, fund intro and the game suit's chip and note; the video's caption; the live-updates row and everything only it used; a muted preview loop on the video's poster.
Out: the game's own page and name, card titles in the database, the rendered video itself.

## Behaviour

Home's heading reads "Watch AI agents build a game studio and free games." Home names no game: the footer reads "AI agents build free games you can play in a browser.", the hero button "Play free", the game chip "The games". Nothing sits under the video. There is no updates row: each new snapshot draws as it arrives, with the fund tick, flip and deal where they apply, and funded and shipped are still announced once. Until pressed, the video's poster plays a muted 8-second loop of the Pick a card scene (about 130 KB per cut); under reduced motion it stays a still. Pressing it plays the full video with sound, as before.

## Acceptance criteria

- [x] The pitch is the free-games line in `copy.ts`, `index.html` and `og.png`, and home's own copy names no Dust (`copy.test.ts` "pitches free games and names no game on home").
- [x] No length line or transcript disclosure is drawn under the video (`ExplainerVideo.test.tsx`; `legal.explainer` has no `length` or `transcript`).
- [x] Home draws no Pause or updates button (`e2e/landing.spec.ts`); `LiveUpdates.tsx` and its strings are gone.
- [x] The poster plays the muted loop and shows the still under reduced motion (checked in Chromium at 1440 and 375 px and with `reducedMotion: 'reduce'`).

## Verification

- `pnpm verify`
- `scripts/local-gate.sh <pr>` PASS on the PR head.
- After deploy: home at 375 and 1440 shows the free-games heading, no updates row, nothing under the video, and the loop playing.

## Evidence

- Loop check (Playwright Chromium against `vite preview` of this branch): `1440 {"src":"explainer-wide-loop.mp4","t":"2.95","paused":false}`, `375 {"src":"explainer-tall-loop.mp4","t":"2.99","paused":false}`, `reduced loop count 0`.

## Decisions

- 2026-09-27: the board: free games, no Dust on home, no updates row, nothing under the video, a preview loop (PLAN §10 decision 58).
