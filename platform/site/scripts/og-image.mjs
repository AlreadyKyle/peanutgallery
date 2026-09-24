// Draws public/og.png, the 1200×630 link preview named by og:image in index.html.
//
// usage: node platform/site/scripts/og-image.mjs          (from the repository root)
//        pnpm --filter @backseat/site exec node scripts/og-image.mjs
//
// The image is typographic and uses the site's own stylesheet: the colours, the font, weights, type
// scale and spacing all come from src/tokens.css and src/styles.css, and the wordmark is the site's
// .wordmark with the mark from brand/mark.svg, drawn in the text colour as the top bar draws it. It is
// drawn on the signal plate, as band 1 of every page is, with the site's own font file (public/fonts,
// inlined as a data URL, since a page set from a string has no origin to load /fonts from); the run
// fails if the font did not load. The words come from
// src/lib/copy.ts (studio name and pitch line) and the address from index.html's og:url. Only the
// frame is laid out here. Chromium comes from @playwright/test, a site devDependency, so run
// `playwright install chromium` first if needed. Commit the PNG it writes; the site serves it from
// public/.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(SITE, 'public/og.png');
const WIDTH = 1200;
const HEIGHT = 630;

function read(path) {
  return readFileSync(resolve(SITE, path), 'utf8');
}

/** A single-quoted string property from copy.ts. */
function copyString(source, key) {
  const match = source.match(new RegExp(`\\b${key}:\\s*'([^']+)'`));
  if (match === null) throw new Error(`src/lib/copy.ts has no ${key}`);
  return match[1];
}

function escapeHtml(text) {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Width and height from a PNG's IHDR chunk. */
function pngSize(bytes) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || signature.some((b, i) => bytes[i] !== b)) throw new Error('not a PNG');
  if (bytes.toString('ascii', 12, 16) !== 'IHDR') throw new Error('PNG has no IHDR first');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const copySource = read('src/lib/copy.ts');
const studioName = copyString(copySource, 'studioName');
const pitchTitle = copyString(copySource, 'pitchTitle');
const pitchBody = copyString(copySource, 'pitchBody');
const ogUrl = read('index.html').match(/<meta property="og:url" content="([^"]+)"/);
if (ogUrl === null) throw new Error('index.html has no og:url');
const address = new URL(ogUrl[1]).host;
// styles.css starts by importing tokens.css; the page here has no bundler, so inline both, with the
// font file's url turned into a data URL.
const FONT = 'fonts/atkinson-hyperlegible-next-400-700.woff2';
const font = `data:font/woff2;base64,${readFileSync(resolve(SITE, 'public', FONT)).toString('base64')}`;
const tokens = read('src/tokens.css');
if (!tokens.includes(`url('/${FONT}')`)) throw new Error(`src/tokens.css does not load /${FONT}`);
const stylesheet = `${tokens.replace(`url('/${FONT}')`, `url('${font}')`)}\n${read('src/styles.css').replace(/^@import [^;]+;\n/m, '')}`;
// The mark as the top bar draws it: inline, in the text colour, sized by the site's .mark rule.
const mark = read('brand/mark.svg').trim().replace('<svg ', '<svg class="mark" aria-hidden="true" ');
if (!mark.includes('fill="currentColor"')) throw new Error('brand/mark.svg is not drawn in currentColor');

// A larger root size scales the rem tokens together. The page heading grows with the viewport on the
// site, so the card sets it at a fixed 1.875rem: at 175% the heading is 52.5px and the lede 35px,
// which read at link-preview size.
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
${stylesheet}
html { font-size: 175%; }
.og {
  width: ${WIDTH}px;
  height: ${HEIGHT}px;
  padding: var(--space-4);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  overflow: hidden;
  background: var(--signal);
  color: var(--paper);
}
.og .wordmark { font-size: var(--size-lead); }
.og h1 { margin-bottom: var(--space-2); font-size: 1.875rem; line-height: 1.25; }
.og .lede { max-width: none; }
.og .address { margin: 0; color: var(--muted-on-signal); font-size: var(--size-small); }
</style>
</head>
<body>
<div class="og">
  <span class="wordmark">${mark}${escapeHtml(studioName)}</span>
  <div>
    <h1>${escapeHtml(pitchTitle)}</h1>
    <p class="lede">${escapeHtml(pitchBody)}</p>
  </div>
  <p class="address">${escapeHtml(address)}</p>
</div>
</body>
</html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const loaded = await page.evaluate(() => document.fonts.check('700 30px "Atkinson Hyperlegible Next"') && [...document.fonts].some((face) => face.family.includes('Atkinson Hyperlegible Next') && face.status === 'loaded'));
  if (!loaded) throw new Error('the site font did not load');
  const fits = await page.evaluate(() => {
    const frame = document.querySelector('.og');
    return frame !== null && frame.scrollHeight <= frame.clientHeight && frame.scrollWidth <= frame.clientWidth;
  });
  if (!fits) throw new Error('the text does not fit the 1200×630 frame');
  const png = await page.screenshot({ clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT }, type: 'png' });
  const size = pngSize(png);
  if (size.width !== WIDTH || size.height !== HEIGHT) {
    throw new Error(`rendered ${size.width}×${size.height}, expected ${WIDTH}×${HEIGHT}`);
  }
  writeFileSync(OUT, png);
  console.log(`wrote ${relative(process.cwd(), OUT)} ${size.width}x${size.height} ${png.length} bytes`);
} finally {
  await browser.close();
}
