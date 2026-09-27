import { progress } from '../anim';
import { C, FONT } from '../theme';

// The agent's steps as the site lists them (EventList.tsx): one fixed line each, "Builder A read a
// file", with hairlines between. A new row slides in at its time; past `rows` visible, the list
// scrolls up by one.

const ROW = 60;

export function EventLog({ rows, frame, width, visible = 4 }: { rows: readonly { text: string; at: number }[]; frame: number; width: number; visible?: number }) {
  const scrolled = rows.reduce((sum, row, i) => (i < visible ? sum : sum + progress(frame, row.at, 16)), 0);
  return (
    <div style={{ position: 'absolute', width, height: ROW * visible, overflow: 'hidden', fontFamily: FONT }}>
      <div style={{ transform: `translateY(${-scrolled * ROW}px)` }}>
        {rows.map((row, i) => {
          const k = progress(frame, row.at, 16);
          return (
            <div
              key={i}
              style={{
                height: ROW,
                boxSizing: 'border-box',
                display: 'flex',
                alignItems: 'center',
                borderTop: `2px solid ${C.line}`,
                fontSize: 25,
                fontWeight: 600,
                color: C.ink,
                opacity: k,
                transform: `translateY(${(1 - k) * 24}px)`,
                whiteSpace: 'nowrap',
              }}
            >
              {row.text}
            </div>
          );
        })}
      </div>
    </div>
  );
}
