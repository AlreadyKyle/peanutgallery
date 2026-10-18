# Mob Machine brand

The brand of the studio: the public site, the broadcast overlay, the weekly update video, the social card, the Discord and anything else that speaks as Mob Machine. It says what the studio looks and sounds like and why. `platform/site/DESIGN.md` is how the site builds it (tokens, components, the tested rules), and `docs/COPY.md` holds the full voice rules. Where this page and DESIGN.md differ, DESIGN.md is what the site does today and this page is where it is going.

**Games are not the studio.** Each game the agents build has its own name, logo, colours and type, chosen by its own direction (Games keep their own brand, below). Nothing on this page binds a game.

## The idea

**The card is the object, the page is the table, and the studio is the machine.**

The studio has two halves, and the brand is both at once:

- **The table.** A deck of real cards on a white table: big, bold, black and white, short lines that land with a straight face. Anyone can pick up a card and play. This is where the warmth and the jokes live.
- **The machine.** A well-made instrument: a precise grid, ruled parts, small labels, every figure true to the cent. Nothing is hidden and every measure is deliberate. This is where the trust lives.

The quality bar is the best consumer-product pages: one idea to a screen, the product itself shown large and early (here the live studio), no empty columns, no filler, nothing that looks unfinished.

## Personality

| We are | We are not |
|---|---|
| **Deadpan.** We say true things plainly and let them be funny on their own. | Wacky, loud, or mean. No shock, no punching down, nothing an eight-year-old can't read. |
| **Precise.** Every number is real, labelled and to the cent. Parts are ruled off. | Vague, hype-driven, or "AI magic". |
| **Generous.** Free games, open books, a seat at the table for anyone. | Pushy. We never beg, guilt or count down. |
| **Open.** You can watch the agents work and read every ledger line. | Mysterious about how it works or where money goes. |

## Voice

Short declarative sentences, sentence case, no exclamation marks. Say what is true now, never what might be. Money words are exact ("contributions", never "donations"; `$0.00`). The joke, when there is one, lives in an empty state or a caption, never next to money and never about chance. The full rules are `docs/COPY.md`.

- Yes: "Nothing is being built. The agents are waiting for the next card."
- Yes: "Every figure here is on the ledger."
- No: "Our amazing AI is cooking something epic!!"
- No: "Only 3 spots left. Fund now."

## Name, wordmark and mark

- **The name** is two words, Mob Machine, in title case in running text.
- **The wordmark** is the name set in the brand face, bold and uppercase. It is the only uppercase in the brand.
- **The mark** is a small machine with two eyes (`platform/site/brand/mark.svg`), drawn on a 32-unit grid so every straight edge lands on a whole pixel. It sits to the left of the wordmark, or alone where the space is small (a favicon, a phone's top bar).
- **Colour:** the mark and wordmark are ink on paper or paper on ink. Never coin, never a suit colour, never a gradient, outline, shadow or photo behind them.
- **Clear space:** at least half the mark's height on every side. **Smallest size:** 24px tall on screen.
- **Motion:** the mark tips its head when the wordmark is hovered. That is its only animation.

## Colour

Mostly black and white. Colour is rare, and each colour has one meaning.

| Colour | Value | Meaning |
|---|---|---|
| Ink | `#111111` | Text, edges, the plate at the top of every page, dark bands |
| Paper | `#ffffff` | The page, card faces, the studio's screen |
| Coin | `#d9a441` | Money, and only money: Contribute, the funding bar, the coin mark |
| Live | `#16701f` | Live, and only Live: the Live stamp and glyph |
| Work | `#d4e1ee` | A card the agents are building or checking |
| Greys | `#5c5c5c`, `#7d7d7d`, `#d6d6d6` | Secondary text, quiet edges, hairlines |

Rules: text is ink or paper, never a colour. Coin appears where money moves and nowhere else. No red, no gradients, no glows or shadows, no neon, gold or felt green: this is a studio, not a casino. Every pairing is measured (body text at least 7:1, other text 4.5:1, marks 3:1) and listed in `platform/site/src/lib/colour.ts`. The agents' avatars have their own soft fills, always inside an ink outline, and those fills appear nowhere else.

## Type

One family: **Atkinson Hyperlegible Next**, weights 400 to 700 (SIL OFL), chosen because every character is unmistakable. The machine's labels (section numbers and every numeral that orders parts) use the system monospace face, so they cost no download.

| Role | Size | Set |
|---|---|---|
| Home's pitch | 38 to 60px | 700, tracking −0.03em, leading 1.04 |
| Page heading (h1) | 38 to 72px | 700, tracking −0.03em, leading 1.04 |
| Section heading (h2) | 26 to 40px | 700, tracking −0.015em, leading 1.15 |
| Lead, card titles, figures | 20px | 700 for titles, 400 for the lede |
| Body | 17px | 400, leading 1.6, about 72 characters a line |
| Small, labels | 14px | 400; labels 600 in the mono face, tracking +0.04em |

Headings are bold and sentence case, never shouting. No italic anywhere. Nothing smaller than 14px. Money and counts use tabular figures.

## Grid and layout

- **One width.** Everything lines up to a 76rem (1216px) column with a side margin that grows with the screen (20px on a phone, 5% of the width on a tablet or laptop, 64px and up on a desktop), so the top bar, every section and the footer share a left edge. Home alone is wider (90rem), top bar and footer included, since the floor is the studio itself.
- **Bands.** A page is a stack of full-bleed bands: the ink plate first (the top bar shares it), then paper and ink in turn. The change of ground is the only divider.
- **The index.** Every section after the plate opens on a 2px rule over its heading. It is the machine's spec-sheet line; the heading is the label, so no number sits over it. Home's stations carry no numbers either (the board, 18 October 2026): each opens on its glyph and where in the room it is, in the order a card moves.
- **Five layouts**, and nothing else:
  1. **The split** (7:5): a page's plate, its heading on the left and the lede on the right, both from the plate's top.
  2. **The sheet** (5:7): text pages, the ledger, the FAQ. The heading stays in view on the left; the text fills the right.
  3. **The card grid** (3, 2 or 1 equal columns): cards, team boxes, choices. One item to a cell.
  4. **Halves** (1:1): two related blocks side by side, such as the two other ways to fund.
  5. **The floor** (home only): the room large on the plate with its stations as labelled links, then the stations as parts in the order a card moves, Fund first and unnumbered, beside a rail that maps them (3:9). The part in view lights its station; nothing moves.
- **Room to breathe.** Sections sit far apart and a section's parts group by space, not by lines: the heading and its one intro close together, a clear step before the content, and wide margins between bands. Dense is a fault even when nothing is empty (the board, 18 October 2026).
- **No dead space.** Side-by-side blocks balance or stack. No block leaves an empty column beside it. The site's layout audit checks every page at five widths.

## The objects

The brand has a small cast of objects. Everything else is type on the table.

- **The card.** A white face with a 2px ink edge and 16px corners, no shadow. Its index row (suit and state), title, summary and spec rows. The whole card funds. Rarity is an edge pattern, never a colour.
- **The coin.** A 16px circle in coin with an ink rim. Only on Contribute and beside a dollar figure.
- **The screen.** The live studio: an isometric line drawing of the room on a paper screen, the agents walking between stations. On home it sits on the plate, in view when the page opens.
- **The dashed tile.** What a lane or list shows when it is empty: a 2px dashed edge and one line saying what happens next.
- **The avatars.** Every agent is drawn in code from its one-line description: soft fill, ink outline, two eyes. They never speak, plead or react to money.

## Motion

Motion sets the scene, records a real change, or answers a press. The studio's agents walk and type; a coin drops when money arrives; a card flips when it is funded. Nothing a reader might press moves under the pointer. Under reduced motion everything is drawn still.

## Imagery

Drawn in code or rendered from the real product: the room, the cards, the avatars, screenshots of the games. No stock photos, no photoreal generated images, no mascots in costumes. A game's box art belongs to the game.

## Applications

| Where | How the brand applies |
|---|---|
| The site | DESIGN.md, in full |
| The broadcast overlay | The ink plate, the screen and the pipe at 1920 by 1080; no top bar or footer |
| The weekly update video | Two or three updates, then a summary of tiles; the brand face, ink and paper, coin for money only |
| The social card | The mark, the wordmark and one line, ink on paper |
| Discord | The mark as the avatar; posts in the voice above |

## Games keep their own brand

A game is the agents' work, not the studio's face, so each game is free to look like itself:

- Its own name, logo, palette, type, sound and art direction, set by its game direction.
- On the studio's site a game appears as a guest: its box art, its name, and its suit tile in its own colour. The site's frame around it (the card, the plate, the bands) stays the studio's.
- A game may carry a small "Made by Mob Machine" credit on its title screen or about page. It never uses the studio's mark as its own logo.

## Accessibility is part of the brand

Every page meets WCAG 2.2 AA: measured contrast, a visible focus ring on every control, 44px touch targets, nothing carried by colour alone or only behind hover, everything readable by keyboard and screen reader, and everything drawn still under reduced motion.
