import { describe, expect, it } from 'vitest';
import { legal } from '../../site/src/lib/legal';
import { BAR, BEAT, CHOREO, DURATION, FPS, SCENES, sceneLength, sceneStart, TOTAL_BARS } from './timeline';

describe('the timeline', () => {
  it('runs on a 120 BPM grid at 60 frames a second', () => {
    expect(FPS).toBe(60);
    expect(BEAT).toBe(30);
    expect(BAR).toBe(120);
  });

  it('shows every line of the script once, in order', () => {
    expect(SCENES.map((scene) => scene.beat)).toEqual(legal.explainer.beats.map((_, i) => i));
  });

  it('starts every scene on a bar, one after another', () => {
    let frame = 0;
    for (const scene of SCENES) {
      expect(sceneStart(scene.id)).toBe(frame);
      expect(sceneStart(scene.id) % BAR).toBe(0);
      frame += scene.bars * BAR;
    }
    expect(frame).toBe(TOTAL_BARS * BAR);
    expect(sceneStart('outro') + sceneLength('outro')).toBe(DURATION);
  });

  it('keeps every moment inside its scene', () => {
    const times = (value: unknown): number[] => (typeof value === 'number' ? [value] : Array.isArray(value) ? value.flatMap(times) : []);
    for (const scene of SCENES) {
      for (const [name, value] of Object.entries(CHOREO[scene.id])) {
        for (const t of times(value)) {
          expect(t, `${scene.id}.${name}`).toBeGreaterThanOrEqual(0);
          expect(t, `${scene.id}.${name}`).toBeLessThan(scene.bars);
        }
      }
    }
  });
});
