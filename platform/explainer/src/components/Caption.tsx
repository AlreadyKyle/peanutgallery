import { Fragment, type CSSProperties } from 'react';
import { progress, tween } from '../anim';
import type { Format } from '../format';
import { C, EASE_IN, FONT } from '../theme';

// A scene's words: the step's number and heading (the six steps of /how-it-works), then the line,
// word by word. Each word rises out of its own slot, a few frames after the one before, and the
// block lifts away as the scene ends. Sentence case, upright, ink on paper or paper on ink.

const STAGGER = 3;
const RISE = 20;
const EXIT = 16;

type Props = {
  text: string;
  step: { number: number; heading: string } | null;
  frame: number;
  start: number;
  end: number;
  format: Format;
  onInk?: boolean;
  /** Centre the words in the frame (the closing plate) instead of the text column. */
  centred?: { y: number; width: number; size: number };
};

export function Caption({ text, step, frame, start, end, format, onInk = false, centred }: Props) {
  const words = text.split(' ');
  const exit = progress(frame, end - EXIT, EXIT, EASE_IN);
  const ink = onInk ? C.paper : C.ink;
  const size = centred?.size ?? format.text.size;
  const box: CSSProperties = centred
    ? { left: (format.width - centred.width) / 2, top: centred.y, width: centred.width, textAlign: 'center' }
    : {
        left: format.text.x,
        top: format.text.y,
        width: format.text.width,
        transform: format.text.anchor === 'centre' ? 'translateY(-50%)' : undefined,
      };
  const stepIn = progress(frame, start - 6, 18);
  return (
    <div style={{ position: 'absolute', ...box, fontFamily: FONT, color: ink }}>
      <div style={{ transform: `translateY(${-28 * exit}px)`, opacity: 1 - exit }}>
        {step === null ? null : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              marginBottom: 26,
              opacity: stepIn,
              transform: `translateX(${(1 - stepIn) * -24}px)`,
            }}
          >
            <span
              style={{
                display: 'inline-grid',
                placeItems: 'center',
                width: 48,
                height: 48,
                boxSizing: 'border-box',
                border: `3px solid ${ink}`,
                borderRadius: 10,
                fontSize: 26,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {step.number}
            </span>
            <span style={{ fontSize: 28, fontWeight: 600 }}>{step.heading}</span>
          </div>
        )}
        <div style={{ fontSize: size, lineHeight: 1.14, fontWeight: 700, letterSpacing: '-0.01em', textWrap: 'balance' } as CSSProperties}>
          {words.map((word, i) => {
            const t = start + i * STAGGER;
            const y = tween(frame, t, RISE, 108, 0);
            const o = tween(frame, t, RISE * 0.6, 0, 1);
            return (
              <Fragment key={i}>
                <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.1em', marginBottom: '-0.1em' }}>
                  <span style={{ display: 'inline-block', transform: `translateY(${y}%)`, opacity: o }}>{word}</span>
                </span>
                {i < words.length - 1 ? ' ' : null}
              </Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
