import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_STUDIO, fundingOrder, moneyRow, type StudioFixture } from '../../e2e/studio-fixture';
import { toDocuments } from '../../e2e/snapshot-documents';
import { fundableCards, groupCards, plannedCards } from './cards';
import SNAPSHOT_KEYS from './snapshot-keys.json';
import {
  CARDS_MAX_AGE_MS,
  CARDS_URL,
  createSnapshotSource,
  ENRICHMENTS,
  LIVE_URL,
  REQUEST_TIMEOUT_MS,
  REQUIRED_KEYS,
  snapshotFrom,
  type Snapshot,
} from './source';

type Docs = { live: Record<string, unknown>; cards: Record<string, unknown> };

/** A fetch that answers the two documents from `docs()`, recording each URL it was asked for. */
function serving(docs: () => Docs, status: Partial<Record<string, number>> = {}) {
  const calls: string[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    calls.push(url);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body = url === LIVE_URL ? docs().live : url === CARDS_URL ? docs().cards : { error: 'not found' };
    return new Response(JSON.stringify(body), { status: status[url] ?? (url === LIVE_URL || url === CARDS_URL ? 200 : 404) });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function studioWith(fields: Partial<StudioFixture>): StudioFixture {
  return { ...DEFAULT_STUDIO, ...fields };
}

const golden = JSON.parse(readFileSync(resolve(process.cwd(), 'src/lib/__fixtures__/snapshot-golden.json'), 'utf8')) as unknown;

/**
 * The Snapshot without what supporter-pages added (docs/specs/supporter-pages.md): role stats, the
 * roster's status, trigger and pause, a card's dealing and veto, and each event's line key; and
 * copy-pass's board-work marker. The golden was captured before them, so it cannot hold them; they
 * are checked on their own below.
 */
function beforeSupporterPages(snapshot: Snapshot): unknown {
  const { roleStats: _stats, ...rest } = snapshot;
  return {
    ...rest,
    cards: rest.cards.map(({ opens_at: _o, board_vetoed: _v, board_veto_reason: _r, board_work: _w, ...card }) => card),
    roles: rest.roles.map(({ status: _s, trigger: _t, paused: _p, paused_reason: _pr, ...role }) => role),
    events: rest.events.map(({ line_key: _k, ...event }) => event),
  };
}

describe('the golden snapshot', () => {
  it('equals the Snapshot main built from the same fixture through the Supabase client, captured before it was removed', async () => {
    const { fetchFn } = serving(() => toDocuments(DEFAULT_STUDIO));
    const snapshot = await createSnapshotSource({ fetchFn }).load();
    expect(beforeSupporterPages(snapshot)).toEqual(golden);
  });

  it('adds each event line key, the role stats and the roster columns (supporter-pages)', async () => {
    const { fetchFn } = serving(() =>
      toDocuments({ ...DEFAULT_STUDIO, roleStats: { [String(DEFAULT_STUDIO.roles[0]!.id)]: { spent_usd: '1.2500', spent_7d_usd: '0.5000', shipped_cards: 2 } } }),
    );
    const snapshot = await createSnapshotSource({ fetchFn }).load();
    expect(snapshot.events.map((event) => event.line_key)).toEqual(['shipped', 'used_tool', 'started']);
    expect(snapshot.roleStats?.[String(DEFAULT_STUDIO.roles[0]!.id)]).toEqual({ spent_usd: 1.25, spent_7d_usd: 0.5, shipped_cards: 2 });
    expect(Object.keys(snapshot.roleStats ?? {})).toHaveLength(DEFAULT_STUDIO.roles.length);
    const builder = snapshot.roles.find((role) => role.title === 'Builder A')!;
    expect([builder.status, builder.trigger, builder.paused, builder.paused_reason]).toEqual(['running', null, false, null]);
    const biz = snapshot.roles.find((role) => role.title === 'Biz Dev')!;
    expect([biz.status, biz.trigger]).toEqual(['starts', 'Starts last, once every other role in the launch roster is built.']);
    expect(snapshot.cards.every((card) => card.board_vetoed === false && card.opens_at === null)).toBe(true);
  });

  it("reads each card's board-work marker, and a card document without one as not board work (copy-pass)", async () => {
    const marked = new Set(DEFAULT_STUDIO.cards.filter((card) => card.board_work === true).map((card) => String(card.id)));
    expect(marked.size).toBeGreaterThan(0);
    const { fetchFn } = serving(() => toDocuments(DEFAULT_STUDIO));
    const snapshot = await createSnapshotSource({ fetchFn }).load();
    expect(new Set(snapshot.cards.filter((card) => card.board_work === true).map((card) => card.id))).toEqual(marked);
    const unmarked = serving(() => toDocuments({ ...DEFAULT_STUDIO, cards: DEFAULT_STUDIO.cards.map(({ board_work: _w, ...card }) => card) }));
    const plain = await createSnapshotSource({ fetchFn: unmarked.fetchFn }).load();
    expect(plain.cards.every((card) => card.board_work === false)).toBe(true);
  });
});

describe('createSnapshotSource.load', () => {
  it('reads both documents on the first load, then /api/live alone each minute', async () => {
    let clock = 0;
    const { fetchFn, calls } = serving(() => toDocuments(DEFAULT_STUDIO));
    const source = createSnapshotSource({ fetchFn, now: () => clock });
    await source.load();
    expect([...calls].sort()).toEqual([CARDS_URL, LIVE_URL].sort());
    for (let minute = 1; minute <= 5; minute += 1) {
      clock = minute * 60_000;
      await source.load();
    }
    expect(calls.filter((url) => url === CARDS_URL)).toHaveLength(1);
    expect(calls.filter((url) => url === LIVE_URL)).toHaveLength(6);
  });

  it('reads /api/cards again once its copy is over five minutes old', async () => {
    let clock = 0;
    const { fetchFn, calls } = serving(() => toDocuments(DEFAULT_STUDIO));
    const source = createSnapshotSource({ fetchFn, now: () => clock });
    await source.load();
    clock = CARDS_MAX_AGE_MS;
    await source.load();
    expect(calls.filter((url) => url === CARDS_URL)).toHaveLength(1);
    clock = CARDS_MAX_AGE_MS + 1;
    await source.load();
    expect(calls.filter((url) => url === CARDS_URL)).toHaveLength(2);
    expect(CARDS_MAX_AGE_MS).toBe(300_000);
  });

  it('reads /api/cards again when the live map names a card it does not hold, and shows the card once it has it', async () => {
    const extra = { ...DEFAULT_STUDIO.cards[0]!, id: '00000000-0000-4000-8000-0000000000ff', title: 'A new card', created_at: '2026-09-16T00:00:00Z' };
    let docs = toDocuments(DEFAULT_STUDIO);
    const { fetchFn, calls } = serving(() => docs);
    const source = createSnapshotSource({ fetchFn, now: () => 0 });
    await source.load();
    docs = toDocuments(studioWith({ cards: [...DEFAULT_STUDIO.cards, extra] }));
    const snapshot = await source.load();
    expect(calls.filter((url) => url === CARDS_URL)).toHaveLength(2);
    expect(snapshot.cards.map((card) => card.title)).toContain('A new card');
  });

  it('does not show a card the card document holds but the live map does not', () => {
    const docs = toDocuments(DEFAULT_STUDIO);
    const cards = docs.live.cards as Record<string, unknown>;
    const gone = String((docs.cards.cards as Record<string, unknown>[])[0]!.id);
    delete cards[gone];
    const snapshot = snapshotFrom(docs.live, docs.cards);
    expect(snapshot.cards.map((card) => card.id)).not.toContain(gone);
    expect(snapshot.cards).toHaveLength(DEFAULT_STUDIO.cards.length - 1);
  });

  it('takes each card’s stage, bar and spend from the live map, which moves each minute', () => {
    const docs = toDocuments(DEFAULT_STUDIO);
    const id = String(DEFAULT_STUDIO.cards[0]!.id);
    const map = docs.live.cards as Record<string, Record<string, unknown>>;
    map[id] = { ...map[id], stage: 'building', funded_usd: 1.5, spent_usd: 0.25, contributors: 4, credited_usd: 1.5 };
    const card = snapshotFrom(docs.live, docs.cards).cards.find((c) => c.id === id)!;
    expect([card.stage, card.funded_usd, card.spent_usd]).toEqual(['building', 1.5, 0.25]);
    expect(snapshotFrom(docs.live, docs.cards).funding[id]).toEqual({ contributors: 4, credited_usd: 1.5 });
  });

  it('shows a card that just shipped with its ship time from the live map while the card document still says building', async () => {
    // The card document was built before the ship (CDN 300 seconds, stale 300 more); the live
    // document after it (60 seconds). The card shows live, shipped when the live map says, and first
    // among the shipped cards, not live with the building row's times.
    const building = DEFAULT_STUDIO.cards.find((card) => card.stage === 'funded')!;
    const before = toDocuments(studioWith({ cards: DEFAULT_STUDIO.cards.map((card) => (card === building ? { ...card, stage: 'building' } : card)) }));
    const shipped = { ...building, stage: 'live', live_at: '2026-09-23T12:00:00Z', updated_at: '2026-09-23T12:00:00Z' };
    const after = toDocuments(studioWith({ cards: DEFAULT_STUDIO.cards.map((card) => (card === building ? shipped : card)) }));
    const card = snapshotFrom(after.live, before.cards).cards.find((c) => c.id === building.id)!;
    expect([card.stage, card.live_at, card.updated_at]).toEqual(['live', '2026-09-23T12:00:00Z', '2026-09-23T12:00:00Z']);
    const shippedTitles = groupCards(snapshotFrom(after.live, before.cards).cards).shipped.map((c) => c.title);
    expect(shippedTitles[0]).toBe(building.title);
    // The same through the source: the held card document is fresh enough, so it is not read again.
    let docs = before;
    const { fetchFn, calls } = serving(() => docs);
    const source = createSnapshotSource({ fetchFn, now: () => 0 });
    await source.load();
    docs = { live: after.live, cards: before.cards };
    const loaded = await source.load();
    expect(calls.filter((url) => url === CARDS_URL)).toHaveLength(1);
    expect(loaded.cards.find((c) => c.id === building.id)?.live_at).toBe('2026-09-23T12:00:00Z');
  });

  it('moves a card the board deals from next to now into the fund group with its target, as funding_order lists it', () => {
    // The deal sets horizon, rank, target and builder in one write (set_card_horizon); the card
    // document still has the card on next with no target.
    const planned = DEFAULT_STUDIO.cards.find((card) => card.horizon === 'next')!;
    const dealt = { ...planned, horizon: 'now', rank: 1, funding_target_usd: '4.0000', executor_role_id: 'r-builder-a' };
    const before = toDocuments(DEFAULT_STUDIO);
    const after = toDocuments(
      studioWith({
        cards: DEFAULT_STUDIO.cards.map((card) => (card === planned ? dealt : card)),
        money: moneyRow({ funding_order: fundingOrder([planned.id]) }),
      }),
    );
    const snapshot = snapshotFrom(after.live, before.cards);
    const card = snapshot.cards.find((c) => c.id === planned.id)!;
    expect([card.horizon, card.rank, card.funding_target_usd, card.executor_role_id]).toEqual(['now', 1, 4, 'r-builder-a']);
    expect(groupCards(snapshot.cards).fund.map((c) => c.id)).toContain(planned.id);
    expect(plannedCards(snapshot.cards).next.map((c) => c.id)).not.toContain(planned.id);
    expect(fundableCards(snapshot).map((c) => c.id)).toEqual([planned.id]);
  });

  it('takes nothing that moves from the card document: only a card’s words, source, shape, folder, drafter and creation', () => {
    const docs = toDocuments(DEFAULT_STUDIO);
    const scrambled = (docs.cards.cards as Record<string, unknown>[]).map((row) => ({
      ...row,
      stage: 'proposed',
      horizon: 'later',
      rank: 99,
      executor_role_id: 'r-stale',
      funding_target_usd: 999,
      funded_usd: 999,
      live_at: '2000-01-01T00:00:00Z',
      updated_at: '2000-01-01T00:00:00Z',
    }));
    expect(beforeSupporterPages(snapshotFrom(docs.live, { ...docs.cards, cards: scrambled }))).toEqual(golden);
  });

  it('rejects a live map card missing a key or holding one of the wrong JSON type', () => {
    const docs = toDocuments(DEFAULT_STUDIO);
    const id = String(DEFAULT_STUDIO.cards[0]!.id);
    const map = docs.live.cards as Record<string, Record<string, unknown>>;
    for (const key of Object.keys(REQUIRED_KEYS.live_card)) {
      const entry = { ...map[id] };
      delete entry[key];
      expect(() => snapshotFrom({ ...docs.live, cards: { ...map, [id]: entry } }, docs.cards), key).toThrow(`/api/live cards.${id} has no ${key}`);
    }
    expect(() => snapshotFrom({ ...docs.live, cards: { ...map, [id]: { ...map[id], live_at: 5 } } }, docs.cards)).toThrow(`/api/live cards.${id}.live_at is number`);
    expect(() => snapshotFrom({ ...docs.live, cards: { ...map, [id]: { ...map[id], horizon: 'soon' } } }, docs.cards)).toThrow('Malformed horizon: soon');
    expect(() => snapshotFrom({ ...docs.live, cards: { ...map, [id]: 'live' } }, docs.cards)).toThrow(`/api/live cards.${id} is not a JSON object`);
  });

  it('lists paused and rejected cards only through stopped, as the pages do today', () => {
    const paused = { ...DEFAULT_STUDIO.cards[0]!, id: '00000000-0000-4000-8000-0000000000aa', stage: 'paused' };
    const rejected = { ...DEFAULT_STUDIO.cards[0]!, id: '00000000-0000-4000-8000-0000000000bb', stage: 'rejected' };
    const docs = toDocuments(studioWith({ cards: [...DEFAULT_STUDIO.cards, paused, rejected] }));
    expect(Object.keys(docs.live.cards as object)).toEqual(expect.arrayContaining([paused.id, rejected.id]));
    const ids = snapshotFrom(docs.live, docs.cards).cards.map((card) => card.id);
    expect(ids).not.toContain(paused.id);
    expect(ids).not.toContain(rejected.id);
  });

  it('ignores a key it does not know, in either document or a row', () => {
    const docs = toDocuments(DEFAULT_STUDIO);
    const snapshot = snapshotFrom(
      { ...docs.live, supporters: [{ n: 1 }], reports: null },
      { ...docs.cards, board_work: 'later', cards: (docs.cards.cards as object[]).map((row) => ({ ...row, future_column: 1 })) },
    );
    expect(beforeSupporterPages(snapshot)).toEqual(golden);
  });

  it('rejects a document missing a required key or holding one of the wrong JSON type', () => {
    const docs = toDocuments(DEFAULT_STUDIO);
    for (const key of Object.keys(REQUIRED_KEYS.live)) {
      const live = { ...docs.live };
      delete live[key];
      expect(() => snapshotFrom(live, docs.cards), key).toThrow(`/api/live has no ${key}`);
    }
    for (const key of Object.keys(REQUIRED_KEYS.cards)) {
      const cards = { ...docs.cards };
      delete cards[key];
      expect(() => snapshotFrom(docs.live, cards), key).toThrow(`/api/cards has no ${key}`);
    }
    expect(() => snapshotFrom({ ...docs.live, cards: [] }, docs.cards)).toThrow('/api/live.cards is array');
    expect(() => snapshotFrom({ ...docs.live, events: {} }, docs.cards)).toThrow('/api/live.events is object');
    expect(() => snapshotFrom({ ...docs.live, studio: null }, docs.cards)).toThrow('/api/live.studio is null');
    expect(() => snapshotFrom(docs.live, { ...docs.cards, terms: 'x' })).toThrow('/api/cards.terms is string');
    expect(() => snapshotFrom([], docs.cards)).toThrow('/api/live is not a JSON object');
  });

  it('marks a null money or stopped missing and keeps everything else', () => {
    for (const [fields, name] of [
      [{ money: null }, 'money'],
      [{ stopped: null }, 'stopped'],
    ] as const) {
      const docs = toDocuments(studioWith(fields));
      const snapshot = snapshotFrom(docs.live, docs.cards);
      expect(snapshot.missing).toEqual([name]);
      if (name === 'money') expect(snapshot.money).toBeNull();
      else expect(snapshot.stopped).toEqual([]);
      expect(snapshot.pool?.balance_usd).toBe(12.34);
    }
    const both = toDocuments(studioWith({ money: null, stopped: null }));
    expect(snapshotFrom(both.live, both.cards).missing).toEqual(['money', 'stopped']);
  });

  it('rejects the load on a malformed figure, never showing zero', () => {
    const cases: Partial<StudioFixture>[] = [
      { pool: { ...DEFAULT_STUDIO.pool, balance_usd: 'abc' } },
      { totals: { ...DEFAULT_STUDIO.totals, usd_total: 'x' } },
      { money: moneyRow({ short_usd: 'x' }) },
      { money: moneyRow({ funding_order: [{ card_id: 'c1', room_usd: 'y' }] }) },
      { spend: [{ card_id: DEFAULT_STUDIO.cards[4]!.id, spent_usd: 'z' }] },
      { funding: [{ card_id: DEFAULT_STUDIO.cards[0]!.id, contributors: 'y', credited_usd: '0' }] },
      { stopped: [{ card_id: 'c9', title: 'Stopped', stage: 'rejected', failing_check: null, spent_usd: 'z', funded_usd: '0', credited_usd: '0', moved: [], stopped_at: '2026-09-22T10:00:00Z' }] },
    ];
    for (const fields of cases) {
      const docs = toDocuments(studioWith(fields));
      // A card's figure in the live map that is not a number fails its type check; any other, money().
      expect(() => snapshotFrom(docs.live, docs.cards), JSON.stringify(fields)).toThrow(/Malformed|is string, not number/);
    }
  });

  it('keeps the books’ order: funding_order is the waterfall’s, card by card', () => {
    const order = fundingOrder([DEFAULT_STUDIO.cards[1]!.id, DEFAULT_STUDIO.cards[0]!.id]);
    const docs = toDocuments(studioWith({ money: moneyRow({ funding_order: order }) }));
    expect(snapshotFrom(docs.live, docs.cards).money?.funding_order).toEqual(order.map(({ card_id }) => ({ card_id, room_usd: 1 })));
  });

  it('reads each card’s horizon and rank from the live map, and the pause and the lane only when true', () => {
    const base = DEFAULT_STUDIO.cards[0]!;
    const docs = toDocuments(
      studioWith({
        cards: [
          { ...base, id: 'a', horizon: 'now', rank: null },
          { ...base, id: 'n', horizon: 'next', rank: '3', created_at: '2026-09-15T00:01:00Z' },
          { ...base, id: 'l', horizon: 'later', rank: 1, created_at: '2026-09-15T00:02:00Z' },
        ],
        paused: true,
        pauseReason: 'awaiting_credit',
      }),
    );
    const snapshot = snapshotFrom(docs.live, docs.cards);
    expect(snapshot.cards.map((card) => [card.id, card.horizon, card.rank])).toEqual([
      ['a', 'now', null],
      ['n', 'next', 3],
      ['l', 'later', 1],
    ]);
    expect([snapshot.paused, snapshot.pauseReason, snapshot.platformLaneOpen]).toEqual([true, 'awaiting_credit', false]);
    const open = { ...docs.live, studio: { launched_at: null, paused: false, platform_lane_open: true, pause_reason: 'board' } };
    const unpaused = snapshotFrom(open, docs.cards);
    expect([unpaused.paused, unpaused.pauseReason, unpaused.platformLaneOpen]).toEqual([false, null, true]);
  });

  it('builds card titles for events from the live document', () => {
    const docs = toDocuments(DEFAULT_STUDIO);
    const snapshot = snapshotFrom(docs.live, docs.cards);
    expect(snapshot.cardTitles).toEqual({ [String(DEFAULT_STUDIO.cards[4]!.id)]: DEFAULT_STUDIO.cards[4]!.title });
    expect(Object.keys(snapshot.events[0]!).sort()).toEqual(['card_id', 'created_at', 'id', 'line_key', 'role_id', 'type']);
  });

  it("keeps a line's step and amount, which the pages turn into what the database did to a card", () => {
    const docs = toDocuments(DEFAULT_STUDIO);
    const events = docs.live.events as Record<string, unknown>[];
    const live = { ...docs.live, events: [{ ...events[0]!, role_id: null, type: 'message', step: 'ceiling_top_up', usd: 2.5 }, ...events.slice(1)] };
    const [first] = snapshotFrom(live, docs.cards).events;
    expect([first!.step, first!.usd]).toEqual(['ceiling_top_up', 2.5]);
    expect(() => snapshotFrom({ ...docs.live, events: [{ ...events[0]!, usd: 'x' }] }, docs.cards)).toThrow('Malformed');
  });

  it('rejects when a document answers other than 200', async () => {
    for (const url of [LIVE_URL, CARDS_URL]) {
      const { fetchFn } = serving(() => toDocuments(DEFAULT_STUDIO), { [url]: 502 });
      await expect(createSnapshotSource({ fetchFn }).load()).rejects.toThrow(`${url} answered 502`);
    }
  });

  it('aborts a request that never answers after its timeout, and rejects the load', async () => {
    const hung = ((_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) return;
        signal.addEventListener('abort', () => reject(signal.reason));
      })) as unknown as typeof fetch;
    await expect(createSnapshotSource({ fetchFn: hung, timeoutMs: 20 }).load()).rejects.toThrow(/TimeoutError|timed out|aborted/i);
    expect(REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('names every enrichment the pages know, of which only money and stopped can now be missing', () => {
    expect([...ENRICHMENTS]).toEqual(['funding', 'spend', 'studio', 'totals', 'events', 'deploys', 'roles', 'money', 'stopped', 'cardTitles']);
  });

  it('requires the keys snapshot-keys.json lists, which the Deno migration test checks against the SQL', () => {
    expect(REQUIRED_KEYS).toEqual(SNAPSHOT_KEYS);
    expect(Object.keys(SNAPSHOT_KEYS.live).sort()).toEqual(['built_at', 'cards', 'deploys', 'events', 'money', 'pool', 'role_stats', 'stopped', 'studio', 'totals']);
    expect(Object.keys(SNAPSHOT_KEYS.live_card).sort()).toEqual([
      'contributors',
      'credited_usd',
      'executor_role_id',
      'funded_usd',
      'funding_target_usd',
      'horizon',
      'live_at',
      'rank',
      'spent_usd',
      'stage',
      'updated_at',
    ]);
    expect(Object.keys(SNAPSHOT_KEYS.cards).sort()).toEqual(['cards', 'roles', 'terms']);
  });
});

describe('the site reads only its own origin', () => {
  /** Every non-test source file under src, read as text. */
  function sources(dir: string): [string, string][] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return sources(path);
      if (!/\.(ts|tsx)$/.test(name) || /\.test\./.test(name)) return [];
      return [[path, readFileSync(path, 'utf8')] as [string, string]];
    });
  }
  const all = sources(resolve(process.cwd(), 'src'));

  it('imports no Supabase client, names no Supabase host and opens no WebSocket', () => {
    const offenders = all.filter(([, text]) => /@supabase\/|supabase\.co|new WebSocket|realtime/i.test(text)).map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it('holds no open-for-funding rule of its own: canFund only for sample and example cards', () => {
    expect(all.filter(([, text]) => /isOpenForFunding|takesMoney/.test(text)).map(([path]) => path)).toEqual([]);
    const callers = all
      .filter(([path, text]) => !path.endsWith('payment.ts') && !path.endsWith('cards.ts') && /\bcanFund\b/.test(text.replace(/^import [^;]*;$/gm, '')))
      .map(([path]) => path.slice(path.indexOf('src/')));
    // Funding.tsx draws a sample card's button; HowItWorks.tsx picks the card its example shows.
    expect(callers.sort()).toEqual(['src/components/Funding.tsx', 'src/pages/HowItWorks.tsx']);
    const funding = all.find(([path]) => path.endsWith('components/Funding.tsx'))![1];
    expect(funding).toMatch(/mode === 'sample' && canFund\(card\)/);
  });
});
