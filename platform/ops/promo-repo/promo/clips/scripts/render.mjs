// Renders one vertical clip: node scripts/render.mjs <props.json> <out.mp4>
// or review frames: node scripts/render.mjs <props.json> --still 60,200,300,400 <dir>
// Run `npm run music` once first; it writes public/soundtrack.wav.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// A local headless shell when there is one; otherwise (GitHub Actions) Remotion downloads its own.
const local = process.env.REMOTION_CHROME || '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell';
const chrome = existsSync(local) ? local : null;
const [propsFile, ...rest] = process.argv.slice(2);
const inputProps = JSON.parse(readFileSync(propsFile, 'utf8'));
const serveUrl = await bundle({ entryPoint: join(root, 'src', 'index.ts'), publicDir: join(root, 'public') });
const composition = await selectComposition({ serveUrl, id: 'moment', inputProps, browserExecutable: chrome });
if (rest[0] === '--still') {
  for (const f of rest[1].split(',').map(Number)) {
    await renderStill({ composition, serveUrl, frame: f, inputProps, output: join(rest[2], `frame-${f}.png`), browserExecutable: chrome });
    console.log('still', f);
  }
} else {
  await renderMedia({ composition, serveUrl, inputProps, codec: 'h264', crf: 18, audioCodec: 'aac', audioBitrate: '192k', pixelFormat: 'yuv420p', outputLocation: rest[0], browserExecutable: chrome, concurrency: 4 });
  console.log('wrote', rest[0]);
}
