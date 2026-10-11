// Kernel (docs/specs/play-counts.md): one press counted, with nothing that names who pressed. It
// posts {"event": "<name>"} to the site's own /api/count (netlify/functions/card.mts), which adds one
// to that event's daily total. No cookie, no identifier, no address; the answer is never read, and a
// failure is dropped, so counting never holds up or breaks the page.

export type PlayEvent = 'card_share';

export const COUNT_PATH = '/api/count';

export function countEvent(event: PlayEvent): void {
  try {
    const body = JSON.stringify({ event });
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(COUNT_PATH, body)) return;
    void fetch(COUNT_PATH, {
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
