import { BAR, BEAT, FPS } from '../timeline';
import type { Beat, Segment, WeekProps } from './schema';

// The weekly video's clock, worked out from the props alone, so the picture (Weekly.tsx) and the
// score (score.ts) read the same table. Same grid as the explainer: 60 frames a second, 120 BPM, a
// bar of two seconds, and every beat starts on a half bar.

/** The plate: the mark builds up, then folds into the top bar. In bars from the start. */
export const PLATE = {
  cabinet: 0.125,
  screen: 0.5,
  eyes: [0.625, 0.75] as const,
  slot: 0.875,
  glance: 1.0,
  word: 1.0,
  blink: 1.5,
  collapse: 1.625,
  /** The first beat starts once the fold has landed. */
  content: 2.0,
};

/** The wipe between two segments: half a bar of its own, so it hides no words. */
export const WIPE = 0.5;

/**
 * The wipe's moves, in frames from `lead` before its slot: three bands sweep in a few frames apart,
 * the segment's number pops on the last (ink) band at `pop`, and the bands sweep on out, ink first,
 * from `out`, uncovering the words' column first.
 */
export const WIPE_AT = { lead: 12, stagger: 5, band: 20, pop: 26, out: 58 };

/** The frame a segment takes over the top bar's counter: its wipe's pop, or its start for the first. */
export function segmentShown(plan: Pick<Layout, 'segments' | 'wipes'>, s: number): number {
  const wipe = plan.wipes.find((w) => w.segment === s);
  return wipe === undefined ? plan.segments[s]!.start : wipe.start - WIPE_AT.lead + WIPE_AT.pop;
}

/** The closing plate, in bars from its start. */
export const CLOSE = { expand: 0, lines: [0.75, 1.125, 1.5, 1.875], address: 2.0, blink: 2.5, bars: 3 };
export const TAIL = BEAT * 2;

/**
 * Hold times. A headline alone holds at least 2.5 s; with a support line, 3.5 s, and 4 s once the two
 * together pass about 90 characters (read at normal speed, with the words' rise). A list beat is a
 * headline alone. `opener` adds to a segment's first beat; it is 0, since the label comes in with
 * the headline and holds for the whole segment.
 */
export const HOLD = { headline: 1.25, support: 1.75, long: 2.0, opener: 0, list: 1.25 };

/** The longest a week may run, in seconds: past this the video drags. */
export const MAX_SECONDS = 45;

/** A beat's length in bars, from its words unless the props say. */
export function beatBars(beat: Beat, segment: Segment | null, first: boolean): number {
  if (beat.bars !== undefined) return beat.bars;
  if (segment?.kind === 'list') return HOLD.list + (first ? HOLD.opener : 0);
  const words = beat.headline.length + (beat.support?.length ?? 0);
  const base = beat.support === undefined ? HOLD.headline : words > 90 ? HOLD.long : HOLD.support;
  return base + (first ? HOLD.opener : 0);
}

export type PlacedBeat = {
  beat: Beat;
  segment: number;
  /** The beat's index inside its segment. */
  index: number;
  start: number;
  length: number;
};

export type Layout = {
  beats: PlacedBeat[];
  segments: { title: string; start: number; end: number }[];
  /** The wipe before each segment after the first: its slot's first frame and its length. */
  wipes: { segment: number; start: number; length: number }[];
  /** The closing plate's first frame. */
  outro: number;
  duration: number;
  /** In bars, for the score. */
  bars: number;
};

export function layout(week: WeekProps): Layout {
  const beats: PlacedBeat[] = [];
  let bar = PLATE.content;
  const segments: Layout['segments'] = [];
  const wipes: Layout['wipes'] = [];
  week.segments.forEach((segment, s) => {
    if (s > 0) {
      wipes.push({ segment: s, start: Math.round(bar * BAR), length: Math.round(WIPE * BAR) });
      bar += WIPE;
    }
    const from = bar;
    segment.beats.forEach((beat, i) => {
      const n = beatBars(beat, segment, i === 0);
      beats.push({ beat, segment: s, index: i, start: Math.round(bar * BAR), length: Math.round(n * BAR) });
      bar += n;
    });
    segments.push({ title: segment.title, start: Math.round(from * BAR), end: Math.round(bar * BAR) });
  });
  const outro = Math.round(bar * BAR);
  bar += CLOSE.bars;
  return { beats, segments, wipes, outro, duration: Math.round(bar * BAR) + TAIL, bars: bar };
}

export const seconds = (frames: number) => frames / FPS;

/** The push-in: it starts a few frames into the beat and settles over 1.6 s. */
export const PUSH = { delay: 6, length: 96 };

/** Whether a beat keeps the beat before's capture and push, so it starts where that one ended. */
export function carried(plan: Layout, i: number): boolean {
  const prev = plan.beats[i - 1];
  const beat = plan.beats[i]!.beat;
  if (prev === undefined) return false;
  const a = prev.beat.shot;
  const b = beat.shot;
  return 'src' in a && 'src' in b && a.src === b.src && prev.beat.focus === beat.focus;
}

/** The frame, from the beat's start, its ring starts drawing: once the push-in settles, or `ringAt`. */
export function ringStart(plan: Layout, i: number): number {
  const beat = plan.beats[i]!.beat;
  if (beat.ringAt !== undefined) return Math.round(beat.ringAt * FPS);
  return beat.focus !== undefined && !carried(plan, i) ? PUSH.delay + PUSH.length - 18 : 18;
}
