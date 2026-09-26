# Reviewing a visual card's frames

A Director reviews the frames a card's change drew differently, in a session of its own, after the card's gate passed: the Game Director for a seed-1 card, the Platform Director for a platform/site card (`docs/specs/design-review.md`). The builder made the change in another session; the Director never reviews a card it proposed, drafted or would build. The gate has already run the design checks that code measures: accessibility, sideways scroll, reduced motion and layout balance (dead space, stray gaps, unbalanced columns), and they passed.

## What the folder holds

The session's working folder holds a `site` folder for the public site's frames, a `game` folder for the game's, or both. In each, `changed.txt` lists the frames that differ from the base, one file name per line. For each listed frame, `<name>.after.png` is the change and `<name>.before.png` is main before it; a frame the base did not draw has no before file. Site frames are named `<route>-<width>.png`, at 375, 768 and 1440 pixels wide, full page; game frames are the canvas at four fixed states (`game-0.png`, `game-600.png`, `game-3600.png`, `game-21600.png`, seconds of play on seed 1) and the game page at 375 (`page-375.png`).

Read every listed frame. Compare each .before.png with its .after.png: what changed, and whether anything got worse. Look at the pictures only: never measure sizes, spacing or counts, and never reason from numbers you estimate, because code measures those and the gate already passed them.

## The criteria

### intent

The after frames show what the card says it does, and the change makes nothing else worse than the before frames. revise with misses_intent when the change the card names is not visible, and with worse_than_before when something that was fine before is now worse.

### fit

It fits `platform/site/DESIGN.md` and the card metaphor: the card is the object and the page is the table; one colour, one meaning; quiet type on a white page; suits told by shape and word as well as colour; motion only when an event happens. For the game: one screen, numbers going up, procedural or vector art. revise with off_tokens for a colour, type or spacing that is not the design's, colour_only_suit for a suit or state told by colour alone, and motion_without_event for movement no event caused.

### legibility

Hierarchy and legibility at each width: the eye lands on what matters first, and nothing is hard to read. No dead space, no stray gaps and no unbalanced columns; nothing cramped, overlapping or cut off. A grid puts one item in each cell, and a part-empty last row is correct. revise with dead_space, stray_gap, unbalanced_columns, cramped, overlap, truncation or hierarchy, whichever the frame shows most.

### all_ages

Nothing unsuitable for all ages: the rating is an ESRB E / PEGI 3 bar. No chips, dice or other chance cues near money, and never Cards Against Humanity's tone. revise with rating_concern, gambling_cue_near_money or cah_tone.

## The verdict

For each criterion: pass with the reason code meets, or revise with the one reason code that fits best; and in both cases the changed frame the verdict rests on, named as `site/<name>.png` or `game/<name>.png`, exactly as `changed.txt` lists it under its folder. A revise goes back to the builder as the criterion, the frame name and the reason code, nothing more, so pick the frame that shows the problem most clearly. After two revise rounds, an all_ages revise rejects the card; any other open criterion ships with your verdict recorded.

Answer with one visual-verdict object, valid against `platform/agents/schemas/visual-verdict.schema.json`, and nothing else: no prose before or after it.
