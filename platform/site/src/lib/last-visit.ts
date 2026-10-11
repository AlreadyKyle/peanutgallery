import { useEffect, useState } from 'react';
import { shippedAt, shippedOrder } from './cards';
import type { Card } from './source';

// "Since your last visit" on home (docs/specs/supporter-loop.md). The only thing kept is the time of
// this browser's last visit, in localStorage: no id, no account and nothing sent anywhere. Storage
// can be blocked or throw, so every read and write is wrapped and the strip simply does not show.

export const LAST_VISIT_KEY = 'peanutgallery.home.lastVisit';
/** The strip lists at most this many cards, newest ship first. */
export const SINCE_LIMIT = 5;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** The stored last visit, as epoch ms, or null for a first visit, blocked storage or a bad value. */
export function readLastVisit(storage: StorageLike | null): number | null {
  try {
    const raw = storage?.getItem(LAST_VISIT_KEY) ?? null;
    if (raw === null) return null;
    const ms = Date.parse(raw);
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

export function writeLastVisit(storage: StorageLike | null, now: Date): void {
  try {
    storage?.setItem(LAST_VISIT_KEY, now.toISOString());
  } catch {
    // Blocked storage: the next visit is a first visit again.
  }
}

/** The cards that went live after `since`, newest first, at most SINCE_LIMIT; none on a first visit. */
export function shippedSince(cards: readonly Card[], since: number | null): Card[] {
  if (since === null) return [];
  return cards
    .filter((card) => card.stage === 'live' && Date.parse(shippedAt(card)) > since)
    .sort(shippedOrder)
    .slice(0, SINCE_LIMIT);
}

function localStore(): StorageLike | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The last visit, read once when home mounts; this visit is then stored, so the list stays put for
 * the rest of this visit and the next visit counts from now.
 */
export function useLastVisit(): number | null {
  const [state] = useState(() => {
    const storage = localStore();
    return { storage, since: readLastVisit(storage) };
  });
  useEffect(() => {
    writeLastVisit(state.storage, new Date());
  }, [state]);
  return state.since;
}
