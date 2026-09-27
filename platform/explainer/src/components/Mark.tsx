import { MARK_PATH } from '../../../site/src/components/Mark';
import { pop, progress, tween } from '../anim';
import { EASE_IN_OUT } from '../theme';

// The studio's mark (docs/specs/machine-mark.md), from the site's own path. Its five parts, in path
// order: the cabinet with its feet, the screen, the two eyes and the coin slot. The screen and slot
// are holes, so they are drawn in the ground colour; built up part by part in the opening, then
// drawn whole. It never reads as a slot machine: no reels, lever or jackpot window.
const PARTS = MARK_PATH.split('Z')
  .filter((part) => part.trim() !== '')
  .map((part) => `${part}Z`);
const [CABINET, SCREEN, EYE_L, EYE_R, SLOT] = PARTS as [string, string, string, string, string];

export type MarkTimes = {
  /** Frames from the mark's own start: each part appears at its time. Omit to draw it whole. */
  cabinet: number;
  screen: number;
  eyes: readonly [number, number];
  slot: number;
  glance?: number;
  blink?: number;
};

type Props = {
  height: number;
  colour: string;
  ground: string;
  frame: number;
  times?: MarkTimes;
  /** Extra blinks, in frames. */
  blinks?: readonly number[];
};

/** The eyes close and open over 10 frames. */
function blinkScale(frame: number, at: number | undefined): number {
  if (at === undefined) return 1;
  const t = frame - at;
  if (t < 0 || t > 10) return 1;
  return t < 4 ? 1 - (t / 4) * 0.88 : 0.12 + ((t - 4) / 6) * 0.88;
}

export function Mark({ height, colour, ground, frame, times, blinks = [] }: Props) {
  const width = (height * 24) / 30;
  const whole = times === undefined;
  const draw = whole ? 1 : progress(frame, times.cabinet, 40, EASE_IN_OUT);
  const fill = whole ? 1 : progress(frame, times.cabinet + 34, 12);
  const screen = whole ? 1 : pop(frame, times.screen, 'snappy');
  const eyeL = whole ? 1 : pop(frame, times.eyes[0], 'bouncy');
  const eyeR = whole ? 1 : pop(frame, times.eyes[1], 'bouncy');
  const slot = whole ? 1 : progress(frame, times.slot, 14);
  // The glance: the eyes look left, then right, then back to centre.
  const glance =
    times?.glance === undefined
      ? 0
      : tween(frame, times.glance, 8, 0, -1.2) + tween(frame, times.glance + 22, 10, 0, 2.4) + tween(frame, times.glance + 46, 10, 0, -1.2);
  const blink = Math.min(blinkScale(frame, times?.blink), ...blinks.map((b) => blinkScale(frame, b)));
  // In an SVG, CSS lengths are user units: the glance moves an eye up to 1.2 of its 4 units.
  const eyeStyle = (scale: number) => ({
    transformBox: 'fill-box' as const,
    transformOrigin: 'center',
    transform: `translateX(${glance}px) scale(${scale}) scaleY(${blink})`,
  });
  return (
    <svg viewBox="4 2 24 30" width={width} height={height} style={{ display: 'block', overflow: 'visible' }} aria-hidden="true">
      {/* The outline draws as one dash from the top-left corner. A dash has no join where it starts
          and ends, so once it has gone all the way round the dash is dropped (the corner closes) and
          the stroke thins away as the fill comes in: the finished mark is exactly the site's shape. */}
      <path
        d={CABINET}
        fill={colour}
        fillOpacity={fill}
        stroke={colour}
        strokeWidth={whole ? 0 : 0.6 * (1 - fill)}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray={draw < 1 ? 1 : undefined}
        strokeDashoffset={draw < 1 ? 1 - draw : undefined}
      />
      <path d={SCREEN} fill={ground} style={{ transformBox: 'fill-box', transformOrigin: 'center', transform: `scale(${0.2 + 0.8 * screen}, ${screen})` }} opacity={screen > 0.01 ? 1 : 0} />
      <path d={EYE_L} fill={colour} style={eyeStyle(eyeL)} />
      <path d={EYE_R} fill={colour} style={eyeStyle(eyeR)} />
      <path d={SLOT} fill={ground} style={{ transformBox: 'fill-box', transformOrigin: 'top', transform: `scaleY(${slot})` }} />
    </svg>
  );
}
