// The one clock the picture and the music share (docs/specs/explainer-video.md). The video runs at
// 60 frames a second on a 120 BPM grid, so a beat is 30 frames and a bar is 120: every scene starts
// on a bar, and every moment below is written in bars from its scene's start. The Remotion scenes and
// the Tone.js score (music/score.ts) both read these numbers, so a card lands on the beat its sound is on.

export const FPS = 60;
export const BPM = 120;
export const BEAT = (FPS * 60) / BPM;
export const BAR = BEAT * 4;

export type SceneId = 'intro' | 'team' | 'pick' | 'split' | 'fills' | 'build' | 'checks' | 'shipped' | 'ledger' | 'outro';

/** Each scene, its length in bars and the line of legal.explainer.beats it shows. */
export const SCENES: readonly { id: SceneId; bars: number; beat: number }[] = [
  { id: 'intro', bars: 5, beat: 0 },
  { id: 'team', bars: 4, beat: 1 },
  { id: 'pick', bars: 4, beat: 2 },
  { id: 'split', bars: 4, beat: 3 },
  { id: 'fills', bars: 3, beat: 4 },
  { id: 'build', bars: 4, beat: 5 },
  { id: 'checks', bars: 4, beat: 6 },
  { id: 'shipped', bars: 4, beat: 7 },
  { id: 'ledger', bars: 4, beat: 8 },
  { id: 'outro', bars: 4, beat: 9 },
];

export const TOTAL_BARS = SCENES.reduce((sum, scene) => sum + scene.bars, 0);
/** Two extra beats of held end frame, so the last chord rings out over the still mark. */
export const TAIL = BEAT * 2;
export const DURATION = TOTAL_BARS * BAR + TAIL;

/** Bars to frames, rounded to a whole frame. */
export function bars(n: number): number {
  return Math.round(n * BAR);
}

/** The bar a scene starts on, counted from the start of the video. */
export function sceneBar(id: SceneId): number {
  let bar = 0;
  for (const scene of SCENES) {
    if (scene.id === id) return bar;
    bar += scene.bars;
  }
  throw new Error(`no scene ${id}`);
}

export function sceneStart(id: SceneId): number {
  return bars(sceneBar(id));
}

export function sceneLength(id: SceneId): number {
  const scene = SCENES.find((s) => s.id === id);
  if (scene === undefined) throw new Error(`no scene ${id}`);
  return bars(scene.bars) + (id === SCENES[SCENES.length - 1]!.id ? TAIL : 0);
}

/** When each thing happens, in bars from its scene's start. The score reads the same table. */
export const CHOREO = {
  intro: {
    cabinet: 0.125,
    screen: 0.625,
    eyes: [0.875, 1.0],
    slot: 1.125,
    glance: 1.375,
    word: 1.5,
    blink: 2.125,
    collapse: 2.375,
    line: 2.75,
    phone: 3.0,
    tag: 3.375,
    exit: 4.625,
  },
  team: {
    line: 0.25,
    pops: [0.5, 0.625, 0.75, 0.875, 1.0, 1.125, 1.25, 1.375, 1.5],
    blinks: [1.9, 2.3, 2.6, 2.95, 3.2],
    exit: 3.5,
  },
  pick: {
    line: 0.25,
    deal: [0.5, 0.625, 0.75, 0.875],
    lift: 2.0,
    target: 3.0,
    exit: 3.625,
  },
  split: {
    line: 0.25,
    coin: 0.5,
    handle: [1.25, 1.5, 1.75, 2.0],
    part: 2.5,
    land: 3.0,
    exit: 3.625,
  },
  fills: {
    line: 0.125,
    coins: [0.25, 0.5, 0.75, 1.0],
    flip: 1.25,
    queue: 2.0,
  },
  build: {
    line: 0.25,
    agent: 0.25,
    flip: 0.75,
    events: [1.0, 1.5, 2.0, 2.5, 3.0],
  },
  checks: {
    line: 0.25,
    flip: 0.25,
    phone: 0.5,
    taps: [1.0, 1.25, 1.5, 1.75, 2.0, 2.25],
    passed: [2.75, 3.0],
    exit: 3.625,
  },
  shipped: {
    line: 0.25,
    flip: 0.25,
    stamp: 0.75,
    pile: 1.0,
    slam: 2.0,
    exit: 3.625,
  },
  ledger: {
    line: 0.25,
    panel: 0.25,
    rows: [0.75, 1.0, 1.25, 1.5, 1.75, 2.0],
    exit: 3.625,
  },
  outro: {
    expand: 0,
    mark: 0.25,
    /** The closing line's three sentences, one to a beat and a half. */
    lines: [1.0, 1.375, 1.75],
    /** The address, on the social cuts only. */
    url: 2.25,
    blink: 2.75,
    rest: 3.5,
  },
} as const;
