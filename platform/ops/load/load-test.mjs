#!/usr/bin/env node
// The stepped load test of the public read paths (docs/specs/load-test.md). Dependency-free: Node
// 22's own fetch and timers.
//
//   node platform/ops/load/load-test.mjs <baseUrl> [--profile site|static] [--play <url>]
//     [--rate 50] [--duration 120] [--steps 5:30,15:30,...] [--max-requests 3000]
//     [--card <uuid>] [--plan] [--json <file>] [--i-mean-production]
//     [--p95-ms 800] [--p99-ms 1800] [--max-error-rate 0.01] [--min-hit-ratio 0.8]
//     [--abort-error-rate 0.02] [--abort-p95-ms 2000] [--max-origin 200]
//
// It sends GET requests at a fixed arrival rate (open loop: a slow answer does not slow the next
// request), in steps that climb to --rate: 10%, 30%, 60% and 100% of it, each held a quarter of
// --duration, unless --steps names them. The mix weights the static pages (home, a page route, the
// page's script, the game's page) over the Netlify Functions, and caps each function group below its
// per-address rate-limit rule, so the run reaches Supabase only when a cached document expires.
// It never sends anything but GET, and only to the paths in TARGETS below: no write path, no
// checkout, no sign-in.
//
// It aborts at once, and says why, when a step's error rate passes --abort-error-rate or its p95
// passes --abort-p95-ms, or when more function answers than --max-origin came from the function
// rather than the cache; it never sends more than --max-requests. At the end it prints p50, p95 and
// p99 latency, the error rate, the throughput and the cache hit ratio (the Cache-Status header) per
// step and per path, and fails on the thresholds in THRESHOLDS (their sources are in the spec).
//
// Production hosts are refused unless --i-mean-production is passed. The first output line is PASS,
// FAIL or ABORTED with the totals. Exit 0 pass, 1 fail or abort, 2 a usage error or refused target.

import { writeFileSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

export const PRODUCTION_BASE = 'https://mobmachine.games';
export const PRODUCTION_PLAY = 'https://play.mobmachine.games';
const PRODUCTION = [/(^|\.)mobmachine\.games$/i, /(^|\.)peanutgallery\.games$/i, /\.netlify\.app$/i];

/** True for a host the studio serves its public site or games from. */
export function isProductionHost(host) {
  const name = String(host).replace(/:\d+$/, '').replace(/\.$/, '');
  return PRODUCTION.some((pattern) => pattern.test(name));
}

/**
 * Pass/fail thresholds (docs/specs/load-test.md, Thresholds):
 * - maxErrorRate: docs/strategy/benchmarks.md §2, Site error rate, the floor (1%); the 0.1% target
 *   is printed as a note.
 * - minHitRatio: benchmarks.md §7, Edge cache hit rate, the floor (80%) over the cached documents;
 *   the 95% target is printed as a note.
 * - p95Ms, p99Ms: benchmarks.md §8 sets LCP at 2.5 s; the server's share of it is the response time,
 *   held to web.dev's "good" Time to First Byte (800 ms) at p95 and its "poor" line (1.8 s) at p99.
 * Abort conditions (the run stops at once): a step's error rate over 2% or p95 over 2 s, or more
 * than maxOrigin function answers served by the function instead of the cache.
 */
export const THRESHOLDS = {
  maxErrorRate: 0.01,
  targetErrorRate: 0.001,
  minHitRatio: 0.8,
  targetHitRatio: 0.95,
  p95Ms: 800,
  p99Ms: 1800,
  abortErrorRate: 0.02,
  abortP95Ms: 2000,
  maxOrigin: 200,
};

export const DEFAULTS = {
  ...THRESHOLDS,
  profile: 'site',
  rate: 50,
  duration: 120,
  maxRequests: 3000,
  timeoutMs: 10_000,
  maxInFlight: 200,
  minSamples: 50,
};

/** The ceilings a production run may not pass, whatever the inputs. */
export const PRODUCTION_LIMITS = { rate: 100, duration: 300, maxRequests: 10_000 };

/** The fractions of --rate each default step runs at. */
export const STEP_FRACTIONS = [0.1, 0.3, 0.6, 1];

/**
 * Requests per second each capped group may take, kept well under the per-address rules the site's
 * functions set (netlify/functions/snapshot.mts and card.mts: 300 a minute per IP, so 5 a second):
 * the load test runs from one address and must never be the reason a rule answers 429.
 * - snapshot: /api/live, /api/cards and /api/reports share snapshot.mts's rule.
 * - card: /api/card/<id>, its preview.png and the /card/<id> page (whose edge function reads
 *   /api/card/<id>) share card.mts's rule.
 * - community: the /api/community documents have no rule; capped so Supabase sees few builds.
 * - feed: /feed.xml has no rule; two RPCs per build.
 */
export const GROUP_CAPS = { snapshot: 3, card: 3, community: 4, feed: 1 };

/**
 * The paths the run reads. kind: static (a file the CDN serves), edge (an edge function in front of a
 * cached document) or function (a Netlify Function in front of Supabase). type: what the answer's
 * Content-Type must hold, so a page served in place of a document (a missing function falls through
 * to the page rewrite with a 200) counts as an error. seconds: the document's s-maxage; rpcs:
 * Supabase calls per build. Only GET, only these.
 */
export function targetsFor({ profile, base, play, card, asset }) {
  const site = [
    { name: '/', url: `${base}/`, weight: 30, kind: 'static', type: 'text/html' },
    { name: '/how-it-works', url: `${base}/how-it-works`, weight: 8, kind: 'static', type: 'text/html' },
  ];
  if (asset) site.push({ name: '/assets/<home script>', url: `${base}${asset}`, weight: 15, kind: 'static', type: 'javascript' });
  if (profile === 'static') {
    site.push({ name: '/version.json', url: `${base}/version.json`, weight: 3, kind: 'static', type: 'application/json' });
    site.push({ name: '/og.png', url: `${base}/og.png`, weight: 2, kind: 'static', type: 'image/png' });
  }
  if (play) site.push({ name: 'play /', url: `${play}/`, weight: 17, kind: 'static', type: 'text/html' });
  if (profile === 'static') return site;
  const doc = (name, weight, group, seconds, rpcs, type = 'application/json', kind = 'function') => ({ name, url: `${base}${name}`, weight, kind, type, group, seconds, rpcs });
  const out = [
    ...site,
    doc('/api/live', 3, 'snapshot', 60, 1),
    doc('/api/cards', 2, 'snapshot', 300, 1),
    doc('/api/reports', 1, 'snapshot', 3600, 1),
    doc('/feed.xml', 1, 'feed', 120, 2, 'application/atom+xml'),
    doc('/api/community/feed', 2, 'community', 5, 1),
    doc('/api/community/goals', 1, 'community', 30, 1),
    doc('/api/community/studio', 1, 'community', 30, 1),
    doc('/api/community/seeds?sort=trending', 1, 'community', 15, 1),
    doc('/api/community/suggestions?sort=top', 1, 'community', 15, 1),
  ];
  if (card) {
    out.push({ ...doc(`/card/${card}`, 2, 'card', 60, 0, 'text/html', 'edge'), name: '/card/<id>' });
    out.push({ ...doc(`/api/card/${card}`, 1, 'card', 60, 1), name: '/api/card/<id>' });
    out.push({ ...doc(`/api/card/${card}/preview.png`, 1, 'card', 600, 1, 'image/png'), name: '/api/card/<id>/preview.png' });
  }
  return out;
}

/**
 * Splits a step's rate across the targets by weight, holding each group at or under its cap and
 * giving what a capped group cannot take to the uncapped targets. Returns rates per target name.
 */
export function allocate(rate, targets, caps = GROUP_CAPS) {
  const rates = Object.fromEntries(targets.map((t) => [t.name, 0]));
  let open = targets.slice();
  let remaining = rate;
  // Each round either fits every open target or fills at least one group to its cap and closes it.
  while (open.length > 0 && remaining > 1e-9) {
    const weight = open.reduce((sum, t) => sum + t.weight, 0);
    if (weight <= 0) break;
    const share = (t) => (remaining * t.weight) / weight;
    const groups = new Set(open.map((t) => t.group).filter((g) => g !== undefined && caps[g] !== undefined));
    const over = [...groups].filter((g) => open.filter((t) => t.group === g).reduce((sum, t) => sum + share(t), 0) > caps[g] + 1e-9);
    if (over.length === 0) {
      for (const t of open) rates[t.name] += share(t);
      break;
    }
    for (const group of over) {
      const members = open.filter((t) => t.group === group);
      const groupWeight = members.reduce((sum, t) => sum + t.weight, 0);
      for (const t of members) rates[t.name] = (caps[group] * t.weight) / groupWeight;
      remaining -= caps[group];
    }
    open = open.filter((t) => !over.includes(t.group));
  }
  return rates;
}

/** The steps: an explicit "rate:seconds,..." list, or STEP_FRACTIONS of rate over duration. */
export function stepsFor({ rate, duration, steps }) {
  if (steps) return steps;
  const seconds = duration / STEP_FRACTIONS.length;
  return STEP_FRACTIONS.map((f) => ({ rate: Math.max(1, Math.round(rate * f)), seconds }));
}

/**
 * The plan: per step and per target, the rate and the request count; the total; and the Supabase
 * calls the run can cause. With the CDN working, a document is built at most once per s-maxage
 * window (Netlify's durable cache is shared by every edge node), plus once more for the window the
 * run starts in; with no cache at all, every function request is a build.
 */
export function plan(targets, steps, caps = GROUP_CAPS) {
  // As run() sends them: each target's requests are its rate's running total, rounded down.
  const sum = Object.fromEntries(targets.map((t) => [t.name, 0]));
  const perStep = steps.map((step) => {
    const rates = allocate(step.rate, targets, caps);
    const counts = {};
    for (const t of targets) {
      const before = Math.floor(sum[t.name] + 1e-9);
      sum[t.name] += rates[t.name] * step.seconds;
      counts[t.name] = Math.floor(sum[t.name] + 1e-9) - before;
    }
    return { ...step, rates, counts, requests: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
  const seconds = steps.reduce((sum, s) => sum + s.seconds, 0);
  const requests = perStep.reduce((sum, s) => sum + s.requests, 0);
  const byTarget = targets.map((t) => {
    const count = perStep.reduce((sum, s) => sum + s.counts[t.name], 0);
    const builds = t.seconds === undefined ? 0 : Math.min(count, Math.ceil(seconds / t.seconds) + 1);
    return { name: t.name, kind: t.kind, requests: count, cachedRpcs: builds * (t.rpcs ?? 0), uncachedRpcs: count * (t.rpcs ?? 0) };
  });
  const functionRequests = byTarget.filter((t) => t.kind !== 'static').reduce((sum, t) => sum + t.requests, 0);
  return {
    steps: perStep,
    seconds,
    requests,
    functionRequests,
    byTarget,
    supabaseCached: byTarget.reduce((sum, t) => sum + t.cachedRpcs, 0),
    supabaseUncached: byTarget.reduce((sum, t) => sum + t.uncachedRpcs, 0),
  };
}

/**
 * A Cache-Status header (RFC 9211) as Netlify sends it, e.g. `"Netlify Edge"; hit` or
 * `"Netlify Durable"; fwd=miss; stored, "Netlify Edge"; fwd=miss`. Returns hit (some cache answered
 * fresh), stale (some cache answered stale and revalidates in the background), miss (the function
 * or origin answered), or none (no header: a local server).
 */
export function cacheResult(header) {
  if (header === null || header === undefined || String(header).trim() === '') return 'none';
  let stale = false;
  let hit = false;
  for (const member of String(header).split(',')) {
    const params = member.split(';').slice(1).map((p) => p.trim().toLowerCase());
    if (params.includes('hit')) {
      hit = true;
      if (params.includes('fwd=stale')) stale = true;
    }
  }
  if (stale) return 'stale';
  return hit ? 'hit' : 'miss';
}

/** The q-th percentile (0 to 100) of sorted numbers, by nearest rank; 0 for none. */
export function percentile(sorted, q) {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((q / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * The figures for a set of results ([{ ms, ok, status, cache, kind }]) over `seconds`. The hit
 * ratio counts hit and stale as served by the cache, over the answers that carried a Cache-Status
 * (null when none did); originRatio is the share of function and edge answers the function built.
 */
export function summarize(results, seconds = 0) {
  const sorted = results.map((r) => r.ms).sort((a, b) => a - b);
  const errors = results.filter((r) => !r.ok).length;
  const withCache = results.filter((r) => r.cache !== undefined && r.cache !== 'none');
  const served = withCache.filter((r) => r.cache === 'hit' || r.cache === 'stale').length;
  return {
    requests: results.length,
    errors,
    errorRate: results.length === 0 ? 0 : errors / results.length,
    rateLimited: results.filter((r) => r.status === 429).length,
    rps: seconds > 0 ? results.length / seconds : 0,
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.length === 0 ? 0 : sorted[sorted.length - 1],
    hitRatio: withCache.length === 0 ? null : served / withCache.length,
    misses: withCache.filter((r) => r.cache === 'miss').length,
    stale: withCache.filter((r) => r.cache === 'stale').length,
  };
}

/** True when a result's answer counts as served by the function rather than the cache. */
export function fromOrigin(result, production) {
  if (result.kind !== 'function') return false;
  if (result.cache === 'miss') return true;
  // In production a function answer with no Cache-Status cannot be shown to be cached.
  return production && result.cache === 'none' && result.ok;
}

/** Why the run must stop now, or null: checked on the current step's completed results. */
export function abortReason(stepResults, allResults, options) {
  const step = summarize(stepResults);
  if (step.requests >= options.minSamples) {
    if (step.errorRate > options.abortErrorRate) {
      return `step error rate ${(step.errorRate * 100).toFixed(2)}% over ${(options.abortErrorRate * 100).toFixed(2)}% after ${step.requests} requests`;
    }
    if (step.p95 > options.abortP95Ms) return `step p95 ${step.p95.toFixed(0)} ms over ${options.abortP95Ms} ms after ${step.requests} requests`;
  }
  if (options.maxOrigin > 0) {
    const origin = allResults.filter((r) => fromOrigin(r, options.production)).length;
    if (origin > options.maxOrigin) return `${origin} function answers came from the function, not the cache (limit ${options.maxOrigin})`;
  }
  return null;
}

/** The pass/fail lines for the whole run; empty when every threshold holds. */
export function breaches(all, cached, options) {
  const out = [];
  if (all.requests === 0) out.push('no request completed');
  if (all.errorRate > options.maxErrorRate) out.push(`error rate ${(all.errorRate * 100).toFixed(2)}% over ${(options.maxErrorRate * 100).toFixed(2)}%`);
  if (all.p95 > options.p95Ms) out.push(`p95 ${all.p95.toFixed(0)} ms over ${options.p95Ms} ms`);
  if (all.p99 > options.p99Ms) out.push(`p99 ${all.p99.toFixed(0)} ms over ${options.p99Ms} ms`);
  if (cached !== null && cached.requests > 0) {
    if (cached.hitRatio === null) {
      if (options.production) out.push('no cached document carried a Cache-Status header');
    } else if (cached.hitRatio < options.minHitRatio) {
      out.push(`cache hit ratio ${(cached.hitRatio * 100).toFixed(1)}% under ${(options.minHitRatio * 100).toFixed(0)}% on the cached documents`);
    }
  }
  return out;
}

const NUMBERS = {
  '--rate': ['rate', (n) => n > 0 && n <= 1000],
  '--duration': ['duration', (n) => n > 0 && n <= 3600],
  '--max-requests': ['maxRequests', (n) => Number.isInteger(n) && n >= 1],
  '--p95-ms': ['p95Ms', (n) => n > 0],
  '--p99-ms': ['p99Ms', (n) => n > 0],
  '--max-error-rate': ['maxErrorRate', (n) => n >= 0 && n <= 1],
  '--min-hit-ratio': ['minHitRatio', (n) => n >= 0 && n <= 1],
  '--abort-error-rate': ['abortErrorRate', (n) => n >= 0 && n <= 1],
  '--abort-p95-ms': ['abortP95Ms', (n) => n > 0],
  '--max-origin': ['maxOrigin', (n) => Number.isInteger(n) && n >= 0],
  '--timeout-ms': ['timeoutMs', (n) => n > 0 && n <= 60_000],
  '--max-in-flight': ['maxInFlight', (n) => Number.isInteger(n) && n >= 1 && n <= 2000],
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function origin(value, label) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { error: `${label} is not a URL: ${value}` };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { error: `${label} must be http or https` };
  if (url.username !== '' || url.password !== '') return { error: `${label} must carry no credentials` };
  return { url };
}

/** The command line, or { error } for a usage error or a refused target. */
export function parseArgs(argv) {
  const options = { ...DEFAULTS, base: null, play: undefined, card: null, steps: null, planOnly: false, json: null, production: false, iMeanProduction: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => argv[(i += 1)];
    if (arg === '--i-mean-production') options.iMeanProduction = true;
    else if (arg === '--plan') options.planOnly = true;
    else if (arg === '--profile') {
      options.profile = value();
      if (options.profile !== 'site' && options.profile !== 'static') return { error: '--profile is site or static' };
    } else if (arg === '--play') {
      options.play = value() ?? '';
    } else if (arg === '--card') {
      options.card = value() ?? '';
      if (!UUID.test(options.card)) return { error: '--card needs a card id (a uuid)' };
    } else if (arg === '--json') {
      options.json = value();
      if (!options.json) return { error: '--json needs a file' };
    } else if (arg === '--steps') {
      const list = (value() ?? '').split(',').filter((s) => s.trim() !== '');
      const steps = list.map((s) => s.split(':').map(Number));
      if (steps.length === 0 || steps.some(([r, s, extra]) => !(r > 0) || !(s > 0) || extra !== undefined)) return { error: '--steps needs rate:seconds pairs, e.g. 5:30,15:30' };
      options.steps = steps.map(([rate, seconds]) => ({ rate, seconds }));
    } else if (Object.hasOwn(NUMBERS, arg)) {
      const [key, valid] = NUMBERS[arg];
      const n = Number(value());
      if (!Number.isFinite(n) || !valid(n)) return { error: `${arg} needs a valid number` };
      options[key] = n;
    } else if (arg.startsWith('--')) return { error: `unknown option ${arg}` };
    else if (options.base === null) options.base = arg;
    else return { error: `unexpected argument ${arg}` };
  }
  if (options.base === null) return { error: 'name the base URL, e.g. http://127.0.0.1:4430' };
  const base = origin(options.base, 'the base URL');
  if ('error' in base) return base;
  options.base = base.url.origin;
  if (options.play === undefined) options.play = isProductionHost(base.url.hostname) ? PRODUCTION_PLAY : '';
  let playHost = null;
  if (options.play !== '') {
    const play = origin(options.play, '--play');
    if ('error' in play) return play;
    options.play = play.url.origin;
    playHost = play.url.hostname;
  }
  options.production = isProductionHost(base.url.hostname) || (playHost !== null && isProductionHost(playHost));
  if (options.production && !options.iMeanProduction) {
    return { error: `refusing to load-test production (${base.url.hostname}); pass --i-mean-production if you mean it` };
  }
  options.steps = stepsFor(options);
  if (options.production) {
    const peak = Math.max(...options.steps.map((s) => s.rate));
    const seconds = options.steps.reduce((sum, s) => sum + s.seconds, 0);
    if (peak > PRODUCTION_LIMITS.rate) return { error: `a production run peaks at ${PRODUCTION_LIMITS.rate} requests a second at most` };
    if (seconds > PRODUCTION_LIMITS.duration) return { error: `a production run lasts ${PRODUCTION_LIMITS.duration} seconds at most` };
    if (options.maxRequests > PRODUCTION_LIMITS.maxRequests) return { error: `a production run sends ${PRODUCTION_LIMITS.maxRequests} requests at most` };
  } else if (!argv.includes('--max-origin')) {
    // A local server sends no Cache-Status, so the origin budget only guards production.
    options.maxOrigin = 0;
  }
  return options;
}

const ACCEPT = { static: 'text/html,*/*', edge: 'text/html', function: 'application/json,*/*' };

async function once(target, timeoutMs) {
  const started = performance.now();
  try {
    const response = await fetch(target.url, {
      headers: { Accept: ACCEPT[target.kind], 'User-Agent': 'mob-machine-load-test (docs/specs/load-test.md)' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await response.arrayBuffer();
    const cache = cacheResult(response.headers.get('cache-status'));
    const ms = performance.now() - started;
    if (response.status >= 400) return { ms, ok: false, status: response.status, cache };
    // A 3xx is a wrong answer for every target here: each is the address a visitor's page reads.
    if (response.status >= 300) return { ms, ok: false, status: response.status, cache };
    const type = response.headers.get('content-type') ?? '';
    if (target.type && !type.includes(target.type)) return { ms, ok: false, status: `${response.status} ${type.split(';')[0] || 'no type'}`, cache };
    return { ms, ok: true, status: response.status, cache };
  } catch (error) {
    return { ms: performance.now() - started, ok: false, status: error?.name === 'TimeoutError' ? 'timeout' : 'network', cache: 'none' };
  }
}

/**
 * Before the run: the newest live card's id from /api/live (one read, unless --card names one) and
 * the home page's script, so the mix reads what a visitor's page load reads.
 */
export async function discover(options) {
  const found = { card: options.card, asset: null };
  try {
    const html = await (await fetch(`${options.base}/`, { signal: AbortSignal.timeout(options.timeoutMs) })).text();
    found.asset = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1] ?? null;
  } catch {
    found.asset = null;
  }
  if (found.card === null && options.profile === 'site') {
    try {
      const live = await (await fetch(`${options.base}/api/live`, { signal: AbortSignal.timeout(options.timeoutMs) })).json();
      const cards = Object.entries(live?.cards ?? {});
      const shipped = cards.filter(([, c]) => c?.stage === 'live' && typeof c.live_at === 'string').sort((a, b) => b[1].live_at.localeCompare(a[1].live_at));
      const id = (shipped[0] ?? cards[0])?.[0] ?? null;
      found.card = id !== null && UUID.test(id) ? id : null;
    } catch {
      found.card = null;
    }
  }
  return found;
}

/**
 * Runs the steps: each tick hands every target the requests its rate has earned, sends them without
 * waiting for earlier answers, and checks the stop conditions once a second.
 */
export async function run(options, targets, { tickMs = 20, log = () => {} } = {}) {
  const results = [];
  const stepTimes = [];
  let sent = 0;
  let inFlight = 0;
  let dropped = 0;
  let stop = null;
  const pending = new Set();
  const byName = new Map(targets.map((t) => [t.name, t]));
  // Each target's credit carries across steps, so its requests are its rate's running total rounded
  // down, as plan() counts them.
  const credit = Object.fromEntries(targets.map((t) => [t.name, 0]));
  for (const [index, step] of options.steps.entries()) {
    if (stop !== null) break;
    const rates = allocate(step.rate, targets);
    const stepResults = [];
    const started = performance.now();
    const ends = started + step.seconds * 1000;
    let last = started;
    let lastCheck = started;
    log(`step ${index + 1}/${options.steps.length}: ${step.rate} req/s for ${step.seconds}s`);
    while (stop === null) {
      const now = Math.min(performance.now(), ends);
      const dt = (now - last) / 1000;
      last = now;
      for (const [name, rate] of Object.entries(rates)) {
        credit[name] += rate * dt;
        while (credit[name] >= 1 - 1e-9 && stop === null) {
          credit[name] -= 1;
          if (sent >= options.maxRequests) {
            stop = { aborted: false, reason: `request cap of ${options.maxRequests} reached` };
            break;
          }
          if (inFlight >= options.maxInFlight) {
            dropped += 1;
            continue;
          }
          sent += 1;
          inFlight += 1;
          const target = byName.get(name);
          const promise = once(target, options.timeoutMs).then((r) => {
            inFlight -= 1;
            const result = { ...r, path: name, kind: target.kind, group: target.group, step: index };
            results.push(result);
            stepResults.push(result);
          });
          pending.add(promise);
          promise.finally(() => pending.delete(promise));
        }
      }
      if (stop === null && now - lastCheck >= 1000) {
        lastCheck = now;
        const reason = abortReason(stepResults, results, options);
        if (reason !== null) stop = { aborted: true, reason };
      }
      if (now >= ends || stop !== null) break;
      await wait(tickMs);
    }
    stepTimes.push({ ...step, index, actualSeconds: (Math.min(performance.now(), ends) - started) / 1000 });
  }
  // Let the requests already sent finish, so their answers count.
  await Promise.allSettled([...pending]);
  return { results, stepTimes, sent, dropped, stop };
}

const pct = (n) => (n === null ? 'n/a' : `${(n * 100).toFixed(1)}%`);

function row(label, s) {
  return `${label.padEnd(36)} ${String(s.requests).padStart(6)} ${s.rps.toFixed(1).padStart(6)} ${s.p50.toFixed(0).padStart(6)} ${s.p95.toFixed(0).padStart(6)} ${s.p99.toFixed(0).padStart(6)} ${pct(s.errorRate).padStart(7)} ${pct(s.hitRatio).padStart(7)}`;
}

const HEADER = `${'path'.padEnd(36)} ${'reqs'.padStart(6)} ${'rps'.padStart(6)} ${'p50'.padStart(6)} ${'p95'.padStart(6)} ${'p99'.padStart(6)} ${'errors'.padStart(7)} ${'cache'.padStart(7)}`;

/** The report: the verdict line first, then the thresholds, the steps, the paths and Supabase. */
export function report(options, targets, outcome) {
  const { results, stepTimes, dropped, stop } = outcome;
  const seconds = stepTimes.reduce((sum, s) => sum + s.actualSeconds, 0);
  const all = summarize(results, seconds);
  // The cached documents (benchmarks §7): the function paths; the edge page runs on every request.
  const cachedResults = results.filter((r) => r.kind === 'function');
  const cached = cachedResults.length === 0 ? null : summarize(cachedResults, seconds);
  const over = breaches(all, cached, options);
  const verdict = stop?.aborted ? 'ABORTED' : over.length === 0 ? 'PASS' : 'FAIL';
  const origin = results.filter((r) => fromOrigin(r, options.production)).length;
  const builds = results.filter((r) => r.kind === 'function' && (r.cache === 'miss' || r.cache === 'stale'));
  const rpcs = builds.reduce((sum, r) => sum + (targets.find((t) => t.name === r.path)?.rpcs ?? 0), 0);
  const lines = [
    `${verdict} load-test ${options.base} requests=${all.requests} rps=${all.rps.toFixed(1)} p50=${all.p50.toFixed(0)}ms p95=${all.p95.toFixed(0)}ms p99=${all.p99.toFixed(0)}ms error_rate=${pct(all.errorRate)} cache_hit=${pct(cached?.hitRatio ?? null)}`,
    `thresholds: error_rate<=${pct(options.maxErrorRate)} (benchmarks.md section 2 floor; target ${pct(THRESHOLDS.targetErrorRate)}) p95<=${options.p95Ms}ms p99<=${options.p99Ms}ms (TTFB good/poor under the benchmarks.md section 8 LCP target) cache_hit>=${pct(options.minHitRatio)} on cached documents (benchmarks.md section 7 floor; target ${pct(THRESHOLDS.targetHitRatio)})`,
    `abort: step error_rate>${pct(options.abortErrorRate)} or step p95>${options.abortP95Ms}ms (after ${options.minSamples} requests), function answers from origin>${options.maxOrigin === 0 ? 'off' : options.maxOrigin}, cap ${options.maxRequests} requests`,
  ];
  if (stop !== null) lines.push(`stopped: ${stop.reason}`);
  if (dropped > 0) lines.push(`client saturated: ${dropped} requests not sent (over ${options.maxInFlight} in flight)`);
  lines.push('', 'per step (ms; cache = hit ratio over answers with a Cache-Status)', HEADER.replace('path'.padEnd(36), 'step'.padEnd(36)));
  for (const step of stepTimes) {
    lines.push(row(`${step.index + 1}: ${step.rate} req/s x ${step.seconds}s`, summarize(results.filter((r) => r.step === step.index), step.actualSeconds)));
  }
  lines.push('', 'per path', HEADER);
  for (const target of targets) lines.push(row(`${target.name}${target.kind === 'static' ? '' : ` [${target.kind}]`}`, summarize(results.filter((r) => r.path === target.name), seconds)));
  if (cached !== null) lines.push(row('all function paths (cached documents)', cached));
  lines.push(row('all paths', all));
  const failures = {};
  for (const r of results) if (!r.ok) failures[`${r.path} ${r.status}`] = (failures[`${r.path} ${r.status}`] ?? 0) + 1;
  if (Object.keys(failures).length > 0) lines.push('');
  for (const [key, n] of Object.entries(failures)) lines.push(`error: ${key} x${n}`);
  if (all.rateLimited > 0) lines.push(`rate limited (429): ${all.rateLimited}`);
  lines.push('', `supabase: ${builds.length} function answers were built or revalidated (miss ${cached?.misses ?? 0}, stale ${cached?.stale ?? 0}), so at most ${rpcs} RPC calls; ${origin} counted against the origin budget`);
  for (const line of over) lines.push(`over threshold: ${line}`);
  const summary = { verdict, base: options.base, play: options.play, steps: options.steps, all, cached, stop, dropped, origin, rpcs, breaches: over };
  return { lines, ok: verdict === 'PASS', summary };
}

/** The plan as lines, for --plan and the start of every run. */
export function planLines(options, targets) {
  const p = plan(targets, options.steps);
  const lines = [
    `plan: ${p.steps.map((s) => `${s.rate} req/s x ${s.seconds}s`).join(' -> ')} = ${p.requests} requests over ${p.seconds}s (cap ${options.maxRequests})`,
    `plan: ${p.functionRequests} function or edge requests (${pct(p.requests === 0 ? 0 : p.functionRequests / p.requests)}); Supabase RPC calls at most ${p.supabaseCached} with the CDN working, ${p.supabaseUncached} if nothing were cached`,
  ];
  for (const t of p.byTarget) lines.push(`plan: ${t.name.padEnd(36)} ${String(t.requests).padStart(5)} requests  peak ${p.steps.at(-1).rates[t.name].toFixed(2)} req/s`);
  return { lines, plan: p };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if ('error' in options) {
    console.error(`load-test: ${options.error}`);
    process.exit(2);
  }
  const found = await discover(options);
  const targets = targetsFor({ ...options, card: found.card, asset: found.asset });
  const planned = planLines(options, targets);
  if (options.profile === 'site' && found.card === null) planned.lines.push('plan: no card id found in /api/live; the card paths are left out');
  if (options.planOnly) {
    console.log(planned.lines.join('\n'));
    return;
  }
  console.error(planned.lines.join('\n'));
  const outcome = await run(options, targets, { log: (line) => console.error(line) });
  const { lines, ok, summary } = report(options, targets, outcome);
  console.log(lines.join('\n'));
  if (options.json) writeFileSync(options.json, `${JSON.stringify({ ...summary, plan: planned.plan }, null, 2)}\n`);
  process.exit(ok ? 0 : 1);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
