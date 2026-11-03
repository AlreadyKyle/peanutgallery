import React from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { avatarFeatures, avatarParts } from './site/Avatar';
import { MARK_PATH } from './site/Mark';
import { C, CREATURE, FONT, LABEL } from './theme';

// The site's objects, drawn the way docs/BRAND.md and platform/site/DESIGN.md draw them: the card
// (paper face, 2px ink edge, 16px corners, no shadow), suit and state tags (a glyph beside a word,
// never colour alone), the coin (money only), the section index (a 2px rule over a mono number).

export function Avatar({ note, size, asleep = false }: { note: string; size: number; asleep?: boolean }) {
  const features = avatarFeatures(note);
  const style = { '--avatar-fill': CREATURE[features.colour], display: 'block', overflow: 'visible' } as CSSProperties;
  return (
    <svg viewBox="8 16 104 104" width={size} height={size} style={style} aria-hidden="true">
      {avatarParts(features, asleep)}
    </svg>
  );
}

export function Mark({ size, color }: { size: number; color: string }) {
  return (
    <svg viewBox="4 2 24 30" width={(size * 24) / 30} height={size} aria-hidden="true" style={{ display: 'block' }}>
      <path fill={color} fillRule="evenodd" d={MARK_PATH} />
    </svg>
  );
}

// The site's glyphs (platform/site/src/components/Glyph.tsx), on their 16-unit grid.
const GLYPHS = {
  cartridge: (
    <>
      <path className="glyph-line" d="M3.75 1.75h6.75l1.75 1.75v10.75h-8.5z" />
      <path className="glyph-line" d="M6 4.5h4.25v3.25H6z" />
      <path className="glyph-line" d="M6 11.25v1.25M8 11.25v1.25M10 11.25v1.25" />
    </>
  ),
  browser: (
    <>
      <path className="glyph-line" d="M1.75 2.75h12.5v10.5H1.75z" />
      <path className="glyph-line" d="M1.75 5.75h12.5" />
      <circle className="glyph-fill" cx={3.75} cy={4.25} r={0.7} />
      <circle className="glyph-fill" cx={5.75} cy={4.25} r={0.7} />
    </>
  ),
  pencil: (
    <>
      <path className="glyph-line" d="M10.5 2.75l2.75 2.75-7.75 7.75H2.75v-2.75z" />
      <path className="glyph-line" d="M9 4.25l2.75 2.75" />
    </>
  ),
  gear: (
    <>
      <circle className="glyph-line" cx={8} cy={8} r={4.25} />
      <circle className="glyph-line" cx={8} cy={8} r={1.5} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (Math.PI / 4) * i;
        return <path key={i} className="glyph-line" d={`M${8 + 4.75 * Math.cos(a)} ${8 + 4.75 * Math.sin(a)}L${8 + 6.75 * Math.cos(a)} ${8 + 6.75 * Math.sin(a)}`} />;
      })}
    </>
  ),
  checklist: (
    <>
      <path className="glyph-line" d="M1.75 1.75h12.5v12.5H1.75z" />
      <path className="glyph-line" d="M4 5.25l1 1 2-2M8.75 5.25h3.25M4 10.25l1 1 2-2M8.75 10.25h3.25" />
    </>
  ),
  stamp: (
    <>
      <path className="glyph-line" d="M1.75 3.25h12.5v9.5H1.75z" />
      <path className="glyph-line" d="M5 8l2 2 4-4" />
    </>
  ),
  share: (
    <>
      <path className="glyph-line" d="M8 10V2.5M4.75 5.5 8 2.25l3.25 3.25" />
      <path className="glyph-line" d="M3 8.5v5h10v-5" />
    </>
  ),
} satisfies Record<string, ReactNode>;
export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, size, color }: { name: GlyphName; size: number; color?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" style={{ display: 'block', color, flex: 'none' }}>
      {GLYPHS[name]}
    </svg>
  );
}

/** A mono label: index numbers and the machine's small labels. */
export function Label({ children, size = 26, color = C.ink, style }: { children: ReactNode; size?: number; color?: string; style?: CSSProperties }) {
  return <span style={{ ...LABEL, fontSize: size, color, ...style }}>{children}</span>;
}

/** The section index: a 2px rule in the text colour that draws in, with the number above the heading. */
export function IndexRule({ draw, width, color = C.ink }: { draw: number; width: number; color?: string }) {
  return <div style={{ width, height: 2, background: color, transform: `scaleX(${draw})`, transformOrigin: 'left center' }} />;
}

/** A suit tag: its glyph in a tile of the suit's colour, then its word. */
export function Suit({ suit, size = 22 }: { suit: 'game' | 'studio'; size?: number }) {
  const tile = Math.round(size * 1.35);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.4), fontFamily: FONT, fontSize: size, fontWeight: 600, color: C.ink }}>
      <span style={{ width: tile, height: tile, borderRadius: 4, background: suit === 'game' ? C.game : C.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.paper }}>
        <Glyph name={suit === 'game' ? 'cartridge' : 'browser'} size={Math.round(size * 0.95)} />
      </span>
      {suit === 'game' ? 'Game' : 'Studio'}
    </span>
  );
}

/** A state tag: glyph and word. Live is the stamp: its glyph and edge in the Live colour, the word in ink. */
export function State({ glyph, word, size = 22, stamp = false }: { glyph: GlyphName; word: string; size?: number; stamp?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: Math.round(size * 0.35), fontFamily: FONT, fontSize: size, fontWeight: 600, color: C.ink,
        ...(stamp ? { border: `3px solid ${C.live}`, borderRadius: 6, padding: `${Math.round(size * 0.2)}px ${Math.round(size * 0.45)}px` } : {}),
      }}
    >
      <Glyph name={glyph} size={Math.round(size * 1.05)} color={glyph === 'stamp' ? C.live : C.ink} />
      {word}
    </span>
  );
}

/** The coin: a coin circle with an ink rim. Money only. */
export function Coin({ size }: { size: number }) {
  return <div style={{ width: size, height: size, borderRadius: size / 2, background: C.coin, border: `${Math.max(2, size / 9)}px solid ${C.ink}`, boxSizing: 'border-box' }} />;
}

/** The funding bar: a 2px ink outline, the coin fill inside. */
export function FundingBar({ fill, height = 16 }: { fill: number; height?: number }) {
  return (
    <div style={{ height, border: `2px solid ${C.ink}`, borderRadius: 4, overflow: 'hidden', boxSizing: 'border-box' }}>
      <div style={{ width: '100%', height: '100%', background: C.coin, transform: `scaleX(${fill})`, transformOrigin: 'left center' }} />
    </div>
  );
}

/** The card: paper (or the work face while building), a 2px ink edge, 16px corners, no shadow. */
export function Card({ children, width, face = 'paper', pad = 28, style }: { children: ReactNode; width: number; face?: 'paper' | 'work'; pad?: number; style?: CSSProperties }) {
  return (
    <div style={{ width, padding: pad, boxSizing: 'border-box', background: face === 'work' ? C.work : C.paper, border: `2px solid ${C.ink}`, borderRadius: 16, fontFamily: FONT, color: C.ink, ...style }}>
      {children}
    </div>
  );
}
