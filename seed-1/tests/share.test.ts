import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { formatDuration } from '../render/format';
import { attachShare, GAME_URL, shareText } from '../render/share';
import { drawRunCard, layoutPills, IMAGE_HEIGHT, IMAGE_WIDTH, runFacts, type CardContext } from '../render/share-image';
import { parseStrings } from '../render/strings';
import { createSim, step } from '../sim/sim';
import { LIVE_CONTENT_DIR, PACKAGE_DIR } from './paths';

const config = loadConfigFromDir(join(PACKAGE_DIR, 'tests', 'fixtures', 'config'));
const strings = parseStrings(JSON.parse(readFileSync(join(LIVE_CONTENT_DIR, 'strings.json'), 'utf8')));

// The smallest stand-ins for a button and a status line: the share code touches only these.
function fakeButton(): { el: HTMLButtonElement; click: () => void } {
  let handler: () => void = () => undefined;
  const el = { textContent: '', style: { visibility: 'hidden' }, addEventListener: (_: string, fn: () => void) => (handler = fn) } as unknown as HTMLButtonElement;
  return { el, click: () => handler() };
}

describe('formatDuration', () => {
  it('reads coarse: seconds, minutes, then hours and minutes', () => {
    expect(formatDuration(30)).toBe('30s');
    expect(formatDuration(720)).toBe('12m');
    expect(formatDuration(7200)).toBe('2h');
    expect(formatDuration(8040)).toBe('2h 14m');
    expect(formatDuration(-5)).toBe('0s');
  });
});

describe('share your run', () => {
  const state = step(createSim(config, 1), config, 600);

  it('states the run in numbers from the save only', () => {
    const text = shareText(state, config, strings);
    expect(text).toContain(`${state.unlocked.length} of ${config.unlocks.unlocks.length} unlocks`);
    expect(text).not.toMatch(/\{\w+\}/);
  });

  it('uses the share sheet when the browser has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const { el, click } = fakeButton();
    const status = { textContent: '' } as HTMLElement;
    attachShare(el, status, () => state, config, strings, { share });
    expect(el.style.visibility).toBe('visible');
    expect(el.textContent).toBe(strings.share.button);
    click();
    expect(share).toHaveBeenCalledWith({ title: strings.title, text: shareText(state, config, strings), url: GAME_URL });
  });

  it('copies the text and the address where there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { el, click } = fakeButton();
    const status = { textContent: '' } as HTMLElement;
    attachShare(el, status, () => state, config, strings, { clipboard: { writeText } });
    click();
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(`${shareText(state, config, strings)} ${GAME_URL}`);
    expect(status.textContent).toBe(strings.share.copied);
  });

  it('says so plainly when neither works', () => {
    const { el, click } = fakeButton();
    const status = { textContent: '' } as HTMLElement;
    attachShare(el, status, () => state, config, strings, {});
    click();
    expect(status.textContent).toBe(strings.share.failed);
  });

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  };

  it('falls back to the clipboard when the share sheet refuses for a reason other than the player', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { el, click } = fakeButton();
    const status = { textContent: '' } as HTMLElement;
    attachShare(el, status, () => state, config, strings, { share, clipboard: { writeText } });
    click();
    await flush();
    expect(writeText).toHaveBeenCalledOnce();
    expect(status.textContent).toBe(strings.share.copied);
  });

  it('says nothing when the player dismisses the share sheet', async () => {
    const share = vi.fn().mockRejectedValue(Object.assign(new Error('cancel'), { name: 'AbortError' }));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const { el, click } = fakeButton();
    const status = { textContent: '' } as HTMLElement;
    attachShare(el, status, () => state, config, strings, { share, clipboard: { writeText } });
    click();
    await flush();
    expect(writeText).not.toHaveBeenCalled();
    expect(status.textContent).toBe('');
  });

  it('attaches the picture of the run where the share sheet takes files, inside the click', () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const file = new File([new Uint8Array([1])], 'dust-run.png', { type: 'image/png' });
    const { el, click } = fakeButton();
    attachShare(el, { textContent: '' } as HTMLElement, () => state, config, strings, { share, canShare: () => true }, () => file);
    click();
    expect(share).toHaveBeenCalledWith({ title: strings.title, text: shareText(state, config, strings), url: GAME_URL, files: [file] });
  });

  it('shares the text alone when the browser cannot take the picture', () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const { el, click } = fakeButton();
    attachShare(el, { textContent: '' } as HTMLElement, () => state, config, strings, { share, canShare: () => true }, () => null);
    click();
    expect(share).toHaveBeenCalledWith({ title: strings.title, text: shareText(state, config, strings), url: GAME_URL });
  });
});

describe('the picture of a run', () => {
  const state = step(createSim(config, 1), config, 3600);

  it('states the dust, the unlocks by name and the address, with no placeholders left', () => {
    const facts = runFacts(state, config, strings, GAME_URL);
    expect(state.unlocked.length).toBeGreaterThan(0);
    expect(facts.unlocks).toBe(`${state.unlocked.length} of ${config.unlocks.unlocks.length} unlocks`);
    expect(facts.names).toEqual(state.unlocked.map((u) => config.unlocks.unlocks.find((x) => x.id === u.id)?.name));
    expect(facts.url).toBe('play.mobmachine.games');
  });

  it('draws inside the card, every pill on the canvas, with nothing but shapes and text', () => {
    const texts: Array<{ text: string; x: number; y: number }> = [];
    const rects: Array<[number, number, number, number]> = [];
    const ctx = {
      fillRect: () => undefined,
      fillText: (text: string, x: number, y: number) => texts.push({ text, x, y }),
      measureText: (text: string) => ({ width: text.length * 18 }),
      beginPath: () => undefined,
      arc: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      roundRect: (x: number, y: number, w: number, h: number) => rects.push([x, y, w, h]),
    } as unknown as CardContext;
    const names = Array.from({ length: 12 }, (_, i) => `Unlock number ${i}`);
    drawRunCard(ctx, { ...runFacts(state, config, strings, GAME_URL), names });
    expect(texts.some((t) => /^\+\d+$/.test(t.text))).toBe(true);
    const address = texts.find((t) => t.text === 'play.mobmachine.games');
    expect(address).toBeDefined();
    for (const [x, y, w, h] of rects) {
      expect(x + w).toBeLessThanOrEqual(IMAGE_WIDTH);
      // Every pill ends above the address line's text (32px type).
      expect(y + h).toBeLessThan(address!.y - 32);
    }
    for (const t of texts) expect(t.y).toBeLessThanOrEqual(IMAGE_HEIGHT);
  });
});

describe('unlock pills', () => {
  it('shows every name when they fit, and never more than two rows', () => {
    expect(layoutPills(['Cart', 'Mill'], (t) => t.length * 18).map((p) => p.label)).toEqual(['Cart', 'Mill']);
    const many = layoutPills(Array.from({ length: 30 }, (_, i) => `Name ${i}`), (t) => t.length * 18);
    expect(new Set(many.map((p) => p.y)).size).toBeLessThanOrEqual(2);
    expect(many.at(-1)?.label).toMatch(/^\+\d+$/);
    const shown = many.length - 1;
    expect(many.at(-1)?.label).toBe(`+${30 - shown}`);
  });
});
