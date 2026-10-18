// Kernel (platform/gate/kernel-paths.txt; docs/specs/play-counts.md, docs/specs/counter-senders.md):
// one Dust load or press counted, with nothing that names the player. It posts {"event": "<name>"} to
// /api/count on this origin, which netlify.toml proxies to the site's counter, so connect-src 'self'
// holds. No cookie, no identifier, no address; the answer is never read and a failure is dropped, so
// counting never holds up the game.
//
// The benchmarks' counters (docs/strategy/benchmarks.md) are decided here, on the player's device, from
// what the page already holds: the age of the save's own savedAt for a return, the time the page has
// been visible for a session, a press or a ?seed= link for a seed, and a channel's source tag in the
// address for a landing (docs/specs/channel-counters.md). Nothing new is stored to decide them, and
// each is sent at most once per page load.

// The daily counters (docs/specs/daily-dust.md): a Daily Dust run started, finished and shared. A server
// that does not know a name yet answers 400, and the game never reads the answer.
export type PlayEvent =
  | 'dust_load'
  | 'dust_share'
  | 'dust_next_card'
  | 'dust_return_1d'
  | 'dust_return_7d'
  | 'dust_session_2m'
  | 'dust_session_4m'
  | 'dust_seed_save'
  | 'dust_seed_open'
  | 'dust_daily_start'
  | 'dust_daily_finish'
  | 'dust_daily_share'
  | ChannelEvent;

/**
 * The channels whose links carry a source tag (docs/specs/channel-counters.md): the promo engine's
 * channels, then the ones a person posts to. A load with `from=<tag>` counts `from_<tag>`. The same
 * list is in platform/site/src/lib/count.ts, and its events in the site's PLAY_EVENTS and the
 * database's count_play_event.
 */
export const CHANNEL_SOURCES = ['x', 'bsky', 'threads', 'mastodon', 'discord', 'yt', 'tiktok', 'ig', 'linkedin', 'reddit', 'hn', 'itch', 'ph', 'creator'] as const;
export type ChannelSource = (typeof CHANNEL_SOURCES)[number];
export type ChannelEvent = `from_${ChannelSource}`;
export const SOURCE_PARAM = 'from';

/** The landing count a load's query (`location.search`) makes: `from_<tag>` for a listed channel, else null. */
export function sourceEvent(search: string): ChannelEvent | null {
  const tag = new URLSearchParams(search).get(SOURCE_PARAM);
  return tag !== null && (CHANNEL_SOURCES as readonly string[]).includes(tag) ? `from_${tag as ChannelSource}` : null;
}

/** The query without the source tag, '' when nothing is left, so a reload or a copied address does not count again. */
export function withoutSource(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SOURCE_PARAM);
  const rest = params.toString();
  return rest === '' ? '' : `?${rest}`;
}

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

/**
 * A sender that passes each event on at most once: one is made per page load (render/main.ts), so a
 * second Save as seed press or a second ?seed= offer in the same load adds nothing.
 */
export function onceEach(send: (event: PlayEvent) => void = (event) => countEvent(event)): (event: PlayEvent) => void {
  const sent = new Set<PlayEvent>();
  return (event) => {
    if (sent.has(event)) return;
    sent.add(event);
    send(event);
  };
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The returning windows, from docs/strategy/benchmarks.md (Player D1 and D7): a load from a save at
 * least 20 hours and under 48 hours old, and from a save at least 6 days and under 8 days old.
 */
export const RETURN_WINDOWS: readonly { event: 'dust_return_1d' | 'dust_return_7d'; fromMs: number; toMs: number }[] = [
  { event: 'dust_return_1d', fromMs: 20 * HOUR_MS, toMs: 48 * HOUR_MS },
  { event: 'dust_return_7d', fromMs: 6 * DAY_MS, toMs: 8 * DAY_MS },
];

/**
 * Which returning count a load makes, from when its save was written (the save's own savedAt, read by
 * sim/save.ts parseSavedAt) and the clock now; null for no save, a save without savedAt, a clock set
 * back, or an age outside both windows.
 */
export function returnEvent(savedAt: number | null, now: number): 'dust_return_1d' | 'dust_return_7d' | null {
  if (savedAt === null || !Number.isFinite(savedAt) || !Number.isFinite(now)) return null;
  const age = now - savedAt;
  for (const range of RETURN_WINDOWS) if (age >= range.fromMs && age < range.toMs) return range.event;
  return null;
}

/** The session buckets (docs/strategy/benchmarks.md, Session length): the benchmark's floor and target. */
export const SESSION_MARKS: readonly { event: 'dust_session_2m' | 'dust_session_4m'; ms: number }[] = [
  { event: 'dust_session_2m', ms: 2 * 60 * 1000 },
  { event: 'dust_session_4m', ms: 4 * 60 * 1000 },
];

/**
 * The longest step one call credits. The page checks every second while it is open; a longer gap
 * means the timers were held (a hidden tab, a sleeping laptop), and that time is not play.
 */
export const MAX_SESSION_STEP_MS = 5_000;

/**
 * Play time in this page load: the time the page has been visible, from calls to `advance` with the
 * clock and whether the page is visible. `advance` answers the session marks just reached, each once.
 */
export class SessionClock {
  private playedMs = 0;
  private last: number | null = null;
  private next = 0;

  get played(): number {
    return this.playedMs;
  }

  advance(now: number, visible: boolean): ('dust_session_2m' | 'dust_session_4m')[] {
    if (this.last !== null && visible && Number.isFinite(now)) {
      const step = now - this.last;
      if (step > 0) this.playedMs += Math.min(step, MAX_SESSION_STEP_MS);
    }
    if (Number.isFinite(now)) this.last = now;
    const reached: ('dust_session_2m' | 'dust_session_4m')[] = [];
    while (this.next < SESSION_MARKS.length && this.playedMs >= SESSION_MARKS[this.next]!.ms) {
      reached.push(SESSION_MARKS[this.next]!.event);
      this.next += 1;
    }
    return reached;
  }
}
