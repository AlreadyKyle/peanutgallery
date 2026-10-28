import { useEffect, useState } from 'react';
import { getCommunity, withCursor } from './community';
import type { FeedDoc, FeedEvent } from './community-types';

// This week, in public (QUEUE Q-053): the New York week so far, Monday 00:00 to now, counted from the
// public feed (/api/community/feed) only. Every line the feed holds is already public and written from
// fixed templates, so the page shows nothing the feed does not: the number of contributions (no
// amount: money statements are the ledger's and legal.ts's), cards opened, funded and shipped, and the players the feed names. It reads no private table and
// makes up no figure; when the feed does not answer, the page says so. The weeks line up with the
// weekly reports (docs/specs/studio-reports.md), which also run Monday to Sunday in New York time.

const ZONE = 'America/New_York';
/** The most feed pages one visit reads (30 events each): a busier week shows its newest 600 events. */
export const MAX_PAGES = 20;

const parts = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  weekday: 'short',
  hourCycle: 'h23',
});

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function nyParts(at: number) {
  const got: Record<string, string> = {};
  for (const part of parts.formatToParts(new Date(at))) got[part.type] = part.value;
  return {
    year: Number(got.year),
    month: Number(got.month),
    day: Number(got.day),
    wall: Date.UTC(Number(got.year), Number(got.month) - 1, Number(got.day), Number(got.hour), Number(got.minute), Number(got.second)),
    weekday: WEEKDAYS.indexOf(got.weekday ?? ''),
  };
}

/** The instant the New York week holding `now` began: its Monday at 00:00 New York time. */
export function weekStart(now: number): number {
  const today = nyParts(now);
  const monday = Date.UTC(today.year, today.month - 1, today.day - today.weekday);
  // New York's offset at that Monday (midnight is never inside a clock change there, which is at 02:00).
  const offset = nyParts(monday + 12 * 3_600_000).wall - (monday + 12 * 3_600_000);
  return monday - offset;
}

export type WeekCard = { readonly id: string; readonly title: string };

export type Week = {
  /** Monday 00:00 New York time, as an ISO instant. */
  readonly from: string;
  /** That Monday as a New York calendar day, YYYY-MM-DD. */
  readonly day: string;
  readonly contributions: number;
  readonly opened: number;
  readonly funded: readonly WeekCard[];
  readonly shipped: readonly WeekCard[];
  /** The players the feed names this week (contributors who chose to be named, suggesters, seed makers). */
  readonly players: number;
  /** False when the visit stopped reading at MAX_PAGES before reaching Monday. */
  readonly complete: boolean;
};

// The feed's stage lines are 'X is funded', 'X is building' and 'X is at the gate' (community.on_card).
const FUNDED = / is funded$/;

function cardOf(event: FeedEvent, suffix: RegExp): WeekCard | null {
  if (event.cardId === undefined) return null;
  return { id: event.cardId, title: event.text.replace(suffix, '') };
}

/** The week's figures from feed events (any order), counting only those at or after `from`. */
export function weekFrom(events: readonly FeedEvent[], from: number, complete = true): Week {
  const seen = new Set<string>();
  const players = new Set<string>();
  const funded = new Map<string, WeekCard>();
  const shipped = new Map<string, WeekCard>();
  let contributions = 0;
  let opened = 0;
  for (const event of events) {
    const at = Date.parse(event.at);
    if (!Number.isFinite(at) || at < from || seen.has(event.id)) continue;
    seen.add(event.id);
    if (event.actor) players.add(event.actor.handle);
    if (event.kind === 'contribution') {
      contributions += 1;
    } else if (event.kind === 'card_opened') {
      opened += 1;
    } else if (event.kind === 'stage' && FUNDED.test(event.text)) {
      const card = cardOf(event, FUNDED);
      if (card !== null) funded.set(card.id, card);
    } else if (event.kind === 'shipped') {
      const card = cardOf(event, / shipped$/);
      if (card !== null) shipped.set(card.id, card);
    }
  }
  const monday = nyParts(from);
  return {
    from: new Date(from).toISOString(),
    day: `${monday.year}-${String(monday.month).padStart(2, '0')}-${String(monday.day).padStart(2, '0')}`,
    contributions,
    opened,
    funded: [...funded.values()],
    shipped: [...shipped.values()],
    players: players.size,
    complete,
  };
}

/** The feed back to `from`, page by page (newest first), then the week counted from it. */
export async function loadWeek(now: number = Date.now(), read: typeof getCommunity = getCommunity): Promise<Week> {
  const from = weekStart(now);
  const events: FeedEvent[] = [];
  let path: string | null = '/feed';
  for (let page = 0; page < MAX_PAGES && path !== null; page += 1) {
    const doc: FeedDoc = await read<FeedDoc>(path);
    events.push(...doc.events);
    const oldest = doc.events.reduce((min, event) => Math.min(min, Date.parse(event.at)), Infinity);
    path = doc.next !== null && oldest >= from ? withCursor('/feed', doc.next) : null;
  }
  return weekFrom(events, from, path === null);
}

export type WeekState = { state: 'loading' } | { state: 'ready'; week: Week } | { state: 'unavailable' };

/** The week for /week, read once when the page opens. */
export function useWeek(): WeekState {
  const [state, setState] = useState<WeekState>({ state: 'loading' });
  useEffect(() => {
    let live = true;
    loadWeek()
      .then((week) => live && setState({ state: 'ready', week }))
      .catch(() => live && setState({ state: 'unavailable' }));
    return () => {
      live = false;
    };
  }, []);
  return state;
}

