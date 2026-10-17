// Tests for the load test (platform/ops/load/load-test.mjs, docs/specs/load-test.md): the stats
// math, the Cache-Status reading, the rate split under the per-address caps, the plan's Supabase
// bound, the command line's refusals, the stop conditions, and two short runs against a local server
// that answers like Netlify's CDN. Run from the repository root: node --test platform/ops/test/load.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { after, before, describe, test } from 'node:test';
import {
  abortReason,
  allocate,
  breaches,
  cacheResult,
  DEFAULTS,
  GROUP_CAPS,
  isProductionHost,
  parseArgs,
  percentile,
  plan,
  report,
  run,
  stepsFor,
  summarize,
  targetsFor,
  THRESHOLDS,
} from '../load/load-test.mjs';

const CARD = '0b6f3c1e-8d2a-4c5b-9e7f-1a2b3c4d5e6f';
const siteTargets = () => targetsFor({ profile: 'site', base: 'https://mobmachine.games', play: 'https://play.mobmachine.games', card: CARD, asset: '/assets/index-abc.js' });

describe('the stats math', () => {
  test('percentile is nearest rank', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    assert.equal(percentile(sorted, 50), 50);
    assert.equal(percentile(sorted, 95), 95);
    assert.equal(percentile(sorted, 99), 99);
    assert.equal(percentile(sorted, 100), 100);
    assert.equal(percentile([7], 99), 7);
    assert.equal(percentile([], 50), 0);
    assert.equal(percentile([1, 2, 3, 4], 50), 2);
  });

  test('summarize counts errors, 429s, throughput and the hit ratio over answers with a Cache-Status', () => {
    const results = [
      { ms: 10, ok: true, status: 200, cache: 'hit' },
      { ms: 20, ok: true, status: 200, cache: 'stale' },
      { ms: 30, ok: true, status: 200, cache: 'miss' },
      { ms: 40, ok: false, status: 429, cache: 'hit' },
      { ms: 50, ok: false, status: 'timeout', cache: 'none' },
    ];
    const s = summarize(results, 2);
    assert.equal(s.requests, 5);
    assert.equal(s.errors, 2);
    assert.equal(s.errorRate, 0.4);
    assert.equal(s.rateLimited, 1);
    assert.equal(s.rps, 2.5);
    assert.equal(s.p50, 30);
    assert.equal(s.p95, 50);
    assert.equal(s.max, 50);
    assert.equal(s.hitRatio, 3 / 4);
    assert.equal(s.misses, 1);
    assert.equal(s.stale, 1);
    assert.equal(summarize([{ ms: 1, ok: true, status: 200, cache: 'none' }]).hitRatio, null);
    assert.deepEqual(summarize([]).errorRate, 0);
  });

  test('cacheResult reads Netlify Cache-Status members', () => {
    assert.equal(cacheResult('"Netlify Edge"; hit'), 'hit');
    assert.equal(cacheResult('"Netlify Durable"; hit; ttl=40, "Netlify Edge"; fwd=miss'), 'hit');
    assert.equal(cacheResult('"Netlify Durable"; fwd=miss; stored, "Netlify Edge"; fwd=miss'), 'miss');
    assert.equal(cacheResult('"Netlify Edge"; hit; fwd=stale'), 'stale');
    assert.equal(cacheResult('"Netlify Edge"; fwd=uri-miss'), 'miss');
    assert.equal(cacheResult(null), 'none');
    assert.equal(cacheResult(''), 'none');
  });
});

describe('the mix', () => {
  test('allocate keeps the whole rate and holds every capped group at or under its cap', () => {
    const targets = siteTargets();
    for (const rate of [1, 5, 15, 30, 50, 100]) {
      const rates = allocate(rate, targets);
      const total = Object.values(rates).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(total - rate) < 1e-6, `rate ${rate} total ${total}`);
      for (const [group, cap] of Object.entries(GROUP_CAPS)) {
        const used = targets.filter((t) => t.group === group).reduce((sum, t) => sum + rates[t.name], 0);
        assert.ok(used <= cap + 1e-9, `${group} at ${rate}: ${used} over ${cap}`);
      }
    }
  });

  test('the capped groups stay under the 300-a-minute per-address rules even at the production ceiling', () => {
    const rates = allocate(100, siteTargets());
    const snapshot = rates['/api/live'] + rates['/api/cards'] + rates['/api/reports'];
    const card = rates['/card/<id>'] + rates['/api/card/<id>'] + rates['/api/card/<id>/preview.png'];
    assert.ok(snapshot * 60 < 300 && card * 60 < 300, `snapshot ${snapshot * 60}/min, card ${card * 60}/min`);
    // The /card page's edge function reads /api/card once more per view; the rule still holds.
    assert.ok((card + rates['/card/<id>']) * 60 < 300);
  });

  test('allocate splits by weight when no cap binds', () => {
    const rates = allocate(4, [
      { name: 'a', weight: 3 },
      { name: 'b', weight: 1, group: 'g' },
    ], { g: 10 });
    assert.deepEqual(rates, { a: 3, b: 1 });
    const capped = allocate(4, [
      { name: 'a', weight: 1 },
      { name: 'b', weight: 1, group: 'g' },
    ], { g: 0.5 });
    assert.deepEqual(capped, { a: 3.5, b: 0.5 });
  });

  test('the default steps climb 10, 30, 60 and 100% of the rate over equal quarters', () => {
    assert.deepEqual(stepsFor({ rate: 50, duration: 120 }), [
      { rate: 5, seconds: 30 },
      { rate: 15, seconds: 30 },
      { rate: 30, seconds: 30 },
      { rate: 50, seconds: 30 },
    ]);
    assert.deepEqual(stepsFor({ rate: 50, duration: 120, steps: [{ rate: 2, seconds: 3 }] }), [{ rate: 2, seconds: 3 }]);
  });

  test('the production plan stays under 3,000 requests, a quarter of them to functions, and bounds Supabase', () => {
    const p = plan(siteTargets(), stepsFor({ rate: 50, duration: 120 }));
    assert.ok(p.requests <= 3000 && p.requests >= 2990, `requests ${p.requests}`);
    assert.ok(p.functionRequests / p.requests < 0.25, `function share ${p.functionRequests / p.requests}`);
    assert.ok(p.supabaseCached < 100, `supabase with the CDN ${p.supabaseCached}`);
    assert.ok(p.supabaseUncached < 700, `supabase with no cache ${p.supabaseUncached}`);
    // /api/reports: one hour of s-maxage, so at most two builds in two minutes.
    assert.equal(p.byTarget.find((t) => t.name === '/api/reports').cachedRpcs, 2);
    // /feed.xml reads two RPCs per build.
    assert.equal(p.byTarget.find((t) => t.name === '/feed.xml').cachedRpcs, 4);
  });

  test('the static profile reads no function path and only the GET paths it names', () => {
    const targets = targetsFor({ profile: 'static', base: 'http://127.0.0.1:4430', play: '', card: CARD, asset: '/assets/x.js' });
    assert.ok(targets.every((t) => t.kind === 'static'));
    assert.deepEqual(targets.map((t) => t.name), ['/', '/how-it-works', '/assets/<home script>', '/version.json', '/og.png']);
  });

  test('no target is a write path, checkout, sign-in or RPC', () => {
    for (const t of siteTargets()) {
      assert.doesNotMatch(t.url, /\/api\/(thanks|count|unsubscribe)|\/auth\/|\/rpc\/|stripe|checkout|contribute/i, t.url);
    }
  });
});

describe('the command line', () => {
  test('needs a base URL and refuses production without --i-mean-production', () => {
    assert.match(parseArgs([]).error, /base URL/);
    for (const host of ['https://mobmachine.games', 'https://play.mobmachine.games', 'https://peanutgallery.games', 'https://x.netlify.app']) {
      assert.match(parseArgs([host]).error, /refusing to load-test production/, host);
    }
    assert.match(parseArgs(['http://127.0.0.1:4430', '--play', 'https://play.mobmachine.games']).error, /refusing/);
    assert.ok(isProductionHost('mobmachine.games.'));
    assert.ok(!isProductionHost('127.0.0.1:4430'));
  });

  test('holds a production run under its ceilings', () => {
    const ok = parseArgs(['https://mobmachine.games', '--i-mean-production']);
    assert.equal(ok.production, true);
    assert.equal(ok.play, 'https://play.mobmachine.games');
    assert.equal(ok.maxRequests, 3000);
    assert.equal(ok.maxOrigin, THRESHOLDS.maxOrigin);
    assert.match(parseArgs(['https://mobmachine.games', '--i-mean-production', '--rate', '101']).error, /100 requests a second/);
    assert.match(parseArgs(['https://mobmachine.games', '--i-mean-production', '--duration', '301']).error, /300 seconds/);
    assert.match(parseArgs(['https://mobmachine.games', '--i-mean-production', '--max-requests', '10001']).error, /10000 requests/);
    assert.match(parseArgs(['https://mobmachine.games', '--i-mean-production', '--steps', '5:30,120:10']).error, /100 requests a second/);
  });

  test('a local run turns the origin budget off, and reads steps and options', () => {
    const local = parseArgs(['http://127.0.0.1:4430/x', '--profile', 'static', '--steps', '2:1,4:1', '--max-requests', '9']);
    assert.equal(local.base, 'http://127.0.0.1:4430');
    assert.equal(local.production, false);
    assert.equal(local.maxOrigin, 0);
    assert.equal(local.play, '');
    assert.deepEqual(local.steps, [{ rate: 2, seconds: 1 }, { rate: 4, seconds: 1 }]);
    assert.match(parseArgs(['http://127.0.0.1:4430', '--steps', '2']).error, /rate:seconds/);
    assert.match(parseArgs(['http://127.0.0.1:4430', '--card', 'nope']).error, /uuid/);
    assert.match(parseArgs(['http://127.0.0.1:4430', '--profile', 'all']).error, /site or static/);
    assert.match(parseArgs(['http://u:p@127.0.0.1:4430']).error, /credentials/);
    assert.match(parseArgs(['http://127.0.0.1:4430', '--bogus']).error, /unknown option/);
  });
});

describe('the stop conditions and the verdict', () => {
  const options = { ...DEFAULTS, production: true };
  const ok = (n, extra = {}) => Array.from({ length: n }, () => ({ ms: 50, ok: true, status: 200, cache: 'hit', kind: 'function', ...extra }));

  test('a step aborts over 2% errors or a 2 s p95, only after enough samples', () => {
    assert.equal(abortReason([...ok(40), ...ok(10, { ok: false, status: 500 })].slice(0, 49), [], options), null);
    assert.match(abortReason([...ok(48), ...ok(2, { ok: false, status: 503 })], [], options), /step error rate 4\.00% over 2\.00%/);
    assert.equal(abortReason([...ok(49), ...ok(1, { ok: false, status: 503 })], [], options), null);
    assert.match(abortReason([...ok(45), ...ok(5, { ms: 2500 })], [], options), /step p95 2500 ms over 2000 ms/);
  });

  test('the origin budget counts function misses, and in production a function answer with no Cache-Status', () => {
    assert.match(abortReason([], ok(201, { cache: 'miss' }), options), /201 function answers came from the function/);
    assert.match(abortReason([], ok(201, { cache: 'none' }), options), /201/);
    assert.equal(abortReason([], ok(201, { cache: 'miss', kind: 'static' }), options), null);
    assert.equal(abortReason([], ok(201, { cache: 'none' }), { ...options, production: false, maxOrigin: 0 }), null);
  });

  test('breaches fail on the benchmark floors', () => {
    const fine = summarize(ok(100));
    assert.deepEqual(breaches(fine, fine, options), []);
    const errors = summarize([...ok(98), ...ok(2, { ok: false, status: 500 })]);
    assert.match(breaches(errors, null, options)[0], /error rate 2\.00% over 1\.00%/);
    const slow = summarize([...ok(90), ...ok(10, { ms: 900 })]);
    assert.match(breaches(slow, null, options)[0], /p95 900 ms over 800 ms/);
    const missing = summarize([...ok(70), ...ok(30, { cache: 'miss' })]);
    assert.match(breaches(fine, missing, options)[0], /cache hit ratio 70\.0% under 80%/);
    const unknown = summarize(ok(10, { cache: 'none' }));
    assert.match(breaches(fine, unknown, options)[0], /no cached document carried a Cache-Status/);
    assert.deepEqual(breaches(fine, unknown, { ...options, production: false }), []);
  });
});

describe('a run against a local server that answers like the CDN', () => {
  let server;
  let base;
  let failing = false;
  const seen = [];
  before(async () => {
    const built = new Map();
    server = createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      if (failing && req.url.startsWith('/api/')) {
        res.writeHead(503).end();
        return;
      }
      if (req.url.startsWith('/api/')) {
        // The first read of each document is a miss, the rest hits, as Netlify's durable cache.
        const first = !built.has(req.url);
        built.set(req.url, true);
        const png = req.url.endsWith('.png');
        res.writeHead(200, { 'content-type': png ? 'image/png' : 'application/json', 'cache-status': first ? '"Netlify Durable"; fwd=miss; stored, "Netlify Edge"; fwd=miss' : '"Netlify Edge"; hit' });
        res.end('{}');
        return;
      }
      if (req.url === '/feed.xml') {
        res.writeHead(200, { 'content-type': 'application/atom+xml; charset=utf-8', 'cache-status': '"Netlify Edge"; hit' }).end('<feed/>');
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html', 'cache-status': '"Netlify Edge"; hit' }).end('<html></html>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  test('passes, reports per step and per path, sends only GET and stops at the request cap', async () => {
    const options = { ...parseArgs([base, '--steps', '30:1,40:1', '--max-requests', '50', '--min-hit-ratio', '0']), minSamples: 10 };
    const targets = targetsFor({ ...options, card: CARD, asset: null });
    const outcome = await run(options, targets, { tickMs: 5 });
    assert.equal(outcome.sent, 50);
    assert.equal(outcome.stop.aborted, false);
    assert.match(outcome.stop.reason, /request cap of 50 reached/);
    assert.ok(seen.every((line) => line.startsWith('GET ')), seen.find((line) => !line.startsWith('GET ')));
    const { lines, ok, summary } = report(options, targets, outcome);
    assert.equal(ok, true, lines.join('\n'));
    assert.match(lines[0], /^PASS load-test http:\/\/127\.0\.0\.1:\d+ requests=50 rps=[\d.]+ p50=\d+ms p95=\d+ms p99=\d+ms error_rate=0\.0% cache_hit=[\d.]+%$/);
    assert.ok(lines.some((line) => line.startsWith('1: 30 req/s x 1s')));
    assert.ok(lines.some((line) => line.startsWith('/api/live [function]')));
    assert.ok(lines.some((line) => /^supabase: \d+ function answers were built/.test(line)));
    assert.equal(summary.all.requests, 50);
  });

  test('aborts at once when the functions fail, and says why', async () => {
    failing = true;
    const options = { ...parseArgs([base, '--steps', '60:3']), minSamples: 20 };
    const targets = targetsFor({ ...options, card: null, asset: null }).map((t) => ({ ...t, weight: t.kind === 'function' ? 10 : 1 }));
    const started = performance.now();
    const outcome = await run(options, targets, { tickMs: 5 });
    assert.ok(performance.now() - started < 2900, 'stopped before the step ended');
    assert.equal(outcome.stop.aborted, true);
    assert.match(outcome.stop.reason, /step error rate/);
    const { lines, ok } = report(options, targets, outcome);
    assert.equal(ok, false);
    assert.match(lines[0], /^ABORTED /);
    assert.ok(lines.some((line) => /^stopped: step error rate/.test(line)));
    assert.ok(lines.some((line) => /^error: \/api\/live 503 x\d+/.test(line)));
    failing = false;
  });
});

// The workflow runs against production from Actions, so it holds no credential and names no secret.
describe('.github/workflows/load-test.yml', () => {
  const text = readFileSync(new URL('../../../.github/workflows/load-test.yml', import.meta.url), 'utf8');

  test('reads contents only, persists no checkout credential and uses no secret', () => {
    assert.match(text, /^permissions:\n {2}contents: read\n(?! )/m);
    assert.doesNotMatch(text, /secrets\.|github\.token|GITHUB_TOKEN|pull_request_target|workflow_run/);
    const checkouts = text.match(/uses: actions\/checkout@/g) ?? [];
    assert.equal((text.match(/persist-credentials: false/g) ?? []).length, checkouts.length);
  });

  test('runs production once after a push to main that changes the load test, and by hand', () => {
    assert.match(text, /push:\n {4}branches: \[main\]\n {4}paths:\n {6}- 'platform\/ops\/load\/\*\*'/);
    assert.match(text, /workflow_dispatch:\n {4}inputs:\n {6}base_url:/);
    for (const input of ['rate', 'duration', 'max_requests']) assert.match(text, new RegExp(`\\n {6}${input}:\\n`));
    assert.match(text, /--i-mean-production/);
    assert.match(text, /if: github\.event_name != 'pull_request' && github\.repository == 'AlreadyKyle\/peanutgallery'/);
  });

  test('hands the inputs to the tool through the environment, never into the script', () => {
    const scripts = text.split('\n').filter((line) => !/^\s*(#|[A-Z_]+: \$\{\{|if:|group:)/.test(line));
    for (const line of scripts) assert.doesNotMatch(line, /\$\{\{\s*inputs\./, line);
  });
});

describe('a run against a server with no functions', () => {
  test('a page served in place of a document counts as an error, as vite preview answers /api', async () => {
    const server = createServer((req, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>'));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const options = { ...parseArgs([base, '--steps', '40:1']), minSamples: 1000 };
      const targets = targetsFor({ ...options, card: null, asset: null });
      const outcome = await run(options, targets, { tickMs: 5 });
      const { lines, ok } = report(options, targets, outcome);
      assert.equal(ok, false);
      assert.ok(lines.some((line) => /^error: \/api\/live 200 text\/html x\d+/.test(line)), lines.join('\n'));
      assert.ok(!lines.some((line) => /^error: \/how-it-works/.test(line)));
    } finally {
      server.close();
    }
  });
});
