import { describe, expect, it } from 'vitest';
import { frameStates, STATES } from '../e2e/frame-states';
import { parseCaptureArgs, sizeOf, statesFor } from '../scripts/capture';
import { PACKAGE_DIR } from './paths';

// scripts/capture.ts: before and after pictures from the same seed, states and camera. The drawing is
// e2e/draw.ts, which the frames spec runs; these cover the arguments and the states.

describe('capture arguments', () => {
  it('takes the defaults the frames use, with paths from the folder pnpm started in', () => {
    const args = parseCaptureArgs(['--', '--out', 'shots/after'], '/work', PACKAGE_DIR, {});
    expect(args).toEqual({
      out: '/work/shots/after',
      root: PACKAGE_DIR,
      states: [0, 600, 3_600, 21_600],
      sizes: [
        { width: 1280, height: 720 },
        { width: 390, height: 844 },
      ],
      port: 4180,
      build: true,
    });
  });

  it('reads states, sizes, another checkout, the port and --no-build', () => {
    const args = parseCaptureArgs(
      ['--out', '/tmp/x', '--states', '600,0,600', '--widths', '1440,375x812', '--root', '../main/seed-1', '--no-build'],
      '/work/repo',
      PACKAGE_DIR,
      { E2E_PORT: '4433' },
    );
    expect(args.states).toEqual([0, 600]);
    expect(args.sizes).toEqual([
      { width: 1440, height: 810 },
      { width: 375, height: 812 },
    ]);
    expect(args.root).toBe('/work/main/seed-1');
    expect(args.port).toBe(4433);
    expect(args.build).toBe(false);
  });

  it('refuses a missing --out, an unknown flag and a bad state or size', () => {
    expect(() => parseCaptureArgs([], '/w', PACKAGE_DIR, {})).toThrow('--out is required');
    expect(() => parseCaptureArgs(['--out', 'x', '--seed', '2'], '/w', PACKAGE_DIR, {})).toThrow('unknown argument --seed');
    expect(() => parseCaptureArgs(['--out', 'x', '--states', '1.5'], '/w', PACKAGE_DIR, {})).toThrow('--states');
    expect(() => sizeOf('wide')).toThrow('--widths');
    expect(() => sizeOf('50')).toThrow('outside');
  });
});

describe('capture states', () => {
  it('makes the same saves as the frames for the same seconds', async () => {
    const frames = frameStates();
    expect(await statesFor(PACKAGE_DIR, STATES)).toEqual(frames);
  });
});
