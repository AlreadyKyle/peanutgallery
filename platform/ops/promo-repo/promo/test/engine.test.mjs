import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { linkFacet } from '../src/channels/bluesky.mjs';
import { harvest, setStatus } from '../src/cli.mjs';
import { composeDrafts } from '../src/compose.mjs';
import { chooseVariant, emptyPlaybook, updatePlaybook } from '../src/learn.mjs';
import { listOutbox, readSent, ROOT } from '../src/lib.mjs';
import { lintText } from '../src/lint.mjs';
import { learn, visitsByChannel } from '../src/metrics.mjs';
import { EXPLAINERS, harvestMoments } from '../src/moments.mjs';
import { publish } from '../src/publish.mjs';

const NOW = Date.parse('2026-10-18T15:00:00Z');
const config = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const docs = {
  cards: {
    cards: [
      { id: 'aaaaaaaa-1111', title: 'Cheaper first Gatherer', summary: 'The Gatherer now costs 10 dust instead of 11, so your first buy comes a little sooner.', stage: 'live', suit: 'game', rarity: 'common', horizon: 'now', folder: 'seed-1', live_at: '2026-10-18T09:00:00Z', executor_role_id: 'e95256d4-170e-4038-82af-9586e9be4fe2' },
      { id: 'bbbbbbbb-2222', title: 'Old change', summary: 'Old.', stage: 'live', suit: 'game', horizon: 'now', folder: 'seed-1', live_at: '2026-09-01T09:00:00Z' },
      { id: 'cccccccc-3333', title: 'Dust trails behind carts', summary: 'Carts leave a short trail of dust.', stage: 'proposed', suit: 'game', horizon: 'now', folder: 'seed-1', live_at: null },
    ],
  },
  live: { cards: { 'aaaaaaaa-1111': { spent_usd: 0.42, funded_usd: 0.8, funding_target_usd: 1.19, contributors: 2 }, 'cccccccc-3333': { funded_usd: 0.5, funding_target_usd: 2 } } },
  reports: { reports: [] },
  feed: { events: [{ id: 'ev1', at: '2026-10-18T10:00:00Z', kind: 'card_opened', rarity: 'legendary', text: 'Supporter 4 opened a legendary card: Dust trails behind carts', cardId: 'cccccccc-3333' }] },
};

function tempRoot(mode = 'review') {
  const dir = mkdtempSync(join(tmpdir(), 'promo-'));
  cpSync(join(ROOT, 'config.json'), join(dir, 'config.json'));
  const c = JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'));
  c.mode = mode;
  writeFileSync(join(dir, 'config.json'), JSON.stringify(c));
  writeFileSync(join(dir, 'docs.json'), JSON.stringify(docs));
  return dir;
}

test('harvest finds the recent ship, the open card, the legendary opening and one evergreen', () => {
  const kinds = harvestMoments(docs, config, NOW).map((m) => m.kind);
  assert.ok(kinds.includes('ship'));
  assert.ok(kinds.includes('spotlight'));
  assert.equal(kinds[0], 'card_legendary');
  assert.equal(kinds.filter((k) => k === 'ship').length, 1, 'the old ship is outside the lookback');
  assert.ok(kinds.includes('explainer') || kinds.includes('play_dust'));
});

test('every composed draft passes the copy checks and links back with its channel tag', () => {
  const drafts = composeDrafts(harvestMoments(docs, config, NOW), config, emptyPlaybook(), new Set(), new Date(NOW));
  assert.ok(drafts.length > 5);
  for (const d of drafts) {
    assert.deepEqual(d.problems, [], `${d.id}: ${d.text}`);
    assert.match(d.link, new RegExp(`from=${config.channels[d.channel].tag}`));
  }
  assert.ok(drafts.filter((d) => d.channel === 'youtube' || d.channel === 'tiktok').every((d) => d.clip), 'video channels only get moments with a clip');
});

test('lint catches the studio voice rules', () => {
  assert.ok(lintText('Fund now! Last chance.').some((p) => p.includes('exclamation')));
  assert.ok(lintText('A lucky win, funded for $1.00 by supporters.').some((p) => p.includes('chance word')));
  assert.ok(lintText('A seamless journey through the studio for everyone.').some((p) => p.includes('inflated')));
  assert.ok(lintText('Thanks for the donation to the studio today.').some((p) => p.includes('donation')));
  assert.ok(lintText('This is it — the studio grew today.').some((p) => p.includes('dash')));
  assert.deepEqual(lintText('The Gatherer now costs 10 dust instead of 11.'), []);
  assert.ok(lintText('The first ever studio run by AI agents in public.').some((p) => p.includes('claims a first')));
  assert.deepEqual(lintText('The first unlock now comes sooner in Dust.'), []);
  for (const e of EXPLAINERS) assert.deepEqual(lintText(e.text), [], e.ref);
});

test('the bandit tries each variant, then prefers the one that earns more', () => {
  let pb = emptyPlaybook();
  const variants = ['plain', 'agent', 'cost'];
  const tried = new Set();
  for (let i = 0; i < 3; i += 1) {
    const v = chooseVariant(pb, 'ship', 'x', variants);
    tried.add(v);
    pb = updatePlaybook(pb, [{ kind: 'ship', channel: 'x', variant: v, hour: 15, metrics: { likes: v === 'agent' ? 20 : 1 } }]);
  }
  assert.equal(tried.size, 3);
  for (let i = 0; i < 20; i += 1) {
    const v = chooseVariant(pb, 'ship', 'x', variants);
    pb = updatePlaybook(pb, [{ kind: 'ship', channel: 'x', variant: v, hour: 15, metrics: { likes: v === 'agent' ? 20 : 1 } }]);
  }
  const n = (v) => pb.arms[`ship|x|${v}`].n;
  assert.ok(n('agent') > n('plain') && n('agent') > n('cost'), JSON.stringify(pb.arms));
});

test('review mode drafts but sends nothing until approved; dedupe holds across runs', async () => {
  const root = tempRoot('review');
  const first = await harvest({ root, now: new Date(NOW), docsFile: join(root, 'docs.json'), log: () => {} });
  const again = await harvest({ root, now: new Date(NOW), docsFile: join(root, 'docs.json'), log: () => {} });
  assert.ok(first.drafts > 0);
  assert.equal(again.drafts, 0);
  const calls = [];
  const fakeFetch = async (url) => {
    calls.push(String(url));
    return new Response(JSON.stringify({ id: '1', channel_id: '2' }), { status: 200 });
  };
  const env = { PROMO_DISCORD_WEBHOOK_URL: 'https://discord.test/hook' };
  let out = await publish({ root, env, fetch: fakeFetch, now: new Date(NOW), log: () => {} });
  assert.equal(out.sent, 0);
  const discordIds = listOutbox(root).filter((d) => d.channel === 'discord').map((d) => d.id);
  setStatus(discordIds, 'approved', { root });
  out = await publish({ root, env, fetch: fakeFetch, now: new Date(NOW), log: () => {} });
  assert.equal(out.sent, 1, 'one per run: the gap rule holds the rest');
  assert.equal(readSent(root)[0].channel, 'discord');
  assert.equal(readSent(root)[0].kind, 'card_legendary', 'highest priority first');
  out = await publish({ root, env, fetch: fakeFetch, now: new Date(NOW + 3 * 3_600_000), log: () => {} });
  assert.equal(out.sent, 1);
});

test('auto mode sends clean drafts; channels without credentials are skipped, not failed', async () => {
  const root = tempRoot('auto');
  await harvest({ root, now: new Date(NOW), docsFile: join(root, 'docs.json'), log: () => {} });
  const fakeFetch = async () => new Response(JSON.stringify({ id: '9', url: 'https://social.test/9' }), { status: 200 });
  const out = await publish({ root, env: { PROMO_MASTODON_URL: 'https://social.test', PROMO_MASTODON_TOKEN: 't' }, fetch: fakeFetch, now: new Date(NOW), log: () => {} });
  assert.equal(out.sent, 1);
  assert.equal(out.failed, 0);
  assert.ok(out.skipped > 0);
  assert.equal(readSent(root)[0].channel, 'mastodon');
});

test('learning runs once per settled post', async () => {
  const root = tempRoot('auto');
  await harvest({ root, now: new Date(NOW), docsFile: join(root, 'docs.json'), log: () => {} });
  const fakeFetch = async () => new Response(JSON.stringify({ id: '9', url: 'u' }), { status: 200 });
  await publish({ root, env: { PROMO_MASTODON_URL: 'https://social.test', PROMO_MASTODON_TOKEN: 't' }, fetch: fakeFetch, now: new Date(NOW), log: () => {} });
  const r = readSent(root)[0];
  mkdirSync(join(root, 'metrics'), { recursive: true });
  writeFileSync(join(root, 'metrics', '2026-10-19.json'), JSON.stringify({ [r.id]: { likes: 3, reposts: 1, channel: 'mastodon' } }));
  assert.equal(learn({ root, now: new Date(NOW + 3 * 86_400_000), log: () => {} }).learned, 1);
  assert.equal(learn({ root, now: new Date(NOW + 4 * 86_400_000), log: () => {} }).learned, 0);
});

test('bluesky link facets index UTF-8 bytes', () => {
  const text = 'Café news\n\nhttps://mobmachine.games/?from=bsky';
  const facet = linkFacet(text, 'https://mobmachine.games/?from=bsky');
  assert.equal(facet.index.byteStart, Buffer.byteLength('Café news\n\n'));
});

test('a ship becomes a clip draft for the video channels only, and the spotlight clip goes out once per card', () => {
  const moments = harvestMoments(docs, config, NOW);
  const drafts = composeDrafts(moments, config, emptyPlaybook(), new Set(), new Date(NOW));
  const ship = drafts.find((d) => d.moment.kind === 'ship' && d.channel === 'youtube');
  assert.ok(ship, 'a YouTube draft for the ship');
  assert.equal(ship.clip.role, 'Builder A');
  assert.equal(ship.clip.state, 'live');
  assert.deepEqual(ship.clip.rows[0], { label: 'Agent work', value: '$0.42', money: true });
  assert.match(ship.title, /^Cheaper first Gatherer/);
  assert.ok(!drafts.find((d) => d.moment.kind === 'ship' && d.channel === 'bluesky').clip, 'text channels keep the image');
  const spot = drafts.find((d) => d.moment.kind === 'spotlight' && d.channel === 'tiktok');
  assert.equal(spot.id, 'spotlight-cccccccc-3333-tiktok');
  assert.equal(spot.clip.funded, 0.25);
});

test('publish renders a clip draft before sending it', async () => {
  const dir = tempRoot();
  const draft = { id: 'ship-x-youtube', createdAt: new Date(NOW).toISOString(), status: 'approved', problems: [], moment: { kind: 'ship', ref: 'x', priority: 70, at: new Date(NOW).toISOString() }, channel: 'youtube', variant: 'plain', text: 'New in Dust.', link: 'https://mobmachine.games/?from=yt', clip: { title: 'T' } };
  mkdirSync(join(dir, 'outbox'), { recursive: true });
  writeFileSync(join(dir, 'outbox', `${draft.id}.json`), JSON.stringify(draft));
  const rendered = [];
  const calls = [];
  const fake = async (url, init) => {
    calls.push(String(url));
    if (String(url).endsWith('/integrations')) return new Response(JSON.stringify([{ id: 'yt1', identifier: 'youtube' }]));
    if (String(url).endsWith('/upload')) return new Response(JSON.stringify({ id: 'm1', path: 'https://uploads.postiz.com/m1.mp4' }));
    return new Response(JSON.stringify([{ postId: 'p1', integration: 'yt1' }]));
  };
  writeFileSync(join(dir, 'clip.mp4'), 'video');
  const summary = await publish({ root: dir, env: { PROMO_POSTIZ_API_KEY: 'k' }, fetch: fake, now: new Date(NOW), log: () => {}, render: (d) => (rendered.push(d.id), 'clip.mp4') });
  assert.deepEqual(rendered, ['ship-x-youtube']);
  assert.equal(summary.sent, 1);
  assert.ok(calls.some((u) => u.endsWith('/upload')), 'the rendered clip was uploaded');
});

test('site visits keyed by link tag land on the channel that carries the tag', () => {
  const config = { channels: { bluesky: { tag: 'bsky' }, youtube: { tag: 'yt' }, x: { tag: 'x' } } };
  assert.deepEqual(visitsByChannel({ bsky: 3, yt: 1, x: 2, reddit: 4 }, config), { bluesky: 3, youtube: 1, x: 2, reddit: 4 });
});
