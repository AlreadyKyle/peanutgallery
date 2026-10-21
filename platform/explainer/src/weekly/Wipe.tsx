import { Fragment } from 'react';
import { pop, progress } from '../anim';
import { C, CREATURE, EASE_IN_OUT, FONT } from '../theme';
import type { WeeklyGeometry } from './geometry';
import { WIPE_AT, type Layout } from './layout';

// The wipe between segments, in each one's own half bar (layout.ts WIPE): two of the agents' colours
// and then ink sweep across on a slant, the next segment's number and name ride in on the ink band,
// and the bands sweep on out to the right, ink first, so the words' column clears before the
// headline rises. It sits under the top bar, whose counter moves on as the number lands.

const BANDS = [CREATURE.yellow, CREATURE.pink, C.ink] as const;
const SLANT = 14;

export function Wipe({ frame, g, plan }: { frame: number; g: WeeklyGeometry; plan: Layout }) {
  const { width: W, height: H } = g.format;
  const lean = Math.tan((SLANT * Math.PI) / 180) * H;
  const span = W + lean * 2;
  const wipe = plan.wipes.find((w) => {
    const f = frame - (w.start - WIPE_AT.lead);
    return f >= 0 && f < WIPE_AT.out + WIPE_AT.stagger * (BANDS.length - 1) + WIPE_AT.band;
  });
  if (wipe === undefined) return null;
  const f = frame - (wipe.start - WIPE_AT.lead);
  const segment = plan.segments[wipe.segment]!;
  const big = 132;
  const chip = Math.round(big * 1.5);
  const numberK = pop(f, WIPE_AT.pop, 'bouncy');
  const titleK = progress(f, WIPE_AT.pop + 6, 18);
  const words = segment.title.split(' ');
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {BANDS.map((colour, k) => {
        const inK = progress(f, k * WIPE_AT.stagger, WIPE_AT.band, EASE_IN_OUT);
        const outK = progress(f, WIPE_AT.out + (BANDS.length - 1 - k) * WIPE_AT.stagger, WIPE_AT.band, EASE_IN_OUT);
        const x = -span + inK * span + outK * span;
        return (
          <div key={k} style={{ position: 'absolute', top: 0, left: -lean, width: span, height: H, transform: `translateX(${x}px)` }}>
            <div style={{ position: 'absolute', inset: 0, background: colour, transform: `skewX(${-SLANT}deg)` }} />
            {k === BANDS.length - 1 ? (
              <div style={{ position: 'absolute', left: lean, top: 0, width: W, height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: Math.round(big * 0.36), fontFamily: FONT, color: C.paper }}>
                <span
                  style={{
                    display: 'inline-grid',
                    placeItems: 'center',
                    width: chip,
                    height: chip,
                    boxSizing: 'border-box',
                    border: `8px solid ${C.paper}`,
                    borderRadius: 28,
                    fontSize: big,
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums',
                    transform: `scale(${numberK}) rotate(${(1 - numberK) * -12}deg)`,
                  }}
                >
                  {wipe.segment + 1}
                </span>
                <span style={{ fontSize: big, fontWeight: 700, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>
                  {words.map((word, i) => {
                    const k2 = progress(f, WIPE_AT.pop + 6 + i * 3, 18);
                    return (
                      <Fragment key={i}>
                        <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.12em', marginBottom: '-0.12em' }}>
                          <span style={{ display: 'inline-block', transform: `translateY(${(1 - k2) * 108}%)`, opacity: Math.min(1, titleK * 2) }}>{word}</span>
                        </span>
                        {i < words.length - 1 ? ' ' : null}
                      </Fragment>
                    );
                  })}
                </span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
