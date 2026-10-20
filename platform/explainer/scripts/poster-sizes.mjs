// The explainer's posters at the sizes the site asks for (platform/site/src/components/ExplainerVideo.tsx):
// each cut's poster as a smaller JPEG and as WebP at every width, beside the full-size JPEG the render
// writes. Home shows the wide poster about 340 to 440px across, so a phone or a laptop no longer
// fetches the 1920px still. Run by `node scripts/render.mjs --publish`, or on its own after a poster
// changes:
//   node scripts/poster-sizes.mjs [folder]     default: platform/site/public/video
// Needs ImageMagick 7 (`magick`) with WebP.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Each cut's full poster width, and the smaller widths drawn from it. Kept equal to ExplainerVideo.tsx. */
export const POSTER_WIDTHS = { wide: { full: 1920, smaller: [720, 1080] }, tall: { full: 1080, smaller: [720] } };

export function posterSizes(folder) {
  for (const [cut, { full, smaller }] of Object.entries(POSTER_WIDTHS)) {
    const source = join(folder, `explainer-${cut}-poster.jpg`);
    if (!existsSync(source)) throw new Error(`${source} is missing`);
    for (const width of [...smaller, full]) {
      const resize = width === full ? [] : ['-resize', `${width}x`];
      const outputs = width === full ? ['webp'] : ['jpg', 'webp'];
      for (const ext of outputs) {
        const output = join(folder, `explainer-${cut}-poster-${width}.${ext}`);
        const quality = ext === 'jpg' ? ['-quality', '82', '-interlace', 'JPEG'] : ['-quality', '80', '-define', 'webp:method=6'];
        execFileSync('magick', [source, '-strip', ...resize, ...quality, output], { stdio: 'inherit' });
        console.log(`${output} (${(statSync(output).size / 1024).toFixed(0)} KB)`);
      }
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  posterSizes(resolve(process.argv[2] ?? join(root, '..', 'site', 'public', 'video')));
}
