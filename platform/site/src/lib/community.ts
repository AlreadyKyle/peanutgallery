import { useCallback, useEffect, useRef, useState } from 'react';
import { COMMUNITY_API, type FeedDoc, type FeedEvent, type PageDoc } from './community-types';
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
 * `path` null reads nothing and stays loading. What is held belongs to one path: a new path (another
 * sort or filter) reads as loading until it answers, and a new path that fails shows its own
 * unavailable state, never the previous path's list under the new choice.
 */
export function useCommunity<T>(path: string | null, pollMs = 0): Loaded<T> & { reload: () => void } {
  const [held, setHeld] = useState<{ path: string | null; value: Loaded<T> }>({ path, value: { state: 'loading' } });
  const [nonce, setNonce] = useState(0);
  // Trying again after a failure shows loading until the document answers.
  const reload = useCallback(() => {
    setHeld((was) => (was.value.state === 'unavailable' ? { path: was.path, value: { state: 'loading' } } : was));
    setNonce((n) => n + 1);
  }, []);
  useEffect(() => {
    if (path === null) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let started = false;
    const load = () => {
      started = true;
      getCommunity<T>(path)
        .then((data) => live && setHeld({ path, value: { state: 'ready', data } }))
        .catch((error: unknown) => {
          if (!live) return;
          // A failed refresh of the same path keeps what is on screen.
          setHeld((was) =>
            was.path === path && was.value.state === 'ready'
              ? was
              : { path, value: { state: 'unavailable', status: error instanceof CommunityError ? error.status : null } },
          );
        })
        .finally(() => {
          if (live && pollMs > 0 && document.visibilityState === 'visible') timer = setTimeout(load, pollMs);
        });
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible' && timer === null && (pollMs > 0 || !started)) load();
      else if (document.visibilityState !== 'visible' && timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };
    // Like the snapshot (lib/studio.tsx), a tab opened hidden reads nothing until it is shown.
    if (document.visibilityState === 'visible') load();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [path, pollMs, nonce]);
  const state: Loaded<T> = held.path === path ? held.value : { state: 'loading' };
  return { ...state, reload };
}

/** `path` with a keyset cursor added to its query. */
export function withCursor(path: string, cursor: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}cursor=${encodeURIComponent(cursor)}`;
}

type MorePages<T> = {
  readonly from: PageDoc<T>;
  readonly items: readonly T[];
  readonly next: string | null;
  readonly loading: boolean;
  readonly failed: boolean;
};

/**
 * A paged community list (PageDoc): the first page from useCommunity, then Show more reads the next
 * page with its cursor and appends it. The pages it appended belong to the first page they followed,
 * so a new sort, a new filter or a reload starts again from its own first page.
 */
export function usePagedCommunity<T extends { readonly id: string }>(path: string | null) {
  const head = useCommunity<PageDoc<T>>(path);
  const [more, setMore] = useState<MorePages<T> | null>(null);
  const doc = head.state === 'ready' ? head.data : null;
  const current = more !== null && doc !== null && more.from === doc ? more : null;
  const next = current === null ? (doc?.next ?? null) : current.next;
  const loadMore = useCallback(() => {
    if (path === null || doc === null || next === null) return;
    const base = (was: MorePages<T> | null): MorePages<T> =>
      was !== null && was.from === doc ? was : { from: doc, items: [], next: doc.next, loading: false, failed: false };
    setMore((was) => ({ ...base(was), loading: true, failed: false }));
    getCommunity<PageDoc<T>>(withCursor(path, next))
      .then((page) =>
        setMore((was) => {
          const kept = base(was);
          return { ...kept, items: [...kept.items, ...page.items], next: page.next, loading: false };
        }),
      )
      .catch(() => setMore((was) => ({ ...base(was), loading: false, failed: true })));
  }, [path, doc, next]);
  const seen = new Set<string>();
  const items = doc === null ? [] : [...doc.items, ...(current?.items ?? [])].filter((item) => (seen.has(item.id) ? false : (seen.add(item.id), true)));
  // Whether the list has shown an item since the page opened: its sort and filters draw only then, so
  // an empty list has none above it, and a new sort or filter that loads, or comes back empty, keeps them.
  const [listed, setListed] = useState(false);
  if (!listed && items.length > 0) setListed(true);
  return {
    state: head.state,
    items,
    listed: listed || items.length > 0,
    hasMore: next !== null,
    loadMore,
    loadingMore: current?.loading ?? false,
    moreFailed: current?.failed ?? false,
    reload: head.reload,
  };
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
