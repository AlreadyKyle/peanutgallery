import type { CSSProperties } from 'react';
import { STATE_TAGS, SUITS } from '../../../site/src/components/Glyph';
import { C, FONT } from '../theme';
import { Glyph } from './Glyph';

// The card as the site draws it (Card.tsx, DESIGN.md The card), scaled up for the screen: a white
// face with an ink edge and no shadow, the corner index with the suit and the state, the title, and
// the funding bar pinned to the bottom. Building and Being checked take the pale work face. Every
// state carries its word and glyph. The suit is its tile and cartridge alone: the video names no game
// (PLAN.md §10 decision 57).

export type CardFace = 'open' | 'funded' | 'building' | 'checks' | 'live';

export const CARD = { width: 520, height: 330 } as const;

type Props = {
  title: string;
  face: CardFace;
  /** How full the funding bar is, 0 to 1. */
  fill?: number;
  /** A muted line under the bar. */
  meta?: string | null;
  /** The Live stamp coming down: 0 is raised and large, 1 is pressed on at -3 degrees. */
  stamp?: number;
  /** The Building gear's turn in degrees. */
  gear?: number;
  /** A funding bar outline pulse, 0 to 1, while the words name the target. */
  pulse?: number;
  style?: CSSProperties;
};

export function Card({ title, face, fill = 0, meta = null, stamp = 1, gear = 0, pulse = 0, style }: Props) {
  const state = STATE_TAGS[face];
  const suit = SUITS.game;
  const work = face === 'building' || face === 'checks';
  const live = face === 'live';
  return (
    <div
      style={{
        position: 'absolute',
        width: CARD.width,
        height: CARD.height,
        boxSizing: 'border-box',
        padding: 34,
        border: `4px solid ${C.ink}`,
        borderRadius: 30,
        background: work ? C.work : C.paper,
        color: C.ink,
        fontFamily: FONT,
        display: 'flex',
        flexDirection: 'column',
        ...style,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', height: 34, fontSize: 22, fontWeight: 600 }}>
        <span style={{ display: 'inline-grid', placeItems: 'center', width: 34, height: 34, borderRadius: 7, background: C.suitGame, color: C.paper }}>
          <Glyph name={suit.glyph} size={23} />
        </span>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 9,
            ...(live
              ? {
                  padding: '4px 14px',
                  border: `4px solid ${C.live}`,
                  borderRadius: 11,
                  transform: `rotate(${-3 - (1 - stamp) * 9}deg) scale(${1 + (1 - stamp) * 1.6})`,
                  opacity: Math.min(1, stamp * 3),
                }
              : {}),
          }}
        >
          <span style={{ display: 'inline-flex', transform: face === 'building' ? `rotate(${gear}deg)` : undefined }}>
            <Glyph name={state.glyph} size={26} colour={live ? C.live : undefined} />
          </span>
          {state.word}
        </span>
      </div>
      <div style={{ marginTop: 24, fontSize: 34, lineHeight: 1.2, fontWeight: 700, textWrap: 'balance' } as CSSProperties}>{title}</div>
      <div style={{ marginTop: 'auto' }}>
        {live ? null : (
          <div
            style={{
              position: 'relative',
              height: 18,
              border: `2px solid ${C.ink}`,
              borderRadius: 7,
              background: C.paper,
              overflow: 'hidden',
              outline: pulse > 0.02 ? `${3 * pulse}px solid ${C.ink}` : undefined,
              outlineOffset: 4,
            }}
          >
            {fill > 0 ? (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: C.coin,
                  borderRight: `3px solid ${C.ink}`,
                  transform: `translateX(${(Math.min(1, fill) - 1) * 100}%)`,
                }}
              />
            ) : null}
          </div>
        )}
        {meta === null ? null : <div style={{ marginTop: 12, fontSize: 22, color: C.muted, fontWeight: 400 }}>{meta}</div>}
      </div>
    </div>
  );
}
