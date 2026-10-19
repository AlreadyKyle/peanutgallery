// Kernel (docs/specs/play-counts.md, docs/specs/counter-senders.md): one press or visit counted, with
// nothing that names who it was. It posts {"event": "<name>"} to the site's own /api/count
// (netlify/functions/card.mts), which adds one to that event's daily total. No cookie, no identifier,
// no address, nothing stored in the browser; the answer is never read, and a failure is dropped, so
// counting never holds up or breaks the page.
//
// The benchmarks' counters (docs/strategy/benchmarks.md) are decided here from what the page already
// knows: the route on show, how long home has been visible, the QR code's or a channel's source tag in
// the address (docs/specs/channel-counters.md), and a press on a Discord link, a Payment Link or, on
// home, a link into the game (the funnel, docs/specs/counter-senders.md). useSiteCounts wires them
// into the frame (App.tsx).

import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

/**
 * The channels whose links carry a source tag (docs/specs/channel-counters.md): the promo engine's
 * channels, then the ones a person posts to. A landing with `from=<tag>` counts `from_<tag>`. The same
 * list is in seed-1/render/count.ts, and its events in card.mts's PLAY_EVENTS and count_play_event.
 */
export const CHANNEL_SOURCES = ['x', 'bsky', 'threads', 'mastodon', 'discord', 'yt', 'tiktok', 'ig', 'linkedin', 'reddit', 'hn', 'itch', 'ph', 'creator'] as const;
export type ChannelSource = (typeof CHANNEL_SOURCES)[number];
export type ChannelEvent = `from_${ChannelSource}`;

export type PlayEvent =
  | 'card_share'
  | 'home_load'
  | 'home_dwell_mid'
  | 'home_dwell_long'
  | 'broadcast_load'
  | 'broadcast_qr'
  | 'discord_click'
  | ChannelEvent
  | 'contribute_load'
  | 'checkout_open'
  | 'home_play_click';

export const COUNT_PATH = '/api/count';

type Beacon = Pick<Navigator, 'sendBeacon' | 'webdriver'>;

export function countEvent(event: PlayEvent, nav: Partial<Beacon> = navigator, fetchFn: typeof fetch = fetch): void {
  try {
    // An automated browser says so in navigator.webdriver (WebDriver and Playwright set it): that is a
    // check or a screenshot run, not a visitor, so nothing is counted (docs/specs/counter-senders.md).
    if (nav.webdriver === true) return;
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

/** A sender that passes each event on at most once: the page load's own is made when this module loads. */
export function onceEach(send: (event: PlayEvent) => void = (event) => countEvent(event)): (event: PlayEvent) => void {
  const sent = new Set<PlayEvent>();
  return (event) => {
    if (sent.has(event)) return;
    sent.add(event);
    send(event);
  };
}

/**
 * The dwell buckets on home (docs/strategy/benchmarks.md, Studio dwell): the benchmark's floor (15
 * seconds) and target (45 seconds). The share of home views reaching each is the share whose dwell is
 * at least that long, so the median meets the floor or the target when that share is a half or more.
 */
export const DWELL_MARKS: readonly { event: 'home_dwell_mid' | 'home_dwell_long'; ms: number }[] = [
  { event: 'home_dwell_mid', ms: 15_000 },
  { event: 'home_dwell_long', ms: 45_000 },
];

/** The longest step one call credits: a longer gap means the timers were held (a hidden tab, a sleeping laptop). */
export const MAX_DWELL_STEP_MS = 5_000;

/**
 * Time on one view of home: the time it has been visible, from calls to `advance` with the clock and
 * whether the page is visible. `advance` answers the dwell marks just reached, each once.
 */
export class DwellClock {
  private shownMs = 0;
  private last: number | null = null;
  private next = 0;

  get shown(): number {
    return this.shownMs;
  }

  advance(now: number, visible: boolean): ('home_dwell_mid' | 'home_dwell_long')[] {
    if (this.last !== null && visible && Number.isFinite(now)) {
      const step = now - this.last;
      if (step > 0) this.shownMs += Math.min(step, MAX_DWELL_STEP_MS);
    }
    if (Number.isFinite(now)) this.last = now;
    const reached: ('home_dwell_mid' | 'home_dwell_long')[] = [];
    while (this.next < DWELL_MARKS.length && this.shownMs >= DWELL_MARKS[this.next]!.ms) {
      reached.push(DWELL_MARKS[this.next]!.event);
      this.next += 1;
    }
    return reached;
  }
}

/** The source tag the broadcast's QR code carries (docs/specs/final-state.md, Channels): `?from=broadcast`. */
export const SOURCE_PARAM = 'from';
export const QR_SOURCE = 'broadcast';

/** The address with the QR code's source tag. */
export function withQrSource(url: string): string {
  const tagged = new URL(url);
  tagged.searchParams.set(SOURCE_PARAM, QR_SOURCE);
  return tagged.toString();
}

/** Whether an address's query (`location.search`) carries the QR code's source tag. */
export function fromQr(search: string): boolean {
  return new URLSearchParams(search).get(SOURCE_PARAM) === QR_SOURCE;
}

/**
 * The count a landing's source tag makes: `broadcast_qr` for the QR code's, `from_<tag>` for a channel
 * in CHANNEL_SOURCES, and null for no tag or one not on the list (that address is left as it is).
 */
export function sourceEvent(search: string): 'broadcast_qr' | ChannelEvent | null {
  const tag = new URLSearchParams(search).get(SOURCE_PARAM);
  if (tag === QR_SOURCE) return 'broadcast_qr';
  return tag !== null && (CHANNEL_SOURCES as readonly string[]).includes(tag) ? `from_${tag as ChannelSource}` : null;
}

/** The query without the source tag, '' when nothing is left, so a reload or a copied address does not count again. */
export function withoutSource(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SOURCE_PARAM);
  const rest = params.toString();
  return rest === '' ? '' : `?${rest}`;
}

const DISCORD_HOSTS = ['discord.gg', 'discord.com', 'discordapp.com'];

/** Whether a link goes to Discord: the site's invite, or any address on Discord's own hosts. */
export function isDiscordLink(href: string, invite: string): boolean {
  if (href === '') return false;
  if (invite !== '' && href === invite) return true;
  let host: string;
  try {
    host = new URL(href).hostname.toLowerCase();
  } catch {
    return false;
  }
  return DISCORD_HOSTS.some((known) => host === known || host.endsWith(`.${known}`));
}

/**
 * Whether a link opens checkout: the site's own Payment Link, at the same https address with any query
 * (a card's Fund adds `client_reference_id`). It compares against the configured link rather than the
 * payment host, so the build names no payment address but that one (platform/gate/payment-host-scan.mjs).
 * No Payment Link, no checkout link.
 */
export function isCheckoutLink(href: string, paymentLink: string): boolean {
  if (href === '' || paymentLink === '') return false;
  try {
    const link = new URL(href);
    const checkout = new URL(paymentLink);
    return link.protocol === 'https:' && link.origin === checkout.origin && link.pathname === checkout.pathname;
  } catch {
    return false;
  }
}

/**
 * Whether a link goes into the game: the play address's origin, at or under its path, with any query
 * or hash (a card's Play adds `from=card`). No play address, no game link.
 */
export function isGameLink(href: string, playUrl: string): boolean {
  if (href === '' || playUrl === '') return false;
  try {
    const link = new URL(href);
    const game = new URL(playUrl);
    const base = game.pathname.replace(/\/+$/, '');
    return link.origin === game.origin && (link.pathname === base || link.pathname.startsWith(`${base}/`));
  } catch {
    return false;
  }
}

/** The link a press landed on: a click, or a middle-button press; null for anything else. */
function pressedLink(event: MouseEvent): HTMLAnchorElement | null {
  if (event.type === 'auxclick' && event.button !== 1) return null;
  const anchor = (event.target as Element | null)?.closest?.('a[href]');
  return anchor instanceof HTMLAnchorElement ? anchor : null;
}

// The paths these counts read, without a trailing slash and in lower case, as the router matches them.
const HOME_PATH = '/';
const BROADCAST_PATH = '/broadcast';
const CONTRIBUTE_PATH = '/contribute';
// How often the dwell clock is read, in milliseconds.
const DWELL_CHECK_MS = 1000;

function routePath(pathname: string): string {
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  return path === '' ? HOME_PATH : path;
}

function pageVisible(): boolean {
  return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

// The page load's own once-each sender: the broadcast's and /contribute's loads, a tagged landing, and
// a Discord or Payment Link press, each count once however many times this page load sees them.
const perPageLoad = onceEach();
const sendEach = (event: PlayEvent): void => countEvent(event);

/** The site's own addresses the counts read: its Discord invite, the game's play address and its Payment Link. */
export type CountLinks = { discordInvite: string; playUrl: string; stripePaymentLinkUrl?: string };

/**
 * The site's benchmark counters, mounted once by the frame (App.tsx):
 * - each view of home counts home_load once it is shown, and home_dwell_mid and home_dwell_long once the view has been
 *   visible 15 and 45 seconds; leaving home stops the clock;
 * - /broadcast counts broadcast_load, and /contribute contribute_load, once a page load;
 * - an address carrying the QR code's source tag counts broadcast_qr once, and a channel's tag counts
 *   from_<tag> once (docs/specs/channel-counters.md); either tag is then dropped;
 * - a press on a Discord link counts discord_click, and a press on a Payment Link checkout_open, once a
 *   page load; the link opens as before;
 * - a press on a link into the game while home is shown counts home_play_click, once a view of home,
 *   so it reads against home_load.
 */
export function useSiteCounts(links: CountLinks, send: (event: PlayEvent) => void = sendEach, once: (event: PlayEvent) => void = perPageLoad): void {
  const { discordInvite, playUrl } = links;
  const paymentLink = links.stripePaymentLinkUrl ?? '';
  const { pathname, search, hash } = useLocation();
  const navigate = useNavigate();
  const path = routePath(pathname);

  useEffect(() => {
    const landing = sourceEvent(search);
    if (landing === null) return;
    once(landing);
    navigate({ pathname, search: withoutSource(search), hash }, { replace: true });
  }, [pathname, search, hash, navigate, once]);

  useEffect(() => {
    if (path === BROADCAST_PATH) once('broadcast_load');
    if (path === CONTRIBUTE_PATH) once('contribute_load');
  }, [path, once]);

  useEffect(() => {
    if (path !== HOME_PATH) return;
    // A tab opened hidden is not a view yet: home_load waits until the page is first shown.
    let viewed = false;
    const countView = () => {
      if (viewed || !pageVisible()) return;
      viewed = true;
      send('home_load');
    };
    countView();
    const clock = new DwellClock();
    clock.advance(Date.now(), pageVisible());
    const timer = window.setInterval(() => {
      countView();
      for (const mark of clock.advance(Date.now(), pageVisible())) send(mark);
    }, DWELL_CHECK_MS);
    return () => window.clearInterval(timer);
  }, [path, send]);

  useEffect(() => {
    if (path !== HOME_PATH || playUrl === '') return;
    // One press counts for each view of home, however many of its Play links are pressed.
    let pressed = false;
    const onPress = (event: MouseEvent) => {
      const anchor = pressedLink(event);
      if (pressed || anchor === null || !isGameLink(anchor.href, playUrl)) return;
      pressed = true;
      send('home_play_click');
    };
    document.addEventListener('click', onPress, true);
    document.addEventListener('auxclick', onPress, true);
    return () => {
      document.removeEventListener('click', onPress, true);
      document.removeEventListener('auxclick', onPress, true);
    };
  }, [path, playUrl, send]);

  useEffect(() => {
    const onPress = (event: MouseEvent) => {
      const anchor = pressedLink(event);
      if (anchor === null) return;
      if (isDiscordLink(anchor.href, discordInvite)) once('discord_click');
      if (isCheckoutLink(anchor.href, paymentLink)) once('checkout_open');
    };
    document.addEventListener('click', onPress, true);
    document.addEventListener('auxclick', onPress, true);
    return () => {
      document.removeEventListener('click', onPress, true);
      document.removeEventListener('auxclick', onPress, true);
    };
  }, [discordInvite, paymentLink, once]);
}
