# Explainer video

Status: built. Card: none. Owner: board.

Draft: written, not yet agreed by the board. Agreed: the contract for the work. Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

The site explains the studio in text and example components, and a first-time visitor has to read six steps to see how a contribution becomes a shipped change. The board asked for a high-quality, motion-designed explainer video for the website (27 Sep 2026).

## Scope

In: a new workspace package, `platform/explainer`, that renders the video from code with Remotion and makes its soundtrack in code with Tone.js; two cuts (16:9 for wide screens, 4:5 for phones); the rendered files in `platform/site/public/video/`; an `ExplainerVideo` component on home (beside the pitch from 64rem, under it below) and at the top of /how-it-works' steps; the video's words in `legal.explainer`; `.mp4` and `.webm` added to the gate's binary media list.
Out: a voiceover, a hosted player or any third-party embed, autoplay, captions files (the words are on screen and in the transcript), a video in the board's site, and the launch clip (`specs/announcement.md`), which stays a recording of a real card's replay.

## Behaviour

- **The story is the site's.** The first and last lines are the board's own for the video (PLAN.md §10 decision 57): it opens "Watch AI agents build a game studio and free games." and closes "Fund a card. Watch AI agents build it. Play it free.", three sentences popping in one to a beat and a half, each with the site glyph for what it says. Every line between is a sentence the site already says, word for word, and each step is a heading of /how-it-works (`legal.explainer`): it introduces the running agents, follows one card through the six steps (Pick a card; Contribute and choose the split; The bar fills; The agents build it; Checks, then live; It shows under Shipped), and shows the public ledger line over the site's own worked example.
- **It names no game** (the board, decision 57): no line says Dust, the cards carry the game suit's tile without its word, only cards whose titles do not say "dust" are dealt, and the phone's frame starts below the game's title and count.
- **Nothing is made up.** The cards are real cards from the live deck (open ones in the hand, shipped ones on the pile, read 27 Sep 2026); the followed card is "Show how long until the next unlock". The agents are every role whose spec says `running`, each drawn by the site's own avatar code from its species note. The game on the phone is a real frame from seed-1's frames rig (the sim at 3,600 seconds). The ledger scene's figures are /how-it-works' worked example ($5.00 paid, with the default split), from `payment.ts`. No dollar figure is shown on the card itself.
- **The brand is the site's.** Colours are the site tokens (amber only for money, green only for Live, magenta for Dust, ink for the studio); one typeface, Atkinson Hyperlegible Next; sentence case; the card, the coin and the mark are the only motifs. The mark, glyphs, suits and state words are the site's own components and strings. The opening plate folds into the site's top bar, and a step counter on the bar tracks the six steps. No art from an image model (the art policy).
- **Motion.** 60 frames a second on a 120 BPM grid: every scene starts on a bar, and every dealt card, coin, flip, stamp and slam lands on a beat. The followed card never cuts away from Pick to Shipped. Flips follow the site's flip (0 to 90 degrees, face swap, back to 0).
- **Sound.** Music and sound effects are code: a Tone.js score in D major at 120 BPM, rendered offline in headless Chromium from the same timeline table the scenes read, loudness-normalised to -16 LUFS integrated with a -1.5 dBTP ceiling. Nothing is recorded, sampled or downloaded.
- **On the site.** A still poster (the closing plate) is the play button, labelled "Play the video" in its bottom-left corner, over a muted 8-second loop of the Pick a card scene (a still under reduced motion). Nothing of the video is fetched before it is pressed (`preload="none"`); pressing starts it with sound and native controls. Below 48rem the 4:5 cut plays, from 48rem the 16:9 cut, each as AV1 in WebM with an H.264 MP4 for every other browser. Nothing sits under it: the length line and the text disclosure were removed by the board (PLAN §10 decision 58). The frame holds the cut's shape before anything loads, so pressing play moves nothing. All files are served from the site's own origin, so the content security policy is unchanged.
- **Tooling.** `pnpm --filter @backseat/explainer music` renders the soundtrack; `render` renders both cuts to `platform/explainer/dist/` (a near-lossless master, then the web MP4 and WebM from it, and a JPEG poster); `render --still <frames>` renders stills for review; `render --publish` copies the finished files into the site. A full render also makes the social cuts in `dist/social/` (16:9 and 4:5, with the site's address on the closing plate, H.264 High and AAC at 48 kHz) for posting to X and LinkedIn; they are not committed, and the site's own cuts name no address, so a new domain never leaves them wrong. Rendering uses the headless Chromium Playwright already installed (or `REMOTION_CHROME`). Remotion's CLI and studio are not installed: a deep dependency of the CLI fails the workspace's trust policy, and the bundler and renderer are enough. Remotion is free under its license for an individual or a company of up to three people.

## Acceptance criteria

- [x] Every line in `legal.explainer.beats` but the board's first and last appears word for word elsewhere in `copy.ts` or `legal.ts`, and its steps are the six /how-it-works headings in order.
- [x] No line and no card title in the video says Dust or dust.
- [x] The video's words pass the site's copy rules (no "X, not Y", no fragments, no em dashes, no inflated words, inside the font subset).
- [x] The team scene draws every running role and no other.
- [x] The video's colours equal the site tokens.
- [x] Every scene starts on a bar, every choreographed moment falls inside its scene, and the stated length matches the video's duration.
- [x] The embed fetches nothing before it is pressed, never autoplays, offers the phone cut below 48rem and the wide cut above, starts with controls on press, and reads out every line in its transcript.
- [x] /how-it-works shows "Watch how it works" above the six steps; home shows the video in its hero.
- [x] The gate skips `.mp4` and `.webm` as binary media, with a test.
- [ ] On the live site, pressing play on home and on /how-it-works plays the video with sound, at 375px and 1440px, with no CSP report.

## Verification

- `pnpm verify`
- `pnpm --filter @backseat/explainer test` and `pnpm --filter @backseat/site test`
- `bash platform/gate/test/run-tests.sh`
- The site's e2e suite (`pnpm --filter @backseat/site e2e`), including the CSP, layout-balance and route-shot specs.
- Screenshots of home and /how-it-works at 375, 768, 1024 and 1440px, looked at.
- `ffprobe` on each published file: duration 81 s, 60 fps, the cut's size, one audio stream.
- The soundtrack's loudness read back with ffmpeg's loudnorm.
- On the live site after the deploy: press play on both pages at 375px and 1440px and read the network requests (the video files requested only after the press, all from the site's origin).

## Evidence

Run in the pull request's worktree on 27 Sep 2026:

- `pnpm verify`: exit 0, with `GATE PASS folder=seed-1 lane=code`, `GATE PASS folder=platform lane=code`, `PASS: secret-scan files=730`, docs `# pass 22 # fail 0`, rename `# pass 8 # fail 0` (the rename check also classifies `KYLE_SETUP.md`, which main added without a tier).
- `pnpm --filter @backseat/explainer test`: 3 files, 15 tests passed (the lines between the board's are word for word from the site, the six steps in order, no game named, every running role, the site tokens, every moment inside its scene, the stated length). `pnpm --filter @backseat/site test`: 48 files, 535 tests passed (the copy rules on `legal.explainer`, the embed).
- `bash platform/gate/test/run-tests.sh`: `PASS: gate tests passed=645`, including "secrets: video explainer.mp4 is skipped as binary media" and the same for `.webm`.
- Site e2e: `layout-balance`, `pages`, `paused`, `landing`, `design` and `csp`: 150 passed; `route-shots`: 9 passed. Screenshots of home and /how-it-works at 375, 768 and 1440 looked at (home from 64rem: the pitch and the video side by side, the studio's state under both).
- In Chromium against the e2e build: before the press only the poster is fetched; after it, `375 / … {"src":"/video/explainer-tall.webm","time":"2.25","paused":false,"controls":true,"w":1080,"h":1350,"muted":false}` and `1440 / … {"src":"/video/explainer-wide.webm","time":"2.43","paused":false,"controls":true,"w":1920,"h":1080,"muted":false}`, the same on /how-it-works, `csp reports: 0` at both widths.
- `ffprobe`: every published file is 81.05 s at 60 fps with 48 kHz audio; `explainer-wide.mp4` h264 1920x1080 (6.56 MB), `explainer-wide.webm` av1 (4.73 MB), `explainer-tall.mp4` h264 1080x1350 (6.40 MB), `explainer-tall.webm` av1 (4.62 MB).
- Soundtrack: `-16.08 LUFS integrated, -1.38 dBTP peak, 6.10 LU range`.
- Stills and frame strips of every scene in both cuts looked at; fixed on the way: the mark's outline notch at its top-left, the wordmark crossing the mark as the plate folds, the pile overlapping the heading, the 4:5 stage's hollow under the words.

## Decisions

- 2026-09-27: Code-rendered video (Remotion) with code-made music (Tone.js). The board asked for music made by a generator or an open-source track; a score in code is free, carries no license, needs no download, and lands every sound on its frame.
- 2026-09-27: Kinetic type, no voiceover. The site's autoplay rule and muted playback mean the words must carry the story on screen; a paid voice would break the everything-free rule.
- 2026-09-27: Click to play, never autoplay. DESIGN.md: first paint is still.
- 2026-09-27: Two cuts, 16:9 and 4:5, chosen by width. A 16:9 video on a phone would make the words too small.
- 2026-09-27: The followed card is a real open card shown moving through every step, with no figures on it; the only figures are the site's own labelled worked example.
- 2026-09-27: After the first cut the board asked for a faster intro (the plate now folds at 4.75 s, from 7 s), the mark's outline closed at its top-left corner, "free games" in the opener with no game named anywhere in the video, and a punchier closing line. Both lines go against settled copy (decision 54's singular pitch, COPY.md's no-slogan rule), which was said; the board kept them, they apply to the video only, and they are recorded as decision 57. The site's pitch is unchanged.
- 2026-09-27: Social cuts carry the site's address; the site's own cuts do not.
