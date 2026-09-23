import type { ReactNode } from 'react';
import type { CardCategory, Face } from '../lib/cards';
import { copy } from '../lib/copy';

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
  | 'arrow-right'
  | 'arrow-left'
  | 'arrow-up'
  | 'arrow-down';

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
  // Funded: a full bar.
  'full-bar': (
    <>
      <path className="glyph-line" d="M1.75 5.25h12.5v5.5H1.75z" />
      <path className="glyph-fill" d="M3.5 7h9v2h-9z" />
    </>
  ),
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
  'arrow-right': <path className="glyph-line" d="M2.5 8h11M9 3.5 13.5 8 9 12.5" />,
  'arrow-left': <path className="glyph-line" d="M13.5 8h-11M7 3.5 2.5 8 7 12.5" />,
  'arrow-up': <path className="glyph-line" d="M8 13.5v-11M3.5 7 8 2.5 12.5 7" />,
  'arrow-down': <path className="glyph-line" d="M8 2.5v11M3.5 9 8 13.5 12.5 9" />,
};

export const GLYPH_NAMES = Object.keys(DRAWINGS) as GlyphName[];

export function Glyph({ name }: { name: GlyphName }) {
  return (
    <svg className="glyph" viewBox="0 0 16 16" width={16} height={16} aria-hidden="true" focusable="false" data-glyph={name}>
      {DRAWINGS[name]}
    </svg>
  );
}

/** The suits: two, from a card's folder. The cartridge appears only here and on Play buttons. */
export const SUITS: Record<CardCategory, { glyph: GlyphName; label: string }> = {
  game: { glyph: 'cartridge', label: copy.categories.game },
  studio: { glyph: 'browser', label: copy.categories.studio },
};

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
};
