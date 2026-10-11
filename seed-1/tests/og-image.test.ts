import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import { OG_FILE_NAME, OG_HEIGHT, OG_WIDTH, ogImagePng } from '../scripts/og-image.mjs';
import { runPostbuild } from '../scripts/postbuild.mjs';
import { PACKAGE_DIR } from './paths';

const IMAGE_URL = `https://play.mobmachine.games/${OG_FILE_NAME}`;

function meta(html: string, attr: 'property' | 'name', key: string): string | undefined {
  const match = html.match(new RegExp(`<meta ${attr}="${key.replace(/[:.]/g, '\\$&')}" content="([^"]*)"`));
  return match?.[1];
}

/** Width, height and the decoded RGB rows of an 8-bit RGB, unfiltered PNG. */
function readPng(png: Buffer): { width: number; height: number; colorType: number; raw: Buffer } {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(png.toString('ascii', 12, 16)).toBe('IHDR');
  const idat: Buffer[] = [];
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    if (png.toString('ascii', at + 4, at + 8) === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20), colorType: png[25]!, raw: inflateSync(Buffer.concat(idat)) };
}

describe('link preview image', () => {
  let workDir = '';
  afterEach(() => {
    if (workDir !== '') rmSync(workDir, { recursive: true, force: true });
    workDir = '';
  });

  it('index.html points og:image and twitter:image at the game picture, with its size and alt text', () => {
    const html = readFileSync(join(PACKAGE_DIR, 'index.html'), 'utf8');
    expect(meta(html, 'property', 'og:image')).toBe(IMAGE_URL);
    expect(meta(html, 'name', 'twitter:image')).toBe(IMAGE_URL);
    expect(meta(html, 'property', 'og:image:width')).toBe(String(OG_WIDTH));
    expect(meta(html, 'property', 'og:image:height')).toBe(String(OG_HEIGHT));
    expect(meta(html, 'property', 'og:image:type')).toBe('image/png');
    expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
    const alt = meta(html, 'property', 'og:image:alt');
    expect(alt).toMatch(/^Dust/);
    expect(meta(html, 'name', 'twitter:image:alt')).toBe(alt);
    expect(html).not.toContain('mobmachine.games/og.png');
  });

  it('the build writes a 1200 by 630 PNG beside the game, drawn the same every time', () => {
    workDir = mkdtempSync(join(tmpdir(), 'seed-1-og-'));
    const packageDir = join(workDir, 'package');
    mkdirSync(join(packageDir, 'config'), { recursive: true });
    mkdirSync(join(packageDir, 'content'), { recursive: true });
    const dist = join(workDir, 'dist');
    runPostbuild(packageDir, dist);

    const png = readFileSync(join(dist, OG_FILE_NAME));
    expect(png.equals(ogImagePng())).toBe(true);
    const { width, height, colorType, raw } = readPng(png);
    expect([width, height]).toEqual([1200, 630]);
    expect(colorType).toBe(2);
    expect(raw.length).toBe(height * (width * 3 + 1));
    // Drawn, not blank: the background, the gold of the pile and the bar's blue all appear.
    const colors = new Set<string>();
    for (let y = 0; y < height; y += 5) {
      for (let x = 0; x < width; x += 5) {
        const i = y * (width * 3 + 1) + 1 + x * 3;
        colors.add(`${raw[i]},${raw[i + 1]},${raw[i + 2]}`);
      }
    }
    expect(colors).toContain('18,22,28');
    expect(colors).toContain('217,164,65');
    expect(colors).toContain('111,168,220');
  });
});
