import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { CHANNEL_SOURCES, COUNT_PATH, countEvent, MAX_SESSION_STEP_MS, onceEach, returnEvent, SessionClock, sourceEvent, withoutSource, type PlayEvent } from '../render/count';
import { PACKAGE_DIR } from './paths';

// Play and share counts (docs/specs/play-counts.md): the event's name alone, to this origin's
// /api/count, which netlify.toml proxies to the site's counter.
describe('countEvent', () => {
  it('sends the event name alone as a beacon to /api/count on this origin', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const fetchFn = vi.fn();
    for (const event of ['dust_load', 'dust_share', 'dust_next_card'] as const) countEvent(event, { sendBeacon }, fetchFn);
    expect(sendBeacon.mock.calls).toEqual([
      ['/api/count', '{"event":"dust_load"}'],
      ['/api/count', '{"event":"dust_share"}'],
      ['/api/count', '{"event":"dust_next_card"}'],
    ]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('sends the Daily Dust counters the same way (docs/specs/daily-dust.md)', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    for (const event of ['dust_daily_start', 'dust_daily_finish', 'dust_daily_share'] as const) countEvent(event, { sendBeacon }, vi.fn());
    expect(sendBeacon.mock.calls.map((call) => call[1])).toEqual([
      '{"event":"dust_daily_start"}',
      '{"event":"dust_daily_finish"}',
      '{"event":"dust_daily_share"}',
    ]);
  });

  it('falls back to a keepalive fetch with no credentials where there is no beacon or it is refused', () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    countEvent('dust_load', {}, fetchFn);
    countEvent('dust_share', { sendBeacon: () => false }, fetchFn);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[0]).toEqual([
      '/api/count',
      { method: 'POST', body: '{"event":"dust_load"}', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' } },
    ]);
  });

  it('counts nothing in an automated browser, which says so in navigator.webdriver (docs/specs/counter-senders.md)', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const fetchFn = vi.fn();
    countEvent('dust_load', { sendBeacon, webdriver: true }, fetchFn);
    countEvent('dust_load', { webdriver: true }, fetchFn);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
    countEvent('dust_load', { sendBeacon, webdriver: false }, fetchFn);
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('never throws: a failed or rejected count is dropped', async () => {
    expect(() => countEvent('dust_load', { sendBeacon: () => { throw new Error('no'); } }, vi.fn())).not.toThrow();
    const rejected = vi.fn().mockRejectedValue(new Error('offline'));
    expect(() => countEvent('dust_load', {}, rejected)).not.toThrow();
    await Promise.resolve();
  });

  it('is proxied to the site by netlify.toml, so connect-src stays self', () => {
    const toml = readFileSync(join(PACKAGE_DIR, 'netlify.toml'), 'utf8');
    expect(toml).toMatch(/from = "\/api\/count"\s*\n\s*to = "https:\/\/mobmachine\.games\/api\/count"\s*\n\s*status = 200\s*\n\s*force = true/);
    expect(toml).toContain("connect-src 'self'");
    expect(COUNT_PATH).toBe('/api/count');
  });
});

// The benchmarks' counters (docs/specs/counter-senders.md, docs/strategy/benchmarks.md).
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-10-17T12:00:00Z');

describe('returnEvent', () => {
  it('counts a load from a save at least 20 hours and under 48 hours old as dust_return_1d', () => {
    expect(returnEvent(NOW - 20 * HOUR, NOW)).toBe('dust_return_1d');
    expect(returnEvent(NOW - 30 * HOUR, NOW)).toBe('dust_return_1d');
    expect(returnEvent(NOW - 48 * HOUR + 1, NOW)).toBe('dust_return_1d');
    expect(returnEvent(NOW - 20 * HOUR + 1, NOW)).toBeNull();
    expect(returnEvent(NOW - 48 * HOUR, NOW)).toBeNull();
  });

  it('counts a load from a save at least 6 days and under 8 days old as dust_return_7d', () => {
    expect(returnEvent(NOW - 6 * DAY, NOW)).toBe('dust_return_7d');
    expect(returnEvent(NOW - 7 * DAY, NOW)).toBe('dust_return_7d');
    expect(returnEvent(NOW - 8 * DAY + 1, NOW)).toBe('dust_return_7d');
    expect(returnEvent(NOW - 6 * DAY + 1, NOW)).toBeNull();
    expect(returnEvent(NOW - 8 * DAY, NOW)).toBeNull();
  });

  it('counts nothing for no save, a fresh save, a gap between the windows, an old save or a clock set back', () => {
    expect(returnEvent(null, NOW)).toBeNull();
    expect(returnEvent(NOW - 5 * 60 * 1000, NOW)).toBeNull();
    expect(returnEvent(NOW - 3 * DAY, NOW)).toBeNull();
    expect(returnEvent(NOW - 30 * DAY, NOW)).toBeNull();
    expect(returnEvent(NOW + DAY, NOW)).toBeNull();
    expect(returnEvent(Number.NaN, NOW)).toBeNull();
  });
});

describe('SessionClock', () => {
  it('reaches 2 and then 4 minutes of visible play, each once', () => {
    const clock = new SessionClock();
    const reached: string[] = [];
    let now = NOW;
    expect(clock.advance(now, true)).toEqual([]);
    for (let second = 1; second <= 10 * 60; second += 1) {
      now += 1000;
      const marks = clock.advance(now, true);
      if (marks.length > 0) reached.push(`${second}:${marks.join(',')}`);
    }
    expect(reached).toEqual(['120:dust_session_2m', '240:dust_session_4m']);
  });

  it('does not count time the page is hidden', () => {
    const clock = new SessionClock();
    let now = NOW;
    clock.advance(now, true);
    for (let second = 0; second < 100; second += 1) clock.advance((now += 1000), true);
    for (let second = 0; second < 600; second += 1) expect(clock.advance((now += 1000), false)).toEqual([]);
    expect(clock.played).toBe(100_000);
    for (let second = 0; second < 19; second += 1) expect(clock.advance((now += 1000), true)).toEqual([]);
    expect(clock.advance((now += 1000), true)).toEqual(['dust_session_2m']);
  });

  it('credits at most a few seconds across a gap in the checks, and nothing for a clock set back', () => {
    const clock = new SessionClock();
    clock.advance(NOW, true);
    expect(clock.advance(NOW + 10 * 60 * 1000, true)).toEqual([]);
    expect(clock.played).toBe(MAX_SESSION_STEP_MS);
    clock.advance(NOW, true);
    expect(clock.played).toBe(MAX_SESSION_STEP_MS);
  });
});

describe('onceEach', () => {
  it('passes each event on once in a page load, whatever the order', () => {
    const sent: PlayEvent[] = [];
    const count = onceEach((event) => sent.push(event));
    for (const event of ['dust_seed_save', 'dust_seed_save', 'dust_seed_open', 'dust_return_1d', 'dust_seed_open', 'dust_session_2m', 'dust_session_2m'] as const) count(event);
    expect(sent).toEqual(['dust_seed_save', 'dust_seed_open', 'dust_return_1d', 'dust_session_2m']);
  });

  it('sends through countEvent by default: the name alone, as a beacon', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal('navigator', { sendBeacon });
    try {
      const count = onceEach();
      count('dust_seed_open');
      count('dust_seed_open');
      expect(sendBeacon.mock.calls).toEqual([['/api/count', '{"event":"dust_seed_open"}']]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('a channel landing (docs/specs/channel-counters.md)', () => {
  it("counts a listed channel's tag as from_<tag>, and nothing for no tag or one off the list", () => {
    expect(sourceEvent('?from=reddit')).toBe('from_reddit');
    expect(sourceEvent('?seed=abc&from=bsky')).toBe('from_bsky');
    for (const tag of CHANNEL_SOURCES) expect(sourceEvent(`?from=${tag}`)).toBe(`from_${tag}`);
    expect(sourceEvent('')).toBeNull();
    expect(sourceEvent('?from=elsewhere')).toBeNull();
    expect(sourceEvent('?from=REDDIT')).toBeNull();
    expect(sourceEvent('?from=broadcast')).toBeNull();
  });

  it('drops the tag and keeps the rest of the query, so a seed link still opens', () => {
    expect(withoutSource('?from=reddit')).toBe('');
    expect(withoutSource('?seed=abc&from=reddit')).toBe('?seed=abc');
  });

  it("lists the same channels as the site, and every landing is a name the site's counter takes", () => {
    const repo = join(PACKAGE_DIR, '..');
    const site = readFileSync(join(repo, 'platform', 'site', 'src', 'lib', 'count.ts'), 'utf8');
    const list = (text: string) => text.match(/export const CHANNEL_SOURCES = \[([^\]]*)\]/)?.[1];
    expect(list(site)).toBe(list(readFileSync(join(PACKAGE_DIR, 'render', 'count.ts'), 'utf8')));
    const card = readFileSync(join(repo, 'platform', 'site', 'netlify', 'functions', 'card.mts'), 'utf8');
    for (const tag of CHANNEL_SOURCES) expect(card).toContain(`'from_${tag}'`);
  });
});

describe('the counters in render/main.ts', () => {
  const main = readFileSync(join(PACKAGE_DIR, 'render', 'main.ts'), 'utf8');

  it('sends the returning, session and seed counts through one once-each sender', () => {
    expect(main).toContain('const countOnce = onceEach();');
    expect(main).toContain('returnEvent(save?.savedAt ?? null, loadedAt)');
    expect(main).toContain("countOnce('dust_seed_save')");
    expect(main).toContain("if (seedState !== null) countOnce('dust_seed_open')");
    expect(main).toContain('session.advance(Date.now(), !document.hidden)');
    expect(main).toContain('const landing = sourceEvent(window.location.search);');
    expect(main).toContain('countOnce(landing);');
  });

  it('reads no storage key for counting: the save and the record of the daily run are the only keys it reads', () => {
    expect(main.match(/getItem\(/g)).toHaveLength(2);
    expect(main).toContain('storage()?.getItem(SAVE_KEY)');
    expect(main).toContain('storage()?.getItem(DAILY_KEY)');
  });

  it('sends only names the site counter takes (platform/site/netlify/functions/card.mts PLAY_EVENTS)', () => {
    const source = readFileSync(join(PACKAGE_DIR, 'render', 'count.ts'), 'utf8');
    const union = source.match(/export type PlayEvent =([\s\S]*?);/)?.[1] ?? '';
    expect([...union.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1])).toEqual([
      'dust_load', 'dust_share', 'dust_next_card',
      'dust_return_1d', 'dust_return_7d', 'dust_session_2m', 'dust_session_4m', 'dust_seed_save', 'dust_seed_open',
      'dust_daily_start', 'dust_daily_finish', 'dust_daily_share',
    ]);
  });
});
