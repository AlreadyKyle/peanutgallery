// Renders the explainer video (docs/specs/explainer-video.md).
//
//   node scripts/render.mjs                  the site's two cuts: MP4 (H.264, AAC), WebM (AV1, Opus) and a
//                                            poster, then every social cut, the 9:16 one included
//   node scripts/render.mjs --only wide      one cut
//   node scripts/render.mjs --still 600,1800 stills of those frames from every cut, for review
//   node scripts/render.mjs --publish        copy the finished files into platform/site/public/video
//   node scripts/render.mjs --no-social      skip the social cuts
//
// A full render also makes the social cuts in dist/social/: the same video with the site's address on
// the closing plate, H.264 High with AAC at 48 kHz and the index at the front, at a higher quality
// than the site's files, for posting to X and LinkedIn (16:9, and 4:5 for phone feeds) and to Reels and TikTok (9:16, which
// the site never shows, so it has no web files or poster).
//
// Everything is written under dist/ (gitignored, and skipped by the gate's scanners by name). The
// soundtrack comes from `pnpm music` (scripts/music.mjs), which must run first. Rendering uses the
// headless Chromium Playwright already installed, or REMOTION_CHROME; nothing is downloaded.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition } from '@remotion/renderer';
import { posterSizes } from './poster-sizes.mjs';

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

const SITE_CUTS = ['wide', 'tall'];
const CUTS = [...SITE_CUTS, 'vertical'];
const SOCIAL_NAME = { wide: '16x9', tall: '4x5', vertical: '9x16' };
/**
 * The poster: Pick a card, the hand of four dealt under the line that says what a card is (11.5 s,
 * before one is lifted). The play pill sits over empty paper at the bottom left in both cuts
 * (e2e/explainer-poster.spec.ts). Frames at 60 fps.
 */
const POSTER_FRAME = { 'explainer-wide': 690, 'explainer-tall': 690 };
const posterFrame = (composition) => POSTER_FRAME[composition.id];
/** The preview loop: 8 s from the start of Pick a card (bar 4 in timeline.ts SCENES), per cut's size. */
const LOOP = { from: 8, seconds: 8, size: { wide: '1280:720', tall: '720:900' } };

function chrome() {
  if (process.env.REMOTION_CHROME) return process.env.REMOTION_CHROME;
  const cache = join(homedir(), 'Library', 'Caches', 'ms-playwright');
  const shells = existsSync(cache) ? readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort() : [];
  for (const shell of shells.reverse()) {
    for (const sub of readdirSync(join(cache, shell))) {
      const bin = join(cache, shell, sub, 'chrome-headless-shell');
      if (existsSync(bin)) return bin;
    }
  }
  throw new Error('No headless Chromium found: run `pnpm exec playwright install chromium` in platform/site, or set REMOTION_CHROME');
}

function prepare() {
  mkdirSync(publicDir, { recursive: true });
  copyFileSync(join(site, 'public', 'fonts', 'atkinson-hyperlegible-next-400-700.woff2'), join(publicDir, 'atkinson-hyperlegible-next-400-700.woff2'));
  copyFileSync(join(root, 'assets', 'dust-3600.png'), join(publicDir, 'dust-3600.png'));
  if (!existsSync(join(publicDir, 'soundtrack.wav'))) throw new Error('dist/public/soundtrack.wav is missing: run `pnpm music` first');
}

function ffmpeg(...rest) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...rest], { stdio: 'inherit' });
}

function size(path) {
  return `${(statSync(path).size / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  if (flag('--publish')) {
    const out = join(site, 'public', 'video');
    mkdirSync(out, { recursive: true });
    for (const cut of SITE_CUTS) {
      for (const ext of ['mp4', 'webm', 'jpg', 'loop']) {
        const name = ext === 'jpg' ? `explainer-${cut}-poster.jpg` : ext === 'loop' ? `explainer-${cut}-loop.mp4` : `explainer-${cut}.${ext}`;
        copyFileSync(join(dist, name), join(out, name));
        console.log(`published ${name} (${size(join(out, name))})`);
      }
    }
    // The smaller and WebP posters the site's picture element offers (scripts/poster-sizes.mjs).
    posterSizes(out);
    return;
  }

  prepare();
  const serveUrl = await bundle({ entryPoint: join(root, 'src', 'index.ts'), publicDir });
  const browserExecutable = chrome();
  const only = value('--only');
  const cuts = only === undefined ? CUTS : [only];
  const still = value('--still');

  for (const cut of cuts) {
    const composition = await selectComposition({ serveUrl, id: `explainer-${cut}`, browserExecutable });
    if (still !== undefined) {
      mkdirSync(join(dist, 'stills'), { recursive: true });
      for (const frame of still.split(',').map(Number)) {
        const output = join(dist, 'stills', `${cut}-${frame}.png`);
        await renderStill({ serveUrl, composition, frame, output, browserExecutable, imageFormat: 'png' });
        console.log(output);
      }
      continue;
    }
    // A near-lossless master first; the two web files are both encoded from it, so neither is a copy
    // of a copy. The 9:16 cut is for posting only, so it makes just its social file below.
    if (SITE_CUTS.includes(cut)) {
      const master = join(dist, `explainer-${cut}.master.mp4`);
      let last = -1;
      await renderMedia({
        serveUrl,
        composition,
        codec: 'h264',
        crf: 10,
        pixelFormat: 'yuv420p',
        audioCodec: 'aac',
        audioBitrate: '256k',
        outputLocation: master,
        browserExecutable,
        onProgress: ({ progress }) => {
          const pct = Math.floor(progress * 10) * 10;
          if (pct !== last) {
            last = pct;
            console.log(`${cut}: ${pct}%`);
          }
        },
      });
      // H.264 for every browser, the index at the front so playback starts before the file has arrived;
      // AV1 in WebM for the browsers that take it, at about half the size.
      const mp4 = join(dist, `explainer-${cut}.mp4`);
      ffmpeg('-i', master, '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', mp4);
      const webm = join(dist, `explainer-${cut}.webm`);
      ffmpeg('-i', master, '-c:v', 'libsvtav1', '-preset', '5', '-crf', '44', '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k', webm);
      // The poster's muted preview loop (docs/specs/free-games-home.md): the first 8 s of Pick a card,
      // silent, at 30 fps and the poster's 720 size, about 130 KB.
      const loop = join(dist, `explainer-${cut}-loop.mp4`);
      ffmpeg('-ss', String(LOOP.from), '-t', String(LOOP.seconds), '-i', master, '-an', '-vf', `fps=30,scale=${LOOP.size[cut]}:flags=lanczos`, '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-b:v', '125k', '-maxrate', '160k', '-bufsize', '320k', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', loop);
      rmSync(master);
      const poster = join(dist, `explainer-${cut}-poster.jpg`);
      await renderStill({ serveUrl, composition, frame: posterFrame(composition), output: poster, browserExecutable, imageFormat: 'jpeg', jpegQuality: 90 });
      console.log(`${cut}: ${mp4} (${size(mp4)}), ${webm} (${size(webm)}), ${poster} (${size(poster)})`);
    }

    if (!flag('--no-social')) {
      const inputProps = { format: cut, social: true };
      const socialComposition = await selectComposition({ serveUrl, id: `explainer-${cut}`, inputProps, browserExecutable });
      const socialMaster = join(dist, `explainer-${cut}.social.master.mp4`);
      await renderMedia({
        serveUrl,
        composition: socialComposition,
        inputProps,
        codec: 'h264',
        crf: 10,
        pixelFormat: 'yuv420p',
        audioCodec: 'aac',
        audioBitrate: '256k',
        outputLocation: socialMaster,
        browserExecutable,
      });
      mkdirSync(join(dist, 'social'), { recursive: true });
      const social = join(dist, 'social', `mob-machine-explainer-${SOCIAL_NAME[cut]}.mp4`);
      ffmpeg('-i', socialMaster, '-c:v', 'libx264', '-preset', 'slow', '-tune', 'animation', '-crf', '18', '-profile:v', 'high', '-level', '4.2', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', social);
      rmSync(socialMaster);
      console.log(`${cut}: ${social} (${size(social)})`);
    }
  }
}

await main();
