import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createDiscordPoster, MAX_CONTENT } from '../src/discord.js';
import { createLogger } from '../src/log.js';
import { MAX_POSTS_PER_TICK, runOutbound, shipText, weeklyText, type OutboundDeps } from '../src/outbound.js';
import { FakeDb, NOW, shipPost } from './helpers/fake-db.js';
import { hangingFetch, mockFetch, type Route } from './helpers/mock-fetch.js';

// docs/specs/studio-reports.md: the outbound lane, with a fake Discord and the fake outbox.
const TOKEN = 'tok-FIXTURE_SecretPart-0123';
const SHIPS = `https://discord.com/api/webhooks/111/${TOKEN}`;
const WEEKLY = `https://discord.com/api/webhooks/222/${TOKEN}`;
const SITE = 'https://site.test';
const HOUR = 60 * 60_000;

function at(msBeforeNow: number): string {
  return new Date(NOW.getTime() - msBeforeNow).toISOString();
}

const ok: Route = () => ({ status: 200, json: { id: 'msg-1' } });

function setup(options: { ships?: string | null; weekly?: string | null; route?: Route; fetchFn?: typeof fetch; timeoutMs?: number } = {}) {
  const db = new FakeDb();
  const lines: string[] = [];
  const log = createLogger(new Writable({ write: (chunk, _enc, cb) => { lines.push(String(chunk)); cb(); } }));
  const server = mockFetch(options.route ?? ok);
  const poster = createDiscordPoster({
    ships: options.ships === undefined ? SHIPS : options.ships,
    weekly: options.weekly === undefined ? WEEKLY : options.weekly,
    fetchFn: options.fetchFn ?? server.fetchFn,
    log,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });
  const deps: OutboundDeps = { db, poster, siteUrl: SITE, now: () => NOW, log };
  return { db, deps, calls: server.calls, lines };
}

const contents = (calls: { body: unknown }[]) => calls.map((call) => (call.body as { content: string }).content);

describe('the outbound lane', () => {
  it('with both lanes unset makes no query and no request', async () => {
    const { db, deps, calls } = setup({ ships: null, weekly: null });
    db.liveCards = [shipPost({ live_at: at(HOUR) })];
    db.reports = [{ week_start: '2026-09-07', shipped_count: 1, shipped_titles: ['A'], open_count: 6 }];
    expect(await runOutbound(deps)).toEqual({ inert: true, posted: 0, failed: 0, skipped: 0 });
    expect(db.outboxCalls).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('posts a card live within 6 hours once, to the ships lane with ?wait=true, and stores its message id', async () => {
    const { db, deps, calls, lines } = setup();
    db.liveCards = [shipPost({ live_at: at(HOUR) })];
    expect(await runOutbound(deps)).toEqual({ inert: false, posted: 1, failed: 0, skipped: 0 });
    expect(calls.map((call) => call.url)).toEqual([`${SHIPS}?wait=true`]);
    expect(db.posts).toEqual([{ kind: 'ship', ref: shipPost().id, state: 'posted', status: 200, message_id: 'msg-1', skip_reason: null }]);
    const body = calls[0]!.body as { content: string; username: string; allowed_mentions: unknown };
    expect(body.username).toBe('Mob Machine');
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toBe(
      `Shipped: Gatherers cost one more. Built by Builder A for $0.29 from contributions, funded by Founding supporter 1, Supporter 3 and 2 more. Watch how it was built: ${SITE}/card/${shipPost().id}`,
    );
    // A second tick finds the row and sends nothing.
    await runOutbound(deps);
    expect(calls).toHaveLength(1);
    expect(lines.join('')).not.toContain(TOKEN);
  });

  it('never posts a card that went live more than 6 hours ago', async () => {
    const { db, deps, calls } = setup();
    db.liveCards = [shipPost({ live_at: at(6 * HOUR + 1) })];
    expect((await runOutbound(deps)).posted).toBe(0);
    expect(calls).toEqual([]);
    expect(db.posts).toEqual([]);
  });

  for (const stop of ['paused', 'kill_switch'] as const) {
    it(`records a card found while ${stop === 'paused' ? 'the studio is paused' : 'the kill switch has fired'} as skipped, posts nothing, and never posts it after resuming`, async () => {
      const { db, deps, calls } = setup();
      db.liveCards = [shipPost({ live_at: at(HOUR) })];
      db.reports = [{ week_start: '2026-09-07', shipped_count: 1, shipped_titles: ['A'], open_count: 6 }];
      if (stop === 'paused') db.studio.paused = true;
      else db.killSwitchFired = true;
      expect(await runOutbound(deps)).toEqual({ inert: false, posted: 0, failed: 0, skipped: 1 });
      expect(calls).toEqual([]);
      expect(db.posts).toEqual([{ kind: 'ship', ref: shipPost().id, state: 'skipped', status: null, message_id: null, skip_reason: stop }]);
      db.studio.paused = false;
      db.killSwitchFired = false;
      await runOutbound(deps);
      // The weekly post goes out after resuming; the ship post never does.
      expect(calls.map((call) => call.url)).toEqual([`${WEEKLY}?wait=true`]);
    });
  }

  it('never sends again a post that timed out, failed with a 500, or whose row a crash left sending', async () => {
    const hanging = hangingFetch();
    const timedOut = setup({ fetchFn: hanging.fetchFn, timeoutMs: 20 });
    timedOut.db.liveCards = [shipPost({ live_at: at(HOUR) })];
    expect((await runOutbound(timedOut.deps)).failed).toBe(1);
    expect(timedOut.db.posts[0]).toMatchObject({ state: 'failed', status: null });
    await runOutbound(timedOut.deps);
    expect(hanging.signals).toHaveLength(1);

    const failing = setup({ route: () => ({ status: 500, text: 'down' }) });
    failing.db.liveCards = [shipPost({ live_at: at(HOUR) })];
    expect((await runOutbound(failing.deps)).failed).toBe(1);
    expect(failing.db.posts[0]).toMatchObject({ state: 'failed', status: 500 });
    await runOutbound(failing.deps);
    expect(failing.calls).toHaveLength(1);

    const crashed = setup();
    crashed.db.liveCards = [shipPost({ live_at: at(HOUR) })];
    crashed.db.posts = [{ kind: 'ship', ref: shipPost().id, state: 'sending', status: null, message_id: null, skip_reason: null }];
    await runOutbound(crashed.deps);
    await runOutbound(crashed.deps);
    expect(crashed.calls).toEqual([]);
    expect(crashed.db.posts[0]!.state).toBe('sending');
  });

  it('a claim another process won first is not posted', async () => {
    const { db, deps, calls } = setup();
    db.liveCards = [shipPost({ live_at: at(HOUR) })];
    // The row appears between the read and the claim.
    const read = db.unpostedShips.bind(db);
    db.unpostedShips = async (since, limit) => {
      const found = await read(since, limit);
      db.posts.push({ kind: 'ship', ref: shipPost().id, state: 'sending', status: null, message_id: null, skip_reason: null });
      return found;
    };
    await runOutbound(deps);
    expect(calls).toEqual([]);
  });

  it('posts the newest unposted report once to the weekly lane', async () => {
    const { db, deps, calls } = setup();
    db.reports = [
      { week_start: '2026-08-31', shipped_count: 1, shipped_titles: ['Old'], open_count: 3 },
      { week_start: '2026-09-07', shipped_count: 2, shipped_titles: ['A plant grows', 'Dust settles'], open_count: 6 },
    ];
    expect((await runOutbound(deps)).posted).toBe(1);
    await runOutbound(deps);
    expect(calls.map((call) => call.url)).toEqual([`${WEEKLY}?wait=true`]);
    expect(contents(calls)).toEqual([`This week at Mob Machine: 2 cards shipped (A plant grows, Dust settles). 6 cards are open for funding. Read the report: ${SITE}/reports`]);
    expect(db.posts).toEqual([{ kind: 'weekly', ref: '2026-09-07', state: 'posted', status: 200, message_id: 'msg-1', skip_reason: null }]);
  });

  it('makes at most five requests in one tick, and the rest go out on the next', async () => {
    const { db, deps, calls } = setup();
    db.liveCards = Array.from({ length: 7 }, (_, i) => shipPost({ id: `card-${i}`, title: `Card ${i}`, live_at: at(HOUR - i * 1000) }));
    db.reports = [{ week_start: '2026-09-07', shipped_count: 7, shipped_titles: [], open_count: 6 }];
    expect((await runOutbound(deps)).posted).toBe(MAX_POSTS_PER_TICK);
    expect(calls).toHaveLength(5);
    await runOutbound(deps);
    expect(calls).toHaveLength(8);
    expect(calls.at(-1)!.url).toBe(`${WEEKLY}?wait=true`);
  });

  it('with only the weekly lane set reads no ship and claims none', async () => {
    const { db, deps, calls } = setup({ ships: null });
    db.liveCards = [shipPost({ live_at: at(HOUR) })];
    db.studio.paused = true;
    await runOutbound(deps);
    expect(db.outboxCalls).toEqual(['postingStop']);
    db.studio.paused = false;
    await runOutbound(deps);
    expect(db.outboxCalls).not.toContain('unpostedShips');
    expect(calls).toEqual([]);
  });

  it('no captured log line carries the webhook token', async () => {
    const { db, deps, lines } = setup({ route: () => ({ status: 403, text: TOKEN }) });
    db.liveCards = [shipPost({ live_at: at(HOUR) })];
    db.reports = [{ week_start: '2026-09-07', shipped_count: 1, shipped_titles: ['A'], open_count: 1 }];
    await runOutbound(deps);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join('')).not.toContain(TOKEN);
  });
});

describe('the post texts', () => {
  it('leaves the cost clause out at $0.00, and the funded clause with no supporter', () => {
    expect(shipText(shipPost({ cost_usd: 0, supporters: [], supporter_count: 0 }), SITE)).toBe(
      `Shipped: Gatherers cost one more. Built by Builder A. Watch how it was built: ${SITE}/card/${shipPost().id}`,
    );
    expect(shipText(shipPost({ cost_usd: 0.004 }), SITE)).toBe(
      `Shipped: Gatherers cost one more. Built by Builder A, funded by Founding supporter 1, Supporter 3 and 2 more. Watch how it was built: ${SITE}/card/${shipPost().id}`,
    );
    expect(shipText(shipPost({ supporters: [{ number: 5, founding: false }], supporter_count: 1 }), SITE)).toContain('from contributions, funded by Supporter 5. Watch');
    expect(shipText(shipPost({ supporters: [{ number: 5, founding: false }, { number: 2, founding: false }], supporter_count: 2 }), SITE)).toContain('funded by Supporter 2 and Supporter 5. Watch');
  });

  it('escapes markdown and @ in titles, and stays within 2,000 characters with its link whole', () => {
    const text = shipText(shipPost({ title: '@everyone **Free** [link](https://evil.test)' }), SITE);
    expect(text.startsWith('Shipped: \\@everyone \\*\\*Free\\*\\* \\[link\\]\\(https\\://evil.test\\).')).toBe(true);
    const long = shipText(shipPost({ title: 'x'.repeat(4000) }), SITE);
    expect(long.length).toBeLessThanOrEqual(MAX_CONTENT);
    expect(long.endsWith(`Watch how it was built: ${SITE}/card/${shipPost().id}`)).toBe(true);
    const weekly = weeklyText({ week_start: '2026-09-07', shipped_count: 1, shipped_titles: ['_one_'], open_count: 1 }, SITE);
    expect(weekly).toBe(`This week at Mob Machine: 1 card shipped (\\_one\\_). 1 card is open for funding. Read the report: ${SITE}/reports`);
    const many = weeklyText({ week_start: '2026-09-07', shipped_count: 7, shipped_titles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'], open_count: 0 }, SITE);
    expect(many).toBe(`This week at Mob Machine: 7 cards shipped (a, b, c, d, e and 2 more). 0 cards are open for funding. Read the report: ${SITE}/reports`);
  });
});
