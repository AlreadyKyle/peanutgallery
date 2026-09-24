// Draws the site's icons from brand/mark.svg (docs/specs/machine-mark.md).
//
// usage: node platform/site/scripts/icons.mjs          (from the repository root)
//        pnpm --filter @backseat/site exec node scripts/icons.mjs
//
// public/favicon.ico (16 and 32) and public/favicon-32.png: the mark in ink with a paper plate under
// its screen and coin slot and nothing around it, so it reads as a tile on a light or a dark tab strip.
// public/apple-touch-icon.png (180) and public/icon-512.png (512, for the Discord and Stripe icons):
// the mark in paper on ink, centred with room for a rounded or round crop. Every size puts the mark's
// 32-unit grid on whole pixels. Chromium (from @playwright/test, a site devDependency) draws each size
// as a transparent screenshot; the .ico holds the two PNGs as they are. Commit what it writes.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INK = '#111111';
const PAPER = '#ffffff';

const source = readFileSync(resolve(SITE, 'brand/mark.svg'), 'utf8');
const path = source.match(/<path fill-rule="evenodd" d="([^"]+)"\/>/)?.[1];
if (path === undefined) throw new Error('brand/mark.svg has no even-odd path');
// The paper plate under the screen and the slot, inside the cabinet's walls (units of the 32 grid).
const PLATE = 'M8 4H24A2 2 0 0 1 26 6V25A2 2 0 0 1 24 27H8A2 2 0 0 1 6 25V6A2 2 0 0 1 8 4Z';

/** The tab icon at 16 or 32px: one pixel or two per unit. */
const tab = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">` +
  `<path fill="${PAPER}" d="${PLATE}"/><path fill="${INK}" fill-rule="evenodd" d="${path}"/></svg>`;

/**
 * The home-screen icon: the mark's 24×30-unit body at a whole number of pixels per unit, centred on
 * ink. The mark spans x 4 to 28 and y 2 to 32 of its grid.
 */
const tile = (size, scale) => {
  const x = (size - 24 * scale) / 2 - 4 * scale;
  const y = (size - 30 * scale) / 2 - 2 * scale;
  if (!Number.isInteger(x) || !Number.isInteger(y)) throw new Error(`${size}px at ${scale}px a unit is off the pixel grid`);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${INK}"/>` +
    `<path fill="${PAPER}" fill-rule="evenodd" transform="translate(${x} ${y}) scale(${scale})" d="${path}"/></svg>`
  );
};

/** An .ico holding PNG images as they are (every current browser reads PNG entries). */
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, index) => {
    const entry = 6 + 16 * index;
    header.writeUInt8(size % 256, entry);
    header.writeUInt8(size % 256, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map(({ png }) => png)]);
}

const browser = await chromium.launch();
try {
  const draw = async (svg, size) => {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size }, omitBackground: true, type: 'png' });
    await page.close();
    return png;
  };
  const files = {
    'public/favicon-32.png': await draw(tab(32), 32),
    'public/apple-touch-icon.png': await draw(tile(180, 4), 180),
    'public/icon-512.png': await draw(tile(512, 11), 512),
  };
  files['public/favicon.ico'] = ico([
    { size: 16, png: await draw(tab(16), 16) },
    { size: 32, png: files['public/favicon-32.png'] },
  ]);
  for (const [file, bytes] of Object.entries(files)) {
    writeFileSync(resolve(SITE, file), bytes);
    console.log(`wrote ${relative(process.cwd(), resolve(SITE, file))} ${bytes.length} bytes`);
  }
} finally {
  await browser.close();
}
