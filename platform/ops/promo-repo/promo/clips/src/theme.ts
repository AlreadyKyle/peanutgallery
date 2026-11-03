import { Easing, interpolate, spring, type EasingFunction } from 'remotion';

// The site's tokens (platform/site/src/tokens.css): amber is money, ink is the studio, green is
// Live, magenta is Dust.
export const C = {
  paper: '#ffffff',
  ink: '#111111',
  muted: '#5c5c5c',
  line: '#d6d6d6',
  paperHover: '#eeeff0',
  mutedOnInk: '#a3a3a3',
  lineOnInk: '#333333',
  field: '#7d7d7d',
  work: '#d4e1ee',
  game: '#b0226a',
  live: '#16701f',
  coin: '#d9a441',
  dust: '#12161c',
} as const;

export const CREATURE: Record<string, string> = {
  blue: '#8db9e8', lavender: '#cbbdee', green: '#9bd3a6', pink: '#f3b0c6', orange: '#f5b97a',
  yellow: '#f5dc7a', purple: '#b39ae0', grey: '#c3c7cc', teal: '#7fcbc5', red: '#eb9a9a', brown: '#cfa77c',
};

export const FONT = "'Atkinson Hyperlegible Next', Arial, sans-serif";
/** The machine's labels: the system mono stack, 600, tracking-label (docs/BRAND.md). */
export const MONO = "ui-monospace, SFMono-Regular, Menlo, 'DejaVu Sans Mono', Consolas, monospace";
export const LABEL = { fontFamily: MONO, fontWeight: 600, letterSpacing: '0.04em' } as const;
/** A decisive ease for the push between scenes: quick through the middle, soft at both ends. */
export const EASE_PUSH = Easing.bezier(0.76, 0, 0.24, 1);
export const EASE_OUT = Easing.bezier(0.2, 0, 0, 1);
export const EASE_IN_OUT = Easing.bezier(0.65, 0, 0.35, 1);

export const FPS = 30;
/** 120 BPM in 4/4: a bar is two seconds. */
export const BAR = 60;
export const BEAT = 15;

/** Scene lengths in bars, in order. */
export const SCENES = [
  { id: 'intro', bars: 1.5 },
  { id: 'u0', bars: 2.5 },
  { id: 'u1', bars: 2.5 },
  { id: 'u2', bars: 2.5 },
  { id: 'summary', bars: 3 },
  { id: 'outro', bars: 1.5 },
] as const;
export type SceneId = (typeof SCENES)[number]['id'];
export const TOTAL_BARS = SCENES.reduce((n, s) => n + s.bars, 0);
export const DURATION = TOTAL_BARS * BAR;
export function sceneBar(id: SceneId): number {
  let n = 0;
  for (const s of SCENES) {
    if (s.id === id) return n;
    n += s.bars;
  }
  throw new Error(id);
}

export function tween(frame: number, start: number, duration: number, from: number, to: number, easing: EasingFunction = EASE_OUT): number {
  return interpolate(frame, [start, start + duration], [from, to], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });
}
export function progress(frame: number, start: number, duration: number, easing: EasingFunction = EASE_OUT): number {
  return tween(frame, start, duration, 0, 1, easing);
}
export function pop(frame: number, start: number, kind: 'snappy' | 'soft' | 'bouncy' = 'snappy'): number {
  const config = {
    snappy: { damping: 16, stiffness: 220, mass: 0.7 },
    soft: { damping: 22, stiffness: 120, mass: 1 },
    bouncy: { damping: 10, stiffness: 200, mass: 0.6 },
  }[kind];
  return spring({ frame: frame - start, fps: FPS, config });
}
export function wobble(frame: number, seed: number, amount: number, period = 90): number {
  return Math.sin(((frame + seed * 37) / period) * Math.PI * 2) * amount;
}
