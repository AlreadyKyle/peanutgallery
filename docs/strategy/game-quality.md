# Game quality: the bar for a Three.js game

The quality bar every Mob Machine game meets before it is called shipped, and every change to a live game keeps. It is the Game Director's rubric for scoring a game, the visual review's checklist for a card that changes a game's frames, and the Art Director's standard for box art (`docs/specs/final-state.md`, Games). It applies to Dust and to every later seed. `seed-1/CLAUDE.md` holds each game's own pillars; where they are stricter, they win.

## 1. How a game is scored

Ten criteria, each scored 0 to 3. A shipped game needs **24 of 30 or more, with no criterion below 2**. A card that changes a live game may not lower any criterion's score.

| Score | Meaning |
|---|---|
| 0 | Missing or broken |
| 1 | Present, but a player would call it unfinished |
| 2 | Good: a player would not notice a problem |
| 3 | Excellent: a player would point it out to someone |

The Game Director records the ten scores, one line of evidence each, with the game's version. The Art Director scores criteria 1 and 9. The score is public on the game's page once the site shows it.

| # | Criterion | 2 means | 3 means |
|---|---|---|---|
| 1 | Art direction | Every object follows the line style below; palette from the tokens; one consistent camera | The game is recognisable from one frame as a Mob Machine game |
| 2 | Juice and feedback | Every input answers within one frame, visibly and (once sound exists) audibly | Feedback scales with impact: a big moment feels big |
| 3 | Readability | Every interactive thing is identifiable at phone size in under a second | A new player reads the screen correctly without text |
| 4 | First 60 seconds | Meets every beat in §4 | A first-time player smiles or says "oh" within the minute |
| 5 | Session arc | A 2-minute session has a beginning, a payoff and a reason to return | Players reach for one more go |
| 6 | Depth over time | New content or mechanics appear across the first hour | Players discover combinations the designers did not script |
| 7 | Performance | Meets every budget in §6 on the reference phone | Holds 60 fps on the floor device too |
| 8 | Accessibility | Meets every item in §7 | Fully playable by keyboard and screen reader with no loss of fun |
| 9 | Box art | Meets every item in §8 | It would look at home on a shelf next to commercial games |
| 10 | Stability | No error in 30 minutes of the headless bot and a device run; saves survive reloads | Seeds, saves and time-away credit survive version changes |

## 2. Art direction: the thick-line style

Mob Machine's look is ink on paper. Games carry it into 3D.

- **Outlines.** Every object has a dark ink outline about 2 px wide at a 375 px portrait viewport, scaled with the device pixel ratio up to its cap. Use an inverted-hull pass or a screen-space edge pass, one technique per game.
- **Shading.** Flat or toon shading with at most three tone steps per material. No photoreal materials, no specular highlights that read as plastic, no image textures except those drawn in code at build time.
- **Palette.** Colours come from `platform/site/src/tokens.css` (paper, ink and the creature fills). A game may add at most three accent colours, recorded in its creative notes.
- **Shapes.** Chunky, readable silhouettes with rounded corners; objects keep a clear outline against the ground at every zoom.
- **Camera.** One fixed or gently constrained camera per game, chosen for the phone's portrait screen first. No camera motion the player did not cause, except a short, small shake on impact that is off under reduced motion.
- **Light.** At most three lights in a scene; shadows, if any, are a simple blob or a single low-resolution map.
- **Type.** In-game text uses the site's type scale and is drawn in the DOM, not in the WebGL canvas, so it stays sharp and accessible.
- **Art policy.** Procedural or vector art only, made in code. No generated images inside games (`docs/PLAN.md` §4 Art policy).

## 3. Juice and feedback

Every player action gets an answer, and bigger actions get bigger answers.

| Moment | Required feedback |
|---|---|
| Any press | A visible change in the same frame: a squash, a flash or a number |
| Gaining something | A number that rises toward its counter, not a jump |
| Buying or unlocking | A short scale pulse (about 120 to 200 ms) and a distinct visual mark on the new thing |
| A rare event | A beat of its own: a brief hold, particles, a one-line toast |
| Returning after time away | The earned amount counts up as it lands, with the time away in words |
| Failure or not enough | A gentle shake of the control and a clear reason, never a sound or flash that punishes |

Rules: easing on every movement (no linear tweens on things the player watches); particles are short-lived and pooled; no flashing above three times a second; every effect has a reduced-motion form (a fade or nothing).

## 4. The first 60 seconds

| By | The player has |
|---|---|
| 3 s | Seen the game drawn and one obvious thing to press, with no loading screen longer than this |
| 10 s | Pressed it and seen a reaction |
| 30 s | Made their first choice (a purchase, a placement, a path) |
| 60 s | Seen something new appear because of what they did, and every core feature of the screen at least once (`seed-1/CLAUDE.md`: every feature visible within 60 seconds) |

No tutorial text walls, no account prompt, no money prompt inside the first 60 seconds. The next-card line under the game is allowed because it is outside the play area.

## 5. The session arc

- **2 minutes is a satisfying session.** Something grows, something new appears, and the player leaves at a natural pause.
- **Return is rewarded.** Time away is credited (up to 8 hours for idle games) and shown with a count-up.
- **A reason to come back.** The next unlock is visible and roughly reachable next session.
- **Shareable end state.** At any natural pause the player can Save as seed and share a run image.
- **No punishment for leaving.** No streaks, no decay of progress, no timers that expire.

## 6. Performance budgets

The **reference phone** is a mid-range Android phone of about three years ago (for example a Pixel 6a class device) on Chrome; the **floor device** is a budget Android phone of about four years ago on Chrome; desktop is a laptop with integrated graphics. Budgets are measured by the game's perf scene in CI with CPU throttling, and confirmed on a real reference device before a game ships.

| Budget | Target | Hard limit |
|---|---|---|
| Frame time, reference phone, p95 | 16.7 ms (60 fps) | 20 ms |
| Frame time, floor device, p95 | 33 ms (30 fps) | 40 ms |
| Frame time, desktop, p95 | 8.3 ms | 16.7 ms |
| Draw calls per frame | 60 or fewer | 100 |
| Triangles on screen | 50,000 or fewer | 100,000 |
| Device pixel ratio | capped at 2 | 2 |
| Dynamic lights | 2 | 3 |
| Initial load, gzip, Three.js included | 450 KB | 600 KB |
| Game code without Three.js, gzip | 120 KB | 200 KB |
| Time to first press on 4G, reference phone | 2.5 s | 4 s |
| JS heap after 10 minutes | 80 MB | 150 MB |
| Garbage collection pauses over 8 ms in 60 s of play | 0 | 2 |
| Renderer resources after 10 minutes | flat (no growth in `renderer.info.memory`) | flat |

Rules that keep these: import only the Three.js modules used (tree-shaken); instance repeated objects; pool particles and vectors; dispose geometries, materials and render targets on teardown; render on demand when nothing moves; pause rendering in a hidden tab while the simulation keeps wall-clock time. These follow common Three.js guidance (about 100 draw calls on mobile, a pixel ratio cap of 2, at most three dynamic lights; [Utsubo, 100 Three.js tips](https://www.utsubo.com/blog/threejs-best-practices-100-tips)).

## 7. Accessibility

- The canvas is `aria-hidden`; every action is a real DOM button or control with a name, driving the same simulation actions (`seed-1/CLAUDE.md`, controls).
- Fully playable by keyboard only, with a visible focus ring; an e2e test plays by keyboard and runs axe with no serious or critical violation.
- A polite live region announces purchases and unlocks at once, totals at most every 10 seconds.
- Reduced motion: no shake, no particles, no count-ups beyond a fade; the game is still fully legible.
- Colour never carries information alone: states, rarities and teams also differ by shape, pattern or word.
- Text contrast 4.5:1, and 3:1 for interactive shapes against their ground.
- Touch targets at least 44 px at a 375 px portrait viewport, with no sideways scroll.
- No input that needs speed or precision to make progress; anything timed has a slower path.
- Sound, once it exists, is never the only cue and has a mute that persists.

## 8. Box art standard

Every game has a 3:4 cover at `seed-*/box-art.svg`, drawn in code (SVG, or a Three.js render to PNG at build time), shown on the game's tile and page and on the studio's trophy shelf.

- **Size.** Designed at 900 by 1200; must read at 120 px wide (the tile) and at full size.
- **Composition.** One hero subject from the game, in the game's own art direction, filling at least half the cover; a clear focal point; no more than three characters or objects competing.
- **Line style.** The same ink outline and toon shading as the game, at a weight that holds at 120 px.
- **Title.** In block type from the site's type scale, at least 12% of the cover's height, legible at 120 px wide.
- **Suit band.** A band with the Game suit's word and glyph, as on cards.
- **All-ages mark.** The studio's all-ages mark in a corner, never covered.
- **Studio mark.** The Mob Machine mark, small.
- **Honesty.** Shows only what is in the game; no feature, character or scene the game does not have.
- **Accessibility.** The image has alt text naming the game and what the cover shows.
- **Rating.** Passes the deny-list and the all-ages rating like any string.

## 9. The visual review checklist

The Game Director and the Art Director use this list for every card whose frames change. Each line is pass or revise; a revise names the line.

1. The changed frames follow the line style: outlines present and even, shading in at most three tones, palette from the tokens and the game's accents.
2. Silhouettes and interactive things read at 375 px; nothing important is smaller than the touch target.
3. Every new action has feedback within one frame, and a reduced-motion form.
4. Text is in the DOM, in the type scale, with 4.5:1 contrast.
5. No information is carried by colour alone.
6. Nothing overlaps, clips or leaves the screen at 375 px portrait and at desktop width.
7. No performance budget in §6 is exceeded in the card's perf run.
8. The first 60 seconds still meet §4.
9. The change is visible to a player if the card says it is.
10. Box art, if changed, meets §8.
11. All-ages rating and the art policy hold.
12. Nothing looks made by default. Players now dismiss games that look generated, and they name the signs. The game's own panels, buttons and notices follow its art style, with no stack of rounded web cards, pills or hard offset shadows beside a hand-drawn world. Effects are drawn for the game, never stock confetti or default particles. Every asset on screen shares one level of detail and one light. A new unlock changes something a player can see or do, not only another percentage.

## 10. How the bar is used

- **Drafts.** The Game Designer writes each game card against this bar; the Game Director refuses a draft that would lower a criterion.
- **Visual review.** The checklist in §9 decides pass or revise.
- **Ship.** A new game ships only at the score in §1.
- **Re-score.** The Game Director re-scores a live game after every tenth shipped card on it, and the review team (`operating-system.md`) reads the trend.
- **Changes to this file.** A pull request with its reason. Lowering a budget or a score bar needs the review team's report showing why.
