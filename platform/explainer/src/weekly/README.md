# The weekly video template

The weekly update video (`docs/specs/weekly-video.md`): the explainer's plate, type and band, then straight into a few segments of short beats (no intro card), each beside a drawn scene that acts out the change (the explainer's own agents, cards, coins, phone and glyphs, moving), then the closing lines. No browser frames and no screenshots. A week is one props file; nothing else changes.

**The studio.** The studio's beats (`agents`, `agent-card`, `curator-joins`) draw the real live studio: `IsoRoom.tsx` renders the site's own room (`RoomDrawing.tsx`, `lib/studio-scene.ts`) with the running agents wandering between its idle spots on a seeded route worked out from the frame, so it renders the same every time.

**Scenes.** Each beat names a scene in `shot: { scene: '<name>' }` (`SceneName` in `schema.ts`, drawn in `Scenes.tsx`): `agents`, `agent-card`, `curator-joins`, `ideas-pitch`, `ideas-vote`, `signup`, `reset`, `follow`, `dust`, `daily`, `seed`, `rates`, `ledger`, `terms`, `checkout`, `shield`, `fast`, `email`, `social`. A week with a change no scene fits adds one to `Scenes.tsx`: one main movement, a pointer where a player would press, the explainer's springs (`anim.ts`), real titles and figures only. Step 2 below (captures) is optional and only for a beat that needs a capture; most weeks need none.

## Make next week's video

1. **List what merged, then cut.** The video runs 45 s at most (`MAX_SECONDS` in `layout.ts`), so keep only what a player would want to see: new things to do, play or watch. Leave out housekeeping such as passwords and resets, copy, Terms versions, fixes and speed-ups. `git log --since=<last week's date> --format='%h %ad %s' --date=short origin/main`, then read each pull request's description (`gh pr view <n> --repo AlreadyKyle/peanutgallery`). Only what merged that week goes in. Note each beat's pull request beside it.
2. **Capture the live site.** Edit the constants at the top of `scripts/weekly-capture.mjs` (`CARD`, `CURATOR`, `TODAY`) and the shots in `SHOTS` for the week's features, then, in `platform/explainer`:

   ```sh
   node scripts/weekly-capture.mjs weekly-captures/<date>            # every shot
   node scripts/weekly-capture.mjs weekly-captures/<date> studio,dust # some again
   ```

   Videos (`.mp4`) and stills (`.png`) are 1920 by 1080 frames of a 1280 by 720 page. Each shot can measure the element a beat points at with `mark(page, '<capture>.<name>', locator)`; the rects go to `rects.json`. Load and look only: never submit a form, make an account or open checkout. `weekly-captures/` is not committed.
3. **Write the props.** Copy `weeks/2026-10-20.ts` to `weeks/<date>.ts`, add it to `weeks/index.ts` and point `LATEST` at it.
4. **Test and look.** `pnpm --filter @backseat/explainer test` checks the words, opener lengths, hold times and the 45 s cap. Then `node scripts/weekly.mjs --week <date> --stills` writes one still per beat to `dist/weekly/weekly-stills/`; look at every one.
5. **Render.** `node scripts/weekly.mjs --week <date>` writes `dist/weekly/weekly-<date>.mp4` (16:9) and `weekly-<date>-tall.mp4` (4:5). Add `--only wide`, `--out <dir>`, or `--music` to render the soundtrack again (it renders on its own when missing, from `scripts/music.mjs --weekly <date>`).

## Props

```ts
type WeekProps = {
  date: '2026-10-20';                       // the week's last day; also the captures folder
  segments: {
    title: 'Ideas';                         // beside its number, over every beat of the segment
    kind?: 'story' | 'list';                // list: quick headline-only beats ("Everything else")
    beats: Beat[];
  }[];
  outro: { lines: { glyph; text }[]; address: 'mobmachine.games' };
};

type Beat = {
  headline: string;      // one idea; a segment's first says what changed for a player, under 8 words
  support?: string;      // at most one line; none in a list segment
  shot:
    | { src: 'sign-up.png' | 'studio.mp4'; url: string; from?: number /* s into a video */; asOf?: 'As of 20 Oct 2026' }
    | { glyph: GlyphName; line: string; url?: string };   // no capture: a site card in the frame
  focus?: 'sign-up.form';  // push in on this rect from rects.json: the beat's one movement
  zoom?: number;           // cap the push (1 to 1.75) when the rect's own fit crops text beside it
  ring?: 'sign-up.form';   // draw the ink ring round this rect once the push settles
  ringAt?: number;         // seconds into the beat, to time a ring to something in a video
  bars?: number;           // override the hold, in two-second bars
};
```

Label any capture that shows a money figure with `asOf`. Two beats in a row on the same video with the same `focus` carry on with no fade; start the second at the first's `from` plus its length.

## What the template decides

- `geometry.ts`: each cut's text column, the one frame box, and the three type sizes (label, headline, support).
- `layout.ts`: the plate and closing times, the hold times (`HOLD`), the push-in (`PUSH`) and ring timing, all on the explainer's 60 fps, 120 BPM grid. The score reads the same table.
- `Scenes.tsx`: the drawn scenes and the cross-fade between beats. `Words.tsx`: the label, the rising headline, the support line. `Plate.tsx`: the plate, the top bar's segment counter and the closing lines. `score.ts`: the soundtrack.
