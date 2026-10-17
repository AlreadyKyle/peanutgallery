import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { breaches, DEFAULT_BASE, DEFAULT_PATHS, isProductionHost, parseLoadArgs, percentile, report, run, summarize, type LoadOptions } from '../scripts/load-test.mjs';

describe('the load test command line (scripts/load-test.mjs)', () => {
  it('defaults to the local preview and the public GET paths', () => {
    const options = parseLoadArgs([]) as LoadOptions;
    expect(options.base).toBe(DEFAULT_BASE);
    expect(options.paths).toEqual([...DEFAULT_PATHS]);
    expect(options.paths).toContain('/api/community/feed');
    expect([options.concurrency, options.duration]).toEqual([10, 10]);
  });

  it('reads a base URL and the options', () => {
    const options = parseLoadArgs(['http://127.0.0.1:4421/x', '--concurrency', '4', '--duration', '2.5', '--paths', '/,/api/live', '--p95-ms', '50', '--max-error-rate', '0']) as LoadOptions;
    expect(options).toMatchObject({ base: 'http://127.0.0.1:4421', concurrency: 4, duration: 2.5, paths: ['/', '/api/live'], p95Ms: 50, maxErrorRate: 0 });
  });

  it('refuses production unless --i-mean-production is passed', () => {
    for (const host of ['https://mobmachine.games', 'https://www.mobmachine.games', 'https://play.mobmachine.games', 'https://peanutgallery.games', 'https://some-site.netlify.app']) {
      expect(parseLoadArgs([host]), host).toEqual({ error: expect.stringContaining('refusing to load-test production') });
      expect((parseLoadArgs([host, '--i-mean-production']) as LoadOptions).production, host).toBe(true);
    }
    expect(isProductionHost('mobmachine.games.')).toBe(true);
    expect(isProductionHost('notmobmachine.games')).toBe(false);
    expect(isProductionHost('127.0.0.1:4173')).toBe(false);
  });

  it('is a usage error for a bad option, number, URL or path', () => {
    for (const argv of [['--nope'], ['--concurrency', '0'], ['--concurrency', '1.5'], ['--duration'], ['ftp://x'], ['http://u:p@localhost'], ['a', 'b'], ['--paths', 'api/live'], ['--paths', '//evil.example/'], ['--max-error-rate', '2']]) {
      expect('error' in parseLoadArgs(argv), argv.join(' ')).toBe(true);
    }
  });
});

describe('the figures', () => {
  it('takes percentiles by nearest rank', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i + 1);
    expect([percentile(sorted, 50), percentile(sorted, 95), percentile(sorted, 99), percentile([], 50), percentile([7], 99)]).toEqual([50, 95, 99, 0, 7]);
  });

  it('counts errors and names each threshold crossed', () => {
    const summary = summarize([
      { ms: 10, ok: true },
      { ms: 20, ok: true },
      { ms: 30, ok: false },
      { ms: 4000, ok: true },
    ]);
    expect(summary).toMatchObject({ requests: 4, errors: 1, errorRate: 0.25, p50: 20, max: 4000 });
    expect(breaches(summary, { p95Ms: 1000, p99Ms: 2000, maxErrorRate: 0.01 })).toHaveLength(3);
    expect(breaches(summarize([{ ms: 5, ok: true }]), { p95Ms: 1000, p99Ms: 2000, maxErrorRate: 0.01 })).toEqual([]);
    expect(breaches(summarize([]), { p95Ms: 1000, p99Ms: 2000, maxErrorRate: 0.01 })).toEqual(['no request completed']);
  });
});

describe('a short run against a local server', () => {
  let server: Server;
  let base = '';
  beforeAll(async () => {
    server = createServer((req, res) => {
      res.statusCode = req.url === '/broken' ? 500 : 200;
      res.end('ok');
    });
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((done) => server.close(() => done())));

  it('passes within the thresholds and fails over the error rate', async () => {
    const good = parseLoadArgs([base, '--duration', '0.3', '--concurrency', '3', '--paths', '/,/api/live']) as LoadOptions;
    const ran = await run(good);
    const ok = report(good, ran.results, ran.seconds);
    expect(ok.ok).toBe(true);
    expect(ok.lines[0]).toMatch(/^PASS load-test http:\/\/127\.0\.0\.1:\d+ requests=\d+ rps=[\d.]+ p50=[\d.]+ms p95=[\d.]+ms p99=[\d.]+ms errors=0 error_rate=0\.00%$/);
    const bad = parseLoadArgs([base, '--duration', '0.3', '--concurrency', '2', '--paths', '/,/broken']) as LoadOptions;
    const failed = await run(bad);
    const out = report(bad, failed.results, failed.seconds);
    expect(out.ok).toBe(false);
    expect(out.lines[0]).toMatch(/^FAIL /);
    expect(out.lines.some((line) => line.startsWith('error: /broken 500'))).toBe(true);
  });
});
