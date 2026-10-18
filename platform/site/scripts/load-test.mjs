#!/usr/bin/env node
// A load test for the public site's GET pages and documents (docs/specs/final-state.md, Scale): it
// keeps --concurrency requests in flight for --duration seconds against a base URL, cycling through
// the paths, then prints p50, p95 and p99 latency and the error rate, overall and per path, and exits
// 1 when a threshold is crossed. Dependency-free: Node's own fetch and timers.
//
//   node platform/site/scripts/load-test.mjs [baseUrl] [--concurrency 10] [--duration 10]
//     [--paths /,/api/live,...] [--p95-ms 1000] [--p99-ms 2000] [--max-error-rate 0.01]
//     [--timeout-ms 10000] [--i-mean-production]
//
// baseUrl defaults to http://127.0.0.1:4173 (vite preview). It refuses the production hosts (the
// studio's domains and any netlify.app address) unless --i-mean-production is passed: a load test
// there spends the studio's function and bandwidth allowance. Only GET is sent; nothing is written.
// Exit codes: 0 within thresholds, 1 over a threshold, 2 a usage error or a refused target.

import { pathToFileURL } from 'node:url';

export const DEFAULT_BASE = 'http://127.0.0.1:4173';
export const DEFAULT_PATHS = [
  '/',
  '/goals',
  '/seeds',
  '/studio/history',
  '/api/live',
  '/api/cards',
  '/api/community/feed',
  '/api/community/goals',
  '/api/community/studio',
  '/api/community/seeds?sort=trending',
];
export const DEFAULTS = { concurrency: 10, duration: 10, p95Ms: 1000, p99Ms: 2000, maxErrorRate: 0.01, timeoutMs: 10_000 };

const PRODUCTION = [/(^|\.)mobmachine\.games$/i, /(^|\.)peanutgallery\.games$/i, /\.netlify\.app$/i];

/** True for a host the studio serves its public site or games from. */
export function isProductionHost(host) {
  const name = String(host).replace(/:\d+$/, '').replace(/\.$/, '');
  return PRODUCTION.some((pattern) => pattern.test(name));
}

const NUMBERS = {
  '--concurrency': ['concurrency', (n) => Number.isInteger(n) && n >= 1 && n <= 1000],
  '--duration': ['duration', (n) => n > 0 && n <= 3600],
  '--p95-ms': ['p95Ms', (n) => n > 0],
  '--p99-ms': ['p99Ms', (n) => n > 0],
  '--max-error-rate': ['maxErrorRate', (n) => n >= 0 && n <= 1],
  '--timeout-ms': ['timeoutMs', (n) => n > 0],
};

/**
 * The command line, or { error } for a usage error or a refused target. Paths are GET paths on the
 * base URL's origin; an absolute URL or a path that leaves the origin is refused.
 */
export function parseLoadArgs(argv) {
  const options = { ...DEFAULTS, base: DEFAULT_BASE, paths: [...DEFAULT_PATHS], production: false };
  let base = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--i-mean-production') {
      options.production = true;
    } else if (arg === '--paths') {
      const value = argv[(i += 1)];
      if (value === undefined || value.trim() === '') return { error: '--paths needs a comma-separated list' };
      options.paths = value.split(',').map((path) => path.trim()).filter((path) => path !== '');
    } else if (Object.hasOwn(NUMBERS, arg)) {
      const [key, valid] = NUMBERS[arg];
      const value = Number(argv[(i += 1)]);
      if (!Number.isFinite(value) || !valid(value)) return { error: `${arg} needs a valid number` };
      options[key] = value;
    } else if (arg.startsWith('--')) {
      return { error: `unknown option ${arg}` };
    } else if (base === null) {
      base = arg;
    } else {
      return { error: `unexpected argument ${arg}` };
    }
  }
  let url;
  try {
    url = new URL(base ?? DEFAULT_BASE);
  } catch {
    return { error: `not a URL: ${base}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: 'the base URL must be http or https' };
  if (url.username !== '' || url.password !== '') return { error: 'the base URL must carry no credentials' };
  options.base = url.origin;
  for (const path of options.paths) {
    if (!path.startsWith('/') || path.startsWith('//')) return { error: `a path must start with one /: ${path}` };
  }
  if (isProductionHost(url.hostname) && !options.production) {
    return { error: `refusing to load-test production (${url.hostname}); pass --i-mean-production if you mean it` };
  }
  return options;
}

/** The q-th percentile (0 to 100) of sorted numbers, by nearest rank; 0 for none. */
export function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((q / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/** The figures for a set of results: [{ ms, ok }]. */
export function summarize(results) {
  const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok).length;
  return {
    requests: results.length,
    errors,
    errorRate: results.length === 0 ? 0 : errors / results.length,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
  };
}

/** The thresholds a summary crosses, as lines; empty when it is within all of them. */
export function breaches(summary, options) {
  const out = [];
  if (summary.requests === 0) out.push('no request completed');
  if (summary.p95 > options.p95Ms) out.push(`p95 ${summary.p95.toFixed(1)} ms is over ${options.p95Ms} ms`);
  if (summary.p99 > options.p99Ms) out.push(`p99 ${summary.p99.toFixed(1)} ms is over ${options.p99Ms} ms`);
  if (summary.errorRate > options.maxErrorRate) out.push(`error rate ${(summary.errorRate * 100).toFixed(2)}% is over ${(options.maxErrorRate * 100).toFixed(2)}%`);
  return out;
}

async function once(base, path, timeoutMs) {
  const started = performance.now();
  try {
    const response = await fetch(base + path, { headers: { Accept: path.startsWith('/api/') ? 'application/json' : 'text/html' }, redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    await response.arrayBuffer();
    return { path, ms: performance.now() - started, ok: response.status < 400, status: response.status };
  } catch (error) {
    return { path, ms: performance.now() - started, ok: false, status: error?.name === 'TimeoutError' ? 'timeout' : 'network' };
  }
}

/** Keeps `concurrency` requests in flight until the duration ends, cycling through the paths. */
export async function run(options) {
  const results = [];
  const deadline = performance.now() + options.duration * 1000;
  let next = 0;
  const worker = async () => {
    while (performance.now() < deadline) {
      const path = options.paths[next % options.paths.length];
      next += 1;
      results.push(await once(options.base, path, options.timeoutMs));
    }
  };
  const started = performance.now();
  await Promise.all(Array.from({ length: options.concurrency }, worker));
  return { results, seconds: (performance.now() - started) / 1000 };
}

function row(label, s) {
  return `${label.padEnd(40)} ${String(s.requests).padStart(7)} ${s.p50.toFixed(1).padStart(8)} ${s.p95.toFixed(1).padStart(8)} ${s.p99.toFixed(1).padStart(8)} ${(s.errorRate * 100).toFixed(2).padStart(7)}%`;
}

export function report(options, results, seconds) {
  const all = summarize(results);
  const over = breaches(all, options);
  const lines = [
    `${over.length === 0 ? 'PASS' : 'FAIL'} load-test ${options.base} requests=${all.requests} rps=${(all.requests / Math.max(seconds, 0.001)).toFixed(1)} p50=${all.p50.toFixed(1)}ms p95=${all.p95.toFixed(1)}ms p99=${all.p99.toFixed(1)}ms errors=${all.errors} error_rate=${(all.errorRate * 100).toFixed(2)}%`,
    `concurrency=${options.concurrency} duration=${options.duration}s thresholds: p95<=${options.p95Ms}ms p99<=${options.p99Ms}ms error_rate<=${(options.maxErrorRate * 100).toFixed(2)}%`,
    `${'path'.padEnd(40)} ${'reqs'.padStart(7)} ${'p50 ms'.padStart(8)} ${'p95 ms'.padStart(8)} ${'p99 ms'.padStart(8)} ${'errors'.padStart(8)}`,
  ];
  for (const path of options.paths) lines.push(row(path, summarize(results.filter((r) => r.path === path))));
  const statuses = {};
  for (const r of results) if (!r.ok) statuses[`${r.path} ${r.status}`] = (statuses[`${r.path} ${r.status}`] ?? 0) + 1;
  for (const [key, n] of Object.entries(statuses)) lines.push(`error: ${key} x${n}`);
  for (const line of over) lines.push(`over threshold: ${line}`);
  return { lines, ok: over.length === 0 };
}

async function main() {
  const options = parseLoadArgs(process.argv.slice(2));
  if ('error' in options) {
    console.error(`load-test: ${options.error}`);
    process.exit(2);
  }
  const { results, seconds } = await run(options);
  const { lines, ok } = report(options, results, seconds);
  console.log(lines.join('\n'));
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
