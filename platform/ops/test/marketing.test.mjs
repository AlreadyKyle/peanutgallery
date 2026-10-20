// Tests for the marketing engine (docs/specs/marketing-engine.md) with a fake database and fake HTTP:
// nothing here reaches Supabase, Bluesky, Mastodon, Discord or ntfy. ops.test.mjs imports this file,
// so `pnpm test:ops` runs it. The deny-list terms are read from the gate's files at run time, so this
// file carries none of them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { envFileProblems } from '../jobs/check-env.mjs';
import { jobEnvProblems, JOB_KEYS } from '../jobs/lib.mjs';
import { main } from '../jobs/main.mjs';
import {
  CHANNEL_KINDS,
  channelTitle,
  composeMessage,
  fit,
  gateScan,
  LIMITS,
  measure,
  openedMessage,
  POSTS_PER_CHANNEL,
  runMarketing,
  shipMessage,
  tagged,
  weeklyMessage,
} from '../jobs/marketing.mjs';
import { blueskyRecord, CHANNEL_KEYS, linkFacets, missingKeys } from '../jobs/marketing-posters.mjs';

const OPS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DENYLIST = path.resolve(OPS_DIR, '..', 'gate', 'denylist');
const NOW = new Date('2026-10-20T12:23:00Z');
const PLAY = 'https://play.mobmachine.games';
const SITE = 'https://mobmachine.games';
const HOOK = `https://discord.com/api/webhooks/123/${'t'.repeat(40)}`;
const BASE = { SUPABASE_URL: 'https://fixture.supabase.local', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture', NTFY_TOPIC_URL: 'https://ntfy.sh/fixture-topic' };
const ALL = {
  ...BASE,
  BLUESKY_HANDLE: 'mobmachine.bsky.social',
  BLUESKY_APP_PASSWORD: 'abcd-efgh-ijkl-mnop',
  MASTODON_INSTANCE_URL: 'https://mastodon.example',
  MASTODON_ACCESS_TOKEN: 'm'.repeat(43),
  DISCORD_WEBHOOK_SHIPS: HOOK,
};
const CARD = '00000000-0000-4000-8000-0000000000c1';
const ship = (extra = {}) => ({ kind: 'ship', ref: CARD, card_id: CARD, folder: 'seed-1', title: 'Dust storms on the map', supporter_count: 3, funded_usd: 3, funding_target_usd: 3, rarity: 'common', claimed: [], ...extra });
const opened = (extra = {}) => ({ kind: 'opened', ref: 'c2', card_id: 'c2', folder: 'seed-1', title: 'Wells for the gatherers', supporter_count: null, funded_usd: 1.5, funding_target_usd: 4, rarity: 'common', claimed: [], ...extra });
const weekly = (extra = {}) => ({ kind: 'weekly', ref: '2026-10-12', shipped_count: 2, shipped_titles: ['Dust storms on the map', 'Wells for the gatherers'], open_count: 5, claimed: [], ...extra });

function firstTerm(list) {
  const line = readFileSync(path.join(DENYLIST, `${list}.txt`), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '' && !l.startsWith('#'));
  if (!line) throw new Error(`${list}.txt holds no term`);
  return line;
}

// The database as marketing_posts_due, marketing_post_claim and marketing_post_settle answer, in memory.
function fakeDb({ items = [], stop = null } = {}) {
  const rows = new Map();
  const calls = [];
  const key = (a) => `${a.p_channel}/${a.p_kind}/${a.p_ref}`;
  const rpc = (name, args) => {
    calls.push([name, args]);
    if (name === 'marketing_posts_due') {
      const due = items
        .map((item) => ({ ...item, claimed: args.p_channels.filter((c) => rows.has(`${c}/${item.kind}/${item.ref}`)) }))
        .filter((item) => item.claimed.length < args.p_channels.length);
      return { stop, items: due };
    }
    if (name === 'marketing_post_claim') {
      if (rows.has(key(args))) return false;
      rows.set(key(args), { state: args.p_state, reason: args.p_skip_reason });
      return true;
    }
    if (name === 'marketing_post_settle') {
      const row = rows.get(key(args));
      if (!row || row.state !== 'sending') return false;
      Object.assign(row, { state: args.p_state, status: args.p_status, id: args.p_post_id });
      return true;
    }
    throw new Error(`unexpected rpc ${name}`);
  };
  return { rows, calls, rpc };
}

// Fake HTTP for the database, the three channels and the alerts. Every request is recorded.
function fakeFetch(db, { blueskySession = 200, blueskyPost = 200, mastodon = 200, discord = 200 } = {}) {
  const requests = [];
  const answer = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fetchFn = async (target, init = {}) => {
    const url = String(target);
    let body = null;
    try {
      body = init.body ? JSON.parse(init.body) : null;
    } catch {
      body = String(init.body);
    }
    requests.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body });
    if (url.startsWith('https://fixture.supabase.local/rest/v1/rpc/')) {
      return answer(200, db.rpc(url.split('/').at(-1), body));
    }
    if (url === 'https://bsky.social/xrpc/com.atproto.server.createSession') return answer(blueskySession, blueskySession === 200 ? { accessJwt: 'jwt-fixture', did: 'did:plc:fixture' } : { error: 'AuthenticationRequired' });
    if (url === 'https://bsky.social/xrpc/com.atproto.repo.createRecord') return answer(blueskyPost, { uri: `at://did:plc:fixture/app.bsky.feed.post/${requests.length}`, cid: 'bafy' });
    if (url === 'https://mastodon.example/api/v1/statuses') return answer(mastodon, { id: `${requests.length}`, url: 'https://mastodon.example/@mobmachine/1' });
    if (url === `${HOOK}?wait=true`) return answer(discord, { id: `${requests.length}` });
    if (url.startsWith('https://ntfy.sh/')) return answer(200, {});
    throw new Error(`unexpected request ${init.method} ${url}`);
  };
  return { fetchFn, requests };
}

const sink = () => {
  let text = '';
  return { write: (chunk) => (text += chunk), text: () => text };
};
const clean = async () => ({ ok: true, ran: true });
const run = (options) => runMarketing({ now: NOW, play: PLAY, scan: clean, ...options });

describe('the marketing messages', () => {
  test('a ship in Dust: the title, the supporters, and the play and card links tagged with the channel', () => {
    const message = shipMessage(ship(), 'bsky', { site: SITE, play: PLAY });
    assert.equal(message.text, `Shipped in Dust: Dust storms on the map, funded by 3 supporters. Play: ${PLAY}/?from=bsky Card: ${SITE}/card/${CARD}?from=bsky`);
    assert.deepEqual(message.links, [`${PLAY}/?from=bsky`, `${SITE}/card/${CARD}?from=bsky`]);
    assert.equal(message.card.uri, `${SITE}/card/${CARD}?from=bsky`);
    assert.ok(!message.text.includes('—'), 'no em dash (docs/COPY.md)');
    assert.equal(shipMessage(ship({ supporter_count: 1 }), 'mastodon', { play: PLAY }).text, `Shipped in Dust: Dust storms on the map, funded by 1 supporter. Play: ${PLAY}/?from=mastodon Card: ${SITE}/card/${CARD}?from=mastodon`);
    assert.equal(shipMessage(ship({ supporter_count: 0 }), 'bsky', { play: PLAY }).text, `Shipped in Dust: Dust storms on the map. Play: ${PLAY}/?from=bsky Card: ${SITE}/card/${CARD}?from=bsky`);
    assert.equal(shipMessage(ship({ folder: 'platform' }), 'bsky', { play: PLAY }).text, `Shipped at Mob Machine: Dust storms on the map, funded by 3 supporters. Card: ${SITE}/card/${CARD}?from=bsky`);
  });

  test('an opening: the title, the bar in dollars and the tagged card link', () => {
    assert.equal(openedMessage(opened(), 'discord', { site: SITE }).text, `New in Dust, open for funding: Wells for the gatherers ($1.50 of $4.00). ${SITE}/card/c2?from=discord`);
    assert.equal(openedMessage(opened({ folder: 'platform' }), 'mastodon', {}).text, `New at Mob Machine, open for funding: Wells for the gatherers ($1.50 of $4.00). ${SITE}/card/c2?from=mastodon`);
  });

  test('the weekly digest: the week named, the titles, the open count and the tagged reports link', () => {
    assert.equal(
      weeklyMessage(weekly(), 'bsky', {}).text,
      `The week of 12 October at Mob Machine: 2 cards shipped (Dust storms on the map, Wells for the gatherers). 5 cards were open for funding when the report was published. Read the report: ${SITE}/reports?from=bsky`,
    );
    assert.equal(weeklyMessage(weekly({ shipped_count: 1, shipped_titles: ['One'], open_count: 1 }), 'mastodon', {}).text, `The week of 12 October at Mob Machine: 1 card shipped (One). 1 card was open for funding when the report was published. Read the report: ${SITE}/reports?from=mastodon`);
    const many = weeklyMessage(weekly({ shipped_count: 9, shipped_titles: Array.from({ length: 9 }, (_, i) => `A long shipped card title number ${i + 1}`) }), 'bsky', {});
    assert.ok(measure('bsky', many.text) <= 300, many.text);
    assert.match(many.text, /and \d+ more\)\. 5 cards were open/);
    assert.ok(many.text.endsWith(`Read the report: ${SITE}/reports?from=bsky`));
  });

  test('a link keeps its query and gains the tag; every message key names the kind, ref and channel', () => {
    assert.equal(tagged(`${SITE}/card/x?a=1`, 'bsky'), `${SITE}/card/x?a=1&from=bsky`);
    assert.equal(composeMessage(ship(), 'mastodon', { play: PLAY }).key, `mobmachine-ship-${CARD}-mastodon`);
    assert.throws(() => composeMessage({ kind: 'reply' }, 'bsky', {}), /no message for kind reply/);
  });

  test('a title is one line, its markup escaped on Discord and its @ and # inert on Mastodon', () => {
    assert.equal(channelTitle('bsky', 'Two\nlines\u0007 here'), 'Two lines here');
    assert.equal(channelTitle('discord', '**bold** @everyone [x](y)'), '\\*\\*bold\\*\\* \\@everyone \\[x\\]\\(y\\)');
    assert.equal(channelTitle('mastodon', 'see @someone #tag'), 'see @​someone #​tag');
  });
});

describe('length trimming', () => {
  const long = 'Dust storms '.repeat(60).trim();

  test('each channel stays inside its limit, the title cut with an ellipsis and the links whole', () => {
    for (const channel of ['bsky', 'mastodon', 'discord']) {
      const message = composeMessage(ship({ title: long }), channel, { play: PLAY });
      assert.ok(measure(channel, message.text) <= LIMITS[channel], `${channel}: ${measure(channel, message.text)}`);
      for (const link of message.links) assert.ok(message.text.includes(link), `${channel} keeps ${link}`);
      if (channel !== 'discord') assert.match(message.text, /…, funded by 3 supporters\. Play: /);
    }
    assert.deepEqual(LIMITS, { bsky: 300, mastodon: 500, discord: 2000 });
  });

  test('Bluesky counts graphemes: a title of emoji families is cut on a whole grapheme', () => {
    const family = '👨‍👩‍👧';
    const text = fit('bsky', 'Shipped in Dust: ', family.repeat(400), ' Card: https://mobmachine.games/card/x?from=bsky');
    assert.ok(measure('bsky', text) <= 300);
    assert.ok(text.length > 300, 'more UTF-16 units than graphemes, so the count is by grapheme');
    assert.ok(text.includes(`${family}…`), 'never half a grapheme');
  });

  test('a message that fits is not cut', () => {
    assert.equal(fit('bsky', 'a ', 'b', ' c'), 'a b c');
  });
});

describe('the Bluesky record', () => {
  test('a link facet over each link, by UTF-8 byte, and an external card for the main link', () => {
    const message = shipMessage(ship({ title: 'Dünen und Stürme' }), 'bsky', { play: PLAY });
    const record = blueskyRecord(message, NOW);
    assert.equal(record.$type, 'app.bsky.feed.post');
    assert.equal(record.createdAt, NOW.toISOString());
    const bytes = new TextEncoder().encode(record.text);
    const decoded = record.facets.map((f) => new TextDecoder().decode(bytes.slice(f.index.byteStart, f.index.byteEnd)));
    assert.deepEqual(decoded, message.links);
    assert.deepEqual(record.facets.map((f) => f.features[0].uri), message.links);
    assert.deepEqual(record.embed, { $type: 'app.bsky.embed.external', external: { uri: message.card.uri, title: 'Dünen und Stürme', description: message.card.description } });
    assert.deepEqual(linkFacets('no link here', ['https://x.test']), []);
  });
});

describe('the marketing env', () => {
  test('the job holds the service key and each channel key; every channel key is optional', () => {
    assert.deepEqual(JOB_KEYS.marketing.required, ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'NTFY_TOPIC_URL']);
    for (const spec of Object.values(CHANNEL_KEYS)) for (const k of [...spec.required, ...spec.optional]) assert.ok(JOB_KEYS.marketing.optional.includes(k), k);
    assert.deepEqual(jobEnvProblems('marketing', BASE), []);
    assert.deepEqual(jobEnvProblems('marketing', ALL), []);
  });

  test('refuses a value of the wrong shape, naming the key and never the value', () => {
    const bad = {
      ...ALL,
      BLUESKY_HANDLE: '@mobmachine.bsky.social',
      BLUESKY_APP_PASSWORD: 'my-real-password',
      MASTODON_INSTANCE_URL: 'https://mastodon.example/@mobmachine',
      MASTODON_ACCESS_TOKEN: 'short',
      DISCORD_WEBHOOK_SHIPS: 'https://discord.com.evil.test/api/webhooks/1/x',
      BLUESKY_PDS_URL: 'http://bsky.social',
    };
    const problems = jobEnvProblems('marketing', bad);
    for (const k of ['BLUESKY_HANDLE', 'BLUESKY_APP_PASSWORD', 'MASTODON_INSTANCE_URL', 'MASTODON_ACCESS_TOKEN', 'DISCORD_WEBHOOK_SHIPS', 'BLUESKY_PDS_URL']) assert.ok(problems.some((p) => p.startsWith(k)), `${k}: ${problems.join(' | ')}`);
    for (const value of Object.values(bad).filter((v) => v.length > 8 && !v.startsWith('https://fixture') && !v.startsWith('https://ntfy'))) assert.ok(!problems.join('\n').includes(value), 'no value is repeated');
    assert.deepEqual(envFileProblems('marketing', 'SUPABASE_URL=https://fixture.supabase.local\nSUPABASE_SERVICE_ROLE_KEY=sb_secret_fixture\nNTFY_TOPIC_URL=https://ntfy.sh/x\nRESEND_API_KEY=re_fixture_key_000\n'), ['RESEND_API_KEY is not a marketing key; the marketing env file holds only SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NTFY_TOPIC_URL, MARKETING_HEALTHCHECK_URL, BLUESKY_HANDLE, BLUESKY_APP_PASSWORD, BLUESKY_PDS_URL, MASTODON_INSTANCE_URL, MASTODON_ACCESS_TOKEN, DISCORD_WEBHOOK_SHIPS']);
  });

  test('a channel missing a key is named with what is missing', () => {
    assert.deepEqual(missingKeys('bsky', { BLUESKY_HANDLE: 'x.bsky.social' }), ['BLUESKY_APP_PASSWORD']);
    assert.deepEqual(missingKeys('discord', ALL), []);
  });
});

describe('a marketing run', () => {
  test('posts each due item once on each channel that carries it, outbound only, and settles each', async () => {
    const db = fakeDb({ items: [ship(), opened(), weekly()] });
    const http = fakeFetch(db);
    const out = sink();
    const result = await run({ env: ALL, fetchFn: http.fetchFn, out });
    assert.equal(result.ok, true, out.text());
    assert.match(out.text(), /^PASS: marketing: bsky posted 3, failed 0, skipped 0, waiting 0; mastodon posted 3, failed 0, skipped 0, waiting 0; discord posted 1, failed 0, skipped 2, waiting 0\n/);
    const channelRequests = http.requests.filter((r) => !r.url.includes('fixture.supabase.local'));
    assert.ok(channelRequests.every((r) => r.method === 'POST'), 'every channel request is a POST');
    assert.deepEqual([...new Set(channelRequests.map((r) => r.url))].sort(), [
      'https://bsky.social/xrpc/com.atproto.repo.createRecord',
      'https://bsky.social/xrpc/com.atproto.server.createSession',
      `${HOOK}?wait=true`,
      'https://mastodon.example/api/v1/statuses',
    ]);
    assert.equal(channelRequests.filter((r) => r.url.endsWith('createSession')).length, 1, 'one Bluesky session a run');
    const toot = channelRequests.find((r) => r.url.endsWith('/statuses'));
    assert.equal(toot.headers.Authorization, `Bearer ${ALL.MASTODON_ACCESS_TOKEN}`);
    assert.match(toot.headers['Idempotency-Key'], /^mobmachine-ship-/);
    assert.equal(toot.body.visibility, 'public');
    const hook = channelRequests.find((r) => r.url.startsWith(HOOK));
    assert.deepEqual(hook.body.allowed_mentions, { parse: [] });
    assert.match(hook.body.content, /^New in Dust, open for funding: Wells for the gatherers \(\$1\.50 of \$4\.00\)\. https:\/\/mobmachine\.games\/card\/c2\?from=discord$/);
    assert.deepEqual([db.rows.get(`discord/ship/${CARD}`).reason, db.rows.get('discord/weekly/2026-10-12').reason], ['dispatcher_lane', 'dispatcher_lane']);
    assert.ok([...db.rows.entries()].filter(([k]) => !k.startsWith('discord/ship') && !k.startsWith('discord/weekly')).every(([, row]) => row.state === 'posted'));
    assert.ok(!out.text().includes(ALL.BLUESKY_APP_PASSWORD) && !out.text().includes(HOOK) && !out.text().includes(ALL.MASTODON_ACCESS_TOKEN), 'no credential in the output');
    assert.deepEqual(CHANNEL_KINDS.discord, ['opened']);
  });

  test('a rerun posts nothing again', async () => {
    const db = fakeDb({ items: [ship(), opened()] });
    await run({ env: ALL, fetchFn: fakeFetch(db).fetchFn, out: sink() });
    const again = fakeFetch(db);
    const out = sink();
    await run({ env: ALL, fetchFn: again.fetchFn, out });
    assert.equal(again.requests.filter((r) => !r.url.includes('fixture.supabase.local')).length, 0, out.text());
    assert.match(out.text(), /^PASS: marketing: bsky posted 0/);
  });

  test('a claim another run holds is never posted, and a lost answer is settled failed, told and not retried', async () => {
    const db = fakeDb({ items: [opened()] });
    db.rows.set('bsky/opened/c2', { state: 'sending' });
    const http = fakeFetch(db, { mastodon: 503 });
    const out = sink();
    const env = { ...BASE, BLUESKY_HANDLE: ALL.BLUESKY_HANDLE, BLUESKY_APP_PASSWORD: ALL.BLUESKY_APP_PASSWORD, MASTODON_INSTANCE_URL: ALL.MASTODON_INSTANCE_URL, MASTODON_ACCESS_TOKEN: ALL.MASTODON_ACCESS_TOKEN };
    const result = await run({ env, fetchFn: http.fetchFn, out });
    assert.equal(result.ok, false);
    assert.ok(!http.requests.some((r) => r.url.endsWith('createRecord')), 'bsky was claimed elsewhere');
    assert.equal(db.rows.get('mastodon/opened/c2').state, 'failed');
    assert.match(out.text(), /- opened c2: mastodon: post refused http 503; not retried/);
    assert.ok(http.requests.some((r) => r.url.startsWith('https://ntfy.sh/')), 'the board is told');
    const second = fakeFetch(db);
    await run({ env, fetchFn: second.fetchFn, out: sink() });
    assert.ok(!second.requests.some((r) => r.url.endsWith('/statuses')), 'a failed post is not retried');
  });

  test('a channel without its keys is skipped with a line, never failed; with none the run makes no request', async () => {
    const db = fakeDb({ items: [ship()] });
    const http = fakeFetch(db);
    const out = sink();
    const result = await run({ env: { ...BASE, MASTODON_INSTANCE_URL: ALL.MASTODON_INSTANCE_URL, MASTODON_ACCESS_TOKEN: ALL.MASTODON_ACCESS_TOKEN }, fetchFn: http.fetchFn, out });
    assert.equal(result.ok, true, out.text());
    assert.match(out.text(), /; bsky not set; discord not set\n/);
    assert.match(out.text(), /- bsky skipped: BLUESKY_HANDLE, BLUESKY_APP_PASSWORD not set/);
    assert.match(out.text(), /- discord skipped: DISCORD_WEBHOOK_SHIPS not set/);
    assert.deepEqual(db.calls.find(([name]) => name === 'marketing_posts_due')[1].p_channels, ['mastodon']);
    const none = fakeFetch(fakeDb());
    const quiet = sink();
    assert.equal((await run({ env: BASE, fetchFn: none.fetchFn, out: quiet })).ok, true);
    assert.match(quiet.text(), /^PASS: marketing: no channel has its keys; nothing to post\n/);
    assert.equal(none.requests.length, 0);
  });

  test('while the studio is stopped nothing is posted, and what is due is recorded skipped for good', async () => {
    for (const stop of ['paused', 'kill_switch']) {
      const db = fakeDb({ items: [ship(), opened()], stop });
      const http = fakeFetch(db);
      const out = sink();
      const result = await run({ env: ALL, fetchFn: http.fetchFn, out });
      assert.equal(result.ok, true);
      assert.equal(http.requests.filter((r) => !r.url.includes('fixture.supabase.local')).length, 0, stop);
      assert.equal(db.rows.size, 6);
      assert.ok([...db.rows.values()].every((row) => row.state === 'skipped' && row.reason === stop));
      assert.match(out.text(), /stopped: /);
    }
  });

  test('a deny-list hit skips the item on every channel and tells the board; a scan that cannot run posts nothing', async () => {
    const db = fakeDb({ items: [opened(), ship()] });
    const http = fakeFetch(db);
    const out = sink();
    const scan = async (texts) => (texts.some((t) => t.includes('Wells')) ? { ok: false, ran: true, detail: 'a deny-list hit: FAIL: banned-phrases' } : { ok: true, ran: true });
    const result = await run({ env: ALL, fetchFn: http.fetchFn, out, scan });
    assert.equal(result.ok, false);
    for (const channel of ['bsky', 'mastodon', 'discord']) assert.equal(db.rows.get(`${channel}/opened/c2`).reason, 'deny_list');
    assert.equal(db.rows.get(`bsky/ship/${CARD}`).state, 'posted', 'the clean item still goes');
    assert.match(out.text(), /- opened c2: refused by a deny-list hit/);
    const broken = fakeDb({ items: [ship()] });
    const none = fakeFetch(broken);
    await assert.rejects(() => run({ env: ALL, fetchFn: none.fetchFn, out: sink(), scan: async () => ({ ok: false, ran: false, detail: 'the deny-list scan could not run' }) }), /the content scan could not run, so nothing was posted/);
    assert.equal(none.requests.filter((r) => !r.url.includes('fixture.supabase.local')).length, 0);
    assert.deepEqual([...broken.rows.keys()], [`discord/ship/${CARD}`], 'only the lane skip, made before any scan; nothing claimed to send');
  });

  test('a Discord opening of a rare or legendary card is left to the announcements lane', async () => {
    const db = fakeDb({ items: [opened({ rarity: 'legendary' })] });
    await run({ env: { ...BASE, DISCORD_WEBHOOK_SHIPS: HOOK }, fetchFn: fakeFetch(db).fetchFn, out: sink() });
    assert.equal(db.rows.get('discord/opened/c2').reason, 'announce_lane');
  });

  test('a Bluesky session refused claims nothing, so the next run tries again', async () => {
    const db = fakeDb({ items: [ship()] });
    const http = fakeFetch(db, { blueskySession: 401 });
    const out = sink();
    const result = await run({ env: { ...BASE, BLUESKY_HANDLE: ALL.BLUESKY_HANDLE, BLUESKY_APP_PASSWORD: ALL.BLUESKY_APP_PASSWORD }, fetchFn: http.fetchFn, out });
    assert.equal(result.ok, false);
    assert.equal(db.rows.size, 0);
    assert.match(out.text(), /- bsky: session refused http 401; nothing posted to bsky this run/);
    assert.ok(!out.text().includes(ALL.BLUESKY_APP_PASSWORD));
  });

  test('at most POSTS_PER_CHANNEL a run on each channel; the rest wait unclaimed', async () => {
    const items = Array.from({ length: 5 }, (_, i) => opened({ ref: `c${i}`, card_id: `c${i}` }));
    const db = fakeDb({ items });
    const out = sink();
    await run({ env: { ...BASE, DISCORD_WEBHOOK_SHIPS: HOOK }, fetchFn: fakeFetch(db).fetchFn, out });
    assert.equal(POSTS_PER_CHANNEL, 3);
    assert.equal(db.rows.size, 3);
    assert.match(out.text(), /discord posted 3, failed 0, skipped 0, waiting 2/);
  });

  test('--dry-run prints every post in full and claims, posts and alerts nothing', async () => {
    const db = fakeDb({ items: [ship(), opened(), weekly()] });
    const http = fakeFetch(db);
    const out = sink();
    const code = await main(['marketing', '--dry-run'], ALL, { fetchFn: http.fetchFn, out, now: NOW, play: PLAY, scan: clean });
    assert.equal(code, 0);
    assert.match(out.text(), /^PASS: marketing \(dry run\): bsky would post 3, failed 0, skipped 0, waiting 0; mastodon would post 3/);
    assert.ok(out.text().includes(`would post to bsky (ship ${CARD}, `));
    assert.ok(out.text().includes(`Shipped in Dust: Dust storms on the map, funded by 3 supporters. Play: ${PLAY}/?from=bsky`));
    assert.equal(db.rows.size, 0);
    assert.deepEqual([...new Set(http.requests.map((r) => r.url.split('/').at(-1)))], ['marketing_posts_due']);
  });
});

describe("the gate's scans over a post", () => {
  test('pass a clean post and refuse a deny-list term or a credential shape', async () => {
    const text = composeMessage(ship(), 'bsky', { play: PLAY }).text;
    assert.deepEqual(await gateScan([text]), { ok: true, ran: true });
    const hit = await gateScan([text, `Shipped in Dust: ${firstTerm('profanity')}.`]);
    assert.equal(hit.ok, false);
    assert.equal(hit.ran, true);
    assert.match(hit.detail, /^a deny-list hit: FAIL: banned-phrases/);
    const key = ['sk', 'ant', 'api03', 'Q'.repeat(24)].join('-');
    const secret = await gateScan([`A title ${key}`]);
    assert.equal(secret.ran, true);
    assert.match(secret.detail, /^a credential shape: FAIL: secret-scan/);
    assert.ok(!secret.detail.includes(key));
    assert.deepEqual(await gateScan([text], { gateDir: '/nonexistent' }), { ok: false, ran: false, detail: 'the deny-list scan could not run: banned-phrases.sh is missing' });
  });
});
