import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { loadConfigFromDir } from '../bots/config';
import { formatDuration } from '../render/format';
import { attachShare, GAME_URL, shareText } from '../render/share';
import { parseStrings } from '../render/strings';
import { createSim, step } from '../sim/sim';
import { LIVE_CONTENT_DIR, PACKAGE_DIR } from './paths';

const config = loadConfigFromDir(join(PACKAGE_DIR, 'tests', 'fixtures', 'config'));
const strings = parseStrings(JSON.parse(readFileSync(join(LIVE_CONTENT_DIR, 'strings.json'), 'utf8')));

// The smallest stand-ins for a button and a status line: the share code touches only these.
function fakeButton(): { el: HTMLButtonElement; click: () => void } {
  let handler: () => void = () => undefined;
  const el = { textContent: '', hidden: true, addEventListener: (_: string, fn: () => void) => (handler = fn) } as unknown as HTMLButtonElement;
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
    expect(el.hidden).toBe(false);
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
});
