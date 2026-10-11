// Kernel (platform/gate/kernel-paths.txt; docs/specs/play-counts.md): one Dust load or press counted,
// with nothing that names the player. It posts {"event": "<name>"} to /api/count on this origin, which
// netlify.toml proxies to the site's counter, so connect-src 'self' holds. No cookie, no identifier, no
// address; the answer is never read and a failure is dropped, so counting never holds up the game.

export type PlayEvent = 'dust_load' | 'dust_share' | 'dust_next_card';

export const COUNT_PATH = '/api/count';

type Beacon = Pick<Navigator, 'sendBeacon'>;

export function countEvent(event: PlayEvent, nav: Partial<Beacon> = navigator, fetchFn: typeof fetch = fetch): void {
  try {
    const body = JSON.stringify({ event });
    if (typeof nav.sendBeacon === 'function' && nav.sendBeacon(COUNT_PATH, body)) return;
    void fetchFn(COUNT_PATH, {
      method: 'POST',
      body,
      keepalive: true,
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => undefined);
  } catch {
    // Counting is best effort.
  }
}
