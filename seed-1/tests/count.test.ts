import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { COUNT_PATH, countEvent } from '../render/count';
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
