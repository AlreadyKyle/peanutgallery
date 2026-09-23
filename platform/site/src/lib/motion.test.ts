import { afterEach, describe, expect, it, vi } from 'vitest';
import { deal, flip, fundTick, motionAllowed, slam } from './motion';

function media(noPreference: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(prefers-reduced-motion: no-preference)' && noPreference }));
}

/** An element that records what it was asked to animate. */
function recording(): HTMLElement & { calls: [Keyframe[], KeyframeAnimationOptions][] } {
  const el = document.createElement('li') as unknown as HTMLElement & { calls: [Keyframe[], KeyframeAnimationOptions][] };
  el.calls = [];
  el.animate = ((frames: Keyframe[], options: KeyframeAnimationOptions) => {
    el.calls.push([frames, options]);
    return { finished: Promise.resolve(), cancel: () => undefined } as unknown as Animation;
  }) as HTMLElement['animate'];
  return el;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('reduced motion', () => {
  it('treats anything but no-preference as reduced', () => {
    media(false);
    expect(motionAllowed()).toBe(false);
    media(true);
    expect(motionAllowed()).toBe(true);
  });

  it('applies end states at once and creates no animation', async () => {
    media(false);
    const el = recording();
    const swap = vi.fn();
    await flip(el, swap);
    expect(swap).toHaveBeenCalledTimes(1);
    fundTick(el, 10, 50);
    deal([el, recording()]);
    slam(el);
    expect(el.calls).toEqual([]);
  });
});

describe('with motion allowed', () => {
  it('moves only transform and opacity, with durations from the tokens', async () => {
    media(true);
    vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
      fn(0);
      return 0;
    });
    const el = recording();
    const swap = vi.fn();
    await flip(el, swap);
    fundTick(el, 10, 50);
    deal([el]);
    slam(el);
    expect(swap).toHaveBeenCalledTimes(1);
    const durations = el.calls.map(([, options]) => options.duration);
    expect(durations).toEqual([200, 200, 240, 240, 240]);
    for (const [frames] of el.calls) {
      for (const frame of frames) for (const key of Object.keys(frame)) expect(['transform', 'opacity', 'offset', 'easing', 'composite']).toContain(key);
    }
    expect(el.calls.every(([, options]) => options.iterations === undefined)).toBe(true);
  });

  it('staggers the deal 50ms apart and starts it from 12px up at -3 degrees', () => {
    media(true);
    const cards = [recording(), recording(), recording()];
    deal(cards);
    expect(cards.map((c) => c.calls[0]![1].delay)).toEqual([0, 50, 100]);
    expect(cards[0]!.calls[0]![0][0]).toEqual({ transform: 'translateY(-12px) rotate(-3deg)', opacity: 0 });
  });
});
