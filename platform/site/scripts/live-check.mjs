// Checks a running copy of the site the way a first-time visitor meets it.
//
// usage: node platform/site/scripts/live-check.mjs [baseUrl] [--allow-no-data]
//        pnpm --filter @backseat/site exec node scripts/live-check.mjs [baseUrl] [--allow-no-data]
//
// baseUrl defaults to https://peanutgallery.games. Both forms work: the @playwright/test import
// resolves from this file's folder, so the working directory does not matter.
//
// Every route (the landing, contribute, ledger, how it works, the team, the roadmap, the four text
// pages, Terms and Refunds version 1, and a missing page) at 375px and 1440px: status 200, one h1, no horizontal overflow, the
// bands in order (the top bar and band 1 on signal, band 2 on paper, then ink and paper in turn),
// no dead space (scripts/layout-audit.mjs, the same checks as the layout balance e2e test), the
// footer's Terms, Privacy, Refunds and Contact links, no console errors and no Content Security
// Policy report. The landing's h2 order, read from the page: Building now, the team, Shipped and
// Planned next appear only when there is something to show. The status line, the pool figure, the
// shipped rows, the fund links, the category filters and /contribute's choices. /how-it-works carries no Payment Link and no client_reference_id; /team
// draws every agent, runs at least one, shows claude-opus-5-5 on each that runs and no model on the
// rest; /roadmap shows no bar and no fund link. Every Payment Link on home and /contribute carries the
// agreement (the Terms, the Refunds page and the age condition), and /terms shows the newest version
// in /api/cards' terms since it took effect, lists the earlier ones and answers the next number
// with the not found page (docs/specs/legal-copy.md). /contribute's Fund the next card in line is first
// and names the next card in line (the first card choice) or says the money waits; /ledger shows
// exactly one reconciliation line, and its received figure (or "No contributions yet.") matches
// /api/live's money; while /api/live's studio says the agents are paused for awaiting_credit, home
// and /contribute say the payout sentence (docs/specs/money-surfaces.md).
//
// The site's own documents (docs/specs/site-snapshot.md): no page requests the Supabase host or opens
// a WebSocket, on any route; /api/live answers 200 JSON with every key in snapshot-keys.json and a
// browser Cache-Control of max-age=0, a second read within 60 seconds is a CDN hit (production),
// /api/cards answers 200, /api/live?x=1 answers 400, and one /assets/*.js is immutable.
// Assets, og:image as an absolute URL, and
// /og.png as a 200 image/png of 1200x630. /board is the not found page, a 404 from Netlify, with no
// sign-in form and no netlify.app address but the game's (board-address.mjs); with BOARD_SITE_URL
// set, no route names the board site's address. The www redirect runs only against production. The
// security headers from netlify.toml, the enforced and report-only policies' full values included,
// run against any address that is not local; a local `vite preview` sends them too
// (vite.config.ts), so they are checked there when present.
//
// frame-ancestors, connect-src and form-action are enforced; the rest of the policy is report-only and blocks
// nothing, so the only sign it would break the site is a report. Every page listens for
// securitypolicyviolation, which fires for enforced and report-only policies alike, and any report
// fails the run whatever the console printed (docs/specs/site-truth-pass.md, docs/specs/launch-site.md).
//
// The data checks need the site's /api documents. A local `vite preview` has no Netlify Function, so
// it has none; --allow-no-data turns those checks into SKIP lines instead of failures.
//
// The first line is PASS or FAIL with the counts; one line per check follows. Exit 0 pass, 1 fail.

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { boardHostFrom, playHostFrom, strayNetlifyHosts } from './board-address.mjs';
import { auditLayout, LIMITS } from './layout-audit.mjs';
import { runningModelsCheck } from './team-models.mjs';

const PRODUCTION = 'https://peanutgallery.games';
// The Supabase host the snapshot function reads (netlify/lib/public-env.ts). No page may request it.
const SUPABASE_HOST = new URL(
  readFileSync(new URL('../netlify/lib/public-env.ts', import.meta.url), 'utf8').match(/SUPABASE_URL = '([^']+)'/)?.[1] ?? 'https://invalid.supabase.co',
).host;
// The keys each document must carry (docs/specs/site-snapshot.md).
const SNAPSHOT_KEYS = JSON.parse(readFileSync(new URL('../src/lib/snapshot-keys.json', import.meta.url), 'utf8'));
const AGREEMENT_TOKENS = ['/terms', '/refunds'];
// The game's netlify.app host, which every page's top bar links to, from the netlify.toml the site is
// built with; and the board site's host, from BOARD_SITE_URL in the environment when it is set (the
// address lives in .env and never in the repository). No page may name any other netlify.app host,
// nor the board site's (docs/specs/board-site.md).
const PLAY_HOST = playHostFrom(readFileSync(new URL('../netlify.toml', import.meta.url), 'utf8'));
const BOARD_HOST = boardHostFrom(process.env.BOARD_SITE_URL);
const args = process.argv.slice(2);
const allowNoData = args.includes('--allow-no-data');
const BASE = (args.find((arg) => !arg.startsWith('--')) ?? PRODUCTION).replace(/\/+$/, '');

const ROUTES = [
  '/',
  '/contribute',
  '/ledger',
  '/how-it-works',
  '/team',
  '/roadmap',
  '/terms',
  '/terms/1',
  '/privacy',
  '/refunds',
  '/refunds/1',
  '/contact',
  '/no-such-page',
];
const FOOTER_LINKS = [
  ['Terms', '/terms'],
  ['Privacy', '/privacy'],
  ['Refunds', '/refunds'],
  ['Contact', '/contact'],
];
const H2_ORDER = ['Building now', "Fund what's next", 'Queued', 'The team', 'Shipped', 'Planned next', 'Where the money goes'];
const OPTIONAL_H2 = new Set(['Building now', 'The team', 'Shipped', 'Planned next']);
// The grounds, as computed colours: band 1 and the top bar signal, band 2 paper, then ink and paper.
const SIGNAL = 'rgb(26, 47, 200)';
const PAPER = 'rgb(255, 255, 255)';
const INK = 'rgb(17, 17, 17)';
// The status line: the open and building counts, then while paused the paused sentence
// (PausedNotice.tsx pausedSentence, the same sentence as the paused notice).
const STATUS_LINE =
  /^(No card is open for funding right now\.|1 card is open for funding\.|\d[\d,]* cards are open for funding\.)( (1 card is|\d[\d,]* cards are) being built\.)?( (The agents are paused|The board has paused the agents)\b.*)?$/;
// legal.pauseReasons.awaiting_credit, said on home and /contribute while the studio waits for a payout.
const PAYOUT_SENTENCE =
  "The agents are paused while the studio waits for Stripe to pay out contributions, which buy the agents' model credit. Cards funded now keep their money and wait in the queue.";
// Fund the next card in line's second line with the funding order loaded: the next card, or the waits line.
const NEXT_IN_LINE = /^Next in line: (.+)$/;
const WAITS_LINE = 'No card is open for funding right now. Your contribution waits in Not on a card yet and funds the next card that opens.';
const RECONCILE_LINE = /^(Reconciled with Stripe on \d{1,2} [A-Z][a-z]{2} \d{4}|Not yet reconciled with Stripe)\.$/;
const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const STRIPE_LINK = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/;
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
// The headers netlify.toml sends on every path, by exact value (docs/specs/site-truth-pass.md).
const REPORT_ONLY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self'; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'";
const ENFORCED_POLICY =
  "frame-ancestors 'none'; " +
  "connect-src 'self'; " +
  "form-action 'self'";
const SECURITY_HEADERS = [
  ['x-frame-options', 'DENY'],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
  ['content-security-policy', ENFORCED_POLICY],
  ['content-security-policy-report-only', REPORT_ONLY_POLICY],
];

const results = [];
function check(ok, message) {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${message}`);
}
function skip(message) {
  results.push(`SKIP ${message}`);
}
/** A check that needs live data: fails without data unless --allow-no-data, which skips it. */
function noData(message) {
  if (allowNoData) skip(`${message}: the site has no live data`);
  else check(false, `${message}: the site has no live data`);
}

/** format.ts formatPostedAt: "22 Sep 2026 at 21:32 Toronto time", whatever this machine's time zone. */
const TORONTO = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'America/Toronto',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
function postedAt(iso) {
  const parts = TORONTO.formatToParts(new Date(iso));
  const value = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${value('day')} ${value('month').slice(0, 3)} ${value('year')} at ${value('hour')}:${value('minute')} Toronto time`;
}

/** One of the site's own documents, parsed; null when it does not answer 200 JSON (a local preview has none). */
async function siteDocument(path) {
  try {
    const response = await fetch(BASE + path);
    if (!response.ok || !(response.headers.get('content-type') ?? '').includes('application/json')) return null;
    return await response.json();
  } catch {
    return null;
  }
}

/** The posted Terms versions, oldest first, from /api/cards as the Terms pages read them; null when the read fails. */
async function postedTerms() {
  const doc = await siteDocument('/api/cards');
  const rows = doc?.terms;
  return Array.isArray(rows) && rows.length > 0 ? [...rows].sort((a, b) => a.version - b.version) : null;
}

/** A part of /api/live the pages read (studio, money); null when the document or the part is missing. */
async function livePart(key) {
  const doc = await siteDocument('/api/live');
  const part = doc?.[key];
  return part !== null && typeof part === 'object' ? part : null;
}

/**
 * Every Payment Link in main that does not carry the agreement: the Terms and Refunds links and the
 * age condition in its own card, or on /contribute in the line directly under the first choice.
 */
function linksWithoutAgreement(page) {
  return page.evaluate((tokens) => {
    const has = (box) =>
      box !== null &&
      tokens.every((href) => box.querySelector(`a[href="${href}"]`) !== null) &&
      /adult/.test(box.textContent ?? '') &&
      /guardian/.test(box.textContent ?? '');
    const first = document.querySelector('main a.choice-primary');
    const line = first?.nextElementSibling ?? null;
    const underFirst = location.pathname === '/contribute' && line?.tagName === 'P' && has(line);
    return [...document.querySelectorAll('main a[href^="https://buy.stripe.com/"]')]
      .filter((a) => !underFirst && !has(a.closest('li.card')))
      .map((a) => `${(a.textContent ?? '').trim()} -> ${a.getAttribute('href')}`);
  }, AGREEMENT_TOKENS);
}

/** Width and height from a PNG's IHDR chunk, or null when the bytes are not a PNG. */
function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) return null;
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function checkPng(url, label) {
  try {
    const response = await fetch(url);
    const type = response.headers.get('content-type') ?? '';
    const size = pngSize(Buffer.from(await response.arrayBuffer()));
    check(
      response.status === 200 && type.startsWith('image/png') && size?.width === 1200 && size?.height === 630,
      `${label} ${response.status} ${type} ${size === null ? 'not a PNG' : `${size.width}x${size.height}`}`,
    );
  } catch (error) {
    check(false, `${label} fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Records every Content Security Policy report the page raises, enforced or report-only, from the
 * securitypolicyviolation event rather than from console text.
 */
async function watchPolicy(page) {
  const reports = [];
  await page.exposeFunction('liveCheckPolicyReport', (line) => reports.push(line));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const blocked = event.blockedURI === '' ? 'inline' : event.blockedURI;
      window.liveCheckPolicyReport(`${event.disposition} ${event.effectiveDirective} blocked ${blocked} on ${location.pathname}`);
    });
  });
  return reports;
}

function checkPolicy(reports, label) {
  check(reports.length === 0, `${label} no Content Security Policy reports${reports.length === 0 ? '' : `: ${reports.slice(0, 3).join(' | ')}`}`);
}

async function open(page, path) {
  const response = await page.goto(BASE + path, { waitUntil: 'load' });
  // The page polls /api/live each minute, so give the first load a moment either way.
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(1_500);
  return response;
}

const browser = await chromium.launch();
try {
  for (const [width, height] of [
    [375, 812],
    [1440, 1000],
  ]) {
    const page = await browser.newPage({ viewport: { width, height } });
    const reports = await watchPolicy(page);
    const errors = [];
    page.on('console', (message) => {
      if (message.type() !== 'error') return;
      // A local preview has no snapshot function, so the browser logs each /api read's 404; with
      // --allow-no-data those are the missing data, not a page error.
      const from = message.location()?.url ?? '';
      if (allowNoData && from !== '' && new URL(from).pathname.startsWith('/api/')) return;
      errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    // The page reads only its own origin (docs/specs/site-snapshot.md): no Supabase request, no socket.
    const offOrigin = [];
    page.on('request', (request) => {
      if (new URL(request.url()).host === SUPABASE_HOST) offOrigin.push(`${request.url()} on ${new URL(page.url()).pathname}`);
    });
    page.on('websocket', (socket) => offOrigin.push(`WebSocket ${socket.url()} on ${new URL(page.url()).pathname}`));
    const namesBoard = [];
    for (const path of ROUTES) {
      const response = await open(page, path);
      if (BOARD_HOST !== null && (await page.content()).toLowerCase().includes(BOARD_HOST)) namesBoard.push(path);
      const status = response?.status() ?? 0;
      check(status === 200, `${width}px ${path} status ${status}`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      check(!overflow, `${width}px ${path} no horizontal overflow`);
      const h1 = await page.locator('h1').allTextContents();
      check(h1.length === 1, `${width}px ${path} one h1: ${JSON.stringify(h1)}`);
      const footer = page.getByRole('contentinfo');
      const links = [];
      for (const [name, href] of FOOTER_LINKS) {
        const link = footer.getByRole('link', { name, exact: true });
        links.push((await link.count()) === 1 && (await link.getAttribute('href')) === href);
      }
      check(links.every(Boolean), `${width}px ${path} footer links Terms, Privacy, Refunds, Contact`);
      const grounds = await page.evaluate(() =>
        [document.querySelector('.topbar'), ...document.querySelectorAll('main > .band'), document.querySelector('.site-footer')].map((el) => (el === null ? '' : getComputedStyle(el).backgroundColor)),
      );
      const bands = grounds.length - 2;
      const want = [SIGNAL, ...Array.from({ length: bands }, (_, i) => (i === 0 ? SIGNAL : i % 2 === 1 ? PAPER : INK)), bands % 2 === 1 ? PAPER : INK];
      check(bands >= 2 && JSON.stringify(grounds) === JSON.stringify(want), `${width}px ${path} bands signal, paper, then ink and paper: ${grounds.join(' / ')}`);
      const gaps = await page.evaluate(auditLayout, LIMITS);
      check(gaps.length === 0, `${width}px ${path} no dead space${gaps.length === 0 ? '' : `: ${gaps.slice(0, 3).join(' | ')}`}`);
    }
    if (BOARD_HOST === null) skip(`${width}px the board site's address on every route: BOARD_SITE_URL is not set`);
    else check(namesBoard.length === 0, `${width}px no route names the board site's address${namesBoard.length === 0 ? '' : `: ${namesBoard.join(', ')}`}`);
    check(errors.length === 0, `${width}px no console errors${errors.length === 0 ? '' : `: ${errors.slice(0, 3).join(' | ')}`}`);
    check(offOrigin.length === 0, `${width}px no page requests the Supabase host or opens a WebSocket${offOrigin.length === 0 ? '' : `: ${offOrigin.slice(0, 3).join(' | ')}`}`);
    checkPolicy(reports, `${width}px`);
    await page.close();
  }

  // The board has its own site (docs/specs/board-site.md): /board here is the not found page, with a
  // 404 status from Netlify, no sign-in form and no address for the board. vite preview has no
  // redirect rules, so a local server answers it 200.
  {
    const board = await browser.newPage({ viewport: { width: 375, height: 812 } });
    const response = await open(board, '/board');
    const status = response?.status() ?? 0;
    if (LOCAL.test(BASE)) skip(`/board status ${status}: a local server has no redirect rules`);
    else check(status === 404, `/board status ${status}`);
    const h1 = await board.locator('h1').allTextContents();
    check(JSON.stringify(h1) === JSON.stringify(['Not found']), `/board is the not found page: ${JSON.stringify(h1)}`);
    check((await board.getByLabel('Email').count()) === 0, '/board has no sign-in form');
    // The top bar's Play link names the game's netlify.app address on every page, /board included;
    // any other netlify.app address would be a leak.
    const content = await board.content();
    const stray = strayNetlifyHosts(content, PLAY_HOST === null ? [] : [PLAY_HOST]);
    check(stray.length === 0, `/board names no netlify.app address but the game's (${PLAY_HOST ?? 'none set'})${stray.length === 0 ? '' : `: ${stray.join(', ')}`}`);
    if (BOARD_HOST !== null) check(!content.toLowerCase().includes(BOARD_HOST), "/board does not name the board site's address");
    await board.close();
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const reports = await watchPolicy(page);
  await open(page, '/');
  const main = page.getByRole('main');
  const pool = main.locator('.pool-line .figure');
  const hasData = (await pool.count()) > 0;

  const h2 = await main.getByRole('heading', { level: 2 }).allTextContents();
  const expected = H2_ORDER.filter((name) => !OPTIONAL_H2.has(name) || h2.includes(name));
  if (!hasData) noData(`landing h2 order ${JSON.stringify(h2)}`);
  else check(JSON.stringify(h2) === JSON.stringify(expected), `landing h2 order ${JSON.stringify(h2)}`);

  const topContribute = page.getByRole('banner').getByRole('link', { name: 'Contribute', exact: true });
  if ((await topContribute.count()) === 0) {
    skip('top bar Contribute: no payment link in this build');
  } else {
    check((await topContribute.getAttribute('href')) === '/contribute', 'top bar Contribute -> /contribute');
  }
  const money = page.getByRole('region', { name: 'Where the money goes' });
  check(
    (await money.getByText('These are contributions, not donations.', { exact: false }).count()) === 1 &&
      (await money.getByRole('link', { name: 'Full ledger' }).getAttribute('href')) === '/ledger',
    'Where the money goes says contributions, not donations, and links the full ledger',
  );

  if (!hasData) {
    noData('the status line and the pool figure');
    noData('Shipped rows');
    noData('fund links and category filters');
  } else {
    const status = ((await main.locator('p.status-line').textContent()) ?? '').trim();
    check(STATUS_LINE.test(status), `status line: ${status}`);
    const home = await livePart('studio');
    if (home !== null && home.paused === true && home.pause_reason === 'awaiting_credit') {
      check(status.endsWith(` ${PAYOUT_SENTENCE}`), 'home status line says the payout sentence while paused for awaiting_credit');
    } else {
      skip(`home payout sentence: the studio is not paused for awaiting_credit`);
    }
    const available = (await pool.textContent()) ?? '';
    check(/^\$[\d,]+\.\d\d$/.test(available) && (await money.locator('.pool-line svg.coin').count()) === 1, `pool figure with the coin shows ${available}`);

    const shipped = page.getByRole('region', { name: 'Shipped' });
    if ((await shipped.count()) === 0) {
      skip('Shipped rows: nothing has shipped yet');
    } else {
      const titles = await shipped.getByRole('heading', { level: 3 }).allTextContents();
      const dates = await shipped.locator('li .row-time').allTextContents();
      const metas = await shipped.locator('li .row-meta .card-meta').allTextContents();
      check(
        titles.length >= 1 &&
          titles.length <= 3 &&
          dates.length === titles.length &&
          dates.every((date) => /^\d{1,2} [A-Z][a-z]{2} \d{4}$/.test(date)) &&
          metas.length === titles.length &&
          metas.every((line) => line.trim() !== ''),
        `${titles.length} shipped rows carry the date, the Live tag and cost or who asked`,
      );
    }

    const fundLinks = await main.getByRole('link', { name: 'Fund this card' }).evaluateAll((as) => as.map((a) => a.href));
    if (fundLinks.length === 0) {
      skip('fund links: no card is open for funding, or no payment link in this build');
    } else {
      check(
        fundLinks.every((href) => /^https:\/\/buy\.stripe\.com\/.+\?client_reference_id=[0-9a-f-]{36}$/.test(href)),
        `fund links (${fundLinks.length}) carry card uuids`,
      );
      const box = await main.getByRole('link', { name: 'Fund this card' }).first().boundingBox();
      check((box?.height ?? 0) >= 44, `Fund button height ${box?.height}`);
    }
    // The studio and next game chips show only while they have cards (none at launch).
    const filters = page.getByRole('group', { name: 'Show cards for' });
    const chips = (await filters.getByRole('button').allTextContents()).map((text) => text.replace(/\s*\d+$/, ''));
    check(chips[0] === 'All' && chips[1] === 'Dust', `category chips ${JSON.stringify(chips)}`);
    for (const label of [...chips.slice(1), 'All']) {
      await filters.getByRole('button', { name: new RegExp(`^${label}`) }).click();
      const bars = await main.getByRole('progressbar').count();
      const pressed = (await filters.locator('[aria-pressed="true"]').textContent()) ?? '';
      check(pressed.startsWith(label), `filter ${label} pressed, ${bars} bars`);
    }
  }

  {
    const stripeLinks = await main.locator('a[href^="https://buy.stripe.com/"]').count();
    const missing = await linksWithoutAgreement(page);
    if (stripeLinks === 0) skip('the agreement on home: no Payment Link on home');
    else check(missing.length === 0, `home: ${stripeLinks} Payment Links, each with the agreement${missing.length === 0 ? '' : `: missing on ${missing.slice(0, 3).join(' | ')}`}`);
  }

  await open(page, '/contribute');
  {
    const missing = await linksWithoutAgreement(page);
    check(missing.length === 0, `/contribute: the agreement line under the first choice covers every Payment Link${missing.length === 0 ? '' : `: missing on ${missing.slice(0, 3).join(' | ')}`}`);
  }
  // The checkout links only: the agreement line under the first choice links the Terms and Refunds.
  const choices = await page
    .getByRole('main')
    .locator('a[href^="https://buy.stripe.com/"]')
    .evaluateAll((as) => as.map((a) => [a.textContent ?? '', a.href]));
  if (choices.length === 0) {
    skip('contribute choices: no payment link in this build');
  } else {
    const [first] = choices;
    check(first[0].startsWith('Fund the next card in line') && STRIPE_LINK.test(first[1]), `Fund the next card in line first -> ${first[1]}`);
    check(
      choices.slice(1).every(([, href]) => /client_reference_id=[0-9a-f-]{36}$/.test(href)),
      `${choices.length - 1} card choices carry card uuids`,
    );
    // Its second line names the next card in line, the first card choice, or says the money waits.
    const body = ((await page.getByRole('main').locator('a.choice-primary .choice-body').textContent()) ?? '').trim();
    const titles = await page.getByRole('main').locator('ul.choices .choice-title').allTextContents();
    const next = NEXT_IN_LINE.exec(body);
    if (!hasData || (await livePart('money')) === null) {
      noData('Fund the next card in line names the next card in line (/api/live money)');
    } else if (next !== null) {
      check(titles.length > 0 && titles[0] === next[1], `Fund the next card in line says "${body}", the first of ${titles.length} card choices`);
    } else {
      check(body === WAITS_LINE && titles.length === 0, `Fund the next card in line says the money waits: "${body}" with ${titles.length} card choices`);
    }
    try {
      const stripe = await fetch(first[1], { redirect: 'manual' });
      check(stripe.status < 400, `Payment Link responds ${stripe.status}`);
    } catch (error) {
      check(false, `Payment Link fetch failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // The pause reason (docs/specs/money-surfaces.md): while the studio waits for a payout, /contribute's
  // notice says the payout sentence; home's status line is checked with the landing below.
  const studioRow = await livePart('studio');
  const awaitingCredit = studioRow !== null && studioRow.paused === true && studioRow.pause_reason === 'awaiting_credit';
  if (studioRow === null) {
    noData('the pause reason on /contribute');
  } else if (!awaitingCredit) {
    skip(`the payout sentence: the studio is not paused for awaiting_credit (paused ${studioRow.paused}, reason ${studioRow.pause_reason})`);
  } else {
    const notice = ((await page.getByRole('main').locator('p.notice').first().textContent().catch(() => '')) ?? '').trim();
    check(notice === PAYOUT_SENTENCE, `/contribute says the payout sentence while paused for awaiting_credit: "${notice}"`);
  }

  // /ledger: exactly one reconciliation line, and money in as public_money has it.
  await open(page, '/ledger');
  {
    const lines = await page
      .getByRole('main')
      .locator('p')
      .evaluateAll((ps) => ps.map((p) => (p.textContent ?? '').trim()).filter((text) => /reconciled with Stripe/i.test(text)));
    const books = await livePart('money');
    if (!hasData || books === null) {
      noData('/ledger reconciliation line and money in');
    } else {
      check(lines.length === 1 && RECONCILE_LINE.test(lines[0]), `/ledger shows exactly one reconciliation line: ${JSON.stringify(lines)}`);
      const moneyIn = page.getByRole('region', { name: 'Money in' });
      if (Number(books.payments) === 0) {
        check((await moneyIn.getByText('No contributions yet.', { exact: true }).count()) === 1, '/ledger says No contributions yet. with /api/live money.payments 0');
      } else {
        const want = USD.format(Number(books.received_usd));
        const shown = ((await moneyIn.locator('.stat', { hasText: 'Received' }).locator('dd').first().textContent()) ?? '').trim();
        check(shown === want, `/ledger received ${shown} matches /api/live money.received_usd ${want} (${books.payments} payments)`);
      }
    }
  }

  await open(page, '/how-it-works');
  const how = await page.content();
  const examples = await page.locator('figure.example').count();
  const labels = await page.locator('figure.example figcaption').allTextContents();
  check(examples === 6 && labels.every((label) => label.startsWith('Example')), `/how-it-works ${examples} labelled examples`);
  check(!/buy\.stripe\.com|client_reference_id/.test(how), '/how-it-works carries no Payment Link and no client_reference_id');
  check((await page.locator('figure.example a, figure.example button').count()) === 0, '/how-it-works examples have no link or button');

  await open(page, '/team');
  if (!hasData) {
    noData('/team agents and avatars');
  } else {
    const avatars = await page.getByRole('main').locator('svg.avatar[role="img"]').count();
    const named = await page.getByRole('main').locator('svg.avatar title').allTextContents();
    check(avatars > 0 && named.length === avatars && named.every((note) => note.trim() !== ''), `/team ${avatars} avatars, each named`);
    // At least one role runs and every role that runs shows claude-opus-5-5 (PLAN.md §10 decision
    // 36; team-models.mjs); a role that does not run shows no model, since none runs it.
    const running = page.getByRole('region', { name: 'Running', exact: true });
    const waiting = page.getByRole('region', { name: 'Not running yet', exact: true });
    const models = runningModelsCheck(await running.locator('li.agent .card-meta').allTextContents());
    check(models.ok, models.message);
    const waitingModels = (await waiting.count()) === 0 ? 0 : await waiting.getByText(/\bclaude-/).count();
    check(waitingModels === 0, `/team shows no model for a role that does not run (${waitingModels} found)`);
  }

  await open(page, '/roadmap');
  const roadmap = page.getByRole('main');
  check((await roadmap.getByRole('progressbar').count()) === 0, '/roadmap shows no funding bar');
  check((await roadmap.getByRole('link').count()) === 0, '/roadmap has no fund link');

  // The Terms versions (docs/specs/legal-copy.md): /terms shows the newest posted version with when it
  // took effect, never the cannot-confirm notice, and lists each earlier one; the next number is not
  // found.
  const terms = await postedTerms();
  if (terms === null) {
    noData('the Terms version in force');
  } else {
    const newest = terms[terms.length - 1];
    await open(page, '/terms');
    const text = (await page.getByRole('main').textContent()) ?? '';
    const since = `Version ${newest.version}, in force since ${postedAt(newest.posted_at)}.`;
    check(text.includes(since) && !text.includes('cannot confirm'), `/terms shows "${since}"`);
    const earlier = terms.slice(0, -1).map((row) => `/terms/${row.version}`);
    const listed = await page
      .getByRole('region', { name: 'Earlier versions' })
      .getByRole('link')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    check(JSON.stringify([...listed].sort()) === JSON.stringify([...earlier].sort()), `/terms lists the earlier versions ${JSON.stringify(listed)}`);
    for (const row of terms.slice(0, -1)) {
      await open(page, `/refunds/${row.version}`);
      const h1 = await page.locator('h1').allTextContents();
      check(JSON.stringify(h1) === JSON.stringify([`Refunds, version ${row.version}`]), `/refunds/${row.version} shows ${JSON.stringify(h1)}`);
    }
    await open(page, `/terms/${newest.version + 1}`);
    const missing = await page.locator('h1').allTextContents();
    check(JSON.stringify(missing) === JSON.stringify(['Not found']), `/terms/${newest.version + 1} is the not found page: ${JSON.stringify(missing)}`);
  }

  await page.waitForTimeout(500);
  checkPolicy(reports, 'landing, contribute, how it works, team, roadmap and terms interactions');
  await page.close();

  // The site's own documents and their caching (docs/specs/site-snapshot.md).
  {
    const jsonType = (value) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);
    const keysOk = (doc, spec) =>
      Object.entries(spec).filter(([key, allowed]) => !(key in doc) || ![allowed].flat().includes(jsonType(doc[key]))).map(([key]) => key);
    const first = await fetch(`${BASE}/api/live`);
    const type = first.headers.get('content-type') ?? '';
    if (!type.includes('application/json') && allowNoData) {
      skip(`/api: ${BASE} has no snapshot function (answered ${first.status} ${type})`);
    } else {
      const doc = await first.json().catch(() => null);
      // Every key of the document, and of each card in its map: a card's stage, ship time and horizon
      // come from here together (docs/specs/site-snapshot.md).
      const liveCards = doc !== null && jsonType(doc.cards) === 'object' ? Object.entries(doc.cards) : [];
      const wrong =
        doc === null
          ? ['not JSON']
          : [
              ...keysOk(doc, SNAPSHOT_KEYS.live),
              ...liveCards.flatMap(([id, entry]) => (jsonType(entry) === 'object' ? keysOk(entry, SNAPSHOT_KEYS.live_card) : ['']).map((key) => `cards.${id}${key === '' ? '' : `.${key}`}`)),
            ];
      const browser = first.headers.get('cache-control') ?? '';
      check(first.status === 200 && wrong.length === 0, `/api/live ${first.status} ${type}${wrong.length === 0 ? ', every key in snapshot-keys.json' : `: missing or wrong ${wrong.join(', ')}`}`);
      check(/max-age=0/.test(browser), `/api/live Cache-Control: ${browser}`);
      if (LOCAL.test(BASE)) {
        skip('/api/live second read is a CDN hit: a local server has no CDN');
      } else {
        const second = await fetch(`${BASE}/api/live`);
        const status = second.headers.get('cache-status') ?? '';
        check(second.status === 200 && /\bhit\b/i.test(status), `/api/live read again within 60 seconds: ${second.status} Cache-Status ${status}`);
      }
      const cards = await fetch(`${BASE}/api/cards`);
      const cardsDoc = await cards.json().catch(() => null);
      const cardsWrong = cardsDoc === null ? ['not JSON'] : keysOk(cardsDoc, SNAPSHOT_KEYS.cards);
      check(cards.status === 200 && cardsWrong.length === 0, `/api/cards ${cards.status}${cardsWrong.length === 0 ? ', every key in snapshot-keys.json' : `: missing or wrong ${cardsWrong.join(', ')}`}`);
      const query = await fetch(`${BASE}/api/live?x=1`);
      check(query.status === 400 && (query.headers.get('cache-control') ?? '') === 'no-store', `/api/live?x=1 ${query.status} Cache-Control ${query.headers.get('cache-control')}`);
    }
    const html = await (await fetch(`${BASE}/`)).text();
    const script = html.match(/<script[^>]+src="(\/assets\/[^"]+\.js)"/)?.[1] ?? null;
    if (script === null) {
      check(false, 'index.html names a script under /assets');
    } else {
      const asset = await fetch(BASE + script, { method: 'HEAD' });
      const cache = asset.headers.get('cache-control') ?? '';
      if (LOCAL.test(BASE) && !/immutable/.test(cache)) skip(`${script} Cache-Control ${cache}: a local server does not send netlify.toml's asset headers`);
      else check(/immutable/.test(cache) && /max-age=31536000/.test(cache), `${script} Cache-Control: ${cache}`);
    }
  }

  for (const asset of ['/favicon.ico', '/peanut.png', '/version.json']) {
    const response = await fetch(BASE + asset);
    check(response.status === 200, `${asset} ${response.status}`);
  }
  await checkPng(`${BASE}/og.png`, '/og.png');

  const index = await (await fetch(`${BASE}/`)).text();
  const ogImage = index.match(/<meta property="og:image" content="([^"]+)"/)?.[1] ?? null;
  const absolute = ogImage !== null && /^https:\/\/[^/]+\/.+/.test(ogImage);
  check(absolute, `index og:image is an absolute URL: ${ogImage}`);
  const twitter = index.match(/<meta name="twitter:card" content="([^"]+)"/)?.[1] ?? null;
  check(twitter === 'summary_large_image', `index twitter:card ${twitter}`);
  if (absolute && new URL(ogImage).origin === new URL(BASE).origin) {
    await checkPng(ogImage, 'og:image');
  } else if (absolute) {
    skip(`og:image points at ${new URL(ogImage).origin}, not ${BASE}; ${BASE}/og.png was checked instead`);
  }

  const probe = await fetch(`${BASE}/`);
  if (LOCAL.test(BASE) && probe.headers.get('content-security-policy') === null) {
    skip('security headers: this local server does not send them');
  } else {
    // The landing, and routes served through the SPA rewrite.
    for (const path of ['/', '/ledger', '/team']) {
      const response = await fetch(BASE + path);
      for (const [name, expected] of SECURITY_HEADERS) {
        const actual = response.headers.get(name);
        check(actual === expected, `${path} ${name}: ${actual}`);
      }
    }
  }

  if (BASE === PRODUCTION) {
    const www = await fetch('https://www.peanutgallery.games/', { redirect: 'manual' });
    check([301, 308].includes(www.status), `www redirects ${www.status}`);
  } else {
    skip('www redirect: production only');
  }
} catch (error) {
  check(false, `live check stopped: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await browser.close();
}

const failed = results.filter((line) => line.startsWith('FAIL')).length;
const passed = results.filter((line) => line.startsWith('PASS')).length;
const skipped = results.filter((line) => line.startsWith('SKIP')).length;
console.log(`${failed === 0 ? 'PASS' : 'FAIL'} live-check ${BASE} passed=${passed} failed=${failed} skipped=${skipped}`);
console.log(results.join('\n'));
process.exit(failed === 0 ? 0 : 1);
