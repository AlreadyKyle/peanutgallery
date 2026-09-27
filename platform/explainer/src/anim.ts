import { interpolate, spring, type EasingFunction } from 'remotion';
import { EASE_OUT } from './theme';
import { BAR, FPS } from './timeline';

/** A clamped tween from `from` to `to` over `duration` frames starting at `start`. */
export function tween(frame: number, start: number, duration: number, from: number, to: number, easing: EasingFunction = EASE_OUT): number {
  if (duration <= 0) return frame < start ? from : to;
  return interpolate(frame, [start, start + duration], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });
}

/** 0 to 1 over `duration` frames from `start`. */
export function progress(frame: number, start: number, duration: number, easing: EasingFunction = EASE_OUT): number {
  return tween(frame, start, duration, 0, 1, easing);
}

/** A spring from 0 to 1 that starts at `start`: `snappy` for cards and coins, `soft` for settling. */
export function pop(frame: number, start: number, kind: 'snappy' | 'soft' | 'bouncy' = 'snappy'): number {
  const config = {
    snappy: { damping: 16, stiffness: 220, mass: 0.7 },
    soft: { damping: 22, stiffness: 120, mass: 1 },
    bouncy: { damping: 10, stiffness: 200, mass: 0.6 },
  }[kind];
  return spring({ frame: frame - start, fps: FPS, config });
}

/** Bars from a scene's start to frames. */
export function at(barsIn: number): number {
  return Math.round(barsIn * BAR);
}

/** A decaying shake for a card that lands hard: x and y in pixels. */
export function shake(frame: number, start: number, strength = 6): { x: number; y: number } {
  const t = frame - start;
  if (t < 0 || t > 18) return { x: 0, y: 0 };
  const decay = Math.exp(-t / 5);
  return { x: Math.sin(t * 2.3) * strength * decay * 0.4, y: Math.cos(t * 1.9) * strength * decay };
}

/** The same small wobble for the same seed, so idle motion is fixed across renders. */
export function wobble(frame: number, seed: number, amount: number, period = 90): number {
  return Math.sin(((frame + seed * 37) / period) * Math.PI * 2) * amount;
}
