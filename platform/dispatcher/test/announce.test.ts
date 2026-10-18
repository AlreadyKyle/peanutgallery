import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { announcementText, MAX_ANNOUNCE_PER_HOUR, MAX_ANNOUNCE_PER_TICK, runAnnouncements } from '../src/announce.js';
import type { Announcement, AnnouncementBatch, OutboundDb, PostKind } from '../src/db.js';
import { createDiscordPoster } from '../src/discord.js';
import { createLogger } from '../src/log.js';
import { mockFetch, type Route } from './helpers/mock-fetch.js';

// docs/specs/operations.md: the announcements lane, with a fake Discord and a fake outbox.
const TOKEN = 'tok-FIXTURE_SecretPart-0456';
const ANNOUNCE = `https://discord.com/api/webhooks/333/${TOKEN}`;
const SHIPS = `https://discord.com/api/webhooks/111/${TOKEN}`;
const SITE = 'https://site.test';
const NOW = new Date('2026-10-17T12:00:00Z');
const CARD = '11111111-2222-4333-8444-555555555555';

function event(over: Partial<Announcement> = {}): Announcement {
  return { ref: '1', kind: 'funded', card_id: CARD, card_title: 'Carts leave dust trails', rarity: 'rare', suit: 'game', goal_title: null, goal_amount_cents: null, era_name: null, ...over };
}

class Outbox implements OutboundDb {
  stop: 'kill_switch' | 'paused' | null = null;
  events: Announcement[] = [];
  sentLastHour = 0;
  posts: { kind: PostKind; ref: string; state: string; skip_reason: string | null }[] = [];
  async postingStop() {
    return this.stop;
  }
  async unpostedShips() {
    return [];
  }
  async unpostedReport() {
    return null;
  }
  async claimPost(kind: PostKind, ref: string, state: 'sending' | 'skipped', skipReason: string | null) {
    if (this.posts.some((post) => post.kind === kind && post.ref === ref)) return false;
    this.posts.push({ kind, ref, state, skip_reason: skipReason });
    return true;
  }
  async finishPost(kind: PostKind, ref: string, result: { state: 'posted' | 'failed' }) {
    const post = this.posts.find((p) => p.kind === kind && p.ref === ref && p.state === 'sending');
    if (post) post.state = result.state;
  }
  async announcementsPending(_since: Date, limit: number): Promise<AnnouncementBatch> {
    const done = new Set(this.posts.filter((p) => p.kind === 'announce').map((p) => p.ref));
    return { items: this.events.filter((e) => !done.has(e.ref)).slice(0, limit), sentLastHour: this.sentLastHour };
  }
}

const ok: Route = () => ({ status: 200, json: { id: 'msg-1' } });

function setup(options: { announce?: string | null; ships?: string | null; route?: Route } = {}) {
  const db = new Outbox();
  const lines: string[] = [];
  const log = createLogger(new Writable({ write: (chunk, _enc, cb) => { lines.push(String(chunk)); cb(); } }));
  const server = mockFetch(options.route ?? ok);
  const poster = createDiscordPoster({
    ships: options.ships ?? null,
    weekly: null,
    announce: options.announce === undefined ? ANNOUNCE : options.announce,
    fetchFn: server.fetchFn,
    log,
  });
  return { db, deps: { db, poster, siteUrl: SITE, now: () => NOW, log }, calls: server.calls, lines };
}

const contents = (calls: { body: unknown }[]) => calls.map((call) => (call.body as { content: string }).content);

describe('the announcements lane', () => {
  it('with no DISCORD_WEBHOOK_URL makes no query and no request', async () => {
    const { db, deps, calls } = setup({ announce: null });
    db.events = [event()];
    expect(await runAnnouncements(deps)).toEqual({ inert: true, posted: 0, failed: 0, skipped: 0, limited: false });
    expect(calls).toEqual([]);
    expect(db.posts).toEqual([]);
  });

  it('builds every post from structured fields: kind, card title, rarity, suit, goal, era', () => {
    expect(announcementText(event(), SITE)).toBe(`Funded: Carts leave dust trails, a rare Game card. The agents start building it. Watch it: ${SITE}/card/${CARD}`);
    expect(announcementText(event({ kind: 'shipped', rarity: 'uncommon', suit: 'new_game' }), SITE)).toBe(
      `Shipped: Carts leave dust trails, an uncommon New game card. See how it was built: ${SITE}/card/${CARD}`,
    );
    expect(announcementText(event({ kind: 'rare_card', rarity: 'legendary' }), SITE)).toBe(`A legendary Game card appeared: Carts leave dust trails. Have a look: ${SITE}/card/${CARD}`);
    expect(announcementText(event({ kind: 'milestone', card_id: null, card_title: null, goal_title: 'A second builder', goal_amount_cents: 50000 }), SITE)).toBe(
      `Milestone reached: A second builder at $500 raised. The goals: ${SITE}/goals`,
    );
    expect(announcementText(event({ kind: 'era', card_id: null, card_title: null, era_name: 'Workshop' }), SITE)).toBe(`The studio grew into the Workshop. Its history: ${SITE}/studio/history`);
    // A rarity or suit outside the closed lists is left out, and markdown and mentions are escaped.
    expect(announcementText(event({ rarity: 'mythic', suit: 'x', card_title: '@everyone **bold**' }), SITE)).toBe(
      `Funded: \\@everyone \\*\\*bold\\*\\*, a card. The agents start building it. Watch it: ${SITE}/card/${CARD}`,
    );
    expect(announcementText(event({ kind: 'milestone', goal_title: null }), SITE)).toBeNull();
  });

  it('posts each event once, at most two a tick, and stores the result; the address never reaches a log', async () => {
    const { db, deps, calls, lines } = setup();
    db.events = [event({ ref: '1' }), event({ ref: '2', kind: 'era', era_name: 'Workshop' }), event({ ref: '3', kind: 'rare_card' })];
    expect(MAX_ANNOUNCE_PER_TICK).toBe(2);
    expect(await runAnnouncements(deps)).toEqual({ inert: false, posted: 2, failed: 0, skipped: 0, limited: true });
    expect(calls.map((call) => call.url)).toEqual([`${ANNOUNCE}?wait=true`, `${ANNOUNCE}?wait=true`]);
    expect(await runAnnouncements(deps)).toEqual({ inert: false, posted: 1, failed: 0, skipped: 0, limited: false });
    expect(await runAnnouncements(deps)).toEqual({ inert: false, posted: 0, failed: 0, skipped: 0, limited: false });
    expect(contents(calls)).toHaveLength(3);
    expect(db.posts.map((p) => [p.ref, p.state])).toEqual([['1', 'posted'], ['2', 'posted'], ['3', 'posted']]);
    expect(lines.join('')).not.toContain(TOKEN);
  });

  it('stops at the hourly limit and leaves the rest for later', async () => {
    const { db, deps, calls } = setup();
    db.events = [event()];
    db.sentLastHour = MAX_ANNOUNCE_PER_HOUR;
    expect(await runAnnouncements(deps)).toEqual({ inert: false, posted: 0, failed: 0, skipped: 0, limited: true });
    expect(calls).toEqual([]);
    expect(db.posts).toEqual([]);
  });

  it('a failed post is recorded failed and never retried', async () => {
    const { db, deps, calls } = setup({ route: () => ({ status: 500, json: {} }) });
    db.events = [event()];
    expect((await runAnnouncements(deps)).failed).toBe(1);
    await runAnnouncements(deps);
    expect(calls).toHaveLength(1);
    expect(db.posts[0]!.state).toBe('failed');
  });

  it('leaves a ship to the ships lane while it has an address', async () => {
    const { db, deps, calls } = setup({ ships: SHIPS });
    db.events = [event({ kind: 'shipped' })];
    expect((await runAnnouncements(deps)).skipped).toBe(1);
    expect(calls).toEqual([]);
    expect(db.posts).toEqual([{ kind: 'announce', ref: '1', state: 'skipped', skip_reason: 'ships_lane' }]);
  });

  for (const stop of ['paused', 'kill_switch'] as const) {
    it(`records what it finds while ${stop} as skipped and posts nothing, then or after`, async () => {
      const { db, deps, calls } = setup();
      db.events = [event()];
      db.stop = stop;
      expect((await runAnnouncements(deps)).skipped).toBe(1);
      db.stop = null;
      await runAnnouncements(deps);
      expect(calls).toEqual([]);
      expect(db.posts).toEqual([{ kind: 'announce', ref: '1', state: 'skipped', skip_reason: stop }]);
    });
  }
});
