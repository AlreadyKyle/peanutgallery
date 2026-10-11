import { describe, expect, it } from 'vitest';
import {
  LAST_VISIT_KEY,
  loadShippedSince,
  parseLastVisit,
  runWhatsNew,
  shippedSince,
  showWhatsNew,
  whatsNewText,
  type WhatsNewElements,
} from '../render/whats-new';

const SINCE = Date.parse('2026-10-01T00:00:00Z');

function doc(rows: Record<string, unknown>[]) {
  return { cards: rows };
}

const rows = [
  { id: 'a', title: 'Old Dust card', folder: 'seed-1', stage: 'live', live_at: '2026-09-20T00:00:00Z' },
  { id: 'b', title: 'Sweep unit', folder: 'seed-1', stage: 'live', live_at: '2026-10-03T00:00:00Z' },
  { id: 'c', title: 'Faster gatherers', folder: 'seed-1', stage: 'live', live_at: '2026-10-05T00:00:00Z' },
  { id: 'd', title: 'Site card', folder: 'platform', stage: 'live', live_at: '2026-10-06T00:00:00Z' },
  { id: 'e', title: 'Still building', folder: 'seed-1', stage: 'building', live_at: null },
];

function elements(): WhatsNewElements {
  const attrs: Record<string, string> = {};
  const link = {
    href: '',
    textContent: '',
    setAttribute: (k: string, v: string) => {
      attrs[k] = v;
    },
    attrs,
  } as unknown as HTMLAnchorElement;
  return { root: { hidden: true } as HTMLElement, link };
}

function memoryStore(init: Record<string, string> = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
  };
}

function okFetch(body: unknown): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch;
}

const failFetch = (async () => new Response('', { status: 500 })) as typeof fetch;

describe('shippedSince', () => {
  it('lists live Dust cards after the visit, newest first', () => {
    expect(shippedSince(doc(rows), SINCE).map((c) => c.id)).toEqual(['c', 'b']);
  });

  it('is empty for nothing new, other folders, unshipped or malformed rows', () => {
    expect(shippedSince(doc(rows), Date.parse('2026-10-10T00:00:00Z'))).toEqual([]);
    expect(shippedSince(null, SINCE)).toEqual([]);
    expect(shippedSince({ cards: 'x' }, SINCE)).toEqual([]);
    expect(shippedSince(doc([{ id: 'z', title: ' ', folder: 'seed-1', stage: 'live', live_at: '2026-10-05T00:00:00Z' }]), SINCE)).toEqual([]);
    expect(shippedSince(doc([{ id: 'z', title: 'T', folder: 'seed-1', stage: 'live', live_at: 'not a date' }]), SINCE)).toEqual([]);
  });
});

describe('parseLastVisit', () => {
  it('reads a positive integer and refuses anything else', () => {
    expect(parseLastVisit('1759276800000')).toBe(1759276800000);
    expect(parseLastVisit(null)).toBeNull();
    expect(parseLastVisit('abc')).toBeNull();
    expect(parseLastVisit('0')).toBeNull();
    expect(parseLastVisit('-5')).toBeNull();
  });
});

describe('the line', () => {
  it('names the one card, or the count and the newest, and links the newest card page', () => {
    const shipped = shippedSince(doc(rows), SINCE);
    expect(whatsNewText(shipped.slice(1))).toEqual({
      label: 'New in Dust since your last visit: Sweep unit',
      aria: "New in Dust since your last visit: Sweep unit. Open its card to see what's new.",
      href: 'https://mobmachine.games/card/b',
    });
    expect(whatsNewText(shipped)?.label).toBe('2 changes shipped since your last visit. Newest: Faster gatherers');
    expect(whatsNewText(shipped)?.href).toBe('https://mobmachine.games/card/c');
    expect(whatsNewText([])).toBeNull();
  });

  it('shows when something shipped and stays hidden otherwise', () => {
    const el = elements();
    showWhatsNew(el, shippedSince(doc(rows), SINCE));
    expect(el.root.hidden).toBe(false);
    expect(el.link.href).toBe('https://mobmachine.games/card/c');
    const empty = elements();
    showWhatsNew(empty, []);
    expect(empty.root.hidden).toBe(true);
    showWhatsNew(empty, null);
    expect(empty.root.hidden).toBe(true);
  });
});

describe('loadShippedSince', () => {
  it('reads /api/cards on this origin', async () => {
    let asked = '';
    const fetchFn = (async (path: string) => {
      asked = path;
      return new Response(JSON.stringify(doc(rows)), { status: 200 });
    }) as unknown as typeof fetch;
    expect((await loadShippedSince(SINCE, fetchFn))?.length).toBe(2);
    expect(asked).toBe('/api/cards');
  });

  it('is null on a failed or malformed read', async () => {
    expect(await loadShippedSince(SINCE, failFetch)).toBeNull();
    const offline = (async () => {
      throw new Error('offline');
    }) as typeof fetch;
    expect(await loadShippedSince(SINCE, offline)).toBeNull();
    expect(await loadShippedSince(SINCE, okFetch([]))).toBeNull();
  });
});

describe('runWhatsNew', () => {
  const NOW = Date.parse('2026-10-11T00:00:00Z');

  it('shows nothing on a first visit, and records the visit without a read', async () => {
    const el = elements();
    const store = memoryStore();
    let reads = 0;
    const fetchFn = (async () => {
      reads += 1;
      return new Response('{}');
    }) as typeof fetch;
    await runWhatsNew(el, store, 'dust.save', NOW, fetchFn);
    expect(el.root.hidden).toBe(true);
    expect(reads).toBe(0);
    expect(store.data.get(LAST_VISIT_KEY)).toBe(String(NOW));
  });

  it('a save with no recorded visit only records one', async () => {
    const el = elements();
    const store = memoryStore({ 'dust.save': '{}' });
    await runWhatsNew(el, store, 'dust.save', NOW, okFetch(doc(rows)));
    expect(el.root.hidden).toBe(true);
    expect(store.data.get(LAST_VISIT_KEY)).toBe(String(NOW));
  });

  it('a returning player sees what shipped, the visit moves to now, the save is untouched', async () => {
    const el = elements();
    const store = memoryStore({ 'dust.save': '{}', [LAST_VISIT_KEY]: String(SINCE) });
    await runWhatsNew(el, store, 'dust.save', NOW, okFetch(doc(rows)));
    expect(el.root.hidden).toBe(false);
    expect(store.data.get(LAST_VISIT_KEY)).toBe(String(NOW));
    expect(store.data.get('dust.save')).toBe('{}');
  });

  it('a failed read keeps the old visit so the news is not lost', async () => {
    const el = elements();
    const store = memoryStore({ 'dust.save': '{}', [LAST_VISIT_KEY]: String(SINCE) });
    await runWhatsNew(el, store, 'dust.save', NOW, failFetch);
    expect(el.root.hidden).toBe(true);
    expect(store.data.get(LAST_VISIT_KEY)).toBe(String(SINCE));
  });

  it('a storage that throws leaves the line hidden', async () => {
    const el = elements();
    const denied = (): never => {
      throw new Error('denied');
    };
    await runWhatsNew(el, { getItem: denied, setItem: denied }, 'dust.save', NOW, okFetch(doc(rows)));
    expect(el.root.hidden).toBe(true);
  });
});
