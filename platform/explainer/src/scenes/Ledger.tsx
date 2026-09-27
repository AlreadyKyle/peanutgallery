import { useCurrentFrame } from 'remotion';
import { at, progress } from '../anim';
import { Stage } from '../components/Stage';
import { ledger } from '../data';
import type { Format } from '../format';
import { C, EASE_IN, EASE_IN_OUT, FONT } from '../theme';
import { CHOREO } from '../timeline';

// Where the money goes: /how-it-works' worked example, $5.00 paid with the default split, as rows.
// Each row's bar is its share of the $5.00, drawn like the funding bar: coin with ink rules.

const ROW = 88;
const TOP = 176;
const BAR = { x: 400, w: 330 };

export function Ledger({ format }: { format: Format }) {
  const frame = useCurrentFrame();
  const c = CHOREO.ledger;
  const panel = progress(frame, at(c.panel), 24);
  const out = progress(frame, at(c.exit), 26, EASE_IN);
  const max = ledger.rows[0]!.usd;
  return (
    <Stage format={format}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 900, fontFamily: FONT, color: C.ink, opacity: 1 - out, transform: `translateY(${(1 - panel) * 30 + out * -30}px)` }}>
        <div style={{ position: 'absolute', left: 0, top: 30, fontSize: 40, fontWeight: 700, opacity: panel }}>{ledger.heading}</div>
        <div style={{ position: 'absolute', left: 0, top: 96, fontSize: 26, color: C.muted, opacity: panel }}>{ledger.caption}</div>
        {ledger.rows.map((row, i) => {
          const t = at(c.rows[i]!);
          const k = progress(frame, t, 18);
          const grow = progress(frame, t + 4, 26, EASE_IN_OUT);
          const last = i === ledger.rows.length - 1;
          return (
            <div
              key={row.label}
              style={{
                position: 'absolute',
                left: 0,
                top: TOP + i * ROW,
                width: 900,
                height: ROW,
                boxSizing: 'border-box',
                borderTop: `2px solid ${C.line}`,
                borderBottom: last ? `2px solid ${C.line}` : undefined,
                display: 'flex',
                alignItems: 'center',
                opacity: k,
                transform: `translateY(${(1 - k) * 18}px)`,
              }}
            >
              <span style={{ width: BAR.x - 20, fontSize: 28, fontWeight: last ? 700 : 400 }}>{row.label}</span>
              <span style={{ position: 'relative', width: BAR.w, height: 22 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    height: 22,
                    width: Math.max(6, (BAR.w * row.usd * grow) / max),
                    boxSizing: 'border-box',
                    background: C.coin,
                    border: `2px solid ${C.ink}`,
                    borderRight: `4px solid ${C.ink}`,
                    borderRadius: 5,
                  }}
                />
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 28, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{row.figure}</span>
            </div>
          );
        })}
      </div>
    </Stage>
  );
}
