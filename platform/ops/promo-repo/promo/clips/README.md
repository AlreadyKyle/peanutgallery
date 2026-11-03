# Clips

The vertical clip for YouTube Shorts and TikTok: one studio moment (a ship or an open card) in 15 seconds at 1080x1920, drawn with the site's own objects (the agent's avatar, the card, the Live stamp, the funding bar). It is a Remotion composition, `moment`, built from the weekly update video's template.

The engine fills it in. `src/clips.mjs` turns a ship or the day's open card into the composition's props, the draft for each video channel carries them, and `publish` renders the clip just before it sends (`clips/out/`, not committed). Every word on screen comes from the card's public record.

```sh
cd promo/clips && npm ci
npm run music                                  # once: writes public/soundtrack.wav (committed)
node scripts/render.mjs props.json out.mp4     # one clip
node scripts/render.mjs props.json --still 110,300 frames/   # review frames
```

`src/Root.tsx` has sample props. A hand-made clip can go through review like any draft: add `"clip": { ...props }` to an item in a `cli.mjs add` batch.
