import type { GlyphName } from '../../../site/src/components/Glyph';
import { Img, OffthreadVideo, Sequence, staticFile } from 'remotion';
import { progress } from '../anim';
import { Glyph } from '../components/Glyph';
import { C, EASE_IN, EASE_IN_OUT, EASE_OUT, FONT } from '../theme';
import { FPS } from '../timeline';
import { screenBox, type WeeklyGeometry } from './geometry';
import { carried as carriedAt, PUSH, ringStart, type Layout, type PlacedBeat } from './layout';
import { isCapture, type Rect, type Rects } from './schema';

// The one browser frame every capture is shown in: the same place and scale all video, so the eye
// never hunts for it. Each beat's capture fades in over the last; then the beat's one movement, a
// slow push-in on the UI it names, and a ring drawn round that UI once the push has settled.

/** Frames each capture takes to fade in over the one before. */
export const FADE = 14;
/** The ring draws in over a third of a second. */
const RING = { length: 20, pad: 12, stroke: 5 };
/** How far the push goes: the rect fills about this much of the frame, never past MAX. */
const FILL = 0.82;
const MAX = 1.75;

type View = { s: number; ox: number; oy: number };

/** The view that centres `r` in the frame at the push's scale, clamped so no edge of the capture shows. */
function viewOf(r: Rect | undefined, zoom?: number): View {
  if (r === undefined) return { s: 1, ox: 0, oy: 0 };
  const [x, y, w, h] = r;
  const s = Math.max(1, Math.min(MAX, zoom ?? Math.min(FILL / w, FILL / h)));
  const clamp = (o: number) => Math.min(0, Math.max(1 - s, o));
  return { s, ox: clamp(0.5 - (x + w / 2) * s), oy: clamp(0.5 - (y + h / 2) * s) };
}

function mix(a: View, b: View, k: number): View {
  return { s: a.s + (b.s - a.s) * k, ox: a.ox + (b.ox - a.ox) * k, oy: a.oy + (b.oy - a.oy) * k };
}

function ShotLayer({ plan, i, frame, g, rects, base }: { plan: Layout; i: number; frame: number; g: WeeklyGeometry; rects: Rects; base: string }) {
  const placed: PlacedBeat = plan.beats[i]!;
  const prev = i === 0 ? null : plan.beats[i - 1]!;
  const box = screenBox(g);
  const { beat } = placed;
  const shot = beat.shot;
  const local = frame - placed.start;
  // A beat that keeps the last beat's capture and push starts where that one ended, so nothing jumps.
  const target = viewOf(beat.focus === undefined ? undefined : rects[beat.focus], beat.zoom);
  const carried = carriedAt(plan, i);
  const startView = carried ? target : { s: 1, ox: 0, oy: 0 };
  const view = mix(startView, target, progress(local, PUSH.delay, PUSH.length, EASE_IN_OUT));
  const fadeIn = prev === null || carried ? 1 : progress(local, 0, FADE, EASE_OUT);

  const ringRect = beat.ring === undefined ? undefined : rects[beat.ring];
  const ringIn = progress(local, ringStart(plan, i), RING.length, EASE_OUT);
  const ringOut = progress(local, placed.length - 10, 10, EASE_IN);

  return (
    <div style={{ position: 'absolute', inset: 0, opacity: fadeIn, overflow: 'hidden', background: C.paper }}>
      {isCapture(shot) ? (
        <div
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: box.width,
            height: box.height,
            transformOrigin: '0 0',
            transform: `translate(${view.ox * box.width}px, ${view.oy * box.height}px) scale(${view.s})`,
          }}
        >
          {shot.src.endsWith('.mp4') ? (
            <OffthreadVideo src={staticFile(`${base}/${shot.src}`)} muted trimBefore={Math.round((shot.from ?? 0) * FPS)} style={{ width: box.width, height: box.height, display: 'block' }} />
          ) : (
            <Img src={staticFile(`${base}/${shot.src}`)} style={{ width: box.width, height: box.height, display: 'block' }} />
          )}
        </div>
      ) : (
        <CardShot glyph={shot.glyph} line={shot.line} width={box.width} g={g} frame={local} />
      )}
      {ringRect !== undefined && ringIn > 0 ? (
        <div
          style={{
            position: 'absolute',
            left: (ringRect[0] * view.s + view.ox) * box.width - RING.pad,
            top: (ringRect[1] * view.s + view.oy) * box.height - RING.pad,
            width: ringRect[2] * view.s * box.width + RING.pad * 2,
            height: ringRect[3] * view.s * box.height + RING.pad * 2,
            boxSizing: 'border-box',
            border: `${RING.stroke}px solid ${C.ink}`,
            borderRadius: 14,
            // A paper edge round the ink, so the ring reads on the site's ink bands as well as on paper.
            boxShadow: `0 0 0 3px ${C.paper}, inset 0 0 0 3px ${C.paper}`,
            opacity: ringIn * (1 - ringOut),
            transform: `scale(${1.06 - 0.06 * ringIn})`,
          }}
        />
      ) : null}
    </div>
  );
}

/** A beat with no capture: one site card, its glyph tile and its one line, in the frame. */
function CardShot({ glyph, line, width, g, frame }: { glyph: GlyphName; line: string; width: number; g: WeeklyGeometry; frame: number }) {
  const k = progress(frame, 4, 30, EASE_OUT);
  const cardW = Math.round(width * 0.62);
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: C.paperHover }}>
      <div
        style={{
          width: cardW,
          boxSizing: 'border-box',
          padding: 40,
          background: C.paper,
          border: `3px solid ${C.ink}`,
          borderRadius: 16,
          fontFamily: FONT,
          color: C.ink,
          transform: `translateY(${(1 - k) * 24}px)`,
          opacity: k,
        }}
      >
        <div style={{ width: 88, height: 88, borderRadius: 14, background: C.ink, color: C.paper, display: 'grid', placeItems: 'center' }}>
          <Glyph name={glyph} size={52} />
        </div>
        <div style={{ marginTop: 28, fontSize: g.type.support, lineHeight: 1.35 }}>{line}</div>
      </div>
    </div>
  );
}

export function Screen({ frame, g, plan, rects, base }: { frame: number; g: WeeklyGeometry; plan: Layout; rects: Rects; base: string }) {
  const { x, y, width, bar, border } = g.frame;
  const box = screenBox(g);
  const first = plan.beats[0]!.start;
  const enter = progress(frame, first - 18, 40, EASE_OUT);
  const exit = progress(frame, plan.outro - 30, 30, EASE_IN);
  const current = [...plan.beats].reverse().find((b) => frame >= b.start) ?? plan.beats[0]!;
  const shot = current.beat.shot;
  const url = shot.url ?? null;
  const asOf = isCapture(shot) ? shot.asOf : undefined;
  // The address changes with a short fade, on the frame the capture starts fading in.
  const urlIn = progress(frame, current.start, FADE, EASE_OUT);
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        height: box.height + bar + border * 2,
        boxSizing: 'border-box',
        border: `${border}px solid ${C.ink}`,
        borderRadius: 20,
        overflow: 'hidden',
        background: C.paper,
        opacity: enter * (1 - exit),
        transform: `translateY(${(1 - enter) * 60 + exit * 60}px)`,
      }}
    >
      <div style={{ height: bar, boxSizing: 'border-box', borderBottom: `3px solid ${C.ink}`, display: 'flex', alignItems: 'center', gap: 14, padding: '0 22px', fontFamily: FONT, color: C.ink }}>
        <span style={{ opacity: url === null ? 0 : 1 }}>
          <Glyph name="browser" size={26} />
        </span>
        <span style={{ fontSize: 24, fontWeight: 600, opacity: url === null ? 0 : urlIn }}>{url}</span>
        {asOf !== undefined ? <span style={{ marginLeft: 'auto', fontSize: 22, color: C.muted, opacity: urlIn }}>{asOf}</span> : null}
      </div>
      <div style={{ position: 'relative', width: box.width, height: box.height, overflow: 'hidden' }}>
        {plan.beats.map((placed, i) => (
          <Sequence key={i} from={placed.start} durationInFrames={placed.length + FADE} layout="none">
            <ShotLayer plan={plan} i={i} frame={frame} g={g} rects={rects} base={base} />
          </Sequence>
        ))}
      </div>
    </div>
  );
}

