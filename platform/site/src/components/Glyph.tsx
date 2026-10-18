import type { ReactNode } from 'react';
import type { Face } from '../lib/cards';
import type { Rarity, Suit } from '../lib/community-types';
import { copy } from '../lib/copy';
import { suitTile } from '../lib/suits';

/**
 * The site's glyphs: 16px, drawn by code in currentColor, so each follows its text on paper or ink
 * and forced colours map it to CanvasText. A glyph always sits beside a word that says the same
 * thing, so each is aria-hidden. The coin mark is money and lives in Funding.tsx.
 */

export type GlyphName =
  | 'cartridge'
  | 'browser'
  | 'coin-outline'
  | 'flag'
  | 'full-bar'
  | 'gear'
  | 'checklist'
  | 'stamp'
  | 'pause'
  | 'crossed-card'
  | 'check'
  | 'play'
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down'
  | 'clock'
  | 'pencil'
  | 'spark'
  | 'blocks'
  | 'machine'
  | 'team'
  | 'gem-common'
  | 'gem-uncommon'
  | 'gem-rare'
  | 'gem-legendary'
  | 'plane'
  | 'box'
  | 'badge'
  | 'milestone'
  | 'seed'
  | 'thumb-up'
  | 'thumb-down';

function gearTeeth(): ReactNode[] {
  return Array.from({ length: 8 }, (_, i) => {
    const angle = (Math.PI / 4) * i;
    const x1 = 8 + 4.75 * Math.cos(angle);
    const y1 = 8 + 4.75 * Math.sin(angle);
    const x2 = 8 + 6.75 * Math.cos(angle);
    const y2 = 8 + 6.75 * Math.sin(angle);
    return <path key={i} className="glyph-line" d={`M${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}`} />;
  });
}

const DRAWINGS: Record<GlyphName, ReactNode> = {
  // The new game suit (docs/specs/final-state.md, Card suits): a four-point spark, a game not built yet.
  spark: <path className="glyph-line" d="M8 1.75c.6 3.4 2.85 5.65 6.25 6.25-3.4.6-5.65 2.85-6.25 6.25-.6-3.4-2.85-5.65-6.25-6.25 3.4-.6 5.65-2.85 6.25-6.25z" />,
  // The platform suit: three stacked blocks, a feature of the site the community asked for.
  blocks: (
    <>
      <path className="glyph-line" d="M1.75 9.25h6v5h-6zM8.25 9.25h6v5h-6zM5 4.25h6v5H5z" />
    </>
  ),
  // The machine suit: the mark, a small machine with two eyes.
  machine: (
    <>
      <path className="glyph-line" d="M2.25 4.75h11.5v8.5H2.25z" />
      <circle className="glyph-fill" cx={5.75} cy={9} r={1.15} />
      <circle className="glyph-fill" cx={10.25} cy={9} r={1.15} />
      <path className="glyph-line" d="M8 4.75v-2.5" />
    </>
  ),
  // The studio suit: two heads side by side, the agent team.
  team: (
    <>
      <circle className="glyph-line" cx={5} cy={7.5} r={2.75} />
      <circle className="glyph-line" cx={11} cy={7.5} r={2.75} />
      <path className="glyph-line" d="M1.75 14.25c.5-2 1.75-3 3.25-3s2.75 1 3 3c.25-2 1.5-3 3-3s2.75 1 3.25 3" />
    </>
  ),
  // Rarity (docs/specs/final-state.md, Rarity): one gem cut per rarity, a word always beside it.
  'gem-common': <circle className="glyph-line" cx={8} cy={8} r={4.75} />,
  'gem-uncommon': <path className="glyph-line" d="M8 2.5l5.5 5.5L8 13.5 2.5 8z" />,
  'gem-rare': (
    <>
      <path className="glyph-line" d="M8 2.5l5.5 5.5L8 13.5 2.5 8z" />
      <path className="glyph-fill" d="M8 5.5l2.5 2.5L8 10.5 5.5 8z" />
    </>
  ),
  'gem-legendary': <path className="glyph-line" d="M8 1.75l1.85 3.95 4.3.5-3.2 2.95.85 4.25L8 11.25 4.2 13.4l.85-4.25-3.2-2.95 4.3-.5z" />,
  // The feed: a suggestion arrives as a paper plane; a ship leaves as a box.
  plane: <path className="glyph-line" d="M1.75 7.5l12.5-5-3.5 11.25-3-4.25zM7.75 9.5l6.5-7" />,
  box: (
    <>
      <path className="glyph-line" d="M2.25 5.25L8 2.5l5.75 2.75v6L8 14l-5.75-2.75z" />
      <path className="glyph-line" d="M2.25 5.25L8 8l5.75-2.75M8 8v6" />
    </>
  ),
  badge: (
    <>
      <circle className="glyph-line" cx={8} cy={6.25} r={4.25} />
      <path className="glyph-line" d="M5.5 9.75l-1.25 4.5L8 12.75l3.75 1.5-1.25-4.5" />
    </>
  ),
  milestone: <path className="glyph-line" d="M3.25 14.25V1.75M3.25 2.25h9l-2 2.75 2 2.75h-9" />,
  seed: (
    <>
      <path className="glyph-line" d="M8 14.25V8.5" />
      <path className="glyph-line" d="M8 8.5C8 5 10.5 3 13.75 3c0 3.25-2.5 5.5-5.75 5.5zM8 10.5c0-2.75-2-4.5-5.75-4.5 0 2.75 2 4.5 5.75 4.5z" />
    </>
  ),
  'thumb-up': <path className="glyph-line" d="M8 2.25l5.25 6H10v5.5H6v-5.5H2.75z" />,
  'thumb-down': <path className="glyph-line" d="M8 13.75l5.25-6H10v-5.5H6v5.5H2.75z" />,
  // The game suit, and Play buttons: a cartridge with a label window and contacts.
  cartridge: (
    <>
      <path className="glyph-line" d="M3.75 1.75h6.75l1.75 1.75v10.75h-8.5z" />
      <path className="glyph-line" d="M6 4.5h4.25v3.25H6z" />
      <path className="glyph-line" d="M6 11.25v1.25M8 11.25v1.25M10 11.25v1.25" />
    </>
  ),
  // The studio suit: a browser window.
  browser: (
    <>
      <path className="glyph-line" d="M1.75 2.75h12.5v10.5H1.75z" />
      <path className="glyph-line" d="M1.75 5.75h12.5" />
      <circle className="glyph-fill" cx={3.75} cy={4.25} r={0.7} />
      <circle className="glyph-fill" cx={5.75} cy={4.25} r={0.7} />
    </>
  ),
  // Open for funding: a coin in outline, so it never reads as the money mark itself.
  'coin-outline': (
    <>
      <circle className="glyph-line" cx={8} cy={8} r={6.25} />
      <circle className="glyph-line" cx={8} cy={8} r={3} />
    </>
  ),
  // Picked by the board.
  flag: (
    <>
      <path className="glyph-line" d="M3.5 14.5V1.75" />
      <path className="glyph-fill" d="M3.5 1.75h9.25l-2.5 3.25 2.5 3.25H3.5z" />
    </>
  ),
  // Funded: a tiny full funding bar, the coin fill inside the text-colour outline (styles.css
  // .glyph-money). With the coin mark, the only fixed fill: the bar it draws is money.
  'full-bar': <path className="glyph-line glyph-money" d="M1.75 5.25h12.5v5.5H1.75z" />,
  // Building: a gear.
  gear: (
    <>
      <circle className="glyph-line" cx={8} cy={8} r={4.25} />
      <circle className="glyph-line" cx={8} cy={8} r={1.5} />
      {gearTeeth()}
    </>
  ),
  // Being checked: a checklist box.
  checklist: (
    <>
      <path className="glyph-line" d="M1.75 1.75h12.5v12.5H1.75z" />
      <path className="glyph-line" d="M4 5.25l1 1 2-2M8.75 5.25h3.25M4 10.25l1 1 2-2M8.75 10.25h3.25" />
    </>
  ),
  // Live: a checked stamp.
  stamp: (
    <>
      <path className="glyph-line" d="M1.75 3.25h12.5v9.5H1.75z" />
      <path className="glyph-line" d="M5 8l2 2 4-4" />
    </>
  ),
  // Paused: two bars.
  pause: <path className="glyph-fill" d="M3.75 2.5h3v11h-3zM9.25 2.5h3v11h-3z" />,
  // Not built: a crossed card.
  'crossed-card': (
    <>
      <path className="glyph-line" d="M3.25 1.75h9.5v12.5h-9.5z" />
      <path className="glyph-line" d="M5.75 5.5l4.5 5M10.25 5.5l-4.5 5" />
    </>
  ),
  // The pressed state of a toggle or chip.
  check: <path className="glyph-line" d="M2.75 8.5l3.5 3.5 7-7.25" />,
  // Play the explainer video.
  play: <path className="glyph-fill" d="M4.75 2.5v11l8.75-5.5z" />,
  'arrow-right': <path className="glyph-line" d="M2.5 8h11M9 3.5 13.5 8 9 12.5" />,
  'arrow-left': <path className="glyph-line" d="M13.5 8h-11M7 3.5 2.5 8 7 12.5" />,
  'arrow-up': <path className="glyph-line" d="M8 13.5v-11M3.5 7 8 2.5 12.5 7" />,
  'arrow-down': <path className="glyph-line" d="M8 2.5v11M3.5 9 8 13.5 12.5 9" />,
  // Planned: on the roadmap, not open yet (home's Next up lane).
  clock: (
    <>
      <circle className="glyph-line" cx="8" cy="8" r="5.75" />
      <path className="glyph-line" d="M8 4.75V8l2.5 1.75" />
    </>
  ),
  // An agent drafting a card (home's Next up lane).
  pencil: (
    <>
      <path className="glyph-line" d="M10.5 2.75l2.75 2.75-7.75 7.75H2.75v-2.75z" />
      <path className="glyph-line" d="M9 4.25l2.75 2.75" />
    </>
  ),
};

export const GLYPH_NAMES = Object.keys(DRAWINGS) as GlyphName[];

export function Glyph({ name }: { name: GlyphName }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false" data-glyph={name}>
      {DRAWINGS[name]}
    </svg>
  );
}

/**
 * A suit as a tag: its glyph in a tile of the suit's colour, then its label (DESIGN.md, Suits). The
 * tile is drawn on paper and the work face only; the signal and ink bands reset it by role.
 */
export function SuitTag({ suit }: { suit: Suit }) {
  return (
    <span className="tag" data-suit={suitTile(suit)} data-suit-key={suit}>
      <span className="suit-tile">
        <Glyph name={SUITS[suit].glyph} />
      </span>
      {SUITS[suit].label}
    </span>
  );
}

/** A state as a tag: its glyph and its word, never colour alone. Live's glyph takes the Live mark. */
export function StateTag({ face, stamp = false }: { face: Face; stamp?: boolean }) {
  const state = STATE_TAGS[face];
  return (
    <span className={stamp ? 'tag tag-stamp' : 'tag'} data-state={face}>
      <Glyph name={state.glyph} />
      {state.word}
    </span>
  );
}

/**
 * The suits (docs/specs/final-state.md, Card suits): five, each a word and a glyph of its own. A card
 * without a suit takes its folder's (lib/suits.ts). The cartridge appears only on the game suit and on
 * Play buttons. The two game suits share the game tile and the rest the studio tile; the glyph and
 * the word tell them apart.
 */
export const SUITS: Record<Suit, { glyph: GlyphName; label: string }> = {
  game: { glyph: 'cartridge', label: copy.categories.game },
  new_game: { glyph: 'spark', label: copy.categories.new_game },
  studio: { glyph: 'team', label: copy.categories.studio },
  platform: { glyph: 'browser', label: copy.categories.platform },
  machine: { glyph: 'machine', label: copy.categories.machine },
};

/** Each rarity's word and gem (docs/specs/final-state.md, Rarity): drawn on the card's face, never colour alone. */
export const RARITY_TAGS: Record<Rarity, { glyph: GlyphName; word: string }> = {
  common: { glyph: 'gem-common', word: copy.rarity.common },
  uncommon: { glyph: 'gem-uncommon', word: copy.rarity.uncommon },
  rare: { glyph: 'gem-rare', word: copy.rarity.rare },
  legendary: { glyph: 'gem-legendary', word: copy.rarity.legendary },
};

export function RarityTag({ rarity }: { rarity: Rarity }) {
  return (
    <span className="tag rarity-tag" data-rarity={rarity}>
      <Glyph name={RARITY_TAGS[rarity].glyph} />
      {RARITY_TAGS[rarity].word}
    </span>
  );
}

/** Each face's state word and glyph. A word and a glyph, never colour alone. */
export const STATE_TAGS: Record<Face, { glyph: GlyphName; word: string }> = {
  open: { glyph: 'coin-outline', word: copy.statusOpen },
  picked: { glyph: 'flag', word: copy.statusPicked },
  funded: { glyph: 'full-bar', word: copy.statusFunded },
  building: { glyph: 'gear', word: copy.statusBuilding },
  checks: { glyph: 'checklist', word: copy.statusGated },
  live: { glyph: 'stamp', word: copy.statusLive },
  paused: { glyph: 'pause', word: copy.statusPaused },
  rejected: { glyph: 'crossed-card', word: copy.statusRejected },
  planned: { glyph: 'clock', word: copy.statusPlanned },
};
