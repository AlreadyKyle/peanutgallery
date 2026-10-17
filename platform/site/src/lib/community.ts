import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMUNITY_API, type FeedDoc, type FeedEvent } from './community-types';
import { copy } from './copy';
import { formatDate } from './format';
import { rarityOf, suitOf } from './suits';
import type { Snapshot } from './source';

// The community documents (docs/specs/final-state.md; the contract is community-types.ts), read from
// the site's own origin, cached at the edge. Every page that reads one draws an honest unavailable
// state when it fails: the backend lands in its own pull request, and the site never shows made-up
// data in its place. A document is only trusted when it answers JSON: a static host's fallback page
// answers HTML for an unknown path, which reads as unavailable.

export type Loaded<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'unavailable'; status: number | null };

export class CommunityError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
  ) {
    super(message);
  }
}

export async function getCommunity<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${COMMUNITY_API}${path}`, { headers: { Accept: 'application/json' }, ...init });
  } catch {
    throw new CommunityError('offline', null);
  }
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('application/json')) throw new CommunityError(`status ${response.status}`, response.status);
  return (await response.json()) as T;
}

/**
 * One community document, read once and then every `pollMs` while the tab is visible (0: once).
 * `path` null reads nothing and stays loading.
 */
export function useCommunity<T>(path: string | null, pollMs = 0): Loaded<T> & { reload: () => void } {
  const [state, setState] = useState<Loaded<T>>({ state: 'loading' });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const load = () => {
      getCommunity<T>(path)
        .then((data) => live && setState({ state: 'ready', data }))
        .catch((error: unknown) => {
          if (!live) return;
          // A failed refresh keeps what is on screen.
          setState((was) => (was.state === 'ready' ? was : { state: 'unavailable', status: error instanceof CommunityError ? error.status : null }));
        })
        .finally(() => {
          if (live && pollMs > 0 && document.visibilityState === 'visible') timer = setTimeout(load, pollMs);
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && timer === null && pollMs > 0) load();
      else if (document.visibilityState !== 'visible' && timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    load();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [path, pollMs, nonce]);
  return { ...state, reload };
}

/** How long ago, in a few plain words: "just now", "4 min ago", "3 h ago", "2 days ago", then the date. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return '';
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return copy.time.justNow;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return copy.time.minutes.replace('{n}', String(minutes));
  const hours = Math.round(minutes / 60);
  if (hours < 24) return copy.time.hours.replace('{n}', String(hours));
  const days = Math.round(hours / 24);
  if (days < 7) return (days === 1 ? copy.time.day : copy.time.days).replace('{n}', String(days));
  return formatDate(iso);
}

/**
 * The pipe's fallback when /api/community/feed does not answer: the events the snapshot itself can
 * tell, from fixed templates (card text is the card's own title, which the card document already
 * shows). No contribution names anyone: the snapshot does not carry who paid.
 */
export function feedFromSnapshot(snapshot: Snapshot, limit = 20): FeedEvent[] {
  const events: FeedEvent[] = [];
  for (const card of snapshot.cards) {
    const base = { cardId: card.id, suit: suitOf(card), rarity: rarityOf(card) } as const;
    if (card.stage === 'live' && card.live_at !== null) {
      events.push({ id: `ship-${card.id}`, at: card.live_at, kind: 'shipped', text: copy.pipe.derived.shipped.replace('{title}', card.title), ...base });
    } else if (card.stage === 'building' || card.stage === 'gated') {
      const text = card.stage === 'building' ? copy.pipe.derived.building : copy.pipe.derived.checks;
      events.push({ id: `stage-${card.id}-${card.stage}`, at: card.updated_at, kind: 'stage', text: text.replace('{title}', card.title), ...base });
    } else if (card.horizon === 'now' && card.stage !== 'funded') {
      events.push({ id: `open-${card.id}`, at: card.created_at, kind: 'card_opened', text: copy.pipe.derived.opened.replace('{title}', card.title), ...base });
    }
    if (card.funded_usd > 0 && card.stage !== 'live') {
      const funding = snapshot.funding[card.id];
      const contributors = funding?.contributors ?? 0;
      const text = (contributors === 1 ? copy.pipe.derived.fundedOne : copy.pipe.derived.fundedMany)
        .replace('{n}', String(contributors))
        .replace('{title}', card.title);
      if (contributors > 0) events.push({ id: `funding-${card.id}`, at: card.updated_at, kind: 'contribution', text, ...base });
    }
  }
  return events.sort((a, b) => Date.parse(b.at) - Date.parse(a.at)).slice(0, limit);
}

/**
 * The pipe's reading: the feed, polled every 15 seconds while the tab is visible, with keyset paging
 * for older events. `available` is false when the feed did not answer, and the pipe then tells the
 * snapshot's events.
 */
export function useFeed(pollMs = 15_000) {
  const head = useCommunity<FeedDoc>('/feed', pollMs);
  const [older, setOlder] = useState<FeedEvent[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const started = useRef(false);
  const headEvents = head.state === 'ready' ? head.data.events : [];
  useEffect(() => {
    if (head.state === 'ready' && !started.current) {
      started.current = true;
      setNext(head.data.next);
    }
  }, [head]);
  const loadOlder = useCallback(() => {
    if (next === null) return;
    setLoadingOlder(true);
    getCommunity<FeedDoc>(`/feed?cursor=${encodeURIComponent(next)}`)
      .then((doc) => {
        setOlder((was) => [...was, ...doc.events]);
        setNext(doc.next);
      })
      .catch(() => setNext(null))
      .finally(() => setLoadingOlder(false));
  }, [next]);
  const seen = new Set<string>();
  const events = [...headEvents, ...older].filter((event) => (seen.has(event.id) ? false : (seen.add(event.id), true)));
  return { state: head.state, events, hasOlder: next !== null, loadOlder, loadingOlder };
}
