import { describe, expect, it } from 'vitest';
import { BEAT, FPS } from '../timeline';
import { layout } from './layout';
import { isCapture } from './schema';
import { WEEKS } from './weeks';

// The weekly template's rules (docs/specs/weekly-video.md), checked on every week's props: plain
// words, one idea a beat, enough time to read it, and a length that fits.

const JARGON = /\b(board|pipe|gate|lane|kernel|dispatcher|directive|turn)\b/i;

for (const [date, week] of Object.entries(WEEKS)) {
  const plan = layout(week);
  const words = [
    week.label,
    week.intro.headline,
    week.intro.support,
    ...week.segments.flatMap((s) => [s.title, ...s.beats.flatMap((b) => [b.headline, b.support ?? '', isCapture(b.shot) ? (b.shot.asOf ?? '') : 'line' in b.shot ? b.shot.line : ''])]),
    ...week.outro.lines.map((l) => l.text),
  ].filter((w) => w !== '');

  describe(`week ${date}`, () => {
    it('says things plainly: no dashes, exclamation marks, inside terms or "first" claims', () => {
      for (const w of words) {
        expect(w, w).not.toMatch(/[–—!]/);
        expect(w, w).not.toMatch(JARGON);
        expect(w, w).not.toMatch(/\bfirst\b/i);
      }
    });

    it("opens each segment on what changed for a player, in under 8 words", () => {
      for (const s of week.segments) expect(s.beats[0]!.headline.split(' ').length, s.beats[0]!.headline).toBeLessThan(8);
    });

    it('holds a headline at least 2.5 s, and 3.5 s with a support line', () => {
      for (const b of plan.beats) {
        const min = b.beat.support === undefined ? 2.5 : 3.5;
        expect(b.length / FPS, b.beat.headline).toBeGreaterThanOrEqual(min);
      }
    });

    it('keeps a list beat to a headline alone', () => {
      for (const s of week.segments.filter((s) => s.kind === 'list')) for (const b of s.beats) expect(b.support, b.headline).toBeUndefined();
    });

    it('runs 45 to 75 seconds', () => {
      const s = plan.duration / FPS;
      expect(s).toBeGreaterThanOrEqual(45);
      expect(s).toBeLessThanOrEqual(75);
    });

    it('starts every beat on a beat of the music', () => {
      for (const b of plan.beats) expect(b.start % BEAT).toBe(0);
    });
  });
}
