// Tests for the ship notices job (docs/specs/ship-notices.md) with fake HTTP: nothing here reaches
// Stripe, Resend, Supabase or ntfy. ops.test.mjs imports this file, so `pnpm test:ops` runs it.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { envFileProblems } from '../jobs/check-env.mjs';
import { jobEnvProblems } from '../jobs/lib.mjs';
import { main } from '../jobs/main.mjs';
import { accountEmail, composeFollowNotice, composeNotice, followUnsubscribeUrl, gameOf, nextOpenCards, NOTICE_FROM, NOTICE_REPLY_TO, NOTICES_PER_RUN, playUrl, runNotices, sessionEmail, unsubscribeUrl } from '../jobs/notices.mjs';

const NOW = new Date('2026-10-11T09:07:00Z');
const PLAY = 'https://play.mobmachine.games';
const ENV = {
  SUPABASE_URL: 'https://fixture.supabase.local',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fixture',
  STRIPE_READ_KEY: 'rk_live_fixture',
  RESEND_API_KEY: 're_fixture_key_000',
  NTFY_TOPIC_URL: 'https://ntfy.sh/fixture-topic',
};
const TOKEN = 'cd'.repeat(32);
const row = (n, extra = {}) => ({
  payment_id: `00000000-0000-4000-8000-00000000000${n}`,
  card_id: '00000000-0000-4000-8000-0000000000c1',
  stripe_session_id: `cs_live_fixture${n}`,
  card_title: 'Dust storms\non the map',
  card_folder: 'seed-1',
  live_at: '2026-10-10T12:00:00Z',
  cost_usd: 1.234,
  unsubscribe_token: TOKEN,
  ...extra,
});
const EMAIL = (n) => `supporter${n}@example.com`;
const follow = (n, extra = {}) => ({
  user_id: `00000000-0000-4000-8000-0000000000f${n}`,
  card_id: '00000000-0000-4000-8000-0000000000c1',
  card_title: 'Dust storms\non the map',
  card_folder: 'seed-1',
  live_at: '2026-10-10T12:00:00Z',
  cost_usd: 1.234,
  unsubscribe_token: TOKEN,
  covered: false,
  ...extra,
});
const FOLLOWER = (n) => `follower${n}@example.com`;
const NEXT = { id: '00000000-0000-4000-8000-0000000000c2', title: 'A <faster> Cart', funded_usd: 0.52, funding_target_usd: 0.78 };
const ORDER = [{ position: 1, card_id: '00000000-0000-4000-8000-0000000000d1', room_usd: 1 }, { position: 2, card_id: NEXT.id, room_usd: 0.26 }, { position: 3, card_id: '00000000-0000-4000-8000-0000000000d3', room_usd: 2 }];
const ORDER_CARDS = [
  { id: '00000000-0000-4000-8000-0000000000d1', title: 'A clearer ledger', folder: 'platform', funded_usd: '0.0000', funding_target_usd: '1.0000' },
  { id: NEXT.id, title: 'A <faster>\nCart', folder: 'seed-1', funded_usd: '0.5200', funding_target_usd: '0.7800' },
  { id: '00000000-0000-4000-8000-0000000000d3', title: 'Later Dust card', folder: 'seed-1', funded_usd: '0.0000', funding_target_usd: '2.0000' },
];
const ACCOUNTS = {
  [follow(1).user_id]: { id: follow(1).user_id, email: FOLLOWER(1), email_confirmed_at: '2026-10-01T00:00:00Z' },
  [follow(2).user_id]: { id: follow(2).user_id, email: FOLLOWER(2), email_confirmed_at: '2026-10-01T00:00:00Z' },
};
const NO_FOLLOWS = '; follows due 0, sent 0, covered 0, no address 0, failed 0, account unread 0, already claimed 0';

// A fetch stand-in for Supabase (the four calls), Stripe (one session read per row), Resend and ntfy.
// claimed holds the pairs already claimed; a claim answers true only the first time.
function fake({
  due = [row(1), row(2)],
  emails = { cs_live_fixture1: EMAIL(1), cs_live_fixture2: EMAIL(2) },
  resend = () => ({ status: 200, body: { id: 'resend-1' } }),
  stripeDown = new Set(),
  stuck = [],
  claimed = new Set(),
  follows = [],
  accounts = ACCOUNTS,
  authDown = new Set(),
  followStuck = [],
  followClaimed = new Set(),
  money = null,
  cards = [],
} = {}) {
  const calls = [];
  const settled = [];
  const followSettled = [];
  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetchFn = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    let body = init.body ?? null;
    try {
      body = body ? JSON.parse(body) : null;
    } catch {
      // ntfy takes plain text.
    }
    calls.push({ method, url, headers: init.headers ?? {}, body });
    if (url.origin === 'https://api.stripe.com') {
      const id = decodeURIComponent(url.pathname.replace('/v1/checkout/sessions/', ''));
      if (stripeDown.has(id)) return json(500, { error: { message: 'down' } });
      return json(200, { id, customer_details: emails[id] ? { email: emails[id] } : { email: null } });
    }
    if (url.origin === 'https://api.resend.com') {
      const answer = resend(body);
      if (answer instanceof Error) throw answer;
      return json(answer.status, answer.body);
    }
    if (url.pathname === '/rest/v1/rpc/ship_notices_due') return json(200, due);
    if (url.pathname === '/rest/v1/rpc/ship_notice_claim') {
      const key = `${body.p_payment}/${body.p_card}`;
      if (claimed.has(key)) return json(200, false);
      claimed.add(key);
      return json(200, true);
    }
    if (url.pathname === '/rest/v1/rpc/ship_notice_settle') {
      settled.push(body);
      return json(200, true);
    }
    if (url.pathname === '/rest/v1/ship_notices') return json(200, stuck);
    if (url.pathname === '/rest/v1/rpc/follow_notices_due') return json(200, follows.slice(0, body.p_limit));
    if (url.pathname === '/rest/v1/rpc/follow_notice_claim') {
      const key = `${body.p_user}/${body.p_card}`;
      if (followClaimed.has(key)) return json(200, false);
      followClaimed.add(key);
      return json(200, true);
    }
    if (url.pathname === '/rest/v1/rpc/follow_notice_settle') {
      followSettled.push(body);
      return json(200, true);
    }
    if (url.pathname === '/rest/v1/rpc/follow_notices_stuck') return json(200, followStuck);
    // The next open card: unanswered (money null) falls through to the plain 'ok' below.
    if (url.pathname === '/rest/v1/public_money' && money !== null) return json(200, money);
    if (url.pathname === '/rest/v1/cards' && money !== null) return json(200, cards);
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      const id = decodeURIComponent(url.pathname.slice('/auth/v1/admin/users/'.length));
      if (authDown.has(id)) return json(500, { msg: 'down' });
      return accounts[id] ? json(200, accounts[id]) : json(404, { msg: 'User not found' });
    }
    return new Response('ok', { status: 200 });
  };
  return { fetchFn, calls, settled, claimed, followSettled, followClaimed };
}

const sink = () => {
  const lines = [];
  return { lines, write: (text) => lines.push(text), text: () => lines.join('') };
};
const run = (f, extra = {}) => runNotices({ env: ENV, fetchFn: f.fetchFn, now: NOW, out: extra.out ?? sink(), sleep: async () => {}, play: PLAY, ...extra });

describe('the ship notices env', () => {
  test('takes the Supabase service key, the restricted Stripe read key, a Resend key and ntfy, and nothing else', () => {
    assert.deepEqual(jobEnvProblems('notices', ENV), []);
    assert.deepEqual(jobEnvProblems('notices', { ...ENV, RESEND_API_KEY: 'not-a-key' }), ['RESEND_API_KEY must be a Resend API key (re_...)']);
    assert.ok(jobEnvProblems('notices', { ...ENV, STRIPE_READ_KEY: 'sk_live_x' }).some((p) => p.includes('Stripe secret key')));
    const { RESEND_API_KEY: _r, ...noResend } = ENV;
    assert.deepEqual(jobEnvProblems('notices', noResend), ['RESEND_API_KEY is missing or empty']);
    const text = `${Object.entries(ENV).map(([k, v]) => `${k}=${v}`).join('\n')}\nGITHUB_BILLING_TOKEN=github_pat_x\n`;
    assert.ok(envFileProblems('notices', text).some((p) => p.startsWith('GITHUB_BILLING_TOKEN is not a notices key')));
  });

  test('the play address is the site build value', () => {
    assert.equal(playUrl(), PLAY);
  });
});

describe('the ship notice', () => {
  test('names the card, that it is live, what the agents spent, its page, the play address and the unsubscribe, and no address', () => {
    const notice = composeNotice(row(1), PLAY);
    assert.equal(notice.subject, 'Shipped in Dust: Dust storms on the map');
    assert.match(notice.text, /Dust storms on the map is live\./);
    assert.match(notice.text, /The agents spent \$1\.23 building it\./);
    assert.ok(notice.text.includes('See the card: https://mobmachine.games/card/00000000-0000-4000-8000-0000000000c1'));
    assert.ok(notice.text.includes(`Play the game: ${PLAY}`));
    const stop = unsubscribeUrl(row(1).payment_id, TOKEN);
    assert.equal(stop, `https://mobmachine.games/api/unsubscribe?p=00000000-0000-4000-8000-000000000001&t=${TOKEN}`);
    assert.ok(notice.text.includes(`Stop ship notices: ${stop}`));
    assert.deepEqual(notice.headers, { 'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    assert.equal(notice.idempotencyKey, 'ship-notice/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-0000000000c1');
    assert.doesNotMatch(`${notice.text}${notice.html}`, /@/);
  });

  test('names no game for a card that changes none', () => {
    assert.equal(gameOf('seed-1'), 'Dust');
    assert.equal(gameOf('platform'), null);
    assert.equal(composeNotice(row(1, { card_folder: 'platform' }), PLAY).subject, 'Shipped: Dust storms on the map');
    assert.equal(composeNotice(row(1, { card_folder: 'platform' }), PLAY, NEXT).text.includes('Next for'), false);
  });

  test('points to the next open card in the game, with its funding', () => {
    const notice = composeNotice(row(1), PLAY, NEXT);
    assert.ok(notice.text.includes('Next for Dust: A <faster> Cart, $0.52 of $0.78 funded.\nFund it: https://mobmachine.games/card/00000000-0000-4000-8000-0000000000c2\n'));
    assert.ok(notice.html.includes('<p>Next for Dust: A &lt;faster&gt; Cart, $0.52 of $0.78 funded. <a href="https://mobmachine.games/card/00000000-0000-4000-8000-0000000000c2">Fund it</a></p>'));
    assert.equal(composeNotice(row(1), PLAY).text.includes('Next for'), false);
    // The shipped card is never its own next card.
    assert.equal(composeNotice(row(1), PLAY, { ...NEXT, id: row(1).card_id }).text.includes('Next for'), false);
    assert.ok(composeFollowNotice(follow(1), PLAY, NEXT).text.includes('Next for Dust: A <faster> Cart, $0.52 of $0.78 funded.'));
  });

  test('escapes the card title in the HTML part', () => {
    const notice = composeNotice(row(1, { card_title: 'A <b>bold</b> & "quoted" card' }), PLAY);
    assert.ok(notice.html.includes('A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; card'));
    assert.doesNotMatch(notice.html, /<b>bold/);
  });

  test('reads the receipt address from the session, or none', () => {
    assert.equal(sessionEmail({ customer_details: { email: ' a@b.example ' } }), 'a@b.example');
    for (const session of [{}, { customer_details: null }, { customer_details: { email: null } }, { customer_details: { email: 'nope' } }]) assert.equal(sessionEmail(session), null);
  });
});

describe('the ship notices run', () => {
  test('reads each session from Stripe with GET, claims, sends one email each from the studio sender, and settles sent', async () => {
    const f = fake();
    const out = sink();
    const result = await run(f, { out });
    assert.equal(result.ok, true);
    assert.deepEqual(result.counts, { due: 2, sent: 2, no_address: 0, failed: 0, skipped: 0, stripe_unread: 0 });
    assert.equal(out.lines[0], `PASS: notices: due 2, sent 2, no address 0, failed 0, Stripe unread 0, already claimed 0${NO_FOLLOWS}\n`);
    const stripe = f.calls.filter((c) => c.url.origin === 'https://api.stripe.com');
    assert.deepEqual(stripe.map((c) => [c.method, c.url.pathname]), [['GET', '/v1/checkout/sessions/cs_live_fixture1'], ['GET', '/v1/checkout/sessions/cs_live_fixture2']]);
    for (const c of stripe) assert.equal(c.headers.Authorization, 'Bearer rk_live_fixture');
    const sends = f.calls.filter((c) => c.url.origin === 'https://api.resend.com');
    assert.equal(sends.length, 2);
    assert.deepEqual(sends.map((c) => c.body.to), [[EMAIL(1)], [EMAIL(2)]]);
    for (const c of sends) {
      assert.equal(c.method, 'POST');
      assert.equal(c.body.from, NOTICE_FROM);
      assert.equal(c.body.from, 'Mob Machine <studio@mobmachine.games>');
      assert.equal(c.body.reply_to, NOTICE_REPLY_TO);
      assert.equal(c.body.reply_to, 'hello@clayhouse.studio');
      assert.equal(c.headers.Authorization, `Bearer ${ENV.RESEND_API_KEY}`);
      assert.match(c.headers['Idempotency-Key'], /^ship-notice\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
      assert.equal(c.body.headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
    }
    assert.deepEqual(f.settled.map((s) => [s.p_status, s.p_provider_id]), [['sent', 'resend-1'], ['sent', 'resend-1']]);
    // Each send is claimed first.
    const order = f.calls.map((c) => (c.url.origin === 'https://api.resend.com' ? 'send' : c.url.pathname.split('/').pop()));
    assert.deepEqual(order.filter((o) => o === 'ship_notice_claim' || o === 'send'), ['ship_notice_claim', 'send', 'ship_notice_claim', 'send']);
    // No address is ever printed, posted to ntfy or sent to Supabase.
    assert.doesNotMatch(out.text(), /@/);
    for (const c of f.calls.filter((c) => c.url.origin !== 'https://api.resend.com')) assert.doesNotMatch(JSON.stringify(c.body ?? ''), /example\.com/);
  });

  test('reads the next open card once a run and names it in each email; an unread order sends without it', async () => {
    const f = fake({ money: [{ funding_order: ORDER }], cards: ORDER_CARDS, follows: [follow(1)] });
    const result = await run(f);
    assert.equal(result.ok, true);
    assert.equal(f.calls.filter((c) => c.url.pathname === '/rest/v1/public_money').length, 1);
    const read = f.calls.filter((c) => c.url.pathname === '/rest/v1/cards');
    assert.equal(read.length, 1);
    assert.equal(read[0].method, 'GET');
    assert.equal(read[0].url.searchParams.get('id'), `in.(${ORDER.map((p) => p.card_id).join(',')})`);
    const sends = f.calls.filter((c) => c.url.origin === 'https://api.resend.com');
    assert.equal(sends.length, 3);
    for (const c of sends) assert.ok(c.body.text.includes('Next for Dust: A <faster> Cart, $0.52 of $0.78 funded.'), c.body.text);
    assert.deepEqual(await nextOpenCards({ select: async () => { throw new Error('down'); } }), {});
    const g = fake();
    await run(g);
    for (const c of g.calls.filter((c) => c.url.origin === 'https://api.resend.com')) assert.equal(c.body.text.includes('Next for'), false);
  });

  test('never sends twice: a second run over the same pairs finds them claimed and sends nothing', async () => {
    const claimed = new Set();
    const first = fake({ claimed });
    await run(first);
    const second = fake({ claimed });
    const result = await run(second);
    assert.equal(result.counts.sent, 0);
    assert.equal(result.counts.skipped, 2);
    assert.equal(second.calls.filter((c) => c.url.origin === 'https://api.resend.com').length, 0);
  });

  test('settles a session with no address as no_address and sends nothing for it', async () => {
    const f = fake({ emails: { cs_live_fixture2: EMAIL(2) } });
    const result = await run(f);
    assert.deepEqual([result.counts.sent, result.counts.no_address], [1, 1]);
    assert.deepEqual(f.settled.map((s) => s.p_status), ['no_address', 'sent']);
  });

  test('a Resend error or a lost answer settles failed, is not retried, and alerts the board with no address', async () => {
    for (const resend of [() => ({ status: 422, body: { message: 'bad' } }), () => new Error('timeout')]) {
      const f = fake({ due: [row(1)], resend });
      const out = sink();
      const result = await run(f, { out });
      assert.equal(result.ok, false);
      assert.deepEqual(f.settled.map((s) => s.p_status), ['failed']);
      assert.match(out.lines[0], /^FAIL: notices: due 1, sent 0, no address 0, failed 1/);
      const alert = f.calls.find((c) => c.url.origin === 'https://ntfy.sh');
      assert.ok(alert, 'the board is alerted');
      assert.doesNotMatch(String(alert.body ?? ''), /@/);
      assert.equal(f.calls.filter((c) => c.url.origin === 'https://api.resend.com').length, 1);
    }
  });

  test('a session Stripe does not answer is not claimed, so the next run tries it again', async () => {
    const f = fake({ stripeDown: new Set(['cs_live_fixture1']) });
    const result = await run(f);
    assert.equal(result.counts.stripe_unread, 1);
    assert.equal(result.counts.sent, 1);
    assert.equal(f.claimed.has(`${row(1).payment_id}/${row(1).card_id}`), false);
    assert.equal(result.ok, false);
  });

  test('names a claim left at sending for over an hour', async () => {
    const f = fake({ due: [], stuck: [{ payment_id: 'p1', card_id: 'c1' }] });
    const out = sink();
    const result = await run(f, { out });
    assert.equal(result.ok, false);
    assert.match(out.text(), /payment p1 card c1: claimed but never settled/);
    const select = f.calls.find((c) => c.url.pathname === '/rest/v1/ship_notices');
    assert.equal(select.url.searchParams.get('status'), 'eq.sending');
    assert.equal(select.url.searchParams.get('created_at'), 'lt.2026-10-11T08:07:00.000Z');
  });

  test('a dry run reads Stripe and claims, sends, settles and alerts nothing', async () => {
    const f = fake();
    const out = sink();
    const result = await run(f, { dryRun: true, out });
    assert.equal(out.lines[0], `PASS: notices (dry run): due 2, would send 2, no address 0, failed 0, Stripe unread 0, already claimed 0${NO_FOLLOWS.replace('sent 0', 'would send 0')}\n`);
    assert.equal(result.counts.sent, 2);
    for (const c of f.calls) {
      assert.ok(!['ship_notice_claim', 'ship_notice_settle'].includes(c.url.pathname.split('/').pop()), c.url.pathname);
      assert.notEqual(c.url.origin, 'https://api.resend.com');
      assert.notEqual(c.url.origin, 'https://ntfy.sh');
    }
  });

  test('main.mjs runs notices, and refuses to start with a bad env, making no request', async () => {
    const f = fake({ due: [] });
    assert.equal(await main(['notices', '--dry-run'], ENV, { fetchFn: f.fetchFn, now: NOW, out: sink(), play: PLAY }), 0);
    const g = fake();
    const out = sink();
    assert.equal(await main(['notices'], { ...ENV, RESEND_API_KEY: '' }, { fetchFn: g.fetchFn, out }), 1);
    assert.equal(g.calls.length, 0);
    assert.match(out.text(), /^FAIL: notices: notices env refused/);
  });
});

describe('the follow email (docs/specs/card-follows.md)', () => {
  test('names the card, that it is live, what the agents spent, its page, the play address and its own unsubscribe, and no address', () => {
    const notice = composeFollowNotice(follow(1), PLAY);
    assert.equal(notice.subject, 'Shipped in Dust: Dust storms on the map');
    assert.match(notice.text, /^A card you follow has shipped\./);
    assert.match(notice.text, /Dust storms on the map is live\./);
    assert.match(notice.text, /The agents spent \$1\.23 building it\./);
    assert.ok(notice.text.includes('See the card: https://mobmachine.games/card/00000000-0000-4000-8000-0000000000c1'));
    assert.ok(notice.text.includes(`Play the game: ${PLAY}`));
    const stop = followUnsubscribeUrl(follow(1).user_id, TOKEN);
    assert.equal(stop, `https://mobmachine.games/api/unsubscribe?f=00000000-0000-4000-8000-0000000000f1&t=${TOKEN}`);
    assert.ok(notice.text.includes(`Stop emails for cards you follow: ${stop}`));
    assert.deepEqual(notice.headers, { 'List-Unsubscribe': `<${stop}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    assert.equal(notice.idempotencyKey, 'card-follow/00000000-0000-4000-8000-0000000000f1/00000000-0000-4000-8000-0000000000c1');
    assert.doesNotMatch(`${notice.text}${notice.html}`, /@/);
  });

  test('escapes the card title in the HTML part', () => {
    const notice = composeFollowNotice(follow(1, { card_title: 'A <b>bold</b> & "quoted" card' }), PLAY);
    assert.ok(notice.html.includes('A &lt;b&gt;bold&lt;/b&gt; &amp; &quot;quoted&quot; card'));
    assert.doesNotMatch(notice.html, /<b>bold/);
  });

  test('takes the account email only once it is confirmed', () => {
    assert.equal(accountEmail({ email: ' a@b.example ', email_confirmed_at: '2026-10-01T00:00:00Z' }), 'a@b.example');
    for (const user of [{}, null, { email: 'a@b.example' }, { email: 'a@b.example', email_confirmed_at: null }, { email: 'nope', email_confirmed_at: '2026-10-01T00:00:00Z' }]) {
      assert.equal(accountEmail(user), null);
    }
  });
});

describe('the follow emails in the notices run', () => {
  test('after the payers: reads each account from Supabase Auth with GET, claims, sends one email each, and settles sent', async () => {
    const f = fake({ due: [row(1)], follows: [follow(1), follow(2)] });
    const out = sink();
    const result = await run(f, { out });
    assert.equal(result.ok, true);
    assert.deepEqual(result.follows, { due: 2, sent: 2, covered: 0, no_address: 0, failed: 0, skipped: 0, account_unread: 0, waiting: false });
    assert.equal(
      out.lines[0],
      'PASS: notices: due 1, sent 1, no address 0, failed 0, Stripe unread 0, already claimed 0; follows due 2, sent 2, covered 0, no address 0, failed 0, account unread 0, already claimed 0\n',
    );
    // The payers' list is read first; the follows get what is left of the run's budget.
    const order = f.calls.map((c) => c.url.pathname.split('/').pop());
    assert.ok(order.indexOf('ship_notices_due') < order.indexOf('follow_notices_due'));
    assert.equal(f.calls.find((c) => c.url.pathname.endsWith('/follow_notices_due')).body.p_limit, NOTICES_PER_RUN - 1);
    const auth = f.calls.filter((c) => c.url.pathname.startsWith('/auth/v1/admin/users/'));
    assert.deepEqual(auth.map((c) => [c.method, c.url.pathname]), [
      ['GET', `/auth/v1/admin/users/${follow(1).user_id}`],
      ['GET', `/auth/v1/admin/users/${follow(2).user_id}`],
    ]);
    for (const c of auth) assert.equal(c.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
    const sends = f.calls.filter((c) => c.url.origin === 'https://api.resend.com');
    assert.deepEqual(sends.map((c) => c.body.to), [[EMAIL(1)], [FOLLOWER(1)], [FOLLOWER(2)]]);
    for (const c of sends.slice(1)) {
      assert.equal(c.body.from, NOTICE_FROM);
      assert.equal(c.body.subject, 'Shipped in Dust: Dust storms on the map');
      assert.match(c.headers['Idempotency-Key'], /^card-follow\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
      assert.match(c.body.headers['List-Unsubscribe'], /\/api\/unsubscribe\?f=[0-9a-f-]{36}&t=[0-9a-f]{64}>$/);
    }
    assert.deepEqual(f.followSettled.map((s) => [s.p_user, s.p_status, s.p_provider_id]), [
      [follow(1).user_id, 'sent', 'resend-1'],
      [follow(2).user_id, 'sent', 'resend-1'],
    ]);
    const steps = f.calls
      .map((c) => (c.url.origin === 'https://api.resend.com' ? 'send' : c.url.pathname.split('/').pop()))
      .filter((o) => o === 'follow_notice_claim' || o === 'send');
    assert.deepEqual(steps, ['send', 'follow_notice_claim', 'send', 'follow_notice_claim', 'send']);
    // No address is ever printed, posted to ntfy or sent to Supabase.
    assert.doesNotMatch(out.text(), /@/);
    for (const c of f.calls.filter((c) => c.url.origin !== 'https://api.resend.com')) assert.doesNotMatch(JSON.stringify(c.body ?? ''), /example\.com/);
  });

  test('a covered follow is claimed and settled covered with no email and no account read', async () => {
    const f = fake({ due: [], follows: [follow(1, { covered: true })] });
    const result = await run(f);
    assert.equal(result.follows.covered, 1);
    assert.deepEqual(f.followSettled.map((s) => s.p_status), ['covered']);
    assert.equal(f.calls.filter((c) => c.url.origin === 'https://api.resend.com').length, 0);
    assert.equal(f.calls.filter((c) => c.url.pathname.startsWith('/auth/')).length, 0);
  });

  test('a full payers list leaves the follows for the next run', async () => {
    const due = Array.from({ length: NOTICES_PER_RUN }, (_, i) => row(1, { payment_id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    const f = fake({ due, follows: [follow(1)] });
    const out = sink();
    const result = await run(f, { out });
    assert.equal(result.follows.waiting, true);
    assert.equal(f.calls.filter((c) => c.url.pathname.endsWith('/follow_notices_due')).length, 0);
    assert.match(out.lines[0], /follows due 0, sent 0, .*, waiting for the payers\n$/);
  });

  test('never sends twice: a second run finds the follows claimed', async () => {
    const followClaimed = new Set();
    await run(fake({ due: [], follows: [follow(1)], followClaimed }));
    const second = fake({ due: [], follows: [follow(1)], followClaimed });
    const result = await run(second);
    assert.deepEqual([result.follows.sent, result.follows.skipped], [0, 1]);
    assert.equal(second.calls.filter((c) => c.url.origin === 'https://api.resend.com').length, 0);
  });

  test('an account Auth does not know, or with no confirmed email, settles no_address and sends nothing', async () => {
    const f = fake({ due: [], follows: [follow(1), follow(2)], accounts: { [follow(2).user_id]: { email: FOLLOWER(2), email_confirmed_at: null } } });
    const result = await run(f);
    assert.equal(result.ok, true);
    assert.equal(result.follows.no_address, 2);
    assert.deepEqual(f.followSettled.map((s) => s.p_status), ['no_address', 'no_address']);
    assert.equal(f.calls.filter((c) => c.url.origin === 'https://api.resend.com').length, 0);
  });

  test('an account Auth does not answer is not claimed, so the next run tries it again', async () => {
    const f = fake({ due: [], follows: [follow(1), follow(2)], authDown: new Set([follow(1).user_id]) });
    const result = await run(f);
    assert.equal(result.ok, false);
    assert.deepEqual([result.follows.account_unread, result.follows.sent], [1, 1]);
    assert.equal(f.followClaimed.has(`${follow(1).user_id}/${follow(1).card_id}`), false);
  });

  test('a Resend error settles the follow failed, is not retried, and alerts the board with no address', async () => {
    const f = fake({ due: [], follows: [follow(1)], resend: () => ({ status: 500, body: {} }) });
    const out = sink();
    const result = await run(f, { out });
    assert.equal(result.ok, false);
    assert.deepEqual(f.followSettled.map((s) => s.p_status), ['failed']);
    const alert = f.calls.find((c) => c.url.origin === 'https://ntfy.sh');
    assert.ok(alert);
    assert.doesNotMatch(String(alert.body ?? ''), /@/);
    assert.match(out.text(), /follow 00000000-0000-4000-8000-0000000000f1 card .*: resend: http 500; not retried/);
  });

  test('names a follow claimed for over an hour and never settled', async () => {
    const f = fake({ due: [], followStuck: [{ user_id: 'u1', card_id: 'c1' }] });
    const out = sink();
    const result = await run(f, { out });
    assert.equal(result.ok, false);
    assert.match(out.text(), /follow u1 card c1: claimed but never settled/);
    assert.equal(f.calls.find((c) => c.url.pathname.endsWith('/follow_notices_stuck')).body.p_before, '2026-10-11T08:07:00.000Z');
  });

  test('a dry run reads Auth and claims, sends, settles and alerts nothing', async () => {
    const f = fake({ due: [], follows: [follow(1), follow(2, { covered: true })] });
    const out = sink();
    const result = await run(f, { dryRun: true, out });
    assert.deepEqual([result.follows.sent, result.follows.covered], [1, 1]);
    assert.match(out.lines[0], /^PASS: notices \(dry run\): .*; follows due 2, would send 1, covered 1,/);
    assert.equal(f.calls.filter((c) => c.url.pathname.startsWith('/auth/')).length, 1);
    for (const c of f.calls) {
      assert.ok(!['follow_notice_claim', 'follow_notice_settle', 'follow_notices_stuck'].includes(c.url.pathname.split('/').pop()), c.url.pathname);
      assert.notEqual(c.url.origin, 'https://api.resend.com');
    }
  });
});
