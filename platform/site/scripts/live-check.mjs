// Checks a running copy of the site the way a first-time visitor meets it.
//
// usage: node platform/site/scripts/live-check.mjs [baseUrl] [--allow-no-data]
//        pnpm --filter @backseat/site exec node scripts/live-check.mjs [baseUrl] [--allow-no-data]
//
// baseUrl defaults to https://peanutgallery.games. Both forms work: the @playwright/test import
// resolves from this file's folder, so the working directory does not matter.
//
// Every route (the landing, contribute, ledger, the four text pages, /board and a missing page) at
// 375px and 1440px: status 200, one h1, no horizontal overflow, the footer's Terms, Privacy, Refunds
// and Contact links, and no console errors. The landing's h2 order, read from the page: Building
// now, Queued and Shipped appear only when cards are in those stages. The Right now panel, the fund
// links, the category filters and /contribute's choices. Assets, og:image as an absolute URL, and
// /og.png as a 200 image/png of 1200x630. The www redirect runs only against production. The
// security headers from netlify.toml run against any address that is not local, because vite preview
// does not send them.
//
// The data checks need the site to reach its database. A local build without the Supabase values
// has none; --allow-no-data turns those checks into SKIP lines instead of failures.
//
// The first line is PASS or FAIL with the counts; one line per check follows. Exit 0 pass, 1 fail.

import { chromium } from '@playwright/test';

const PRODUCTION = 'https://peanutgallery.games';
const args = process.argv.slice(2);
const allowNoData = args.includes('--allow-no-data');
const BASE = (args.find((arg) => !arg.startsWith('--')) ?? PRODUCTION).replace(/\/+$/, '');

const ROUTES = ['/', '/contribute', '/ledger', '/terms', '/privacy', '/refunds', '/contact', '/board', '/no-such-page'];
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
// The enforced headers netlify.toml sends on every path (docs/specs/site-truth-pass.md).
const SECURITY_HEADERS = [
  ['x-frame-options', 'DENY'],
  ['x-content-type-options', 'nosniff'],
  ['referrer-policy', 'strict-origin-when-cross-origin'],
  ['permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'],
  ['content-security-policy', "frame-ancestors 'none'"],
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
    const errors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(String(error)));
    for (const path of ROUTES) {
      const response = await open(page, path);
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
    check(errors.length === 0, `${width}px no console errors${errors.length === 0 ? '' : `: ${errors.slice(0, 3).join(' | ')}`}`);
    await page.close();
  }

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
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
    const filters = page.getByRole('group', { name: 'Show cards for' });
    for (const label of ['Dust', 'The studio', 'Next game', 'All']) {
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

  if (LOCAL.test(BASE)) {
    skip('security headers: a local preview does not send them');
  } else {
    // The landing, and a route served through the SPA rewrite.
    for (const path of ['/', '/ledger']) {
      const response = await fetch(BASE + path);
      for (const [name, expected] of SECURITY_HEADERS) {
        const actual = response.headers.get(name);
        check(actual === expected, `${path} ${name}: ${actual}`);
      }
      check(response.headers.has('content-security-policy-report-only'), `${path} content-security-policy-report-only is sent`);
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
