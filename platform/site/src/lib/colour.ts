// The colour system as data (DESIGN.md, Colour): every colour token and its one job, and every
// pairing the site draws, with the floor it must meet. The design guide measures each pairing on the
// page from the values in tokens.css; styles.test.ts checks the same list against tokens.css, and
// checks that each banned pairing stays below its floor, which is why a rule keeps it off the page.

export type ColourToken = { readonly name: string; readonly role: string };

/** Every colour token in tokens.css, in the order DESIGN.md lists them, with its one job. */
export const COLOUR_TOKENS: readonly ColourToken[] = [
  { name: '--paper', role: 'The page ground and paper bands; card faces and fields; text on signal and ink' },
  { name: '--ink', role: 'Text on paper and work; card edges; the ground of ink bands' },
  { name: '--muted', role: 'Secondary text on paper and work' },
  { name: '--field', role: 'Field, chip and quiet edges on paper, work and ink' },
  { name: '--line', role: 'Hairlines on paper; the outline press fill on paper' },
  { name: '--paper-hover', role: 'Outline hover on paper; primary hover and press on signal and ink' },
  { name: '--ink-hover', role: 'Outline hover and press on ink' },
  { name: '--muted-on-ink', role: 'Secondary text on ink' },
  { name: '--line-on-ink', role: 'Hairlines on ink' },
  { name: '--signal', role: 'The studio: band 1, the primary fill and focus ring on paper, the Picked ribbon, the studio suit' },
  { name: '--signal-deep', role: 'Hover of every signal fill' },
  { name: '--signal-press', role: 'Press of every signal fill' },
  { name: '--muted-on-signal', role: 'Secondary text on signal; the quiet label and edge there' },
  { name: '--line-on-signal', role: 'Hairlines on signal' },
  { name: '--work', role: 'The Building and Being checked face: a pale blue' },
  { name: '--suit-game', role: 'The Dust suit tile, on paper and work only' },
  { name: '--suit-studio', role: 'The studio suit tile: the signal' },
  { name: '--live', role: 'Live only: its glyph and the stamp edge, on paper' },
  { name: '--coin', role: 'Money only: Contribute, the funding bar, the coin mark, the Funded glyph' },
  { name: '--coin-down', role: 'Contribute hover and press on paper and ink' },
  { name: '--coin-up', role: 'Contribute hover and press on signal' },
];

/**
 * A pairing: a foreground on a background. `floor` is the ratio it must reach (7 for body text, 4.5
 * for other text, 3 for controls and marks, 0 when it is decorative and something else carries it).
 * A banned pairing measures below its floor, so a rule keeps it off the page.
 */
export type ColourPair = {
  readonly fg: string;
  readonly bg: string;
  readonly floor: number;
  readonly banned?: true;
  readonly use: string;
};

export const COLOUR_PAIRS: readonly ColourPair[] = [
  // Paper
  { fg: '--ink', bg: '--paper', floor: 7, use: 'Paper: text, links, the outline label, tags, card edges, the pressed border, the change marker' },
  { fg: '--muted', bg: '--paper', floor: 4.5, use: 'Paper: secondary text, the quiet label, Waiting for the agents' },
  { fg: '--field', bg: '--paper', floor: 3, use: 'Paper: field, chip and quiet edges' },
  { fg: '--line', bg: '--paper', floor: 0, use: 'Paper: hairlines' },
  { fg: '--signal', bg: '--paper', floor: 3, use: 'Paper: the primary fill, the focus ring, the Picked ribbon, the studio tile' },
  { fg: '--paper', bg: '--signal-deep', floor: 7, use: 'Primary hover label on paper; outline hover on signal' },
  { fg: '--signal-deep', bg: '--paper', floor: 3, use: 'Paper: the primary hover fill' },
  { fg: '--paper', bg: '--signal-press', floor: 7, use: 'Primary press label on paper; outline press on signal' },
  { fg: '--signal-press', bg: '--paper', floor: 3, use: 'Paper: the primary press fill' },
  { fg: '--ink', bg: '--paper-hover', floor: 7, use: 'Outline hover label on paper; primary hover label on signal and ink' },
  { fg: '--ink', bg: '--line', floor: 7, use: 'Paper: the outline press label' },
  { fg: '--ink', bg: '--coin', floor: 7, use: 'Every ground: the Contribute label; the coin ring, the bar rule, the Funded outline' },
  { fg: '--ink', bg: '--coin-down', floor: 4.5, use: 'Paper and ink: the Contribute hover label' },
  { fg: '--coin', bg: '--paper', floor: 0, use: 'Paper: the coin fill (its ink rim and the words carry it)' },
  { fg: '--suit-game', bg: '--paper', floor: 3, use: 'Paper: the Dust tile' },
  { fg: '--paper', bg: '--suit-game', floor: 3, use: 'The paper cartridge glyph on the Dust tile' },
  { fg: '--paper', bg: '--suit-studio', floor: 3, use: 'The paper browser glyph on the studio tile' },
  { fg: '--live', bg: '--paper', floor: 3, use: 'Paper: the Live glyph and stamp edge (the word stays ink)' },
  // The work face
  { fg: '--ink', bg: '--work', floor: 7, use: 'Work face: text, the state tag, the edge, the change marker' },
  { fg: '--muted', bg: '--work', floor: 4.5, use: 'Work face: secondary text, the who line' },
  { fg: '--field', bg: '--work', floor: 3, use: 'Work face: control edges' },
  { fg: '--signal', bg: '--work', floor: 3, use: 'Work face: the focus ring, the studio tile' },
  { fg: '--suit-game', bg: '--work', floor: 3, use: 'Work face: the Dust tile' },
  { fg: '--work', bg: '--paper', floor: 0, use: 'The work face on the page (its 2px ink edge carries it)' },
  // The signal band
  { fg: '--paper', bg: '--signal', floor: 7, use: 'Signal: text, links, glyphs, the mark, the pressed border, the focus ring; the primary label on paper' },
  { fg: '--muted-on-signal', bg: '--signal', floor: 4.5, use: 'Signal: secondary text; the quiet label and edge' },
  { fg: '--muted-on-signal', bg: '--signal-deep', floor: 4.5, use: 'Signal: secondary text on a hovered outline' },
  { fg: '--paper-hover', bg: '--signal', floor: 3, use: 'Signal: the primary hover and press fill' },
  { fg: '--coin', bg: '--signal', floor: 3, use: 'Signal: the Contribute fill and the coin mark' },
  { fg: '--coin-up', bg: '--signal', floor: 3, use: 'Signal: the Contribute hover and press fill' },
  { fg: '--ink', bg: '--coin-up', floor: 7, use: 'Signal: the Contribute hover label' },
  { fg: '--line-on-signal', bg: '--signal', floor: 0, use: 'Signal: hairlines' },
  // The ink band
  { fg: '--paper', bg: '--ink', floor: 7, use: 'Ink: text, links, glyphs, the mark, edges, the pressed border, the focus ring, the avatar disc' },
  { fg: '--muted-on-ink', bg: '--ink', floor: 4.5, use: 'Ink: secondary text, the quiet label' },
  { fg: '--muted-on-ink', bg: '--ink-hover', floor: 4.5, use: 'Ink: secondary text on a hovered outline' },
  { fg: '--paper', bg: '--ink-hover', floor: 7, use: 'Ink: the outline hover and press label' },
  { fg: '--field', bg: '--ink', floor: 3, use: 'Ink: field and quiet edges' },
  { fg: '--paper-hover', bg: '--ink', floor: 3, use: 'Ink: the primary hover and press fill' },
  { fg: '--coin', bg: '--ink', floor: 3, use: 'Ink: the Contribute fill and the coin mark' },
  { fg: '--coin-down', bg: '--ink', floor: 3, use: 'Ink: the Contribute hover and press fill' },
  { fg: '--line-on-ink', bg: '--ink', floor: 0, use: 'Ink: hairlines' },
  // Banned: each measures below its floor, so a rule keeps it off the page.
  { fg: '--signal', bg: '--ink', floor: 3, banned: true, use: 'Signal never touches ink: band 2 is always paper' },
  { fg: '--ink', bg: '--signal', floor: 3, banned: true, use: 'No ink text on signal; the Contribute edge merges there and its amber carries it' },
  { fg: '--muted', bg: '--signal', floor: 4.5, banned: true, use: 'Secondary text on signal is muted-on-signal' },
  { fg: '--suit-game', bg: '--signal', floor: 3, banned: true, use: 'Suit tiles reset to none on signal' },
  { fg: '--suit-game', bg: '--ink', floor: 3, banned: true, use: 'Suit tiles reset to none on ink' },
];

/** Marks that can share a card index or a row: each pair stays at least 25 delta-E apart under normal vision and three colour-vision simulations. */
export const MARK_PAIRS: readonly (readonly [string, string])[] = [
  ['--suit-game', '--suit-studio'],
  ['--suit-game', '--live'],
  ['--suit-studio', '--live'],
  ['--live', '--coin'],
  ['--suit-game', '--coin'],
  ['--suit-studio', '--coin'],
];
