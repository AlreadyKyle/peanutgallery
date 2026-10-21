// Renders the weekly update video (docs/specs/weekly-video.md) from a week's props in
// src/weekly/weeks/<date>.ts and its captures in weekly-captures/<date>/.
//
//   node scripts/weekly.mjs --week 2026-10-20                    the 16:9 video, into dist/weekly/
//   node scripts/weekly.mjs --week 2026-10-20 --stills           one still per beat (held, ring drawn), plus the plates
//   node scripts/weekly.mjs --week 2026-10-20 --out <dir>        write the files there instead
//
// The soundtrack comes from `node scripts/music.mjs --weekly <date>`, run here first if it is missing
// (or with --music). Rendering uses the headless Chromium Playwright installed, or REMOTION_CHROME.
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const publicDir = join(dist, 'public');
const site = join(root, '..', 'site');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args[i + 1];
};

const week = value('--week');
if (week === undefined) throw new Error('--week <date> is required, for example --week 2026-10-20');
// Optional: a week of drawn scenes has no captures, and check() refuses a beat that names a missing one.
const captures = join(root, 'weekly-captures', week);
const out = value('--out') ?? join(dist, 'weekly');
// Horizontal only: the owner's call, 21 Oct 2026.
const CUTS = { wide: { id: 'weekly-wide', file: `weekly-${week}.mp4` } };

function chrome() {
  if (process.env.REMOTION_CHROME) return process.env.REMOTION_CHROME;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const shell of shells) {
    for (const sub of readdirSync(join(cache, shell))) {
      const bin = join(cache, shell, sub, 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error('No headless Chromium found: run `pnpm exec playwright install chromium` in platform/site, or set REMOTION_CHROME');
}

/** The week's beat table, from the same layout.ts the video reads. */
async function plan() {
  const file = join(dist, `weekly-plan-${week}.mjs`);
  await build({
    stdin: { contents: `export { layout } from './src/weekly/layout'; export { WEEKS } from './src/weekly/weeks';`, resolveDir: root, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: file,
    logLevel: 'error',
    loader: { '.json': 'json' },
  });
  const mod = await import(pathToFileURL(file).href);
  const props = mod.WEEKS[week];
  if (props === undefined) throw new Error(`src/weekly/weeks has no week ${week}`);
  return { props, layout: mod.layout(props) };
}

function check(props, rects) {
  // Every capture and every rect a beat names must exist, or the frame would show nothing.
  const beats = props.segments.flatMap((s) => s.beats);
  const missing = [];
  for (const beat of beats) {
    if ('src' in beat.shot && !existsSync(join(captures, beat.shot.src))) missing.push(beat.shot.src);
    for (const key of [beat.focus, beat.ring]) if (key !== undefined && rects[key] === undefined) missing.push(`rects.json ${key}`);
  }
  if (missing.length > 0) throw new Error(`missing from ${captures}: ${[...new Set(missing)].join(', ')}`);
}

const size = (path) => `${(statSync(path).size / 1024 / 1024).toFixed(2)} MB`;
const ffmpeg = (...rest) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...rest], { stdio: 'inherit' });

const { props, layout } = await plan();
const rectsFile = join(captures, 'rects.json');
const rects = existsSync(rectsFile) ? JSON.parse(readFileSync(rectsFile, 'utf8')) : {};
check(props, rects);

mkdirSync(publicDir, { recursive: true });
copyFileSync(join(site, 'public', 'fonts', 'atkinson-hyperlegible-next-400-700.woff2'), join(publicDir, 'atkinson-hyperlegible-next-400-700.woff2'));
// The game's frame the drawn phone shows (components/Phone.tsx), the same file the explainer uses.
copyFileSync(join(root, 'assets', 'dust-3600.png'), join(publicDir, 'dust-3600.png'));
copyFileSync(join(root, '..', '..', 'seed-1', 'box-art.svg'), join(publicDir, 'box-art.svg'));
rmSync(join(publicDir, 'weekly', week), { recursive: true, force: true });
if (existsSync(captures)) cpSync(captures, join(publicDir, 'weekly', week), { recursive: true, filter: (src) => !src.endsWith('rects.json') });
const wav = join(publicDir, `weekly-soundtrack-${week}.wav`);
if (flag('--music') || !existsSync(wav)) execFileSync('node', [join(root, 'scripts', 'music.mjs'), '--weekly', week], { stdio: 'inherit' });

const serveUrl = await bundle({ entryPoint: join(root, 'src', 'index.ts'), publicDir });
const browserExecutable = chrome();
mkdirSync(out, { recursive: true });

for (const [name, cut] of Object.entries(CUTS)) {
  const inputProps = { format: name, week, rects };
  const composition = await selectComposition({ serveUrl, id: cut.id, inputProps, browserExecutable });
  if (flag('--stills')) {
    // One still per beat, late in its hold (the words in, the push settled, the ring drawn), one of
    // each wipe with its number in, and one of each plate.
    const dir = join(out, 'weekly-stills');
    mkdirSync(dir, { recursive: true });
    const frames = [
      ['00-plate', Math.round(120 * 1.4)],
      ...layout.beats.map((b, i) => [`${String(i + 1).padStart(2, '0')}-s${b.segment + 1}b${b.index + 1}`, b.start + b.length - 22]),
      ...layout.wipes.map((w) => [`${String(layout.beats.findIndex((b) => b.segment === w.segment)).padStart(2, '0')}-wipe-s${w.segment + 1}`, w.start + 30]),
      ['99-close', layout.duration - 30],
    ];
    for (const [label, frame] of frames) {
      const output = join(dir, `${label}.png`);
      await renderStill({ serveUrl, composition, frame, output, inputProps, browserExecutable, imageFormat: 'png' });
      console.log(output, `frame ${frame}`);
    }
    continue;
  }
  const master = join(dist, `weekly-${week}-${name}.master.mp4`);
  let last = -1;
  await renderMedia({
    serveUrl,
    composition,
    inputProps,
    codec: 'h264',
    crf: 10,
    pixelFormat: 'yuv420p',
    audioCodec: 'aac',
    audioBitrate: '256k',
    outputLocation: master,
    browserExecutable,
    concurrency: 6,
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 10) * 10;
      if (pct !== last) {
        last = pct;
        console.log(`${name}: ${pct}%`);
      }
    },
  });
  // H.264 High with AAC at 48 kHz and the index at the front: plays anywhere and posts anywhere.
  const file = join(out, cut.file);
  ffmpeg('-i', master, '-c:v', 'libx264', '-preset', 'slow', '-crf', '19', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', file);
  rmSync(master);
  console.log(`${name}: ${file} (${size(file)}, ${(composition.durationInFrames / composition.fps).toFixed(2)} s)`);
}
