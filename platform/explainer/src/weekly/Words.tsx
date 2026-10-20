import { Fragment, type CSSProperties } from 'react';
import { progress, tween } from '../anim';
import { C, EASE_IN, EASE_OUT, FONT } from '../theme';
import type { WeeklyGeometry } from './geometry';
import type { Layout } from './layout';

// The words beside the frame. Three steps of type and no more: the segment's number and name (or
// the week, on the intro), one headline, at most one support line. The label holds still for the
// whole segment, so only the headline changes from beat to beat; its words rise one after another
// as in the explainer's captions, the support line follows as one piece, and both lift away as the
// beat ends. The block's top lines up with the frame's top on the wide cut.

const STAGGER = 3;
const RISE = 20;
const EXIT = 14;
/** Room between the label and the headline, and the headline and the support line. */
const GAP = { label: 34, support: 28 };

function Headline({ text, frame, size }: { text: string; frame: number; size: number }) {
  const words = text.split(' ');
  return (
    <div style={{ fontSize: size, lineHeight: 1.1, fontWeight: 700, letterSpacing: '-0.01em', textWrap: 'balance' } as CSSProperties}>
      {words.map((word, i) => {
        const t = 4 + i * STAGGER;
        return (
          <Fragment key={i}>
            <span style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'top', paddingBottom: '0.12em', marginBottom: '-0.12em' }}>
              <span style={{ display: 'inline-block', transform: `translateY(${tween(frame, t, RISE, 108, 0)}%)`, opacity: tween(frame, t, RISE * 0.6, 0, 1) }}>{word}</span>
            </span>
            {i < words.length - 1 ? ' ' : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function Label({ number, title, frame, size }: { number: number | null; title: string; frame: number; size: number }) {
  const k = progress(frame, 0, 18, EASE_OUT);
  const chip = Math.round(size * 1.72);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: chip, opacity: k, transform: `translateX(${(1 - k) * -24}px)` }}>
      {number === null ? null : (
        <span
          style={{
            display: 'inline-grid',
            placeItems: 'center',
            width: chip,
            height: chip,
            boxSizing: 'border-box',
            border: `3px solid ${C.ink}`,
            borderRadius: 10,
            fontSize: size - 2,
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {number}
        </span>
      )}
      <span style={{ fontSize: size, fontWeight: 600 }}>{title}</span>
    </div>
  );
}

export function Words({ frame, g, plan, weekLabel }: { frame: number; g: WeeklyGeometry; plan: Layout; weekLabel: string }) {
  const { text, type } = g;
  const top = g.text.anchor === 'centre' ? g.frame.y : text.y;
  const current = [...plan.beats].reverse().find((b) => frame >= b.start);
  if (current === undefined || frame >= plan.outro) return null;
  const local = frame - current.start;
  const exit = progress(local, current.length - EXIT, EXIT, EASE_IN);
  // The label: the week's on the intro, the segment's number and name after; it moves only when the
  // segment changes, and leaves with the last beat before the closing plate.
  const segment = current.segment;
  const segStart = segment === -1 ? current.start : plan.segments[segment]!.start;
  const segEnd = segment === -1 ? current.start + current.length : plan.segments[segment]!.end;
  const labelOut = progress(frame, segEnd - EXIT, EXIT, EASE_IN);
  const supportIn = progress(local, 4 + current.beat.headline.split(' ').length * STAGGER + 4, 18, EASE_OUT);
  return (
    <div style={{ position: 'absolute', left: text.x, top, width: text.width, fontFamily: FONT, color: C.ink }}>
      <div style={{ opacity: 1 - labelOut, transform: `translateY(${-20 * labelOut}px)` }}>
        <Label number={segment === -1 ? null : segment + 1} title={segment === -1 ? weekLabel : plan.segments[segment]!.title} frame={frame - segStart} size={type.label} />
      </div>
      <div key={current.start} style={{ marginTop: GAP.label, opacity: 1 - exit, transform: `translateY(${-24 * exit}px)` }}>
        <Headline text={current.beat.headline} frame={local} size={type.headline} />
        {current.beat.support === undefined ? null : (
          <div style={{ marginTop: GAP.support, fontSize: type.support, lineHeight: 1.36, color: C.muted, opacity: supportIn, transform: `translateY(${(1 - supportIn) * 14}px)`, textWrap: 'pretty' } as CSSProperties}>
            {current.beat.support}
          </div>
        )}
      </div>
    </div>
  );
}
