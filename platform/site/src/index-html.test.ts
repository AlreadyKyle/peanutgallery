import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copy } from './lib/copy';

// Link previews: index.html carries the pitch line and an absolute og:image, and public/og.png is
// the 1200×630 PNG it names. Paths resolve from the package root vitest runs in (see styles.test.ts).
const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
const pitch = `${copy.pitchTitle} ${copy.pitchBody}`;

function meta(attribute: 'name' | 'property', key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`<meta ${attribute}="${escaped}" content="([^"]*)"`));
  return match === null ? null : match[1]!;
}

describe('index.html link previews', () => {
  it('describes the site with the pitch line from copy.ts', () => {
    expect(html).toContain(`<title>${copy.studioName}</title>`);
    expect(meta('name', 'description')).toBe(pitch);
    expect(meta('property', 'og:description')).toBe(pitch);
  });

  it('carries the Open Graph and Twitter tags with an absolute 1200×630 image', () => {
    expect(meta('property', 'og:type')).toBe('website');
    expect(meta('property', 'og:site_name')).toBe(copy.studioName);
    expect(meta('property', 'og:title')).toBe(copy.studioName);
    expect(meta('property', 'og:url')).toBe('https://mobmachine.games/');
    expect(meta('property', 'og:image')).toBe('https://mobmachine.games/og.png');
    expect(meta('property', 'og:image:width')).toBe('1200');
    expect(meta('property', 'og:image:height')).toBe('630');
    expect(meta('property', 'og:image:alt')).toBe(`${copy.studioName}: ${copy.pitchTitle}`);
    expect(meta('name', 'twitter:card')).toBe('summary_large_image');
  });

  it('ships public/og.png as a 1200×630 PNG', () => {
    const png = readFileSync(resolve(process.cwd(), 'public/og.png'));
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(png.toString('ascii', 12, 16)).toBe('IHDR');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1200, 630]);
  });
});
