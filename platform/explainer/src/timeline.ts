// The one clock the picture and the music share (docs/specs/explainer-video.md). The video runs at
// 60 frames a second on a 120 BPM grid, so a beat is 30 frames and a bar is 120: every scene starts
// on a bar, and every moment below is written in bars from its scene's start. The Remotion scenes and
// the Tone.js score (music/score.ts) both read these numbers, so a card lands on the beat its sound is on.

export const FPS = 60;
export const BPM = 120;
export const BEAT = (FPS * 60) / BPM;
export const BAR = BEAT * 4;

export type SceneId = 'intro' | 'pick' | 'fills' | 'build' | 'shipped' | 'outro';

/**
 * Each scene, its length in bars and the line of legal.explainer.beats it shows. 21 bars and the tail,
 * 43 s: every video runs 45 s at most (the owner's call, 21 Oct 2026), so the cut keeps the card's own
 * story (picked, funded, built, shipped) and leaves the team, the split, the checks and the ledger to
 * the site.
 */
export const SCENES: readonly { id: SceneId; bars: number; beat: number }[] = [
  { id: 'intro', bars: 4, beat: 0 },
  { id: 'pick', bars: 4, beat: 1 },
  { id: 'fills', bars: 3, beat: 2 },
  { id: 'build', bars: 4, beat: 3 },
  { id: 'shipped', bars: 3, beat: 4 },
  { id: 'outro', bars: 3, beat: 5 },
];

/** The longest the video may run, in seconds. */
export const MAX_SECONDS = 45;

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
    screen: 0.5,
    eyes: [0.625, 0.75],
    slot: 0.875,
    glance: 1.0,
    word: 1.0,
    blink: 1.5,
    collapse: 1.625,
    line: 2.0,
    phone: 2.125,
    tag: 2.5,
    exit: 3.625,
  },
  pick: {
    line: 0.25,
    deal: [0.5, 0.625, 0.75, 0.875],
    lift: 2.0,
    target: 3.0,
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
  shipped: {
    line: 0.25,
    flip: 0.25,
    stamp: 0.75,
    pile: 1.0,
    slam: 2.0,
    exit: 2.625,
  },
  outro: {
    expand: 0,
    mark: 0.25,
    /** The closing line's three sentences, one to a beat and a half. */
    lines: [0.75, 1.125, 1.5],
    /** The address, on the social cuts only. */
    url: 1.875,
    blink: 2.25,
    rest: 2.75,
  },
} as const;
