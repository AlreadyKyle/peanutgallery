# Weekly update video

Status: built. Card: none. Owner: studio.

Draft: written, not yet agreed. Agreed: the contract for the work, settled by the session or role that owns it (docs/PLAN.md §10 decision 74). Built: merged, and every criterion a test can prove is ticked; live verification is still to run. Done: every Verification line has been run and its output quoted. A criterion replaced by a later spec is struck through and names that spec.

## Problem

docs/BRAND.md lists a weekly update video, but there was no template for one: each video would be made by hand, look different, and make claims nobody checked against what merged. The studio needs a weekly video that looks like the explainer, says only what shipped, and costs one props file and a capture run to make.

## Scope

In: a `weekly` template in `platform/explainer/src/weekly/` (the 16:9 `weekly-wide` composition first, and a 4:5 `weekly-tall` cut from the same beats, as the explainer has), a capture script for the live site, a render script, a soundtrack from the same timeline, and a test that holds every week's props to the rules below. The first week's props (`weeks/2026-10-20.ts`).
Out: posting the video anywhere, the explainer's own composition and its published files (unchanged), a voiceover, captions files.

## Behaviour

- **A week is data.** `weeks/<date>.ts` holds the week's label, the intro, its segments (each a list of beats) and the closing lines. Type, frames, rings, easing, hold times, transitions and the score are the template's, so a new week changes no component.
- **One idea a beat.** A beat is one headline and at most one support line, one capture in the frame, at most one push-in and one ring. A segment's first headline says what changed for a player in under 8 words. A `list` segment ("Everything else") is headlines alone.
- **Plain words, true claims.** Every claim comes from a pull request merged to main that week, cited beside its beat in the props file. No inside terms (pipe, gate, lane, kernel, dispatcher, turn), no "first", no dashes, no exclamation marks. A money figure appears only inside a capture, and that capture's frame is labelled with the day it was taken.
- **The explainer's look.** The plate builds the mark and folds into the top bar, which counts the segments; the words are the explainer's caption type, the label (number and name) holding still through a segment; the plate unfolds for the closing lines and the address. One browser frame, in one place and at one scale, shows every capture; a capture with nothing to show is a site card with its glyph.
- **Motion that points.** Each beat's capture fades in over the last; its one movement is a slow push-in (the explainer's ease) on the UI it names, then an ink ring drawn round that UI. Rings and push-ins are placed from element rects the capture script measures, not by eye.
- **Time to read.** A headline alone holds at least 2.5 s, with a support line 3.5 s, and 4 s when the two pass about 90 characters. Every beat starts on a beat of the 120 BPM grid; a week runs 45 to 75 s.
- **Captures are honest.** `scripts/weekly-capture.mjs` loads the live site headless at 1280 by 720 CSS pixels (1920 by 1080 frames): load and look only, no form submitted, no account made, no checkout opened, and the site's counters skip an automated browser. Captures are not committed (`weekly-captures/` is ignored); the script makes them again.
- **Sound.** `scripts/music.mjs --weekly <date>` renders the explainer's band on the week's own timeline: the mark's notes, a flick as each capture comes in, a rising note at each segment, a tick at each ring, the closing chords; -16 LUFS.

## Acceptance criteria

- [x] `weekly-wide` (1920 by 1080) and `weekly-tall` (1080 by 1350) render at 60 fps from a week's props, with the length worked out from them.
- [x] `weekly.test.ts` holds every week to: no dashes, exclamation marks, inside terms or "first"; segment openers under 8 words; the hold times; list beats headline-only; 45 to 75 s; beats on the grid.
- [x] `scripts/weekly.mjs` refuses a week whose captures or named rects are missing.
- [x] The explainer's compositions and their output are unchanged.

## Verification

- `pnpm --filter @backseat/explainer typecheck` and `pnpm --filter @backseat/explainer test`
- `node scripts/weekly-capture.mjs weekly-captures/<date>` then `node scripts/weekly.mjs --week <date> --stills`, and every still looked at.
- `ffprobe` on each rendered file: the cut's size, 60 fps, one audio stream, the stated length.
- `pnpm verify`

## Evidence

Run in the `weekly-video` worktree on 20 Oct 2026, for the week to 20 October 2026: typecheck clean; `Tests 20 passed (20)`; 22 stills a cut looked at and fixed; the files' ffprobe readings are in the pull request.

## Decisions

- 2026-10-20: horizontal first. Every earlier studio video is 16:9, so the weekly video is built from the explainer, and the 4:5 cut mirrors the explainer's tall cut.
- 2026-10-20: the week to 20 October leaves out Dust's "what's new" line (it shipped on 11 October, #186) and any claim that an agent sorts ideas (the site says that work has not started, #251).
