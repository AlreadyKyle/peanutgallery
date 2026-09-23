// Checks a running copy of the site the way a first-time visitor meets it.
//
// usage: node platform/site/scripts/live-check.mjs [baseUrl] [--allow-no-data]
//        pnpm --filter @backseat/site exec node scripts/live-check.mjs [baseUrl] [--allow-no-data]
//
// baseUrl defaults to https://peanutgallery.games. Both forms work: the @playwright/test import
// resolves from this file's folder, so the working directory does not matter.
//
// Every route (the landing, contribute, ledger, how it works, the team, the roadmap, the four text
// pages and a missing page) at 375px and 1440px: status 200, one h1, no horizontal overflow,
// the footer's Terms, Privacy, Refunds and Contact links, no console errors and no Content Security
// Policy report. The landing's h2 order, read from the page: Building now, Queued and Shipped appear
// only when cards are in those stages. The Right now panel, the fund links, the category filters and
// /contribute's choices. /how-it-works carries no Payment Link and no client_reference_id; /team
// draws every agent, runs at least one, shows claude-opus-5-5 on each that runs and no model on the
// rest; /roadmap shows no bar and no fund link. Assets, og:image as an absolute URL, and
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
// The data checks need the site to reach its database. A local build without the Supabase values
// has none; --allow-no-data turns those checks into SKIP lines instead of failures.
//
// The first line is PASS or FAIL with the counts; one line per check follows. Exit 0 pass, 1 fail.

import { readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { boardHostFrom, playHostFrom, strayNetlifyHosts } from './board-address.mjs';
import { runningModelsCheck } from './team-models.mjs';

const PRODUCTION = 'https://peanutgallery.games';
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
  '/privacy',
  '/refunds',
  '/contact',
  '/no-such-page',
];
const FOOTER_LINKS = [
  ['Terms', '/terms'],
  ['Privacy', '/privacy'],
  ['Refunds', '/refunds'],
  ['Contact', '/contact'],
];
const H2_ORDER = ['Right now', 'Building now', "Fund what's next", 'Queued', 'Shipped', 'How it works', 'Funding', 'Ledger', 'Fixed rules'];
const OPTIONAL_H2 = new Set(['Building now', 'Queued', 'Shipped']);
const STRIPE_LINK = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9]+$/;
const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
// The headers netlify.toml sends on every path, by exact value (docs/specs/site-truth-pass.md).
const REPORT_ONLY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; " +
  "connect-src 'self' https://lyxndueoeisyqzewflpu.supabase.co wss://lyxndueoeisyqzewflpu.supabase.co; " +
  "object-src 'none'; base-uri 'self'; form-action 'self'";
const ENFORCED_POLICY =
  "frame-ancestors 'none'; " +
  "connect-src 'self' https://lyxndueoeisyqzewflpu.supabase.co wss://lyxndueoeisyqzewflpu.supabase.co; " +
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
  // Realtime keeps a socket open, so network idle may never come; give the data a moment either way.
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
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
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
    }
    if (BOARD_HOST === null) skip(`${width}px the board site's address on every route: BOARD_SITE_URL is not set`);
    else check(namesBoard.length === 0, `${width}px no route names the board site's address${namesBoard.length === 0 ? '' : `: ${namesBoard.join(', ')}`}`);
    check(errors.length === 0, `${width}px no console errors${errors.length === 0 ? '' : `: ${errors.slice(0, 3).join(' | ')}`}`);
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
  const panel = page.getByRole('complementary');
  const hasData = (await panel.locator('dd').count()) > 0;

  const h2 = await main.getByRole('heading', { level: 2 }).allTextContents();
  const expected = H2_ORDER.filter((name) => !OPTIONAL_H2.has(name) || h2.includes(name));
  check(JSON.stringify(h2) === JSON.stringify(expected), `landing h2 order ${JSON.stringify(h2)}`);

  const heroContribute = main.getByRole('link', { name: 'Contribute', exact: true });
  if ((await heroContribute.count()) === 0) {
    skip('hero Contribute: no payment link in this build');
  } else {
    check((await heroContribute.getAttribute('href')) === '/contribute', 'hero Contribute -> /contribute');
  }

  if (!hasData) {
    noData('Right now available figure');
    noData('Shipped rows and the latest shipped line');
    noData('fund links and category filters');
  } else {
    const available = (await panel.locator('dd').first().textContent()) ?? '';
    check(/^\$[\d,]+\.\d\d$/.test(available), `Right now available shows ${available}`);

    const shipped = page.getByRole('region', { name: 'Shipped' });
    if ((await shipped.count()) === 0) {
      check((await panel.getByText('Latest shipped:').count()) === 0, 'nothing shipped yet: no Shipped section and no latest shipped line');
    } else {
      const titles = await shipped.getByRole('heading', { level: 3 }).allTextContents();
      const latest = await panel.getByText('Latest shipped:').locator('xpath=..').textContent();
      check(latest === `Latest shipped: ${titles[0]}`, `Right now names the latest shipped card: ${latest}`);
      const metas = await shipped.locator('li .card-meta').allTextContents();
      check(
        metas.length === titles.length && metas.every((line) => /^(\$[\d,]+\.\d\d spent · )?.+ · shipped .+$/.test(line)),
        `${titles.length} shipped rows carry cost, contributors and date`,
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

  await open(page, '/contribute');
  const choices = await page
    .getByRole('main')
    .getByRole('link')
    .evaluateAll((as) => as.map((a) => [a.textContent ?? '', a.href]));
  if (choices.length === 0) {
    skip('contribute choices: no payment link in this build');
  } else {
    const [first] = choices;
    check(first[0].startsWith('Pick for me') && STRIPE_LINK.test(first[1]), `Pick for me first -> ${first[1]}`);
    check(
      choices.slice(1).every(([, href]) => href.includes('client_reference_id=')),
      `${choices.length - 1} card choices carry card ids`,
    );
    try {
      const stripe = await fetch(first[1], { redirect: 'manual' });
      check(stripe.status < 400, `Payment Link responds ${stripe.status}`);
    } catch (error) {
      check(false, `Payment Link fetch failed: ${error instanceof Error ? error.message : String(error)}`);
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

  await page.waitForTimeout(500);
  checkPolicy(reports, 'landing, contribute, how it works, team and roadmap interactions');
  await page.close();

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
