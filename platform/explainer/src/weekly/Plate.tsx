import { at, pop, progress, tween } from '../anim';
import { Glyph } from '../components/Glyph';
import { Mark, type MarkTimes } from '../components/Mark';
import { plateLockup } from '../components/TopBar';
import { labels } from '../data';
import { C, EASE_IN_OUT, FONT } from '../theme';
import type { WeeklyGeometry } from './geometry';
import { CLOSE, PLATE, segmentShown, type Layout } from './layout';
import type { WeekProps } from './schema';

// The explainer's black plate, on the weekly clock: the mark builds up in the middle, the plate folds
// into the site's top bar, the bar counts the segments on its right, and the plate unfolds again for
// the closing lines and the address.

const FOLD = 54;

function measure(text: string, size: number): number {
  const canvas = document.createElement('canvas').getContext('2d');
  if (canvas === null) return text.length * size * 0.68;
  canvas.font = `700 ${size}px ${FONT}`;
  return canvas.measureText(text).width;
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** The closing lines' type size and line height, and the room the lines and address take. */
function closing(g: WeeklyGeometry, count: number) {
  const size = g.format.name === 'wide' ? 62 : 56;
  const line = Math.round(size * 1.32);
  const gap = 64;
  const address = 28 + Math.round(size * 0.62 * 1.3);
  return { size, line, gap, address, height: gap + line * count + address };
}

function closingTop(g: WeeklyGeometry, count: number): number {
  return (g.format.height - plateLockup(g.format).height - closing(g, count).height) / 2;
}

export function Plate({ frame, g, plan, week }: { frame: number; g: WeeklyGeometry; plan: Layout; week: WeekProps }) {
  const format = g.format;
  const { width: W, height: H, bar, margin } = format;
  const count = week.outro.lines.length;
  const fold = progress(frame, at(PLATE.collapse), FOLD, EASE_IN_OUT);
  const unfold = progress(frame, plan.outro + at(CLOSE.expand), FOLD, EASE_IN_OUT);
  const k = fold - unfold;
  const height = lerp(H, bar, k);

  const lockup = plateLockup(format);
  const plateWord = lockup.word;
  const barWord = 26;
  const wordWidth = measure(labels.wordmark, plateWord);
  const { P, gap } = lockup;
  const plateTop = lerp(lockup.top, closingTop(g, count), unfold);
  const b = format.mark.bar;
  const markH = lerp(P, b, k);
  const markLeft = lerp(W / 2 - (P * 0.8) / 2, margin, Math.pow(k, 0.6));
  const markTop = lerp(plateTop, (bar - b) / 2, k);
  const wordScale = lerp(1, barWord / plateWord, k);
  const wordLeft = lerp(W / 2 - wordWidth / 2, margin + b * 0.8 + 20, Math.pow(k, 1.4));
  const wordTop = lerp(plateTop + P + gap, bar / 2 - barWord / 2, Math.pow(k, 1.8));

  const times: MarkTimes = {
    cabinet: at(PLATE.cabinet),
    screen: at(PLATE.screen),
    eyes: [at(PLATE.eyes[0]), at(PLATE.eyes[1])],
    slot: at(PLATE.slot),
    glance: at(PLATE.glance),
    blink: at(PLATE.blink),
  };
  // The mark blinks as each segment starts, and once on the closing plate.
  const blinks = [...plan.segments.map((s) => s.start + 6), plan.outro + at(CLOSE.blink)];
  const letters = labels.wordmark.split('');

  // The counter moves on as each wipe shows the next segment's number.
  const shown = plan.segments.map((_, i) => frame >= segmentShown(plan, i)).lastIndexOf(true);
  const segIndex = frame >= plan.outro ? -1 : shown;
  const railIn = progress(frame, plan.segments[0]!.start - 24, 24) - progress(frame, plan.outro - 24, 24);

  const lines = closing(g, count);
  const linesTop = closingTop(g, count) + lockup.height + lines.gap;
  const local = frame - plan.outro;

  return (
    <>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height, background: C.ink, overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: markLeft, top: markTop }}>
          <Mark height={markH} colour={C.paper} ground={C.ink} frame={frame} times={times} blinks={blinks} />
        </div>
        <div
          style={{
            position: 'absolute',
            left: wordLeft,
            top: wordTop,
            transform: `scale(${wordScale})`,
            transformOrigin: 'top left',
            fontFamily: FONT,
            fontWeight: 700,
            fontSize: plateWord,
            lineHeight: 1,
            color: C.paper,
            whiteSpace: 'pre',
          }}
        >
          {letters.map((letter, i) => (
            <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top' }}>
              <span style={{ display: 'inline-block', transform: `translateY(${tween(frame, at(PLATE.word) + i * 2, 18, 110, 0)}%)` }}>{letter}</span>
            </span>
          ))}
        </div>
        {railIn > 0 ? (
          <div style={{ position: 'absolute', right: margin, top: (bar - 38) / 2, display: 'flex', gap: 10, opacity: railIn, fontFamily: FONT }}>
            {plan.segments.map((s, i) => {
              const active = i === segIndex;
              const done = segIndex > i;
              const on = active ? progress(frame, segmentShown(plan, i), 12) : 0;
              return (
                <span
                  key={s.title}
                  style={{
                    display: 'inline-grid',
                    placeItems: 'center',
                    width: 38,
                    height: 38,
                    boxSizing: 'border-box',
                    borderRadius: 8,
                    border: `2px solid ${active || done ? C.paper : C.lineOnInk}`,
                    background: active ? C.paper : 'transparent',
                    color: active ? C.ink : done ? C.paper : C.mutedOnInk,
                    fontSize: 19,
                    fontWeight: 700,
                    transform: `scale(${1 + 0.12 * Math.sin(on * Math.PI)})`,
                  }}
                >
                  {i + 1}
                </span>
              );
            })}
          </div>
        ) : null}
      </div>
      {local >= 0 ? (
        <div style={{ position: 'absolute', left: 0, top: linesTop, width: W, fontFamily: FONT, color: C.paper, textAlign: 'center' }}>
          {week.outro.lines.map((line, i) => {
            const p = pop(frame, plan.outro + at(CLOSE.lines[i] ?? CLOSE.lines[CLOSE.lines.length - 1]!), 'soft');
            return (
              <div
                key={line.text}
                style={{
                  height: lines.line,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: Math.round(lines.size * 0.34),
                  fontSize: lines.size,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  opacity: Math.min(1, p * 1.4),
                  transform: `translateY(${(1 - p) * 30}px)`,
                }}
              >
                <Glyph name={line.glyph} size={Math.round(lines.size * 0.92)} />
                {line.text}
              </div>
            );
          })}
          <div
            style={{
              marginTop: 28,
              fontSize: Math.round(lines.size * 0.62),
              fontWeight: 600,
              color: C.mutedOnInk,
              opacity: progress(frame, plan.outro + at(CLOSE.address), 20),
              transform: `translateY(${(1 - progress(frame, plan.outro + at(CLOSE.address), 20)) * 14}px)`,
            }}
          >
            {week.outro.address}
          </div>
        </div>
      ) : null}
    </>
  );
}
